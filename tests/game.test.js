import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The game logic ships as plain browser scripts (no import/export), so the
// browser can load it straight off the filesystem. To test it in Node we load
// the pure-logic files in order and evaluate them in one shared scope, then
// hand back the symbols under test — exactly the globals the browser sees.
const here = path.dirname(fileURLToPath(import.meta.url));
const LOGIC_FILES = ['constants.js', 'utils.js', 'terrain.js', 'pieces.js', 'board.js', 'game.js'];

const source = LOGIC_FILES.map((file) => fs.readFileSync(path.join(here, '..', 'src', file), 'utf8')).join('\n');
const {
  createInitialState,
  movePlayer,
  getVisibleBounds,
  getPlayerMoves,
  capturableAt,
  generateFloor,
  defeatBoss,
  bossKindForFloor,
  useClassAltar,
  rollClassAltarOffers,
  highestClass,
  movePlayerTo,
} = new Function(
  `${source}\nreturn { createInitialState, movePlayer, getVisibleBounds, getPlayerMoves, capturableAt, generateFloor, defeatBoss, bossKindForFloor, useClassAltar, rollClassAltarOffers, highestClass, movePlayerTo };`,
)();

// Build a bare enemy with the default state flags, overridden by `extra`.
function makeEnemy(extra) {
  return {
    id: `t-${extra.x}-${extra.y}`,
    awake: false,
    surprised: false,
    frustrated: false,
    statue: false,
    turret: false,
    boss: false,
    ...extra,
  };
}

test('createInitialState starts the king at the center and spawns enemies', () => {
  const state = createInitialState();

  assert.equal(state.player.x, 8);
  assert.equal(state.player.y, 8);
  assert.ok(state.enemies.length >= 3);
});

test('movePlayer updates the position and triggers an enemy turn', () => {
  const state = createInitialState();
  const next = movePlayer(state, 1, 0);

  assert.equal(next.player.x, 9);
  assert.equal(next.turn, 1);
  assert.equal(next.enemyTurn, true);
});

test('visible bounds are centered on the player and match the starting vision', () => {
  const state = createInitialState();
  const bounds = getVisibleBounds(state);

  // The king starts with a 5x5 sight window, centered on (8,8).
  assert.equal(bounds.width, 5);
  assert.equal(bounds.height, 5);
  assert.equal(bounds.x, 6);
  assert.equal(bounds.y, 6);
});

test('a fresh floor reveals fog of war around the king', () => {
  const state = createInitialState();

  // The king's own tile is explored at floor start; far corners are not.
  assert.ok(state.explored['8,8']);
  assert.ok(!state.explored['0,0']);
});

test('statues block the king but cannot be captured', () => {
  const state = createInitialState();
  state.terrain = {};
  state.enemies = [makeEnemy({ kind: 'queen', x: 9, y: 8, statue: true })];

  assert.equal(capturableAt(state, 9, 8), false);
  // The king (at 8,8) may not land on the statue's tile.
  assert.ok(!getPlayerMoves(state).some((m) => m.x === 9 && m.y === 8));
});

test('turrets cannot be captured', () => {
  const state = createInitialState();
  state.terrain = {};
  state.enemies = [makeEnemy({ kind: 'rook', x: 9, y: 8, turret: true, awake: true })];

  assert.equal(capturableAt(state, 9, 8), false);
  assert.ok(!getPlayerMoves(state).some((m) => m.x === 9 && m.y === 8));
});

test('a boss is shielded while a visible guard remains, then becomes vulnerable', () => {
  const state = createInitialState();
  state.terrain = {};
  state.enemies = [
    makeEnemy({ kind: 'amazon', x: 9, y: 8, boss: true, awake: true }),
    makeEnemy({ kind: 'pawn', x: 8, y: 9, awake: true }),
  ];

  // The pawn guard is in sight, so the boss cannot be captured.
  assert.equal(capturableAt(state, 9, 8), false);

  // With the guard gone, the boss is vulnerable.
  state.enemies = state.enemies.filter((e) => e.kind !== 'pawn');
  assert.equal(capturableAt(state, 9, 8), true);
});

test('class altars advance a ladder and always offer the strongest class next', () => {
  let state = createInitialState();

  // Two rungs of Barbarian: Cleave (a melee trait) then Plunder (+3 gold/kill).
  state.altar = { x: 1, y: 1, used: false, offers: ['barbarian'] };
  state = useClassAltar(state, 'barbarian');
  assert.deepEqual(state.player.meleeTraits, ['thrust']);
  state.altar = { x: 1, y: 1, used: false, offers: ['barbarian'] };
  state = useClassAltar(state, 'barbarian');
  assert.equal(state.player.goldPerKill, 3);
  assert.equal(state.player.classLevels.barbarian, 2);

  // Barbarian is now the strongest class, so every altar offers its next rung.
  assert.equal(highestClass(state.player), 'barbarian');
  for (let i = 0; i < 12; i += 1) {
    assert.ok(rollClassAltarOffers(state.player, 3).includes('barbarian'));
  }
});

test('an armored foe survives the first hit, shedding armor and flinging the king home', () => {
  const state = createInitialState();
  state.terrain = {};
  state.enemies = [makeEnemy({ kind: 'rook', x: 9, y: 8, armored: true })];

  const next = movePlayerTo(state, 9, 8); // king (8,8) strikes the adjacent armored rook
  const foe = next.enemies.find((e) => e.x === 9 && e.y === 8);
  assert.ok(foe, 'the armored foe survives the first blow');
  assert.equal(foe.armored, false, 'its armor is shattered');
  assert.equal(next.player.x, 8); // hurled back to the floor start (8,8)
  assert.equal(next.player.y, 8);
});

test('the final floor is guarded by an amazon boss behind a barred stair', () => {
  const player = createInitialState().player;
  const state = generateFloor(15, player, 0);
  const boss = state.enemies.find((e) => e.boss);

  assert.equal(bossKindForFloor(15), 'amazon');
  assert.ok(boss && boss.kind === 'amazon');
  assert.ok(state.exit && state.exit.locked === true);
});

test('defeating a boss unbars the stair, and the final boss wins the run', () => {
  const player = createInitialState().player;

  // A non-final boss floor: defeating the boss unlocks the exit.
  const mid = generateFloor(2, player, 0);
  mid.exit = { x: 5, y: 5, locked: true };
  defeatBoss(mid, 5, 5);
  assert.equal(mid.exit.locked, false);
  assert.equal(Boolean(mid.won), false);

  // A final boss floor: defeating the boss wins.
  const last = generateFloor(15, player, 0);
  defeatBoss(last, last.exit.x, last.exit.y);
  assert.equal(last.won, true);
});

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
  beginEnemyPhase,
  floorGoldReward,
  moveEnemy,
  getPieceThreats,
  createBoss,
  useCard,
  createPlayer,
  chebyshev,
} = new Function(
  `${source}\nreturn { createInitialState, movePlayer, getVisibleBounds, getPlayerMoves, capturableAt, generateFloor, defeatBoss, bossKindForFloor, useClassAltar, rollClassAltarOffers, highestClass, movePlayerTo, beginEnemyPhase, floorGoldReward, moveEnemy, getPieceThreats, createBoss, useCard, createPlayer, chebyshev };`,
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

test('class altars spend exp to learn class perks in order', () => {
  let state = createInitialState('valkyrie'); // starts with Valkyrie level 1
  state.player.exp = 5;

  // Learn Barbarian L1 (Arsenal, +1 weapon slot) — costs 1 exp.
  const slots = state.player.maxCards;
  state.altar = { x: 1, y: 1, used: false, offers: ['barbarian'] };
  state = useClassAltar(state, 'barbarian');
  assert.equal(state.player.classLevels.barbarian, 1);
  assert.equal(state.player.maxCards, slots + 1);
  assert.equal(state.player.exp, 4);

  // Learn Barbarian L2 (Frenzy) — costs 2 exp.
  state.altar = { x: 1, y: 1, used: false, offers: ['barbarian'] };
  state = useClassAltar(state, 'barbarian');
  assert.equal(state.player.frenzy, true);
  assert.equal(state.player.exp, 2);
});

test('a class altar refuses a perk the king cannot afford', () => {
  let state = createInitialState('valkyrie');
  state.player.exp = 0;
  state.altar = { x: 1, y: 1, used: false, offers: ['ranger'] };
  state = useClassAltar(state, 'ranger');
  assert.equal(state.player.classLevels.ranger || 0, 0); // not learned
  assert.equal(state.altar.used, false); // altar not spent
});

test('an enemy is never surprised two enemy phases in a row', () => {
  const state = createInitialState();
  state.terrain = {};
  // A rook that was already surprised last phase, still in sight.
  state.enemies = [makeEnemy({ kind: 'rook', x: 9, y: 8, awake: false, surprised: true })];

  const phase = beginEnemyPhase(state);
  const e = phase.state.enemies[0];
  assert.equal(e.surprised, false, 'it acts this phase rather than freezing again');
  assert.ok(phase.moverIds.includes(e.id));
});

test('the descend reward decays about 1% per turn to zero', () => {
  const s = createInitialState();
  const t0 = floorGoldReward(s);
  s.turn = 50;
  const t50 = floorGoldReward(s);
  s.turn = 100;
  const t100 = floorGoldReward(s);

  assert.ok(t0 > t50 && t50 > t100);
  assert.equal(t100, 0);
});

test('a mage fires, then cannot fire the very next turn (no two acts in a row)', () => {
  const state = createInitialState();
  state.terrain = {};
  // A rook-mage on the king's file, charged.
  state.enemies = [makeEnemy({ kind: 'rook', x: 8, y: 5, mage: true, charged: true })];

  const afterFire = moveEnemy(state, state.enemies[0].id);
  assert.ok(afterFire.player.hp < state.player.hp, 'the bolt hits');
  assert.equal(afterFire.enemies[0].charged, false, 'it is spent');

  const afterRecharge = moveEnemy(afterFire, afterFire.enemies[0].id);
  assert.equal(afterRecharge.player.hp, afterFire.player.hp, 'it cannot fire again immediately');
  assert.equal(afterRecharge.enemies[0].charged, true, 'it recharges');
});

test('a mage only marks tiles as dangerous while it is charged', () => {
  const state = createInitialState();
  state.terrain = {};
  assert.ok(getPieceThreats(makeEnemy({ kind: 'rook', x: 8, y: 5, mage: true, charged: true }), state).length > 0);
  assert.equal(getPieceThreats(makeEnemy({ kind: 'rook', x: 8, y: 5, mage: true, charged: false }), state).length, 0);
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

test('Valkyrie Reflection turns a mage bolt back, slaying the mage unharmed', () => {
  const state = createInitialState('valkyrie');
  state.terrain = {};
  state.player.reflect = true;
  state.player.hp = 5;
  state.enemies = [makeEnemy({ kind: 'rook', x: 8, y: 5, mage: true, charged: true })];

  const next = moveEnemy(state, state.enemies[0].id);
  assert.equal(next.enemies.length, 0, 'the mage is slain by its reflected bolt');
  assert.equal(next.player.hp, 5, 'the king takes no damage');
});

test('Necromancer Undying revives once per floor at the start tile', () => {
  const state = createInitialState('necromancer');
  state.terrain = {};
  state.player.extraLife = true;
  state.player.extraLifeUsed = false;
  state.player.hp = 1;
  state.player.x = 3;
  state.player.y = 3;
  // A pawn strikes the lone-HP king from an adjacent tile.
  state.enemies = [makeEnemy({ kind: 'king', x: 3, y: 4, awake: true })];

  const next = moveEnemy(state, state.enemies[0].id);
  assert.equal(next.gameOver, false, 'the run continues');
  assert.equal(next.player.hp, 1, 'revived at 1 HP');
  assert.equal(next.player.x, 8, 'back at the start tile');
  assert.equal(next.player.extraLifeUsed, true);
});

test('Ninja Silent keeps unaware distant foes from noticing (but not adjacent ones)', () => {
  const state = createInitialState('ninja');
  state.terrain = {};
  state.player.stealth = true;
  state.player.attacked = false;

  // Two tiles away and unaware → stays unaware, not a mover.
  state.enemies = [makeEnemy({ kind: 'queen', x: 8, y: 6, awake: false })];
  let phase = beginEnemyPhase(state);
  assert.equal(phase.moverIds.length, 0);
  assert.equal(phase.state.enemies[0].awake, false);

  // Right beside him → notices normally.
  state.enemies = [makeEnemy({ kind: 'queen', x: 8, y: 7, awake: false })];
  phase = beginEnemyPhase(state);
  assert.equal(phase.state.enemies[0].awake, true);
});

test('every floor has its unique authored boss; the final floor is the Balrog', () => {
  const player = createInitialState('valkyrie').player;
  const f2 = generateFloor(2, player, 0);
  const centaur = f2.enemies.find((e) => e.boss);
  assert.ok(centaur, 'floor 2 has a boss');
  assert.equal(centaur.bossName, 'the Centaur');
  assert.deepEqual(centaur.phases, ['knight', 'king']);

  const state = generateFloor(10, player, 0);
  const boss = state.enemies.find((e) => e.boss);
  assert.equal(bossKindForFloor(10), 'queen');
  assert.ok(boss && boss.bossName === 'the Balrog');
  assert.equal(boss.kind, 'queen'); // its opening form
});

test('the authored exit sits at the fixed chamber anchor with a sleeping cohort', () => {
  const player = createInitialState('valkyrie').player;
  const state = generateFloor(1, player, 0);
  assert.deepEqual({ x: state.exit.x, y: state.exit.y }, { x: 16, y: 16 }); // floor 1 anchor
  // The cohort (four sleeping guards) stands loosely around the chamber.
  const cohort = state.enemies.filter((e) => !e.boss && !e.awake && chebyshev(e.x, e.y, state.exit.x, state.exit.y) <= 5);
  assert.ok(cohort.length >= 3, 'a sleeping cohort guards the chamber');
});

test('a multi-phase boss sheds a form before it can be slain', () => {
  const state = createInitialState('valkyrie');
  state.terrain = {};
  state.enemies = [];
  const boss = createBoss(6, 5, 5); // the Lich: king -> king -> king
  boss.homeX = 5;
  boss.homeY = 5;
  state.enemies.push(boss);
  state.player.x = 4;
  state.player.y = 5; // adjacent, so a normal move captures

  const first = movePlayerTo(state, 5, 5); // strike phase 1
  const survivor = first.enemies.find((e) => e.boss);
  assert.ok(survivor, 'the Lich is not gone after one blow');
  assert.equal(survivor.phase, 1, 'it advanced to its second form');
  assert.equal(Boolean(first.won), false);
});

test('the Bone Dragon shrugs off ranged blows but falls to an adjacent strike', () => {
  const player = createPlayer('valkyrie');
  player.cards = [{ kind: 'rook', traits: [], cooldown: 3, remaining: 0 }];
  const state = createInitialState('valkyrie');
  state.player = player;
  state.terrain = {};
  state.enemies = [];
  const boss = createBoss(9, 8, 10); // the Bone Dragon (meleeOnly), phase 0 = rook
  boss.phase = boss.phases.length - 1; // its final form, so a killing blow would end it
  boss.homeX = 8;
  boss.homeY = 10;
  state.enemies = [boss];
  state.player.x = 8;
  state.player.y = 8; // two tiles away (in card range), a clear rook file

  const ranged = useCard(state, 0, 8, 10); // a distant rook strike
  assert.equal(ranged.lastAction, 'blocked', 'ranged blow is shrugged off');
  assert.ok(ranged.enemies.some((e) => e.boss), 'the Bone Dragon still stands');
});

test('slaying a boss pays a gold bounty; the final boss wins the run', () => {
  const player = createInitialState('valkyrie').player;

  // A non-final boss floor: defeating the boss pays gold (not a win).
  const mid = generateFloor(2, player, 0);
  mid.player.gold = 0;
  mid.turn = 0;
  defeatBoss(mid, 5, 5);
  assert.ok(mid.player.gold > 0);
  assert.equal(Boolean(mid.won), false);

  // A final boss floor: defeating the boss wins.
  const last = generateFloor(10, player, 0);
  defeatBoss(last, 1, 1);
  assert.equal(last.won, true);
});

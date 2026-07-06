import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The game logic ships as plain browser scripts (no import/export). To test in
// Node we load the pure-logic files in order and evaluate them in one shared
// scope, then hand back the symbols under test — the same globals the browser sees.
const here = path.dirname(fileURLToPath(import.meta.url));
const LOGIC_FILES = ['constants.js', 'utils.js', 'terrain.js', 'pieces.js', 'board.js', 'game.js'];
const source = LOGIC_FILES.map((file) => fs.readFileSync(path.join(here, '..', 'src', file), 'utf8')).join('\n');

const api = new Function(
  `${source}\nreturn { createInitialState, createPlayer, generateFloor, nextFloor, learnPerk, rollLevelPerks, getPlayerMoves, movePlayer, movePlayerTo, beginEnemyPhase, moveEnemy, maybeSpawnEnemy, useCard, consumeItem, getVisibleBounds, capturableAt, createBoss, defeatBoss, enemyRole, getCardMoves, getPieceThreats, chebyshev, CLASSES, terrainAt };`,
)();
const {
  createInitialState, createPlayer, generateFloor, nextFloor, learnPerk, rollLevelPerks,
  getPlayerMoves, movePlayerTo, beginEnemyPhase, moveEnemy, useCard,
  getVisibleBounds, capturableAt, createBoss, enemyRole, getCardMoves, chebyshev, CLASSES, terrainAt,
} = api;

// A bare enemy with the default flags, overridden by `extra`.
function makeEnemy(extra) {
  return {
    id: `t-${extra.x}-${extra.y}-${Math.random()}`,
    awake: false, surprised: false, frustrated: false,
    statue: false, turret: false, boss: false, summonCircle: false, summoned: false,
    charged: true, lastSeen: null, lastSeenTtl: 0,
    ...extra,
  };
}

test('createInitialState starts the king at the center and spawns enemies', () => {
  const state = createInitialState('warrior');
  assert.equal(state.player.x, 8);
  assert.equal(state.player.y, 8);
  assert.ok(state.enemies.length >= 3);
});

test('category is a class property; each class starts with its one card', () => {
  // Cards no longer carry a category — it is derived from the owning class.
  assert.equal(createPlayer('warrior').cards[0].kind, 'king');
  assert.equal(createPlayer('warrior').cards[0].category, undefined);
  assert.equal(CLASSES.warrior.category, 'melee');
  assert.equal(createPlayer('ranger').cards[0].kind, 'knight');
  assert.equal(CLASSES.ranger.category, 'ranged');
  assert.equal(createPlayer('sorcerer').cards[0].kind, 'rook');
  assert.equal(CLASSES.sorcerer.category, 'spell');
  assert.equal(createPlayer('warrior').cards.length, 1);
});

test('visible bounds are a centered 7x7 window', () => {
  const bounds = getVisibleBounds(createInitialState('warrior'));
  assert.equal(bounds.width, 7);
  assert.equal(bounds.height, 7);
  assert.equal(bounds.x, 5);
  assert.equal(bounds.y, 5);
});

test('a fresh floor reveals fog around the king but not the far corners', () => {
  const state = createInitialState('warrior');
  assert.ok(state.explored['8,8']);
  assert.ok(!state.explored['0,0']);
});

test('statues and turrets cannot be captured; a summoning circle can', () => {
  const s = createInitialState('warrior');
  s.terrain = {};
  s.enemies = [
    makeEnemy({ kind: 'rook', x: 9, y: 8, statue: true }),
    makeEnemy({ kind: 'rook', x: 8, y: 9, turret: true }),
    makeEnemy({ kind: 'pawn', x: 7, y: 8, summonCircle: true }),
  ];
  assert.equal(capturableAt(s, 9, 8), false);
  assert.equal(capturableAt(s, 8, 9), false);
  assert.equal(capturableAt(s, 7, 8), true);
});

test('a boss has HP: it takes several hits, and the final floor boss wins the run', () => {
  const s = createInitialState('warrior');
  s.terrain = {};
  s.enemies = [];
  s.floor = 8;
  const boss = createBoss(8, 9, 8);
  assert.ok(boss.hp > 1);
  s.enemies = [boss];
  s.player.x = 8;
  s.player.y = 8;
  let n = s;
  for (let i = 0; i < boss.maxHp; i += 1) {
    const b = n.enemies.find((e) => e.boss);
    if (!b) break;
    n.player.x = b.x - 1;
    n.player.y = b.y;
    n = movePlayerTo(n, b.x, b.y);
  }
  assert.equal(n.won, true);
});

test('a summoning circle conjures a foe when it sees you, and dies when stepped on', () => {
  const s = createInitialState('warrior');
  s.terrain = {};
  s.player.x = 8;
  s.player.y = 8;
  const circle = makeEnemy({ kind: 'pawn', x: 9, y: 8, summonCircle: true, awake: true });
  s.enemies = [circle];
  assert.equal(enemyRole(circle), 'circle');
  const before = s.enemies.length;
  const acted = moveEnemy(s, circle.id);
  assert.ok(acted.enemies.length > before, 'it conjured a minion');
  const destroyed = movePlayerTo(s, 9, 8);
  assert.ok(!destroyed.enemies.some((e) => e.summonCircle), 'stepping on it destroys it');
});

test('a ground potion is picked up on arrival', () => {
  const s = createInitialState('warrior');
  s.terrain = {};
  s.enemies = [];
  s.player.x = 8;
  s.player.y = 8;
  s.player.consumables = [];
  s.items = [{ kind: 'consumable', potion: 'health', x: 9, y: 8 }];
  const n = movePlayerTo(s, 9, 8);
  assert.equal(n.player.consumables.length, 1);
  assert.equal(n.items.length, 0);
});

test('the king cannot cross lava, but enemies can', () => {
  const blocked = createInitialState('warrior');
  blocked.terrain = { '9,8': 'lava' };
  blocked.player.x = 8;
  blocked.player.y = 8;
  assert.ok(!getPlayerMoves(blocked).some((m) => m.x === 9 && m.y === 8), 'king blocked by lava');

  const s = createInitialState('warrior');
  s.terrain = { '9,8': 'lava' };
  s.floor = 6; // enemies cross lava
  s.player.x = 8;
  s.player.y = 8;
  s.player.hp = 5;
  s.enemies = [makeEnemy({ kind: 'rook', x: 11, y: 8, awake: true })];
  const n = moveEnemy(s, s.enemies[0].id);
  assert.ok(n.player.hp < 5 || n.enemies[0].x < 11, 'the rook crossed the lava toward the king');
});

test('water is passable but slow', () => {
  const s = createInitialState('warrior');
  s.terrain = { '9,8': 'water' };
  s.player.x = 8;
  s.player.y = 8;
  assert.ok(getPlayerMoves(s).some((m) => m.x === 9 && m.y === 8), 'the king can wade into water');
});

test('a melee card moves the king onto the target; a spell card pierces cover', () => {
  const melee = createInitialState('warrior');
  melee.terrain = {};
  melee.player.x = 8;
  melee.player.y = 8;
  melee.enemies = [makeEnemy({ kind: 'pawn', x: 9, y: 8, awake: true })];
  const m = useCard(melee, 0, 9, 8);
  assert.deepEqual({ x: m.player.x, y: m.player.y }, { x: 9, y: 8 });
  assert.equal(m.enemies.length, 0);

  const spell = createInitialState('sorcerer');
  spell.terrain = {};
  spell.player.x = 8;
  spell.player.y = 8;
  spell.enemies = [makeEnemy({ kind: 'pawn', x: 9, y: 8, awake: true }), makeEnemy({ kind: 'pawn', x: 11, y: 8, awake: true })];
  const targets = getCardMoves(spell, spell.player.cards[0]);
  assert.ok(targets.some((t) => t.x === 11 && t.y === 8), 'spell targets through the blocker');
  const n = useCard(spell, 0, 11, 8);
  assert.deepEqual({ x: n.player.x, y: n.player.y }, { x: 8, y: 8 }, 'the caster holds his tile');
  assert.equal(n.enemies.length, 0, 'the bolt slays both');
});

test('a melee enemy cannot move AND strike in the same turn', () => {
  const s = createInitialState('warrior');
  s.terrain = {};
  s.player.hp = 5;
  s.player.x = 8;
  s.player.y = 8;
  const foe = makeEnemy({ kind: 'king', x: 10, y: 8, awake: true });
  s.enemies = [foe];
  const n = moveEnemy(s, foe.id);
  assert.equal(n.player.hp, 5, 'no damage — it could not reach the king');
  assert.equal(chebyshev(n.enemies[0].x, n.enemies[0].y, 8, 8), 1, 'it merely closed in');
});

test('descending queues a level-up; taking a stat perk and a card perk both apply', () => {
  let s = createInitialState('warrior');
  s.floor = 1;
  const n = nextFloor(s);
  assert.equal(n.pendingLevelUp, true);
  assert.ok(Array.isArray(n.levelPerks) && n.levelPerks.length === 3);

  let hp = createInitialState('warrior');
  const hp0 = hp.player.maxHp;
  hp.pendingLevelUp = true;
  hp = learnPerk(hp, 'w_hp');
  assert.equal(hp.player.maxHp, hp0 + 2);

  let card = createInitialState('warrior');
  const cards0 = card.player.cards.length;
  card.pendingLevelUp = true;
  card = learnPerk(card, 'w_knight');
  assert.equal(card.player.cards.length, cards0 + 1);
  assert.ok(card.player.cards.some((c) => c.kind === 'knight'));
});

test('rollLevelPerks offers three from the class pool and skips taken uniques', () => {
  const p = createPlayer('sorcerer');
  const offers = rollLevelPerks(p, 3);
  assert.equal(offers.length, 3);
  assert.ok(offers.every((o) => CLASSES.sorcerer.perks.some((k) => k.id === o.id)));
  // A repeatable perk can be taken twice; a unique cannot recur.
  p.takenPerks = CLASSES.sorcerer.perks.filter((k) => !k.repeatable).map((k) => k.id);
  const remaining = rollLevelPerks(p, 3);
  assert.ok(remaining.every((o) => CLASSES.sorcerer.perks.find((k) => k.id === o.id).repeatable));
});

test('an enemy is never surprised two enemy phases in a row', () => {
  const s = createInitialState('warrior');
  s.terrain = {};
  s.player.x = 8;
  s.player.y = 8;
  s.enemies = [makeEnemy({ kind: 'queen', x: 8, y: 6, awake: false })];
  const first = beginEnemyPhase(s).state;
  assert.equal(first.enemies[0].surprised, true);
  const second = beginEnemyPhase(first).state;
  assert.equal(second.enemies[0].surprised, false, 'it acts the following turn, not surprised again');
});

test('an out-of-sight enemy pursues the king’s last-seen tile', () => {
  const s = createInitialState('warrior');
  s.terrain = {};
  s.player.x = 8;
  s.player.y = 8;
  s.enemies = [makeEnemy({ kind: 'king', x: 11, y: 8, awake: false })];
  let st = beginEnemyPhase(s).state;
  assert.deepEqual(st.enemies[0].lastSeen, { x: 8, y: 8 });
  st.terrain = { '10,8': 'wall' };
  const after = beginEnemyPhase(st).state.enemies[0];
  assert.ok(chebyshev(after.x, after.y, 8, 8) < chebyshev(11, 8, 8, 8), 'it advanced toward the memory');
});

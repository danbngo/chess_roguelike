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
  `${source}\nreturn { createInitialState, createPlayer, generateFloor, nextFloor, learnPerk, rollLevelPerks, getPlayerMoves, movePlayer, movePlayerTo, beginEnemyPhase, moveEnemy, maybeSpawnEnemy, useCard, getVisibleBounds, capturableAt, createBoss, defeatBoss, enemyRole, getCardMoves, getPieceThreats, chebyshev, CLASSES, terrainAt, unitInSight, fireTurret, summonCircleTurn, tryDescend, collectKeyIfHere, getPieceMoves, blinkToSafety, getThreatenedTiles, advanceAllies, allyAt, enemyAwareOfKing, playerDisplayColor, chainColorFor, ensureReachable, dangerReachOk, standableFor, blocksSight, knockbackBoulder, meltIce, smashIce, inLineOfSight, isBefriendedBeast };`,
)();
const {
  createInitialState, createPlayer, generateFloor, nextFloor, learnPerk, rollLevelPerks,
  getPlayerMoves, movePlayer, movePlayerTo, beginEnemyPhase, moveEnemy, useCard,
  getVisibleBounds, capturableAt, createBoss, enemyRole, getCardMoves, chebyshev, CLASSES, terrainAt, unitInSight,
  fireTurret, summonCircleTurn, tryDescend, collectKeyIfHere, getPieceMoves, blinkToSafety, getThreatenedTiles,
  advanceAllies, allyAt, enemyAwareOfKing, playerDisplayColor, chainColorFor, getPieceThreats, maybeSpawnEnemy,
  ensureReachable, dangerReachOk, standableFor, blocksSight, knockbackBoulder, meltIce, smashIce, inLineOfSight, isBefriendedBeast,
} = api;

// A bare enemy with the default flags, overridden by `extra`.
function makeEnemy(extra) {
  return {
    id: `t-${extra.x}-${extra.y}-${Math.random()}`,
    awake: false, surprised: false, frustrated: false,
    turret: false, boss: false, summonCircle: false, summoned: false,
    charged: true, lastSeen: null, lastSeenTtl: 0,
    ...extra,
  };
}

test('createInitialState starts the king at the center and spawns enemies', () => {
  const state = createInitialState('warrior');
  assert.equal(state.player.x, 10);
  assert.equal(state.player.y, 10);
  assert.ok(state.enemies.length >= 3);
});

test('category is a class property; each class starts with its one card', () => {
  // Cards no longer carry a category — it is derived from the owning class.
  assert.equal(createPlayer('warrior').cards[0].kind, 'knight'); // a melee leap ("horse")
  assert.equal(createPlayer('warrior').cards[0].category, undefined);
  assert.equal(CLASSES.warrior.category, 'melee');
  assert.equal(createPlayer('ranger').cards[0].kind, 'rook'); // the Ranger now opens with a rook
  assert.equal(createPlayer('ranger').cards[0].cooldown, 5); // the rook's own (per-unit) cooldown
  assert.equal(CLASSES.ranger.category, 'ranged');
  assert.equal(createPlayer('sorcerer').cards[0].kind, 'bishop'); // the Sorcerer now opens with a bishop
  assert.equal(createPlayer('sorcerer').cards[0].cooldown, 3); // the bishop's own (per-unit) cooldown
  assert.equal(CLASSES.sorcerer.category, 'spell');
  assert.equal(createPlayer('warrior').cards.length, 1);
});

test('visible bounds are a centered 7x7 window', () => {
  const bounds = getVisibleBounds(createInitialState('warrior'));
  assert.equal(bounds.width, 7);
  assert.equal(bounds.height, 7);
  assert.equal(bounds.x, 7);
  assert.equal(bounds.y, 7);
});

test('a fresh floor reveals fog around the king but not the far corners', () => {
  const state = createInitialState('warrior');
  assert.ok(state.explored['10,10']);
  assert.ok(!state.explored['0,0']);
});

test('arriving on any floor leaves no enemy in the king’s line of sight', () => {
  // EVERY floor — the first (a fresh new game) included — should open on a quiet view so
  // the king explores into danger and tutorials never pop in a pile. (The boss sits far
  // off on the stair, out of sight.)
  for (let floor = 1; floor <= 8; floor += 1) {
    const s = generateFloor(floor, createPlayer('warrior'), 0);
    const visibleFoes = s.enemies.filter((e) => !e.boss && unitInSight(s, e.x, e.y));
    assert.equal(visibleFoes.length, 0, `floor ${floor} arrives with no foe in view`);
    assert.ok(!unitInSight(s, s.enemies.find((e) => e.boss).x, s.enemies.find((e) => e.boss).y), `floor ${floor} boss is out of sight`);
  }
});

test('the king’s token colour is his class colour, upgraded to a tier-3 subclass capstone', () => {
  let s = createInitialState('warrior');
  assert.equal(playerDisplayColor(s.player), CLASSES.warrior.color, 'base is the class colour');
  // Climb the Sentinel chain to its tier-3 capstone (Parry) — the colour becomes Sentinel's.
  for (const id of ['w_hp1', 'w_hp2', 'w_bulwark']) {
    s.pendingLevelUp = true;
    s = learnPerk(s, id);
  }
  assert.equal(playerDisplayColor(s.player), chainColorFor('warrior', 'Sentinel'), 'a tier-3 capstone recolours him');
  assert.notEqual(chainColorFor('warrior', 'Sentinel'), CLASSES.warrior.color, 'and that colour differs from the base');
});

test('a FIRE turret pierces a body to blast the king, on a 3-turn cycle; fire turrets are fire-immune', () => {
  const s = createInitialState('warrior');
  s.floor = 6; s.terrain = {};
  s.player.x = 10; s.player.y = 10; s.player.hp = 4; s.player.maxHp = 4; s.player.className = 'warrior';
  const turret = makeEnemy({ kind: 'rook', x: 10, y: 6, turret: true, fire: true, hp: 3, maxHp: 3, awake: true });
  const shield = makeEnemy({ kind: 'pawn', x: 10, y: 8, awake: true }); // a body BETWEEN it and the king
  const other = makeEnemy({ kind: 'rook', x: 10, y: 7, turret: true, fire: true, hp: 3, maxHp: 3, awake: true }); // another fire turret in the lane
  s.enemies = [turret, shield, other];
  const T = (st) => st.enemies.find((e) => e.turret && e.y === 6);
  let n = moveEnemy(s, turret.id); // turn 1: LOCK ON (no damage)
  assert.equal(n.player.hp, 4, 'it only locks on the first turn');
  assert.equal(T(n).aiming, true, 'and shows as aiming');
  n = moveEnemy(n, T(n).id); // turn 2: FIRE — pierces the pawn to hit the king
  assert.equal(n.player.hp, 3, 'the spellfire pierces the body and wounds the king');
  assert.ok(!n.enemies.some((e) => e.x === 10 && e.y === 8 && !e.turret), 'the body in the lane is incinerated');
  assert.ok(n.enemies.some((e) => e.x === 10 && e.y === 7 && e.turret), 'but a fellow fire turret in the lane is unharmed');
  assert.equal(T(n).recovering, true, 'it must now recover');
  n = moveEnemy(n, T(n).id); // turn 3: RECOVER (no shot)
  assert.equal(n.player.hp, 3, 'it vents this turn — no shot');
});

test('a recovering (winded) boss threatens no tiles that turn', () => {
  const s = createInitialState('warrior');
  s.terrain = {};
  const boss = createBoss(3, 12, 10); boss.dormant = false; boss.awake = true; boss.recovering = true;
  s.enemies = [boss];
  s.player.x = 10; s.player.y = 10;
  assert.equal(getThreatenedTiles(s).size, 0, 'a boss catching its breath covers nothing');
  boss.recovering = false;
  assert.ok(getThreatenedTiles(s).size > 0, 'but once rested it threatens again');
});

test('turrets are destructible (HP, struck in place); circles and plain pieces die in one', () => {
  const s = createInitialState('warrior');
  s.terrain = {};
  s.enemies = [
    makeEnemy({ kind: 'rook', x: 8, y: 9, turret: true, hp: 3, maxHp: 3 }),
    makeEnemy({ kind: 'pawn', x: 7, y: 8, summonCircle: true }),
    makeEnemy({ kind: 'knight', x: 9, y: 8 }),
  ];
  assert.equal(capturableAt(s, 8, 9), true, 'a turret is now a valid target');
  assert.equal(capturableAt(s, 7, 8), true);
  assert.equal(capturableAt(s, 9, 8), true);

  // A turret soaks 3 hits, struck in place — the king holds his tile until it falls.
  let n = createInitialState('warrior');
  n.terrain = {};
  n.exit = { x: 18, y: 18, discovered: true, locked: false }; // keep the (randomly-placed) stair clear of the king's tile
  n.enemies = [makeEnemy({ kind: 'rook', x: 9, y: 8, turret: true, hp: 3, maxHp: 3 })];
  n.player.x = 8; n.player.y = 8;
  for (let i = 0; i < 2; i += 1) {
    n = movePlayerTo(n, 9, 8);
    assert.deepEqual({ x: n.player.x, y: n.player.y }, { x: 8, y: 8 }, 'king stays put striking the turret');
    assert.ok(n.enemies.some((e) => e.turret), 'turret still standing after a hit');
  }
  n = movePlayerTo(n, 9, 8); // third hit destroys it
  assert.ok(!n.enemies.some((e) => e.turret), 'the turret is destroyed on the third hit');
});

test('a boss recovers (skips a turn) after it acts — every-other-turn cadence', () => {
  const s = createInitialState('warrior');
  s.terrain = {}; s.enemies = [];
  const boss = createBoss(3, 9, 8); // rook, adjacent to the king
  boss.bossPerk = 'tough'; // no on-hit reaction, deterministic
  boss.dormant = false; boss.spokeLine = true;
  s.enemies = [boss];
  s.player.x = 8; s.player.y = 8; s.player.hp = 5; s.player.maxHp = 5; s.player.className = 'warrior';
  const t1 = moveEnemy(s, boss.id); // it strikes the king...
  assert.equal(t1.enemies.find((e) => e.boss).recovering, true, 'it is winded after acting');
  const hp1 = t1.player.hp;
  assert.ok(hp1 < 5, 'the first blow lands');
  const t2 = moveEnemy(t1, boss.id); // ...then recovers, doing nothing
  assert.equal(t2.enemies.find((e) => e.boss).recovering, false, 'the cooldown clears');
  assert.equal(t2.player.hp, hp1, 'it does NOT strike on its recovery turn');
});

test('a turret TARGETS for one turn before it can fire, then fires each turn he stays in line', () => {
  const s = createInitialState('warrior');
  s.terrain = {};
  s.player.x = 10; s.player.y = 10; s.player.hp = 5; s.player.maxHp = 5;
  s.enemies = [makeEnemy({ kind: 'rook', x: 10, y: 13, turret: true, hp: 3, maxHp: 3 })]; // covers the column
  const t1 = moveEnemy(s, s.enemies[0].id);
  assert.equal(t1.player.hp, 5, 'the first turn it only LOCKS ON — no hit yet (a turn to step clear)');
  assert.equal(t1.enemies[0].aiming, true, 'it is now aiming');
  const t2 = moveEnemy(t1, t1.enemies[0].id);
  assert.ok(t2.player.hp < 5, 'the next turn it FIRES down its line');
  const t3 = moveEnemy(t2, t2.enemies[0].id);
  assert.ok(t3.player.hp < t2.player.hp, 'and it keeps firing while he stands in it (no windup window)');
});

test('a Regenerating boss knits one wound shut every fourth turn', () => {
  const s = createInitialState('warrior');
  s.terrain = {}; s.enemies = [];
  const boss = createBoss(3, 15, 15); boss.dormant = false; boss.spokeLine = true;
  boss.bossPerk = 'regen'; boss.maxHp = 6; boss.hp = 3;
  s.enemies = [boss];
  s.player.x = 3; s.player.y = 3; // far away so it just lumbers/recovers
  let n = s;
  for (let i = 0; i < 4; i += 1) n = moveEnemy(n, boss.id);
  assert.equal(n.enemies.find((e) => e.boss).hp, 4, 'it regained a wound on the 4th turn');
});

test('difficulty: Easy doubles starting HP; Nightmare halves the dread clock', () => {
  const base = createInitialState('warrior', 'hard').player.maxHp;
  assert.equal(createInitialState('warrior', 'easy').player.maxHp, base * 2, 'Easy = double HP');
  assert.equal(createInitialState('warrior', 'nightmare').player.maxHp, base, 'Nightmare keeps baseline HP');
  const hardClock = createInitialState('warrior', 'hard').dreadTurns;
  assert.ok(createInitialState('warrior', 'nightmare').dreadTurns < hardClock, 'Nightmare dread clock is faster');
});

test('a boss has HP and takes several hits; slaying the final guardian no longer wins the run', () => {
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
  assert.ok(!n.enemies.some((e) => e.boss), 'the guardian is slain');
  assert.equal(n.won, false, 'but that no longer wins — the portal does');
  assert.equal(n.pendingLevelUp, true, 'slaying the final guardian still grants a boon');
});

test('the final floor holds a portal + Orb of Victory instead of a stair + key', () => {
  const s = generateFloor(8, createPlayer('warrior'), 0);
  assert.equal(s.isPortalFloor, true);
  assert.equal(s.exit.portal, true, 'the exit is a victory portal');
  assert.ok(s.key && s.key.orb === true, 'the key is the Orb of Victory');
  // Earlier floors keep the plain stair + key.
  const s3 = generateFloor(3, createPlayer('warrior'), 0);
  assert.ok(!s3.isPortalFloor && !s3.exit.portal);
  assert.ok(!s3.key || !s3.key.orb);
});

test('the portal wins only with the Orb; taking the Orb opens it and starts the boss-rush', () => {
  const s = createInitialState('warrior');
  s.floor = 8; s.isPortalFloor = true; s.enemies = []; s.terrain = {};
  s.exit = { x: 12, y: 10, discovered: true, portal: true, locked: true };
  s.key = { x: 11, y: 10, collected: false, discovered: true, orb: true };
  // Step onto the portal WITHOUT the Orb — it stays shut and does not win.
  s.player.x = 11; s.player.y = 10; // adjacent to portal, ON the orb tile
  // First reaching the portal without the orb: simulate standing on the portal tile.
  const noOrb = structuredClone(s); noOrb.key.x = 3; noOrb.key.y = 3; noOrb.player.x = 12; noOrb.player.y = 10;
  assert.equal(tryDescend(noOrb), false, 'the dormant portal cannot be entered');
  assert.equal(noOrb.won, false);
  // Now walk onto the Orb (collect), then into the portal (win).
  const got = movePlayerTo(s, 11, 10); // player already there → collectKeyIfHere fires on arrival elsewhere; force it
  collectKeyIfHere(got);
  assert.equal(got.key.collected, true, 'the Orb is seized');
  assert.equal(got.exit.locked, false, 'the portal opens');
  assert.equal(got.orbTaken, true, 'the finale begins');
  got.player.x = 12; got.player.y = 10; // step into the open portal
  const win = tryDescend(got);
  assert.equal(win, true);
  assert.equal(got.won, true, 'entering the open portal with the Orb wins the run');
});

test('the boss-rush spawns lesser (lava-vulnerable) bosses near the king after the Orb', () => {
  let s = createInitialState('warrior');
  s.floor = 8; s.isPortalFloor = true; s.orbTaken = true; s.bossRushTimer = 0;
  s.enemies = []; s.terrain = {};
  s.player.x = 10; s.player.y = 10;
  for (let i = 0; i < 60 && s.enemies.filter((e) => e.boss).length === 0; i += 1) s = maybeSpawnEnemy(s);
  let rush = s.enemies.filter((e) => e.boss);
  assert.ok(rush.length >= 1, 'a rush boss appeared');
  assert.equal(rush[0].rush, true, 'flagged as a rush boss (no boon)');
  assert.equal(rush[0].lavaImmune, false, 'and it is NOT immune to lava');
  assert.ok(!rush[0].awake, 'it arrives surprised, not instantly hunting');
  assert.ok(chebyshev(rush[0].x, rush[0].y, 10, 10) >= 2 && chebyshev(rush[0].x, rush[0].y, 10, 10) <= 7, 'near the king but never adjacent');
  // Only ONE rogue boss loose at a time — keep ticking and it never spawns a second.
  for (let i = 0; i < 60; i += 1) s = maybeSpawnEnemy(s);
  rush = s.enemies.filter((e) => e.boss && e.rush);
  assert.equal(rush.length, 1, 'the cap holds at one rogue boss');
});

test('a destroyed turret leaves rusty scrap, not a corpse', () => {
  const s = createInitialState('warrior');
  s.terrain = {}; s.corpses = []; s.scrap = [];
  s.enemies = [makeEnemy({ kind: 'rook', x: 11, y: 10, turret: true, hp: 1, maxHp: 3 })];
  s.player.x = 10; s.player.y = 10;
  const n = movePlayerTo(s, 11, 10); // step onto the 1-HP turret → destroys it
  assert.ok(!n.enemies.some((e) => e.turret), 'the turret is destroyed');
  assert.ok((n.scrap || []).length >= 1, 'it leaves scrap');
  assert.equal((n.corpses || []).length, 0, 'and NO corpse (scrap is distinct)');
  assert.deepEqual({ x: n.player.x, y: n.player.y }, { x: 11, y: 10 }, 'and the king steps onto the wreck');
});

test('turrets are pushable now — Trample shoves an adjacent turret back', () => {
  const s = warriorWith('w_fleet', 'w_pierce', 'w_trample');
  const idx = s.player.cards.findIndex((c) => c.kind === 'knight');
  s.player.x = 10; s.player.y = 8;
  s.terrain = {};
  s.enemies = [makeEnemy({ kind: 'rook', x: 13, y: 9, turret: true, hp: 3, maxHp: 3 })]; // adjacent to the leap landing, open behind
  const r = useCard(s, idx, 12, 9); // leap to (12,9); the shockwave shoves the turret east
  assert.deepEqual({ x: r.player.x, y: r.player.y }, { x: 12, y: 9 });
  assert.ok(r.enemies.some((e) => e.turret && e.x === 14 && e.y === 9), 'the turret was shoved a tile back');
});

test('a foe shoved into a pit plunges to its death; a boss clambers back out for 1 wound', () => {
  const s = warriorWith('w_fleet', 'w_pierce', 'w_trample');
  const idx = s.player.cards.findIndex((c) => c.kind === 'knight');
  s.player.x = 10; s.player.y = 8;
  s.terrain = { '14,9': 'pit' };
  s.enemies = [makeEnemy({ kind: 'pawn', x: 13, y: 9, awake: true })]; // shoved east into the pit at (14,9)
  const r = useCard(s, idx, 12, 9);
  assert.ok(!r.enemies.some((e) => e.x === 13 && e.y === 9), 'the pawn is gone');
  assert.ok(!r.enemies.length, 'plunged into the pit');
  // A boss instead CLAMBERS back out, taking a wound but holding its ground.
  const b = warriorWith('w_fleet', 'w_pierce', 'w_trample');
  const bi = b.player.cards.findIndex((c) => c.kind === 'knight');
  b.player.x = 10; b.player.y = 8;
  b.terrain = { '14,9': 'pit' };
  const boss = createBoss(3, 13, 9); boss.dormant = false; boss.spokeLine = true; boss.hp = 4; boss.maxHp = 4;
  boss.bossPerk = 'brutal'; // a perk with no on-hit reaction (Blinkborn/Shifting would move/morph)
  b.enemies = [boss];
  const rb = useCard(b, bi, 12, 9);
  const bb = rb.enemies.find((e) => e.boss);
  assert.ok(bb, 'the boss did NOT fall in');
  assert.deepEqual({ x: bb.x, y: bb.y }, { x: 13, y: 9 }, 'it clambered back to its tile');
  assert.equal(bb.hp, 3, 'taking a single wound');
});

test('a LEAP onto a surviving turret knocks it back and the king takes its tile', () => {
  const s = createInitialState('warrior'); // knight card
  s.terrain = {}; s.player.x = 10; s.player.y = 8;
  s.enemies = [makeEnemy({ kind: 'rook', x: 12, y: 9, turret: true, hp: 3, maxHp: 3 })]; // a knight's move away, open behind
  const idx = s.player.cards.findIndex((c) => c.kind === 'knight');
  const r = useCard(s, idx, 12, 9); // leap onto the turret; approach dir (1,1)
  assert.ok(r.enemies.some((e) => e.turret && e.x === 13 && e.y === 10), 'the turret is knocked back diagonally');
  assert.deepEqual({ x: r.player.x, y: r.player.y }, { x: 12, y: 9 }, 'and the king takes its vacated tile');
});

test('Double Step onto a surviving turret lands the king BESIDE it (moves closer, strikes)', () => {
  const s = warriorWith('w_fleet');
  const idx = s.player.cards.findIndex((c) => c.kind === 'doublestep');
  s.player.x = 10; s.player.y = 10;
  s.terrain = {};
  s.enemies = [makeEnemy({ kind: 'rook', x: 12, y: 10, turret: true, hp: 3, maxHp: 3 })]; // 2 tiles east
  const r = useCard(s, idx, 12, 10); // dash at the turret (a slide, not a leap)
  assert.deepEqual({ x: r.player.x, y: r.player.y }, { x: 11, y: 10 }, 'the king lands one tile short, beside it');
  assert.ok(r.enemies.some((e) => e.turret && e.x === 12 && e.y === 10), 'the turret holds its ground');
});

test('a mini-boss (danger event) rises, grants no boon, and is smaller-HP', () => {
  let s = createInitialState('warrior');
  s.floor = 3; s.terrain = {}; s.enemies = [];
  s.player.x = 10; s.player.y = 10;
  s.player.seenTerrain = []; s.player.seenTurret = false; // pool = wave | miniBoss
  let mini = null;
  for (let i = 0; i < 80 && !mini; i += 1) {
    let t = structuredClone(s);
    t.turn = 40; t.turnsSinceSpawn = 99;
    t = maybeSpawnEnemy(t);
    mini = t.enemies.find((e) => e.boss && e.mini);
    if (mini) s = t;
  }
  assert.ok(mini, 'a mini-boss rose within the samples');
  assert.equal(mini.mini, true);
  assert.ok(mini.maxHp <= 4, 'with clearly fewer wounds than a floor guardian');
  // Slaying it grants NO boon.
  const guardian = s.enemies.find((e) => e.boss);
  guardian.hp = 1; guardian.dormant = false; guardian.spokeLine = true;
  s.player.x = guardian.x - 1; s.player.y = guardian.y;
  const n = movePlayerTo(s, guardian.x, guardian.y);
  assert.ok(!n.pendingLevelUp, 'no boon from a mini-boss kill');
});

test('the stair only relocates AFTER the key is his, out of view and still reachable', () => {
  // Before the key: moveStair never fires.
  let before = createInitialState('warrior');
  before.floor = 3; before.terrain = {}; before.enemies = [];
  before.key = { x: 3, y: 3, collected: false };
  before.player.seenTerrain = []; before.player.seenTurret = false;
  const kinds = new Set();
  for (let i = 0; i < 60; i += 1) { let t = structuredClone(before); t.turn = 40; t.turnsSinceSpawn = 99; t = maybeSpawnEnemy(t); if (t.dangerEvent) kinds.add(t.dangerEvent.kind); }
  assert.ok(!kinds.has('moveStair'), 'moveStair is impossible before the key is collected');
});

test('a guardian roars its line AND acts the same turn (no free telegraph once it is chasing)', () => {
  const s = createInitialState('warrior');
  s.terrain = {}; s.enemies = [];
  const boss = createBoss(3, 12, 10);
  boss.kind = 'rook'; boss.originalKind = 'rook'; // a slider two tiles east — clear LOS, NOT adjacent
  boss.bossPerk = 'leech'; // a plain 1-damage strike, no ranged/summon/knockback side-effects
  s.enemies = [boss];
  s.player.x = 10; s.player.y = 10; s.player.hp = 5; s.player.maxHp = 5; s.player.className = 'warrior';
  const n = moveEnemy(s, boss.id);
  const b = n.enemies.find((e) => e.boss);
  assert.equal(b.dormant, false, 'it wakes on sight');
  assert.equal(b.spokeLine, true, 'and speaks its line');
  assert.ok(n.bossLine && n.bossLine.length > 10, 'the roar is logged separately (bossLine), not a spent turn');
  // It closes / strikes THIS turn (a rook 2 tiles off captures the king on the row).
  assert.equal(n.player.hp, 4, 'and it strikes the king immediately');
});

test('demon-floor guardians are lava-immune; earlier/vanilla bosses sear in lava', () => {
  assert.equal(createBoss(8, 9, 8).lavaImmune, true, 'the floor-8 guardian shrugs off lava');
  assert.equal(createBoss(3, 9, 8).lavaImmune, false, 'a floor-3 guardian does not');
  // A non-immune boss standing on lava loses a wound on its turn.
  const s = createInitialState('warrior');
  s.terrain = { '9,8': 'lava' }; s.enemies = [];
  const boss = createBoss(3, 9, 8); // vanilla-era, not lava-immune
  boss.dormant = false; boss.spokeLine = true; boss.lavaImmune = false; boss.hp = 4; boss.maxHp = 4;
  s.enemies = [boss];
  s.player.x = 15; s.player.y = 15;
  const n = moveEnemy(s, boss.id);
  const b = n.enemies.find((e) => e.boss);
  assert.ok(b && b.hp < 4, 'the lava sears the vanilla boss');
});

test('a dormant guardian rouses when it SEES the king, not only when he is adjacent', () => {
  const s = createInitialState('warrior');
  s.terrain = {}; s.enemies = [];
  const boss = createBoss(3, 13, 10); // three tiles east of the king, clear line of sight
  s.enemies = [boss];
  s.player.x = 10; s.player.y = 10;
  assert.equal(boss.dormant, true);
  const n = moveEnemy(s, boss.id); // it has LOS but is NOT adjacent
  const b = n.enemies.find((e) => e.boss);
  assert.equal(b.dormant, false, 'the guardian wakes on sight');
});

test('every boss rolls one of the twelve boss perks', () => {
  const boss = createBoss(4, 9, 8);
  assert.ok(['summoner', 'blinker', 'brutal', 'ranged', 'sorcerer', 'knockback', 'shapeshifter', 'tough', 'leech', 'flying', 'phasing', 'regen'].includes(boss.bossPerk));
  assert.equal(boss.originalKind, boss.kind);
});

test('a Leech boss mends a wound each time it wounds the king', () => {
  const s = createInitialState('warrior');
  s.terrain = {}; s.enemies = [];
  const boss = createBoss(3, 9, 8); // rook
  boss.bossPerk = 'leech';
  boss.dormant = false; boss.spokeLine = true;
  boss.maxHp = 4; boss.hp = 2; // wounded, with room to heal
  s.enemies = [boss];
  s.player.x = 8; s.player.y = 8; s.player.hp = 5; s.player.maxHp = 5;
  s.player.className = 'warrior'; // no innate mitigation, so the blow lands
  const n = moveEnemy(s, boss.id); // adjacent rook slides onto the king and strikes
  const b = n.enemies.find((e) => e.boss);
  assert.equal(n.player.hp, 4, 'the king takes the blow');
  assert.equal(b.hp, 3, 'and the guardian knits a wound shut');
  // It never heals past its maximum.
  s.player.x = 8; s.player.y = 8;
  boss.hp = boss.maxHp;
  const full = moveEnemy(s, boss.id);
  assert.equal(full.enemies.find((e) => e.boss).hp, boss.maxHp, 'a full-health Leech boss does not overheal');
});

test('a Hardened boss bears three extra wounds', () => {
  // createBoss is random, so probe many draws and check the Hardened ones only.
  const base = 5; // the floor-4 (queen) boss's authored HP
  for (let i = 0; i < 40; i += 1) {
    const b = createBoss(4, 9, 8);
    if (b.bossPerk === 'tough') assert.equal(b.maxHp, base + 3);
    else assert.equal(b.maxHp, base);
  }
});

test('a Brutal boss strikes the king for two', () => {
  const s = createInitialState('warrior');
  s.terrain = {}; s.enemies = [];
  const boss = createBoss(3, 9, 8); // rook
  boss.bossPerk = 'brutal';
  boss.dormant = false; boss.spokeLine = true;
  s.enemies = [boss];
  s.player.x = 8; s.player.y = 8; s.player.hp = 6; s.player.maxHp = 6;
  s.player.className = 'warrior';
  const before = s.player.hp;
  const n = moveEnemy(s, boss.id);
  assert.ok(before - n.player.hp === 2 || n.player.deflected, 'a landed Brutal blow removes two hearts');
});

test('a Shifting boss morphs into a no-higher form when wounded', () => {
  const s = createInitialState('warrior');
  s.terrain = {}; s.enemies = [];
  const boss = createBoss(3, 9, 8); // rook (rank 3)
  boss.bossPerk = 'shapeshifter';
  boss.originalKind = 'rook';
  boss.kind = 'rook';
  boss.maxHp = 5; boss.hp = 5;
  boss.dormant = false; boss.spokeLine = true;
  s.enemies = [boss];
  s.player.x = 8; s.player.y = 8;
  const n = movePlayerTo(s, 9, 8); // capture-strike the boss (it survives on 5 HP)
  const b = n.enemies.find((e) => e.boss);
  assert.ok(b, 'the boss survives the first wound');
  assert.ok(['pawn', 'knight', 'bishop'].includes(b.kind), `a wounded rook shifts to a lesser form, not ${b.kind}`);
});

test('a Volley boss shoots down an open line instead of closing', () => {
  const s = createInitialState('warrior');
  s.terrain = {}; s.enemies = [];
  const boss = createBoss(3, 12, 8); // rook, four tiles east on the same row
  boss.bossPerk = 'ranged';
  boss.dormant = false; boss.spokeLine = true;
  s.enemies = [boss];
  s.player.x = 8; s.player.y = 8; s.player.hp = 5; s.player.maxHp = 5;
  s.player.className = 'warrior';
  const bx = boss.x;
  const n = moveEnemy(s, boss.id);
  const b = n.enemies.find((e) => e.boss);
  assert.equal(b.x, bx, 'it holds position and fires rather than advancing');
  assert.ok(n.lastShot && n.lastShot.toX === 8 && n.lastShot.toY === 8, 'a bolt flies at the king');
  assert.ok(n.player.hp < 5 || n.player.deflected, 'the bolt wounds the king');
});

test('a ranged boss only shoots along its own movement lines (a bishop won’t fire orthogonally)', () => {
  // Bishop boss (floor 2), king on the SAME ROW — a bishop can't travel a rank, so it
  // must NOT fire; it just advances instead.
  const s1 = createInitialState('warrior');
  s1.terrain = {}; s1.enemies = [];
  const b1 = createBoss(2, 12, 8); // the floor-2 boss is a bishop
  b1.bossPerk = 'ranged'; b1.dormant = false; b1.spokeLine = true;
  s1.enemies = [b1];
  s1.player.x = 8; s1.player.y = 8; s1.player.hp = 5; s1.player.maxHp = 5;
  s1.player.className = 'warrior';
  const n1 = moveEnemy(s1, b1.id);
  assert.equal(n1.player.hp, 5, 'an orthogonal king takes no bolt from a bishop');
  assert.ok(!n1.lastShot, 'and no bolt is fired');
  // Same bishop boss, king on a DIAGONAL — now it fires.
  const s2 = createInitialState('warrior');
  s2.terrain = {}; s2.enemies = [];
  const b2 = createBoss(2, 12, 8);
  b2.bossPerk = 'ranged'; b2.dormant = false; b2.spokeLine = true;
  s2.enemies = [b2];
  s2.player.x = 8; s2.player.y = 4; // (8,4): four tiles up-left of the boss — a diagonal
  s2.player.hp = 5; s2.player.maxHp = 5; s2.player.className = 'warrior';
  const n2 = moveEnemy(s2, b2.id);
  assert.ok(n2.lastShot, 'a diagonal king draws a bolt');
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
  // Circles now conjure only every THIRD turn.
  let acted = moveEnemy(s, circle.id);
  assert.equal(acted.enemies.length, before, 'no minion on turn 1');
  acted = moveEnemy(acted, circle.id);
  assert.equal(acted.enemies.length, before, 'nor turn 2');
  acted = moveEnemy(acted, circle.id);
  assert.ok(acted.enemies.length > before, 'it conjures a minion on the THIRD turn');
  const destroyed = movePlayerTo(s, 9, 8);
  assert.ok(!destroyed.enemies.some((e) => e.summonCircle), 'stepping on it destroys it');
});

test('a missile (ranged/spell) does NOT dispel a summoning circle — only stepping/bumping does', () => {
  const s = createInitialState('sorcerer'); // spell bolts pierce (now a diagonal bishop)
  s.terrain = {};
  s.player.x = 8; s.player.y = 8;
  s.enemies = [
    makeEnemy({ kind: 'pawn', x: 9, y: 9, summonCircle: true, awake: true }), // a circle on the diagonal line
    makeEnemy({ kind: 'pawn', x: 11, y: 11, awake: true }), // a real foe beyond it
  ];
  // The circle is NOT offered as a target...
  const targets = getCardMoves(s, s.player.cards[0]);
  assert.ok(!targets.some((t) => t.x === 9 && t.y === 9), 'a circle is not a missile target');
  // ...and firing down the line kills the foe but leaves the circle standing.
  const r = useCard(s, 0, 11, 11);
  assert.ok(r.enemies.some((e) => e.summonCircle), 'the circle survives the bolt passing over it');
  assert.ok(!r.enemies.some((e) => e.x === 11 && e.y === 11 && !e.summonCircle), 'the real foe still falls');
});

test('classes start with different HP (Warrior sturdiest, Sorcerer frailest)', () => {
  assert.equal(createPlayer('warrior').maxHp, 5);
  assert.equal(createPlayer('ranger').maxHp, 4);
  assert.equal(createPlayer('sorcerer').maxHp, 3);
});

test('the king CAN cross lava now, but it sears him 1 HP per turn (Winged Boots negates it)', () => {
  const s = createInitialState('warrior');
  s.terrain = { '9,8': 'lava' };
  s.enemies = [];
  s.player.x = 8; s.player.y = 8; s.player.hp = 5;
  assert.ok(getPlayerMoves(s).some((m) => m.x === 9 && m.y === 8), 'the king may step onto lava');
  const onLava = movePlayerTo(s, 9, 8);
  assert.deepEqual({ x: onLava.player.x, y: onLava.player.y }, { x: 9, y: 8 }, 'he steps onto it');
  assert.equal(onLava.player.hp, 4, 'and it sears him for 1 HP that turn');
  // Winged Boots (terrainImmune) makes him immune to the burning.
  const immune = createInitialState('ranger');
  immune.terrain = { '9,8': 'lava' };
  immune.enemies = [];
  immune.player.x = 8; immune.player.y = 8; immune.player.hp = 4; immune.player.terrainImmune = true;
  const safe = movePlayerTo(immune, 9, 8);
  assert.equal(safe.player.hp, 4, 'Winged Boots — no lava burn');
});

test('pit: impassable to the king, but shots and turret fire cross it', () => {
  const s = createInitialState('warrior');
  s.enemies = [];
  s.terrain = { '9,8': 'pit' };
  s.player.x = 8; s.player.y = 8;
  assert.ok(!getPlayerMoves(s).some((m) => m.x === 9 && m.y === 8), 'the king cannot step into a pit');
  // A rook turret fires OVER a pit onto the king (a mild warrior debuff — he can't shoot back).
  const t = createInitialState('warrior');
  t.terrain = { '10,10': 'pit' };
  t.player.x = 10; t.player.y = 8; t.player.hp = 5; t.player.maxHp = 5;
  t.enemies = [makeEnemy({ kind: 'rook', x: 10, y: 13, turret: true, hp: 3, maxHp: 3 })];
  assert.ok(getPieceThreats(t.enemies[0], t).some((th) => th.x === 10 && th.y === 8), 'the turret threatens through the pit');
  const aim = moveEnemy(t, t.enemies[0].id); // it locks on first
  assert.ok(moveEnemy(aim, aim.enemies[0].id).player.hp < 5, 'and the next turn it fires across the pit');
});

test('a ranger shoots across a pit (mild ranged buff)', () => {
  const s = createInitialState('ranger'); // rook, ranged
  s.terrain = { '11,10': 'pit' };
  s.player.x = 10; s.player.y = 10;
  s.enemies = [makeEnemy({ kind: 'pawn', x: 12, y: 10, awake: true })]; // beyond the pit, on the orthogonal line
  assert.ok(getCardMoves(s, s.player.cards[0]).some((tt) => tt.x === 12 && tt.y === 10), 'the shot flies over the pit');
});

test('boulder: the king shoves it; into a pit it fills the hole', () => {
  const s = createInitialState('warrior');
  s.enemies = [];
  s.terrain = { '9,8': 'boulder', '10,8': 'pit' };
  s.player.x = 8; s.player.y = 8;
  assert.ok(getPlayerMoves(s).some((m) => m.x === 9 && m.y === 8 && m.push), 'the boulder is a pushable move');
  const r = movePlayerTo(s, 9, 8);
  assert.deepEqual({ x: r.player.x, y: r.player.y }, { x: 9, y: 8 }, 'the king takes the boulder’s tile');
  assert.equal(terrainAt(r, 9, 8), 'normal', 'the boulder rolled off its tile');
  assert.equal(terrainAt(r, 10, 8), 'normal', 'and filled the pit');
});

test('boulder: pushing onto open ground rolls it forward; a wall-backed boulder strains (SPENDS the turn)', () => {
  const roll = createInitialState('warrior');
  roll.enemies = [];
  roll.terrain = { '9,8': 'boulder' };
  roll.player.x = 8; roll.player.y = 8;
  const r = movePlayerTo(roll, 9, 8);
  assert.equal(terrainAt(r, 10, 8), 'boulder', 'the boulder rolled one tile forward');
  // A boulder with a wall behind it can't be shoved — the king strains in vain, but a committed
  // shove still SPENDS the turn (unlike walking into a wall).
  const blocked = createInitialState('warrior');
  blocked.enemies = [];
  blocked.terrain = { '9,8': 'boulder', '10,8': 'wall' };
  blocked.player.x = 8; blocked.player.y = 8;
  assert.ok(getPlayerMoves(blocked).some((m) => m.x === 9 && m.y === 8 && m.push), 'shoving a blocked boulder is still offered');
  const b = movePlayerTo(blocked, 9, 8);
  assert.deepEqual({ x: b.player.x, y: b.player.y }, { x: 8, y: 8 }, 'the king does not move');
  assert.equal(terrainAt(b, 9, 8), 'boulder', 'the boulder holds');
  assert.equal(b.lastAction, 'boulder-stuck', 'the futile shove is a committed action');
  assert.equal(b.enemyTurn, true, 'and the enemy phase DOES run — the turn is spent');
});

test('a knight leap crushes a boulder it lands on', () => {
  const s = createInitialState('warrior'); // starts with a knight card
  s.enemies = [];
  s.terrain = { '12,9': 'boulder' };
  s.player.x = 10; s.player.y = 8;
  const idx = s.player.cards.findIndex((c) => c.kind === 'knight');
  assert.ok(getCardMoves(s, s.player.cards[idx]).some((m) => m.x === 12 && m.y === 9), 'the boulder tile is a leap target');
  const r = useCard(s, idx, 12, 9);
  assert.deepEqual({ x: r.player.x, y: r.player.y }, { x: 12, y: 9 }, 'the king lands there');
  assert.equal(terrainAt(r, 12, 9), 'normal', 'the boulder is crushed to rubble');
});

test('a sorcerer spell blasts the first boulder in its path', () => {
  const s = createInitialState('sorcerer'); // bishop spell (diagonal)
  s.enemies = [];
  s.terrain = { '11,11': 'boulder' };
  s.player.x = 8; s.player.y = 8;
  assert.ok(getCardMoves(s, s.player.cards[0]).some((tt) => tt.x === 11 && tt.y === 11), 'the boulder is a spell target');
  const r = useCard(s, 0, 11, 11);
  assert.equal(terrainAt(r, 11, 11), 'normal', 'the bolt blasts the boulder to rubble');
  assert.ok((r.rubble || []).some((rb) => rb.x === 11 && rb.y === 11), 'and leaves rubble');
});

test('leaps clear pits — a knight lands beyond one but never IN it', () => {
  const s = createInitialState('warrior'); // knight card
  s.enemies = [];
  s.terrain = { '12,9': 'pit', '11,8': 'pit' };
  s.player.x = 10; s.player.y = 8;
  const idx = s.player.cards.findIndex((c) => c.kind === 'knight');
  const moves = getCardMoves(s, s.player.cards[idx]);
  assert.ok(!moves.some((m) => m.x === 12 && m.y === 9), 'cannot land in a pit');
  assert.ok(moves.some((m) => m.x === 12 && m.y === 7), 'but leaps to open ground (over any pit between)');
});

test('a compound piece leaps over a pit even though its slide cannot cross it', () => {
  const s = createInitialState('warrior');
  s.terrain = { '11,10': 'pit' };
  const amazon = makeEnemy({ kind: 'amazon', x: 10, y: 10 });
  s.enemies = [amazon];
  const moves = getPieceMoves(amazon, s);
  assert.ok(!moves.some((m) => m.x === 12 && m.y === 10 && !m.viaJump), 'the queen-slide is stopped by the pit');
  assert.ok(moves.some((m) => m.viaJump && m.x === 12 && m.y === 11), 'but the knight-leap clears it');
});

test('a crushed boulder (knight leap) leaves rubble', () => {
  const s = createInitialState('warrior');
  s.enemies = [];
  s.terrain = { '12,9': 'boulder' };
  s.player.x = 10; s.player.y = 8;
  const idx = s.player.cards.findIndex((c) => c.kind === 'knight');
  const r = useCard(s, idx, 12, 9);
  assert.equal(terrainAt(r, 12, 9), 'normal', 'the boulder is crushed');
  assert.ok((r.rubble || []).some((rb) => rb.x === 12 && rb.y === 9), 'rubble is left behind');
});

test('Winged Boots lets the king step over a pit', () => {
  const s = rangerWith('r_wade'); // Druid Winged Boots grants terrainImmune → flying over pits
  assert.equal(s.player.terrainImmune, true);
  s.terrain = { '11,10': 'pit' };
  const moves = getPlayerMoves(s);
  assert.ok(moves.some((m) => m.x === 11 && m.y === 10 && !m.push), 'the pit tile is a walkable move');
  const r = movePlayerTo(s, 11, 10);
  assert.deepEqual({ x: r.player.x, y: r.player.y }, { x: 11, y: 10 }, 'the king stands over the pit');
});

test('Wild Empathy: a wild knight/amazon won\'t attack until struck; the king can displace it', () => {
  const s = rangerWith('r_wade', 'r_xray'); // Druid: r_xray is now Wild Empathy (beastFriend)
  assert.equal(s.player.beastFriend, true);
  s.terrain = {};
  s.player.x = 10; s.player.y = 10; s.player.hp = 4; s.player.maxHp = 4;
  const beast = makeEnemy({ kind: 'knight', x: 11, y: 12, awake: true }); // a knight a jump away
  s.enemies = [beast];
  // On the enemy phase it roams instead of pouncing — no damage to the king.
  const after = beginEnemyPhase(s).state;
  assert.equal(after.player.hp, 4, 'the befriended knight does not attack');
  // The king DISPLACES it by stepping onto its tile — they swap, no blow struck.
  let s2 = structuredClone(s);
  s2.enemies = [makeEnemy({ kind: 'knight', x: 11, y: 10, awake: true })]; // adjacent (east)
  const disp = movePlayerTo(s2, 11, 10);
  assert.deepEqual({ x: disp.player.x, y: disp.player.y }, { x: 11, y: 10 }, 'the king takes its tile');
  assert.ok(disp.enemies.some((e) => e.x === 10 && e.y === 10 && e.kind === 'knight'), 'and the beast is displaced to his old tile');
});

test('Phase lets the king move through a boulder just like a wall', () => {
  const s = sorcererWith('s_blink', 's_phase');
  assert.equal(s.player.phase, true);
  s.terrain = { '11,10': 'boulder' };
  assert.ok(getPlayerMoves(s).some((m) => m.x === 11 && m.y === 10 && !m.push), 'the boulder tile is walkable while phasing');
});

test('Blink never lands the king on a pit', () => {
  const s = sorcererWith('s_blink');
  s.player.blink = true;
  s.player.hp = 5;
  // Fill the whole visible window with pits except a couple of safe tiles.
  s.terrain = {};
  const b = getVisibleBounds(s);
  for (let y = b.y; y < b.y + b.height; y += 1) {
    for (let x = b.x; x < b.x + b.width; x += 1) {
      if (!(x === s.player.x && y === s.player.y) && !(x === 13 && y === 13)) s.terrain[`${x},${y}`] = 'pit';
    }
  }
  s.enemies = [];
  const moved = blinkToSafety(s);
  if (moved) assert.equal(terrainAt(s, s.player.x, s.player.y), 'normal', 'the king never blinks onto a pit');
});

test('Double Step charges a boulder two tiles forward', () => {
  const s = warriorWith('w_fleet'); // grants the doublestep card
  const idx = s.player.cards.findIndex((c) => c.kind === 'doublestep');
  s.terrain = { '11,10': 'boulder' };
  s.player.x = 10; s.player.y = 10;
  assert.ok(getCardMoves(s, s.player.cards[idx]).some((m) => m.x === 11 && m.y === 10 && m.push), 'the boulder is a charge target');
  const r = useCard(s, idx, 11, 10);
  assert.equal(terrainAt(r, 13, 10), 'boulder', 'the boulder rolled two tiles');
  assert.equal(terrainAt(r, 11, 10), 'normal', 'off its start tile');
  assert.deepEqual({ x: r.player.x, y: r.player.y }, { x: 11, y: 10 }, 'the king follows into the old boulder tile');
});

test('Double Step rolls a boulder into a pit, filling it', () => {
  const s = warriorWith('w_fleet');
  const idx = s.player.cards.findIndex((c) => c.kind === 'doublestep');
  s.terrain = { '11,10': 'boulder', '12,10': 'pit' };
  s.player.x = 10; s.player.y = 10;
  const r = useCard(s, idx, 11, 10);
  assert.equal(terrainAt(r, 12, 10), 'normal', 'the pit is filled by the rolling boulder');
  assert.equal(terrainAt(r, 11, 10), 'normal', 'and the boulder is consumed');
});

test('a knocked-back boulder ROLLS until it shatters against a wall', () => {
  const s = warriorWith('w_fleet', 'w_pierce', 'w_trample'); // Cavalier leapShock chain
  assert.equal(s.player.leapShock, true);
  const idx = s.player.cards.findIndex((c) => c.kind === 'knight');
  // Leap to (12,9); a boulder lands adjacent (east) with clear ground, then a wall at 16.
  s.player.x = 10; s.player.y = 8;
  s.terrain = { '13,9': 'boulder', '16,9': 'wall' };
  s.enemies = [];
  const r = useCard(s, idx, 12, 9);
  assert.deepEqual({ x: r.player.x, y: r.player.y }, { x: 12, y: 9 }, 'the king lands the leap');
  assert.equal(terrainAt(r, 13, 9), 'normal', 'the boulder rolls off its tile');
  assert.equal(terrainAt(r, 15, 9), 'normal', 'it did not simply stop one tile over');
  assert.ok((r.rubble || []).some((rb) => rb.x === 15 && rb.y === 9), 'it shatters into rubble at the wall');
});

test('a rolling boulder crushes an ordinary foe and PLOWS ON (a boss halts it)', () => {
  const s = warriorWith('w_fleet', 'w_pierce', 'w_trample');
  const idx = s.player.cards.findIndex((c) => c.kind === 'knight');
  s.player.x = 10; s.player.y = 8;
  s.terrain = { '13,9': 'boulder', '18,9': 'wall' };
  s.enemies = [makeEnemy({ kind: 'pawn', x: 14, y: 9, awake: true })]; // directly behind the boulder
  const r = useCard(s, idx, 12, 9);
  assert.ok(!r.enemies.some((e) => e.x === 14 && e.y === 9), 'the foe is crushed by the rolling boulder');
  assert.notEqual(terrainAt(r, 14, 9), 'boulder', 'it did not rest on the corpse — it kept rolling');
  assert.equal(terrainAt(r, 13, 9), 'normal', 'off its start tile');
});

test('ice: impassable but see-through; a spell MELTS it to water', () => {
  assert.equal(standableFor('ice', {}), false, 'nobody may stand on an ice slab');
  assert.equal(standableFor('ice', { phaseWalls: true }), true, 'a phasing mover slips through');
  assert.equal(blocksSight('ice'), false, 'but you can see past it');
  const s = createInitialState('sorcerer');
  s.terrain = { '11,10': 'ice' };
  s.player.x = 10; s.player.y = 10;
  meltIce(s, 11, 10);
  assert.equal(terrainAt(s, 11, 10), 'water', 'the struck slab thaws to water');
});

test('ice SHATTERS when a leaper lands on it', () => {
  const s = warriorWith('w_fleet');
  const idx = s.player.cards.findIndex((c) => c.kind === 'knight');
  s.player.x = 10; s.player.y = 10;
  s.terrain = { '12,11': 'ice' }; // a knight's-move target
  s.enemies = [];
  const r = useCard(s, idx, 12, 11);
  assert.deepEqual({ x: r.player.x, y: r.player.y }, { x: 12, y: 11 }, 'the king leaps onto the ice');
  assert.equal(terrainAt(r, 12, 11), 'normal', 'the slab shattered under him');
  assert.ok((r.iceShards || []).some((sh) => sh.x === 12 && sh.y === 11), 'leaving pale shards');
});

test('devilgrass blocks sight but not movement; a rolling boulder flattens it', () => {
  assert.equal(blocksSight('devilgrass'), true, 'the thicket hides what is behind it');
  assert.equal(standableFor('devilgrass', {}), true, 'but you can walk right through');
  const s = createInitialState('warrior');
  s.terrain = { '11,10': 'boulder', '12,10': 'devilgrass', '15,10': 'wall' };
  knockbackBoulder(s, 11, 10, 1, 0); // send it rolling east over the grass
  assert.notEqual(terrainAt(s, 12, 10), 'devilgrass', 'the grass is flattened as the boulder rolls over it');
});

test('a rolling boulder that slams the king costs him 1 HP', () => {
  const s = createInitialState('warrior');
  const hp0 = s.player.hp;
  s.player.x = 13; s.player.y = 10;
  s.terrain = { '11,10': 'boulder' };
  s.enemies = [];
  knockbackBoulder(s, 11, 10, 1, 0); // rolls east into the king at 13,10
  assert.equal(s.player.hp, hp0 - 1, 'the king takes a wound');
  assert.equal(terrainAt(s, 12, 10), 'boulder', 'the boulder stops short of him');
});

test('a Flying boss crosses pits, water, and lava freely', () => {
  const s = createInitialState('warrior');
  s.terrain = { '11,10': 'pit', '9,10': 'water', '10,11': 'lava' };
  const boss = makeEnemy({ kind: 'rook', x: 10, y: 10, boss: true, bossPerk: 'flying', awake: true });
  s.enemies = [boss];
  const moves = getPieceMoves(boss, s);
  assert.ok(moves.some((m) => m.x === 11 && m.y === 10), 'flies over the pit');
});

test('a Phasing boss moves and sees through walls and boulders', () => {
  const s = createInitialState('warrior');
  s.terrain = { '11,10': 'boulder', '9,10': 'wall' };
  const boss = makeEnemy({ kind: 'rook', x: 10, y: 10, boss: true, bossPerk: 'phasing', awake: true });
  s.enemies = [boss];
  const moves = getPieceMoves(boss, s);
  assert.ok(moves.some((m) => m.x === 11 && m.y === 10), 'drifts through the boulder');
  assert.ok(moves.some((m) => m.x === 9 && m.y === 10), 'and through the wall');
});

test('a boss bolt shatters a boulder in its path to the king', () => {
  const s = createInitialState('warrior');
  s.terrain = {}; s.enemies = [];
  // A ranged (Volley) rook boss firing east at the king, a boulder standing between them.
  const boss = createBoss(3, 10, 10); // rook
  boss.bossPerk = 'ranged';
  boss.dormant = false; boss.spokeLine = true;
  boss.recovering = false;
  s.enemies = [boss];
  s.player.x = 13; s.player.y = 10; s.player.hp = 5; s.player.maxHp = 5;
  s.player.className = 'warrior';
  s.terrain = { '11,10': 'boulder' };
  const n = moveEnemy(s, boss.id);
  assert.equal(terrainAt(n, 11, 10), 'normal', 'the bolt blasts the boulder to rubble');
  assert.equal(n.player.hp, 4, 'and the bolt strikes the king behind it');
});

test('danger events only unleash hazards the king has already met', () => {
  let s = createInitialState('warrior');
  s.floor = 4;
  const kinds = new Set();
  for (let i = 0; i < 80; i += 1) {
    s.turn = 60; s.turnsSinceSpawn = 99;
    s.player.seenTerrain = []; s.player.seenTurret = false; // pretend he's encountered nothing
    s = maybeSpawnEnemy(s);
    if (s.dangerEvent) kinds.add(s.dangerEvent.kind);
  }
  for (const k of ['lavaSpread', 'wallsToLava', 'pits', 'caveIn', 'turrets', 'flood']) {
    assert.ok(!kinds.has(k), `never fires "${k}" before the king has seen its hazard`);
  }
  assert.ok(kinds.has('wave'), 'only the enemy wave fires when nothing has been seen');
});

test('a danger WAVE spawns at least one foe in the king’s view', () => {
  const base = createInitialState('warrior');
  base.terrain = {}; // open floor so sight is clear
  base.player.x = 10; base.player.y = 10;
  base.player.seenTerrain = []; base.player.seenTurret = false; // pool = wave | miniBoss
  base.enemies = [];
  let saw = false;
  for (let i = 0; i < 80 && !saw; i += 1) {
    let s = structuredClone(base);
    s.turn = 40; s.turnsSinceSpawn = 99; // force an event
    s = maybeSpawnEnemy(s);
    if (s.dangerEvent && s.dangerEvent.kind === 'wave') {
      saw = true;
      assert.ok(s.enemies.length >= 1 && s.enemies.some((e) => unitInSight(s, e.x, e.y)), 'some of the wave arrives in sight');
    }
  }
  assert.ok(saw, 'a wave event fired within the samples');
});

test('a terrain danger event erupts at least partly in the king’s view', () => {
  const base = createInitialState('warrior');
  base.terrain = {};
  base.player.x = 10; base.player.y = 10;
  base.player.seenTerrain = ['pit']; base.player.seenTurret = false; // pool = wave | pits
  base.enemies = [];
  let sawPits = false;
  for (let i = 0; i < 80 && !sawPits; i += 1) {
    let s = structuredClone(base);
    s.turn = 40; s.turnsSinceSpawn = 99;
    s = maybeSpawnEnemy(s);
    if (s.dangerEvent && s.dangerEvent.kind === 'pits') {
      sawPits = true;
      const pits = Object.entries(s.terrain).filter(([, v]) => v === 'pit').map(([k]) => k.split(',').map(Number));
      assert.ok(pits.length >= 1, 'pits opened');
      assert.ok(pits.some(([x, y]) => unitInSight(s, x, y)), 'at least one fresh pit opened in view');
    }
  }
  assert.ok(sawPits, 'a pits event fired within the samples');
});

test('a danger event fires at the interval, carrying a kind + message, and keeps state coherent', () => {
  let s = createInitialState('warrior');
  s.turn = 40; s.turnsSinceSpawn = 99; // force an event this call
  s = maybeSpawnEnemy(s);
  assert.ok(s.dangerEvent && s.dangerEvent.kind && s.dangerEvent.message, 'an event with a kind + message fired');
  // Repeated events across floors never throw and never lose the exit.
  for (let i = 0; i < 60; i += 1) { s.floor = 1 + (i % 8); s.turn = 60; s.turnsSinceSpawn = 99; s = maybeSpawnEnemy(s); }
  assert.ok(s.exit, 'the exit survives repeated danger events');
});

test('water is passable but slow', () => {
  const s = createInitialState('warrior');
  s.terrain = { '9,8': 'water' };
  s.player.x = 8;
  s.player.y = 8;
  assert.ok(getPlayerMoves(s).some((m) => m.x === 9 && m.y === 8), 'the king can wade into water');
});

test('a melee card lunges the king onto the target; a spell card pierces cover', () => {
  const melee = createInitialState('warrior'); // starts with a melee KNIGHT (L-leap)
  melee.terrain = {};
  melee.player.x = 8;
  melee.player.y = 8;
  melee.enemies = [makeEnemy({ kind: 'pawn', x: 10, y: 9, awake: true })]; // a knight's move away
  const m = useCard(melee, 0, 10, 9);
  assert.deepEqual({ x: m.player.x, y: m.player.y }, { x: 10, y: 9 });
  assert.equal(m.enemies.length, 0);

  const spell = createInitialState('sorcerer'); // now a diagonal bishop bolt
  spell.terrain = {};
  spell.player.x = 8;
  spell.player.y = 8;
  spell.enemies = [makeEnemy({ kind: 'pawn', x: 9, y: 9, awake: true }), makeEnemy({ kind: 'pawn', x: 11, y: 11, awake: true })];
  const targets = getCardMoves(spell, spell.player.cards[0]);
  assert.ok(targets.some((t) => t.x === 11 && t.y === 11), 'spell targets through the blocker');
  const n = useCard(spell, 0, 11, 11);
  assert.deepEqual({ x: n.player.x, y: n.player.y }, { x: 8, y: 8 }, 'the caster holds his tile');
  assert.equal(n.enemies.length, 0, 'the bolt slays both');
  // The fireball records every tile it scorches (9,9 · 10,10 · the target 11,11) so the
  // view can bloom an impact on each — not just the final tile.
  assert.equal(n.lastShot.role, 'fireball');
  assert.ok(Array.isArray(n.lastShot.tiles), 'a spell carries its AoE tile list');
  const hit = new Set(n.lastShot.tiles.map((t) => `${t.x},${t.y}`));
  assert.ok(hit.has('9,9') && hit.has('10,10') && hit.has('11,11'), 'every tile on the path is marked');
});

test('the Sorcerer aims the max-range END of a firing line, not a body on it', () => {
  const s = createInitialState('sorcerer'); // bishop spell card (reach 3, diagonal, pierces)
  s.terrain = {};
  s.player.x = 8;
  s.player.y = 8;
  // One foe right next to the king, one two tiles further along the same diagonal.
  s.enemies = [makeEnemy({ kind: 'pawn', x: 9, y: 9, awake: true }), makeEnemy({ kind: 'pawn', x: 11, y: 11, awake: true })];
  const targets = getCardMoves(s, s.player.cards[0]);
  assert.ok(targets.some((t) => t.x === 11 && t.y === 11), 'the max-range endpoint is a target');
  assert.ok(!targets.some((t) => t.x === 9 && t.y === 9), 'a nearer body is NOT — you aim the line END');
  const n = useCard(s, 0, 11, 11); // AIM the max-range endpoint...
  const hit = new Set(n.lastShot.tiles.map((t) => `${t.x},${t.y}`));
  assert.ok(hit.has('9,9') && hit.has('10,10') && hit.has('11,11'), 'the bolt reaches all 3 tiles');
  assert.equal(n.enemies.length, 0, '...and both foes on the line fall');
});

test('a foe felled by a spell leaves an ash pile, not a corpse', () => {
  const s = createInitialState('sorcerer');
  s.terrain = {};
  s.player.x = 8;
  s.player.y = 8;
  s.enemies = [makeEnemy({ kind: 'pawn', x: 9, y: 9, awake: true })];
  s.corpses = [];
  s.ashes = [];
  const n = useCard(s, 0, 11, 11); // aim the max-range endpoint; the line still sweeps the foe at 9,9
  assert.equal(n.enemies.length, 0, 'the bolt slays the foe');
  assert.ok((n.ashes || []).length >= 1, 'it leaves an ash pile');
  assert.equal((n.corpses || []).length, 0, 'and no corpse');
});

test('a hit flings satellite blood spatters onto adjacent tiles', () => {
  const s = createInitialState('warrior'); // melee knight card
  s.terrain = {};
  s.player.x = 10;
  s.player.y = 10;
  s.enemies = [makeEnemy({ kind: 'pawn', x: 11, y: 12, awake: true })]; // a knight's move off
  s.spatters = [];
  const n = useCard(s, 0, 11, 12);
  assert.equal(n.enemies.length, 0, 'the foe is captured');
  assert.ok(n.spatters.length >= 2, 'the kill leaves the main spatter plus at least one satellite');
});

test('an ordinary attacker is stained by striking the king (HP-less pieces wear a fading stain)', () => {
  const b = createInitialState('warrior');
  b.terrain = {};
  b.player.x = 10;
  b.player.y = 10;
  b.player.hp = 5;
  const foe = makeEnemy({ kind: 'king', x: 11, y: 10, awake: true }); // adjacent, no maxHp
  b.enemies = [foe];
  const hit = moveEnemy(b, foe.id); // the enemy king steps in and strikes
  assert.equal(hit.player.hp, 4, 'the blow lands');
  assert.ok((hit.enemies[0].blood || 0) > 0, 'and the striker is spattered');
  // The king carries NO stain field — his gore is drawn from missing HP instead.
  assert.ok(!hit.player.blood, 'the king wears wounds (HP-based), not a stain');
});

test('a slain boss leaves remains that linger far longer than a common corpse', () => {
  // A common corpse's lifespan, from an ordinary kill...
  const a = createInitialState('warrior');
  a.terrain = {};
  a.player.x = 10;
  a.player.y = 10;
  a.enemies = [makeEnemy({ kind: 'pawn', x: 11, y: 12, awake: true })];
  a.corpses = [];
  const normalMax = useCard(a, 0, 11, 12).corpses[0].max;
  // ...versus a boss's, which should outlast it by a wide margin.
  const b = createInitialState('warrior');
  b.terrain = {};
  const boss = createBoss(3, 9, 8);
  boss.hp = 1;
  boss.maxHp = 1;
  boss.dormant = false; boss.spokeLine = true;
  b.enemies = [boss];
  b.corpses = [];
  b.player.x = 8;
  b.player.y = 8;
  const bn = movePlayerTo(b, 9, 8);
  assert.equal(bn.enemies.filter((e) => e.boss).length, 0, 'the boss falls');
  assert.ok(bn.corpses.length >= 1, 'and leaves remains');
  assert.ok(bn.corpses[bn.corpses.length - 1].max > normalMax, 'the boss corpse outlasts a common one');
});

test('a melee card can reposition onto empty ground, not just capture', () => {
  const s = createInitialState('warrior'); // starts with a melee knight (L-leap)
  s.terrain = {};
  s.enemies = [];
  s.exit = { x: 0, y: 0, discovered: false }; // keep the exit off the test tile
  s.player.x = 10;
  s.player.y = 10;
  const targets = getCardMoves(s, s.player.cards[0]);
  const spot = targets.find((m) => m.x === 12 && m.y === 11); // empty knight's-move tile
  assert.ok(spot, 'empty knight-leap ground is a valid target');
  assert.equal(spot.capture, false, 'and it is marked a move, not a capture');
  const n = useCard(s, 0, 12, 11);
  assert.deepEqual({ x: n.player.x, y: n.player.y }, { x: 12, y: 11 }, 'the king repositions there');
});

// A tiny Warrior fixture: a bare floor, king centered, and the given perks learned.
function warriorWith(...perkIds) {
  let s = createInitialState('warrior');
  s.terrain = {};
  s.enemies = [];
  s.exit = { x: 0, y: 0, discovered: false };
  s.player.x = 10;
  s.player.y = 10;
  for (const id of perkIds) {
    s.pendingLevelUp = true;
    s = learnPerk(s, id);
  }
  return s;
}

test('En Passant steps one tile (capturing there) and strikes one foe in passing', () => {
  const s = warriorWith('w_enpassant');
  const card = s.player.cards.find((c) => c.kind === 'enpassant');
  const idx = s.player.cards.indexOf(card);
  // A foe on the destination (north of origin) + a foe beside the origin (west).
  s.enemies = [makeEnemy({ kind: 'pawn', x: 10, y: 9 }), makeEnemy({ kind: 'pawn', x: 9, y: 10 })];
  const north = getCardMoves(s, card).find((m) => m.x === 10 && m.y === 9);
  assert.ok(north && north.capture, 'stepping onto the north foe is a capture');
  assert.deepEqual(north.flanks, [{ x: 9, y: 10 }], 'the in-passing target is the foe beside the origin');
  const r = useCard(s, idx, 10, 9); // step north (capture) + strike the west foe in passing
  assert.deepEqual({ x: r.player.x, y: r.player.y }, { x: 10, y: 9 }, 'king steps onto the north tile');
  assert.equal(r.enemies.length, 0, 'both the stepped-on foe and the in-passing foe fall');
});

test('Cleave and Pierce fire on a plain move-kill, not just a card', () => {
  const cleave = warriorWith('w_edge', 'w_cleave');
  cleave.enemies = [makeEnemy({ kind: 'pawn', x: 11, y: 10 }), makeEnemy({ kind: 'pawn', x: 11, y: 11 })];
  assert.equal(movePlayerTo(cleave, 11, 10).enemies.length, 0, 'the kill cleaves an adjacent foe');

  const pierce = warriorWith('w_fleet', 'w_pierce');
  pierce.player.moveRange = 1;
  pierce.enemies = [makeEnemy({ kind: 'pawn', x: 11, y: 10 }), makeEnemy({ kind: 'pawn', x: 12, y: 10 })];
  const r = movePlayerTo(pierce, 11, 10);
  assert.equal(r.enemies.length, 0, 'pierce strikes the foe directly behind the kill');
});

test('Trample: landing a knight leap HURLS adjacent foes back, colliding with what is behind', () => {
  const s = warriorWith('w_fleet', 'w_pierce', 'w_trample');
  const idx = s.player.cards.findIndex((c) => c.kind === 'knight');
  s.enemies = [
    makeEnemy({ kind: 'pawn', x: 11, y: 11 }), // adjacent (W): shoved toward (10,11)...
    makeEnemy({ kind: 'pawn', x: 10, y: 11 }), // ...where THIS foe stands — it's crushed
    makeEnemy({ kind: 'pawn', x: 13, y: 11 }), // adjacent (E): shoved to open (14,11)
  ];
  const r = useCard(s, idx, 12, 11); // leap onto empty ground at (12,11)
  assert.deepEqual({ x: r.player.x, y: r.player.y }, { x: 12, y: 11 });
  assert.ok(r.enemies.some((e) => e.x === 10 && e.y === 11), 'the shoved foe takes the crushed one’s tile');
  assert.ok(r.enemies.some((e) => e.x === 14 && e.y === 11), 'an open-backed foe is simply pushed back');
  assert.equal(r.enemies.length, 2, 'the foe slammed into is destroyed; both shovers survive');
});

test('a foe shoved into a boss merely bumps it — the foe holds, the boss is wounded', () => {
  const s = warriorWith('w_fleet', 'w_pierce', 'w_trample');
  const idx = s.player.cards.findIndex((c) => c.kind === 'knight');
  const boss = createBoss(3, 10, 11); // rook boss, two tiles W of the landing
  boss.bossPerk = 'brutal'; // a perk with no on-hit reaction, for a deterministic test
  boss.dormant = false; boss.spokeLine = true;
  boss.maxHp = 4;
  boss.hp = 4;
  s.enemies = [makeEnemy({ kind: 'pawn', x: 11, y: 11 }), boss];
  const r = useCard(s, idx, 12, 11); // leap to (12,11); the pawn is shoved W into the boss at (10,11)
  const b = r.enemies.find((e) => e.boss);
  assert.equal(b.hp, 3, 'the boss takes a wound from the impact');
  assert.ok(r.enemies.some((e) => e.x === 11 && e.y === 11 && !e.boss), 'the shoved foe stops short against the boss');
});

test('Displacement knocks foes adjacent to the arrival tile back a tile', () => {
  const s = sorcererWith('s_blink', 's_phase', 's_swap');
  const idx = s.player.cards.findIndex((c) => c.kind === 'swap');
  s.enemies = [
    makeEnemy({ kind: 'pawn', x: 13, y: 13 }), // the swap target
    makeEnemy({ kind: 'pawn', x: 13, y: 12 }), // adjacent to the arrival tile → shoved to (13,11)
  ];
  const r = useCard(s, idx, 13, 13);
  assert.deepEqual({ x: r.player.x, y: r.player.y }, { x: 13, y: 13 }, 'the king arrives');
  assert.ok(r.enemies.some((e) => e.x === 13 && e.y === 11), 'the adjacent foe is shoved back');
  assert.ok(r.enemies.some((e) => e.x === 10 && e.y === 10), 'the swapped unit is spared (it took the king’s old tile)');
});

// A tiny Ranger fixture: a bare floor, king centered, given perks learned.
function rangerWith(...perkIds) {
  let s = createInitialState('ranger');
  s.terrain = {};
  s.enemies = [];
  s.exit = { x: 0, y: 0, discovered: false };
  s.player.x = 10;
  s.player.y = 10;
  for (const id of perkIds) {
    s.pendingLevelUp = true;
    s = learnPerk(s, id);
  }
  return s;
}

test('Winged Boots lets the Ranger wade water freely, cast while wading, and shrug off lava', () => {
  const wade = rangerWith('r_wade');
  wade.player.moveRange = 3;
  wade.terrain = { '11,10': 'water', '12,10': 'water' };
  assert.ok(getPlayerMoves(wade).some((m) => m.x === 13 && m.y === 10), 'slides across two water tiles');
  const cast = rangerWith('r_wade');
  cast.terrain = { '10,10': 'water' };
  cast.enemies = [makeEnemy({ kind: 'pawn', x: 12, y: 10 })]; // on the rook's orthogonal line
  const r = useCard(cast, 0, 12, 10);
  assert.notEqual(r.lastAction, 'blocked', 'a weapon still fires while wading');
  assert.equal(r.enemies.length, 0);
  // And lava no longer burns.
  const fire = rangerWith('r_wade');
  fire.enemies = [];
  fire.terrain = { '11,10': 'lava' };
  fire.player.x = 10; fire.player.y = 10; fire.player.hp = 4; fire.player.moveRange = 1;
  const onLava = movePlayerTo(fire, 11, 10);
  assert.equal(onLava.player.hp, 4, 'Winged Boots shrugs off the lava');
});

test('Wild Empathy: a floor BOSS is never tamed, and striking a beast provokes it', () => {
  const s = rangerWith('r_wade', 'r_xray');
  s.terrain = {};
  // A true floor boss of amazon kind is NOT befriended.
  const boss = createBoss(8, 12, 12); boss.kind = 'amazon'; boss.mini = false; boss.rush = false;
  assert.equal(isBefriendedBeast(s, boss), false, 'a floor guardian is never a friendly beast');
  // A mini-boss knight IS befriended — until struck (provokedBeast), then it turns hostile.
  const mini = makeEnemy({ kind: 'knight', x: 11, y: 11, boss: true, mini: true, maxHp: 3, hp: 3, awake: true });
  assert.equal(isBefriendedBeast(s, mini), true, 'a wild mini-boss knight is befriended');
  mini.provokedBeast = true;
  assert.equal(isBefriendedBeast(s, mini), false, 'once struck it is no longer friendly');
});

test('Promotion: a free cast that becomes an INVINCIBLE warhorse and locks cards', () => {
  const s = rangerWith('r_wade', 'r_xray', 'r_promo');
  const bi = s.player.cards.findIndex((c) => c.kind === 'promotion');
  assert.equal(s.player.cards[bi].cooldown, 9, 'the promotion card has a long cooldown');
  const horse = useCard(s, bi, s.player.x, s.player.y);
  assert.equal(horse.player.promotion, 3);
  assert.equal(horse.enemyTurn, false, 'casting it costs no turn');
  const moves = getPlayerMoves(horse);
  assert.ok(moves.some((m) => m.viaJump), 'the warhorse can knight-leap');
  assert.ok(moves.some((m) => !m.viaJump), 'and still step a single tile');
  assert.ok(!moves.some((m) => Math.abs(m.x - horse.player.x) + Math.abs(m.y - horse.player.y) > 3), 'but no long queen-slides');
  assert.equal(useCard(horse, 0, 12, 12).lastAction, 'blocked', 'no weapons while promoted');
  // Invincible: an enemy blow deals no damage during the horse form.
  horse.player.x = 10; horse.player.y = 10;
  horse.enemies = [makeEnemy({ kind: 'rook', x: 11, y: 10, awake: true })];
  const hp0 = horse.player.hp;
  const r = beginEnemyPhase(horse);
  let st = r.state;
  for (const id of r.moverIds) st = moveEnemy(st, id);
  assert.equal(st.player.hp, hp0, 'the warhorse takes no damage');
  // The timer counts down each turn the king acts.
  const after = movePlayerTo(horse, moves.find((m) => !m.viaJump).x, moves.find((m) => !m.viaJump).y);
  assert.equal(after.player.promotion, 2, 'the timer counts down each turn');
});

test('Charge: only the FIRST kill-move each turn is free', () => {
  const s = warriorWith('w_enpassant', 'w_flourish', 'w_rush'); // Duellist chain → Charge
  s.player.x = 10; s.player.y = 10; s.player.moveRange = 1;
  s.enemies = [
    makeEnemy({ kind: 'pawn', x: 11, y: 10, awake: true }),
    makeEnemy({ kind: 'pawn', x: 12, y: 10, awake: true }),
  ];
  const first = movePlayerTo(s, 11, 10); // kill by moving
  assert.equal(first.lastAction, 'move-free', 'the first kill-move is free');
  assert.equal(first.enemyTurn, false, 'no turn spent');
  assert.equal(first.player.freeMoveUsed, true, 'the free move is now used up');
  const second = movePlayerTo(first, 12, 10); // a second kill-move THIS turn
  assert.equal(second.enemyTurn, true, 'the second kill-move spends the turn');
});

test('Vampiric Edge heals only when a strike fells two foes at once (Cleave supplies the second)', () => {
  // Kill + Cleave = two deaths in one action → heal.
  const s = warriorWith('w_edge', 'w_cleave', 'w_leech');
  s.player.x = 10; s.player.y = 10; s.player.moveRange = 1;
  s.player.hp = 3; s.player.maxHp = 5;
  s.enemies = [
    makeEnemy({ kind: 'pawn', x: 11, y: 10, awake: true }), // moved onto
    makeEnemy({ kind: 'pawn', x: 11, y: 11, awake: true }), // adjacent → cleaved
  ];
  const two = movePlayerTo(s, 11, 10);
  assert.equal(two.enemies.length, 0, 'both foes fall (kill + cleave)');
  assert.equal(two.player.hp, 4, 'felling two at once heals 1');
  // A lone kill (no second death) does NOT heal.
  const s1 = warriorWith('w_edge', 'w_cleave', 'w_leech');
  s1.player.x = 10; s1.player.y = 10; s1.player.moveRange = 1;
  s1.player.hp = 3; s1.player.maxHp = 5;
  s1.enemies = [makeEnemy({ kind: 'pawn', x: 11, y: 10, awake: true })];
  const one = movePlayerTo(s1, 11, 10);
  assert.equal(one.enemies.length, 0, 'the single foe falls');
  assert.equal(one.player.hp, 3, 'a lone kill does not heal');
});

test('Reload readies every other card; Ballista grants a queen (cd9); Recoil kicks back', () => {
  const s = rangerWith('r_reload', 'r_longbow');
  const queen = s.player.cards.find((c) => c.kind === 'queen');
  assert.equal(queen.cooldown, 9, 'the Ballista queen keeps the queen’s own cooldown (9)');
  const rook = s.player.cards.find((c) => c.kind === 'rook'); // the Ranger's starting rook
  assert.equal(rook.cooldown, 5, 'the starting rook is cooldown 5');
  rook.remaining = 3; queen.remaining = 8;
  const ri = s.player.cards.findIndex((c) => c.kind === 'reload');
  const reloaded = useCard(s, ri, s.player.x, s.player.y);
  assert.equal(reloaded.player.cards.find((c) => c.kind === 'rook').remaining, 0, 'the rook is ready again');
  assert.equal(reloaded.player.cards.find((c) => c.kind === 'queen').remaining, 0, 'the queen is ready again');
  assert.equal(reloaded.enemyTurn, true, 'reload spends the turn');

  const rec = rangerWith('r_reload', 'r_longbow', 'r_recoil');
  rec.enemies = [makeEnemy({ kind: 'pawn', x: 12, y: 10 })];
  const rookIdx = rec.player.cards.findIndex((c) => c.kind === 'rook');
  const shot = useCard(rec, rookIdx, 12, 10); // rook shot east; recoil west to (9,10)
  assert.deepEqual({ x: shot.player.x, y: shot.player.y }, { x: 9, y: 10 });
  assert.equal(shot.enemies.length, 0);
});

test('Deadeye chain: Premonition (T1 true-sight) → Hawk Eyes (+sight) → Power Draw (+reach)', () => {
  const base = createInitialState('ranger').player;
  // Premonition is now T1 and grants true-sight (see through cover within radius, no shooting).
  const p1 = rangerWith('r_eagle');
  assert.equal(p1.player.trueSight, true, 'Premonition grants true-sight');
  assert.ok(!p1.player.seeThroughWalls, 'but NOT shooting through cover');
  // Premonition lets the king SEE a foe behind a wall (visibility only).
  p1.player.x = 10; p1.player.y = 10;
  p1.terrain = { '11,10': 'wall' };
  assert.equal(inLineOfSight(p1, 12, 10), true, 'sight passes over the wall');
  // Full chain adds +1 sight radius (Hawk Eyes) and +1 card reach (Power Draw).
  const s = rangerWith('r_eagle', 'r_eyes2', 'r_reach');
  assert.equal(s.player.vision, base.vision + 2, 'one +1-radius sight bump');
  assert.equal(s.player.cardReach, 1, 'one +1 card-reach bump');
});

test('the king can strike a phasing boss EMBEDDED in an adjacent wall, without moving onto it', () => {
  const s = createInitialState('warrior');
  s.terrain = { '11,10': 'wall' };
  const boss = createBoss(3, 11, 10); boss.dormant = false; boss.spokeLine = true;
  boss.bossPerk = 'phasing'; boss.maxHp = 2; boss.hp = 2;
  s.enemies = [boss];
  s.player.x = 10; s.player.y = 10;
  const r = movePlayerTo(s, 11, 10); // step toward the embedded boss
  assert.deepEqual({ x: r.player.x, y: r.player.y }, { x: 10, y: 10 }, 'the king holds his ground (falls short)');
  assert.equal(r.enemies.find((e) => e.boss).hp, 1, 'but the boss still takes the blow');
  assert.equal(terrainAt(r, 11, 10), 'wall', 'the wall is untouched');
});

test('a wall BETWEEN blocks striking an embedded foe', () => {
  const s = createInitialState('warrior');
  s.terrain = { '11,10': 'wall', '12,10': 'wall' };
  const boss = createBoss(3, 12, 10); boss.dormant = false; boss.spokeLine = true;
  boss.bossPerk = 'phasing'; boss.maxHp = 2; boss.hp = 2;
  s.enemies = [boss];
  s.player.x = 10; s.player.y = 10;
  const moves = getPlayerMoves(s);
  assert.ok(!moves.some((m) => m.x === 12 && m.y === 10), 'the boss two walls deep is unreachable');
});

test('Recoil also shoves adjacent foes back a tile (blocked ones hold)', () => {
  const s = rangerWith('r_reload', 'r_longbow', 'r_recoil');
  s.terrain = { '7,10': 'wall' }; // a wall directly behind one adjacent foe
  s.enemies = [
    makeEnemy({ kind: 'pawn', x: 13, y: 10, awake: true }), // the shot target (E, on the rook line)
    makeEnemy({ kind: 'pawn', x: 9, y: 9, awake: true }), // adjacent to the king's landing (9,10), open behind
    makeEnemy({ kind: 'pawn', x: 8, y: 10, awake: true }), // adjacent, but a wall sits behind it (7,10)
  ];
  const idx = s.player.cards.findIndex((c) => c.kind === 'rook');
  const r = useCard(s, idx, 13, 10);
  assert.deepEqual({ x: r.player.x, y: r.player.y }, { x: 9, y: 10 }, 'the archer recoils W');
  assert.ok(!r.enemies.some((e) => e.x === 13 && e.y === 10), 'the target falls');
  assert.ok(r.enemies.some((e) => e.x === 9 && e.y === 8), 'the open-backed foe is shoved back a tile');
  assert.ok(r.enemies.some((e) => e.x === 8 && e.y === 10), 'the wall-backed foe holds its ground');
});

test('Camouflage: turrets hold fire and circles conjure nothing', () => {
  const s = rangerWith('r_ghost', 'r_camo');
  const turret = makeEnemy({ kind: 'rook', x: 10, y: 13, turret: true });
  s.enemies = [turret];
  const hp0 = s.player.hp;
  assert.equal(fireTurret(s, turret).player.hp, hp0, 'a turret cannot target the camouflaged king');
  const s2 = rangerWith('r_ghost', 'r_camo');
  const circle = makeEnemy({ kind: 'pawn', x: 10, y: 12, summonCircle: true, charged: true });
  s2.enemies = [circle];
  assert.equal(summonCircleTurn(s2, circle).enemies.length, 1, 'a circle conjures nothing while camouflaged');
});

// A tiny Sorcerer fixture on a bare floor.
function sorcererWith(...perkIds) {
  let s = createInitialState('sorcerer');
  s.terrain = {};
  s.enemies = [];
  s.exit = { x: 0, y: 0, discovered: false, locked: false };
  s.key = null;
  s.player.x = 10;
  s.player.y = 10;
  for (const id of perkIds) {
    s.pendingLevelUp = true;
    s = learnPerk(s, id);
  }
  return s;
}

test('Sorcerer cards carry cooldowns and subclass colours', () => {
  const s = sorcererWith();
  assert.equal(s.player.cards[0].kind, 'bishop');
  assert.equal(s.player.cards[0].cooldown, 3, 'the starting bishop uses the bishop’s own cooldown');
  assert.equal(s.player.cards[0].color, '#a855f7', 'a starter card wears the class colour');
  const conj = sorcererWith('s_amp', 's_staff');
  const horse = conj.player.cards.find((c) => c.kind === 'horse');
  assert.equal(horse.cooldown, 4, 'Phantom Steed horse has cooldown 4');
  assert.equal(horse.color, '#8b5cf6', 'a granted card wears its subclass colour');
});

test('Blast: a spell also detonates on tiles beside its target', () => {
  const setup = (withBlast) => {
    const s = withBlast ? sorcererWith('s_amp') : sorcererWith(); // s_amp is now Blast
    s.player.x = 10; s.player.y = 10;
    s.enemies = [makeEnemy({ kind: 'pawn', x: 12, y: 12, awake: true })]; // a foe up the NE diagonal to aim at
    const bi = s.player.cards.findIndex((c) => c.kind === 'bishop');
    const aim = getCardMoves(s, s.player.cards[bi]).find((m) => Math.sign(m.x - 10) === 1 && Math.sign(m.y - 10) === 1);
    // Ring the AIMED tile with foes so Blast (3 random of 8 neighbours) always fells at least one extra.
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const rx = aim.x + dx; const ry = aim.y + dy;
      if (rx === 10 && ry === 10) continue;
      if (!s.enemies.some((e) => e.x === rx && e.y === ry)) s.enemies.push(makeEnemy({ kind: 'pawn', x: rx, y: ry, awake: true }));
    }
    return { s, bi, aim };
  };
  const a = setup(false);
  assert.ok(a.aim, 'the bishop offers a NE aim');
  const plain = useCard(a.s, a.bi, a.aim.x, a.aim.y);
  const b = setup(true);
  assert.equal(b.s.player.spellBlast, true, 'Blast grants spellBlast');
  const blast = useCard(b.s, b.bi, b.aim.x, b.aim.y);
  assert.ok(blast.enemies.length < plain.enemies.length, 'Blast fells extra foes around the aimed tile');
});

test('Camouflage: a turret dozes (sleep) until you strike it, then it hunts', () => {
  const s = rangerWith('r_ghost', 'r_camo');
  assert.equal(s.player.camouflage, true);
  s.terrain = {};
  s.player.x = 10; s.player.y = 10; s.player.hp = 5; s.player.maxHp = 5;
  s.enemies = [makeEnemy({ kind: 'rook', x: 10, y: 8, turret: true, hp: 3, maxHp: 3, awake: true })];
  // On its file, but camouflaged — it dozes and never fires.
  const dozed = moveEnemy(s, s.enemies[0].id);
  assert.equal(dozed.player.hp, 5, 'the camouflaged king is safe from the dozing turret');
  assert.equal(dozed.enemies[0].dozing, true, 'it is shown dormant');
  // Provoke it: step adjacent and strike it in place.
  let s2 = structuredClone(s);
  s2.player.x = 10; s2.player.y = 9;
  s2 = movePlayerTo(s2, 10, 8);
  const t = s2.enemies.find((e) => e.turret);
  assert.equal(t.provoked, true, 'striking wakes it for good');
  // Back on its file, the provoked turret locks on and fires despite camouflage.
  s2.player.x = 10; s2.player.y = 10;
  let n = moveEnemy(s2, t.id); // locks on
  n = moveEnemy(n, n.enemies.find((e) => e.turret).id); // fires
  assert.ok(n.player.hp < 5, 'the provoked turret now blasts the king');
});

test('Double Cast: a spell with a foe still in range fires once more before the turn ends', () => {
  const s = sorcererWith('s_amp', 's_staff', 's_barrage'); // s_barrage now grants doubleCast
  assert.equal(s.player.doubleCast, true, 'the tier-3 grants Double Cast');
  // Two foes on different diagonals: the first shot clears one, the second is still available.
  s.enemies = [
    makeEnemy({ kind: 'pawn', x: 12, y: 12 }), // SE (bishop line)
    makeEnemy({ kind: 'pawn', x: 12, y: 8 }), // NE (bishop line)
  ];
  const idx = s.player.cards.findIndex((c) => c.kind === 'bishop');
  const first = useCard(s, idx, 13, 13); // aim the SE max-range endpoint (line sweeps the foe at 12,12)
  assert.ok(!first.enemies.some((e) => e.x === 12 && e.y === 12), 'the SE foe falls');
  assert.equal(first.lastAction, 'card-followup', 'the caster stays up for a second shot');
  assert.equal(first.enemyTurn, false, 'the turn has NOT passed yet');
  assert.equal(first.player.cards[idx].remaining, 0, 'and the card is not yet on cooldown');
  assert.equal(first.player.cards[idx].doubleReady, true, 'a follow-up is armed');
  // The follow-up shot ends the turn and puts the card on cooldown.
  const second = useCard(first, idx, 13, 7); // aim the NE endpoint (line sweeps the foe at 12,8)
  assert.ok(!second.enemies.some((e) => e.x === 12 && e.y === 8), 'the NE foe falls too');
  assert.equal(second.enemyTurn, true, 'now the turn passes');
  assert.ok(second.player.cards[idx].remaining > 0, 'and the card is on cooldown');
  assert.ok(!second.player.cards[idx].doubleReady, 'the follow-up is spent');
});

test('Double Cast: the FIRST shot alone ends the turn when no target remains', () => {
  const s = sorcererWith('s_amp', 's_staff', 's_barrage');
  s.enemies = [makeEnemy({ kind: 'pawn', x: 12, y: 12 })]; // the only foe (SE diagonal)
  const idx = s.player.cards.findIndex((c) => c.kind === 'bishop');
  const r = useCard(s, idx, 13, 13); // aim the SE endpoint; the line sweeps the lone foe
  assert.equal(r.enemies.length, 0, 'the lone foe falls');
  assert.equal(r.enemyTurn, true, 'no target remains, so the turn ends after one shot');
  assert.ok(r.player.cards[idx].remaining > 0, 'and the card goes on cooldown');
});

test('Conjuration Phantom Steed: an L-shaped AOE spell that never moves the king', () => {
  const s = sorcererWith('s_amp', 's_staff');
  const idx = s.player.cards.findIndex((c) => c.kind === 'horse');
  assert.ok(idx >= 0, 'Phantom Steed grants a horse card');
  assert.equal(s.player.cards[idx].cooldown, 4, 'the horse keeps its own cooldown (4)');
  // King at (10,10). Knight offset (+2,+1) traces the L: (11,10) · (12,10) · the tile (12,11).
  s.enemies = [
    makeEnemy({ kind: 'pawn', x: 11, y: 10, awake: true }), // on the L path
    makeEnemy({ kind: 'pawn', x: 12, y: 11, awake: true }), // the aimed knight tile (destination)
  ];
  const targets = getCardMoves(s, s.player.cards[idx]);
  assert.ok(targets.some((t) => t.x === 12 && t.y === 11), 'the knight tile is a valid aim');
  const r = useCard(s, idx, 12, 11);
  assert.deepEqual({ x: r.player.x, y: r.player.y }, { x: 10, y: 10 }, 'the king does NOT move (it is no jump)');
  assert.ok(!r.enemies.some((e) => e.x === 11 && e.y === 10), 'the foe on the L path is trampled');
  assert.ok(!r.enemies.some((e) => e.x === 12 && e.y === 11), 'and the foe at the knight tile too');
  assert.ok((r.ashes || []).length >= 1, 'spell kills leave ash');
});

test('Phase lets the king enter walls and blinds him while embedded', () => {
  const s = sorcererWith('s_blink', 's_phase');
  s.terrain = { '11,10': 'wall' };
  assert.ok(getPlayerMoves(s).some((m) => m.x === 11 && m.y === 10), 'a wall is a legal move while phasing');
  const inWall = movePlayerTo(s, 11, 10);
  const bounds = getVisibleBounds(inWall);
  assert.equal(bounds.width, 3, 'sight shrinks to a 3x3 window inside a wall');
});

test('Displacement swaps the king with a targeted unit; Blink flees to safety', () => {
  const s = sorcererWith('s_blink', 's_phase', 's_swap');
  s.enemies = [makeEnemy({ kind: 'knight', x: 13, y: 13 })];
  const idx = s.player.cards.findIndex((c) => c.kind === 'swap');
  const r = useCard(s, idx, 13, 13);
  assert.deepEqual({ x: r.player.x, y: r.player.y }, { x: 13, y: 13 }, 'the king takes the unit’s tile');
  assert.deepEqual({ x: r.enemies[0].x, y: r.enemies[0].y }, { x: 10, y: 10 }, 'and the unit takes his');

  const bs = sorcererWith('s_blink');
  bs.enemies = [makeEnemy({ kind: 'rook', x: 10, y: 8 })]; // in sight, threatens the king's column
  assert.ok(getThreatenedTiles(bs).has('10,10'), 'the king starts on a threatened tile');
  assert.equal(blinkToSafety(bs), true);
  assert.ok(!getThreatenedTiles(bs).has(`${bs.player.x},${bs.player.y}`), 'blink lands on a safe tile');
});

test('Hex converts one adjacent foe per turn into a ferz (boss/ferz immune, pawns are not); Slumber sleeps adjacent foes', () => {
  const hex = sorcererWith('s_hex');
  hex.player.moveRange = 1;
  // Move UP, away from the foe — it ends adjacent (to the side), never "ahead": still hexed.
  hex.enemies = [makeEnemy({ kind: 'knight', x: 11, y: 10, awake: true })];
  const moved = movePlayerTo(hex, 10, 9);
  assert.equal(moved.enemies[0].kind, 'ferz', 'an adjacent foe is warped into a ferz');
  assert.equal(moved.enemies[0].awake, false, 'and confused (startled)');

  // A PAWN is no longer immune — it warps too.
  const pawnHex = sorcererWith('s_hex');
  pawnHex.player.moveRange = 1;
  pawnHex.enemies = [makeEnemy({ kind: 'pawn', x: 11, y: 10, awake: true })];
  assert.equal(movePlayerTo(pawnHex, 10, 9).enemies[0].kind, 'ferz', 'a pawn is warped too (no longer immune)');

  // A FERZ is immune — it's already the weakest form.
  const ferzHex = sorcererWith('s_hex');
  ferzHex.player.moveRange = 1;
  ferzHex.enemies = [makeEnemy({ kind: 'ferz', x: 11, y: 10, awake: true })];
  assert.equal(movePlayerTo(ferzHex, 10, 9).enemies[0].kind, 'ferz', 'a ferz is immune to Hex');

  const bossHex = sorcererWith('s_hex');
  bossHex.player.moveRange = 1;
  bossHex.enemies = [makeEnemy({ kind: 'knight', x: 11, y: 10, awake: true, boss: true, hp: 3, maxHp: 3, dormant: false })];
  assert.equal(movePlayerTo(bossHex, 10, 9).enemies[0].kind, 'knight', 'the boss is immune to Hex');

  const lull = sorcererWith('s_hex', 's_cata', 's_slumber');
  const foe = makeEnemy({ kind: 'rook', x: 11, y: 10, awake: true });
  lull.enemies = [foe];
  const hp0 = lull.player.hp;
  const r = beginEnemyPhase(lull);
  const woke = r.state;
  assert.equal(woke.enemies[0].asleep, true, 'the adjacent foe is asleep');
  assert.equal(woke.player.hp, hp0, 'a sleeping foe never strikes');
});

test('Fletcher opens with Reload (T1); the queen is T2', () => {
  const s = rangerWith('r_reload'); // tier 1 alone
  assert.ok(s.player.cards.some((c) => c.kind === 'reload'), 'reload is the first Fletcher grant');
  assert.ok(!s.player.cards.some((c) => c.kind === 'queen'), 'the queen is NOT granted at tier 1');
  const s2 = rangerWith('r_reload', 'r_longbow'); // tier 1 then tier 2
  assert.ok(s2.player.cards.some((c) => c.kind === 'queen'), 'the queen arrives at tier 2');
});

test('a walled-in king is wrenched to a tile that can reach the key and stair', () => {
  const s = createInitialState('warrior');
  s.floor = 3;
  s.enemies = [];
  s.player.x = 5; s.player.y = 5; // jammed in a tiny cell...
  s.terrain = { // ...walled in on all eight sides
    '4,4': 'wall', '5,4': 'wall', '6,4': 'wall',
    '4,5': 'wall', '6,5': 'wall',
    '4,6': 'wall', '5,6': 'wall', '6,6': 'wall',
  };
  s.exit = { x: 18, y: 18, discovered: true, locked: false };
  s.key = { x: 17, y: 17, collected: false };
  assert.equal(dangerReachOk(s), false, 'he is genuinely walled off from both objectives');
  const moved = ensureReachable(s);
  assert.equal(moved, true, 'so he is relocated');
  assert.ok(!(s.player.x === 1 && s.player.y === 1), 'to a new tile');
  assert.equal(dangerReachOk(s), true, 'from which he can now reach the key and the stair');
});

test('a ferz moves and captures exactly one step diagonally (never orthogonally)', () => {
  const s = createInitialState('warrior');
  s.terrain = {}; s.enemies = [];
  const ferz = makeEnemy({ kind: 'ferz', x: 10, y: 10 });
  s.enemies = [ferz];
  const moves = getPieceMoves(ferz, s);
  assert.ok(moves.some((m) => m.x === 11 && m.y === 11), 'steps one diagonal');
  assert.ok(!moves.some((m) => m.x === 11 && m.y === 10), 'never orthogonally');
  assert.ok(!moves.some((m) => m.x === 12 && m.y === 12), 'and only ONE step');
});

test('a non-demonic foe knocked into lava burns down; a demon-kind foe shrugs it off', () => {
  const s = createInitialState('warrior');
  s.terrain = { '12,10': 'lava' };
  s.player.x = 10; s.player.y = 10;
  s.enemies = [makeEnemy({ kind: 'pawn', x: 12, y: 10, awake: true })]; // a plain foe standing in lava
  const burned = beginEnemyPhase(s).state;
  assert.ok(!burned.enemies.some((e) => e.x === 12 && e.y === 10), 'the pawn is consumed by the lava');
  const s2 = createInitialState('warrior');
  s2.terrain = { '12,10': 'lava' };
  s2.player.x = 10; s2.player.y = 10;
  s2.enemies = [makeEnemy({ kind: 'amazon', x: 12, y: 10, awake: true })]; // a demon-kind foe
  assert.ok(beginEnemyPhase(s2).state.enemies.some((e) => e.x === 12 && e.y === 10), 'the demon-kind amazon is immune to lava');
});

test('the undead ally sears in lava; a demonic ally is immune', () => {
  const s = sorcererWith('s_familiar');
  s.terrain = { '9,9': 'lava' }; s.enemies = [];
  s.allies = [{ id: 'u1', kind: 'knight', x: 9, y: 9, undead: true }]; // non-demon undead
  assert.ok(!(beginEnemyPhase(s).state.allies || []).some((a) => a.id === 'u1'), 'the undead knight burns in the lava');
  const s2 = sorcererWith('s_familiar');
  s2.terrain = { '9,9': 'lava' }; s2.enemies = [];
  s2.allies = [{ id: 'd1', kind: 'berolina', x: 9, y: 9, familiar: true }]; // demonic familiar
  assert.ok((beginEnemyPhase(s2).state.allies || []).some((a) => a.id === 'd1'), 'the demonic familiar is immune to lava');
});

test('Necromancy: familiar spawns and respawns; foes rise as one undead at a time', () => {
  const s = sorcererWith('s_familiar');
  assert.equal(s.allies.length, 1);
  assert.ok(s.allies[0].familiar && s.allies[0].kind === 'berolina');
  assert.equal(chebyshev(s.allies[0].x, s.allies[0].y, s.player.x, s.player.y), 1, 'spawns beside the king');
  assert.ok((nextFloor(s).allies || []).some((a) => a.familiar), 'rejoins on the next floor');

  const necro = sorcererWith('s_familiar', 's_undead');
  necro.allies = [];
  necro.enemies = [makeEnemy({ kind: 'knight', x: 13, y: 13 })];
  const raised = useCard(necro, 0, 13, 13); // bishop bolt (diagonal) slays the knight → it rises undead
  assert.equal((raised.allies || []).filter((a) => a.undead).length, 1, 'a slain foe rises as undead');
  raised.enemies = [makeEnemy({ kind: 'bishop', x: 13, y: 7 })];
  raised.player.cards[0].remaining = 0;
  const again = useCard(raised, 0, 13, 7);
  assert.equal((again.allies || []).filter((a) => a.undead).length, 1, 'only ONE undead at a time');
});

test('allies: enemies may capture them, the king swaps with them, the General upgrades', () => {
  const rook = makeEnemy({ kind: 'rook', x: 12, y: 8 });
  const s = sorcererWith();
  s.enemies = [rook];
  s.allies = [{ id: 'fam', kind: 'berolina', x: 12, y: 10, familiar: true }];
  assert.ok(getPieceMoves(rook, s).some((m) => m.x === 12 && m.y === 10), 'an ally tile is a valid enemy capture');

  const swap = sorcererWith('s_familiar');
  swap.allies = [{ id: 'fam', kind: 'berolina', x: 11, y: 10, familiar: true }];
  swap.player.moveRange = 1;
  const swapped = movePlayerTo(swap, 11, 10);
  assert.deepEqual({ x: swapped.player.x, y: swapped.player.y }, { x: 11, y: 10 });
  assert.deepEqual({ x: swapped.allies[0].x, y: swapped.allies[0].y }, { x: 10, y: 10 }, 'king and familiar trade tiles');

  const gen = sorcererWith('s_familiar', 's_undead', 's_general');
  assert.ok(gen.allies.some((a) => a.familiar && a.kind === 'general'), 'the familiar becomes a General');
});

test('Blink fires at most once per turn; Silent hides only foes beyond a tile', () => {
  const bs = sorcererWith('s_blink');
  bs.enemies = [makeEnemy({ kind: 'rook', x: 10, y: 8 })];
  assert.equal(blinkToSafety(bs), true);
  assert.equal(blinkToSafety(bs), false, 'the second blink this turn is spent');

  const phase = (state) => beginEnemyPhase(state).state;
  // An unaware foe TWO tiles from the Silent king stays oblivious (it wanders, never wakes).
  const far = createInitialState('warrior');
  far.terrain = {};
  far.player.x = 10; far.player.y = 10; far.player.stealth = true;
  far.enemies = [makeEnemy({ kind: 'rook', x: 12, y: 10, awake: false })];
  const farFoe = phase(far).enemies.find((e) => e.kind === 'rook');
  assert.ok(farFoe && !farFoe.awake && !farFoe.surprised, 'a foe beyond a tile never notices him');
  // An unaware foe WITHIN a tile detects him at once (surprised) — exactly like a normal
  // first sighting, not fooled by stealth.
  const near = createInitialState('warrior');
  near.terrain = {};
  near.player.x = 10; near.player.y = 10; near.player.stealth = true;
  near.enemies = [makeEnemy({ kind: 'rook', x: 11, y: 10, awake: false })];
  const nearFoe = phase(near).enemies[0];
  assert.ok(nearFoe.awake || nearFoe.surprised, 'a foe within a tile detects the Silent king');
});

test('Silent: attacking reveals you; a foe that wanders adjacent wakes at once', () => {
  const phase = (state) => {
    const r = beginEnemyPhase(state);
    let st = r.state;
    for (const id of r.moverIds) st = moveEnemy(st, id);
    return st;
  };

  // Capturing a foe breaks stealth: a distant unaware bystander wakes that same phase.
  const atk = createInitialState('warrior');
  atk.terrain = {};
  atk.player.x = 10; atk.player.y = 10; atk.player.stealth = true;
  atk.enemies = [
    makeEnemy({ kind: 'rook', x: 12, y: 10, awake: false }), // bystander, 2 away, in sight
    makeEnemy({ kind: 'pawn', x: 12, y: 11, awake: false }), // a knight-leap target
  ];
  const struck = useCard(atk, 0, 12, 11); // knight card captures the pawn
  assert.equal(struck.player.attacked, true, 'an attack marks the king as revealed');
  const seen = phase(struck).enemies.find((e) => e.kind === 'rook');
  assert.ok(seen && (seen.surprised || seen.awake), 'the bystander wakes — the strike gave the king away');

  // A plain (non-capturing) move does NOT reveal you — the king stays unmarked. (Whether
  // a distant foe then wanders into you is a separate matter, tested below.)
  const sneak = createInitialState('warrior');
  sneak.terrain = {};
  sneak.player.x = 10; sneak.player.y = 10; sneak.player.stealth = true; sneak.player.moveRange = 1;
  sneak.enemies = [makeEnemy({ kind: 'rook', x: 12, y: 10, awake: false })];
  const moved = movePlayerTo(sneak, 10, 9); // step to empty ground
  assert.equal(moved.player.attacked, false, 'a plain move does not reveal you');

  // A foe adjacent at the START of a phase detects the Silent king at once (surprised),
  // then hunts — within a tile, it is no longer fooled.
  const adj = createInitialState('warrior');
  adj.terrain = {};
  adj.player.x = 10; adj.player.y = 10; adj.player.stealth = true;
  adj.enemies = [makeEnemy({ kind: 'rook', x: 11, y: 10, awake: false })];
  const woke = phase(adj).enemies[0];
  assert.ok(woke.awake || woke.surprised, 'a foe within a tile notices the Silent king at once');
});

test('every floor spawns a key and a stair sealed until it is collected', () => {
  for (let floor = 1; floor <= 5; floor += 1) {
    const s = generateFloor(floor, createPlayer('warrior'), 0);
    assert.ok(s.key, `floor ${floor} has a key`);
    assert.equal(s.exit.locked, true, 'the stair starts locked');
    assert.ok(!(s.key.x === s.exit.x && s.key.y === s.exit.y), 'the key is not on the stair');
    assert.ok(!(s.key.x === s.player.x && s.key.y === s.player.y), 'the key is not under the king');
    // The GUARDIAN now stands on the key (it guards it); no OTHER piece/turret/circle may.
    assert.ok(s.enemies.some((e) => e.boss && e.x === s.key.x && e.y === s.key.y), 'the guardian guards the key');
    assert.ok(!s.enemies.some((e) => !e.boss && e.x === s.key.x && e.y === s.key.y), 'no non-boss piece sits on the key');
    // The king spawns NEAR the exit (a short journey to the way out).
    assert.ok(chebyshev(s.exit.x, s.exit.y, s.player.x, s.player.y) <= 6, 'the king starts near the exit');
  }
});

test('the stair stays sealed until the key is collected, then opens', () => {
  const s = generateFloor(3, createPlayer('warrior'), 0);
  const onStair = structuredClone(s);
  onStair.player.x = onStair.exit.x;
  onStair.player.y = onStair.exit.y;
  assert.equal(tryDescend(onStair), false, 'cannot descend while locked');

  const onKey = structuredClone(s);
  onKey.player.x = onKey.key.x;
  onKey.player.y = onKey.key.y;
  assert.equal(collectKeyIfHere(onKey), true);
  assert.equal(onKey.key.collected, true);
  assert.equal(onKey.exit.locked, false, 'collecting the key unlocks the stair');
  onKey.player.x = onKey.exit.x;
  onKey.player.y = onKey.exit.y;
  assert.equal(tryDescend(onKey), true, 'now the king may descend');
});

test('walking onto the key collects it; enemies never step on it', () => {
  const s = createInitialState('warrior');
  s.terrain = {};
  s.enemies = [];
  s.key = { x: 12, y: 10, collected: false, discovered: false };
  s.exit = { x: 3, y: 3, discovered: false, locked: true };
  s.player.x = 11;
  s.player.y = 10;
  s.player.moveRange = 1;
  const walked = movePlayerTo(s, 12, 10);
  assert.equal(walked.key.collected, true, 'stepping onto the key collects it');
  assert.equal(walked.exit.locked, false, 'and unlocks the stair');

  const es = createInitialState('warrior');
  es.terrain = {};
  es.key = { x: 10, y: 6, collected: false, discovered: false };
  const rook = makeEnemy({ kind: 'rook', x: 10, y: 2 });
  es.enemies = [rook];
  const moves = getPieceMoves(rook, es);
  assert.ok(!moves.some((m) => m.x === 10 && m.y === 6), 'the key tile is not a legal enemy move');
  assert.ok(!moves.some((m) => m.x === 10 && m.y > 6), 'the key blocks a slider from passing through it');
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

test('a raised moveRange forces the FULL slide — 2 tiles, stopping only on collision', () => {
  const s = createInitialState('warrior');
  s.terrain = {};
  s.enemies = [];
  s.player.x = 10;
  s.player.y = 10;
  s.player.moveRange = 2;
  const moves = getPlayerMoves(s);
  assert.ok(moves.some((m) => m.x === 12 && m.y === 10), 'the 2-tile destination is offered');
  assert.ok(!moves.some((m) => m.x === 11 && m.y === 10), 'the inner 1-tile stop is NOT (must commit)');
  const far = movePlayer(s, 1, 0);
  assert.deepEqual({ x: far.player.x, y: far.player.y }, { x: 12, y: 10 }, 'keyboard east slides the full 2');

  const blocked = createInitialState('warrior');
  blocked.terrain = { '12,10': 'wall' };
  blocked.enemies = [];
  blocked.player.x = 10;
  blocked.player.y = 10;
  blocked.player.moveRange = 2;
  const stop = movePlayer(blocked, 1, 0);
  assert.deepEqual({ x: stop.player.x, y: stop.player.y }, { x: 11, y: 10 }, 'a wall halts the slide one short');
});

test('Double-Step: the Cavalier gains an on-demand 2-tile dash; ordinary movement stays 1', () => {
  const s = warriorWith('w_fleet'); // Cavalier tier 1 now grants the double-step card
  s.player.x = 10;
  s.player.y = 10;
  const card = s.player.cards.find((c) => c.kind === 'doublestep');
  assert.ok(card, 'the perk grants a double-step card');
  assert.equal(card.cooldown, 3, 'on a 3-turn cooldown');
  assert.equal(s.player.moveRange, 1, 'and it does NOT raise move range (normal steps stay 1)');
  const idx = s.player.cards.indexOf(card);
  const targets = getCardMoves(s, card);
  // It MUST cover both tiles now — a 1-tile stop is never offered.
  assert.ok(!targets.some((t) => t.x === 11 && t.y === 10), 'a 1-tile dash is NOT offered (must move the full 2)');
  assert.ok(targets.some((t) => t.x === 12 && t.y === 10), 'only the full 2-tile dash');
  const n = useCard(s, idx, 12, 10);
  assert.deepEqual({ x: n.player.x, y: n.player.y }, { x: 12, y: 10 }, 'the king dashes two tiles');
  // Ordinary movement is unaffected — a single step, both squares reachable one at a time.
  assert.ok(getPlayerMoves(s).some((m) => m.x === 11 && m.y === 10), 'normal move is a single step');
  assert.ok(!getPlayerMoves(s).some((m) => m.x === 12 && m.y === 10), 'not a forced 2-tile slide');
  // Blocked at one tile away → that whole direction is unusable (can't stop short).
  const blocked = warriorWith('w_fleet');
  blocked.player.x = 10; blocked.player.y = 10;
  blocked.terrain = { '11,10': 'wall' };
  const bt = getCardMoves(blocked, blocked.player.cards.find((c) => c.kind === 'doublestep'));
  assert.ok(!bt.some((t) => t.x === 12 && t.y === 10), 'a wall one tile out blocks the whole dash that way');
});

test('slaying a boss grants the boon in place — the king does not auto-descend', () => {
  const s = createInitialState('warrior');
  s.terrain = {};
  s.floor = 3; // not the final floor
  s.exit = { x: 9, y: 8, discovered: true };
  const boss = createBoss(3, 9, 8);
  boss.hp = 1; boss.maxHp = 1; boss.dormant = false; boss.spokeLine = true;
  s.enemies = [boss];
  s.player.x = 8; s.player.y = 8;
  const before = s.player.level;
  const n = movePlayerTo(s, 9, 8); // strike the adjacent boss in place
  assert.equal(n.enemies.some((e) => e.boss), false, 'the boss is slain');
  assert.equal(n.pendingLevelUp, true, 'the boon is granted on the kill');
  assert.ok(Array.isArray(n.levelPerks) && n.levelPerks.length === 2);
  assert.equal(n.player.level, before + 1, 'the level climbs on the kill');
  assert.deepEqual({ x: n.player.x, y: n.player.y }, { x: 9, y: 8 }, 'the king strides onto the fallen guardian’s tile');
  assert.notEqual(n.lastAction, 'exit', 'and does NOT descend yet (the guardian guarded the key, not the stair)');
});

test('descending the stair is a separate step and grants no further boon', () => {
  const s = createInitialState('warrior');
  s.terrain = {};
  s.enemies = []; // boss already slain and gone
  s.exit = { x: 9, y: 8, discovered: true };
  s.player.x = 8; s.player.y = 8;
  const stepped = movePlayerTo(s, 9, 8); // walk onto the now-open stair
  assert.equal(stepped.lastAction, 'exit');
  const nf = nextFloor(stepped);
  assert.equal(nf.pendingLevelUp, false, 'descending alone earns nothing');
});

test('taking a tier-1 perk and a card perk both apply', () => {
  let hp = createInitialState('warrior');
  const hp0 = hp.player.maxHp;
  hp.pendingLevelUp = true;
  hp = learnPerk(hp, 'w_hp1'); // tier 1 gives +1
  assert.equal(hp.player.maxHp, hp0 + 1);

  let card = createInitialState('warrior');
  const cards0 = card.player.cards.length;
  card.pendingLevelUp = true;
  card = learnPerk(card, 'w_enpassant');
  assert.equal(card.player.cards.length, cards0 + 1);
  assert.ok(card.player.cards.some((c) => c.kind === 'enpassant'));
});

test('perks are tiered: a capstone stays gated until its prerequisites are taken', () => {
  const p = createPlayer('warrior');
  // Fresh: only the four tier-1 chain roots are offerable; the tier-2/3 are gated.
  const rootIds = rollLevelPerks({ ...p, takenPerks: [] }, 99).map((o) => o.id).sort();
  assert.deepEqual(rootIds, ['w_edge', 'w_enpassant', 'w_fleet', 'w_hp1']);
  // Taking the tier-1 HP unlocks the tier-2 (but not yet the tier-3 Bulwark).
  const afterHp1 = rollLevelPerks({ ...p, takenPerks: ['w_hp1'] }, 99).map((o) => o.id);
  assert.ok(afterHp1.includes('w_hp2'), 'tier 2 unlocked by tier 1');
  assert.ok(!afterHp1.includes('w_bulwark'), 'tier 3 still gated');
  assert.ok(!afterHp1.includes('w_hp1'), 'a taken perk is not re-offered');
  // With tier-1 and tier-2 in, the tier-3 capstone finally appears.
  const afterHp2 = rollLevelPerks({ ...p, takenPerks: ['w_hp1', 'w_hp2'] }, 99).map((o) => o.id);
  assert.ok(afterHp2.includes('w_bulwark'), 'tier 3 unlocked by tier 2');
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

test('an enemy that pursues into view reads as aware, not "unaware" on screen', () => {
  const s = createInitialState('warrior');
  s.terrain = {};
  s.player.x = 10;
  s.player.y = 10;
  // Out of sight (dist 4) but hunting the king's last-seen tile; it will step into view.
  s.enemies = [makeEnemy({ kind: 'king', x: 10, y: 14, awake: false, lastSeen: { x: 10, y: 10 }, lastSeenTtl: 5 })];
  assert.equal(unitInSight(s, 10, 14), false, 'it starts out of sight');
  const e = beginEnemyPhase(s).state.enemies[0];
  assert.ok(unitInSight(s, e.x, e.y), 'it advanced onto the screen');
  assert.equal(e.awake, true, 'so it must read as aware/hostile');
  assert.equal(e.surprised, false, 'not surprised (it was already hunting), and never left unaware');
});

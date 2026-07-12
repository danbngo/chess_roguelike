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
  `${source}\nreturn { createInitialState, createPlayer, generateFloor, nextFloor, learnPerk, rollLevelPerks, getPlayerMoves, movePlayer, movePlayerTo, beginEnemyPhase, moveEnemy, maybeSpawnEnemy, useCard, getVisibleBounds, capturableAt, createBoss, defeatBoss, enemyRole, getCardMoves, getPieceThreats, chebyshev, CLASSES, terrainAt, unitInSight, fireTurret, summonCircleTurn, tryDescend, collectKeyIfHere, getPieceMoves, blinkToSafety, getThreatenedTiles, advanceAllies, allyAt, enemyAwareOfKing, playerDisplayColor, chainColorFor };`,
)();
const {
  createInitialState, createPlayer, generateFloor, nextFloor, learnPerk, rollLevelPerks,
  getPlayerMoves, movePlayer, movePlayerTo, beginEnemyPhase, moveEnemy, useCard,
  getVisibleBounds, capturableAt, createBoss, enemyRole, getCardMoves, chebyshev, CLASSES, terrainAt, unitInSight,
  fireTurret, summonCircleTurn, tryDescend, collectKeyIfHere, getPieceMoves, blinkToSafety, getThreatenedTiles,
  advanceAllies, allyAt, enemyAwareOfKing, playerDisplayColor, chainColorFor,
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
  assert.equal(createPlayer('ranger').cards[0].kind, 'bishop');
  assert.equal(createPlayer('ranger').cards[0].cooldown, 3); // the class-default cooldown
  assert.equal(CLASSES.ranger.category, 'ranged');
  assert.equal(createPlayer('sorcerer').cards[0].kind, 'rook');
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

test('descending onto a floor leaves no enemy in the king’s line of sight', () => {
  // Floors 2..8 are reached by descending — the king should arrive to a quiet view so
  // tutorials stagger one at a time. (Floor 1 is a new game, not a descent, and keeps
  // its deliberate intro foe; the boss sits far off on the stair, out of sight.)
  for (let floor = 2; floor <= 8; floor += 1) {
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

test('every boss rolls one of the eight boss perks', () => {
  const boss = createBoss(4, 9, 8);
  assert.ok(['summoner', 'blinker', 'brutal', 'ranged', 'sorcerer', 'knockback', 'shapeshifter', 'tough'].includes(boss.bossPerk));
  assert.equal(boss.originalKind, boss.kind);
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
  boss.dormant = false;
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
  boss.dormant = false;
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
  boss.dormant = false;
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

test('classes start with different HP (Warrior sturdiest, Sorcerer frailest)', () => {
  assert.equal(createPlayer('warrior').maxHp, 5);
  assert.equal(createPlayer('ranger').maxHp, 4);
  assert.equal(createPlayer('sorcerer').maxHp, 3);
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

test('a melee card lunges the king onto the target; a spell card pierces cover', () => {
  const melee = createInitialState('warrior'); // starts with a melee KNIGHT (L-leap)
  melee.terrain = {};
  melee.player.x = 8;
  melee.player.y = 8;
  melee.enemies = [makeEnemy({ kind: 'pawn', x: 10, y: 9, awake: true })]; // a knight's move away
  const m = useCard(melee, 0, 10, 9);
  assert.deepEqual({ x: m.player.x, y: m.player.y }, { x: 10, y: 9 });
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
  // The fireball records every tile it scorches (9,8 · 10,8 · the target 11,8) so the
  // view can bloom an impact on each — not just the final tile.
  assert.equal(n.lastShot.role, 'fireball');
  assert.ok(Array.isArray(n.lastShot.tiles), 'a spell carries its AoE tile list');
  const hit = new Set(n.lastShot.tiles.map((t) => `${t.x},${t.y}`));
  assert.ok(hit.has('9,8') && hit.has('10,8') && hit.has('11,8'), 'every tile on the path is marked');
});

test('a sorcerer bolt always travels its FULL range, even at a nearer target', () => {
  const s = createInitialState('sorcerer'); // starts with a rook spell card (reach 3)
  s.terrain = {};
  s.player.x = 8;
  s.player.y = 8;
  // One foe right next to the king, one two tiles further along the same line.
  s.enemies = [makeEnemy({ kind: 'pawn', x: 9, y: 8, awake: true }), makeEnemy({ kind: 'pawn', x: 11, y: 8, awake: true })];
  const n = useCard(s, 0, 9, 8); // AIM at the ADJACENT foe...
  const hit = new Set(n.lastShot.tiles.map((t) => `${t.x},${t.y}`));
  assert.ok(hit.has('9,8') && hit.has('10,8') && hit.has('11,8'), 'the bolt reaches all 3 tiles, not just the aimed one');
  assert.equal(n.enemies.length, 0, '...yet both foes on the line fall');
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

test('Trample: landing a knight leap strikes every adjacent foe', () => {
  const s = warriorWith('w_fleet', 'w_pierce', 'w_trample');
  const idx = s.player.cards.findIndex((c) => c.kind === 'knight');
  s.enemies = [
    makeEnemy({ kind: 'pawn', x: 11, y: 11 }),
    makeEnemy({ kind: 'pawn', x: 13, y: 11 }),
    makeEnemy({ kind: 'pawn', x: 12, y: 12 }),
  ];
  const r = useCard(s, idx, 12, 11); // leap onto empty ground
  assert.deepEqual({ x: r.player.x, y: r.player.y }, { x: 12, y: 11 });
  assert.equal(r.enemies.length, 0, 'all foes around the landing tile fall');
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

test('Amphibious lets the Ranger wade freely and cast while in water', () => {
  const wade = rangerWith('r_wade');
  wade.player.moveRange = 3;
  wade.terrain = { '11,10': 'water', '12,10': 'water' };
  assert.ok(getPlayerMoves(wade).some((m) => m.x === 13 && m.y === 10), 'slides across two water tiles');
  const cast = rangerWith('r_wade');
  cast.terrain = { '10,10': 'water' };
  cast.enemies = [makeEnemy({ kind: 'pawn', x: 12, y: 12 })];
  const r = useCard(cast, 0, 12, 12);
  assert.notEqual(r.lastAction, 'blocked', 'a weapon still fires while wading');
  assert.equal(r.enemies.length, 0);
});

test('Sixth Sense sees and shoots over walls (diagonally, as a bishop)', () => {
  const plain = rangerWith();
  plain.terrain = { '11,11': 'wall' };
  plain.enemies = [makeEnemy({ kind: 'pawn', x: 12, y: 12 })];
  assert.ok(!getCardMoves(plain, plain.player.cards[0]).some((m) => m.x === 12 && m.y === 12), 'a wall blocks the shot');
  const xray = rangerWith('r_wade', 'r_xray');
  xray.terrain = { '11,11': 'wall' };
  xray.enemies = [makeEnemy({ kind: 'pawn', x: 12, y: 12 })];
  assert.ok(getCardMoves(xray, xray.player.cards[0]).some((m) => m.x === 12 && m.y === 12), 'Sixth Sense shoots past it');
  assert.ok(unitInSight(xray, 12, 12), 'and sees past it');
  // ...but it is ONE-WAY: the foe behind the wall cannot see the king back.
  assert.equal(enemyAwareOfKing(xray, 12, 12), false, 'the foe does not see the king through the wall');
  const woke = beginEnemyPhase(xray).state.enemies[0];
  assert.ok(woke && woke.awake === false && !woke.surprised, 'so it stays unaware');
  const clear = structuredClone(xray);
  clear.terrain = {};
  assert.equal(enemyAwareOfKing(clear, 12, 12), true, 'with the wall gone it can see (and would wake)');
});

test('Promotion: a free cast that turns the king into an amazon and locks his cards', () => {
  const s = rangerWith('r_wade', 'r_xray', 'r_promo');
  const bi = s.player.cards.findIndex((c) => c.kind === 'promotion');
  const amazon = useCard(s, bi, s.player.x, s.player.y);
  assert.equal(amazon.player.promotion, 3);
  assert.equal(amazon.enemyTurn, false, 'casting it costs no turn');
  const moves = getPlayerMoves(amazon);
  assert.ok(moves.some((m) => m.viaJump), 'amazon form can knight-leap');
  assert.ok(moves.some((m) => !m.viaJump), 'amazon form can also queen-slide');
  const leap = moves.find((m) => m.viaJump);
  assert.equal(useCard(amazon, 0, 12, 12).lastAction, 'blocked', 'no weapons while promoted');
  const after = movePlayerTo(amazon, leap.x, leap.y);
  assert.equal(after.player.promotion, 2, 'the timer counts down each turn');
});

test('Reload readies every other card; Longbow grants a slow rook; Recoil kicks back', () => {
  const s = rangerWith('r_reload', 'r_longbow');
  const rook = s.player.cards.find((c) => c.kind === 'rook');
  assert.equal(rook.cooldown, 5, 'Longbow rook has cooldown 5');
  s.player.cards[0].remaining = 3; // bishop mid-cooldown
  rook.remaining = 4;
  const ri = s.player.cards.findIndex((c) => c.kind === 'reload');
  const reloaded = useCard(s, ri, s.player.x, s.player.y);
  assert.equal(reloaded.player.cards[0].remaining, 0, 'the bishop is ready again');
  assert.equal(reloaded.player.cards.find((c) => c.kind === 'rook').remaining, 0, 'the rook is ready again');
  assert.equal(reloaded.enemyTurn, true, 'reload spends the turn');

  const rec = rangerWith('r_reload', 'r_longbow', 'r_recoil');
  rec.enemies = [makeEnemy({ kind: 'pawn', x: 12, y: 12 })];
  const shot = useCard(rec, 0, 12, 12); // bishop shot down-right; recoil up-left to (9,9)
  assert.deepEqual({ x: shot.player.x, y: shot.player.y }, { x: 9, y: 9 });
  assert.equal(shot.enemies.length, 0);
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
  assert.equal(s.player.cards[0].kind, 'rook');
  assert.equal(s.player.cards[0].cooldown, 5, 'the mighty starting rook is slow');
  assert.equal(s.player.cards[0].color, '#a855f7', 'a starter card wears the class colour');
  const conj = sorcererWith('s_amp', 's_staff');
  const queen = conj.player.cards.find((c) => c.kind === 'queen');
  assert.equal(queen.cooldown, 9, 'Archstaff queen has cooldown 9');
  assert.equal(queen.color, '#8b5cf6', 'a granted card wears its subclass colour');
});

test('Barrage fires a spell down every line the piece commands', () => {
  const s = sorcererWith('s_amp', 's_staff', 's_barrage');
  s.enemies = [
    makeEnemy({ kind: 'pawn', x: 12, y: 10 }),
    makeEnemy({ kind: 'pawn', x: 8, y: 10 }),
    makeEnemy({ kind: 'pawn', x: 10, y: 12 }),
    makeEnemy({ kind: 'pawn', x: 10, y: 8 }),
    makeEnemy({ kind: 'pawn', x: 12, y: 12 }), // diagonal — a rook can't reach
  ];
  const idx = s.player.cards.findIndex((c) => c.kind === 'rook');
  const r = useCard(s, idx, 12, 10);
  assert.ok(!r.enemies.some((e) => e.y === 10 || e.x === 10), 'all four orthogonal lines are cleared');
  assert.ok(r.enemies.some((e) => e.x === 12 && e.y === 12), 'the diagonal foe survives a rook barrage');
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

test('Hex converts one adjacent foe per turn (boss/pawn immune); Slumber sleeps adjacent foes', () => {
  const hex = sorcererWith('s_hex');
  hex.player.moveRange = 1;
  // Move UP, away from the foe — it ends adjacent (to the side), never "ahead": still hexed.
  hex.enemies = [makeEnemy({ kind: 'knight', x: 11, y: 10, awake: true })];
  const moved = movePlayerTo(hex, 10, 9);
  assert.equal(moved.enemies[0].kind, 'pawn', 'an adjacent foe is warped into a pawn');
  assert.equal(moved.enemies[0].awake, false, 'and confused (startled)');

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

test('Necromancy: familiar spawns and respawns; foes rise as one undead at a time', () => {
  const s = sorcererWith('s_familiar');
  assert.equal(s.allies.length, 1);
  assert.ok(s.allies[0].familiar && s.allies[0].kind === 'berolina');
  assert.equal(chebyshev(s.allies[0].x, s.allies[0].y, s.player.x, s.player.y), 1, 'spawns beside the king');
  assert.ok((nextFloor(s).allies || []).some((a) => a.familiar), 'rejoins on the next floor');

  const necro = sorcererWith('s_familiar', 's_undead');
  necro.allies = [];
  necro.enemies = [makeEnemy({ kind: 'knight', x: 13, y: 10 })];
  const raised = useCard(necro, 0, 13, 10); // rook bolt slays the knight → it rises undead
  assert.equal((raised.allies || []).filter((a) => a.undead).length, 1, 'a slain foe rises as undead');
  raised.enemies = [makeEnemy({ kind: 'bishop', x: 10, y: 13 })];
  raised.player.cards[0].remaining = 0;
  const again = useCard(raised, 0, 10, 13);
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

test('Blink fires at most once per turn; Silent lets foes bump but not auto-notice', () => {
  const bs = sorcererWith('s_blink');
  bs.enemies = [makeEnemy({ kind: 'rook', x: 10, y: 8 })];
  assert.equal(blinkToSafety(bs), true);
  assert.equal(blinkToSafety(bs), false, 'the second blink this turn is spent');

  // Over many single enemy phases: a Silent king is bumped sometimes but never all the
  // time, while a plain unaware adjacent foe simply freezes (surprised) and never hits.
  const phase = (state) => {
    const r = beginEnemyPhase(state);
    let st = r.state;
    for (const id of r.moverIds) st = moveEnemy(st, id);
    return st;
  };
  let silentBumps = 0;
  let plainHits = 0;
  const N = 100;
  for (let i = 0; i < N; i += 1) {
    const s = createInitialState('warrior');
    s.terrain = {};
    s.player.x = 10; s.player.y = 10; s.player.stealth = true;
    s.enemies = [makeEnemy({ kind: 'rook', x: 11, y: 10, awake: false })];
    if (phase(s).player.hp < s.player.hp) silentBumps += 1;
  }
  for (let i = 0; i < N; i += 1) {
    const s = createInitialState('warrior');
    s.terrain = {};
    s.player.x = 10; s.player.y = 10;
    s.enemies = [makeEnemy({ kind: 'rook', x: 11, y: 10, awake: false })];
    if (phase(s).player.hp < s.player.hp) plainHits += 1;
  }
  assert.ok(silentBumps > 0 && silentBumps < N, `silent bumps happen sometimes (${silentBumps}/${N})`);
  assert.equal(plainHits, 0, 'a non-silent unaware foe freezes on first sight, never hitting');
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

  // A foe that wanders adjacent never lingers unaware — it wakes the instant it's beside you.
  let adjacentButUnaware = 0;
  for (let i = 0; i < 200; i += 1) {
    const s = createInitialState('warrior');
    s.terrain = {};
    s.player.x = 10; s.player.y = 10; s.player.stealth = true;
    s.enemies = [makeEnemy({ kind: 'king', x: 12, y: 10, awake: false })];
    const e = phase(s).enemies[0];
    if (e && chebyshev(e.x, e.y, 10, 10) === 1 && e.awake === false && !e.surprised) adjacentButUnaware += 1;
  }
  assert.equal(adjacentButUnaware, 0, 'no foe ends its turn adjacent-yet-oblivious');
});

test('every floor spawns a key and a stair sealed until it is collected', () => {
  for (let floor = 1; floor <= 5; floor += 1) {
    const s = generateFloor(floor, createPlayer('warrior'), 0);
    assert.ok(s.key, `floor ${floor} has a key`);
    assert.equal(s.exit.locked, true, 'the stair starts locked');
    assert.ok(!(s.key.x === s.exit.x && s.key.y === s.exit.y), 'the key is not on the stair');
    assert.ok(!(s.key.x === s.player.x && s.key.y === s.player.y), 'the key is not under the king');
    assert.ok(!s.enemies.some((e) => e.x === s.key.x && e.y === s.key.y), 'no piece/turret/circle sits on the key');
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

test('Fleet (+moveRange) forces the FULL slide — 2 tiles, stopping only on collision', () => {
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

test('slaying a boss grants the boon in place — the king does not auto-descend', () => {
  const s = createInitialState('warrior');
  s.terrain = {};
  s.floor = 3; // not the final floor
  s.exit = { x: 9, y: 8, discovered: true };
  const boss = createBoss(3, 9, 8);
  boss.hp = 1; boss.maxHp = 1; boss.dormant = false;
  s.enemies = [boss];
  s.player.x = 8; s.player.y = 8;
  const before = s.player.level;
  const n = movePlayerTo(s, 9, 8); // strike the adjacent boss in place
  assert.equal(n.enemies.some((e) => e.boss), false, 'the boss is slain');
  assert.equal(n.pendingLevelUp, true, 'the boon is granted on the kill');
  assert.ok(Array.isArray(n.levelPerks) && n.levelPerks.length === 2);
  assert.equal(n.player.level, before + 1, 'the level climbs on the kill');
  assert.deepEqual({ x: n.player.x, y: n.player.y }, { x: 8, y: 8 }, 'the king holds his tile');
  assert.notEqual(n.lastAction, 'exit', 'and does NOT descend yet');
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

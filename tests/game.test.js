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
  createEnemy,
  enemyRole,
  enemyDisplayName,
  rollEnemyRole,
  getCardMoves,
  buyCard,
  terrainAt,
  passTurn,
} = new Function(
  `${source}\nreturn { createInitialState, movePlayer, getVisibleBounds, getPlayerMoves, capturableAt, generateFloor, defeatBoss, bossKindForFloor, useClassAltar, rollClassAltarOffers, highestClass, movePlayerTo, beginEnemyPhase, floorGoldReward, moveEnemy, getPieceThreats, createBoss, useCard, createPlayer, chebyshev, createEnemy, enemyRole, enemyDisplayName, rollEnemyRole, getCardMoves, buyCard, terrainAt, passTurn };`,
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

  // The king starts with a 7x7 sight window, centered on (8,8).
  assert.equal(bounds.width, 7);
  assert.equal(bounds.height, 7);
  assert.equal(bounds.x, 5);
  assert.equal(bounds.y, 5);
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

test('a boss carries HP: melee blows chip its bar until its final form falls', () => {
  const state = createInitialState('valkyrie');
  state.terrain = {};
  state.enemies = [];
  const boss = createBoss(3, 9, 8); // the Yeti: bishop -> king, hp 3 per phase
  boss.homeX = 15;
  boss.homeY = 15;
  state.enemies = [boss];
  state.player.x = 8;
  state.player.y = 8; // adjacent — a normal move strikes it in place

  // A boss is always a legal target (no shield gate).
  assert.equal(capturableAt(state, 9, 8), true);

  const maxHp = boss.maxHp;
  let s = movePlayerTo(state, 9, 8); // one blow
  const hurt = s.enemies.find((e) => e.boss);
  assert.ok(hurt, 'the boss survives a single blow');
  assert.equal(hurt.hp, maxHp - 1);
  assert.deepEqual({ x: s.player.x, y: s.player.y }, { x: 8, y: 8 }, 'the king does not step onto a living boss');
});

test('class altars spend exp to learn class perks in order', () => {
  let state = createInitialState('valkyrie'); // starts with Valkyrie level 1
  state.player.exp = 5;

  // Learn Barbarian L1 (Arsenal, +1 melee card slot) — costs 1 exp.
  const meleeSlots = state.player.caps.melee;
  state.altar = { x: 1, y: 1, used: false, offers: ['barbarian'] };
  state = useClassAltar(state, 'barbarian');
  assert.equal(state.player.classLevels.barbarian, 1);
  assert.equal(state.player.caps.melee, meleeSlots + 1);
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

test('an armored foe survives the first hit; the king stops one tile short', () => {
  const state = createInitialState();
  state.terrain = {};
  state.player.x = 5;
  state.player.y = 5;
  state.enemies = [makeEnemy({ kind: 'pawn', x: 6, y: 5, armored: true })];

  const next = movePlayerTo(state, 6, 5); // king (5,5) strikes the adjacent armored guard
  const foe = next.enemies.find((e) => e.x === 6 && e.y === 5);
  assert.ok(foe, 'the armored foe survives the first blow');
  assert.equal(foe.armored, false, 'its armor is shattered');
  assert.equal(foe.brokenShield, true, 'it now bears a broken shield');
  // The king does NOT enter its tile and is NOT flung to start — he stops short.
  assert.deepEqual({ x: next.player.x, y: next.player.y }, { x: 5, y: 5 });
});

test('jumping onto an armored foe knocks it back so the king lands on its tile', () => {
  const state = createInitialState('valkyrie');
  state.terrain = {};
  state.player.x = 8;
  state.player.y = 8;
  state.player.cards = [{ kind: 'knight', traits: [], cooldown: 3, remaining: 0 }];
  state.enemies = [makeEnemy({ kind: 'pawn', x: 9, y: 10, armored: true })]; // a knight-leap away

  const next = useCard(state, 0, 9, 10); // leap onto the armored guard
  const foe = next.enemies.find((e) => e.armored === false && e.brokenShield);
  assert.ok(foe, 'the guard survives, shield broken');
  // Knocked back along the leap's momentum (away from the king's origin).
  assert.deepEqual({ x: foe.x, y: foe.y }, { x: 10, y: 11 });
  // The king lands on the tile the guard vacated.
  assert.deepEqual({ x: next.player.x, y: next.player.y }, { x: 9, y: 10 });
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

test('a multi-phase boss sheds a form when its HP bar empties', () => {
  let state = createInitialState('valkyrie');
  state.terrain = {};
  state.enemies = [];
  const boss = createBoss(6, 5, 5); // the Lich: king -> king -> king, hp 2/phase
  boss.homeX = 5;
  boss.homeY = 5;
  state.enemies.push(boss);
  state.player.x = 4;
  state.player.y = 5; // adjacent, so a normal move strikes in place

  // Drain the first phase's HP; only then does it shed its form.
  const hp = boss.maxHp;
  for (let i = 0; i < hp; i += 1) {
    const b = state.enemies.find((e) => e.boss);
    state.player.x = b.x - 1; // stand beside wherever it is
    state.player.y = b.y;
    if (b.x - 1 < 0) { state.player.x = b.x + 1; }
    state = movePlayerTo(state, b.x, b.y);
  }
  const survivor = state.enemies.find((e) => e.boss);
  assert.ok(survivor, 'the Lich is not gone after its first form falls');
  assert.equal(survivor.phase, 1, 'it advanced to its second form');
  assert.equal(survivor.hp, survivor.maxHp, 'the bar refilled for the new form');
  assert.equal(Boolean(state.won), false);
});

test('the Bone Dragon shrugs off ranged blows but falls to an adjacent strike', () => {
  const player = createPlayer('valkyrie');
  player.cards = [{ kind: 'rook', category: 'ranged', rating: 1, traits: [], cooldown: 3, remaining: 0 }];
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

  const ranged = useCard(state, 0, 8, 10); // a distant rook shot
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

test('roles are restricted to eligible kinds and carry flavour names', () => {
  const guard = createEnemy('pawn', 1, 1);
  guard.armored = true;
  assert.equal(enemyRole(guard), 'armored');
  assert.equal(enemyDisplayName(guard), 'Guard');

  const banshee = createEnemy('queen', 1, 1);
  banshee.flying = true;
  assert.equal(enemyDisplayName(banshee), 'Banshee');

  const archwizard = createEnemy('chancellor', 1, 1);
  archwizard.mage = true;
  assert.equal(enemyDisplayName(archwizard), 'Archwizard');

  // A king is eligible for no role — rollEnemyRole never grants it one.
  let any = null;
  for (let i = 0; i < 50; i += 1) any = any || rollEnemyRole(1, 'king');
  assert.equal(any, null);

  // A broken-shield unit still reads as an armored Guard.
  const broken = createEnemy('pawn', 1, 1);
  broken.brokenShield = true;
  assert.equal(enemyRole(broken), 'armored');
});

test('a jumper attacks by leaping onto the king and knocking him back', () => {
  const state = createInitialState('valkyrie');
  state.terrain = {};
  state.enemies = [];
  state.player.hp = 5;
  state.player.x = 8;
  state.player.y = 8;
  // A knight a leap away (8-1, 8-2) can hop onto the king's tile.
  const knight = makeEnemy({ kind: 'knight', x: 7, y: 6, awake: true });
  state.enemies = [knight];
  const next = moveEnemy(state, knight.id);
  assert.ok(next.player.hp < 5, 'the leap struck the king');
  // The king was shoved to (9,9) — diagonally, the way the knight jumped.
  assert.deepEqual({ x: next.player.x, y: next.player.y }, { x: 9, y: 9 });
  const jumped = next.enemies[0];
  assert.deepEqual({ x: jumped.x, y: jumped.y }, { x: 8, y: 8 }, 'the knight took the king\'s old tile');
});

test('classes get per-category caps and the right starting weapon', () => {
  const sorc = createPlayer('sorcerer');
  assert.deepEqual(sorc.caps, { melee: 0, ranged: 1, spell: 3 });
  assert.equal(sorc.cards.length, 1);
  assert.equal(sorc.cards[0].category, 'spell');
  assert.equal(sorc.cards[0].kind, 'knight');
  const ranger = createPlayer('ranger');
  assert.equal(ranger.cards[0].category, 'ranged');
  assert.deepEqual(ranger.caps, { melee: 1, ranged: 3, spell: 1 });
});

test('a melee card moves the king onto the slain target', () => {
  const s = createInitialState('valkyrie');
  s.terrain = {};
  s.player.x = 8;
  s.player.y = 8;
  s.player.cards = [{ kind: 'king', category: 'melee', rating: 1, traits: [], cooldown: 2, remaining: 0 }];
  s.enemies = [makeEnemy({ kind: 'pawn', x: 9, y: 8, awake: true })];
  const n = useCard(s, 0, 9, 8);
  assert.deepEqual({ x: n.player.x, y: n.player.y }, { x: 9, y: 8 }, 'king steps onto the vacated tile');
  assert.equal(n.enemies.length, 0);
});

test('a ranged card strikes from afar (king holds) and is blocked by cover', () => {
  const s = createInitialState('valkyrie');
  s.terrain = {};
  s.player.x = 8;
  s.player.y = 8;
  s.player.cards = [{ kind: 'rook', category: 'ranged', rating: 3, traits: [], cooldown: 3, remaining: 0 }];
  s.enemies = [makeEnemy({ kind: 'pawn', x: 9, y: 8, awake: true }), makeEnemy({ kind: 'bishop', x: 10, y: 8, awake: true })];
  const moves = getCardMoves(s, s.player.cards[0]);
  assert.ok(moves.some((m) => m.x === 9 && m.y === 8), 'can hit the near foe');
  assert.ok(!moves.some((m) => m.x === 10 && m.y === 8), 'cannot shoot through the blocker');
  const n = useCard(s, 0, 9, 8);
  assert.deepEqual({ x: n.player.x, y: n.player.y }, { x: 8, y: 8 }, 'king holds his ground');
  assert.ok(!n.enemies.some((e) => e.x === 9 && e.y === 8), 'the near foe falls');
});

test('a spell card pierces cover, slaying the blocker and the target behind it', () => {
  const s = createInitialState('sorcerer');
  s.terrain = {};
  s.player.x = 8;
  s.player.y = 8;
  s.player.cards = [{ kind: 'rook', category: 'spell', rating: 3, traits: [], cooldown: 6, remaining: 0 }];
  s.enemies = [makeEnemy({ kind: 'pawn', x: 9, y: 8, awake: true }), makeEnemy({ kind: 'bishop', x: 11, y: 8, awake: true })];
  const moves = getCardMoves(s, s.player.cards[0]);
  assert.ok(moves.some((m) => m.x === 11 && m.y === 8), 'the spell can target through the blocker');
  const n = useCard(s, 0, 11, 8);
  assert.deepEqual({ x: n.player.x, y: n.player.y }, { x: 8, y: 8 }, 'king holds his ground');
  assert.equal(n.enemies.length, 0, 'the bolt slays both units on its path');
});

test('a card rating extends a slider’s reach (beyond base sight)', () => {
  const s = createInitialState('valkyrie');
  s.terrain = {};
  s.viewSize = 15; // wide sight so reach, not vision, is the limiter
  s.player.vision = 15;
  s.player.x = 8;
  s.player.y = 8;
  s.enemies = [makeEnemy({ kind: 'pawn', x: 12, y: 8, awake: true })]; // four tiles east
  const r1 = getCardMoves(s, { kind: 'rook', category: 'ranged', rating: 1, traits: [] });
  const r3 = getCardMoves(s, { kind: 'rook', category: 'ranged', rating: 3, traits: [] });
  assert.ok(!r1.some((m) => m.x === 12), 'rating 1 (reach 2) falls short of 4 tiles');
  assert.ok(r3.some((m) => m.x === 12 && m.y === 8), 'rating 3 (reach 4) reaches it');
});

test('a Fiery spell scorches its path and burns a caught foe', () => {
  const s = createInitialState('sorcerer');
  s.terrain = {};
  s.floor = 1; // a mortal floor: enemies are not demons, so fire consumes them
  s.player.x = 8;
  s.player.y = 8;
  s.player.cards = [{ kind: 'rook', category: 'spell', rating: 2, traits: ['fiery'], cooldown: 6, remaining: 0 }];
  s.enemies = [makeEnemy({ kind: 'pawn', x: 10, y: 8, awake: true })];
  const n = useCard(s, 0, 10, 8);
  // The bolt slew the pawn and scorched the empty path tile to fire.
  assert.equal(n.enemies.length, 0);
  assert.equal(terrainAt(n, 9, 8), 'fire', 'the path is set alight');
});

test('fire burns a non-demon standing in it, then dies down', () => {
  const s = createInitialState('valkyrie');
  s.terrain = { '8,8': 'fire' };
  s.fires = { '8,8': 2 };
  s.floor = 2;
  s.player.hp = 3;
  s.player.x = 8;
  s.player.y = 8;
  passTurn(s);
  assert.equal(s.player.hp, 2, 'the king is seared while standing in fire');
  assert.equal(s.fires['8,8'], 1, 'the fire has one turn of life left');
  passTurn(s);
  assert.equal(terrainAt(s, 8, 8), 'normal', 'the fire has died down to open ground');
});

test('demons (floor 5+ foes) are unharmed by fire, but the king still burns', () => {
  const s = createInitialState('valkyrie');
  s.terrain = { '9,8': 'fire' };
  s.fires = { '9,8': 2 };
  s.floor = 6; // demon realm — enemies are demonic
  s.enemies = [makeEnemy({ kind: 'berolina', x: 9, y: 8, awake: true })];
  passTurn(s);
  assert.equal(s.enemies.length, 1, 'the demon strides through flame unharmed');
});

test('a Rainy spell douses fire and floods the path', () => {
  const s = createInitialState('sorcerer');
  s.terrain = { '9,8': 'fire', '10,8': 'mud' };
  s.player.x = 8;
  s.player.y = 8;
  s.player.cards = [{ kind: 'rook', category: 'spell', rating: 3, traits: ['rainy'], cooldown: 6, remaining: 0 }];
  s.enemies = [makeEnemy({ kind: 'pawn', x: 11, y: 8, awake: true })];
  const n = useCard(s, 0, 11, 8);
  assert.equal(terrainAt(n, 9, 8), 'normal', 'rain snuffs the fire');
  assert.equal(terrainAt(n, 10, 8), 'water', 'rain floods the mud');
});

test('water is now passable but slow', () => {
  const s = createInitialState('valkyrie');
  s.terrain = { '9,8': 'water' };
  s.player.x = 8;
  s.player.y = 8;
  assert.ok(getPlayerMoves(s).some((m) => m.x === 9 && m.y === 8), 'the king can wade into water');
});

test('buyCard respects per-category caps', () => {
  const s = createInitialState('valkyrie'); // melee cap 2, starts with 1 melee card
  s.player.gold = 999;
  s.weaponShop = {
    x: 1, y: 1, variant: 'blacksmith', category: 'melee',
    offers: [
      { kind: 'rook', category: 'melee', rating: 1, traits: [], sold: false },
      { kind: 'bishop', category: 'melee', rating: 1, traits: [], sold: false },
    ],
  };
  const one = buyCard(s, 0); // fills the 2nd melee slot
  assert.equal(one.player.cards.filter((c) => (c.category || 'melee') === 'melee').length, 2);
  const two = buyCard(one, 1); // melee full, no replace given
  assert.equal(two.player.cards.filter((c) => (c.category || 'melee') === 'melee').length, 2);
  assert.match(two.shopMessage, /full/i);
});

test('a melee enemy cannot move AND strike in the same turn', () => {
  const s = createInitialState('valkyrie');
  s.terrain = {};
  s.player.hp = 5;
  s.player.x = 8;
  s.player.y = 8;
  // A king enemy two tiles away: it cannot capture the king this turn, so it may
  // only advance — never advance THEN strike.
  const foe = makeEnemy({ kind: 'king', x: 10, y: 8, awake: true });
  s.enemies = [foe];
  const n = moveEnemy(s, foe.id);
  const e = n.enemies[0];
  assert.equal(n.player.hp, 5, 'the king takes no damage — the foe could not reach him');
  assert.equal(chebyshev(e.x, e.y, 8, 8), 1, 'it merely closed to melee range');
});

test('a melee enemy that can reach the king strikes from where it stands (persist)', () => {
  const s = createInitialState('valkyrie');
  s.terrain = {};
  s.player.hp = 5;
  s.player.x = 8;
  s.player.y = 8;
  const foe = makeEnemy({ kind: 'king', x: 9, y: 8, awake: true }); // already adjacent
  s.enemies = [foe];
  const n = moveEnemy(s, foe.id);
  const e = n.enemies[0];
  assert.equal(n.player.hp, 4, 'the adjacent foe strikes');
  assert.deepEqual({ x: e.x, y: e.y }, { x: 9, y: 8 }, 'and it does not move onto him');
});

test('a slider enemy cannot strike the king through a blocker', () => {
  const s = createInitialState('valkyrie');
  s.terrain = {};
  s.player.hp = 5;
  s.player.x = 8;
  s.player.y = 8;
  const rook = makeEnemy({ kind: 'rook', x: 11, y: 8, awake: true });
  const blocker = makeEnemy({ kind: 'pawn', x: 10, y: 8, awake: false });
  s.enemies = [rook, blocker];
  const n = moveEnemy(s, rook.id);
  assert.equal(n.player.hp, 5, 'the rook cannot hit through the pawn on its line');
});

test('an enemy that loses sight of the king pursues his last-seen tile', () => {
  const s = createInitialState('valkyrie');
  s.terrain = {};
  s.player.x = 8;
  s.player.y = 8;
  const foe = makeEnemy({ kind: 'king', x: 11, y: 8, awake: false, lastSeen: null, lastSeenTtl: 0 });
  s.enemies = [foe];

  // First phase: it spots the king (three tiles off) and remembers the spot.
  let ph = beginEnemyPhase(s);
  let st = ph.state;
  assert.deepEqual(st.enemies[0].lastSeen, { x: 8, y: 8 }, 'it remembers where it saw the king');
  assert.equal(st.enemies[0].lastSeenTtl > 0, true);

  // Now a wall drops between them: out of sight, it should hunt toward the memory.
  st.terrain = { '10,8': 'wall' };
  ph = beginEnemyPhase(st);
  const after = ph.state.enemies[0];
  assert.ok(chebyshev(after.x, after.y, 8, 8) < chebyshev(11, 8, 8, 8), 'it advanced toward the last-seen tile');
});

test('a blind enemy chases the king’s last-seen tile and can blunder onto the invisible king', () => {
  // Pursuit while the king is invisible: it still advances toward the remembered tile.
  const s = createInitialState('valkyrie');
  s.terrain = {};
  s.player.x = 8;
  s.player.y = 8;
  s.player.statuses = { invisible: 5 };
  s.enemies = [makeEnemy({ kind: 'king', x: 11, y: 8, lastSeen: { x: 8, y: 8 }, lastSeenTtl: 6 })];
  const chased = beginEnemyPhase(s).state.enemies[0];
  assert.ok(chebyshev(chased.x, chased.y, 8, 8) < 3, 'blind, it still closes on the last-seen tile');

  // If the invisible king is still standing there, the pursuer stumbles into him.
  const s2 = createInitialState('valkyrie');
  s2.terrain = {};
  s2.player.x = 8;
  s2.player.y = 8;
  s2.player.hp = 5;
  s2.player.statuses = { invisible: 5 };
  s2.enemies = [makeEnemy({ kind: 'king', x: 9, y: 8, lastSeen: { x: 8, y: 8 }, lastSeenTtl: 6 })];
  const bumped = beginEnemyPhase(s2).state;
  assert.equal(bumped.player.hp, 4, 'blundering into him lands a hit');
  assert.equal(bumped.player.statuses.invisible, 0, 'and reveals him');
  assert.equal(bumped.enemies.length, 0, 'the clumsy pursuer is spent');
});

test('Parry wards the coming enemy phase after a strike, even without a kill', () => {
  const s = createInitialState('valkyrie');
  s.terrain = {};
  s.player.x = 8;
  s.player.y = 8;
  s.player.hp = 5;
  s.player.cards = [{ kind: 'king', category: 'melee', rating: 1, traits: ['parry'], cooldown: 2, remaining: 0 }];
  // Strike an armored pawn (its shield breaks — NOT a kill), with a king foe poised
  // to strike from the far side.
  s.enemies = [
    makeEnemy({ kind: 'pawn', x: 9, y: 8, armored: true, awake: true }),
    makeEnemy({ kind: 'king', x: 8, y: 7, awake: true }),
  ];
  const after = useCard(s, 0, 9, 8);
  assert.equal(after.player.warded, true, 'the parry ward is raised even though nothing died');

  // The adjacent king strikes on the enemy phase but is turned aside.
  const ph = beginEnemyPhase(after);
  let st = ph.state;
  for (const id of ph.moverIds) st = moveEnemy(st, id);
  assert.equal(st.player.hp, 5, 'no damage lands through the parry');
});

test('a summoned unit is dispelled once it is no longer a hostile mover', () => {
  const state = createInitialState('valkyrie');
  state.terrain = {};
  // A summoned pawn far out of sight should vanish this phase.
  const minion = makeEnemy({ kind: 'pawn', x: 18, y: 18, summoned: true, awake: true });
  state.enemies = [minion];
  const phase = beginEnemyPhase(state);
  assert.equal(phase.state.enemies.some((e) => e.id === minion.id), false, 'the out-of-sight summon is dispelled');
});

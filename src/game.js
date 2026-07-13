// Core game rules: building floors, and resolving king / enemy / shop actions.
// Pure logic — no DOM, no canvas, no storage.

/* --------------------------------- enemies -------------------------------- */

function createEnemy(type, x, y) {
  return {
    id: `${type}-${x}-${y}-${Math.random().toString(16).slice(2, 8)}`,
    kind: type,
    x,
    y,
    homeX: x,
    homeY: y,
    awake: false,
    surprised: false,
    frustrated: false,
    // Object roles (at most one): fixed turret, boss, or a destroyable summoning
    // circle. Ordinary enemies carry none.
    turret: false,
    boss: false,
    summonCircle: false, // stationary spawner; destroyed by stepping on it
    summoned: false, // a STATE: conjured, dispelled if it turns non-hostile
    charged: true, // turrets / circles act only when charged (not two turns running)
    lastSeen: null, // {x,y}: last tile the king was seen on (out-of-sight pursuit)
    lastSeenTtl: 0,
  };
}

// The single role a piece carries (or 'normal'), for display / icons.
function enemyRole(enemy) {
  if (enemy.boss) return 'boss';
  if (enemy.turret) return 'turret';
  if (enemy.summonCircle) return 'circle';
  return 'normal';
}

const JUMPER_KINDS = ['knight', 'archbishop', 'chancellor', 'amazon'];
function isJumperKind(kind) {
  return JUMPER_KINDS.includes(kind);
}

// Whether an enemy may be attacked by the king right now. A summoning circle is
// destroyed by stepping on it; a boss and now a TURRET are targetable but soak HP
// (struck in place — see damageBoss / damageTurret). Ordinary pieces die in one.
function isCapturable(state, enemy) {
  if (!enemy) return false;
  return true;
}
function capturableAt(state, x, y) {
  return isCapturable(state, state.enemies.find((e) => e.x === x && e.y === y));
}

// Whether felling this piece should trigger the king's on-kill perks (cleave, leech,
// Quick Draw, Dazzle, Bloodrush). Only real enemy pieces count — NOT summoning
// circles or other structures (and never a mere non-lethal hit, handled by callers).
function isKillablePiece(enemy) {
  return Boolean(enemy) && !enemy.turret && !enemy.summonCircle;
}

// Has the floor's boss been defeated? True when no boss piece remains.
function bossDefeated(state) {
  return !state.enemies.some((e) => e.boss);
}

// The uncollected floor key sits on this tile — enemies and structures may never enter
// or spawn on it (only the king may walk over it, to collect it).
function keyTileAt(state, x, y) {
  return Boolean(state.key) && !state.key.collected && state.key.x === x && state.key.y === y;
}

// The player's ally (Necromancer familiar / undead) standing on this tile, if any.
function allyAt(state, x, y) {
  return (state.allies || []).find((a) => a.x === x && a.y === y) || null;
}
function hasLivingFamiliar(state) {
  return (state.allies || []).some((a) => a.familiar);
}

// The spawn pool for a floor. Floors 1-4 draw from the standard pieces; from floor
// 5 the fairy pieces take over.
function enemyRosterForFloor(floor) {
  const demon = floor >= DEMON_FLOOR;
  const allowed = demon ? DEMON_KINDS : STANDARD_KINDS;
  const pool = ENEMY_UNLOCKS.filter((e) => floor >= e.floor && allowed.includes(e.kind)).map((e) => e.kind);
  return pool.length ? pool : [demon ? 'berolina' : 'pawn'];
}
function randomEnemyKind(floor) {
  const pool = enemyRosterForFloor(floor);
  return pool[randomInt(pool.length)];
}

// Floor 8 is the ABSOLUTE last floor — there is no descent past it. Instead of a stair it
// holds a portal, and instead of a key an Orb of Victory; grabbing the orb opens the portal
// (and rouses the finale's boss-rush), and stepping into the portal wins the run.
function isFinalFloor(floor) {
  return floor >= FINAL_FLOOR;
}

// The floor's boss piece kind (a unique, high-mobility piece — see the LEVELS table).
function bossKindForFloor(floor) {
  const level = levelForFloor(floor);
  return level ? level.boss.kind : 'queen';
}

// Build the floor's boss at (x, y): a high-mobility piece with a HP pool.
function createBoss(floor, x, y) {
  const spec = (levelForFloor(floor) || { boss: { name: 'the Guardian', kind: 'queen', hp: 4 } }).boss;
  const boss = createEnemy(spec.kind, x, y);
  boss.boss = true;
  boss.bossName = spec.name;
  boss.maxHp = spec.hp || 4;
  boss.originalKind = spec.kind; // a Shifting boss never grows stronger than this
  boss.bossPerk = BOSS_PERKS[randomInt(BOSS_PERKS.length)];
  if (boss.bossPerk === 'tough') boss.maxHp += 3; // Hardened: three extra wounds
  boss.hp = boss.maxHp;
  boss.dormant = true; // holds the stair/portal until it spies the king or is struck
  // Demon-floor guardians (the fairy/demon pieces from floor 5) shrug off lava; earlier
  // guardians do not (and the finale's rush of vanilla-type bosses stays vulnerable to it).
  boss.lavaImmune = floor >= DEMON_FLOOR;
  return boss;
}

// A boss's blow strength — Brutal guardians hit twice as hard.
function bossDamage(boss) {
  return boss && boss.bossPerk === 'brutal' ? 2 : 1;
}

// Leech guardians knit a wound shut each time they draw the king's blood (capped at max
// HP). Call this only when a boss's blow ACTUALLY lands (not when it's warded/deflected).
function bossLeech(boss) {
  if (boss && boss.bossPerk === 'leech' && boss.hp < boss.maxHp) boss.hp += 1;
}

// A wounded boss's reaction: Shifting bosses morph to a lesser form; Blinkborn
// bosses flicker away. Called from damageBoss on any non-fatal hit.
function applyBossHitReaction(state, boss) {
  if (boss.bossPerk === 'shapeshifter') {
    const origRank = PIECE_RANK.indexOf(boss.originalKind || boss.kind);
    const pool = PIECE_RANK.filter((k, i) => i <= origRank && k !== boss.kind);
    if (pool.length) {
      boss.kind = pool[randomInt(pool.length)];
      state.message += ` It shifts into a ${boss.kind}!`;
    }
  } else if (boss.bossPerk === 'blinker') {
    if (bossBlink(state, boss)) state.message += ' It blinks away!';
  }
}

// Flicker a struck boss to a random standable tile a few squares off, never adjacent
// to the king. Returns false if there's nowhere to go.
function bossBlink(state, boss) {
  const king = state.player;
  const spots = [];
  for (let dx = -4; dx <= 4; dx += 1) {
    for (let dy = -4; dy <= 4; dy += 1) {
      const x = boss.x + dx;
      const y = boss.y + dy;
      if (x < 0 || x >= WORLD_SIZE || y < 0 || y >= WORLD_SIZE) continue;
      if (chebyshev(x, y, boss.x, boss.y) < 2) continue; // a real jump, not a shuffle
      if (chebyshev(x, y, king.x, king.y) <= 1) continue; // never blink into melee
      if (!isStandable(terrainAt(state, x, y))) continue;
      if (x === king.x && y === king.y) continue;
      if (keyTileAt(state, x, y) || allyAt(state, x, y)) continue;
      if (state.enemies.some((e) => e.id !== boss.id && e.x === x && e.y === y)) continue;
      if (!kindCanMove(state, boss.kind, x, y)) continue;
      spots.push({ x, y });
    }
  }
  if (!spots.length) return false;
  const dest = spots[randomInt(spots.length)];
  boss.x = dest.x;
  boss.y = dest.y;
  return true;
}

function bossTitle(boss) {
  const name = boss.bossName || `${boss.kind} guardian`;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

// A demon-kind guardian (the fairy/demon pieces of the deeper floors) — its threats are nastier.
// A demon (fairy) piece — immune to lava (see tickLavaDamage) and drawn with horns/wings.
function isDemonKind(kind) {
  return DEMON_KINDS.includes(kind);
}
function isDemonBoss(boss) {
  return isDemonKind(boss.originalKind || boss.kind);
}
// The line a guardian snarls the first time it turns hostile toward the king (shown in the log).
// Demon guardians get scarier, hungrier threats.
function bossHostileLine(boss) {
  const name = bossTitle(boss);
  const demon = [
    `${name} fixes its burning gaze on you: "Your soul will feed the abyss!"`,
    `${name} snarls, "Fresh meat... I will wear your bones, little king."`,
    `${name} shrieks, "Kneel and be devoured, mortal!"`,
    `${name} hisses, "The dark has waited so long for you to bleed."`,
  ];
  const mortal = [
    `${name} bellows, "You shall not pass, intruder!"`,
    `${name} levels its guard: "Turn back, or be cut down."`,
    `${name} roars, "Come no further — meet your end here!"`,
    `${name} growls, "This is where your journey ends."`,
  ];
  const pool = isDemonBoss(boss) ? demon : mortal;
  return pool[randomInt(pool.length)];
}

// Deal `amount` damage to a boss. Returns 'slain' if it fell, else 'hurt'.
function damageBoss(state, boss, amount) {
  boss.hp -= amount;
  if (boss.hp > 0) {
    state.message = `The king strikes ${boss.bossName} (${boss.hp}/${boss.maxHp}).`;
    state.lastAction = 'combat';
    applyBossHitReaction(state, boss);
    return 'hurt';
  }
  state.enemies = state.enemies.filter((e) => e.id !== boss.id);
  addSpatter(state, boss.x, boss.y, Math.sign(boss.x - state.player.x), Math.sign(boss.y - state.player.y));
  addCorpse(state, boss.x, boss.y, boss.kind, BOSS_CORPSE_LIFE); // a boss's remains linger far longer
  state.player.killedEnemy = true;
  defeatBoss(state, boss);
  return 'slain';
}

// A turret soaks HP like a boss (a flat, non-scaling pool) and is struck IN PLACE. It
// grants no boon and is not an "on-kill" trigger — it's a structure, just a destructible one.
function damageTurret(state, turret, amount) {
  turret.hp -= amount;
  if (turret.hp > 0) {
    state.message = `The ${turret.kind} turret sparks (${turret.hp}/${turret.maxHp}).`;
    state.lastAction = 'combat';
    return 'hurt';
  }
  state.enemies = state.enemies.filter((e) => e.id !== turret.id);
  addSpatter(state, turret.x, turret.y);
  addCorpse(state, turret.x, turret.y, turret.kind);
  state.message = `The ${turret.kind} turret is destroyed!`;
  state.lastAction = 'combat';
  return 'slain';
}

// Resolve a boss being slain. The floor GUARDIAN earns the level-up boon RIGHT HERE (the king
// does not descend yet — the stair/portal it guarded is now clear, and he must still walk onto
// it). A conjured "rush" boss (the finale's converging guardians) is pure threat — no boon. The
// run is NEVER won by a kill now; victory comes only from stepping into the portal with the Orb.
function defeatBoss(state, boss) {
  if (boss && boss.rush) {
    state.message = `${bossTitle(boss)} is destroyed!`;
    state.lastAction = 'combat';
    return;
  }
  const p = state.player;
  p.level = (p.level || 1) + 1;
  state.pendingLevelUp = true;
  state.levelPerks = rollLevelPerks(p, LEVEL_PERK_CHOICES);
  const tail = isFinalFloor(state.floor) ? 'choose a boon.' : 'choose a boon, then take the stair.';
  state.message = `The guardian falls! You reach level ${p.level} — ${tail}`;
}

/* ------------------------------- the king --------------------------------- */

// Resolve the king dropping to 0 HP: Undying revives once per floor at his start.
function checkDeath(state) {
  const p = state.player;
  if (p.hp > 0) return;
  if (p.extraLife && !p.extraLifeUsed) {
    p.extraLifeUsed = true;
    p.hp = 1;
    p.x = PLAYER_START.x;
    p.y = PLAYER_START.y;
    state.message = 'Undying — you rise again at your start!';
    state.lastAction = 'enemy';
    updateDiscovery(state);
    return;
  }
  state.gameOver = true;
  state.message = 'The king falls.';
}

// Resolve whether an incoming hit is shrugged off: a Bulwark ward (first hit each
// turn), or a Parry ward from a strike last turn. Null means the hit lands. When a
// hit IS deflected, `player.deflected` is flagged so the view can flash a block.
function rollMitigation(player) {
  let mit = null;
  if (player.promotion > 0) {
    mit = 'invuln'; // the promoted warhorse takes no damage for the duration
  } else if (player.warded) {
    mit = 'parry';
  } else if (player.firstHitEachTurn && !player.firstHitUsedThisTurn) {
    player.firstHitUsedThisTurn = true;
    mit = 'ward';
  }
  if (mit) player.deflected = true;
  return mit;
}
function mitigationMessage(mit, kind) {
  if (mit === 'invuln') return `The warhorse charges through a ${kind}, unharmed!`;
  if (mit === 'parry') return `The king parries a ${kind}!`;
  if (mit === 'ward') return `A ward absorbs a ${kind}'s blow!`;
  return `The king shrugs off a ${kind}!`;
}

// Return up to `count` distinct random members of `items` (a shuffled sample).
function pickSome(items, count) {
  const pool = items.slice();
  const picked = [];
  while (pool.length && picked.length < count) {
    picked.push(pool.splice(randomInt(pool.length), 1)[0]);
  }
  return picked;
}

/* --------------------------- classes & the king --------------------------- */

// Perk grant flags that are simply switched on.
const PERK_FLAGS = [
  'reflect', 'firstHitEachTurn', 'freeKillMove', 'extraLife', 'stealth',
  'revealFloor', 'spellHaste', 'freeSpell', 'spellSurprise',
  'meleeCleave', 'meleeLeech', 'rangedRapid', 'spellDazzle',
  'meleeRefund', 'meleePierce', 'leapShock', 'meleeFlourish',
  'terrainImmune', 'seeThroughWalls', 'noChase', 'camouflage', 'recoil',
  'blink', 'phase', 'hexDemote', 'sleepAura', 'doubleCast',
  'familiar', 'necromancy', 'generalForm',
];

// Build a card record. The category (from the owning class) sets the cooldown but
// is NOT stored on the card — it is re-derived from the class wherever needed. `color`
// is the card's subclass colour for the UI (the class colour for a starter card).
function makeCard(kind, category, cooldownOverride, color) {
  const cooldown = cooldownOverride != null ? cooldownOverride : cardCooldown(kind, category || 'melee');
  return { kind, cooldown, remaining: 0, color: color || null };
}

// Apply a perk's grants to a player (stat bumps, a card, or a rule flag). `cardColor`
// tints any card the perk grants (its subclass colour).
function applyPerk(player, grants, cardColor) {
  if (!grants) return;
  if (grants.maxHp) {
    player.maxHp += grants.maxHp;
    player.hp += grants.maxHp;
  }
  if (grants.vision) player.vision += grants.vision;
  if (grants.moveRange) player.moveRange += grants.moveRange;
  if (grants.cardReach) player.cardReach = (player.cardReach || 0) + grants.cardReach;
  if (grants.gainCard) player.cards.push(makeCard(grants.gainCard, classCategory(player.className), grants.gainCooldown, cardColor));
  for (const flag of PERK_FLAGS) {
    if (grants[flag]) player[flag] = true;
  }
}

// Build a fresh king of the chosen class: base stats + its starting card.
function createPlayer(classKey) {
  const cls = CLASSES[classKey] || CLASSES.warrior;
  const startHp = cls.hp || STARTING_HP; // Warrior is sturdier, Sorcerer frailer
  const player = {
    x: PLAYER_START.x,
    y: PLAYER_START.y,
    hp: startHp,
    maxHp: startHp,
    level: 1,
    className: CLASSES[classKey] ? classKey : 'warrior',
    moveRange: 1,
    vision: STARTING_VISION,
    cardReach: 0,
    promotion: 0, // turns remaining as an amazon (Ranger's Promotion); 0 = normal
    cards: [],
    takenPerks: [], // perk ids taken (unique ones can't be offered again)
    warded: false,
    firstHitUsedThisTurn: false,
    freeMoveUsed: false, // Charge: at most one free kill-move per turn
    blinkedThisTurn: false, // Blink fires at most once per turn
    // Per-floor flags reset on descent:
    extraLifeUsed: false,
    attacked: false,
    totalTurns: 0,
    // Conduct trackers:
    killedEnemy: false,
    wasHit: false,
  };
  for (const flag of PERK_FLAGS) player[flag] = false;
  player.cards.push(makeCard(cls.start, cls.category, cls.startCooldown, cls.color));
  return player;
}

// Is a perk offerable right now? Not already taken, and its prerequisite (if any)
// has been taken — so tier-2/3 chain perks only surface once their tier below is in.
function perkAvailable(player, perk) {
  const taken = player.takenPerks || [];
  if (taken.includes(perk.id)) return false;
  if (perk.requires && !taken.includes(perk.requires)) return false;
  return true;
}

// The perks offered on a descent (up to `count`): the currently-unlocked, untaken
// tiers of the king's class chains. May return fewer than `count` late in a run.
function rollLevelPerks(player, count) {
  const cls = CLASSES[player.className] || CLASSES.warrior;
  const eligible = cls.perks.filter((perk) => perkAvailable(player, perk));
  return pickSome(eligible, count || LEVEL_PERK_CHOICES);
}

// Learn a level-up perk (by id) from the king's class pool.
function learnPerk(state, perkId) {
  const next = structuredClone(state);
  const p = next.player;
  const cls = CLASSES[p.className] || CLASSES.warrior;
  const perk = cls.perks.find((k) => k.id === perkId);
  if (!perk || !perkAvailable(p, perk)) {
    next.pendingLevelUp = false;
    return next;
  }
  applyPerk(p, perk.grants, chainColorFor(p.className, perk.chain));
  p.takenPerks.push(perkId);
  // Necromancy: the familiar joins at once; the General upgrade re-forges any living one.
  if (p.generalForm) for (const a of next.allies || []) if (a.familiar) a.kind = 'general';
  if (p.familiar && !hasLivingFamiliar(next)) spawnFamiliar(next);
  next.viewSize = p.vision;
  next.pendingLevelUp = false;
  next.levelPerks = null;
  next.message = `You gain ${perk.name}.`;
  updateDiscovery(next);
  return next;
}

// The class a run belongs to (single class now — kept for the token tint helper).
function highestClass(player) {
  return player.className || 'warrior';
}

/* ----------------------------- floor building ----------------------------- */

function findFreeTile(occupied, predicate, attempts) {
  for (let i = 0; i < (attempts || 300); i += 1) {
    const x = randomInt(WORLD_SIZE);
    const y = randomInt(WORLD_SIZE);
    const key = `${x},${y}`;
    if (occupied.has(key)) continue;
    if (predicate && !predicate(x, y)) continue;
    return { x, y, key };
  }
  return null;
}

// Tiles the KING can walk between (8-directional flood over floor/water — walls and
// lava block him). Used to guarantee the exit is reachable.
function playerReachable(state, sx, sy) {
  const seen = new Set();
  const walkable = (x, y) => x >= 0 && x < WORLD_SIZE && y >= 0 && y < WORLD_SIZE
    && standableFor(terrainAt(state, x, y), { lavaOk: false });
  if (!walkable(sx, sy)) return seen;
  const stack = [[sx, sy]];
  seen.add(`${sx},${sy}`);
  while (stack.length) {
    const [x, y] = stack.pop();
    for (const [dx, dy] of [...ORTHO, ...DIAG]) {
      const nx = x + dx;
      const ny = y + dy;
      const key = `${nx},${ny}`;
      if (seen.has(key) || !walkable(nx, ny)) continue;
      seen.add(key);
      stack.push([nx, ny]);
    }
  }
  return seen;
}

// Clear a walkable L-shaped corridor between two points. Turns walls (and, unless
// `wallsOnly`, lava) to floor.
function carveCorridor(state, x0, y0, x1, y1, wallsOnly) {
  let x = x0;
  let y = y0;
  const open = (cx, cy) => {
    if (cx <= 0 || cx >= WORLD_SIZE - 1 || cy <= 0 || cy >= WORLD_SIZE - 1) return;
    const t = terrainAt(state, cx, cy);
    if (t === 'wall' || t === 'boulder' || t === 'pit' || (!wallsOnly && t === 'lava')) delete state.terrain[`${cx},${cy}`];
  };
  while (x !== x1) { open(x, y); x += Math.sign(x1 - x); }
  while (y !== y1) { open(x, y); y += Math.sign(y1 - y); }
  open(x, y);
}

// Clear the minimum-wall path from (sx,sy) to (tx,ty), routing AROUND lava (a 0-1 BFS:
// stepping on floor/water is free, breaking a wall costs 1, lava is impassable). Turns
// only the walls on that path to floor. Returns false if the target is unreachable even
// through walls (i.e. genuinely lava-isolated) — such a pocket is left alone.
function carveWallPathTo(state, sx, sy, tx, ty) {
  const key = (x, y) => `${x},${y}`;
  const passable = (x, y) => x > 0 && x < WORLD_SIZE - 1 && y > 0 && y < WORLD_SIZE - 1 && terrainAt(state, x, y) !== 'lava';
  const breakable = (t) => t === 'wall' || t === 'boulder' || t === 'pit'; // barriers a carve can clear
  const cost = new Map([[key(sx, sy), 0]]);
  const prev = new Map();
  const deque = [[sx, sy]];
  while (deque.length) {
    const [x, y] = deque.shift();
    if (x === tx && y === ty) break;
    const base = cost.get(key(x, y));
    for (const [dx, dy] of [...ORTHO, ...DIAG]) {
      const nx = x + dx;
      const ny = y + dy;
      if (!passable(nx, ny)) continue;
      const nc = base + (breakable(terrainAt(state, nx, ny)) ? 1 : 0);
      if (!cost.has(key(nx, ny)) || nc < cost.get(key(nx, ny))) {
        cost.set(key(nx, ny), nc);
        prev.set(key(nx, ny), key(x, y));
        if (nc === base) deque.unshift([nx, ny]);
        else deque.push([nx, ny]);
      }
    }
  }
  if (!cost.has(key(tx, ty))) return false; // lava-isolated — leave it be
  let cur = key(tx, ty);
  while (cur) {
    if (breakable(terrainAt(state, ...cur.split(',').map(Number)))) delete state.terrain[cur];
    cur = prev.get(cur);
  }
  return true;
}

// No walkable region may be fully WALLED off from the king. Flood from his start; for
// each pocket he can't reach, carve the min-wall path to it (routing around lava, so
// genuinely lava-isolated islands are left as intended).
function connectWalledPockets(state, sx, sy) {
  const tried = new Set();
  for (let guard = 0; guard < 60; guard += 1) {
    const reach = playerReachable(state, sx, sy);
    let pocket = null;
    for (let y = 1; y < WORLD_SIZE - 1 && !pocket; y += 1) {
      for (let x = 1; x < WORLD_SIZE - 1; x += 1) {
        const key = `${x},${y}`;
        if (reach.has(key) || tried.has(key)) continue;
        if (standableFor(terrainAt(state, x, y), { lavaOk: false })) pocket = { x, y };
      }
    }
    if (!pocket) break;
    for (const k of playerReachable(state, pocket.x, pocket.y)) tried.add(k); // whole pocket, once
    carveWallPathTo(state, sx, sy, pocket.x, pocket.y);
  }
}

// Would this enemy, as its piece, have at least one legal move from where it stands?
function enemyHasMove(state, enemy) {
  return getPieceMoves(enemy, state).length > 0;
}

// Could a piece of `kind` at (x,y) move at all, judged by TERRAIN alone (other units
// ignored — they shift/die)? Used to avoid spawning a piece somewhere it's stuck (e.g.
// a knight boxed into a corridor whose every L-tile is a wall).
function kindCanMove(state, kind, x, y) {
  const probe = { kind, x, y, id: '__probe' };
  return getPieceMoves(probe, { ...state, enemies: [probe] }).length > 0;
}

// How many tiles a turret of `kind` planted at (x,y) would cover, judged by TERRAIN
// alone (transient units don't count — they move/die). Avoids boxing a turret in where
// walls leave it firing at almost nothing.
function turretCoverage(state, kind, x, y) {
  const probe = { kind, x, y, id: '__probe' };
  return getPieceThreats(probe, { ...state, enemies: [probe] }).length;
}

// Could a summoning circle of `kind` at (x,y) conjure a minion onto an adjacent tile
// from which that minion could move (terrain-wise)? (Don't place circles that would
// only ever spawn stuck pieces.)
function circleCanSpawnMobile(state, kind, x, y) {
  for (const [dx, dy] of [...ORTHO, ...DIAG]) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || nx >= WORLD_SIZE || ny < 0 || ny >= WORLD_SIZE) continue;
    if (isStandable(terrainAt(state, nx, ny)) && kindCanMove(state, kind, nx, ny)) return true;
  }
  return false;
}

// Build the floor's terrain: a solid wall border enclosing everything, then rooms,
// hallways and water/lava per the level recipe. The tiles around the king's start
// stay clear.
function generateTerrain(floor, player) {
  const terrain = {};
  const nearStart = (x, y) => chebyshev(x, y, player.x, player.y) <= 2;
  // Interior placement only (never the border, never on the king's doorstep).
  const put = (x, y, type) => {
    if (x < 1 || x >= WORLD_SIZE - 1 || y < 1 || y >= WORLD_SIZE - 1) return;
    if (nearStart(x, y)) return;
    terrain[`${x},${y}`] = type;
  };
  const clear = (x, y) => {
    if (x < 1 || x >= WORLD_SIZE - 1 || y < 1 || y >= WORLD_SIZE - 1) return;
    delete terrain[`${x},${y}`];
  };

  // 1) A wall wraps the whole map so the king is always enclosed.
  for (let i = 0; i < WORLD_SIZE; i += 1) {
    terrain[`${i},0`] = 'wall';
    terrain[`${i},${WORLD_SIZE - 1}`] = 'wall';
    terrain[`0,${i}`] = 'wall';
    terrain[`${WORLD_SIZE - 1},${i}`] = 'wall';
  }

  const blob = (type, patches, spread) => {
    for (let i = 0; i < patches; i += 1) {
      const cx = randomInt(WORLD_SIZE);
      const cy = randomInt(WORLD_SIZE);
      const cells = 3 + randomInt(spread);
      for (let j = 0; j < cells; j += 1) put(cx + randomInt(3) - 1, cy + randomInt(3) - 1, type);
    }
  };
  // Straight wall runs — the bones of hallways.
  const wallLine = (segments, length) => {
    for (let i = 0; i < segments; i += 1) {
      let x = 1 + randomInt(WORLD_SIZE - 2);
      let y = 1 + randomInt(WORLD_SIZE - 2);
      const horizontal = Math.random() < 0.5;
      for (let j = 0; j < length; j += 1) {
        put(x, y, 'wall');
        if (horizontal) x += 1;
        else y += 1;
      }
    }
  };
  // Rectangular rooms — a wall outline with one or two doorway gaps.
  const rooms = (count) => {
    for (let i = 0; i < count; i += 1) {
      const w = 4 + randomInt(5);
      const h = 4 + randomInt(5);
      const rx = 2 + randomInt(Math.max(1, WORLD_SIZE - w - 3));
      const ry = 2 + randomInt(Math.max(1, WORLD_SIZE - h - 3));
      const edge = [];
      for (let x = rx; x < rx + w; x += 1) { put(x, ry, 'wall'); put(x, ry + h - 1, 'wall'); edge.push([x, ry], [x, ry + h - 1]); }
      for (let y = ry; y < ry + h; y += 1) { put(rx, y, 'wall'); put(rx + w - 1, y, 'wall'); edge.push([rx, y], [rx + w - 1, y]); }
      const doors = 1 + randomInt(2);
      for (let d = 0; d < doors && edge.length; d += 1) {
        const [dx, dy] = edge[randomInt(edge.length)];
        clear(dx, dy);
        clear(dx, dy); // widen the gap a touch by clearing a neighbour too
      }
    }
  };

  const level = levelForFloor(floor);
  const recipe = (level && level.recipe) || {};
  const cycle = Math.floor((floor - 1) / FINAL_FLOOR);
  const scale = (1 + cycle * 0.5) * (WORLD_SIZE / 20); // more seeds for the bigger board
  const seeds = (type) => Math.round((recipe[type] || 0) * scale);
  if (seeds('water')) blob('water', 2 * seeds('water'), 5);
  if (seeds('lava')) blob('lava', 2 * seeds('lava'), 5);
  if (seeds('wall')) wallLine(3 * seeds('wall'), 5);
  rooms(3 + randomInt(3));
  // Depth hazards: bottomless PITS from floor 2, pushable BOULDERS from floor 3, scattered
  // as a few small clusters. (Connectivity is guaranteed afterward — carves clear both.)
  if (floor >= 2) for (let i = 0; i < 3 + Math.floor(floor / 2); i += 1) put(2 + randomInt(WORLD_SIZE - 4), 2 + randomInt(WORLD_SIZE - 4), 'pit');
  if (floor >= 3) for (let i = 0; i < 2 + Math.floor(floor / 3); i += 1) put(2 + randomInt(WORLD_SIZE - 4), 2 + randomInt(WORLD_SIZE - 4), 'boulder');
  return terrain;
}

// Build (or rebuild) a floor. Carries the player's stats forward between floors.
function generateFloor(floor, carryPlayer, score) {
  const player = carryPlayer ? { ...carryPlayer, x: PLAYER_START.x, y: PLAYER_START.y } : createPlayer('warrior');

  const state = {
    worldSize: WORLD_SIZE,
    viewSize: player.vision,
    player,
    terrain: generateTerrain(floor, player),
    explored: {},
    enemies: [],
    spatters: [],
    corpses: [], // fading remains of slain pieces (cosmetic)
    ashes: [], // fading ash piles left by spell kills (cosmetic)
    rubble: [], // fading rock piles left by crushed / blasted boulders (cosmetic)
    scars: [], // permanent marks (shattered summoning circles)
    exit: null,
    key: null, // the floor key; the stair stays locked until it is collected
    allies: [], // the Necromancer's familiar / undead pieces (the player's side)
    floor,
    turn: 0,
    score: score || 0,
    enemyTurn: false,
    gameOver: false,
    won: false,
    pendingLevelUp: false,
    levelPerks: null,
    message: 'A new floor. Find the floor key to unlock the stair down.',
    lastAction: 'start',
    spawnInterval: Math.max(3, 9 - floor),
    turnsSinceSpawn: 0,
  };

  const occupied = new Set([`${player.x},${player.y}`]);
  const standable = (x, y) => isStandable(terrainAt(state, x, y));
  const seen = (x, y) => inLineOfSight(state, x, y);

  function place(predicate) {
    const tile = findFreeTile(occupied, predicate);
    if (tile) occupied.add(tile.key);
    return tile;
  }
  // Spawn a MOBILE enemy that is guaranteed to have a legal move: if the chosen kind
  // is walled in, fall back to a king (moves one step any way); if even that is
  // trapped, don't spawn it at all — never leave a piece frozen in place.
  function addMobileEnemy(type, x, y, surprised) {
    const enemy = createEnemy(type, x, y);
    enemy.surprised = Boolean(surprised);
    state.enemies.push(enemy);
    if (!enemyHasMove(state, enemy)) {
      enemy.kind = 'king';
      if (!enemyHasMove(state, enemy)) {
        state.enemies.pop();
        return null;
      }
    }
    return enemy;
  }

  // Every initial cohort is scaled to 0.75x for a gentler starting population.
  const initCount = (n) => Math.round(n * 0.75);

  // Wandering off-screen enemies, growing with depth.
  const offscreenCount = Math.min(initCount(8 + floor * 4), MAX_ENEMIES);
  for (let i = 0; i < offscreenCount; i += 1) {
    const tile = place((x, y) => standable(x, y) && !seen(x, y) && chebyshev(x, y, player.x, player.y) >= 2);
    if (!tile) break;
    addMobileEnemy(randomEnemyKind(floor), tile.x, tile.y, false);
  }


  // The floor KEY (or the Orb of Victory on the last floor) sits GUARDED in a walled chamber at
  // the floor's fixed anchor: the boss stands ON it, dormant, until it spies the king, ringed by
  // a wall (or lava/water moat) with a doorway facing the king, plus a backup cohort. The EXIT is
  // placed SEPARATELY near the king's start (below) — he spawns beside the way out and must
  // journey to the guarded key and back to leave.
  const level = levelForFloor(floor);
  const anchor = chamberAnchorForFloor(floor);
  const ax = Math.max(2, Math.min(WORLD_SIZE - 3, anchor.x));
  const ay = Math.max(2, Math.min(WORLD_SIZE - 3, anchor.y));
  const portalFloor = isFinalFloor(floor);
  state.isPortalFloor = portalFloor;
  occupied.add(`${ax},${ay}`);
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dy = -1; dy <= 1; dy += 1) delete state.terrain[`${ax + dx},${ay + dy}`];
  }
  const ringType = (level && level.recipe && level.recipe.lava) ? 'lava' : (level && level.recipe && level.recipe.water) ? 'water' : 'wall';
  const doorX = ax + Math.sign(player.x - ax) * 2;
  const doorY = ay + Math.sign(player.y - ay) * 2;
  for (let dx = -2; dx <= 2; dx += 1) {
    for (let dy = -2; dy <= 2; dy += 1) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== 2) continue;
      const rx = ax + dx;
      const ry = ay + dy;
      if (rx < 1 || rx >= WORLD_SIZE - 1 || ry < 1 || ry >= WORLD_SIZE - 1) continue;
      if (chebyshev(rx, ry, doorX, doorY) === 0) continue;
      state.terrain[`${rx},${ry}`] = ringType;
    }
  }
  delete state.terrain[`${doorX},${doorY}`];

  // The KEY / Orb at the chamber's heart — the boss stands on it and guards it. A wanderer
  // scattered earlier may have landed on the anchor before it was reserved; clear it so the
  // guardian (and the key beneath it) sit alone.
  state.key = { x: ax, y: ay, collected: false, discovered: false, orb: portalFloor };
  state.enemies = state.enemies.filter((e) => !(e.x === ax && e.y === ay));
  const boss = createBoss(floor, ax, ay);
  state.enemies.push(boss);
  // A pure jumper (e.g. a knight) only ever lands on the chebyshev-2 ring, so a solid
  // wall ring would pen it in forever. If the boss can't move once roused, flood the
  // ring to water so any piece can wade out.
  if (!enemyHasMove(state, boss)) {
    for (let dx = -2; dx <= 2; dx += 1) {
      for (let dy = -2; dy <= 2; dy += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== 2) continue;
        const key = `${ax + dx},${ay + dy}`;
        if (state.terrain[key] === 'wall') state.terrain[key] = 'water';
      }
    }
  }

  // The EXIT (stair / victory portal) sits NEAR the king's start — he begins beside the way out,
  // and it is DISCOVERED from the off so he always knows where to return. It stays sealed until
  // the guarded key is claimed.
  // Always within a few tiles of the king (never more than chebyshev 6), preferring a spot well
  // clear of the guarded chamber; each fallback only relaxes the constraints, never the cap.
  const nearKing = (x, y, lo, hi) => standable(x, y) && chebyshev(x, y, player.x, player.y) >= lo && chebyshev(x, y, player.x, player.y) <= hi;
  const exitTile = place((x, y) => nearKing(x, y, 2, 4) && chebyshev(x, y, ax, ay) >= 5)
    || place((x, y) => nearKing(x, y, 2, 6) && chebyshev(x, y, ax, ay) >= 4)
    || place((x, y) => nearKing(x, y, 2, 6))
    || place((x, y) => nearKing(x, y, 1, 6));
  const exx = exitTile ? exitTile.x : Math.min(WORLD_SIZE - 2, player.x + 2);
  const exy = exitTile ? exitTile.y : player.y;
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dy = -1; dy <= 1; dy += 1) { const k = `${exx + dx},${exy + dy}`; if (state.terrain[k] === 'wall') delete state.terrain[k]; }
  }
  state.exit = { x: exx, y: exy, discovered: true, portal: portalFloor, locked: Boolean(state.key) };
  state.message = portalFloor
    ? 'The final floor. Seize the Orb of Victory, then reach the portal to escape!'
    : 'A new floor. You start by the stair — find the floor key to unlock it.';

  const nearChamber = (x, y) => isStandable(terrainAt(state, x, y)) && chebyshev(x, y, ax, ay) >= 2 && chebyshev(x, y, ax, ay) <= 6 && chebyshev(x, y, player.x, player.y) >= 3 && !seen(x, y);
  // The chamber leans on STATIONARY hazards near the stair, with only a thin screen of
  // mobile guards. Sleeping backup pieces (few).
  for (let i = 0; i < initCount(2 + Math.floor(floor / 2)); i += 1) {
    const spot = place(nearChamber);
    if (spot) addMobileEnemy(randomEnemyKind(floor), spot.x, spot.y, false);
  }
  // Turrets guarding the chamber (from floor 3) — placed ONLY where they cover real
  // ground (never boxed into hitting no/few tiles).
  if (floor >= 3) {
    for (let i = 0; i < initCount(3 + Math.floor(floor / 2)); i += 1) {
      const kind = randomEnemyKind(floor);
      const spot = place((x, y) => nearChamber(x, y) && turretCoverage(state, kind, x, y) >= 4);
      if (spot) {
        const t = createEnemy(kind, spot.x, spot.y);
        t.turret = true;
        t.hp = TURRET_HP;
        t.maxHp = TURRET_HP;
        state.enemies.push(t);
      }
    }
  }
  // Summoning circles (from floor 2) — placed ONLY where the piece they conjure has
  // room to move. The shown piece type is the ONLY kind each conjures.
  if (floor >= 2) {
    for (let i = 0; i < initCount(3 + Math.floor(floor / 2)); i += 1) {
      const kind = randomEnemyKind(floor);
      const spot = place((x, y) => nearChamber(x, y) && circleCanSpawnMobile(state, kind, x, y));
      if (spot) {
        const c = createEnemy(kind, spot.x, spot.y);
        c.summonCircle = true;
        state.enemies.push(c);
      }
    }
  }

  // Guarantee the king can reach the stair: if walls/lava seal the doorway off, carve
  // to it — then make sure NO walkable pocket anywhere is fully walled off.
  const reachable = playerReachable(state, player.x, player.y);
  if (!reachable.has(`${doorX},${doorY}`)) {
    carveCorridor(state, player.x, player.y, doorX, doorY);
  }
  connectWalledPockets(state, player.x, player.y);

  // Final guard: the chamber ring and corridor-carving happen after the wanderers are
  // scattered, so one may have been sealed in by terrain. Any mobile piece with no
  // move even in isolation is king-swapped, or dropped if it's truly walled solid —
  // never leave a frozen piece on the board.
  state.enemies = state.enemies.filter((e) => {
    if (e.boss || e.turret || e.summonCircle) return true;
    const solo = { ...state, enemies: [e] };
    if (getPieceMoves(e, solo).length > 0) return true;
    e.kind = 'king';
    return getPieceMoves(e, solo).length > 0;
  });

  // The king always lands on a quiet-looking floor — EVERY floor (the first included):
  // guarantee NO enemy sits in his line of sight on arrival, so he explores into danger
  // rather than starting beside it and tutorials never pop in a pile. (The far-off boss
  // on the stair is always out of view.) The corridor carving above can newly expose an
  // otherwise-hidden piece, so this is the final check — a spotted piece slips to the
  // nearest hidden tile, or is dropped if none exists.
  for (const e of state.enemies) {
    if (e.boss) continue;
    if (!seen(e.x, e.y)) continue;
    const canGo = (x, y) =>
      isStandable(terrainAt(state, x, y)) &&
      !seen(x, y) &&
      chebyshev(x, y, player.x, player.y) >= 2 &&
      (e.turret || e.summonCircle || kindCanMove(state, e.kind, x, y));
    const hidden = e.turret
      ? findFreeTile(occupied, (x, y) => canGo(x, y) && turretCoverage(state, e.kind, x, y) >= 4) || findFreeTile(occupied, canGo)
      : findFreeTile(occupied, canGo);
    if (hidden) {
      occupied.delete(`${e.x},${e.y}`);
      e.x = hidden.x;
      e.y = hidden.y;
      occupied.add(hidden.key);
    } else {
      e.hideFailed = true; // nowhere out of sight to hide it — drop it entirely
    }
  }
  state.enemies = state.enemies.filter((e) => !e.hideFailed);

  // Ranger Eagle Eye: the whole floor is mapped from the outset.
  if (player.revealFloor) {
    for (let ry = 0; ry < WORLD_SIZE; ry += 1) {
      for (let rx = 0; rx < WORLD_SIZE; rx += 1) state.explored[`${rx},${ry}`] = true;
    }
    if (state.exit) state.exit.discovered = true;
    if (state.key) state.key.discovered = true;
  }

  // The Necromancer's familiar rejoins him on each fresh floor (undead do not follow down).
  if (player.familiar) spawnFamiliar(state);

  updateDiscovery(state);
  return state;
}

function createInitialState(classKey) {
  return generateFloor(1, createPlayer(classKey || 'warrior'), 0);
}

// Descending the stair: fully heal and refresh cards, then build the next floor. The
// level-up boon is NOT granted here — it is earned earlier, by slaying the floor's
// boss (see defeatBoss). Slipping past a boss and descending thus yields nothing.
function nextFloor(state) {
  const healed = { ...state.player, hp: state.player.maxHp };
  healed.cards = (healed.cards || []).map((c) => ({ ...c, remaining: 0 }));
  healed.extraLifeUsed = false;
  const next = generateFloor(state.floor + 1, healed, state.score);
  next.pendingLevelUp = false;
  next.message = 'You descend the stair to the next floor.';
  return next;
}

/* ---------------------------------- turn ---------------------------------- */

// Spatter a hit tile with blood, PLUS a few satellite droplets flung to adjacent tiles.
// The satellites lean toward `momX,momY` (the way the blow carried — e.g. hit from the
// left, blood sprays right), but not every time, for a natural scatter. Satellites may
// land on walls, where they render as downward smears.
function addSpatter(state, x, y, momX, momY) {
  if (!Array.isArray(state.spatters)) state.spatters = [];
  state.spatters.push({ x, y, life: SPATTER_LIFE, max: SPATTER_LIFE, seed: randomInt(1000) });
  const extras = 1 + randomInt(2); // 1-2 satellite spatters
  const dirs = [...ORTHO, ...DIAG];
  const hasMomentum = Boolean(momX || momY);
  for (let i = 0; i < extras; i += 1) {
    let dir;
    if (hasMomentum && Math.random() < 0.7) {
      // Bias into the hemisphere the blow carried toward (positive dot product).
      const arc = dirs.filter(([dx, dy]) => dx * momX + dy * momY > 0);
      dir = arc.length ? arc[randomInt(arc.length)] : dirs[randomInt(dirs.length)];
    } else {
      dir = dirs[randomInt(dirs.length)];
    }
    const nx = x + dir[0];
    const ny = y + dir[1];
    if (nx < 0 || nx >= WORLD_SIZE || ny < 0 || ny >= WORLD_SIZE) continue;
    state.spatters.push({ x: nx, y: ny, life: SPATTER_LIFE, max: SPATTER_LIFE, seed: randomInt(1000), satellite: true });
  }
}
function decaySpatters(spatters) {
  if (!Array.isArray(spatters)) return [];
  return spatters.map((s) => ({ ...s, life: s.life - 1 })).filter((s) => s.life > 0);
}
// Splash blood ONTO a piece (0..1), so combat leaves it visibly stained. It dries off
// over a few turns (see passTurn). Being struck stains more than landing a blow.
// HP-bearing pieces (the king, bosses, turrets) are EXEMPT — their gore is drawn from
// how wounded they are (missing HP), not a fading stain, so it recedes when they heal.
function bloody(unit, amount) {
  if (!unit || unit.maxHp) return;
  unit.blood = Math.min(1, (unit.blood || 0) + amount);
}
// A random in-tile jitter (offset + slant) so stacked remains form a natural-looking pile
// rather than a single overlaid stamp. Offsets are kept small so a body stays on its tile.
function remainsJitter() {
  return {
    ox: (Math.random() * 2 - 1) * 0.2,
    oy: (Math.random() * 2 - 1) * 0.2,
    rot: (Math.random() * 2 - 1) * 0.6,
  };
}
// A corpse: the slain piece's flattened, darkening remains — purely cosmetic, fades faster
// than blood. (An enemy raised as a Necromancer ally leaves no body.) `life` overrides the
// default lifespan (a boss's remains linger far longer).
function addCorpse(state, x, y, kind, life) {
  if (!Array.isArray(state.corpses)) state.corpses = [];
  const span = life || CORPSE_LIFE;
  // `blood` (0..1) drives the gore spattered on the body when it's drawn.
  state.corpses.push({ x, y, kind, life: span, max: span, blood: 0.5 + Math.random() * 0.4, ...remainsJitter() });
}
// An ash pile: what a foe felled by a SPELL leaves instead of a corpse. It decays at the
// same rate as a corpse and carries no piece identity (all ash looks alike).
function addAsh(state, x, y) {
  if (!Array.isArray(state.ashes)) state.ashes = [];
  state.ashes.push({ x, y, life: CORPSE_LIFE, max: CORPSE_LIFE, ...remainsJitter() });
}
// Rubble: the scattered rocks a crushed / blasted boulder leaves behind (cosmetic, fades).
function addRubble(state, x, y) {
  if (!Array.isArray(state.rubble)) state.rubble = [];
  state.rubble.push({ x, y, life: CORPSE_LIFE, max: CORPSE_LIFE, ...remainsJitter() });
}

// One turn's upkeep: age counters, recharge cards, fade blood, and lapse wards.
function passTurn(state) {
  const p = state.player;
  state.turn += 1;
  p.totalTurns = (p.totalTurns || 0) + 1;
  const calmHaste = Boolean(p.spellHaste) && getVisibleEnemies(state).length === 0;
  for (const card of p.cards || []) {
    // A card fired THIS turn doesn't tick down now (so the bar shows its full cooldown);
    // it starts counting down next turn.
    if (card.remaining > 0 && !card.justFired) {
      const tick = calmHaste && classCategory(p.className) === 'spell' ? 2 : 1;
      card.remaining = Math.max(0, card.remaining - tick);
    }
    card.justFired = false;
  }
  state.spatters = decaySpatters(state.spatters);
  if (Array.isArray(state.corpses)) state.corpses = state.corpses.map((c) => ({ ...c, life: c.life - 1 })).filter((c) => c.life > 0);
  if (Array.isArray(state.ashes)) state.ashes = state.ashes.map((a) => ({ ...a, life: a.life - 1 })).filter((a) => a.life > 0);
  if (Array.isArray(state.rubble)) state.rubble = state.rubble.map((r) => ({ ...r, life: r.life - 1 })).filter((r) => r.life > 0);
  // Blood on pieces dries off over a few turns.
  const dryBlood = (u) => {
    if (u && u.blood) {
      u.blood *= BLOOD_DRY;
      if (u.blood < 0.06) u.blood = 0;
    }
  };
  dryBlood(p);
  for (const e of state.enemies || []) dryBlood(e);
  for (const a of state.allies || []) dryBlood(a);
  // Hex (Sorcerer): each turn, one adjacent foe is warped into a confused (startled) FERZ (a
  // weak 1-step diagonal mover). Ferzes, bosses and structures are immune — but pawns are NOT.
  if (p.hexDemote) {
    for (const [dx, dy] of [...ORTHO, ...DIAG]) {
      const e = state.enemies.find((en) => en.x === p.x + dx && en.y === p.y + dy);
      if (e && !e.boss && !e.turret && !e.summonCircle && e.kind !== 'ferz') {
        e.kind = 'ferz';
        e.awake = false;
        e.surprised = false;
        e.lastSeen = null;
        e.lastSeenTtl = 0;
        // Slumber (T3) + Hex (T1): the new ferz drops straight to sleep, not merely confused.
        if (p.sleepAura) e.asleep = true;
        break;
      }
    }
  }
  if (p.promotion > 0) p.promotion -= 1; // Promotion (horse form) wears off after its turns elapse
  // Lava sears the king for 1 HP each turn he ends on it (Winged Boots / terrainImmune
  // negates it). He CAN cross lava now — it just costs blood.
  if (terrainAt(state, p.x, p.y) === 'lava' && !p.terrainImmune) {
    p.hp -= 1;
    p.wasHit = true;
    addSpatter(state, p.x, p.y);
    if (state.message) state.message += ' The lava sears the king!';
    else state.message = 'The lava sears the king!';
    checkDeath(state);
  }
  p.warded = false;
  p.firstHitUsedThisTurn = false;
  p.freeMoveUsed = false; // Charge grants only ONE free kill-move per turn
  p.blinkedThisTurn = false;
  // NB: p.attacked is NOT cleared here — it must survive into the enemy phase so a foe
  // can tell the Silent king struck this turn (it is reset at the start of each action).
}

function revealSeen(state) {
  if (!state.explored) state.explored = {};
  const p = state.player;
  if (!Array.isArray(p.seenTerrain)) p.seenTerrain = [];
  for (const key of computeVisibleTiles(state)) {
    state.explored[key] = true;
    // Remember which hazard terrains the king has laid eyes on — danger events only unleash
    // a hazard he has already met (see fireDangerEvent), tying them to normal progression.
    const [x, y] = key.split(',').map(Number);
    const t = terrainAt(state, x, y);
    if (t !== 'normal' && t !== 'wall' && !p.seenTerrain.includes(t)) p.seenTerrain.push(t);
  }
}

// Reveal newly-seen ground and remember the exit once explored.
function updateDiscovery(state) {
  revealSeen(state);
  if (state.exit && state.explored[`${state.exit.x},${state.exit.y}`]) state.exit.discovered = true;
  // Once the king lays eyes on the key it is remembered through the fog (like the stair).
  if (state.key && state.explored[`${state.key.x},${state.key.y}`]) state.key.discovered = true;
}

/* ----------------------------- player movement ---------------------------- */

// Every tile the king may move to.
function getPlayerMoves(state) {
  const p = state.player;
  // The king stops on a foe (capture) OR an ally (a swap) — both are valid destinations.
  const enemyAt = (x, y) => state.enemies.find((e) => e.x === x && e.y === y) || allyAt(state, x, y) || null;
  const isEnemy = (x, y) => capturableAt(state, x, y) || Boolean(allyAt(state, x, y));
  const moves = [];
  const seen = new Set();
  const add = (tile) => {
    const key = `${tile.x},${tile.y}`;
    if (seen.has(key)) return;
    seen.add(key);
    moves.push({ x: tile.x, y: tile.y, viaJump: Boolean(tile.viaJump), capture: Boolean(tile.capture), push: Boolean(tile.push) });
  };
  if (p.promotion > 0) {
    // Promotion (Druid): the king becomes an invincible WARHORSE — it leaps like a knight
    // (and can still step a single tile) for a few turns, taking no damage and playing no
    // cards. Click/target any reachable tile.
    const opts = { terrainImmune: Boolean(p.terrainImmune), phaseWalls: Boolean(p.phase), flying: Boolean(p.terrainImmune) };
    for (const t of generateMoves('knight', state, p.x, p.y, enemyAt, isEnemy, opts)) add(t);
    for (const [dx, dy] of [...ORTHO, ...DIAG]) {
      const stops = slideStops(state, p.x, p.y, dx, dy, 1, enemyAt, isEnemy, opts);
      if (stops.length) add(stops[0]); // a single step, so keyboard movement still works
    }
    return moves;
  }
  const opts = { terrainImmune: Boolean(p.terrainImmune), phaseWalls: Boolean(p.phase), flying: Boolean(p.terrainImmune) };
  for (const [dx, dy] of [...ORTHO, ...DIAG]) {
    const stops = slideStops(state, p.x, p.y, dx, dy, p.moveRange, enemyAt, isEnemy, opts);
    // The king must COMMIT to the full slide (his moveRange) — he can only stop short
    // where he collides (a wall, edge, or a foe he captures). So only the furthest
    // reachable tile in each direction is a legal destination, never an inner one.
    if (stops.length) add(stops[stops.length - 1]);
    // Boulder shove: ANY adjacent boulder is a valid "push" action. If its far side is
    // clear it rolls forward (and the king takes its tile); if something blocks it, the
    // king shoves in vain and merely wastes the turn (see resolveBoulderPush).
    const bx = p.x + dx;
    const by = p.y + dy;
    if (terrainAt(state, bx, by) === 'boulder') add({ x: bx, y: by, push: true });
  }
  return moves;
}

/* -------------------------------- boulders -------------------------------- */

// Can the king shove the boulder at (bx,by) one step in (dx,dy)? The tile beyond must be
// on-board, not a wall/boulder, hold no unit, and not be the floor key.
function canPushBoulder(state, bx, by, dx, dy) {
  const tx = bx + dx;
  const ty = by + dy;
  if (tx < 0 || tx >= WORLD_SIZE || ty < 0 || ty >= WORLD_SIZE) return false;
  const t = terrainAt(state, tx, ty);
  if (t === 'wall' || t === 'boulder') return false;
  if (tx === state.player.x && ty === state.player.y) return false;
  if (state.enemies.some((e) => e.x === tx && e.y === ty) || allyAt(state, tx, ty)) return false;
  if (keyTileAt(state, tx, ty)) return false; // never bury the floor key
  return true;
}
// Shove the boulder at (bx,by) one step. Driven into a PIT / LAVA / WATER it FILLS the
// hazard (both tiles become open floor); onto open ground it simply rolls one tile. The
// king follows into the vacated tile.
function pushBoulder(state, bx, by, dx, dy) {
  const tx = bx + dx;
  const ty = by + dy;
  const t = terrainAt(state, tx, ty);
  delete state.terrain[`${bx},${by}`]; // the boulder leaves its tile
  if (t === 'pit' || t === 'lava' || t === 'water') {
    delete state.terrain[`${tx},${ty}`]; // hazard filled, boulder consumed
  } else {
    state.terrain[`${tx},${ty}`] = 'boulder';
  }
  state.player.x = bx;
  state.player.y = by;
}
// Shove a boulder up to `dist` tiles in (dx,dy) — a running charge (Double Step) rolls it two
// tiles where a plain move heaves it one. It travels until a wall / boulder / unit / edge / the
// floor key halts it (coming to rest on the last clear tile), or drops into a pit / lava / water
// and FILLS that hazard (consumed). The king always follows one tile, into the boulder's old
// square. Returns true if the boulder actually moved.
function pushBoulderFar(state, bx, by, dx, dy, dist) {
  let cx = bx;
  let cy = by;
  let moved = false;
  for (let i = 0; i < dist; i += 1) {
    const nx = cx + dx;
    const ny = cy + dy;
    if (nx < 0 || nx >= WORLD_SIZE || ny < 0 || ny >= WORLD_SIZE) break;
    const t = terrainAt(state, nx, ny);
    if (t === 'wall' || t === 'boulder') break;
    if (nx === state.player.x && ny === state.player.y) break;
    if (state.enemies.some((e) => e.x === nx && e.y === ny) || allyAt(state, nx, ny)) break;
    if (keyTileAt(state, nx, ny)) break; // never bury the floor key
    if (t === 'pit' || t === 'lava' || t === 'water') {
      delete state.terrain[`${bx},${by}`];
      delete state.terrain[`${nx},${ny}`]; // hazard filled, boulder consumed
      state.player.x = bx;
      state.player.y = by;
      return true;
    }
    cx = nx;
    cy = ny;
    moved = true;
  }
  if (moved) {
    delete state.terrain[`${bx},${by}`];
    state.terrain[`${cx},${cy}`] = 'boulder';
    state.player.x = bx;
    state.player.y = by;
  }
  return moved;
}
// Smash a boulder to rubble: clear the tile and leave a fading pile of rocks (cosmetic).
function smashBoulder(state, x, y) {
  if (terrainAt(state, x, y) !== 'boulder') return;
  delete state.terrain[`${x},${y}`];
  addRubble(state, x, y);
}
// A leaper that lands on a boulder crushes it (leaving rubble).
function crushBoulderUnder(state, unit) {
  smashBoulder(state, unit.x, unit.y);
}
// Collapse a wall to open floor, leaving a fading pile of rubble (cosmetic) — the same remains a
// crushed boulder leaves. Used wherever a wall is destroyed in play (e.g. a cave-in).
function smashWall(state, x, y) {
  if (terrainAt(state, x, y) !== 'wall') return;
  delete state.terrain[`${x},${y}`];
  addRubble(state, x, y);
}

// Resolve the king arriving on (x, y): attack a boss in place, destroy a summoning
// circle / capture a foe, grab an item, and take the stair.
function applyArrival(next, x, y) {
  const pl = next.player;
  pl.attacked = false; // a fresh action — set true only if the king actually strikes
  // Leapt onto a boulder? He crushes it to rubble as he lands.
  smashBoulder(next, x, y);

  // A boss is ATTACKED IN PLACE (it has HP): the king never steps onto its tile —
  // even the killing blow leaves him where he stands. The boss (which guards the
  // stair) is removed and the level-up boon is granted (see defeatBoss); the king
  // must then walk onto the now-empty stair himself to descend.
  const bossHere = next.enemies.find((e) => e.x === x && e.y === y && e.boss);
  if (bossHere) {
    pl.attacked = true;
    const result = damageBoss(next, bossHere, 1);
    if (result === 'slain') pl.killedEnemy = true;
    if (result === 'slain' && pl.freeKillMove && !pl.freeMoveUsed) {
      pl.freeMoveUsed = true; // Charge: only the FIRST kill-move each turn is free
      next.enemyTurn = false;
      next.lastAction = 'move-free';
    } else {
      passTurn(next);
      next.enemyTurn = true;
      next.lastAction = 'combat';
    }
    updateDiscovery(next);
    return next;
  }

  // A turret is likewise struck IN PLACE (it soaks HP) — the king holds his ground and
  // chips it down; it grants no boon and no free move (a structure, not a "kill").
  const turretHere = next.enemies.find((e) => e.x === x && e.y === y && e.turret);
  if (turretHere) {
    pl.attacked = true;
    damageTurret(next, turretHere, 1);
    passTurn(next);
    next.enemyTurn = true;
    next.lastAction = 'combat';
    updateDiscovery(next);
    return next;
  }

  const fromX = pl.x;
  const fromY = pl.y;

  // Moving onto an ally TRADES places with it (the Necromancer can shuffle his familiar
  // in and out of the front line).
  const allyHere = allyAt(next, x, y);
  if (allyHere) {
    next.player.x = x;
    next.player.y = y;
    allyHere.x = fromX;
    allyHere.y = fromY;
    next.enemyTurn = true;
    next.lastAction = 'move';
    next.message = `The king trades places with the ${allyHere.kind}.`;
    collectKeyIfHere(next);
    if (tryDescend(next)) return next;
    passTurn(next);
    updateDiscovery(next);
    return next;
  }

  next.player.x = x;
  next.player.y = y;
  next.enemyTurn = true;
  next.lastAction = 'move';
  next.message = 'The king moves.';

  const enemy = next.enemies.find((e) => e.x === x && e.y === y);
  let realKill = false;
  if (enemy) {
    realKill = isKillablePiece(enemy); // a circle is destroyed, but not an on-kill trigger
    resolveKill(next, enemy);
    pl.attacked = true;
    next.message = enemy.summonCircle ? 'The king shatters a summoning circle!' : `The king defeats a ${enemy.kind}.`;
    next.lastAction = 'combat';
  }

  // A kill by moving fans out the Warrior's on-kill perks (Cleave/Pierce/Leech/Flourish);
  // Pierce strikes the foe directly behind the corpse, along the king's line of advance.
  if (realKill) applyOnKill(next, x, y, Math.sign(x - fromX), Math.sign(y - fromY));

  collectKeyIfHere(next);
  if (tryDescend(next)) return next;

  if (realKill && pl.freeKillMove && !pl.freeMoveUsed) {
    pl.freeMoveUsed = true; // Charge: only the FIRST kill-move each turn is free
    next.enemyTurn = false;
    next.lastAction = 'move-free';
  } else {
    passTurn(next);
  }
  updateDiscovery(next);
  return next;
}

// Resolve a piece being slain by the king. Bosses take HP damage; everything else
// is removed. Returns true if a unit was actually slain.
function resolveKill(state, enemy, opts) {
  if (enemy.boss) {
    damageBoss(state, enemy, 1);
    return true;
  }
  state.enemies = state.enemies.filter((e) => e.id !== enemy.id);
  const p = state.player;
  p.killedEnemy = true;
  const bySpell = Boolean(opts && opts.ash);
  // Necromancy: a felled real piece rises as an undead ally — but only ONE at a time.
  // When it dies, the next foe the king slays takes its place.
  if (p.necromancy && isKillablePiece(enemy) && !(state.allies || []).some((a) => a.undead)) {
    if (spawnAllyNear(state, enemy.kind, enemy.x, enemy.y, { undead: true })) {
      state.message = `The slain ${enemy.kind} rises to serve you!`;
      return true;
    }
  }
  addSpatter(state, enemy.x, enemy.y, Math.sign(enemy.x - p.x), Math.sign(enemy.y - p.y)); // blood flings away from the king
  // A shattered summoning circle leaves a permanent scar so its ruin stays visible; a foe
  // burnt down by a spell leaves an ash pile; an ordinary slain piece leaves a fading
  // corpse (a raised undead, above, left neither).
  if (enemy.summonCircle) {
    if (!Array.isArray(state.scars)) state.scars = [];
    state.scars.push({ x: enemy.x, y: enemy.y, kind: 'circle' });
  } else if (bySpell) {
    addAsh(state, enemy.x, enemy.y);
  } else {
    addCorpse(state, enemy.x, enemy.y, enemy.kind);
  }
  return true;
}

// Strike a tile WITHOUT moving the king (spell path, ranged shot, cleave). Handles
// bosses (HP) and ordinary foes. Returns the slain enemy (or null if nothing fell).
function attackTile(state, tx, ty, opts) {
  const e = state.enemies.find((en) => en.x === tx && en.y === ty);
  if (e && isCapturable(state, e)) {
    // A summoning circle is a structure you can only break by STEPPING onto it (or being
    // shoved onto it) — a missile weapon or spell passes over it without dispelling it.
    if (e.summonCircle) return null;
    if (e.boss) return damageBoss(state, e, 1) === 'slain' ? e : null;
    if (e.turret) return damageTurret(state, e, 1) === 'slain' ? e : null;
    resolveKill(state, e, opts);
    return e;
  }
  return null;
}

function cleaveAdjacent(state, x, y) {
  for (const [dx, dy] of [...ORTHO, ...DIAG]) {
    if (attackTile(state, x + dx, y + dy)) return;
  }
}

// Flourish (Duellist): after a kill, every foe adjacent to the king is caught off
// guard — its memory of the king is wiped so it burns its next turn gasping in
// surprise instead of striking (bosses/structures are unmoved).
function flourishSurprise(state) {
  const p = state.player;
  for (const [dx, dy] of [...ORTHO, ...DIAG]) {
    const e = state.enemies.find((en) => en.x === p.x + dx && en.y === p.y + dy);
    if (e && !e.boss && !e.turret && !e.summonCircle) {
      e.awake = false;
      e.surprised = false;
      e.lastSeen = null;
      e.lastSeenTtl = 0;
    }
  }
}

// Fan out the Warrior's on-kill perks after he fells a foe by moving or with a melee
// card. `ox,oy` is the origin the effects radiate from (the king's tile / the slain
// foe's tile); `dx,dy` is the strike direction (0,0 to skip Pierce). Fires once per
// action, so a single turn heals/flourishes/cleaves at most once.
function applyOnKill(state, ox, oy, dx, dy) {
  const p = state.player;
  if (state.gameOver || state.won) return;
  const before = state.enemies.length; // the main foe is already gone; count further kills
  if (p.meleeCleave) cleaveAdjacent(state, ox, oy);
  if (p.meleePierce && (dx || dy)) attackTile(state, ox + dx, oy + dy);
  const totalKills = 1 + (before - state.enemies.length); // the main kill + Cleave/Pierce kills
  // Vampiric Edge: heal ONLY when the strike fells at least two foes at once (its natural
  // partner is Cleave, which supplies the second kill).
  if (p.meleeLeech && totalKills >= 2) p.hp = Math.min(p.maxHp, p.hp + 1);
  if (p.meleeFlourish) flourishSurprise(state);
}

// If the king now stands on the stair (and the run isn't already won/over), flag the
// descent so the controller drops to the next floor. Returns true when it fires.
function tryDescend(next) {
  if (next.won || next.gameOver) return false;
  if (next.exit && next.player.x === next.exit.x && next.player.y === next.exit.y) {
    if (next.exit.locked) {
      // The king reached the exit but it is sealed until he holds the key / Orb.
      next.message = next.exit.portal
        ? 'The portal lies dormant — seize the Orb of Victory first.'
        : 'The stair is sealed — find the floor key first.';
      return false;
    }
    if (next.exit.portal) {
      // The FINALE: stepping into the open portal, Orb in hand, wins the run outright. Flag it
      // as 'win' (not 'exit') so no caller tries to generate a floor 9 — there is none.
      next.won = true;
      next.lastAction = 'win';
      next.message = 'You step into the portal, Orb of Victory in hand — the realm is saved!';
      return true;
    }
    next.lastAction = 'exit';
    next.message = 'You step onto the stair and descend...';
    return true;
  }
  return false;
}

// Blink (Sorcerer Translocations): when a foe lands a hit, teleport the king to a random
// tile in sight that is standable, empty, off the stair, and NOT threatened by any visible
// enemy. No-op when no such refuge exists. Returns true if he blinked.
function blinkToSafety(state) {
  const p = state.player;
  if (!p.blink || p.blinkedThisTurn || state.gameOver) return false;
  // Danger must be judged as if the king already stood on the candidate — so a slider's
  // FULL line counts (his own body must not "block" a threat behind himself). Compute each
  // visible enemy's reach from a ghost state whose king sits off-board.
  const ghost = { ...state, player: { ...p, x: -50, y: -50 } };
  const danger = new Set();
  for (const e of getVisibleEnemies(state)) {
    for (const t of getPieceThreats(e, ghost, true)) danger.add(`${t.x},${t.y}`);
  }
  const bounds = getVisibleBounds(state);
  const options = [];
  for (let yy = bounds.y; yy < bounds.y + bounds.height; yy += 1) {
    for (let xx = bounds.x; xx < bounds.x + bounds.width; xx += 1) {
      if (xx === p.x && yy === p.y) continue;
      if (!inLineOfSight(state, xx, yy)) continue;
      if (!standableFor(terrainAt(state, xx, yy), {})) continue; // solid ground only
      if (state.enemies.some((e) => e.x === xx && e.y === yy)) continue;
      if (state.exit && xx === state.exit.x && yy === state.exit.y) continue;
      if (danger.has(`${xx},${yy}`)) continue; // must be a SAFE tile
      options.push({ x: xx, y: yy });
    }
  }
  if (!options.length) return false;
  const pick = options[randomInt(options.length)];
  p.x = pick.x;
  p.y = pick.y;
  p.blinkedThisTurn = true;
  collectKeyIfHere(state);
  state.message = 'The king blinks away to safety!';
  return true;
}

// Collect the floor key when the king stands on it: the stair unlocks for good.
function collectKeyIfHere(next) {
  const k = next.key;
  const p = next.player;
  if (k && !k.collected && p.x === k.x && p.y === k.y) {
    k.collected = true;
    k.discovered = true;
    if (next.exit) next.exit.locked = false;
    if (k.orb) {
      // The finale begins: the portal wakes and the realm's guardians start converging (see
      // maybeSpawnEnemy / spawnBossRush). From here it's a fighting retreat to the portal.
      next.orbTaken = true;
      next.bossRushTimer = 0;
      next.message = 'You seize the Orb of Victory — the portal roars open, and guardians converge!';
    } else {
      next.message = 'You seize the floor key — the stair unlocks!';
    }
    return true;
  }
  return false;
}

// The tiles strictly between two points along a straight (8-direction) line.
function straightPath(x0, y0, x1, y1) {
  const dx = Math.sign(x1 - x0);
  const dy = Math.sign(y1 - y0);
  const adx = Math.abs(x1 - x0);
  const ady = Math.abs(y1 - y0);
  if (!(adx === ady || adx === 0 || ady === 0) || (adx === 0 && ady === 0)) return [];
  const tiles = [];
  let x = x0 + dx;
  let y = y0 + dy;
  while (x !== x1 || y !== y1) {
    tiles.push({ x, y });
    x += dx;
    y += dy;
  }
  return tiles;
}

function canStandEmpty(state, x, y) {
  if (x < 0 || x >= WORLD_SIZE || y < 0 || y >= WORLD_SIZE) return false;
  if (!standableFor(terrainAt(state, x, y), {})) return false;
  if (state.enemies.some((e) => e.x === x && e.y === y)) return false;
  return true;
}

// Play a weapon card at (x, y): melee moves onto the target; ranged/spell hold the
// king's tile (spell pierces the whole path). Class perks add the effects.
function useCard(state, cardIndex, x, y) {
  const next = structuredClone(state);
  const p = next.player;
  p.attacked = false; // reset per action; a weapon card sets it true (breaking stealth)
  const card = p.cards[cardIndex];
  if (!card) {
    next.message = 'No such card.';
    next.lastAction = 'blocked';
    return next;
  }
  if (card.remaining > 0) {
    next.message = 'That card is still recharging.';
    next.lastAction = 'blocked';
    return next;
  }
  // While promoted the king wields no cards — he roams as the warhorse.
  if (p.promotion > 0) {
    next.message = 'The warhorse needs no cards — strike by leaping.';
    next.lastAction = 'blocked';
    return next;
  }
  const isAbilityCard = card.kind === 'promotion' || card.kind === 'reload' || card.kind === 'swap';
  // Water forbids readying a WEAPON (Amphibious lifts that); ability cards are exempt.
  if (isSlowTerrain(terrainAt(next, p.x, p.y)) && !p.terrainImmune && !isAbilityCard) {
    next.message = `You can't ready a weapon while wading through ${terrainAt(next, p.x, p.y)}.`;
    next.lastAction = 'blocked';
    return next;
  }
  const move = getCardMoves(next, card).find((m) => m.x === x && m.y === y);
  if (!move) {
    next.message = 'That card cannot reach that tile.';
    next.lastAction = 'blocked';
    return next;
  }

  // Promotion: a FREE action (no turn spent) that turns the king into an invincible
  // warhorse for a few turns — he leaps like a knight, takes no damage, and can play no
  // cards until it wears off. Its long cooldown is what balances the invulnerability.
  if (card.kind === 'promotion') {
    p.promotion = PROMOTION_TURNS;
    card.remaining = card.cooldown;
    next.message = 'The Ranger mounts up — an invincible warhorse storms the board!';
    next.enemyTurn = false;
    next.lastAction = 'card-free';
    updateDiscovery(next);
    return next;
  }
  // Reload: spend the turn to recharge every OTHER card at once.
  if (card.kind === 'reload') {
    for (const c of p.cards) if (c !== card) c.remaining = 0;
    card.remaining = card.cooldown;
    card.justFired = true;
    next.message = 'You reload — every other card is ready.';
    passTurn(next);
    next.enemyTurn = true;
    next.lastAction = 'combat';
    updateDiscovery(next);
    return next;
  }
  // Displacement: trade tiles with the targeted unit (no damage), then spend the turn.
  if (card.kind === 'swap') {
    const unit = next.enemies.find((e) => e.x === x && e.y === y);
    if (!unit) {
      next.message = 'Nothing to swap with there.';
      next.lastAction = 'blocked';
      return next;
    }
    const kx = p.x;
    const ky = p.y;
    p.x = x;
    p.y = y;
    unit.x = kx;
    unit.y = ky;
    card.remaining = card.cooldown;
    card.justFired = true;
    next.message = `The king swaps places with a ${unit.kind}.`;
    // The violent arrival shoves every OTHER foe (and loose boulder) now adjacent to the
    // king back a tile (colliding with whatever's behind it); the just-swapped unit is spared.
    if (!next.gameOver && !next.won) shoveAdjacentAway(next, p.x, p.y, unit.id);
    collectKeyIfHere(next);
    passTurn(next);
    next.enemyTurn = true;
    next.lastAction = 'combat';
    updateDiscovery(next);
    return next;
  }

  // Double Step charge into a boulder: the running shove rolls it TWO tiles (a plain move
  // heaves it just one), the king following into the boulder's old square.
  if (move.push) {
    const dx = Math.sign(x - p.x);
    const dy = Math.sign(y - p.y);
    const rolled = pushBoulderFar(next, x, y, dx, dy, 2);
    next.message = rolled ? 'The king charges — the boulder rolls two tiles!' : 'The king charges the boulder — but it will not budge.';
    card.remaining = card.cooldown;
    card.justFired = true;
    p.attacked = false; // heaving a boulder is not an attack
    collectKeyIfHere(next);
    if (tryDescend(next)) { updateDiscovery(next); return next; }
    passTurn(next);
    next.enemyTurn = true;
    next.lastAction = 'move';
    updateDiscovery(next);
    return next;
  }

  const category = classCategory(p.className);
  const fromX = p.x;
  const fromY = p.y;
  const mainTarget = next.enemies.find((e) => e.x === x && e.y === y);
  let scored = false; // struck the main target (for the flavour message)
  let realKill = false; // felled a real enemy piece (gates the on-kill perks)
  const kills = []; // real pieces felled this cast (for Dazzle)
  const impactTiles = []; // every tile a spell's fireball detonates on (for the view)
  p.attacked = true;

  if (category === 'melee') {
    let survived = false;
    const isLeap = Boolean(move.viaJump) && isJumperKind(card.kind);
    // A leap card that lands on a boulder crushes it to rubble (the king ends up there).
    if (isLeap) smashBoulder(next, x, y);
    if (mainTarget && (mainTarget.boss || mainTarget.turret)) {
      // A boss or turret is struck IN PLACE — it soaks HP and the king never steps onto
      // its tile (so the melee card just chips it down from where he stands).
      const res = mainTarget.boss ? damageBoss(next, mainTarget, 1) : damageTurret(next, mainTarget, 1);
      survived = res !== 'slain';
      scored = !survived;
      realKill = scored && isKillablePiece(mainTarget); // a felled turret is not an on-kill
    } else if (mainTarget) {
      resolveKill(next, mainTarget);
      p.x = x;
      p.y = y;
      scored = true;
      realKill = isKillablePiece(mainTarget); // shattering a circle is not an on-kill
    } else {
      // No foe on the tile: a melee card can also be spent as a repositioning move
      // onto empty ground within reach.
      p.x = x;
      p.y = y;
      next.message = 'The king repositions.';
    }
    // En Passant: after the step, strike one foe "in passing" (a piece that flanked the
    // ORIGIN square). `move.flanks[0]` is that target.
    if (card.kind === 'enpassant' && !next.gameOver && !next.won) {
      const passing = (move.flanks || [])[0];
      if (passing) {
        const felled = attackTile(next, passing.x, passing.y);
        if (felled) {
          scored = true;
          if (isKillablePiece(felled)) realKill = true;
        }
      }
      next.message = scored ? 'En passant — the king strikes as he slips by!' : 'The king slips past.';
    }
    // Trample (leapShock): once the king actually LANDS a knight leap, its shockwave
    // HURLS every adjacent foe back a tile (slamming it into whatever's behind it), rather
    // than striking it in place. Fixed structures don't budge.
    if (isLeap && p.leapShock && p.x === x && p.y === y && !next.gameOver && !next.won) {
      shoveAdjacentAway(next, x, y, null);
    }
    // On-kill perks fan out once (Cleave/Pierce/Leech/Flourish); Pierce strikes along
    // the king's line of advance.
    if (realKill && !next.gameOver && !next.won) {
      applyOnKill(next, x, y, Math.sign(x - fromX), Math.sign(y - fromY));
    }
  } else if (card.kind === 'horse') {
    // The Conjuration horse: a spectral steed charges the L-shaped path toward the aimed
    // knight tile — WITHOUT moving the king — scorching every foe along the L (leaving ash).
    for (const t of knightLPath(fromX, fromY, x - fromX, y - fromY)) {
      if (t.x < 0 || t.x >= WORLD_SIZE || t.y < 0 || t.y >= WORLD_SIZE) continue;
      impactTiles.push({ x: t.x, y: t.y });
      dispelAllyAt(next, t.x, t.y);
      const felled = attackTile(next, t.x, t.y, { ash: true });
      if (felled) {
        if (t.x === x && t.y === y) scored = true;
        if (isKillablePiece(felled)) kills.push(felled);
      }
    }
    realKill = kills.length > 0;
    next.message = scored ? 'A spectral steed tramples through the ranks!' : 'The spectral steed charges past.';
  } else if (category === 'spell' && !move.viaJump) {
    // A sorcerer's bolt ALWAYS travels its FULL range in the aimed direction — every
    // tile out to `reach` is scorched, even past the nearest target (stopped only by a
    // wall or the board edge). The aimed tile just picks the direction.
    const reach = cardReach(card.kind, p.cardReach || 0);
    const dx = Math.sign(x - fromX);
    const dy = Math.sign(y - fromY);
    let cx = fromX;
    let cy = fromY;
    for (let i = 0; i < reach; i += 1) {
      cx += dx;
      cy += dy;
      if (cx < 0 || cx >= WORLD_SIZE || cy < 0 || cy >= WORLD_SIZE) break;
      const bt = terrainAt(next, cx, cy);
      if ((bt === 'wall' || bt === 'boulder') && !p.seeThroughWalls) {
        if (bt === 'boulder') { smashBoulder(next, cx, cy); impactTiles.push({ x: cx, y: cy }); scored = true; } // the bolt blasts it to rubble
        break;
      }
      impactTiles.push({ x: cx, y: cy }); // every tile the fireball scorches
      dispelAllyAt(next, cx, cy); // a piercing bolt dispels an ally in its path
      const felled = attackTile(next, cx, cy, { ash: true }); // spell kills leave ash
      if (felled) {
        if (cx === x && cy === y) scored = true; // struck the aimed tile (flavour)
        if (isKillablePiece(felled)) kills.push(felled);
      }
    }
    realKill = kills.length > 0;
    if (!next.gameOver && !next.won && p.spellDazzle) {
      for (const s of kills) {
        for (const [dx2, dy2] of [...ORTHO, ...DIAG]) {
          const e = next.enemies.find((en) => en.x === s.x + dx2 && en.y === s.y + dy2);
          if (e && !e.boss && unitInSight(next, e.x, e.y)) e.awake = false;
        }
      }
    }
  } else {
    // Ranged (or a spell fired via a leap): a single shot that strikes only the target.
    dispelAllyAt(next, x, y);
    const mainFelled = attackTile(next, x, y);
    if (mainFelled) {
      scored = true;
      if (isKillablePiece(mainFelled)) kills.push(mainFelled);
    }
    realKill = kills.length > 0;
  }

  // Record the shot so the view can fly a projectile (arrow / bolt) from the king to the
  // target before the hit resolves. Only ranged/spell weapon cards fire one.
  if (category !== 'melee') {
    next.lastShot = {
      fromX, fromY, toX: x, toY: y,
      role: category === 'ranged' ? 'arrow' : 'fireball',
      tiles: category === 'spell' && impactTiles.length ? impactTiles : null,
    };
  }

  if (category === 'spell' && p.spellSurprise && !next.gameOver && !next.won) {
    for (const e of next.enemies) {
      if (!e.boss && unitInSight(next, e.x, e.y)) e.awake = false;
    }
  }

  // Recoil (Fletcher): a ranged/spell shot kicks the archer one tile back, away from the
  // target — landing on (and capturing) a foe there if one blocks the step.
  if (p.recoil && category !== 'melee' && !next.gameOver && !next.won) {
    const rdx = Math.sign(p.x - x);
    const rdy = Math.sign(p.y - y);
    if (rdx || rdy) {
      const bx = p.x + rdx;
      const by = p.y + rdy;
      if (bx >= 0 && bx < WORLD_SIZE && by >= 0 && by < WORLD_SIZE && standableFor(terrainAt(next, bx, by), {})) {
        const foe = next.enemies.find((e) => e.x === bx && e.y === by);
        if (!foe) {
          p.x = bx;
          p.y = by;
        } else if (isCapturable(next, foe)) {
          if (attackTile(next, bx, by)) {
            p.x = bx;
            p.y = by;
          }
        }
        // A wall/lava/edge or an untouchable turret behind him simply halts the recoil.
      }
    }
    // Shockwave: shove every MOBILE foe (and loose boulder) now adjacent to the king back one
    // tile (away from him), colliding with whatever's behind it. Fixed structures don't budge.
    shoveAdjacentAway(next, p.x, p.y, null);
  }

  // A melee reposition / En-Passant dash / Recoil can carry the king onto the key.
  collectKeyIfHere(next);
  // A melee card that fells the guardian leaves the king on the stair: descend.
  if (tryDescend(next)) {
    updateDiscovery(next);
    return next;
  }

  // Quick Draw (rangedRapid): a real-piece kill grants ONE immediate free follow-up.
  const rapidFollowup = Boolean(card.rapidReady);
  card.rapidReady = false;
  const rapidTrigger = category === 'ranged' && p.rangedRapid && realKill && !rapidFollowup;
  if (rapidTrigger) card.rapidReady = true;

  // Double Cast (Conjuration T3): after the FIRST spell shot, if a targetable foe still
  // stands, the caster stays up to fire ONCE more before the turn passes. The follow-up
  // shot — or cancelling it (see main.js) — ends the turn. The card only goes on cooldown
  // once the sequence completes, so it isn't double-charged.
  const doubleFollowup = Boolean(card.doubleReady);
  card.doubleReady = false;
  const canDoubleCast = category === 'spell' && p.doubleCast && !doubleFollowup
    && !next.gameOver && !next.won && getCardMoves(next, card).length > 0;
  if (canDoubleCast) card.doubleReady = true;

  const free = (category === 'spell' && p.freeSpell) || rapidTrigger || canDoubleCast;
  if (!rapidTrigger && !canDoubleCast) {
    card.remaining = card.cooldown;
    // The turn this card fires does NOT tick its cooldown, so the bar shows the FULL
    // cooldown right after use (then counts down each following turn). Free casts skip
    // passTurn entirely, so they need no flag.
    if (!free) card.justFired = true;
  }
  // Keen Edge (meleeRefund): a card that scored a kill recharges one turn faster.
  if (category === 'melee' && realKill && p.meleeRefund) card.remaining = Math.max(0, card.remaining - 1);
  if (!scored && !next.message) next.message = 'The card strikes.';
  if (free) {
    next.enemyTurn = false;
    // A pending double-cast keeps the caster up to aim a second shot (main.js re-opens
    // targeting); other free casts just yield a bonus action.
    next.lastAction = canDoubleCast ? 'card-followup' : 'card-free';
    if (canDoubleCast) next.message = 'The bolt flies — aim again, or cancel to end your turn.';
  } else {
    passTurn(next);
    next.enemyTurn = true;
    next.lastAction = 'combat';
  }
  updateDiscovery(next);
  return next;
}

// End a turn that a Double Cast left hanging: the caster loosed one bolt and then either
// fired his bonus shot or declined it. Put the (single-fired) card on cooldown and pass
// the turn so the enemy phase runs. Used by the UI when the follow-up is cancelled or
// no target remains.
function finishFollowup(state) {
  const next = structuredClone(state);
  for (const c of next.player.cards || []) {
    if (c.doubleReady) {
      c.doubleReady = false;
      c.remaining = c.cooldown; // the one shot still spent the card
      c.justFired = true; // show its full cooldown after passTurn ticks
    }
  }
  passTurn(next);
  next.enemyTurn = true;
  next.lastAction = 'wait';
  return next;
}

// Move the king to a specific reachable tile (click-to-move).
function movePlayerTo(state, x, y) {
  const next = structuredClone(state);
  const move = getPlayerMoves(next).find((m) => m.x === x && m.y === y);
  if (!move) {
    next.message = 'The king cannot reach that tile.';
    next.lastAction = 'blocked';
    return next;
  }
  if (move.push) return resolveBoulderPush(next, x, y); // shove the boulder standing there
  return applyArrival(next, x, y);
}

// Resolve the king heaving a boulder (the shove spends the turn like a move — even a
// FUTILE shove against a blocked boulder wastes the turn).
function resolveBoulderPush(next, x, y) {
  const p = next.player;
  const dx = Math.sign(x - p.x);
  const dy = Math.sign(y - p.y);
  p.attacked = false;
  if (canPushBoulder(next, x, y, dx, dy)) {
    pushBoulder(next, x, y, dx, dy);
    next.message = 'The king heaves a boulder aside.';
  } else {
    next.message = 'The king shoves the boulder — but it will not budge.';
  }
  next.lastAction = 'move';
  collectKeyIfHere(next);
  if (tryDescend(next)) {
    updateDiscovery(next);
    return next;
  }
  passTurn(next);
  next.enemyTurn = true;
  updateDiscovery(next);
  return next;
}

// Keyboard movement: a single ground step in a direction.
function movePlayer(state, dx, dy) {
  // Stepping into a boulder shoves it (if its far side is clear) — route to the pusher.
  if (terrainAt(state, state.player.x + dx, state.player.y + dy) === 'boulder') {
    return movePlayerTo(state, state.player.x + dx, state.player.y + dy);
  }
  const enemyAt = (x, y) => state.enemies.find((e) => e.x === x && e.y === y) || allyAt(state, x, y) || null;
  const isEnemy = (x, y) => capturableAt(state, x, y) || Boolean(allyAt(state, x, y));
  // Slide the king's FULL move range (normally 1), stopping only on collision —
  // the furthest reachable stop is the destination.
  const stops = slideStops(state, state.player.x, state.player.y, dx, dy, state.player.moveRange, enemyAt, isEnemy, { terrainImmune: Boolean(state.player.terrainImmune), phaseWalls: Boolean(state.player.phase), flying: Boolean(state.player.terrainImmune) });
  if (!stops.length) {
    const next = structuredClone(state);
    next.message = 'The king cannot move that way.';
    next.lastAction = 'blocked';
    return next;
  }
  const dest = stops[stops.length - 1];
  return movePlayerTo(state, dest.x, dest.y);
}

/* --------------------------------- allies --------------------------------- */

// Place an ally on (x,y) or, failing that, an adjacent free tile — never the king, an
// enemy, another ally, or the floor key. Returns the placed ally, or null if hemmed in.
function spawnAllyNear(state, kind, x, y, props) {
  if (!Array.isArray(state.allies)) state.allies = [];
  const spots = [{ x, y }];
  for (const [dx, dy] of [...ORTHO, ...DIAG]) spots.push({ x: x + dx, y: y + dy });
  for (const s of spots) {
    if (s.x < 0 || s.x >= WORLD_SIZE || s.y < 0 || s.y >= WORLD_SIZE) continue;
    if (!isStandable(terrainAt(state, s.x, s.y))) continue;
    if (s.x === state.player.x && s.y === state.player.y) continue;
    if (state.enemies.some((e) => e.x === s.x && e.y === s.y)) continue;
    if (allyAt(state, s.x, s.y)) continue;
    if (keyTileAt(state, s.x, s.y)) continue;
    const ally = { id: `ally-${Math.random().toString(36).slice(2)}`, kind, x: s.x, y: s.y, ...(props || {}) };
    state.allies.push(ally);
    return ally;
  }
  return null;
}

// Summon (or resummon) the familiar beside the king — a berolina pawn, or a General once
// upgraded. No-op if one already lives.
function spawnFamiliar(state) {
  if (!state.player.familiar || hasLivingFamiliar(state)) return null;
  const kind = state.player.generalForm ? 'general' : 'berolina';
  return spawnAllyNear(state, kind, state.player.x, state.player.y, { familiar: true });
}

// The familiar returns once the coast is clear (no foe in sight).
function maybeRespawnFamiliar(state) {
  if (state.player.familiar && !hasLivingFamiliar(state) && getVisibleEnemies(state).length === 0) {
    spawnFamiliar(state);
  }
}

// The move (from `moves`) that steps CLOSEST to (tx,ty), skipping `blocked` tiles — or
// null if none beats standing still.
function allyStepToward(moves, ax, ay, tx, ty, blocked) {
  let best = null;
  let bestD = distanceSq(ax, ay, tx, ty);
  for (const m of moves) {
    if (blocked(m.x, m.y)) continue;
    const d = distanceSq(m.x, m.y, tx, ty);
    if (d < bestD) { bestD = d; best = m; }
  }
  return best;
}

// One ally's turn: strike a foe it can reach, else advance on the nearest visible foe,
// else heel to the king. Allies see what the king sees.
function moveAlly(state, ally) {
  const king = state.player;
  const enemyHere = (x, y) => state.enemies.find((e) => e.x === x && e.y === y) || null;
  const unitAt = (x, y) => {
    if (x === king.x && y === king.y) return 'king';
    if (keyTileAt(state, x, y)) return 'key';
    const other = allyAt(state, x, y);
    if (other && other.id !== ally.id) return other;
    return enemyHere(x, y);
  };
  const isTarget = (x, y) => {
    const e = enemyHere(x, y);
    return Boolean(e) && isCapturable(state, e);
  };
  // The king's summons are NOT lava-immune, so they keep off it (lavaOk: false).
  const moves = generateMoves(ally.kind, state, ally.x, ally.y, unitAt, isTarget, { lavaOk: false });
  const cap = moves.find((m) => isTarget(m.x, m.y));
  if (cap) {
    const foe = enemyHere(cap.x, cap.y);
    if (foe) {
      state.enemies = state.enemies.filter((e) => e.id !== foe.id);
      addSpatter(state, foe.x, foe.y, Math.sign(foe.x - ally.x), Math.sign(foe.y - ally.y));
      addCorpse(state, foe.x, foe.y, foe.kind);
      bloody(ally, BLOOD_STRIKE); // the ally is spattered by its kill
      ally.x = cap.x;
      ally.y = cap.y;
    }
    return;
  }
  const foes = getVisibleEnemies(state);
  const blocked = (x, y) => isTarget(x, y);
  if (foes.length) {
    let target = foes[0];
    for (const f of foes) if (distanceSq(f.x, f.y, ally.x, ally.y) < distanceSq(target.x, target.y, ally.x, ally.y)) target = f;
    const step = allyStepToward(moves, ally.x, ally.y, target.x, target.y, blocked);
    if (step) { ally.x = step.x; ally.y = step.y; }
    return;
  }
  if (chebyshev(ally.x, ally.y, king.x, king.y) > 1) {
    const step = allyStepToward(moves, ally.x, ally.y, king.x, king.y, blocked);
    if (step) { ally.x = step.x; ally.y = step.y; }
  }
}

// The allies' turn: respawn a lost familiar, then move each ally once.
function advanceAllies(state) {
  maybeRespawnFamiliar(state);
  for (const ally of (state.allies || []).slice()) {
    if ((state.allies || []).includes(ally)) moveAlly(state, ally);
  }
}

// The ally phase as a fresh state (the controller runs it AFTER the foes have moved).
function runAllyPhase(state) {
  const next = structuredClone(state);
  advanceAllies(next);
  return next;
}

// A player AOE that crosses an ally's tile dispels it.
function dispelAllyAt(state, x, y) {
  if (state.allies) state.allies = state.allies.filter((a) => !(a.x === x && a.y === y));
}

/* ------------------------------ enemy phase ------------------------------- */

// An unaware enemy shuffles one tile at random. Normally it steers clear of the king's
// sight (so it only pokes into view when the KING moves, and is reliably surprised). When
// `hidden` (the king is Silent/stealthed and this enemy can't perceive him at all), it
// roams freely and may BLUNDER onto his tile — bumping (striking) him and waking at last.
function wanderEnemy(state, enemy, hidden) {
  const king = state.player;
  const unitAt = (x, y) => {
    if (x === king.x && y === king.y) return hidden ? null : 'player'; // a hidden king isn't sensed
    if (keyTileAt(state, x, y)) return 'key'; // enemies never path onto the floor key
    if (allyAt(state, x, y)) return 'ally';
    return state.enemies.find((other) => other.id !== enemy.id && other.x === x && other.y === y) || null;
  };
  const never = () => false;
  const demon = (state.floor || 1) >= DEMON_FLOOR;
  const opts = { lavaOk: demon };
  const candidates = [];
  for (const [dx, dy] of [...ORTHO, ...DIAG]) {
    const stops = slideStops(state, enemy.x, enemy.y, dx, dy, 1, unitAt, never, opts);
    if (!stops.length) continue;
    const dest = stops[stops.length - 1];
    // An unaware foe steers clear of tiles from which the KING would spot it — but by its
    // OWN (wall-blocked) sight line, so Sixth Sense doesn't make it cower behind walls.
    if (hidden || !enemyAwareOfKing(state, dest.x, dest.y)) candidates.push(dest);
  }
  if (!candidates.length) return null;
  const pick = candidates[randomInt(candidates.length)];
  if (hidden && pick.x === king.x && pick.y === king.y) {
    // It walks straight into the hidden king — an accidental blow that gives him away.
    strikeKing(state, enemy);
    enemy.awake = true;
    enemy.lastSeen = { x: king.x, y: king.y };
    enemy.lastSeenTtl = PURSUIT_TTL;
    return true; // it BUMPED the king
  }
  enemy.x = pick.x;
  enemy.y = pick.y;
  return false;
}

// The tiles this enemy could move to like its piece, WITHOUT capturing — for
// pursuing the king's last-seen tile.
function movesTowardTile(state, enemy) {
  const unitAt = (x, y) => {
    if (x === state.player.x && y === state.player.y) return 'player';
    if (keyTileAt(state, x, y)) return 'key'; // pursuers never path onto the floor key
    return state.enemies.find((o) => o.id !== enemy.id && o.x === x && o.y === y) || null;
  };
  const never = () => false;
  const demon = (state.floor || 1) >= DEMON_FLOOR;
  const opts = { lavaOk: demon };
  return generateMoves(enemy.kind, state, enemy.x, enemy.y, unitAt, never, opts);
}

// An out-of-sight enemy hunts toward the king's last-seen tile. Returns true if it
// pursued; false if it gave up (then it wanders).
function pursueLastSeen(state, enemy) {
  const target = enemy.lastSeen;
  if (!target) return false;
  const forget = () => {
    enemy.lastSeen = null;
    enemy.lastSeenTtl = 0;
  };
  if (enemy.x === target.x && enemy.y === target.y) {
    forget();
    return false;
  }
  const curD = distanceSq(enemy.x, enemy.y, target.x, target.y);
  let best = null;
  let bestD = Infinity;
  for (const m of movesTowardTile(state, enemy)) {
    const d = distanceSq(m.x, m.y, target.x, target.y);
    if (d < bestD) {
      bestD = d;
      best = m;
    }
  }
  if (!best || bestD > curD) {
    forget();
    return false;
  }
  enemy.x = best.x;
  enemy.y = best.y;
  enemy.lastSeenTtl -= 1;
  if ((enemy.x === target.x && enemy.y === target.y) || enemy.lastSeenTtl <= 0) forget();
  return true;
}

// A stationary object (turret / summoning circle) never wanders.
function isStationary(enemy) {
  // A dormant guardian holds the stair like a turret does — it only stirs (in
  // bossMove) once the king strikes it or steps adjacent.
  return enemy.turret || enemy.summonCircle || (enemy.boss && enemy.dormant);
}

// Resolve sight at the start of an enemy turn, per piece, and collect the pieces
// that get to act (movers).
// Non-demonic enemies and allies SEAR in lava — one hit at the start of each enemy phase, so a
// foe knocked into a lava field burns down turn by turn (the king can now weaponise lava with
// knockback). Demon-kind pieces are immune; the king's own lava is handled in passTurn; a boss
// takes its lava wound in bossMove. Ordinary pieces carry no HP pool, so one hit removes them
// (burned to ash). Called once per turn from beginEnemyPhase.
function tickLavaDamage(state) {
  const burns = (u) => terrainAt(state, u.x, u.y) === 'lava' && !isDemonKind(u.kind);
  const doomedFoes = state.enemies.filter((e) => !e.boss && !e.turret && !e.summonCircle && burns(e));
  for (const e of doomedFoes) addAsh(state, e.x, e.y);
  if (doomedFoes.length) state.enemies = state.enemies.filter((e) => !doomedFoes.includes(e));
  const doomedAllies = (state.allies || []).filter((a) => burns(a));
  for (const a of doomedAllies) addAsh(state, a.x, a.y);
  if (doomedAllies.length) state.allies = state.allies.filter((a) => !doomedAllies.includes(a));
}

function beginEnemyPhase(state) {
  const next = structuredClone(state);
  let moverIds = [];
  const p = next.player;
  const stealthed = Boolean(p.stealth) && !p.attacked;
  recordSeenEnemies(next);
  tickLavaDamage(next); // lava burns any non-demonic foe/ally standing in it this turn

  // Slumber (Sorcerer): non-boss, non-structure foes adjacent to the king are lulled to
  // sleep and skip their turn; any no longer adjacent wake back up.
  if (p.sleepAura) {
    for (const enemy of next.enemies) {
      if (enemy.boss || enemy.turret || enemy.summonCircle) continue;
      if (chebyshev(enemy.x, enemy.y, p.x, p.y) === 1) {
        enemy.asleep = true;
        enemy.awake = false;
        enemy.surprised = false;
        enemy.lastSeen = null;
        enemy.lastSeenTtl = 0;
      } else if (enemy.asleep) {
        enemy.asleep = false;
      }
    }
  }

  for (const enemy of next.enemies) {
    if (enemy.asleep) continue; // a slumbering foe holds still
    const wasSurprised = enemy.surprised;
    enemy.frustrated = false;
    // Silent (stealth): an unaware foe MORE than one tile away never perceives the king;
    // any within one tile detects him normally (see the aware branch below).
    const hiddenFromThis = stealthed && !enemy.awake && chebyshev(enemy.x, enemy.y, p.x, p.y) > 1;
    const sensesWalls = enemy.bossPerk === 'phasing'; // a Phasing boss sees the king through walls/boulders
    if (hiddenFromThis || !enemyAwareOfKing(next, enemy.x, enemy.y, sensesWalls)) {
      enemy.awake = false;
      enemy.surprised = false;
      if (!isStationary(enemy)) {
        if (hiddenFromThis) {
          // A Silent-blinded foe wanders on, oblivious. Only BLUNDERING straight into the
          // king (a bump) gives him away now; merely wandering next to him doesn't — it
          // will notice next turn, once it's within a tile at the start of its turn.
          const bumped = wanderEnemy(next, enemy, true);
          if (bumped) {
            enemy.awake = true;
            enemy.surprised = true;
            enemy.lastSeen = { x: p.x, y: p.y };
            enemy.lastSeenTtl = PURSUIT_TTL;
          }
        } else {
          // Ghost (noChase): the king shakes pursuers the instant he breaks sight, so a
          // foe that has lost him wanders instead of hunting his last-seen tile.
          const canPursue = !p.noChase && enemy.lastSeen && enemy.lastSeenTtl > 0 && pursueLastSeen(next, enemy);
          if (!canPursue) wanderEnemy(next, enemy, false);
        }
      }
      // Pursuing/wandering can carry an enemy INTO the king's view. It has already
      // spent its move this turn, but it must NOT be left flagged "unaware" while
      // sitting on screen — a hunter that steps into sight is plainly hostile. Mark
      // it aware and refresh its memory so it acts as a mover next turn.
      if (!hiddenFromThis && enemyAwareOfKing(next, enemy.x, enemy.y, sensesWalls)) {
        enemy.awake = true;
        enemy.lastSeen = { x: p.x, y: p.y };
        enemy.lastSeenTtl = PURSUIT_TTL;
      }
      continue;
    }
    // An enemy is only startled if it had truly lost track of the king. If it
    // still holds a live memory of him (it was pursuing his last-seen tile), it
    // re-engages at once rather than gasping in surprise all over again.
    const remembered = Boolean(enemy.lastSeen) && enemy.lastSeenTtl > 0;
    enemy.lastSeen = { x: p.x, y: p.y };
    enemy.lastSeenTtl = PURSUIT_TTL;
    if (!enemy.awake && !wasSurprised && !remembered) {
      enemy.awake = true;
      enemy.surprised = true;
    } else {
      enemy.awake = true;
      enemy.surprised = false;
      moverIds.push(enemy.id);
    }
  }

  // Summoned units persist only while they are actively hostile movers.
  const before = next.enemies.length;
  next.enemies = next.enemies.filter((e) => !(e.summoned && !moverIds.includes(e.id)));
  if (next.enemies.length !== before) moverIds = moverIds.filter((id) => next.enemies.some((e) => e.id === id));

  for (let i = moverIds.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [moverIds[i], moverIds[j]] = [moverIds[j], moverIds[i]];
  }
  return { state: next, moverIds };
}

// Valkyrie-style Reflection: a ranged attack is turned back on its caster.
function tryReflect(state, attacker) {
  if (!state.player.reflect) return false;
  state.lastShot = { fromX: state.player.x, fromY: state.player.y, toX: attacker.x, toY: attacker.y, role: 'turret' };
  if (isCapturable(state, attacker)) resolveKill(state, attacker);
  state.message = `The king reflects the ${attacker.kind}'s attack!`;
  state.lastAction = 'enemy';
  return true;
}

// A turret's turn: it holds ground and fires along its piece pattern.
function fireTurret(state, turret) {
  // Recharging after its last shot — it can't fire this turn (a window to cross its line).
  if (turret.recovering) {
    turret.recovering = false;
    state.message = `A ${turret.kind} turret hums, recharging.`;
    state.lastAction = 'enemy';
    return state;
  }
  // Camouflage (Gloom Stalker): structures can't find the king to target him.
  if (state.player.camouflage) {
    state.message = `A ${turret.kind} turret loses the king from view.`;
    state.lastAction = 'enemy';
    return state;
  }
  const hitsKing = getPieceThreats(turret, state).some((t) => t.x === state.player.x && t.y === state.player.y);
  if (!hitsKing) {
    state.message = `A ${turret.kind} turret takes aim.`;
    state.lastAction = 'enemy';
    return state;
  }
  turret.recovering = true; // firing spends its charge — it must recharge next turn
  if (tryReflect(state, turret)) return state;
  state.lastShot = { fromX: turret.x, fromY: turret.y, toX: state.player.x, toY: state.player.y, role: 'turret' };
  const mit = rollMitigation(state.player);
  if (mit) {
    state.message = mitigationMessage(mit, `${turret.kind} turret`);
    state.lastAction = 'enemy';
    return state;
  }
  state.player.hp -= 1;
  state.player.wasHit = true;
  addSpatter(state, state.player.x, state.player.y);
  state.message = `A ${turret.kind} turret blasts the king!`;
  state.lastAction = 'hit';
  checkDeath(state);
  if (!state.gameOver) blinkToSafety(state);
  return state;
}

// Conjure a fresh minion of `kind` on a free tile beside `origin`.
function summonAdjacent(state, origin, kind) {
  const dirs = [...ORTHO, ...DIAG];
  for (let i = dirs.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [dirs[i], dirs[j]] = [dirs[j], dirs[i]];
  }
  const minionKind = kind || randomEnemyKind(state.floor);
  for (const [dx, dy] of dirs) {
    const x = origin.x + dx;
    const y = origin.y + dy;
    if (x < 0 || x >= WORLD_SIZE || y < 0 || y >= WORLD_SIZE) continue;
    if (!isStandable(terrainAt(state, x, y))) continue;
    if (x === state.player.x && y === state.player.y) continue;
    if (keyTileAt(state, x, y)) continue; // never conjure a minion onto the floor key
    if (allyAt(state, x, y)) continue; // nor onto one of the king's allies
    if (state.enemies.some((e) => e.x === x && e.y === y)) continue;
    if (!kindCanMove(state, minionKind, x, y)) continue; // never conjure a stuck minion
    const minion = createEnemy(minionKind, x, y);
    minion.summoned = true;
    minion.awake = true;
    state.enemies.push(minion);
    return true;
  }
  return false;
}

// A summoning circle's turn: while the king can see it, it conjures a minion of its
// OWN piece type on charged turns (never two running). It never moves or strikes.
function summonCircleTurn(state, circle) {
  // Camouflage: a circle that can't sense the king won't conjure against him.
  if (state.player.camouflage) {
    circle.charged = true;
    state.message = 'A summoning circle gropes blindly for the king.';
    state.lastAction = 'enemy';
    return state;
  }
  if (circle.charged && state.enemies.length < MAX_ENEMIES && summonAdjacent(state, circle, circle.kind)) {
    circle.charged = false;
    state.message = 'A summoning circle conjures a minion!';
    state.lastAction = 'enemy';
    return state;
  }
  circle.charged = true;
  state.message = 'A summoning circle pulses with dark light.';
  state.lastAction = 'enemy';
  return state;
}

function chooseHostileMove(moves, px, py) {
  const key = `${px},${py}`;
  let chosen = moves.find((m) => `${m.x},${m.y}` === key);
  if (!chosen) {
    let best = Infinity;
    for (const m of moves) {
      const d = distanceSq(m.x, m.y, px, py);
      if (d < best || (d === best && Math.random() < 0.5)) {
        best = d;
        chosen = m;
      }
    }
  }
  return chosen;
}

// A boss strikes without expending itself (a hit costs 1 HP by default).
function bossHit(state, boss, hitMsg) {
  const mit = rollMitigation(state.player);
  if (!mit) {
    state.player.hp -= bossDamage(boss);
    state.player.wasHit = true;
    bossLeech(boss); // a Leech guardian mends a wound as it draws blood
    addSpatter(state, state.player.x, state.player.y, Math.sign(state.player.x - boss.x), Math.sign(state.player.y - boss.y));
    state.message = hitMsg;
    state.lastAction = 'hit';
    checkDeath(state);
    if (!state.gameOver) blinkToSafety(state);
  } else {
    state.message = `The king withstands ${boss.bossName || `the ${boss.kind} guardian`}!`;
    state.lastAction = 'enemy';
  }
  return state;
}

// A jumper leaps onto the king's tile and knocks him back, taking his ground.
// --- Knockback with collision ------------------------------------------------
// A shoved piece that slams into another unit deals it a hit: an ordinary piece (or an
// ally) is crushed and the shover takes its tile; an HP-bearing piece (boss, turret,
// king) withstands it, so the shover stops short and merely bumps it. These two helpers
// give EVERY knockback source (jumpers, boss Bulwark, Recoil, Trample, Displacement) the
// same consistent behaviour.

// Resolve a shove onto (tx,ty): damage whatever occupies it. Returns true if the tile is
// now CLEAR (the shover should advance onto it), false if it held (the shover stops).
// `moverId` is the shover's enemy id (null for the king); `moverIsKing` gives the king
// kill-credit for a foe he is driven into.
function resolveShoveInto(state, tx, ty, moverId, moverIsKing) {
  // Slammed into the king: he takes a hit but holds his ground.
  if (tx === state.player.x && ty === state.player.y) {
    const mit = rollMitigation(state.player);
    if (!mit) {
      state.player.hp -= 1;
      state.player.wasHit = true;
      addSpatter(state, tx, ty);
      checkDeath(state);
      if (!state.gameOver) blinkToSafety(state);
    }
    return false;
  }
  // Slammed into one of the king's allies: it's crushed, the shover takes its tile.
  const ally = allyAt(state, tx, ty);
  if (ally) {
    state.allies = state.allies.filter((a) => a.id !== ally.id);
    addSpatter(state, tx, ty);
    addCorpse(state, tx, ty, ally.kind);
    return true;
  }
  // Slammed into another piece.
  const foe = state.enemies.find((e) => e.id !== moverId && e.x === tx && e.y === ty);
  if (foe) {
    if (foe.boss) return damageBoss(state, foe, 1) === 'slain'; // a boss withstands it unless it falls
    if (foe.turret) return damageTurret(state, foe, 1) === 'slain';
    if (foe.summonCircle) {
      // shoved onto a summoning circle — it shatters into a scar, the shover takes its tile
      state.enemies = state.enemies.filter((e) => e.id !== foe.id);
      if (!Array.isArray(state.scars)) state.scars = [];
      state.scars.push({ x: tx, y: ty, kind: 'circle' });
      return true;
    }
    if (moverIsKing) {
      resolveKill(state, foe); // the king's shove counts as his kill (boon / necromancy)
    } else {
      state.enemies = state.enemies.filter((e) => e.id !== foe.id);
      addSpatter(state, tx, ty);
      addCorpse(state, tx, ty, foe.kind);
    }
    return true;
  }
  return true; // empty ground
}

// Shove an ENEMY one tile in (dx,dy), colliding with whatever's there. A wall / the board
// edge halts it (enemies may be driven across water and onto lava). Fixed structures
// should be filtered out by the caller.
function knockbackEnemy(state, enemy, dx, dy) {
  if (!dx && !dy) return;
  const tx = enemy.x + dx;
  const ty = enemy.y + dy;
  if (tx < 0 || tx >= WORLD_SIZE || ty < 0 || ty >= WORLD_SIZE) return;
  if (!standableFor(terrainAt(state, tx, ty), { lavaOk: true })) return; // a wall stops the shove
  if (resolveShoveInto(state, tx, ty, enemy.id, false)) {
    enemy.x = tx;
    enemy.y = ty;
  }
}

// Shove the BOULDER at (bx,by) one tile in (dx,dy) — the knockback counterpart of a manual
// push. A wall / boulder / board edge halts it; a pit / lava / water is FILLED (boulder
// consumed); a unit in the way is struck for 1 exactly like a knocked-back enemy (an ordinary
// foe is crushed and the boulder rolls onto its tile, while a boss / turret / the king merely
// takes the hit and stops the boulder). The floor key is never buried.
function knockbackBoulder(state, bx, by, dx, dy) {
  if (!dx && !dy) return;
  if (terrainAt(state, bx, by) !== 'boulder') return;
  const tx = bx + dx;
  const ty = by + dy;
  if (tx < 0 || tx >= WORLD_SIZE || ty < 0 || ty >= WORLD_SIZE) return;
  const t = terrainAt(state, tx, ty);
  if (t === 'wall' || t === 'boulder') return; // solid ahead — the boulder can't advance
  if (t === 'pit' || t === 'lava' || t === 'water') {
    delete state.terrain[`${bx},${by}`];
    delete state.terrain[`${tx},${ty}`]; // hazard filled, boulder consumed
    return;
  }
  if (keyTileAt(state, tx, ty)) return; // never bury the floor key
  const occupied = (tx === state.player.x && ty === state.player.y)
    || state.enemies.some((e) => e.x === tx && e.y === ty)
    || Boolean(allyAt(state, tx, ty));
  if (occupied) {
    // Collide (1 damage) via the shared resolver; if the tile clears the boulder rolls onto it.
    if (resolveShoveInto(state, tx, ty, null, false)) {
      delete state.terrain[`${bx},${by}`];
      state.terrain[`${tx},${ty}`] = 'boulder';
    }
    return;
  }
  delete state.terrain[`${bx},${by}`];
  state.terrain[`${tx},${ty}`] = 'boulder';
}

// Shove everything ADJACENT to (cx,cy) — mobile foes AND loose boulders — one tile directly
// away, colliding with whatever's behind it. Fixed structures (turrets / summoning circles)
// and the excluded piece stay put. Shared by Recoil, Trample, and Displacement.
function shoveAdjacentAway(state, cx, cy, excludeId) {
  const ids = state.enemies
    .filter((e) => !e.turret && !e.summonCircle && e.id !== excludeId && chebyshev(e.x, e.y, cx, cy) === 1)
    .map((e) => e.id);
  for (const id of ids) {
    const foe = state.enemies.find((e) => e.id === id);
    if (foe) knockbackEnemy(state, foe, Math.sign(foe.x - cx), Math.sign(foe.y - cy));
  }
  for (const [dx, dy] of [...ORTHO, ...DIAG]) {
    if (terrainAt(state, cx + dx, cy + dy) === 'boulder') knockbackBoulder(state, cx + dx, cy + dy, dx, dy);
  }
}

// A jumper (or a Bulwark boss) leaps onto the king and bowls him back one tile — into
// whatever stands behind him (crushing an ordinary foe/ally, bumping a boss/turret). The
// jumper then takes the ground the king vacated.
function knockbackKing(state, enemy) {
  const king = state.player;
  let pdx = Math.sign(king.x - enemy.x);
  let pdy = Math.sign(king.y - enemy.y);
  if (pdx === 0 && pdy === 0) pdx = 1;
  const bx = king.x + pdx;
  const by = king.y + pdy;
  const mit = rollMitigation(king);
  if (!mit) {
    king.hp -= enemy.boss ? bossDamage(enemy) : 1;
    king.wasHit = true;
    bloody(enemy, BLOOD_STRIKE); // an ordinary jumper is flecked (a boss shows HP wounds)
    if (enemy.boss) bossLeech(enemy); // a Leech guardian mends as it lands the shove
    addSpatter(state, king.x, king.y, pdx, pdy); // blood carries in the shove direction
    checkDeath(state);
  }
  // The king is bowled back unless he just fell, or a wall/lava/edge halts him. Whatever
  // stands behind him is slammed (see resolveShoveInto); if it clears, he slides in and
  // the jumper takes his old tile.
  let pushed = false;
  if (!mit && !state.gameOver) {
    const inBounds = bx >= 0 && bx < WORLD_SIZE && by >= 0 && by < WORLD_SIZE;
    if (inBounds && standableFor(terrainAt(state, bx, by), { phaseWalls: Boolean(king.phase) })) {
      if (resolveShoveInto(state, bx, by, null, true)) {
        const kx = king.x;
        const ky = king.y;
        king.x = bx;
        king.y = by;
        enemy.x = kx;
        enemy.y = ky;
        pushed = true;
      }
    }
  }
  if (mit) {
    state.message = mitigationMessage(mit, enemy.kind);
    state.lastAction = 'enemy';
  } else {
    state.message = pushed ? `A ${enemy.kind} bowls the king aside!` : `A ${enemy.kind} leaps upon the king!`;
    state.lastAction = 'hit';
  }
  if (!state.gameOver) collectKeyIfHere(state); // shoved onto the key? he grabs it
  if (!state.gameOver && !mit) blinkToSafety(state); // a struck blink-mage flickers away
  updateDiscovery(state);
  return state;
}

// Can this (non-jumping) enemy strike the king from where it stands? Adjacent only.
function canMeleeStrike(state, enemy) {
  return chebyshev(enemy.x, enemy.y, state.player.x, state.player.y) === 1;
}

// A piece attacks ONLY if it can move onto the king this turn; otherwise it just
// advances. Never both. Jumpers knock him back; others strike (persisting).
function meleeMove(state, enemy) {
  const king = state.player;
  const moves = getPieceMoves(enemy, state);
  const canCapture = moves.some((m) => m.x === king.x && m.y === king.y);
  if (canCapture) {
    if (isJumperKind(enemy.kind)) return knockbackKing(state, enemy);
    strikeKing(state, enemy);
    return state;
  }
  // The king is out of reach — cut down one of his allies if one is in range instead.
  const allyHit = moves.find((m) => allyAt(state, m.x, m.y));
  if (allyHit) {
    const a = allyAt(state, allyHit.x, allyHit.y);
    state.allies = state.allies.filter((al) => al.id !== a.id);
    addSpatter(state, allyHit.x, allyHit.y);
    enemy.x = allyHit.x;
    enemy.y = allyHit.y;
    state.message = `A ${enemy.kind} cuts down your ${a.kind}!`;
    state.lastAction = 'enemy';
    return state;
  }
  const legal = moves.filter((m) => !(m.x === king.x && m.y === king.y) && !allyAt(state, m.x, m.y));
  if (!legal.length) {
    enemy.frustrated = true;
    state.message = 'A cornered piece fumes, unable to move.';
    state.lastAction = 'enemy';
    return state;
  }
  const chosen = chooseHostileMove(legal, king.x, king.y);
  enemy.x = chosen.x;
  enemy.y = chosen.y;
  crushBoulderUnder(state, enemy); // a leaper that lands on a boulder crushes it
  state.message = 'An enemy piece advances.';
  state.lastAction = 'enemy';
  return state;
}

// Resolve an ordinary enemy striking the king (it persists — never expends itself).
function strikeKing(state, enemy) {
  const mit = rollMitigation(state.player);
  if (!mit) {
    state.player.hp -= 1;
    state.player.wasHit = true;
    bloody(enemy, BLOOD_STRIKE); // the striker is flecked (the king shows HP wounds)
    addSpatter(state, state.player.x, state.player.y, Math.sign(state.player.x - enemy.x), Math.sign(state.player.y - enemy.y));
    state.message = `A ${enemy.kind} strikes the king!`;
    state.lastAction = 'hit';
    checkDeath(state);
    if (!state.gameOver) blinkToSafety(state);
  } else {
    state.message = mitigationMessage(mit, enemy.kind);
    state.lastAction = 'enemy';
  }
  return state;
}

// A Volley/Sorcerer boss looses a bolt at the king when he lies along one of the boss's
// OWN movement lines — a bishop only down its diagonals, a rook only down ranks/files, a
// queen either. (It never fires a line its piece can't travel.) A plain Volley is stopped
// by anything in the lane (cover or a body); a Sorcerer's bolt pierces every unit on the
// path, wounding each. Walls stop both. Returns true if it fired, false to fall back to a
// normal advancing move.
function bossRangedAttack(state, boss) {
  const king = state.player;
  const ddx = king.x - boss.x;
  const ddy = king.y - boss.y;
  if (ddx === 0 && ddy === 0) return false;
  const onLine = ddx === 0 || ddy === 0 || Math.abs(ddx) === Math.abs(ddy);
  if (!onLine) return false;
  const dx = Math.sign(ddx);
  const dy = Math.sign(ddy);
  // The king must sit on a ray the boss's piece can actually slide along.
  if (!cardSlideDirs(boss.kind).some(([sx, sy]) => sx === dx && sy === dy)) return false;
  const pierce = boss.bossPerk === 'sorcerer';
  const path = [];
  const shattered = []; // boulders the bolt smashes through on its way to the king
  let x = boss.x + dx;
  let y = boss.y + dy;
  let reached = false;
  while (x >= 0 && x < WORLD_SIZE && y >= 0 && y < WORLD_SIZE) {
    const terr = terrainAt(state, x, y);
    if (terr === 'wall') return false; // a wall stops any bolt cold
    if (terr === 'boulder') shattered.push({ x, y }); // the bolt blasts it apart in passing (incidental)
    if (x === king.x && y === king.y) {
      reached = true;
      break;
    }
    const inLane = state.enemies.some((e) => e.id !== boss.id && e.x === x && e.y === y) || allyAt(state, x, y);
    if (inLane && !pierce) return false; // a plain volley can't shoot past a body
    path.push({ x, y });
    x += dx;
    y += dy;
  }
  if (!reached) return false;
  // The shot is confirmed — any boulders that stood in the bolt's path are blasted to rubble.
  for (const b of shattered) smashBoulder(state, b.x, b.y);
  // A Sorcerer boss looses a piercing fireball that scorches every tile on the path
  // (its own bolt lands on the king's tile); a Volley boss looses a plain arrow.
  state.lastShot = {
    fromX: boss.x, fromY: boss.y, toX: king.x, toY: king.y,
    role: pierce ? 'fireball' : 'arrow',
    tiles: pierce ? [...path.map((t) => ({ x: t.x, y: t.y })), { x: king.x, y: king.y }] : null,
  };
  if (pierce) {
    // Everything caught on the path is wounded (the boss spares only itself).
    for (const t of path) {
      const ally = allyAt(state, t.x, t.y);
      if (ally) {
        state.allies = state.allies.filter((a) => a.id !== ally.id);
        addSpatter(state, t.x, t.y, dx, dy);
        addAsh(state, t.x, t.y); // burnt down by the sorcerer's bolt
        continue;
      }
      const foe = state.enemies.find((e) => e.id !== boss.id && !e.boss && e.x === t.x && e.y === t.y);
      if (foe) {
        state.enemies = state.enemies.filter((e) => e.id !== foe.id);
        addSpatter(state, t.x, t.y, dx, dy);
        addAsh(state, t.x, t.y);
      }
    }
  }
  const mit = rollMitigation(king);
  if (!mit) {
    king.hp -= 1;
    king.wasHit = true;
    bossLeech(boss); // a Leech guardian mends a wound as its bolt bites
    addSpatter(state, king.x, king.y, dx, dy); // blood sprays along the bolt's path
    state.message = pierce
      ? `${bossTitle(boss)} looses a searing bolt through all in its path!`
      : `${bossTitle(boss)} looses a bolt at the king!`;
    state.lastAction = 'hit';
    checkDeath(state);
    if (!state.gameOver) blinkToSafety(state);
  } else {
    state.message = mitigationMessage(mit, boss.kind);
    state.lastAction = 'enemy';
  }
  return true;
}

// A boss's turn: hunt like its piece, and strike ONLY if it can capture the king.
function bossMove(state, boss) {
  const king = state.player;
  // A non-immune guardian (an earlier-age piece, or one of the finale's rush bosses) sears in
  // lava it stands on — 1 wound at the start of its turn, so the king can lure or knock a
  // vanilla-type boss into a lava field to whittle it down. Demon-floor guardians are immune.
  if (!boss.lavaImmune && terrainAt(state, boss.x, boss.y) === 'lava') {
    if (damageBoss(state, boss, 1) === 'slain') { state.lastAction = 'combat'; return state; }
  }
  // A giant guardian must catch its breath after every exertion: the turn AFTER it acts it
  // only RECOVERS, giving the king a window to strike or reposition. (This is what makes
  // these long-reach, high-HP bosses fair to fight.)
  if (boss.recovering) {
    boss.recovering = false;
    state.message = `${bossTitle(boss)} lumbers, catching its breath.`;
    state.lastAction = 'enemy';
    return state;
  }
  // A dormant guardian holds the stair/portal until it SEES the king (line of sight within
  // view) or is struck (hp < maxHp) — then it rouses for good. Seeing him is the trigger now,
  // not merely stepping adjacent, so a guardian on the far side of the room stirs on sight.
  if (boss.dormant) {
    if (boss.hp < boss.maxHp || enemyAwareOfKing(state, boss.x, boss.y, boss.bossPerk === 'phasing')) {
      boss.dormant = false;
    } else {
      const guarded = state.key && state.key.orb ? 'Orb' : 'key';
      state.message = `${bossTitle(boss)} guards the ${guarded}, unmoving.`;
      state.lastAction = 'enemy';
      return state;
    }
  }
  // The first time it turns hostile, a guardian ROARS its threat (a one-turn telegraph before it
  // hunts) — logged so the player reads it; demon guardians are scarier (see bossHostileLine).
  if (!boss.spokeLine) {
    boss.spokeLine = true;
    state.message = bossHostileLine(boss);
    state.lastAction = 'enemy';
    return state;
  }
  boss.recovering = true; // whatever the boss does below, it must recover next turn
  // Summoner: every third turn it conjures a minion of its own kind instead of acting.
  if (boss.bossPerk === 'summoner') {
    boss.perkTick = (boss.perkTick || 0) + 1;
    if (boss.perkTick % 3 === 0) {
      const made = summonAdjacent(state, boss, boss.kind);
      state.message = made
        ? `${bossTitle(boss)} conjures a ${boss.kind}!`
        : `${bossTitle(boss)} reaches for aid, but finds no room.`;
      state.lastAction = 'enemy';
      return state;
    }
  }
  // Volley / Sorcerer: loose a bolt down an open line rather than closing to melee.
  if ((boss.bossPerk === 'ranged' || boss.bossPerk === 'sorcerer') && bossRangedAttack(state, boss)) {
    return state;
  }
  const moves = getPieceMoves(boss, state);
  const canCapture = moves.some((m) => m.x === king.x && m.y === king.y);
  if (canCapture) {
    if (isJumperKind(boss.kind) || boss.bossPerk === 'knockback') return knockbackKing(state, boss);
    return bossHit(state, boss, `${bossTitle(boss)} strikes the king!`);
  }
  const bossAlly = moves.find((m) => allyAt(state, m.x, m.y));
  if (bossAlly) {
    const a = allyAt(state, bossAlly.x, bossAlly.y);
    state.allies = state.allies.filter((al) => al.id !== a.id);
    addSpatter(state, bossAlly.x, bossAlly.y);
    boss.x = bossAlly.x;
    boss.y = bossAlly.y;
    state.message = `${bossTitle(boss)} destroys your ${a.kind}!`;
    state.lastAction = 'enemy';
    return state;
  }
  const legal = moves.filter((m) => !(m.x === king.x && m.y === king.y) && !allyAt(state, m.x, m.y));
  if (!legal.length) {
    boss.frustrated = true;
    state.message = `${bossTitle(boss)} fumes.`;
    state.lastAction = 'enemy';
    return state;
  }
  const chosen = chooseHostileMove(legal, king.x, king.y);
  boss.x = chosen.x;
  boss.y = chosen.y;
  crushBoulderUnder(state, boss); // a leaping boss crushes a boulder it lands on
  state.message = `${bossTitle(boss)} advances.`;
  state.lastAction = 'enemy';
  return state;
}

// Move a single (seen, aware) enemy.
function moveEnemy(state, enemyId) {
  const next = structuredClone(state);
  next.lastShot = null;
  next.player.deflected = false; // set true only if THIS enemy's blow is deflected
  const enemy = next.enemies.find((piece) => piece.id === enemyId);
  if (!enemy) return next;
  if (enemy.boss) return bossMove(next, enemy);
  if (enemy.turret) return fireTurret(next, enemy);
  if (enemy.summonCircle) return summonCircleTurn(next, enemy);
  return meleeMove(next, enemy);
}

/* ------------------------------ danger events ----------------------------- */
// The floor turns against the king the longer he lingers: at intervals (shorter as dread
// climbs) ONE random hostile "event" fires. This REPLACES the old faster-and-faster spawn
// trickle. Each event sets `state.dangerEvent` so the view can shake + play an ominous cue.

// Every open floor tile the king still has a safe path to the exit / key over — used to
// revert any terrain change that would seal him off.
function dangerReachOk(next) {
  const reach = playerReachable(next, next.player.x, next.player.y);
  const need = [];
  if (next.exit) need.push(`${next.exit.x},${next.exit.y}`);
  if (next.key && !next.key.collected) need.push(`${next.key.x},${next.key.y}`);
  return need.every((k) => reach.has(k));
}
// Convert up to `count` open floor tiles (well clear of the king, never the exit/key/units)
// to `type`. Undoes ALL of it if that would cut the exit or key off from the king.
function scatterTerrain(next, type, count) {
  const p = next.player;
  const changed = [];
  for (let tries = 0; changed.length < count && tries < 400; tries += 1) {
    const x = 1 + randomInt(WORLD_SIZE - 2);
    const y = 1 + randomInt(WORLD_SIZE - 2);
    if (terrainAt(next, x, y) !== 'normal') continue;
    if (chebyshev(x, y, p.x, p.y) <= 3) continue; // leave the king room to react
    if (next.exit && x === next.exit.x && y === next.exit.y) continue;
    if (next.key && !next.key.collected && x === next.key.x && y === next.key.y) continue;
    if (next.enemies.some((e) => e.x === x && e.y === y) || allyAt(next, x, y)) continue;
    next.terrain[`${x},${y}`] = type;
    changed.push(`${x},${y}`);
  }
  if (!dangerReachOk(next)) for (const k of changed) delete next.terrain[k];
  return changed.length;
}
// A cluster of fresh foes just beyond the king's sight.
function spawnWave(next) {
  const cap = Math.min(MAX_ENEMIES, 14 + next.floor * 5);
  const radius = Math.floor((next.player.vision || STARTING_VISION) / 2);
  const occupied = new Set([`${next.player.x},${next.player.y}`]);
  for (const e of next.enemies) occupied.add(`${e.x},${e.y}`);
  const seed = randomEnemyKind(next.floor);
  const anchor = findFreeTile(occupied, (x, y) => isStandable(terrainAt(next, x, y)) && !inLineOfSight(next, x, y)
      && chebyshev(x, y, next.player.x, next.player.y) <= radius + 4 && kindCanMove(next, seed, x, y))
    || findFreeTile(occupied, (x, y) => isStandable(terrainAt(next, x, y)) && !inLineOfSight(next, x, y) && kindCanMove(next, seed, x, y));
  if (!anchor) return 'A distant snarl echoes — but nothing comes.';
  let placed = 0;
  const want = 3 + randomInt(3);
  for (let i = 0; i < 30 && placed < want && next.enemies.length < cap; i += 1) {
    const kind = randomEnemyKind(next.floor);
    const tile = findFreeTile(occupied, (x, y) => chebyshev(x, y, anchor.x, anchor.y) <= 2 && isStandable(terrainAt(next, x, y))
      && !inLineOfSight(next, x, y) && !keyTileAt(next, x, y) && !allyAt(next, x, y) && kindCanMove(next, kind, x, y));
    if (!tile) continue;
    occupied.add(tile.key);
    next.enemies.push(createEnemy(kind, tile.x, tile.y));
    placed += 1;
  }
  return placed ? 'A wave of enemies pours in nearby!' : 'The shadows stir uneasily.';
}
// The finale's boss-rush: once the Orb is taken, one lesser guardian claws into the world near
// the king every BOSS_RUSH_INTERVAL turns (capped so the board never chokes). It uses an
// EARLIER, vanilla piece kind (rook, knight, bishop, …) which — unlike the demon-floor
// guardian — is NOT immune to lava, so the king can still play the terrain against it. It
// spawns already hostile and hunting.
function spawnBossRush(next) {
  const liveRush = next.enemies.filter((e) => e.boss && e.rush).length;
  if (liveRush >= BOSS_RUSH_CAP) return ''; // only one rogue guardian loose at a time
  const p = next.player;
  const kind = STANDARD_KINDS[randomInt(STANDARD_KINDS.length)]; // an earlier-age piece
  const occupied = new Set([`${p.x},${p.y}`]);
  for (const e of next.enemies) occupied.add(`${e.x},${e.y}`);
  const near = (x, y) => isStandable(terrainAt(next, x, y)) && !keyTileAt(next, x, y) && !allyAt(next, x, y) && kindCanMove(next, kind, x, y);
  const tile = findFreeTile(occupied, (x, y) => near(x, y) && chebyshev(x, y, p.x, p.y) >= 2 && chebyshev(x, y, p.x, p.y) <= 5)
    || findFreeTile(occupied, (x, y) => near(x, y) && chebyshev(x, y, p.x, p.y) <= 7);
  if (!tile) return '';
  const b = createEnemy(kind, tile.x, tile.y);
  b.boss = true;
  b.rush = true; // a converging guardian — grants no boon when felled
  b.bossName = `a rogue ${kind}`;
  b.originalKind = kind;
  b.maxHp = 2 + Math.floor(next.floor / 3); // a LESSER boss than the floor guardian
  b.bossPerk = BOSS_PERKS[randomInt(BOSS_PERKS.length)];
  if (b.bossPerk === 'tough') b.maxHp += 3;
  b.hp = b.maxHp;
  b.lavaImmune = false; // an earlier-age guardian: lava still burns it
  b.dormant = false;
  // It arrives SURPRISED — it freezes the first time the king lays eyes on it, then turns hostile
  // (roaring its line) — so a boss never simply materialises in your face. (createEnemy defaults
  // awake:false / surprised:false, which makes it a fresh sighting → surprised on the next phase.)
  next.enemies.push(b);
  return `A rogue ${kind} guardian claws into the world nearby!`;
}
// A few turrets rise around the map (out of sight, where they cover real ground).
function dropTurrets(next) {
  const occupied = new Set([`${next.player.x},${next.player.y}`]);
  for (const e of next.enemies) occupied.add(`${e.x},${e.y}`);
  let placed = 0;
  const want = 2 + randomInt(2);
  for (let i = 0; i < 40 && placed < want; i += 1) {
    const kind = randomEnemyKind(next.floor);
    const tile = findFreeTile(occupied, (x, y) => isStandable(terrainAt(next, x, y)) && !inLineOfSight(next, x, y)
      && !keyTileAt(next, x, y) && !allyAt(next, x, y) && turretCoverage(next, kind, x, y) >= 4);
    if (!tile) continue;
    occupied.add(tile.key);
    const t = createEnemy(kind, tile.x, tile.y);
    t.turret = true;
    t.hp = TURRET_HP;
    t.maxHp = TURRET_HP;
    next.enemies.push(t);
    placed += 1;
  }
  return placed ? 'Turrets grind up from the floor around you!' : 'The floor rumbles ominously.';
}
// Every mobile foe locks onto the king and gives chase. (Ghost still shakes them once he
// breaks sight, so it is semi-immune.)
function aggroAll(next) {
  const p = next.player;
  let n = 0;
  for (const e of next.enemies) {
    if (e.turret || e.summonCircle) continue;
    e.awake = true;
    e.asleep = false;
    e.surprised = false;
    e.lastSeen = { x: p.x, y: p.y };
    e.lastSeenTtl = PURSUIT_TTL;
    n += 1;
  }
  return n ? 'Every foe on the floor senses you — they close in!' : 'A dreadful silence falls.';
}
// A fifth of the interior walls slump into lava (opening the map but adding hazard).
function wallsToLava(next) {
  const interior = [];
  for (const k in next.terrain) {
    if (next.terrain[k] !== 'wall') continue;
    const [x, y] = k.split(',').map(Number);
    if (x > 1 && x < WORLD_SIZE - 2 && y > 1 && y < WORLD_SIZE - 2) interior.push(k);
  }
  if (!interior.length) return 'The walls groan, but hold.';
  const n = Math.max(1, Math.round(interior.length * 0.2));
  for (let i = 0; i < n; i += 1) next.terrain[interior[randomInt(interior.length)]] = 'lava';
  return 'Walls slump into rivers of lava!';
}

// A cave-in also collapses a few STANDING interior walls to open floor, each leaving a fading
// pile of rubble. Removing a wall only ever OPENS the map, so it can never seal off a path.
function collapseWalls(next, count) {
  const interior = [];
  for (const k in next.terrain) {
    if (next.terrain[k] !== 'wall') continue;
    const [x, y] = k.split(',').map(Number);
    if (x > 1 && x < WORLD_SIZE - 2 && y > 1 && y < WORLD_SIZE - 2) interior.push([x, y]);
  }
  let done = 0;
  for (let i = 0; i < count && interior.length; i += 1) {
    const [x, y] = interior.splice(randomInt(interior.length), 1)[0];
    smashWall(next, x, y);
    done += 1;
  }
  return done;
}

function fireDangerEvent(next) {
  // Only unleash a hazard the king has ALREADY encountered, so danger events keep pace with
  // the game's normal progression (no lava/pits/boulders/turrets before he's met one).
  const seen = next.player.seenTerrain || [];
  const pool = ['wave', 'aggro']; // always available (enemies always exist)
  if (seen.includes('water')) pool.push('flood');
  if (seen.includes('lava')) pool.push('lavaSpread', 'wallsToLava');
  if (seen.includes('pit')) pool.push('pits');
  if (seen.includes('boulder')) pool.push('caveIn');
  if (next.player.seenTurret) pool.push('turrets');
  const kind = pool[randomInt(pool.length)];
  let msg = '';
  switch (kind) {
    case 'wave': msg = spawnWave(next); break;
    case 'turrets': msg = dropTurrets(next); break;
    case 'aggro': msg = aggroAll(next); break;
    case 'wallsToLava': msg = wallsToLava(next); break;
    case 'lavaSpread': msg = scatterTerrain(next, 'lava', 3 + randomInt(4)) ? 'Lava wells up through the floor!' : 'The floor smoulders.'; break;
    case 'flood': msg = scatterTerrain(next, 'water', 4 + randomInt(4)) ? 'Water floods across the floor!' : 'A damp chill spreads.'; break;
    case 'pits': msg = scatterTerrain(next, 'pit', 2 + randomInt(3)) ? 'The ground gives way — pits yawn open!' : 'The ground shudders.'; break;
    case 'caveIn':
      scatterTerrain(next, 'boulder', 2 + randomInt(3));
      scatterTerrain(next, 'wall', 1 + randomInt(2));
      collapseWalls(next, 1 + randomInt(3)); // some standing walls give way, leaving rubble
      msg = 'The ceiling caves in — rubble crashes down!';
      break;
    default: msg = 'The floor darkens with menace.';
  }
  next.dangerEvent = { kind, message: msg };
  next.message = msg;
  updateDiscovery(next);
}

// Once per turn: tick the danger timer and, at ever-shorter intervals as dread climbs,
// unleash one random hostile event. This is the game's escalating pressure now.
function maybeSpawnEnemy(state) {
  const next = structuredClone(state);
  next.dangerEvent = null; // cleared each turn; set below only when an event fires
  // The FINALE: once the Orb is taken on the portal floor, the realm's guardians converge —
  // every so often a fresh boss claws into the world near the king, replacing ordinary danger.
  if (next.isPortalFloor && next.orbTaken) {
    next.bossRushTimer = (next.bossRushTimer || 0) + 1;
    if (!next.bossRushEvery) next.bossRushEvery = BOSS_RUSH_MIN + randomInt(BOSS_RUSH_MAX - BOSS_RUSH_MIN + 1);
    if (next.bossRushTimer >= next.bossRushEvery) {
      next.bossRushTimer = 0;
      next.bossRushEvery = BOSS_RUSH_MIN + randomInt(BOSS_RUSH_MAX - BOSS_RUSH_MIN + 1); // re-roll the next gap
      const msg = spawnBossRush(next);
      if (msg) { next.dangerEvent = { kind: 'bossRush', message: msg }; next.message = msg; }
    }
    return next;
  }
  next.turnsSinceSpawn = (next.turnsSinceSpawn || 0) + 1;
  const ramp = Math.min(1, next.turn / MAX_TURNS_SCARY); // 0 -> 1 over the dread horizon
  const interval = Math.max(6, Math.round(16 - 10 * ramp)); // ~16 turns early, ~6 at max dread
  if (next.turnsSinceSpawn < interval) return next;
  next.turnsSinceSpawn = 0;
  fireDangerEvent(next);
  return next;
}

/* --------------------------------- upkeep --------------------------------- */

// Record any enemy kinds the king can currently see.
function recordSeenEnemies(state) {
  const p = state.player;
  if (!Array.isArray(p.seenKinds)) p.seenKinds = [];
  for (const enemy of getVisibleEnemies(state)) {
    if (!p.seenKinds.includes(enemy.kind)) p.seenKinds.push(enemy.kind);
    if (enemy.turret) p.seenTurret = true; // gates the "turrets" danger event
  }
}

/* --------------------------------- scoring -------------------------------- */

function earnedConducts(player) {
  const conducts = [];
  if (!player.killedEnemy) conducts.push({ name: 'Pacifist', desc: 'Never killed an enemy.' });
  if (!player.wasHit) conducts.push({ name: 'Untouchable', desc: 'Never took a hit.' });
  return conducts;
}

function finalScore(state) {
  const turns = Math.max(1, state.player.totalTurns || 0);
  return Math.round((Math.pow(state.floor, 1.25) * 100) / turns);
}

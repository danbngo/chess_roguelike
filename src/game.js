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

// Whether an enemy may be captured/destroyed by the king right now. Turrets are
// untouchable; a summoning circle is destroyed by stepping on it; a boss is
// targetable but soaks HP (handled specially). Ordinary pieces die in one.
function isCapturable(state, enemy) {
  if (!enemy) return false;
  if (enemy.turret) return false;
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

function isFinalBossFloor(floor) {
  return floor % FINAL_FLOOR === 0;
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
  boss.hp = boss.maxHp;
  boss.dormant = true; // holds the stair until the king strikes it or draws adjacent
  return boss;
}

function bossTitle(boss) {
  const name = boss.bossName || `${boss.kind} guardian`;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

// Deal `amount` damage to a boss. Returns 'slain' if it fell, else 'hurt'.
function damageBoss(state, boss, amount) {
  boss.hp -= amount;
  if (boss.hp > 0) {
    state.message = `The king strikes ${boss.bossName} (${boss.hp}/${boss.maxHp}).`;
    state.lastAction = 'combat';
    return 'hurt';
  }
  state.enemies = state.enemies.filter((e) => e.id !== boss.id);
  addSpatter(state, boss.x, boss.y);
  state.player.killedEnemy = true;
  defeatBoss(state, boss.x, boss.y);
  return 'slain';
}

// Resolve the floor's boss being slain: the final floor wins the run; any other
// floor earns the level-up boon RIGHT HERE (the king does not descend yet — the
// stair the boss guarded is now clear, and he must still walk onto it).
function defeatBoss(state, x, y) {
  if (isFinalBossFloor(state.floor)) {
    state.won = true;
    state.message = 'The final guardian falls — the realm is free!';
    return;
  }
  const p = state.player;
  p.level = (p.level || 1) + 1;
  state.pendingLevelUp = true;
  state.levelPerks = rollLevelPerks(p, LEVEL_PERK_CHOICES);
  state.message = `The guardian falls! You reach level ${p.level} — choose a boon, then take the stair.`;
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
  if (player.warded) {
    mit = 'parry';
  } else if (player.firstHitEachTurn && !player.firstHitUsedThisTurn) {
    player.firstHitUsedThisTurn = true;
    mit = 'ward';
  }
  if (mit) player.deflected = true;
  return mit;
}
function mitigationMessage(mit, kind) {
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
  'blink', 'phase', 'hexDemote', 'sleepAura', 'multiShot',
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
    if (t === 'wall' || (!wallsOnly && t === 'lava')) delete state.terrain[`${cx},${cy}`];
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
      const nc = base + (terrainAt(state, nx, ny) === 'wall' ? 1 : 0);
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
    if (terrainAt(state, ...cur.split(',').map(Number)) === 'wall') delete state.terrain[cur];
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
    scars: [], // permanent marks (shattered summoning circles)
    exit: null,
    key: null, // the floor key; the stair stays locked until it is collected
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

  // Floor 1 introduces the game with one visible, surprised foe.
  if (floor === 1) {
    const tile = place((x, y) => standable(x, y) && seen(x, y) && chebyshev(x, y, player.x, player.y) >= 2);
    if (tile) addMobileEnemy(randomEnemyKind(floor), tile.x, tile.y, true);
  }

  // The exit + boss chamber sit at the floor's fixed anchor, ringed by a wall (or a
  // lava/water moat on watery/fiery floors) with a doorway facing the king. The
  // boss and a backup cohort (turrets / summoning circles / sleeping pieces) guard it.
  const level = levelForFloor(floor);
  const anchor = chamberAnchorForFloor(floor);
  const ax = Math.max(2, Math.min(WORLD_SIZE - 3, anchor.x));
  const ay = Math.max(2, Math.min(WORLD_SIZE - 3, anchor.y));
  state.exit = { x: ax, y: ay, discovered: false };
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

  // The boss stands ON the stair, guarding the way down until roused.
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

  // The floor KEY: the stair is sealed until the king picks it up. It favours a tile
  // well clear of the stair's overlook (chebyshev >= 6) AND out of the king's landing
  // sight, so he must explore for it; the constraints relax if no such tile exists.
  // Reserved in `occupied` so NO piece, turret, or circle ever spawns on it, and placed
  // before the connectivity carve so its pocket is guaranteed reachable.
  const keyClear = (x, y) => standable(x, y) && chebyshev(x, y, ax, ay) >= 2 && chebyshev(x, y, player.x, player.y) >= 2;
  const keyFar = (x, y) => keyClear(x, y) && chebyshev(x, y, ax, ay) >= 6;
  const keyHidden = (x, y) => keyFar(x, y) && !seen(x, y);
  const keyTile = place(keyHidden) || place(keyFar) || place(keyClear) || place(standable);
  if (keyTile) {
    state.key = { x: keyTile.x, y: keyTile.y, collected: false, discovered: false };
    state.exit.locked = true;
  }

  const nearChamber = (x, y) => isStandable(terrainAt(state, x, y)) && chebyshev(x, y, ax, ay) >= 2 && chebyshev(x, y, ax, ay) <= 6 && chebyshev(x, y, player.x, player.y) >= 3;
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

  // Ranger Eagle Eye: the whole floor is mapped from the outset.
  if (player.revealFloor) {
    for (let ry = 0; ry < WORLD_SIZE; ry += 1) {
      for (let rx = 0; rx < WORLD_SIZE; rx += 1) state.explored[`${rx},${ry}`] = true;
    }
    if (state.exit) state.exit.discovered = true;
    if (state.key) state.key.discovered = true;
  }

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

function addSpatter(state, x, y) {
  if (!Array.isArray(state.spatters)) state.spatters = [];
  state.spatters.push({ x, y, life: SPATTER_LIFE, max: SPATTER_LIFE });
}
function decaySpatters(spatters) {
  if (!Array.isArray(spatters)) return [];
  return spatters.map((s) => ({ ...s, life: s.life - 1 })).filter((s) => s.life > 0);
}

// One turn's upkeep: age counters, recharge cards, fade blood, and lapse wards.
function passTurn(state) {
  const p = state.player;
  state.turn += 1;
  p.totalTurns = (p.totalTurns || 0) + 1;
  const calmHaste = Boolean(p.spellHaste) && getVisibleEnemies(state).length === 0;
  for (const card of p.cards || []) {
    if (card.remaining > 0) {
      const tick = calmHaste && classCategory(p.className) === 'spell' ? 2 : 1;
      card.remaining = Math.max(0, card.remaining - tick);
    }
  }
  state.spatters = decaySpatters(state.spatters);
  if (p.promotion > 0) p.promotion -= 1; // Promotion (amazon form) wears off after its turns elapse
  p.warded = false;
  p.firstHitUsedThisTurn = false;
  p.attacked = false;
}

function revealSeen(state) {
  if (!state.explored) state.explored = {};
  for (const key of computeVisibleTiles(state)) state.explored[key] = true;
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
  const enemyAt = (x, y) => state.enemies.find((e) => e.x === x && e.y === y) || null;
  const isEnemy = (x, y) => capturableAt(state, x, y);
  const moves = [];
  const seen = new Set();
  const add = (tile) => {
    const key = `${tile.x},${tile.y}`;
    if (seen.has(key)) return;
    seen.add(key);
    moves.push({ x: tile.x, y: tile.y, viaJump: Boolean(tile.viaJump), capture: Boolean(tile.capture) });
  };
  if (p.promotion > 0) {
    // Promotion (Ranger): the king moves as an AMAZON — full queen slides PLUS knight
    // leaps — for a few turns, playing no cards. Click/target any reachable tile.
    const opts = { terrainImmune: Boolean(p.terrainImmune), phaseWalls: Boolean(p.phase) };
    for (const t of generateMoves('amazon', state, p.x, p.y, enemyAt, isEnemy, opts)) add(t);
    return moves;
  }
  const opts = { terrainImmune: Boolean(p.terrainImmune), phaseWalls: Boolean(p.phase) };
  for (const [dx, dy] of [...ORTHO, ...DIAG]) {
    const stops = slideStops(state, p.x, p.y, dx, dy, p.moveRange, enemyAt, isEnemy, opts);
    // The king must COMMIT to the full slide (his moveRange) — he can only stop short
    // where he collides (a wall, edge, or a foe he captures). So only the furthest
    // reachable tile in each direction is a legal destination, never an inner one.
    if (stops.length) add(stops[stops.length - 1]);
  }
  return moves;
}

// Resolve the king arriving on (x, y): attack a boss in place, destroy a summoning
// circle / capture a foe, grab an item, and take the stair.
function applyArrival(next, x, y) {
  const pl = next.player;

  // A boss is ATTACKED IN PLACE (it has HP): the king never steps onto its tile —
  // even the killing blow leaves him where he stands. The boss (which guards the
  // stair) is removed and the level-up boon is granted (see defeatBoss); the king
  // must then walk onto the now-empty stair himself to descend.
  const bossHere = next.enemies.find((e) => e.x === x && e.y === y && e.boss);
  if (bossHere) {
    pl.attacked = true;
    const result = damageBoss(next, bossHere, 1);
    if (result === 'slain') pl.killedEnemy = true;
    if (result === 'slain' && pl.freeKillMove) {
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

  const fromX = pl.x;
  const fromY = pl.y;
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

  // Hex (Sorcerer): a non-pawn foe left standing one tile ahead of the king's advance is
  // demoted to a pawn and startled.
  if (pl.hexDemote && (x - fromX || y - fromY) && !next.gameOver && !next.won) {
    const hx = x + Math.sign(x - fromX);
    const hy = y + Math.sign(y - fromY);
    const foe = next.enemies.find((e) => e.x === hx && e.y === hy);
    if (foe && !foe.boss && !foe.turret && !foe.summonCircle && foe.kind !== 'pawn') {
      foe.kind = 'pawn';
      foe.awake = false;
      foe.surprised = false;
      foe.lastSeen = null;
      foe.lastSeenTtl = 0;
    }
  }

  collectKeyIfHere(next);
  if (tryDescend(next)) return next;

  if (realKill && pl.freeKillMove) {
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
function resolveKill(state, enemy) {
  if (enemy.boss) {
    damageBoss(state, enemy, 1);
    return true;
  }
  state.enemies = state.enemies.filter((e) => e.id !== enemy.id);
  const p = state.player;
  p.killedEnemy = true;
  addSpatter(state, enemy.x, enemy.y);
  // A shattered summoning circle leaves a permanent scar so its ruin stays visible.
  if (enemy.summonCircle) {
    if (!Array.isArray(state.scars)) state.scars = [];
    state.scars.push({ x: enemy.x, y: enemy.y, kind: 'circle' });
  }
  return true;
}

// Strike a tile WITHOUT moving the king (spell path, ranged shot, cleave). Handles
// bosses (HP) and ordinary foes. Returns the slain enemy (or null if nothing fell).
function attackTile(state, tx, ty) {
  const e = state.enemies.find((en) => en.x === tx && en.y === ty);
  if (e && isCapturable(state, e)) {
    if (e.boss) return damageBoss(state, e, 1) === 'slain' ? e : null;
    resolveKill(state, e);
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
  if (p.meleeCleave) cleaveAdjacent(state, ox, oy);
  if (p.meleePierce && (dx || dy)) attackTile(state, ox + dx, oy + dy);
  if (p.meleeLeech) p.hp = Math.min(p.maxHp, p.hp + 1);
  if (p.meleeFlourish) flourishSurprise(state);
}

// If the king now stands on the stair (and the run isn't already won/over), flag the
// descent so the controller drops to the next floor. Returns true when it fires.
function tryDescend(next) {
  if (next.won || next.gameOver) return false;
  if (next.exit && next.player.x === next.exit.x && next.player.y === next.exit.y) {
    if (next.exit.locked) {
      // The king reached the stair but it is sealed until he holds the floor key.
      next.message = 'The stair is sealed — find the floor key first.';
      return false;
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
  if (!p.blink || state.gameOver) return false;
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
  collectKeyIfHere(state);
  state.message = 'The king blinks out of harm’s way!';
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
    next.message = 'You seize the floor key — the stair unlocks!';
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
  // While promoted the king wields no cards — he roams as the amazon.
  if (p.promotion > 0) {
    next.message = 'The amazon needs no cards — strike by moving.';
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

  // Promotion: a FREE action (no turn spent) that turns the king into an amazon for a
  // few turns — he roams as queen + knight and can play no cards until it wears off.
  if (card.kind === 'promotion') {
    p.promotion = PROMOTION_TURNS;
    card.remaining = card.cooldown;
    next.message = 'The Ranger is promoted — she storms the board as an amazon!';
    next.enemyTurn = false;
    next.lastAction = 'card-free';
    updateDiscovery(next);
    return next;
  }
  // Reload: spend the turn to recharge every OTHER card at once.
  if (card.kind === 'reload') {
    for (const c of p.cards) if (c !== card) c.remaining = 0;
    card.remaining = card.cooldown;
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
    next.message = `The king swaps places with a ${unit.kind}.`;
    collectKeyIfHere(next);
    passTurn(next);
    next.enemyTurn = true;
    next.lastAction = 'combat';
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
  p.attacked = true;

  if (category === 'melee') {
    let survived = false;
    const isLeap = Boolean(move.viaJump) && isJumperKind(card.kind);
    if (card.kind === 'enpassant') {
      // The Duellist dashes 2 tiles onto empty ground, then en-passant-strikes the two
      // tiles flanking the square dashed over (never the landing tile itself).
      p.x = x;
      p.y = y;
      next.message = 'The king dashes past!';
      for (const f of move.flanks || []) {
        const felled = attackTile(next, f.x, f.y);
        if (felled && isKillablePiece(felled)) realKill = true;
      }
      scored = realKill;
    } else if (mainTarget && mainTarget.boss) {
      // The boss is struck IN PLACE — the king never steps onto its stair tile, even
      // on the kill (so he must still walk onto the stair afterward to descend).
      survived = damageBoss(next, mainTarget, 1) !== 'slain';
      scored = !survived;
      realKill = scored;
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
    // Trample (leapShock): once the king actually LANDS a knight leap, he strikes every
    // adjacent foe (skipped when a boss was struck in place and he never moved).
    if (isLeap && p.leapShock && p.x === x && p.y === y && !next.gameOver && !next.won) {
      for (const [dx, dy] of [...ORTHO, ...DIAG]) {
        const felled = attackTile(next, x + dx, y + dy);
        if (felled && isKillablePiece(felled)) realKill = true;
      }
    }
    // On-kill perks fan out once (Cleave/Pierce/Leech/Flourish). En-passant's flank
    // strikes carry no single "behind" line, so Pierce is skipped there (dir 0,0).
    if (realKill && !next.gameOver && !next.won) {
      const pdx = card.kind === 'enpassant' ? 0 : Math.sign(x - fromX);
      const pdy = card.kind === 'enpassant' ? 0 : Math.sign(y - fromY);
      applyOnKill(next, x, y, pdx, pdy);
    }
  } else if (category === 'spell' && p.multiShot && !move.viaJump) {
    // Barrage (Conjuration): fire a piercing bolt down EVERY line the piece commands
    // (a rook fires its 4 orthogonals, a queen all 8), striking every unit on each.
    const reach = cardReach(card.kind, p.cardReach || 0);
    for (const [dx, dy] of cardSlideDirs(card.kind)) {
      let cx = fromX;
      let cy = fromY;
      for (let i = 0; i < reach; i += 1) {
        cx += dx;
        cy += dy;
        if (cx < 0 || cx >= WORLD_SIZE || cy < 0 || cy >= WORLD_SIZE) break;
        if (terrainAt(next, cx, cy) === 'wall' && !p.seeThroughWalls) break;
        const felled = attackTile(next, cx, cy);
        if (felled && isKillablePiece(felled)) kills.push(felled);
      }
    }
    scored = kills.length > 0;
    realKill = kills.length > 0;
    if (!next.gameOver && !next.won && p.spellDazzle) {
      for (const s of kills) {
        for (const [dx, dy] of [...ORTHO, ...DIAG]) {
          const e = next.enemies.find((en) => en.x === s.x + dx && en.y === s.y + dy);
          if (e && !e.boss && unitInSight(next, e.x, e.y)) e.awake = false;
        }
      }
    }
  } else {
    if (category === 'spell' && !move.viaJump) {
      for (const t of straightPath(fromX, fromY, x, y)) {
        const felled = attackTile(next, t.x, t.y);
        if (felled && isKillablePiece(felled)) kills.push(felled);
      }
    }
    const mainFelled = attackTile(next, x, y);
    if (mainFelled) {
      scored = true;
      if (isKillablePiece(mainFelled)) kills.push(mainFelled);
    }
    realKill = kills.length > 0;
    if (!next.gameOver && !next.won && category === 'spell' && p.spellDazzle) {
      for (const s of kills) {
        for (const [dx, dy] of [...ORTHO, ...DIAG]) {
          const e = next.enemies.find((en) => en.x === s.x + dx && en.y === s.y + dy);
          if (e && !e.boss && unitInSight(next, e.x, e.y)) e.awake = false;
        }
      }
    }
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

  const free = (category === 'spell' && p.freeSpell) || rapidTrigger;
  if (!rapidTrigger) card.remaining = card.cooldown;
  // Keen Edge (meleeRefund): a card that scored a kill recharges one turn faster.
  if (category === 'melee' && realKill && p.meleeRefund) card.remaining = Math.max(0, card.remaining - 1);
  if (!scored && !next.message) next.message = 'The card strikes.';
  if (free) {
    next.enemyTurn = false;
    next.lastAction = 'card-free';
  } else {
    passTurn(next);
    next.enemyTurn = true;
    next.lastAction = 'combat';
  }
  updateDiscovery(next);
  return next;
}

// Move the king to a specific reachable tile (click-to-move).
function movePlayerTo(state, x, y) {
  const next = structuredClone(state);
  const reachable = getPlayerMoves(next).some((move) => move.x === x && move.y === y);
  if (!reachable) {
    next.message = 'The king cannot reach that tile.';
    next.lastAction = 'blocked';
    return next;
  }
  return applyArrival(next, x, y);
}

// Keyboard movement: a single ground step in a direction.
function movePlayer(state, dx, dy) {
  const enemyAt = (x, y) => state.enemies.find((e) => e.x === x && e.y === y) || null;
  const isEnemy = (x, y) => capturableAt(state, x, y);
  // Slide the king's FULL move range (2+ with Fleet), stopping only on collision —
  // the furthest reachable stop is the destination.
  const stops = slideStops(state, state.player.x, state.player.y, dx, dy, state.player.moveRange, enemyAt, isEnemy, { terrainImmune: Boolean(state.player.terrainImmune), phaseWalls: Boolean(state.player.phase) });
  if (!stops.length) {
    const next = structuredClone(state);
    next.message = 'The king cannot move that way.';
    next.lastAction = 'blocked';
    return next;
  }
  const dest = stops[stops.length - 1];
  return movePlayerTo(state, dest.x, dest.y);
}

/* ------------------------------ enemy phase ------------------------------- */

// An unaware enemy shuffles one tile at random, never into the king's sight (so it
// only ever pokes into view because the KING moved, and is reliably surprised).
function wanderEnemy(state, enemy) {
  const unitAt = (x, y) => {
    if (x === state.player.x && y === state.player.y) return 'player';
    if (keyTileAt(state, x, y)) return 'key'; // enemies never path onto the floor key
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
    if (!unitInSight(state, dest.x, dest.y)) candidates.push(dest);
  }
  if (!candidates.length) return null;
  const pick = candidates[randomInt(candidates.length)];
  enemy.x = pick.x;
  enemy.y = pick.y;
  return null;
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
function beginEnemyPhase(state) {
  const next = structuredClone(state);
  let moverIds = [];
  const p = next.player;
  const stealthed = Boolean(p.stealth) && !p.attacked;
  recordSeenEnemies(next);

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
    const hiddenFromThis = stealthed && !enemy.awake && chebyshev(enemy.x, enemy.y, p.x, p.y) > 1;
    if (hiddenFromThis || !unitInSight(next, enemy.x, enemy.y)) {
      enemy.awake = false;
      enemy.surprised = false;
      if (!isStationary(enemy)) {
        // Ghost (noChase): the king shakes pursuers the instant he breaks sight, so a
        // foe that has lost him wanders instead of hunting his last-seen tile.
        const canPursue = !p.noChase && enemy.lastSeen && enemy.lastSeenTtl > 0 && pursueLastSeen(next, enemy);
        if (!canPursue) wanderEnemy(next, enemy);
      }
      // Pursuing/wandering can carry an enemy INTO the king's view. It has already
      // spent its move this turn, but it must NOT be left flagged "unaware" while
      // sitting on screen — a hunter that steps into sight is plainly hostile. Mark
      // it aware and refresh its memory so it acts as a mover next turn.
      if (!hiddenFromThis && unitInSight(next, enemy.x, enemy.y)) {
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
    state.player.hp -= 1;
    state.player.wasHit = true;
    addSpatter(state, state.player.x, state.player.y);
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
function knockbackKing(state, enemy) {
  const king = state.player;
  let pdx = Math.sign(king.x - enemy.x);
  let pdy = Math.sign(king.y - enemy.y);
  if (pdx === 0 && pdy === 0) pdx = 1;
  const bx = king.x + pdx;
  const by = king.y + pdy;
  const occupied = (x, y) => state.enemies.some((e) => e.id !== enemy.id && e.x === x && e.y === y);
  const canPush = bx >= 0 && bx < WORLD_SIZE && by >= 0 && by < WORLD_SIZE && standableFor(terrainAt(state, bx, by), {}) && !occupied(bx, by);
  const mit = rollMitigation(king);
  if (!mit) {
    king.hp -= 1;
    king.wasHit = true;
    addSpatter(state, king.x, king.y);
  }
  if (canPush) {
    const kx = king.x;
    const ky = king.y;
    king.x = bx;
    king.y = by;
    enemy.x = kx;
    enemy.y = ky;
  }
  if (mit) {
    state.message = mitigationMessage(mit, enemy.kind);
    state.lastAction = 'enemy';
  } else {
    state.message = canPush ? `A ${enemy.kind} bowls the king aside!` : `A ${enemy.kind} leaps upon the king!`;
    state.lastAction = 'hit';
    checkDeath(state);
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
  const legal = moves.filter((m) => !(m.x === king.x && m.y === king.y));
  if (!legal.length) {
    enemy.frustrated = true;
    state.message = 'A cornered piece fumes, unable to move.';
    state.lastAction = 'enemy';
    return state;
  }
  const chosen = chooseHostileMove(legal, king.x, king.y);
  enemy.x = chosen.x;
  enemy.y = chosen.y;
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
    addSpatter(state, state.player.x, state.player.y);
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

// A boss's turn: hunt like its piece, and strike ONLY if it can capture the king.
function bossMove(state, boss) {
  const king = state.player;
  // A dormant guardian holds the stair until the king strikes it (hp < maxHp) or
  // steps adjacent — then it rouses for good.
  if (boss.dormant) {
    if (boss.hp < boss.maxHp || chebyshev(boss.x, boss.y, king.x, king.y) <= 1) {
      boss.dormant = false;
    } else {
      state.message = `${bossTitle(boss)} guards the stair, unmoving.`;
      state.lastAction = 'enemy';
      return state;
    }
  }
  const moves = getPieceMoves(boss, state);
  const canCapture = moves.some((m) => m.x === king.x && m.y === king.y);
  if (canCapture) {
    if (isJumperKind(boss.kind)) return knockbackKing(state, boss);
    return bossHit(state, boss, `${bossTitle(boss)} strikes the king!`);
  }
  const legal = moves.filter((m) => !(m.x === king.x && m.y === king.y));
  if (!legal.length) {
    boss.frustrated = true;
    state.message = `${bossTitle(boss)} fumes.`;
    state.lastAction = 'enemy';
    return state;
  }
  const chosen = chooseHostileMove(legal, king.x, king.y);
  boss.x = chosen.x;
  boss.y = chosen.y;
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

// Difficulty over time: drop fresh enemies just BEYOND the king's sight so they
// close in on him — the safe bubble shrinks the longer he lingers. Spawns come
// faster (and, at the danger ceiling, twice as many) the longer he stays.
function maybeSpawnEnemy(state) {
  const next = structuredClone(state);
  next.turnsSinceSpawn += 1;
  const maxed = next.turn >= MAX_TURNS_SCARY; // lingered to the danger ceiling
  const ramp = Math.min(1, next.turn / MAX_TURNS_SCARY);
  // Turns between spawns (shrinks as dread ramps). Toned down 50% from before — the
  // interval is the full base (was halved), so foes trickle in half as fast.
  const interval = Math.max(1, Math.round(next.spawnInterval - (next.spawnInterval - 2) * ramp));
  const cap = Math.min(MAX_ENEMIES, 14 + next.floor * 5);
  if (next.turnsSinceSpawn < interval || next.enemies.length >= cap) return next;
  next.turnsSinceSpawn = 0;
  const bursts = maxed ? 2 : 1; // at max danger the spawns come twice as fast
  const radius = Math.floor((next.player.vision || STARTING_VISION) / 2);
  for (let b = 0; b < bursts; b += 1) {
    if (next.enemies.length >= cap) break;
    const occupied = new Set([`${next.player.x},${next.player.y}`]);
    for (const enemy of next.enemies) occupied.add(`${enemy.x},${enemy.y}`);
    // A spawn tile must be standable, unseen, AND let this kind actually move (never
    // drop a piece where it's terrain-stuck — e.g. a knight in a corridor).
    const kind = randomEnemyKind(next.floor);
    const ok = (x, y) => isStandable(terrainAt(next, x, y)) && !inLineOfSight(next, x, y) && !keyTileAt(next, x, y) && kindCanMove(next, kind, x, y);
    // Prefer the ring just outside sight (encroaching); else anywhere unseen it can move.
    const dist = (x, y) => chebyshev(x, y, next.player.x, next.player.y);
    const tile = findFreeTile(occupied, (x, y) => ok(x, y) && dist(x, y) <= radius + 2)
      || findFreeTile(occupied, ok);
    if (tile) next.enemies.push(createEnemy(kind, tile.x, tile.y));
  }
  return next;
}

/* --------------------------------- upkeep --------------------------------- */

// Record any enemy kinds the king can currently see.
function recordSeenEnemies(state) {
  const p = state.player;
  if (!Array.isArray(p.seenKinds)) p.seenKinds = [];
  for (const enemy of getVisibleEnemies(state)) {
    if (!p.seenKinds.includes(enemy.kind)) p.seenKinds.push(enemy.kind);
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

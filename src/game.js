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
    // Object roles (at most one): inert statue, fixed turret, boss, or a
    // destroyable summoning circle. Ordinary enemies carry none.
    statue: false,
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
  if (enemy.statue) return 'statue';
  if (enemy.turret) return 'turret';
  if (enemy.summonCircle) return 'circle';
  return 'normal';
}

const JUMPER_KINDS = ['knight', 'archbishop', 'chancellor', 'amazon'];
function isJumperKind(kind) {
  return JUMPER_KINDS.includes(kind);
}

// Whether an enemy may be captured/destroyed by the king right now. Statues and
// turrets are untouchable; a summoning circle is destroyed by stepping on it; a
// boss is targetable but soaks HP (handled specially). Ordinary pieces die in one.
function isCapturable(state, enemy) {
  if (!enemy) return false;
  if (enemy.statue || enemy.turret) return false;
  return true;
}
function capturableAt(state, x, y) {
  return isCapturable(state, state.enemies.find((e) => e.x === x && e.y === y));
}

// Has the floor's boss been defeated? True when no boss piece remains.
function bossDefeated(state) {
  return !state.enemies.some((e) => e.boss);
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

// Resolve the floor's boss being slain: the final floor wins the run.
function defeatBoss(state, x, y) {
  if (isFinalBossFloor(state.floor)) {
    state.won = true;
    state.message = 'The final guardian falls — the realm is free!';
  } else {
    state.message = 'The guardian falls — the way down is clear!';
  }
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
// turn), or a Parry ward from a strike last turn. Null means the hit lands.
function rollMitigation(player) {
  if (player.warded) return 'parry';
  if (player.firstHitEachTurn && !player.firstHitUsedThisTurn) {
    player.firstHitUsedThisTurn = true;
    return 'ward';
  }
  return null;
}
function mitigationMessage(mit, kind) {
  if (mit === 'parry') return `The king parries a ${kind}!`;
  if (mit === 'ward') return `A ward absorbs a ${kind}'s blow!`;
  return `The king shrugs off a ${kind}!`;
}

/* ------------------------------ consumables ------------------------------- */

function randomConsumable() {
  return POTION_KINDS[randomInt(POTION_KINDS.length)];
}

// Drink a potion: an immediate boon.
function applyConsumable(state, potion) {
  const p = state.player;
  if (potion === 'health') {
    p.hp = p.maxHp;
    state.message = 'A Potion of Healing restores you to full health.';
  } else if (potion === 'mana') {
    for (const card of p.cards || []) card.remaining = 0;
    state.message = 'A Potion of Mending recharges every card.';
  }
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
  'reflect', 'firstHitEachTurn', 'freeKillMove', 'extraLife', 'stealth', 'terrainImmune',
  'revealFloor', 'freePotion', 'spellHaste', 'freeSpell', 'spellSurprise',
  'meleeCleave', 'meleeLeech', 'rangedRapid', 'spellDazzle',
];

// Build a card record.
function makeCard(kind, category) {
  return { kind, category: category || 'melee', cooldown: cardCooldown(kind, category || 'melee'), remaining: 0 };
}

// Apply a perk's grants to a player (stat bumps, a card, or a rule flag).
function applyPerk(player, grants) {
  if (!grants) return;
  if (grants.maxHp) {
    player.maxHp += grants.maxHp;
    player.hp += grants.maxHp;
  }
  if (grants.vision) player.vision += grants.vision;
  if (grants.moveRange) player.moveRange += grants.moveRange;
  if (grants.cardReach) player.cardReach = (player.cardReach || 0) + grants.cardReach;
  if (grants.maxConsumables) player.maxConsumables += grants.maxConsumables;
  if (grants.gainCard) player.cards.push(makeCard(grants.gainCard.kind, grants.gainCard.category));
  for (const flag of PERK_FLAGS) {
    if (grants[flag]) player[flag] = true;
  }
}

// Build a fresh king of the chosen class: base stats + its starting card.
function createPlayer(classKey) {
  const cls = CLASSES[classKey] || CLASSES.warrior;
  const player = {
    x: PLAYER_START.x,
    y: PLAYER_START.y,
    hp: STARTING_HP,
    maxHp: STARTING_HP,
    level: 1,
    className: CLASSES[classKey] ? classKey : 'warrior',
    moveRange: 1,
    vision: STARTING_VISION,
    cardReach: 0,
    cards: [],
    maxConsumables: STARTING_CONSUMABLE_SLOTS,
    consumables: [],
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
  player.cards.push(makeCard(cls.start.kind, cls.start.category));
  return player;
}

// The three perks offered on a descent: from the king's class pool, excluding
// unique perks already taken (repeatable perks may recur). Falls back to whatever
// remains so a choice is always available.
function rollLevelPerks(player, count) {
  const cls = CLASSES[player.className] || CLASSES.warrior;
  const eligible = cls.perks.filter((perk) => perk.repeatable || !player.takenPerks.includes(perk.id));
  return pickSome(eligible.length ? eligible : cls.perks, count || LEVEL_PERK_CHOICES);
}

// Learn a level-up perk (by id) from the king's class pool.
function learnPerk(state, perkId) {
  const next = structuredClone(state);
  const p = next.player;
  const cls = CLASSES[p.className] || CLASSES.warrior;
  const perk = cls.perks.find((k) => k.id === perkId);
  if (!perk || (!perk.repeatable && p.takenPerks.includes(perkId))) {
    next.pendingLevelUp = false;
    return next;
  }
  applyPerk(p, perk.grants);
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

// Scatter the floor's terrain (walls / water / lava per the level recipe), keeping
// the tiles around the king's start clear.
function generateTerrain(floor, player) {
  const terrain = {};
  const nearStart = (x, y) => chebyshev(x, y, player.x, player.y) <= 2;
  const put = (x, y, type) => {
    if (x < 1 || x >= WORLD_SIZE - 1 || y < 1 || y >= WORLD_SIZE - 1) return;
    if (nearStart(x, y)) return;
    terrain[`${x},${y}`] = type;
  };
  const blob = (type, patches, spread) => {
    for (let i = 0; i < patches; i += 1) {
      const cx = randomInt(WORLD_SIZE);
      const cy = randomInt(WORLD_SIZE);
      const cells = 3 + randomInt(spread);
      for (let j = 0; j < cells; j += 1) put(cx + randomInt(3) - 1, cy + randomInt(3) - 1, type);
    }
  };
  const wallLine = (segments, length) => {
    for (let i = 0; i < segments; i += 1) {
      let x = randomInt(WORLD_SIZE);
      let y = randomInt(WORLD_SIZE);
      const horizontal = Math.random() < 0.5;
      for (let j = 0; j < length; j += 1) {
        put(x, y, 'wall');
        if (horizontal) x += 1;
        else y += 1;
      }
    }
  };
  const level = levelForFloor(floor);
  const recipe = (level && level.recipe) || {};
  const cycle = Math.floor((floor - 1) / FINAL_FLOOR);
  const scale = 1 + cycle * 0.5;
  const seeds = (type) => Math.round((recipe[type] || 0) * scale);
  if (seeds('water')) blob('water', 2 * seeds('water'), 5);
  if (seeds('lava')) blob('lava', 2 * seeds('lava'), 5);
  if (seeds('wall')) wallLine(2 * seeds('wall'), 3);
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
    itemMemory: {},
    enemies: [],
    items: [],
    spatters: [],
    exit: null,
    floor,
    turn: 0,
    score: score || 0,
    enemyTurn: false,
    gameOver: false,
    won: false,
    pendingLevelUp: false,
    levelPerks: null,
    message: 'A new floor. Seek the exit.',
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
  function addEnemy(type, x, y, surprised) {
    const enemy = createEnemy(type, x, y);
    enemy.surprised = Boolean(surprised);
    state.enemies.push(enemy);
  }

  // Wandering off-screen enemies, growing with depth (capped).
  const offscreenCount = Math.min(5 + floor * 3, MAX_ENEMIES);
  for (let i = 0; i < offscreenCount; i += 1) {
    const tile = place((x, y) => standable(x, y) && !seen(x, y) && chebyshev(x, y, player.x, player.y) >= 2);
    if (!tile) break;
    addEnemy(randomEnemyKind(floor), tile.x, tile.y, false);
  }

  // Floor 1 introduces the game with one visible, surprised foe.
  if (floor === 1) {
    const tile = place((x, y) => standable(x, y) && seen(x, y) && chebyshev(x, y, player.x, player.y) >= 2);
    if (tile) addEnemy(randomEnemyKind(floor), tile.x, tile.y, true);
  }

  // The exit + boss chamber sit at the floor's fixed anchor, ringed by a wall (or a
  // lava/water moat on watery/fiery floors) with a doorway facing the king. The
  // boss and a backup cohort (turrets / statues / summoning circles / sleeping
  // pieces) guard it.
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

  const bossSpot = place((x, y) => isStandable(terrainAt(state, x, y)) && chebyshev(x, y, ax, ay) === 1 && chebyshev(x, y, player.x, player.y) >= 3);
  if (bossSpot) state.enemies.push(createBoss(floor, bossSpot.x, bossSpot.y));

  const nearChamber = (x, y) => isStandable(terrainAt(state, x, y)) && chebyshev(x, y, ax, ay) >= 2 && chebyshev(x, y, ax, ay) <= 5 && chebyshev(x, y, player.x, player.y) >= 3;
  // Sleeping backup pieces near the boss.
  for (let i = 0; i < 3 + Math.floor(floor / 2); i += 1) {
    const spot = place(nearChamber);
    if (spot) state.enemies.push(createEnemy(randomEnemyKind(floor), spot.x, spot.y));
  }
  // Turrets guarding the chamber (from floor 3).
  if (floor >= 3) {
    for (let i = 0; i < 1 + Math.floor(floor / 3); i += 1) {
      const spot = place(nearChamber);
      if (spot) {
        const t = createEnemy(randomEnemyKind(floor), spot.x, spot.y);
        t.turret = true;
        state.enemies.push(t);
      }
    }
  }
  // A summoning circle or two (from floor 2).
  if (floor >= 2) {
    for (let i = 0; i < 1 + Math.floor(floor / 4); i += 1) {
      const spot = place(nearChamber);
      if (spot) {
        const c = createEnemy('pawn', spot.x, spot.y);
        c.summonCircle = true;
        state.enemies.push(c);
      }
    }
  }

  // Potions dropped on the ground (grabbed by stepping on them; trampled by foes).
  const potionCount = 2 + randomInt(3);
  for (let i = 0; i < potionCount; i += 1) {
    const tile = place((x, y) => standable(x, y) && chebyshev(x, y, player.x, player.y) >= 3);
    if (tile) state.items.push({ kind: 'consumable', potion: randomConsumable(), x: tile.x, y: tile.y });
  }

  // Loose statues scattered out of sight (the Crypt has extra).
  const statueCount = (level && level.statues ? level.statues : 0) + (floor >= 2 ? 1 + randomInt(2) : 0);
  for (let i = 0; i < statueCount; i += 1) {
    const tile = place((x, y) => standable(x, y) && !seen(x, y) && chebyshev(x, y, player.x, player.y) >= 3);
    if (tile) {
      const s = createEnemy(randomEnemyKind(floor), tile.x, tile.y);
      s.statue = true;
      state.enemies.push(s);
    }
  }

  // Ranger Eagle Eye: the whole floor is mapped from the outset.
  if (player.revealFloor) {
    for (let ry = 0; ry < WORLD_SIZE; ry += 1) {
      for (let rx = 0; rx < WORLD_SIZE; rx += 1) state.explored[`${rx},${ry}`] = true;
    }
    if (state.exit) state.exit.discovered = true;
  }

  updateDiscovery(state);
  return state;
}

function createInitialState(classKey) {
  return generateFloor(1, createPlayer(classKey || 'warrior'), 0);
}

// Descending: fully heal, refresh cards, reset per-floor flags, and queue a level-up
// perk choice. The controller shows the choice, then the next floor is built.
function nextFloor(state) {
  const healed = { ...state.player, hp: state.player.maxHp };
  healed.cards = (healed.cards || []).map((c) => ({ ...c, remaining: 0 }));
  healed.level = (healed.level || 1) + 1;
  healed.extraLifeUsed = false;
  const next = generateFloor(state.floor + 1, healed, state.score);
  next.pendingLevelUp = true;
  next.levelPerks = rollLevelPerks(next.player, LEVEL_PERK_CHOICES);
  next.message = `You reach level ${next.player.level}. Choose a boon.`;
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

// One turn's upkeep: age counters, recharge cards, fade blood, lapse wards, and
// crush any potions trodden underfoot.
function passTurn(state) {
  const p = state.player;
  state.turn += 1;
  p.totalTurns = (p.totalTurns || 0) + 1;
  const calmHaste = Boolean(p.spellHaste) && getVisibleEnemies(state).length === 0;
  for (const card of p.cards || []) {
    if (card.remaining > 0) {
      const tick = calmHaste && (card.category || 'melee') === 'spell' ? 2 : 1;
      card.remaining = Math.max(0, card.remaining - tick);
    }
  }
  state.spatters = decaySpatters(state.spatters);
  p.warded = false;
  p.firstHitUsedThisTurn = false;
  p.attacked = false;
  trampleItems(state);
}

// Record item memory (last-seen pickup at each explored tile) from what's in view.
function rememberItems(state) {
  if (!state.itemMemory) state.itemMemory = {};
  for (const key of computeVisibleTiles(state)) {
    const [x, y] = key.split(',').map(Number);
    const item = state.items.find((i) => i.x === x && i.y === y);
    if (item) state.itemMemory[key] = { kind: item.kind, potion: item.potion };
    else delete state.itemMemory[key];
  }
}

function revealSeen(state) {
  if (!state.explored) state.explored = {};
  for (const key of computeVisibleTiles(state)) state.explored[key] = true;
}

// Reveal newly-seen ground, and remember the exit once explored.
function updateDiscovery(state) {
  revealSeen(state);
  rememberItems(state);
  if (state.exit && state.explored[`${state.exit.x},${state.exit.y}`]) state.exit.discovered = true;
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
  const opts = { terrainImmune: Boolean(p.terrainImmune) };
  for (const [dx, dy] of [...ORTHO, ...DIAG]) {
    for (const stop of slideStops(state, p.x, p.y, dx, dy, p.moveRange, enemyAt, isEnemy, opts)) add(stop);
  }
  return moves;
}

// Resolve the king arriving on (x, y): attack a boss in place, destroy a summoning
// circle / capture a foe, grab an item, and take the stair.
function applyArrival(next, x, y) {
  const pl = next.player;

  // A boss is ATTACKED IN PLACE (it has HP): the king only steps onto its tile if
  // the blow fells it.
  const bossHere = next.enemies.find((e) => e.x === x && e.y === y && e.boss);
  if (bossHere) {
    pl.attacked = true;
    const result = damageBoss(next, bossHere, 1);
    if (result === 'slain') {
      pl.x = x;
      pl.y = y;
      pl.killedEnemy = true;
    }
    if (result === 'slain' && pl.freeKillMove) {
      next.enemyTurn = false;
      next.lastAction = 'move-free';
    } else {
      passTurn(next);
      next.enemyTurn = true;
    }
    updateDiscovery(next);
    return next;
  }

  next.player.x = x;
  next.player.y = y;
  next.enemyTurn = true;
  next.lastAction = 'move';
  next.message = 'The king moves.';

  const enemy = next.enemies.find((e) => e.x === x && e.y === y);
  let killed = false;
  if (enemy) {
    resolveKill(next, enemy);
    pl.attacked = true;
    killed = true;
    next.message = enemy.summonCircle ? 'The king shatters a summoning circle!' : `The king defeats a ${enemy.kind}.`;
    next.lastAction = 'combat';
  }

  // Grab a potion lying on the tile (if there's satchel space).
  const item = next.items.find((i) => i.x === x && i.y === y);
  if (item) {
    if (!Array.isArray(pl.consumables)) pl.consumables = [];
    if (pl.consumables.length < pl.maxConsumables) {
      pl.consumables.push(item.potion);
      next.items = next.items.filter((i) => i !== item);
      next.message = `You pick up a ${CONSUMABLES[item.potion].name}.`;
    } else {
      next.message = 'Your satchel is full — no room for that potion.';
    }
  }

  if (next.exit && next.exit.x === x && next.exit.y === y) {
    next.lastAction = 'exit';
    next.message = 'You step onto the stair and descend...';
    return next;
  }

  // Statues wake the moment the king steps beside them.
  for (const e of next.enemies) {
    if (e.statue && chebyshev(e.x, e.y, x, y) <= 1) {
      e.statue = false;
      e.awake = false;
      e.surprised = false;
      next.awokeStatue = true;
      next.message = `A ${e.kind} statue cracks to life!`;
    }
  }

  if (killed && pl.freeKillMove) {
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
  return true;
}

// Strike a tile WITHOUT moving the king (spell path, ranged shot, cleave). Handles
// bosses (HP) and ordinary foes. Returns true if a unit was slain.
function attackTile(state, tx, ty) {
  const e = state.enemies.find((en) => en.x === tx && en.y === ty);
  if (e && isCapturable(state, e)) {
    if (e.boss) return damageBoss(state, e, 1) === 'slain';
    resolveKill(state, e);
    return true;
  }
  return false;
}

function cleaveAdjacent(state, x, y) {
  for (const [dx, dy] of [...ORTHO, ...DIAG]) {
    if (attackTile(state, x + dx, y + dy)) return;
  }
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
  if (isSlowTerrain(terrainAt(next, p.x, p.y))) {
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

  const category = card.category || 'melee';
  const fromX = p.x;
  const fromY = p.y;
  const mainTarget = next.enemies.find((e) => e.x === x && e.y === y);
  let scored = false;
  const slain = [];
  p.attacked = true;

  if (category === 'melee') {
    let survived = false;
    if (mainTarget && mainTarget.boss) {
      survived = damageBoss(next, mainTarget, 1) !== 'slain';
      if (!survived) { p.x = x; p.y = y; }
    } else if (mainTarget) {
      resolveKill(next, mainTarget);
      p.x = x;
      p.y = y;
    }
    scored = Boolean(mainTarget) && !survived;
    if (scored) slain.push({ x, y });
    if (!next.gameOver && !next.won) {
      if (scored && p.meleeCleave) cleaveAdjacent(next, x, y);
      if (scored && p.meleeLeech) p.hp = Math.min(p.maxHp, p.hp + 1);
    }
  } else {
    if (category === 'spell') {
      if (!move.viaJump) {
        for (const t of straightPath(fromX, fromY, x, y)) {
          if (attackTile(next, t.x, t.y)) slain.push(t);
        }
      }
    }
    if (attackTile(next, x, y)) {
      scored = true;
      slain.push({ x, y });
    }
    if (!next.gameOver && !next.won) {
      if (category === 'ranged' && p.rangedRapid && scored) {
        // fall through — the free follow-up is handled by the cooldown/turn logic
      }
      if (category === 'spell' && p.spellDazzle) {
        for (const s of slain) {
          for (const [dx, dy] of [...ORTHO, ...DIAG]) {
            const e = next.enemies.find((en) => en.x === s.x + dx && en.y === s.y + dy);
            if (e && !e.boss && !e.statue && unitInSight(next, e.x, e.y)) e.awake = false;
          }
        }
      }
    }
  }

  if (category === 'spell' && p.spellSurprise && !next.gameOver && !next.won) {
    for (const e of next.enemies) {
      if (!e.boss && !e.statue && unitInSight(next, e.x, e.y)) e.awake = false;
    }
  }

  // Quick Draw (rangedRapid): a kill grants ONE immediate free follow-up.
  const rapidFollowup = Boolean(card.rapidReady);
  card.rapidReady = false;
  const rapidTrigger = category === 'ranged' && p.rangedRapid && scored && !rapidFollowup;
  if (rapidTrigger) card.rapidReady = true;

  const free = (category === 'spell' && p.freeSpell) || rapidTrigger;
  if (!rapidTrigger) card.remaining = card.cooldown;
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
  const isEnemy = (x, y) => Boolean(enemyAt(x, y));
  const stops = slideStops(state, state.player.x, state.player.y, dx, dy, 1, enemyAt, isEnemy, { terrainImmune: Boolean(state.player.terrainImmune) });
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
  return enemy.turret || enemy.summonCircle;
}

// Resolve sight at the start of an enemy turn, per piece, and collect the pieces
// that get to act (movers).
function beginEnemyPhase(state) {
  const next = structuredClone(state);
  let moverIds = [];
  const p = next.player;
  const stealthed = Boolean(p.stealth) && !p.attacked;
  recordSeenEnemies(next);

  for (const enemy of next.enemies) {
    const wasSurprised = enemy.surprised;
    enemy.frustrated = false;
    if (enemy.statue) continue;
    const hiddenFromThis = stealthed && !enemy.awake && chebyshev(enemy.x, enemy.y, p.x, p.y) > 1;
    if (hiddenFromThis || !unitInSight(next, enemy.x, enemy.y)) {
      enemy.awake = false;
      enemy.surprised = false;
      if (!isStationary(enemy)) {
        if (!(enemy.lastSeen && enemy.lastSeenTtl > 0 && pursueLastSeen(next, enemy))) {
          wanderEnemy(next, enemy);
        }
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
  return state;
}

// Conjure a fresh minion on a free tile beside `origin`.
function summonAdjacent(state, origin) {
  const dirs = [...ORTHO, ...DIAG];
  for (let i = dirs.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [dirs[i], dirs[j]] = [dirs[j], dirs[i]];
  }
  for (const [dx, dy] of dirs) {
    const x = origin.x + dx;
    const y = origin.y + dy;
    if (x < 0 || x >= WORLD_SIZE || y < 0 || y >= WORLD_SIZE) continue;
    if (!isStandable(terrainAt(state, x, y))) continue;
    if (x === state.player.x && y === state.player.y) continue;
    if (state.enemies.some((e) => e.x === x && e.y === y)) continue;
    const minion = createEnemy(randomEnemyKind(state.floor), x, y);
    minion.summoned = true;
    minion.awake = true;
    state.enemies.push(minion);
    return true;
  }
  return false;
}

// A summoning circle's turn: while the king can see it, it conjures a minion on
// charged turns (never two turns running). It never moves and never strikes.
function summonCircleTurn(state, circle) {
  if (circle.charged && state.enemies.length < MAX_ENEMIES && summonAdjacent(state, circle)) {
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
  } else {
    state.message = mitigationMessage(mit, enemy.kind);
    state.lastAction = 'enemy';
  }
  return state;
}

// A boss's turn: hunt like its piece, and strike ONLY if it can capture the king.
function bossMove(state, boss) {
  const king = state.player;
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
  const enemy = next.enemies.find((piece) => piece.id === enemyId);
  if (!enemy) return next;
  if (enemy.boss) return bossMove(next, enemy);
  if (enemy.turret) return fireTurret(next, enemy);
  if (enemy.summonCircle) return summonCircleTurn(next, enemy);
  return meleeMove(next, enemy);
}

// Difficulty over time: drop fresh enemies out of sight, faster the longer the king
// lingers.
function maybeSpawnEnemy(state) {
  const next = structuredClone(state);
  next.turnsSinceSpawn += 1;
  const ramp = Math.min(1, next.turn / MAX_TURNS_SCARY);
  const interval = Math.max(1, Math.round((next.spawnInterval - (next.spawnInterval - 2) * ramp) / 2));
  const cap = Math.min(MAX_ENEMIES, 8 + next.floor * 3);
  if (next.turnsSinceSpawn < interval || next.enemies.length >= cap) return next;
  next.turnsSinceSpawn = 0;
  const occupied = new Set([`${next.player.x},${next.player.y}`]);
  for (const enemy of next.enemies) occupied.add(`${enemy.x},${enemy.y}`);
  for (const item of next.items) occupied.add(`${item.x},${item.y}`);
  const tile = findFreeTile(occupied, (x, y) => isStandable(terrainAt(next, x, y)) && !inLineOfSight(next, x, y));
  if (tile) next.enemies.push(createEnemy(randomEnemyKind(next.floor), tile.x, tile.y));
  return next;
}

/* ------------------------------- consumables ------------------------------ */

// Drink a held potion (by satchel index): a turn passes so enemies then move.
function consumeItem(state, index) {
  const next = structuredClone(state);
  const p = next.player;
  if (!Array.isArray(p.consumables) || index < 0 || index >= p.consumables.length) {
    next.message = 'No such potion.';
    next.lastAction = 'blocked';
    return next;
  }
  const potion = p.consumables[index];
  if (p.freePotion) {
    applyConsumable(next, potion);
    p.consumables.splice(index, 1);
    next.enemyTurn = false;
    next.lastAction = 'consume-free';
    updateDiscovery(next);
    return next;
  }
  passTurn(next);
  next.enemyTurn = true;
  applyConsumable(next, potion);
  p.consumables.splice(index, 1);
  next.lastAction = 'consume';
  updateDiscovery(next);
  return next;
}

/* --------------------------------- upkeep --------------------------------- */

// Ground potions in the king's sight are trampled away by any foe standing on them.
function trampleItems(state) {
  if (!Array.isArray(state.items) || !state.items.length) return;
  state.items = state.items.filter((item) => {
    const foe = state.enemies.some((e) => e.x === item.x && e.y === item.y);
    if (foe && inLineOfSight(state, item.x, item.y)) return false; // crushed underfoot
    return true;
  });
}

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

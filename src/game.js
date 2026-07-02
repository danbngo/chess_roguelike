// Core game rules: building floors, and resolving king / enemy / shop actions.
// Pure logic — no DOM, no canvas, no storage.

function createEnemy(type, x, y) {
  return {
    id: `${type}-${x}-${y}-${Math.random().toString(16).slice(2, 8)}`,
    kind: type,
    x,
    y,
    homeX: x, // spawn tile (skirmishers retreat here after a strike)
    homeY: y,
    awake: false,
    surprised: false,
    frustrated: false,
    // Special roles — at most one per piece (the "status"). All default off:
    //   statue     - inert stone until the king steps beside it, then it wakes.
    //   turret     - a fixed emplacement that fires its piece pattern; never
    //                moves and cannot be destroyed.
    //   boss       - the floor's guardian; cannot be captured while killable
    //                guards remain in sight, and its fall opens the descent.
    //   skirmisher - hits and runs: retreats to its spawn after striking; half
    //                the time it darts about instead of closing in.
    //   armored    - shrugs off the first hit (losing the armor and flinging the
    //                king back to his start); lumbers, moving only on odd turns.
    //   summoner   - conjures fresh pieces beside it (odd turns); never strikes.
    //   summoned   - conjured; vanishes when no summoner is in sight.
    //   mage       - fires a piercing ranged blast along its line (odd turns),
    //                slaying everything between it and the king.
    statue: false,
    turret: false,
    boss: false,
    skirmisher: false,
    armored: false,
    summoner: false,
    summoned: false,
    mage: false,
    flying: false, // moves over any terrain but walls
    mounted: false, // tramples the king, pushing him back
    ability: null, // (legacy) unused; bosses now carry `special` (see createBoss)
    charged: true, // mages/summoners can act only when charged (not two turns running)
  };
}

// The single special role a piece carries (or 'normal'), for display / icons.
function enemyRole(enemy) {
  if (enemy.boss) return 'boss';
  if (enemy.statue) return 'statue';
  if (enemy.turret) return 'turret';
  if (enemy.mage) return 'mage';
  if (enemy.skirmisher) return 'skirmisher';
  if (enemy.summoner) return 'summoner';
  if (enemy.armored) return 'armored';
  if (enemy.mounted) return 'mounted';
  if (enemy.flying) return 'flying';
  if (enemy.summoned) return 'summoned';
  return 'normal';
}

const JUMPER_KINDS = ['knight', 'archbishop', 'chancellor', 'amazon'];
function isJumperKind(kind) {
  return JUMPER_KINDS.includes(kind);
}

// Roll a special role for an ordinary spawn (or null). Roles arrive with depth
// (ROLE_MIN_FLOOR) and stay rare. Pawns and kings can be neither skirmishers nor
// mages (too lowly for hit-and-run or artillery).
function rollEnemyRole(floor, kind) {
  const roll = Math.random();
  const ranged = kind !== 'pawn' && kind !== 'king'; // pawns/kings can't be mages/skirmishers
  const jumper = isJumperKind(kind); // jumpers can't be mounted
  if (ranged && floor >= ROLE_MIN_FLOOR.mage && roll < 0.08) return 'mage';
  if (floor >= ROLE_MIN_FLOOR.summoner && roll < 0.16) return 'summoner';
  if (floor >= ROLE_MIN_FLOOR.armored && roll < 0.26) return 'armored';
  if (ranged && floor >= ROLE_MIN_FLOOR.skirmisher && roll < 0.36) return 'skirmisher';
  if (!jumper && floor >= ROLE_MIN_FLOOR.mounted && roll < 0.46) return 'mounted';
  if (floor >= ROLE_MIN_FLOOR.flying && roll < 0.56) return 'flying';
  return null;
}

// Give a freshly-created ordinary enemy a rolled role (mutates and returns it).
function withRolledRole(enemy, floor) {
  const role = rollEnemyRole(floor, enemy.kind);
  if (role) enemy[role] = true;
  return enemy;
}

// A boss is shielded while ANY other unit (any non-boss piece) stands in the
// king's sight — every foe on screen acts as a bodyguard.
function bossShielded(state) {
  return state.enemies.some((e) => !e.boss && unitInSight(state, e.x, e.y));
}

// Whether a given enemy can be captured right now. The Ranger's Deadshot ignores
// all defenses (statues, turrets, armor, boss shields). Otherwise statues/turrets
// are untouchable and a boss only once every other unit is out of sight.
function isCapturable(state, enemy) {
  if (!enemy) return false;
  if (state.player && state.player.ignoreDefenses) return true;
  if (enemy.statue || enemy.turret) return false;
  if (enemy.boss && bossShielded(state)) return false;
  return true;
}

// The capturable enemy on a tile (or false) — what the king may legally land on.
function capturableAt(state, x, y) {
  return isCapturable(state, state.enemies.find((e) => e.x === x && e.y === y));
}

// Has the floor's boss been defeated? True when no boss piece remains. (A floor
// with no boss at all counts as cleared.)
function bossDefeated(state) {
  return !state.enemies.some((e) => e.boss);
}

// The spawn pool for a floor. Floors 1-4 draw from the standard pieces; from the
// demon realm (floor 5+) ONLY the fairy/demonic pieces spawn — standard pieces no
// longer appear (though they can still be summoned or reanimated).
function enemyRosterForFloor(floor) {
  const demon = floor >= DEMON_FLOOR;
  const allowed = demon ? DEMON_KINDS : STANDARD_KINDS;
  const pool = ENEMY_UNLOCKS.filter((e) => floor >= e.floor && allowed.includes(e.kind)).map((e) => e.kind);
  return pool.length ? pool : [demon ? 'berolina' : 'pawn'];
}

// Pick a random kind from the floor's pool, with even odds per unit.
function randomEnemyKind(floor) {
  const pool = enemyRosterForFloor(floor);
  return pool[randomInt(pool.length)];
}

// A floor whose number is a multiple of FINAL_FLOOR holds the realm's final boss.
function isFinalBossFloor(floor) {
  return floor % FINAL_FLOOR === 0;
}

// The piece a floor's boss first appears as — the opening form of its authored
// multi-phase sequence (see the LEVELS table).
function bossKindForFloor(floor) {
  const level = levelForFloor(floor);
  return level ? level.boss.phases[0] : 'queen';
}

// Build the floor's unique guardian at (x, y): a multi-phase boss with borrowed
// role traits, a signature `special` behaviour, and its own hit damage. Its home
// tile is the boss chamber (where respawning bosses reform).
function createBoss(floor, x, y) {
  const spec = (levelForFloor(floor) || { boss: { name: 'the Guardian', phases: ['queen'], traits: [], special: 'none', damage: 1 } }).boss;
  const boss = createEnemy(spec.phases[0], x, y);
  boss.boss = true;
  boss.bossName = spec.name;
  boss.phases = spec.phases.slice();
  boss.phase = 0;
  boss.special = spec.special;
  boss.bossDamage = spec.damage || 1;
  boss.respawnMelee = Boolean(spec.respawnMelee); // Hydra: only a ranged blow truly kills it
  boss.respawnDeath = Boolean(spec.respawnDeath); // Lich: reforms across the chamber when struck
  boss.meleeOnly = Boolean(spec.meleeOnly); // Bone Dragon: ranged blows glance off
  boss.deaths = 0; // reforms survived (gold is paid on the first)
  boss.rallied = false; // one-time abilities (Warlord's rally) fire once
  boss.charged = true;
  for (const t of spec.traits || []) boss[t] = true; // armored / mounted / mage / skirmisher / flying
  return boss;
}

// Capitalize a boss title for the start of a sentence ("the Warlord" -> "The Warlord").
function bossTitle(boss) {
  const name = boss.bossName || `${boss.kind} guardian`;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

// The gold bounty for slaying this floor's boss — a purse that bleeds ~1% of its
// base each turn the king lingers (reaching zero near MAX_TURNS_SCARY).
function floorGoldReward(state) {
  const base = FLOOR_GOLD_BASE + (state.floor || 1) * 10;
  const decay = Math.max(0, 1 - (state.turn || 0) / MAX_TURNS_SCARY);
  return Math.floor(base * decay);
}

// Resolve the king dropping to 0 HP: the Necromancer's Undying revives him once
// per floor at his start; otherwise the run ends.
function checkDeath(state) {
  const p = state.player;
  if (p.hp > 0) return;
  if (p.extraLife && !p.extraLifeUsed) {
    p.extraLifeUsed = true;
    p.hp = 1;
    p.x = PLAYER_START.x;
    p.y = PLAYER_START.y;
    if (p.statuses) p.statuses.invisible = 0;
    state.message = 'Undying — you rise again at your start!';
    state.lastAction = 'enemy';
    updateDiscovery(state);
    return;
  }
  state.gameOver = true;
  state.message = 'The king falls.';
}

// Resolve the floor's boss being slain: the final boss wins the run; any other
// pays out its (decaying) gold bounty.
function defeatBoss(state, x, y) {
  if (isFinalBossFloor(state.floor)) {
    state.won = true;
    state.message = 'The final guardian falls — the realm is free!';
  } else {
    const bounty = floorGoldReward(state);
    state.player.gold += bounty;
    state.message = `The guardian falls — ${bounty} gold!`;
  }
}

// Pick a consumable kind by spawn weight (common healing, rare barkskin).
function randomConsumable() {
  const keys = Object.keys(CONSUMABLES);
  return keys[randomInt(keys.length)];
}

// Resolve whether an incoming hit is shrugged off, and how: a guaranteed block
// (riposte / barkskin), the once-per-floor Bulwark, a rolled evasion, or null
// (the hit lands). Mutates firstHitUsed when Bulwark is spent.
function rollMitigation(player) {
  if (player.warded) return 'parry'; // Parry trait ward from a kill last turn
  if (player.statuses && player.statuses.barkskin > 0) return 'barkskin';
  if (player.firstHitEachTurn && !player.firstHitUsedThisTurn) {
    player.firstHitUsedThisTurn = true; // Valkyrie: the first hit each turn is negated
    return 'ward';
  }
  return null;
}

// The flavour line for a mitigated blow.
function mitigationMessage(mit, kind) {
  if (mit === 'parry') return `The king parries a ${kind}!`;
  if (mit === 'barkskin') return `Barkskin turns aside a ${kind}!`;
  if (mit === 'ward') return `A shieldmaiden's ward absorbs a ${kind}'s blow!`;
  return `The king shrugs off a ${kind}!`;
}

// Drink a consumable / read a scroll: an immediate boon or a short status.
function applyConsumable(state, potion) {
  const p = state.player;
  if (!p.statuses) p.statuses = {};
  if (potion === 'health') {
    p.hp = p.maxHp;
    state.message = 'A Potion of Healing restores you to full health.';
  } else if (potion === 'mana') {
    for (const card of p.cards || []) {
      card.remaining = 0;
    }
    state.message = 'A Potion of Mending recharges every card.';
  } else if (potion === 'barkskin') {
    p.statuses.barkskin = BARKSKIN_TURNS;
    state.message = `Barkskin hardens your hide — invincible for ${BARKSKIN_TURNS} turns.`;
  } else if (potion === 'invis') {
    p.statuses.invisible = INVIS_TURNS;
    state.message = `You fade from sight for ${INVIS_TURNS} turns.`;
  } else if (potion === 'summoning') {
    if (summonRandomAlly(state)) {
      state.message = 'A Scroll of Summoning calls an ally to your side.';
    } else {
      state.message = 'The Scroll of Summoning fizzles — no room, or no foes seen.';
    }
  } else if (potion === 'fog') {
    if (!state.fogClouds) state.fogClouds = {};
    for (const key of computeVisibleTiles(state)) {
      const [x, y] = key.split(',').map(Number);
      if (x === p.x && y === p.y) continue; // never fog your own tile
      if (terrainAt(state, x, y) === 'wall') continue;
      state.fogClouds[key] = true;
    }
    state.message = 'A Fog Scroll blankets your surroundings in cloud.';
  } else if (potion === 'teleport') {
    const occupied = new Set(state.enemies.map((e) => `${e.x},${e.y}`));
    const tile = findFreeTile(occupied, (x, y) => isStandable(terrainAt(state, x, y)) && chebyshev(x, y, p.x, p.y) >= 1);
    if (tile) {
      p.x = tile.x;
      p.y = tile.y;
    }
    state.message = 'A Teleport Scroll whisks you across the floor.';
  }
}

// Age the king's timed statuses by one turn, dropping any that have run out.
function tickStatuses(player) {
  if (!player.statuses) {
    player.statuses = {};
    return;
  }
  for (const key of Object.keys(player.statuses)) {
    player.statuses[key] -= 1;
    if (player.statuses[key] <= 0) {
      delete player.statuses[key];
    }
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

// A weighted sample of `count` distinct equipment keys (vision is scarce, so it
// surfaces less often than the cheaper hp / regen charms).
/* --------------------------- classes & the king --------------------------- */

// Class-perk grant flags that are simply switched on.
const PERK_FLAGS = [
  'reflect', 'firstHitEachTurn', 'freeKillMove', 'terrainImmune', 'ignoreDefenses',
  'stealthStructures', 'stealth', 'weaponKillSurprise', 'pierceTargeting', 'pierceDamage',
  'familiar', 'reanimate', 'extraLife', 'goldOnKill', 'freePotion', 'frenzy',
];

// Apply a perk's grants directly to a player object (stat bumps + rule flags).
function applyPerk(player, grants) {
  if (grants.maxHp) {
    player.maxHp += grants.maxHp;
    player.hp += grants.maxHp;
  }
  if (grants.maxCards) player.maxCards += grants.maxCards;
  if (grants.maxConsumables) player.maxConsumables += grants.maxConsumables;
  if (grants.vision) player.vision += grants.vision;
  if (grants.moveRange) player.moveRange += grants.moveRange;
  for (const flag of PERK_FLAGS) {
    if (grants[flag]) player[flag] = true;
  }
}

// Grant the next perk in a class's ladder to a player (applies its effect and
// records the level). Returns the perk, or null if the class is maxed / unknown.
function grantClassLevel(player, classKey) {
  const cls = CLASSES[classKey];
  if (!cls) return null;
  const level = (player.classLevels[classKey] || 0);
  const perk = cls.perks[level];
  if (!perk) return null;
  applyPerk(player, perk.grants);
  player.classLevels[classKey] = level + 1;
  player.perks.push(perk.id);
  return perk;
}

// Build a fresh king of the chosen class: base stats, the class's level-1 perk,
// and its starting weapon (or, for the Alchemist, a satchel of random potions).
function createPlayer(classKey) {
  const player = {
    x: PLAYER_START.x,
    y: PLAYER_START.y,
    hp: STARTING_HP,
    maxHp: STARTING_HP,
    gold: 0,
    exp: 0,
    className: classKey,
    moveRange: 1,
    vision: STARTING_VISION,
    regen: STARTING_REGEN,
    maxCards: STARTING_CARD_SLOTS,
    cards: [],
    maxConsumables: STARTING_CONSUMABLE_SLOTS,
    consumables: [],
    seenKinds: [],
    weaponsUnlocked: true,
    warded: false,
    statuses: {},
    classLevels: {},
    perks: [],
    // Per-floor flags reset on descent:
    firstHitUsed: false,
    extraLifeUsed: false,
    attacked: false, // did the king attack this turn (ninja stealth reveal)
    totalTurns: 0,
    // Conduct trackers:
    usedAltar: false,
    killedEnemy: false,
    boughtCard: false,
    wasHit: false,
  };
  // Every perk flag defaults off.
  for (const flag of PERK_FLAGS) player[flag] = false;

  const cls = CLASSES[classKey] || CLASSES.valkyrie;
  grantClassLevel(player, CLASSES[classKey] ? classKey : 'valkyrie'); // free level-1 perk (may raise slots)
  if (cls.weapon) {
    player.cards.push({ kind: cls.weapon.kind, traits: [...cls.weapon.traits], cooldown: cardCooldown(cls.weapon.kind), remaining: 0 });
  } else if (cls.startKit === 'scrolls') {
    // Sorcerer: a satchel of random scrolls, filled to capacity.
    while (player.consumables.length < player.maxConsumables) player.consumables.push(SCROLL_KINDS[randomInt(SCROLL_KINDS.length)]);
  } else {
    // Alchemist: a satchel of random potions, filled to capacity.
    while (player.consumables.length < player.maxConsumables) player.consumables.push(POTION_KINDS[randomInt(POTION_KINDS.length)]);
  }
  return player;
}

/* ------------------------------ class altars ------------------------------ */

// Classes the king can still advance (the next perk in their ladder exists).
function availableClasses(player) {
  return Object.keys(CLASSES).filter((k) => ((player.classLevels && player.classLevels[k]) || 0) < CLASSES[k].perks.length);
}

// The class the king has invested the most levels in (or null). Ties favour his
// chosen starting class.
function highestClass(player) {
  const levels = player.classLevels || {};
  let best = player.className || null;
  let bestLv = best ? levels[best] || 0 : 0;
  for (const k of Object.keys(CLASSES)) {
    const lv = levels[k] || 0;
    if (lv > bestLv) {
      bestLv = lv;
      best = k;
    }
  }
  return best;
}

// The next perk in a class's ladder (or null if maxed), and its exp cost.
function nextClassPerk(player, classKey) {
  const cls = CLASSES[classKey];
  if (!cls) return null;
  const level = (player.classLevels && player.classLevels[classKey]) || 0;
  return cls.perks[level] || null;
}
function nextPerkCost(player, classKey) {
  const level = (player.classLevels && player.classLevels[classKey]) || 0;
  return CLASS_PERK_COST[level] != null ? CLASS_PERK_COST[level] : 99;
}

// Which classes an altar offers: always the next rung of the strongest class that
// can still advance, then random others.
function rollClassAltarOffers(player, count) {
  const avail = availableClasses(player);
  const offers = [];
  const high = highestClass(player);
  if (high && avail.includes(high)) {
    offers.push(high);
  }
  const rest = avail.filter((k) => !offers.includes(k));
  while (offers.length < count && rest.length) {
    offers.push(rest.splice(randomInt(rest.length), 1)[0]);
  }
  return offers;
}

// Spend exp at a class altar to learn the next perk of a class. The altar is spent.
function useClassAltar(state, classKey) {
  const next = structuredClone(state);
  const p = next.player;
  if (!next.altar || next.altar.used) {
    return next;
  }
  const perk = nextClassPerk(p, classKey);
  if (!perk) {
    return next;
  }
  const cost = nextPerkCost(p, classKey);
  if ((p.exp || 0) < cost) {
    next.altarMessage = `Need ${cost} exp for ${CLASSES[classKey].name}: ${perk.name}.`;
    return next;
  }
  p.exp -= cost;
  grantClassLevel(p, classKey);
  next.viewSize = p.vision;
  p.usedAltar = true;
  next.altar.used = true;
  next.altarMessage = `You embrace the ${CLASSES[classKey].name}: ${perk.name}.`;
  updateDiscovery(next);
  return next;
}

// Roll the weapon traits for a shop card: a first trait scales in with depth, and
// each further trait is increasingly rare (2 traits ~4x rarer, 3 traits ~8x rarer).
function rollCardTraits(floor) {
  const base = Math.min(MAX_TRAIT_CHANCE, MAX_TRAIT_CHANCE * ((floor - 1) / Math.max(1, FINAL_FLOOR - 1)));
  let count = Math.random() < base ? 1 : 0;
  if (count === 1 && Math.random() < 0.25) {
    count = 2;
    while (count < CARD_TRAITS.length && Math.random() < 0.5) count += 1;
  }
  return pickSome(CARD_TRAITS, count);
}

function findFreeTile(occupied, predicate, attempts) {
  for (let i = 0; i < (attempts || 300); i += 1) {
    const x = randomInt(WORLD_SIZE);
    const y = randomInt(WORLD_SIZE);
    const key = `${x},${y}`;
    if (occupied.has(key)) {
      continue;
    }
    if (predicate && !predicate(x, y)) {
      continue;
    }
    return { x, y, key };
  }
  return null;
}

// Scatter terrain patches. The tiles around the king's start stay clear so he
// is never boxed in on arrival.
function generateTerrain(floor, player) {
  const terrain = {};
  const nearStart = (x, y) => chebyshev(x, y, player.x, player.y) <= 2;
  const put = (x, y, type) => {
    if (x < 1 || x >= WORLD_SIZE - 1 || y < 1 || y >= WORLD_SIZE - 1) {
      return;
    }
    if (nearStart(x, y)) {
      return;
    }
    terrain[`${x},${y}`] = type;
  };
  const blob = (type, patches, spread) => {
    for (let i = 0; i < patches; i += 1) {
      const cx = randomInt(WORLD_SIZE);
      const cy = randomInt(WORLD_SIZE);
      const cells = 3 + randomInt(spread);
      for (let j = 0; j < cells; j += 1) {
        put(cx + randomInt(3) - 1, cy + randomInt(3) - 1, type);
      }
    }
  };
  const wallLine = (segments, length) => {
    for (let i = 0; i < segments; i += 1) {
      let x = randomInt(WORLD_SIZE);
      let y = randomInt(WORLD_SIZE);
      const horizontal = Math.random() < 0.5;
      for (let j = 0; j < length; j += 1) {
        put(x, y, 'wall');
        if (horizontal) {
          x += 1;
        } else {
          y += 1;
        }
      }
    }
  };

  // The floor's terrain follows its authored theme (the LEVELS recipe): a count of
  // "blob" seeds per hazard type, thickening on New Game + cycles. Walls last so
  // they win any overlap.
  const level = levelForFloor(floor);
  const recipe = (level && level.recipe) || {};
  const cycle = Math.floor((floor - 1) / FINAL_FLOOR);
  const scale = 1 + cycle * 0.5;
  const seeds = (type) => Math.round((recipe[type] || 0) * scale);
  if (seeds('mud')) blob('mud', 2 * seeds('mud'), 4);
  if (seeds('ice')) blob('ice', 2 * seeds('ice'), 4);
  if (seeds('trees')) blob('trees', 2 * seeds('trees'), 4);
  if (seeds('brush')) blob('brush', 2 * seeds('brush'), 5);
  if (seeds('water')) blob('water', 2 * seeds('water'), 5);
  if (seeds('lava')) blob('lava', 2 * seeds('lava'), 5);
  if (seeds('wall')) wallLine(2 * seeds('wall'), 3);
  return terrain;
}

// Brush a unit steps onto (within the king's sight) is trampled back to open
// ground. Called each turn for the player, enemies, and allies.
function trampleBrush(state) {
  if (!state.terrain) return;
  const units = [state.player, ...state.enemies, ...(state.allies || [])];
  for (const u of units) {
    const key = `${u.x},${u.y}`;
    if (state.terrain[key] === 'brush' && inLineOfSight(state, u.x, u.y)) {
      delete state.terrain[key];
    }
  }
}

// Build (or rebuild) a floor. Carries the player's stats forward between floors.
function generateFloor(floor, carryPlayer, score) {
  const player = carryPlayer
    ? { ...carryPlayer, x: PLAYER_START.x, y: PLAYER_START.y }
    : createPlayer('valkyrie');

  const state = {
    worldSize: WORLD_SIZE,
    viewSize: player.vision, // legacy field, kept in sync with the vision stat
    player,
    terrain: generateTerrain(floor, player),
    // Fog of war: tiles the king has ever seen on this floor (keys "x,y"). Fresh
    // each floor; everything else is hidden until explored.
    explored: {},
    // Remembered items: last-seen pickup at each explored tile ("x,y" -> {kind,...}).
    // May go stale (an enemy can trample an item out of view).
    itemMemory: {},
    enemies: [],
    items: [],
    spatters: [], // decaying blood marks left by kills / the king being struck
    fogClouds: {}, // temporary sight-blocking clouds from a Fog Scroll ("x,y" -> true)
    exit: null,
    altar: null, // class altar (perk shrine)
    weaponShop: null, // sells movement cards (once unlocked)
    potionShop: null, // sells consumables
    floor,
    turn: 0,
    score: score || 0,
    enemyTurn: false,
    gameOver: false,
    won: false,
    allies: [], // friendly summons on this floor
    pendingAltar: false,
    pendingWeaponShop: false,
    pendingPotionShop: false,
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
    if (tile) {
      occupied.add(tile.key);
    }
    return tile;
  }

  function addEnemy(type, x, y, surprised) {
    const enemy = createEnemy(type, x, y);
    enemy.surprised = Boolean(surprised);
    if (!surprised && floor >= 2) {
      withRolledRole(enemy, floor); // wandering spawns may carry a special role
    }
    state.enemies.push(enemy);
  }

  // Enemies start asleep and out of sight; they wander until they spot the king.
  // Grows with depth but capped so deep new-game-plus floors aren't overrun at birth.
  const offscreenCount = Math.min(6 + floor * 4, MAX_ENEMIES);
  for (let i = 0; i < offscreenCount; i += 1) {
    const tile = place((x, y) => standable(x, y) && !seen(x, y) && chebyshev(x, y, player.x, player.y) >= 2);
    if (!tile) {
      break;
    }
    addEnemy(randomEnemyKind(floor), tile.x, tile.y, false);
  }

  // Floor 1 introduces the game with exactly one visible, surprised foe.
  if (floor === 1) {
    const tile = place((x, y) => standable(x, y) && seen(x, y) && chebyshev(x, y, player.x, player.y) >= 2);
    if (tile) {
      addEnemy(randomEnemyKind(floor), tile.x, tile.y, true);
    }
  }

  // Gold and potions are no longer scattered on the ground: gold is claimed by
  // descending swiftly (floorGoldReward), and potions are bought at a shop.

  // The exit and its boss chamber are AUTHORED, not random: the stair sits at the
  // floor's fixed chamber anchor, ringed by a themed wall (or a lava/water moat on
  // "island" levels) with a single doorway facing the king's start. The floor's
  // unique guardian stands in the chamber, and a cohort of sleeping enemies keeps
  // a loose watch nearby.
  const level = levelForFloor(floor);
  {
    const anchor = chamberAnchorForFloor(floor);
    const ax = Math.max(2, Math.min(WORLD_SIZE - 3, anchor.x));
    const ay = Math.max(2, Math.min(WORLD_SIZE - 3, anchor.y));
    state.exit = { x: ax, y: ay, discovered: false };
    occupied.add(`${ax},${ay}`);

    // Clear the 3x3 interior to standable ground so the guardian and stair sit free.
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        delete state.terrain[`${ax + dx},${ay + dy}`];
      }
    }

    // Ring the chamber at radius 2, leaving the tile nearest the king's start open
    // as a doorway (and a small "island" moat lets flying/demonic bosses lord it
    // over a king who must find the land bridge).
    const island = level && level.feature === 'island';
    const ringType = island ? (level.theme === 'lava' || level.theme === 'castle' ? 'lava' : 'water') : 'wall';
    const doorDx = Math.sign(player.x - ax);
    const doorDy = Math.sign(player.y - ay);
    const doorX = ax + doorDx * 2;
    const doorY = ay + doorDy * 2;
    for (let dx = -2; dx <= 2; dx += 1) {
      for (let dy = -2; dy <= 2; dy += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== 2) continue; // border ring only
        const rx = ax + dx;
        const ry = ay + dy;
        if (rx < 1 || rx >= WORLD_SIZE - 1 || ry < 1 || ry >= WORLD_SIZE - 1) continue;
        if (chebyshev(rx, ry, doorX, doorY) === 0) continue; // leave the doorway open
        state.terrain[`${rx},${ry}`] = ringType;
      }
    }
    delete state.terrain[`${doorX},${doorY}`]; // ensure the doorway is clear ground

    // The unique guardian: on a free interior tile beside the stair.
    const bossSpot = place((x, y) => isStandable(terrainAt(state, x, y)) && chebyshev(x, y, ax, ay) === 1 && chebyshev(x, y, player.x, player.y) >= 3);
    if (bossSpot) {
      const boss = createBoss(floor, bossSpot.x, bossSpot.y);
      state.enemies.push(boss);
    }

    // The sleeping cohort: guards loosely ringing the chamber (near, but not right
    // atop the exit), asleep until the king rouses them.
    for (const kind of (level && level.cohort) || []) {
      const spot = place((x, y) =>
        isStandable(terrainAt(state, x, y)) &&
        chebyshev(x, y, ax, ay) >= 2 && chebyshev(x, y, ax, ay) <= 5 &&
        chebyshev(x, y, player.x, player.y) >= 3);
      if (spot) {
        const guard = createEnemy(kind, spot.x, spot.y);
        state.enemies.push(guard); // asleep by default; wakes when spotted
      }
    }
  }

  // Buildings each roll a chance, so floors vary and never feel bloated.

  // A class altar where the king spends exp on a class perk.
  if (Math.random() < 0.55) {
    const offers = rollClassAltarOffers(player, CLASS_ALTAR_CHOICES);
    if (offers.length) {
      const altarTile = place((x, y) => standable(x, y) && chebyshev(x, y, player.x, player.y) >= 2);
      if (altarTile) {
        state.altar = { x: altarTile.x, y: altarTile.y, discovered: false, used: false, offers };
      }
    }
  }

  // Weapon shops offer cards drawn from the kinds the king has seen, each rolling
  // a set of weapon traits (extra traits increasingly rare).
  if (Math.random() < 0.5) {
    const kinds = pickSome(
      (player.seenKinds || []).filter((kind) => isCardKind(kind)),
      SHOP_CHOICES,
    );
    const shopOffers = kinds.map((kind) => ({ kind, traits: rollCardTraits(floor), sold: false }));
    if (shopOffers.length) {
      const shopTile = place((x, y) => standable(x, y) && chebyshev(x, y, player.x, player.y) >= 2);
      if (shopTile) {
        state.weaponShop = { x: shopTile.x, y: shopTile.y, discovered: false, offers: shopOffers };
      }
    }
  }

  // An apothecary selling potions (the only source now that they aren't scattered).
  if (Math.random() < 0.5) {
    const offers = pickSome(Object.keys(CONSUMABLES), CONSUMABLE_SHOP_CHOICES).map((key) => ({ key, sold: false }));
    const shopTile = place((x, y) => standable(x, y) && chebyshev(x, y, player.x, player.y) >= 2);
    if (shopTile) {
      state.potionShop = { x: shopTile.x, y: shopTile.y, discovered: false, offers };
    }
  }

  // Tiles whose surroundings must stay safe — no turret may threaten a feature,
  // and statues may stand guard a step away from one.
  const featureTiles = [];
  for (const f of [state.exit, state.altar, state.weaponShop, state.potionShop]) {
    if (f) featureTiles.push(`${f.x},${f.y}`);
  }
  const featureSet = new Set(featureTiles);

  // Buildings and the stair are known from the outset — their tiles are revealed
  // (though the rest of the floor stays shrouded until explored).
  for (const f of [state.exit, state.altar, state.weaponShop, state.potionShop]) {
    if (f) {
      state.explored[`${f.x},${f.y}`] = true;
      f.discovered = true;
    }
  }

  const addStatue = (type, x, y) => {
    const e = createEnemy(type, x, y);
    e.statue = true;
    state.enemies.push(e);
  };

  // Statues: inert pieces scattered out of sight, plus the occasional sentinel
  // standing a tile away from a feature (a nasty surprise for a careless king).
  // They arrive only from ROLE_MIN_FLOOR.statue onward.
  if (floor >= ROLE_MIN_FLOOR.statue) {
    const statueCount = 2 + randomInt(3);
    for (let i = 0; i < statueCount; i += 1) {
      const tile = place((x, y) => standable(x, y) && !seen(x, y) && chebyshev(x, y, player.x, player.y) >= 3);
      if (tile) addStatue(randomEnemyKind(floor), tile.x, tile.y);
    }
    for (const key of featureTiles) {
      if (Math.random() < 0.5) continue;
      const [fx, fy] = key.split(',').map(Number);
      const spot = place((x, y) => standable(x, y) && chebyshev(x, y, fx, fy) === 1 && chebyshev(x, y, player.x, player.y) >= 2);
      if (spot) addStatue(randomEnemyKind(floor), spot.x, spot.y);
    }
  }

  // Turrets: fixed emplacements, introduced a few floors in. A candidate is only
  // accepted if its fire covers no feature tile and not the king's start, so the
  // exit / shops / altar are never made deadly to reach.
  if (floor >= 3) {
    const turretCount = 1 + randomInt(2);
    const startKey = `${player.x},${player.y}`;
    for (let i = 0; i < turretCount; i += 1) {
      for (let attempt = 0; attempt < 30; attempt += 1) {
        const tile = findFreeTile(occupied, (x, y) => standable(x, y) && !seen(x, y) && chebyshev(x, y, player.x, player.y) >= 4);
        if (!tile) break;
        const probe = createEnemy(randomEnemyKind(floor), tile.x, tile.y);
        probe.turret = true;
        const threats = getPieceThreats(probe, state);
        const unsafe = threats.some((t) => featureSet.has(`${t.x},${t.y}`) || `${t.x},${t.y}` === startKey);
        if (unsafe) continue;
        occupied.add(tile.key);
        state.enemies.push(probe);
        break;
      }
    }
  }

  // Necromancer familiar: a demon (berolina) ally at the king's side each floor.
  if (player.familiar) {
    addAllyNear(state, 'berolina', player.x, player.y);
  }

  updateDiscovery(state);
  return state;
}

function createInitialState(classKey) {
  return generateFloor(1, createPlayer(classKey || 'valkyrie'), 0);
}

function nextFloor(state) {
  // Descending fully heals the king, refreshes every card, grants exp, and resets
  // the per-floor perk flags.
  const healed = { ...state.player, hp: state.player.maxHp };
  healed.cards = (healed.cards || []).map((c) => ({ ...c, remaining: 0 }));
  healed.exp = (healed.exp || 0) + 1;
  healed.extraLifeUsed = false;
  healed.firstHitUsed = false;
  return generateFloor(state.floor + 1, healed, state.score);
}

// Blood spatters: add one at a tile, and age the set by a turn (dropping spent ones).
function addSpatter(state, x, y) {
  if (!Array.isArray(state.spatters)) state.spatters = [];
  state.spatters.push({ x, y, life: SPATTER_LIFE, max: SPATTER_LIFE });
}

function decaySpatters(spatters) {
  if (!Array.isArray(spatters)) return [];
  return spatters.map((s) => ({ ...s, life: s.life - 1 })).filter((s) => s.life > 0);
}

// Each turn, every drifting fog cloud has a chance to dissipate.
function decayFog(state) {
  if (!state.fogClouds) return;
  for (const key of Object.keys(state.fogClouds)) {
    if (Math.random() < FOG_DISSIPATE) delete state.fogClouds[key];
  }
}

// Advance the world by one turn's upkeep: age the turn counters, recharge cards,
// fade blood, lapse the Riposte ward, tick timed statuses, and drift the fog.
function passTurn(state) {
  const p = state.player;
  state.turn += 1;
  p.totalTurns = (p.totalTurns || 0) + 1;
  for (const card of p.cards || []) {
    if (card.remaining > 0) card.remaining -= 1;
  }
  state.spatters = decaySpatters(state.spatters);
  p.warded = false;
  p.firstHitUsedThisTurn = false; // Valkyrie ward refreshes each turn
  p.attacked = false;
  tickStatuses(p);
  decayFog(state);
  trampleBrush(state);
}

// Record any enemy kinds the king can currently see, and unlock weapon shops once
// he has spotted his first card-eligible foe.
function recordSeenEnemies(state) {
  const p = state.player;
  if (!Array.isArray(p.seenKinds)) p.seenKinds = [];
  for (const enemy of getVisibleEnemies(state)) {
    if (!p.seenKinds.includes(enemy.kind)) {
      p.seenKinds.push(enemy.kind);
    }
    if (isCardKind(enemy.kind)) {
      p.weaponsUnlocked = true;
    }
  }
}

// Sync the king's memory of items with what he can currently see: tiles in view
// get the true picture (item there, or none), while tiles out of view keep their
// last-known state — which may have gone stale (an enemy can trample unseen).
function rememberItems(state) {
  if (!state.itemMemory) state.itemMemory = {};
  for (const key of computeVisibleTiles(state)) {
    const [x, y] = key.split(',').map(Number);
    const item = state.items.find((i) => i.x === x && i.y === y);
    if (item) {
      state.itemMemory[key] = { kind: item.kind, amount: item.amount, potion: item.potion };
    } else {
      delete state.itemMemory[key];
    }
  }
}

// Dispel the fog of war over every tile currently in the king's line of sight.
// Explored tiles stay revealed (terrain remembered) even after he looks away.
function revealSeen(state) {
  if (!state.explored) {
    state.explored = {};
  }
  for (const key of computeVisibleTiles(state)) {
    state.explored[key] = true;
  }
}

// Reveal newly-seen ground, remember the exit / buildings once explored, and note
// which enemy kinds the king has laid eyes on.
function updateDiscovery(state) {
  revealSeen(state);
  recordSeenEnemies(state);
  rememberItems(state);
  if (state.exit && state.explored[`${state.exit.x},${state.exit.y}`]) {
    state.exit.discovered = true;
  }
  if (state.altar && state.explored[`${state.altar.x},${state.altar.y}`]) {
    state.altar.discovered = true;
  }
  // Treasure Sense: remember every item on the floor, wherever it lies.
  if (state.player && state.player.detectItems) {
    if (!state.itemMemory) state.itemMemory = {};
    for (const item of state.items) {
      state.explored[`${item.x},${item.y}`] = true;
      state.itemMemory[`${item.x},${item.y}`] = { kind: item.kind, amount: item.amount, potion: item.potion };
    }
  }
  if (state.weaponShop && state.explored[`${state.weaponShop.x},${state.weaponShop.y}`]) {
    state.weaponShop.discovered = true;
  }
  if (state.potionShop && state.explored[`${state.potionShop.x},${state.potionShop.y}`]) {
    state.potionShop.discovered = true;
  }
}

// Every tile the king may move to: terrain-aware slides up to his move range,
// plus knight leaps once unlocked.
function getPlayerMoves(state) {
  const p = state.player;
  const enemyAt = (x, y) => state.enemies.find((e) => e.x === x && e.y === y) || null;
  // Every enemy blocks the king's path, but only capturable ones may be landed
  // on (statues, turrets, and a shielded boss block without being a target).
  const isEnemy = (x, y) => capturableAt(state, x, y);
  const moves = [];
  const seen = new Set();
  const add = (tile) => {
    const key = `${tile.x},${tile.y}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    moves.push({ x: tile.x, y: tile.y, viaJump: Boolean(tile.viaJump), capture: Boolean(tile.capture) });
  };

  const opts = { terrainImmune: Boolean(p.terrainImmune) }; // Ranger Pathfinder
  for (const [dx, dy] of [...ORTHO, ...DIAG]) {
    for (const stop of slideStops(state, p.x, p.y, dx, dy, p.moveRange, enemyAt, isEnemy, opts)) {
      add(stop);
    }
  }
  if (p.canJump) {
    for (const target of jumpTargets(state, p.x, p.y, enemyAt, isEnemy)) {
      add(target);
    }
  }
  return moves;
}

// Resolve the king arriving on (x, y): swap with an ally, capture, exit, buildings.
// The turn's upkeep runs at the END, and is skipped when a Bloodrush free kill lets
// the move cost no turn.
function applyArrival(next, x, y) {
  const fromX = next.player.x;
  const fromY = next.player.y;

  // Moving onto a friendly summon swaps places with it (and stops it acting).
  const ally = (next.allies || []).find((a) => a.x === x && a.y === y);
  if (ally) {
    ally.x = fromX;
    ally.y = fromY;
    ally.skipTurn = true;
  }

  next.player.x = x;
  next.player.y = y;
  next.enemyTurn = true;
  next.lastAction = 'move';
  next.message = 'The king moves.';

  const enemy = next.enemies.find((e) => e.x === x && e.y === y);
  const pl = next.player;
  let killed = false;
  if (enemy && enemy.armored && !pl.ignoreDefenses) {
    // The first blow only shatters the armor: the piece survives (now ordinary)
    // and the recoil flings the king back to his floor-start tile.
    enemy.armored = false;
    pl.x = PLAYER_START.x;
    pl.y = PLAYER_START.y;
    addSpatter(next, x, y);
    next.message = `The king shatters a ${enemy.kind}'s armor and is hurled back!`;
    next.lastAction = 'combat';
    passTurn(next);
    next.enemyTurn = true;
    updateDiscovery(next);
    return next;
  }
  if (enemy) {
    resolveKill(next, enemy);
    pl.attacked = true;
    // A boss may survive the blow (shed a form / reform) — resolveKill sets its own
    // message then, and it doesn't count as a kill (no Bloodrush / reanimate).
    if (next.enemies.some((e) => e.id === enemy.id)) {
      next.lastAction = 'combat';
    } else {
      killed = true;
      next.message = `The king defeats a ${enemy.kind}.`;
      next.lastAction = 'combat';
    }
  }

  if (next.exit && next.exit.x === x && next.exit.y === y) {
    next.lastAction = 'exit';
    next.message = 'You step onto the stair and descend...';
    return next;
  }

  if (next.altar && next.altar.x === x && next.altar.y === y && !next.altar.used) {
    next.pendingAltar = true;
    next.message = 'A class altar. It awakens once the enemies have moved.';
  }

  if (next.weaponShop && next.weaponShop.x === x && next.weaponShop.y === y) {
    next.pendingWeaponShop = true;
    next.message = 'A weapon shop! It opens once the enemies have moved.';
  }

  if (next.potionShop && next.potionShop.x === x && next.potionShop.y === y) {
    next.pendingPotionShop = true;
    next.message = 'An apothecary! It opens once the enemies have moved.';
  }

  // Statues wake the moment the king steps beside them (unless a Ninja's Shadow
  // makes structures ignore him), becoming ordinary pieces the coming enemy phase
  // catches by surprise (one turn frozen, then hunt).
  for (const e of next.enemies) {
    if (e.statue && !next.player.stealthStructures && chebyshev(e.x, e.y, x, y) <= 1) {
      e.statue = false;
      e.awake = false;
      e.surprised = false;
      next.awokeStatue = true;
      next.message = `A ${e.kind} statue cracks to life!`;
    }
  }

  // Barbarian Bloodrush: a normal move that scores a kill costs no turn.
  if (killed && pl.freeKillMove) {
    next.enemyTurn = false;
    next.lastAction = 'move-free';
  } else {
    passTurn(next); // one turn's upkeep (cards, blood, ward, statuses, fog)
  }
  updateDiscovery(next);
  return next;
}

// A boss struck down may not truly die: multi-phase guardians shed a form and
// rise anew, and some reform across their chamber (see surviveBossBlow). Returns
// true when the boss survives this blow and must NOT be removed. ctx.ranged tells
// whether the killing blow came from range (a bolt / a distant weapon card).
function surviveBossBlow(state, boss, ctx) {
  const ranged = Boolean(ctx.ranged);
  // Hydra: a melee blow only makes it regrow — only a ranged strike can fell it.
  if (boss.respawnMelee && !ranged) {
    if (!reformBoss(state, boss)) return false; // nowhere to reform — it dies
    const g = firstReformGold(state, boss);
    state.message = `${bossTitle(boss)} regrows where it was struck — strike from afar!${g ? ` (+${g} gold)` : ''}`;
    state.lastAction = 'enemy';
    return true;
  }
  // Multi-phase guardians shed one form per blow, rising anew until the last.
  if (boss.phase < boss.phases.length - 1) {
    boss.phase += 1;
    boss.kind = boss.phases[boss.phase];
    boss.charged = true;
    if (!reformBoss(state, boss)) return false;
    const g = boss.respawnDeath ? firstReformGold(state, boss) : 0;
    state.message = `${bossTitle(boss)} sheds its form and rises anew!${g ? ` (+${g} gold)` : ''}`;
    state.lastAction = 'enemy';
    return true;
  }
  return false; // its final form — felled for good
}

// Reform a boss on a free standable tile near its chamber home, away from the
// king. Returns false if none can be found (then the blow simply slays it).
function reformBoss(state, boss) {
  const king = state.player;
  const occupied = (x, y) =>
    (x === king.x && y === king.y) ||
    state.enemies.some((e) => e.id !== boss.id && e.x === x && e.y === y) ||
    (state.allies || []).some((a) => a.x === x && a.y === y);
  const ok = (x, y) =>
    x >= 0 && x < WORLD_SIZE && y >= 0 && y < WORLD_SIZE &&
    standableFor(terrainAt(state, x, y), { lavaOk: true, flying: Boolean(boss.flying) }) &&
    !occupied(x, y) && chebyshev(x, y, king.x, king.y) >= 2;
  const hx = boss.homeX != null ? boss.homeX : boss.x;
  const hy = boss.homeY != null ? boss.homeY : boss.y;
  for (let r = 0; r <= 6; r += 1) {
    const cands = [];
    for (let dx = -r; dx <= r; dx += 1) {
      for (let dy = -r; dy <= r; dy += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (ok(hx + dx, hy + dy)) cands.push({ x: hx + dx, y: hy + dy });
      }
    }
    if (cands.length) {
      const c = cands[randomInt(cands.length)];
      boss.x = c.x;
      boss.y = c.y;
      return true;
    }
  }
  return false;
}

// Pay the boss's bounty the first time it reforms (its later reforms are free).
function firstReformGold(state, boss) {
  boss.deaths = (boss.deaths || 0) + 1;
  if (boss.deaths !== 1) return 0;
  const bounty = floorGoldReward(state);
  state.player.gold += bounty;
  return bounty;
}

// Resolve a piece being slain by the king (melee, weapon, or AoE): remove it, roll
// on-kill class perks, and open the boss if it was the guardian. `ctx.ranged`
// marks a from-range blow (matters for phase/reform bosses).
function resolveKill(state, enemy, ctx) {
  if (enemy.boss && surviveBossBlow(state, enemy, ctx || {})) {
    return; // it shed a form or reformed — not slain
  }
  state.enemies = state.enemies.filter((e) => e.id !== enemy.id);
  const p = state.player;
  p.killedEnemy = true;
  addSpatter(state, enemy.x, enemy.y);
  if (p.statuses) p.statuses.invisible = 0; // attacking reveals you
  if (p.goldOnKill) p.gold += 1; // Alchemist Transmute
  if (p.frenzy && Array.isArray(p.cards)) {
    const cooling = p.cards.filter((c) => c.remaining > 0);
    if (cooling.length) cooling[randomInt(cooling.length)].remaining -= 1; // Barbarian Frenzy
  }
  if (p.reanimate && !enemy.boss && (state.allies || []).length < MAX_ALLIES) {
    addAllyNear(state, enemy.kind, enemy.x, enemy.y); // Necromancer Reanimate
  }
  if (enemy.boss) {
    defeatBoss(state, enemy.x, enemy.y);
  }
}

// Slay any capturable enemy OR friendly ally on (tx, ty) — used by area weapon
// effects (Cleave, Sorcerer Ruin), which can catch the king's own summons.
function slayUnitAt(state, tx, ty, ctx) {
  const enemy = state.enemies.find((e) => e.x === tx && e.y === ty);
  if (enemy && isCapturable(state, enemy)) {
    resolveKill(state, enemy, ctx);
    return true;
  }
  const before = (state.allies || []).length;
  if (before) {
    state.allies = state.allies.filter((a) => !(a.x === tx && a.y === ty));
    if (state.allies.length !== before) {
      addSpatter(state, tx, ty);
      return true;
    }
  }
  return false;
}
// Back-compat alias used by ranged enemies (mage bolt, etc.) — enemies only.
function slayEnemyAt(state, tx, ty) {
  const enemy = state.enemies.find((e) => e.x === tx && e.y === ty);
  if (!enemy || !isCapturable(state, enemy)) return false;
  resolveKill(state, enemy);
  return true;
}

// Play a weapon card: it can ONLY be used to strike (must target an enemy). The
// king moves like the card's unit onto the foe and slays it, applying its traits.
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
  const move = getCardMoves(next, card.kind).find((m) => m.x === x && m.y === y);
  if (!move) {
    next.message = 'That card cannot reach that tile.';
    next.lastAction = 'blocked';
    return next;
  }
  if (!move.capture) {
    next.message = 'A weapon card can only strike an enemy.';
    next.lastAction = 'blocked';
    return next;
  }

  const fromX = p.x;
  const fromY = p.y;
  const traits = card.traits || [];

  // A weapon blow is "ranged" if it reaches beyond an adjacent tile, snaps back
  // (Shoot), or pierces (Ruin). It matters for guardians that shrug off distant
  // hits (Bone Dragon) or that only a ranged blow can fell (Hydra).
  const ranged = chebyshev(fromX, fromY, x, y) > 1 || traits.includes('shoot') || Boolean(p.pierceDamage);
  const targetEnemy = next.enemies.find((e) => e.x === x && e.y === y);
  if (targetEnemy && targetEnemy.boss && targetEnemy.meleeOnly && ranged && !p.ignoreDefenses) {
    next.message = `${bossTitle(targetEnemy)} shrugs off the blow — only an adjacent strike will land!`;
    next.lastAction = 'blocked';
    return next;
  }

  // Sorcerer Ruin: also slay everything on the straight path to the target.
  if (p.pierceDamage) {
    for (const t of straightPath(fromX, fromY, x, y)) slayUnitAt(next, t.x, t.y, { ranged: true });
  }

  const target = next.enemies.find((e) => e.x === x && e.y === y);
  if (target) {
    resolveKill(next, target, { ranged });
  }
  p.x = x;
  p.y = y;
  p.attacked = true;

  if (!next.gameOver && !next.won) {
    if (traits.includes('cleave')) {
      cleaveAdjacent(next, x, y); // slay up to 1 adjacent unit
    }
    if (traits.includes('leech')) {
      p.hp = Math.min(p.maxHp, p.hp + 1);
    }
    if (traits.includes('parry')) {
      p.warded = true;
    }
    if (traits.includes('shoot')) {
      p.x = fromX;
      p.y = fromY;
    }
    if (p.weaponKillSurprise) {
      for (const [dx, dy] of [...ORTHO, ...DIAG]) {
        const e = next.enemies.find((en) => en.x === x + dx && en.y === y + dy);
        if (e && unitInSight(next, e.x, e.y)) e.awake = false; // re-surprised next phase
      }
    }
  }

  card.remaining = card.cooldown;
  if (traits.includes('quick')) {
    next.enemyTurn = false;
    next.lastAction = 'card-free'; // Quick: costs no turn
  } else {
    passTurn(next);
    next.enemyTurn = true;
    next.lastAction = 'combat';
  }
  updateDiscovery(next);
  return next;
}

// Cleave: slay one adjacent enemy/ally beside the strike (cardinal first).
function cleaveAdjacent(state, x, y) {
  for (const [dx, dy] of [...ORTHO, ...DIAG]) {
    if (slayUnitAt(state, x + dx, y + dy)) return;
  }
}

// The tiles strictly between two points along a straight (8-direction) line, or
// empty if they don't line up. Used by Sorcerer Ruin.
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

/* --------------------------------- allies --------------------------------- */

// Add a friendly summon (an ally piece) at a tile.
function addAlly(state, kind, x, y) {
  if (!state.allies) state.allies = [];
  state.allies.push({ id: `ally-${kind}-${x}-${y}-${Math.random().toString(16).slice(2, 6)}`, kind, x, y, skipTurn: false });
}

// Add an ally near (x, y) — on it if free, else an adjacent free standable tile.
function addAllyNear(state, kind, x, y) {
  const taken = (ax, ay) =>
    (ax === state.player.x && ay === state.player.y) ||
    state.enemies.some((e) => e.x === ax && e.y === ay) ||
    (state.allies || []).some((a) => a.x === ax && a.y === ay);
  const free = (ax, ay) => ax >= 0 && ax < WORLD_SIZE && ay >= 0 && ay < WORLD_SIZE && isStandable(terrainAt(state, ax, ay)) && !taken(ax, ay);
  if (free(x, y)) {
    addAlly(state, kind, x, y);
    return true;
  }
  for (const [dx, dy] of [...ORTHO, ...DIAG]) {
    if (free(x + dx, y + dy)) {
      addAlly(state, kind, x + dx, y + dy);
      return true;
    }
  }
  return false;
}

// Summon a random ally of a kind the king has seen (Scroll of Summoning).
function summonRandomAlly(state) {
  const kinds = (state.player.seenKinds || []).filter((k) => k !== 'amazon');
  if (!kinds.length || (state.allies || []).length >= MAX_ALLIES) return false;
  return addAllyNear(state, kinds[randomInt(kinds.length)], state.player.x, state.player.y);
}

// Where an ally may move: like its piece, targeting enemies, blocked by the king,
// other allies, and non-target enemies.
function getAllyMoves(ally, state) {
  const unitAt = (x, y) => {
    if (x === state.player.x && y === state.player.y) return 'king';
    if ((state.allies || []).some((a) => a.id !== ally.id && a.x === x && a.y === y)) return 'ally';
    return state.enemies.find((e) => e.x === x && e.y === y) || null;
  };
  const isTarget = (x, y) => state.enemies.some((e) => e.x === x && e.y === y && isCapturable(state, e));
  return generateMoves(ally.kind, state, ally.x, ally.y, unitAt, isTarget);
}

// One step per ally each enemy phase: an ally out of the king's sight blinks to
// the nearest visible free tile (or is unsummoned if none); an ally in sight hunts
// and strikes the nearest visible enemy.
function stepAllies(state) {
  const survivors = [];
  for (const ally of state.allies || []) {
    if (ally.skipTurn) {
      ally.skipTurn = false; // it swapped with the king this turn — it holds
      survivors.push(ally);
      continue;
    }
    if (!unitInSight(state, ally.x, ally.y)) {
      const tile = nearestVisibleFreeTile(state, ally);
      if (!tile) continue; // no home in sight — the summon fades away
      ally.x = tile.x;
      ally.y = tile.y;
    }
    const target = nearestVisibleEnemy(state, ally);
    if (target) {
      const moves = getAllyMoves(ally, state);
      const step = chooseHostileMove(moves, target.x, target.y);
      if (step) {
        ally.x = step.x;
        ally.y = step.y;
        const hit = state.enemies.find((e) => e.x === ally.x && e.y === ally.y && isCapturable(state, e));
        if (hit) {
          if (hit.boss) {
            resolveKill(state, hit, { ranged: false }); // ally melee — may shed a phase / reform
          } else {
            state.enemies = state.enemies.filter((e) => e.id !== hit.id);
            addSpatter(state, ally.x, ally.y);
          }
        }
      }
    }
    survivors.push(ally);
  }
  state.allies = survivors;
}

function nearestVisibleEnemy(state, from) {
  let best = null;
  let bestD = Infinity;
  for (const e of state.enemies) {
    if (!isCapturable(state, e) || !unitInSight(state, e.x, e.y)) continue;
    const d = distanceSq(e.x, e.y, from.x, from.y);
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  return best;
}

function nearestVisibleFreeTile(state, ally) {
  const taken = (x, y) =>
    (x === state.player.x && y === state.player.y) ||
    state.enemies.some((e) => e.x === x && e.y === y) ||
    (state.allies || []).some((a) => a.id !== ally.id && a.x === x && a.y === y);
  let best = null;
  let bestD = Infinity;
  for (const key of computeVisibleTiles(state)) {
    const [x, y] = key.split(',').map(Number);
    if (!isStandable(terrainAt(state, x, y)) || taken(x, y)) continue;
    const d = distanceSq(x, y, state.player.x, state.player.y);
    if (d < bestD) {
      bestD = d;
      best = { x, y };
    }
  }
  return best;
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

// Keyboard movement: a single ground step in a direction (but ice still slides).
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

// An unaware enemy shuffles one tile in a completely random direction. It never
// steps onto another unit (enemies magically know where each other are), and it
// never wanders into the king's line of sight — so a piece only ever enters view
// because the *king* moved, and is then reliably caught by surprise on that exact
// turn (rather than appearing un-surprised and freezing a turn late).
// When `invisible` is true the king can't be seen, so the enemy shuffles about
// with no regard for staying hidden, and may even blunder onto his tile — which
// the caller resolves as an accidental bump. Returns 'bump' in that case.
function wanderEnemy(state, enemy, invisible) {
  const unitAt = (x, y) => {
    if (!invisible && x === state.player.x && y === state.player.y) {
      return 'player'; // while invisible the king is not a blocker (can be bumped)
    }
    return state.enemies.find((other) => other.id !== enemy.id && other.x === x && other.y === y) || null;
  };
  const never = () => false;
  const candidates = [];
  for (const [dx, dy] of [...ORTHO, ...DIAG]) {
    const stops = slideStops(state, enemy.x, enemy.y, dx, dy, 1, unitAt, never);
    if (!stops.length) {
      continue;
    }
    const dest = stops[stops.length - 1];
    if (invisible || !unitInSight(state, dest.x, dest.y)) {
      candidates.push(dest); // stay hidden until the king comes to us (unless he's unseen)
    }
  }
  if (!candidates.length) {
    return null; // Boxed in (or hemmed against the king's view) — just idle.
  }
  const pick = candidates[randomInt(candidates.length)];
  if (invisible && pick.x === state.player.x && pick.y === state.player.y) {
    return 'bump'; // blundered into the unseen king — don't move onto him
  }
  enemy.x = pick.x;
  enemy.y = pick.y;
  return null;
}

// Resolve an enemy blundering into the invisible king: a hit (unless mitigated),
// the king is revealed, and the clumsy attacker spends itself.
function resolveBump(state, enemy) {
  const mit = rollMitigation(state.player);
  if (!mit) {
    state.player.hp -= 1;
    state.player.wasHit = true;
    addSpatter(state, state.player.x, state.player.y);
  }
  if (state.player.statuses) state.player.statuses.invisible = 0; // revealed by contact
  state.enemies = state.enemies.filter((e) => e.id !== enemy.id);
  if (mit) {
    state.message = `A ${enemy.kind} blunders into the unseen king, who shrugs it off!`;
    state.lastAction = 'enemy';
  } else {
    state.message = `A ${enemy.kind} stumbles into the king, revealing him!`;
    state.lastAction = 'hit';
    checkDeath(state);
  }
}

// Resolve sight at the start of an enemy turn, per piece:
//   - not in sight        -> sleep (clear awake/surprised) and wander.
//   - newly in sight       -> freeze in surprise for this one turn (awake, no move).
//   - in sight and aware   -> hostile: it gets to move (hunt / attack).
// A wanderer only ever pokes one tile into view, so the turn after it appears (or
// the turn the king steps into view of it) it is reliably caught by surprise,
// then acts hostile while seen and returns to wandering once out of sight. The
// transient `frustrated` flag is cleared here so it only ever shows for one turn.
function beginEnemyPhase(state) {
  const next = structuredClone(state);
  let moverIds = [];
  const p = next.player;
  const invisible = Boolean(p.statuses && p.statuses.invisible > 0);
  // Ninja Silent: unaware foes don't notice him this phase — unless he attacked
  // last move, or they are right beside him.
  const stealthed = Boolean(p.stealth) && !p.attacked;
  if (!invisible) {
    recordSeenEnemies(next); // note any kinds that just came into view
  }

  for (const enemy of next.enemies) {
    const wasSurprised = enemy.surprised; // its state entering this phase
    enemy.frustrated = false;
    if (enemy.statue) {
      continue; // inert stone — never wakes from sight, only from proximity
    }
    // While the king is invisible, every piece is unaware: it wanders (and may
    // blunder into him), and turrets hold their fire.
    if (invisible) {
      enemy.awake = false;
      enemy.surprised = false;
      if (!enemy.turret && wanderEnemy(next, enemy, true) === 'bump') {
        resolveBump(next, enemy);
        if (next.gameOver) break;
      }
      continue;
    }
    // Iron Giant (siege): once it has laid eyes on the king it never loses him —
    // it keeps hunting his exact position even when he slips out of sight.
    if (enemy.boss && enemy.special === 'siege' && enemy.everSeen) {
      enemy.awake = true;
      enemy.surprised = false;
      moverIds.push(enemy.id);
      continue;
    }
    // Ninja Silent: an unaware foe that isn't adjacent simply doesn't spot him.
    const hiddenFromThis = stealthed && !enemy.awake && chebyshev(enemy.x, enemy.y, p.x, p.y) > 1;
    if (hiddenFromThis || !unitInSight(next, enemy.x, enemy.y)) {
      enemy.awake = false;
      enemy.surprised = false;
      if (!enemy.turret) {
        wanderEnemy(next, enemy); // turrets are fixed; everything else wanders
      }
      continue;
    }
    // In sight: a fresh sighting freezes the piece in surprise for ONE turn
    // (telegraphing its threat). It can never be surprised two turns running —
    // if it was surprised last turn, it acts now regardless.
    if (enemy.boss) enemy.everSeen = true; // a tracking boss remembers it saw him
    if (!enemy.awake && !wasSurprised) {
      enemy.awake = true;
      enemy.surprised = true;
    } else {
      enemy.awake = true;
      enemy.surprised = false;
      moverIds.push(enemy.id);
    }
  }

  // Conjured minions wink out of existence the moment they drift off the king's
  // screen (out of his sight).
  const before = next.enemies.length;
  next.enemies = next.enemies.filter((e) => !(e.summoned && !unitInSight(next, e.x, e.y)));
  if (next.enemies.length !== before) {
    moverIds = moverIds.filter((id) => next.enemies.some((e) => e.id === id));
  }

  // Hostile pieces act in a random order each turn (Fisher-Yates shuffle).
  for (let i = moverIds.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [moverIds[i], moverIds[j]] = [moverIds[j], moverIds[i]];
  }

  stepAllies(next); // the king's summons hunt alongside the enemy phase
  trampleBrush(next); // enemies/allies flatten brush they end on

  return { state: next, moverIds };
}

// Valkyrie Reflection: a ranged attack is turned back on its caster (the attack
// is negated, and the attacker is slain if it can be). Returns true if reflected.
function tryReflect(state, attacker) {
  if (!state.player.reflect) return false;
  state.lastShot = { fromX: state.player.x, fromY: state.player.y, toX: attacker.x, toY: attacker.y, role: attacker.mage ? 'mage' : 'turret' };
  slayEnemyAt(state, attacker.x, attacker.y); // hurled back (kills it if capturable)
  state.message = `The king reflects the ${attacker.kind}'s attack!`;
  state.lastAction = 'enemy';
  return true;
}

// A turret's turn: it holds its ground and fires along its piece pattern. If the
// king stands on one of its threatened tiles he is struck (unless warded); the
// turret is never expended, so it keeps watch indefinitely. A Ninja's Shadow makes
// turrets ignore him entirely.
function fireTurret(state, turret) {
  if (state.player.stealthStructures) {
    state.message = `A ${turret.kind} turret sits dormant.`;
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
    state.message =
      mit === 'evade'
        ? `The king dodges a ${turret.kind} turret's shot!`
        : `The king shrugs off a ${turret.kind} turret's shot!`;
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

// Pick a hostile destination: pounce on the king if reachable, else close in as
// far as possible (ties broken randomly).
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

// Resolve an enemy striking the king: apply damage unless mitigated, and remove
// the attacker if it expends itself (normal melee). Returns true if it is gone.
function strikeKing(state, enemy, expend) {
  const mit = rollMitigation(state.player);
  if (!mit) {
    state.player.hp -= 1;
    state.player.wasHit = true; // breaks the untouchable conduct
    addSpatter(state, state.player.x, state.player.y);
  }
  if (expend) {
    state.enemies = state.enemies.filter((p) => p.id !== enemy.id);
  }
  if (mit) {
    state.message = mitigationMessage(mit, enemy.kind);
    state.lastAction = 'enemy';
  } else {
    state.message = `A ${enemy.kind} strikes the king!`;
    state.lastAction = 'hit';
    checkDeath(state);
  }
  return expend;
}

// The slide directions a ranged piece fires along (rook = ranks/files, etc.).
function slideDirsFor(kind) {
  switch (kind) {
    case 'rook':
    case 'chancellor':
      return ORTHO;
    case 'bishop':
    case 'archbishop':
      return DIAG;
    case 'queen':
    case 'amazon':
      return [...ORTHO, ...DIAG];
    default:
      return [];
  }
}

// If the king lies on one of a piece's firing lines, return the tiles strictly
// between and whether a unit blocks it. Prefers an UNBLOCKED path (a clear slide
// line, or a knight leap — leaps are never blocked) over a blocked one. Null if
// the king is off every line. Walls always stop a line.
function lineToPlayer(state, piece) {
  const px = state.player.x;
  const py = state.player.y;
  let blockedResult = null;
  for (const [dx, dy] of slideDirsFor(piece.kind)) {
    let x = piece.x;
    let y = piece.y;
    const between = [];
    while (true) {
      x += dx;
      y += dy;
      if (x < 0 || x >= WORLD_SIZE || y < 0 || y >= WORLD_SIZE) break;
      if (terrainAt(state, x, y) === 'wall') break;
      if (x === px && y === py) {
        const blocked = between.some((t) => state.enemies.some((e) => e.x === t.x && e.y === t.y));
        if (!blocked) return { between, blocked: false };
        blockedResult = { between, blocked: true };
        break;
      }
      between.push({ x, y });
    }
  }
  // Knight-style leaps (for knights and the compound pieces) never blockable.
  if (['knight', 'archbishop', 'chancellor', 'amazon'].includes(piece.kind)) {
    for (const [dx, dy] of KNIGHT_STEPS) {
      if (piece.x + dx === px && piece.y + dy === py) {
        return { between: [], blocked: false };
      }
    }
  }
  return blockedResult;
}

// Every tile a mage's piercing bolt can reach (it pierces units, stopped only by
// walls / board edge, plus knight-leap landing tiles). Used for threat display.
function magePierceTiles(state, piece) {
  const tiles = [];
  for (const [dx, dy] of slideDirsFor(piece.kind)) {
    let x = piece.x;
    let y = piece.y;
    while (true) {
      x += dx;
      y += dy;
      if (x < 0 || x >= WORLD_SIZE || y < 0 || y >= WORLD_SIZE) break;
      if (terrainAt(state, x, y) === 'wall') break;
      tiles.push({ x, y });
    }
  }
  if (['knight', 'archbishop', 'chancellor', 'amazon'].includes(piece.kind)) {
    for (const [dx, dy] of KNIGHT_STEPS) {
      const x = piece.x + dx;
      const y = piece.y + dy;
      if (x >= 0 && x < WORLD_SIZE && y >= 0 && y < WORLD_SIZE && terrainAt(state, x, y) !== 'wall') {
        tiles.push({ x, y });
      }
    }
  }
  return tiles;
}

// Shared wandering-hostile turn: 50% close in on the king, 50% step at random. If
// allowAttack, landing on the king strikes him; otherwise the king's tile is
// avoided (ranged / summoning pieces never melee).
function moveTowardOrRandom(state, enemy, allowAttack) {
  const moves = getPieceMoves(enemy, state);
  const legal = allowAttack ? moves : moves.filter((m) => !(m.x === state.player.x && m.y === state.player.y));
  if (!legal.length) {
    enemy.frustrated = true;
    state.message = 'A piece is hemmed in.';
    state.lastAction = 'enemy';
    return state;
  }
  const chosen = Math.random() < 0.5 ? chooseHostileMove(legal, state.player.x, state.player.y) : legal[randomInt(legal.length)];
  enemy.x = chosen.x;
  enemy.y = chosen.y;
  if (allowAttack && enemy.x === state.player.x && enemy.y === state.player.y) {
    strikeKing(state, enemy, true);
    return state;
  }
  state.message = 'An enemy piece advances.';
  state.lastAction = 'enemy';
  return state;
}

// Mage turn: when CHARGED it fires a piercing bolt down its firing line, slaying
// EVERY unit between it and the king (friend or foe) and striking the king — then
// it must recharge (it can never attack two turns running). Uncharged, or with no
// line, it repositions (and recharges) and never melees.
function mageMove(state, enemy) {
  if (enemy.charged) {
    const line = lineToPlayer(state, enemy);
    if (line) {
      enemy.charged = false; // spent — cannot fire again next turn
      if (tryReflect(state, enemy)) return state; // Valkyrie hurls the spell back
      state.lastShot = { fromX: enemy.x, fromY: enemy.y, toX: state.player.x, toY: state.player.y, role: 'mage' };
      for (const t of line.between) {
        slayEnemyAt(state, t.x, t.y); // the bolt pierces everything in its path
      }
      const mit = rollMitigation(state.player);
      if (!mit) {
        state.player.hp -= 1;
        state.player.wasHit = true;
        addSpatter(state, state.player.x, state.player.y);
        state.message = `A ${enemy.kind} mage's bolt tears through the king!`;
        state.lastAction = 'hit';
        checkDeath(state);
      } else {
        state.message = `The king weathers a ${enemy.kind} mage's bolt!`;
        state.lastAction = 'enemy';
      }
      return state;
    }
  }
  enemy.charged = true; // didn't fire — recharge for next turn
  return moveTowardOrRandom(state, enemy, false);
}

// Skirmisher turn: it can strike EVERY turn (no cooldown). With a clear firing
// line (or a knight leap) it darts in, strikes, and bounds back to its spawn.
// With a line that is blocked by a unit it fumes (frustrated). With no line at
// all it repositions.
function skirmisherMove(state, enemy) {
  const line = lineToPlayer(state, enemy);
  if (line && !line.blocked) {
    if (tryReflect(state, enemy)) return state; // Valkyrie turns the dart back
    state.lastShot = { fromX: enemy.x, fromY: enemy.y, toX: state.player.x, toY: state.player.y, role: 'skirmisher' };
    strikeKing(state, enemy, false); // strikes from range, does not expend itself
    if (!state.gameOver) {
      retreatSkirmisher(state, enemy);
      if (state.lastAction !== 'enemy') {
        state.message = `A ${enemy.kind} skirmisher strikes and darts away!`;
        state.lastAction = 'enemy';
      }
    }
    return state;
  }
  if (line && line.blocked) {
    enemy.frustrated = true; // has a line but a unit is in the way
    state.message = `A ${enemy.kind} skirmisher's line is blocked.`;
    state.lastAction = 'enemy';
    return state;
  }
  return moveTowardOrRandom(state, enemy, false);
}

// A skirmisher bounds back to its spawn after a strike — or any free neighbour;
// if truly boxed in, it stays put.
function retreatSkirmisher(state, enemy) {
  const occupiedAt = (x, y) =>
    (x === state.player.x && y === state.player.y) || state.enemies.some((e) => e.id !== enemy.id && e.x === x && e.y === y);
  const free = (x, y) =>
    x >= 0 && x < WORLD_SIZE && y >= 0 && y < WORLD_SIZE && isStandable(terrainAt(state, x, y)) && !occupiedAt(x, y);
  if (free(enemy.homeX, enemy.homeY)) {
    enemy.x = enemy.homeX;
    enemy.y = enemy.homeY;
    return;
  }
  for (const [dx, dy] of [...ORTHO, ...DIAG]) {
    if (free(enemy.x + dx, enemy.y + dy)) {
      enemy.x += dx;
      enemy.y += dy;
      return;
    }
  }
}

// A random kind in the floor roster strictly weaker (lower value) than `kind` —
// what a summoner may conjure (falls back to the weakest available).
function weakerKind(floor, kind) {
  const cap = CARD_POINTS[kind] || 2;
  const pool = enemyRosterForFloor(floor).filter((k) => (CARD_POINTS[k] || 2) < cap);
  if (pool.length) return pool[randomInt(pool.length)];
  const roster = enemyRosterForFloor(floor);
  return roster.reduce((weak, k) => ((CARD_POINTS[k] || 2) < (CARD_POINTS[weak] || 2) ? k : weak), roster[0]);
}

// Conjure a fresh minion (weaker than the summoner) on a free tile beside it.
function summonAdjacent(state, summoner) {
  const dirs = [...ORTHO, ...DIAG];
  for (let i = dirs.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [dirs[i], dirs[j]] = [dirs[j], dirs[i]];
  }
  for (const [dx, dy] of dirs) {
    const x = summoner.x + dx;
    const y = summoner.y + dy;
    if (x < 0 || x >= WORLD_SIZE || y < 0 || y >= WORLD_SIZE) continue;
    if (!isStandable(terrainAt(state, x, y))) continue;
    if (x === state.player.x && y === state.player.y) continue;
    if (state.enemies.some((e) => e.x === x && e.y === y)) continue;
    const minion = createEnemy(weakerKind(state.floor, summoner.kind), x, y);
    minion.summoned = true;
    minion.awake = true; // already roused to the fight
    state.enemies.push(minion);
    return true;
  }
  return false;
}

// Summoner turn: when CHARGED it conjures a minion on an adjacent tile, then must
// recharge (never two turns running). If charged but no adjacent tile is free it
// fumes (frustrated). Uncharged it repositions. It never strikes the king.
function summonerMove(state, enemy) {
  if (enemy.charged) {
    if (state.enemies.length < MAX_ENEMIES && summonAdjacent(state, enemy)) {
      enemy.charged = false;
      state.message = `A ${enemy.kind} summoner conjures a minion!`;
      state.lastAction = 'enemy';
      return state;
    }
    // Wanted to summon but hemmed in — fume, and recharge for next turn.
    enemy.frustrated = true;
    state.message = `A ${enemy.kind} summoner is hemmed in, unable to conjure.`;
    state.lastAction = 'enemy';
    return state;
  }
  enemy.charged = true; // didn't summon — recharge for next turn
  return moveTowardOrRandom(state, enemy, false);
}

// A boss strikes without expending itself (bosses don't spend themselves on a hit).
// A blow costs the boss's damage (most deal 1; the Minotaur gores for more).
function bossHit(state, boss, hitMsg, dmg) {
  const mit = rollMitigation(state.player);
  if (!mit) {
    state.player.hp -= dmg || boss.bossDamage || 1;
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

// Teleport a boss onto a free tile adjacent to the king. Returns true on success.
function blinkTowardKing(state, boss) {
  const dirs = [...ORTHO, ...DIAG];
  for (let i = dirs.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [dirs[i], dirs[j]] = [dirs[j], dirs[i]];
  }
  for (const [dx, dy] of dirs) {
    const x = state.player.x + dx;
    const y = state.player.y + dy;
    if (x < 0 || x >= WORLD_SIZE || y < 0 || y >= WORLD_SIZE) continue;
    if (!isStandable(terrainAt(state, x, y))) continue;
    if (state.enemies.some((e) => e.id !== boss.id && e.x === x && e.y === y)) continue;
    boss.x = x;
    boss.y = y;
    return true;
  }
  return false;
}

// Conjure a fresh minion of a specific kind on a free tile beside `origin`
// (returns the minion, or null). Like summonAdjacent but with a chosen kind.
function summonKindAdjacent(state, origin, kind, roleFlag) {
  if (state.enemies.length >= MAX_ENEMIES) return null;
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
    const minion = createEnemy(kind, x, y);
    minion.summoned = true;
    minion.awake = true;
    if (roleFlag) minion[roleFlag] = true;
    state.enemies.push(minion);
    return minion;
  }
  return null;
}

// A boss conjures a random roster minion bearing a random role trait beside it
// (the Lich's necromancy, the Balrog's inferno).
const BOSS_SUMMON_TRAITS = ['armored', 'mounted', 'flying', 'skirmisher', 'mage'];
function summonRandomTraitMinion(state, boss) {
  const kind = randomEnemyKind(state.floor);
  let trait = BOSS_SUMMON_TRAITS[randomInt(BOSS_SUMMON_TRAITS.length)];
  if (trait === 'mounted' && isJumperKind(kind)) trait = null; // jumpers are never mounted
  if ((trait === 'mage' || trait === 'skirmisher') && (kind === 'pawn' || kind === 'king')) trait = null;
  return summonKindAdjacent(state, boss, kind, trait);
}

// A "true" firing line that ignores units, brush, and trees (stopped only by
// walls / the board edge) — the Centaur's shot that pierces the wood. Returns the
// tiles between the boss and the king if he stands on such a line, else null.
function trueLineToPlayer(state, boss) {
  const px = state.player.x;
  const py = state.player.y;
  for (const [dx, dy] of [...ORTHO, ...DIAG]) {
    let x = boss.x;
    let y = boss.y;
    const between = [];
    while (true) {
      x += dx;
      y += dy;
      if (x < 0 || x >= WORLD_SIZE || y < 0 || y >= WORLD_SIZE) break;
      if (terrainAt(state, x, y) === 'wall') break;
      if (x === px && y === py) return { between };
      between.push({ x, y });
    }
  }
  return null;
}

// Advance a boss one step toward the king (never onto him), returning the tile it
// took (or null if hemmed in). Sets frustrated when it cannot move.
function bossAdvance(state, boss) {
  const king = state.player;
  const moves = getPieceMoves(boss, state).filter((m) => !(m.x === king.x && m.y === king.y));
  if (!moves.length) {
    boss.frustrated = true;
    return null;
  }
  const chosen = chooseHostileMove(moves, king.x, king.y);
  const from = { x: boss.x, y: boss.y };
  boss.x = chosen.x;
  boss.y = chosen.y;
  return { from, to: chosen };
}

// A mounted boss that can reach the king's tile tramples him; returns true if it
// resolved the turn that way.
function bossTrample(state, boss) {
  if (!boss.mounted) return false;
  if (!getPieceMoves(boss, state).some((m) => m.x === state.player.x && m.y === state.player.y)) return false;
  trampleKing(state, boss);
  return true;
}

// Boss turn: each guardian wields its unique `special`, then (by default) hunts and
// strikes. A boss never expends itself and never simply steps onto the king.
function bossMove(state, boss) {
  const king = state.player;
  const adjacent = canMeleeStrike(state, boss);
  const dmg = boss.bossDamage || 1;

  switch (boss.special) {
    case 'rally': {
      // Warlord: on first rousing, calls up an armored soldier.
      if (!boss.rallied) {
        boss.rallied = true;
        if (summonKindAdjacent(state, boss, 'pawn', 'armored')) {
          state.message = `${bossTitle(boss)} rallies an armored soldier!`;
          state.lastAction = 'enemy';
          return state;
        }
      }
      break;
    }
    case 'trueshot': {
      // Centaur: a shot that pierces wood and ranks alike, then it holds ground.
      const line = trueLineToPlayer(state, boss);
      if (line) {
        if (tryReflect(state, boss)) return state;
        state.lastShot = { fromX: boss.x, fromY: boss.y, toX: king.x, toY: king.y, role: 'boss' };
        return bossHit(state, boss, `${bossTitle(boss)} looses an arrow through the trees!`, dmg);
      }
      break;
    }
    case 'frostwake': {
      // Yeti: mounted charger that freezes the ground in its wake.
      if (bossTrample(state, boss)) return state;
      if (adjacent) return bossHit(state, boss, `${bossTitle(boss)} mauls the king!`, dmg);
      const step = bossAdvance(state, boss);
      if (step) {
        if (!state.terrain) state.terrain = {};
        if (terrainAt(state, step.from.x, step.from.y) !== 'wall') state.terrain[`${step.from.x},${step.from.y}`] = 'ice';
        if (canMeleeStrike(state, boss)) return bossHit(state, boss, `${bossTitle(boss)} mauls the king!`, dmg);
        state.message = `${bossTitle(boss)} lumbers closer, frost trailing behind.`;
        state.lastAction = 'enemy';
        return state;
      }
      state.message = `${bossTitle(boss)} is hemmed in.`;
      state.lastAction = 'enemy';
      return state;
    }
    case 'siege': {
      // Iron Giant: smashes through walls to reach the king.
      if (adjacent) return bossHit(state, boss, `${bossTitle(boss)} smashes the king!`, dmg);
      const step = bossAdvance(state, boss);
      if (step) {
        if (canMeleeStrike(state, boss)) return bossHit(state, boss, `${bossTitle(boss)} smashes the king!`, dmg);
        state.message = `${bossTitle(boss)} advances.`;
        state.lastAction = 'enemy';
        return state;
      }
      // Hemmed in by a wall — smash the wall lying toward the king, then wait.
      const wx = boss.x + Math.sign(king.x - boss.x);
      const wy = boss.y + Math.sign(king.y - boss.y);
      if (state.terrain && state.terrain[`${wx},${wy}`] === 'wall') {
        delete state.terrain[`${wx},${wy}`];
        state.message = `${bossTitle(boss)} smashes a wall to rubble!`;
        state.lastAction = 'enemy';
        return state;
      }
      boss.frustrated = true;
      state.message = `${bossTitle(boss)} fumes.`;
      state.lastAction = 'enemy';
      return state;
    }
    case 'necromancy': {
      // Lich: raises the dead while the king keeps his distance.
      if (!adjacent && summonRandomTraitMinion(state, boss)) {
        state.message = `${bossTitle(boss)} raises a fresh horror!`;
        state.lastAction = 'enemy';
        return state;
      }
      break;
    }
    case 'gaze': {
      // Medusa: a petrifying gaze harries the king whenever she can see him — plus
      // a piercing bolt when he is on her line.
      const line = lineToPlayer(state, boss);
      if (line) {
        if (tryReflect(state, boss)) return state;
        state.lastShot = { fromX: boss.x, fromY: boss.y, toX: king.x, toY: king.y, role: 'boss' };
        for (const t of line.between) slayEnemyAt(state, t.x, t.y);
        return bossHit(state, boss, `${bossTitle(boss)}'s gaze sears the king!`, dmg);
      }
      // No line — advance, then let the gaze still bite (she is in his sight).
      bossAdvance(state, boss);
      return bossHit(state, boss, `${bossTitle(boss)}'s gaze petrifies the king!`, dmg);
    }
    case 'inferno': {
      // Balrog: burns the king while adjacent; conjures horrors when he flees.
      if (adjacent) return bossHit(state, boss, `${bossTitle(boss)} engulfs the king in flame!`, dmg);
      if (summonRandomTraitMinion(state, boss)) {
        bossAdvance(state, boss);
        state.message = `${bossTitle(boss)} spits forth a demon!`;
        state.lastAction = 'enemy';
        return state;
      }
      break;
    }
    default:
      break; // 'aquatic' / 'bonehide' / 'none' just hunt (their trick is at death)
  }

  // Default hunt: trample if mounted & able, strike if in reach, else close in.
  if (bossTrample(state, boss)) return state;
  if (adjacent) return bossHit(state, boss, `${bossTitle(boss)} strikes the king!`, dmg);
  const step = bossAdvance(state, boss);
  if (!step) {
    state.message = `${bossTitle(boss)} fumes.`;
    state.lastAction = 'enemy';
    return state;
  }
  if (canMeleeStrike(state, boss)) return bossHit(state, boss, `${bossTitle(boss)} strikes the king!`, dmg);
  state.message = `${bossTitle(boss)} advances.`;
  state.lastAction = 'enemy';
  return state;
}

// Move a single (seen, aware) enemy: capture the king if possible, else close in.
function moveEnemy(state, enemyId) {
  const next = structuredClone(state);
  next.lastShot = null; // transient: a ranged attack sets this for the animation
  const enemy = next.enemies.find((piece) => piece.id === enemyId);
  if (!enemy) {
    return next;
  }

  // Role-specific turns.
  if (enemy.turret) {
    return fireTurret(next, enemy); // fixed emplacement; fires its pattern
  }
  if (enemy.mage) {
    return mageMove(next, enemy);
  }
  if (enemy.skirmisher) {
    return skirmisherMove(next, enemy);
  }
  if (enemy.summoner) {
    return summonerMove(next, enemy);
  }
  if (enemy.boss) {
    return bossMove(next, enemy);
  }
  return meleeMove(next, enemy); // normal / armored / flying / mounted
}

// Can this enemy strike the king from where it stands? Melee pieces need to be
// adjacent; jumpers can also reach across at a knight's leap (over any blockers).
function canMeleeStrike(state, enemy) {
  const king = state.player;
  if (chebyshev(enemy.x, enemy.y, king.x, king.y) === 1) return true;
  if (isJumperKind(enemy.kind)) {
    for (const [dx, dy] of KNIGHT_STEPS) {
      if (enemy.x + dx === king.x && enemy.y + dy === king.y) return true;
    }
  }
  return false;
}

// The new melee model: a piece advances toward the king as far as it can (never
// onto him) and strikes when in reach, PERSISTING rather than spending itself.
// Mounted pieces charge into his square and shove him back.
function meleeMove(state, enemy) {
  const king = state.player;

  // Mounted charge: if it can reach the king's square, trample him.
  if (enemy.mounted && getPieceMoves(enemy, state).some((m) => m.x === king.x && m.y === king.y)) {
    return trampleKing(state, enemy);
  }

  // Already in reach — strike without moving.
  if (canMeleeStrike(state, enemy)) {
    strikeKing(state, enemy, false);
    return state;
  }

  // Otherwise advance toward the king (never onto his tile).
  const moves = getPieceMoves(enemy, state).filter((m) => !(m.x === king.x && m.y === king.y));
  if (!moves.length) {
    enemy.frustrated = true;
    state.message = 'A cornered piece fumes, unable to move.';
    state.lastAction = 'enemy';
    return state;
  }
  const chosen = chooseHostileMove(moves, king.x, king.y);
  enemy.x = chosen.x;
  enemy.y = chosen.y;
  if (canMeleeStrike(state, enemy)) {
    strikeKing(state, enemy, false);
  } else {
    state.message = 'An enemy piece advances.';
    state.lastAction = 'enemy';
  }
  return state;
}

// A mounted piece tramples the king: it charges into his square, shoving him to
// the tile beyond. If that tile is blocked/impassable it strikes normally instead.
function trampleKing(state, enemy) {
  const king = state.player;
  const dx = Math.sign(king.x - enemy.x);
  const dy = Math.sign(king.y - enemy.y);
  const bx = king.x + dx;
  const by = king.y + dy;
  const occupied = (x, y) => state.enemies.some((e) => e.id !== enemy.id && e.x === x && e.y === y) || (state.allies || []).some((a) => a.x === x && a.y === y);
  const canPush = bx >= 0 && bx < WORLD_SIZE && by >= 0 && by < WORLD_SIZE && isStandable(terrainAt(state, bx, by)) && !occupied(bx, by);
  if (!canPush) {
    strikeKing(state, enemy, false); // nowhere to shove him — a plain blow
    return state;
  }
  const mit = rollMitigation(king);
  if (!mit) {
    king.hp -= enemy.bossDamage || 1; // a mounted boss (Minotaur) tramples for its gore damage
    king.wasHit = true;
    addSpatter(state, king.x, king.y);
  }
  const kx = king.x;
  const ky = king.y;
  king.x = bx;
  king.y = by;
  enemy.x = kx; // the charger takes the king's old ground
  enemy.y = ky;
  if (mit) {
    state.message = mitigationMessage(mit, enemy.kind);
    state.lastAction = 'enemy';
  } else {
    state.message = `A mounted ${enemy.kind} tramples the king!`;
    state.lastAction = 'hit';
    checkDeath(state);
  }
  updateDiscovery(state);
  return state;
}

// Difficulty over time: drop fresh enemies on standable ground out of the king's
// sight, and faster the longer he lingers on a floor — so the board fills up more
// and more. The population ceiling grows with depth (capped for safety).
function maybeSpawnEnemy(state) {
  const next = structuredClone(state);
  next.turnsSinceSpawn += 1;
  // Spawns accelerate the longer the king lingers, hitting their fastest at
  // MAX_TURNS_SCARY turns spent on this floor. The whole curve is twice as fast as
  // the raw interval (rate doubled), bottoming out at one spawn per turn.
  const ramp = Math.min(1, next.turn / MAX_TURNS_SCARY);
  const interval = Math.max(1, Math.round((next.spawnInterval - (next.spawnInterval - 2) * ramp) / 2));
  const cap = Math.min(MAX_ENEMIES, 10 + next.floor * 4);
  if (next.turnsSinceSpawn < interval || next.enemies.length >= cap) {
    return next;
  }
  next.turnsSinceSpawn = 0;

  const occupied = new Set([`${next.player.x},${next.player.y}`]);
  for (const enemy of next.enemies) {
    occupied.add(`${enemy.x},${enemy.y}`);
  }
  for (const item of next.items) {
    occupied.add(`${item.x},${item.y}`);
  }
  const tile = findFreeTile(occupied, (x, y) => isStandable(terrainAt(next, x, y)) && !inLineOfSight(next, x, y));
  if (tile) {
    next.enemies.push(withRolledRole(createEnemy(randomEnemyKind(next.floor), tile.x, tile.y), next.floor));
  }
  return next;
}

// Buy a weapon-shop offer (identified by its index in weaponShop.offers). With a
// free slot the card is added; with all slots full, `replaceIndex` says which to
// swap out. `shopMessage` reports the result.
function buyCard(state, offerIndex, replaceIndex) {
  const next = structuredClone(state);
  const p = next.player;
  const offer = next.weaponShop && next.weaponShop.offers && next.weaponShop.offers[offerIndex];
  if (!offer || offer.sold || !isCardKind(offer.kind)) {
    return next;
  }
  const traits = offer.traits || [];
  const cost = cardCost(offer.kind, traits.length);
  if (p.gold < cost) {
    next.shopMessage = 'Not enough gold.';
    return next;
  }
  const card = { kind: offer.kind, traits: [...traits], cooldown: cardCooldown(offer.kind), remaining: 0 };
  if (p.cards.length < p.maxCards) {
    p.cards.push(card);
  } else if (replaceIndex != null && replaceIndex >= 0 && replaceIndex < p.cards.length) {
    p.cards[replaceIndex] = card;
  } else {
    next.shopMessage = 'Card slots full — choose one to replace.';
    return next;
  }
  p.gold -= cost;
  p.boughtCard = true; // breaks the ascetic conduct
  offer.sold = true;
  next.shopMessage = `Acquired the ${offer.kind} card.`;
  return next;
}

// Buy a potion from the apothecary into the king's satchel (potions are held,
// then used on demand from the HUD). Stock is unlimited; only gold and satchel
// space limit purchases.
function buyConsumable(state, offerIndex) {
  const next = structuredClone(state);
  const p = next.player;
  const offer = next.potionShop && next.potionShop.offers && next.potionShop.offers[offerIndex];
  if (!offer || !CONSUMABLES[offer.key]) {
    return next;
  }
  const def = CONSUMABLES[offer.key];
  if (p.gold < def.cost) {
    next.shopMessage = 'Not enough gold.';
    return next;
  }
  if (!Array.isArray(p.consumables)) p.consumables = [];
  if (p.consumables.length >= p.maxConsumables) {
    next.shopMessage = 'Your satchel is full.';
    return next;
  }
  p.consumables.push(offer.key);
  p.gold -= def.cost;
  next.shopMessage = `Bought a ${def.name}.`;
  return next;
}

// Drink a held potion (by satchel index): it takes effect and a turn passes, so
// the enemies then move. Mirrors the turn upkeep in applyArrival.
function consumeItem(state, index) {
  const next = structuredClone(state);
  const p = next.player;
  if (!Array.isArray(p.consumables) || index < 0 || index >= p.consumables.length) {
    next.message = 'No such potion.';
    next.lastAction = 'blocked';
    return next;
  }
  const potion = p.consumables[index];
  // Alchemist's Quick Draw: drinking is a free action (no turn passes).
  if (p.freePotion) {
    applyConsumable(next, potion);
    p.consumables.splice(index, 1);
    next.enemyTurn = false;
    next.lastAction = 'consume-free';
    updateDiscovery(next);
    return next;
  }
  passTurn(next); // one turn's upkeep, then the potion takes effect
  next.enemyTurn = true;
  applyConsumable(next, potion); // sets next.message; may set barkskin (after the tick)
  p.consumables.splice(index, 1);
  next.lastAction = 'consume';
  updateDiscovery(next);
  return next;
}

// Passable, unoccupied tiles the king can currently see — valid Blink targets.
function blinkTargets(state) {
  const tiles = [];
  for (const key of computeVisibleTiles(state)) {
    const [x, y] = key.split(',').map(Number);
    if (x === state.player.x && y === state.player.y) continue;
    if (!isStandable(terrainAt(state, x, y))) continue;
    if (state.enemies.some((e) => e.x === x && e.y === y)) continue;
    tiles.push({ x, y });
  }
  return tiles;
}

// Use a Blink Scroll (held at `index`) to hop to a chosen visible tile. Costs a
// turn unless Quick Draw makes it free.
function useBlink(state, index, x, y) {
  const next = structuredClone(state);
  const p = next.player;
  if (!Array.isArray(p.consumables) || p.consumables[index] !== 'blink') {
    next.message = 'No blink scroll ready.';
    next.lastAction = 'blocked';
    return next;
  }
  if (!blinkTargets(next).some((t) => t.x === x && t.y === y)) {
    next.message = 'You cannot blink there.';
    next.lastAction = 'blocked';
    return next;
  }
  const free = Boolean(p.freePotion);
  if (!free) {
    passTurn(next);
  }
  p.x = x;
  p.y = y;
  p.consumables.splice(index, 1);
  next.enemyTurn = !free;
  next.lastAction = free ? 'consume-free' : 'consume';
  next.message = 'You blink across the chamber.';
  updateDiscovery(next);
  return next;
}

// Tiles on the eight straight lines from the king — valid Scroll of Digging aims.
function diggingTargets(state) {
  const tiles = [];
  for (const [dx, dy] of [...ORTHO, ...DIAG]) {
    let x = state.player.x + dx;
    let y = state.player.y + dy;
    while (x >= 0 && x < WORLD_SIZE && y >= 0 && y < WORLD_SIZE) {
      tiles.push({ x, y });
      x += dx;
      y += dy;
    }
  }
  return tiles;
}

// Use a Scroll of Digging (held at `index`): clear the whole straight line from
// the king through the aimed tile to the board edge back to open ground.
function useDigging(state, index, x, y) {
  const next = structuredClone(state);
  const p = next.player;
  if (!Array.isArray(p.consumables) || p.consumables[index] !== 'digging') {
    next.message = 'No digging scroll ready.';
    next.lastAction = 'blocked';
    return next;
  }
  const dx = Math.sign(x - p.x);
  const dy = Math.sign(y - p.y);
  const adx = Math.abs(x - p.x);
  const ady = Math.abs(y - p.y);
  if ((dx === 0 && dy === 0) || !(adx === ady || adx === 0 || ady === 0)) {
    next.message = 'Aim the scroll along a straight line.';
    next.lastAction = 'blocked';
    return next;
  }
  if (!next.terrain) next.terrain = {};
  let cx = p.x + dx;
  let cy = p.y + dy;
  while (cx >= 0 && cx < WORLD_SIZE && cy >= 0 && cy < WORLD_SIZE) {
    delete next.terrain[`${cx},${cy}`]; // back to open ground
    cx += dx;
    cy += dy;
  }
  const free = Boolean(p.freePotion);
  if (!free) passTurn(next);
  p.consumables.splice(index, 1);
  next.enemyTurn = !free;
  next.lastAction = free ? 'consume-free' : 'consume';
  next.message = 'A Scroll of Digging carves a line through the terrain.';
  updateDiscovery(next);
  return next;
}

// The end-of-run honours the player earned (conducts kept the whole run).
function earnedConducts(player) {
  const conducts = [];
  if (!player.usedAltar) conducts.push({ name: 'Atheist', desc: 'Never used an altar.' });
  if (!player.killedEnemy) conducts.push({ name: 'Pacifist', desc: 'Never killed an enemy.' });
  if (!player.boughtCard) conducts.push({ name: 'Ascetic', desc: 'Never bought a weapon card.' });
  if (!player.wasHit) conducts.push({ name: 'Untouchable', desc: 'Never took a hit.' });
  return conducts;
}

// Final score: rewards reaching deep floors quickly. Rises ~floor^1.25 and is
// divided by the total turns taken across the whole run.
function finalScore(state) {
  const turns = Math.max(1, state.player.totalTurns || 0);
  return Math.round((Math.pow(state.floor, 1.25) * 100) / turns);
}

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
    // Special roles — at most one per piece (the "status"). All default off, and
    // each is restricted to a few kinds (see ROLE_UNITS). Bosses may also carry
    // one as a trait.
    //   statue      - inert stone until the king steps beside it, then it wakes.
    //   turret      - a fixed emplacement that fires its piece pattern; never
    //                 moves and cannot be destroyed.
    //   boss        - the floor's guardian; carries HP and a signature ability.
    //   skirmisher  - hits and runs: retreats to its spawn after striking.
    //   armored     - shrugs off a hit (its shield "breaks"); the king can't take
    //                 its tile, so he stops short. Re-arms out of the king's sight.
    //   summoner    - conjures fresh pieces beside it (odd turns); never strikes.
    //   mage        - fires a piercing ranged blast along its line (odd turns).
    //   flying      - moves over any terrain but walls.
    statue: false,
    turret: false,
    boss: false,
    skirmisher: false,
    armored: false,
    brokenShield: false, // an armored unit whose shield has been shattered (re-arms out of sight)
    summoner: false,
    summoned: false, // a STATE (not a role): conjured, and dispelled if it turns non-hostile
    mage: false,
    flying: false, // moves over any terrain but walls
    ability: null, // (legacy) unused; bosses now carry `special` (see createBoss)
    charged: true, // mages/summoners can act only when charged (not two turns running)
    lastSeen: null, // {x,y}: the last tile the king was seen on (for out-of-sight pursuit)
    lastSeenTtl: 0, // turns of pursuit remaining before it loses the trail
  };
}

// The single special role a piece carries (or 'normal'), for display / icons.
// (Summoned is a STATE now, not a role, so it isn't listed here.)
function enemyRole(enemy) {
  if (enemy.boss) return 'boss';
  if (enemy.statue) return 'statue';
  if (enemy.turret) return 'turret';
  if (enemy.mage) return 'mage';
  if (enemy.skirmisher) return 'skirmisher';
  if (enemy.summoner) return 'summoner';
  if (enemy.armored || enemy.brokenShield) return 'armored';
  if (enemy.flying) return 'flying';
  return 'normal';
}

// The flavourful name a unit shows in the UI for its role+kind (or null). Purely
// cosmetic — e.g. an armored pawn reads as a "Guard", a flying queen a "Banshee".
function enemyDisplayName(enemy) {
  if (enemy.boss) return enemy.bossName ? enemy.bossName.replace(/^the /, '') : null;
  const role = enemyRole(enemy);
  const names = ROLE_NAMES[role];
  return names && names[enemy.kind] ? names[enemy.kind] : null;
}

const JUMPER_KINDS = ['knight', 'archbishop', 'chancellor', 'amazon'];
function isJumperKind(kind) {
  return JUMPER_KINDS.includes(kind);
}

// Roll the (single) role a spawn of this kind may bear on this floor, or null.
// Each kind is eligible for at most one role (ROLE_FOR_KIND); whether it actually
// gains it is governed by the floor's thematic `role` weight, so the "right" foes
// crowd each stage (Guards on the Battlefield, Horse Archers in the Forest, …).
function rollEnemyRole(floor, kind) {
  const role = ROLE_FOR_KIND[kind];
  if (!role) return null;
  const level = levelForFloor(floor);
  const chance = (level && level.weights && level.weights.role) || 0;
  return Math.random() < chance ? role : null;
}

// Give a freshly-created ordinary enemy a rolled role (mutates and returns it).
function withRolledRole(enemy, floor) {
  const role = rollEnemyRole(floor, enemy.kind);
  if (role) enemy[role] = true;
  return enemy;
}

// Whether a given enemy can be TARGETED by the king right now. The Ranger's
// Deadshot ignores all defenses. Otherwise statues/turrets are untouchable.
// Bosses are always targetable (they carry HP and take multiple blows).
function isCapturable(state, enemy) {
  if (!enemy) return false;
  if (state.player && state.player.ignoreDefenses) return true;
  if (enemy.statue || enemy.turret) return false;
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

// Pick a random kind from the floor's pool, biased by the floor's thematic kind
// weights (so the "right" pieces crowd each stage); unlisted kinds weigh 1.
function randomEnemyKind(floor) {
  const pool = enemyRosterForFloor(floor);
  const level = levelForFloor(floor);
  const kw = (level && level.weights && level.weights.kinds) || null;
  if (!kw) return pool[randomInt(pool.length)];
  const weights = pool.map((k) => (kw[k] != null ? kw[k] : 1));
  let total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < pool.length; i += 1) {
    r -= weights[i];
    if (r < 0) return pool[i];
  }
  return pool[pool.length - 1];
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
  const spec = (levelForFloor(floor) || { boss: { name: 'the Guardian', phases: ['queen'], traits: [], special: 'none', damage: 1, hp: 3 } }).boss;
  const boss = createEnemy(spec.phases[0], x, y);
  boss.boss = true;
  boss.bossName = spec.name;
  boss.phases = spec.phases.slice();
  boss.phase = 0;
  boss.special = spec.special;
  boss.bossDamage = spec.damage || 1;
  boss.maxHp = spec.hp || 3; // HP PER PHASE (the bar refills when it sheds a form)
  boss.hp = boss.maxHp;
  boss.respawnDeath = Boolean(spec.respawnDeath); // Lich: rises again when its last form falls
  boss.meleeOnly = Boolean(spec.meleeOnly); // Bone Dragon: ranged blows glance off
  boss.deaths = 0; // times felled (gold is paid on the first)
  boss.charged = true;
  boss.regenTick = false; // Hydra: heals every other turn
  for (const t of spec.traits || []) boss[t] = true; // armored / mage / summoner / skirmisher / flying
  boss.shieldUp = Boolean(boss.armored); // armored boss: absorbs a hit per phase, re-arms out of sight
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
  'stealthStructures', 'stealth', 'familiar', 'reanimate', 'extraLife', 'goldOnKill',
  'freePotion', 'frenzy', 'revealFloor', 'xraySight', 'spellHaste', 'freeSpell', 'spellSurprise',
];

// Apply a perk's grants directly to a player object (stat bumps + rule flags).
function applyPerk(player, grants) {
  if (grants.maxHp) {
    player.maxHp += grants.maxHp;
    player.hp += grants.maxHp;
  }
  if (!player.caps) player.caps = { melee: 0, ranged: 0, spell: 0 };
  if (grants.maxMelee) player.caps.melee += grants.maxMelee;
  if (grants.maxRanged) player.caps.ranged += grants.maxRanged;
  if (grants.maxSpell) player.caps.spell += grants.maxSpell;
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
    caps: { melee: 0, ranged: 0, spell: 0 }, // per-category card caps (set from the class below)
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
  player.caps = { ...(cls.caps || { melee: 1, ranged: 0, spell: 0 }) }; // base per-category caps
  grantClassLevel(player, CLASSES[classKey] ? classKey : 'valkyrie'); // free level-1 perk (may raise a cap)
  if (cls.weapon) {
    player.cards.push(makeCard(cls.weapon.kind, cls.weapon.category || 'melee', cls.weapon.rating || 1, [...(cls.weapon.traits || [])]));
  } else if (cls.startKit === 'potions') {
    // Alchemist: a satchel of random potions, filled to capacity.
    while (player.consumables.length < player.maxConsumables) player.consumables.push(POTION_KINDS[randomInt(POTION_KINDS.length)]);
  }
  return player;
}

// Build a card record (weapon) with its category, rating, cooldown, and traits.
function makeCard(kind, category, rating, traits) {
  return {
    kind,
    category: category || 'melee',
    rating: rating || 1,
    traits: traits || [],
    cooldown: cardCooldown(kind, category || 'melee'),
    remaining: 0,
  };
}

// How many cards of a category the king holds, and his cap for it.
function cardCountByCategory(player, category) {
  return (player.cards || []).filter((c) => (c.category || 'melee') === category).length;
}
function cardCapFor(player, category) {
  return (player.caps && player.caps[category]) || 0;
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

// Roll the weapon traits for a shop card of a given kind+category: a first trait
// scales in with depth, and each further trait is increasingly rare. Traits are
// drawn only from the card's own category (and never Overhead on a knight).
function rollCardTraits(floor, kind, category) {
  const pool = traitsForCard(kind, category || 'melee');
  if (!pool.length) return [];
  const base = Math.min(MAX_TRAIT_CHANCE, MAX_TRAIT_CHANCE * ((floor - 1) / Math.max(1, FINAL_FLOOR - 1)));
  let count = Math.random() < base ? 1 : 0;
  if (count === 1 && Math.random() < 0.25) {
    count = 2;
    while (count < pool.length && Math.random() < 0.5) count += 1;
  }
  const picked = pickSome(pool, count);
  // Weather traits are mutually exclusive — keep at most one.
  let sawWeather = false;
  return picked.filter((t) => {
    if (!isWeatherTrait(t)) return true;
    if (sawWeather) return false;
    sawWeather = true;
    return true;
  });
}

// Roll a card's rating (1-3): rating 1 is common, higher ratings scale in slowly
// with depth (rating 3 only shows up in the deeper floors).
function rollCardRating(floor) {
  const t = (floor - 1) / Math.max(1, FINAL_FLOOR - 1);
  if (Math.random() < 0.25 * t) return 3;
  if (Math.random() < 0.5 * t) return 2;
  return 1;
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
    fires: {}, // burning tiles ("x,y" -> turns of life left); see resolveFires
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
        withRolledRole(guard, floor); // cohorts pick up the stage's thematic roles
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

  // A weapon shop of one of three variants — blacksmith (melee), fletcher (ranged),
  // or library (spell) — stocking category cards drawn from the kinds the king has
  // seen, each rolling a rating and a set of same-category traits.
  if (Math.random() < 0.55) {
    const variants = Object.keys(SHOP_VARIANTS);
    const variant = variants[randomInt(variants.length)];
    const category = SHOP_VARIANTS[variant];
    const kinds = pickSome(
      (player.seenKinds || []).filter((kind) => isCardKind(kind) && kindAllowsCategory(kind, category)),
      SHOP_CHOICES,
    );
    const shopOffers = kinds.map((kind) => {
      const rating = rollCardRating(floor);
      return { kind, category, rating, traits: rollCardTraits(floor, kind, category), sold: false };
    });
    if (shopOffers.length) {
      const shopTile = place((x, y) => standable(x, y) && chebyshev(x, y, player.x, player.y) >= 2);
      if (shopTile) {
        state.weaponShop = { x: shopTile.x, y: shopTile.y, discovered: false, variant, category, offers: shopOffers };
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

  // The stair and buildings are NOT given away up front — they stay shrouded until
  // the king explores to them (updateDiscovery marks each `discovered` once its
  // tile is seen). The Ranger's Eagle Eye below is the one exception.

  const addStatue = (type, x, y) => {
    const e = createEnemy(type, x, y);
    e.statue = true;
    state.enemies.push(e);
  };

  // Statues: inert pieces scattered out of sight, plus the occasional sentinel
  // standing a tile away from a feature (a nasty surprise for a careless king).
  // They arrive only from ROLE_MIN_FLOOR.statue onward.
  if (floor >= ROLE_MIN_FLOOR.statue) {
    // Some themed floors (the statue-choked Crypt) call for a heavier scattering.
    const statueCount = (level && level.statues ? level.statues : 0) + 2 + randomInt(3);
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

  // Ranger Eagle Eye: the whole floor is mapped from the outset (no fog of war).
  if (player.revealFloor) {
    for (let ry = 0; ry < WORLD_SIZE; ry += 1) {
      for (let rx = 0; rx < WORLD_SIZE; rx += 1) state.explored[`${rx},${ry}`] = true;
    }
    for (const f of [state.exit, state.altar, state.weaponShop, state.potionShop]) {
      if (f) f.discovered = true;
    }
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

/* ----------------------------------- fire ---------------------------------- */

// Demons are unharmed by fire and lava. The king is never a demon; enemies are
// demonic in the demon realm (floor 5+), so on those floors fire only harms him.
function isDemonUnit(state, unit) {
  if (unit === state.player) return false;
  return (state.floor || 1) >= DEMON_FLOOR;
}

// Light a fire on a tile (never on a wall). Records its remaining life so it burns
// down to open ground after FIRE_LIFE turns. Returns true if it caught.
function setFire(state, x, y) {
  if (x < 0 || x >= WORLD_SIZE || y < 0 || y >= WORLD_SIZE) return false;
  if (!state.terrain) state.terrain = {};
  if (terrainAt(state, x, y) === 'wall') return false;
  state.terrain[`${x},${y}`] = 'fire';
  if (!state.fires) state.fires = {};
  state.fires[`${x},${y}`] = FIRE_LIFE;
  return true;
}

// Sear the king if he stands in fire (unless a ward turns it aside). Returns true
// if it dealt damage.
function burnKingIfAflame(state) {
  if (terrainAt(state, state.player.x, state.player.y) !== 'fire') return false;
  if (rollMitigation(state.player)) return false;
  state.player.hp -= 1;
  state.player.wasHit = true;
  addSpatter(state, state.player.x, state.player.y);
  state.message = 'The king is seared by the flames!';
  state.lastAction = 'hit';
  checkDeath(state);
  return true;
}

// Turn's upkeep for fire: sear any non-demon caught in flame, then age every fire
// (those that burn out revert to open ground).
function resolveFires(state) {
  if (!state.fires) state.fires = {};
  burnKingIfAflame(state);
  if (!((state.floor || 1) >= DEMON_FLOOR)) {
    // On mortal floors, ordinary foes caught in fire are consumed (a boss is chipped).
    for (const e of [...state.enemies]) {
      if (terrainAt(state, e.x, e.y) !== 'fire') continue;
      if (e.boss) {
        damageBoss(state, e, 1, { ranged: true });
      } else if (!e.statue && !e.turret) {
        state.enemies = state.enemies.filter((u) => u.id !== e.id);
        addSpatter(state, e.x, e.y);
      }
    }
  }
  for (const key of Object.keys(state.fires)) {
    state.fires[key] -= 1;
    if (state.fires[key] <= 0) {
      delete state.fires[key];
      if (state.terrain && state.terrain[key] === 'fire') delete state.terrain[key];
    }
  }
}

// A spell's WEATHER trait reshapes a tile the bolt passes over. Mutually exclusive
// (a card carries at most one weather trait).
function applyWeatherToTile(state, x, y, weather) {
  if (x < 0 || x >= WORLD_SIZE || y < 0 || y >= WORLD_SIZE) return;
  if (!state.terrain) state.terrain = {};
  const key = `${x},${y}`;
  const t = terrainAt(state, x, y);
  const set = (type) => {
    if (state.fires) delete state.fires[key];
    if (type === 'normal') delete state.terrain[key];
    else state.terrain[key] = type;
  };
  if (weather === 'icy') {
    if (t === 'wall') return;
    if (t === 'fire' || t === 'lava') {
      set('normal');
      if (!state.fogClouds) state.fogClouds = {};
      state.fogClouds[key] = true; // steam
    } else {
      set('ice');
    }
  } else if (weather === 'rainy') {
    if (t === 'fire') set('normal');
    else if (t === 'mud') set('water');
    else if (t === 'normal') set('mud');
  } else if (weather === 'fiery') {
    if (t === 'ice') set('water');
    else if (t === 'water') set('mud');
    else if (t === 'mud') set('normal');
    else if (t === 'brush' || t === 'trees' || t === 'normal') setFire(state, x, y);
  } else if (weather === 'windy') {
    if (t === 'fire' || t === 'trees' || t === 'brush') set('normal');
    if (state.fogClouds) delete state.fogClouds[key];
  }
}

// Advance the world by one turn's upkeep: age the turn counters, recharge cards,
// fade blood, lapse the Riposte ward, tick timed statuses, and drift the fog.
function passTurn(state) {
  const p = state.player;
  state.turn += 1;
  p.totalTurns = (p.totalTurns || 0) + 1;
  // Sorcerer Attunement: spell cards recharge twice as fast with no enemy in sight.
  const calmHaste = Boolean(p.spellHaste) && getVisibleEnemies(state).length === 0;
  for (const card of p.cards || []) {
    if (card.remaining > 0) {
      const tick = calmHaste && (card.category || 'melee') === 'spell' ? 2 : 1;
      card.remaining = Math.max(0, card.remaining - tick);
    }
  }
  state.spatters = decaySpatters(state.spatters);
  p.warded = false;
  p.firstHitUsedThisTurn = false; // Valkyrie ward refreshes each turn
  p.attacked = false;
  tickStatuses(p);
  decayFog(state);
  trampleBrush(state);
  resolveFires(state);
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

// Is (dx, dy) a knight's-leap offset? Tells a JUMP attack from a slide/step.
function isKnightOffset(dx, dy) {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  return (ax === 1 && ay === 2) || (ax === 2 && ay === 1);
}

// Shove a unit one tile away from (awayX, awayY) — the momentum of whatever bowled
// into it. Prefers the straight continuation, then a nearby tile that still heads
// away, never into a wall / water / lava / another unit / the king. Returns true
// if it found somewhere to land (the unit is moved), false if it is boxed in.
function knockUnitBack(state, unit, awayX, awayY) {
  const px = unit.x;
  const py = unit.y;
  const dx = Math.sign(px - awayX);
  const dy = Math.sign(py - awayY);
  const occupied = (x, y) =>
    (x === state.player.x && y === state.player.y) ||
    state.enemies.some((e) => e.id !== unit.id && e.x === x && e.y === y) ||
    (state.allies || []).some((a) => a.x === x && a.y === y);
  const ok = (x, y) =>
    x >= 0 && x < WORLD_SIZE && y >= 0 && y < WORLD_SIZE &&
    standableFor(terrainAt(state, x, y), { lavaOk: false, fireOk: true, flying: Boolean(unit.flying) }) &&
    !occupied(x, y); // a shove can drive a unit into fire (it burns on the next upkeep)
  const cur = chebyshev(px, py, awayX, awayY);
  const cands = [];
  if (dx || dy) cands.push([dx, dy]); // the straight continuation
  if (dx && dy) {
    cands.push([dx, 0]); // splay off a diagonal to the nearest orthogonals
    cands.push([0, dy]);
  }
  for (const [ox, oy] of [...ORTHO, ...DIAG]) {
    if (chebyshev(px + ox, py + oy, awayX, awayY) >= cur) cands.push([ox, oy]); // any tile still heading "away"
  }
  for (const [ox, oy] of cands) {
    if (ok(px + ox, py + oy)) {
      unit.x = px + ox;
      unit.y = py + oy;
      return true;
    }
  }
  return false;
}

// Resolve the king striking an armored unit — it SURVIVES the first blow (its
// shield shatters), so the king can't share its tile. On a JUMP he knocks it back
// and lands where it stood (or, if it can't be shoved anywhere, the leap rebounds
// and he stays put); on a normal approach he stops one tile short. Returns the
// tile the king ends on, and sets the message.
function resolveArmoredHit(state, enemy, fromX, fromY, tx, ty, isJump) {
  enemy.armored = false;
  enemy.brokenShield = true;
  addSpatter(state, tx, ty);
  const nm = enemyDisplayName(enemy) || enemy.kind;
  if (isJump) {
    if (knockUnitBack(state, enemy, fromX, fromY)) {
      state.message = `The king shatters the ${nm}'s shield and bowls it aside!`;
      return { x: tx, y: ty };
    }
    state.message = `The king shatters the ${nm}'s shield — the leap rebounds!`;
    return { x: fromX, y: fromY };
  }
  state.message = `The king shatters the ${nm}'s shield!`;
  return { x: tx - Math.sign(tx - fromX), y: ty - Math.sign(ty - fromY) };
}

// Resolve the king arriving on (x, y): swap with an ally, capture, exit, buildings.
// The turn's upkeep runs at the END, and is skipped when a Bloodrush free kill lets
// the move cost no turn.
function applyArrival(next, x, y) {
  const fromX = next.player.x;
  const fromY = next.player.y;
  const pl = next.player;

  // Bosses are ATTACKED IN PLACE: the king strikes the boss's tile but does not
  // step onto it unless the blow fells its final form. It chips the HP bar; the
  // boss (or its next phase) fights on.
  const bossHere = next.enemies.find((e) => e.x === x && e.y === y && e.boss);
  if (bossHere) {
    pl.attacked = true;
    const result = damageBoss(next, bossHere, pl.ignoreDefenses ? bossHere.hp : 1, { ranged: false, instakill: Boolean(pl.ignoreDefenses) });
    if (result === 'slain') {
      pl.x = x; // walk onto the now-empty tile
      pl.y = y;
      pl.killedEnemy = true;
      if (pl.statuses) pl.statuses.invisible = 0;
      if (pl.goldOnKill) pl.gold += 1;
    }
    if (result !== 'slain' || !pl.freeKillMove) {
      passTurn(next);
      next.enemyTurn = true;
    } else {
      next.enemyTurn = false; // Bloodrush: the killing blow costs no turn
      next.lastAction = 'move-free';
    }
    updateDiscovery(next);
    return next;
  }

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
  let killed = false;
  if (enemy && enemy.armored && !pl.ignoreDefenses) {
    // The first blow only SHATTERS the armor: the shield breaks (the piece becomes
    // a broken-shield unit that re-arms out of sight). Since it survives, the king
    // can't take its tile — he stops one tile short (or, on a leap, knocks it back
    // and lands where it stood).
    const land = resolveArmoredHit(next, enemy, fromX, fromY, x, y, isKnightOffset(x - fromX, y - fromY));
    pl.x = land.x;
    pl.y = land.y;
    pl.attacked = true;
    if (pl.statuses) pl.statuses.invisible = 0; // attacking reveals you
    next.lastAction = 'combat';
    passTurn(next);
    next.enemyTurn = true;
    updateDiscovery(next);
    return next;
  }
  if (enemy) {
    resolveKill(next, enemy);
    pl.attacked = true;
    killed = true;
    next.message = `The king defeats a ${enemy.kind}.`;
    next.lastAction = 'combat';
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

// Deal `amount` damage to a boss and resolve the outcome. Bosses carry HP PER
// PHASE: a blow chips the bar; when it empties the boss sheds its form (refilling
// the bar for the next), and only the last form's fall is truly fatal. Returns:
//   'blocked'    - a ranged blow that glanced off (Bone Dragon) — nothing happened.
//   'shielded'   - an armored boss absorbed the hit (its shield broke).
//   'hurt'       - the bar dropped but the boss lives.
//   'transformed'- the phase fell; the boss rose in its next form (relocated).
//   'respawned'  - the last form fell but the boss rose anew (the Lich).
//   'slain'      - the final form fell; the boss is gone (defeated).
// ctx.ranged marks a from-range blow; ctx.instakill (Ranger Deadshot) ends it.
function damageBoss(state, boss, amount, ctx) {
  ctx = ctx || {};
  const ranged = Boolean(ctx.ranged);
  if (boss.meleeOnly && ranged && !ctx.instakill) {
    state.message = `${bossTitle(boss)} shrugs off the distant blow — strike it up close!`;
    state.lastAction = 'blocked';
    return 'blocked';
  }
  if (boss.shieldUp && !ctx.instakill) {
    boss.shieldUp = false; // its armor absorbs the blow, then re-arms out of the king's sight
    boss.brokenShield = true;
    state.message = `${bossTitle(boss)}'s armor absorbs the blow — its shield shatters!`;
    state.lastAction = 'combat';
    return 'shielded';
  }
  boss.hp -= ctx.instakill ? boss.hp : amount;
  if (boss.hp > 0) {
    state.message = `The king strikes ${boss.bossName} (${boss.hp}/${boss.maxHp}).`;
    state.lastAction = 'combat';
    return 'hurt';
  }
  return advanceBossPhase(state, boss);
}

// A boss phase has fallen: shed into the next form (bar refilled, relocated), rise
// anew (the Lich), or — on the final form — die for good.
function advanceBossPhase(state, boss) {
  if (boss.phase < boss.phases.length - 1) {
    boss.phase += 1;
    boss.kind = boss.phases[boss.phase];
    boss.hp = boss.maxHp;
    boss.charged = true;
    boss.shieldUp = Boolean(boss.armored);
    boss.brokenShield = false;
    reformBoss(state, boss);
    state.message = `${bossTitle(boss)} sheds its form and rises anew!`;
    state.lastAction = 'combat';
    return 'transformed';
  }
  // The Lich's final form falls, but it rises again — paying its bounty once.
  if (boss.respawnDeath) {
    const g = firstReformGold(state, boss);
    boss.phase = 0;
    boss.kind = boss.phases[0];
    boss.hp = boss.maxHp;
    boss.charged = true;
    reformBoss(state, boss);
    state.message = `${bossTitle(boss)} cannot die — it rises from its grave!${g ? ` (+${g} gold)` : ''}`;
    state.lastAction = 'combat';
    return 'respawned';
  }
  // Felled for good.
  state.enemies = state.enemies.filter((e) => e.id !== boss.id);
  addSpatter(state, boss.x, boss.y);
  if (state.player && state.player.statuses) state.player.statuses.invisible = 0;
  defeatBoss(state, boss.x, boss.y);
  return 'slain';
}

// Reform a boss on a free standable tile near its chamber home, away from the
// king. Returns false if none can be found (then it stays put).
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
  if (enemy.boss) {
    // Bosses take HP damage rather than being captured outright; damageBoss
    // handles their death (and reports it). AoE / allies deal 1 (Deadshot ends it).
    damageBoss(state, enemy, (state.player && state.player.ignoreDefenses) ? enemy.hp : 1, { ...(ctx || {}), instakill: Boolean(state.player && state.player.ignoreDefenses) });
    return;
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

// Can the king stand on (x, y) right now — passable ground, nothing in the way?
function canStandEmpty(state, x, y) {
  if (x < 0 || x >= WORLD_SIZE || y < 0 || y >= WORLD_SIZE) return false;
  if (!standableFor(terrainAt(state, x, y), {})) return false; // water OK, lava/wall not
  if (state.enemies.some((e) => e.x === x && e.y === y)) return false;
  if ((state.allies || []).some((a) => a.x === x && a.y === y)) return false;
  return true;
}

// Resolve a player attack landing on a tile WITHOUT moving the king (spell path,
// ranged shot, cleave, shrapnel). Handles bosses (HP), armored units (shield
// breaks, survive), and — for a Blast spell — statues/turrets. Returns true if a
// unit was actually slain there.
function attackTile(state, tx, ty, ctx) {
  ctx = ctx || {};
  const p = state.player;
  const deadshot = Boolean(p && p.ignoreDefenses);
  const e = state.enemies.find((en) => en.x === tx && en.y === ty);
  if (e) {
    if (e.boss) {
      return damageBoss(state, e, deadshot ? e.hp : 1, { ranged: Boolean(ctx.ranged), instakill: deadshot }) === 'slain';
    }
    if (e.statue || e.turret) {
      if (!ctx.blast) return false; // only a Blast spell shatters structures
      state.enemies = state.enemies.filter((u) => u.id !== e.id);
      addSpatter(state, tx, ty);
      return true;
    }
    if (e.armored && !deadshot) {
      e.armored = false; // its shield shatters, but it survives (re-arms out of sight)
      e.brokenShield = true;
      addSpatter(state, tx, ty);
      return false;
    }
    resolveKill(state, e, { ranged: Boolean(ctx.ranged) });
    return true;
  }
  const before = (state.allies || []).length;
  if (before) {
    state.allies = state.allies.filter((a) => !(a.x === tx && a.y === ty));
    if ((state.allies || []).length !== before) {
      addSpatter(state, tx, ty);
      return true;
    }
  }
  return false;
}

// Play a weapon card at (x, y). Behaviour turns on the card's category:
//   melee  - the king moves onto the target (respecting armor / boss rules).
//   ranged - the king holds his tile and strikes the target (blocked by cover).
//   spell  - the king holds his tile and the bolt pierces the whole path.
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
  // Slogging through mud or water, the king can't ready a weapon.
  const here = terrainAt(next, p.x, p.y);
  if (isSlowTerrain(here)) {
    next.message = `You can't ready a weapon while wading through ${here}.`;
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
  const traits = card.traits || [];
  const blast = traits.includes('blast');
  const fromX = p.x;
  const fromY = p.y;
  const mainTarget = next.enemies.find((e) => e.x === x && e.y === y);

  // The Bone Dragon shrugs off any blow that isn't an adjacent melee strike.
  if (mainTarget && mainTarget.boss && mainTarget.meleeOnly && category !== 'melee' && !p.ignoreDefenses) {
    next.message = `${bossTitle(mainTarget)} shrugs off the distant blow — strike it up close!`;
    next.lastAction = 'blocked';
    return next;
  }

  let scored = false;
  let parryWard = false; // set warded AFTER passTurn, so it survives into the enemy phase
  const slain = [];
  p.attacked = true;

  if (category === 'melee') {
    // The king walks/leaps onto the target.
    let survived = false;
    if (mainTarget && mainTarget.boss) {
      const result = damageBoss(next, mainTarget, p.ignoreDefenses ? mainTarget.hp : 1, { ranged: false, instakill: Boolean(p.ignoreDefenses) });
      survived = result !== 'slain';
      if (!survived) { p.x = x; p.y = y; }
    } else if (mainTarget && mainTarget.armored && !p.ignoreDefenses) {
      const land = resolveArmoredHit(next, mainTarget, fromX, fromY, x, y, isKnightOffset(x - fromX, y - fromY));
      p.x = land.x; p.y = land.y;
      survived = true;
    } else if (mainTarget) {
      resolveKill(next, mainTarget, { ranged: false });
      p.x = x; p.y = y;
    }
    scored = Boolean(mainTarget) && !survived;
    if (scored) slain.push({ x, y });
    if (!next.gameOver && !next.won) {
      if (scored && traits.includes('cleave')) cleaveAdjacent(next, x, y);
      if (scored && traits.includes('leech')) p.hp = Math.min(p.maxHp, p.hp + 1);
      // Parry is a defensive stance: it wards whenever the blow LANDS (kill or not,
      // e.g. shattering a shield or chipping a boss), applied after passTurn below.
      if (traits.includes('parry')) parryWard = true;
    }
  } else {
    // Ranged / spell: the king holds his ground and strikes from afar.
    if (category === 'spell' && !move.viaJump) {
      // A spell bolt pierces every unit on the straight path to the target.
      for (const t of straightPath(fromX, fromY, x, y)) {
        if (attackTile(next, t.x, t.y, { ranged: true, blast })) slain.push(t);
      }
    }
    if (attackTile(next, x, y, { ranged: true, blast })) {
      scored = true;
      slain.push({ x, y });
    }
    if (!next.gameOver && !next.won) {
      if (category === 'ranged') {
        if (scored && traits.includes('shrapnel')) {
          for (const [dx, dy] of [...ORTHO, ...DIAG]) {
            if (Math.random() < 1 / 3 && attackTile(next, x + dx, y + dy, { ranged: true })) slain.push({ x: x + dx, y: y + dy });
          }
        }
        if (traits.includes('recoil')) {
          const bx = fromX + Math.sign(fromX - x);
          const by = fromY + Math.sign(fromY - y);
          if (canStandEmpty(next, bx, by)) { p.x = bx; p.y = by; }
        }
      }
      if (category === 'spell') {
        if (traits.includes('dazzle')) {
          for (const s of slain) {
            for (const [dx, dy] of [...ORTHO, ...DIAG]) {
              const e = next.enemies.find((en) => en.x === s.x + dx && en.y === s.y + dy);
              if (e && !e.boss && !e.statue && unitInSight(next, e.x, e.y)) e.awake = false; // surprised next phase
            }
          }
        }
        // Weather traits reshape the terrain the bolt swept over.
        const weather = traits.find((t) => isWeatherTrait(t));
        if (weather) {
          const swept = move.viaJump ? [{ x, y }] : [...straightPath(fromX, fromY, x, y), { x, y }];
          for (const t of swept) applyWeatherToTile(next, t.x, t.y, weather);
        }
        if (traits.includes('zoom') && scored && canStandEmpty(next, x, y)) {
          p.x = x; p.y = y; // step onto the vacated tile (never onto fresh fire)
        }
      }
    }
  }

  // Sorcerer Cataclysm: casting a spell catches every visible enemy by surprise.
  if (category === 'spell' && p.spellSurprise && !next.gameOver && !next.won) {
    for (const e of next.enemies) {
      if (!e.boss && !e.statue && unitInSight(next, e.x, e.y)) e.awake = false;
    }
  }

  // Rapid (ranged): a kill grants ONE immediate free follow-up shot.
  const rapidFollowup = Boolean(card.rapidReady);
  card.rapidReady = false;
  const rapidTrigger = category === 'ranged' && traits.includes('rapid') && scored && !rapidFollowup;
  if (rapidTrigger) card.rapidReady = true;

  const free = traits.includes('quick') || (category === 'spell' && p.freeSpell) || rapidTrigger;
  if (!rapidTrigger) card.remaining = card.cooldown; // the follow-up shot leaves it uncharged until spent
  if (!scored && !next.message) next.message = 'The card strikes.';
  if (free) {
    next.enemyTurn = false;
    next.lastAction = 'card-free';
  } else {
    passTurn(next);
    next.enemyTurn = true;
    next.lastAction = 'combat';
  }
  // Raise the Parry ward AFTER upkeep (passTurn clears last turn's ward), so it
  // shields the coming enemy phase and lapses on the king's next action.
  if (parryWard && !next.gameOver && !next.won) p.warded = true;
  updateDiscovery(next);
  return next;
}

// Cleave: slay one adjacent enemy beside the strike (cardinal first).
function cleaveAdjacent(state, x, y) {
  for (const [dx, dy] of [...ORTHO, ...DIAG]) {
    if (attackTile(state, x + dx, y + dy, {})) return;
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

// The tiles this enemy could move to like its piece, WITHOUT capturing — used to
// pursue the king's last-seen tile (it moves toward a spot, not onto a target).
// Other units block; it may drift into the king's sight (unlike a hidden wanderer),
// which is exactly how it "follows" him. While the king is invisible he is NOT a
// blocker, so a pursuer can blunder right onto his tile (see pursueLastSeen).
function movesTowardTile(state, enemy, invisible) {
  const unitAt = (x, y) => {
    if (!invisible && x === state.player.x && y === state.player.y) return 'player';
    return state.enemies.find((o) => o.id !== enemy.id && o.x === x && o.y === y) || null;
  };
  const never = () => false;
  const demon = (state.floor || 1) >= DEMON_FLOOR;
  const opts = { lavaOk: demon, fireOk: demon, flying: Boolean(enemy.flying) };
  return generateMoves(enemy.kind, state, enemy.x, enemy.y, unitAt, never, opts);
}

// An out-of-sight (or blind, while the king is invisible) enemy that still
// remembers where it last saw the king hunts toward that tile. It gives up
// (clearing the memory) once it arrives, once the trail goes cold (TTL), or if no
// move brings it any closer (walled off). Returns 'bump' if — while chasing an
// invisible king — it would step onto his tile (the caller resolves the collision),
// true if it spent its turn pursuing, or false if it gave up (then it wanders).
function pursueLastSeen(state, enemy, invisible) {
  const target = enemy.lastSeen;
  if (!target) return false;
  const forget = () => {
    enemy.lastSeen = null;
    enemy.lastSeenTtl = 0;
  };
  if (enemy.x === target.x && enemy.y === target.y) {
    forget(); // reached the spot — nothing here; resume normal wandering
    return false;
  }
  const curD = distanceSq(enemy.x, enemy.y, target.x, target.y);
  let best = null;
  let bestD = Infinity;
  for (const m of movesTowardTile(state, enemy, invisible)) {
    const d = distanceSq(m.x, m.y, target.x, target.y);
    if (d < bestD) {
      bestD = d;
      best = m;
    }
  }
  if (!best || bestD > curD) {
    forget(); // boxed in / walled off — lose the trail
    return false;
  }
  // Chasing an unseen king right onto his tile: don't move — report the collision.
  if (invisible && best.x === state.player.x && best.y === state.player.y) {
    return 'bump';
  }
  enemy.x = best.x;
  enemy.y = best.y;
  enemy.lastSeenTtl -= 1;
  if ((enemy.x === target.x && enemy.y === target.y) || enemy.lastSeenTtl <= 0) {
    forget();
  }
  return true;
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
    // A broken-shield unit re-forges its armor the moment it slips out of sight.
    if (enemy.brokenShield && !unitInSight(next, enemy.x, enemy.y)) {
      enemy.brokenShield = false;
      enemy.armored = true;
      if (enemy.boss) enemy.shieldUp = true; // an armored boss regains its absorbing shield too
    }
    if (enemy.statue) {
      continue; // inert stone — never wakes from sight, only from proximity
    }
    // While the king is invisible, every piece is unaware: it can't gain a fresh
    // sighting. But a piece that saw him just before he vanished still chases his
    // last-seen tile (and may blunder onto him there); the rest wander blindly.
    // Turrets hold their fire either way.
    if (invisible) {
      enemy.awake = false;
      enemy.surprised = false;
      if (!enemy.turret) {
        let outcome = false;
        if (enemy.lastSeen && enemy.lastSeenTtl > 0) {
          outcome = pursueLastSeen(next, enemy, true);
        }
        if (outcome === false) {
          outcome = wanderEnemy(next, enemy, true); // gave up / no memory — drift blindly
        }
        if (outcome === 'bump') {
          resolveBump(next, enemy);
          if (next.gameOver) break;
        }
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
      // Out of sight: hunt toward the king's last-seen tile if the trail is warm,
      // otherwise drift at random. (Turrets are fixed and do neither.)
      if (!enemy.turret) {
        if (!(enemy.lastSeen && enemy.lastSeenTtl > 0 && pursueLastSeen(next, enemy, false))) {
          wanderEnemy(next, enemy);
        }
      }
      continue;
    }
    // In sight: a fresh sighting freezes the piece in surprise for ONE turn
    // (telegraphing its threat). It can never be surprised two turns running —
    // if it was surprised last turn, it acts now regardless.
    if (enemy.boss) enemy.everSeen = true; // a tracking boss remembers it saw him
    // Note where he is: if he slips away, the piece will hunt toward this tile.
    enemy.lastSeen = { x: p.x, y: p.y };
    enemy.lastSeenTtl = PURSUIT_TTL;
    if (!enemy.awake && !wasSurprised) {
      enemy.awake = true;
      enemy.surprised = true;
    } else {
      enemy.awake = true;
      enemy.surprised = false;
      moverIds.push(enemy.id);
    }
  }

  // "Summoned" is a STATE, not a role: a conjured unit persists only while it is
  // actively hostile. The instant it would lapse into any other state (sleeping,
  // wandering, surprised — i.e. it isn't a hostile mover this phase) it is dispelled.
  const before = next.enemies.length;
  next.enemies = next.enemies.filter((e) => !(e.summoned && !moverIds.includes(e.id)));
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

// A boss conjures a random roster minion (with its kind's eligible role, when the
// stage allows) beside it — the Weaponmaster / Lich summons. A summoned unit can
// NEVER be a summoner.
function summonRandomTraitMinion(state, boss) {
  const kind = randomEnemyKind(state.floor);
  let role = ROLE_FOR_KIND[kind] || null;
  if (role === 'summoner') role = null; // summoned units can't summon
  if (role && Math.random() > 0.6) role = null; // most minions are plain
  return summonKindAdjacent(state, boss, kind, role);
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

// A summoner boss conjures a minion when `allowed` (not two turns running). Returns
// true if it spent its turn summoning.
function bossSummon(state, boss, allowed) {
  if (!boss.summoner || !allowed) return false;
  if (!boss.charged) {
    boss.charged = true; // recharge instead of summoning
    return false;
  }
  if (state.enemies.length < MAX_ENEMIES && summonRandomTraitMinion(state, boss)) {
    boss.charged = false;
    state.message = `${bossTitle(boss)} conjures a minion to its side!`;
    state.lastAction = 'enemy';
    return true;
  }
  return false;
}

// Boss turn. The Centaur acts twice; everything else acts once (see bossAct).
function bossMove(state, boss) {
  // Hydra: mends 1 HP every other turn.
  if (boss.special === 'aquatic') {
    boss.regenTick = !boss.regenTick;
    if (boss.regenTick && boss.hp < boss.maxHp) boss.hp += 1;
  }
  if (boss.special === 'doubleAct') {
    bossAct(state, boss);
    if (!state.gameOver && !state.won && state.enemies.some((e) => e.id === boss.id)) {
      bossAct(state, boss); // the Centaur strikes a second time
    }
    return state;
  }
  return bossAct(state, boss);
}

// One boss action: its signature `special` and any trait behaviours, then a hunt.
// A boss never simply steps onto the king (jumpers knock him back; others strike
// from adjacency or at range).
function bossAct(state, boss) {
  const king = state.player;
  const dmg = boss.bossDamage || 1;
  const adjacent = canMeleeStrike(state, boss);
  const jumper = isJumperKind(boss.kind);
  const canLandOnKing = getPieceMoves(boss, state).some((m) => m.x === king.x && m.y === king.y);

  switch (boss.special) {
    case 'armorAura': {
      // Weaponmaster: armor its neighbours (then it summons / fights below).
      for (const e of state.enemies) {
        if (e.id !== boss.id && !e.boss && chebyshev(e.x, e.y, boss.x, boss.y) === 1) {
          e.armored = true;
          e.brokenShield = false;
        }
      }
      break;
    }
    case 'frostwake': {
      // Yeti: freezes the ground it vacates (while in the king's sight).
      if (canLandOnKing) return bossHit(state, boss, `${bossTitle(boss)} mauls the king!`, dmg);
      const step = bossAdvance(state, boss);
      if (step) {
        if (!state.terrain) state.terrain = {};
        if (unitInSight(state, step.from.x, step.from.y) && terrainAt(state, step.from.x, step.from.y) !== 'wall') {
          state.terrain[`${step.from.x},${step.from.y}`] = 'ice';
        }
        state.message = `${bossTitle(boss)} lumbers closer, frost in its wake.`;
        state.lastAction = 'enemy';
        return state;
      }
      state.message = `${bossTitle(boss)} is hemmed in.`;
      state.lastAction = 'enemy';
      return state;
    }
    case 'siege': {
      // Stone Golem: smashes through walls to reach the king.
      if (canLandOnKing) return bossHit(state, boss, `${bossTitle(boss)} smashes the king!`, dmg);
      const step = bossAdvance(state, boss);
      if (step) {
        state.message = `${bossTitle(boss)} advances.`;
        state.lastAction = 'enemy';
        return state;
      }
      // Hemmed in by a wall — smash it and move into the rubble.
      const wx = boss.x + Math.sign(king.x - boss.x);
      const wy = boss.y + Math.sign(king.y - boss.y);
      if (state.terrain && state.terrain[`${wx},${wy}`] === 'wall') {
        delete state.terrain[`${wx},${wy}`];
        const blocked = (wx === king.x && wy === king.y) || state.enemies.some((e) => e.id !== boss.id && e.x === wx && e.y === wy);
        if (!blocked) {
          boss.x = wx;
          boss.y = wy;
        }
        state.message = `${bossTitle(boss)} smashes through a wall!`;
        state.lastAction = 'enemy';
        return state;
      }
      boss.frustrated = true;
      state.message = `${bossTitle(boss)} fumes.`;
      state.lastAction = 'enemy';
      return state;
    }
    case 'gore': {
      // Minotaur: every blow is a knockback for heavy damage — but only if it can
      // actually reach the king this turn (no charging AND goring in one turn).
      if (canLandOnKing) return knockbackKing(state, boss);
      const step = bossAdvance(state, boss);
      if (!step) {
        state.message = `${bossTitle(boss)} snorts, hemmed in.`;
        state.lastAction = 'enemy';
        return state;
      }
      state.message = `${bossTitle(boss)} charges.`;
      state.lastAction = 'enemy';
      return state;
    }
    case 'petrify': {
      // Medusa: while visible, turns every other unit to stone and sears the king.
      for (const e of state.enemies) {
        if (e.id !== boss.id && !e.boss && !e.statue) {
          e.statue = true;
          e.awake = false;
          e.surprised = false;
        }
      }
      state.allies = []; // the king's summons are petrified too
      if (!adjacent) bossAdvance(state, boss);
      return bossHit(state, boss, `${bossTitle(boss)}'s gaze turns all to stone!`, dmg);
    }
    case 'inferno': {
      // Balrog: wreathes every adjacent tile in flame each turn (the king, if he
      // stands beside it, is caught in the fire); else it looses a mage bolt.
      let lit = 0;
      for (const [dx, dy] of [...ORTHO, ...DIAG]) {
        if (setFire(state, boss.x + dx, boss.y + dy)) lit += 1;
      }
      if (lit) {
        const burned = burnKingIfAflame(state); // adjacent king is seared at once
        bossAdvance(state, boss); // and it still stalks him
        if (!burned) {
          state.message = `${bossTitle(boss)} wreathes itself in flame!`;
          state.lastAction = 'enemy';
        }
        return state;
      }
      break; // hemmed by walls — fall through to the mage bolt / hunt
    }
    default:
      break; // 'aquatic' / 'undying' / 'bonehide' — their trick is HP/death, not the turn
  }

  // Mage trait (Balrog): a piercing bolt down a clear line when not adjacent.
  if (boss.mage && !adjacent) {
    const line = lineToPlayer(state, boss);
    if (line) {
      if (tryReflect(state, boss)) return state;
      state.lastShot = { fromX: boss.x, fromY: boss.y, toX: king.x, toY: king.y, role: 'boss' };
      for (const t of line.between) slayEnemyAt(state, t.x, t.y);
      return bossHit(state, boss, `${bossTitle(boss)} looses a searing bolt!`, dmg);
    }
  }

  // Skirmisher trait (Centaur): a hit-and-run shot on a clear firing line.
  if (boss.skirmisher) {
    const line = lineToPlayer(state, boss);
    if (line && !line.blocked) {
      if (tryReflect(state, boss)) return state;
      state.lastShot = { fromX: boss.x, fromY: boss.y, toX: king.x, toY: king.y, role: 'boss' };
      return bossHit(state, boss, `${bossTitle(boss)} looses a shot!`, dmg);
    }
    bossAdvance(state, boss);
    state.message = `${bossTitle(boss)} circles closer.`;
    state.lastAction = 'enemy';
    return state;
  }

  // Summoner trait (Weaponmaster, Lich): conjure while the king isn't adjacent.
  if (bossSummon(state, boss, !adjacent)) return state;

  // Default hunt: a leaper knocks the king back; others strike ONLY if they can
  // capture him from where they stand. It never moves AND strikes in one turn —
  // if it just closes the distance, it strikes on the following turn.
  if (jumper && canLandOnKing) return knockbackKing(state, boss);
  if (canLandOnKing) return bossHit(state, boss, `${bossTitle(boss)} strikes the king!`, dmg);
  const step = bossAdvance(state, boss);
  if (!step) {
    state.message = `${bossTitle(boss)} fumes.`;
    state.lastAction = 'enemy';
    return state;
  }
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

  // Role-specific turns. A boss runs its OWN AI even when it carries a borrowed
  // trait (mage/skirmisher/summoner), so check it before the role dispatch.
  if (enemy.boss) {
    return bossMove(next, enemy);
  }
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
  return meleeMove(next, enemy); // normal / armored / flying (jumpers knock back)
}

// Can this (non-jumping) enemy strike the king from where it stands? It must be
// adjacent. Jumpers don't use this — they strike only by leaping onto his tile.
function canMeleeStrike(state, enemy) {
  return chebyshev(enemy.x, enemy.y, state.player.x, state.player.y) === 1;
}

// The melee model. A piece gets ONE action per turn: it attacks ONLY if it could
// move ONTO the king's tile this turn (i.e. actually capture him — a clear line for
// a slider, an adjacent step for a king/pawn, a leap for a knight). If it cannot
// reach him, it simply advances toward him. It never moves AND strikes on the same
// turn, so the king can always read the danger from the threat tiles before it
// lands: an enemy that just closed to melee range only strikes on the FOLLOWING
// turn (if the king stays within reach). Attacks PERSIST — the piece isn't spent.
function meleeMove(state, enemy) {
  const king = state.player;
  const moves = getPieceMoves(enemy, state);
  const canCapture = moves.some((m) => m.x === king.x && m.y === king.y);

  if (canCapture) {
    // A leaper bowls the king aside and takes his ground; everything else strikes
    // from where it stands.
    if (isJumperKind(enemy.kind)) return knockbackKing(state, enemy);
    strikeKing(state, enemy, false);
    return state;
  }

  // Out of reach — advance toward the king (the king's tile isn't reachable, so it
  // can't be chosen). No strike this turn.
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

// A jumper leaps onto the king's tile and knocks him back, taking his ground. The
// knockback follows the "best" angle of the leap: knights shove diagonally in the
// direction they jumped (sign of the leap vector). If the tile behind the king is
// blocked/impassable, the blow lands but he isn't moved (the jumper holds).
function knockbackKing(state, enemy) {
  const king = state.player;
  let pdx = Math.sign(king.x - enemy.x); // the leap's general direction
  let pdy = Math.sign(king.y - enemy.y);
  if (pdx === 0 && pdy === 0) {
    pdx = 1; // degenerate (shouldn't happen for a leap) — pick a direction
  }
  const dmg = enemy.bossDamage || 1;
  const bx = king.x + pdx;
  const by = king.y + pdy;
  const occupied = (x, y) => state.enemies.some((e) => e.id !== enemy.id && e.x === x && e.y === y) || (state.allies || []).some((a) => a.x === x && a.y === y);
  // A shove CAN drive the king into fire (unlike his own steps) — but never a wall/lava.
  const canPush = bx >= 0 && bx < WORLD_SIZE && by >= 0 && by < WORLD_SIZE && standableFor(terrainAt(state, bx, by), { fireOk: true }) && !occupied(bx, by);
  const mit = rollMitigation(king);
  if (!mit) {
    king.hp -= dmg;
    king.wasHit = true;
    addSpatter(state, king.x, king.y);
  }
  if (canPush) {
    const kx = king.x;
    const ky = king.y;
    king.x = bx;
    king.y = by;
    enemy.x = kx; // the leaper lands where the king stood
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
  if (!state.gameOver) burnKingIfAflame(state); // shoved into flame? it sears at once
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

// Buy a weapon-shop offer (identified by its index in weaponShop.offers). Card
// caps are PER CATEGORY: with a free slot of the offer's category the card is
// added; when that category is full, `replaceIndex` must point to a card OF THE
// SAME CATEGORY to swap out. `shopMessage` reports the result.
function buyCard(state, offerIndex, replaceIndex) {
  const next = structuredClone(state);
  const p = next.player;
  const offer = next.weaponShop && next.weaponShop.offers && next.weaponShop.offers[offerIndex];
  if (!offer || offer.sold || !isCardKind(offer.kind)) {
    return next;
  }
  const traits = offer.traits || [];
  const category = offer.category || 'melee';
  const rating = offer.rating || 1;
  const cost = cardCost(offer.kind, traits.length, rating);
  if (p.gold < cost) {
    next.shopMessage = 'Not enough gold.';
    return next;
  }
  if (cardCapFor(p, category) <= 0) {
    next.shopMessage = `Your class can't wield ${category} cards.`;
    return next;
  }
  const card = makeCard(offer.kind, category, rating, [...traits]);
  if (cardCountByCategory(p, category) < cardCapFor(p, category)) {
    p.cards.push(card);
  } else if (replaceIndex != null && p.cards[replaceIndex] && (p.cards[replaceIndex].category || 'melee') === category) {
    p.cards[replaceIndex] = card;
  } else {
    next.shopMessage = `${category[0].toUpperCase()}${category.slice(1)} slots full — choose one of that kind to replace.`;
    return next;
  }
  p.gold -= cost;
  p.boughtCard = true; // breaks the ascetic conduct
  offer.sold = true;
  next.shopMessage = `Acquired the ${offer.kind} ${category} card.`;
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

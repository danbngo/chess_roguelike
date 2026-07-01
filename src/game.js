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
    //   summoner   - conjures fresh pieces beside it and fights warily.
    //   summoned   - conjured; vanishes when no summoner is in sight.
    statue: false,
    turret: false,
    boss: false,
    skirmisher: false,
    armored: false,
    summoner: false,
    summoned: false,
  };
}

// The single special role a piece carries (or 'normal'), for display / icons.
function enemyRole(enemy) {
  if (enemy.boss) return 'boss';
  if (enemy.statue) return 'statue';
  if (enemy.turret) return 'turret';
  if (enemy.skirmisher) return 'skirmisher';
  if (enemy.armored) return 'armored';
  if (enemy.summoner) return 'summoner';
  if (enemy.summoned) return 'summoned';
  return 'normal';
}

// Roll a special role for an ordinary spawn (or null). Roles arrive with depth
// and stay rare. Pawns are never skirmishers (too weak to hit-and-run).
function rollEnemyRole(floor, kind) {
  const roll = Math.random();
  if (floor >= 6 && roll < 0.1) return 'summoner';
  if (floor >= 4 && roll < 0.22) return 'armored';
  if (floor >= 2 && roll < 0.34 && kind !== 'pawn') return 'skirmisher';
  return null;
}

// Give a freshly-created ordinary enemy a rolled role (mutates and returns it).
function withRolledRole(enemy, floor) {
  const role = rollEnemyRole(floor, enemy.kind);
  if (role) enemy[role] = true;
  return enemy;
}

// A non-boss, killable piece (not a statue or turret) that is currently in the
// king's sight — i.e. a guard that still shields the floor's boss.
function shieldsBoss(state, enemy) {
  return !enemy.boss && !enemy.statue && !enemy.turret && unitInSight(state, enemy.x, enemy.y);
}

// True while any guard still stands in view, keeping the boss invulnerable.
function bossShielded(state) {
  return state.enemies.some((e) => shieldsBoss(state, e));
}

// Whether a given enemy can be captured right now: statues and turrets never
// can, and a boss only once its guards have fallen out of sight.
function isCapturable(state, enemy) {
  if (!enemy) return false;
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

// The spawn pool for a floor: every enemy kind unlocked at or before it. The king
// every kind unlocked at or before this floor.
function enemyRosterForFloor(floor) {
  const pool = ENEMY_UNLOCKS.filter((entry) => floor >= entry.floor).map((entry) => entry.kind);
  return pool.length ? pool : ['pawn'];
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

// The kind of piece guarding a floor's exit: the amazon on every final-boss floor
// (she exists nowhere else), otherwise the strongest piece in the floor's roster —
// allowed to be one tier above what ordinarily spawns there.
function bossKindForFloor(floor) {
  if (isFinalBossFloor(floor)) {
    return 'amazon';
  }
  const pool = enemyRosterForFloor(floor).slice();
  const upcoming = ENEMY_UNLOCKS.filter((e) => floor < e.floor).sort((a, b) => a.floor - b.floor)[0];
  if (upcoming) {
    pool.push(upcoming.kind); // a guardian a cut above the rank and file
  }
  return pool.reduce((best, k) => ((CARD_POINTS[k] || 0) > (CARD_POINTS[best] || 0) ? k : best), pool[0] || 'queen');
}

// The chance an ordinary floor's exit is boss-guarded (climbs slightly with depth).
function bossChance(floor) {
  return Math.min(0.5, 0.3 + floor * 0.015);
}

// Resolve the floor's boss being defeated: the final boss wins the run, any other
// unbars the stair it was guarding.
function defeatBoss(state, x, y) {
  if (isFinalBossFloor(state.floor)) {
    state.won = true;
    state.message = 'The Amazon guardian falls — the realm is free!';
  } else if (state.exit) {
    state.exit.locked = false;
    state.message = 'The guardian falls — the stair below is unbarred!';
  }
}

// Pick a consumable kind by spawn weight (common healing, rare barkskin).
function randomConsumable() {
  const entries = Object.entries(CONSUMABLES);
  const total = entries.reduce((sum, [, c]) => sum + c.weight, 0);
  let roll = Math.random() * total;
  for (const [key, c] of entries) {
    roll -= c.weight;
    if (roll < 0) {
      return key;
    }
  }
  return entries[0][0];
}

// Resolve whether an incoming hit is shrugged off, and how: a guaranteed block
// (riposte / barkskin), a rolled evasion (class perks), or null (the hit lands).
function rollMitigation(player) {
  if (player.warded) return 'riposte';
  if (player.statuses && player.statuses.barkskin > 0) return 'barkskin';
  if (player.evade && Math.random() < player.evade) return 'evade';
  return null;
}

// Drink a consumable: an immediate boon or a short status. Sets the floor message.
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
function sampleEquipment(count) {
  const pool = Object.entries(EQUIPMENT).map(([key, e]) => ({ key, weight: e.weight }));
  const picked = [];
  while (pool.length && picked.length < count) {
    const total = pool.reduce((sum, p) => sum + p.weight, 0);
    let roll = Math.random() * total;
    let idx = 0;
    for (let i = 0; i < pool.length; i += 1) {
      roll -= pool[i].weight;
      if (roll < 0) {
        idx = i;
        break;
      }
    }
    picked.push(pool.splice(idx, 1)[0].key);
  }
  return picked;
}

// Apply (sign +1) or remove (sign -1) one stat bonus to the king.
function applyOneBonus(player, stat, amount, sign) {
  if (stat === 'hp') {
    player.maxHp += sign * amount;
    if (sign > 0) player.hp += amount; // donning heals you for its value
    if (player.hp > player.maxHp) player.hp = player.maxHp; // removing may force a clamp
    if (player.hp < 1) player.hp = 1;
  } else if (stat === 'vision') {
    player.vision += sign * amount;
  } else if (stat === 'regen') {
    player.regen += sign * amount;
  } else if (stat === 'evade') {
    player.evade = (player.evade || 0) + sign * amount;
  } else if (stat === 'moveRange') {
    player.moveRange += sign * amount;
  }
}

// Apply (sign +1) or remove (sign -1) a worn equipment's bonuses (base + enchant).
function applyEquipBonus(state, item, sign) {
  applyOneBonus(state.player, item.stat, item.amount, sign);
  if (item.enchant) {
    applyOneBonus(state.player, item.enchant.stat, item.enchant.amount, sign);
  }
  state.viewSize = state.player.vision; // keep the legacy mirror in sync
}

// An equipment shop offer: a key, plus (for armor, rarely) a bonus enchantment.
function makeEquipOffer(key) {
  const def = EQUIPMENT[key];
  const enchant = def && def.armor && Math.random() < EQUIP_ENCHANT_CHANCE ? EQUIP_ENCHANTS[randomInt(EQUIP_ENCHANTS.length)] : null;
  return { key, sold: false, enchant };
}

/* ------------------------------ class perks ------------------------------- */

// Classes the king can still advance (the next perk in their ladder exists).
function availableClasses(player) {
  return Object.keys(CLASSES).filter((k) => ((player.classLevels && player.classLevels[k]) || 0) < CLASSES[k].perks.length);
}

// The class the king has invested in most (or null if none yet / it is maxed).
function highestClass(player) {
  const levels = player.classLevels || {};
  let best = null;
  let bestLv = 0;
  for (const k of Object.keys(CLASSES)) {
    const lv = levels[k] || 0;
    if (lv > bestLv && lv < CLASSES[k].perks.length) {
      bestLv = lv;
      best = k;
    }
  }
  return best;
}

// The next perk in a class's ladder for this king (or null if maxed).
function nextClassPerk(player, classKey) {
  const cls = CLASSES[classKey];
  if (!cls) return null;
  const level = (player.classLevels && player.classLevels[classKey]) || 0;
  return cls.perks[level] || null;
}

// Choose which classes a class altar offers: always the next rung of the king's
// strongest class (so a main build keeps climbing), then random others.
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

// Apply a perk's bundled stat / rule grants to the king.
function applyPerk(state, grants) {
  const p = state.player;
  if (grants.maxHp) {
    p.maxHp += grants.maxHp;
    p.hp += grants.maxHp;
  }
  if (grants.regen) p.regen += grants.regen;
  if (grants.vision) {
    p.vision += grants.vision;
    state.viewSize = p.vision;
  }
  if (grants.moveRange) p.moveRange += grants.moveRange;
  if (grants.maxCards) p.maxCards += grants.maxCards;
  if (grants.maxEquipment) p.maxEquipment += grants.maxEquipment;
  if (grants.evade) p.evade = (p.evade || 0) + grants.evade;
  if (grants.cooldownReduction) p.cooldownReduction = (p.cooldownReduction || 0) + grants.cooldownReduction;
  if (grants.cardRangeBonus) p.cardRangeBonus = (p.cardRangeBonus || 0) + grants.cardRangeBonus;
  if (grants.goldPerKill) p.goldPerKill = (p.goldPerKill || 0) + grants.goldPerKill;
  if (grants.meleeTrait) {
    if (!Array.isArray(p.meleeTraits)) p.meleeTraits = [];
    p.meleeTraits.push(grants.meleeTrait);
  }
  if (grants.detectItems) p.detectItems = true;
}

// Take the next perk of a class at the altar. The altar then falls dormant.
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
  applyPerk(next, perk.grants);
  if (!p.classLevels) p.classLevels = {};
  p.classLevels[classKey] = (p.classLevels[classKey] || 0) + 1;
  if (!Array.isArray(p.perks)) p.perks = [];
  p.perks.push(perk.id);
  p.usedAltar = true; // breaks the atheist conduct
  next.altar.used = true;
  next.altarMessage = `You embrace the ${CLASSES[classKey].name}: ${perk.name}.`;
  updateDiscovery(next); // a sight perk may dispel fog immediately
  return next;
}

// Buy an equipment-shop offer, donning it in a free slot or swapping out the worn
// piece at `replaceIndex` when slots are full. `shopMessage` reports the result.
function buyEquipment(state, offerIndex, replaceIndex) {
  const next = structuredClone(state);
  const p = next.player;
  const offer = next.equipShop && next.equipShop.offers && next.equipShop.offers[offerIndex];
  if (!offer || offer.sold || !EQUIPMENT[offer.key]) {
    return next;
  }
  const def = EQUIPMENT[offer.key];
  if (p.gold < def.cost) {
    next.shopMessage = 'Not enough gold.';
    return next;
  }
  const worn = { key: offer.key, stat: def.stat, amount: def.amount, enchant: offer.enchant || null };
  if (p.equipment.length < p.maxEquipment) {
    p.equipment.push(worn);
  } else if (replaceIndex != null && replaceIndex >= 0 && replaceIndex < p.equipment.length) {
    applyEquipBonus(next, p.equipment[replaceIndex], -1); // shed the old piece's bonus
    p.equipment[replaceIndex] = worn;
  } else {
    next.shopMessage = 'Equipment slots full — choose one to replace.';
    return next;
  }
  applyEquipBonus(next, worn, 1);
  p.gold -= def.cost;
  p.boughtEquipment = true;
  offer.sold = true;
  next.shopMessage = `Equipped the ${def.name}.`;
  updateDiscovery(next); // a Spyglass may dispel fog immediately
  return next;
}

// Roll a weapon trait for a card bought on this floor: none on floor 1, scaling up
// to MAX_TRAIT_CHANCE by the final floor. Some kinds always carry one (forceTrait).
function rollCardTrait(floor, forceTrait) {
  const chance = forceTrait ? 1 : Math.min(MAX_TRAIT_CHANCE, MAX_TRAIT_CHANCE * ((floor - 1) / (FINAL_FLOOR - 1)));
  if (Math.random() >= chance) {
    return null;
  }
  return CARD_TRAITS[randomInt(CARD_TRAITS.length)];
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

  // How many "doublings" of a terrain type to scatter this floor: 0 before it is
  // unlocked, then growing each deeper floor so the final floor is crowded.
  const tiers = (type) => {
    const unlock = TERRAIN_UNLOCK[type];
    return floor < unlock ? 0 : floor - unlock + 1;
  };

  if (tiers('mud')) blob('mud', 2 * tiers('mud'), 4);
  if (tiers('water')) blob('water', 2 * tiers('water'), 4);
  if (tiers('ice')) blob('ice', 2 * tiers('ice'), 4);
  if (tiers('wall')) wallLine(2 * tiers('wall'), 3); // Walls last so they win any overlap.
  return terrain;
}

// Build (or rebuild) a floor. Carries the player's stats forward between floors.
function generateFloor(floor, carryPlayer, score) {
  const player = carryPlayer
    ? { ...carryPlayer, x: PLAYER_START.x, y: PLAYER_START.y }
    : {
        x: PLAYER_START.x,
        y: PLAYER_START.y,
        hp: STARTING_HP,
        maxHp: STARTING_HP,
        gold: 0,
        moveRange: 1,
        vision: STARTING_VISION,
        canJump: false,
        regen: STARTING_REGEN,
        maxCards: STARTING_CARD_SLOTS,
        cards: [],
        maxEquipment: STARTING_EQUIP_SLOTS,
        equipment: [], // worn equipment cards, each {key, stat, amount}
        seenKinds: [],
        weaponsUnlocked: false,
        upgradeCounts: { hp: 0, vision: 0, regen: 0, cards: 0 },
        warded: false,
        statuses: {}, // active timed effects (e.g. barkskin), keyed to turns left
        // Class-perk effects (all start neutral):
        goldPerKill: 0, // bonus gold per capture
        evade: 0, // chance to shrug off an incoming hit
        cooldownReduction: 0, // turns shaved off weapon-card recharge
        cardRangeBonus: 0, // extra reach on weapon cards
        meleeTraits: [], // weapon traits that fire on the king's own melee captures
        detectItems: false, // sense items across the floor
        classLevels: {}, // perks taken per class (class key -> count)
        perks: [], // perk ids owned
        totalTurns: 0,
        // Conduct trackers (for end-of-run honours; never affect score).
        usedAltar: false,
        killedEnemy: false,
        boughtCard: false,
        wasHit: false,
      };
  // Backfill any fields missing from older saves.
  if (player.vision == null) player.vision = STARTING_VISION;
  if (player.regen == null) player.regen = STARTING_REGEN;
  if (player.maxCards == null) player.maxCards = STARTING_CARD_SLOTS;
  if (!Array.isArray(player.cards)) player.cards = [];
  if (player.maxEquipment == null) player.maxEquipment = STARTING_EQUIP_SLOTS;
  if (!Array.isArray(player.equipment)) player.equipment = [];
  if (!Array.isArray(player.seenKinds)) player.seenKinds = [];
  if (player.weaponsUnlocked == null) player.weaponsUnlocked = false;
  if (!player.upgradeCounts) player.upgradeCounts = { hp: 0, vision: 0, regen: 0, cards: 0 };
  if (!player.statuses) player.statuses = {};
  if (player.goldPerKill == null) player.goldPerKill = 0;
  if (player.evade == null) player.evade = 0;
  if (player.cooldownReduction == null) player.cooldownReduction = 0;
  if (player.cardRangeBonus == null) player.cardRangeBonus = 0;
  if (!Array.isArray(player.meleeTraits)) player.meleeTraits = [];
  if (player.detectItems == null) player.detectItems = false;
  if (!player.classLevels) player.classLevels = {};
  if (!Array.isArray(player.perks)) player.perks = [];
  if (player.totalTurns == null) player.totalTurns = 0;

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
    exit: null,
    altar: null, // class altar (perk shrine)
    equipShop: null, // sells passive equipment cards
    weaponShop: null, // sells movement cards (once unlocked)
    floor,
    turn: 0,
    score: score || 0,
    enemyTurn: false,
    gameOver: false,
    won: false,
    pendingAltar: false,
    pendingEquipShop: false,
    pendingWeaponShop: false,
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

  // Items are placed once, at floor creation, and never respawn. Consumables are
  // rarer than the old hearts: usually one per floor, occasionally two.
  const consumableCount = 1 + (randomInt(3) === 0 ? 1 : 0);
  for (let i = 0; i < consumableCount; i += 1) {
    const tile = place((x, y) => standable(x, y) && chebyshev(x, y, player.x, player.y) >= 2);
    if (tile) {
      state.items.push({ id: `potion-${floor}-${i}`, kind: 'consumable', potion: randomConsumable(), x: tile.x, y: tile.y });
    }
  }
  for (let i = 0; i < 3 + floor; i += 1) {
    const tile = place((x, y) => standable(x, y) && chebyshev(x, y, player.x, player.y) >= 2);
    if (tile) {
      state.items.push({ id: `gold-${floor}-${i}`, kind: 'gold', x: tile.x, y: tile.y, amount: 1 });
    }
  }

  // Every floor has a stair down; it starts out of sight, so it must be found.
  {
    const tile = place((x, y) => standable(x, y) && !seen(x, y) && chebyshev(x, y, player.x, player.y) >= 4);
    if (tile) {
      // Hidden under fog of war until the king explores its tile.
      state.exit = { x: tile.x, y: tile.y, discovered: false, locked: false };
    }
  }

  // A boss may guard the stair — a chance on ordinary floors, always on a final-
  // boss floor. The exit stays barred until the guardian falls. Its lair is a
  // small walled keep (a castle) holding the boss and a few sleeping bodyguards.
  if (state.exit && (isFinalBossFloor(floor) || Math.random() < bossChance(floor))) {
    const ex = state.exit.x;
    const ey = state.exit.y;
    state.exit.locked = true;

    // Ring of walls two tiles out (the keep), leaving one gap as the gate.
    const ring = [];
    for (let dx = -2; dx <= 2; dx += 1) {
      for (let dy = -2; dy <= 2; dy += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) === 2) ring.push([ex + dx, ey + dy]);
      }
    }
    const gate = randomInt(ring.length);
    ring.forEach(([wx, wy], i) => {
      if (i === gate) return; // the one way in
      if (wx < 1 || wx >= WORLD_SIZE - 1 || wy < 1 || wy >= WORLD_SIZE - 1) return;
      if (chebyshev(wx, wy, player.x, player.y) <= 2) return; // never wall the king in
      state.terrain[`${wx},${wy}`] = 'wall';
      occupied.add(`${wx},${wy}`);
    });

    // The boss, beside the stair.
    const bossSpot = place((x, y) => standable(x, y) && chebyshev(x, y, ex, ey) === 1);
    const boss = createEnemy(bossKindForFloor(floor), bossSpot ? bossSpot.x : ex, bossSpot ? bossSpot.y : ey);
    boss.boss = true;
    state.enemies.push(boss);

    // Bodyguards: sleeping pieces packed into the keep.
    const guardCount = Math.min(6, 2 + Math.floor(floor / 4) + (isFinalBossFloor(floor) ? 2 : 0));
    for (let i = 0; i < guardCount; i += 1) {
      const spot = place((x, y) => standable(x, y) && chebyshev(x, y, ex, ey) <= 1);
      if (!spot) break;
      addEnemy(randomEnemyKind(floor), spot.x, spot.y, false);
    }
  }

  // Buildings no longer appear on every floor — each rolls a chance, so floors
  // vary and never feel bloated. (The boss / its keep above is separate.)

  // A class altar offering a few classes' next perks (incl. the king's strongest).
  if (Math.random() < 0.55) {
    const offers = rollClassAltarOffers(player, CLASS_ALTAR_CHOICES);
    if (offers.length) {
      const altarTile = place((x, y) => standable(x, y) && chebyshev(x, y, player.x, player.y) >= 2);
      if (altarTile) {
        state.altar = { x: altarTile.x, y: altarTile.y, discovered: false, used: false, offers };
      }
    }
  }

  // An equipment shop selling a weighted sample of passive gear.
  if (Math.random() < 0.5) {
    const offers = sampleEquipment(EQUIP_SHOP_CHOICES).map((key) => makeEquipOffer(key));
    const shopTile = place((x, y) => standable(x, y) && chebyshev(x, y, player.x, player.y) >= 2);
    if (shopTile) {
      state.equipShop = { x: shopTile.x, y: shopTile.y, discovered: false, offers };
    }
  }

  // Weapon shops appear once the king has seen his first card-eligible enemy, and
  // each offers cards drawn from the kinds he has seen. Each offer may carry a
  // weapon trait (pawn / king / berolina cards always do).
  if (player.weaponsUnlocked && Math.random() < 0.5) {
    const kinds = pickSome(
      player.seenKinds.filter((kind) => isCardKind(kind)),
      SHOP_CHOICES,
    );
    const shopOffers = kinds.map((kind) => ({ kind, trait: rollCardTrait(floor, cardMustHaveTrait(kind)), sold: false }));
    if (shopOffers.length) {
      const shopTile = place((x, y) => standable(x, y) && chebyshev(x, y, player.x, player.y) >= 2);
      if (shopTile) {
        state.weaponShop = { x: shopTile.x, y: shopTile.y, discovered: false, offers: shopOffers };
      }
    }
  }

  // Tiles whose surroundings must stay safe — no turret may threaten a feature,
  // and statues may stand guard a step away from one.
  const featureTiles = [];
  for (const f of [state.exit, state.altar, state.equipShop, state.weaponShop]) {
    if (f) featureTiles.push(`${f.x},${f.y}`);
  }
  const featureSet = new Set(featureTiles);

  const addStatue = (type, x, y) => {
    const e = createEnemy(type, x, y);
    e.statue = true;
    state.enemies.push(e);
  };

  // Statues: inert pieces scattered out of sight, plus the occasional sentinel
  // standing a tile away from a feature (a nasty surprise for a careless king).
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

  updateDiscovery(state);
  return state;
}

function createInitialState() {
  return generateFloor(1, null, 0);
}

function nextFloor(state) {
  // Descending mends the king by his regen rate (never above his maximum).
  const regen = state.player.regen || STARTING_REGEN;
  const healed = { ...state.player, hp: Math.min(state.player.maxHp, state.player.hp + regen) };
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
  if (state.equipShop && state.explored[`${state.equipShop.x},${state.equipShop.y}`]) {
    state.equipShop.discovered = true;
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

  for (const [dx, dy] of [...ORTHO, ...DIAG]) {
    for (const stop of slideStops(state, p.x, p.y, dx, dy, p.moveRange, enemyAt, isEnemy)) {
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

// Resolve the king arriving on (x, y): capture, pick-ups, exit, buildings.
function applyArrival(next, x, y) {
  const fromX = next.player.x; // where the king struck from (for melee-trait effects)
  const fromY = next.player.y;
  next.player.x = x;
  next.player.y = y;
  next.turn += 1;
  next.player.totalTurns = (next.player.totalTurns || 0) + 1;
  next.enemyTurn = true;
  next.lastAction = 'move';
  next.message = 'The king moves.';

  // A turn passes: every card on cooldown recharges by one, blood fades, and any
  // lingering Riposte ward from last turn lapses.
  for (const card of next.player.cards || []) {
    if (card.remaining > 0) {
      card.remaining -= 1;
    }
  }
  next.spatters = decaySpatters(next.spatters);
  next.player.warded = false;
  tickStatuses(next.player);

  const enemy = next.enemies.find((e) => e.x === x && e.y === y);
  if (enemy && enemy.armored) {
    // The first blow only shatters the armor: the piece survives (now ordinary)
    // and the recoil flings the king back to his floor-start tile.
    enemy.armored = false;
    next.player.x = PLAYER_START.x;
    next.player.y = PLAYER_START.y;
    addSpatter(next, x, y);
    next.message = `The king shatters a ${enemy.kind}'s armor and is hurled back!`;
    next.lastAction = 'combat';
    updateDiscovery(next);
    return next;
  }
  if (enemy) {
    next.enemies = next.enemies.filter((e) => e.id !== enemy.id);
    next.player.gold += 2 + (next.player.goldPerKill || 0);
    next.player.killedEnemy = true; // breaks the pacifist conduct
    addSpatter(next, x, y); // the fallen piece's blood
    next.message = `The king defeats a ${enemy.kind}.`;
    next.lastAction = 'combat';
    if (enemy.boss) {
      defeatBoss(next, x, y);
    }
    // Class melee perks (Cleave, Spark, Arcane Nova, Riposte Ward) fire on the
    // king's own captures, reusing the weapon-trait effects.
    if (!next.gameOver && !next.won) {
      for (const trait of next.player.meleeTraits || []) {
        applyCardTrait(next, trait, x, y, fromX, fromY);
      }
    }
  }

  const itemIndex = next.items.findIndex((item) => item.x === x && item.y === y);
  if (itemIndex >= 0) {
    const [item] = next.items.splice(itemIndex, 1);
    if (item.kind === 'consumable') {
      applyConsumable(next, item.potion);
      next.pickupKind = item.potion;
    } else {
      next.player.gold += item.amount;
      next.message = `You collect ${item.amount} gold.`;
      next.pickupKind = item.kind;
    }
    next.lastAction = 'item';
  }

  if (next.exit && next.exit.x === x && next.exit.y === y) {
    if (next.exit.locked) {
      next.message = 'The stair is barred — the guardian must fall first.';
    } else {
      next.lastAction = 'exit';
      next.message = 'You step onto the stair and descend...';
      return next;
    }
  }

  if (next.altar && next.altar.x === x && next.altar.y === y && !next.altar.used) {
    next.pendingAltar = true;
    next.message = 'A class altar. It awakens once the enemies have moved.';
  }

  if (next.equipShop && next.equipShop.x === x && next.equipShop.y === y) {
    next.pendingEquipShop = true;
    next.message = 'An equipment shop! It opens once the enemies have moved.';
  }

  if (next.weaponShop && next.weaponShop.x === x && next.weaponShop.y === y) {
    next.pendingWeaponShop = true;
    next.message = 'A weapon shop! It opens once the enemies have moved.';
  }

  // Statues wake the moment the king steps beside them, becoming ordinary pieces
  // that the coming enemy phase catches by surprise (one turn frozen, then hunt).
  for (const e of next.enemies) {
    if (e.statue && chebyshev(e.x, e.y, x, y) <= 1) {
      e.statue = false;
      e.awake = false;
      e.surprised = false;
      next.awokeStatue = true;
      next.message = `A ${e.kind} statue cracks to life!`;
    }
  }

  updateDiscovery(next);
  return next;
}

// Play a card: the king moves like the card's unit onto a reachable tile, then
// that card goes on cooldown. Resolves captures / pick-ups like any move.
function useCard(state, cardIndex, x, y) {
  const next = structuredClone(state);
  const card = next.player.cards[cardIndex];
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
  if (!getCardMoves(next, card.kind).some((move) => move.x === x && move.y === y)) {
    next.message = 'That card cannot reach that tile.';
    next.lastAction = 'blocked';
    return next;
  }
  const fromX = next.player.x;
  const fromY = next.player.y;
  const trait = card.trait;
  const struck = Boolean(next.enemies.find((e) => e.x === x && e.y === y)); // a kill this card scores

  const result = applyArrival(next, x, y); // ticks every card's cooldown down by one...
  // ...then this one recharges fully, less any Channeling (cooldownReduction) perk.
  const reduction = result.player.cooldownReduction || 0;
  result.player.cards[cardIndex].remaining = Math.max(1, result.player.cards[cardIndex].cooldown - reduction);

  // Weapon traits fire only when the card itself scores a kill (and the run goes on).
  if (struck && trait && !result.gameOver) {
    applyCardTrait(result, trait, x, y, fromX, fromY);
  }
  return result;
}

// Slay any enemy on (tx, ty) — used by area-of-effect weapon traits. Returns true
// if an enemy was there.
function slayEnemyAt(state, tx, ty) {
  const enemy = state.enemies.find((e) => e.x === tx && e.y === ty);
  if (!enemy || !isCapturable(state, enemy)) {
    return false; // statues, turrets, and a shielded boss shrug off area attacks
  }
  state.enemies = state.enemies.filter((e) => e.id !== enemy.id);
  state.player.killedEnemy = true;
  addSpatter(state, tx, ty);
  if (enemy.boss) {
    defeatBoss(state, tx, ty);
  }
  return true;
}

// Resolve a weapon trait after a card scores a kill at (x, y), having departed
// (fromX, fromY).
function applyCardTrait(state, trait, x, y, fromX, fromY) {
  switch (trait) {
    case 'slash': // X shape: the four diagonal neighbours of the landing tile
      for (const [dx, dy] of DIAG) slayEnemyAt(state, x + dx, y + dy);
      break;
    case 'thrust': // cross: the four cardinal neighbours
      for (const [dx, dy] of ORTHO) slayEnemyAt(state, x + dx, y + dy);
      break;
    case 'shoot': // snap back to where the strike was launched from
      state.player.x = fromX;
      state.player.y = fromY;
      updateDiscovery(state);
      break;
    case 'flourish': // every seen enemy is caught off guard next enemy phase
      for (const e of state.enemies) {
        if (unitInSight(state, e.x, e.y)) {
          e.awake = false; // beginEnemyPhase will re-surprise it
        }
      }
      break;
    case 'riposte': // shrug off all damage on the coming enemy turn
      state.player.warded = true;
      break;
    default:
      break;
  }
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
  const stops = slideStops(state, state.player.x, state.player.y, dx, dy, 1, enemyAt, isEnemy);
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
function wanderEnemy(state, enemy) {
  const unitAt = (x, y) => {
    if (x === state.player.x && y === state.player.y) {
      return 'player';
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
    if (!unitInSight(state, dest.x, dest.y)) {
      candidates.push(dest); // stay hidden until the king comes to us
    }
  }
  if (!candidates.length) {
    return; // Boxed in (or hemmed against the king's view) — just idle.
  }
  const pick = candidates[randomInt(candidates.length)];
  enemy.x = pick.x;
  enemy.y = pick.y;
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
  recordSeenEnemies(next); // note any kinds that just came into view

  for (const enemy of next.enemies) {
    enemy.frustrated = false;
    if (enemy.statue) {
      continue; // inert stone — never wakes from sight, only from proximity
    }
    if (!unitInSight(next, enemy.x, enemy.y)) {
      enemy.awake = false;
      enemy.surprised = false;
      if (!enemy.turret) {
        wanderEnemy(next, enemy); // turrets are fixed; everything else wanders
      }
      continue;
    }
    // In sight: freeze in surprise for one turn (telegraphing its threat), then
    // act. Turrets "act" by firing from where they stand; others move/hunt.
    if (!enemy.awake) {
      enemy.awake = true;
      enemy.surprised = true;
    } else {
      enemy.surprised = false;
      if (enemy.armored && next.turn % 2 === 0) {
        continue; // armored pieces lumber — they act only on odd turns
      }
      moverIds.push(enemy.id);
    }
  }

  // Conjured minions wink out of existence when no summoner is in the king's
  // sight to sustain them (only those he can see vanish — for a visible effect).
  const summonerSeen = next.enemies.some((e) => e.summoner && unitInSight(next, e.x, e.y));
  if (!summonerSeen) {
    const before = next.enemies.length;
    next.enemies = next.enemies.filter((e) => !(e.summoned && unitInSight(next, e.x, e.y)));
    if (next.enemies.length !== before) {
      moverIds = moverIds.filter((id) => next.enemies.some((e) => e.id === id));
    }
  }

  // Hostile pieces act in a random order each turn (Fisher-Yates shuffle).
  for (let i = moverIds.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [moverIds[i], moverIds[j]] = [moverIds[j], moverIds[i]];
  }

  return { state: next, moverIds };
}

// A turret's turn: it holds its ground and fires along its piece pattern. If the
// king stands on one of its threatened tiles he is struck (unless warded); the
// turret is never expended, so it keeps watch indefinitely.
function fireTurret(state, turret) {
  const hitsKing = getPieceThreats(turret, state).some((t) => t.x === state.player.x && t.y === state.player.y);
  if (!hitsKing) {
    state.message = `A ${turret.kind} turret takes aim.`;
    state.lastAction = 'enemy';
    return state;
  }
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
  if (state.player.hp <= 0) {
    state.gameOver = true;
    state.message = 'The king falls.';
  }
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

// Resolve an enemy (already moved onto the king's tile) striking him: apply
// damage unless mitigated, and remove the attacker if it expends itself (normal
// melee) or is cut down by a Riposte. Returns true if the attacker is gone.
function strikeKing(state, enemy, expend) {
  const mit = rollMitigation(state.player);
  if (!mit) {
    state.player.hp -= 1;
    state.player.wasHit = true; // breaks the untouchable conduct
    addSpatter(state, state.player.x, state.player.y);
  }
  const removed = expend || mit === 'riposte'; // riposte cuts the attacker down
  if (removed) {
    state.enemies = state.enemies.filter((p) => p.id !== enemy.id);
  }
  if (mit) {
    state.message =
      mit === 'riposte'
        ? `The king ripostes a ${enemy.kind}!`
        : mit === 'barkskin'
          ? `Barkskin turns aside a ${enemy.kind}!`
          : `The king dodges a ${enemy.kind}!`;
    state.lastAction = 'enemy';
  } else {
    state.message = `A ${enemy.kind} strikes the king!`;
    state.lastAction = 'hit';
    if (state.player.hp <= 0) {
      state.gameOver = true;
      state.message = 'The king falls.';
    }
  }
  return removed;
}

// A skirmisher (sitting on the king's tile after a strike) bounds back to its
// spawn — or, failing that, any free neighbour; if truly boxed in, it is spent.
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
  state.enemies = state.enemies.filter((e) => e.id !== enemy.id); // nowhere to flee
}

// Skirmisher turn: half the time it darts to a random reachable tile, half the
// time it closes in / strikes — and after any strike it retreats to its spawn.
function skirmisherMove(state, enemy) {
  const moves = getPieceMoves(enemy, state);
  if (!moves.length) {
    enemy.frustrated = true;
    state.message = 'A skirmisher is hemmed in.';
    state.lastAction = 'enemy';
    return state;
  }
  const chosen = Math.random() < 0.5 ? chooseHostileMove(moves, state.player.x, state.player.y) : moves[randomInt(moves.length)];
  enemy.x = chosen.x;
  enemy.y = chosen.y;
  if (enemy.x === state.player.x && enemy.y === state.player.y) {
    const removed = strikeKing(state, enemy, false);
    if (!removed && !state.gameOver) {
      retreatSkirmisher(state, enemy);
      state.message = `A ${enemy.kind} skirmisher strikes and darts away!`;
      state.lastAction = 'enemy';
    }
    return state;
  }
  state.message = 'A skirmisher repositions.';
  state.lastAction = 'enemy';
  return state;
}

// Conjure a fresh (weak) piece on a free tile beside the summoner. Returns true
// if one was placed.
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
    const minion = createEnemy('pawn', x, y); // conjured minions are weak pawns
    minion.summoned = true;
    minion.awake = true; // already roused to the fight
    state.enemies.push(minion);
    return true;
  }
  return false;
}

// Summoner turn: a third of the time conjure a minion, a third dart randomly, a
// third close in / strike.
function summonerMove(state, enemy) {
  const roll = Math.random();
  if (roll < 0.34 && state.enemies.length < MAX_ENEMIES && summonAdjacent(state, enemy)) {
    state.message = `A ${enemy.kind} summoner conjures a minion!`;
    state.lastAction = 'enemy';
    return state;
  }
  const moves = getPieceMoves(enemy, state);
  if (!moves.length) {
    enemy.frustrated = true;
    state.message = 'A summoner is hemmed in.';
    state.lastAction = 'enemy';
    return state;
  }
  const chosen = roll < 0.67 ? moves[randomInt(moves.length)] : chooseHostileMove(moves, state.player.x, state.player.y);
  enemy.x = chosen.x;
  enemy.y = chosen.y;
  if (enemy.x === state.player.x && enemy.y === state.player.y) {
    strikeKing(state, enemy, true);
    return state;
  }
  state.message = 'A summoner shifts.';
  state.lastAction = 'enemy';
  return state;
}

// Move a single (seen, aware) enemy: capture the king if possible, else close in.
function moveEnemy(state, enemyId) {
  const next = structuredClone(state);
  const enemy = next.enemies.find((piece) => piece.id === enemyId);
  if (!enemy) {
    return next;
  }

  // Role-specific turns.
  if (enemy.turret) {
    return fireTurret(next, enemy); // fixed emplacement; fires its pattern
  }
  if (enemy.skirmisher) {
    return skirmisherMove(next, enemy);
  }
  if (enemy.summoner) {
    return summonerMove(next, enemy);
  }

  // Ordinary hostile: getPieceMoves already excludes friend-held tiles, so it
  // never steps onto an ally. With no legal move it holds still and fumes.
  const moves = getPieceMoves(enemy, next);
  if (!moves.length) {
    enemy.frustrated = true;
    next.message = 'A cornered piece fumes, unable to move.';
    next.lastAction = 'enemy';
    return next;
  }

  const chosen = chooseHostileMove(moves, next.player.x, next.player.y);
  enemy.x = chosen.x;
  enemy.y = chosen.y;

  if (enemy.x === next.player.x && enemy.y === next.player.y) {
    strikeKing(next, enemy, true);
    return next;
  }

  // An enemy that steps onto an item destroys it — even out of the king's sight,
  // so a remembered pickup may be gone by the time he returns.
  const itemIndex = next.items.findIndex((item) => item.x === enemy.x && item.y === enemy.y);
  if (itemIndex >= 0) {
    const [item] = next.items.splice(itemIndex, 1);
    if (unitInSight(next, enemy.x, enemy.y)) {
      next.message = `An enemy tramples ${item.kind === 'consumable' ? 'a potion' : 'some gold'}.`;
      next.lastAction = 'enemy';
      return next;
    }
  }

  next.message = 'An enemy piece advances.';
  next.lastAction = 'enemy';
  return next;
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
  const cost = cardCost(offer.kind, Boolean(offer.trait));
  if (p.gold < cost) {
    next.shopMessage = 'Not enough gold.';
    return next;
  }
  const card = { kind: offer.kind, trait: offer.trait || null, cooldown: cardCooldown(offer.kind), remaining: 0 };
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

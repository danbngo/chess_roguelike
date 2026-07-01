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
    ability: null, // boss special ability id (see bossAbilityForFloor)
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
  if (enemy.armored) return 'armored';
  if (enemy.summoner) return 'summoner';
  if (enemy.summoned) return 'summoned';
  return 'normal';
}

// Roll a special role for an ordinary spawn (or null). Roles arrive with depth
// (ROLE_MIN_FLOOR) and stay rare. Pawns and kings can be neither skirmishers nor
// mages (too lowly for hit-and-run or artillery).
function rollEnemyRole(floor, kind) {
  const roll = Math.random();
  const ranged = kind !== 'pawn' && kind !== 'king';
  if (ranged && floor >= ROLE_MIN_FLOOR.mage && roll < 0.09) return 'mage';
  if (floor >= ROLE_MIN_FLOOR.summoner && roll < 0.18) return 'summoner';
  if (floor >= ROLE_MIN_FLOOR.armored && roll < 0.29) return 'armored';
  if (ranged && floor >= ROLE_MIN_FLOOR.skirmisher && roll < 0.4) return 'skirmisher';
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

// Each boss's signature ability, escalating with depth (position within the
// 10-floor cycle). The final boss (the Amazon) wields them all.
//   summon    - conjures a fresh guardian on odd turns (also re-shields itself).
//   blink     - teleports next to the king, then strikes.
//   pierce    - fires a mage-like bolt down its line, slaying all in the way.
//   warden    - summon + pierce.
//   sovereign - summon + blink + pierce (the Amazon).
function bossAbilityForFloor(floor) {
  if (isFinalBossFloor(floor)) return 'sovereign';
  const f = ((floor - 1) % FINAL_FLOOR) + 1;
  if (f >= 8) return 'warden';
  if (f >= 6) return 'pierce';
  if (f >= 4) return 'blink';
  return 'summon';
}

const BOSS_ABILITY_PARTS = {
  summon: ['summon'],
  blink: ['blink'],
  pierce: ['pierce'],
  warden: ['summon', 'pierce'],
  sovereign: ['summon', 'blink', 'pierce'],
};

// Gold claimed by descending from this floor: a per-floor purse that bleeds ~1%
// of its base each turn the king lingers (reaching zero near MAX_TURNS_SCARY).
function floorGoldReward(state) {
  const base = FLOOR_GOLD_BASE + (state.floor || 1) * 10;
  const decay = Math.max(0, 1 - (state.turn || 0) / MAX_TURNS_SCARY);
  return Math.floor(base * decay);
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
// (riposte / barkskin), the once-per-floor Bulwark, a rolled evasion, or null
// (the hit lands). Mutates firstHitUsed when Bulwark is spent.
function rollMitigation(player) {
  if (player.warded) return 'riposte';
  if (player.statuses && player.statuses.barkskin > 0) return 'barkskin';
  if (player.firstHitShield && !player.firstHitUsed) {
    player.firstHitUsed = true;
    return 'bulwark';
  }
  if (player.evade && Math.random() < player.evade) return 'evade';
  return null;
}

// The flavour line for a mitigated blow.
function mitigationMessage(mit, kind) {
  if (mit === 'riposte') return `The king ripostes a ${kind}!`;
  if (mit === 'barkskin') return `Barkskin turns aside a ${kind}!`;
  if (mit === 'bulwark') return `Bulwark absorbs a ${kind}'s blow!`;
  return `The king dodges a ${kind}!`; // evade
}

// Drink a consumable: an immediate boon or a short status. Sets the floor message.
// The Alchemist's Potent Brews perk empowers every potion.
function applyConsumable(state, potion) {
  const p = state.player;
  if (!p.statuses) p.statuses = {};
  const potent = Boolean(p.potionPotency);
  if (potion === 'health') {
    p.hp = p.maxHp;
    if (potent) p.statuses.barkskin = Math.max(p.statuses.barkskin || 0, 2); // also wards briefly
    state.message = potent ? 'A potent Healing brew restores you and hardens your skin.' : 'A Potion of Healing restores you to full health.';
  } else if (potion === 'mana') {
    for (const card of p.cards || []) {
      card.remaining = 0;
    }
    if (potent) p.hp = Math.min(p.maxHp, p.hp + 2); // also mends a little
    state.message = potent ? 'A potent Mending brew recharges every card and knits your wounds.' : 'A Potion of Mending recharges every card.';
  } else if (potion === 'barkskin') {
    const turns = potent ? BARKSKIN_TURNS + 3 : BARKSKIN_TURNS;
    p.statuses.barkskin = turns;
    state.message = `Barkskin hardens your hide — invincible for ${turns} turns.`;
  } else if (potion === 'invis') {
    const turns = potent ? INVIS_TURNS + 3 : INVIS_TURNS;
    p.statuses.invisible = turns;
    state.message = `You fade from sight for ${turns} turns.`;
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

// Class-perk grant flags that are simply switched on.
const PERK_FLAGS = ['firstHitShield', 'retaliate', 'wardOnDescend', 'descendRefresh', 'pillage', 'frenzy', 'bloodlust', 'wardOnKill', 'freePotion', 'potionPotency'];

// Apply a perk's grants to the king: numeric bonuses that enable synergy, plus
// rule flags.
function applyPerk(state, grants) {
  const p = state.player;
  if (grants.maxCards) p.maxCards += grants.maxCards;
  if (grants.maxEquipment) p.maxEquipment += grants.maxEquipment;
  if (grants.maxConsumables) p.maxConsumables += grants.maxConsumables;
  if (grants.cooldownReduction) p.cooldownReduction = (p.cooldownReduction || 0) + grants.cooldownReduction;
  if (grants.cardRangeBonus) p.cardRangeBonus = (p.cardRangeBonus || 0) + grants.cardRangeBonus;
  if (grants.evade) p.evade = (p.evade || 0) + grants.evade;
  for (const flag of PERK_FLAGS) {
    if (grants[flag]) p[flag] = true;
  }
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
        maxConsumables: STARTING_CONSUMABLE_SLOTS,
        consumables: [], // held potion keys, used on demand from the HUD
        seenKinds: [],
        weaponsUnlocked: false,
        upgradeCounts: { hp: 0, vision: 0, regen: 0, cards: 0 },
        warded: false,
        statuses: {}, // active timed effects (e.g. barkskin), keyed to turns left
        // Class-perk effects (all start neutral):
        evade: 0, // chance to shrug off an incoming hit
        cooldownReduction: 0, // turns shaved off weapon-card recharge
        cardRangeBonus: 0, // extra reach on weapon cards
        firstHitShield: false, // negate the first hit each floor (Warrior)
        firstHitUsed: false, // per-floor: has the Bulwark been spent?
        retaliate: false, // after a hit, ward the rest of the enemy phase
        wardOnDescend: false, // Barkskin on descending
        descendRefresh: false, // refresh cards on descending
        pillage: false, // captures pay the piece's value in gold
        frenzy: false, // captures shave a turn off card cooldowns
        bloodlust: false, // captures heal when below half HP
        wardOnKill: false, // a capture wards the coming enemy phase
        freePotion: false, // drinking a potion costs no turn
        potionPotency: false, // empowered potion effects
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
  if (player.maxConsumables == null) player.maxConsumables = STARTING_CONSUMABLE_SLOTS;
  if (!Array.isArray(player.consumables)) player.consumables = [];
  if (!Array.isArray(player.seenKinds)) player.seenKinds = [];
  if (player.weaponsUnlocked == null) player.weaponsUnlocked = false;
  if (!player.upgradeCounts) player.upgradeCounts = { hp: 0, vision: 0, regen: 0, cards: 0 };
  if (!player.statuses) player.statuses = {};
  if (player.evade == null) player.evade = 0;
  if (player.cooldownReduction == null) player.cooldownReduction = 0;
  if (player.cardRangeBonus == null) player.cardRangeBonus = 0;
  for (const flag of ['firstHitShield', 'retaliate', 'wardOnDescend', 'descendRefresh', 'pillage', 'frenzy', 'bloodlust', 'wardOnKill', 'freePotion', 'potionPotency']) {
    if (player[flag] == null) player[flag] = false;
  }
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
    fogClouds: {}, // temporary sight-blocking clouds from a Fog Scroll ("x,y" -> true)
    exit: null,
    altar: null, // class altar (perk shrine)
    equipShop: null, // sells passive equipment cards
    weaponShop: null, // sells movement cards (once unlocked)
    potionShop: null, // sells consumables
    floor,
    turn: 0,
    score: score || 0,
    enemyTurn: false,
    gameOver: false,
    won: false,
    pendingAltar: false,
    pendingEquipShop: false,
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

  // Every floor has a stair down; it starts out of sight, so it must be found.
  {
    const tile = place((x, y) => standable(x, y) && !seen(x, y) && chebyshev(x, y, player.x, player.y) >= 4);
    if (tile) {
      // Hidden under fog of war until the king explores its tile.
      state.exit = { x: tile.x, y: tile.y, discovered: false, locked: false };
    }
  }

  // A boss may guard the stair — a chance from ROLE_MIN_FLOOR.boss on, always on a
  // final-boss floor. The exit stays barred until the guardian falls. Its lair is
  // a small walled keep (a castle) holding the boss and a few sleeping bodyguards.
  const bossEligible = isFinalBossFloor(floor) || (floor >= ROLE_MIN_FLOOR.boss && Math.random() < bossChance(floor));
  if (state.exit && bossEligible) {
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
    boss.ability = bossAbilityForFloor(floor);
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
  for (const f of [state.exit, state.altar, state.equipShop, state.weaponShop, state.potionShop]) {
    if (f) featureTiles.push(`${f.x},${f.y}`);
  }
  const featureSet = new Set(featureTiles);

  // Buildings and the stair are known from the outset — their tiles are revealed
  // (though the rest of the floor stays shrouded until explored).
  for (const f of [state.exit, state.altar, state.equipShop, state.weaponShop, state.potionShop]) {
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

  updateDiscovery(state);
  return state;
}

function createInitialState() {
  return generateFloor(1, null, 0);
}

function nextFloor(state) {
  // Descending mends the king by his regen rate (never above his maximum), and
  // fires any on-descend class perks.
  const regen = state.player.regen || STARTING_REGEN;
  const healed = { ...state.player, hp: Math.min(state.player.maxHp, state.player.hp + regen) };
  healed.firstHitUsed = false; // Bulwark refreshes each floor
  if (healed.descendRefresh && Array.isArray(healed.cards)) {
    healed.cards = healed.cards.map((c) => ({ ...c, remaining: 0 })); // Arcane Recovery
  }
  if (healed.wardOnDescend) {
    healed.statuses = { ...(healed.statuses || {}), barkskin: BARKSKIN_TURNS }; // Second Wind
  }
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
  tickStatuses(p);
  decayFog(state);
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
  next.player.x = x;
  next.player.y = y;
  passTurn(next); // one turn's upkeep (cards, blood, ward, statuses, fog)
  next.enemyTurn = true;
  next.lastAction = 'move';
  next.message = 'The king moves.';

  const enemy = next.enemies.find((e) => e.x === x && e.y === y);
  const pl = next.player;
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
    if (pl.statuses) pl.statuses.invisible = 0; // attacking reveals you
    pl.gold += pl.pillage ? CARD_POINTS[enemy.kind] || 2 : 2; // Pillage pays the piece's value
    pl.killedEnemy = true; // breaks the pacifist conduct
    addSpatter(next, x, y); // the fallen piece's blood
    next.message = `The king defeats a ${enemy.kind}.`;
    next.lastAction = 'combat';
    // Capture-triggered class perks:
    if (pl.frenzy) {
      for (const c of pl.cards || []) if (c.remaining > 0) c.remaining -= 1; // Frenzy
    }
    if (pl.bloodlust && pl.hp < pl.maxHp / 2) {
      pl.hp = Math.min(pl.maxHp, pl.hp + 1); // Bloodlust
    }
    if (pl.wardOnKill) {
      pl.warded = true; // Shadowstep — no damage on the coming enemy phase
    }
    if (enemy.boss) {
      defeatBoss(next, x, y);
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
      const reward = floorGoldReward(next);
      next.player.gold += reward;
      next.lastAction = 'exit';
      next.message = `You descend with ${reward} gold from the floor.`;
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

  if (next.potionShop && next.potionShop.x === x && next.potionShop.y === y) {
    next.pendingPotionShop = true;
    next.message = 'An apothecary! It opens once the enemies have moved.';
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
    if (state.player.retaliate) state.player.warded = true;
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
    if (state.player.hp <= 0) {
      state.gameOver = true;
      state.message = 'The king falls.';
    }
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
  const invisible = Boolean(next.player.statuses && next.player.statuses.invisible > 0);
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
    if (!unitInSight(next, enemy.x, enemy.y)) {
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
    if (!enemy.awake && !wasSurprised) {
      enemy.awake = true;
      enemy.surprised = true;
    } else {
      enemy.awake = true;
      enemy.surprised = false;
      if (enemy.armored && next.turn % 2 === 0) {
        continue; // armored pieces lumber — they act only on odd turns
      }
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
  if (state.player.retaliate) state.player.warded = true;
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

// Resolve an enemy striking the king: apply damage unless mitigated, and remove
// the attacker if it expends itself (normal melee). Returns true if it is gone.
function strikeKing(state, enemy, expend) {
  const mit = rollMitigation(state.player);
  if (!mit) {
    state.player.hp -= 1;
    state.player.wasHit = true; // breaks the untouchable conduct
    addSpatter(state, state.player.x, state.player.y);
    if (state.player.retaliate) state.player.warded = true; // Retaliation
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
    if (state.player.hp <= 0) {
      state.gameOver = true;
      state.message = 'The king falls.';
    }
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
      state.lastShot = { fromX: enemy.x, fromY: enemy.y, toX: state.player.x, toY: state.player.y, role: 'mage' };
      for (const t of line.between) {
        slayEnemyAt(state, t.x, t.y); // the bolt pierces everything in its path
      }
      const mit = rollMitigation(state.player);
      if (!mit) {
        state.player.hp -= 1;
        state.player.wasHit = true;
        if (state.player.retaliate) state.player.warded = true;
        addSpatter(state, state.player.x, state.player.y);
        state.message = `A ${enemy.kind} mage's bolt tears through the king!`;
        state.lastAction = 'hit';
        if (state.player.hp <= 0) {
          state.gameOver = true;
          state.message = 'The king falls.';
        }
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

// Conjure a fresh weak minion on a free tile beside the summoner. Returns true if
// one was placed.
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
function bossHit(state, boss, hitMsg) {
  const mit = rollMitigation(state.player);
  if (!mit) {
    state.player.hp -= 1;
    state.player.wasHit = true;
    if (state.player.retaliate) state.player.warded = true;
    addSpatter(state, state.player.x, state.player.y);
    state.message = hitMsg;
    state.lastAction = 'hit';
    if (state.player.hp <= 0) {
      state.gameOver = true;
      state.message = 'The king falls.';
    }
  } else {
    state.message = `The king withstands the ${boss.kind} guardian!`;
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

// Boss turn: wields its signature ability, then hunts. It never expends itself
// and never steps onto the king (it strikes from adjacency or at range).
function bossMove(state, boss) {
  const parts = BOSS_ABILITY_PARTS[boss.ability] || [];
  const has = (a) => parts.includes(a);
  const king = state.player;
  const canSummon = boss.charged;
  boss.charged = true; // recharge by default; summoning spends it

  // Reinforcement (a fresh guard also re-shields the boss) — never two turns running.
  if (has('summon') && canSummon && state.enemies.length < MAX_ENEMIES && summonAdjacent(state, boss)) {
    boss.charged = false;
    state.message = `The ${boss.kind} guardian summons a defender!`;
    state.lastAction = 'enemy';
    return state;
  }

  // Piercing bolt down its line, slaying everything between.
  if (has('pierce')) {
    const line = lineToPlayer(state, boss);
    if (line) {
      state.lastShot = { fromX: boss.x, fromY: boss.y, toX: king.x, toY: king.y, role: 'boss' };
      for (const t of line.between) slayEnemyAt(state, t.x, t.y);
      return bossHit(state, boss, `The ${boss.kind} guardian looses a searing bolt!`);
    }
  }

  // Blink adjacent to the king, then strike if it landed beside him.
  if (has('blink') && Math.random() < 0.6 && blinkTowardKing(state, boss)) {
    if (chebyshev(boss.x, boss.y, king.x, king.y) <= 1) {
      return bossHit(state, boss, `The ${boss.kind} guardian blinks in and strikes!`);
    }
    state.message = `The ${boss.kind} guardian blinks closer!`;
    state.lastAction = 'enemy';
    return state;
  }

  // Otherwise hunt: advance toward the king (never onto him); strike if adjacent.
  const moves = getPieceMoves(boss, state).filter((m) => !(m.x === king.x && m.y === king.y));
  if (!moves.length) {
    boss.frustrated = true;
    state.message = `The ${boss.kind} guardian fumes.`;
    state.lastAction = 'enemy';
    return state;
  }
  const chosen = chooseHostileMove(moves, king.x, king.y);
  boss.x = chosen.x;
  boss.y = chosen.y;
  if (chebyshev(boss.x, boss.y, king.x, king.y) <= 1) {
    return bossHit(state, boss, `The ${boss.kind} guardian strikes the king!`);
  }
  state.message = `The ${boss.kind} guardian advances.`;
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
  } else {
    next.message = 'An enemy piece advances.';
    next.lastAction = 'enemy';
  }
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

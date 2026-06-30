// Core game rules: building floors, and resolving king / enemy / shop actions.
// Pure logic — no DOM, no canvas, no storage.

function createEnemy(type, x, y) {
  return {
    id: `${type}-${x}-${y}-${Math.random().toString(16).slice(2, 8)}`,
    kind: type,
    x,
    y,
    awake: false,
    surprised: false,
    frustrated: false,
    // Special states (all default off — a plain hunting piece):
    //   statue - inert stone until the king steps beside it, then it wakes.
    //   turret - a fixed emplacement that fires its piece pattern; never moves
    //            and cannot be destroyed.
    //   boss   - the floor's guardian; cannot be captured while killable guards
    //            remain in the king's sight, and its fall opens the descent.
    statue: false,
    turret: false,
    boss: false,
  };
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

// The king is immune to harm while warded (a one-turn Riposte) or under a timed
// invincibility status (Barkskin).
function isInvincible(player) {
  return Boolean(player.warded) || (player.statuses && player.statuses.barkskin > 0);
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

// Apply (sign +1) or remove (sign -1) a worn equipment's passive stat bonus.
function applyEquipBonus(state, item, sign) {
  const p = state.player;
  if (item.stat === 'hp') {
    p.maxHp += sign * item.amount;
    if (sign > 0) {
      p.hp += item.amount; // donning a vigor charm heals you for its value
    }
    if (p.hp > p.maxHp) p.hp = p.maxHp; // removing one may force a clamp
    if (p.hp < 1) p.hp = 1;
  } else if (item.stat === 'vision') {
    p.vision += sign * item.amount;
    state.viewSize = p.vision; // keep the legacy mirror in sync
  } else if (item.stat === 'regen') {
    p.regen += sign * item.amount;
  }
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
  const worn = { key: offer.key, stat: def.stat, amount: def.amount };
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
    equipShop: null, // sells passive equipment cards
    weaponShop: null, // sells movement cards (once unlocked)
    floor,
    turn: 0,
    score: score || 0,
    enemyTurn: false,
    gameOver: false,
    won: false,
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

  // Every floor has a portal down; it starts out of sight, so it must be found.
  {
    const tile = place((x, y) => standable(x, y) && !seen(x, y) && chebyshev(x, y, player.x, player.y) >= 4);
    if (tile) {
      // Hidden under fog of war until the king explores its tile.
      state.exit = { x: tile.x, y: tile.y, discovered: false };
    }
  }

  // Every floor holds an equipment shop selling a weighted sample of passive gear.
  {
    const offers = sampleEquipment(EQUIP_SHOP_CHOICES).map((key) => ({ key, sold: false }));
    const shopTile = place((x, y) => standable(x, y) && chebyshev(x, y, player.x, player.y) >= 2);
    if (shopTile) {
      // Hidden under fog of war until the king explores its tile.
      state.equipShop = { x: shopTile.x, y: shopTile.y, discovered: false, offers };
    }
  }

  // Weapon shops appear once the king has seen his first card-eligible enemy, and
  // each offers three cards drawn from the kinds he has seen. Each offer may carry
  // a weapon trait (pawn / king / berolina cards always do).
  if (player.weaponsUnlocked) {
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
  for (const f of [state.exit, state.equipShop, state.weaponShop]) {
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
  if (state.equipShop && state.explored[`${state.equipShop.x},${state.equipShop.y}`]) {
    state.equipShop.discovered = true;
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
  if (enemy) {
    next.enemies = next.enemies.filter((e) => e.id !== enemy.id);
    next.player.gold += 2;
    next.player.killedEnemy = true; // breaks the pacifist conduct
    addSpatter(next, x, y); // the fallen piece's blood
    next.message = `The king defeats a ${enemy.kind}.`;
    next.lastAction = 'combat';
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
    next.lastAction = 'exit';
    next.message = 'You step onto the stair and descend...';
    return next;
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
  result.player.cards[cardIndex].remaining = result.player.cards[cardIndex].cooldown; // ...then this one recharges fully.

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
  const moverIds = [];
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
      moverIds.push(enemy.id);
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
  if (isInvincible(state.player)) {
    state.message = `The king shrugs off a ${turret.kind} turret's shot!`;
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

// Move a single (seen, aware) enemy: capture the king if possible, else close in.
function moveEnemy(state, enemyId) {
  const next = structuredClone(state);
  const enemy = next.enemies.find((piece) => piece.id === enemyId);
  if (!enemy) {
    return next;
  }

  // Turrets never move: they fire along their piece's pattern, striking the king
  // if he stands on a threatened tile, and persist (they are never expended).
  if (enemy.turret) {
    return fireTurret(next, enemy);
  }

  // Hostile preference order: strike the king, else close in as far as possible,
  // else (if every move only opens distance) move as little further as possible.
  // getPieceMoves already excludes tiles held by other enemies, so a hostile
  // piece never tries to step onto a friend. With no legal move at all it holds
  // still and fumes (the frustrated mark) for this turn.
  const moves = getPieceMoves(enemy, next);
  if (!moves.length) {
    enemy.frustrated = true;
    next.message = 'A cornered piece fumes, unable to move.';
    next.lastAction = 'enemy';
    return next;
  }

  const playerKey = `${next.player.x},${next.player.y}`;
  let chosen = moves.find((move) => `${move.x},${move.y}` === playerKey);

  if (!chosen) {
    let best = Infinity;
    for (const move of moves) {
      const d = distanceSq(move.x, move.y, next.player.x, next.player.y);
      if (d < best || (d === best && Math.random() < 0.5)) {
        best = d;
        chosen = move;
      }
    }
  }

  const fromX = enemy.x;
  const fromY = enemy.y;
  enemy.x = chosen.x;
  enemy.y = chosen.y;

  if (enemy.x === next.player.x && enemy.y === next.player.y) {
    const riposte = Boolean(next.player.warded); // Riposte: no damage this turn
    const immune = isInvincible(next.player); // riposte or barkskin
    if (!immune) {
      next.player.hp -= 1;
      next.player.wasHit = true; // breaks the untouchable conduct
      addSpatter(next, next.player.x, next.player.y); // the king's own blood
    }
    next.enemies = next.enemies.filter((piece) => piece.id !== enemyId); // the attacker spends itself
    if (immune) {
      next.message = riposte ? `The king ripostes a ${enemy.kind}!` : `Barkskin turns aside a ${enemy.kind}!`;
      next.lastAction = 'enemy';
    } else {
      next.message = `A ${enemy.kind} strikes the king!`;
      next.lastAction = 'hit';
      if (next.player.hp <= 0) {
        next.gameOver = true;
        next.message = 'The king falls.';
      }
    }
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
    next.enemies.push(createEnemy(randomEnemyKind(next.floor), tile.x, tile.y));
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

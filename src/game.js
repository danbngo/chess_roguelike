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
  };
}

// The spawn pool for a floor: every enemy kind unlocked at or before it. The king
// boss is never in here — it is placed by hand on final floors.
function enemyRosterForFloor(floor) {
  const pool = ENEMY_UNLOCKS.filter((entry) => floor >= entry.floor).map((entry) => entry.kind);
  return pool.length ? pool : ['pawn'];
}

// Pick a random kind from the floor's pool, with even odds per unit.
function randomEnemyKind(floor) {
  const pool = enemyRosterForFloor(floor);
  return pool[randomInt(pool.length)];
}

// A floor is a "king floor" (the boss, no exit) on every multiple of FINAL_FLOOR.
function isKingFloor(floor) {
  return floor % FINAL_FLOOR === 0;
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

  // lava (and fire) removed from the game.
  if (tiers('water')) blob('water', 2 * tiers('water'), 4);
  if (tiers('ice')) blob('ice', 2 * tiers('ice'), 4);
  if (tiers('mist')) blob('mist', 2 * tiers('mist'), 4);
  if (tiers('wall')) wallLine(2 * tiers('wall'), 3); // Walls last so they win any overlap.
  return terrain;
}

// Build (or rebuild) a floor. Carries the player's stats forward between floors.
function generateFloor(floor, carryPlayer, score) {
  const isFinal = isKingFloor(floor);

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
        seenKinds: [],
        weaponsUnlocked: false,
      };
  // Backfill any fields missing from older saves.
  if (player.vision == null) player.vision = STARTING_VISION;
  if (player.regen == null) player.regen = STARTING_REGEN;
  if (player.maxCards == null) player.maxCards = STARTING_CARD_SLOTS;
  if (!Array.isArray(player.cards)) player.cards = [];
  if (!Array.isArray(player.seenKinds)) player.seenKinds = [];
  if (player.weaponsUnlocked == null) player.weaponsUnlocked = false;

  const state = {
    worldSize: WORLD_SIZE,
    viewSize: player.vision, // legacy field, kept in sync with the vision stat
    player,
    terrain: generateTerrain(floor, player),
    // Fog of war: tiles the king has ever seen on this floor (keys "x,y"). Fresh
    // each floor; everything else is hidden until explored.
    explored: {},
    enemies: [],
    items: [],
    exit: null,
    altar: null, // free, one-use stat shrine
    weaponShop: null, // sells movement cards (once unlocked)
    floor,
    finalFloor: FINAL_FLOOR,
    isFinalFloor: isFinal,
    turn: 0,
    score: score || 0,
    enemyTurn: false,
    gameOver: false,
    won: false,
    pendingAltar: false,
    pendingWeaponShop: false,
    message: isFinal ? 'The enemy king lurks on this floor. Hunt it down.' : 'A new floor. Seek the exit.',
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
  const offscreenCount = 3 + floor * 2;
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

  if (isFinal) {
    const tile = place((x, y) => standable(x, y) && !seen(x, y) && chebyshev(x, y, player.x, player.y) >= 5);
    if (tile) {
      addEnemy('king', tile.x, tile.y, false);
    }
  }

  // Items are placed once, at floor creation, and never respawn.
  for (let i = 0; i < 2; i += 1) {
    const tile = place((x, y) => standable(x, y) && chebyshev(x, y, player.x, player.y) >= 2);
    if (tile) {
      state.items.push({ id: `heart-${floor}-${i}`, kind: 'heart', x: tile.x, y: tile.y });
    }
  }
  for (let i = 0; i < 3 + floor; i += 1) {
    const tile = place((x, y) => standable(x, y) && chebyshev(x, y, player.x, player.y) >= 2);
    if (tile) {
      state.items.push({ id: `gold-${floor}-${i}`, kind: 'gold', x: tile.x, y: tile.y, amount: 5 + randomInt(11) });
    }
  }

  // The exit always starts out of sight, so it must be found.
  if (!isFinal) {
    const tile = place((x, y) => standable(x, y) && !seen(x, y) && chebyshev(x, y, player.x, player.y) >= 4);
    if (tile) {
      // Hidden under fog of war until the king explores its tile.
      state.exit = { x: tile.x, y: tile.y, discovered: false };
    }
  }

  // Every floor holds an altar (free, single-use stat shrine).
  const altarTile = place((x, y) => standable(x, y) && chebyshev(x, y, player.x, player.y) >= 2);
  if (altarTile) {
    // Hidden under fog of war until the king explores its tile.
    state.altar = { x: altarTile.x, y: altarTile.y, discovered: false, used: false };
  }

  // Weapon shops appear once the king has seen his first card-eligible enemy.
  if (player.weaponsUnlocked) {
    const shopTile = place((x, y) => standable(x, y) && chebyshev(x, y, player.x, player.y) >= 2);
    if (shopTile) {
      state.weaponShop = { x: shopTile.x, y: shopTile.y, discovered: false };
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

// Record any enemy kinds the king can currently see, and unlock weapon shops once
// he has spotted his first card-eligible (non-pawn, non-king) foe.
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
  if (state.exit && state.explored[`${state.exit.x},${state.exit.y}`]) {
    state.exit.discovered = true;
  }
  if (state.altar && state.explored[`${state.altar.x},${state.altar.y}`]) {
    state.altar.discovered = true;
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
  const isEnemy = (x, y) => Boolean(enemyAt(x, y));
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
  next.enemyTurn = true;
  next.lastAction = 'move';
  next.message = 'The king moves.';

  // A turn passes: every card on cooldown recharges by one.
  for (const card of next.player.cards || []) {
    if (card.remaining > 0) {
      card.remaining -= 1;
    }
  }

  const enemy = next.enemies.find((e) => e.x === x && e.y === y);
  if (enemy) {
    next.enemies = next.enemies.filter((e) => e.id !== enemy.id);
    next.score += 1;
    next.player.gold += 2;
    if (enemy.kind === 'king') {
      next.won = true;
      next.gameOver = true;
      next.lastAction = 'victory';
      next.message = 'The enemy king falls — the realm is free!';
      return next;
    }
    next.message = `The king defeats a ${enemy.kind}.`;
    next.lastAction = 'combat';
  }

  const itemIndex = next.items.findIndex((item) => item.x === x && item.y === y);
  if (itemIndex >= 0) {
    const [item] = next.items.splice(itemIndex, 1);
    if (item.kind === 'heart') {
      next.player.hp = Math.min(next.player.maxHp, next.player.hp + 1);
      next.message = 'A heart restores 1 HP.';
    } else {
      next.player.gold += item.amount;
      next.message = `You collect ${item.amount} gold.`;
    }
    next.pickupKind = item.kind;
    next.lastAction = 'item';
  }

  if (next.exit && next.exit.x === x && next.exit.y === y) {
    next.lastAction = 'exit';
    next.message = 'You step onto the stair and descend...';
    return next;
  }

  if (next.altar && next.altar.x === x && next.altar.y === y && !next.altar.used) {
    next.pendingAltar = true;
    next.message = 'An altar. It awakens once the enemies have moved.';
  }

  if (next.weaponShop && next.weaponShop.x === x && next.weaponShop.y === y) {
    next.pendingWeaponShop = true;
    next.message = 'A weapon shop! It opens once the enemies have moved.';
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
  const result = applyArrival(next, x, y); // ticks every card's cooldown down by one...
  result.player.cards[cardIndex].remaining = result.player.cards[cardIndex].cooldown; // ...then this one recharges fully.
  return result;
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
// tries to dip no more than a single tile into the king's vision before being
// spotted: if its random pick would carry it into view, it looks for a move
// heading the same way that intrudes less. (Vision is treated as bidirectional.)
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
    candidates.push({ x: dest.x, y: dest.y, dx, dy });
  }
  if (!candidates.length) {
    return; // Boxed in — just idle.
  }

  // A completely random choice among the available shuffles.
  let pick = candidates[randomInt(candidates.length)];

  // How far into the king's view a tile reaches: 0 when out of sight, larger the
  // closer it sits to the king once inside it.
  const intrusion = (tile) =>
    unitInSight(state, tile.x, tile.y) ? state.worldSize - chebyshev(tile.x, tile.y, state.player.x, state.player.y) : 0;

  if (intrusion(pick) > 0) {
    // Prefer a move in that exact direction that digs less far into his space, so
    // the enemy only pokes one tile into view (and is caught by surprise next
    // turn). If nothing milder exists, keep the original move.
    for (const c of candidates) {
      if (Math.sign(c.dx) === Math.sign(pick.dx) && Math.sign(c.dy) === Math.sign(pick.dy) && intrusion(c) < intrusion(pick)) {
        pick = c;
      }
    }
  }

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
    if (!unitInSight(next, enemy.x, enemy.y)) {
      enemy.awake = false;
      enemy.surprised = false;
      wanderEnemy(next, enemy);
      continue;
    }
    if (!enemy.awake) {
      enemy.awake = true;
      enemy.surprised = true;
    } else {
      enemy.surprised = false;
      moverIds.push(enemy.id);
    }
  }

  return { state: next, moverIds };
}

// Move a single (seen, aware) enemy: capture the king if possible, else close in.
function moveEnemy(state, enemyId) {
  const next = structuredClone(state);
  const enemy = next.enemies.find((piece) => piece.id === enemyId);
  if (!enemy) {
    return next;
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
    next.player.hp -= 1;
    if (enemy.kind === 'king') {
      enemy.x = fromX; // The boss strikes but stays on the board.
      enemy.y = fromY;
    } else {
      next.enemies = next.enemies.filter((piece) => piece.id !== enemyId);
    }
    next.message = `A ${enemy.kind} strikes the king!`;
    next.lastAction = 'hit';
    if (next.player.hp <= 0) {
      next.gameOver = true;
      next.message = 'The king falls.';
    }
    return next;
  }

  // An enemy that tramples an item in plain sight destroys it.
  const itemIndex = next.items.findIndex((item) => item.x === enemy.x && item.y === enemy.y);
  if (itemIndex >= 0 && unitInSight(next, enemy.x, enemy.y)) {
    const [item] = next.items.splice(itemIndex, 1);
    next.message = `An enemy tramples ${item.kind === 'heart' ? 'a heart' : 'some gold'}.`;
    next.lastAction = 'enemy';
    return next;
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
  // Every ~15 turns spent on this floor, spawns arrive one turn sooner.
  const interval = Math.max(2, next.spawnInterval - Math.floor(next.turn / 15));
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

// Receive one upgrade from an altar, for free. The altar then goes dormant.
function useAltar(state, id) {
  const next = structuredClone(state);
  const p = next.player;
  const def = ALTAR_UPGRADES.find((upgrade) => upgrade.id === id);
  if (!def || !next.altar || next.altar.used) {
    return next;
  }
  if (def.stat && def.max != null && p[def.stat] >= def.max) {
    next.altarMessage = `${def.name} is already maxed.`;
    return next; // leave the altar active so another blessing can be chosen
  }

  if (id === 'hp') {
    p.maxHp += 1;
    p.hp += 1;
  } else if (id === 'vision') {
    p.vision += 1;
    next.viewSize = p.vision; // keep the legacy mirror in sync
    updateDiscovery(next); // the wider window may dispel fog immediately
  } else if (id === 'regen') {
    p.regen += 1;
  } else if (id === 'cards') {
    p.maxCards += 1;
  }
  next.altar.used = true; // one blessing per altar, then it falls dormant
  next.altarMessage = `The altar grants ${def.name}.`;
  return next;
}

// Buy a movement card from a weapon shop. With a free slot it is added; with all
// slots full, `replaceIndex` says which existing card to swap out. `shopMessage`
// reports the result.
function buyCard(state, kind, replaceIndex) {
  const next = structuredClone(state);
  const p = next.player;
  const stats = CARD_STATS[kind];
  if (!stats) {
    return next;
  }
  if (p.gold < stats.cost) {
    next.shopMessage = 'Not enough gold.';
    return next;
  }
  const card = { kind, cooldown: stats.cooldown, remaining: 0 };
  if (p.cards.length < p.maxCards) {
    p.cards.push(card);
  } else if (replaceIndex != null && replaceIndex >= 0 && replaceIndex < p.cards.length) {
    p.cards[replaceIndex] = card;
  } else {
    next.shopMessage = 'Card slots full — choose one to replace.';
    return next;
  }
  p.gold -= stats.cost;
  next.shopMessage = `Acquired the ${kind} card.`;
  return next;
}

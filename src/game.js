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
  };
}

// Find a random free tile matching `predicate`, avoiding everything in `occupied`.
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

// Build (or rebuild) a floor. Carries the player's stats forward between floors.
function generateFloor(floor, carryPlayer, score) {
  const isFinal = floor >= FINAL_FLOOR;

  const player = carryPlayer
    ? { ...carryPlayer, x: PLAYER_START.x, y: PLAYER_START.y }
    : { x: PLAYER_START.x, y: PLAYER_START.y, hp: STARTING_HP, maxHp: STARTING_HP, gold: 0, moveRange: 1, canJump: false };

  const state = {
    worldSize: WORLD_SIZE,
    viewSize: VIEW_SIZE,
    player,
    enemies: [],
    items: [],
    exit: null,
    shop: null,
    floor,
    finalFloor: FINAL_FLOOR,
    isFinalFloor: isFinal,
    turn: 0,
    score: score || 0,
    enemyTurn: false,
    gameOver: false,
    won: false,
    pendingShop: false,
    message: isFinal ? 'The enemy king lurks on this floor. Hunt it down.' : 'A new floor. Seek the exit.',
    lastAction: 'start',
    // Difficulty: deeper floors spawn reinforcements more often.
    spawnInterval: Math.max(3, 9 - floor),
    turnsSinceSpawn: 0,
  };

  const bounds = getVisibleBounds(state);
  const inView = (x, y) => isWithinBounds(bounds, x, y);
  const occupied = new Set([`${player.x},${player.y}`]);

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
    return enemy;
  }

  // Enemies start asleep and out of sight, so nothing ambushes the player on
  // arrival — they get a surprise turn when first spotted (see beginEnemyPhase).
  const offscreenCount = 3 + floor * 2;
  for (let i = 0; i < offscreenCount; i += 1) {
    const tile = place((x, y) => !inView(x, y) && chebyshev(x, y, player.x, player.y) >= 2);
    if (!tile) {
      break;
    }
    addEnemy(PIECE_TYPES[randomInt(PIECE_TYPES.length)], tile.x, tile.y, false);
  }

  // Floor 1 introduces the surprise mechanic with exactly one visible foe.
  if (floor === 1) {
    const tile = place((x, y) => inView(x, y) && chebyshev(x, y, player.x, player.y) >= 2);
    if (tile) {
      addEnemy(PIECE_TYPES[randomInt(PIECE_TYPES.length)], tile.x, tile.y, true);
    }
  }

  // The boss only appears on the final floor.
  if (isFinal) {
    const tile = place((x, y) => !inView(x, y) && chebyshev(x, y, player.x, player.y) >= 5);
    if (tile) {
      addEnemy('king', tile.x, tile.y, false);
    }
  }

  // Items are placed once, at floor creation, and never respawn.
  for (let i = 0; i < 2; i += 1) {
    const tile = place((x, y) => chebyshev(x, y, player.x, player.y) >= 2);
    if (tile) {
      state.items.push({ id: `heart-${floor}-${i}`, kind: 'heart', x: tile.x, y: tile.y });
    }
  }
  for (let i = 0; i < 3 + floor; i += 1) {
    const tile = place((x, y) => chebyshev(x, y, player.x, player.y) >= 2);
    if (tile) {
      state.items.push({ id: `gold-${floor}-${i}`, kind: 'gold', x: tile.x, y: tile.y, amount: 5 + randomInt(11) });
    }
  }

  // The exit always starts outside the king's sight, so it must be found.
  if (!isFinal) {
    const tile = place((x, y) => !inView(x, y) && chebyshev(x, y, player.x, player.y) >= 4);
    if (tile) {
      state.exit = { x: tile.x, y: tile.y, discovered: false };
    }
  }

  // One shop per floor on a random tile.
  const shopTile = place((x, y) => chebyshev(x, y, player.x, player.y) >= 2);
  if (shopTile) {
    state.shop = { x: shopTile.x, y: shopTile.y, discovered: false };
  }

  updateDiscovery(state);
  return state;
}

function createInitialState() {
  return generateFloor(1, null, 0);
}

function nextFloor(state) {
  // Descending mends the king by 1 HP (never above his maximum).
  const healed = { ...state.player, hp: Math.min(state.player.maxHp, state.player.hp + 1) };
  return generateFloor(state.floor + 1, healed, state.score);
}

// Mark the exit / shop as "discovered" once they've been seen, so the renderer
// can leave a faint reminder of where they are even after they fall out of view.
function updateDiscovery(state) {
  const bounds = getVisibleBounds(state);
  if (state.exit && isWithinBounds(bounds, state.exit.x, state.exit.y)) {
    state.exit.discovered = true;
  }
  if (state.shop && isWithinBounds(bounds, state.shop.x, state.shop.y)) {
    state.shop.discovered = true;
  }
}

// Every tile the king may move to: straight slides up to its move range, plus
// knight leaps once that upgrade is unlocked.
function getPlayerMoves(state) {
  const moves = [];
  const seen = new Set();
  const w = state.worldSize;
  const p = state.player;

  const enemyAt = (x, y) => state.enemies.find((e) => e.x === x && e.y === y);
  const add = (x, y, viaJump) => {
    const key = `${x},${y}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    moves.push({ x, y, viaJump: Boolean(viaJump), capture: Boolean(enemyAt(x, y)) });
  };

  for (const [dx, dy] of [...ORTHO, ...DIAG]) {
    for (let stepCount = 1; stepCount <= p.moveRange; stepCount += 1) {
      const x = p.x + dx * stepCount;
      const y = p.y + dy * stepCount;
      if (x < 0 || x >= w || y < 0 || y >= w) {
        break;
      }
      add(x, y, false);
      if (enemyAt(x, y)) {
        break; // Capture, and the slide stops there.
      }
    }
  }

  if (p.canJump) {
    for (const [dx, dy] of KNIGHT_STEPS) {
      const x = p.x + dx;
      const y = p.y + dy;
      if (x >= 0 && x < w && y >= 0 && y < w) {
        add(x, y, true);
      }
    }
  }

  return moves;
}

// Resolve the king arriving on (x, y): capture, pick-ups, exit, shop.
function applyArrival(next, x, y) {
  next.player.x = x;
  next.player.y = y;
  next.turn += 1;
  next.enemyTurn = true;
  next.lastAction = 'move';
  next.message = 'The king moves.';

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
    next.lastAction = 'item';
  }

  if (next.exit && next.exit.x === x && next.exit.y === y) {
    next.lastAction = 'exit';
    next.message = 'You step onto the stair and descend...';
    return next;
  }

  if (next.shop && next.shop.x === x && next.shop.y === y) {
    next.pendingShop = true;
    next.message = 'A shop! It opens once the enemies have moved.';
  }

  updateDiscovery(next);
  return next;
}

// Move the king to a specific tile (used by click-to-move). Validates the tile
// is actually reachable; otherwise the move is rejected.
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

// Keyboard movement: a single step in a direction (precise, always one tile).
function movePlayer(state, dx, dy) {
  return movePlayerTo(state, state.player.x + dx, state.player.y + dy);
}

// Resolve sight at the start of an enemy turn: wake newly-spotted pieces (which
// freeze in surprise this turn) and return the ids of the pieces that may move.
function beginEnemyPhase(state) {
  const next = structuredClone(state);
  const bounds = getVisibleBounds(next);
  const moverIds = [];

  for (const enemy of next.enemies) {
    if (!isWithinBounds(bounds, enemy.x, enemy.y)) {
      enemy.awake = false;
      enemy.surprised = false;
      continue;
    }
    if (!enemy.awake) {
      enemy.awake = true;
      enemy.surprised = true; // Spotted the king — frozen for this one turn.
    } else {
      enemy.surprised = false;
      moverIds.push(enemy.id);
    }
  }

  return { state: next, moverIds };
}

// Move a single enemy: capture the king if possible, otherwise close the distance.
function moveEnemy(state, enemyId) {
  const next = structuredClone(state);
  const enemy = next.enemies.find((piece) => piece.id === enemyId);
  if (!enemy) {
    return next;
  }

  const moves = getPieceMoves(enemy, next);
  if (!moves.length) {
    next.message = 'A cornered piece holds its ground.';
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
  const bounds = getVisibleBounds(next);
  const itemIndex = next.items.findIndex((item) => item.x === enemy.x && item.y === enemy.y);
  if (itemIndex >= 0 && isWithinBounds(bounds, enemy.x, enemy.y)) {
    const [item] = next.items.splice(itemIndex, 1);
    next.message = `An enemy tramples ${item.kind === 'heart' ? 'a heart' : 'some gold'}.`;
    next.lastAction = 'enemy';
    return next;
  }

  next.message = 'An enemy piece advances.';
  next.lastAction = 'enemy';
  return next;
}

// Difficulty over time: occasionally drop a fresh enemy somewhere out of sight.
function maybeSpawnEnemy(state) {
  const next = structuredClone(state);
  next.turnsSinceSpawn += 1;
  if (next.turnsSinceSpawn < next.spawnInterval || next.enemies.length >= MAX_ENEMIES) {
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
  const bounds = getVisibleBounds(next);
  const tile = findFreeTile(occupied, (x, y) => !isWithinBounds(bounds, x, y));
  if (tile) {
    next.enemies.push(createEnemy(PIECE_TYPES[randomInt(PIECE_TYPES.length)], tile.x, tile.y));
  }
  return next;
}

// Spend gold on a shop upgrade. Returns a new state with a `shopMessage`.
function buyUpgrade(state, id) {
  const next = structuredClone(state);
  const def = UPGRADES.find((upgrade) => upgrade.id === id);
  const p = next.player;
  if (!def) {
    return next;
  }
  if (id === 'jump' && p.canJump) {
    next.shopMessage = 'Already learned.';
    return next;
  }
  if (id === 'range' && p.moveRange >= def.max) {
    next.shopMessage = 'Move range is maxed out.';
    return next;
  }
  if (id === 'heal' && p.hp >= p.maxHp) {
    next.shopMessage = 'Already at full health.';
    return next;
  }
  if (p.gold < def.cost) {
    next.shopMessage = 'Not enough gold.';
    return next;
  }

  p.gold -= def.cost;
  if (id === 'heart') {
    p.maxHp += 1;
    p.hp += 1;
  } else if (id === 'heal') {
    p.hp = p.maxHp;
  } else if (id === 'range') {
    p.moveRange += 1;
  } else if (id === 'jump') {
    p.canJump = true;
  }
  next.shopMessage = `Purchased ${def.name}.`;
  return next;
}

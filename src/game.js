const WORLD_SIZE = 20;
const VIEW_SIZE = 8;
const PLAYER_START = { x: 8, y: 8 };

const PIECE_TYPES = ['pawn', 'rook', 'bishop', 'knight', 'queen'];

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function randomInt(max) {
  return Math.floor(Math.random() * max);
}

function createEnemy(type, x, y) {
  return { id: `${type}-${x}-${y}-${Math.random().toString(16).slice(2, 8)}`, kind: type, x, y };
}

function spawnEnemies(state) {
  const enemies = [];
  const occupied = new Set([`${state.player.x},${state.player.y}`]);

  while (enemies.length < 5) {
    const x = randomInt(WORLD_SIZE);
    const y = randomInt(WORLD_SIZE);
    const key = `${x},${y}`;
    if (occupied.has(key)) {
      continue;
    }
    occupied.add(key);
    const type = PIECE_TYPES[randomInt(PIECE_TYPES.length)];
    enemies.push(createEnemy(type, x, y));
  }

  return enemies;
}

export function createInitialState() {
  const player = { x: PLAYER_START.x, y: PLAYER_START.y, hp: 5 };
  const state = {
    worldSize: WORLD_SIZE,
    viewSize: VIEW_SIZE,
    player,
    enemies: [],
    turn: 0,
    enemyTurn: false,
    score: 0,
    message: 'The king awakens on a strange board.',
    gameOver: false,
    lastAction: 'start',
  };

  state.enemies = spawnEnemies(state);
  return state;
}

export function getVisibleBounds(state) {
  const half = Math.floor(state.viewSize / 2);
  return {
    x: clamp(state.player.x - half, 0, state.worldSize - state.viewSize),
    y: clamp(state.player.y - half, 0, state.worldSize - state.viewSize),
    width: state.viewSize,
    height: state.viewSize,
  };
}

export function movePlayer(state, dx, dy) {
  const next = structuredClone(state);
  const targetX = next.player.x + dx;
  const targetY = next.player.y + dy;

  if (targetX < 0 || targetX >= next.worldSize || targetY < 0 || targetY >= next.worldSize) {
    next.message = 'The king cannot step beyond the board.';
    next.lastAction = 'blocked';
    return next;
  }

  const occupiedEnemy = next.enemies.find((enemy) => enemy.x === targetX && enemy.y === targetY);
  next.player.x = targetX;
  next.player.y = targetY;
  next.turn += 1;
  next.enemyTurn = true;

  if (occupiedEnemy) {
    next.enemies = next.enemies.filter((enemy) => enemy.id !== occupiedEnemy.id);
    next.score += 1;
    next.message = `The king defeats a ${occupiedEnemy.kind}.`;
    next.lastAction = 'combat';
  } else {
    next.message = 'The king steps forward.';
    next.lastAction = 'move';
  }

  return next;
}

export function resolveEnemyTurn(state) {
  const next = structuredClone(state);
  if (!next.enemies.length) {
    next.enemyTurn = false;
    return next;
  }

  const enemy = next.enemies[randomInt(next.enemies.length)];
  const dx = Math.sign(next.player.x - enemy.x);
  const dy = Math.sign(next.player.y - enemy.y);
  const preferredMoves = [
    { x: enemy.x + dx, y: enemy.y },
    { x: enemy.x, y: enemy.y + dy },
    { x: enemy.x + (dx === 0 ? 1 : 0), y: enemy.y + (dy === 0 ? 1 : 0) },
  ];

  let moved = false;
  for (const candidate of preferredMoves) {
    if (
      candidate.x >= 0 &&
      candidate.x < next.worldSize &&
      candidate.y >= 0 &&
      candidate.y < next.worldSize &&
      !next.enemies.some((other) => other.id !== enemy.id && other.x === candidate.x && other.y === candidate.y)
    ) {
      enemy.x = candidate.x;
      enemy.y = candidate.y;
      moved = true;
      break;
    }
  }

  if (!moved) {
    enemy.x = clamp(enemy.x, 0, next.worldSize - 1);
    enemy.y = clamp(enemy.y, 0, next.worldSize - 1);
  }

  if (enemy.x === next.player.x && enemy.y === next.player.y) {
    next.player.hp -= 1;
    next.enemies = next.enemies.filter((piece) => piece.id !== enemy.id);
    next.message = 'A hostile piece strikes the king!';
    next.lastAction = 'hit';
    if (next.player.hp <= 0) {
      next.gameOver = true;
      next.message = 'The king falls. Press restart to try again.';
    }
  } else {
    next.message = 'An enemy piece shifts across the board.';
    next.lastAction = 'enemy';
  }

  next.enemyTurn = false;
  return next;
}

export function getPieceLabel(kind) {
  const labels = {
    pawn: '♙',
    rook: '♖',
    bishop: '♗',
    knight: '♘',
    queen: '♕',
  };
  return labels[kind] ?? '♟';
}

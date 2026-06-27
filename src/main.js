import { createInitialState, getPieceLabel, getVisibleBounds, movePlayer, resolveEnemyTurn } from './game.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const turnLabel = document.getElementById('turn');
const healthLabel = document.getElementById('health');
const scoreLabel = document.getElementById('score');
const statusLabel = document.getElementById('status');
const restartButton = document.getElementById('restart');

const tileSize = 44;
const padding = 24;
const boardPixelSize = tileSize * 8;
const boardOffsetX = (canvas.width - boardPixelSize) / 2;
const boardOffsetY = (canvas.height - boardPixelSize) / 2;

let gameState = createInitialState();
let playerRender = { x: gameState.player.x, y: gameState.player.y, targetX: gameState.player.x, targetY: gameState.player.y };
let enemyRenders = [];
let animationTime = 0;
let pendingEnemyTurn = false;

function syncRenderEntities(nextState) {
  playerRender.targetX = nextState.player.x;
  playerRender.targetY = nextState.player.y;

  const nextEnemyRenders = [];
  for (const enemy of nextState.enemies) {
    let render = enemyRenders.find((item) => item.id === enemy.id);
    if (!render) {
      render = { id: enemy.id, x: enemy.x, y: enemy.y, targetX: enemy.x, targetY: enemy.y };
    }
    render.targetX = enemy.x;
    render.targetY = enemy.y;
    render.kind = enemy.kind;
    nextEnemyRenders.push(render);
  }
  enemyRenders = nextEnemyRenders;
}

function updateHud() {
  turnLabel.textContent = `Turn ${gameState.turn}`;
  healthLabel.textContent = `HP ${gameState.player.hp}`;
  scoreLabel.textContent = `Score ${gameState.score}`;
  statusLabel.textContent = gameState.message;
}

function resetRenderPositions(nextState) {
  playerRender.x = nextState.player.x;
  playerRender.y = nextState.player.y;
  playerRender.targetX = nextState.player.x;
  playerRender.targetY = nextState.player.y;

  enemyRenders = nextState.enemies.map((enemy) => ({
    id: enemy.id,
    x: enemy.x,
    y: enemy.y,
    targetX: enemy.x,
    targetY: enemy.y,
    kind: enemy.kind,
  }));
}

function applyState(nextState, animate = true) {
  gameState = nextState;
  updateHud();
  if (animate) {
    syncRenderEntities(nextState);
  } else {
    resetRenderPositions(nextState);
  }
}

function updateEntities(delta) {
  const speed = 0.18 + delta * 0.003;
  playerRender.x += (playerRender.targetX - playerRender.x) * speed;
  playerRender.y += (playerRender.targetY - playerRender.y) * speed;

  for (const enemy of enemyRenders) {
    enemy.x += (enemy.targetX - enemy.x) * speed;
    enemy.y += (enemy.targetY - enemy.y) * speed;
  }
}

function drawBoard() {
  const bounds = getVisibleBounds(gameState);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#020617';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.save();
  ctx.translate(boardOffsetX, boardOffsetY);

  for (let row = 0; row < bounds.height; row += 1) {
    for (let col = 0; col < bounds.width; col += 1) {
      const x = col * tileSize;
      const y = row * tileSize;
      const isDark = (row + col) % 2 === 1;
      ctx.fillStyle = isDark ? '#734d26' : '#f6d7a8';
      ctx.fillRect(x, y, tileSize, tileSize);
    }
  }

  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 2;
  ctx.strokeRect(0, 0, boardPixelSize, boardPixelSize);

  const playerScreenX = (playerRender.x - bounds.x) * tileSize;
  const playerScreenY = (playerRender.y - bounds.y) * tileSize;
  ctx.fillStyle = '#fef3c7';
  ctx.fillRect(playerScreenX + 4, playerScreenY + 4, tileSize - 8, tileSize - 8);

  for (const enemy of enemyRenders) {
    const screenX = (enemy.x - bounds.x) * tileSize;
    const screenY = (enemy.y - bounds.y) * tileSize;
    ctx.fillStyle = '#ef4444';
    ctx.font = `${tileSize * 0.68}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(getPieceLabel(enemy.kind), screenX + tileSize / 2, screenY + tileSize / 2 + 2);
  }

  ctx.fillStyle = '#fff';
  ctx.font = `${tileSize * 0.4}px sans-serif`;
  ctx.textAlign = 'left';
  ctx.fillText('♔', playerScreenX + tileSize * 0.27, playerScreenY + tileSize * 0.62);
  ctx.restore();
}

function step(timestamp) {
  if (!lastTime) {
    lastTime = timestamp;
  }
  const delta = (timestamp - lastTime) / 1000;
  lastTime = timestamp;

  if (animationTime > 0) {
    animationTime = Math.max(0, animationTime - delta);
    if (animationTime === 0 && pendingEnemyTurn && !gameState.gameOver) {
      const nextState = resolveEnemyTurn(gameState);
      applyState(nextState, true);
      pendingEnemyTurn = false;
    }
  }

  updateEntities(delta);
  drawBoard();
  requestAnimationFrame(step);
}

let lastTime = 0;

function handleMove(dx, dy) {
  if (gameState.gameOver) {
    return;
  }

  const nextState = movePlayer(gameState, dx, dy);
  applyState(nextState, true);
  if (nextState.enemyTurn) {
    animationTime = 0.25;
    pendingEnemyTurn = true;
  }
}

function handleKeydown(event) {
  const key = event.key.toLowerCase();
  const moves = {
    arrowup: [0, -1],
    w: [0, -1],
    arrowdown: [0, 1],
    s: [0, 1],
    arrowleft: [-1, 0],
    a: [-1, 0],
    arrowright: [1, 0],
    d: [1, 0],
  };
  const move = moves[key];
  if (move) {
    event.preventDefault();
    handleMove(...move);
  }
}

restartButton.addEventListener('click', () => {
  gameState = createInitialState();
  resetRenderPositions(gameState);
  updateHud();
  animationTime = 0;
  pendingEnemyTurn = false;
  lastTime = 0;
});

document.addEventListener('keydown', handleKeydown);

updateHud();
resetRenderPositions(gameState);
drawBoard();
requestAnimationFrame(step);

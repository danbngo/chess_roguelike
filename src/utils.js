// Small pure helpers shared across the game logic.

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function randomInt(max) {
  return Math.floor(Math.random() * max);
}

function chebyshev(ax, ay, bx, by) {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

function distanceSq(x, y, px, py) {
  const dx = x - px;
  const dy = y - py;
  return dx * dx + dy * dy;
}

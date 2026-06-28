// Vision / fog-of-war: what the king can see and which tiles are under threat.

// The square sight window centered on the king, sized by his current vision
// (upgradable), clamped to stay inside the world. `viewSize` is a legacy
// fallback for saves made before vision became a player stat.
function getVisibleBounds(state) {
  const size = state.player.vision || state.viewSize;
  const half = Math.floor(size / 2);
  return {
    x: clamp(state.player.x - half, 0, state.worldSize - size),
    y: clamp(state.player.y - half, 0, state.worldSize - size),
    width: size,
    height: size,
  };
}

function isWithinBounds(bounds, x, y) {
  return x >= bounds.x && x < bounds.x + bounds.width && y >= bounds.y && y < bounds.y + bounds.height;
}

// Enemies the king can actually see (clear line of sight, not hidden in mist).
function getVisibleEnemies(state) {
  return state.enemies.filter((enemy) => unitInSight(state, enemy.x, enemy.y));
}

// Map of "x,y" -> how many visible enemies could capture the king on that tile.
// The renderer tints more heavily where the count is higher.
function getThreatenedTiles(state) {
  const counts = new Map();
  for (const enemy of getVisibleEnemies(state)) {
    for (const tile of getPieceThreats(enemy, state)) {
      const key = `${tile.x},${tile.y}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  return counts;
}

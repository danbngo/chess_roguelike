// Vision / fog-of-war: what the king can see and which tiles are under threat.

// The square sight window centered on the king, sized by his current vision
// (upgradable), clamped to stay inside the world. `viewSize` is a legacy
// fallback for saves made before vision became a player stat.
function getVisibleBounds(state) {
  const p = state.player;
  // Phase (Sorcerer): while embedded in something OPAQUE (a wall or boulder) the king can
  // barely see out (3x3 window). Clear ice does not blind him.
  const size = (p.phase && blocksSight(terrainAt(state, p.x, p.y))) ? 3 : (p.vision || state.viewSize);
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

// Enemies the king can actually see (clear line of sight).
function getVisibleEnemies(state) {
  return state.enemies.filter((enemy) => unitInSight(state, enemy.x, enemy.y));
}

// Whether a (visible) enemy could actually strike the king on its NEXT turn — used to decide
// which tiles read as dangerous. A piece that is recovering/winding-up (skips its turn), dozing,
// asleep, or a befriended beast poses no threat this turn.
function threatensNextTurn(state, enemy) {
  if (enemy.recovering) return false; // a boss/turret catching its breath can't fire next turn
  if (enemy.dozing || enemy.asleep) return false;
  if (typeof isBefriendedBeast === 'function' && isBefriendedBeast(state, enemy)) return false;
  return true;
}

// Map of "x,y" -> how many visible enemies could capture the king on that tile.
// The renderer tints more heavily where the count is higher.
// A turret is only a LIVE threat when the king is actually standing in its firing line (then it
// locks on and fires); off-line it sits idle. Used to gate its danger tiles and its status icon.
function turretHasKingInLine(state, turret) {
  return getPieceThreats(turret, state, true).some((t) => t.x === state.player.x && t.y === state.player.y);
}

function getThreatenedTiles(state) {
  const counts = new Map();
  for (const enemy of getVisibleEnemies(state)) {
    if (!threatensNextTurn(state, enemy)) continue;
    // includeOccupied: a tile an enemy sits on is still dangerous, because the king
    // can capture that enemy and end his move there — where other foes can hit him.
    const tiles = getPieceThreats(enemy, state, true);
    // A turret paints its firing lane RED only while the king is in it — an idle turret (king off
    // its line) is dormant this turn, so its lane isn't marked dangerous.
    if (enemy.turret && !tiles.some((t) => t.x === state.player.x && t.y === state.player.y)) continue;
    for (const tile of tiles) {
      const key = `${tile.x},${tile.y}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  return counts;
}

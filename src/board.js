// Vision / fog-of-war: what the king can see and which tiles are under threat.

// The square sight window centered on the king, sized by his current vision
// (upgradable), clamped to stay inside the world. `viewSize` is a legacy
// fallback for saves made before vision became a player stat.
// The DISPLAY sight window: how far the king SEES (his full vision, one-way Oracle sight included).
function getVisibleBounds(state) {
  const p = state.player;
  // Phase (Sorcerer): while embedded in something OPAQUE (a wall or boulder) the king can
  // barely see out (3x3 window). Clear ice does not blind him.
  const size = (p.phase && blocksSight(terrainAt(state, p.x, p.y))) ? 3 : (p.vision || state.viewSize);
  return boundsOfSize(state, size);
}

// The AWARENESS window: how far FOES can see the king back — his display sight MINUS any one-way
// Oracle band (Hawk Eyes / Power Draw). Foes out in that extended band can't see or target him.
function getAwarenessBounds(state) {
  const p = state.player;
  const display = (p.phase && blocksSight(terrainAt(state, p.x, p.y))) ? 3 : (p.vision || state.viewSize);
  const size = Math.max(3, display - (p.visionOneWay || 0));
  return boundsOfSize(state, size);
}

function boundsOfSize(state, size) {
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
  const p = state.player;
  // Judge danger as if the king's OWN body were NOT on the board — a slider / turret threatens its
  // FULL line, so a tile the king currently SHADOWS (one he'd expose the moment he steps onto it)
  // is correctly flagged, not falsely shown safe. (Mirrors blinkToSafety's ghost.)
  const ghost = { ...state, player: { ...p, x: -50, y: -50 } };
  for (const enemy of getVisibleEnemies(state)) {
    if (!threatensNextTurn(state, enemy)) continue;
    // includeOccupied: a tile an enemy sits on is still dangerous, because the king
    // can capture that enemy and end his move there — where other foes can hit him.
    const tiles = getPieceThreats(enemy, ghost, true);
    // A turret only fires the turn the king is ALREADY in its line (it locked on last turn); step
    // in fresh and it merely aims. So paint its lane RED only when the king currently stands in it
    // — but thanks to the ghost above, the WHOLE lane is then flagged, including tiles beyond his
    // own body that he'd slide onto and eat a shot at (the bug this fixes).
    if (enemy.turret && !tiles.some((t) => t.x === p.x && t.y === p.y)) continue;
    for (const tile of tiles) {
      const key = `${tile.x},${tile.y}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  return counts;
}

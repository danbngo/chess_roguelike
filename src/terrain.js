// Terrain types and the rules that depend on them: symmetric line of sight and
// the slide / jump movement primitives shared by the player and the enemies. Only
// three terrain types exist:
//
//   normal - open ground.
//   wall   - solid; blocks movement AND line of sight, and cannot be leapt over.
//   water  - passable but SLOW: at most one water tile may be crossed per move,
//            and no weapon card may be used while wading in it (so a lake can
//            never wall the king off the exit). Doesn't block sight; leapt over.
//   lava   - the king cannot cross it, but ENEMIES can (it doesn't stop them);
//            leapers jump clean over it and it doesn't block sight.
//
// Sight is hidden only by walls (and drifting fog clouds / the fog of war). A
// Ranger's Eagle Eye lets sight pass through anything but walls.

function terrainAt(state, x, y) {
  return (state.terrain && state.terrain[`${x},${y}`]) || 'normal';
}

function blocksSight(type) {
  return type === 'wall';
}

// Whether a mover may enter/stop on a tile. Walls stop everything. Flyers cross
// anything but walls. Lava is passable only to enemies (opts.lavaOk); water is
// passable to all (but slow — see slideStops).
function standableFor(type, opts) {
  if (type === 'wall') return false;
  const o = opts || {};
  if (o.flying) return true;
  if (type === 'lava') return Boolean(o.lavaOk);
  return true; // water & normal are walkable
}

// Slow terrain the king only crosses one tile of per move (and can't cast from).
function isSlowTerrain(type) {
  return type === 'water';
}

// Context-free standability (used for placement): a plain walker.
function isStandable(type) {
  return standableFor(type, {});
}

// Symmetric line of sight: clear unless a wall lies strictly between the two
// points (endpoints themselves are not opaque to the look).
function hasLineOfSight(state, x0, y0, x1, y1) {
  // A Ranger's Eagle Eye lets the king see through anything but stone walls.
  const xray = Boolean(state.player && state.player.xraySight);
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let x = x0;
  let y = y0;
  while (x !== x1 || y !== y1) {
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
    if (x === x1 && y === y1) {
      break;
    }
    const blocked = xray ? terrainAt(state, x, y) === 'wall' : (blocksSight(terrainAt(state, x, y)) || (state.fogClouds && state.fogClouds[`${x},${y}`]));
    if (blocked) {
      return false; // walls (and, without Eagle Eye, brush/trees/fog clouds) block the look
    }
  }
  return true;
}

// A tile is in sight if it is inside the king's window and unobstructed.
function inLineOfSight(state, x, y) {
  return isWithinBounds(getVisibleBounds(state), x, y) && hasLineOfSight(state, state.player.x, state.player.y, x, y);
}

// A piece is mutually visible with the king when sight is clear. (Line of sight
// is symmetric, so this is "it sees you and you see it".)
function unitInSight(state, x, y) {
  return inLineOfSight(state, x, y);
}

// The set of tiles the king can currently see (for rendering brightness).
function computeVisibleTiles(state) {
  const bounds = getVisibleBounds(state);
  const set = new Set();
  for (let y = bounds.y; y < bounds.y + bounds.height; y += 1) {
    for (let x = bounds.x; x < bounds.x + bounds.width; x += 1) {
      if (hasLineOfSight(state, state.player.x, state.player.y, x, y)) {
        set.add(`${x},${y}`);
      }
    }
  }
  return set;
}

// Walk a ray, returning every tile the mover may legally stop on. Ice forces a
// slide (you can't stop on it); mud caps at two crossed tiles; walls and water
// are solid. `unitAt(x,y)` returns a blocking unit (or null); `isTarget(x,y)`
// reports whether a unit there may be captured (and thus stopped on).
function slideStops(state, sx, sy, dx, dy, maxGround, unitAt, isTarget, opts) {
  const o = opts || {};
  const immune = Boolean(o.terrainImmune) || Boolean(o.flying); // ignore slow-terrain effects
  const stops = [];
  let x = sx;
  let y = sy;
  let groundUsed = 0;
  let slowUsed = 0;

  while (true) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || nx >= WORLD_SIZE || ny < 0 || ny >= WORLD_SIZE) break;
    const terrain = terrainAt(state, nx, ny);
    if (!standableFor(terrain, o)) break; // wall always; water/lava unless it flies / walks lava
    if (unitAt(nx, ny)) {
      // Capturing the target costs a ground step; without the range to spend it,
      // the target is out of reach this move (a 1-range king can't pounce two).
      if (isTarget(nx, ny) && groundUsed < maxGround) {
        stops.push({ x: nx, y: ny, capture: true });
      }
      break;
    }
    if (isSlowTerrain(terrain) && !immune && slowUsed >= 1) break; // at most one water tile per move
    if (groundUsed >= maxGround) break; // out of range
    groundUsed += 1;
    if (isSlowTerrain(terrain) && !immune) slowUsed += 1;
    x = nx;
    y = ny;
    stops.push({ x, y, capture: false });
  }
  return stops;
}

// Knight-style leaps: land on the L tiles, never onto a wall, and never over a
// wall (a wall on either orthogonal shoulder blocks the leap). Water underneath
// is leapt clean over.
function jumpTargets(state, fromX, fromY, unitAt, isTarget) {
  const targets = [];
  for (const [dx, dy] of KNIGHT_STEPS) {
    const x = fromX + dx;
    const y = fromY + dy;
    if (x < 0 || x >= WORLD_SIZE || y < 0 || y >= WORLD_SIZE) {
      continue;
    }
    const terrain = terrainAt(state, x, y);
    if (terrain === 'wall' || terrain === 'lava') {
      continue; // Can't land on a wall or in deep water.
    }
    if (terrainAt(state, fromX + Math.sign(dx), fromY) === 'wall') {
      continue; // Wall blocks the leap.
    }
    if (terrainAt(state, fromX, fromY + Math.sign(dy)) === 'wall') {
      continue;
    }
    const unit = unitAt(x, y);
    if (unit && !isTarget(x, y)) {
      continue; // Friendly piece in the way.
    }
    targets.push({ x, y, viaJump: true, capture: Boolean(unit) });
  }
  return targets;
}

// A generic leaper (e.g. the camel's (3,1) hop): lands on from+step, leaping
// clean over whatever lies between. Like a knight it cannot land on a wall or a
// friendly piece, but it has no shoulder-blocking rule.
function leapTargets(state, fromX, fromY, steps, unitAt, isTarget) {
  const targets = [];
  for (const [dx, dy] of steps) {
    const x = fromX + dx;
    const y = fromY + dy;
    if (x < 0 || x >= WORLD_SIZE || y < 0 || y >= WORLD_SIZE) {
      continue;
    }
    const terrain = terrainAt(state, x, y);
    if (terrain === 'wall' || terrain === 'lava') {
      continue; // Can't land on a wall or in deep water.
    }
    const unit = unitAt(x, y);
    if (unit && !isTarget(x, y)) {
      continue; // Friendly piece in the way.
    }
    targets.push({ x, y, viaJump: true, capture: Boolean(unit) });
  }
  return targets;
}

// A rider over leap vectors (the nightrider rides repeated knight hops in a line):
// it keeps leaping in each direction until it leaves the board, hits a wall, or
// meets a unit (capturing it if it is a target). Each individual hop leaps clean
// over the cells between, but a unit on a landing square blocks further travel.
function riderTargets(state, fromX, fromY, steps, unitAt, isTarget) {
  const targets = [];
  for (const [dx, dy] of steps) {
    let x = fromX;
    let y = fromY;
    while (true) {
      x += dx;
      y += dy;
      if (x < 0 || x >= WORLD_SIZE || y < 0 || y >= WORLD_SIZE) {
        break;
      }
      const terrain = terrainAt(state, x, y);
      if (terrain === 'wall' || terrain === 'lava') {
        break; // Can't land on a wall or in deep water, and can't ride past it.
      }
      const unit = unitAt(x, y);
      if (unit) {
        if (isTarget(x, y)) {
          targets.push({ x, y, viaJump: true, capture: true });
        }
        break; // A unit on a landing square halts the ride.
      }
      targets.push({ x, y, viaJump: true, capture: false });
    }
  }
  return targets;
}

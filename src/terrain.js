// Terrain types and the rules that depend on them: symmetric line of sight and
// the slide / jump movement primitives shared by the player and the enemies.
//
//   normal - open ground.
//   wall   - solid; nothing may stand on it, it blocks line of sight, and it
//            cannot be leapt over.
//   lava   - impassable (nothing may stand on it), but it does NOT block sight;
//            leapers can still jump clean over it. (Demon realm only, floor 5+.)
//   mud    - slow: at most ONE mud/water tile may be crossed in a move, and no
//            weapon card may be used while standing on it.
//   water  - now passable but slow, exactly like mud (so the king can never be
//            walled off the exit by a lake); also blocks card use while on it.
//   ice    - you cannot stop on it; you slide to the far end (or until you bump
//            a unit / hit a wall). Jumps and weapon shots ignore ice.
//   brush  - blocks line of sight and blocks sliding through, but is trampled back
//            to open ground the moment a unit steps onto it (in the king's sight).
//   fire   - a temporary hazard (from a Fiery spell or the Balrog): burns down to
//            normal after a couple of turns, and scorches any non-demon that is
//            caught in it. Non-demons won't step into it, but can be knocked in.
//
// Sight is hidden by walls, brush, drifting fog clouds, and the fog of war (a
// Ranger's Eagle Eye lets sight pass through anything but walls).

function terrainAt(state, x, y) {
  return (state.terrain && state.terrain[`${x},${y}`]) || 'normal';
}

function blocksSight(type) {
  return type === 'wall' || type === 'brush' || type === 'trees';
}

// Whether a mover may enter/stop on a tile, given its options (flying / lavaOk).
// Walls stop everything. Flyers cross anything but walls. Lava is passable only to
// flyers and lava-walkers (demonic enemies); water only to flyers. Brush/trees/
// ice/mud/normal are walkable.
function standableFor(type, opts) {
  if (type === 'wall') return false;
  const o = opts || {};
  if (o.flying) return true;
  if (type === 'lava') return Boolean(o.lavaOk);
  if (type === 'fire') return Boolean(o.fireOk); // only demons stride into flame (others are knocked in)
  return true; // water is now passable (but slow — see slideStops)
}

// Slow terrain the king can only cross one tile of per move (and can't cast from).
function isSlowTerrain(type) {
  return type === 'mud' || type === 'water';
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
  const immune = Boolean(o.terrainImmune) || Boolean(o.flying); // ignore ice/mud/brush effects
  const iceSlides = !immune && !o.ignoreIce; // weapon shots (ignoreIce) don't slide
  const stops = [];
  let x = sx;
  let y = sy;
  let groundUsed = 0;
  let mudUsed = 0;
  let onIce = false;

  while (true) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || nx >= WORLD_SIZE || ny < 0 || ny >= WORLD_SIZE) {
      if (onIce) stops.push({ x, y, capture: false });
      break;
    }
    const terrain = terrainAt(state, nx, ny);
    if (!standableFor(terrain, o)) {
      // Solid for this mover (walls always; water/lava unless it flies / walks lava).
      if (onIce) stops.push({ x, y, capture: false });
      break;
    }
    if (unitAt(nx, ny)) {
      if (isTarget(nx, ny)) {
        // Capturing the target costs a ground step (unless an ice slide carries
        // the mover in for free). Without the range to spend it, the target is
        // simply out of reach this move — a 1-range king can't pounce two tiles.
        const captureCost = onIce ? 0 : 1;
        if (captureCost === 0 || groundUsed < maxGround) {
          stops.push({ x: nx, y: ny, capture: true });
        } else if (onIce) {
          stops.push({ x, y, capture: false });
        }
      } else if (onIce) {
        stops.push({ x, y, capture: false });
      }
      break;
    }
    if (isSlowTerrain(terrain) && !immune && mudUsed >= 1) {
      if (onIce) stops.push({ x, y, capture: false });
      break; // may cross at most ONE mud/water tile per move
    }
    const cost = onIce ? 0 : 1;
    if (cost === 1 && groundUsed >= maxGround) {
      break; // Out of range on solid ground.
    }
    groundUsed += cost;
    if (isSlowTerrain(terrain) && !immune) {
      mudUsed += 1;
    }
    const wasOnIce = onIce;
    x = nx;
    y = ny;
    if (terrain === 'ice' && iceSlides) {
      onIce = true; // Keep sliding; ice is never a resting tile.
    } else {
      stops.push({ x, y, capture: false });
      onIce = false;
      if (wasOnIce || (terrain === 'brush' && !immune)) {
        break; // stopped at the edge of ice, or trampled into blocking brush
      }
    }
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

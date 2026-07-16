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

// Sight (and projectiles) are stopped by walls and boulders. Pits are open holes and lava/
// water are low, so none of those block the look or a shot.
function blocksSight(type) {
  // Devilgrass grows tall enough to hide what's behind it. ICE is see-through — a frozen
  // pane you can look past but not walk through.
  return type === 'wall' || type === 'boulder' || type === 'devilgrass';
}

// Whether a mover may enter/stop on a tile. Walls and BOULDERS stop everyone (a phasing
// king excepted). PITS are bottomless — impassable to all, always. Lava is WALKABLE by
// default (the king sears 1 HP/turn on it — see passTurn); `opts.lavaOk === false` bars it,
// which the level generator relies on for a guaranteed safe path. Water is passable (slow).
function standableFor(type, opts) {
  const o = opts || {};
  if (type === 'wall' || type === 'boulder' || type === 'ice') return Boolean(o.phaseWalls); // walls, boulders & ice slabs stop everyone but a phasing mover
  if (type === 'pit') return Boolean(o.flying); // only a FLYING mover (Winged Boots / a flying boss) crosses a pit
  if (type === 'lava') return o.lavaOk !== false; // walkable unless a caller explicitly forbids it
  return true; // water & normal are walkable
}

// Slow terrain the king only crosses one tile of per move (and can't cast from).
function isSlowTerrain(type) {
  return type === 'water';
}

// Context-free standability (used for placement / spawns): a plain walker who avoids
// lava. (The king may now WALK onto lava — that goes through standableFor with no
// lavaOk — but nothing should be PLACED on it.)
function isStandable(type) {
  return standableFor(type, { lavaOk: false });
}

// Symmetric line of sight: clear unless a wall lies strictly between the two
// points (endpoints themselves are not opaque to the look).
function hasLineOfSight(state, x0, y0, x1, y1, seeWalls) {
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
    if (blocksSight(terrainAt(state, x, y)) && !seeWalls) {
      return false; // walls block the look (unless the looker sees over them)
    }
  }
  return true;
}

// Does the king's OWN sight pass over sight-blockers (walls/boulders/devilgrass)? Sixth Sense
// grants it for both seeing AND shooting; Premonition (trueSight) grants it for SEEING ONLY
// (his shots and steps still stop at cover). Both are one-way — see enemyAwareOfKing.
function playerSeesThroughCover(state) {
  const p = state.player || {};
  return Boolean(p.seeThroughWalls || p.trueSight);
}

// A tile is in the KING's sight if it is inside his window and unobstructed.
function inLineOfSight(state, x, y) {
  return isWithinBounds(getVisibleBounds(state), x, y) && hasLineOfSight(state, state.player.x, state.player.y, x, y, playerSeesThroughCover(state));
}

// A unit the KING can see (his vision — passes over walls with Sixth Sense).
function unitInSight(state, x, y) {
  return inLineOfSight(state, x, y);
}

// Whether the foe at (ex,ey) can see the KING. Walls ALWAYS block here: Sixth Sense is
// one-way, so a foe on the far side of a wall stays oblivious even while the Ranger sees
// (and shoots) it through the wall.
function enemyAwareOfKing(state, ex, ey, seeWalls) {
  return isWithinBounds(getVisibleBounds(state), ex, ey) && hasLineOfSight(state, state.player.x, state.player.y, ex, ey, Boolean(seeWalls));
}

// The set of tiles the king can currently see (for rendering brightness).
function computeVisibleTiles(state) {
  const bounds = getVisibleBounds(state);
  const seeWalls = playerSeesThroughCover(state);
  const set = new Set();
  for (let y = bounds.y; y < bounds.y + bounds.height; y += 1) {
    for (let x = bounds.x; x < bounds.x + bounds.width; x += 1) {
      if (hasLineOfSight(state, state.player.x, state.player.y, x, y, seeWalls)) {
        set.add(`${x},${y}`);
      }
    }
  }
  return set;
}

// Walk a ray, returning every tile the mover may legally stop on. Water is slow
// (at most one crossed per move); walls stop the ray. `unitAt(x,y)` returns a
// blocking unit (or null); `isTarget(x,y)` reports whether a unit there may be
// captured (and thus stopped on).
function slideStops(state, sx, sy, dx, dy, maxGround, unitAt, isTarget, opts) {
  const o = opts || {};
  const immune = Boolean(o.terrainImmune); // ignore slow-terrain effects
  // A PROJECTILE ray (turret fire) flies over pits / lava / water, stopped only by walls,
  // boulders, and the first unit it strikes — so a turret's line of fire crosses a pit.
  const projectile = Boolean(o.projectile);
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
    const blocked = projectile ? blocksSight(terrain) : !standableFor(terrain, o);
    if (projectile && blocked) break; // a bolt stops at opaque cover (wall/boulder) — never reaches a unit behind it
    if (unitAt(nx, ny)) {
      // Capturing the target costs a ground step; without the range to spend it,
      // the target is out of reach this move (a 1-range king can't pounce two). A capturable
      // unit EMBEDDED in blocked terrain (a phasing foe in a wall/ice, or the phased king) can
      // still be STRUCK when the path to it is clear — the striker falls short rather than moving
      // onto the tile (`embedded` flags that for resolution).
      if (isTarget(nx, ny) && groundUsed < maxGround) {
        stops.push({ x: nx, y: ny, capture: true, embedded: !projectile && blocked });
      }
      break;
    }
    if (blocked) break; // empty non-standable terrain stops the slide
    if (!projectile && isSlowTerrain(terrain) && !immune && slowUsed >= 1) break; // one water tile / move
    if (groundUsed >= maxGround) break; // out of range
    groundUsed += 1;
    if (!projectile && isSlowTerrain(terrain) && !immune) slowUsed += 1;
    x = nx;
    y = ny;
    stops.push({ x, y, capture: false });
  }
  return stops;
}

// Knight-style leaps: land on the L tiles, never onto a wall, and never over a
// wall (a wall on either orthogonal shoulder blocks the leap). Water underneath
// is leapt clean over.
function jumpTargets(state, fromX, fromY, unitAt, isTarget, opts) {
  const phaseWalls = Boolean(opts && opts.phaseWalls);
  const flying = Boolean(opts && opts.flying); // Fairy Wings / a Flying boss — may alight on lava/pits
  const targets = [];
  for (const [dx, dy] of KNIGHT_STEPS) {
    const x = fromX + dx;
    const y = fromY + dy;
    if (x < 0 || x >= WORLD_SIZE || y < 0 || y >= WORLD_SIZE) {
      continue;
    }
    const terrain = terrainAt(state, x, y);
    if ((terrain === 'lava' || terrain === 'pit') && !flying) {
      continue; // never land in lava or a bottomless pit — unless flying (Fairy Wings)
    }
    const unit = unitAt(x, y);
    if (unit && !isTarget(x, y)) {
      continue; // Friendly piece in the way.
    }
    const capHere = Boolean(unit); // a capturable foe on the landing tile (passed the filter above)
    if (terrain === 'wall') {
      // Can't land on a wall — UNLESS a phasing leaper is pouncing onto a foe embedded there.
      if (!(phaseWalls && capHere)) continue;
    } else if (terrain === 'ice') {
      // Empty ice is a fine landing (the leap shatters it). But a foe EMBEDDED in ice may only
      // be pounced on by a leaper that also phases.
      if (capHere && !phaseWalls) continue;
    }
    if (!phaseWalls && terrainAt(state, fromX + Math.sign(dx), fromY) === 'wall') {
      continue; // Wall blocks the leap (a phasing leaper ignores the shoulder).
    }
    if (!phaseWalls && terrainAt(state, fromX, fromY + Math.sign(dy)) === 'wall') {
      continue;
    }
    targets.push({ x, y, viaJump: true, capture: capHere });
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
    if (terrain === 'wall' || terrain === 'lava' || terrain === 'pit') {
      continue; // can't land on a wall, in lava, or in a bottomless pit (a boulder IS landable — a leaper crushes it)
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

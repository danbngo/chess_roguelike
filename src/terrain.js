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

// A torch bracketed on a WALL. Only a PHASING mover can ever stand inside that wall, and when one
// does the torch sears it 1 HP a turn exactly as lava does (see passTurn / bossMove / tickLavaDamage).
// Guarded by the wall check so a stale entry left on a since-cleared tile is harmless.
function hasTorch(state, x, y) {
  return terrainAt(state, x, y) === 'wall' && Boolean(state.torches && state.torches[`${x},${y}`]);
}

// Sight (and projectiles) are stopped by walls and boulders. Pits are open holes and lava/
// water are low, so none of those block the look or a shot.
function blocksSight(type) {
  // Devilgrass grows tall enough to hide what's behind it. ICE is see-through — a frozen
  // pane you can look past but not walk through. A SHUT door blocks the look and any shot; an
  // OPEN one ('dooropen') is a clear passage.
  // NB: no 'gate'. A gate is BARS — it stops you walking through, never looking (or shooting)
  // through. That is the whole point of it, and the only thing separating it from a tree.
  return type === 'wall' || type === 'tree' || type === 'boulder' || type === 'devilgrass' || type === 'door';
}

// SOFT cover: sight-blockers that are only a haze — tall grass and (handled separately) the
// erupting geyser's steam. Premonition (trueSight) looks and shoots THROUGH these but not through
// HARD, opaque cover (stone, timber, boulders, a shut door). Sixth Sense sees through everything.
function blocksSightSoft(type) {
  return type === 'devilgrass';
}

// Whether a mover may enter/stop on a tile. Walls and BOULDERS stop everyone (a phasing
// king excepted). PITS are bottomless — impassable to all, always. Lava is WALKABLE by
// default (the king sears 1 HP/turn on it — see passTurn); `opts.lavaOk === false` bars it,
// which the level generator relies on for a guaranteed safe path. Water is passable (slow).
function standableFor(type, opts) {
  const o = opts || {};
  if (type === 'door' || type === 'dooropen' || type === 'doorajar') return true; // a door is always walkable — stepping onto a SHUT/closing one (re)opens it (see openDoorsUnderUnits)
  // The two immunities are DISJOINT, on purpose (no overlap): PATHFINDER (Druid) is the woodsman —
  // he threads TREES, wades WATER and treads PITS; PHASE (Sorcerer) is the ghost — it slips WALLS,
  // ICE and GATES. Neither crosses LAVA.
  //
  // A BOULDER is not on that list. Phase is for slipping into the dungeon's FABRIC — masonry, a slab,
  // barred iron: fixed things you can sink into and hide inside. A boulder is loose rock sitting on
  // the floor, and it is also a thing you SHOVE: letting a phaser occupy one made the push mechanic
  // incoherent, and (worse) a knockback could hurl him into a rock he had no intention of entering.
  // Nothing stands in a boulder now, so being shoved at one simply stops him short.
  if (type === 'tree') return Boolean(o.pathfinder); // solid timber — only Pathfinder walks through it
  if (type === 'gate') return Boolean(o.phaseWalls); // barred iron — only Phase slips the bars (see-through, though; see blocksSight)
  if (type === 'wall' || type === 'ice') return Boolean(o.phaseWalls); // masonry & ice slabs — only a phasing mover
  if (type === 'boulder') return false; // LOOSE STONE stops everyone, phaser included — see below
  if (type === 'pit') return Boolean(o.flying || o.pitOk || o.pathfinder); // Pathfinder treads the void; a FLYING mover soars it; a BURROWER walks it as solid ground
  if (type === 'lava') return o.lavaOk !== false; // walkable (it sears) unless a caller forbids it — NEITHER immunity gives a lava pass
  return true; // water & normal are walkable
}

// SOLID ground: stone, timber, iron. Nothing alights on top of any of them — only a phasing mover
// gets to be inside one. They must be named in ONE place, because the leapers each carried their own
// hand-written list of terrain names, and trees and gates were added long after those lists were
// written: nothing pointed a knight at them, so it would happily perch in a treetop.
function isSolidBarrier(type) {
  return type === 'wall' || type === 'tree' || type === 'gate';
}

// Slow terrain: a mover wades ONE tile of it per move and must stop there — no sliding clean
// across a channel — and can't ready a weapon while standing in it. LAVA counts: it used to stop
// nobody, so a rook could slide straight over a fire river as if it were floor. It now costs you
// the same way water does, on top of searing whatever ends its turn in it. (Projectiles are exempt
// — a bolt still flies over both; see slideStops' `projectile`.)
function isSlowTerrain(type) {
  return type === 'water' || type === 'lava';
}

// Context-free standability (used for placement / spawns): a plain walker who avoids
// lava. (The king may now WALK onto lava — that goes through standableFor with no
// lavaOk — but nothing should be PLACED on it.)
function isStandable(type) {
  return standableFor(type, { lavaOk: false });
}

// Symmetric line of sight: clear unless cover lies strictly between the two points (endpoints
// themselves are not opaque to the look). `seeMode` is how far the looker sees THROUGH cover:
//   false  — sees through nothing (plain sight)
//   'soft' — sees/shoots through HAZE only: tall grass and erupting geyser steam (Premonition)
//   true   — sees through everything, opaque cover included (Sixth Sense)
function hasLineOfSight(state, x0, y0, x1, y1, seeMode) {
  const seesAll = seeMode === true || seeMode === 'all';
  const seesSoft = seesAll || seeMode === 'soft';
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
    const tt = terrainAt(state, x, y);
    if (blocksSight(tt)) {
      // Haze (grass) yields to soft-sight; opaque cover (stone/timber/boulder/door) only to full sight.
      if (blocksSightSoft(tt) ? !seesSoft : !seesAll) return false;
    }
    // A geyser is see-through when dormant, but its erupting plume of gas blocks the look for that
    // one turn — the same gas that scalds anything over it (see geyserErupting/tickGeysers). Steam is
    // HAZE, so soft-sight (Premonition) peers through it.
    if (tt === 'geyser' && typeof geyserErupting === 'function' && geyserErupting(state) && !seesSoft) {
      return false;
    }
    // FOG: a drifting cloud that blocks the look while it lingers. It too is HAZE — soft-sight sees
    // through it (that is the Oracle's Premonition), and full x-ray sight of course does.
    if (typeof fogAt === 'function' && fogAt(state, x, y) && !seesSoft) {
      return false;
    }
  }
  return true;
}

// Is there a GATE strictly between two points? Used to tell a caged (gaol) prisoner apart from an
// open-field sleeper: it watches the king through the see-through bars of its cell, so it wakes at
// sight range rather than only when he is right at the door.
function lineHasGate(state, x0, y0, x1, y1) {
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let x = x0;
  let y = y0;
  while (x !== x1 || y !== y1) {
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 < dx) { err += dx; y += sy; }
    if (x === x1 && y === y1) break;
    if (terrainAt(state, x, y) === 'gate') return true;
  }
  return false;
}

// How far the king's OWN sight passes THROUGH cover. Sixth Sense (seeThroughWalls) sees and shoots
// clean through opaque cover — full x-ray (returns true). Premonition (trueSight) is now the lesser
// gift: it peers only through HAZE — tall grass and geyser steam — never stone, timber or boulders
// (returns 'soft'). Both are one-way — see enemyAwareOfKing.
function playerSeesThroughCover(state) {
  const p = state.player || {};
  if (p.seeThroughWalls) return true;
  if (p.trueSight) return 'soft';
  return false;
}

// A tile is in the KING's sight if it is inside his window and unobstructed.
function inLineOfSight(state, x, y) {
  return isWithinBounds(getVisibleBounds(state), x, y) && hasLineOfSight(state, state.player.x, state.player.y, x, y, playerSeesThroughCover(state));
}

// A unit the KING can see (his vision — passes over walls with Sixth Sense).
function unitInSight(state, x, y) {
  return inLineOfSight(state, x, y);
}

// Whether the foe at (ex,ey) can see the KING. It uses the AWARENESS window (his two-way footprint),
// NOT his full display sight — so a foe out in the one-way Oracle band can't perceive him. Walls
// always block here too: the Ranger's extended/see-through sight is one-way.
function enemyAwareOfKing(state, ex, ey, seeWalls) {
  return isWithinBounds(getAwarenessBounds(state), ex, ey) && hasLineOfSight(state, state.player.x, state.player.y, ex, ey, Boolean(seeWalls));
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
  // FLYING soars over all slow terrain; PATHFINDER wades WATER at a walk but is still mired by lava
  // (no lava pass). So water is fast for both, lava only for flying.
  const ignoresSlow = (t) => Boolean(o.flying) || (Boolean(o.pathfinder) && t === 'water');
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
    // A gate is see-through BARS (not in blocksSight) — but a physical bolt still strikes the iron,
    // so a turret's shot is stopped by a gate even though the eye and the fog are not. Trees already
    // stop the ray (they block sight); the gate is the one thing sight and shot part ways on.
    let blocked = projectile ? (blocksSight(terrain) || terrain === 'gate') : !standableFor(terrain, o);
    // A lava-averse phaser (a non-immune Phasing boss) shuns a burning wall-torch, so it reads as
    // solid to that mover even though it could otherwise slip through the wall.
    if (!blocked && o.torchAverse && terrain === 'wall' && hasTorch(state, nx, ny)) blocked = true;
    if (projectile && blocked) {
      // A bolt stops AT opaque cover and never reaches anything behind it — but a unit standing IN
      // that cover is on its NEAR face, and the bolt gets there first. That is the phased king
      // embedded in a wall: nothing is in the way, so a turret can shoot him exactly as a slider can
      // reach out and strike him. Without this the ray died one tile short of him and every gun on
      // the board read "no target" while he stood in plain view of it.
      if (unitAt(nx, ny) && isTarget(nx, ny) && groundUsed < maxGround) {
        stops.push({ x: nx, y: ny, capture: true, embedded: true });
      }
      break;
    }
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
    if (blocked) {
      // THREAT MAP only: the tile is not standable for THIS mover, but if the KING could stand there
      // (a Pathfinder king on a pit/tree, a phaser in stone), a slider can still slide onto it to
      // CAPTURE him — so mark it a reachable capture endpoint. It never lets the ray continue past.
      if (o.captureBlocked && o.captureBlocked(nx, ny) && groundUsed < maxGround) {
        stops.push({ x: nx, y: ny, capture: true, embedded: true });
      }
      break; // empty non-standable terrain stops the slide
    }
    if (!projectile && isSlowTerrain(terrain) && !ignoresSlow(terrain) && slowUsed >= 1) break; // one water/lava tile / move
    if (groundUsed >= maxGround) break; // out of range
    groundUsed += 1;
    if (!projectile && isSlowTerrain(terrain) && !ignoresSlow(terrain)) slowUsed += 1;
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
  const flying = Boolean(opts && opts.flying); // a Flying boss — may alight on lava AND pits
  const pathfinder = Boolean(opts && opts.pathfinder); // Pathfinder (Druid) — alights on pits and in timber, never lava
  const targets = [];
  for (const [dx, dy] of KNIGHT_STEPS) {
    const x = fromX + dx;
    const y = fromY + dy;
    if (x < 0 || x >= WORLD_SIZE || y < 0 || y >= WORLD_SIZE) {
      continue;
    }
    const terrain = terrainAt(state, x, y);
    if (terrain === 'lava' && !flying) continue; // never land in lava unless FLYING — Pathfinder gets no lava pass
    if (terrain === 'pit' && !flying && !pathfinder) continue; // a pit swallows all but a Flying/Pathfinder lander
    const unit = unitAt(x, y);
    if (unit && !isTarget(x, y)) {
      continue; // Friendly piece in the way.
    }
    const capHere = Boolean(unit); // a capturable foe on the landing tile (passed the filter above)
    if (opts && opts.torchAverse && terrain === 'wall' && hasTorch(state, x, y)) {
      continue; // a lava-averse phaser never pounces into a burning wall-torch
    }
    if (isSolidBarrier(terrain)) {
      // Can't land on stone, timber or iron — UNLESS a phasing leaper pounces onto a foe embedded
      // there, OR a PATHFINDER alights in TIMBER (it walks through trees). A boulder is NOT in this
      // class: the impact crushes it flat, a fine landing (and ice is perched on, below).
      if (!(phaseWalls && capHere) && !(terrain === 'tree' && pathfinder)) continue;
    } else if (terrain === 'ice') {
      // Empty ice is a fine landing — a jumper PERCHES on the slab without breaking it (only fire
      // thaws it, a slam shatters it). But a foe EMBEDDED in ice may only be pounced on by a phaser.
      if (capHere && !phaseWalls) continue;
    }
    // A wall CAGES the leap only on its LONG axis — the two-tile direction the knight travels
    // through first, exactly as a xiangqi horse is hobbled by the piece on its "leg". A wall off the
    // perpendicular SHORT-axis shoulder does NOT block it: the leap arcs clear of that side. Blocking
    // on both shoulders caged leaps that plainly had a clear path — the "a nightrider a knight's-move
    // away can't reach me" bug — and it cages the king's own leap cards the same wrong way.
    if (!phaseWalls) {
      // A WALL or a GATE on the xiangqi-horse "leg" (the long-axis first step) is the one thing a leap
      // cannot vault — solid stone or barred iron hobbles the horse. Everything else it clears: timber,
      // boulders, water, lava, pits, ice, other pieces. (A short-axis shoulder does not cage take-off.)
      const legT = Math.abs(dx) === 2 ? terrainAt(state, fromX + Math.sign(dx), fromY) : terrainAt(state, fromX, fromY + Math.sign(dy));
      if (legT === 'wall' || legT === 'gate') continue;
    }
    targets.push({ x, y, viaJump: true, capture: capHere });
  }
  return targets;
}

// A RIDER that repeats one leap: it keeps taking the SAME hop outward — leaping clean over whatever
// lies between each pair of legs — until something halts the ride. Every square along the way is a
// landing square, so an occupied or unlandable one stops it THERE (a body halts the ride whether it
// can be captured or not). Landing rules per leg match jumpTargets, but the SHOULDER rule applies to
// the launch only: the first leg is exactly a knight's leap (walls still cage it taking off), and
// once airborne nothing halts it bar a landing it cannot make. Checking shoulders every leg instead
// compounds absurdly — a four-leg ride would need eight clear shoulders, and measured on real floors
// the piece collapsed below a plain knight.
function riderLeapTargets(state, fromX, fromY, steps, unitAt, isTarget, opts) {
  const phaseWalls = Boolean(opts && opts.phaseWalls);
  const flying = Boolean(opts && opts.flying);
  const pathfinder = Boolean(opts && opts.pathfinder); // an Animal-Form unicorn on a Pathfinder Druid rides through timber/pits
  const torchAverse = Boolean(opts && opts.torchAverse);
  const targets = [];
  for (const [dx, dy] of steps) {
    let px = fromX;
    let py = fromY;
    for (let leg = 0; leg < WORLD_SIZE; leg += 1) {
      // Shoulder rule on the LAUNCH leg only, and only on the LONG axis (the xiangqi-horse "leg") —
      // a wall off the perpendicular short-axis shoulder does not cage the take-off. (Blocking both
      // shoulders wrongly stranded a nightrider a knight's-move from the king behind a side wall.)
      if (leg === 0 && !phaseWalls) {
        // A WALL or GATE on the launch leg hobbles the take-off (see jumpTargets); nothing else does.
        const legT = Math.abs(dx) === 2 ? terrainAt(state, px + Math.sign(dx), py) : terrainAt(state, px, py + Math.sign(dy));
        if (legT === 'wall' || legT === 'gate') break;
      }
      const x = px + dx;
      const y = py + dy;
      if (x < 0 || x >= WORLD_SIZE || y < 0 || y >= WORLD_SIZE) break;
      const terrain = terrainAt(state, x, y);
      if (terrain === 'lava' && !flying) break; // lava halts the ride for all but a Flying mover
      if (terrain === 'pit' && !flying && !pathfinder) break; // a pit halts it bar Flying / Pathfinder
      const unit = unitAt(x, y);
      const capHere = Boolean(unit) && isTarget(x, y);
      if (torchAverse && terrain === 'wall' && hasTorch(state, x, y)) break;
      if (isSolidBarrier(terrain)) {
        // A Pathfinder rides THROUGH timber; otherwise stone, timber and iron all halt the ride.
        if (!(phaseWalls && capHere) && !(terrain === 'tree' && pathfinder)) break;
      } else if (terrain === 'ice' && capHere && !phaseWalls) {
        break;
      }
      if (unit) {
        if (capHere) targets.push({ x, y, viaJump: true, capture: true });
        break; // a body — friend or foe — halts the ride here
      }
      targets.push({ x, y, viaJump: true, capture: false });
      px = x;
      py = y;
    }
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
    if (isSolidBarrier(terrain) || terrain === 'lava' || terrain === 'pit') {
      continue; // can't land on stone/timber/iron, in lava, or in a bottomless pit (a boulder IS landable — a leaper crushes it)
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

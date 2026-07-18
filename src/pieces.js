// Chess-piece movement, expressed in terms of the terrain-aware slide / jump
// primitives in terrain.js.

// A blocker lookup for an enemy piece: the king is a capture target, other
// enemies merely block.
function enemyUnitAt(state, piece) {
  return (x, y) => {
    if (x === state.player.x && y === state.player.y) {
      return 'player';
    }
    if (keyTileAt(state, x, y)) {
      return 'key'; // the floor key blocks enemies — they can never stop on it
    }
    const ally = allyAt(state, x, y);
    if (ally) return ally; // an ally blocks the enemy (and may be captured — see getPieceMoves)
    return state.enemies.find((other) => other.id !== piece.id && other.x === x && other.y === y) || null;
  };
}

// Core move generator: every tile a piece of `kind` standing at (fromX, fromY)
// could move onto, given a `unitAt` blocker lookup and an `isTarget` test for
// which occupied tiles may be captured (and thus moved onto). Shared by enemy
// pieces (target = the king) and the king's own cards (targets = enemies).
function generateMoves(kind, state, fromX, fromY, unitAt, isTarget, opts) {
  const moves = [];

  const slide = (directions, maxGround) => {
    for (const [dx, dy] of directions) {
      for (const stop of slideStops(state, fromX, fromY, dx, dy, maxGround, unitAt, isTarget, opts)) {
        moves.push(stop);
      }
    }
  };

  switch (kind) {
    case 'rook':
      slide(ORTHO, Infinity);
      break;
    case 'bishop':
      slide(DIAG, Infinity);
      break;
    case 'queen':
      slide([...ORTHO, ...DIAG], Infinity);
      break;
    case 'king':
    case 'mann': // a MANN is a non-royal king: one step any direction
      slide([...ORTHO, ...DIAG], 1);
      break;
    case 'knight':
      for (const target of jumpTargets(state, fromX, fromY, unitAt, isTarget, opts)) {
        moves.push(target);
      }
      break;
    case 'nightrider':
      // A knight that KEEPS GOING: it repeats its leap outward in a line until a body or a wall
      // halts it. Long reach along eight knight-bearings — but no adjacent attack at all, so the
      // one place it cannot touch you is right beside it.
      for (const target of riderLeapTargets(state, fromX, fromY, KNIGHT_STEPS, unitAt, isTarget, opts)) {
        moves.push(target);
      }
      break;
    case 'archbishop':
      // Bishop + knight.
      slide(DIAG, Infinity);
      for (const target of jumpTargets(state, fromX, fromY, unitAt, isTarget, opts)) {
        moves.push(target);
      }
      break;
    case 'chancellor':
      // Rook + knight.
      slide(ORTHO, Infinity);
      for (const target of jumpTargets(state, fromX, fromY, unitAt, isTarget, opts)) {
        moves.push(target);
      }
      break;
    case 'amazon':
      // Queen + knight.
      slide([...ORTHO, ...DIAG], Infinity);
      for (const target of jumpTargets(state, fromX, fromY, unitAt, isTarget, opts)) {
        moves.push(target);
      }
      break;
    case 'unicorn':
      // Bishop + nightrider — the Ranger's Animal Form: it glides the diagonals AND rides the
      // knight-bearings outward in a line until a body or a wall halts it.
      slide(DIAG, Infinity);
      for (const target of riderLeapTargets(state, fromX, fromY, KNIGHT_STEPS, unitAt, isTarget, opts)) {
        moves.push(target);
      }
      break;
    case 'vampiress':
      // The Necromancer's risen familiar: a QUEEN. She was a king-plus-knight ("General"); as a
      // queen she is a real threat on an open floor, which is the point of feeding her.
      slide([...ORTHO, ...DIAG], Infinity);
      break;
    case 'berolina':
      // The pawn's mirror: steps diagonally onto empty ground...
      for (const [dx, dy] of DIAG) {
        for (const stop of slideStops(state, fromX, fromY, dx, dy, 1, unitAt, () => false)) {
          moves.push(stop);
        }
      }
      // ...and captures straight ahead (any cardinal).
      for (const [dx, dy] of ORTHO) {
        const x = fromX + dx;
        const y = fromY + dy;
        if (isTarget(x, y)) {
          moves.push({ x, y, capture: true });
        }
      }
      break;
    case 'ferz':
      // A ferz steps (and captures) exactly one square DIAGONALLY — a weak, short-range piece
      // (what the Hexer's curse warps foes into). It is NOT demonic.
      slide(DIAG, 1);
      break;
    case 'pawn':
    default:
      // Cardinal steps onto empty ground (never a straight capture)...
      for (const [dx, dy] of ORTHO) {
        for (const stop of slideStops(state, fromX, fromY, dx, dy, 1, unitAt, () => false)) {
          moves.push(stop);
        }
      }
      // ...and a diagonal capture only.
      for (const [dx, dy] of DIAG) {
        const x = fromX + dx;
        const y = fromY + dy;
        if (isTarget(x, y)) {
          moves.push({ x, y, capture: true });
        }
      }
      break;
  }

  return moves;
}

// Every tile this enemy piece could legally move onto next turn. Targets the king.
// Enemies may walk over lava.
function getPieceMoves(piece, state) {
  const unitAt = enemyUnitAt(state, piece);
  // Enemies may capture the king OR an ally (movement AI prefers the king; see meleeMove).
  const isTarget = (x, y) => (x === state.player.x && y === state.player.y) || Boolean(allyAt(state, x, y));
  return generateMoves(piece.kind, state, piece.x, piece.y, unitAt, isTarget, pieceTerrainOpts(piece));
}

// Terrain opts for an enemy's move/threat generation — normally "wade lava", but the
// Flying boss trait crosses pits/water/lava freely and Phasing moves through walls/boulders.
function pieceTerrainOpts(piece) {
  // Only a piece that SURVIVES fire will walk into it. Anything else routes around lava rather than
  // immolating itself to reach the king (isLavaSafe is the same predicate tickLavaDamage burns by).
  // Pits need no rule here: standableFor already bars everything but a flier.
  const opts = { lavaOk: isLavaSafe(piece) };
  if (bossHas(piece, 'flying')) { opts.flying = true; opts.terrainImmune = true; }
  if (bossHas(piece, 'phasing')) {
    opts.phaseWalls = true;
    if (!isLavaSafe(piece)) opts.torchAverse = true; // a non-immune phaser routes around burning wall-torches
  }
  if (bossHas(piece, 'burrower')) opts.pitOk = true; // a Burrower treads the void as solid ground
  return opts;
}

// The straight-line directions a card kind slides/casts along (empty for a pure
// leaper). Pawn cards capture diagonally.
// How far a piece's LINE actually runs — the same reach generateMoves gives its slides.
//
// Volley and Sorcerer only change WHAT HAPPENS when a piece strikes along its normal pattern; the
// bolt can never outrange the piece. bossRangedAttack used to walk its ray to the edge of the WORLD
// while only checking the DIRECTION, so a king boss — whose "line" is a single step — shot the king
// from clean across the floor. And the threat map, which reads the piece's real pattern, quite
// correctly painted that tile safe. One cause, two bugs: a shot that cannot happen, on a tile that
// promised it could not.
function pieceLineReach(kind) {
  switch (kind) {
    case 'rook': case 'bishop': case 'queen':
    case 'archbishop': case 'chancellor': case 'amazon': case 'vampiress':
      return Infinity; // true sliders: the line runs until something stops it
    case 'king': case 'mann': case 'pawn': case 'berolina':
      return 1; // one step is not a line
    default:
      return 0; // leapers have no line at all
  }
}

// Can this kind loose bolts down a line at all? On anything else Volley/Sorcerer are dead slots —
// and worse than dead, since they turned a melee piece into an artillery battery.
function hasFiringLine(kind) {
  return cardSlideDirs(kind).length > 0 && pieceLineReach(kind) > 1;
}

function cardSlideDirs(kind) {
  switch (kind) {
    case 'king':
    case 'queen':
    case 'amazon':
    case 'fireball': // the Conjurer's Fireball: hurled along any queen line
    case 'doublestep': // the Cavalier's dash: any of the 8 directions
      return [...ORTHO, ...DIAG];
    case 'bishop':
    case 'archbishop':
      return [...DIAG];
    case 'rook':
    case 'chancellor':
      return [...ORTHO];
    case 'pawn':
      return [...DIAG];
    default:
      return []; // knight: a pure leaper
  }
}

// The three tiles a knight's-move (dx,dy) traces as an L from (kx,ky): two steps along the
// MAJOR axis (the one with offset 2), then one along the minor — ending on the destination.
// Shared by the Conjuration horse spell (aim + AOE) so its move-gen and resolution agree.
// The TWO L-paths a knight's move can trace: turning at the far corner, or at the near one. A real
// knight does not care — it LEAPS, and what lies between is irrelevant. The spectral steed does
// care: it tramples every square it crosses, so which way round it goes decides what it hits.
function knightLPaths(kx, ky, dx, dy) {
  const sx = Math.sign(dx);
  const sy = Math.sign(dy);
  if (Math.abs(dx) === 2) {
    return [
      [{ x: kx + sx, y: ky }, { x: kx + 2 * sx, y: ky }, { x: kx + 2 * sx, y: ky + sy }], // along the 2 first
      [{ x: kx, y: ky + sy }, { x: kx + sx, y: ky + sy }, { x: kx + 2 * sx, y: ky + sy }], // the 1 first
    ];
  }
  return [
    [{ x: kx, y: ky + sy }, { x: kx, y: ky + 2 * sy }, { x: kx + sx, y: ky + 2 * sy }], // along the 2 first
    [{ x: kx + sx, y: ky }, { x: kx + sx, y: ky + sy }, { x: kx + sx, y: ky + 2 * sy }], // the 1 first
  ];
}

// A tile the spectral steed's charge would actually DO something to: a foe it can trample (a
// capturable enemy in sight) OR a terrain feature its spellfire acts on — timber it lights, ice it
// thaws, grass it withers, a boulder it blasts. Fire reaching a tree is exactly as valid a target as
// fire reaching a foe, so the aim overlay and the path-picking both weigh the two the same.
function steedActsOn(state, x, y) {
  if (!inLineOfSight(state, x, y)) return false;
  const e = (state.enemies || []).find((en) => en.x === x && en.y === y);
  if (e && isCapturable(state, e)) return true;
  const t = terrainAt(state, x, y);
  return t === 'tree' || t === 'ice' || t === 'devilgrass' || t === 'boulder';
}

// The way the steed ACTUALLY goes: whichever of the two tramples more foes (or terrain it can burn).
//
// It always took the long axis first, so a charge that could have caught two foes by turning at the
// near corner instead simply missed both — and the player had no way to ask for the other path. The
// aim overlay, the targeting and the resolution all read THIS, so the preview cannot promise one
// path and the cast take the other.
//
// Ties go to the first (long-axis-first) path, so the choice is deterministic and the preview is
// always what happens.
function knightLPath(kx, ky, dx, dy, state) {
  const paths = knightLPaths(kx, ky, dx, dy);
  if (!state) return paths[0];
  const score = (lpath) => lpath.reduce((n, t) => n + (steedActsOn(state, t.x, t.y) ? 1 : 0), 0);
  return score(paths[1]) > score(paths[0]) ? paths[1] : paths[0];
}

// The enemy tiles a weapon card may strike from the king's square. Behaviour turns
// on the card's category:
//   melee  - the king physically moves onto the target (real movement rules).
//   ranged - a projectile: rays fly over terrain, stopped only by walls, and are
//            BLOCKED by the first unit in the way.
//   spell  - a bolt that pierces EVERY unit on its path (ignores obstructions).
// Leaps ignore whatever they jump over. Steppers/knights reach 1, sliders reach 3
// (+ a Farsight perk). Targets must be in sight. The category comes from the
// player's class, not the card.
function getCardMoves(state, card) {
  const p = state.player;
  const kind = card.kind;
  // If he cannot wield this card at all — wading, or roaming as the warhorse — it reaches nothing.
  //
  // This used to hand back a full set of targets for a weapon the king was wading and could not
  // possibly swing: useCard refused every one of them. So the aim overlay lit up tiles the game had
  // no intention of honouring, and the player could press a hotkey, pick a lit square and be told
  // no. (Measured: 2,267 targets offered for cards useCard rejects, across 40 runs.) The generator
  // and the resolver have to agree about what is legal, and the resolver is right.
  if (typeof cardUnusableReason === 'function' && cardUnusableReason(state, card)) return [];
  const category = classCategory(p.className);
  const reach = cardReach(kind, p.cardReach || 0);
  const dirs = cardSlideDirs(kind);
  const hasLeap = isJumperKind(kind);
  const pierce = category === 'spell';
  const enemyAt = (x, y) => state.enemies.find((e) => e.x === x && e.y === y) || null;
  const inBounds = (x, y) => x >= 0 && x < WORLD_SIZE && y >= 0 && y < WORLD_SIZE;
  const targetable = (x, y) => isCapturable(state, enemyAt(x, y));
  const results = [];
  // NB: like getPlayerMoves' add, this REBUILDS the move rather than passing it through, so every
  // flag must be named here or it is silently dropped on the floor.
  const add = (x, y, viaJump, capture, embedded, chop) => {
    if (inLineOfSight(state, x, y)) results.push({ x, y, capture: Boolean(capture), viaJump: Boolean(viaJump), embedded: Boolean(embedded), chop: Boolean(chop) });
  };

  // Self-cast ability cards (Promotion, Reload) target the king's own tile — there is
  // no foe to aim at, so selecting his square activates them.
  if (kind === 'promotion' || kind === 'reload' || kind === 'blink' || kind === 'silence' || kind === 'confuse') {
    return [{ x: p.x, y: p.y, capture: false, viaJump: false, self: true }];
  }
  // Displacement (swap) can target ANY unit in sight — enemies and turrets alike.
  if (kind === 'swap') {
    const out = [];
    for (const e of state.enemies) {
      if (inLineOfSight(state, e.x, e.y)) out.push({ x: e.x, y: e.y, capture: false, viaJump: false, swap: true });
    }
    return out;
  }
  // Banish targets like Displacement — anything in sight — minus what cannot be shifted at all.
  if (kind === 'banish') {
    const out = [];
    for (const e of state.enemies) {
      if (!isBanishable(e)) continue;
      if (inLineOfSight(state, e.x, e.y)) out.push({ x: e.x, y: e.y, capture: false, viaJump: false, banish: true });
    }
    return out;
  }

  // The Conjuration horse: aim at a knight's-move tile in SIGHT; casting tramples the L-path to
  // it, scorching every foe along the way (it never moves the king). A knight tile is offered
  // when any tile on its L holds a targetable foe. Reuses the spell aiming overlay.
  if (kind === 'horse') {
    const out = [];
    for (const [dx, dy] of KNIGHT_STEPS) {
      const ex = p.x + dx;
      const ey = p.y + dy;
      if (!inBounds(ex, ey)) continue;
      const lpath = knightLPath(p.x, p.y, dx, dy, state);
      // What matters is whether a foe stands ANYWHERE on the L the steed tramples, and whether the
      // king can SEE that foe. The aimed knight tile is only where he points.
      //
      // This used to demand line of sight to the ENDPOINT, which threw away perfectly good charges:
      // a foe one step along the L was untargetable whenever the tile BEYOND it happened to be out
      // of view or behind cover — so the direction vanished from the aim overlay, and with it the
      // AOE preview of the path.
      const hits = lpath.some((t) => inBounds(t.x, t.y) && steedActsOn(state, t.x, t.y));
      if (hits) out.push({ x: ex, y: ey, capture: true, viaJump: false });
    }
    return out;
  }

  if (kind === 'enpassant') {
    // En Passant: step ONE square in any direction (capturing a foe on that tile, or
    // repositioning onto empty ground) AND strike one foe "in passing" — a piece that
    // was adjacent to the ORIGIN square (never the tile you step onto). `flanks` carries
    // that one in-passing target so the renderer can mark it while aiming.
    for (const [dx, dy] of [...ORTHO, ...DIAG]) {
      const ex = p.x + dx;
      const ey = p.y + dy;
      if (!inBounds(ex, ey)) continue;
      const destT = terrainAt(state, ex, ey);
      if (destT === 'wall' || destT === 'pit' || destT === 'boulder') continue; // can't step into a wall/pit/boulder (lava is walkable, at a cost)
      const foe = enemyAt(ex, ey);
      if (foe && !targetable(ex, ey)) continue; // blocked by an untouchable unit
      let passing = null;
      for (const [ax, ay] of [...ORTHO, ...DIAG]) {
        const px = p.x + ax;
        const py = p.y + ay;
        if (px === ex && py === ey) continue; // not the tile stepped onto
        if (targetable(px, py)) { passing = { x: px, y: py }; break; }
      }
      if (inLineOfSight(state, ex, ey)) results.push({ x: ex, y: ey, capture: Boolean(foe), viaJump: false, flanks: passing ? [passing] : [] });
    }
  } else if (category === 'melee') {
    // The king walks/leaps onto a foe (a capture) OR onto empty ground within reach
    // (a plain repositioning move) — real movement rules apply either way.
    const opts = { terrainImmune: Boolean(p.terrainImmune), flying: Boolean(p.terrainImmune) };
    for (const [dx, dy] of dirs) {
      for (const stop of slideStops(state, p.x, p.y, dx, dy, reach, enemyAt, targetable, opts)) {
        // Double Step has its OWN generator (below) — it is two steps, not a slide.
        if (kind === 'doublestep') continue;
        add(stop.x, stop.y, false, stop.capture, stop.embedded);
      }
      // DOUBLE STEP: two steps in ONE direction, and either of them may be a blow.
      //
      // It used to demand a destination exactly two tiles off and reject everything else, which
      // meant a foe standing at step ONE deleted the whole direction — the dash could not cut
      // through it and come out the far side, which is the only thing a charge is FOR. And an
      // adjacent boss could not be charged at all, so the card was dead in exactly the moment it
      // should shine.
      //
      // Now: whatever survives step one ends the charge THERE and eats both blows; whatever dies to
      // it is trampled and he carries on into step two.
      if (kind === 'doublestep') {
        const bx = p.x + dx;
        const by = p.y + dy;
        const cx = p.x + dx * 2;
        const cy = p.y + dy * 2;
        if (!inBounds(bx, by)) continue;
        const t1 = terrainAt(state, bx, by);
        const foe1 = enemyAt(bx, by);
        // A boulder in the way is CHARGED — the running shove rolls it two tiles.
        if (t1 === 'boulder') {
          if (inLineOfSight(state, bx, by)) results.push({ x: bx, y: by, capture: false, viaJump: false, push: true });
          continue; // the rock owns this direction
        }
        // Timber takes the charge and stops it — for two wounds, not one.
        if (isChoppable(t1)) {
          if (inLineOfSight(state, bx, by)) results.push({ x: bx, y: by, capture: false, viaJump: false, chop: true });
          continue;
        }
        // Something that will SURVIVE a blow (a guardian, a turret) halts the charge on its own
        // tile — and takes both of them.
        if (foe1 && targetable(bx, by)) {
          const survives = Boolean(foe1.boss || foe1.turret || foe1.parry); // a warded foe soaks the first hoof
          if (survives) { add(bx, by, false, true); continue; }
          // ...otherwise he tramples it and keeps going. The far tile is the destination.
        } else if (foe1 || !standableFor(t1, opts)) {
          continue; // an ally, a wall: the direction is shut
        }
        if (!inBounds(cx, cy)) continue;
        const t2 = terrainAt(state, cx, cy);
        const foe2 = enemyAt(cx, cy);
        if (foe2 && !targetable(cx, cy)) continue; // his own piece at the end of it
        // TIMBER at step two: the charge barrels through the open near tile and bites into the tree
        // (or gate) beyond for two wounds, rebounding beside it — the same as charging one at step one,
        // just reached across the clear tile in front of it.
        if (!foe2 && isChoppable(t2)) {
          if (inLineOfSight(state, cx, cy)) results.push({ x: cx, y: cy, capture: false, viaJump: false, chop: true });
          continue;
        }
        if (!foe2 && !standableFor(t2, opts)) continue; // nowhere to land
        // The charge COMMITS to a direction and barrels THROUGH step one — so the landing is offered
        // even when step one is a sight-blocker (a bush/devilgrass) that hides the far tile. Pushing
        // straight past `add()` here bypasses its line-of-sight gate, which would otherwise delete the
        // whole dash the moment a bush stood in front of it (and let a foe lurking behind get charged).
        results.push({ x: cx, y: cy, capture: Boolean(foe2), viaJump: false, embedded: false, chop: false });
      }
    }
    if (hasLeap) {
      for (const [dx, dy] of KNIGHT_STEPS) {
        const x = p.x + dx;
        const y = p.y + dy;
        if (!inBounds(x, y)) continue;
        const t = terrainAt(state, x, y);
        const phases = Boolean(p.phase);
        const flies = Boolean(p.terrainImmune); // Fairy Wings: alight on lava/pits with no ill effect
        if (t === 'wall' && !phases) continue; // can't land in a wall (unless phasing)
        if (t === 'pit' && !phases && !flies) continue; // can't land in a pit (unless phasing/flying)
        // TIMBER and IRON are not landing squares. The leap is still offered — but as a STRIKE: he
        // springs at the tree, buries the blade and rebounds to where he came from, exactly as he
        // does against a boss that shrugs off the blow. He must never come down on top of a tree,
        // and certainly never sail clean through to the far side of it.
        if (isChoppable(t) && !phases) {
          if (!enemyAt(x, y)) add(x, y, true, false, false, true);
          continue;
        }
        if (enemyAt(x, y)) {
          // A foe embedded in a wall/ice can't be POUNCED on unless the king also phases.
          if (targetable(x, y) && (phases || (t !== 'wall' && t !== 'ice'))) add(x, y, true, true);
        } else if (t !== 'wall' || phases) {
          add(x, y, true, false); // leap to empty ground / ice (crushing a boulder, shattering ice)
        }
      }
    }
  } else {
    // ranged / spell: projectile rays over terrain, stopped only by walls (Sixth Sense flies
    // over). Only foes are valid targets — never summoning circles (a missile passes over a
    // circle without dispelling it; you must step or be shoved onto it).
    const shootWalls = Boolean(p.seeThroughWalls); // Sixth Sense: shots fly over walls
    const missileTarget = (x, y) => {
      const e = enemyAt(x, y);
      return Boolean(e) && isCapturable(state, e) && !e.summonCircle;
    };
    if (pierce) {
      // SORCERER: a piercing bolt ALWAYS travels its full range. He aims the END of a firing line, not
      // a body on it — and any line with SOMETHING to affect is a valid aim: a foe, or terrain the
      // fire changes (it melts ICE, lights a TREE, blasts a BOULDER, scorches DEVILGRASS). The
      // endpoints where the bolt STOPS (ice / tree / boulder) are aimable tiles in their own right, so
      // a mage can deliberately thaw an ice slab or torch a tree even with no foe on the line. This
      // now mirrors the resolution exactly — it used to sail PAST ice/trees offering tiles the bolt
      // could never reach, and offered nothing when only terrain (not a foe) stood in the way.
      for (const [dx, dy] of dirs) {
        let x = p.x;
        let y = p.y;
        let far = null; // farthest VISIBLE tile the bolt reaches in this direction (the aim point)
        let worth = false; // is there anything on this line the bolt would affect?
        for (let i = 0; i < reach; i += 1) {
          x += dx;
          y += dy;
          if (!inBounds(x, y)) break;
          const t = terrainAt(state, x, y);
          if (t === 'ice' || t === 'tree') { if (inLineOfSight(state, x, y)) { far = { x, y }; worth = true; } break; } // thawed / lit — the bolt stops and this is a valid endpoint
          if (t === 'wall' && !shootWalls) break; // opaque cover stops the bolt short of this tile
          if (t === 'boulder' && !shootWalls) { if (inLineOfSight(state, x, y)) { far = { x, y }; worth = true; } break; } // blasted to rubble; stops here
          if (inLineOfSight(state, x, y)) far = { x, y }; // can only AIM a tile he can see; max range is capped by sight
          if (t === 'devilgrass') worth = true; // the fire scorches the thicket away and rages on
          if (missileTarget(x, y)) worth = true;
        }
        if (far && worth) {
          results.push({ x: far.x, y: far.y, capture: Boolean(missileTarget(far.x, far.y)), viaJump: false });
        }
      }
    } else {
      // RANGED: a single arrow to the FIRST foe it can reach (blocked by the first body / wall).
      for (const [dx, dy] of dirs) {
        let x = p.x;
        let y = p.y;
        for (let i = 0; i < reach; i += 1) {
          x += dx;
          y += dy;
          if (!inBounds(x, y)) break;
          const t = terrainAt(state, x, y);
          if ((t === 'wall' || t === 'boulder') && !shootWalls) break;
          if (enemyAt(x, y)) {
            if (missileTarget(x, y)) add(x, y, false, true);
            break; // a solid unit (including a circle) blocks a non-piercing shot
          }
        }
      }
    }
    if (hasLeap) {
      for (const [dx, dy] of KNIGHT_STEPS) {
        const x = p.x + dx;
        const y = p.y + dy;
        if (!inBounds(x, y) || terrainAt(state, x, y) === 'wall') continue;
        if (enemyAt(x, y) && targetable(x, y)) add(x, y, true, true);
      }
    }
  }

  const seen = new Set();
  return results.filter((m) => {
    const key = `${m.x},${m.y}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// The squares immediately adjacent (in the given directions) a piece threatens —
// used for pawn-likes, whose capture squares differ from their move squares. With
// `includeOccupied` (the danger overlay), an ally-occupied square STILL counts as
// threatened — because if the king captures that ally and stands there, this piece
// can capture him next turn.
function adjacentThreats(piece, state, dirs, includeOccupied) {
  const threats = [];
  for (const [dx, dy] of dirs) {
    const x = piece.x + dx;
    const y = piece.y + dy;
    if (x < 0 || x >= state.worldSize || y < 0 || y >= state.worldSize) {
      continue;
    }
    if (!isStandable(terrainAt(state, x, y))) {
      continue;
    }
    if (!includeOccupied && state.enemies.some((other) => other.id !== piece.id && other.x === x && other.y === y)) {
      continue;
    }
    threats.push({ x, y });
  }
  return threats;
}

// Tiles where this piece could capture the king — the squares dangerous to stand
// on (the red threat tint). Pawn-likes capture differently than they move: a pawn
// attacks the diagonals, the berolina attacks the orthogonals. Everything else
// threatens exactly where it can move. With `includeOccupied` (the danger overlay),
// an ally-occupied square still counts as threatened — because the king may CAPTURE
// that ally and stand there, exposing himself to this piece next turn.
function getPieceThreats(piece, state, includeOccupied) {
  if (piece.summonCircle) {
    return []; // a summoning circle never strikes the king directly
  }
  if (piece.kind === 'pawn') {
    return adjacentThreats(piece, state, DIAG, includeOccupied);
  }
  if (piece.kind === 'berolina') {
    return adjacentThreats(piece, state, ORTHO, includeOccupied);
  }
  // A PIERCING line: a fire turret's spellfire, or a SORCERER guardian's bolt. Both hurl through
  // bodies, so their reach is not the piece's move pattern (which stops at the first thing in the
  // way) — it is the whole line out to the first wall. The map has to show that, or a Sorcerer's
  // lane past its own minions reads safe right up until the bolt comes through them.
  //
  // Bounded by the piece's own line reach, which is what keeps the trait honest: a bolt travels the
  // piece's line and no further.
  const piercing = (piece.turret && piece.fire)
    || (typeof bossHas === 'function' && bossHas(piece, 'sorcerer') && hasFiringLine(piece.kind));
  if (piercing) {
    const tiles = [];
    const reach = piece.turret ? Infinity : pieceLineReach(piece.kind);
    for (const [dx, dy] of cardSlideDirs(piece.kind)) {
      let x = piece.x + dx;
      let y = piece.y + dy;
      let step = 0;
      while (x >= 0 && x < WORLD_SIZE && y >= 0 && y < WORLD_SIZE && ++step <= reach) {
        const t = terrainAt(state, x, y);
        if (t === 'wall' || t === 'boulder') break;
        tiles.push({ x, y });
        x += dx;
        y += dy;
      }
    }
    // A sorcerer guardian can still MOVE and strike as its piece normally does — the bolt is an
    // extra way to reach him, not a replacement for its legs.
    if (!piece.turret) {
      const unitAt2 = enemyUnitAt(state, piece);
      const isTarget2 = () => true;
      for (const m of generateMoves(piece.kind, state, piece.x, piece.y, unitAt2, isTarget2, pieceTerrainOpts(piece))) {
        if (!tiles.some((t) => t.x === m.x && t.y === m.y)) tiles.push({ x: m.x, y: m.y });
      }
    }
    return tiles;
  }
  const unitAt = enemyUnitAt(state, piece);
  // With `includeOccupied` every occupied square (king OR another enemy) counts as a target,
  // so sliders threaten the tiles their allies sit on too.
  const isTarget = includeOccupied
    ? (x, y) => (x === state.player.x && y === state.player.y) || state.enemies.some((o) => o.id !== piece.id && o.x === x && o.y === y)
    : (x, y) => (x === state.player.x && y === state.player.y) || Boolean(allyAt(state, x, y));
  // A TURRET fires a projectile (crossing pits / lava / water, stopped only by walls,
  // boulders, and the unit it hits); a mobile piece threatens where it can MOVE.
  const opts = piece.turret ? { projectile: true } : pieceTerrainOpts(piece);
  return generateMoves(piece.kind, state, piece.x, piece.y, unitAt, isTarget, opts);
}

// Standard pieces use solid chess glyphs; the fairy / endgame pieces use a single
// mnemonic letter so they read clearly on the colored tokens.
function getPieceLabel(kind) {
  const labels = {
    king: '♚',
    pawn: '♟',
    rook: '♜',
    bishop: '♝',
    knight: '♞',
    queen: '♛',
    mann: '☠', // the Necromancer's risen familiar — a SKULL. It is a mann (a non-royal king) by its
    // moves, but it must never wear the king's silhouette: the one token on the board the player
    // must find at a glance is his own, and a second crowned head standing beside him is the one
    // thing guaranteed to cost him that glance.
    berolina: 'B', // berolina pawn
    nightrider: 'N', // a knight's leap, repeated outward in a line
    ferz: '♗', // a ferz (1-step diagonal mover) — the Hexer's confused-foe form
    vampiress: '♛', // the Necromancer's risen familiar — a queen that feeds on what she fells
    archbishop: 'A', // bishop + knight
    chancellor: 'M', // rook + knight (a.k.a. marshall)
    amazon: 'Z', // queen + knight (the final boss)
    enpassant: '♙', // the Duellist's en-passant dash card
    doublestep: '»', // the Cavalier's two-tile dash card
    horse: '♞', // the Conjuration steed: an L-shaped AOE spell (does NOT move the king)
    promotion: '♞', // the Ranger's Animal Form (unicorn) card
    reload: '⟳', // the Ranger's Reload card
    swap: '⇄', // the Sorcerer's Displacement (swap) card
    blink: '✦', // the Sorcerer's Blink card — flicker to a safe tile
    silence: '☾', // the Gloom Stalker's Silence — the room drops asleep
    banish: '✧', // Translocations' Banish — a foe sent clean out of the world
    confuse: '๑', // the Hexer's Mass Confusion — the room forgets which side it is on
    fireball: '☄', // the Conjurer's Fireball — a queen-line bolt that bursts on impact
  };
  return labels[kind] ?? '♟';
}

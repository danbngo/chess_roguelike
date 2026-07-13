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
      slide([...ORTHO, ...DIAG], 1);
      break;
    case 'knight':
      for (const target of jumpTargets(state, fromX, fromY, unitAt, isTarget)) {
        moves.push(target);
      }
      break;
    case 'archbishop':
      // Bishop + knight.
      slide(DIAG, Infinity);
      for (const target of jumpTargets(state, fromX, fromY, unitAt, isTarget)) {
        moves.push(target);
      }
      break;
    case 'chancellor':
      // Rook + knight.
      slide(ORTHO, Infinity);
      for (const target of jumpTargets(state, fromX, fromY, unitAt, isTarget)) {
        moves.push(target);
      }
      break;
    case 'amazon':
      // Queen + knight.
      slide([...ORTHO, ...DIAG], Infinity);
      for (const target of jumpTargets(state, fromX, fromY, unitAt, isTarget)) {
        moves.push(target);
      }
      break;
    case 'general':
      // The Necromancer's upgraded familiar: a king that may also leap like a knight.
      slide([...ORTHO, ...DIAG], 1);
      for (const target of jumpTargets(state, fromX, fromY, unitAt, isTarget)) {
        moves.push(target);
      }
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
  const opts = { lavaOk: true };
  return generateMoves(piece.kind, state, piece.x, piece.y, unitAt, isTarget, opts);
}

// The straight-line directions a card kind slides/casts along (empty for a pure
// leaper). Pawn cards capture diagonally.
function cardSlideDirs(kind) {
  switch (kind) {
    case 'king':
    case 'queen':
    case 'amazon':
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
  const category = classCategory(p.className);
  const reach = cardReach(kind, p.cardReach || 0);
  const dirs = cardSlideDirs(kind);
  const hasLeap = isJumperKind(kind);
  const pierce = category === 'spell';
  const enemyAt = (x, y) => state.enemies.find((e) => e.x === x && e.y === y) || null;
  const inBounds = (x, y) => x >= 0 && x < WORLD_SIZE && y >= 0 && y < WORLD_SIZE;
  const targetable = (x, y) => isCapturable(state, enemyAt(x, y));
  const results = [];
  const add = (x, y, viaJump, capture) => {
    if (inLineOfSight(state, x, y)) results.push({ x, y, capture: Boolean(capture), viaJump: Boolean(viaJump) });
  };

  // Self-cast ability cards (Promotion, Reload) target the king's own tile — there is
  // no foe to aim at, so selecting his square activates them.
  if (kind === 'promotion' || kind === 'reload') {
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
    const opts = { terrainImmune: Boolean(p.terrainImmune) };
    for (const [dx, dy] of dirs) {
      for (const stop of slideStops(state, p.x, p.y, dx, dy, reach, enemyAt, targetable, opts)) {
        add(stop.x, stop.y, false, stop.capture);
      }
    }
    if (hasLeap) {
      for (const [dx, dy] of KNIGHT_STEPS) {
        const x = p.x + dx;
        const y = p.y + dy;
        if (!inBounds(x, y)) continue;
        const t = terrainAt(state, x, y);
        if (t === 'wall' || t === 'pit') continue; // can't land in a wall or pit (a boulder here gets crushed on landing)
        if (enemyAt(x, y)) {
          if (targetable(x, y)) add(x, y, true, true);
        } else {
          add(x, y, true, false); // leap to empty ground (crushing a boulder if one's there)
        }
      }
    }
  } else {
    // ranged / spell: projectile rays over terrain, stopped only by walls. Only foes are
    // valid targets — and NOT summoning circles (a missile passes over a circle without
    // dispelling it; you must step or be shoved onto it). A circle still BLOCKS a
    // non-piercing shot, though.
    const shootWalls = Boolean(p.seeThroughWalls); // Sixth Sense: shots fly over walls
    const missileTarget = (x, y) => {
      const e = enemyAt(x, y);
      return Boolean(e) && isCapturable(state, e) && !e.summonCircle;
    };
    for (const [dx, dy] of dirs) {
      let x = p.x;
      let y = p.y;
      for (let i = 0; i < reach; i += 1) {
        x += dx;
        y += dy;
        if (!inBounds(x, y)) break;
        const t = terrainAt(state, x, y);
        if ((t === 'wall' || t === 'boulder') && !shootWalls) {
          if (t === 'boulder' && pierce) add(x, y, false, true); // a SPELL can blast the first boulder it hits
          break;
        }
        if (enemyAt(x, y)) {
          if (missileTarget(x, y)) add(x, y, false, true);
          if (!pierce) break; // a solid unit (including a circle) blocks a non-piercing shot
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
  const unitAt = enemyUnitAt(state, piece);
  // With `includeOccupied` every occupied square (king OR another enemy) counts as a target,
  // so sliders threaten the tiles their allies sit on too.
  const isTarget = includeOccupied
    ? (x, y) => (x === state.player.x && y === state.player.y) || state.enemies.some((o) => o.id !== piece.id && o.x === x && o.y === y)
    : (x, y) => (x === state.player.x && y === state.player.y) || Boolean(allyAt(state, x, y));
  // A TURRET fires a projectile (crossing pits / lava / water, stopped only by walls,
  // boulders, and the unit it hits); a mobile piece threatens where it can MOVE.
  const opts = piece.turret ? { projectile: true } : { lavaOk: true };
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
    berolina: 'B', // berolina pawn
    general: '♔', // the Necromancer's upgraded familiar (king + knight)
    archbishop: 'A', // bishop + knight
    chancellor: 'M', // rook + knight (a.k.a. marshall)
    amazon: 'Z', // queen + knight (the final boss)
    enpassant: '♙', // the Duellist's en-passant dash card
    doublestep: '»', // the Cavalier's two-tile dash card
    promotion: '♛', // the Ranger's Promotion (amazon form) card
    reload: '⟳', // the Ranger's Reload card
    swap: '⇄', // the Sorcerer's Displacement (swap) card
  };
  return labels[kind] ?? '♟';
}

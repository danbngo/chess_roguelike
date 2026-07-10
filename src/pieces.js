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
  const isKing = (x, y) => x === state.player.x && y === state.player.y;
  const opts = { lavaOk: true };
  return generateMoves(piece.kind, state, piece.x, piece.y, unitAt, isKing, opts);
}

// The straight-line directions a card kind slides/casts along (empty for a pure
// leaper). Pawn cards capture diagonally.
function cardSlideDirs(kind) {
  switch (kind) {
    case 'king':
    case 'queen':
    case 'amazon':
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
    // The Duellist's signature dash: bolt exactly 2 tiles orthogonally onto empty
    // ground, en-passant-striking the two tiles that FLANK the square dashed over.
    // Walls/lava block both the pass-through and the landing; a foe on the landing
    // tile blocks the dash (you must land on clear ground).
    for (const [dx, dy] of ORTHO) {
      const mx = p.x + dx;
      const my = p.y + dy; // the tile dashed over
      const ex = p.x + 2 * dx;
      const ey = p.y + 2 * dy; // the landing tile
      if (!inBounds(ex, ey)) continue;
      const midT = terrainAt(state, mx, my);
      const destT = terrainAt(state, ex, ey);
      if (midT === 'wall' || midT === 'lava') continue; // can't dash through
      if (destT === 'wall' || destT === 'lava') continue; // can't land there
      if (enemyAt(ex, ey)) continue; // must land on empty ground
      // The two rear diagonals of the landing tile — the squares that flank the tile
      // dashed over (down-left and down-right relative to the dash direction).
      const flanks = [
        { x: ex - dx + dy, y: ey - dy - dx },
        { x: ex - dx - dy, y: ey - dy + dx },
      ];
      if (inLineOfSight(state, ex, ey)) results.push({ x: ex, y: ey, capture: false, viaJump: true, flanks });
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
        if (t === 'wall' || t === 'lava') continue; // can't land there
        if (enemyAt(x, y)) {
          if (targetable(x, y)) add(x, y, true, true);
        } else {
          add(x, y, true, false); // leap to empty ground
        }
      }
    }
  } else {
    // ranged / spell: projectile rays over terrain, stopped only by walls. Only foes
    // are valid targets (these cards never move the king).
    const shootWalls = Boolean(p.seeThroughWalls); // Sixth Sense: shots fly over walls
    for (const [dx, dy] of dirs) {
      let x = p.x;
      let y = p.y;
      for (let i = 0; i < reach; i += 1) {
        x += dx;
        y += dy;
        if (!inBounds(x, y)) break;
        if (terrainAt(state, x, y) === 'wall' && !shootWalls) break;
        if (enemyAt(x, y)) {
          if (targetable(x, y)) add(x, y, false, true);
          if (!pierce) break; // a solid unit blocks a non-piercing shot
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
  if (!includeOccupied) {
    return getPieceMoves(piece, state);
  }
  // Treat every occupied square (the king OR any other enemy) as a capture target,
  // so sliders/steppers threaten the tiles their allies sit on too.
  const unitAt = enemyUnitAt(state, piece);
  const isTarget = (x, y) =>
    (x === state.player.x && y === state.player.y) ||
    state.enemies.some((o) => o.id !== piece.id && o.x === x && o.y === y);
  return generateMoves(piece.kind, state, piece.x, piece.y, unitAt, isTarget, { lavaOk: true });
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
    archbishop: 'A', // bishop + knight
    chancellor: 'M', // rook + knight (a.k.a. marshall)
    amazon: 'Z', // queen + knight (the final boss)
    enpassant: '♙', // the Duellist's en-passant dash card
    promotion: '♛', // the Ranger's Promotion (amazon form) card
    reload: '⟳', // the Ranger's Reload card
    swap: '⇄', // the Sorcerer's Displacement (swap) card
  };
  return labels[kind] ?? '♟';
}

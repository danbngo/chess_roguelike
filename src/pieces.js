// Chess-piece movement, expressed in terms of the terrain-aware slide / jump
// primitives in terrain.js.

// A blocker lookup for an enemy piece: the king is a capture target, other
// enemies merely block.
function enemyUnitAt(state, piece) {
  return (x, y) => {
    if (x === state.player.x && y === state.player.y) {
      return 'player';
    }
    return state.enemies.find((other) => other.id !== piece.id && other.x === x && other.y === y) || null;
  };
}

// Core move generator: every tile a piece of `kind` standing at (fromX, fromY)
// could move onto, given a `unitAt` blocker lookup and an `isTarget` test for
// which occupied tiles may be captured (and thus moved onto). Shared by enemy
// pieces (target = the king) and the king's own cards (targets = enemies).
function generateMoves(kind, state, fromX, fromY, unitAt, isTarget) {
  const moves = [];

  const slide = (directions, maxGround) => {
    for (const [dx, dy] of directions) {
      for (const stop of slideStops(state, fromX, fromY, dx, dy, maxGround, unitAt, isTarget)) {
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
    case 'camel':
      // A (3,1) leaper.
      for (const target of leapTargets(state, fromX, fromY, CAMEL_STEPS, unitAt, isTarget)) {
        moves.push(target);
      }
      break;
    case 'nightrider':
      // Rides repeated knight leaps in a line until blocked.
      for (const target of riderTargets(state, fromX, fromY, KNIGHT_STEPS, unitAt, isTarget)) {
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
function getPieceMoves(piece, state) {
  const unitAt = enemyUnitAt(state, piece);
  const isKing = (x, y) => x === state.player.x && y === state.player.y;
  return generateMoves(piece.kind, state, piece.x, piece.y, unitAt, isKing);
}

// Where the king could move if he played a card of the given kind: he moves like
// that unit from his own square, and enemies are the capturable targets. A card
// can never carry him farther than he can see (his vision radius).
function getCardMoves(state, kind) {
  const enemyAt = (x, y) => state.enemies.find((e) => e.x === x && e.y === y) || null;
  const isEnemy = (x, y) => Boolean(enemyAt(x, y));
  const range = Math.floor((state.player.vision || state.viewSize) / 2);
  return generateMoves(kind, state, state.player.x, state.player.y, enemyAt, isEnemy).filter(
    (move) => chebyshev(move.x, move.y, state.player.x, state.player.y) <= range,
  );
}

// The squares immediately adjacent (in the given directions) a piece threatens —
// used for pawn-likes, whose capture squares differ from their move squares.
function adjacentThreats(piece, state, dirs) {
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
    if (state.enemies.some((other) => other.id !== piece.id && other.x === x && other.y === y)) {
      continue;
    }
    threats.push({ x, y });
  }
  return threats;
}

// Tiles where this piece could capture the king — the squares dangerous to stand
// on (the red threat tint). Pawn-likes capture differently than they move: a pawn
// attacks the diagonals, the berolina attacks the orthogonals. Everything else
// threatens exactly where it can move.
function getPieceThreats(piece, state) {
  if (piece.kind === 'pawn') {
    return adjacentThreats(piece, state, DIAG);
  }
  if (piece.kind === 'berolina') {
    return adjacentThreats(piece, state, ORTHO);
  }
  return getPieceMoves(piece, state);
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
    camel: 'C',
    archbishop: 'A', // bishop + knight
    chancellor: 'M', // rook + knight (a.k.a. marshall)
    amazon: 'Z', // queen + knight
    nightrider: 'N', // rides repeated knight leaps
  };
  return labels[kind] ?? '♟';
}

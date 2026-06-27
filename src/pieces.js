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

// Every tile this piece could legally move onto next turn, given the board.
function getPieceMoves(piece, state) {
  const unitAt = enemyUnitAt(state, piece);
  const isKing = (x, y) => x === state.player.x && y === state.player.y;
  const moves = [];

  const slide = (directions, maxGround) => {
    for (const [dx, dy] of directions) {
      for (const stop of slideStops(state, piece.x, piece.y, dx, dy, maxGround, unitAt, isKing)) {
        moves.push(stop);
      }
    }
  };

  switch (piece.kind) {
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
      for (const target of jumpTargets(state, piece.x, piece.y, unitAt, isKing)) {
        moves.push(target);
      }
      break;
    case 'pawn':
    default:
      // Cardinal steps onto empty ground (never a straight capture)...
      for (const [dx, dy] of ORTHO) {
        for (const stop of slideStops(state, piece.x, piece.y, dx, dy, 1, unitAt, () => false)) {
          moves.push(stop);
        }
      }
      // ...and a diagonal capture of the king only.
      for (const [dx, dy] of DIAG) {
        const x = piece.x + dx;
        const y = piece.y + dy;
        if (isKing(x, y)) {
          moves.push({ x, y, capture: true });
        }
      }
      break;
  }

  return moves;
}

// Tiles where this piece could capture the king — the squares dangerous to
// stand on (the red threat tint). For every piece except the pawn this is its
// move set; a pawn only attacks the diagonals.
function getPieceThreats(piece, state) {
  if (piece.kind !== 'pawn') {
    return getPieceMoves(piece, state);
  }
  const threats = [];
  for (const [dx, dy] of DIAG) {
    const x = piece.x + dx;
    const y = piece.y + dy;
    if (x < 0 || x >= state.worldSize || y < 0 || y >= state.worldSize) {
      continue;
    }
    const terrain = terrainAt(state, x, y);
    if (terrain === 'wall' || terrain === 'lava') {
      continue;
    }
    if (state.enemies.some((other) => other.id !== piece.id && other.x === x && other.y === y)) {
      continue;
    }
    threats.push({ x, y });
  }
  return threats;
}

// Solid (filled) glyphs read clearly on the colored tokens.
function getPieceLabel(kind) {
  const labels = {
    king: '♚',
    pawn: '♟',
    rook: '♜',
    bishop: '♝',
    knight: '♞',
    queen: '♛',
  };
  return labels[kind] ?? '♟';
}

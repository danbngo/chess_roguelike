// Chess-piece movement: which tiles a piece can legally reach in one move.

// Slides outward along each direction until the edge or a blocker.
// Another enemy stops the slide; the king can still be captured on contact.
function slidingMoves(piece, directions, occupied, playerKey, worldSize) {
  const moves = [];
  for (const [dx, dy] of directions) {
    let x = piece.x + dx;
    let y = piece.y + dy;
    while (x >= 0 && x < worldSize && y >= 0 && y < worldSize) {
      const key = `${x},${y}`;
      if (occupied.has(key)) {
        if (key === playerKey) {
          moves.push({ x, y });
        }
        break;
      }
      moves.push({ x, y });
      x += dx;
      y += dy;
    }
  }
  return moves;
}

// Single-step jumps (knight, pawn). The player's tile is never in `occupied`,
// so it always stays capturable.
function steppingMoves(piece, deltas, occupied, worldSize) {
  const moves = [];
  for (const [dx, dy] of deltas) {
    const x = piece.x + dx;
    const y = piece.y + dy;
    if (x < 0 || x >= worldSize || y < 0 || y >= worldSize) {
      continue;
    }
    if (occupied.has(`${x},${y}`)) {
      continue;
    }
    moves.push({ x, y });
  }
  return moves;
}

// A pawn moves one square cardinally onto empty ground, but captures the king
// only on the diagonals (true chess pawn behavior, minus the fixed facing).
function pawnMoves(piece, occupied, playerKey, worldSize) {
  const moves = [];
  for (const [dx, dy] of ORTHO) {
    const x = piece.x + dx;
    const y = piece.y + dy;
    const key = `${x},${y}`;
    if (x < 0 || x >= worldSize || y < 0 || y >= worldSize) {
      continue;
    }
    if (occupied.has(key) || key === playerKey) {
      continue; // Blocked, and pawns can't capture straight ahead.
    }
    moves.push({ x, y });
  }
  for (const [dx, dy] of DIAG) {
    const x = piece.x + dx;
    const y = piece.y + dy;
    if (`${x},${y}` === playerKey) {
      moves.push({ x, y }); // Diagonal capture of the king.
    }
  }
  return moves;
}

// Every tile this piece could legally move onto next turn, given the board.
function getPieceMoves(piece, state) {
  const occupied = new Set();
  for (const other of state.enemies) {
    if (other.id !== piece.id) {
      occupied.add(`${other.x},${other.y}`);
    }
  }
  const playerKey = `${state.player.x},${state.player.y}`;
  const w = state.worldSize;

  switch (piece.kind) {
    case 'rook':
      return slidingMoves(piece, ORTHO, occupied, playerKey, w);
    case 'bishop':
      return slidingMoves(piece, DIAG, occupied, playerKey, w);
    case 'queen':
      return slidingMoves(piece, [...ORTHO, ...DIAG], occupied, playerKey, w);
    case 'knight':
      return steppingMoves(piece, KNIGHT_STEPS, occupied, w);
    case 'king':
      return steppingMoves(piece, [...ORTHO, ...DIAG], occupied, w);
    case 'pawn':
    default:
      return pawnMoves(piece, occupied, playerKey, w);
  }
}

// Tiles where this piece could capture the king — i.e. the squares that are
// dangerous to stand on (the red threat tint). For every piece except the pawn
// this equals its move set; a pawn only attacks the diagonals.
function getPieceThreats(piece, state) {
  if (piece.kind !== 'pawn') {
    return getPieceMoves(piece, state);
  }
  const occupied = new Set();
  for (const other of state.enemies) {
    if (other.id !== piece.id) {
      occupied.add(`${other.x},${other.y}`);
    }
  }
  const w = state.worldSize;
  const threats = [];
  for (const [dx, dy] of DIAG) {
    const x = piece.x + dx;
    const y = piece.y + dy;
    if (x < 0 || x >= w || y < 0 || y >= w) {
      continue;
    }
    if (occupied.has(`${x},${y}`)) {
      continue; // A friendly piece sits there.
    }
    threats.push({ x, y });
  }
  return threats;
}

// Solid (filled) glyphs read clearly on the colored piece tokens.
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

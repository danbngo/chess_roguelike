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
// Enemies may walk over lava (demonic); a flyer crosses any non-wall terrain.
function getPieceMoves(piece, state) {
  const unitAt = enemyUnitAt(state, piece);
  const isKing = (x, y) => x === state.player.x && y === state.player.y;
  // Demons (all enemies from the demon realm, floor 5+) stride through lava & fire.
  const demon = (state.floor || 1) >= DEMON_FLOOR;
  const opts = { lavaOk: true, fireOk: demon, flying: Boolean(piece.flying) };
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
//   melee  - the king would physically move onto the target, so it respects real
//            movement (terrain, slow ground). Reach = rating (steppers) or 3/4/5.
//   ranged - a projectile: rays fly over terrain, stopped only by walls, and are
//            BLOCKED by the first unit in the way (unless Overhead pierces).
//   spell  - a bolt that pierces EVERY unit on its path (ignores obstructions).
// Leaps ignore whatever they jump over. Targets must be in sight (a Ranger's Eagle
// Eye lets sight — and thus shots — pass through any terrain but walls).
function getCardMoves(state, card) {
  const p = state.player;
  const kind = card.kind;
  const category = card.category || 'melee';
  const rating = card.rating || 1;
  const traits = card.traits || [];
  const reach = cardReach(kind, rating);
  const hops = kind === 'knight' ? rating : 1; // compounds do a single knight leap
  const dirs = cardSlideDirs(kind);
  const hasLeap = isJumperKind(kind);
  const blast = traits.includes('blast');
  const pierce = category === 'spell' || (category === 'ranged' && traits.includes('overhead'));
  const enemyAt = (x, y) => state.enemies.find((e) => e.x === x && e.y === y) || null;
  const inBounds = (x, y) => x >= 0 && x < WORLD_SIZE && y >= 0 && y < WORLD_SIZE;
  const targetable = (x, y) => {
    const e = enemyAt(x, y);
    if (!e) return false;
    if (blast && (e.statue || e.turret)) return true; // a Blast spell shatters structures
    return isCapturable(state, e);
  };
  const results = [];
  const add = (x, y, viaJump) => {
    if (inLineOfSight(state, x, y)) results.push({ x, y, capture: true, viaJump: Boolean(viaJump) });
  };

  if (category === 'melee') {
    // The king walks/leaps onto the target — real movement rules apply.
    const opts = { ignoreIce: true, terrainImmune: Boolean(p.terrainImmune) };
    for (const [dx, dy] of dirs) {
      for (const stop of slideStops(state, p.x, p.y, dx, dy, reach, enemyAt, targetable, opts)) {
        if (stop.capture) add(stop.x, stop.y);
      }
    }
    if (hasLeap) {
      for (const [dx, dy] of KNIGHT_STEPS) {
        let x = p.x;
        let y = p.y;
        for (let h = 0; h < hops; h += 1) {
          x += dx;
          y += dy;
          if (!inBounds(x, y)) break;
          const t = terrainAt(state, x, y);
          if (t === 'wall' || (t === 'lava' && !p.terrainImmune)) break; // can't land there
          if (enemyAt(x, y)) {
            if (targetable(x, y)) add(x, y, true);
            break; // a unit halts the ride
          }
        }
      }
    }
  } else {
    // ranged / spell: projectile rays over terrain, stopped only by walls.
    for (const [dx, dy] of dirs) {
      let x = p.x;
      let y = p.y;
      for (let i = 0; i < reach; i += 1) {
        x += dx;
        y += dy;
        if (!inBounds(x, y) || terrainAt(state, x, y) === 'wall') break;
        if (enemyAt(x, y)) {
          if (targetable(x, y)) add(x, y);
          if (!pierce) break; // a solid unit blocks a non-piercing shot
        }
      }
    }
    if (hasLeap) {
      for (const [dx, dy] of KNIGHT_STEPS) {
        let x = p.x;
        let y = p.y;
        for (let h = 0; h < hops; h += 1) {
          x += dx;
          y += dy;
          if (!inBounds(x, y) || terrainAt(state, x, y) === 'wall') break;
          if (enemyAt(x, y)) {
            if (targetable(x, y)) add(x, y, true);
            if (!pierce) break;
          }
        }
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
  if (piece.statue) {
    return []; // an inert statue threatens nothing until it wakes
  }
  if (piece.summoner) {
    return []; // summoners never strike the king directly
  }
  if (piece.mage) {
    // A mage only threatens when charged, and its bolt pierces (mage tiles).
    return piece.charged ? magePierceTiles(state, piece) : [];
  }
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
    archbishop: 'A', // bishop + knight
    chancellor: 'M', // rook + knight (a.k.a. marshall)
    amazon: 'Z', // queen + knight (the final boss)
  };
  return labels[kind] ?? '♟';
}

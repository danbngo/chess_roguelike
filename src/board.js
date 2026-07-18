// Vision / fog-of-war: what the king can see and which tiles are under threat.

// The square sight window centered on the king, sized by his current vision
// (upgradable), clamped to stay inside the world. `viewSize` is a legacy
// fallback for saves made before vision became a player stat.
// The DISPLAY sight window: how far the king SEES (his full vision, one-way Oracle sight included).
function getVisibleBounds(state) {
  const p = state.player;
  // NB: Phase no longer blinds him. Standing inside a wall used to cut him to a 3x3 window, which
  // made the perk's own signature move — slipping into stone — something you did with your eyes
  // shut. Phase is a Sorcerer capstone-chain perk; it should feel like a power, not a trade.
  return boundsOfSize(state, p.vision || state.viewSize);
}

// The AWARENESS window: how far FOES can see the king back — his display sight MINUS any one-way
// Oracle band (Hawk Eyes / Power Draw). Foes out in that extended band can't see or target him.
function getAwarenessBounds(state) {
  const p = state.player;
  const display = p.vision || state.viewSize;
  const size = Math.max(3, display - (p.visionOneWay || 0));
  return boundsOfSize(state, size);
}

function boundsOfSize(state, size) {
  const half = Math.floor(size / 2);
  return {
    x: clamp(state.player.x - half, 0, state.worldSize - size),
    y: clamp(state.player.y - half, 0, state.worldSize - size),
    width: size,
    height: size,
  };
}

function isWithinBounds(bounds, x, y) {
  return x >= bounds.x && x < bounds.x + bounds.width && y >= bounds.y && y < bounds.y + bounds.height;
}

// Enemies the king can actually see (clear line of sight).
function getVisibleEnemies(state) {
  return state.enemies.filter((enemy) => unitInSight(state, enemy.x, enemy.y));
}

// Whether a (visible) enemy could actually strike the king on its NEXT turn — used to decide
// which tiles read as dangerous. A piece that is recovering/winding-up (skips its turn), dozing,
// asleep, or a neutral beast poses no threat this turn.
function threatensNextTurn(state, enemy) {
  if (enemy.recovering) return false; // a boss/turret catching its breath can't fire next turn
  if (enemy.dozing || enemy.asleep) return false;
  if (typeof isNeutralBeast === 'function' && isNeutralBeast(state, enemy)) return false;
  // IT HAS TO HAVE NOTICED HIM. A foe that has not (a "?" over its head) cannot strike him next
  // turn: step into its view and the very first thing it does is GASP, and the surprise costs it
  // the turn. So every lane an oblivious rook "covers" is ground he can walk across freely — and
  // painting it red told him the exact opposite of the truth, on tiles that were his for the taking.
  //
  // The two cases that must NOT be excluded here, both verified against what the pieces actually do:
  //   - SURPRISED: a piece gasping this turn has its wits back by the next one and swings then.
  //   - mid-PURSUIT (a live lastSeen): it never gasps at all, it re-engages at once — so it is a
  //     threat whether or not it happens to have eyes on him this instant.
  const remembers = Boolean(enemy.lastSeen) && enemy.lastSeenTtl > 0;
  if (!enemy.awake && !enemy.surprised && !remembers) return false;
  return true;
}

// Map of "x,y" -> how many visible enemies could capture the king on that tile.
// The renderer tints more heavily where the count is higher.
// A turret is only a LIVE threat when the king is actually standing in its firing line (then it
// locks on and fires); off-line it sits idle. Used to gate its danger tiles and its status icon.
function turretHasKingInLine(state, turret) {
  return getPieceThreats(turret, state, true).some((t) => t.x === state.player.x && t.y === state.player.y);
}

// THE GHOST. The question the threat map answers is not "what is dangerous right now" — it is "if
// the king STOOD there, could he be hit". So the board must be judged as it would be WITH HIM ON IT,
// and three things have to be undone first. Each one silently painted a lethal tile green:
//
//   1. HIS OWN BODY. A slider threatens its FULL line, so a tile he currently shadows would read
//      safe — right up until he steps onto it and unblocks the very shot that kills him.
//   2. THE KEY. Enemies treat the key as impassable (`enemyUnitAt` returns 'key'), so every threat
//      ray BROKE on it — leaving the key tile, AND the whole line beyond it, painted safe. The one
//      tile on the floor he is guaranteed to walk onto was the one tile never marked dangerous.
//      He can stand on it; a shot can reach it; it is not a wall. Remove it from the ghost.
//   3. SHUT DOORS. A shut door stops a turret's projectile ray, so the doorway and everything past
//      it read safe — but stepping onto a door OPENS it, and the lane he just cleared is the lane
//      he is now standing in. Judge every door as already open.
//
// Built in ONE place because two callers now depend on it: the red tint (getThreatenedTiles) and the
// hover highlight (threatenersOf). If those two ever disagreed about what is dangerous, the game
// would be telling the player two different stories about the same tile.
function buildThreatGhost(state) {
  const ghostTerrain = { ...state.terrain };
  for (const k in ghostTerrain) {
    if (ghostTerrain[k] === 'door' || ghostTerrain[k] === 'doorajar') ghostTerrain[k] = 'dooropen';
  }
  return { ...state, player: { ...state.player, x: -50, y: -50 }, key: null, terrain: ghostTerrain };
}

// Does this enemy's threat include (x, y)? A turret only fires the turn the king is ALREADY in its
// line (it locked on last turn); step in fresh and it merely aims. So its lane counts as live only
// while he actually stands in it — the same rule the tint uses.
function enemyThreatensTile(state, ghost, enemy, x, y) {
  if (!threatensNextTurn(state, enemy)) return false;
  const tiles = getPieceThreats(enemy, ghost, true);
  if (enemy.turret && !tiles.some((t) => t.x === state.player.x && t.y === state.player.y)) return false;
  // The SAME per-tile sight test getThreatenedTiles applies (turrets included — a gun outside its
  // awareness window from the candidate tile will not fire). It has to be here too, or the hover
  // rings and the red tint start telling the player two different stories about one square — which
  // is exactly what the test on these two caught the moment the tint learned this rule and the
  // rings did not.
  if (!enemySeesTile(state, enemy, x, y)) return false;
  return tiles.some((t) => t.x === x && t.y === y);
}

// WHICH foes threaten this tile — the hover highlight's backing. The tint says a tile is dangerous;
// this says who by, so the player can plan a late-game move without eyeballing every piece on screen.
function threatenersOf(state, x, y) {
  const ghost = buildThreatGhost(state);
  return getVisibleEnemies(state).filter((e) => enemyThreatensTile(state, ghost, e, x, y));
}

// Would this foe SEE him standing THERE? Awareness is reckoned around the KING, so it has to be
// asked per-TILE and not once per foe: a rook covers a whole hall, but it cannot see the far end of
// one. Step down there and it is simply not looking at you.
//
// This is what the Oracle's one-way band IS. Its whole promise is that he watches foes that cannot
// watch him back — and the map was painting those foes' lanes red anyway, which is the exact
// opposite of the thing the perk sells. (Measured: a rook 4 tiles off, plainly visible to him,
// blind to him, painted DANGER, and it never so much as moved.) The same tiles were ALREADY being
// washed cyan as "free shots", so the board was making both claims about one square at once.
function enemySeesTile(state, enemy, x, y) {
  const probe = { ...state, player: { ...state.player, x, y } };
  return enemyAwareOfKing(probe, enemy.x, enemy.y, typeof bossHas === 'function' && bossHas(enemy, 'phasing'));
}

function getThreatenedTiles(state) {
  const counts = new Map();
  const p = state.player;
  // ANIMAL FORM. While the warhorse holds, NOTHING on the board can lay a finger on him —
  // rollMitigation returns 'invuln' before any enemy blow resolves — so every tile he can reach is
  // safe and painting lanes red is simply false.
  //
  // But NOT on the last turn, and that exception is the whole point. passTurn ticks the form down
  // BEFORE the room swings, so a king who acts with 1 turn left is a plain king again by the time
  // the blows land (verified: at promotion 1 he takes the hit; at 2 he does not). That is the most
  // dangerous turn of the entire form — he has spent three turns learning that nothing can touch
  // him — so it must go back to reading red BEFORE he steps, not after he is bleeding.
  if (p.promotion > 1) return counts;
  const ghost = buildThreatGhost(state);
  for (const enemy of getVisibleEnemies(state)) {
    if (!threatensNextTurn(state, enemy)) continue;
    // includeOccupied: a tile an enemy sits on is still dangerous, because the king
    // can capture that enemy and end his move there — where other foes can hit him.
    const tiles = getPieceThreats(enemy, ghost, true);
    // A turret only fires the turn the king is ALREADY in its line (it locked on last turn); step
    // in fresh and it merely aims. So paint its lane RED only when the king currently stands in it
    // — but thanks to the ghost above, the WHOLE lane is then flagged, including tiles beyond his
    // own body that he'd slide onto and eat a shot at (the bug this fixes).
    if (enemy.turret && !tiles.some((t) => t.x === p.x && t.y === p.y)) continue;
    for (const tile of tiles) {
      // It can REACH this tile — but could it see him on it? A foe that cannot perceive him there
      // will never come for him there. This holds for a TURRET too: a stationary gun only fires
      // when the king is inside its AWARENESS window (see beginEnemyPhase — an unaware turret idles
      // and never reaches fireTurret). So a lane tile the king could step onto that puts the gun
      // OUTSIDE that window is genuinely safe, and painting it red told him the opposite — the very
      // "move one tile and the turret drops out of range" case the map used to get wrong.
      if (!enemySeesTile(state, enemy, tile.x, tile.y)) continue;
      const key = `${tile.x},${tile.y}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  // AN OPEN STAIR IS ALWAYS SAFE. Step onto an unlocked exit and the floor ends then and there —
  // tryDescend fires on the move itself, so there IS no enemy phase and nothing on the board ever
  // gets to swing at him. However many blades cover that square, he cannot be hit standing on it.
  // Painting it red told him the one tile he could always run to was the one place he must not go.
  //
  // A LOCKED stair is a tile like any other: he bounces off the seal and stands there taking hits.
  if (state.exit && !state.exit.locked) counts.delete(`${state.exit.x},${state.exit.y}`);
  return counts;
}

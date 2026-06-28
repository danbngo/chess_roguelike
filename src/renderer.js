// All canvas drawing and the smooth piece-movement animation. Keeps its own
// private "render entity" positions that ease toward the logical tile targets.

const Renderer = (function () {
  let ctx = null;
  let canvas = null;
  let tileSize = 0;

  let playerRender = { x: 0, y: 0, targetX: 0, targetY: 0 };
  let enemyRenders = [];

  // Hit feedback: a brief screen shake + red flash, both easing out from 1 -> 0.
  let shake = 0;
  const SHAKE_DURATION = 0.4;
  const SHAKE_MAGNITUDE = 9;

  // Camera: a movable, zoomable window onto the board. `baseTile` is the on-screen
  // size of a tile at zoom 1 — set so the default view shows half the board (i.e.
  // tiles are 2x the size of the old whole-board view). The camera position is the
  // world coordinate (in tiles, fractional) sitting at the center of the canvas;
  // x/y ease toward targetX/targetY and zoom toward targetZoom for smooth motion.
  let baseTile = 0;
  const DEFAULT_ZOOM = 1;
  const MIN_ZOOM = 0.5; // zoomed all the way out shows the whole 20x20 board
  const MAX_ZOOM = 2.5; // zoomed all the way in shows a handful of tiles
  let camera = { x: 10, y: 10, targetX: 10, targetY: 10, zoom: DEFAULT_ZOOM, targetZoom: DEFAULT_ZOOM };

  function currentTileSize() {
    return baseTile * camera.zoom;
  }

  function init(canvasEl) {
    canvas = canvasEl;
    ctx = canvasEl.getContext('2d');
    // Two tiles' worth bigger than the old full-board fit: the default view spans
    // half the world (WORLD_SIZE / 2 tiles across the canvas).
    baseTile = canvasEl.width / (WORLD_SIZE / 2);
    tileSize = baseTile * camera.zoom;
  }

  // Kick off the on-hit shake/flash.
  function hit() {
    shake = SHAKE_DURATION;
  }

  // Snap the camera onto the king instantly (keeps the current zoom level).
  function snapCameraToPlayer(state) {
    camera.x = camera.targetX = state.player.x + 0.5;
    camera.y = camera.targetY = state.player.y + 0.5;
  }

  // Glide the camera so the king's tile sits at the center of the view.
  function centerOn(x, y) {
    camera.targetX = x + 0.5;
    camera.targetY = y + 0.5;
  }

  // Nudge the camera target by a number of tiles (used by pan controls).
  function panBy(dxTiles, dyTiles) {
    camera.targetX += dxTiles;
    camera.targetY += dyTiles;
  }

  // Adjust the zoom target (positive zooms in, negative out), clamped to range.
  function zoomBy(amount) {
    camera.targetZoom = clamp(camera.targetZoom + amount, MIN_ZOOM, MAX_ZOOM);
  }

  // Convert a canvas-space pixel (already scaled to the 640px backing size) to the
  // world tile under it, accounting for the current camera position and zoom.
  function screenToTile(canvasX, canvasY) {
    const ts = currentTileSize();
    const originX = camera.x - canvas.width / ts / 2;
    const originY = camera.y - canvas.height / ts / 2;
    return { x: Math.floor(canvasX / ts + originX), y: Math.floor(canvasY / ts + originY) };
  }

  // Keep the camera target from drifting off the board. When the view is wider
  // than the world, lock it to the world center.
  function clampCamera() {
    const ts = baseTile * camera.targetZoom;
    const viewX = canvas.width / ts;
    const viewY = canvas.height / ts;
    camera.targetX = viewX >= WORLD_SIZE ? WORLD_SIZE / 2 : clamp(camera.targetX, viewX / 2, WORLD_SIZE - viewX / 2);
    camera.targetY = viewY >= WORLD_SIZE ? WORLD_SIZE / 2 : clamp(camera.targetY, viewY / 2, WORLD_SIZE - viewY / 2);
  }

  // Snap render positions to the state instantly (new game / load / restart).
  function reset(state) {
    playerRender = {
      x: state.player.x,
      y: state.player.y,
      targetX: state.player.x,
      targetY: state.player.y,
    };
    enemyRenders = state.enemies.map((enemy) => ({
      id: enemy.id,
      x: enemy.x,
      y: enemy.y,
      targetX: enemy.x,
      targetY: enemy.y,
      kind: enemy.kind,
      surprised: Boolean(enemy.surprised),
    }));
    snapCameraToPlayer(state);
  }

  // Retarget render entities so they glide to their new tiles.
  function sync(state) {
    playerRender.targetX = state.player.x;
    playerRender.targetY = state.player.y;

    const next = [];
    for (const enemy of state.enemies) {
      let render = enemyRenders.find((item) => item.id === enemy.id);
      if (!render) {
        render = { id: enemy.id, x: enemy.x, y: enemy.y, targetX: enemy.x, targetY: enemy.y };
      }
      render.targetX = enemy.x;
      render.targetY = enemy.y;
      render.kind = enemy.kind;
      render.surprised = Boolean(enemy.surprised);
      next.push(render);
    }
    enemyRenders = next;
  }

  function update(delta) {
    const speed = Math.min(1, 12 * delta);
    playerRender.x += (playerRender.targetX - playerRender.x) * speed;
    playerRender.y += (playerRender.targetY - playerRender.y) * speed;
    for (const enemy of enemyRenders) {
      enemy.x += (enemy.targetX - enemy.x) * speed;
      enemy.y += (enemy.targetY - enemy.y) * speed;
    }
    clampCamera();
    camera.x += (camera.targetX - camera.x) * speed;
    camera.y += (camera.targetY - camera.y) * speed;
    camera.zoom += (camera.targetZoom - camera.zoom) * speed;
    if (shake > 0) {
      shake = Math.max(0, shake - delta);
    }
  }

  function drawPiece(tileX, tileY, kind, isPlayer) {
    const cx = tileX * tileSize + tileSize / 2;
    const cy = tileY * tileSize + tileSize / 2;
    const radius = tileSize * 0.4;

    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = isPlayer ? '#f7e7b8' : '#111118';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = isPlayer ? '#8a6a26' : '#dadada';
    ctx.stroke();

    ctx.fillStyle = isPlayer ? '#3a2c0a' : '#f3f1e7';
    ctx.font = `${tileSize * 0.62}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(getPieceLabel(kind), cx, cy + tileSize * 0.04);
  }

  // A bright "!" above a piece that has just spotted the king.
  function drawSurpriseMark(tileX, tileY) {
    const cx = tileX * tileSize + tileSize / 2;
    const cy = tileY * tileSize + tileSize * 0.12;
    ctx.font = `bold ${tileSize * 0.55}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)';
    ctx.strokeText('!', cx, cy);
    ctx.fillStyle = '#ffd400';
    ctx.fillText('!', cx, cy);
  }

  function drawExit(tileX, tileY, faded) {
    const px = tileX * tileSize;
    const py = tileY * tileSize;
    ctx.save();
    ctx.globalAlpha = faded ? 0.45 : 1;
    ctx.fillStyle = '#0e7490';
    ctx.fillRect(px + tileSize * 0.15, py + tileSize * 0.15, tileSize * 0.7, tileSize * 0.7);
    ctx.fillStyle = '#a5f3fc';
    ctx.beginPath();
    ctx.moveTo(px + tileSize * 0.3, py + tileSize * 0.38);
    ctx.lineTo(px + tileSize * 0.7, py + tileSize * 0.38);
    ctx.lineTo(px + tileSize * 0.5, py + tileSize * 0.74);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawShop(tileX, tileY, faded) {
    const px = tileX * tileSize;
    const py = tileY * tileSize;
    ctx.save();
    ctx.globalAlpha = faded ? 0.45 : 1;
    ctx.fillStyle = '#b45309';
    ctx.fillRect(px + tileSize * 0.15, py + tileSize * 0.15, tileSize * 0.7, tileSize * 0.7);
    ctx.fillStyle = '#fde68a';
    ctx.font = `bold ${tileSize * 0.5}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('$', px + tileSize / 2, py + tileSize * 0.54);
    ctx.restore();
  }

  function drawItem(item) {
    const cx = item.x * tileSize + tileSize / 2;
    const cy = item.y * tileSize + tileSize / 2;
    if (item.kind === 'heart') {
      ctx.fillStyle = '#ef4444';
      ctx.font = `${tileSize * 0.6}px serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('♥', cx, cy + tileSize * 0.05);
    } else {
      ctx.beginPath();
      ctx.arc(cx, cy, tileSize * 0.26, 0, Math.PI * 2);
      ctx.fillStyle = '#fbbf24';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#b45309';
      ctx.stroke();
      ctx.fillStyle = '#7c4a03';
      ctx.font = `bold ${tileSize * 0.32}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('$', cx, cy);
    }
  }

  // A small marker on each tile the king can move to this turn.
  function drawMoveHint(tileX, tileY, viaJump, capture) {
    const cx = tileX * tileSize + tileSize / 2;
    const cy = tileY * tileSize + tileSize / 2;
    if (capture) {
      ctx.beginPath();
      ctx.arc(cx, cy, tileSize * 0.42, 0, Math.PI * 2);
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(248, 113, 113, 0.9)';
      ctx.stroke();
      return;
    }
    ctx.beginPath();
    ctx.arc(cx, cy, tileSize * 0.12, 0, Math.PI * 2);
    ctx.fillStyle = viaJump ? 'rgba(96, 165, 250, 0.85)' : 'rgba(74, 222, 128, 0.85)';
    ctx.fill();
  }

  // Tile colors per terrain (two shades to keep the checkerboard feel). All kept
  // within a warm cream/tan/brown family — desaturated and fairly light — so the
  // green / red / orange move-and-threat tints overlay legibly on every tile.
  function terrainColor(type, isDark) {
    switch (type) {
      case 'ice':
        return isDark ? '#c2cccc' : '#e0e7e3'; // pale frost
      case 'water':
        return isDark ? '#6b8a90' : '#86a3a8'; // muted, desaturated blue
      case 'lava':
        return isDark ? '#b23409' : '#cc3f0c'; // (lava removed — unused)
      case 'wall':
        return isDark ? '#5a4f45' : '#6b5e52'; // warm brown stone
      case 'mist':
        return isDark ? '#9c9586' : '#b1a999'; // warm taupe
      default:
        return isDark ? '#6b4a2b' : '#e9cfa0'; // cream/brown ground
    }
  }

  // Deterministic per-tile pseudo-random in [0, 1) so textures stay put across
  // frames (no flicker) yet differ from tile to tile.
  function tileHash(x, y) {
    const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return h - Math.floor(h);
  }

  // A light dusting of per-terrain detail painted over the flat base color.
  function drawTexture(type, px, py, isDark, x, y) {
    ctx.save();
    switch (type) {
      case 'water': {
        // Gentle horizontal ripples.
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
        ctx.lineWidth = 1;
        for (let i = 1; i <= 2; i += 1) {
          const ly = py + tileSize * (0.28 * i + 0.12);
          ctx.beginPath();
          ctx.moveTo(px + tileSize * 0.12, ly);
          ctx.quadraticCurveTo(px + tileSize * 0.5, ly - tileSize * 0.07, px + tileSize * 0.88, ly);
          ctx.stroke();
        }
        break;
      }
      case 'ice': {
        // A pale crack catching the light.
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(px + tileSize * 0.18, py + tileSize * 0.72);
        ctx.lineTo(px + tileSize * 0.5, py + tileSize * 0.3);
        ctx.lineTo(px + tileSize * 0.72, py + tileSize * 0.56);
        ctx.stroke();
        break;
      }
      case 'wall': {
        // Staggered brickwork.
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
        ctx.lineWidth = 1;
        const midY = py + tileSize * 0.5;
        ctx.beginPath();
        ctx.moveTo(px, midY);
        ctx.lineTo(px + tileSize, midY);
        ctx.moveTo(px + tileSize * 0.5, py);
        ctx.lineTo(px + tileSize * 0.5, midY);
        ctx.moveTo(px + tileSize * 0.25, midY);
        ctx.lineTo(px + tileSize * 0.25, py + tileSize);
        ctx.moveTo(px + tileSize * 0.75, midY);
        ctx.lineTo(px + tileSize * 0.75, py + tileSize);
        ctx.stroke();
        break;
      }
      case 'mist': {
        // Soft drifting blobs.
        ctx.fillStyle = 'rgba(255, 255, 255, 0.06)';
        for (let i = 0; i < 3; i += 1) {
          const rx = tileHash(x * 3 + i, y + 7);
          const ry = tileHash(x + 7, y * 3 + i);
          ctx.beginPath();
          ctx.arc(px + tileSize * (0.2 + rx * 0.6), py + tileSize * (0.2 + ry * 0.6), tileSize * 0.18, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      }
      default: {
        // Open ground: scattered grit specks.
        ctx.fillStyle = isDark ? 'rgba(0, 0, 0, 0.13)' : 'rgba(120, 80, 40, 0.16)';
        for (let i = 0; i < 4; i += 1) {
          const rx = tileHash(x * 4 + i, y);
          const ry = tileHash(x, y * 4 + i);
          const r = tileSize * (0.03 + 0.03 * tileHash(x + i, y - i));
          ctx.beginPath();
          ctx.arc(px + tileSize * (0.15 + rx * 0.7), py + tileSize * (0.15 + ry * 0.7), r, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      }
    }
    ctx.restore();
  }

  // A flat dark canvas to sit behind the title screen before play begins.
  function drawEmpty() {
    ctx.fillStyle = '#020617';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  function draw(state, showMoves) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!state) {
      drawEmpty();
      return;
    }

    // Lock in the camera's on-screen scale for this frame, and compute the world
    // coordinate sitting at the top-left of the canvas.
    tileSize = currentTileSize();
    const viewTilesX = canvas.width / tileSize;
    const viewTilesY = canvas.height / tileSize;
    const originX = camera.x - viewTilesX / 2;
    const originY = camera.y - viewTilesY / 2;

    // Void beyond the board edges.
    ctx.fillStyle = '#020617';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const world = state.worldSize;
    const bounds = getVisibleBounds(state);
    const threatened = getThreatenedTiles(state);
    const visible = computeVisibleTiles(state);
    const lit = (x, y) => visible.has(`${x},${y}`) && terrainAt(state, x, y) !== 'mist';

    // Fog of war: ground the king has never seen on this floor stays hidden.
    const explored = state.explored || {};
    const isExplored = (x, y) => Boolean(explored[`${x},${y}`]);

    // Tiles the king can reach this turn, used both for the tints below and the
    // special jump / capture markers drawn later.
    const playerMoves = showMoves ? getPlayerMoves(state) : [];
    const reachable = new Set(playerMoves.map((move) => `${move.x},${move.y}`));

    ctx.save();
    if (shake > 0) {
      // Jitter the whole board while the shake decays.
      const t = shake / SHAKE_DURATION;
      const ox = (Math.random() * 2 - 1) * SHAKE_MAGNITUDE * t;
      const oy = (Math.random() * 2 - 1) * SHAKE_MAGNITUDE * t;
      ctx.translate(ox, oy);
    }
    // Shift world-space drawing into the camera's view; everything below now draws
    // at `tileX * tileSize` in world space, as before.
    ctx.translate(-originX * tileSize, -originY * tileSize);

    // Only the tiles that fall inside the viewport need drawing.
    const minX = Math.max(0, Math.floor(originX));
    const maxX = Math.min(world - 1, Math.floor(originX + viewTilesX));
    const minY = Math.max(0, Math.floor(originY));
    const maxY = Math.min(world - 1, Math.floor(originY + viewTilesY));

    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const px = x * tileSize;
        const py = y * tileSize;

        if (!isExplored(x, y)) {
          // Under the fog of war: terrain (and any shop / exit / item on it) is
          // entirely hidden until the king first lays eyes on this tile.
          ctx.fillStyle = '#05060a';
          ctx.fillRect(px, py, tileSize, tileSize);
          continue;
        }

        const inView = visible.has(`${x},${y}`);
        const isDark = (x + y) % 2 === 1;

        const type = terrainAt(state, x, y);
        ctx.fillStyle = terrainColor(type, isDark);
        ctx.fillRect(px, py, tileSize, tileSize);
        drawTexture(type, px, py, isDark, x, y);

        const threatCount = inView ? threatened.get(`${x},${y}`) || 0 : 0;
        const canMove = reachable.has(`${x},${y}`);
        if (canMove && threatCount > 0) {
          // Dangerous: the king can step here, but an enemy covers it too. Red,
          // deepening where more enemies converge.
          const alpha = Math.min(0.62, 0.32 + 0.12 * threatCount);
          ctx.fillStyle = `rgba(220, 38, 38, ${alpha})`;
          ctx.fillRect(px, py, tileSize, tileSize);
        } else if (canMove) {
          // Safe king move — light green.
          ctx.fillStyle = 'rgba(74, 222, 128, 0.35)';
          ctx.fillRect(px, py, tileSize, tileSize);
        } else if (threatCount > 0) {
          // Enemies cover this square but the king can't reach it — orange.
          const alpha = Math.min(0.6, 0.3 + 0.12 * threatCount);
          ctx.fillStyle = `rgba(249, 115, 22, ${alpha})`;
          ctx.fillRect(px, py, tileSize, tileSize);
        }

        if (!inView) {
          // Out of the king's line of sight: dim it and hide what lurks there.
          ctx.fillStyle = 'rgba(2, 6, 23, 0.64)';
          ctx.fillRect(px, py, tileSize, tileSize);
        }
      }
    }

    // Outline the king's field of view.
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = 2;
    ctx.strokeRect(bounds.x * tileSize, bounds.y * tileSize, bounds.width * tileSize, bounds.height * tileSize);

    // Exit and shop: shown when in sight, or faded once discovered.
    if (state.exit) {
      const seen = lit(state.exit.x, state.exit.y);
      if (seen || state.exit.discovered) {
        drawExit(state.exit.x, state.exit.y, !seen);
      }
    }
    if (state.shop) {
      const seen = lit(state.shop.x, state.shop.y);
      if (seen || state.shop.discovered) {
        drawShop(state.shop.x, state.shop.y, !seen);
      }
    }

    // Items are only visible inside the king's line of sight.
    for (const item of state.items) {
      if (lit(item.x, item.y)) {
        drawItem(item);
      }
    }

    // Plain moves are shown by the light-green tile tint above; here we only mark
    // the special cases: capture targets (ring) and knight-leap tiles (blue dot).
    for (const move of playerMoves) {
      if (move.capture || move.viaJump) {
        drawMoveHint(move.x, move.y, move.viaJump, move.capture);
      }
    }

    for (const enemy of enemyRenders) {
      if (!lit(enemy.targetX, enemy.targetY)) {
        continue; // Out of sight / hidden in mist.
      }
      drawPiece(enemy.x, enemy.y, enemy.kind, false);
      if (enemy.surprised) {
        drawSurpriseMark(enemy.x, enemy.y);
      }
    }

    drawPiece(playerRender.x, playerRender.y, 'king', true);

    ctx.restore();

    if (shake > 0) {
      // Red wash over the whole canvas, fading with the shake.
      const t = shake / SHAKE_DURATION;
      ctx.fillStyle = `rgba(220, 38, 38, ${0.5 * t})`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  }

  return { init, reset, sync, update, draw, hit, centerOn, panBy, zoomBy, screenToTile };
})();

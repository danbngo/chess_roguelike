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

  // Ever-increasing time accumulator, used for ambient animation (powerup glow).
  let clock = 0;

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

  // Drag the world by a canvas-space pixel delta (used by click-and-drag panning):
  // moving the cursor right slides the board right, so the camera shifts left.
  function panByPixels(dxPx, dyPx) {
    const ts = currentTileSize();
    camera.targetX -= dxPx / ts;
    camera.targetY -= dyPx / ts;
    camera.x -= dxPx / ts; // move immediately so the drag feels 1:1
    camera.y -= dyPx / ts;
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
      frustrated: Boolean(enemy.frustrated),
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
      render.frustrated = Boolean(enemy.frustrated);
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
    clock += delta; // drives the powerup glow pulse
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

  // A small glyph above a piece's head (surprise "!", frustration "✖", etc.).
  function drawStatusMark(tileX, tileY, glyph, color) {
    const cx = tileX * tileSize + tileSize / 2;
    const cy = tileY * tileSize + tileSize * 0.12;
    ctx.font = `bold ${tileSize * 0.55}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)';
    ctx.strokeText(glyph, cx, cy);
    ctx.fillStyle = color;
    ctx.fillText(glyph, cx, cy);
  }

  // A bright "!" above a piece that has just spotted the king.
  function drawSurpriseMark(tileX, tileY) {
    drawStatusMark(tileX, tileY, '!', '#ffd400');
  }

  // An orange "✖" above a hostile piece that has no legal move and fumes in place.
  function drawFrustratedMark(tileX, tileY) {
    drawStatusMark(tileX, tileY, '✖', '#fb923c');
  }

  // A cyan shield over the king while a Riposte ward is active.
  function drawWardMark(tileX, tileY) {
    const cx = tileX * tileSize + tileSize / 2;
    const top = tileY * tileSize + tileSize * 0.04;
    const w = tileSize * 0.3;
    const h = tileSize * 0.32;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cx - w / 2, top);
    ctx.lineTo(cx + w / 2, top);
    ctx.lineTo(cx + w / 2, top + h * 0.55);
    ctx.quadraticCurveTo(cx, top + h * 1.2, cx, top + h);
    ctx.quadraticCurveTo(cx, top + h * 1.2, cx - w / 2, top + h * 0.55);
    ctx.closePath();
    ctx.fillStyle = 'rgba(56, 189, 248, 0.9)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#0c4a6e';
    ctx.stroke();
    ctx.restore();
  }

  // The exit: a dark stairwell of pale steps receding downward.
  function drawExit(tileX, tileY, faded) {
    const px = tileX * tileSize;
    const py = tileY * tileSize;
    ctx.save();
    ctx.globalAlpha = faded ? 0.45 : 1;
    // Dark stairwell pit.
    ctx.fillStyle = '#0b1220';
    ctx.fillRect(px + tileSize * 0.14, py + tileSize * 0.14, tileSize * 0.72, tileSize * 0.72);
    // Four descending steps, each narrower and lower.
    ctx.fillStyle = '#7c93ad';
    for (let i = 0; i < 4; i += 1) {
      const inset = 0.18 + i * 0.07;
      const top = py + tileSize * (0.2 + i * 0.16);
      ctx.fillStyle = `rgb(${150 - i * 28}, ${168 - i * 30}, ${190 - i * 30})`;
      ctx.fillRect(px + tileSize * inset, top, tileSize * (1 - inset * 2), tileSize * 0.1);
    }
    ctx.restore();
  }

  // The weapon shop: a stall with two crossed swords.
  function drawWeaponShop(tileX, tileY, faded) {
    const px = tileX * tileSize;
    const py = tileY * tileSize;
    const cx = px + tileSize / 2;
    const cy = py + tileSize / 2;
    ctx.save();
    ctx.globalAlpha = faded ? 0.45 : 1;
    ctx.fillStyle = '#7c2d12';
    ctx.fillRect(px + tileSize * 0.12, py + tileSize * 0.12, tileSize * 0.76, tileSize * 0.76);
    // Awning stripe.
    ctx.fillStyle = '#b45309';
    ctx.fillRect(px + tileSize * 0.12, py + tileSize * 0.12, tileSize * 0.76, tileSize * 0.18);
    // Two crossed sword blades.
    ctx.translate(cx, cy + tileSize * 0.08);
    ctx.strokeStyle = '#e5e7eb';
    ctx.lineWidth = Math.max(2, tileSize * 0.06);
    ctx.lineCap = 'round';
    for (const dir of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(dir * tileSize * 0.22, tileSize * 0.18);
      ctx.lineTo(-dir * tileSize * 0.22, -tileSize * 0.22);
      ctx.stroke();
    }
    // Hilts.
    ctx.strokeStyle = '#facc15';
    ctx.lineWidth = Math.max(2, tileSize * 0.05);
    for (const dir of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(dir * tileSize * 0.14, tileSize * 0.1);
      ctx.lineTo(dir * tileSize * 0.26, tileSize * 0.22);
      ctx.stroke();
    }
    ctx.restore();
  }

  // The altar: a pale stone plinth with a glowing flame. Dimmed once spent.
  function drawAltar(tileX, tileY, faded, used) {
    const px = tileX * tileSize;
    const py = tileY * tileSize;
    ctx.save();
    ctx.globalAlpha = used ? 0.35 : faded ? 0.45 : 1;
    // Plinth base + top slab.
    ctx.fillStyle = used ? '#6b7280' : '#cbd5e1';
    ctx.fillRect(px + tileSize * 0.28, py + tileSize * 0.46, tileSize * 0.44, tileSize * 0.36);
    ctx.fillStyle = used ? '#9ca3af' : '#e2e8f0';
    ctx.fillRect(px + tileSize * 0.22, py + tileSize * 0.4, tileSize * 0.56, tileSize * 0.12);
    if (!used) {
      // A violet flame floating above it.
      const cx = px + tileSize / 2;
      const fy = py + tileSize * 0.36;
      ctx.beginPath();
      ctx.moveTo(cx, fy - tileSize * 0.22);
      ctx.quadraticCurveTo(cx + tileSize * 0.14, fy - tileSize * 0.02, cx, fy);
      ctx.quadraticCurveTo(cx - tileSize * 0.14, fy - tileSize * 0.02, cx, fy - tileSize * 0.22);
      ctx.fillStyle = '#a855f7';
      ctx.fill();
    }
    ctx.restore();
  }

  // Draw a pickup. `animated` items (in current view) pulse and glow; remembered
  // ones (out of view) are static and dimmed.
  function drawItem(item, animated) {
    const cx = item.x * tileSize + tileSize / 2;
    const cy = item.y * tileSize + tileSize / 2;
    const pulse = animated ? 0.5 + 0.5 * Math.sin(clock * 4 + (item.x + item.y)) : 0;
    ctx.save();
    if (!animated) {
      ctx.globalAlpha = 0.5;
    }
    ctx.shadowBlur = animated ? tileSize * (0.18 + 0.22 * pulse) : 0;
    if (item.kind === 'heart') {
      ctx.shadowColor = 'rgba(244, 114, 182, 0.9)';
      ctx.fillStyle = '#f472b6'; // pink
      ctx.font = `${tileSize * (0.58 + 0.06 * pulse)}px serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('♥', cx, cy + tileSize * 0.05);
    } else {
      ctx.shadowColor = 'rgba(251, 191, 36, 0.95)';
      ctx.beginPath();
      ctx.arc(cx, cy, tileSize * (0.24 + 0.03 * pulse), 0, Math.PI * 2);
      ctx.fillStyle = '#fbbf24';
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#b45309';
      ctx.stroke();
      ctx.fillStyle = '#7c4a03';
      ctx.font = `bold ${tileSize * 0.32}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('$', cx, cy);
    }
    ctx.restore();
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

  // A violet marker on tiles a card being aimed can reach (ring = capture).
  function drawCardHint(tileX, tileY, capture) {
    const cx = tileX * tileSize + tileSize / 2;
    const cy = tileY * tileSize + tileSize / 2;
    if (capture) {
      ctx.beginPath();
      ctx.arc(cx, cy, tileSize * 0.42, 0, Math.PI * 2);
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(216, 180, 254, 0.95)';
      ctx.stroke();
      return;
    }
    ctx.beginPath();
    ctx.arc(cx, cy, tileSize * 0.16, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(168, 85, 247, 0.85)';
    ctx.fill();
  }

  // A bright box around the tile the keyboard targeting cursor is on.
  function drawCardCursor(tileX, tileY) {
    const px = tileX * tileSize;
    const py = tileY * tileSize;
    ctx.save();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#f5d0fe';
    ctx.shadowColor = 'rgba(168, 85, 247, 0.9)';
    ctx.shadowBlur = tileSize * 0.3;
    ctx.strokeRect(px + 2, py + 2, tileSize - 4, tileSize - 4);
    ctx.restore();
  }

  // A fading blood spatter: a bright-red central splat plus a scatter of droplets
  // of varied size, alpha by remaining life.
  function drawSpatter(spatter) {
    const px = spatter.x * tileSize;
    const py = spatter.y * tileSize;
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, spatter.life / spatter.max)) * 0.85;
    ctx.fillStyle = '#c81e1e'; // vivid red
    // A central blob.
    ctx.beginPath();
    ctx.arc(px + tileSize * 0.5, py + tileSize * 0.5, tileSize * 0.2, 0, Math.PI * 2);
    ctx.fill();
    // Scattered droplets flung outward, deterministic per tile.
    for (let i = 0; i < 11; i += 1) {
      const rx = tileHash(spatter.x * 9 + i, spatter.y * 13 + 5);
      const ry = tileHash(spatter.x * 13 + 5, spatter.y * 9 + i);
      const r = tileSize * (0.02 + 0.07 * tileHash(spatter.x + i * 3, spatter.y - i));
      ctx.beginPath();
      ctx.arc(px + tileSize * (0.08 + rx * 0.84), py + tileSize * (0.08 + ry * 0.84), r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // Tile colors per terrain (two shades to keep the checkerboard feel). All kept
  // within a warm cream/tan/brown family — desaturated and fairly light — so the
  // green / red / orange move-and-threat tints overlay legibly on every tile.
  function terrainColor(type, isDark) {
    switch (type) {
      case 'ice':
        return isDark ? '#c2cccc' : '#e0e7e3'; // pale frost
      case 'water':
        return isDark ? '#2f5d78' : '#386b8a'; // deep, impassable blue
      case 'mud':
        return isDark ? '#5a4a30' : '#6e5a3c'; // murky brown
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
        ctx.strokeStyle = 'rgba(220, 240, 255, 0.18)';
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
      case 'mud': {
        // Murky bubbles.
        ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
        for (let i = 0; i < 4; i += 1) {
          const rx = tileHash(x * 6 + i, y + 2);
          const ry = tileHash(x + 2, y * 6 + i);
          ctx.beginPath();
          ctx.arc(px + tileSize * (0.2 + rx * 0.6), py + tileSize * (0.2 + ry * 0.6), tileSize * (0.05 + 0.05 * rx), 0, Math.PI * 2);
          ctx.fill();
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

  function draw(state, showMoves, cardTargets, cardCursor) {
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

    // Blood spatters on explored ground, fading with each turn.
    for (const spatter of state.spatters || []) {
      if (isExplored(spatter.x, spatter.y)) {
        drawSpatter(spatter);
      }
    }

    // Exit, altar and weapon shop: shown when in sight, or faded once discovered.
    if (state.exit) {
      const seen = lit(state.exit.x, state.exit.y);
      if (seen || state.exit.discovered) {
        drawExit(state.exit.x, state.exit.y, !seen);
      }
    }
    if (state.altar) {
      const seen = lit(state.altar.x, state.altar.y);
      if (seen || state.altar.discovered) {
        drawAltar(state.altar.x, state.altar.y, !seen, state.altar.used);
      }
    }
    if (state.weaponShop) {
      const seen = lit(state.weaponShop.x, state.weaponShop.y);
      if (seen || state.weaponShop.discovered) {
        drawWeaponShop(state.weaponShop.x, state.weaponShop.y, !seen);
      }
    }

    // Live items in current view: drawn from reality, animated.
    for (const item of state.items) {
      if (lit(item.x, item.y)) {
        drawItem(item, true);
      }
    }
    // Remembered items the king saw earlier, on explored ground he can't currently
    // see: drawn static and dim. They may be stale (trampled while out of view).
    const memory = state.itemMemory || {};
    for (const key in memory) {
      const [mx, my] = key.split(',').map(Number);
      if (isExplored(mx, my) && !lit(mx, my)) {
        drawItem({ x: mx, y: my, kind: memory[key].kind, amount: memory[key].amount }, false);
      }
    }

    // While aiming a card, show its reachable tiles in violet; otherwise the plain
    // moves are the light-green tint above and we only mark the special cases:
    // capture targets (ring) and knight-leap tiles (blue dot).
    if (cardTargets) {
      for (const target of cardTargets) {
        drawCardHint(target.x, target.y, target.capture);
      }
      if (cardCursor) {
        drawCardCursor(cardCursor.x, cardCursor.y);
      }
    } else {
      for (const move of playerMoves) {
        if (move.capture || move.viaJump) {
          drawMoveHint(move.x, move.y, move.viaJump, move.capture);
        }
      }
    }

    // Visible enemies, with those currently mid-move (e.g. a knight in the middle
    // of a leap) drawn last so they ride visibly over the pieces they pass over.
    const visibleEnemies = enemyRenders.filter((enemy) => lit(enemy.targetX, enemy.targetY));
    const isMoving = (enemy) => Math.abs(enemy.x - enemy.targetX) + Math.abs(enemy.y - enemy.targetY) > 0.05;
    const ordered = [...visibleEnemies.filter((enemy) => !isMoving(enemy)), ...visibleEnemies.filter(isMoving)];
    for (const enemy of ordered) {
      drawPiece(enemy.x, enemy.y, enemy.kind, false);
      if (enemy.surprised) {
        drawSurpriseMark(enemy.x, enemy.y);
      } else if (enemy.frustrated) {
        drawFrustratedMark(enemy.x, enemy.y);
      }
    }

    drawPiece(playerRender.x, playerRender.y, 'king', true);
    if (state.player.warded) {
      drawWardMark(playerRender.x, playerRender.y);
    }

    ctx.restore();

    if (shake > 0) {
      // Red wash over the whole canvas, fading with the shake.
      const t = shake / SHAKE_DURATION;
      ctx.fillStyle = `rgba(220, 38, 38, ${0.5 * t})`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  }

  return { init, reset, sync, update, draw, hit, centerOn, panBy, panByPixels, zoomBy, screenToTile };
})();

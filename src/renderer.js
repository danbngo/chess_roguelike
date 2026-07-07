// All canvas drawing and the smooth piece-movement animation. Keeps its own
// private "render entity" positions that ease toward the logical tile targets.

const Renderer = (function () {
  let ctx = null;
  let canvas = null;
  let tileSize = 0;
  let miniCanvas = null; // the dedicated bottom-right minimap canvas (screen-fixed)
  let miniCtx = null;

  let playerRender = { x: 0, y: 0, targetX: 0, targetY: 0 };
  let enemyRenders = [];

  // Hit feedback: a brief screen shake + colored full-screen flash, easing out.
  let shake = 0;
  let flash = 0; // 0 -> 1, decays each frame
  let flashColor = '220, 38, 38';
  let flashPeak = 0.5; // max wash opacity for the current flash
  const SHAKE_DURATION = 0.4;
  const SHAKE_MAGNITUDE = 9;
  const FLASH_DURATION = 0.5;

  // Feedback presets: each fires a tinted flash (and, for impacts, a shake).
  const EFFECTS = {
    hit: { color: '220, 38, 38', peak: 0.5, shake: SHAKE_DURATION }, // red
    deflect: { color: '125, 211, 252', peak: 0.4, shake: SHAKE_DURATION * 0.4 }, // sky blue — blocked
    death: { color: '153, 27, 27', peak: 0.85, shake: SHAKE_DURATION * 1.8 }, // deep crimson
    kill: { color: '248, 250, 252', peak: 0.18, shake: SHAKE_DURATION * 0.45 }, // pale impact
    heal: { color: '74, 222, 128', peak: 0.6, shake: SHAKE_DURATION * 0.3 }, // bright green — a quaff
    trap: { color: '217, 119, 6', peak: 0.55, shake: SHAKE_DURATION }, // amber — a trap erupts
    powerup: { color: '168, 85, 247', peak: 0.45, shake: 0 }, // violet (level-up)
    victory: { color: '234, 179, 8', peak: 0.7, shake: 0 }, // gold
  };

  // Ever-increasing time accumulator, used for ambient animation (powerup glow).
  let clock = 0;

  // In-flight ranged projectiles (turret / boss bolts), each easing from a source
  // tile to a target tile over its lifetime.
  let projectiles = [];
  const PROJECTILE_TIME = 0.16;
  const PROJECTILE_COLOR = { turret: '#e0894b', boss: '#ffe9a8' };

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
    miniCanvas = typeof document !== 'undefined' ? document.getElementById('minimap') : null;
    miniCtx = miniCanvas ? miniCanvas.getContext('2d') : null;
    // Two tiles' worth bigger than the old full-board fit: the default view spans
    // half the world (WORLD_SIZE / 2 tiles across the canvas).
    baseTile = canvasEl.width / (WORLD_SIZE / 2);
    tileSize = baseTile * camera.zoom;
  }

  // Fire a feedback effect by name (see EFFECTS): a tinted flash and optional shake.
  function effect(kind) {
    const e = EFFECTS[kind];
    if (!e) return;
    flash = 1;
    flashColor = e.color;
    flashPeak = e.peak;
    if (e.shake) {
      shake = Math.max(shake, e.shake);
    }
  }

  // Back-compat: a plain on-hit shake/flash.
  function hit() {
    effect('hit');
  }

  // Launch an animated bolt from one tile to another (ranged enemy attacks).
  function rangedShot(fromX, fromY, toX, toY, role) {
    projectiles.push({ fromX, fromY, toX, toY, t: 0, color: PROJECTILE_COLOR[role] || '#ffffff' });
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
      awake: Boolean(enemy.awake),
      charged: enemy.charged !== false,
      role: typeof enemyRole === 'function' ? enemyRole(enemy) : 'normal',
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
      render.awake = Boolean(enemy.awake);
      render.charged = enemy.charged !== false;
      render.role = typeof enemyRole === 'function' ? enemyRole(enemy) : 'normal';
      render.boss = Boolean(enemy.boss);
      render.hp = enemy.hp;
      render.maxHp = enemy.maxHp;
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
    if (flash > 0) {
      flash = Math.max(0, flash - delta / FLASH_DURATION);
    }
    if (projectiles.length) {
      for (const p of projectiles) p.t += delta / PROJECTILE_TIME;
      projectiles = projectiles.filter((p) => p.t < 1);
    }
  }

  function drawPiece(tileX, tileY, kind, isPlayer, opts) {
    const o = opts || {};
    const role = o.role || 'normal';
    const cx = tileX * tileSize + tileSize / 2;
    const cy = tileY * tileSize + tileSize / 2;
    const radius = tileSize * (role === 'boss' ? 0.46 : 0.4);

    ctx.save();
    // Spent (recharging) casters are faded.
    if (o.inactive) ctx.globalAlpha = 0.4;

    // Token body / outline, tinted by special role / class / allegiance.
    let fill = isPlayer ? '#f7e7b8' : '#111118';
    let stroke = isPlayer ? '#8a6a26' : '#dadada';
    let glyph = isPlayer ? '#3a2c0a' : '#f3f1e7';
    if (isPlayer && o.classColor) {
      stroke = o.classColor; // the king's outline is tinted by his class
    }
    if (role === 'statue') {
      fill = '#5b6470'; // dull stone
      stroke = '#8b95a3';
      glyph = '#cdd5df';
    } else if (role === 'turret') {
      fill = '#2c2f3a'; // dark steel
      stroke = '#e0894b'; // warm danger ring
      glyph = '#f1c9a0';
    } else if (role === 'boss') {
      fill = '#1a0f1f'; // deep royal
      stroke = '#e0b341'; // gold
      glyph = '#ffe9a8';
    } else if (role === 'circle') {
      fill = '#241733'; // arcane violet — a summoning circle
      stroke = '#a855f7';
      glyph = '#e9d5ff';
    }

    // Boss aura: a soft gold outer ring.
    if (role === 'boss') {
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, radius + tileSize * 0.12, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(224, 179, 65, 0.85)';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.restore();
    }

    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineWidth = role === 'boss' || (isPlayer && o.classColor) ? 3 : 2;
    ctx.strokeStyle = stroke;
    ctx.stroke();

    ctx.fillStyle = glyph;
    ctx.font = `${tileSize * 0.62}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(getPieceLabel(kind), cx, cy + tileSize * 0.04);
    ctx.restore();
  }

  // At-a-glance ROLE indicator: a colored cap sitting atop the piece token.
  const ROLE_HAT = {
    statue: '#94a3b8', // stone
    turret: '#e0894b', // rust
    boss: '#e0b341', // gold
    circle: '#a855f7', // arcane violet
  };
  function drawRoleHat(tileX, tileY, role) {
    const color = ROLE_HAT[role];
    if (!color) return;
    const cx = tileX * tileSize + tileSize / 2;
    const topY = tileY * tileSize + tileSize * 0.14;
    const w = tileSize * 0.34;
    ctx.save();
    // A little peaked cap with a brim.
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(cx, topY - tileSize * 0.06);
    ctx.lineTo(cx - w / 2, topY + tileSize * 0.12);
    ctx.lineTo(cx + w / 2, topY + tileSize * 0.12);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(cx - w * 0.62, topY + tileSize * 0.1, w * 1.24, tileSize * 0.05);
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }

  // A boss's HP bar, hovering just below its token.
  function drawBossHpBar(tileX, tileY, hp, maxHp) {
    const frac = Math.max(0, Math.min(1, hp / maxHp));
    const w = tileSize * 0.72;
    const h = tileSize * 0.09;
    const x = tileX * tileSize + (tileSize - w) / 2;
    const y = tileY * tileSize + tileSize * 0.86;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
    ctx.fillStyle = '#3a0d0d';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = frac > 0.5 ? '#e0b341' : frac > 0.25 ? '#e07a2b' : '#dc2626';
    ctx.fillRect(x, y, w * frac, h);
    ctx.restore();
  }

  // At-a-glance STATE icon above a piece: surprise, hostility, or frustration.
  // (Sleeping / wandering pieces are out of sight, so they are never drawn.)
  function drawStateIcon(tileX, tileY, mainState) {
    // Hostile is the default state (no icon, to avoid clutter). Only the transient
    // surprised / frustrated states show a mark.
    if (mainState === 'surprised') {
      drawStatusMark(tileX, tileY, '!', '#ffd400');
    } else if (mainState === 'frustrated') {
      drawStatusMark(tileX, tileY, '✖', '#fca5a5');
    }
  }

  // Draw drifting fog clouds (from a Fog Scroll) over their tiles.
  // Draw the in-flight ranged bolts (world space).
  function drawProjectiles() {
    for (const p of projectiles) {
      const x = (p.fromX + (p.toX - p.fromX) * p.t + 0.5) * tileSize;
      const y = (p.fromY + (p.toY - p.fromY) * p.t + 0.5) * tileSize;
      ctx.save();
      ctx.shadowBlur = tileSize * 0.3;
      ctx.shadowColor = p.color;
      ctx.beginPath();
      ctx.arc(x, y, tileSize * 0.13, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.fill();
      ctx.restore();
    }
  }

  // A small state glyph (surprise "!", frustration "✖", etc.) in the piece's
  // TOP-RIGHT corner — clear of the top-centre role hat, so a unit's state never
  // hides its role.
  function drawStatusMark(tileX, tileY, glyph, color) {
    const cx = tileX * tileSize + tileSize * 0.8;
    const cy = tileY * tileSize + tileSize * 0.2;
    ctx.font = `bold ${tileSize * 0.44}px sans-serif`;
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
  function drawExit(tileX, tileY, faded, locked) {
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
    // A barred stair (boss-locked) is crossed by heavy crimson bars.
    if (locked) {
      ctx.strokeStyle = '#dc2626';
      ctx.lineWidth = Math.max(2, tileSize * 0.08);
      ctx.lineCap = 'round';
      for (let i = 0; i < 3; i += 1) {
        const bx = px + tileSize * (0.26 + i * 0.24);
        ctx.beginPath();
        ctx.moveTo(bx, py + tileSize * 0.16);
        ctx.lineTo(bx, py + tileSize * 0.84);
        ctx.stroke();
      }
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
    if (item.kind === 'consumable') {
      const info = (typeof CONSUMABLES !== 'undefined' && CONSUMABLES[item.potion]) || { glyph: '!', color: '#f472b6' };
      ctx.shadowColor = info.color;
      ctx.fillStyle = info.color;
      ctx.font = `${tileSize * (0.56 + 0.06 * pulse)}px serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(info.glyph, cx, cy + tileSize * 0.05);
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

  // A permanent scar left on the ground: a shattered summoning circle, or a sprung
  // trap. Drawn dim when only remembered, brighter while in sight.
  function drawScar(scar, faded) {
    const cx = scar.x * tileSize + tileSize / 2;
    const cy = scar.y * tileSize + tileSize / 2;
    const r = tileSize * 0.34;
    ctx.save();
    ctx.globalAlpha = faded ? 0.4 : 0.8;
    ctx.lineWidth = Math.max(1.5, tileSize * 0.05);
    if (scar.kind === 'circle') {
      // A broken violet ring — the ruin of a summoning circle.
      ctx.strokeStyle = '#7c5cbf';
      for (let i = 0; i < 4; i += 1) {
        const a0 = (i / 4) * Math.PI * 2 + 0.25;
        ctx.beginPath();
        ctx.arc(cx, cy, r, a0, a0 + Math.PI * 0.35);
        ctx.stroke();
      }
    } else {
      // A sprung trap — jagged X of scorched marks.
      ctx.strokeStyle = '#d97706';
      ctx.beginPath();
      ctx.moveTo(cx - r, cy - r); ctx.lineTo(cx + r, cy + r);
      ctx.moveTo(cx + r, cy - r); ctx.lineTo(cx - r, cy + r);
      ctx.stroke();
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
      case 'lava':
        return isDark ? '#7a1f10' : '#a6321a'; // molten rock
      case 'water':
        return isDark ? '#1e4d6b' : '#2f6f97'; // deep water
      case 'wall':
        return isDark ? '#5a4f45' : '#6b5e52'; // warm brown stone
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
      case 'lava': {
        // Glowing molten cracks.
        ctx.strokeStyle = 'rgba(255, 196, 90, 0.7)';
        ctx.lineWidth = 1.5;
        for (let i = 1; i <= 2; i += 1) {
          const ly = py + tileSize * (0.28 * i + 0.12);
          ctx.beginPath();
          ctx.moveTo(px + tileSize * 0.12, ly);
          ctx.quadraticCurveTo(px + tileSize * 0.5, ly - tileSize * 0.09, px + tileSize * 0.88, ly);
          ctx.stroke();
        }
        break;
      }
      case 'water': {
        // Gentle ripples catching the light.
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
        ctx.lineWidth = 1;
        for (let i = 1; i <= 2; i += 1) {
          const wy = py + tileSize * (0.3 * i + 0.1);
          ctx.beginPath();
          ctx.moveTo(px + tileSize * 0.15, wy);
          ctx.quadraticCurveTo(px + tileSize * 0.5, wy + tileSize * 0.08, px + tileSize * 0.85, wy);
          ctx.stroke();
        }
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

  // Mark a tile with an OPAQUE box outline hugging its inner edge, in a solid colour,
  // instead of a translucent wash — so the marker reads the same over any terrain and
  // leaves the tile itself fully visible. `strength` (>= 1) thickens the border where
  // more enemies converge.
  function tileOutline(px, py, color, strength) {
    ctx.save();
    ctx.globalAlpha = 1; // fully opaque — never tinted by the background tile
    ctx.strokeStyle = color;
    const lw = Math.min(tileSize * 0.16, Math.max(1.5, tileSize * 0.06) * (1 + 0.3 * ((strength || 1) - 1)));
    ctx.lineWidth = lw;
    const inset = lw / 2 + 0.5; // sit just inside the tile so the whole edge shows
    ctx.strokeRect(px + inset, py + inset, tileSize - inset * 2, tileSize - inset * 2);
    ctx.restore();
  }

  // A flat dark canvas to sit behind the title screen before play begins.
  function drawEmpty() {
    ctx.fillStyle = '#020617';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  // A whole-level minimap drawn onto its own screen-fixed canvas (bottom-right of
  // the viewport). Shows explored terrain (dim when only remembered, bright while
  // in sight — so fog of war reads clearly), discovered features, and green/red
  // blips for the king and any foes currently in view.
  function drawMinimap(state) {
    if (!miniCtx || !miniCanvas) return;
    const W = miniCanvas.width;
    const H = miniCanvas.height;
    miniCtx.clearRect(0, 0, W, H);
    if (!state || !state.player) return;

    const world = state.worldSize || WORLD_SIZE;
    const cell = Math.min(W, H) / world; // the whole level fits, square
    const ox = (W - cell * world) / 2; // center the map if the canvas isn't square
    const oy = (H - cell * world) / 2;

    // Backing (also the colour of unexplored/void tiles).
    miniCtx.fillStyle = 'rgba(2, 6, 23, 0.92)';
    miniCtx.fillRect(0, 0, W, H);

    const explored = state.explored || {};
    const visible = computeVisibleTiles(state);
    const fill = (x, y) => miniCtx.fillRect(ox + x * cell, oy + y * cell, cell + 0.6, cell + 0.6);

    // Terrain: remembered tiles dim, in-sight tiles bright; unexplored stays void.
    for (let y = 0; y < world; y += 1) {
      for (let x = 0; x < world; x += 1) {
        const key = `${x},${y}`;
        if (!explored[key]) continue; // fog of war — never seen
        const seen = visible.has(key);
        miniCtx.globalAlpha = seen ? 1 : 0.5;
        miniCtx.fillStyle = terrainColor(terrainAt(state, x, y), !seen);
        fill(x, y);
      }
    }
    miniCtx.globalAlpha = 1;

    // Interesting features (once discovered), as distinct coloured cells.
    const feature = (f, color) => {
      if (!f || !f.discovered) return;
      miniCtx.fillStyle = color;
      fill(f.x, f.y);
    };
    feature(state.exit, '#38bdf8'); // stair down — cyan
    // Permanent scars on explored ground: shattered circles (violet) / sprung traps (amber).
    for (const scar of state.scars || []) {
      if (!(state.explored || {})[`${scar.x},${scar.y}`]) continue;
      miniCtx.fillStyle = scar.kind === 'circle' ? '#7c5cbf' : '#d97706';
      fill(scar.x, scar.y);
    }

    // Blips: the king (green) and any foes currently in sight (red).
    const blip = (x, y, color, r) => {
      miniCtx.fillStyle = color;
      miniCtx.beginPath();
      miniCtx.arc(ox + (x + 0.5) * cell, oy + (y + 0.5) * cell, r, 0, Math.PI * 2);
      miniCtx.fill();
    };
    const r = Math.max(1.4, cell * 0.42);
    for (const e of state.enemies || []) {
      if (visible.has(`${e.x},${e.y}`)) blip(e.x, e.y, '#ef4444', r);
    }
    blip(state.player.x, state.player.y, '#22c55e', r + 0.7);

    // A faint frame marking the slice of the level currently on screen.
    const b = getVisibleBounds(state);
    miniCtx.strokeStyle = 'rgba(226, 232, 240, 0.55)';
    miniCtx.lineWidth = 1;
    miniCtx.strokeRect(ox + b.x * cell, oy + b.y * cell, b.width * cell, b.height * cell);
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
    const lit = (x, y) => visible.has(`${x},${y}`);

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
        const isKingTile = x === state.player.x && y === state.player.y;
        // Markers are drawn as an opaque box outline (not a translucent wash) so the
        // tile stays fully visible and the colour never blends with the ground.
        if ((canMove || isKingTile) && threatCount > 0) {
          // RED — you get hit if you move onto (or stand on) this tile; the king's
          // OWN square counts. Thicker where more enemies converge.
          tileOutline(px, py, '#ef4444', threatCount);
        } else if (canMove) {
          // GREEN — a safe tile the king can move to.
          tileOutline(px, py, '#22c55e', 1);
        } else if (threatCount > 0) {
          // ORANGE — enemies cover this square but the king can't reach it.
          tileOutline(px, py, '#f97316', threatCount);
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

    // The stair down: shown when in sight, or faded once discovered.
    if (state.exit) {
      const seen = lit(state.exit.x, state.exit.y);
      if (seen || state.exit.discovered) {
        drawExit(state.exit.x, state.exit.y, !seen, state.exit.locked);
      }
    }

    // Permanent scars (shattered circles, sprung traps): shown forever once their
    // tile has been explored.
    for (const scar of state.scars || []) {
      if (isExplored(scar.x, scar.y)) drawScar(scar, !lit(scar.x, scar.y));
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
        drawItem({ x: mx, y: my, kind: memory[key].kind, amount: memory[key].amount, potion: memory[key].potion }, false);
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
      const role = enemy.role || 'normal';
      // A summoning circle that is spent (recharging) can't conjure next turn —
      // drawn faded so the player can read who is dangerous this turn.
      const inactive = role === 'circle' && !enemy.charged;
      drawPiece(enemy.x, enemy.y, enemy.kind, false, { role, inactive });
      if (role !== 'normal') {
        drawRoleHat(enemy.x, enemy.y, role);
      }
      // A boss wears a HP bar so the multi-hit fight has a readable state.
      if (enemy.boss && enemy.maxHp) {
        drawBossHpBar(enemy.x, enemy.y, enemy.hp, enemy.maxHp);
      }
      // Main-AI-state icon (statues / turrets / circles stay put, so show none).
      if (role !== 'statue' && role !== 'turret' && role !== 'circle') {
        const mainState = enemy.surprised ? 'surprised' : enemy.frustrated ? 'frustrated' : enemy.awake ? 'hostile' : null;
        if (mainState) drawStateIcon(enemy.x, enemy.y, mainState);
      }
    }

    const classColor =
      typeof highestClass === 'function' && typeof CLASSES !== 'undefined'
        ? (CLASSES[highestClass(state.player)] || {}).color
        : null;
    drawPiece(playerRender.x, playerRender.y, 'king', true, { classColor });
    if (state.player.warded) {
      drawWardMark(playerRender.x, playerRender.y);
    }

    drawProjectiles();

    ctx.restore();

    if (flash > 0) {
      // A tinted wash over the whole canvas, fading out (color set by effect()).
      ctx.fillStyle = `rgba(${flashColor}, ${flashPeak * flash})`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    drawMinimap(state); // whole-level overview, bottom-right (over the hit flash)
  }

  return { init, reset, sync, update, draw, hit, effect, rangedShot, centerOn, panBy, panByPixels, zoomBy, screenToTile };
})();

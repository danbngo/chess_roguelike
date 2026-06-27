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

  function init(canvasEl) {
    canvas = canvasEl;
    ctx = canvasEl.getContext('2d');
    tileSize = canvasEl.width / WORLD_SIZE;
  }

  // Kick off the on-hit shake/flash.
  function hit() {
    shake = SHAKE_DURATION;
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

    const world = state.worldSize;
    const bounds = getVisibleBounds(state);
    const threatened = getThreatenedTiles(state);

    ctx.save();
    if (shake > 0) {
      // Jitter the whole board while the shake decays.
      const t = shake / SHAKE_DURATION;
      const ox = (Math.random() * 2 - 1) * SHAKE_MAGNITUDE * t;
      const oy = (Math.random() * 2 - 1) * SHAKE_MAGNITUDE * t;
      ctx.translate(ox, oy);
    }

    for (let y = 0; y < world; y += 1) {
      for (let x = 0; x < world; x += 1) {
        const px = x * tileSize;
        const py = y * tileSize;
        const inView = isWithinBounds(bounds, x, y);
        const isDark = (x + y) % 2 === 1;

        ctx.fillStyle = isDark ? '#6b4a2b' : '#e9cfa0';
        ctx.fillRect(px, py, tileSize, tileSize);

        const threatCount = inView ? threatened.get(`${x},${y}`) || 0 : 0;
        if (threatCount > 0) {
          // Deeper red where more enemies cover the same square.
          const alpha = Math.min(0.78, 0.27 + 0.15 * threatCount);
          ctx.fillStyle = `rgba(220, 38, 38, ${alpha})`;
          ctx.fillRect(px, py, tileSize, tileSize);
        }

        if (!inView) {
          // Beyond the king's sight: dim the tiles and hide whatever lurks there.
          ctx.fillStyle = 'rgba(2, 6, 23, 0.64)';
          ctx.fillRect(px, py, tileSize, tileSize);
        }
      }
    }

    // Outline the king's field of view.
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = 2;
    ctx.strokeRect(bounds.x * tileSize, bounds.y * tileSize, bounds.width * tileSize, bounds.height * tileSize);

    // Exit and shop: shown in view, or faded once discovered.
    if (state.exit) {
      const visible = isWithinBounds(bounds, state.exit.x, state.exit.y);
      if (visible || state.exit.discovered) {
        drawExit(state.exit.x, state.exit.y, !visible);
      }
    }
    if (state.shop) {
      const visible = isWithinBounds(bounds, state.shop.x, state.shop.y);
      if (visible || state.shop.discovered) {
        drawShop(state.shop.x, state.shop.y, !visible);
      }
    }

    // Items are only visible inside the king's sight.
    for (const item of state.items) {
      if (isWithinBounds(bounds, item.x, item.y)) {
        drawItem(item);
      }
    }

    // Where the king can move this turn.
    if (showMoves) {
      for (const move of getPlayerMoves(state)) {
        drawMoveHint(move.x, move.y, move.viaJump, move.capture);
      }
    }

    for (const enemy of enemyRenders) {
      if (!isWithinBounds(bounds, enemy.targetX, enemy.targetY)) {
        continue; // Hidden in the fog.
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

  return { init, reset, sync, update, draw, hit };
})();

// All canvas drawing and the smooth piece-movement animation. Keeps its own
// private "render entity" positions that ease toward the logical tile targets.

const Renderer = (function () {
  let ctx = null;
  let canvas = null;
  let tileSize = 0;
  let miniCanvas = null; // the dedicated bottom-right minimap canvas (screen-fixed)
  let miniCtx = null;
  let miniGeom = null; // last-drawn minimap geometry {cell, ox, oy, world} — maps a minimap pixel to a tile
  let demonRealm = false; // floor >= DEMON_FLOOR: the ground turns to dark RED MARBLE

  let playerRender = { x: 0, y: 0, targetX: 0, targetY: 0 };
  let enemyRenders = [];
  let allyRenders = []; // the king's summons — eased like enemies (they used to snap)
  let puffs = []; // purple-smoke death puffs for vanished allies (client-side, time-decayed)
  const PUFF_TIME = 5; // seconds a death/summon smoke puff takes to dissipate (lingers ~4x longer)
  let shouts = []; // { x, y, text, t } — a boss's one-turn battle-cry speech bubble (client-side)
  const SHOUT_TIME = 1.6; // seconds the bubble lingers before it fades
  let boulderRenders = []; // { x, y, targetX, targetY, angle, targetAngle } — boulders ROLL + spin as they move
  let lungePoint = null; // the king POUNCES onto this tile first, then eases to his real target (leap-onto-foe bounce)

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
    powerup: { color: '74, 222, 128', peak: 0.55, shake: 0 }, // a perk taken — recoloured per-cast to the subclass's colour (green is only the fallback)
    key: { color: '250, 204, 21', peak: 0.6, shake: 0 }, // yellow — floor key collected
    victory: { color: '234, 179, 8', peak: 0.7, shake: 0 }, // gold
    danger: { color: '120, 20, 20', peak: 0.32, shake: SHAKE_DURATION * 1.1 }, // a danger event: gentler rumble + a colour tint (the hue is overridden per event so the player reads which one)
  };

  // Ever-increasing time accumulator, used for ambient animation (powerup glow).
  let clock = 0;

  // In-flight ranged projectiles (turret / boss bolts), each easing from a source
  // tile to a target tile over its lifetime.
  let projectiles = [];
  // Spell fireballs bloom on every tile they scorch — each impact is a short-lived burst.
  let bursts = [];
  const PROJECTILE_TIME = 0.16;
  const BURST_TIME = 0.3;
  const PROJECTILE_COLOR = { turret: '#e0894b', boss: '#ffe9a8', arrow: '#d9f99d', bolt: '#c4b5fd', fireball: '#fb923c' };

  // Blood-speck layout on a piece token, as [x, y, size] fractions of the body radius.
  // Ordered so a lightly-stained piece shows the first few and a drenched one shows them
  // all (the count scales with a unit's blood; see drawPiece).
  const BLOOD_SPECKS = [
    [-0.34, -0.30, 0.15], [0.30, -0.16, 0.11], [0.12, 0.32, 0.13],
    [-0.16, 0.10, 0.09], [0.40, 0.24, 0.10], [-0.44, 0.18, 0.08],
    [0.02, -0.42, 0.10], [-0.06, -0.04, 0.12], [0.28, 0.00, 0.08],
    [-0.28, -0.04, 0.09],
  ];

  // How bloodied to draw a piece (0..1). HP-bearing pieces (king, bosses, turrets) show
  // WOUNDS scaled to their missing HP — so the gore worsens as they near death and recedes
  // when they heal. Everything else wears the fading combat stain it accumulated.
  function woundBlood(unit) {
    if (!unit) return 0;
    if (unit.maxHp) return Math.max(0, Math.min(1, 1 - unit.hp / unit.maxHp));
    return unit.blood || 0;
  }

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

  // A '#rrggbb' hex to an 'r, g, b' triplet (the format EFFECTS colours use). Passes a
  // triplet straight through so either form works as a colour override.
  function toRgbTriplet(color) {
    if (typeof color !== 'string') return null;
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color.trim());
    if (!m) return color; // already 'r, g, b' (or something else — leave as-is)
    return `${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}`;
  }

  // Pick a legible ink (near-black or near-white) for a glyph drawn on a '#rrggbb' fill,
  // by the fill's perceived luminance.
  function contrastInk(color) {
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec((color || '').trim());
    if (!m) return '#fbf8ef';
    const r = parseInt(m[1], 16);
    const g = parseInt(m[2], 16);
    const b = parseInt(m[3], 16);
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return lum > 0.62 ? '#1c1c22' : '#fbf8ef';
  }

  // Fire a feedback effect by name (see EFFECTS): a tinted flash and optional shake.
  // An optional colorOverride ('#rrggbb' or 'r, g, b') recolours just this flash — used
  // so a perk-taken flash wears the colour of the subclass it belongs to.
  function effect(kind, colorOverride) {
    const e = EFFECTS[kind];
    if (!e) return;
    flash = 1;
    flashColor = colorOverride ? toRgbTriplet(colorOverride) : e.color;
    flashPeak = e.peak;
    if (e.shake) {
      shake = Math.max(shake, e.shake);
    }
  }

  // Back-compat: a plain on-hit shake/flash.
  function hit() {
    effect('hit');
  }

  // Launch an animated projectile from one tile to another (ranged/spell attacks).
  // A fireball (spell) also blooms on every `tiles` entry, staggered so the burst on
  // each tile fires as the fireball sweeps across it.
  function rangedShot(fromX, fromY, toX, toY, role, tiles) {
    const color = PROJECTILE_COLOR[role] || '#ffffff';
    projectiles.push({ fromX, fromY, toX, toY, t: 0, role, color });
    if (role === 'fireball' && Array.isArray(tiles) && tiles.length) {
      const total = Math.max(1, Math.hypot(toX - fromX, toY - fromY));
      for (const tile of tiles) {
        const frac = Math.min(1, Math.hypot(tile.x - fromX, tile.y - fromY) / total);
        bursts.push({ x: tile.x, y: tile.y, t: 0, delay: frac * PROJECTILE_TIME, color });
      }
    } else if (role === 'turret' || role === 'boss' || role === 'bolt') {
      // A single-target energy bolt blooms a small impact spark where it lands, timed to hit as the
      // slug arrives — so a turret/boss shot clearly READS as a shot that connects.
      bursts.push({ x: toX, y: toY, t: 0, delay: PROJECTILE_TIME, color });
    }
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

  // Convert a minimap-canvas pixel (in the minimap's own backing-pixel space) to the world tile
  // under it, or null if the click landed off the mapped area. Uses the geometry the last
  // drawMinimap laid down so it always matches what's on screen.
  function minimapToTile(px, py) {
    if (!miniGeom) return null;
    const { cell, ox, oy, world } = miniGeom;
    const x = Math.floor((px - ox) / cell);
    const y = Math.floor((py - oy) / cell);
    if (x < 0 || x >= world || y < 0 || y >= world) return null;
    return { x, y };
  }

  // Center the view on a world tile IMMEDIATELY (used by minimap click-and-drag): the clicked tile
  // snaps to the middle of the screen so the drag tracks the cursor 1:1, kept on-board.
  function centerCameraOn(x, y) {
    camera.targetX = x + 0.5;
    camera.targetY = y + 0.5;
    clampCamera();
    camera.x = camera.targetX;
    camera.y = camera.targetY;
  }

  // A "bump": the king tried to step into a wall/impassable tile but couldn't. Shove his token a
  // fraction toward (dx,dy); since his render target is unchanged it eases straight back — a lean
  // into the wall and a bounce off it. The camera is left untouched (no snap).
  function bump(dx, dy) {
    playerRender.x += dx * 0.32;
    playerRender.y += dy * 0.32;
  }

  // A "lunge": the king leaps ONTO a foe's tile (ex,ey), then (in update) eases off to wherever
  // he actually ends — so a bounce reads as a pounce-and-recoil, not a teleport.
  function lunge(ex, ey) {
    lungePoint = { x: ex, y: ey };
  }

  // Pop a boss's short battle-cry as a speech bubble above its tile — appears on its scream turn
  // and fades on its own over SHOUT_TIME (so it never outlasts that first hostile turn).
  function shout(x, y, text, demon) {
    shouts.push({ x, y, text: String(text || ''), t: 0, demon: Boolean(demon) });
  }

  // A boulder the king shoved but couldn't budge: nudge its rock toward the shove; it eases right
  // back to its tile — a little vibration matching the king's bump.
  function bumpBoulder(bx, by, dx, dy) {
    const b = boulderRenders.find((r) => r.targetX === bx && r.targetY === by);
    if (b) { b.x += dx * 0.16; b.y += dy * 0.16; }
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
      // Carry combat identity so HP bars / boss styling show from the moment a floor loads
      // (not only after the first enemy phase syncs them).
      boss: Boolean(enemy.boss),
      turret: Boolean(enemy.turret),
      rush: Boolean(enemy.rush),
      finalBoss: Boolean(enemy.finalBoss),
      mini: Boolean(enemy.mini),
      bossPerk: enemy.bossPerk || null,
      hp: enemy.hp,
      maxHp: enemy.maxHp,
    }));
    allyRenders = (state.allies || []).map((ally) => ({
      id: ally.id, x: ally.x, y: ally.y, targetX: ally.x, targetY: ally.y, kind: ally.kind,
    }));
    boulderRenders = [];
    for (const k in state.terrain || {}) {
      if (state.terrain[k] !== 'boulder') continue;
      const [x, y] = k.split(',').map(Number);
      boulderRenders.push({ x, y, targetX: x, targetY: y, angle: 0, targetAngle: 0 });
    }
    projectiles = [];
    bursts = [];
    puffs = []; // a fresh floor: no lingering smoke
    shouts = [];
    lungePoint = null;
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
        // A SUMMONED foe (from a boss or a summoning circle) materialises in a puff of purple
        // smoke — distinguishing a conjuring from an ordinary off-screen spawn.
        if (enemy.summoned) puffs.push({ x: enemy.x, y: enemy.y, t: 0, summon: true });
      }
      render.targetX = enemy.x;
      render.targetY = enemy.y;
      // HEXED: the king's curse warped this foe into a ferz where it stood — mark the change with
      // a puff of PINK smoke (the same shape as the purple conjuring/dissolving smoke).
      if (render.kind && render.kind !== enemy.kind && enemy.kind === 'ferz') {
        puffs.push({ x: enemy.x, y: enemy.y, t: 0, hex: true });
      }
      render.kind = enemy.kind;
      render.summonTick = enemy.summonTick || 0; // summoning-circle wind-up (for the charge preview)
      render.surprised = Boolean(enemy.surprised);
      render.frustrated = Boolean(enemy.frustrated);
      render.awake = Boolean(enemy.awake);
      render.charged = enemy.charged !== false;
      render.role = typeof enemyRole === 'function' ? enemyRole(enemy) : 'normal';
      render.summoned = Boolean(enemy.summoned); // conjured — drawn violet, like an ally is drawn green
      render.boss = Boolean(enemy.boss);
      render.rush = Boolean(enemy.rush);
      render.finalBoss = Boolean(enemy.finalBoss); // the last guardian: its own black-and-fire livery // a finale rush-boss (drawn ashen, not royal)
      render.mini = Boolean(enemy.mini); // a MINI-boss: smaller token, less HP, no boon
      render.fire = Boolean(enemy.fire); // a FIRE turret (reddish, piercing spellfire)
      render.bossPerk = enemy.bossPerk || null;
      render.hp = enemy.hp;
      render.maxHp = enemy.maxHp;
      next.push(render);
    }
    enemyRenders = next;

    // Allies (the king's summons): glide to their new tiles exactly like enemies. Any ally that
    // has vanished since last sync has DIED — it dissolves into a puff of purple smoke where it
    // last stood.
    const nextAllies = [];
    for (const ally of state.allies || []) {
      let render = allyRenders.find((it) => it.id === ally.id);
      if (!render) render = { id: ally.id, x: ally.x, y: ally.y, targetX: ally.x, targetY: ally.y };
      render.targetX = ally.x;
      render.targetY = ally.y;
      render.kind = ally.kind;
      nextAllies.push(render);
    }
    for (const old of allyRenders) {
      if (!nextAllies.some((r) => r.id === old.id)) puffs.push({ x: old.x, y: old.y, t: 0 });
    }
    allyRenders = nextAllies;
    syncBoulders(state);
  }

  // Diff the boulder terrain against the eased boulder renders: a boulder that MOVED (its tile is
  // no longer a boulder, and a fresh boulder tile appeared nearby) keeps its render object so it
  // ROLLS + spins to the new tile; brand-new boulders appear in place; destroyed ones vanish.
  function syncBoulders(state) {
    const newTiles = [];
    for (const k in state.terrain || {}) if (state.terrain[k] === 'boulder') newTiles.push(k);
    const newSet = new Set(newTiles);
    const kept = [];
    const takenTargets = new Set();
    const orphans = [];
    for (const b of boulderRenders) {
      const key = `${b.targetX},${b.targetY}`;
      if (newSet.has(key) && !takenTargets.has(key)) { kept.push(b); takenTargets.add(key); }
      else orphans.push(b);
    }
    const usedOrphan = new Set();
    for (const key of newTiles) {
      if (takenTargets.has(key)) continue;
      const [nx, ny] = key.split(',').map(Number);
      let best = -1;
      let bestD = Infinity;
      for (let i = 0; i < orphans.length; i += 1) {
        if (usedOrphan.has(i)) continue;
        const d = Math.abs(orphans[i].targetX - nx) + Math.abs(orphans[i].targetY - ny);
        if (d < bestD) { bestD = d; best = i; }
      }
      if (best >= 0 && bestD <= 3) {
        usedOrphan.add(best);
        const o = orphans[best];
        const odx = nx - o.targetX;
        const ody = ny - o.targetY;
        const dir = Math.abs(odx) >= Math.abs(ody) ? Math.sign(odx) : Math.sign(ody);
        o.targetAngle = (o.targetAngle || 0) + (Math.abs(odx) + Math.abs(ody)) * (0.8 + Math.random() * 0.6) * (dir || 1);
        o.targetX = nx;
        o.targetY = ny;
        kept.push(o);
      } else {
        kept.push({ x: nx, y: ny, targetX: nx, targetY: ny, angle: 0, targetAngle: 0 });
      }
      takenTargets.add(key);
    }
    boulderRenders = kept;
  }

  function update(delta) {
    const speed = Math.min(1, 12 * delta);
    if (lungePoint) {
      // Snap toward the pounce tile fast; once there, release to ease off to the real target.
      playerRender.x += (lungePoint.x - playerRender.x) * Math.min(1, speed * 1.8);
      playerRender.y += (lungePoint.y - playerRender.y) * Math.min(1, speed * 1.8);
      if (Math.abs(playerRender.x - lungePoint.x) + Math.abs(playerRender.y - lungePoint.y) < 0.14) lungePoint = null;
    } else {
      playerRender.x += (playerRender.targetX - playerRender.x) * speed;
      playerRender.y += (playerRender.targetY - playerRender.y) * speed;
    }
    for (const enemy of enemyRenders) {
      enemy.x += (enemy.targetX - enemy.x) * speed;
      enemy.y += (enemy.targetY - enemy.y) * speed;
    }
    for (const ally of allyRenders) {
      ally.x += (ally.targetX - ally.x) * speed;
      ally.y += (ally.targetY - ally.y) * speed;
    }
    for (const b of boulderRenders) {
      b.x += (b.targetX - b.x) * speed;
      b.y += (b.targetY - b.y) * speed;
      b.angle = (b.angle || 0) + ((b.targetAngle || 0) - (b.angle || 0)) * speed; // spin toward the roll angle
    }
    for (const puff of puffs) puff.t += delta / PUFF_TIME;
    puffs = puffs.filter((p) => p.t < 1);
    for (const s of shouts) s.t += delta / SHOUT_TIME;
    shouts = shouts.filter((s) => s.t < 1);
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
    if (bursts.length) {
      for (const b of bursts) {
        if (b.delay > 0) b.delay -= delta; // hold until the fireball reaches this tile
        else b.t += delta / BURST_TIME;
      }
      bursts = bursts.filter((b) => b.t < 1);
    }
  }

  // Demon (fairy) pieces are drawn as their NEAREST normal piece — so they read as a familiar
  // chess unit — then marked as demonic with devil horns (all of them) and bat wings (the
  // knight-compound movers). berolina = a demonic pawn; archbishop/chancellor/amazon add the
  // knight leap, hence the wings.
  const DEMON_BASE_GLYPH = { berolina: '♟', archbishop: '♝', chancellor: '♜', amazon: '♛' };
  const DEMON_WINGED = new Set(['archbishop', 'chancellor', 'amazon']); // the knight-leapers
  function isDemonKind(kind) { return Object.prototype.hasOwnProperty.call(DEMON_BASE_GLYPH, kind); }
  function pieceGlyph(kind) { return DEMON_BASE_GLYPH[kind] || getPieceLabel(kind); }

  // Devil horns (and, for the leapers, bat wings) framing a demon piece's token.
  function drawDemonMarks(cx, cy, radius, kind) {
    const r = radius;
    ctx.save();
    // Bat wings first, so the token sits over their roots.
    if (DEMON_WINGED.has(kind)) {
      ctx.fillStyle = 'rgba(90, 14, 22, 0.92)';
      ctx.strokeStyle = 'rgba(30, 6, 10, 0.9)';
      ctx.lineWidth = Math.max(1, r * 0.05);
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(cx + s * r * 0.6, cy - r * 0.35); // shoulder
        ctx.lineTo(cx + s * r * 1.35, cy - r * 0.5); // top spar
        ctx.lineTo(cx + s * r * 1.12, cy - r * 0.12);
        ctx.lineTo(cx + s * r * 1.32, cy + r * 0.12); // mid scallop
        ctx.lineTo(cx + s * r * 1.02, cy + r * 0.22);
        ctx.lineTo(cx + s * r * 1.15, cy + r * 0.5); // lower point
        ctx.lineTo(cx + s * r * 0.62, cy + r * 0.18); // body attach
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    }
    // Two curved horns rising from the crown of the token.
    ctx.fillStyle = '#c0392b'; // crimson
    ctx.strokeStyle = 'rgba(40, 8, 8, 0.85)';
    ctx.lineWidth = Math.max(1, r * 0.05);
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(cx + s * r * 0.34, cy - r * 0.82); // inner base
      ctx.lineTo(cx + s * r * 0.64, cy - r * 0.7); // outer base
      ctx.quadraticCurveTo(cx + s * r * 0.9, cy - r * 1.05, cx + s * r * 0.78, cy - r * 1.32); // curve to tip
      ctx.quadraticCurveTo(cx + s * r * 0.5, cy - r * 1.0, cx + s * r * 0.34, cy - r * 0.82);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawPiece(tileX, tileY, kind, isPlayer, opts) {
    const o = opts || {};
    const role = o.role || 'normal';
    const cx = tileX * tileSize + tileSize / 2;
    const cy = tileY * tileSize + tileSize / 2;
    const radius = tileSize * (role === 'boss' ? (o.mini ? 0.36 : (o.finalBoss ? 0.52 : 0.46)) : 0.4); // minis smaller; the FINAL guardian looms larger

    ctx.save();
    // Spent (recharging) casters are faded.
    if (o.inactive) ctx.globalAlpha = 0.4;

    // Inverted scheme: the KING is the dark, class-coloured token (his fill is his class
    // or tier-3 subclass colour); ordinary ENEMIES are the light bone-coloured tokens.
    // Special roles (turret / boss / circle / ally) keep their own identity below.
    let fill = isPlayer ? o.classColor || '#dc2626' : '#e7e2d1';
    let stroke = isPlayer ? '#faf6e9' : '#33333c';
    // The king's glyph flips to ink on light class colours (e.g. lime) so it stays legible.
    let glyph = isPlayer ? contrastInk(fill) : '#17171d';
    if (role === 'turret') {
      if (o.fire) {
        fill = '#3a1512'; // charred red — a FIRE turret
        stroke = '#ef4444'; // hot red danger ring
        glyph = '#ffc4b0';
      } else {
        fill = '#34353c'; // cool GREY steel (grayer than before)
        stroke = '#9a9da6'; // muted steel ring
        glyph = '#d4d6dc';
      }
    } else if (role === 'boss') {
      if (o.rush || o.mini) {
        // A MINI-boss (finale rush OR a risen mini-boss): ashen grey-green, not royal gold, so it
        // reads at a glance as "lesser, grants no boon" — and it's drawn smaller (radius above).
        fill = '#161a15'; // charred ash
        stroke = '#7f9e6b'; // sickly moss-green
        glyph = '#c7d6b5';
      } else if (o.finalBoss) {
        // The LAST guardian is a thing apart: pitch black shot through with furnace red, never the
        // ordinary royal gold — you should know what you're looking at the instant it wakes.
        fill = '#120204'; // void black
        stroke = '#ff3b1f'; // furnace red
        glyph = '#ff9d6b';
      } else {
        fill = '#1a0f1f'; // deep royal
        stroke = '#e0b341'; // gold
        glyph = '#ffe9a8';
      }
    } else if (role === 'circle') {
      fill = '#241733'; // arcane violet — a summoning circle
      stroke = '#a855f7';
      glyph = '#e9d5ff';
    } else if (role === 'ally') {
      fill = '#0f2a1a'; // deep green — the king's own piece
      stroke = '#34d399';
      glyph = '#bbf7d0';
    } else if (o.summoned) {
      // CONJURED by a circle (or a summoner-boss): tinted arcane VIOLET the way an ally is tinted
      // green, so a conjured foe never reads as just another wanderer. Kill its circle and it goes.
      fill = '#2a1b3d';
      stroke = '#c084fc';
      glyph = '#e9d5ff';
    }

    // A FERZ (what the Hexer's curse warps a foe into) is a harmless, dazed little blob — drawn
    // small and goofy in pale pink so it never reads as a real threat. It keeps that shape in EVERY
    // role: a ferz raised as undead is still a ferz, so it must still look like one (only its ring
    // takes the ally/summoned colour, set above).
    const isFerz = !isPlayer && kind === 'ferz';
    const bodyRadius = isFerz ? radius * 0.66 : radius;
    if (isFerz) { fill = '#f4d3e7'; if (role === 'normal') stroke = '#cf93c4'; }

    // A MANN (the Necromancer's risen familiar) keeps the ordinary mann silhouette but is BONE —
    // a pale, dead-white token, so it reads as a skeleton at a glance without losing its shape.
    const isMann = !isPlayer && kind === 'mann';
    if (isMann) {
      fill = '#e8e4d8'; // old bone
      stroke = '#6b6558'; // dry grey-brown
      glyph = '#2b2a26';
    }

    // Boss aura: a soft outer ring — gold for a true guardian, sickly green for a rush boss.
    if (role === 'boss') {
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, radius + tileSize * 0.12, 0, Math.PI * 2);
      ctx.strokeStyle = (o.rush || o.mini) ? 'rgba(127, 158, 107, 0.85)'
        : (o.finalBoss ? 'rgba(255, 59, 31, 0.9)' : 'rgba(224, 179, 65, 0.85)'); // the last guardian burns instead of gleaming
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.restore();
    }

    // A demon (fairy) enemy/ally sprouts horns and wings behind its token (never the king).
    if (!isPlayer && isDemonKind(kind)) drawDemonMarks(cx, cy, radius, kind);

    if (isFerz) {
      // A GUMDROP-shaped blob: a high domed top flaring to a wide, rounded base.
      const r = bodyRadius;
      const topY = cy - r * 1.05;
      const botY = cy + r * 0.72;
      const halfW = r * 0.98;
      ctx.beginPath();
      ctx.moveTo(cx - halfW, botY);
      ctx.quadraticCurveTo(cx, botY + r * 0.34, cx + halfW, botY); // rounded, slightly bulging base
      ctx.bezierCurveTo(cx + halfW * 1.02, cy - r * 0.25, cx + r * 0.55, topY, cx, topY); // right flank up to the dome
      ctx.bezierCurveTo(cx - r * 0.55, topY, cx - halfW * 1.02, cy - r * 0.25, cx - halfW, botY); // left flank back down
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = stroke;
      ctx.stroke();
      // Two wide, blank eyes and NO mouth — a vacant, dazed stare rather than a cheerful grin.
      const eo = r * 0.32;
      const ey = cy - r * 0.04;
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(cx - eo, ey, r * 0.22, 0, Math.PI * 2); ctx.arc(cx + eo, ey, r * 0.22, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#5b2f52';
      ctx.beginPath(); ctx.arc(cx - eo, ey + r * 0.03, r * 0.09, 0, Math.PI * 2); ctx.arc(cx + eo, ey + r * 0.04, r * 0.09, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.beginPath();
      ctx.arc(cx, cy, bodyRadius, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.lineWidth = role === 'boss' || (isPlayer && o.classColor) ? 3 : 2;
      ctx.strokeStyle = stroke;
      ctx.stroke();
      ctx.fillStyle = glyph;
      ctx.font = `${tileSize * 0.62}px serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(pieceGlyph(kind), cx, cy + tileSize * 0.04);
      // A MANN is RISEN: lay a few dry rib-bones across its bone-white token so it reads as a
      // skeleton, without touching the silhouette that says "mann".
      if (isMann) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, bodyRadius, 0, Math.PI * 2);
        ctx.clip(); // keep the bones on the token
        ctx.strokeStyle = 'rgba(70, 66, 56, 0.5)';
        ctx.lineWidth = Math.max(1, tileSize * 0.035);
        ctx.lineCap = 'round';
        for (let i = -1; i <= 1; i += 1) {
          const ry = cy + i * bodyRadius * 0.34 + bodyRadius * 0.1;
          ctx.beginPath();
          ctx.moveTo(cx - bodyRadius * 0.52, ry);
          ctx.lineTo(cx + bodyRadius * 0.52, ry);
          ctx.stroke();
        }
        ctx.restore();
      }
    }

    // Damage marks over the token, worse the lower its HP — clipped to the body. A TURRET (a
    // machine) shows spreading CRACKS instead of blood.
    if (o.blood > 0.06) {
      const b = Math.min(1, o.blood);
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.clip();
      if (role === 'turret') {
        // PALE fracture lines (bright, so they read on the dark steel) with a thin dark backing for
        // contrast — kept in the mid-body (short, near the centre) so they never spill over the rim.
        ctx.globalAlpha = (o.inactive ? 0.4 : 1) * Math.min(0.95, 0.6 + b * 0.35);
        const cracks = Math.max(2, Math.round(b * 4));
        for (let i = 0; i < cracks; i += 1) {
          const a0 = (i / Math.max(2, cracks)) * Math.PI * 2 + 0.5;
          const r0 = radius * 0.22;
          const r1 = radius * (0.48 + 0.14 * b);
          const p0x = cx + Math.cos(a0) * r0; const p0y = cy + Math.sin(a0) * r0;
          const p1x = cx + Math.cos(a0) * r1; const p1y = cy + Math.sin(a0) * r1;
          const p2x = cx + Math.cos(a0 + 0.4) * r1 * 0.85; const p2y = cy + Math.sin(a0 + 0.4) * r1 * 0.85;
          const stroke = (col, w) => {
            ctx.strokeStyle = col; ctx.lineWidth = Math.max(1, w);
            ctx.beginPath(); ctx.moveTo(p0x, p0y); ctx.lineTo(p1x, p1y); ctx.lineTo(p2x, p2y); ctx.stroke();
          };
          stroke('rgba(10,12,18,0.55)', radius * 0.09); // dark backing
          stroke('rgba(222,230,244,0.95)', radius * 0.045); // bright crack on top
        }
      } else {
        ctx.globalAlpha = (o.inactive ? 0.4 : 1) * Math.min(0.9, 0.4 + b * 0.55);
        ctx.fillStyle = '#a5121b'; // dark, fresh blood
        const n = Math.max(1, Math.round(b * BLOOD_SPECKS.length));
        for (let i = 0; i < n; i += 1) {
          const [sx, sy, sr] = BLOOD_SPECKS[i];
          ctx.beginPath();
          ctx.arc(cx + sx * radius, cy + sy * radius, radius * sr, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
    }
    ctx.restore();
  }

  // At-a-glance ROLE indicator: a colored cap sitting atop the piece token.
  const ROLE_HAT = {
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

  // Each boss trait wears a DISTINCT crown — a coloured cap with its own emblem — so a
  // guardian's perk reads at a glance (see BOSS_PERKS). Bosses without a rolled perk fall
  // back to the plain gold boss cap (drawRoleHat).
  const BOSS_TRAIT_HAT = {
    summoner: { color: '#a855f7', mark: '✶' }, // violet conjuring star
    blinker: { color: '#22d3ee', mark: '↯' }, // cyan flicker
    brutal: { color: '#dc2626', mark: '✖' }, // blood-red cross
    ranged: { color: '#84cc16', mark: '↟' }, // lime volley arrow
    sorcerer: { color: '#fb923c', mark: '✷' }, // ember burst
    knockback: { color: '#94a3b8', mark: '⛊' }, // steel bulwark shield
    shapeshifter: { color: '#e879f9', mark: '∞' }, // shifting loop
    tough: { color: '#f59e0b', mark: '◆' }, // hardened gem
    leech: { color: '#7f1d1d', mark: '♥' }, // dark leeching heart
    flying: { color: '#bfdbfe', mark: '︿' }, // pale-sky wings
    phasing: { color: '#c4b5fd', mark: '◇' }, // spectral diamond
  };
  function drawBossTraitHat(tileX, tileY, perk, rush) {
    const spec = BOSS_TRAIT_HAT[perk];
    if (!spec) { drawRoleHat(tileX, tileY, 'boss'); return; }
    // A rush boss keeps its trait emblem but wears an ashen moss-green cap (never royal), to
    // match its lesser, rogue look.
    const capColor = rush ? '#7f9e6b' : spec.color;
    const cx = tileX * tileSize + tileSize / 2;
    const topY = tileY * tileSize + tileSize * 0.14;
    const w = tileSize * 0.36;
    ctx.save();
    // A peaked cap with a brim.
    ctx.fillStyle = capColor;
    ctx.beginPath();
    ctx.moveTo(cx, topY - tileSize * 0.08);
    ctx.lineTo(cx - w / 2, topY + tileSize * 0.12);
    ctx.lineTo(cx + w / 2, topY + tileSize * 0.12);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(cx - w * 0.64, topY + tileSize * 0.1, w * 1.28, tileSize * 0.05);
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = 1;
    ctx.stroke();
    // The trait's emblem, hovering just above the cap's peak.
    ctx.fillStyle = capColor;
    ctx.font = `${tileSize * 0.3}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(spec.mark, cx, topY - tileSize * 0.22);
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
    } else if (mainState === 'asleep') {
      drawStatusMark(tileX, tileY, 'z', '#93c5fd'); // a soft-blue "z" for a slumbering foe
    } else if (mainState === 'unaware') {
      drawStatusMark(tileX, tileY, '?', '#a3a3a3'); // a grey "?" — it hasn't noticed the king
    } else if (mainState === 'frustrated') {
      drawStatusMark(tileX, tileY, '✖', '#fca5a5');
    } else if (mainState === 'recovering') {
      drawStatusMark(tileX, tileY, '⟳', '#67e8f9'); // cyan recharge glyph — winded / cooling down
    } else if (mainState === 'befriended') {
      drawStatusMark(tileX, tileY, '♥', '#f9a8d4'); // pink heart — a beast tamed by Wild Empathy
    } else if (mainState === 'aiming') {
      // A small red crosshair (compact + coloured like the other marks, no heavy black glyph) —
      // a turret locking onto the king.
      const cx = tileX * tileSize + tileSize * 0.8;
      const cy = tileY * tileSize + tileSize * 0.2;
      const r = tileSize * 0.14;
      ctx.save();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(0,0,0,0.45)'; // thin rim for contrast only
      ctx.beginPath(); ctx.arc(cx, cy, r + 0.7, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = '#ef4444';
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx - r * 1.5, cy); ctx.lineTo(cx + r * 1.5, cy);
      ctx.moveTo(cx, cy - r * 1.5); ctx.lineTo(cx, cy + r * 1.5);
      ctx.stroke();
      ctx.fillStyle = '#ef4444';
      ctx.beginPath(); ctx.arc(cx, cy, r * 0.3, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
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
      ctx.fillStyle = p.color;
      if (p.role === 'arrow') {
        // A little arrowhead + shaft pointing along its flight path.
        ctx.translate(x, y);
        ctx.rotate(Math.atan2(p.toY - p.fromY, p.toX - p.fromX));
        const s = tileSize * 0.22;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = Math.max(1.5, tileSize * 0.045);
        ctx.beginPath();
        ctx.moveTo(-s, 0);
        ctx.lineTo(s * 0.35, 0);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(s, 0);
        ctx.lineTo(s * 0.2, -s * 0.4);
        ctx.lineTo(s * 0.2, s * 0.4);
        ctx.closePath();
        ctx.fill();
      } else if (p.role === 'fireball') {
        // A molten orb with a blazing white-hot core.
        const r = tileSize * 0.18;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fff7ed';
        ctx.beginPath();
        ctx.arc(x, y, r * 0.5, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // A glowing energy SLUG (turret / boss bolt) with a bright tracer tail streaking behind it
        // along its flight path, so it reads clearly as a shot in flight — not a faint dot.
        const dx = p.toX - p.fromX;
        const dy = p.toY - p.fromY;
        const len = Math.hypot(dx, dy) || 1;
        const ux = (dx / len) * tileSize;
        const uy = (dy / len) * tileSize;
        ctx.strokeStyle = p.color;
        ctx.lineCap = 'round';
        ctx.lineWidth = tileSize * 0.14;
        ctx.globalAlpha = 0.55;
        ctx.beginPath();
        ctx.moveTo(x - ux * 0.7, y - uy * 0.7); // a short tail trailing the head
        ctx.lineTo(x, y);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.arc(x, y, tileSize * 0.17, 0, Math.PI * 2); // the glowing head
        ctx.fill();
        ctx.fillStyle = '#fff7ed';
        ctx.beginPath();
        ctx.arc(x, y, tileSize * 0.08, 0, Math.PI * 2); // hot white core
        ctx.fill();
      }
      ctx.restore();
    }
  }

  // Fireball impact blooms: an expanding, fading ring of flame with a hot core, one
  // per scorched tile (staggered by drawProjectiles' burst timing above).
  function drawBursts() {
    for (const b of bursts) {
      if (b.delay > 0) continue;
      const cx = (b.x + 0.5) * tileSize;
      const cy = (b.y + 0.5) * tileSize;
      const r = tileSize * (0.22 + 0.3 * b.t);
      const fade = 1 - b.t;
      ctx.save();
      ctx.shadowBlur = tileSize * 0.4;
      ctx.shadowColor = b.color;
      ctx.globalAlpha = fade;
      ctx.fillStyle = b.color;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = fade * 0.85;
      ctx.fillStyle = '#fff7ed';
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.45, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // A dying ally's farewell: a puff of purple smoke that swells and fades over PUFF_TIME. A
  // clutch of drifting violet blobs plus a bright core early on — a slow visual dissolve.
  function drawPuffs() {
    for (const puff of puffs) {
      const cx = (puff.x + 0.5) * tileSize;
      const cy = (puff.y + 0.5) * tileSize;
      const t = puff.t;
      const fade = 1 - t;
      ctx.save();
      for (let i = 0; i < 6; i += 1) {
        const ang = (i / 6) * Math.PI * 2 + t * 1.6;
        const dist = tileSize * (0.04 + t * 0.34);
        const r = tileSize * (0.13 + t * 0.16) * (i % 2 ? 0.75 : 1);
        ctx.fillStyle = `rgba(${puff.hex ? '236, 72, 153' : '168, 85, 247'}, ${(fade * 0.5).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(cx + Math.cos(ang) * dist, cy - tileSize * t * 0.18 + Math.sin(ang) * dist, r, 0, Math.PI * 2);
        ctx.fill();
      }
      // A brighter lilac core that shrinks as the smoke thins.
      ctx.fillStyle = `rgba(${puff.hex ? '251, 207, 232' : '216, 180, 254'}, ${(fade * 0.65).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(cx, cy, tileSize * 0.17 * fade, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // A boss's battle-cry speech bubble: a rounded box with a little tail, floating above the tile —
  // pops in with a slight bounce, holds, then fades out over its life.
  function drawShouts() {
    for (const s of shouts) {
      const t = s.t;
      const pop = Math.min(1, t / 0.16); // quick scale-in
      const fade = t > 0.7 ? Math.max(0, 1 - (t - 0.7) / 0.3) : 1; // hold, then fade over the last 30%
      const scale = 0.7 + 0.3 * pop;
      const cx = (s.x + 0.5) * tileSize;
      const cy = (s.y + 0.5) * tileSize;
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.font = `700 ${Math.round(tileSize * 0.34)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const padX = tileSize * 0.16;
      const w = ctx.measureText(s.text).width + padX * 2;
      const h = tileSize * 0.5;
      const bx = cx - (w / 2) * scale;
      const by = cy - tileSize * (0.62 + 0.1 * pop) - h * scale; // sits above the head, drifting up as it pops
      ctx.translate(cx, by + h * scale);
      ctx.scale(scale, scale);
      ctx.translate(-cx, -(by + h * scale));
      // A DEMON snarls from a BLACK bubble in hellish red; a mortal guardian gets the pale one.
      const body = s.demon ? '#0b0406' : '#fef2f2';
      const edge = s.demon ? '#ef4444' : '#b91c1c';
      const ink = s.demon ? '#ff5f5f' : '#7f1d1d';
      // bubble body
      const r = h * 0.4;
      ctx.beginPath();
      ctx.moveTo(bx + r, by);
      ctx.arcTo(bx + w, by, bx + w, by + h, r);
      ctx.arcTo(bx + w, by + h, bx, by + h, r);
      ctx.arcTo(bx, by + h, bx, by, r);
      ctx.arcTo(bx, by, bx + w, by, r);
      ctx.closePath();
      ctx.fillStyle = body;
      ctx.fill();
      ctx.strokeStyle = edge;
      ctx.lineWidth = 2;
      ctx.stroke();
      // tail pointing down to the boss
      ctx.beginPath();
      ctx.moveTo(cx - tileSize * 0.08, by + h - 1);
      ctx.lineTo(cx, by + h + tileSize * 0.16);
      ctx.lineTo(cx + tileSize * 0.08, by + h - 1);
      ctx.closePath();
      ctx.fillStyle = body;
      ctx.fill();
      ctx.strokeStyle = edge;
      ctx.stroke();
      // text
      ctx.fillStyle = ink;
      ctx.fillText(s.text, cx, by + h / 2);
      ctx.restore();
    }
  }

  // A summoning circle's minion-to-be: a translucent violet ghost of the piece kind that grows
  // more solid (and rises) as the conjuring charges (progress 0..1). It POPS on the summon tick.
  function drawSummonCharge(tileX, tileY, kind, progress) {
    const cx = tileX * tileSize + tileSize / 2;
    const cy = tileY * tileSize + tileSize / 2 - tileSize * 0.12 * progress;
    ctx.save();
    ctx.globalAlpha = 0.2 + 0.6 * progress; // faint at first, near-solid just before it appears
    ctx.fillStyle = '#a855f7';
    ctx.beginPath();
    ctx.arc(cx, cy, tileSize * 0.22 * (0.5 + 0.5 * progress), 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(233, 213, 255, 0.9)';
    ctx.font = `${tileSize * 0.4}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(pieceGlyph(kind), cx, cy + tileSize * 0.02);
    ctx.restore();
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

  // The floor key: a gold key the king must collect to unlock the stair. Drawn bright
  // in sight and dim once only remembered (it persists through fog like the stair).
  function drawKey(tileX, tileY, faded) {
    const cx = tileX * tileSize + tileSize / 2;
    const cy = tileY * tileSize + tileSize / 2;
    const s = tileSize;
    ctx.save();

    // An animated golden aura pulsing around the key while it is in sight — draws the
    // eye to the objective. (Only a static, dimmed key shows once merely remembered.)
    if (!faded) {
      const pulse = 0.5 + 0.5 * Math.sin(clock * 4.5);
      const glowR = s * (0.34 + 0.09 * pulse);
      const grad = ctx.createRadialGradient(cx, cy, s * 0.04, cx, cy, glowR);
      grad.addColorStop(0, `rgba(253, 224, 71, ${0.5 * (0.55 + 0.45 * pulse)})`);
      grad.addColorStop(0.6, `rgba(250, 204, 21, ${0.22 * (0.55 + 0.45 * pulse)})`);
      grad.addColorStop(1, 'rgba(253, 224, 71, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, glowR, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalAlpha = faded ? 0.5 : 1;
    ctx.fillStyle = '#fbbf24';
    ctx.strokeStyle = '#b45309';
    ctx.lineWidth = Math.max(1, s * 0.03);
    // An upright key CENTRED on the tile: a ringed bow up top, a shaft straight down, and
    // two teeth on the right. `ax` (the vertical axis) is nudged a hair left so the teeth
    // don't pull the whole shape off-centre.
    const ax = cx - s * 0.03;
    const bowR = s * 0.14;
    const bowY = cy - s * 0.13;
    ctx.beginPath();
    ctx.arc(ax, bowY, bowR, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = faded ? '#1e293b' : '#0b1220';
    ctx.beginPath();
    ctx.arc(ax, bowY, bowR * 0.44, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fbbf24';
    const shaftW = s * 0.07;
    ctx.fillRect(ax - shaftW / 2, bowY + bowR * 0.5, shaftW, s * 0.33); // shaft, ending near +0.27
    ctx.fillRect(ax - shaftW / 2, cy + s * 0.11, shaftW + s * 0.1, shaftW); // tooth 1
    ctx.fillRect(ax - shaftW / 2, cy + s * 0.2, shaftW + s * 0.15, shaftW); // tooth 2
    ctx.restore();
  }

  // The victory PORTAL (floor 8): a swirling ring of arcane light where a stair would be. It
  // lies dark and barred until the Orb of Victory is taken, then blazes open.
  function drawPortal(tileX, tileY, faded, locked) {
    const cx = tileX * tileSize + tileSize / 2;
    const cy = tileY * tileSize + tileSize / 2;
    const s = tileSize;
    ctx.save();
    ctx.globalAlpha = faded ? 0.5 : 1;
    const spin = clock * (locked ? 0.5 : 1.8);
    const open = locked ? 0.4 : 1; // brightness/energy of the gate
    // Outer glow when open.
    if (!locked && !faded) {
      const pulse = 0.5 + 0.5 * Math.sin(clock * 3);
      const grad = ctx.createRadialGradient(cx, cy, s * 0.05, cx, cy, s * 0.5);
      grad.addColorStop(0, `rgba(196, 132, 252, ${0.55 * (0.6 + 0.4 * pulse)})`);
      grad.addColorStop(0.6, `rgba(129, 60, 217, ${0.28 * (0.6 + 0.4 * pulse)})`);
      grad.addColorStop(1, 'rgba(129, 60, 217, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, s * 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
    // Dark maw.
    ctx.fillStyle = '#120821';
    ctx.beginPath();
    ctx.arc(cx, cy, s * 0.32, 0, Math.PI * 2);
    ctx.fill();
    // Swirling arcs of energy.
    ctx.lineWidth = Math.max(2, s * 0.06);
    ctx.lineCap = 'round';
    for (let i = 0; i < 3; i += 1) {
      const r = s * (0.14 + i * 0.08);
      const a0 = spin + (i * Math.PI * 0.7);
      ctx.strokeStyle = `rgba(${168 + i * 20}, ${85 + i * 30}, ${247}, ${open})`;
      ctx.beginPath();
      ctx.arc(cx, cy, r, a0, a0 + Math.PI * 1.3);
      ctx.stroke();
    }
    // A barred (dormant) portal shows crimson bars, like a sealed stair.
    if (locked) {
      ctx.strokeStyle = '#dc2626';
      ctx.lineWidth = Math.max(2, s * 0.07);
      for (let i = 0; i < 3; i += 1) {
        const bx = cx + (i - 1) * s * 0.2;
        ctx.beginPath();
        ctx.moveTo(bx, cy - s * 0.3);
        ctx.lineTo(bx, cy + s * 0.3);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // The Orb of Victory (floor 8): a radiant sphere that replaces the floor key — collecting it
  // opens the portal and triggers the finale's boss-rush.
  function drawOrb(tileX, tileY, faded) {
    const cx = tileX * tileSize + tileSize / 2;
    const cy = tileY * tileSize + tileSize / 2;
    const s = tileSize;
    ctx.save();
    if (!faded) {
      const pulse = 0.5 + 0.5 * Math.sin(clock * 4.5);
      const glowR = s * (0.36 + 0.1 * pulse);
      const grad = ctx.createRadialGradient(cx, cy, s * 0.04, cx, cy, glowR);
      grad.addColorStop(0, `rgba(125, 252, 231, ${0.55 * (0.55 + 0.45 * pulse)})`);
      grad.addColorStop(0.6, `rgba(56, 189, 248, ${0.24 * (0.55 + 0.45 * pulse)})`);
      grad.addColorStop(1, 'rgba(56, 189, 248, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, glowR, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = faded ? 0.5 : 1;
    // The sphere: a shaded ball with a bright highlight.
    const r = s * 0.2;
    const grad = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.1, cx, cy, r);
    grad.addColorStop(0, '#e0fffb');
    grad.addColorStop(0.5, '#5eead4');
    grad.addColorStop(1, '#0e7490');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#0e7490';
    ctx.lineWidth = Math.max(1, s * 0.03);
    ctx.stroke();
    // A crisp glint.
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.arc(cx - r * 0.32, cy - r * 0.38, r * 0.22, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Draw a pickup. `animated` items (in current view) pulse and glow; remembered
  // ones (out of view) are static and dimmed.
  // A permanent scar left on the ground: the ruin of a shattered summoning circle.
  // Drawn dim when only remembered, brighter while in sight.
  function drawScar(scar, faded) {
    const cx = scar.x * tileSize + tileSize / 2;
    const cy = scar.y * tileSize + tileSize / 2;
    const r = tileSize * 0.34;
    ctx.save();
    ctx.globalAlpha = faded ? 0.4 : 0.8;
    ctx.lineWidth = Math.max(1.5, tileSize * 0.05);
    ctx.strokeStyle = '#7c5cbf'; // a broken violet ring
    for (let i = 0; i < 4; i += 1) {
      const a0 = (i / 4) * Math.PI * 2 + 0.25;
      ctx.beginPath();
      ctx.arc(cx, cy, r, a0, a0 + Math.PI * 0.35);
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

  // A fiery wash + outline over a tile a spell's AoE would scorch, so the whole hit
  // line (not just the final tile) is visible while aiming.
  function drawAoeTile(tileX, tileY) {
    const px = tileX * tileSize;
    const py = tileY * tileSize;
    ctx.save();
    ctx.fillStyle = 'rgba(251, 146, 60, 0.26)';
    ctx.fillRect(px, py, tileSize, tileSize);
    ctx.strokeStyle = 'rgba(251, 146, 60, 0.85)';
    ctx.lineWidth = Math.max(1.5, tileSize * 0.04);
    ctx.strokeRect(px + 1.5, py + 1.5, tileSize - 3, tileSize - 3);
    ctx.restore();
  }

  // A red strike-mark on a tile an en-passant dash would hit (its flank captures), so
  // the player can see the hit area before committing the dash.
  function drawCardFlank(tileX, tileY) {
    const cx = tileX * tileSize + tileSize / 2;
    const cy = tileY * tileSize + tileSize / 2;
    const r = tileSize * 0.24;
    ctx.save();
    ctx.strokeStyle = 'rgba(248, 113, 113, 0.95)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx - r, cy - r);
    ctx.lineTo(cx + r, cy + r);
    ctx.moveTo(cx + r, cy - r);
    ctx.lineTo(cx - r, cy + r);
    ctx.stroke();
    ctx.restore();
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
  function drawSpatter(spatter, isWall) {
    const px = spatter.x * tileSize;
    const py = spatter.y * tileSize;
    const seed = spatter.seed || 0; // per-spatter offset so stacked marks differ
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, spatter.life / spatter.max)) * 0.85;
    ctx.fillStyle = '#c81e1e'; // vivid red
    if (isWall) {
      // On a wall, blood clings and runs DOWNWARD as a few streaks/smears.
      const streaks = 2 + (seed % 3); // 2-4 streaks
      for (let i = 0; i < streaks; i += 1) {
        const fx = tileHash(spatter.x * 7 + i * 5 + seed, spatter.y * 3 + 2);
        const top = tileHash(spatter.x + i, spatter.y * 5 + seed + i);
        const cx = px + tileSize * (0.15 + fx * 0.7);
        const y0 = py + tileSize * (0.05 + top * 0.15);
        const len = tileSize * (0.3 + 0.45 * tileHash(spatter.x * 11 + i, spatter.y + seed));
        const w = tileSize * (0.05 + 0.05 * tileHash(spatter.x + seed, spatter.y * 7 + i));
        // A rounded vertical run with a heavier drip-blob at the bottom.
        ctx.beginPath();
        ctx.moveTo(cx - w / 2, y0);
        ctx.lineTo(cx + w / 2, y0);
        ctx.lineTo(cx + w / 2, y0 + len);
        ctx.lineTo(cx - w / 2, y0 + len);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.arc(cx, y0 + len, w * 0.85, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      return;
    }
    // On the ground: an IRREGULAR central splat (a cluster of offset blobs, never a clean
    // circle) with elongated droplets flung outward like real spatter — deterministic per
    // spatter so it doesn't flicker, but varied by its seed.
    const cx = px + tileSize * 0.5;
    const cy = py + tileSize * 0.5;
    const h = (a, b) => tileHash(spatter.x * a + seed + b * 3, spatter.y * b + seed + a * 2);
    // Main mass: several overlapping lobes of varied size, slightly off-centre.
    for (let i = 0; i < 5; i += 1) {
      const ang = h(7, i + 1) * Math.PI * 2;
      const dist = tileSize * 0.09 * h(3, i + 2);
      const r = tileSize * (0.08 + 0.1 * h(5, i + 4));
      ctx.beginPath();
      ctx.arc(cx + Math.cos(ang) * dist, cy + Math.sin(ang) * dist, r, 0, Math.PI * 2);
      ctx.fill();
    }
    // Flung droplets: little teardrops stretched along their outward direction, some with a
    // trailing fleck — this is what makes it read as a splatter rather than a ring of dots.
    for (let i = 0; i < 9; i += 1) {
      const ang = h(11, i + 1) * Math.PI * 2;
      const dist = tileSize * (0.17 + 0.26 * h(13, i + 1));
      const dropX = cx + Math.cos(ang) * dist;
      const dropY = cy + Math.sin(ang) * dist;
      if (dropX < px || dropX > px + tileSize || dropY < py || dropY > py + tileSize) continue; // keep it on-tile
      const len = tileSize * (0.03 + 0.11 * h(2, i + 5));
      const wid = tileSize * (0.012 + 0.03 * h(4, i + 3));
      ctx.save();
      ctx.translate(dropX, dropY);
      ctx.rotate(ang); // stretch away from the centre
      ctx.beginPath();
      ctx.ellipse(0, 0, len, wid, 0, 0, Math.PI * 2);
      ctx.fill();
      if (h(6, i + 7) > 0.55) {
        ctx.beginPath();
        ctx.arc(len * 1.6, 0, wid * 0.7, 0, Math.PI * 2); // a trailing speck
        ctx.fill();
      }
      ctx.restore();
    }
    ctx.restore();
  }

  // A corpse: the slain piece's glyph, darkened, flattened and slanted so it reads as a
  // body lying on the ground. Fades toward transparent as it decays (faster than blood).
  // A corpse: the fallen piece as a dark, flattened, slanted husk lying on the ground.
  // (Living enemies are now light-coloured tokens, so this dark shape reads clearly as a
  // dead one.) It carries the piece glyph so you can still tell what it was.
  function drawCorpse(corpse, faded) {
    // A corpse is the SAME light token as the living enemy (light bone body, dark glyph),
    // only muted/greyed a touch and flattened + slanted so it reads as that piece toppled
    // over — NOT a dark shadow. Each sits at a small random offset + slant so repeated
    // kills on one square stack into a natural-looking pile.
    const cx = corpse.x * tileSize + tileSize * (0.5 + (corpse.ox || 0));
    const cy = corpse.y * tileSize + tileSize * (0.58 + (corpse.oy || 0));
    // Start nearly opaque and hold that most of the corpse's life, only thinning out near
    // the very end (sqrt keeps it solid-looking far longer than a linear fade would).
    const lifeFrac = corpse.max ? Math.max(0, corpse.life / corpse.max) : 1;
    ctx.save();
    ctx.globalAlpha = (faded ? 0.6 : 1) * Math.max(0.18, Math.sqrt(lifeFrac));
    ctx.translate(cx, cy);
    ctx.rotate(-0.35 + (corpse.rot || 0)); // slanted, as if fallen
    ctx.scale(1, 0.5); // flattened
    ctx.beginPath();
    ctx.arc(0, 0, tileSize * 0.34, 0, Math.PI * 2);
    ctx.fillStyle = '#cbc6b7'; // muted bone (living enemy is #e7e2d1) — greyed, not black
    ctx.fill();
    ctx.lineWidth = Math.max(1, tileSize * 0.03);
    ctx.strokeStyle = '#6b6b63';
    ctx.stroke();
    ctx.fillStyle = '#2c2c30'; // dark glyph, like the living piece
    ctx.font = `bold ${tileSize * 0.42}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(pieceGlyph(corpse.kind), 0, 0);
    // Blood spattered on the body — reuses the same speck layout as living pieces, drawn
    // in the corpse's flattened/slanted frame and clipped to its body so it reads as gore
    // pooled on the fallen piece (darker, dried).
    const b = Math.min(1, corpse.blood || 0.6);
    const r = tileSize * 0.34;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#7a0f0f';
    const n = Math.max(2, Math.round(b * BLOOD_SPECKS.length));
    for (let i = 0; i < n; i += 1) {
      const [sx, sy, sr] = BLOOD_SPECKS[i];
      ctx.beginPath();
      ctx.arc(sx * r, sy * r, r * sr, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // An ash pile: a small grey mound left by a spell kill. No piece identity — all ash looks
  // alike. Jittered + stackable like corpses, and fades toward transparent as it decays.
  function drawAsh(ash, faded) {
    const cx = ash.x * tileSize + tileSize * (0.5 + (ash.ox || 0));
    const cy = ash.y * tileSize + tileSize * (0.58 + (ash.oy || 0));
    const lifeFrac = ash.max ? Math.max(0, ash.life / ash.max) : 1;
    const r = tileSize * 0.28;
    ctx.save();
    ctx.globalAlpha = (faded ? 0.4 : 0.8) * Math.max(0.12, lifeFrac);
    ctx.translate(cx, cy);
    ctx.rotate((ash.rot || 0) * 0.5);
    ctx.scale(1, 0.42); // a low, flattened mound
    // A soft charcoal heap with a lighter cap of cinders.
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = '#2b2b2f';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(-r * 0.18, -r * 0.12, r * 0.55, 0, Math.PI * 2);
    ctx.fillStyle = '#4a4a50';
    ctx.fill();
    // A few pale flecks of ash.
    ctx.fillStyle = '#6f6f77';
    for (let i = 0; i < 4; i += 1) {
      const a = (i / 4) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * r * 0.5, Math.sin(a) * r * 0.5, r * 0.1, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // Rubble: a scatter of grey rocks left where a boulder was crushed or blasted. Every pile is
  // laid out fresh from its `seed` — a wandering centre, a varied number of ANGULAR chunks each at
  // its own offset, size, grey and ROTATION — so no two look alike and overlapping piles read as a
  // real jumble of debris. Deterministic per (tile, seed) so it never flickers.
  function drawRubble(rubble, faded) {
    const px = rubble.x * tileSize;
    const py = rubble.y * tileSize;
    const seed = rubble.seed || 0;
    const lifeFrac = rubble.max ? Math.max(0, rubble.life / rubble.max) : 1;
    const h = (a, b) => tileHash(rubble.x * a + seed + b * 3, rubble.y * b + seed + a * 2);
    const cx = px + tileSize * (0.3 + 0.4 * h(7, 1)); // the pile's centre wanders per-instance
    const cy = py + tileSize * (0.32 + 0.4 * h(3, 2));
    ctx.save();
    ctx.globalAlpha = (faded ? 0.4 : 0.85) * Math.max(0.12, lifeFrac);
    const count = rubble.satellite ? 2 + (seed % 2) : 4 + (seed % 3); // 2-3 for a flung bit, 4-6 for a pile
    for (let i = 0; i < count; i += 1) {
      const ang = h(11, i + 1) * Math.PI * 2;
      const dist = tileSize * 0.22 * h(13, i + 2);
      const rx = cx + Math.cos(ang) * dist;
      const ry = cy + Math.sin(ang) * dist;
      const r = tileSize * (0.06 + 0.09 * h(5, i + 3));
      const shade = 70 + Math.floor(h(9, i + 4) * 34); // varied greys
      ctx.save();
      ctx.translate(rx, ry);
      ctx.rotate(h(17, i + 5) * Math.PI * 2); // each chunk tilted its own way
      // An irregular angular chunk (a squashed, rotated quad), never a clean circle.
      const w = r * (0.8 + 0.5 * h(2, i + 6));
      ctx.beginPath();
      ctx.moveTo(-w, r * 0.5);
      ctx.lineTo(-r * 0.4, -r);
      ctx.lineTo(w, -r * 0.3);
      ctx.lineTo(r * 0.5, r);
      ctx.closePath();
      ctx.fillStyle = `rgb(${shade + 10}, ${shade + 8}, ${shade + 14})`;
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.3)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }

  // Scrap: the RUSTY WRECKAGE a destroyed turret leaves — jagged metal shards in warm rust/steel
  // tones, clearly distinct from grey rock rubble.
  function drawScrap(s, faded) {
    const cx = s.x * tileSize + tileSize * (0.5 + (s.ox || 0));
    const cy = s.y * tileSize + tileSize * (0.56 + (s.oy || 0));
    const lifeFrac = s.max ? Math.max(0, s.life / s.max) : 1;
    ctx.save();
    ctx.globalAlpha = (faded ? 0.42 : 0.88) * Math.max(0.12, lifeFrac);
    // A few angular shards (triangles) of twisted metal.
    const shards = [
      { x: -0.16, y: 0.06, s: 0.2, a: 0.4, c: '#8a5a2b' },
      { x: 0.14, y: -0.04, s: 0.17, a: -0.7, c: '#b07a3a' },
      { x: 0.04, y: 0.15, s: 0.15, a: 1.2, c: '#6d6a72' },
      { x: -0.05, y: -0.12, s: 0.13, a: 2.1, c: '#a56b34' },
    ];
    for (const sh of shards) {
      const bx = cx + sh.x * tileSize;
      const by = cy + sh.y * tileSize;
      const r = sh.s * tileSize;
      ctx.save();
      ctx.translate(bx, by);
      ctx.rotate(sh.a);
      ctx.fillStyle = sh.c;
      ctx.beginPath();
      ctx.moveTo(-r * 0.5, r * 0.4);
      ctx.lineTo(0, -r * 0.55);
      ctx.lineTo(r * 0.55, r * 0.35);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }

  // Ice shards: the PALE-BLUE SPLINTERS a shattered ice slab leaves — angular frosted flakes,
  // distinct from grey rubble and rust scrap.
  function drawIceShards(s, faded) {
    const cx = s.x * tileSize + tileSize * (0.5 + (s.ox || 0));
    const cy = s.y * tileSize + tileSize * (0.56 + (s.oy || 0));
    const lifeFrac = s.max ? Math.max(0, s.life / s.max) : 1;
    ctx.save();
    ctx.globalAlpha = (faded ? 0.4 : 0.85) * Math.max(0.12, lifeFrac);
    const shards = [
      { x: -0.15, y: 0.05, s: 0.19, a: 0.3 }, { x: 0.15, y: -0.03, s: 0.16, a: -0.8 },
      { x: 0.03, y: 0.15, s: 0.14, a: 1.3 }, { x: -0.05, y: -0.12, s: 0.12, a: 2.0 },
    ];
    for (const sh of shards) {
      ctx.save();
      ctx.translate(cx + sh.x * tileSize, cy + sh.y * tileSize);
      ctx.rotate(sh.a);
      const r = sh.s * tileSize;
      ctx.fillStyle = 'rgba(200,235,248,0.9)';
      ctx.beginPath();
      ctx.moveTo(-r * 0.5, r * 0.4);
      ctx.lineTo(0, -r * 0.55);
      ctx.lineTo(r * 0.55, r * 0.35);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(120,170,200,0.6)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
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
        return isDark ? '#1b5a5f' : '#2f8f8c'; // deep water — nudged TEAL/green so it reads apart from ice
      case 'wall':
        return isDark ? '#54535a' : '#6a696f'; // neutral grey stone (cool, desaturated)
      case 'pit':
        return isDark ? '#0b0b12' : '#15151d'; // a dark void
      case 'ice':
        return isDark ? '#9ecfe4' : '#cdeefb'; // pale frozen slab — dark shade brightened toward the light (unlike murky water)
      case 'devilgrass':
        return isDark ? '#1c3a1e' : '#2f5f33'; // dark, sickly thicket
      case 'door':
        return isDark ? '#5a3a1c' : '#7a5024'; // a SHUT wooden door — warm timber
      case 'doorajar':
      case 'dooropen':
        // An OPEN / half-closing doorway: the sepia floor of the threshold (a leaf/frame is drawn over it).
        return isDark ? '#71481d' : '#e8c589';
      default:
        // boulder + normal both sit on ground (the boulder rock is drawn over it). In the DEMON
        // REALM (floor 5+) that ground is dark RED MARBLE instead of the upper floors' warm sepia —
        // and since a pit lays this same floor before sinking its shaft, pit rims turn to marble too.
        if (demonRealm) return isDark ? '#4a1216' : '#8f2f2c'; // dark red marble
        return isDark ? '#71481d' : '#e8c589'; // warm SEPIA ground (so fogged floor never reads as wall)
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
      case 'pit': {
        // A bottomless SHAFT punched through ordinary ground. The tile's base is plain floor (laid
        // by the caller), so the rim is drawn like any other floor — grit specks and all — and only
        // the shaft itself goes black. Keeping the hole well inside the tile is what stops a field
        // of pits reading as one big dark blot.
        const cx = px + tileSize / 2;
        const cy = py + tileSize / 2;
        const hole = tileSize * 0.36;
        // Speckle on the ground AROUND the shaft, matching whatever floor it is cut into.
        ctx.fillStyle = demonRealm
          ? (isDark ? 'rgba(255, 225, 220, 0.12)' : 'rgba(255, 225, 220, 0.16)') // marble flecks
          : (isDark ? 'rgba(0, 0, 0, 0.13)' : 'rgba(120, 80, 40, 0.16)');
        for (let i = 0; i < 4; i += 1) {
          const gx = px + tileSize * (0.12 + tileHash(x * 4 + i, y) * 0.76);
          const gy = py + tileSize * (0.12 + tileHash(x, y * 4 + i) * 0.76);
          if (Math.hypot(gx - cx, gy - cy) < hole * 1.08) continue; // never inside the shaft
          ctx.beginPath();
          ctx.arc(gx, gy, tileSize * (0.025 + 0.025 * tileHash(x + i, y - i)), 0, Math.PI * 2);
          ctx.fill();
        }
        // The shaft: black at the mouth, easing to the rim.
        const g = ctx.createRadialGradient(cx, cy - tileSize * 0.04, tileSize * 0.05, cx, cy, hole);
        g.addColorStop(0, 'rgba(0, 0, 0, 0.97)');
        g.addColorStop(0.7, 'rgba(0, 0, 0, 0.92)');
        g.addColorStop(1, 'rgba(10, 10, 16, 0.8)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(cx, cy, hole, 0, Math.PI * 2);
        ctx.fill();
        // A soft shadow where ground meets hole, and a lit near lip so it reads as depth.
        ctx.strokeStyle = demonRealm ? 'rgba(40, 8, 10, 0.6)' : 'rgba(60, 38, 16, 0.5)'; // the rim's shadow follows the floor
        ctx.lineWidth = Math.max(1.5, tileSize * 0.05);
        ctx.beginPath();
        ctx.arc(cx, cy, hole, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(214, 214, 228, 0.3)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(cx, cy, hole * 0.92, Math.PI * 1.05, Math.PI * 1.95);
        ctx.stroke();
        break;
      }
      case 'boulder': {
        // A rounded grey rock resting on the ground.
        const cx = px + tileSize / 2;
        const cy = py + tileSize * 0.52;
        const r = tileSize * 0.38;
        ctx.fillStyle = 'rgba(0,0,0,0.28)';
        ctx.beginPath();
        ctx.ellipse(cx, py + tileSize * 0.8, r * 1.05, r * 0.32, 0, 0, Math.PI * 2);
        ctx.fill();
        const g = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.2, cx, cy, r * 1.25);
        g.addColorStop(0, '#93929a');
        g.addColorStop(1, '#4a4951');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.35)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.strokeStyle = 'rgba(0,0,0,0.22)';
        ctx.beginPath();
        ctx.moveTo(cx - r * 0.4, cy - r * 0.25);
        ctx.lineTo(cx + r * 0.15, cy + r * 0.35);
        ctx.stroke();
        break;
      }
      case 'ice': {
        // A raised, rounded ICE CUBE: a translucent block inset from the tile, bevelled bright on
        // the top-left and shaded on the bottom-right so it reads as a solid frozen block, never
        // as flat ground.
        const pad = tileSize * 0.07;
        const r = tileSize * 0.22; // generously rounded corners — a cube, not a slab
        const x0 = px + pad; const y0 = py + pad; const w = tileSize - pad * 2; const h = tileSize - pad * 2;
        const roundRect = (rx, ry, rw, rh, rr) => {
          ctx.beginPath();
          ctx.moveTo(rx + rr, ry);
          ctx.arcTo(rx + rw, ry, rx + rw, ry + rh, rr);
          ctx.arcTo(rx + rw, ry + rh, rx, ry + rh, rr);
          ctx.arcTo(rx, ry + rh, rx, ry, rr);
          ctx.arcTo(rx, ry, rx + rw, ry, rr);
          ctx.closePath();
        };
        const g = ctx.createLinearGradient(x0, y0, x0 + w, y0 + h);
        g.addColorStop(0, 'rgba(236,249,255,0.9)');
        g.addColorStop(0.55, 'rgba(158,207,228,0.6)');
        g.addColorStop(1, 'rgba(96,156,188,0.72)');
        ctx.fillStyle = g;
        roundRect(x0, y0, w, h, r);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.85)'; // bright top-left bevel
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x0 + r, y0 + 1);
        ctx.arcTo(x0 + 1, y0 + 1, x0 + 1, y0 + r, r);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(56,104,134,0.75)'; // shaded bottom-right edge
        ctx.beginPath();
        ctx.moveTo(x0 + w - 1, y0 + h - r);
        ctx.arcTo(x0 + w - 1, y0 + h - 1, x0 + w - r, y0 + h - 1, r);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,0.6)'; // a crisp glint streak
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x0 + w * 0.28, y0 + h * 0.22);
        ctx.lineTo(x0 + w * 0.52, y0 + h * 0.52);
        ctx.stroke();
        break;
      }
      case 'devilgrass': {
        // Tall writhing fronds — clusters of upward slashes.
        ctx.strokeStyle = isDark ? 'rgba(120,200,120,0.5)' : 'rgba(190,255,180,0.55)';
        ctx.lineWidth = 1.5;
        for (let i = 0; i < 6; i += 1) {
          const bx = px + tileSize * (0.12 + 0.14 * i);
          const sway = (tileHash(x * 5 + i, y) - 0.5) * tileSize * 0.22;
          ctx.beginPath();
          ctx.moveTo(bx, py + tileSize * 0.9);
          ctx.quadraticCurveTo(bx + sway, py + tileSize * 0.45, bx + sway * 1.4, py + tileSize * 0.12);
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
      case 'door': {
        // A SHUT wooden door: a stone frame with vertical planks and an iron ring handle.
        const m = tileSize * 0.14;
        ctx.strokeStyle = 'rgba(30, 18, 8, 0.75)';
        ctx.lineWidth = Math.max(1.5, tileSize * 0.05);
        ctx.strokeRect(px + m, py + m * 0.4, tileSize - m * 2, tileSize - m * 0.8); // door frame
        ctx.strokeStyle = 'rgba(40, 24, 10, 0.5)';
        ctx.lineWidth = 1;
        for (let i = 1; i <= 3; i += 1) { // plank seams
          const lx = px + m + (tileSize - m * 2) * (i / 4);
          ctx.beginPath();
          ctx.moveTo(lx, py + m * 0.6);
          ctx.lineTo(lx, py + tileSize - m * 0.5);
          ctx.stroke();
        }
        ctx.fillStyle = 'rgba(20, 12, 5, 0.8)'; // handle
        ctx.beginPath();
        ctx.arc(px + tileSize - m * 1.5, py + tileSize * 0.5, tileSize * 0.05, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'dooropen': {
        // An OPEN doorway: just the empty stone jambs at either side (the leaf swung aside).
        ctx.fillStyle = 'rgba(30, 18, 8, 0.55)';
        const jw = tileSize * 0.14;
        ctx.fillRect(px + tileSize * 0.08, py + tileSize * 0.08, jw, tileSize * 0.84);
        ctx.fillRect(px + tileSize * 0.92 - jw, py + tileSize * 0.08, jw, tileSize * 0.84);
        break;
      }
      case 'doorajar': {
        // A door SWINGING SHUT: a jamb plus the leaf drawn partway across (it fully closes next turn).
        const jw = tileSize * 0.13;
        ctx.fillStyle = 'rgba(30, 18, 8, 0.5)';
        ctx.fillRect(px + tileSize * 0.08, py + tileSize * 0.1, jw, tileSize * 0.8); // left jamb
        const m = tileSize * 0.12;
        const lw = tileSize * 0.44; // the leaf covers ~half — swinging closed
        ctx.fillStyle = isDark ? 'rgba(90, 58, 28, 0.85)' : 'rgba(148, 99, 48, 0.9)';
        ctx.fillRect(px + tileSize * 0.14, py + m, lw, tileSize - m * 2);
        ctx.strokeStyle = 'rgba(30, 18, 8, 0.6)';
        ctx.lineWidth = 1;
        ctx.strokeRect(px + tileSize * 0.14, py + m, lw, tileSize - m * 2);
        break;
      }
      default: {
        // The DEMON REALM's floor is polished red MARBLE — pale veins threading the slab instead of
        // the upper floors' loose grit.
        if (demonRealm) {
          ctx.strokeStyle = isDark ? 'rgba(230, 180, 180, 0.16)' : 'rgba(255, 225, 220, 0.22)';
          ctx.lineWidth = Math.max(1, tileSize * 0.028);
          for (let i = 0; i < 2; i += 1) {
            const vy = py + tileSize * (0.24 + 0.42 * tileHash(x * 3 + i, y * 5));
            const sway = (tileHash(x + i, y * 2) - 0.5) * tileSize * 0.5;
            ctx.beginPath();
            ctx.moveTo(px, vy);
            ctx.quadraticCurveTo(px + tileSize * 0.5, vy + sway, px + tileSize, vy + sway * 0.3);
            ctx.stroke();
          }
          break;
        }
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

  // A wall-mounted TORCH: a short sconce with a layered, glowing flame that flickers off the render
  // clock (seeded per tile so neighbours dance out of phase). Marks a wall that sears any creature
  // phased into it — a hazard for the Phase-perk king.
  function drawTorch(px, py, x, y) {
    const seed = x * 7.3 + y * 3.1;
    const flick = Math.sin(clock * 8 + seed) * 0.5 + Math.sin(clock * 19 + seed * 1.7) * 0.5; // -1..1
    const cx = px + tileSize * (0.5 + 0.03 * flick);
    const baseY = py + tileSize * 0.5;
    ctx.save();
    // Iron sconce stub.
    ctx.strokeStyle = '#2a1d14';
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(1.5, tileSize * 0.06);
    ctx.beginPath();
    ctx.moveTo(px + tileSize * 0.5, baseY + tileSize * 0.14);
    ctx.lineTo(px + tileSize * 0.5, baseY);
    ctx.stroke();
    // Glowing flame — three nested teardrops (orange → amber → white-hot core).
    ctx.shadowBlur = tileSize * (0.45 + 0.18 * flick);
    ctx.shadowColor = 'rgba(255, 140, 30, 0.95)';
    const h = tileSize * (0.3 + 0.05 * flick);
    const w = tileSize * 0.15;
    const flame = (scale, color) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(cx, baseY - h * scale);
      ctx.quadraticCurveTo(cx + w * scale, baseY - h * scale * 0.35, cx, baseY);
      ctx.quadraticCurveTo(cx - w * scale, baseY - h * scale * 0.35, cx, baseY - h * scale);
      ctx.fill();
    };
    flame(1, '#f97316'); // outer orange
    flame(0.6, '#fbbf24'); // amber
    flame(0.28, '#fff7ed'); // white-hot core
    ctx.restore();
  }

  // The map's outer edge is solid STONE — rough grey rock, not the interior brick walls. A
  // full-tile rocky block with a couple of deterministic facet cracks so the rampart reads as
  // chiselled stone all the way around the level.
  function isBorderTile(x, y) {
    return x === 0 || y === 0 || x === WORLD_SIZE - 1 || y === WORLD_SIZE - 1;
  }
  function drawBorderStone(px, py, isDark, x, y) {
    ctx.save();
    const g = ctx.createLinearGradient(px, py, px + tileSize, py + tileSize);
    g.addColorStop(0, isDark ? '#57545f' : '#6d6a72');
    g.addColorStop(1, isDark ? '#3a3843' : '#48464e');
    ctx.fillStyle = g;
    ctx.fillRect(px, py, tileSize, tileSize);
    // Chunky facet cracks.
    ctx.strokeStyle = 'rgba(0,0,0,0.34)';
    ctx.lineWidth = Math.max(1, tileSize * 0.03);
    const h1 = tileHash(x, y);
    const h2 = tileHash(x + 7, y - 3);
    const h3 = tileHash(x - 5, y + 9);
    ctx.beginPath();
    ctx.moveTo(px + tileSize * (0.1 + h1 * 0.28), py);
    ctx.lineTo(px + tileSize * (0.34 + h2 * 0.28), py + tileSize * (0.42 + h3 * 0.18));
    ctx.lineTo(px + tileSize * (0.14 + h3 * 0.28), py + tileSize);
    ctx.moveTo(px + tileSize * (0.56 + h2 * 0.26), py);
    ctx.lineTo(px + tileSize * (0.7 + h1 * 0.22), py + tileSize * (0.5 + h2 * 0.2));
    ctx.lineTo(px + tileSize * (0.86 + h3 * 0.1), py + tileSize);
    ctx.stroke();
    // A faint top-edge highlight so the rock has a lit face.
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(px, py, tileSize, tileSize * 0.12);
    ctx.restore();
  }

  // A single boulder rock centred on (cx, cy), rotated by `angle` (so a rolling boulder visibly
  // TUMBLES via its cracks). The cast shadow stays flat on the ground. `faded` dims it in fog.
  function drawBoulderRock(cx, cy, angle, faded) {
    const r = tileSize * 0.38;
    ctx.save();
    ctx.globalAlpha = faded ? 0.5 : 1;
    // Flat ground shadow (not rotated).
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath();
    ctx.ellipse(cx, cy + r * 0.62, r * 1.05, r * 0.32, 0, 0, Math.PI * 2);
    ctx.fill();
    // The rock body, spun about the tile centre.
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    const g = ctx.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.2, 0, 0, r * 1.25);
    g.addColorStop(0, '#93929a');
    g.addColorStop(1, '#4a4951');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();
    // A couple of cracks so the spin READS as motion.
    ctx.strokeStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath();
    ctx.moveTo(-r * 0.4, -r * 0.25);
    ctx.lineTo(r * 0.15, r * 0.35);
    ctx.moveTo(r * 0.12, -r * 0.5);
    ctx.lineTo(r * 0.3, -r * 0.08);
    ctx.stroke();
    ctx.restore();
  }

  // Draw every boulder from its eased render (rolling ones are mid-tile), respecting fog.
  function drawBoulders(isExplored, lit) {
    for (const b of boulderRenders) {
      if (!isExplored(b.targetX, b.targetY)) continue; // still under the fog
      const cx = (b.x + 0.5) * tileSize;
      const cy = (b.y + 0.5) * tileSize;
      drawBoulderRock(cx, cy, b.angle || 0, !lit(b.targetX, b.targetY));
    }
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

  // Escalating-danger vignette. `dread` ramps 0..1 over MAX_TURNS_SCARY turns on the floor;
  // the vignette fades in from the edges as an amber warmth, then at MAX danger snaps to a
  // deeper, strongly-pulsing red that creeps further inward — a clear "get out NOW" cue.
  // The board's centre is always left untouched (transparent), so nothing is ever hidden.
  function drawDangerVignette(state) {
    if (typeof MAX_TURNS_SCARY === 'undefined' || !state || state.gameOver || state.won) return;
    const scary = state.dreadTurns || MAX_TURNS_SCARY; // Nightmare halves this
    const dread = (state.turn || 0) / scary;
    const intensity = Math.max(0, Math.min(1, (dread - 0.35) / 0.65)); // starts ~1/3 of the way in
    const maxed = (state.turn || 0) >= scary;
    if (intensity <= 0 && !maxed) return;
    const w = canvas.width;
    const h = canvas.height;
    const pulse = 0.5 + 0.5 * Math.sin(clock * (maxed ? 6.5 : 2 + dread * 2)); // quickens with danger
    let color;
    let peak;
    let inner;
    if (maxed) {
      color = '198, 26, 26'; // angry red
      peak = 0.34 + 0.34 * pulse; // big alpha jump + strong heartbeat
      inner = 0.28; // creeps further toward the middle
    } else {
      color = '226, 118, 40'; // warm amber
      peak = (0.12 + 0.2 * intensity) * (0.65 + 0.35 * pulse);
      inner = 0.44; // hugs the edges
    }
    const r = Math.hypot(w, h) / 2;
    const g = ctx.createRadialGradient(w / 2, h / 2, r * inner, w / 2, h / 2, r);
    g.addColorStop(0, `rgba(${color}, 0)`);
    g.addColorStop(0.72, `rgba(${color}, ${(peak * 0.35).toFixed(3)})`);
    g.addColorStop(1, `rgba(${color}, ${peak.toFixed(3)})`);
    ctx.save();
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
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
    miniGeom = { cell, ox, oy, world }; // remember it so a click on the minimap maps back to a tile

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
    feature(state.exit, state.exit && state.exit.portal ? '#c084fc' : '#38bdf8'); // portal — violet / stair — cyan
    if (state.key && !state.key.collected) feature(state.key, state.key.orb ? '#5eead4' : '#fbbf24'); // Orb — teal / key — gold
    // Permanent scars on explored ground: shattered summoning circles (violet).
    for (const scar of state.scars || []) {
      if (!(state.explored || {})[`${scar.x},${scar.y}`]) continue;
      miniCtx.fillStyle = '#7c5cbf';
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
    const seesAllMini = Boolean(state.player.seeAllFoes);
    for (const e of state.enemies || []) {
      if (visible.has(`${e.x},${e.y}`)) blip(e.x, e.y, '#ef4444', r);
      else if (seesAllMini) blip(e.x, e.y, '#7f1d1d', r); // Premonition radar: every foe, dim red, straight through fog
    }
    for (const a of state.allies || []) blip(a.x, a.y, '#34d399', r); // allies — green
    // The floor key: shown once spotted, OR through the fog with Premonition (a gold blip).
    if (state.key && !state.key.collected && (visible.has(`${state.key.x},${state.key.y}`) || explored[`${state.key.x},${state.key.y}`] || seesAllMini)) {
      blip(state.key.x, state.key.y, '#fde047', r);
    }
    blip(state.player.x, state.player.y, '#22c55e', r + 0.7);

    // A faint frame marking the slice of the level currently ON SCREEN — the actual camera
    // viewport (so it tracks panning / zoom and a minimap drag), not the king's sight range.
    const ts = currentTileSize();
    const viewTilesX = canvas.width / ts;
    const viewTilesY = canvas.height / ts;
    const fx = camera.x - viewTilesX / 2;
    const fy = camera.y - viewTilesY / 2;
    miniCtx.strokeStyle = 'rgba(226, 232, 240, 0.55)';
    miniCtx.lineWidth = 1;
    miniCtx.strokeRect(ox + fx * cell, oy + fy * cell, viewTilesX * cell, viewTilesY * cell);
  }

  function draw(state, showMoves, cardTargets, cardCursor, aoeTiles) {
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

    demonRealm = (state.floor || 1) >= DEMON_FLOOR; // the demon realm is floored in red marble
    const world = state.worldSize;
    const bounds = getVisibleBounds(state);
    const awareBounds = getAwarenessBounds(state); // his TWO-WAY footprint (foes here can strike back)
    const oneWayActive = Boolean(state.player.visionOneWay); // Oracle extended (one-way) sight in play
    const seeThrough = Boolean(state.player.seeThroughWalls); // Premonition: see/shoot through cover (one-way)
    // A lit tile is a SAFE one-way firing zone if it lies out in the extended Oracle band, or if the
    // king only sees it THROUGH cover (his normal line to it is blocked) — a foe there can't hit back.
    const oneWaySafe = (x, y) => (oneWayActive && !isWithinBounds(awareBounds, x, y))
      || (seeThrough && !hasLineOfSight(state, state.player.x, state.player.y, x, y, false));
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
    // Aiming a card: its target squares outrank the danger boxes (see the outline block below).
    const aiming = Boolean(cardTargets && cardTargets.length);
    const targetKeys = aiming ? new Set(cardTargets.map((t) => `${t.x},${t.y}`)) : null;

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
        if (type === 'wall' && isBorderTile(x, y)) {
          // The level's edge is a rampart of solid STONE, distinct from the brick interior walls.
          drawBorderStone(px, py, isDark, x, y);
        } else {
          // A PIT is a hole punched through ORDINARY ground, so lay plain floor first — its rim then
          // reads as the floor you walk beside, and drawTexture sinks only the shaft. (terrainColor
          // keeps its own dark shade for the minimap, where a pit must still stand out.)
          ctx.fillStyle = terrainColor(type === 'pit' ? 'normal' : type, isDark);
          ctx.fillRect(px, py, tileSize, tileSize);
          // A boulder's ROCK is drawn later (animated — it rolls); here we lay only its ground.
          if (type !== 'boulder') drawTexture(type, px, py, isDark, x, y);
          // A wall may bear a flickering torch (sears anything phased into it).
          if (type === 'wall' && typeof hasTorch === 'function' && hasTorch(state, x, y)) drawTorch(px, py, x, y);
        }

        const threatCount = inView ? threatened.get(`${x},${y}`) || 0 : 0;
        const canMove = reachable.has(`${x},${y}`);
        const isKingTile = x === state.player.x && y === state.player.y;
        // While AIMING, the danger boxes step back so the shot reads: a tile you can actually FIRE
        // at gets no box at all (its violet hint owns the square), and every other danger box is
        // drawn faint. On a board crowded with foes the red would otherwise bury the very thing
        // you're trying to hit.
        const isTargetTile = targetKeys && targetKeys.has(`${x},${y}`);
        if (!isTargetTile) {
          if (aiming) {
            ctx.save();
            ctx.globalAlpha = 0.3;
          }
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
            // A covered square the king can't reach: ORANGE if it's open ground he simply can't get
            // to, but GRAY if it's IMPASSABLE (a wall / ice / boulder he could never stand on anyway).
            const passable = typeof standableFor === 'function'
              && standableFor(type, { phaseWalls: Boolean(state.player.phase), flying: Boolean(state.player.terrainImmune) });
            tileOutline(px, py, passable ? '#f97316' : '#9ca3af', threatCount);
          }
          if (aiming) ctx.restore();
        }

        if (!inView) {
          // Out of the king's line of sight: dim it and hide what lurks there.
          ctx.fillStyle = 'rgba(2, 6, 23, 0.64)';
          ctx.fillRect(px, py, tileSize, tileSize);
        } else if (oneWaySafe(x, y)) {
          // A SAFE one-way firing zone (Oracle extended band, or a tile seen only through cover):
          // the king can shoot here but foes here can't hit him back. A cyan wash marks it apart.
          ctx.fillStyle = 'rgba(34, 211, 238, 0.13)';
          ctx.fillRect(px, py, tileSize, tileSize);
        }
      }
    }

    // Outline the king's field of view.
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = 2;
    ctx.strokeRect(bounds.x * tileSize, bounds.y * tileSize, bounds.width * tileSize, bounds.height * tileSize);

    // Blood spatters on explored ground/walls, fading with each turn (walls show streaks).
    for (const spatter of state.spatters || []) {
      if (isExplored(spatter.x, spatter.y)) {
        drawSpatter(spatter, terrainAt(state, spatter.x, spatter.y) === 'wall');
      }
    }
    // Ash piles (spell kills), rubble (smashed boulders), and corpses over the blood.
    for (const ash of state.ashes || []) {
      if (isExplored(ash.x, ash.y)) {
        drawAsh(ash, !lit(ash.x, ash.y));
      }
    }
    for (const rub of state.rubble || []) {
      if (isExplored(rub.x, rub.y)) {
        drawRubble(rub, !lit(rub.x, rub.y));
      }
    }
    for (const sc of state.scrap || []) {
      if (isExplored(sc.x, sc.y)) {
        drawScrap(sc, !lit(sc.x, sc.y));
      }
    }
    for (const sh of state.iceShards || []) {
      if (isExplored(sh.x, sh.y)) {
        drawIceShards(sh, !lit(sh.x, sh.y));
      }
    }
    for (const corpse of state.corpses || []) {
      if (isExplored(corpse.x, corpse.y)) {
        drawCorpse(corpse, !lit(corpse.x, corpse.y));
      }
    }
    // Boulders (rolling + spinning) sit on the ground above the decor.
    drawBoulders(isExplored, lit);

    // The stair down: shown when in sight, or faded once discovered.
    if (state.exit) {
      const seen = lit(state.exit.x, state.exit.y);
      if (seen || state.exit.discovered) {
        if (state.exit.portal) drawPortal(state.exit.x, state.exit.y, !seen, state.exit.locked);
        else drawExit(state.exit.x, state.exit.y, !seen, state.exit.locked);
      }
    }

    // The floor key / Orb of Victory: shown when in sight, or faded once discovered (persists in fog).
    if (state.key && !state.key.collected) {
      const seen = lit(state.key.x, state.key.y);
      // Premonition (seeAllFoes) reveals the key straight through the fog (drawn faded).
      if (seen || state.key.discovered || state.player.seeAllFoes) {
        if (state.key.orb) drawOrb(state.key.x, state.key.y, !seen);
        else drawKey(state.key.x, state.key.y, !seen);
      }
    }

    // Permanent scars (shattered summoning circles): shown forever once explored.
    for (const scar of state.scars || []) {
      if (isExplored(scar.x, scar.y)) drawScar(scar, !lit(scar.x, scar.y));
    }

    // While aiming a card, show its reachable tiles in violet; otherwise the plain
    // moves are the light-green tint above and we only mark the special cases:
    // capture targets (ring) and knight-leap tiles (blue dot).
    // A spell's full AoE (the pierced line, or every Barrage line) under the cursor —
    // drawn first so the target hints and cursor box sit on top of it.
    if (aoeTiles && aoeTiles.length) {
      for (const t of aoeTiles) drawAoeTile(t.x, t.y);
    }
    if (cardTargets) {
      for (const target of cardTargets) {
        drawCardHint(target.x, target.y, target.capture);
        // En-passant dashes carry the two flank tiles they strike — mark them so the
        // hit area is obvious before the dash is committed.
        if (target.flanks) {
          for (const f of target.flanks) drawCardFlank(f.x, f.y);
        }
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
    // Premonition (seeAllFoes): EVERY enemy on the floor is shown as a radar blip, straight
    // through the fog — the out-of-sight ones faded, so the player has full foe awareness even
    // though he can still only target within his sight.
    const seesAll = Boolean(state.player.seeAllFoes);
    const shown = enemyRenders.filter((enemy) => lit(enemy.targetX, enemy.targetY) || seesAll);
    const isMoving = (enemy) => Math.abs(enemy.x - enemy.targetX) + Math.abs(enemy.y - enemy.targetY) > 0.05;
    const ordered = [...shown.filter((enemy) => !isMoving(enemy)), ...shown.filter(isMoving)];
    // A unit's gore lives on the live state object (render objects only track position), so
    // look it up by id.
    const liveById = new Map((state.enemies || []).map((e) => [e.id, e]));
    for (const enemy of ordered) {
      const role = enemy.role || 'normal';
      const inSight = lit(enemy.targetX, enemy.targetY);
      // A spent summoning circle, or an enemy seen only through Premonition, is faded.
      const inactive = (role === 'circle' && !enemy.charged) || !inSight;
      drawPiece(enemy.x, enemy.y, enemy.kind, false, { role, rush: enemy.rush, mini: enemy.mini, fire: enemy.fire, inactive, blood: woundBlood(liveById.get(enemy.id)) });
      if (role === 'boss') {
        drawBossTraitHat(enemy.x, enemy.y, enemy.bossPerk, enemy.rush || enemy.mini); // trait-specific crown (ashen for minis)
      } else if (role !== 'normal') {
        drawRoleHat(enemy.x, enemy.y, role);
      }
      // A charging summoning circle shows the minion-to-be gathering — a ghost of its own piece
      // kind that grows more solid as the conjuring nears (fires on the 4th tick, so a slower,
      // more gradual wind-up).
      if (role === 'circle' && inSight && (enemy.summonTick % 4) > 0) {
        drawSummonCharge(enemy.x, enemy.y, enemy.kind, (enemy.summonTick % 4) / 4);
      }
      // A boss (and now a destructible turret) wears a HP bar so its multi-hit state reads.
      if ((enemy.boss || enemy.turret) && enemy.maxHp) {
        drawBossHpBar(enemy.x, enemy.y, enemy.hp, enemy.maxHp);
      }
      // State icon. A boss or turret catching its breath (cooldown) shows the recharge
      // glyph — otherwise the main-AI-state icon (turrets/circles have none of the latter).
      const live = liveById.get(enemy.id);
      if (inSight && live && live.recovering && (enemy.boss || enemy.turret)) {
        drawStateIcon(enemy.x, enemy.y, 'recovering');
      } else if (inSight && role === 'turret') {
        // Show the crosshair ONLY while the king is actually in the turret's line RIGHT NOW (computed
        // fresh, so a stale aim flag never lingers); otherwise it sits idle with a sleep "z".
        const live2 = live || enemy;
        const targetingNow = !enemy.dozing && typeof turretHasKingInLine === 'function' && turretHasKingInLine(state, live2);
        drawStateIcon(enemy.x, enemy.y, targetingNow ? 'aiming' : 'asleep');
      } else if (inSight && isBefriendedBeast(state, enemy)) {
        drawStateIcon(enemy.x, enemy.y, 'befriended'); // Wild Empathy: a tamed beast (♥)
      } else if (inSight && role !== 'turret' && role !== 'circle') {
        const mainState = enemy.asleep ? 'asleep' : enemy.surprised ? 'surprised' : enemy.frustrated ? 'frustrated' : enemy.awake ? 'hostile' : 'unaware';
        if (mainState) drawStateIcon(enemy.x, enemy.y, mainState);
      }
    }

    // The king's allies (Necromancer familiar / undead): green tokens with a heart, always
    // shown (they are on his side, so never hidden by fog). Positions come from the EASED ally
    // renders (so they glide like every other piece); gore is looked up on the live ally by id.
    const allyById = new Map((state.allies || []).map((a) => [a.id, a]));
    for (const ar of allyRenders) {
      const live = allyById.get(ar.id);
      drawPiece(ar.x, ar.y, ar.kind, false, { role: 'ally', blood: woundBlood(live) });
      drawStatusMark(ar.x, ar.y, '♥', '#f472b6');
    }

    const classColor =
      typeof playerDisplayColor === 'function'
        ? playerDisplayColor(state.player)
        : typeof highestClass === 'function' && typeof CLASSES !== 'undefined'
          ? (CLASSES[highestClass(state.player)] || {}).color
          : null;
    // While Promoted the king shows as an amazon (he moves and fights as one).
    const playerGlyph = state.player.promotion > 0 ? 'amazon' : 'king'; // an invincible amazon while in Animal Form
    drawPiece(playerRender.x, playerRender.y, playerGlyph, true, { classColor, blood: woundBlood(state.player) });
    if (state.player.warded) {
      drawWardMark(playerRender.x, playerRender.y);
    }

    drawProjectiles();
    drawBursts();
    drawPuffs();
    drawShouts();

    ctx.restore();

    // Escalating danger: a warm edge vignette that intensifies the longer the king lingers,
    // snapping to an angry, pulsing red once the floor hits max danger. Purely atmospheric —
    // the centre of the board stays perfectly clear, so vision never changes.
    drawDangerVignette(state);

    if (flash > 0) {
      // A tinted wash over the whole canvas, fading out (color set by effect()).
      ctx.fillStyle = `rgba(${flashColor}, ${flashPeak * flash})`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    drawMinimap(state); // whole-level overview, bottom-right (over the hit flash)
  }

  return { init, reset, sync, update, draw, hit, effect, rangedShot, centerOn, centerCameraOn, minimapToTile, bump, bumpBoulder, lunge, shout, panBy, panByPixels, zoomBy, screenToTile };
})();

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
  // Per-frame handles on the tree state, so drawTexture can size a canopy to its wounds and set it
  // ablaze. Set in draw(), exactly like demonRealm — drawTexture is called per tile and has no
  // route to `state` of its own.
  let treeHp = null;
  let burnTrees = null;
  // The geyser clock's current STAGE for this frame — 'erupting' (blowing gas, blocks sight),
  // 'imminent' (tall warning plume, ending a turn here next means the blast), or 'calm'. Set in draw()
  // from state.geyserPhase, since drawTexture gets no route to `state`.
  let geyserStage = 'calm';
  let fogNow = null; // per-frame ref to state.fog ("x,y" -> turns left), set in draw()
  let seeThroughHaze = false; // Premonition / Sixth Sense: the king sees CLEAR through haze — draw no veil

  let playerRender = { x: 0, y: 0, targetX: 0, targetY: 0 };
  let enemyRenders = [];
  let allyRenders = []; // the king's summons — eased like enemies (they used to snap)
  let allySyncedOnce = false; // guards the first sync of a floor: an ally already at his side is not a conjuring
  let puffs = []; // purple-smoke death puffs for vanished allies (client-side, time-decayed)
  let scheduledBumps = []; // knockback nudges held a beat each, so a shove WAVE ripples outward instead of jerking as one
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
  // The ids of the foes that threaten the tile under the cursor. Late game there can be a dozen
  // pieces on screen and working out WHICH of them covers the square you are eyeing means tracing
  // every line by eye; this rings the culprits instead. Set on hover, empty the rest of the time.
  let markedThreats = new Set();

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

  // A foe SWINGING at the king: shove its token a third of a tile at him. It is never retargeted,
  // so the ordinary easing hauls it straight back to its own square — a lunge and a recoil, the
  // same trick bumpBoulder plays. Without it a melee blow was invisible: the king lost a heart
  // while every piece on the board stood perfectly still.
  function bumpEnemy(id, dx, dy, delay) {
    if (delay && delay > 0) { scheduledBumps.push({ id, dx, dy, t: delay }); return; } // ripple: fires after a beat
    const e = enemyRenders.find((r) => r.id === id);
    if (e) { e.x += dx * 0.34; e.y += dy * 0.34; }
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
      parry: Boolean(enemy.parry),
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
    scheduledBumps = [];
    allySyncedOnce = false; // ...and nobody standing beside him on arrival was CONJURED there
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
      render.parry = Boolean(enemy.parry);
      next.push(render);
    }
    enemyRenders = next;

    // Allies (the king's summons): glide to their new tiles exactly like enemies. Any ally that
    // has vanished since last sync has DIED — it dissolves into a puff of purple smoke where it
    // last stood.
    const nextAllies = [];
    const firstSync = allyRenders.length === 0 && !allySyncedOnce;
    for (const ally of state.allies || []) {
      let render = allyRenders.find((it) => it.id === ally.id);
      if (!render) {
        render = { id: ally.id, x: ally.x, y: ally.y, targetX: ally.x, targetY: ally.y };
        // An ally CONJURED into the world — the familiar padding back once the coast is clear, a
        // slain foe rising as undead, a beast bowing — arrives in the same puff of violet smoke a
        // summoned foe does. It used to just blink into existence: the sound played and nothing on
        // screen said where to look.
        //
        // Skipped on the very first sync of a floor, where every ally is "new" and a puff would
        // fire for something that simply walked in with him.
        if (!firstSync) puffs.push({ x: ally.x, y: ally.y, t: 0, summon: true });
      }
      render.targetX = ally.x;
      render.targetY = ally.y;
      render.kind = ally.kind;
      nextAllies.push(render);
    }
    allySyncedOnce = true;
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
    // Held knockback nudges: count each down, and fire it (the token jerks and eases back) once its
    // beat elapses — so a shove wave ripples out tile by tile instead of every foe lurching at once.
    if (scheduledBumps.length) {
      const still = [];
      for (const b of scheduledBumps) {
        b.t -= delta;
        if (b.t <= 0) { const e = enemyRenders.find((r) => r.id === b.id); if (e) { e.x += b.dx * 0.34; e.y += b.dy * 0.34; } }
        else still.push(b);
      }
      scheduledBumps = still;
    }
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
  // knight-compound movers). berolina = a demonic pawn; nightrider/archbishop/chancellor/amazon add
  // the knight leap, hence the wings. A nightrider wears the knight's own glyph — it IS a knight,
  // one that never stops leaping.
  const DEMON_BASE_GLYPH = { berolina: '♟', nightrider: '♞', archbishop: '♝', chancellor: '♜', amazon: '♛' };
  const DEMON_WINGED = new Set(['nightrider', 'archbishop', 'chancellor', 'amazon']); // the knight-leapers
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

    // NB: the MANN deliberately gets NO colour override. It used to be painted bone-white, which made
    // it the ONE ally on the board not wearing the king's green — his risen familiar read as a third
    // faction standing next to his skeleton rook. Its SHAPE is what makes it distinct now (a skull;
    // see getPieceLabel), and its colour says whose side it is on, which is the job colour should do.

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

    // A demon (fairy) enemy/ally sprouts horns and wings behind its token (never the king) — but a
    // summoning CIRCLE is a rune, not a creature, so it grows no horns however demonic its brood.
    if (!isPlayer && role !== 'circle' && isDemonKind(kind)) drawDemonMarks(cx, cy, radius, kind);

    if (role === 'circle') {
      // A SUMMONING CIRCLE is not a creature — it is a rune cut into the floor. Draw the same
      // violet ring its scar leaves behind once broken, with the piece it will conjure STAMPED
      // small and purple on the stone inside it. No filled token, so it never reads as a foe.
      ctx.save();
      ctx.globalAlpha = o.charged === false ? 0.5 : 1;
      ctx.strokeStyle = '#a855f7';
      ctx.lineWidth = Math.max(1.5, tileSize * 0.055);
      ctx.beginPath();
      ctx.arc(cx, cy, tileSize * 0.34, 0, Math.PI * 2); // the ring (intact — the scar's is broken)
      ctx.stroke();
      ctx.globalAlpha *= 0.45;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, tileSize * 0.25, 0, Math.PI * 2); // a fainter inner ring
      ctx.stroke();
      ctx.globalAlpha = o.charged === false ? 0.5 : 1;
      ctx.fillStyle = '#c084fc'; // the brood-to-be, stamped on the ground
      ctx.font = `${tileSize * 0.38}px serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(pieceGlyph(kind), cx, cy + tileSize * 0.02);
      ctx.restore();
    } else if (isFerz) {
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
      // A MANN is RISEN: dry rib-bones laid across its token, so the skull reads as a whole skeleton
      // rather than a floating head. Tinted to the token's own glyph colour rather than a fixed
      // bone-grey — it wears the king's green now like every other ally, and hard-coded bone would
      // put a dead patch in the middle of it.
      if (kind === 'mann' && !isPlayer) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, bodyRadius, 0, Math.PI * 2);
        ctx.clip(); // keep the bones on the token
        ctx.globalAlpha = 0.5;
        ctx.strokeStyle = glyph;
        ctx.lineWidth = Math.max(1, tileSize * 0.03);
        ctx.lineCap = 'round';
        for (let i = -1; i <= 1; i += 1) {
          const ry = cy + i * bodyRadius * 0.3 + bodyRadius * 0.42; // ribs BELOW the skull, not across it
          ctx.beginPath();
          ctx.moveTo(cx - bodyRadius * 0.42, ry);
          ctx.lineTo(cx + bodyRadius * 0.42, ry);
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
        // DARK fracture lines gouged into the steel — a crack reads as damage when it's a shadow in
        // the metal, not a bright line laid over it (which the old pale version looked like: a shine,
        // not a wound). A thin steel glint down the middle gives the fissure depth. Longer and
        // thicker as it nears destruction, so a turret one hit from scrap plainly LOOKS it.
        ctx.globalAlpha = (o.inactive ? 0.4 : 1) * Math.min(1, 0.7 + b * 0.3);
        const cracks = Math.max(2, Math.round(b * 5));
        for (let i = 0; i < cracks; i += 1) {
          const a0 = (i / Math.max(2, cracks)) * Math.PI * 2 + 0.5;
          const r0 = radius * 0.16;
          const r1 = radius * (0.5 + 0.18 * b);
          const p0x = cx + Math.cos(a0) * r0; const p0y = cy + Math.sin(a0) * r0;
          const p1x = cx + Math.cos(a0) * r1; const p1y = cy + Math.sin(a0) * r1;
          const p2x = cx + Math.cos(a0 + 0.4) * r1 * 0.85; const p2y = cy + Math.sin(a0 + 0.4) * r1 * 0.85;
          const stroke = (col, w) => {
            ctx.strokeStyle = col; ctx.lineWidth = Math.max(1, w); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
            ctx.beginPath(); ctx.moveTo(p0x, p0y); ctx.lineTo(p1x, p1y); ctx.lineTo(p2x, p2y); ctx.stroke();
          };
          stroke('rgba(2,3,6,0.92)', radius * (0.1 + 0.03 * b)); // the dark fissure — the crack itself
          stroke('rgba(150,158,174,0.5)', radius * 0.03); // a thin steel glint deep in the gouge
        }
      } else {
        ctx.globalAlpha = (o.inactive ? 0.4 : 1) * Math.min(0.9, 0.4 + b * 0.55);
        // A demon's own wounds weep dark green ichor rather than blood.
        ctx.fillStyle = (!isPlayer && isDemonKind(kind)) ? '#155e2b' : '#a5121b';
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
    warper: { color: '#818cf8', mark: '⇄' }, // indigo swap-arrows
    guardian: { color: '#38bdf8', mark: '⛨' }, // warding shield
    mechanic: { color: '#e0894b', mark: '⚙' }, // rust cog
    hotblooded: { color: '#ef4444', mark: '♨' }, // boiling heat
    icygrasp: { color: '#7dd3fc', mark: '❄' }, // frost
    shadowstep: { color: '#4b3a6b', mark: '☾' }, // shadow crescent
    anchored: { color: '#78716c', mark: '⚓' }, // an anchor
    gardener: { color: '#4ade80', mark: '❀' }, // a bloom
    petowner: { color: '#d97706', mark: '❦' }, // a leashed familiar
    hasty: { color: '#facc15', mark: '»' }, // twin chevrons of speed
    burrower: { color: '#7c5b3a', mark: '⧗' }, // a bored shaft
    fogweaver: { color: '#cbd5e1', mark: '☁' }, // a pale storm cloud
    wary: { color: '#94a3b8', mark: '⛨' }, // a raised steel guard (matches the ward's steel border)
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
    const h = tileSize * 0.1;
    const x = tileX * tileSize + (tileSize - w) / 2;
    const y = tileY * tileSize + tileSize * 0.86;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
    ctx.fillStyle = '#3a0d0d';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = frac > 0.5 ? '#e0b341' : frac > 0.25 ? '#e07a2b' : '#dc2626';
    ctx.fillRect(x, y, w * frac, h);
    // SEGMENT a small pool into discrete pips so a turret's 3 HP reads at a glance as "three hits
    // left" — a smooth bar hides exactly how much a single shot took off. Big boss pools stay smooth.
    if (maxHp >= 2 && maxHp <= 6) {
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      const seg = w / maxHp;
      for (let i = 1; i < maxHp; i += 1) ctx.fillRect(Math.round(x + seg * i), y, Math.max(1, tileSize * 0.012), h);
    }
    ctx.restore();
  }

  // At-a-glance STATE icon above a piece: surprise, hostility, or frustration.
  // (Sleeping / wandering pieces are out of sight, so they are never drawn.)
  function drawStateIcon(tileX, tileY, mainState) {
    // Hostile is the default state (no icon, to avoid clutter). Only the transient
    // surprised / frustrated states show a mark.
    if (mainState === 'confused') {
      // Arcane violet, matching the Hexes chain that deals it out. Confusion outranks every other
      // mark: a confused piece is not hunting, dozing or aiming, whatever its other flags say.
      drawStatusMark(tileX, tileY, '๑', '#c084fc');
    } else if (mainState === 'surprised') {
      drawStatusMark(tileX, tileY, '!', '#ffd400');
    } else if (mainState === 'asleep') {
      drawStatusMark(tileX, tileY, 'z', '#93c5fd'); // a soft-blue "z" for a slumbering foe
    } else if (mainState === 'unaware') {
      drawStatusMark(tileX, tileY, '?', '#a3a3a3'); // a grey "?" — it hasn't noticed the king
    } else if (mainState === 'frustrated') {
      drawStatusMark(tileX, tileY, '✖', '#fca5a5');
    } else if (mainState === 'recovering') {
      drawStatusMark(tileX, tileY, '⟳', '#67e8f9'); // cyan recharge glyph — winded / cooling down
    } else if (mainState === 'neutral') {
      // A HOLLOW heart, against the filled one his allies wear. The pairing is the whole point: it
      // reads at a glance as "friendly, but not yours yet" — walk up to it and it fills in.
      drawStatusMark(tileX, tileY, '♡', '#a7f3d0');
    } else if (mainState === 'aiming') {
      // A BRIGHT red crosshair — a turret locking onto the king, and the one status you must never
      // miss. Bigger, hotter, and PULSING so it catches the eye the way a lock-on should. It also
      // throws a red glow, which is what actually makes it pop against the board.
      const cx = tileX * tileSize + tileSize * 0.78;
      const cy = tileY * tileSize + tileSize * 0.22;
      const beat = 0.6 + 0.4 * (0.5 + 0.5 * Math.sin(clock * 6));
      const r = tileSize * 0.18;
      ctx.save();
      ctx.shadowBlur = tileSize * 0.3 * beat;
      ctx.shadowColor = 'rgba(255, 40, 40, 0.95)';
      ctx.lineWidth = Math.max(1.5, tileSize * 0.03);
      ctx.strokeStyle = 'rgba(0,0,0,0.5)'; // dark rim so the red reads on a light tile
      ctx.beginPath(); ctx.arc(cx, cy, r + tileSize * 0.02, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = '#ff2222';
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx - r * 1.6, cy); ctx.lineTo(cx + r * 1.6, cy);
      ctx.moveTo(cx, cy - r * 1.6); ctx.lineTo(cx, cy + r * 1.6);
      ctx.stroke();
      ctx.fillStyle = '#ff2222';
      ctx.beginPath(); ctx.arc(cx, cy, r * 0.32, 0, Math.PI * 2); ctx.fill();
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
      // Gray for fire/lava scorch smoke; pink for a Hex; violet for arcane conjuring/dissolve.
      const bodyRGB = puff.gray ? '120, 120, 128' : puff.hex ? '236, 72, 153' : '168, 85, 247';
      const coreRGB = puff.gray ? '200, 200, 205' : puff.hex ? '251, 207, 232' : '216, 180, 254';
      for (let i = 0; i < 6; i += 1) {
        const ang = (i / 6) * Math.PI * 2 + t * 1.6;
        const dist = tileSize * (0.04 + t * 0.34);
        const r = tileSize * (0.13 + t * 0.16) * (i % 2 ? 0.75 : 1);
        ctx.fillStyle = `rgba(${bodyRGB}, ${(fade * 0.5).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(cx + Math.cos(ang) * dist, cy - tileSize * t * 0.18 + Math.sin(ang) * dist, r, 0, Math.PI * 2);
        ctx.fill();
      }
      // A brighter core that shrinks as the smoke thins.
      ctx.fillStyle = `rgba(${coreRGB}, ${(fade * 0.65).toFixed(3)})`;
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
  // The Parry GUARD: a small steel shield riding above the king's token whenever his guard is
  // raised — so "am I covered?" is answerable at a glance, without reading the log.
  // ANIMAL FORM, and how much of it is left. A timer in the sidebar is no use to a player watching
  // the board — he has to read it off the KING, where his eyes already are.
  //
  // The count is drawn as literal rings around him, one per turn remaining, so "how long have I got"
  // is a thing you glance at rather than something you have to have been counting. And the LAST turn
  // is called out in red and beats hard: the form ticks down before the room swings, so acting on
  // one ring means taking the next blows as a bare king. That turn is where a player who has spent
  // three turns being invincible gets killed, and it should look like a warning, not a countdown.
  function drawBeastAura(tileX, tileY, turns) {
    const cx = tileX * tileSize + tileSize / 2;
    const cy = tileY * tileSize + tileSize / 2;
    const last = turns <= 1;
    const beat = 0.5 + 0.5 * Math.sin(clock * (last ? 7 : 2.6));
    ctx.save();
    // The halo: green and steady while it holds, red and hammering on the last turn.
    const glow = last ? '239, 68, 68' : '74, 222, 128';
    const grad = ctx.createRadialGradient(cx, cy, tileSize * 0.2, cx, cy, tileSize * 0.62);
    grad.addColorStop(0, `rgba(${glow}, 0)`);
    grad.addColorStop(0.55, `rgba(${glow}, ${(0.16 + 0.2 * beat).toFixed(3)})`);
    grad.addColorStop(1, `rgba(${glow}, 0)`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, tileSize * 0.62, 0, Math.PI * 2);
    ctx.fill();
    // One ring per turn left — the count itself, readable at a glance.
    ctx.lineWidth = Math.max(1.5, tileSize * 0.035);
    for (let i = 0; i < Math.min(turns, 4); i += 1) {
      ctx.strokeStyle = `rgba(${glow}, ${(last ? 0.5 + 0.45 * beat : 0.75 - i * 0.14).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(cx, cy, tileSize * (0.44 + i * 0.055), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  // The tell that the Animal Form king is a UNICORN, not just another horse: a spiralled golden HORN
  // jutting up from its brow, a wisp of a rainbow mane, and a drifting sparkle. Without it the green
  // token read as one more knight — this is what makes it unmistakable at a glance.
  function drawUnicornHorn(tileX, tileY) {
    const cx = tileX * tileSize + tileSize / 2;
    const cy = tileY * tileSize + tileSize / 2;
    const baseX = cx + tileSize * 0.12;      // brow, a touch forward of centre
    const baseY = cy - tileSize * 0.24;
    const tipX = cx + tileSize * 0.26;       // horn angles up and forward
    const tipY = cy - tileSize * 0.52;
    ctx.save();
    // The horn: a tapering gold spike with a dark keyline so it survives any background.
    ctx.shadowBlur = tileSize * 0.28;
    ctx.shadowColor = 'rgba(253, 224, 71, 0.9)';
    const grad = ctx.createLinearGradient(baseX, baseY, tipX, tipY);
    grad.addColorStop(0, '#fde047');
    grad.addColorStop(1, '#fff7cc');
    ctx.fillStyle = grad;
    const w = tileSize * 0.06;
    const nx = -(tipY - baseY);
    const ny = (tipX - baseX);
    const nlen = Math.hypot(nx, ny) || 1;
    const ox = (nx / nlen) * w;
    const oy = (ny / nlen) * w;
    ctx.beginPath();
    ctx.moveTo(baseX + ox, baseY + oy);
    ctx.lineTo(baseX - ox, baseY - oy);
    ctx.lineTo(tipX, tipY);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(120, 53, 15, 0.85)';
    ctx.lineWidth = Math.max(1, tileSize * 0.015);
    ctx.stroke();
    // Two spiral ridges across the horn so it reads as twisted, not a plain cone.
    ctx.strokeStyle = 'rgba(180, 120, 20, 0.75)';
    ctx.lineWidth = Math.max(1, tileSize * 0.014);
    for (let i = 1; i <= 2; i += 1) {
      const t = i / 3;
      const mx = baseX + (tipX - baseX) * t;
      const my = baseY + (tipY - baseY) * t;
      ctx.beginPath();
      ctx.moveTo(mx + ox * (1 - t), my + oy * (1 - t));
      ctx.lineTo(mx - ox * (1 - t), my - oy * (1 - t));
      ctx.stroke();
    }
    // A drifting sparkle off the tip — a tiny four-point star that twinkles on the tile clock.
    const tw = 0.5 + 0.5 * Math.sin(clock * 4 + tileX * 1.3 + tileY * 0.7);
    const sx = tipX + tileSize * 0.06;
    const sy = tipY - tileSize * 0.02;
    const sr = tileSize * (0.03 + 0.03 * tw);
    ctx.fillStyle = `rgba(255, 255, 255, ${(0.5 + 0.5 * tw).toFixed(3)})`;
    ctx.beginPath();
    ctx.moveTo(sx, sy - sr);
    ctx.lineTo(sx + sr * 0.32, sy - sr * 0.32);
    ctx.lineTo(sx + sr, sy);
    ctx.lineTo(sx + sr * 0.32, sy + sr * 0.32);
    ctx.lineTo(sx, sy + sr);
    ctx.lineTo(sx - sr * 0.32, sy + sr * 0.32);
    ctx.lineTo(sx - sr, sy);
    ctx.lineTo(sx - sr * 0.32, sy - sr * 0.32);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // A bobbing arrow pointing DOWN at whatever he is supposed to be going for: the key while he
  // hunts it, then the way out once it is his. Only ever ONE of them on screen at a time, because
  // it means "this, now" — two would mean neither.
  //
  // Drawn ABOVE the tile and moving, because that is the whole point: the key already glows, and a
  // glow among torches, lava and spell light is just more light. Motion against a still board is
  // what the eye actually catches, and it is what stops a player walking past the one thing on the
  // floor he came for.
  function drawObjectiveArrow(tileX, tileY, color) {
    const cx = tileX * tileSize + tileSize / 2;
    const bob = Math.sin(clock * 2.4) * tileSize * 0.09;
    const tipY = tileY * tileSize - tileSize * 0.06 + bob;   // hovers just clear of the tile
    const h = tileSize * 0.3;
    const w = tileSize * 0.24;
    ctx.save();
    ctx.shadowBlur = tileSize * 0.35;
    ctx.shadowColor = color;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(cx, tipY);                       // the point, aimed at the tile
    ctx.lineTo(cx - w / 2, tipY - h * 0.55);
    ctx.lineTo(cx - w * 0.18, tipY - h * 0.55);
    ctx.lineTo(cx - w * 0.18, tipY - h);        // the shaft
    ctx.lineTo(cx + w * 0.18, tipY - h);
    ctx.lineTo(cx + w * 0.18, tipY - h * 0.55);
    ctx.lineTo(cx + w / 2, tipY - h * 0.55);
    ctx.closePath();
    ctx.fill();
    // A dark outline so it survives being drawn over a bright tile (lava, a lit torch, the portal).
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(15, 23, 42, 0.75)';
    ctx.lineWidth = Math.max(1, tileSize * 0.018);
    ctx.stroke();
    ctx.restore();
  }

  function drawGuardMark(tileX, tileY) {
    // Tucked into the top-right CORNER at the same size as an enemy's status mark (drawStatusMark's
    // 0.8/0.2), not planted over the crown. It is a persistent state — it can sit there for many
    // turns — so it has to live where the eye files status, or it competes with the piece itself.
    const cx = tileX * tileSize + tileSize * 0.8;
    const top = tileY * tileSize + tileSize * 0.04;
    const w = tileSize * 0.24;
    const h = tileSize * 0.26;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cx - w / 2, top);
    ctx.lineTo(cx + w / 2, top);
    ctx.lineTo(cx + w / 2, top + h * 0.55);
    ctx.quadraticCurveTo(cx, top + h * 1.2, cx, top + h);
    ctx.quadraticCurveTo(cx, top + h * 1.2, cx - w / 2, top + h * 0.55);
    ctx.closePath();
    ctx.fillStyle = 'rgba(148, 163, 184, 0.95)'; // steel, not the cyan of a magic ward
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#1e293b';
    ctx.stroke();
    ctx.restore();
  }

  // A GOLDEN shield badge in the top-LEFT corner while WAITING (Sentinel) holds — the same shape as the
  // Parry mark but gold, and on the opposite corner so both can show at once (a Sentinel who Waits also
  // banks a Parry). It reads as a persistent "I am untouchable until my next turn" tell, alongside the
  // whole-body halo — the badge for a glance, the halo for the drama.
  function drawWaitMark(tileX, tileY) {
    const cx = tileX * tileSize + tileSize * 0.2; // top-LEFT (Parry lives top-right)
    const top = tileY * tileSize + tileSize * 0.04;
    const w = tileSize * 0.24;
    const h = tileSize * 0.26;
    const beat = 0.75 + 0.25 * (0.5 + 0.5 * Math.sin(clock * 5));
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cx - w / 2, top);
    ctx.lineTo(cx + w / 2, top);
    ctx.lineTo(cx + w / 2, top + h * 0.55);
    ctx.quadraticCurveTo(cx, top + h * 1.2, cx, top + h);
    ctx.quadraticCurveTo(cx, top + h * 1.2, cx - w / 2, top + h * 0.55);
    ctx.closePath();
    ctx.fillStyle = `rgba(250, 204, 21, ${beat.toFixed(3)})`; // gold, matching the invuln halo
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#3f2d07';
    ctx.stroke();
    ctx.restore();
  }

  // A pulsing GOLDEN HALO round the king while WAITING (Sentinel) makes him invincible for the turn.
  // A ring, not a corner badge, so it never collides with the Parry shield the same king may be
  // wearing top-right — and a whole-body glow reads as "nothing can touch me" better than a pip.
  function drawInvulnMark(tileX, tileY) {
    const cx = tileX * tileSize + tileSize / 2;
    const cy = tileY * tileSize + tileSize / 2;
    const pulse = 0.5 + 0.5 * Math.sin(clock * 4);
    const r = tileSize * (0.42 + 0.05 * pulse);
    ctx.save();
    ctx.lineWidth = Math.max(2, tileSize * 0.05);
    ctx.strokeStyle = `rgba(255, 226, 140, ${(0.55 + 0.35 * pulse).toFixed(3)})`;
    ctx.shadowBlur = tileSize * 0.28 * pulse;
    ctx.shadowColor = 'rgba(255, 210, 90, 0.9)';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // A small cyan shield on a WARDED foe (a Guardian's retinue) — top-left, clear of the trait crown
  // and the HP bar, so "strike me twice" reads at a glance.
  function drawWardMark(tileX, tileY) {
    const cx = tileX * tileSize + tileSize * 0.2;
    const top = tileY * tileSize + tileSize * 0.05;
    const w = tileSize * 0.22;
    const h = tileSize * 0.24;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cx - w / 2, top);
    ctx.lineTo(cx + w / 2, top);
    ctx.lineTo(cx + w / 2, top + h * 0.55);
    ctx.quadraticCurveTo(cx, top + h * 1.2, cx, top + h);
    ctx.quadraticCurveTo(cx, top + h * 1.2, cx - w / 2, top + h * 0.55);
    ctx.closePath();
    // The SAME steel shield the KING's own Parry wears (drawGuardMark) — one symbol for "a guard is up,
    // the next blow is turned aside", whoever is holding it. It used to be cyan to read as a magic
    // ward, which just meant the player had two different marks to learn for one mechanic.
    ctx.fillStyle = 'rgba(148, 163, 184, 0.95)';
    ctx.fill();
    ctx.lineWidth = Math.max(1, tileSize * 0.02);
    ctx.strokeStyle = '#1e293b';
    ctx.stroke();
    ctx.restore();
  }

  // A floating "hush" over the king while SILENCE holds — sound-waves crossed by a red mute slash, so
  // the player can see the spell is still in effect (the room sleeps because of HIM, not by luck).
  // Top-LEFT, opposite the guard mark's top-right, so the two never overlap.
  function drawHushMark(tileX, tileY) {
    const bob = Math.sin(clock * 3) * tileSize * 0.02;
    const cx = tileX * tileSize + tileSize * 0.2;
    const cy = tileY * tileSize + tileSize * 0.17 + bob;
    const r = tileSize * 0.15;
    ctx.save();
    ctx.fillStyle = 'rgba(6, 18, 26, 0.72)';
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#67e8f9';
    ctx.lineWidth = Math.max(1.5, tileSize * 0.022);
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(cx - r * 0.25, cy, r * 0.4, -0.95, 0.95); ctx.stroke(); // inner sound-wave
    ctx.beginPath(); ctx.arc(cx - r * 0.25, cy, r * 0.66, -0.95, 0.95); ctx.stroke(); // outer sound-wave
    ctx.strokeStyle = '#f87171';
    ctx.beginPath(); ctx.moveTo(cx - r * 0.72, cy - r * 0.72); ctx.lineTo(cx + r * 0.72, cy + r * 0.72); ctx.stroke(); // mute slash
    ctx.restore();
  }

  // The exit: a dark stairwell of pale steps receding downward.
  // The COLLAPSED upstair the king arrived by — scenery, not a way out. Deliberately drawn as a
  // RUIN of the stair-down: same footprint, but choked with fallen rock and greyed out, so it reads
  // at a glance as "this is where I came in" and never as "this is a stair I could take".
  function drawUpstair(tileX, tileY, faded) {
    const px = tileX * tileSize;
    const py = tileY * tileSize;
    ctx.save();
    ctx.globalAlpha = faded ? 0.4 : 0.9;
    ctx.fillStyle = '#141a24'; // the shaft, collapsed dark
    ctx.fillRect(px + tileSize * 0.14, py + tileSize * 0.14, tileSize * 0.72, tileSize * 0.72);
    // Steps going UP, and all in grey — no cool blue, so it never reads as the live stair.
    for (let i = 0; i < 3; i += 1) {
      const inset = 0.18 + i * 0.08;
      const top = py + tileSize * (0.62 - i * 0.15);
      const v = 96 - i * 16;
      ctx.fillStyle = `rgb(${v}, ${v - 4}, ${v - 8})`;
      ctx.fillRect(px + tileSize * inset, top, tileSize * (1 - inset * 2), tileSize * 0.1);
    }
    // BARRED, not caved in. Plain grey iron across the shaft — the way BACK is simply shut, and it
    // must read as "no exit here" without the alarm-red of a boss-locked stair or the old fussy
    // heap of rubble that looked like a cloud sitting on the floor.
    ctx.strokeStyle = '#6b7280';
    ctx.lineWidth = Math.max(2, tileSize * 0.06);
    ctx.lineCap = 'round';
    const bm = tileSize * 0.18;
    for (let i = 0; i < 3; i += 1) {
      const bx = px + tileSize * (0.28 + i * 0.22);
      ctx.beginPath();
      ctx.moveTo(bx, py + bm);
      ctx.lineTo(bx, py + tileSize - bm);
      ctx.stroke();
    }
    ctx.strokeStyle = '#8a919c'; // two cross-braces, a shade lighter
    ctx.lineWidth = Math.max(1.5, tileSize * 0.045);
    for (const fy of [0.36, 0.64]) {
      ctx.beginPath();
      ctx.moveTo(px + tileSize * 0.2, py + tileSize * fy);
      ctx.lineTo(px + tileSize * 0.8, py + tileSize * fy);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Does this stair open onto the DEMON REALM? Floor 4's does — that is the descent into hell — and
  // so does every stair below it. An ordinary stair between two mortal floors is left alone: if all
  // of them smouldered, none of them would mean anything.
  function isHellmouth(state) {
    return Boolean(state) && ((state.floor || 1) + 1) >= DEMON_FLOOR;
  }

  function drawExit(tileX, tileY, faded, locked, hell) {
    const px = tileX * tileSize;
    const py = tileY * tileSize;
    ctx.save();
    ctx.globalAlpha = faded ? 0.45 : 1;
    // A HELLMOUTH breathes: a slow red glare welling up out of the shaft, so the way down reads as
    // something alive and waiting rather than a hole in the floorboards. Drawn UNDER the masonry so
    // the light comes from below, out of the dark, the way it would if something down there were lit.
    if (hell && !faded) {
      const breath = 0.5 + 0.5 * Math.sin(clock * 1.6);
      const grad = ctx.createRadialGradient(px + tileSize / 2, py + tileSize / 2, tileSize * 0.05,
        px + tileSize / 2, py + tileSize / 2, tileSize * 0.62);
      grad.addColorStop(0, `rgba(255, 110, 30, ${(0.5 + 0.28 * breath).toFixed(3)})`);
      grad.addColorStop(0.55, `rgba(190, 30, 20, ${(0.3 + 0.16 * breath).toFixed(3)})`);
      grad.addColorStop(1, 'rgba(120, 12, 30, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(px - tileSize * 0.2, py - tileSize * 0.2, tileSize * 1.4, tileSize * 1.4);
    }
    // Dark stairwell pit — pitch black over coals for a hellmouth, cold slate otherwise.
    ctx.fillStyle = hell ? '#12040a' : '#0b1220';
    ctx.fillRect(px + tileSize * 0.14, py + tileSize * 0.14, tileSize * 0.72, tileSize * 0.72);
    // Four descending steps, each narrower and lower — and for a hellmouth, lit from beneath: the
    // deepest step glows hottest, so the eye is dragged DOWN the stair into the light.
    for (let i = 0; i < 4; i += 1) {
      const inset = 0.18 + i * 0.07;
      const top = py + tileSize * (0.2 + i * 0.16);
      ctx.fillStyle = hell
        ? `rgb(${90 + i * 46}, ${26 + i * 18}, ${24 + i * 6})`
        : `rgb(${150 - i * 28}, ${168 - i * 30}, ${190 - i * 30})`;
      ctx.fillRect(px + tileSize * inset, top, tileSize * (1 - inset * 2), tileSize * 0.1);
    }
    // Jagged teeth closing over the throat of a hellmouth. This is the whole difference between a
    // stairway and a MOUTH, and it is what the eye actually reads at a glance.
    if (hell) {
      ctx.fillStyle = '#1c0a10';
      const teeth = 5;
      for (let i = 0; i < teeth; i += 1) {
        const tx = px + tileSize * (0.16 + (i / teeth) * 0.68);
        const w = tileSize * 0.09;
        ctx.beginPath(); // upper fangs
        ctx.moveTo(tx, py + tileSize * 0.14);
        ctx.lineTo(tx + w, py + tileSize * 0.14);
        ctx.lineTo(tx + w / 2, py + tileSize * 0.3);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath(); // lower fangs
        ctx.moveTo(tx, py + tileSize * 0.86);
        ctx.lineTo(tx + w, py + tileSize * 0.86);
        ctx.lineTo(tx + w / 2, py + tileSize * 0.7);
        ctx.closePath();
        ctx.fill();
      }
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
    // GLEAM: the gold breathes on the SAME slow cadence as lava (clock * 1.5), brightening and
    // fading, so the objective shimmers. A remembered (faded) key sits static — no gleam in the fog.
    const gleam = faded ? 0.35 : (0.5 + 0.5 * Math.sin(clock * 1.5));
    const gold = `rgb(${Math.round(236 + 19 * gleam)}, ${Math.round(178 + 52 * gleam)}, ${Math.round(30 + 116 * gleam)})`;
    // ONE outline weight for the WHOLE key — the bow ring and the shaft/teeth alike — so no part
    // reads as more heavily bordered than another (the bow used to be thick, the shaft bare).
    ctx.strokeStyle = '#160f02';
    ctx.lineWidth = Math.max(1.5, s * 0.038);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    const ax = cx - s * 0.03; // the vertical axis, nudged left so the teeth don't pull it off-centre
    const bowR = s * 0.14;
    const bowY = cy - s * 0.13;
    // The BOW: a ring — outer gold circle, then a punched hole — with the shared outline.
    ctx.fillStyle = gold;
    ctx.beginPath();
    ctx.arc(ax, bowY, bowR, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = faded ? '#1e293b' : '#0b1220';
    ctx.beginPath();
    ctx.arc(ax, bowY, bowR * 0.44, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // The SHAFT + TEETH as ONE comb outline, so the border runs cleanly around the whole thing
    // instead of leaving internal seams where three rectangles met.
    const shaftW = s * 0.07;
    const lx = ax - shaftW / 2;
    const rx = ax + shaftW / 2;
    const topY = bowY + bowR * 0.5;
    const t1y = cy + s * 0.11; const t1w = s * 0.1;
    const t2y = cy + s * 0.2; const t2w = s * 0.15;
    const botY = t2y + shaftW; // the shaft ends level with the lower tooth
    ctx.fillStyle = gold;
    ctx.beginPath();
    ctx.moveTo(lx, topY);
    ctx.lineTo(rx, topY);
    ctx.lineTo(rx, t1y);
    ctx.lineTo(rx + t1w, t1y);
    ctx.lineTo(rx + t1w, t1y + shaftW);
    ctx.lineTo(rx, t1y + shaftW);
    ctx.lineTo(rx, t2y);
    ctx.lineTo(rx + t2w, t2y);
    ctx.lineTo(rx + t2w, t2y + shaftW);
    ctx.lineTo(lx, botY);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
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
  // A SCORCH: soot burnt into bare stone where spellfire washed over it. A soft, irregular sooty
  // blotch (never a clean disc) that fades away over its life, like rubble or scrap.
  function drawScorch(sc, faded) {
    const px = sc.x * tileSize;
    const py = sc.y * tileSize;
    const seed = sc.seed || 0;
    const lifeFrac = sc.max ? Math.max(0, sc.life / sc.max) : 1;
    const h = (a, b) => tileHash(sc.x * a + seed + b * 3, sc.y * b + seed + a * 2);
    ctx.save();
    ctx.globalAlpha = (faded ? 0.4 : 0.75) * Math.max(0.08, lifeFrac);
    // Several overlapping charred lobes, darkest at the centre.
    for (let i = 0; i < 6; i += 1) {
      const ang = h(7, i + 1) * Math.PI * 2;
      const dist = tileSize * 0.16 * h(3, i + 2);
      const r = tileSize * (0.12 + 0.14 * h(5, i + 4));
      ctx.fillStyle = `rgba(18, 14, 12, ${(0.28 + 0.22 * h(11, i)).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(px + tileSize * 0.5 + Math.cos(ang) * dist, py + tileSize * 0.5 + Math.sin(ang) * dist, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

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
  function drawCardHint(tileX, tileY, capture, warded) {
    const cx = tileX * tileSize + tileSize / 2;
    const cy = tileY * tileSize + tileSize / 2;
    if (capture) {
      ctx.beginPath();
      ctx.arc(cx, cy, tileSize * 0.42, 0, Math.PI * 2);
      ctx.lineWidth = 3;
      // A WARDED foe rings STEEL instead of violet — the shot lands but its guard turns it aside, so
      // it reads apart from a target the shot would actually fell.
      ctx.strokeStyle = warded ? 'rgba(148, 163, 184, 0.95)' : 'rgba(216, 180, 254, 0.95)';
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
    // A DEMON bleeds dark green ICHOR; mortals (and the king) bleed vivid red.
    ctx.fillStyle = spatter.ichor ? '#1f6b2e' : '#c81e1e';
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
    // Main mass: overlapping lobes flung WIDER and more unevenly than before, so the centre reads
    // as a ragged splat rather than a tidy near-circle. A couple of them sit well off-centre.
    for (let i = 0; i < 6; i += 1) {
      const ang = h(7, i + 1) * Math.PI * 2;
      const dist = tileSize * (0.04 + 0.16 * h(3, i + 2)); // some lobes ride out to the rim of the mass
      const r = tileSize * (0.05 + 0.13 * h(5, i + 4)); // and vary more in size
      ctx.beginPath();
      ctx.arc(cx + Math.cos(ang) * dist, cy + Math.sin(ang) * dist, r, 0, Math.PI * 2);
      ctx.fill();
    }
    // A couple of SPIKES off the mass — stretched teardrops that break the round outline, the way
    // real spatter throws fingers of blood.
    for (let i = 0; i < 3; i += 1) {
      const ang = h(17, i + 1) * Math.PI * 2;
      const dist = tileSize * (0.14 + 0.08 * h(19, i + 1));
      ctx.save();
      ctx.translate(cx + Math.cos(ang) * dist, cy + Math.sin(ang) * dist);
      ctx.rotate(ang);
      ctx.beginPath();
      ctx.ellipse(0, 0, tileSize * (0.06 + 0.06 * h(23, i)), tileSize * 0.028, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
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
  // Sticks and leaves where a tree came down — the timber counterpart of a wall's rubble.
  function drawSticks(st, faded) {
    const px = st.x * tileSize;
    const py = st.y * tileSize;
    const a = Math.max(0, Math.min(1, st.life / (st.max || 1))) * (faded ? 0.4 : 1);
    if (a <= 0.01) return;
    const seed = st.seed || 0;
    ctx.save();
    ctx.globalAlpha = a;
    // THE WRECK OF A GATE: snapped bar-ends and scattered rivets. Iron does not shed leaves, and a
    // drift of greenery behind a felled iron gate was the tell that this drew one thing for both.
    if (st.iron) {
      ctx.strokeStyle = '#6b7280';
      ctx.lineWidth = Math.max(1, tileSize * 0.06);
      ctx.lineCap = 'butt'; // sheared, not whittled: a cut bar ends square
      for (let i = 0; i < 3; i += 1) {
        const ang = ((seed + i * 61) % 360) * Math.PI / 180;
        const cx = px + tileSize * (0.3 + ((seed + i * 17) % 40) / 100);
        const cy = py + tileSize * (0.35 + ((seed + i * 31) % 40) / 100);
        const len = tileSize * 0.19;
        ctx.beginPath();
        ctx.moveTo(cx - Math.cos(ang) * len, cy - Math.sin(ang) * len);
        ctx.lineTo(cx + Math.cos(ang) * len, cy + Math.sin(ang) * len);
        ctx.stroke();
      }
      // A glint of bare metal along each shear, so the pile reads as steel and not as sticks.
      ctx.strokeStyle = 'rgba(226, 232, 240, 0.55)';
      ctx.lineWidth = Math.max(1, tileSize * 0.018);
      for (let i = 0; i < 3; i += 1) {
        const ang = ((seed + i * 61) % 360) * Math.PI / 180;
        const cx = px + tileSize * (0.3 + ((seed + i * 17) % 40) / 100);
        const cy = py + tileSize * (0.35 + ((seed + i * 31) % 40) / 100);
        const len = tileSize * 0.19;
        ctx.beginPath();
        ctx.moveTo(cx - Math.cos(ang) * len * 0.9, cy - Math.sin(ang) * len * 0.9);
        ctx.lineTo(cx + Math.cos(ang) * len * 0.9, cy + Math.sin(ang) * len * 0.9);
        ctx.stroke();
      }
      // Rivets, popped loose and lying about.
      ctx.fillStyle = '#4b5563';
      for (let i = 0; i < 4; i += 1) {
        const lx = px + tileSize * (0.2 + ((seed + i * 41) % 60) / 100);
        const ly = py + tileSize * (0.25 + ((seed + i * 59) % 55) / 100);
        ctx.beginPath();
        ctx.arc(lx, ly, tileSize * 0.035, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      return;
    }
    // A few broken branches lying crossed.
    ctx.strokeStyle = '#5a3f26';
    ctx.lineWidth = Math.max(1, tileSize * 0.055);
    ctx.lineCap = 'round';
    for (let i = 0; i < 3; i += 1) {
      const ang = ((seed + i * 47) % 360) * Math.PI / 180;
      const cx = px + tileSize * (0.3 + ((seed + i * 13) % 40) / 100);
      const cy = py + tileSize * (0.35 + ((seed + i * 29) % 40) / 100);
      const len = tileSize * 0.2;
      ctx.beginPath();
      ctx.moveTo(cx - Math.cos(ang) * len, cy - Math.sin(ang) * len);
      ctx.lineTo(cx + Math.cos(ang) * len, cy + Math.sin(ang) * len);
      ctx.stroke();
    }
    // ...and scattered leaves.
    ctx.fillStyle = '#2f7a38';
    for (let i = 0; i < 4; i += 1) {
      const lx = px + tileSize * (0.2 + ((seed + i * 37) % 60) / 100);
      const ly = py + tileSize * (0.25 + ((seed + i * 53) % 55) / 100);
      ctx.beginPath();
      ctx.ellipse(lx, ly, tileSize * 0.06, tileSize * 0.035, ((seed + i * 91) % 180) * Math.PI / 180, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

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
  // The demon realm's GROUND: ashen grey, faintly warm with old soot. It used to be red marble,
  // which put a bright red floor directly against bright red lava — the one pair of tiles a player
  // must never confuse, since one of them costs a heart per turn. Ash reads dead and cold, and lets
  // the lava own every bit of red on the screen. Kept as one definition because the plain floor, an
  // open doorway's threshold and a gate's underfoot all have to be the SAME ground.
  // Faintly PINK-PURPLE ash: unhallowed ground, not ordinary stone. The two constraints pull against
  // each other and both matter. Plain grey ash (what this was) read as a normal dungeon floor — you
  // could not tell floor 5 from floor 1. Red marble (what it was before that) read as LAVA, which is
  // the one tile that must never be mistaken, since standing on it costs a heart a turn. So: a violet
  // cast, clearly not stone and clearly not fire, and kept muted so the lava still shouts louder than
  // the ground it sits in.
  //
  // NB the name. This was `DEMON_FLOOR`, which SHADOWED the global `DEMON_FLOOR = 5` throughout this
  // whole IIFE — so `state.floor >= DEMON_FLOOR` compared a number against this object, got NaN, and
  // came out false on every floor of the game. The entire demon realm (this ground, the blue torches,
  // the iron doors, the dead trees, the withered grass) silently stopped rendering, and nothing threw.
  // GROUND, not FLOOR: a floor is a number here, and the two must never be confusable again.
  const DEMON_GROUND = { dark: '#3a2c40', light: '#54415c' };

  function terrainColor(type, isDark) {
    switch (type) {
      case 'lava':
        // BRIGHT, saturated red-orange, and deliberately the loudest thing on the floor: this is the
        // only terrain that wounds you for merely standing on it, so it must never read as decor.
        return isDark ? '#c02a0a' : '#e8460f'; // molten rock, glowing (drawTexture pulses it)
      case 'water':
        // In the demon realm the water is fouled — BRACKISH SLUDGE: a murky olive-brown, so it reads
        // as poisoned muck rather than clean teal (the same "same terrain, hellish look" trick the
        // withered grass and dead trees use). Mechanically it is still just slow water.
        if (demonRealm) return isDark ? '#33371f' : '#565b34';
        return isDark ? '#1b5a5f' : '#2f8f8c'; // deep water — nudged TEAL/green so it reads apart from ice
      case 'wall':
        return isDark ? '#54535a' : '#6a696f'; // neutral grey stone (cool, desaturated)
      case 'pit':
        return isDark ? '#0b0b12' : '#15151d'; // a dark void
      case 'ice':
        // The slab is drawn as a translucent inset CUBE by drawTexture, so the tile's BASE is the
        // native floor — it shows around the cube's edges, rather than a pane of ice filling the
        // whole square.
        if (demonRealm) return isDark ? DEMON_GROUND.dark : DEMON_GROUND.light;
        return isDark ? '#71481d' : '#e8c589';
      case 'geyser':
        // A vent in the hellfloor: the tile's BASE is the realm's own ground (drawTexture lays the
        // crusted rim and the gas plume over it), so it reads as a hole in the floor, not a tile of
        // its own colour. Geysers only occur in the demon realm; the fallback is just defensive.
        if (demonRealm) return isDark ? DEMON_GROUND.dark : DEMON_GROUND.light;
        return isDark ? '#3a2c40' : '#54415c';
      case 'devilgrass':
        // The same terrain everywhere — only the look changes. Living GRASS on the mortal floors;
        // dry, ashen pink-grey husks once you are in the demon realm.
        if (demonRealm) return isDark ? '#5b4048' : '#8d6b73';
        return isDark ? '#1c3a1e' : '#2f5f33'; // deep living green
      case 'gate':
        // The bars sit on the NATIVE FLOOR of the realm — sepia ground up top, ashen violet in
        // hell — so the floor shows between them, exactly like the room they guard. (drawTexture
        // lays the ironwork over the top.) It used to be a slab of dark slate all its own.
        if (demonRealm) return isDark ? DEMON_GROUND.dark : DEMON_GROUND.light;
        return isDark ? '#71481d' : '#e8c589';
      case 'tree':
        // The ground a trunk stands on: leaf litter, not stone — and dead brown in the demon realm,
        // matching devilgrass's living/withered split.
        if (demonRealm) return isDark ? '#3a2b22' : '#5a453a';
        return isDark ? '#23351f' : '#3a5233';
      case 'door':
        // Warm timber up top; in the realm it is BLACK IRON — cold, dark, and studded (see below).
        if (demonRealm) return isDark ? '#17161b' : '#2b2930';
        return isDark ? '#5a3a1c' : '#7a5024'; // a SHUT wooden door — warm timber
      case 'doorajar':
      case 'dooropen':
        // An OPEN / half-closing doorway: the floor of the threshold shows through (a leaf/frame is
        // drawn over it). It used to hand back sunny sepia on EVERY floor, which is why an open
        // doorway in hell glowed like a patch of daylight in the middle of the red marble.
        if (demonRealm) return isDark ? DEMON_GROUND.dark : DEMON_GROUND.light;
        return isDark ? '#71481d' : '#e8c589';
      default:
        // boulder + normal both sit on ground (the boulder rock is drawn over it). In the DEMON
        // REALM (floor 5+) that ground is dark RED MARBLE instead of the upper floors' warm sepia —
        // and since a pit lays this same floor before sinking its shaft, pit rims turn to marble too.
        if (demonRealm) return isDark ? DEMON_GROUND.dark : DEMON_GROUND.light; // ashen hellfloor
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
        // A slow molten BREATH: the whole tile swells with heat and fades back. Each tile is given
        // its own phase off tileHash, so a lake ripples rather than blinking on and off as one slab
        // — and the movement is what catches the eye of a player about to stroll into it.
        const pulse = 0.5 + 0.5 * Math.sin(clock * 1.5 + tileHash(x, y) * Math.PI * 2);
        ctx.fillStyle = `rgba(255, 138, 26, ${(0.10 + 0.20 * pulse).toFixed(3)})`;
        ctx.fillRect(px, py, tileSize, tileSize);
        // Glowing molten cracks, brightening with the same breath.
        ctx.shadowBlur = tileSize * 0.3 * pulse;
        ctx.shadowColor = 'rgba(255, 170, 40, 0.9)';
        ctx.strokeStyle = `rgba(255, 232, 150, ${(0.6 + 0.35 * pulse).toFixed(3)})`;
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
        // Several SHORT wavelets, fainter and staggered across the tile, rather than two big lines
        // spanning the whole square — so a lake reads as rippled water instead of ruled paper.
        ctx.lineWidth = Math.max(0.75, tileSize * 0.016);
        ctx.lineCap = 'round';
        for (let i = 0; i < 5; i += 1) {
          const wy = py + tileSize * (0.16 + 0.16 * i + 0.04 * tileHash(x * 3 + i, y));
          const wx = px + tileSize * (0.1 + 0.35 * tileHash(x, y * 3 + i)); // start point wanders
          const wlen = tileSize * (0.24 + 0.2 * tileHash(x * 5 + i, y * 2));
          // Clean water catches WHITE glints; brackish sludge only shows a dull, sickly scum sheen.
          ctx.strokeStyle = demonRealm
            ? `rgba(150, 170, 90, ${(0.1 + 0.07 * tileHash(x + i, y - i)).toFixed(3)})`
            : `rgba(255, 255, 255, ${(0.12 + 0.08 * tileHash(x + i, y - i)).toFixed(3)})`;
          ctx.beginPath();
          ctx.moveTo(wx, wy);
          ctx.quadraticCurveTo(wx + wlen * 0.5, wy - tileSize * 0.035, wx + wlen, wy);
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
        // The mouth is an IRREGULAR blob, not a compass circle — a jagged rim of ground giving way.
        // Traced once from tileHash so it holds still. Reused for the fill, the shadow and the lip.
        const rimPts = [];
        const lobes = 11;
        for (let i = 0; i < lobes; i += 1) {
          const a = (i / lobes) * Math.PI * 2;
          const rr = hole * (0.82 + 0.24 * tileHash(x * 3 + i, y * 5 + i));
          rimPts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.94]);
        }
        const traceRim = () => {
          ctx.beginPath();
          ctx.moveTo(rimPts[0][0], rimPts[0][1]);
          for (let i = 1; i <= lobes; i += 1) {
            const p0 = rimPts[i % lobes];
            const pm = rimPts[(i - 1) % lobes];
            ctx.quadraticCurveTo(pm[0], pm[1], (pm[0] + p0[0]) / 2, (pm[1] + p0[1]) / 2);
          }
          ctx.closePath();
        };
        // The shaft: a VERTICAL fall, not a flat disc. A top-to-bottom LINEAR gradient — the near
        // wall at the lip catches a little earthy light and it darkens to near-black at the floor of
        // it — reads as depth you look DOWN into, where the old radial version read as an orb resting
        // on the surface.
        const g = ctx.createLinearGradient(cx, cy - hole, cx, cy + hole);
        g.addColorStop(0, demonRealm ? 'rgba(52, 24, 30, 0.82)' : 'rgba(50, 42, 30, 0.8)'); // lit near lip — dug earth
        g.addColorStop(0.45, demonRealm ? 'rgba(24, 10, 16, 0.95)' : 'rgba(24, 22, 24, 0.95)');
        g.addColorStop(1, demonRealm ? 'rgba(5, 2, 5, 0.99)' : 'rgba(5, 5, 9, 0.99)'); // the dark floor of the shaft
        ctx.fillStyle = g;
        traceRim();
        ctx.fill();
        // EARTHEN WALLS: jagged vertical striations clipped inside the mouth, darkening as they fall —
        // the marks of DUG ground, not a clean bore. Placed from tileHash so they hold still.
        ctx.save();
        traceRim();
        ctx.clip();
        ctx.lineCap = 'round';
        for (let i = 0; i < 6; i += 1) {
          const sx = cx + (tileHash(x * 7 + i, y * 3) - 0.5) * hole * 1.7;
          const topY = cy - hole * (0.45 + 0.32 * tileHash(x + i, y * 2));
          const botY = cy + hole * (0.35 + 0.55 * tileHash(x * 2, y + i));
          const jag = (tileHash(x * 5 + i, y * 9) - 0.5) * hole * 0.22;
          ctx.strokeStyle = `rgba(0, 0, 0, ${(0.2 + 0.18 * tileHash(x + i, y - i)).toFixed(3)})`;
          ctx.lineWidth = Math.max(1, tileSize * 0.02);
          ctx.beginPath();
          ctx.moveTo(sx, topY);
          ctx.lineTo(sx + jag, (topY + botY) / 2);
          ctx.lineTo(sx - jag * 0.5, botY);
          ctx.stroke();
        }
        ctx.restore();
        // A soft shadow where ground meets hole, and a lit near lip so it reads as depth.
        ctx.strokeStyle = demonRealm ? 'rgba(40, 8, 10, 0.6)' : 'rgba(60, 38, 16, 0.5)';
        ctx.lineWidth = Math.max(1.5, tileSize * 0.05);
        traceRim();
        ctx.stroke();
        ctx.strokeStyle = 'rgba(214, 214, 228, 0.3)'; // the near lip catching the light
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(cx, cy, hole * 0.9, Math.PI * 1.08, Math.PI * 1.92);
        ctx.stroke();
        break;
      }
      case 'gate': {
        // Vertical iron BARS in a heavy frame — deliberately open, because the whole point of a gate
        // is that you can see (and shoot) through it while it still bars the way. Bars thin as they
        // are cut, so its wounds read at a glance the way a tree's canopy does.
        const hp = treeHp ? (treeHp[`${x},${y}`] ?? 3) : 3;
        const swings = 3 - hp; // 0, 1 or 2 blows landed
        const m = tileSize * 0.1;
        ctx.fillStyle = demonRealm ? 'rgba(12, 10, 14, 0.95)' : 'rgba(38, 40, 48, 0.95)';
        ctx.fillRect(px + m, py + m * 0.5, tileSize - m * 2, tileSize * 0.1); // top rail
        ctx.fillRect(px + m, py + tileSize - m * 0.5 - tileSize * 0.1, tileSize - m * 2, tileSize * 0.1); // bottom rail
        // A gate does not WEAR THIN as it is cut — bars SNAP. Scaling their width was far too quiet
        // a tell (it just looked like a slightly different gate); losing a whole bar and leaving the
        // stub bent out of line is something you cannot miss at a glance. Same idea as the tree's
        // axe-notch: show the wound, do not merely shrink the thing.
        const bars = 4;
        const gone = swings; // one bar sheared away per blow landed
        for (let i = 0; i < bars; i += 1) {
          const bx2 = px + m + (tileSize - m * 2) * ((i + 0.5) / bars);
          const w = Math.max(1, tileSize * 0.055);
          ctx.fillStyle = demonRealm ? 'rgba(30, 26, 32, 0.95)' : 'rgba(70, 74, 86, 0.95)';
          if (i < gone) {
            // SHEARED: only a stub left top and bottom, bent aside, with the cut showing bright.
            const lean = tileSize * 0.05 * (i % 2 ? 1 : -1);
            ctx.fillRect(bx2 - w / 2, py + m * 0.5, w, tileSize * 0.22);
            ctx.fillRect(bx2 - w / 2 + lean, py + tileSize - m * 0.5 - tileSize * 0.22, w, tileSize * 0.22);
            ctx.strokeStyle = 'rgba(226, 232, 240, 0.6)'; // bare metal at the shear
            ctx.lineWidth = Math.max(1, tileSize * 0.02);
            ctx.beginPath();
            ctx.moveTo(bx2 - w / 2, py + m * 0.5 + tileSize * 0.22);
            ctx.lineTo(bx2 + w / 2, py + m * 0.5 + tileSize * 0.22);
            ctx.stroke();
          } else {
            ctx.fillRect(bx2 - w / 2, py + m * 0.5, w, tileSize - m); // whole, floor to lintel
          }
        }
        break;
      }
      case 'tree': {
        // A trunk with a canopy over it. The canopy SHRINKS as the tree is chopped, so its wounds
        // are readable at a glance without a health bar; once lit by spellfire it burns orange and
        // is gone next turn.
        const cx = px + tileSize / 2;
        const groundY = py + tileSize * 0.82;
        const hp = treeHp ? (treeHp[`${x},${y}`] ?? 3) : 3;
        const burning = burnTrees ? Boolean(burnTrees[`${x},${y}`]) : false;
        const health = Math.max(0.34, Math.min(1, hp / 3));
        ctx.fillStyle = 'rgba(0,0,0,0.26)'; // the shadow it throws
        ctx.beginPath();
        ctx.ellipse(cx, groundY, tileSize * 0.30, tileSize * 0.10, 0, 0, Math.PI * 2);
        ctx.fill();
        const bark = demonRealm ? (isDark ? '#241a1c' : '#33262a') : (isDark ? '#3d2a19' : '#5a3f26'); // the trunk — DARK and dead in the realm (so it reads against the ashen floor)
        ctx.fillStyle = bark;
        ctx.fillRect(cx - tileSize * 0.07, py + tileSize * 0.42, tileSize * 0.14, tileSize * 0.4);
        // THE AXE NOTCH. Scaling the canopy alone just made a wounded tree look like a smaller tree
        // — nothing about it said "hit". A wedge chopped out of the trunk is the plainest possible
        // read: it deepens with each swing and always bites the same side, so two swings show as a
        // trunk half severed rather than a sapling.
        const swings = 3 - hp; // 0, 1, or 2 landed
        if (swings > 0) {
          const notchY = py + tileSize * 0.56;
          const depth = tileSize * (0.05 + 0.055 * swings); // eats further in with each blow
          ctx.fillStyle = isDark ? 'rgba(12, 8, 5, 0.92)' : 'rgba(30, 18, 10, 0.85)';
          ctx.beginPath();
          ctx.moveTo(cx - tileSize * 0.07, notchY - tileSize * 0.07);
          ctx.lineTo(cx - tileSize * 0.07 + depth, notchY);
          ctx.lineTo(cx - tileSize * 0.07, notchY + tileSize * 0.07);
          ctx.closePath();
          ctx.fill();
          // Pale exposed heartwood along the cut — the bright edge is what makes it read as fresh.
          ctx.strokeStyle = isDark ? 'rgba(214, 190, 150, 0.5)' : 'rgba(240, 222, 186, 0.65)';
          ctx.lineWidth = Math.max(1, tileSize * 0.02);
          ctx.beginPath();
          ctx.moveTo(cx - tileSize * 0.07, notchY - tileSize * 0.07);
          ctx.lineTo(cx - tileSize * 0.07 + depth, notchY);
          ctx.stroke();
          // Chips and severed leaves littering the ground at its foot.
          ctx.fillStyle = demonRealm ? 'rgba(90, 70, 60, 0.75)' : 'rgba(60, 90, 50, 0.7)';
          for (let i = 0; i < swings * 3; i += 1) {
            const a = tileHash(x + i, y - i) * Math.PI * 2;
            const d = tileSize * (0.18 + 0.16 * tileHash(x - i, y + i));
            ctx.fillRect(cx + Math.cos(a) * d, groundY + Math.sin(a) * d * 0.34, tileSize * 0.055, tileSize * 0.03);
          }
        }
        // Canopy: overlapping blobs, tightening as it takes wounds.
        const r = tileSize * 0.30 * health;
        if (demonRealm && !burning) {
          // In the demon realm a tree is a DEAD one: no canopy, just bare clawing branches off a grey
          // trunk. Drawn DARK and BIG on purpose — a player kept stumbling into hell trees he could
          // not pick out from the ashen violet floor. Near-black limbs, thicker and reaching further
          // than a living crown, over a soft dark silhouette so the whole thing reads as a SHAPE.
          const forkY = py + tileSize * 0.4;
          const reach = tileSize * 0.42 * (0.62 + 0.38 * health); // bigger than the living crown (0.30)
          ctx.fillStyle = isDark ? 'rgba(12, 8, 12, 0.5)' : 'rgba(22, 14, 20, 0.5)'; // silhouette mass
          ctx.beginPath();
          ctx.ellipse(cx, forkY - tileSize * 0.05, reach * 0.85, reach * 0.72, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = isDark ? '#150f16' : '#221820'; // near-black clawing limbs
          ctx.lineCap = 'round';
          const thick = Math.max(1.5, tileSize * 0.075);
          for (const [ang, len] of [[-2.5, 0.95], [-0.64, 0.95], [-1.57, 1.05], [-2.1, 0.72], [-1.05, 0.72], [-1.9, 0.52], [-1.25, 0.52]]) {
            ctx.lineWidth = thick;
            const ex = cx + Math.cos(ang) * reach * len;
            const ey = forkY + Math.sin(ang) * reach * len;
            ctx.beginPath();
            ctx.moveTo(cx, forkY);
            ctx.lineTo(ex, ey);
            ctx.stroke();
            if (len > 0.85) { // a forked twig at the tip of the long limbs — the clawing look
              ctx.lineWidth = Math.max(1, tileSize * 0.042);
              ctx.beginPath();
              ctx.moveTo(ex, ey);
              ctx.lineTo(ex + Math.cos(ang - 0.5) * reach * 0.26, ey + Math.sin(ang - 0.5) * reach * 0.26);
              ctx.moveTo(ex, ey);
              ctx.lineTo(ex + Math.cos(ang + 0.5) * reach * 0.26, ey + Math.sin(ang + 0.5) * reach * 0.26);
              ctx.stroke();
            }
          }
        } else {
          const green = burning ? (isDark ? '#c2410c' : '#f97316') : (isDark ? '#1f4a24' : '#2f7a38');
          const leafHi = burning ? (isDark ? '#ea580c' : '#fb923c') : (isDark ? '#2f6b34' : '#4a9a4e');
          const leafLo = burning ? (isDark ? '#9a2f0a' : '#c2410c') : (isDark ? '#163a1c' : '#236228');
          // The crown does not merely SHRINK as it is cut — it is torn open, lopsidedly. A full tree
          // is three even blobs; a wounded one loses whole limbs off one side and shows the broken
          // branch stubs left behind. That asymmetry is the tell, far more than size ever was.
          const crowns = hp >= 3
            ? [[0, -0.10, 1], [-0.16, 0.02, 0.78], [0.16, 0.02, 0.78]] // full, even, healthy
            : hp === 2
              ? [[-0.13, -0.04, 0.82], [0.12, 0.06, 0.5]] // one side blasted away, what's left sags
              : [[-0.05, 0.02, 0.55]]; // a single sad tuft clinging on
          ctx.fillStyle = green;
          for (const [ox, oy, m] of crowns) {
            ctx.beginPath();
            ctx.arc(cx + tileSize * ox, py + tileSize * 0.4 + tileSize * oy, r * m, 0, Math.PI * 2);
            ctx.fill();
          }
          // LEAFY DAPPLE: scatter small light-and-dark leaf clusters across the crown so it reads as
          // foliage, not a flat green ball. Clipped to the crown blobs so leaves never spill past the
          // silhouette. Deterministic per tile.
          ctx.save();
          ctx.beginPath();
          for (const [ox, oy, m] of crowns) {
            ctx.moveTo(cx + tileSize * ox + r * m, py + tileSize * 0.4 + tileSize * oy);
            ctx.arc(cx + tileSize * ox, py + tileSize * 0.4 + tileSize * oy, r * m, 0, Math.PI * 2);
          }
          ctx.clip();
          for (let i = 0; i < 10; i += 1) {
            const lx = cx + (tileHash(x * 7 + i, y * 2) - 0.5) * r * 2.4;
            const ly = py + tileSize * 0.4 + (tileHash(x * 2, y * 7 + i) - 0.5) * r * 2.2;
            const lr = r * (0.16 + 0.12 * tileHash(x + i, y - i));
            ctx.fillStyle = tileHash(x * 3 + i, y * 3) > 0.5 ? leafHi : leafLo;
            ctx.beginPath();
            ctx.ellipse(lx, ly, lr, lr * 0.72, tileHash(x + i, y + i) * Math.PI, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.restore();
          if (hp < 3 && !burning) { // bare, snapped limbs jutting from where the crown used to be
            ctx.strokeStyle = bark;
            ctx.lineWidth = Math.max(1, tileSize * 0.035);
            ctx.lineCap = 'round';
            const forkY = py + tileSize * 0.46;
            const stubs = hp === 2 ? [[-0.7, 0.85], [-0.25, 0.7]] : [[-0.7, 0.95], [-0.25, 0.8], [-1.35, 0.75], [-2.5, 0.6]];
            for (const [ang, len] of stubs) {
              ctx.beginPath();
              ctx.moveTo(cx, forkY);
              ctx.lineTo(cx + Math.cos(ang) * tileSize * 0.3 * len, forkY + Math.sin(ang) * tileSize * 0.3 * len);
              ctx.stroke();
            }
          }
        }
        if (burning) { // flames licking up off the crown
          ctx.fillStyle = 'rgba(253, 224, 71, 0.85)';
          for (let i = 0; i < 3; i += 1) {
            ctx.beginPath();
            ctx.arc(cx + tileSize * (i - 1) * 0.14, py + tileSize * (0.2 + (i % 2) * 0.06), tileSize * 0.07, 0, Math.PI * 2);
            ctx.fill();
          }
        }
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
        // A BULGY, irregular rock — a lumpy outline traced from tileHash (so it holds still), not a
        // perfect circle. Same trick as the pit rim.
        const lobes = 10;
        const pts = [];
        for (let i = 0; i < lobes; i += 1) {
          const a = (i / lobes) * Math.PI * 2;
          const rr = r * (0.82 + 0.26 * tileHash(x * 5 + i, y * 3 + i));
          pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
        }
        const traceRock = () => {
          ctx.beginPath();
          ctx.moveTo(pts[0][0], pts[0][1]);
          for (let i = 1; i <= lobes; i += 1) {
            const p0 = pts[i % lobes];
            const pm = pts[(i - 1) % lobes];
            ctx.quadraticCurveTo(pm[0], pm[1], (pm[0] + p0[0]) / 2, (pm[1] + p0[1]) / 2);
          }
          ctx.closePath();
        };
        const g = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.2, cx, cy, r * 1.3);
        g.addColorStop(0, '#9a99a2');
        g.addColorStop(1, '#454451');
        ctx.fillStyle = g;
        traceRock();
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.35)';
        ctx.lineWidth = 1;
        traceRock();
        ctx.stroke();
        // A couple of fracture lines across the face — the boulder's own grain.
        ctx.strokeStyle = 'rgba(0,0,0,0.24)';
        ctx.lineWidth = Math.max(1, tileSize * 0.014);
        ctx.beginPath();
        ctx.moveTo(cx - r * 0.45, cy - r * 0.2);
        ctx.lineTo(cx + r * 0.05, cy + r * 0.15);
        ctx.lineTo(cx + r * 0.4, cy - r * 0.05);
        ctx.moveTo(cx - r * 0.1, cy + r * 0.5);
        ctx.lineTo(cx + r * 0.1, cy + r * 0.05);
        ctx.stroke();
        // A pale glint on the top-left bulge.
        ctx.fillStyle = 'rgba(255,255,255,0.14)';
        ctx.beginPath();
        ctx.ellipse(cx - r * 0.32, cy - r * 0.34, r * 0.28, r * 0.16, -0.6, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'geyser': {
        // A VENT in the hellfloor: a crusted mineral rim around a dark throat, with gas that reads
        // its place in the 3-turn clock. 'calm' — a faint wisp; 'imminent' — a tall, pulsing warning
        // plume (the tell that ending a turn here next means the blast); 'erupting' — a billowing
        // cloud that fills the tile (and blocks sight, matching geyserErupting).
        const cx = px + tileSize / 2;
        const cy = py + tileSize / 2;
        const r = tileSize * 0.3;
        // The crusted RIM: a pale-yellow sulphurous ring of mineral deposit.
        ctx.strokeStyle = isDark ? 'rgba(150, 138, 96, 0.55)' : 'rgba(170, 156, 104, 0.6)';
        ctx.lineWidth = Math.max(1.5, tileSize * 0.05);
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
        // The dark THROAT.
        const throat = ctx.createRadialGradient(cx, cy, r * 0.1, cx, cy, r);
        throat.addColorStop(0, 'rgba(8, 6, 10, 0.95)');
        throat.addColorStop(1, 'rgba(30, 22, 30, 0.4)');
        ctx.fillStyle = throat;
        ctx.beginPath();
        ctx.arc(cx, cy, r * 0.82, 0, Math.PI * 2);
        ctx.fill();
        // The GAS. A slow bubbling breath at rest; a tall column when a blast is one turn off; a full
        // cloud on the erupting turn. Bubbles rise and fade on the tile clock so a field of vents
        // shimmers rather than blinking as one.
        const pulse = 0.5 + 0.5 * Math.sin(clock * 3 + tileHash(x, y) * Math.PI * 2);
        // Premonition/Sixth Sense see through the erupting STEAM — so for them the vent shows only the
        // slimmer warning column (you still read that it is active), never the full obscuring cloud.
        if (geyserStage === 'erupting' && !seeThroughHaze) {
          ctx.fillStyle = `rgba(210, 235, 200, ${(0.4 + 0.25 * pulse).toFixed(3)})`;
          for (let i = 0; i < 6; i += 1) {
            const bx = cx + (tileHash(x * 7 + i, y) - 0.5) * tileSize * 0.7;
            const by = py + tileSize * (0.7 - 0.55 * ((clock * 0.9 + tileHash(x, y * 3 + i)) % 1));
            const br = tileSize * (0.12 + 0.1 * tileHash(x + i, y + i));
            ctx.beginPath();
            ctx.arc(bx, by, br, 0, Math.PI * 2);
            ctx.fill();
          }
        } else if (geyserStage === 'imminent' || geyserStage === 'erupting') {
          // A rising warning COLUMN — pale, tall, and pulsing so it plainly reads as "about to blow".
          ctx.fillStyle = `rgba(225, 225, 150, ${(0.28 + 0.28 * pulse).toFixed(3)})`;
          for (let i = 0; i < 4; i += 1) {
            const by = py + tileSize * (0.7 - 0.52 * ((clock * 0.7 + tileHash(x, y + i)) % 1));
            const br = tileSize * (0.09 + 0.05 * i);
            ctx.beginPath();
            ctx.arc(cx + (tileHash(x + i, y) - 0.5) * tileSize * 0.25, by, br, 0, Math.PI * 2);
            ctx.fill();
          }
        } else {
          // Calm: a single faint wisp bubbling at the mouth.
          ctx.fillStyle = `rgba(200, 205, 180, ${(0.1 + 0.1 * pulse).toFixed(3)})`;
          ctx.beginPath();
          ctx.arc(cx, cy - tileSize * 0.06 * pulse, tileSize * 0.1, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      }
      case 'ice': {
        // A raised, rounded ICE CUBE: a translucent block inset from the tile, bevelled bright on
        // the top-left and shaded on the bottom-right so it reads as a solid frozen block, never
        // as flat ground.
        const pad = tileSize * 0.14; // a wider margin, so a clear ring of native FLOOR shows around it
        const r = tileSize * 0.2; // generously rounded corners — a cube, not a slab
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
        // A soft shadow the cube casts on the floor around it (so it reads as a block sitting ON the
        // ground, not painted into it).
        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,0.18)';
        roundRect(x0 + tileSize * 0.03, y0 + tileSize * 0.05, w, h, r);
        ctx.fill();
        ctx.restore();
        const g = ctx.createLinearGradient(x0, y0, x0 + w, y0 + h);
        // A touch more opaque than before — the base is floor now, so the cube itself must carry the
        // "this is ice" read on its own.
        g.addColorStop(0, 'rgba(240,251,255,0.95)');
        g.addColorStop(0.55, 'rgba(168,213,233,0.82)');
        g.addColorStop(1, 'rgba(104,164,196,0.88)');
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
        // Tall writhing fronds — clusters of upward slashes. Green and alive on the mortal floors;
        // bleached to dry pink husks in the demon realm.
        ctx.strokeStyle = demonRealm
          ? (isDark ? 'rgba(215,175,185,0.45)' : 'rgba(240,215,220,0.55)')
          : (isDark ? 'rgba(120,200,120,0.45)' : 'rgba(190,255,180,0.5)');
        ctx.lineWidth = Math.max(0.75, tileSize * 0.02); // thinner blades
        ctx.lineCap = 'round';
        // MANY short strands in two staggered rows — a thick low turf rather than six tall reeds.
        for (let i = 0; i < 11; i += 1) {
          const bx = px + tileSize * (0.08 + 0.084 * i);
          const base = py + tileSize * (0.78 + 0.14 * tileHash(x * 7 + i, y)); // roots at varied heights
          const height = tileSize * (0.26 + 0.2 * tileHash(x * 3 + i, y * 5)); // SHORT blades
          const sway = (tileHash(x * 5 + i, y * 2) - 0.5) * tileSize * 0.16;
          ctx.beginPath();
          ctx.moveTo(bx, base);
          ctx.quadraticCurveTo(bx + sway, base - height * 0.6, bx + sway * 1.5, base - height);
          ctx.stroke();
        }
        break;
      }
      case 'wall': {
        // SMALL staggered brickwork — four low courses of half-width bricks, offset course to
        // course, with hairline mortar. Far finer than the old two-course grid, and it reads as
        // masonry rather than a tic-tac-toe board.
        const courses = 4;
        const ch = tileSize / courses;
        ctx.strokeStyle = demonRealm ? 'rgba(0, 0, 0, 0.42)' : 'rgba(0, 0, 0, 0.32)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let c = 1; c < courses; c += 1) { // the horizontal mortar between courses
          const cy = py + c * ch;
          ctx.moveTo(px, cy);
          ctx.lineTo(px + tileSize, cy);
        }
        for (let c = 0; c < courses; c += 1) { // the vertical joints, offset every other course
          const cy = py + c * ch;
          const off = (c % 2) * tileSize * 0.25;
          for (let vx = off; vx <= tileSize; vx += tileSize * 0.5) {
            ctx.moveTo(px + vx, cy);
            ctx.lineTo(px + vx, cy + ch);
          }
        }
        ctx.stroke();
        // CRUMBLE: a few bricks chipped, a corner or two knocked off — deterministic per tile so it
        // never flickers. A hint of decay, heavier in the demon realm.
        const chips = demonRealm ? 5 : 3;
        for (let i = 0; i < chips; i += 1) {
          const hx = tileHash(x * 7 + i, y * 3 + 1);
          const hy = tileHash(x * 3 + 2, y * 7 + i);
          const cx2 = px + tileSize * (0.1 + hx * 0.8);
          const cy2 = py + tileSize * (0.1 + hy * 0.8);
          const cr = tileSize * (0.03 + 0.05 * tileHash(x + i, y - i));
          ctx.fillStyle = (i % 2)
            ? (demonRealm ? 'rgba(0,0,0,0.28)' : 'rgba(0,0,0,0.2)') // a knocked-out pit
            : (demonRealm ? 'rgba(90,80,90,0.28)' : 'rgba(200,195,190,0.22)'); // a pale spalled patch
          ctx.beginPath();
          ctx.ellipse(cx2, cy2, cr, cr * (0.6 + 0.5 * hx), hy * Math.PI, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      }
      case 'door': {
        const m = tileSize * 0.14;
        if (demonRealm) {
          // A BLACK IRON door: a heavy frame, two horizontal bands across it, and rows of rivets —
          // no planks, no ring. Cold hardware, not carpentry.
          ctx.strokeStyle = 'rgba(6, 5, 8, 0.9)';
          ctx.lineWidth = Math.max(2, tileSize * 0.07);
          ctx.strokeRect(px + m, py + m * 0.4, tileSize - m * 2, tileSize - m * 0.8);
          ctx.strokeStyle = 'rgba(70, 66, 78, 0.85)'; // the bands, catching a little cold light
          ctx.lineWidth = Math.max(1.5, tileSize * 0.06);
          for (const f of [0.34, 0.66]) {
            ctx.beginPath();
            ctx.moveTo(px + m, py + tileSize * f);
            ctx.lineTo(px + tileSize - m, py + tileSize * f);
            ctx.stroke();
          }
          ctx.fillStyle = 'rgba(120, 116, 130, 0.8)'; // rivets
          for (const fy of [0.34, 0.66]) {
            for (const fx of [0.28, 0.5, 0.72]) {
              ctx.beginPath();
              ctx.arc(px + tileSize * fx, py + tileSize * fy, Math.max(1, tileSize * 0.028), 0, Math.PI * 2);
              ctx.fill();
            }
          }
          break;
        }
        // A SHUT wooden door: a stone frame with vertical planks and an iron ring handle.
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
        // An OPEN doorway: the empty jambs at either side (the leaf swung aside). In the demon realm
        // the jambs are cold IRON, not stone — a dark post with a thin steel highlight down its
        // inner edge, so an open iron door reads as the same hardware as the shut one beside it.
        const jw = tileSize * 0.14;
        const lx = px + tileSize * 0.08;
        const rx = px + tileSize * 0.92 - jw;
        ctx.fillStyle = demonRealm ? 'rgba(10, 9, 12, 0.85)' : 'rgba(30, 18, 8, 0.55)';
        ctx.fillRect(lx, py + tileSize * 0.08, jw, tileSize * 0.84);
        ctx.fillRect(rx, py + tileSize * 0.08, jw, tileSize * 0.84);
        if (demonRealm) {
          ctx.fillStyle = 'rgba(90, 86, 100, 0.6)'; // cold steel glint on the inner face of each jamb
          ctx.fillRect(lx + jw - Math.max(1, tileSize * 0.02), py + tileSize * 0.08, Math.max(1, tileSize * 0.02), tileSize * 0.84);
          ctx.fillRect(rx, py + tileSize * 0.08, Math.max(1, tileSize * 0.02), tileSize * 0.84);
        }
        break;
      }
      case 'doorajar': {
        // A door SWINGING SHUT: a jamb plus the leaf drawn partway across (it fully closes next turn).
        const jw = tileSize * 0.13;
        const m = tileSize * 0.12;
        const lw = tileSize * 0.44; // the leaf covers ~half — swinging closed
        if (demonRealm) {
          // IRON, to match the shut demon door: a dark leaf with a cold band and two rivets, not timber.
          ctx.fillStyle = 'rgba(10, 9, 12, 0.85)';
          ctx.fillRect(px + tileSize * 0.08, py + tileSize * 0.1, jw, tileSize * 0.8); // left jamb
          ctx.fillStyle = isDark ? 'rgba(20, 19, 24, 0.92)' : 'rgba(34, 32, 40, 0.92)';
          ctx.fillRect(px + tileSize * 0.14, py + m, lw, tileSize - m * 2);
          ctx.strokeStyle = 'rgba(70, 66, 78, 0.85)'; // the band, catching cold light
          ctx.lineWidth = Math.max(1.5, tileSize * 0.05);
          ctx.beginPath();
          ctx.moveTo(px + tileSize * 0.14, py + tileSize * 0.5);
          ctx.lineTo(px + tileSize * 0.14 + lw, py + tileSize * 0.5);
          ctx.stroke();
          ctx.fillStyle = 'rgba(120, 116, 130, 0.8)'; // rivets
          for (const fy of [0.32, 0.68]) {
            ctx.beginPath();
            ctx.arc(px + tileSize * 0.14 + lw * 0.5, py + tileSize * fy, Math.max(1, tileSize * 0.026), 0, Math.PI * 2);
            ctx.fill();
          }
          break;
        }
        ctx.fillStyle = 'rgba(30, 18, 8, 0.5)';
        ctx.fillRect(px + tileSize * 0.08, py + tileSize * 0.1, jw, tileSize * 0.8); // left jamb
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
          // Ashen violet stone: fine pale veins, PLUS a scatter of soot flecks so the slab has
          // grain rather than reading as two flat quadrilaterals.
          ctx.strokeStyle = isDark ? 'rgba(224, 196, 214, 0.13)' : 'rgba(240, 216, 230, 0.17)';
          ctx.lineWidth = Math.max(0.75, tileSize * 0.016);
          for (let i = 0; i < 3; i += 1) {
            const vy = py + tileSize * (0.18 + 0.3 * i + 0.12 * tileHash(x * 3 + i, y * 5));
            const sway = (tileHash(x + i, y * 2) - 0.5) * tileSize * 0.45;
            ctx.beginPath();
            ctx.moveTo(px, vy);
            ctx.quadraticCurveTo(px + tileSize * 0.5, vy + sway, px + tileSize, vy + sway * 0.3);
            ctx.stroke();
          }
          ctx.fillStyle = 'rgba(10, 6, 12, 0.22)';
          for (let i = 0; i < 6; i += 1) {
            const gx = px + tileSize * (0.1 + tileHash(x * 5 + i, y * 2) * 0.8);
            const gy = py + tileSize * (0.1 + tileHash(x * 2, y * 5 + i) * 0.8);
            ctx.beginPath();
            ctx.arc(gx, gy, tileSize * (0.012 + 0.018 * tileHash(x + i, y + i)), 0, Math.PI * 2);
            ctx.fill();
          }
          break;
        }
        // Open ground: MANY small pockmarks, plus a couple of hairline cracks — grain, not four
        // fat freckles. Deterministic per tile so the pattern holds still.
        ctx.fillStyle = isDark ? 'rgba(0, 0, 0, 0.14)' : 'rgba(120, 80, 40, 0.17)';
        for (let i = 0; i < 8; i += 1) {
          const rx = tileHash(x * 4 + i, y * 2 + 1);
          const ry = tileHash(x * 2 + 3, y * 4 + i);
          const r = tileSize * (0.012 + 0.022 * tileHash(x + i, y - i));
          ctx.beginPath();
          ctx.arc(px + tileSize * (0.1 + rx * 0.8), py + tileSize * (0.1 + ry * 0.8), r, 0, Math.PI * 2);
          ctx.fill();
        }
        // A hairline crack or two, kinked once so it reads as a fracture, not a scratch.
        ctx.strokeStyle = isDark ? 'rgba(0, 0, 0, 0.16)' : 'rgba(90, 60, 30, 0.18)';
        ctx.lineWidth = Math.max(0.75, tileSize * 0.012);
        const cracks = tileHash(x * 9, y * 9) > 0.5 ? 2 : 1;
        for (let i = 0; i < cracks; i += 1) {
          const sx = px + tileSize * (0.15 + tileHash(x * 6 + i, y) * 0.7);
          const sy = py + tileSize * (0.15 + tileHash(x, y * 6 + i) * 0.7);
          const a = tileHash(x + i * 2, y + i) * Math.PI * 2;
          const len = tileSize * (0.14 + 0.16 * tileHash(x * 3, y * 3 + i));
          const mx = sx + Math.cos(a) * len * 0.55;
          const my = sy + Math.sin(a) * len * 0.55;
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.lineTo(mx, my);
          ctx.lineTo(mx + Math.cos(a + 0.7) * len * 0.5, my + Math.sin(a + 0.7) * len * 0.5);
          ctx.stroke();
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
    // Glowing flame — three nested teardrops, hot core last. In the demon realm the fire burns COLD
    // BLUE: it marks the torches as something other than honest firelight, and (usefully) stops a
    // wall-torch from reading as a splash of lava now that the floor beside it is ash.
    const fire = demonRealm
      ? { glow: 'rgba(70, 150, 255, 0.95)', outer: '#1d4ed8', mid: '#60a5fa', core: '#ecfeff' }
      : { glow: 'rgba(255, 140, 30, 0.95)', outer: '#f97316', mid: '#fbbf24', core: '#fff7ed' };
    ctx.shadowBlur = tileSize * (0.45 + 0.18 * flick);
    ctx.shadowColor = fire.glow;
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
    flame(1, fire.outer);
    flame(0.6, fire.mid);
    flame(0.28, fire.core); // white-hot core
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
  function drawBoulderRock(cx, cy, angle, faded, seed) {
    const r = tileSize * 0.38;
    const sd = seed || 0;
    // A LUMPY outline instead of a clean circle — a ring of vertices at wandering radii, seeded per
    // boulder so each rock is its own irregular shape (and the same one frame to frame). Smoothed with
    // quadratic curves through the midpoints so it reads as a knobbly stone, not a spiky gear.
    const N = 11;
    const rad = [];
    for (let i = 0; i < N; i += 1) {
      const h = Math.sin(sd * 12.9898 + i * 78.233) * 43758.5453;
      rad.push(r * (0.78 + 0.30 * (h - Math.floor(h)))); // 0.78r .. 1.08r
    }
    const lumpyPath = () => {
      const pt = (i) => { const a = (i / N) * Math.PI * 2; const rr = rad[(i % N + N) % N]; return [Math.cos(a) * rr, Math.sin(a) * rr]; };
      ctx.beginPath();
      let [px, py] = pt(0);
      const [mx0, my0] = [(pt(N - 1)[0] + px) / 2, (pt(N - 1)[1] + py) / 2];
      ctx.moveTo(mx0, my0);
      for (let i = 0; i < N; i += 1) {
        const [cxp, cyp] = pt(i);
        const [nxp, nyp] = pt(i + 1);
        ctx.quadraticCurveTo(cxp, cyp, (cxp + nxp) / 2, (cyp + nyp) / 2); // corner as the control point → rounded lump
      }
      ctx.closePath();
    };
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
    lumpyPath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 1;
    lumpyPath();
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
      drawBoulderRock(cx, cy, b.angle || 0, !lit(b.targetX, b.targetY), b.targetX * 131.7 + b.targetY * 41.3 + 1);
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

  // ------------------------------- TITLE SCENE -------------------------------
  // The menu is DIEGETIC: its options are tiles on a live board, with the king enthroned at the
  // centre. Everything here reuses the in-game primitives (drawPiece/drawExit/drawKey/drawTorch and
  // terrainColor) so the splash is unmistakably the same game, not a web page bolted to the front.

  let titleRects = []; // {id, x, y, w, h, enabled} in canvas pixels — the hit-test targets
  let titleCenter = null; // the throne's pixel centre — the origin for spatial keyboard select
  let sceneCenter = null; // the trophy-hall king's pixel centre — origin for directional trophy select

  // ONE layout, shared by the draw and the hit-test so a click can never land somewhere the eye
  // was not pointed. A tidy 2x2 of options around the king in the middle.
  function titleLayout() {
    const W = canvas.width;
    const H = canvas.height;
    const tile = Math.max(28, Math.round(Math.min(W, H) / 9));
    const cols = Math.ceil(W / tile);
    const rows = Math.ceil(H / tile);
    // The TRUE centre of the visible canvas, not floor(cols/2): the board is a hair wider than the
    // canvas, so floor(cols/2) sits half a tile RIGHT of centre and shoved the king + menu (and the
    // right-hand torch clean off-screen). round(size/2/tile - 0.5) lands the middle tile dead-centre.
    const midc = Math.round(W / 2 / tile - 0.5);
    const midr = Math.round(H / 2 / tile - 0.5);
    const cells = [
      [midc - 2, midr], [midc + 2, midr],         // New Game / Continue, flanking the throne
      [midc - 2, midr + 2], [midc + 2, midr + 2], // Trophies / Options, the rank below
    ];
    return { W, H, tile, cols, rows, midc, midr, cells };
  }

  // A gold goblet — the Trophies tile.
  function drawTrophyIcon(col, row, tile) {
    const cx = col * tile + tile / 2;
    const cy = row * tile + tile / 2;
    const r = tile * 0.26;
    ctx.save();
    ctx.fillStyle = '#e8c14a';
    ctx.strokeStyle = '#7a5a16';
    ctx.lineWidth = Math.max(1, tile * 0.03);
    ctx.beginPath(); // the bowl
    ctx.moveTo(cx - r, cy - r * 0.75);
    ctx.lineTo(cx + r, cy - r * 0.75);
    ctx.arc(cx, cy - r * 0.75, r, 0, Math.PI);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillRect(cx - tile * 0.03, cy + r * 0.1, tile * 0.06, r * 0.7); // stem
    ctx.fillRect(cx - r * 0.55, cy + r * 0.8, r * 1.1, tile * 0.06); // base
    ctx.restore();
  }

  // A cog — the Options tile. It turns, slowly.
  function drawGearIcon(col, row, tile) {
    const cx = col * tile + tile / 2;
    const cy = row * tile + tile / 2;
    const r = tile * 0.26;
    ctx.save();
    ctx.fillStyle = '#9aa4b2';
    ctx.strokeStyle = '#3a424f';
    ctx.lineWidth = Math.max(1, tile * 0.025);
    const teeth = 8;
    ctx.beginPath();
    for (let i = 0; i < teeth * 2; i += 1) {
      const a = (i / (teeth * 2)) * Math.PI * 2 - clock * 0.4;
      const rr = i % 2 === 0 ? r : r * 0.74;
      const px = cx + Math.cos(a) * rr;
      const py = cy + Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#020617';
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.34, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawTitleOption(col, row, tile, opt, hovered) {
    const px = col * tile;
    const py = row * tile;
    ctx.save();
    if (!opt.enabled) ctx.globalAlpha = 0.4;
    // HOVER: the same green move-highlight the board uses in play — one language for "you can go
    // here". It breathes so a still splash still has a pulse.
    if (hovered && opt.enabled) {
      const beat = 0.6 + 0.4 * (0.5 + 0.5 * Math.sin(clock * 5));
      ctx.save();
      ctx.shadowBlur = tile * 0.5 * beat;
      ctx.shadowColor = 'rgba(34, 197, 94, 0.9)';
      ctx.fillStyle = `rgba(34, 197, 94, ${(0.14 * beat).toFixed(3)})`;
      ctx.fillRect(px, py, tile, tile);
      ctx.strokeStyle = `rgba(74, 222, 128, ${(0.95 * beat).toFixed(3)})`;
      ctx.lineWidth = Math.max(2, tile * 0.05);
      ctx.strokeRect(px + tile * 0.06, py + tile * 0.06, tile * 0.88, tile * 0.88);
      ctx.restore();
    }
    if (opt.icon === 'stair') drawExit(col, row, false, false, false);
    else if (opt.icon === 'key') drawKey(col, row, false);
    else if (opt.icon === 'trophy') drawTrophyIcon(col, row, tile);
    else if (opt.icon === 'gear') drawGearIcon(col, row, tile);
    // The label, carved under the tile.
    ctx.globalAlpha = opt.enabled ? 1 : 0.5;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = `${Math.round(tile * 0.26)}px Georgia, "Times New Roman", serif`;
    ctx.lineWidth = Math.max(2, tile * 0.05);
    ctx.strokeStyle = 'rgba(2, 6, 23, 0.85)';
    ctx.fillStyle = hovered && opt.enabled ? '#bbf7d0' : '#f1e5c8';
    const ly = py + tile * 1.02;
    ctx.strokeText(opt.label, px + tile / 2, ly);
    ctx.fillText(opt.label, px + tile / 2, ly);
    ctx.restore();
  }

  // The LIVING BOARD behind the menus: a warm sepia checkerboard, flickering corner torches, and a
  // vignette that settles the eye toward the middle. Shared by the title splash and every other
  // pre-game screen (class select, trophies, options) so none of them is a black void any more.
  function drawBoardBackdrop() {
    const L = titleLayout();
    tileSize = L.tile;     // drawPiece/drawExit/drawKey/drawTorch read this
    demonRealm = false;    // the splash is the warm mortal board, never hell
    treeHp = null;
    burnTrees = null;
    ctx.fillStyle = '#020617';
    ctx.fillRect(0, 0, L.W, L.H);
    for (let x = 0; x < L.cols; x += 1) {
      for (let y = 0; y < L.rows; y += 1) {
        const isDark = (x + y) % 2 === 1;
        ctx.fillStyle = terrainColor('normal', isDark);
        ctx.fillRect(x * L.tile, y * L.tile, L.tile, L.tile);
        drawTexture('normal', x * L.tile, y * L.tile, isDark, x, y);
      }
    }
    for (const [tx, ty] of [[L.midc - 4, L.midr - 3], [L.midc + 4, L.midr - 3], [L.midc - 4, L.midr + 3], [L.midc + 4, L.midr + 3]]) {
      if (tx < 0 || ty < 0 || tx >= L.cols || ty >= L.rows) continue;
      ctx.fillStyle = terrainColor('wall', (tx + ty) % 2 === 1);
      ctx.fillRect(tx * L.tile, ty * L.tile, L.tile, L.tile);
      drawTorch(tx * L.tile, ty * L.tile, tx, ty);
    }
    ctx.save();
    const vg = ctx.createRadialGradient(L.W / 2, L.H / 2, L.tile, L.W / 2, L.H / 2, Math.max(L.W, L.H) * 0.62);
    vg.addColorStop(0, 'rgba(2, 6, 23, 0)');
    vg.addColorStop(1, 'rgba(2, 6, 23, 0.72)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, L.W, L.H);
    ctx.restore();
    return L;
  }

  function drawTitle(menu) {
    const L = drawBoardBackdrop();
    const m = menu || {};
    const opts = m.options || [];

    // 2) THE KING, enthroned at the centre on a soft gold ring.
    const kx = L.midc * L.tile + L.tile / 2;
    const ky = L.midr * L.tile + L.tile / 2;
    ctx.save();
    const halo = 0.5 + 0.5 * Math.sin(clock * 1.4);
    const grad = ctx.createRadialGradient(kx, ky, L.tile * 0.2, kx, ky, L.tile * 0.7);
    grad.addColorStop(0, `rgba(232, 193, 74, ${(0.28 + 0.14 * halo).toFixed(3)})`);
    grad.addColorStop(1, 'rgba(232, 193, 74, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(kx, ky, L.tile * 0.7, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    drawPiece(L.midc, L.midr, 'king', true, { classColor: '#e8c14a' });

    // 3) THE OPTIONS, as tiles around him.
    titleCenter = { x: kx, y: ky }; // the throne — origin for the directional keyboard select
    titleRects = [];
    opts.forEach((opt, i) => {
      const cell = L.cells[i];
      if (!cell) return;
      const [cx, cy] = cell;
      drawTitleOption(cx, cy, L.tile, opt, opt.id === m.hover);
      titleRects.push({ id: opt.id, x: cx * L.tile, y: cy * L.tile, w: L.tile, h: L.tile, enabled: Boolean(opt.enabled) });
    });

    // 4) THE TITLE, chiselled across the top.
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const titleY = L.tile * 1.4;
    ctx.font = `700 ${Math.round(L.tile * 0.82)}px Georgia, "Times New Roman", serif`;
    ctx.lineWidth = Math.max(3, L.tile * 0.07);
    ctx.strokeStyle = 'rgba(2, 6, 23, 0.9)';
    ctx.strokeText(m.title || 'Chess Dungeon', L.W / 2, titleY);
    const tg = ctx.createLinearGradient(0, titleY - L.tile * 0.5, 0, titleY + L.tile * 0.5);
    tg.addColorStop(0, '#f7e7b8');
    tg.addColorStop(1, '#d8a93a');
    ctx.fillStyle = tg;
    ctx.fillText(m.title || 'Chess Dungeon', L.W / 2, titleY);
    // The subtitle and the save-file line both sit over a busy, torch-lit board, so each gets a HEAVY
    // dark outline (stroke under fill) — otherwise the pale text washes out against the bright tiles.
    ctx.lineJoin = 'round';
    if (m.subtitle) {
      ctx.font = `italic ${Math.round(L.tile * 0.3)}px Georgia, serif`;
      ctx.lineWidth = Math.max(3, L.tile * 0.055);
      ctx.strokeStyle = 'rgba(2, 6, 23, 0.92)';
      ctx.strokeText(m.subtitle, L.W / 2, titleY + L.tile * 0.72);
      ctx.fillStyle = '#e6d3a8'; // a touch brighter, too, so it lifts off the outline
      ctx.fillText(m.subtitle, L.W / 2, titleY + L.tile * 0.72);
    }
    if (m.save && L.cells[1]) {
      const sx = (L.cells[1][0] + 0.5) * L.tile;
      const sy = (L.cells[1][1] + 1.34) * L.tile;
      ctx.font = `${Math.round(L.tile * 0.22)}px Georgia, serif`;
      ctx.lineWidth = Math.max(2.5, L.tile * 0.05);
      ctx.strokeStyle = 'rgba(2, 6, 23, 0.92)';
      ctx.strokeText(m.save, sx, sy);
      ctx.fillStyle = '#c4d2e4';
      ctx.fillText(m.save, sx, sy);
    }
    ctx.restore();

    // (The vignette is drawn by drawBoardBackdrop, under the king and options.)
  }

  // --------------------------- PRE-GAME SCENES ---------------------------
  // Class select and the trophy room are DIEGETIC, exactly like the title: the king stands on the
  // board and the choices are pieces/tiles around him. ONE hit-rect list + one hit-test serve both,
  // so a click can never land somewhere the eye was not pointed.
  const TROPHY_TIER_COLOR = { gold: '#e8c14a', silver: '#cbd5e1', bronze: '#cd7f4b' };
  let sceneRects = []; // {id, x, y, w, h} in canvas px — the click/hover targets of the current scene
  // Trophy hall: each room wears a different accent, and paging PANS to the neighbouring room so the
  // travel reads. `trophyRoom` tracks which room is on screen and when the pan began.
  let trophyRoom = { page: -1, startClock: 0, dir: 0 };
  const TROPHY_ROOM_ACCENTS = ['#e8c14a', '#7dd3fc', '#f472b6', '#4ade80', '#fb923c', '#a78bfa', '#f87171', '#38bdf8', '#facc15', '#34d399', '#c084fc', '#fca5a5'];
  function sceneOptionAt(px, py) {
    for (const r of sceneRects) {
      if (px >= r.x && px < r.x + r.w && py >= r.y && py < r.y + r.h) return r.id;
    }
    return null;
  }

  // The pulsing green "you can go here" box the board uses in play and the title uses for its options.
  function drawSceneHover(L, col, row) {
    const px = col * L.tile;
    const py = row * L.tile;
    const beat = 0.6 + 0.4 * (0.5 + 0.5 * Math.sin(clock * 5));
    ctx.save();
    ctx.shadowBlur = L.tile * 0.5 * beat;
    ctx.shadowColor = 'rgba(34, 197, 94, 0.9)';
    ctx.fillStyle = `rgba(34, 197, 94, ${(0.14 * beat).toFixed(3)})`;
    ctx.fillRect(px, py, L.tile, L.tile);
    ctx.strokeStyle = `rgba(74, 222, 128, ${(0.95 * beat).toFixed(3)})`;
    ctx.lineWidth = Math.max(2, L.tile * 0.05);
    ctx.strokeRect(px + L.tile * 0.06, py + L.tile * 0.06, L.tile * 0.88, L.tile * 0.88);
    ctx.restore();
  }

  // A chiselled scene title (+ subtitle) across the top, matching the splash.
  function drawSceneTitle(L, title, sub) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const y = L.tile * 1.1;
    ctx.font = `700 ${Math.round(L.tile * 0.62)}px Georgia, "Times New Roman", serif`;
    ctx.lineWidth = Math.max(3, L.tile * 0.06);
    ctx.strokeStyle = 'rgba(2, 6, 23, 0.9)';
    ctx.strokeText(title, L.W / 2, y);
    const tg = ctx.createLinearGradient(0, y - L.tile * 0.4, 0, y + L.tile * 0.4);
    tg.addColorStop(0, '#f7e7b8');
    tg.addColorStop(1, '#d8a93a');
    ctx.fillStyle = tg;
    ctx.fillText(title, L.W / 2, y);
    if (sub) {
      ctx.font = `italic ${Math.round(L.tile * 0.26)}px Georgia, serif`;
      ctx.fillStyle = '#cbb489';
      ctx.fillText(sub, L.W / 2, y + L.tile * 0.6);
    }
    ctx.restore();
  }

  // Word-wrap `text` to `maxWidth` (ctx font must be set first).
  function wrapLines(text, maxWidth) {
    const words = String(text || '').split(/\s+/).filter(Boolean);
    const lines = [];
    let line = '';
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (ctx.measureText(test).width > maxWidth && line) { lines.push(line); line = w; } else line = test;
    }
    if (line) lines.push(line);
    return lines;
  }

  // The heading + blurb of whatever is hovered, in a panel low on the board.
  function drawSceneBlurb(L, heading, text) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const cx = L.W / 2;
    const maxW = L.W * 0.9;
    let y = L.H - L.tile * 2.0; // below the lowest ring of tiles, above the Back plaque
    if (heading) {
      // SHRINK the heading to fit the board width — a long achievement name (or the doorway hint) used
      // to run clean off both edges of the screen.
      let px = Math.round(L.tile * 0.32);
      ctx.font = `700 ${px}px Georgia, serif`;
      while (px > 9 && ctx.measureText(heading).width > maxW) { px -= 1; ctx.font = `700 ${px}px Georgia, serif`; }
      ctx.lineWidth = Math.max(2, px * 0.16);
      ctx.strokeStyle = 'rgba(2, 6, 23, 0.85)';
      ctx.fillStyle = '#f1e5c8';
      ctx.strokeText(heading, cx, y);
      ctx.fillText(heading, cx, y);
      y += L.tile * 0.42;
    }
    if (text) {
      ctx.font = `${Math.round(L.tile * 0.23)}px Georgia, serif`;
      ctx.fillStyle = '#cdd5e1';
      for (const ln of wrapLines(text, maxW).slice(0, 2)) { ctx.fillText(ln, cx, y); y += L.tile * 0.3; }
    }
    ctx.restore();
  }

  // A "‹ Back" plaque in the bottom-left, always present. Pushes its own hit-rect.
  function drawSceneBack(L, hovered) {
    const w = L.tile * 1.8;
    const h = L.tile * 0.66;
    const px = L.tile * 0.22;
    const py = L.H - h - L.tile * 0.22;
    ctx.save();
    ctx.fillStyle = hovered ? 'rgba(34, 197, 94, 0.22)' : 'rgba(2, 6, 23, 0.55)';
    ctx.strokeStyle = hovered ? '#4ade80' : 'rgba(200, 168, 100, 0.55)';
    ctx.lineWidth = Math.max(2, L.tile * 0.04);
    ctx.beginPath();
    const r = L.tile * 0.16;
    ctx.moveTo(px + r, py);
    ctx.arcTo(px + w, py, px + w, py + h, r);
    ctx.arcTo(px + w, py + h, px, py + h, r);
    ctx.arcTo(px, py + h, px, py, r);
    ctx.arcTo(px, py, px + w, py, r);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = hovered ? '#bbf7d0' : '#f1e5c8';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${Math.round(L.tile * 0.3)}px Georgia, serif`;
    ctx.fillText('‹ Back', px + w / 2, py + h / 2);
    ctx.restore();
    sceneRects.push({ id: 'back', x: px, y: py, w, h });
  }

  // A soft coloured halo behind a king token on a scene.
  function drawSceneKingHalo(L, col, row, color) {
    const kx = col * L.tile + L.tile / 2;
    const ky = row * L.tile + L.tile / 2;
    const pulse = 0.5 + 0.5 * Math.sin(clock * 1.4);
    const grad = ctx.createRadialGradient(kx, ky, L.tile * 0.2, kx, ky, L.tile * 0.72);
    grad.addColorStop(0, hexA(color, 0.3 + 0.14 * pulse));
    grad.addColorStop(1, hexA(color, 0));
    ctx.save();
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(kx, ky, L.tile * 0.72, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // ONE class choice: a king token in the class colour, its name + a one-line kit under it.
  function drawChoiceKing(L, col, row, ch, hovered) {
    const px = col * L.tile;
    const py = row * L.tile;
    if (hovered) drawSceneHover(L, col, row);
    drawSceneKingHalo(L, col, row, ch.color);
    drawPiece(col, row, 'king', true, { classColor: ch.color });
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.lineWidth = Math.max(2, L.tile * 0.05);
    ctx.strokeStyle = 'rgba(2, 6, 23, 0.85)';
    ctx.font = `700 ${Math.round(L.tile * 0.3)}px Georgia, serif`;
    ctx.fillStyle = hovered ? '#bbf7d0' : ch.color;
    ctx.strokeText(ch.label, px + L.tile / 2, py + L.tile * 1.02);
    ctx.fillText(ch.label, px + L.tile / 2, py + L.tile * 1.02);
    if (ch.sublabel) {
      ctx.font = `${Math.round(L.tile * 0.22)}px Georgia, serif`;
      ctx.fillStyle = '#cbd5e1';
      ctx.strokeText(ch.sublabel, px + L.tile / 2, py + L.tile * 1.36);
      ctx.fillText(ch.sublabel, px + L.tile / 2, py + L.tile * 1.36);
    }
    ctx.restore();
  }

  // THE CLASS / DIFFICULTY PICKER: a centred row of kings, one per choice, the king you'll command.
  // The TRUE centre column/row of the VISIBLE canvas (titleLayout's midc sits half a tile off-centre
  // because the board is a hair wider than the canvas — fine for the title, but symmetric scenes must
  // key off the real middle or their outer tiles fall off the right edge).
  function sceneCentre(L) {
    return { cc: Math.round(L.W / 2 / L.tile - 0.5), cr: Math.round(L.H / 2 / L.tile - 0.5) };
  }
  function drawPickScene(model) {
    const L = drawBoardBackdrop();
    tileSize = L.tile;
    sceneRects = [];
    const m = model || {};
    const choices = m.choices || [];
    const { cc, cr } = sceneCentre(L);
    drawSceneTitle(L, m.title || 'Choose your calling', m.subtitle);
    const spread = choices.length >= 3 ? 3 : 2;
    const startCol = cc - Math.floor((choices.length - 1) / 2) * spread;
    choices.forEach((ch, i) => {
      const col = startCol + i * spread;
      drawChoiceKing(L, col, cr, ch, ch.id === m.hover);
      sceneRects.push({ id: ch.id, x: col * L.tile, y: cr * L.tile, w: L.tile, h: L.tile });
    });
    const hov = choices.find((c) => c.id === m.hover);
    drawSceneBlurb(L, hov ? hov.label : (m.hint || 'Hover a king to read its calling.'), hov ? hov.desc : '');
    drawSceneBack(L, m.hover === 'back');
  }

  // ONE trophy on the wall of a room: a medallion (lit by tier, or a hollow star if unwon) + its name.
  function drawTrophyTile(L, col, row, t, hovered) {
    const px = col * L.tile;
    const py = row * L.tile;
    const cx = px + L.tile / 2;
    const cy = py + L.tile * 0.4;
    const r = L.tile * 0.27;
    if (hovered) drawSceneHover(L, col, row);
    const color = t.tier ? (TROPHY_TIER_COLOR[t.tier] || '#cbd5e1') : null;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (color) {
      const g = ctx.createRadialGradient(cx, cy, r * 0.2, cx, cy, r * 1.9);
      g.addColorStop(0, hexA(color, 0.42));
      g.addColorStop(1, hexA(color, 0));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(cx, cy, r * 1.9, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(20, 14, 6, 0.7)'; ctx.lineWidth = Math.max(1, r * 0.14); ctx.stroke();
      ctx.fillStyle = 'rgba(20, 14, 6, 0.85)';
      ctx.font = `${Math.round(r * 1.3)}px "Segoe UI Symbol", serif`;
      ctx.fillText('★', cx, cy + r * 0.06);
    } else {
      ctx.fillStyle = 'rgba(255, 240, 210, 0.05)';
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(150, 140, 120, 0.3)'; ctx.lineWidth = Math.max(1, r * 0.1); ctx.stroke();
      ctx.font = `${Math.round(r * 1.3)}px "Segoe UI Symbol", serif`;
      ctx.lineWidth = Math.max(1, r * 0.07); ctx.strokeStyle = 'rgba(180, 180, 195, 0.42)';
      ctx.strokeText('★', cx, cy + r * 0.06); // a hollow star — still to win
    }
    // Its full name + condition show in the blurb on hover — the medal itself stays clean (a wall of
    // labels around the king was unreadable at this size).
    ctx.restore();
  }

  // A doorway to the neighbouring room — the ‹ › the king walks through to page the trophy halls.
  function drawSceneDoor(L, col, row, id, glyph, hovered) {
    const px = col * L.tile;
    const py = row * L.tile;
    if (hovered) drawSceneHover(L, col, row);
    ctx.save();
    ctx.fillStyle = 'rgba(8, 7, 11, 0.72)';
    ctx.fillRect(px + L.tile * 0.22, py + L.tile * 0.08, L.tile * 0.56, L.tile * 0.84);
    ctx.strokeStyle = 'rgba(150, 124, 74, 0.5)';
    ctx.lineWidth = Math.max(1.5, L.tile * 0.03);
    ctx.strokeRect(px + L.tile * 0.22, py + L.tile * 0.08, L.tile * 0.56, L.tile * 0.84);
    ctx.fillStyle = hovered ? '#bbf7d0' : '#e8c14a';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 ${Math.round(L.tile * 0.72)}px Georgia, serif`;
    ctx.fillText(glyph, px + L.tile / 2, py + L.tile / 2);
    ctx.restore();
    sceneRects.push({ id, x: px, y: py, w: L.tile, h: L.tile });
  }

  // THE TROPHY ROOM: the king in the middle of a hall, this room's trophies on the walls around him,
  // doorways ‹ › leading to the next room's worth. Paged, so he walks the whole collection this way.
  function drawTrophyScene(model) {
    const m = model || {};
    const page = m.page || 0;
    // Page change → start a horizontal PAN to the neighbouring room (no pan on the first open).
    if (page !== trophyRoom.page) {
      trophyRoom = { page, startClock: clock, dir: trophyRoom.page < 0 ? 0 : Math.sign(page - trophyRoom.page) };
    }
    const t = trophyRoom.dir === 0 ? 1 : Math.min(1, (clock - trophyRoom.startClock) / 0.42);
    const ease = 1 - Math.pow(1 - t, 3);
    const W0 = canvas.width;
    const H0 = canvas.height;
    const slideX = t < 1 ? trophyRoom.dir * W0 * (1 - ease) : 0; // the new room slides in from the doorway side
    sceneRects = [];
    // Black behind, then PAN the whole room (board + contents) as one — the UI chrome (title, blurb,
    // Back) stays put over the top.
    ctx.fillStyle = '#020617';
    ctx.fillRect(0, 0, W0, H0);
    ctx.save();
    ctx.translate(slideX, 0);
    const L = drawBoardBackdrop();
    tileSize = L.tile;
    const { cc, cr } = sceneCentre(L);
    sceneCenter = { x: (cc + 0.5) * L.tile, y: (cr + 0.5) * L.tile }; // origin for directional trophy select (pan settled = no offset)
    const accent = TROPHY_ROOM_ACCENTS[page % TROPHY_ROOM_ACCENTS.length];
    drawRoomAccent(L, accent); // this room's colour wash + a big faint room numeral, so each reads apart
    drawRoomNumeral(L, cc, cr, page + 1, accent);
    // The king, centre stage, ringed by this room's trophies (top three, two flanks, bottom three).
    const slots = [
      [cc - 2, cr - 2], [cc, cr - 2], [cc + 2, cr - 2],
      [cc - 2, cr], [cc + 2, cr],
      [cc - 2, cr + 2], [cc, cr + 2], [cc + 2, cr + 2],
    ];
    const trophies = m.trophies || [];
    trophies.forEach((tr, i) => {
      const slot = slots[i];
      if (!slot) return;
      drawTrophyTile(L, slot[0], slot[1], tr, tr.id === m.hover);
      sceneRects.push({ id: tr.id, x: slot[0] * L.tile + slideX, y: slot[1] * L.tile, w: L.tile, h: L.tile });
    });
    drawSceneKingHalo(L, cc, cr, '#e8c14a');
    drawPiece(cc, cr, 'king', true, { classColor: '#e8c14a' });
    if (m.hasPrev) { drawSceneDoor(L, cc - 4, cr, 'prev', '‹', m.hover === 'prev'); sceneRects.push({ id: 'prev', x: (cc - 4) * L.tile + slideX, y: cr * L.tile, w: L.tile, h: L.tile }); }
    if (m.hasNext) { drawSceneDoor(L, cc + 4, cr, 'next', '›', m.hover === 'next'); sceneRects.push({ id: 'next', x: (cc + 4) * L.tile + slideX, y: cr * L.tile, w: L.tile, h: L.tile }); }
    ctx.restore();
    // UI chrome, static over the pan.
    drawSceneTitle(L, 'Hall of Trophies', m.countLine);
    const hov = trophies.find((tr) => tr.id === m.hover);
    drawSceneBlurb(L, hov ? hov.name : 'Walk the doorways ‹ › (or arrow keys) to view every trophy.', hov ? hov.desc : '');
    drawSceneBack(L, m.hover === 'back');
  }

  // A room's colour identity: a soft accent vignette drawn over the board so no two adjacent rooms
  // read the same.
  function drawRoomAccent(L, color) {
    ctx.save();
    const g = ctx.createRadialGradient(L.W / 2, L.H / 2, L.tile, L.W / 2, L.H / 2, Math.max(L.W, L.H) * 0.62);
    g.addColorStop(0, hexA(color, 0.16));
    g.addColorStop(0.6, hexA(color, 0.06));
    g.addColorStop(1, hexA(color, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, L.W, L.H);
    ctx.restore();
  }

  // A big, faint room number behind the king — a watermark the eye catches when it changes, so paging
  // reads as moving to a NEW room even at a glance.
  function drawRoomNumeral(L, cc, cr, num, color) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 ${Math.round(L.tile * 3.2)}px Georgia, "Times New Roman", serif`;
    ctx.fillStyle = hexA(color, 0.12);
    ctx.fillText(String(num), (cc + 0.5) * L.tile, (cr + 0.5) * L.tile);
    ctx.restore();
  }

  // rgba() from a #rrggbb hex + alpha — small local helper for the trophy halos.
  function hexA(hex, a) {
    const h = hex.replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${Math.max(0, Math.min(1, a)).toFixed(3)})`;
  }

  // Which option tile the cursor is over (enabled only), or null. Same coords screenToTile takes.
  function titleOptionAt(px, py) {
    for (const r of titleRects) {
      if (r.enabled && px >= r.x && px < r.x + r.w && py >= r.y && py < r.y + r.h) return r.id;
    }
    return null;
  }

  // SPATIAL keyboard select: given rects laid out AROUND a centre and a pressed direction (dx,dy),
  // return the id of the one whose bearing from the centre best matches the key — press LEFT and you
  // land on the left icon, DOWN-LEFT on the down-left icon, and so on. ABSOLUTE (not a rotation through
  // a list): the same direction always picks the same icon, whichever one is currently highlighted.
  function pickByDirection(rects, cx, cy, dx, dy) {
    if ((!dx && !dy) || !rects.length) return null;
    const dlen = Math.hypot(dx, dy) || 1;
    let best = null;
    let bestScore = 0.35; // require a real match, not a near-perpendicular one
    for (const r of rects) {
      if (r.enabled === false) continue;
      const vx = (r.x + r.w / 2) - cx;
      const vy = (r.y + r.h / 2) - cy;
      const vlen = Math.hypot(vx, vy) || 1;
      const score = (vx * dx + vy * dy) / (vlen * dlen); // cosine of the angle between bearing and key
      if (score > bestScore) { bestScore = score; best = r.id; }
    }
    return best;
  }

  // The title icons ring the throne — pick the one the pressed direction points at.
  function titleOptionInDirection(dx, dy) {
    const cx = titleCenter ? titleCenter.x : (titleRects.reduce((a, r) => a + r.x + r.w / 2, 0) / (titleRects.length || 1));
    const cy = titleCenter ? titleCenter.y : (titleRects.reduce((a, r) => a + r.y + r.h / 2, 0) / (titleRects.length || 1));
    return pickByDirection(titleRects, cx, cy, dx, dy);
  }

  // The trophy medallions ring the king in the Hall — same directional pick, ignoring the ‹ › doors and
  // the Back button (those page rooms / leave, not select a trophy).
  function trophyInDirection(dx, dy) {
    if (!sceneCenter) return null;
    const medallions = sceneRects.filter((r) => r.id !== 'prev' && r.id !== 'next' && r.id !== 'back');
    return pickByDirection(medallions, sceneCenter.x, sceneCenter.y, dx, dy);
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
    if (state.upstair) { miniCtx.fillStyle = '#6b7280'; fill(state.upstair.x, state.upstair.y); } // where he came in — grey, and always known
    if (state.key && !state.key.collected) feature(state.key, state.key.orb ? '#5eead4' : '#fbbf24'); // Orb — teal / key — gold
    // NB: a shattered summoning circle is deliberately NOT marked here. Its ruin still scars the
    // board itself, which is where it matters; on the minimap a permanent violet block read as a
    // live threat — or at least as somewhere still worth going — long after the thing was dead.

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

    demonRealm = (state.floor || 1) >= DEMON_FLOOR; // the demon realm is floored in ash, and burns blue
    treeHp = state.treeHp || null;
    burnTrees = state.burningTrees || null;
    geyserStage = (typeof geyserErupting === 'function' && geyserErupting(state)) ? 'erupting'
      : (typeof geyserImminent === 'function' && geyserImminent(state)) ? 'imminent'
        : 'calm';
    fogNow = state.fog || null; // drifting fog banks (spellfire steam, lava/ice steam, a Fogweaver)
    // Premonition (soft-sight) and Sixth Sense (x-ray) both see CLEAR through HAZE — grass, fog and
    // geyser steam. When either is on, the view draws no haze veil at all over what he can see, so the
    // ground and the foes behind the murk read exactly as if it were not there.
    seeThroughHaze = Boolean(state.player.trueSight) || Boolean(state.player.seeThroughWalls);
    const world = state.worldSize;
    const bounds = getVisibleBounds(state);
    const awareBounds = getAwarenessBounds(state); // his TWO-WAY footprint (foes here can strike back)
    const oneWayActive = Boolean(state.player.visionOneWay); // Oracle extended (one-way) sight in play
    const seeThrough = Boolean(state.player.seeThroughWalls) || Boolean(state.player.trueSight); // Premonition (haze) / x-ray: see/shoot through cover (one-way)
    // A lit tile is a SAFE one-way firing zone if it lies out in the extended Oracle band, or if the
    // king only sees it THROUGH cover (his normal line to it is blocked) — a foe there can't hit back.
    const oneWaySafe = (x, y) => {
      // COVER IS NOT A FIRING ZONE. A wall, a trunk, a boulder is something you shoot PAST, never
      // at and never from — marking one was pure noise, and it painted stone he could plainly see
      // as though it took Premonition to know it was there. (It happens because the sight line to a
      // wall clips the wall NEXT to it, which is true and completely uninteresting.)
      if (blocksSight(terrainAt(state, x, y))) return false;
      return (oneWayActive && !isWithinBounds(awareBounds, x, y))
        || (seeThrough && !hasLineOfSight(state, state.player.x, state.player.y, x, y, false));
    };
    const threatened = getThreatenedTiles(state);
    const visible = computeVisibleTiles(state);
    const lit = (x, y) => visible.has(`${x},${y}`);

    // The ground around a gate that opens onto hell (or the portal home) is stained. Only once he
    // has actually FOUND it — staining the fog would paint him a signpost to the very thing he is
    // supposed to be hunting for.
    //
    // Computed HERE, below `lit`, and not up beside demonRealm where it belongs thematically: `lit`
    // is a const, so reading it earlier is a temporal-dead-zone throw that takes the whole frame
    // down — a black screen, not a wrong colour.
    const gate = state.exit;
    const gatePrecinct = gate && (gate.discovered || lit(gate.x, gate.y)) && (gate.portal || isHellmouth(state))
      ? { x: gate.x, y: gate.y }
      : null;

    // Fog of war: ground the king has never seen on this floor stays hidden.
    const explored = state.explored || {};
    const isExplored = (x, y) => Boolean(explored[`${x},${y}`]);

    // Tiles the king can reach this turn, used both for the tints below and the
    // special jump / capture markers drawn later.
    const playerMoves = showMoves ? getPlayerMoves(state) : [];
    const reachable = new Set(playerMoves.map((move) => `${move.x},${move.y}`));
    // A move that STRIKES rather than steps — capturing a foe/turret, or chopping a tree/gate. A
    // boulder SHOVE is deliberately NOT here: it is a push, not an attack. Its border reads WHITE so
    // the player can tell "I will hit something" from "I will step onto empty ground" (green).
    const attackKeys = new Set(playerMoves.filter((m) => m.capture || m.chop).map((m) => `${m.x},${m.y}`));
    // A WARDED target (a Guardian's retinue, `parry`) turns the first blow aside — striking it costs a
    // turn and does not kill. Its border reads STEEL rather than white, matching the shield the ward is
    // drawn with, so "this one soaks a hit" is legible BEFORE you commit the swing.
    const wardedAt = (x, y) => (state.enemies || []).some((e) => e.x === x && e.y === y && e.parry);
    const parryKeys = new Set(playerMoves.filter((m) => m.capture && wardedAt(m.x, m.y)).map((m) => `${m.x},${m.y}`));
    // A move onto ground that BITES — lava, a burning wall-torch, or a tree ablaze (all only reachable
    // by wading or phasing). Its border reads YELLOW: safe from foes, but the floor itself will hurt.
    const harmfulKeys = new Set();
    for (const m of playerMoves) {
      if (m.capture || m.chop || m.push) continue; // he does not END his move on these
      const t = terrainAt(state, m.x, m.y);
      const ablaze = t === 'tree' && state.burningTrees && state.burningTrees[`${m.x},${m.y}`];
      if (t === 'lava' || ablaze || (typeof hasTorch === 'function' && hasTorch(state, m.x, m.y))) harmfulKeys.add(`${m.x},${m.y}`);
    }
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
          // UNHALLOWED GROUND bleeding out from the gate. Purely a wash laid over whatever terrain
          // is actually there — deliberately NOT a terrain type, because a real one would have to be
          // taught to every rule that asks "is this plain floor" (doorway checks, area counts, blob
          // scatter) and would go wrong in a dozen quiet places for a cosmetic stain. It fades with
          // distance, so the precinct has an edge without a hard line.
          if (gatePrecinct) {
            const d = Math.max(Math.abs(x - gatePrecinct.x), Math.abs(y - gatePrecinct.y));
            if (d <= 2 && type !== 'lava') {
              const bleed = (1 - d / 3) * 0.5; // strongest underfoot, gone by 3 tiles out
              ctx.fillStyle = `rgba(88, 22, 60, ${bleed.toFixed(3)})`;
              ctx.fillRect(px, py, tileSize, tileSize);
            }
          }
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
          const key = `${x},${y}`;
          if ((canMove || isKingTile) && threatCount > 0) {
            // RED — you get hit if you move onto (or stand on) this tile; the king's OWN square
            // counts. Danger outranks the white/yellow tells: a strike or a lava tile that ALSO
            // exposes him to a foe reads red, so "safe attack" (white) really means safe.
            tileOutline(px, py, '#ef4444', threatCount);
          } else if (canMove && parryKeys.has(key)) {
            // STEEL — a strike that will be WARDED: the blow lands but is turned aside, so it costs the
            // turn without felling. Dimmer than the white "this kills it" tell, on purpose.
            tileOutline(px, py, '#94a3b8', 1);
          } else if (canMove && attackKeys.has(key)) {
            // WHITE — moving here STRIKES (a capture, or a chop) rather than merely steps.
            tileOutline(px, py, '#f5f5f5', 1);
          } else if (canMove && harmfulKeys.has(key)) {
            // YELLOW — no foe covers it, but the GROUND bites (lava / torch / burning tree).
            tileOutline(px, py, '#eab308', 1);
          } else if (canMove) {
            // GREEN — a safe tile the king can simply move to.
            tileOutline(px, py, '#22c55e', 1);
          } else if (threatCount > 0) {
            // A covered square the king can't reach: ORANGE if it's open ground he simply can't get
            // to, but GRAY if it's IMPASSABLE (a wall / ice / boulder he could never stand on anyway).
            const passable = typeof standableFor === 'function'
              && standableFor(type, { phaseWalls: Boolean(state.player.phase), pathfinder: Boolean(state.player.pathfinder) });
            tileOutline(px, py, passable ? '#f97316' : '#9ca3af', threatCount);
          }
          if (aiming) ctx.restore();
        }

        if (!inView) {
          // Out of the king's line of sight: dim it and hide what lurks there.
          ctx.fillStyle = 'rgba(2, 6, 23, 0.64)';
          ctx.fillRect(px, py, tileSize, tileSize);
        } else if (oneWaySafe(x, y)) {
          // A SAFE one-way firing zone: the king can shoot here but nothing here can hit him back.
          // ONE visual for BOTH sources, deliberately — the Oracle's extended band and Premonition's
          // see-through-cover tiles mean exactly the same thing to the player ("free shots"), so
          // they must look identical or he has two rules to learn instead of one.
          //
          // A cyan wash that BREATHES, rather than the diagonal hatch this used to be. The hatch was
          // certainly visible, but it was scratched over half the board at once and buried the
          // terrain underneath it; a slow pulse is just as impossible to miss (the eye is drawn to
          // movement more than to contrast) while leaving the ground legible. Same trick the lava
          // uses, and deliberately the same rhythm — one language for "this tile is doing something".
          // Deep AQUA rather than bright cyan: cyan-400 sat forward of the terrain and read as a
          // light source of its own. A darker teal sits DOWN in the floor, which is what a hint
          // about the ground should do.
          //
          // The COLOUR itself now swings with the pulse, not just its opacity — the wash travels
          // between a near-black teal and a bright one. A breathing alpha on one flat colour reads
          // as a slow shimmer you stop noticing; a colour moving light-to-dark is a thing the eye
          // keeps catching, which is the entire job of this overlay.
          const beat = 0.5 + 0.5 * Math.sin(clock * 1.9 + tileHash(x, y) * 0.6);
          // The FLOOR of the pulse is lifted (was 40/0.30): even at its dimmest the zone now reads
          // clearly as "special ground", so the extent of Premonition's one-way sight is obvious at a
          // glance rather than fading almost to nothing at the bottom of each breath.
          const lum = 72 + 76 * beat; // 72 -> 148: never fully dim
          ctx.fillStyle = `rgba(${Math.round(lum * 0.18)}, ${Math.round(lum)}, ${Math.round(lum * 1.02)}, ${(0.4 + 0.14 * beat).toFixed(3)})`;
          ctx.fillRect(px, py, tileSize, tileSize);
        }
      }
    }

    // Outline the king's field of view.
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = 2;
    ctx.strokeRect(bounds.x * tileSize, bounds.y * tileSize, bounds.width * tileSize, bounds.height * tileSize);

    // SCORCH marks first — soot burnt into the stone by spellfire, so blood and remains lie ON it.
    for (const sc of state.scorches || []) {
      if (isExplored(sc.x, sc.y)) drawScorch(sc, !lit(sc.x, sc.y));
    }
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
    for (const st of state.sticks || []) {
      if (isExplored(st.x, st.y)) {
        drawSticks(st, !lit(st.x, st.y));
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

    // The collapsed upstair he came in by: always on his starting tile, so always explored.
    if (state.upstair && isExplored(state.upstair.x, state.upstair.y)) {
      drawUpstair(state.upstair.x, state.upstair.y, !lit(state.upstair.x, state.upstair.y));
    }

    // The stair down: shown when in sight, or faded once discovered.
    if (state.exit) {
      const seen = lit(state.exit.x, state.exit.y);
      if (seen || state.exit.discovered) {
        if (state.exit.portal) drawPortal(state.exit.x, state.exit.y, !seen, state.exit.locked);
        else drawExit(state.exit.x, state.exit.y, !seen, state.exit.locked, isHellmouth(state));
        // Key in hand, the way out becomes the thing to go for — so the arrow moves here. Keyed off
        // `locked` rather than the key itself, so it is the STAIR's own state that decides: a
        // barred stair never points him at a door he cannot open.
        if (!state.exit.locked) {
          drawObjectiveArrow(state.exit.x, state.exit.y, state.exit.portal ? '#c084fc' : '#38bdf8');
        }
      }
    }

    // The floor key / Orb of Victory: shown when in sight, or faded once discovered (persists in fog).
    if (state.key && !state.key.collected) {
      const seen = lit(state.key.x, state.key.y);
      // Premonition (seeAllFoes) reveals the key straight through the fog (drawn faded).
      if (seen || state.key.discovered || state.player.seeAllFoes) {
        if (state.key.orb) drawOrb(state.key.x, state.key.y, !seen);
        else drawKey(state.key.x, state.key.y, !seen);
        drawObjectiveArrow(state.key.x, state.key.y, state.key.orb ? '#5eead4' : '#fbbf24');
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
      // SELF-HARM WARNING: if the blast would wash over the king's OWN tile, ring it in danger-red
      // (the same red a threatened move tile wears) so he sees he is about to burn himself.
      if (aoeTiles.some((t) => t.x === state.player.x && t.y === state.player.y)) {
        tileOutline(state.player.x * tileSize, state.player.y * tileSize, '#ef4444', 3);
      }
    }
    if (cardTargets) {
      for (const target of cardTargets) {
        drawCardHint(target.x, target.y, target.capture, wardedAt(target.x, target.y));
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
    // REVELATION (Oracle): the STATIONARY hazards — summoning circles and turrets — stay marked
    // through the fog once the floor is known, so the player can plan around them. Living foes
    // (enemies, minis, bosses) are NOT revealed; only the fixtures are.
    const revealsHazards = Boolean(state.player.revealFloor);
    const isKnownHazard = (enemy) => (enemy.role === 'circle' || enemy.role === 'turret') && isExplored(enemy.targetX, enemy.targetY);
    const shown = enemyRenders.filter((enemy) => lit(enemy.targetX, enemy.targetY) || seesAll || (revealsHazards && isKnownHazard(enemy)));
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
      // THIS is one of the foes covering the hovered tile: ring it in hot orange before its token
      // goes down, so the halo reads as a glow around the piece rather than a smear across it. It
      // breathes, because a static ring on a busy board is easy to miss.
      if (markedThreats.has(enemy.id)) {
        const beat = 0.62 + 0.38 * (0.5 + 0.5 * Math.sin(clock * 5));
        // Same mapping drawPiece uses — the canvas is ALREADY translated by the camera origin, so
        // subtracting it again here would float the halo away from the piece it belongs to.
        const cx = enemy.x * tileSize + tileSize / 2;
        const cy = enemy.y * tileSize + tileSize / 2;
        ctx.save();
        ctx.shadowBlur = tileSize * 0.5 * beat;
        ctx.shadowColor = 'rgba(249, 115, 22, 0.95)';
        ctx.fillStyle = `rgba(249, 115, 22, ${(0.16 * beat).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(cx, cy, tileSize * 0.46, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = `rgba(254, 138, 40, ${(0.95 * beat).toFixed(3)})`;
        ctx.lineWidth = Math.max(1.5, tileSize * 0.055);
        ctx.beginPath();
        ctx.arc(cx, cy, tileSize * 0.42, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
      // Seen ONLY through Premonition — the king sees it PAST cover (haze/fog) with no direct line to
      // it, so it cannot strike back. Ring it in the same teal as the one-way firing zone, so it reads
      // at a glance as "a free shot": a foe you can hit that can't hit you.
      if (seeThrough && inSight && typeof hasLineOfSight === 'function'
          && !hasLineOfSight(state, state.player.x, state.player.y, enemy.targetX, enemy.targetY, false)) {
        const beat = 0.5 + 0.5 * Math.sin(clock * 1.9 + tileHash(enemy.x | 0, enemy.y | 0) * 0.6);
        const cx = enemy.x * tileSize + tileSize / 2;
        const cy = enemy.y * tileSize + tileSize / 2;
        ctx.save();
        ctx.strokeStyle = `rgba(45, 212, 191, ${(0.65 + 0.3 * beat).toFixed(3)})`; // teal, matching the zone wash
        ctx.lineWidth = Math.max(1.5, tileSize * 0.06);
        ctx.setLineDash([tileSize * 0.14, tileSize * 0.1]); // dashed, so it never reads as a solid capture-ring
        ctx.beginPath();
        ctx.arc(cx, cy, tileSize * 0.43, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
      drawPiece(enemy.x, enemy.y, enemy.kind, false, { role, rush: enemy.rush, mini: enemy.mini, fire: enemy.fire, inactive, blood: woundBlood(liveById.get(enemy.id)) });
      if (role === 'boss') {
        // A guardian UNMADE — every perk torn off it by the Hexer — wears NO crown at all. That
        // bare head is the tell that there is nothing left of it but the piece.
        if (enemy.bossPerk) {
          drawBossTraitHat(enemy.x, enemy.y, enemy.bossPerk, enemy.rush || enemy.mini); // trait-specific crown (ashen for minis)
        }
      } else if (role !== 'normal') {
        drawRoleHat(enemy.x, enemy.y, role);
      }
      // A charging summoning circle shows the minion-to-be gathering — a ghost of its own piece
      // kind that grows more solid as the conjuring nears (fires on the 4th tick, so a slower,
      // more gradual wind-up).
      // The wind-up preview MUST read the same constant the conjuring does — it was hardcoded to 4
      // here while the logic counted to 4 there, which is exactly the pair that silently desyncs the
      // moment one side changes.
      if (role === 'circle' && inSight && (enemy.summonTick % SUMMON_TURNS) > 0) {
        drawSummonCharge(enemy.x, enemy.y, enemy.kind, (enemy.summonTick % SUMMON_TURNS) / SUMMON_TURNS);
      }
      // A boss (and now a destructible turret) wears a HP bar so its multi-hit state reads.
      if ((enemy.boss || enemy.turret) && enemy.maxHp) {
        drawBossHpBar(enemy.x, enemy.y, enemy.hp, enemy.maxHp);
      }
      // A WARDED foe (a Guardian's retinue) wears a small cyan shield — it will turn the first blow
      // aside, so the player knows to strike it twice (or knock it into a hazard).
      if (enemy.parry && inSight) {
        drawWardMark(enemy.x, enemy.y);
      }
      // State icon. A boss or turret catching its breath (cooldown) shows the recharge
      // glyph — otherwise the main-AI-state icon (turrets/circles have none of the latter).
      const live = liveById.get(enemy.id);
      // CONFUSED first, and for every kind of piece. The branches below are keyed on role — turrets
      // and summoning circles take their own paths and never reach the general state icon at all —
      // so anything less than the top spot would silently hide the fog on exactly the pieces the
      // player most needs to see it on.
      if (inSight && live && typeof isConfused === 'function' && isConfused(live)) {
        drawStateIcon(enemy.x, enemy.y, 'confused');
      } else if (inSight && live && live.recovering && (enemy.boss || enemy.turret)) {
        drawStateIcon(enemy.x, enemy.y, 'recovering');
      } else if (inSight && role === 'turret') {
        // Show the crosshair ONLY while the king is actually in the turret's line RIGHT NOW (computed
        // fresh, so a stale aim flag never lingers); otherwise it sits idle with a sleep "z".
        const live2 = live || enemy;
        const targetingNow = !enemy.dozing && typeof turretHasKingInLine === 'function' && turretHasKingInLine(state, live2);
        // A turret that KNOWS he is there but cannot bring a line to bear reads as FRUSTRATED, not
        // asleep — it is a "you are safe from THIS one, from HERE" tell. It knows if he is right
        // beside it, or if he has struck it. Purely cosmetic: the turret behaves identically either
        // way; only the icon changes, so the player can see the difference between a gun that has
        // not noticed him and a gun that has and can do nothing about it.
        const dx = Math.abs(live2.x - state.player.x);
        const dy = Math.abs(live2.y - state.player.y);
        const knowsHeIsThere = Math.max(dx, dy) <= 1 || Boolean(live2.provoked);
        drawStateIcon(enemy.x, enemy.y, targetingNow ? 'aiming' : knowsHeIsThere ? 'frustrated' : 'asleep');
      } else if (inSight && typeof isNeutralBeast === 'function' && isNeutralBeast(state, enemy)) {
        drawStateIcon(enemy.x, enemy.y, 'neutral'); // Wild Empathy: a wild beast at truce (♡)
      } else if (inSight && role !== 'turret' && role !== 'circle') {
        // Read the LIVE state, not the animation snapshot: `enemy` is a frame that can lag a beat
        // behind (a free action like Silence puts the room to sleep with no enemy phase to refresh
        // the snapshot), so a just-hushed foe kept showing its stale "?" wander icon instead of the
        // sleep "z". `live` is the current truth, exactly as the confused/recovering branches use.
        const st = live || enemy;
        const mainState = st.asleep ? 'asleep' : st.surprised ? 'surprised' : st.frustrated ? 'frustrated' : st.awake ? 'hostile' : 'unaware';
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
    // While in Animal Form the king shows as a horse — a UNICORN (bishop + nightrider); the ♞ glyph
    // reads as the beast he moves and fights as.
    const playerGlyph = state.player.promotion > 0 ? 'nightrider' : 'king';
    if (state.player.promotion > 0) drawBeastAura(playerRender.x, playerRender.y, state.player.promotion);
    drawPiece(playerRender.x, playerRender.y, playerGlyph, true, { classColor, blood: woundBlood(state.player) });
    if (state.player.promotion > 0) drawUnicornHorn(playerRender.x, playerRender.y); // the horn that makes the beast a UNICORN, not just a horse
    if (state.player.invuln && !(state.player.promotion > 0)) {
      drawInvulnMark(playerRender.x, playerRender.y); // Waiting: an untouchable halo (Animal Form has its own aura)
      drawWaitMark(playerRender.x, playerRender.y); // ...and a golden corner badge, the at-a-glance tell (like Parry, but gold)
    }
    if (state.player.guardUp) {
      drawGuardMark(playerRender.x, playerRender.y);
    }
    if (state.player.silence > 0) {
      drawHushMark(playerRender.x, playerRender.y); // Silence in effect — a hush hangs over the king
    }

    drawProjectiles();
    drawBursts();
    drawPuffs();
    drawFog(lit);
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

  // A puff of smoke on demand — the same arcane smoke a conjuring/dissolving uses. Banish is the
  // caller: a banished foe leaves nothing else behind.
  function puff(tileX, tileY) {
    puffs.push({ x: tileX, y: tileY, t: 0 });
  }

  // Drifting FOG banks: a soft gray haze over every fogged tile the king can currently SEE (only the
  // near edge of a bank is lit — the fog blocks the look past it). Semi-transparent, so pieces caught
  // in the near fog still show through, and animated on the tile clock so it rolls rather than sits.
  function drawFog(litFn) {
    if (!fogNow || seeThroughHaze) return; // Premonition/Sixth Sense: no veil — he sees clear through it
    ctx.save();
    for (const key in fogNow) {
      if (fogNow[key] <= 0) continue;
      const comma = key.indexOf(',');
      const fx = Number(key.slice(0, comma));
      const fy = Number(key.slice(comma + 1));
      if (litFn && !litFn(fx, fy)) continue; // never paint fog on ground he cannot see
      const cx = (fx + 0.5) * tileSize;
      const cy = (fy + 0.5) * tileSize;
      for (let i = 0; i < 5; i += 1) {
        const ang = (i / 5) * Math.PI * 2 + clock * 0.35 + tileHash(fx + i, fy) * 6.28;
        const dist = tileSize * (0.1 + 0.13 * (0.5 + 0.5 * Math.sin(clock * 0.5 + i + fx)));
        const r = tileSize * (0.24 + 0.1 * tileHash(fx, fy + i));
        ctx.fillStyle = 'rgba(205, 210, 220, 0.16)';
        ctx.beginPath();
        ctx.arc(cx + Math.cos(ang) * dist, cy + Math.sin(ang) * dist, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  // GRAY scorch smoke — drifts up wherever lava or fire sears a unit (king, foe or ally). Same shape
  // as the arcane puff, ashen instead of violet, so a burn reads as a burn at a glance.
  function smoke(tileX, tileY) {
    puffs.push({ x: tileX, y: tileY, t: 0, gray: true });
  }

  // Ring the foes threatening the hovered tile. Takes ids (not pieces) so a stale hover can never
  // resurrect a dead one — an id that no longer matches anything on the board simply draws nothing.
  function markThreats(ids) {
    markedThreats = new Set(ids || []);
  }

  return { init, reset, sync, update, draw, hit, effect, rangedShot, centerOn, centerCameraOn, minimapToTile, bump, bumpBoulder, bumpEnemy, lunge, shout, puff, smoke, drawTitle, titleOptionAt, titleOptionInDirection, trophyInDirection, drawBoardBackdrop, drawPickScene, drawTrophyScene, sceneOptionAt, panBy, panByPixels, zoomBy, screenToTile, markThreats };
})();

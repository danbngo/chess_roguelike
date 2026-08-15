// App controller: owns the screen state machine, the turn flow, the render
// loop, tutorial tips, and all DOM wiring. Depends on every other script first.

(function () {
  const canvas = document.getElementById('game');
  const minimapEl = document.getElementById('minimap');
  const floorLabel = document.getElementById('floor');
  const floorNameLabel = document.getElementById('floor-name');
  const turnLabel = document.getElementById('turn');
  const healthLabel = document.getElementById('health');
  const levelLabel = document.getElementById('level');
  const logEl = document.getElementById('log');
  const logToggle = document.getElementById('log-toggle');
  const examineEl = document.getElementById('examine');
  const optionsTitleButton = document.getElementById('options-title');
  const optionsButton = document.getElementById('options');

  const titleScreen = document.getElementById('title-screen');
  const gameoverScreen = document.getElementById('gameover-screen');
  const gameoverStats = document.getElementById('gameover-stats');
  const trophyScreen = document.getElementById('trophy-screen');
  const trophyBody = document.getElementById('trophy-body');
  const trophySub = document.getElementById('trophy-sub');
  const trophyButton = document.getElementById('title-trophies');
  const trophyCloseButton = document.getElementById('trophy-close');
  const gameoverBadges = document.getElementById('gameover-badges');
  const victoryBadges = document.getElementById('victory-badges');
  const victoryScreen = document.getElementById('victory-screen');
  const victoryStats = document.getElementById('victory-stats');
  const titleRunTable = document.getElementById('title-runtable');
  const gameoverRunTable = document.getElementById('gameover-runtable');
  const victoryRunTable = document.getElementById('victory-runtable');
  const altarScreen = document.getElementById('altar-screen');
  const altarList = document.getElementById('altar-list');
  const altarMessage = document.getElementById('altar-message');
  // ONE overlay, THREE uses (level-up boons, altars, portal confirmation), so its heading has to be
  // set per use. It was hardcoded "Level Up" in the markup, which meant an altar — and later a
  // portal asking him to commit to a realm — both announced themselves as a level-up.
  const altarTitle = document.getElementById('altar-title');
  const altarSub = document.getElementById('altar-sub');
  function setOverlayHeading(title, sub) {
    if (altarTitle) altarTitle.textContent = title;
    if (altarSub) altarSub.textContent = sub;
  }
  const altarCloseButton = document.getElementById('altar-close');
  const cardBar = document.getElementById('card-bar');
  const cardHint = document.getElementById('card-hint');
  const carryEl = document.getElementById('carry');
  const orbBar = document.getElementById('orb-bar');
  const orbHint = document.getElementById('orb-hint');
  const tilePopover = document.getElementById('tile-popover');
  const musicLoadingEl = document.getElementById('music-loading');
  const crashScreen = document.getElementById('crash-screen');
  const crashReload = document.getElementById('crash-reload');
  if (crashReload) crashReload.addEventListener('click', () => location.reload());
  const tutorialScreen = document.getElementById('tutorial-screen');
  const tutorialTitle = document.getElementById('tutorial-title');
  const tutorialText = document.getElementById('tutorial-text');
  const optionsScreen = document.getElementById('options-screen');
  const optionsStatus = document.getElementById('options-tutorial-status');
  const optionsToggle = document.getElementById('options-toggle-tutorial');
  const optionsSoundToggle = document.getElementById('options-toggle-sound');
  const optionsEdgeScroll = document.getElementById('options-toggle-edgescroll');
  const optionsCharacterButton = document.getElementById('options-character');

  const characterScreen = document.getElementById('character-screen');
  const characterSub = document.getElementById('character-sub');
  const characterBody = document.getElementById('character-body');
  const characterCloseButton = document.getElementById('character-close');

  const confirmScreen = document.getElementById('confirm-screen');
  const confirmTitleEl = document.getElementById('confirm-title');
  const confirmText = document.getElementById('confirm-text');
  const confirmYesButton = document.getElementById('confirm-yes');
  const confirmNoButton = document.getElementById('confirm-no');

  const classScreen = document.getElementById('class-screen');
  const classList = document.getElementById('class-list');
  const classBackButton = document.getElementById('class-back');
  const newGameButton = document.getElementById('new-game');
  const continueButton = document.getElementById('continue-game');
  const titleOptionsButton = document.getElementById('title-options');
  const playAgainButton = document.getElementById('play-again');
  const toTitleButton = document.getElementById('to-title');
  const victoryContinueButton = document.getElementById('victory-continue');
  const victoryAgainButton = document.getElementById('victory-again');
  const victoryTitleButton = document.getElementById('victory-title');
  const optionsCloseButton = document.getElementById('options-close');

  Renderer.init(canvas);

  // Camera pan controls. `edgePan` is the live direction from the mouse hovering
  // near a browser-window edge; the constants tune the pan / zoom feel.
  let edgePan = { x: 0, y: 0 };
  const EDGE_MARGIN = 42; // px from a window edge that starts panning
  const EDGE_PAN_SPEED = 9; // tiles per second while at an edge
  const KEY_PAN_STEP = 1.4; // tiles per arrow-key press
  const WHEEL_ZOOM_STEP = 0.12;
  const KEY_ZOOM_STEP = 0.25;
  // Touch tuning. A one-finger flick STEPS the king (SWIPE_STEP px in a direction = one move); a tap
  // (under TAP_SLOP) acts on the tile; panning/zoom are TWO-finger, so one finger is free to move.
  const TAP_SLOP = 10;      // px — under this a touch is a tap, not a swipe (fingers wobble)
  const SWIPE_STEP = 26;    // px a finger must travel for a flick to register as one king-step
  const PINCH_ZOOM_SCALE = 0.005;
  const LONG_PRESS_MS = 420; // hold this long without moving to inspect a tile (touch has no hover)
  // Is this a touch device? Drives swipe controls and which control hints the tutorial shows.
  const IS_TOUCH = (typeof window !== 'undefined')
    && (('ontouchstart' in window) || (navigator && navigator.maxTouchPoints > 0));
  // Tag the body so CSS can de-crowd the HUD on a phone in ANY orientation. The mobile LAYOUT rules are
  // width-gated (max-width:760px), which a phone held sideways slips past — this class is not.
  if (IS_TOUCH && typeof document !== 'undefined' && document.body) document.body.classList.add('touch');

  // screen: 'title' | 'class' | 'playing' | 'levelup' | 'character' | 'confirm' | 'gameover' | 'victory' | 'tutorial' | 'options'
  let screen = 'title';
  let titleHover = null; // which title option the cursor is over (diegetic menu)
  // The diegetic pre-game scenes (class select + trophy room) share one hovered-id and their own
  // small bits of state, exactly like the title's `titleHover`.
  let sceneHover = null;     // the scene tile/king the cursor is over
  let pickStage = 'class';   // the class-select flow: 'class' then 'difficulty'
  let pickedClass = null;    // the class chosen, awaiting a difficulty
  let trophyPage = 0;        // which "room" of the trophy hall is on screen
  let trophyPages = [[]];    // trophies chunked into rooms of eight (built on open)
  let trophyTotals = { earned: 0, total: 0 };
  // The diegetic title menu: each option is a tile on the board (drawn by the renderer), with the
  // action it fires when clicked. Built fresh each time it is drawn so Continue reflects the save.
  // The one-line "here is where you left off" under the Continue tile.
  function lastRunLine() {
    try {
      const saved = loadSave();
      if (!saved || !saved.player) return null;
      const cls = CLASSES[saved.player.className];
      const who = (typeof playerTitle === 'function' ? playerTitle(saved.player) : (cls && cls.name)) || 'King';
      return `Floor ${toRoman(saved.floor || 1)} · ${who}`;
    } catch {
      return null;
    }
  }

  function titleMenuModel() {
    return {
      title: 'Chess Dungeon',
      subtitle: 'A lone king wanders a hostile board.',
      hover: titleHover,
      save: hasSave() ? lastRunLine() : null,
      options: [
        { id: 'new', icon: 'stair', label: 'New Game', enabled: true, action: openClassSelect },
        { id: 'continue', icon: 'key', label: 'Continue', enabled: hasSave(), action: continueGame },
        { id: 'trophies', icon: 'trophy', label: 'Trophies', enabled: true, action: openTrophies },
        { id: 'options', icon: 'gear', label: 'Options', enabled: true, action: openOptions },
      ],
    };
  }
  // THE DEBUG TILE, appended only when CONFIG.debugMenu is on. It has to live in THIS list rather
  // than in the DOM: the title screen is diegetic — drawn on the board — and the `#title-screen`
  // overlay is hidden the moment the game starts, so a DOM button there is never seen.
  function withDebugOption(model) {
    if (!(typeof CONFIG !== 'undefined' && CONFIG.debugMenu)) return model;
    return {
      ...model,
      options: [...model.options, {
        id: 'debug', icon: 'debug', label: 'Debug: NG+', enabled: true, action: promptDebugWarp,
      }],
    };
  }
  let gameState = null;

  // Card targeting: the index of the card currently awaiting a destination, or
  // null when not aiming. `cardTargets` are the tiles it can reach; `cardCursor`
  // is the keyboard-controlled target square — steered by DIRECTION (see aimCardCursor).
  let cardTargeting = null;
  let cardTargets = [];
  let cardCursor = null;
  // Double Cast: true while the caster is aiming his bonus second shot. Firing it ends the
  // turn normally; cancelling the aim ends the turn too (he declines the extra bolt).
  let awaitingFollowup = false;

  // The enemy turn is resolved one piece at a time so each move animates.
  let enemyQueue = [];
  let animTimer = 0;
  // The portal gate awaiting a yes/no, or null. Stepping through is the one irreversible move in the
  // game, so it is confirmed rather than taken on contact (see openPortalConfirm).
  let pendingPortal = null;
  let pendingAction = null; // null | 'floor' | 'shot' | 'enemyshot' (resolve after the projectile lands)
  let pendingShot = null; // the player state to resolve once a ranged/spell projectile lands
  let pendingEnemyShot = null; // { state, hpBefore } — an ENEMY's volley in flight; its blow lands with it
  let pendingBossKill = null; // the post-capture state to resolve once a felled guardian has DISSOLVED
  let pendingBossKillId = null; // the guardian's id, held through its death SCREAM until the dissolve begins
  const PLAYER_MOVE_TIME = 0.16;
  const ENEMY_MOVE_TIME = 0.16;
  const SHOT_LEAD_TIME = 0.19; // arrow/bolt flies for this long before its hit resolves
  const LEVELUP_LEAD_TIME = 1.5; // beat between a guardian's death fanfare and the boon menu
  const GAMEOVER_LEAD_TIME = 1.2; // beat between the king's death (blood pool + flash) and the death screen
  // A felled guardian dissolves for this long BEFORE the king claims its tile. MUST stay SHORTER than the
  // renderer's DISSOLVE_DUR (0.9s) — that entry has to outlive this hold, or the boss flashes back at full
  // sprite in the gap between "faded out" and "removed from state". The sprite is fully gone by ~0.45s, so
  // 0.62 gives a brief beat of empty tile before the king strides on.
  const BOSS_DISSOLVE_TIME = 0.62;
  const BOSS_SCREAM_LEAD = 0.3; // a felled guardian screams (still standing) for this beat BEFORE it dissolves
  const FLOOR_FADE_OUT = 0.3; // stair descent: the old floor darkens to black over this long...
  const FLOOR_FADE_IN = 0.34; // ...then the new floor rises out of it. Also the 'floor' hold time.
  const PORTAL_FADE_OUT = 0.4; // a portal warps a touch slower and swirlier than a plain stair...
  const PORTAL_FADE_IN = 0.46; // ...and rises back in over this long.
  const FLOOR_TINT = '#000'; // a plain stair sinks to black
  const PORTAL_TINT = '#1b0733'; // a portal sinks to a deep violet instead
  // A coloured curtain over the whole board for a transition between floors/realms: fade the old one
  // out, build the next behind it, fade it back in. `phase` is 'out' (0→1 opaque) then 'in' (1→0 clear);
  // `color` is the tint it sinks to (black for stairs, violet for portals).
  let floorFade = null; // { phase:'out'|'in', t, dur, color } or null when no transition is playing
  function startFloorFade(phase, dur, color) { floorFade = { phase, t: 0, dur, color: color || FLOOR_TINT }; }
  function floorFadeAlpha() {
    if (!floorFade) return 0;
    const k = floorFade.dur > 0 ? Math.min(1, floorFade.t / floorFade.dur) : 1;
    return floorFade.phase === 'out' ? k : 1 - k;
  }

  // Modal bookkeeping: which screen to return to when a tip / options closes.
  let pendingTips = [];
  // Tutorial-FLOOR lesson tips (tutWelcome, tutAttack, …) are "volatile": they always show while the
  // player is on the training grounds — even on a replay — and are never written to the seen-tips
  // record. Everything else is a one-and-done tip that persists. `lastTutSerial` tracks the sign-visit
  // counter game.js bumps each time the king freshly STEPS onto a sign, so a lesson re-shows every
  // time he steps on its sign (and again if he walks off and back), but NOT while he stands on it.
  let volatileTips = new Set();
  let lastTutSerial = 0;
  let screenBeforeModal = 'playing';
  let pendingConfirm = null; // callback to run if the player confirms a yes/no modal

  function isIdle() {
    return screen === 'playing' && animTimer <= 0 && enemyQueue.length === 0 && pendingAction === null && !gameState.gameOver;
  }

  // Whole numbers to Roman numerals (I, II, ... VIII, IX, X, ...) for the floor label.
  function toRoman(n) {
    if (!n || n < 1) return '—';
    const map = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
    let out = '';
    let v = Math.floor(n);
    for (const [val, sym] of map) {
      while (v >= val) { out += sym; v -= val; }
    }
    return out;
  }

  // HP as a row of filled/empty hearts.
  function renderHearts(hp, maxHp) {
    if (!healthLabel) return;
    healthLabel.innerHTML = '';
    for (let i = 0; i < maxHp; i += 1) {
      const h = document.createElement('span');
      h.className = i < hp ? 'heart' : 'heart empty';
      h.textContent = i < hp ? '♥' : '♡';
      healthLabel.append(h);
    }
    healthLabel.title = `HP ${hp}/${maxHp}`;
    // LOW HP alarm: at 3 hearts or fewer the lit hearts BLINK, faster the fewer remain (1 heart ≈ 0.34s,
    // 3 ≈ 0.78s). Off above the threshold and at 0 (nothing left to blink — the death screen takes over).
    const blink = hp > 0 && hp <= 3;
    healthLabel.classList.toggle('blinking', blink);
    if (blink) healthLabel.style.setProperty('--blink', `${(0.12 + hp * 0.22).toFixed(2)}s`);
    else healthLabel.style.removeProperty('--blink');
  }

  // Character level as ONE compact badge ("Lv 3"), not a row of stars. MAXED — once he holds every boon
  // a run can pay out — it burns gold-white with a ✦, so "the next guardian has nothing to teach me" is
  // legible at a glance (the panel used to look identical either way).
  function renderLevelBadges(level, boons) {
    if (!levelLabel) return;
    const maxed = typeof MAX_BOONS === 'number' && (boons || 0) >= MAX_BOONS;
    levelLabel.innerHTML = '';
    const b = document.createElement('span');
    b.className = maxed ? 'badge maxed' : 'badge';
    b.textContent = maxed ? `Lv ${level} ✦` : `Lv ${level}`;
    levelLabel.append(b);
    levelLabel.title = maxed ? `Level ${level} — all ${MAX_BOONS} boons learned` : `Level ${level}`;
  }

  function updateHud() {
    if (!gameState) {
      return;
    }
    const p = gameState.player;
    floorLabel.textContent = `Floor ${toRoman(gameState.floor)} · ${playerTitle(p)}`; // subclass name once committed
    if (floorNameLabel) floorNameLabel.textContent = floorName(gameState.floor, gameState.realm);
    turnLabel.textContent = `Turn ${gameState.turn}${p.promotion > 0 ? ` · ♛ Beast Form ${p.promotion}` : ''}`;
    renderHearts(p.hp, p.maxHp);
    renderLevelBadges(p.level || 1, p.boonsTaken || 0);
    logMessage(gameState.message);

    // Dread rises as the king lingers.
    turnLabel.style.color = scaryColor(Math.min(1, gameState.turn / (gameState.dreadTurns || MAX_TURNS_SCARY)));
    renderCards();
    renderInventory();
  }

  /* ----------------------------- inventory ------------------------------ */
  // What he is CARRYING, as opposed to what he can do. Only the floor key for now — the whole
  // point is that a player can see at a glance whether the stair is going to open for him, without
  // hunting for it in the log. Kept deliberately bare: it is a shelf, not a second row of buttons.
  function renderInventory() {
    // The carried KEY (or the Orb of Victory — the last floor's key in a different hat, key.orb) shown
    // as one small badge INLINE with the stats, not a whole "Carrying" row. So he can see at a glance
    // whether the stair will open without hunting the log. Empty (nothing carried) → hidden by CSS.
    if (carryEl) {
      carryEl.textContent = '';
      carryEl.className = 'carry';
      if (gameState && gameState.key && gameState.key.collected) {
        const orb = gameState.key.orb;
        const realmOrb = (realmDef(gameState.realm).orb) || {};
        carryEl.textContent = orb ? '◉' : '⚷';
        carryEl.classList.add(orb ? 'orb' : 'key');
        carryEl.title = orb
          ? `${realmOrb.name || 'Orb of Victory'} — the portal will open for you`
          : 'Floor key — the stair down is unlocked';
      }
    }
    renderOrbs();
  }

  // THE ORB SHELF. One per realm he has finished, kept for good. Nothing on it does anything — that
  // is deliberate: a realm he was never required to enter can only honestly reward him with the fact
  // of having done it, and a shelf of trophies says that better than a stat would.
  function renderOrbs() {
    if (!orbBar) return;
    orbBar.innerHTML = '';
    if (orbHint) orbHint.classList.add('hidden');
    const won = (gameState && gameState.player && gameState.player.orbs) || [];
    if (!won.length) return;
    // Look each one up by name so the shelf shows its realm's own glyph and colour.
    const byName = {};
    for (const key of Object.keys(REALMS)) {
      const o = REALMS[key].orb;
      if (o) byName[o.name] = o;
    }
    for (const name of won) {
      const o = byName[name] || { glyph: '◉', color: '#fbbf24', short: name };
      const slot = document.createElement('div');
      slot.className = 'inv-slot orb';
      slot.textContent = o.glyph;
      slot.style.color = o.color;
      slot.style.borderColor = o.color;
      slot.title = `${name} — carried out of ${o.short}`;
      orbBar.append(slot);
    }
    if (orbHint) orbHint.classList.remove('hidden');
  }

  /* -------------------------------- log --------------------------------- */

  let lastLogged = null;
  const LOG_MAX = 40; // keep plenty of history so LONG mode has something to scroll through

  // Tint a log line by how the event reads on a good→bad scale, so the player can skim the log by
  // colour: really-good (light blue), good (green), normal (near-white), scary (yellow),
  // bad (red), really-bad (dark red), and unimportant flavour (dim grey).
  function logSeverityColor(text) {
    const t = text.toLowerCase();
    if (/\byou win|victory|orb of victory|level up|a boon|new power|is slain|is defeated|guardian falls|slain!|claims? the (key|orb)|reaches the portal/.test(t)) return '#7dd3fc';
    if (/you have fallen|the king falls|game over|hurled screaming|blasts the king|slams into the king|bowls the king aside|strikes the king|wounds the king|the king is struck|sears the king|erupts under the king/.test(t)) {
      return '#b91c1c'; // really bad — the king is wounded or worse (dark red)
    }
    if (/roars?|awakens|turns hostile|locks onto the king|— move!|floods|lava wells|slump into|pits yawn|ceiling caves|caves in|erupts|killing frost|ice sheets|a wave of|mini-?boss|rogue \w+|claws in|converge|conjures a minion/.test(t)) {
      return '#fde047'; // scary — a fresh threat looms (yellow)
    }
    if (/defeats? a|is destroyed|shatters?|is felled|tramples|you heal|heals? \d|recharge|picks? up|unlock|reload|the beast is|slips past the friendly/.test(t)) {
      return '#4ade80'; // good — the king gains ground (green)
    }
    if (/strikes|blasts|shoves|knocks|clambers|cuts down|leaps upon|bowls|plunges|hurled|blindsides|charges/.test(t)) {
      return '#f87171'; // bad — a foe lands a blow or lunges (red)
    }
    if (/repositions|slips past|pulses|gropes|will not budge|shove in vain|shudders|smoulders|damp chill|breath fogs|stirs?|shadows stir|nothing to/.test(t)) {
      return '#6b7280'; // unimportant flavour (dim grey)
    }
    return '#e5e7eb'; // normal (near-white)
  }

  // Append a message to the left-pane log (newest at the bottom), skipping exact
  // consecutive repeats.
  function logMessage(text) {
    if (!logEl || !text || text === lastLogged) {
      return; // the on-screen log was removed from the UI — messages surface via the board + status line
    }
    lastLogged = text;
    const line = document.createElement('div');
    line.className = 'log-line';
    line.textContent = text;
    line.style.color = logSeverityColor(text);
    logEl.append(line);
    while (logEl.childElementCount > LOG_MAX) {
      logEl.removeChild(logEl.firstChild);
    }
    // Autoscroll to the newest line — but on the NEXT frame, so reading scrollHeight doesn't force a
    // synchronous layout right after the append (a reflow on every log line). Skipped entirely when the
    // log is hidden (offsetParent === null), e.g. the mobile layout where the panel is display:none.
    requestAnimationFrame(() => {
      if (logEl.offsetParent !== null) logEl.scrollTop = logEl.scrollHeight;
    });
  }

  // White -> yellow -> orange -> red -> dark red as `ratio` climbs 0..1.
  function scaryColor(ratio) {
    if (ratio >= 0.95) return '#7f1d1d';
    if (ratio >= 0.7) return '#ef4444';
    if (ratio >= 0.45) return '#fb923c';
    if (ratio >= 0.2) return '#fde047';
    return '#f8fafc';
  }

  /* -------------------------------- cards -------------------------------- */

  // Draw the card bar: one slot per `maxCards`, owned cards first. A ready card is
  // clickable to start aiming; one mid-cooldown shows its countdown.
  // Colors per weapon category (border tint on the card slot).
  const CATEGORY_COLOR = { melee: '#dc2626', ranged: '#65a30d', spell: '#a855f7' };

  // A distinct tint per hostile (danger) event, matching its hazard's colour, so the brief
  // screen-flicker tells the player which one just struck. (Keyed by dangerEvent.kind.)
  const DANGER_TINTS = {
    wave: '#dc2626', // red — a wave of foes
    turrets: '#e0894b', // rust — turrets
    flood: '#38bdf8', // blue — water
    lavaSpread: '#f97316', // orange — lava wells up
    wallsToLava: '#ea580c', // deep orange — walls melt to lava
    pits: '#7c3aed', // violet — the void opens
    freeze: '#7dd3fc', // pale cyan — a killing frost sheets the floor with ice
    devilgrass: '#4ade80', // sickly green — devilgrass chokes the floor
    caveIn: '#b45309', // brown — rubble crashes down
    bossRush: '#e0b341', // gold — a rogue guardian (finale)
    miniBoss: '#b91c1c', // crimson — a mini-boss rises
  };

  function renderCards() {
    cardBar.innerHTML = '';
    if (cardHint) cardHint.classList.add('hidden');
    if (!gameState) {
      return;
    }
    // Owned cards, by HOTKEY SLOT (the 1-based index is the key you press). The hand is sparse — a
    // card may sit on slot 7 with 4-6 empty — so a hole renders as a dimmed placeholder rather than
    // being skipped: collapsing them would put a card under a number that does not fire it.
    gameState.player.cards.forEach((card, i) => {
      cardBar.append(card ? makeCardSlot(card, i) : makeEmptySlot(i));
    });
    const held = gameState.player.cards.filter(Boolean);
    // The caption only shows when he actually HAS a card to press.
    if (cardHint && held.length) cardHint.classList.remove('hidden');
    // NB: no more tip pop-ups in the real game. ALL teaching lives on the tutorial floor now — the
    // main game is kept clear of interruptions (playtest feedback). See buildTutorialFloor.
  }

  // How many turns a card's ONGOING effect still has to run (0 = not currently active). Only cards
  // that cast a timed field of effect qualify — a plain strike has nothing to show here.
  function activeEffectTurns(card) {
    const p = gameState.player;
    if (card.kind === 'silence') return p.silence || 0;
    if (card.kind === 'promotion') return p.promotion || 0;
    return 0;
  }

  // An EMPTY hotkey slot: the number, greyed out, holding the place so the slots you can see line up
  // with the keys you press.
  function makeEmptySlot(i) {
    const slot = document.createElement('div');
    slot.className = 'card-slot empty';
    slot.title = `Slot ${i + 1} — empty`;
    const key = document.createElement('span');
    key.className = 'card-trait';
    key.style.left = '2px';
    key.style.right = 'auto';
    key.textContent = String(i + 1);
    slot.append(key);
    return slot;
  }

  function makeCardSlot(card, i) {
    const cat = classCategory(gameState.player.className);
    const slot = document.createElement('button');
    slot.type = 'button';
    slot.className = 'card-slot';
    // Each ability card wears its subclass colour (the class colour for a starter card).
    const cardColor = card.color || CATEGORY_COLOR[cat] || '#888';
    slot.style.borderColor = cardColor;
    slot.style.color = cardColor;
    slot.textContent = getPieceLabel(card.kind);
    slot.title = `[${i + 1}] ${cat} ${card.kind}`;
    const onCooldown = card.remaining > 0;
    // Charged, but not playable from where he is standing (wading: a weapon needs both hands). Ask
    // the RULE rather than restating it here — cardBlockedReason is what useCard refuses by, so the
    // button cannot come to a different conclusion than the game does.
    const blocked = !onCooldown && typeof cardBlockedReason === 'function' && cardBlockedReason(gameState, card);
    if (cardTargeting === i) {
      slot.classList.add('targeting');
    } else if (onCooldown) {
      slot.classList.add('cooldown');
    } else {
      slot.classList.add('ready');
      // Translucent, not grey: it IS ready, and its glow says so. It just cannot be played here.
      if (blocked) {
        slot.classList.add('unusable');
        slot.title += ` — ${blocked}`;
      }
    }
    // A tiny hotkey number in the corner.
    const key = document.createElement('span');
    key.className = 'card-trait';
    key.style.left = '2px';
    key.style.right = 'auto';
    key.textContent = String(i + 1);
    slot.append(key);
    if (onCooldown) {
      const badge = document.createElement('span');
      badge.className = 'card-cooldown';
      badge.textContent = String(card.remaining);
      slot.append(badge);
    }
    // ACTIVE-EFFECT tell: a card whose effect is still RUNNING (Silence hushing the room, Animal Form
    // held) gets a glowing ring and a small turns-left pip in the TOP-right — deliberately apart from
    // the cooldown number (bottom), so "the spell is working" reads separately from "recharging". A
    // card is usually on cooldown WHILE its effect runs, so the two must be legible at once.
    const active = activeEffectTurns(card);
    if (active > 0) {
      slot.classList.add('active');
      const pip = document.createElement('span');
      pip.className = 'card-active';
      pip.textContent = String(active);
      pip.title = `active — ${active} turn${active === 1 ? '' : 's'} left`;
      slot.append(pip);
    }
    // NB: not the `disabled` attribute — a disabled button suppresses hover, and we want the
    // description to float even while the card recharges. toggleCardTargeting guards the click.
    slot.addEventListener('click', () => toggleCardTargeting(i));
    // Hovering a card floats its brief description + subclass (like the purchase menu).
    slot.addEventListener('mouseenter', (e) => showCardPopover(card, i, e));
    slot.addEventListener('mousemove', (e) => showCardPopover(card, i, e));
    slot.addEventListener('mouseleave', hideTilePopover);
    return slot;
  }


  // Start (or cancel) aiming a card. While aiming, its reachable tiles glow.
  function toggleCardTargeting(index) {
    if (!isIdle()) {
      return;
    }
    if (tutBlocksCard(index)) return; // training floor: only the spotlit ability card answers
    // During a Double-Cast follow-up only the SAME card may re-fire; its hotkey otherwise
    // declines the bonus shot and ends the turn, and other cards are locked out.
    if (awaitingFollowup) {
      if (index === cardTargeting) {
        cancelCardTargeting();
        endFollowupTurn();
      }
      return;
    }
    if (cardTargeting === index) {
      cancelCardTargeting();
      return;
    }
    const card = gameState.player.cards[index];
    if (!card) {
      return;
    }
    // Ability cards (utility: promotion/reload/swap/blink/silence/confuse) vs weapons. Two things key
    // off this: they are exempt from the wading guard below (no weapon to ready), and — clicking one
    // WHILE AIMING another card CANCELS the aim rather than switching to it. Mid-aim, an ability is the
    // "never mind, do this instead" choice; a clean cancel reads better than re-aiming onto a self-cast
    // target. (Weapon cards still switch the aim. Works whether or not the ability is off cooldown.)
    const isAbilityCard = card.kind === 'promotion' || card.kind === 'reload' || card.kind === 'swap' || card.kind === 'blink' || card.kind === 'silence' || card.kind === 'confuse';
    if (cardTargeting !== null && isAbilityCard) {
      cancelCardTargeting();
      gameState.message = 'Aim cancelled.';
      updateHud();
      return;
    }
    if (card.remaining > 0) {
      return;
    }
    const p = gameState.player;
    const underNow = terrainAt(gameState, p.x, p.y);
    // Mirrors cardUnusableReason (game.js): a SPELL is barred in water too, even the "ability" spells.
    if (!(isAbilityCard && classCategory(p.className) !== 'spell') && !p.pathfinder && underNow === 'water') {
      const cardNoun = classCategory(p.className) === 'spell' ? 'spell' : classCategory(p.className) === 'ranged' ? 'bow' : 'weapon';
      gameState.message = `You can't ready a ${cardNoun} while wading through ${underNow}.`;
      updateHud();
      return;
    }
    cardTargeting = index;
    cardTargets = getCardMoves(gameState, card);
    // Entering card-aim CANCELS any far-move in flight — a proposed walk path (the yellow preview) and a
    // running auto-walk both mean "go THERE", the opposite of "aim HERE". Left up, the two targeting
    // modes fought over the board and the next tap; now starting an aim clears the walk outright.
    clearAutoMove();
    clearPathProposal();
    if (!cardTargets.length) {
      gameState.message = 'That card has no target in reach.';
      cancelCardTargeting();
      updateHud();
      return;
    }
    // Order targets clockwise around the king (ties by nearness) so movement keys
    // cycle through them in a predictable ring.
    const kx = gameState.player.x;
    const ky = gameState.player.y;
    cardTargets.sort((a, b) => {
      const angA = Math.atan2(a.y - ky, a.x - kx);
      const angB = Math.atan2(b.y - ky, b.x - kx);
      return angA !== angB ? angA - angB : distToKing(a) - distToKing(b);
    });
    // Snap the cursor to the HIGHEST-VALUE target by default (offensive cards want the best foe, not
    // empty ground or an ice slab). A boss outweighs a common foe outweighs a slab of terrain; a shot
    // that would wash back over the KING scores far below zero, so the aim never DEFAULTS to burning
    // him (fireball). Ties break by nearness, and if nothing is worth hitting it falls to the closest
    // reachable tile — exactly the old behaviour once every value is a wash.
    const scored = cardTargets.map((t) => ({ t, v: aimValue(card, t) }));
    scored.sort((a, b) => (b.v - a.v) || (distToKing(a.t) - distToKing(b.t)));
    const preferred = scored[0].t;
    cardCursor = { x: preferred.x, y: preferred.y };
    // TUTORIAL: snap straight to the tile the lesson wants (the ledge / switch / ice), never a stray
    // foe, so a single Enter or a tap on the glowing tile always solves the puzzle.
    const tg = tutGuide();
    if (tg && tg.phase === 'cardTarget' && tg.tiles.length) cardCursor = { x: tg.tiles[0].x, y: tg.tiles[0].y };
    gameState.message = `Aiming the ${classCategory(gameState.player.className)} ${card.kind} — cycle targets with the numpad/WSAD, then Enter/Space (or press ${index + 1} again) to fire; Esc to cancel.`;
    showCardInfo(card, index);
    updateHud();
  }

  // The card's SUBCLASS name (from its colour): a granted card wears its chain's colour; a
  // starter card wears the plain class colour (no subclass). null when it belongs to no chain.
  function cardSubclass(card) {
    if (!gameState || !card.color) return null;
    const cls = CLASSES[gameState.player.className];
    const chains = (cls && cls.chains) || {};
    for (const name of Object.keys(chains)) {
      if (chains[name] === card.color) return name;
    }
    return null;
  }

  // A BRIEF one-line description of a card (used everywhere but the purchase/level-up menus,
  // which show the full perk text).
  function cardVerb(card) {
    const cat = classCategory(gameState.player.className);
    switch (card.kind) {
      case 'promotion': return 'Self-cast: confirm on your own tile. Free action.';
      case 'reload': return 'Self-cast: confirm on your own tile — recharge every other card.';
      case 'swap': return 'Target any unit in sight to trade places with it; arriving shoves other adjacent foes back a tile. Summoning circles are cut into the floor and cannot be swapped with.';
      case 'enpassant': return 'Step 1 tile; also strikes one foe you pass (marked ✕).';
      case 'doublestep': return 'Dash the FULL 2 tiles in one direction (capturing at the end).';
      case 'horse': return 'A spectral steed tramples an L-shaped path to an aimed knight tile — you don’t move.';
      case 'globe': return 'Aim a direction: a ball of fire is conjured beside you and drifts that way one tile a turn, bursting on the first solid thing it meets.';
      case 'chainlight': return 'Self-cast: confirm on your own tile — a bolt leaps to the nearest foe and arcs through every unit chained to it (you and your allies conduct too).';
      case 'confuse': return 'Self-cast: confirm on your own tile — every foe in sight loses friend from foe.';
      case 'silence': return 'Self-cast: confirm on your own tile — every foe in sight drops asleep. Free action.';
      default:
        return cat === 'melee' ? 'Strikes by moving onto the foe.'
          : cat === 'ranged' ? 'Fires from afar (blocked by cover); you hold your tile.'
          : 'A piercing bolt down a line; aim the far tile, you hold your ground.';
    }
  }

  // The lines describing a card: subclass tag, brief verb, cooldown.
  function cardInfoLines(card) {
    const sub = cardSubclass(card);
    return [sub ? `${sub} subclass` : null, cardVerb(card), `Cooldown ${card.cooldown} turns`].filter(Boolean);
  }

  // Show the card being aimed in the right pane (BRIEF description, not the full piece text), plus a
  // row of hotkey buttons to REBIND it to another slot (1-9) — swapping with whatever holds that slot.
  function showCardInfo(card, index) {
    if (!examineEl) return; // the right-pane ability readout was removed from the UI
    examineEl.innerHTML = '';
    addExamineBlock(`${card.kind} — ${classCategory(gameState.player.className)}`, cardInfoLines(card));
    // REBIND-HOTKEY row DISABLED — the 1-9 slot grid ate too much of a phone screen (a rarely-used
    // convenience). Re-enable by uncommenting; addRebindRow/rebindCard below are kept intact.
    // if (typeof index === 'number') addRebindRow(index);
  }

  // A row of numbered buttons under the aimed card's description: press one to move this card to that
  // hotkey slot. If another card already sits there, the two simply TRADE places, so no slot is ever
  // left empty and the total hand is unchanged.
  function addRebindRow(index) {
    if (!examineEl) return;
    const cards = gameState.player.cards;
    if (!cards) return;
    const block = document.createElement('div');
    block.className = 'examine-block';
    const h = document.createElement('div');
    h.className = 'examine-h';
    h.textContent = 'Rebind hotkey';
    block.append(h);
    const row = document.createElement('div');
    row.className = 'rebind-row';
    // ALL NINE slots, always — not just as many as he happens to be holding. The keyboard has 1-9
    // whether or not there is a card behind each one, and a player who wants his one spell on 5
    // because that is where his finger sits should be able to put it there.
    for (let i = 0; i < MAX_CARD_SLOTS; i += 1) {
      const occupant = cards[i];
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'rebind-key' + (i === index ? ' current' : occupant ? '' : ' vacant');
      b.textContent = String(i + 1);
      b.title = i === index ? 'current slot'
        : occupant ? `move to slot ${i + 1} (swaps with ${occupant.kind})`
        : `move to slot ${i + 1} (empty)`;
      if (i !== index) b.addEventListener('click', () => rebindCard(index, i));
      row.append(b);
    }
    block.append(row);
    examineEl.append(block);
  }

  // Swap the cards in two hotkey slots. Keeps the aim pointed at the SAME card if one is being aimed,
  // so rebinding mid-aim never fires the wrong spell.
  function rebindCard(fromIndex, toIndex) {
    const cards = gameState && gameState.player && gameState.player.cards;
    if (!cards || fromIndex === toIndex || toIndex < 0 || toIndex >= MAX_CARD_SLOTS) return;
    // Moving PAST the end of the hand grows it with empty slots — that is what makes slot 7 reachable
    // while 4-6 sit vacant. Swapping with a vacant slot simply leaves a hole behind, which is the
    // point: the card is where he asked for it, and nothing else shuffled to make room.
    while (cards.length <= toIndex) cards.push(null);
    const tmp = cards[fromIndex];
    cards[fromIndex] = cards[toIndex] || null;
    cards[toIndex] = tmp;
    while (cards.length && !cards[cards.length - 1]) cards.pop(); // no trailing dead slots
    if (cardTargeting === fromIndex) cardTargeting = toIndex;
    else if (cardTargeting === toIndex) cardTargeting = fromIndex;
    renderCards();
    if (cardTargeting !== null) showCardInfo(cards[cardTargeting], cardTargeting); // refresh the panel on the moved card
    saveGame(gameState);
  }

  // Hovering a card slot floats the same brief description (like the purchase menu, minus the
  // full text).
  function showCardPopover(card, i, event) {
    tilePopover.textContent = `[${i + 1}] ${card.kind} — ${classCategory(gameState.player.className)}\n${cardInfoLines(card).join('\n')}`;
    tilePopover.style.left = `${event.clientX + 14}px`;
    tilePopover.style.top = `${event.clientY + 14}px`;
    tilePopover.classList.remove('hidden');
  }

  function distToKing(tile) {
    const dx = tile.x - gameState.player.x;
    const dy = tile.y - gameState.player.y;
    return dx * dx + dy * dy;
  }

  function cancelCardTargeting() {
    cardTargeting = null;
    cardTargets = [];
    cardCursor = null;
  }

  // How much the king WANTS to hit whatever stands on (x,y): a boss is the prize, a common awake foe
  // next, a dozing one or a structure less so; bare ground (or a terrain obstacle like ice/a tree) is
  // worth nothing. Used to pick the best default aim.
  function foeValueAt(x, y) {
    const e = gameState.enemies.find((en) => en.x === x && en.y === y);
    if (!e) return 0;
    if (e.summonCircle) return 4; // shutting a circle is worth something
    if (e.boss) return 20;
    if (e.turret) return 5;
    if (e.awake && !e.asleep) return 10;
    return 6; // a foe that hasn't woken yet
  }

  // The total value of aiming `card` at `tile`: the worth of every foe the cast would actually strike
  // (its whole AoE for a spell, just the tile for a melee/ranged card), MINUS a heavy penalty if the
  // blast would wash back over the king himself (so a fireball never DEFAULTS to burning him) and a
  // smaller one for catching his own allies.
  function aimValue(card, tile) {
    const area = classCategory(gameState.player.className) === 'spell'
      ? (spellAoeTiles(gameState, cardTargeting, tile) || [tile])
      : [tile];
    let v = 0;
    for (const t of area) v += foeValueAt(t.x, t.y);
    if (area.some((t) => t.x === gameState.player.x && t.y === gameState.player.y)) v -= 50; // self-harm: never the default
    if (area.some((t) => (gameState.allies || []).some((a) => a.x === t.x && a.y === t.y))) v -= 8; // burns his own
    return v;
  }

  // The tiles a spell cast at `cursor` would scorch (its whole pierced line), so the aim
  // overlay can highlight them. Ranged/melee cards hit only their target, so return null.
  function spellAoeTiles(state, cardIndex, cursor) {
    const card = state.player.cards[cardIndex];
    if (!card || !cursor) return null;
    if (classCategory(state.player.className) !== 'spell') return null;
    const p = state.player;
    const seeWalls = Boolean(p.seeThroughWalls);
    const inB = (x, y) => x >= 0 && x < WORLD_SIZE && y >= 0 && y < WORLD_SIZE;
    const tiles = [];
    const push = (x, y) => { if (inB(x, y) && !tiles.some((t) => t.x === x && t.y === y)) tiles.push({ x, y }); };

    if (card.kind === 'fireball') {
      // The fireball BURSTS at the first thing that stops it — the first foe on the line, or the first
      // solid obstacle (wall / boulder / ice / tree) — NOT the empty far tile the cursor sits on. The
      // burst is that centre PLUS all eight tiles around it, so the preview must show the whole ring
      // (this is exactly what the resolution does — see fireballCentre + the burst loop).
      const reach = cardReach('fireball', p.cardReach || 0);
      const dx = Math.sign(cursor.x - p.x);
      const dy = Math.sign(cursor.y - p.y);
      let centre = null;
      for (let i = 1; i <= reach; i += 1) {
        const x = p.x + dx * i;
        const y = p.y + dy * i;
        if (!inB(x, y)) break;
        const bt = terrainAt(state, x, y);
        if (state.enemies.some((e) => e.x === x && e.y === y)) { centre = { x, y }; break; }
        if (bt === 'wall' || bt === 'boulder' || bt === 'ice' || bt === 'tree') { centre = { x, y }; break; }
      }
      if (centre) {
        push(centre.x, centre.y);
        for (let ox = -1; ox <= 1; ox += 1) for (let oy = -1; oy <= 1; oy += 1) push(centre.x + ox, centre.y + oy);
      }
    } else if (card.kind === 'horse') {
      // The phantom steed scorches the whole L-path to the aimed knight tile.
      for (const t of knightLPath(p.x, p.y, cursor.x - p.x, cursor.y - p.y, gameState)) push(t.x, t.y);
    } else if (card.kind === 'globe') {
      // Preview the globe's DRIFT: from the tile it spawns on (the aimed neighbour) forward until its
      // path meets something solid, then the burst ring where it would detonate. A snapshot — things move.
      const dx = Math.sign(cursor.x - p.x);
      const dy = Math.sign(cursor.y - p.y);
      let gx = cursor.x;
      let gy = cursor.y;
      push(gx, gy);
      let guard = 0;
      while (guard++ < WORLD_SIZE && typeof globeBlocked === 'function') {
        if (globeBlocked(state, gx + dx, gy + dy)) break;
        gx += dx;
        gy += dy;
        push(gx, gy);
      }
      for (let ox = -1; ox <= 1; ox += 1) for (let oy = -1; oy <= 1; oy += 1) push(gx + ox, gy + oy);
    } else {
      // A piercing bolt ALWAYS travels its full range in the aimed direction — preview every tile
      // it scorches, matching the real bolt: ice ends it (thaws), a wall/boulder stops it (unless
      // Sixth Sense), devilgrass is burned through.
      const reach = cardReach(card.kind, p.cardReach || 0);
      const dx = Math.sign(cursor.x - p.x);
      const dy = Math.sign(cursor.y - p.y);
      let cx = p.x;
      let cy = p.y;
      for (let i = 0; i < reach; i += 1) {
        cx += dx;
        cy += dy;
        if (!inB(cx, cy)) break;
        const bt = terrainAt(state, cx, cy);
        if (bt === 'ice') { push(cx, cy); break; }
        if ((bt === 'wall' || bt === 'boulder') && !seeWalls) { if (bt === 'boulder') push(cx, cy); break; }
        push(cx, cy);
      }
    }
    // Blast (Conjuration) now HURLS surviving foes along the bolt's own line — no extra tiles to
    // preview; the shove happens on the tiles the bolt already lights up.
    return tiles;
  }

  function hideTilePopover() {
    Renderer.markThreats([]); // the cursor is gone — so are the rings
    tilePopover.classList.add('hidden');
    tilePopover.classList.remove('wide'); // reset the class-details widening
  }

  function setExamineEmpty(text) {
    if (!examineEl) return;
    examineEl.innerHTML = '';
    const p = document.createElement('p');
    p.className = 'examine-empty';
    p.textContent = text;
    examineEl.append(p);
  }

  function addExamineBlock(title, lines) {
    if (!examineEl) return;
    const block = document.createElement('div');
    block.className = 'examine-block';
    const h = document.createElement('div');
    h.className = 'examine-h';
    h.textContent = title;
    block.append(h);
    for (const line of [].concat(lines).filter(Boolean)) {
      const row = document.createElement('div');
      row.className = 'examine-line';
      row.textContent = line;
      block.append(row);
    }
    examineEl.append(block);
  }


  // Aim by DIRECTION rather than blind-cycling a ring: a movement key picks the target whose
  // BEARING from the king best matches the way you pushed. Pressing the same way again steps
  // OUTWARD along targets sharing that bearing (a slider's ray), wrapping at the far end. A
  // direction with nothing that way simply doesn't move the cursor.
  //
  // Bearing (not a one-tile walk) is what makes this work for every card: a knight's targets sit on
  // L-tiles and a spell's are only the far ENDPOINTS of each ray, so a cursor that stepped tile by
  // tile could never reach either — every intermediate tile is an invalid target.
  function aimCardCursor(dx, dy) {
    if (cardTargeting === null || !cardTargets.length || !gameState) {
      return;
    }
    // TUTORIAL: the cursor is pinned to the lesson's target tile — don't let a direction key drag it
    // off onto a tile the spotlight isn't even showing.
    const g = tutGuide();
    if (g && g.phase === 'cardTarget') return;
    const kx = gameState.player.x;
    const ky = gameState.player.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const scored = cardTargets
      .map((t) => {
        const ox = t.x - kx;
        const oy = t.y - ky;
        const d = Math.hypot(ox, oy) || 1;
        return { t, dot: (ox / d) * ux + (oy / d) * uy, dist: d };
      })
      .filter((s) => s.dot > 0.35) // roughly that way (within ~70°) — never snap to something behind him
      .sort((a, b) => (b.dot - a.dot) || (a.dist - b.dist));
    if (!scored.length) {
      return; // nothing lies that way — hold the cursor where it is
    }
    // Everything sharing the best bearing forms one ray; repeated presses walk out along it.
    const ray = scored.filter((s) => Math.abs(s.dot - scored[0].dot) < 0.01).sort((a, b) => a.dist - b.dist);
    let pick = ray[0].t;
    if (cardCursor) {
      const at = ray.findIndex((s) => s.t.x === cardCursor.x && s.t.y === cardCursor.y);
      if (at >= 0) pick = ray[(at + 1) % ray.length].t; // already on this ray → step further out
    }
    cardCursor = { x: pick.x, y: pick.y };
    Renderer.centerOn(cardCursor.x, cardCursor.y); // keep the cursor in view
  }

  function confirmCardCursor() {
    if (cardTargeting === null || !cardCursor) {
      return;
    }
    // TUTORIAL: only fire when the cursor sits on the lesson's target tile — never let a misaim waste
    // the one card that opens the barrier. (toggleCardTargeting already snaps the cursor there.)
    const g = tutGuide();
    if (g && g.phase === 'cardTarget' && !g.tiles.some((t) => t.x === cardCursor.x && t.y === cardCursor.y)) return;
    const target = cardTargets.find((t) => t.x === cardCursor.x && t.y === cardCursor.y);
    const index = cardTargeting;
    if (!target) {
      return;
    }
    awaitingFollowup = false; // firing (incl. the bonus shot) resolves normally
    cancelCardTargeting();
    GameAudio.play('cast');
    commitMove(useCard(gameState, index, target.x, target.y));
  }

  // Finish a Double Cast turn the caster is NOT completing with a second shot (he
  // cancelled the aim, or no target remained): put the fired card on cooldown and run
  // the enemy phase.
  function endFollowupTurn() {
    awaitingFollowup = false;
    resolveCommitted(finishFollowup(gameState));
  }

  // Save the current board as a downloadable PNG (F2). Canvas-only — the crisp board makes a clean
  // store-page shot; capture the full window with your OS screenshot tool if you want the HUD too.
  function saveScreenshot() {
    try {
      const link = document.createElement('a');
      link.href = canvas.toDataURL('image/png');
      link.download = `chess-dungeon-${gameState ? 'floor' + gameState.floor + '-' : ''}${Math.floor(performance.now())}.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (e) {
      /* toDataURL can throw if the canvas is tainted; ignore */
    }
  }

  // Restart the HP counter's damage animation. The class is re-added on the NEXT frame, which restarts
  // the CSS animation without the old `void offsetWidth` trick — that read forced a synchronous layout
  // (a reflow) on every single hit. requestAnimationFrame costs nothing and delays the flash one frame.
  function flashHealth() {
    healthLabel.classList.remove('damage');
    requestAnimationFrame(() => healthLabel.classList.add('damage'));
  }

  function applyState(nextState, animate) {
    // A fresh state load (animate === false) — descending a stair, entering a realm/portal, a new game —
    // is NOT a normal step, so cancel any mobile auto-walk; otherwise it would keep chasing the old
    // floor's destination onto the new floor. (Normal moves pass animate === true and keep it running.)
    if (!animate) { clearAutoMove(); clearPathProposal(); }
    gameState = nextState;
    updateHud();
    if (!nextState.gameOver) kingDeathBegun = false; // a living state: re-arm the death throes for next time
    // Drain the action's SOUND CUES. The logic layer names what happened (a door creaked open, a
    // boulder started rolling, something went down a pit); the mixer decides what actually sounds —
    // see the priority/debounce/duck notes in audio.js. Cleared so a cue fires exactly once.
    const cues = nextState.cues;
    if (cues && cues.length) {
      for (const c of cues) GameAudio.play(c);
      nextState.cues = [];
    }
    // Drain the COLLISIONS: anything a shove slammed into something lurches at what it hit, the way
    // the king's own blows lurch. Drained here rather than in landEnemyMove because a shove comes
    // from both sides of the board — an enemy's Bulwark blow AND the king's own Blast/Recoil/
    // Thundering Charge — and this is the one place both of them land.
    if (nextState.shoveBumps && nextState.shoveBumps.length) {
      // A shove wave hurls the OUTERMOST foe first, then the next in, and so on. Stagger the nudges by
      // each foe's distance from the king (the shove's origin) so the eye can FOLLOW the ripple out and
      // read which collision felled what, rather than every token jerking on the same frame.
      const king = nextState.player;
      for (const b of nextState.shoveBumps) {
        const e = nextState.enemies.find((en) => en.id === b.id);
        const d = e ? chebyshev(e.x, e.y, king.x, king.y) : 1;
        Renderer.bumpEnemy(b.id, b.dx, b.dy, Math.max(0, d - 1) * 0.06);
      }
      nextState.shoveBumps = [];
    }
    // Drain SMOKE PUFFS: a Warper/Shadowstep/Burrower leaves smoke where it vanished and where it
    // reappears. Drained here so it fires once, from whichever phase produced it.
    if (nextState.puffs && nextState.puffs.length) {
      for (const pf of nextState.puffs) Renderer.puff(pf.x, pf.y);
      nextState.puffs = [];
    }
    // Drain SCORCH SMOKE: gray puffs left wherever lava or fire seared a unit this turn.
    if (nextState.smoke && nextState.smoke.length) {
      for (const sm of nextState.smoke) Renderer.smoke(sm.x, sm.y);
      nextState.smoke = [];
    }
    // Drain FIRE BURSTS: a molten bloom on every tile a Globe of Fire just detonated across.
    if (nextState.fireBursts && nextState.fireBursts.length) {
      if (Renderer.fireBloom) for (const fb of nextState.fireBursts) Renderer.fireBloom(fb.x, fb.y);
      GameAudio.play('cast');
      nextState.fireBursts = [];
    }
    if (animate) {
      Renderer.sync(nextState);
    } else {
      Renderer.reset(nextState);
    }
    // The KING's pseudo-tutorial line ("I must find the key!" etc.) — the same speech bubble a boss
    // uses, over his own tile, but SILENT (no roar). Drained AFTER sync/reset because a fresh floor load
    // takes the reset path, and Renderer.reset CLEARS the shouts list — draining before it wiped the
    // spawn line (the mid-play reminder survived only because a normal move syncs, not resets). Fires
    // on both a floor load (the spawn line) and mid-play (the reminder a turn after he grabs the key/orb).
    if (nextState.kingShout) {
      Renderer.shout(nextState.player.x, nextState.player.y, nextState.kingShout.text, false);
      nextState.kingShout = null;
    }
  }

  /* ------------------------------ tutorials ------------------------------ */

  // Queue a tip if tips are on and this one hasn't been seen, then show it as
  // soon as no other modal is up. Showing a tip pauses the game.
  function queueTip(id, opts) {
    const isVolatile = Boolean(opts && opts.volatile);
    if (!TUTORIALS[id] || pendingTips.includes(id)) return;
    // Disabling tutorials silences EVERYTHING, tutorial-floor lessons included — so "Disable Tutorial"
    // on a lesson pop-up actually stops the rest. (The floor only ever loads while tutorials are on.)
    if (!tutorialsEnabled()) return;
    // A volatile (tutorial-floor) lesson ignores only the SEEN record, so a replay re-teaches it;
    // a normal one-and-done tip is suppressed once seen.
    if (!isVolatile && tipSeen(id)) return;
    if (isVolatile) volatileTips.add(id);
    pendingTips.push(id);
    showNextTipIfIdle();
  }

  function showNextTipIfIdle() {
    if (screen === 'tutorial' || screen === 'options' || !pendingTips.length) {
      return;
    }
    screenBeforeModal = screen;
    screen = 'tutorial';
    presentTip(pendingTips[0]);
  }

  function presentTip(id) {
    const tip = TUTORIALS[id];
    tutorialTitle.textContent = tip.title;
    // On a touch device, show the mobile control copy (swipe/tap) when a tip provides it — nobody on a
    // phone should be told to "press WASD". Falls back to the normal text when there's no mobile variant.
    tutorialText.textContent = (IS_TOUCH && tip.mobileText) ? tip.mobileText : tip.text;
    tutorialScreen.classList.remove('hidden');
  }

  function dismissTip() {
    const id = pendingTips.shift();
    if (id) {
      if (volatileTips.has(id)) volatileTips.delete(id); // a tutorial lesson tip — never persisted
      else markTipSeen(id);
    }
    if (pendingTips.length) {
      presentTip(pendingTips[0]);
    } else {
      tutorialScreen.classList.add('hidden');
      screen = screenBeforeModal;
    }
  }


  // Queue tips for whatever the king can currently see.
  //
  // DELIBERATELY SPARSE: we only auto-pop tips that teach the CORE LOOP and objective (surprise,
  // danger squares, the guardian, the key→stair unlock, the finale). Per-TERRAIN and per-ENEMY-TYPE
  // tips are NOT auto-shown — they read clearly enough in play, and every tile / unit already carries
  // a full description in the hover EXAMINE panel (which acts as an always-available codex). The tip
  // COPY is kept in tutorials.js so any of these can be re-enabled or surfaced elsewhere later.
  function scanVisibleTips(state) {
    // MINIMAL by design. Everything a player can read on a token or tile lives in the hover EXAMINE
    // panel (an always-available codex). Nothing auto-pops merely from SIGHT any more — the one
    // remaining objective tip (the sealed stair / portal) fires only if the king actually steps onto
    // it while it's locked (see maybeShowLockedExitTip), so a player who beelines the key never sees it.
    //
    // The one exception is the TRAINING GROUNDS, whose whole job is to teach. game.js bumps
    // `tutTipSerial` every time the king freshly STEPS onto a lesson sign; we surface the tip on each
    // bump — so a sign re-teaches every time it's stepped on, the SAME sign included.
    if (state && state.tutorial && state.tutTip && state.tutTipSerial !== lastTutSerial) {
      lastTutSerial = state.tutTipSerial;
      queueTip(state.tutTip, { volatile: true });
    }
  }

  // Once an explainer pop-up; now a no-op. The real game shows NO tutorial pop-ups (all teaching is on
  // the tutorial floor), and a king who steps onto a sealed stair still reads the reason in the log
  // line tryDescend prints ("The stair is sealed — find the floor key first."). Kept as a stub so its
  // callers need no change.
  function maybeShowLockedExitTip() {}

  /* ------------------------------- options ------------------------------- */

  function refreshOptions() {
    const enabled = tutorialsEnabled();
    optionsStatus.textContent = enabled
      ? 'Tutorial is ON — the training grounds play at the start of every new game.'
      : 'Tutorial is OFF.';
    optionsToggle.textContent = enabled ? 'Disable tutorial' : 'Enable tutorial';
    if (optionsSoundToggle) optionsSoundToggle.textContent = GameAudio.isEnabled() ? 'Sound: On' : 'Sound: Off';
    if (optionsEdgeScroll) optionsEdgeScroll.textContent = `Edge scrolling: ${edgeScrollEnabled() ? 'On' : 'Off'}`;
    // The character sheet only exists mid-run.
    if (optionsCharacterButton) optionsCharacterButton.style.display = gameState ? '' : 'none';
  }

  function openOptions() {
    if (screen !== 'playing' && screen !== 'title') {
      return;
    }
    screenBeforeModal = screen;
    screen = 'options';
    refreshOptions();
    optionsScreen.classList.remove('hidden');
  }

  function closeOptions() {
    optionsScreen.classList.add('hidden');
    screen = screenBeforeModal;
  }

  /* ---------------------------- character sheet -------------------------- */

  // Build one titled block (heading + list of rows) for the character sheet.
  function characterBlock(heading, rows) {
    const block = document.createElement('div');
    block.className = 'examine-block';
    const h = document.createElement('div');
    h.className = 'examine-h';
    h.textContent = heading;
    block.append(h);
    rows.forEach((row) => {
      const line = document.createElement('div');
      line.className = 'examine-line';
      if (typeof row === 'string') {
        line.textContent = row;
      } else {
        if (row.color) line.style.color = row.color;
        line.textContent = row.text;
      }
      block.append(line);
    });
    return block;
  }

  function renderCharacter() {
    const p = gameState.player;
    const cls = CLASSES[p.className];
    characterSub.textContent = cls
      ? `${cls.name} — Level ${p.level || 1}`
      : `Level ${p.level || 1}`;
    characterBody.innerHTML = '';

    characterBody.append(characterBlock('Stats', [
      `HP ${p.hp}/${p.maxHp}`,
      `Sight ${p.vision}`,
      `Move ${p.moveRange}`,
    ]));

    const cards = p.cards || [];
    const cat = classCategory(p.className);
    characterBody.append(characterBlock(`Cards (${cards.length}, ${cat})`, cards.length
      ? cards.map((c) => {
          const ready = c.remaining > 0 ? `cooldown ${c.remaining}` : 'ready';
          return { text: `${getPieceLabel(c.kind)}  ${c.kind} — ${cat} (${ready})`, color: c.color || CATEGORY_COLOR[cat] };
        })
      : ['No cards.']));

    const taken = p.takenPerks || [];
    const chainColors = (cls && cls.chains) || {};
    // The INNATE class trait leads the list, tagged so it reads apart from the perks he CHOSE. The
    // character sheet uses each perk's SHORT one-liner (not the full desc) — a scannable list, not a
    // wall of text; the long form is reserved for the level-up/altar screens where you're choosing.
    const perkRows = [];
    if (cls && cls.startPerk) {
      const blurb = cls.startPerk.short || cls.startPerk.desc;
      perkRows.push({ text: `${cls.startPerk.name} (innate) — ${blurb}`, color: cls.color || null });
    }
    if (taken.length && cls) {
      for (const id of taken) {
        const perk = cls.perks.find((k) => k.id === id) || { name: id };
        const blurb = perk.short || perk.desc;
        const text = blurb ? `${perk.name} — ${blurb}` : perk.name;
        perkRows.push({ text, color: chainColors[perk.chain] || null });
      }
    }
    characterBody.append(characterBlock(`Perks (${perkRows.length})`, perkRows.length ? perkRows : ['No perks taken yet.']));
  }

  function openCharacter() {
    if (!gameState) return;
    optionsScreen.classList.add('hidden');
    screen = 'character';
    renderCharacter();
    characterScreen.classList.remove('hidden');
  }

  function closeCharacter() {
    characterScreen.classList.add('hidden');
    screen = 'options';
    optionsScreen.classList.remove('hidden');
  }

  /* --------------------------- screen handling --------------------------- */

  function hideOverlays() {
    titleScreen.classList.add('hidden');
    classScreen.classList.add('hidden');
    gameoverScreen.classList.add('hidden');
    victoryScreen.classList.add('hidden');
    altarScreen.classList.add('hidden');
    tutorialScreen.classList.add('hidden');
    optionsScreen.classList.add('hidden');
    characterScreen.classList.add('hidden');
    if (trophyScreen) trophyScreen.classList.add('hidden');
    if (confirmScreen) confirmScreen.classList.add('hidden');
    pendingConfirm = null;
  }

  // THE TROPHY ROOM, diegetic like the title: the king stands in the middle of a hall, this room's
  // trophies on the walls around him, doorways ‹ › leading to the next room's worth. Build the whole
  // collection into "rooms" of eight — best metal first, then the locked ones as a to-do list.
  const TROPHY_PER_ROOM = 8;
  function buildTrophyPages() {
    let store = {};
    try { store = loadAchievements() || {}; } catch { store = {}; }
    const all = typeof ACHIEVEMENTS !== 'undefined' ? ACHIEVEMENTS : [];
    const rank = { gold: 0, silver: 1, bronze: 2 };
    const list = all.map((a) => ({ id: `t_${a.id}`, name: a.name, tier: store[a.id] || null, desc: a.desc }));
    list.sort((p, q) => (p.tier ? rank[p.tier] : 9) - (q.tier ? rank[q.tier] : 9));
    const pages = [];
    for (let i = 0; i < list.length; i += TROPHY_PER_ROOM) pages.push(list.slice(i, i + TROPHY_PER_ROOM));
    trophyPages = pages.length ? pages : [[]];
    trophyTotals = { earned: list.filter((t) => t.tier).length, total: list.length };
  }

  function trophySceneModel() {
    const pageCount = Math.max(1, trophyPages.length);
    const page = Math.max(0, Math.min(trophyPage, pageCount - 1));
    return {
      hover: sceneHover,
      page,
      pageCount,
      countLine: `${trophyTotals.earned} of ${trophyTotals.total} won · Room ${page + 1} of ${pageCount}`,
      trophies: trophyPages[page] || [],
      hasPrev: page > 0,
      hasNext: page < pageCount - 1,
    };
  }

  // The id of the first (top-left) trophy of the current room, or null if the room is empty.
  function firstTrophyId() {
    const room = trophyPages[trophyPage];
    return room && room[0] ? room[0].id : null;
  }

  function openTrophies() {
    screen = 'trophies';
    gameState = null;
    trophyPage = 0;
    buildTrophyPages();
    sceneHover = firstTrophyId(); // the top-left trophy is highlighted by default
    document.body.classList.remove('in-game');
    document.body.classList.add('on-title');
    hideOverlays(); // the diegetic hall IS the screen — no DOM card
  }

  function pageTrophies(delta) {
    const pageCount = Math.max(1, trophyPages.length);
    trophyPage = Math.max(0, Math.min(pageCount - 1, trophyPage + delta));
    sceneHover = firstTrophyId(); // stepping into a new room lands on its top-left trophy
  }

  function showTitle() {
    screen = 'title';
    gameState = null;
    enemyQueue = [];
    animTimer = 0;
    pendingAction = null;
    pendingTips = [];
    cancelCardTargeting();
    cardBar.innerHTML = '';
    document.body.classList.remove('in-game');
    document.body.classList.add('on-title');
    hideTilePopover();
    hideOverlays();
    titleScreen.classList.add('hidden'); // the diegetic board IS the title now
    titleHover = null;
    canvas.style.cursor = 'default';
    if (logEl) logEl.innerHTML = '';
    lastLogged = null;
  }

  function startGame(state) {
    applyState(state, false);
    enemyQueue = [];
    animTimer = 0;
    pendingAction = null;
    pendingTips = [];
    awaitingFollowup = false;
    cancelCardTargeting();
    setExamineEmpty('Aim an ability to see what it does.');
    screen = 'playing';
    document.body.classList.add('in-game');
    document.body.classList.remove('on-title');
    hideOverlays();
  }

  // The full hover detail for a class: heading, blurb, starting card, then the perk
  // pool the level-up screen draws from.
  function classDetailText(key) {
    const cls = CLASSES[key];
    const lines = [cls.name, cls.blurb, ''];
    lines.push(`• All cards are ${cls.category}; starts with a ${cls.start} card`);
    lines.push(`• Every descent, pick one of two ${cls.name} boons (tiered chains):`);
    cls.perks.forEach((perk) => lines.push(`   – ${perk.name}: ${perk.short || perk.desc}`));
    return lines.join('\n');
  }

  function showClassPopover(key, event) {
    tilePopover.textContent = classDetailText(key);
    tilePopover.classList.add('wide');
    tilePopover.style.left = `${event.clientX + 16}px`;
    tilePopover.style.top = `${event.clientY + 16}px`;
    tilePopover.classList.remove('hidden');
  }

  function hideClassPopover() {
    tilePopover.classList.remove('wide');
    hideTilePopover();
  }

  // Open the class-select screen (the "New Game" entry point). Each row shows a
  // brief description; hovering reveals full details (kit + each perk).
  // '#rrggbb' + an alpha 0..1 -> 'rgba(r,g,b,a)', for canvas glows.
  function hexAlpha(hex, a) {
    const h = (hex || '#888').replace('#', '');
    const r = parseInt(h.slice(0, 2), 16) || 0;
    const g = parseInt(h.slice(2, 4), 16) || 0;
    const b = parseInt(h.slice(4, 6), 16) || 0;
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }

  // Dark ink on a light colour, light ink on a dark one — the same choice the in-game king token
  // makes for its glyph, so the emblem reads the same way the piece will.
  function inkFor(hex) {
    const h = (hex || '#888').replace('#', '');
    const r = parseInt(h.slice(0, 2), 16) || 0;
    const g = parseInt(h.slice(2, 4), 16) || 0;
    const b = parseInt(h.slice(4, 6), 16) || 0;
    return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? '#17171d' : '#faf6e9';
  }

  // A small canvas showing HOW THIS CLASS LOOKS: the king token in the class colour, on a soft glow
  // of that same colour — the exact token the player will command, so the three of them read apart
  // at a glance. The starting-piece glyph rides in the corner as a hint at the kit.
  // Append U+FE0E so these chess glyphs render as monochrome TEXT, never a colour-emoji substitute on
  // mobile (same reason as renderer.pieceGlyph — the king emblem looked wrong on phones otherwise).
  const VS_TEXT = String.fromCharCode(0xFE0E);
  const PIECE_GLYPH = { knight: '♞' + VS_TEXT, bishop: '♝' + VS_TEXT, rook: '♜' + VS_TEXT, king: '♚' + VS_TEXT };
  function classEmblem(cls) {
    const el = document.createElement('canvas');
    const S = 88;
    el.width = S; el.height = S;
    el.className = 'class-emblem';
    const g = el.getContext('2d');
    const cx = S / 2;
    const cy = S / 2;
    const r = S * 0.3;
    // The glow.
    const glow = g.createRadialGradient(cx, cy, r * 0.4, cx, cy, r * 1.7);
    glow.addColorStop(0, hexAlpha(cls.color, 0.5));
    glow.addColorStop(1, hexAlpha(cls.color, 0));
    g.fillStyle = glow;
    g.beginPath();
    g.arc(cx, cy, r * 1.7, 0, Math.PI * 2);
    g.fill();
    // The token: class-coloured disc, cream ring.
    g.fillStyle = cls.color;
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#faf6e9';
    g.lineWidth = Math.max(2, S * 0.03);
    g.stroke();
    // The king glyph, in contrasting ink.
    g.fillStyle = inkFor(cls.color);
    g.font = `${Math.round(r * 1.5)}px "Segoe UI Symbol", serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(PIECE_GLYPH.king, cx, cy + r * 0.08);
    // The starting piece as a small corner chip — a nod to the class's opening weapon.
    const bs = S * 0.28;
    const bx = S - bs * 0.62;
    const by = S - bs * 0.62;
    g.fillStyle = 'rgba(2, 6, 23, 0.85)';
    g.beginPath();
    g.arc(bx, by, bs * 0.5, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = cls.color;
    g.lineWidth = Math.max(1.5, S * 0.02);
    g.stroke();
    g.fillStyle = '#f1e5c8';
    g.font = `${Math.round(bs * 0.7)}px "Segoe UI Symbol", serif`;
    g.fillText(PIECE_GLYPH[cls.start] || '♟', bx, by + bs * 0.06);
    return el;
  }

  // CHARACTER CREATION, diegetic like the title: three kings stand on the board and you pick one,
  // then the same for the difficulty. No DOM card — just the scene, drawn each frame from this model.
  const DIFF_MEDAL = { easy: 'bronze', hard: 'silver', nightmare: 'gold' };
  function classPickModel() {
    if (pickStage === 'difficulty') {
      const cls = CLASSES[pickedClass] || {};
      return {
        title: 'Choose your trial',
        subtitle: `${cls.name || 'The king'} — how thick is your skin?`,
        hover: sceneHover,
        choices: DIFFICULTIES.map((d) => {
          const hp = (DIFFICULTY_HP[d.key] || {})[pickedClass];
          return {
            id: d.key,
            color: d.color,
            label: d.name + (d.recommended ? ' ★' : ''),
            sublabel: `${hp ? `${hp} HP` : ''} · ${DIFF_MEDAL[d.key] || ''} badges`,
            desc: d.blurb + (d.recommended ? ' (Recommended)' : ''),
          };
        }),
      };
    }
    return {
      title: 'Choose your calling',
      subtitle: 'A lone king wanders a hostile board — which king are you?',
      hover: sceneHover,
      choices: Object.keys(CLASSES).map((k) => {
        const c = CLASSES[k];
        return {
          id: k,
          color: c.color,
          label: c.name,
          sublabel: `${PIECE_GLYPH[c.start] || '♟'} ${c.start} opener`,
          desc: c.blurb,
        };
      }),
    };
  }

  // The "New Game" entry point (title, options, Play Again, victory). Gated: if a run is still saved,
  // confirm before it's wiped. Once confirmed, enterClassSelect actually opens the picker.
  function openClassSelect() {
    confirmNewGame(enterClassSelect);
  }
  function enterClassSelect() {
    screen = 'class';
    // Always the clean title-style board behind the scene, whether we arrived from the title or from
    // Play Again after a run — otherwise a dead final board (and the game panes) would show through.
    gameState = null;
    pickStage = 'class';
    pickedClass = null;
    sceneHover = null;
    document.body.classList.remove('in-game');
    document.body.classList.add('on-title');
    hideOverlays(); // the diegetic scene IS the screen now — no DOM card
  }

  // After the class, pick a difficulty for the run (reuses the class-select screen).
  // Difficulty is ONE dial: starting HP. The dungeon itself — spawns, dread clock, foes — is
  // identical at every setting. Achievements badge bronze / silver / gold for easy / hard / nightmare.
  const DIFFICULTIES = [
    { key: 'easy', name: 'Easy', color: '#4ade80', blurb: 'A forgiving descent — the thickest skin. Badges earn BRONZE.' },
    { key: 'hard', name: 'Hard', color: '#fbbf24', blurb: 'The standard trial. Badges earn SILVER.', recommended: true },
    { key: 'nightmare', name: 'Nightmare', color: '#ef4444', blurb: 'The same dungeon, met with a thin skin. Badges earn GOLD.' },
  ];
  // The difficulty as an emblem: a heart in the difficulty's colour with the starting HP inside it.
  // Difficulty is only ever "how thick your skin is", so a heart carrying the number says it plainly.
  function difficultyEmblem(diff, hp) {
    const el = document.createElement('canvas');
    const S = 88;
    el.width = S; el.height = S;
    el.className = 'class-emblem';
    const g = el.getContext('2d');
    const cx = S / 2;
    const cy = S * 0.46;
    const r = S * 0.3;
    const glow = g.createRadialGradient(cx, cy, r * 0.3, cx, cy, r * 1.7);
    glow.addColorStop(0, hexAlpha(diff.color, 0.5));
    glow.addColorStop(1, hexAlpha(diff.color, 0));
    g.fillStyle = glow;
    g.beginPath();
    g.arc(cx, cy, r * 1.7, 0, Math.PI * 2);
    g.fill();
    // A heart in the difficulty colour.
    g.fillStyle = diff.color;
    g.beginPath();
    const t = r * 1.15;
    g.moveTo(cx, cy + t * 0.5);
    g.bezierCurveTo(cx - t, cy - t * 0.25, cx - t * 0.5, cy - t * 0.75, cx, cy - t * 0.3);
    g.bezierCurveTo(cx + t * 0.5, cy - t * 0.75, cx + t, cy - t * 0.25, cx, cy + t * 0.5);
    g.fill();
    // The starting HP, stamped into it.
    g.fillStyle = inkFor(diff.color);
    g.font = `700 ${Math.round(r * 0.95)}px "Segoe UI", sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    if (hp) g.fillText(String(hp), cx, cy - r * 0.05);
    return el;
  }

  function openDifficultySelect(classKey) {
    screen = 'class';
    classScreen.classList.remove('hidden');
    classList.innerHTML = '';
    let defaultBtn = null;
    for (const diff of DIFFICULTIES) {
      const row = document.createElement('li');
      row.className = 'shop-item class-item';
      if (diff.recommended) row.style.outline = `2px solid ${diff.color}`; // Hard is the highlighted default
      const info = document.createElement('div');
      info.className = 'shop-info';
      const hp = (DIFFICULTY_HP[diff.key] || {})[classKey];
      info.innerHTML =
        `<span class="shop-name" style="color:${diff.color}">${diff.name}${diff.recommended ? ' ★' : ''}` +
        `${hp ? ` — ${hp} HP` : ''}</span>` +
        `<span class="shop-desc">${diff.blurb}${diff.recommended ? ' (Recommended)' : ''}</span>`;
      const pick = document.createElement('button');
      pick.type = 'button';
      pick.textContent = 'Begin';
      pick.addEventListener('click', () => newGame(classKey, diff.key));
      row.append(difficultyEmblem(diff, hp), info, pick);
      classList.append(row);
      if (diff.recommended) defaultBtn = pick;
    }
    if (defaultBtn) defaultBtn.focus(); // pressing Enter starts a Hard run
  }

  function newGame(classKey, difficulty) {
    const cls = classKey || 'warrior';
    const diff = difficulty || 'hard';
    // NB: no `resetSeenTips()` any more. It used to replay EVERY tip on every new game, which is the
    // "tutorial popup spam" — a one-and-done tip should stay done. Tips now persist for good; the
    // training grounds carry their own always-on lesson tips instead (volatile, see queueTip).
    //
    // THE TRAINING GROUNDS load on EVERY new game while the tutorial is on — the player is never told
    // "you already did this". The only way out is the in-floor skip portal, which turns the tutorial
    // off for good (see commitMove). Re-enable it any time from Options.
    if (tutorialsEnabled() && typeof buildTutorialFloor === 'function') {
      lastTutSerial = 0;
      startGame(buildTutorialFloor(cls, diff));
      saveGame(gameState);
      scanVisibleTips(gameState); // surfaces the welcome lesson
      return;
    }
    // Straight into the run — no welcome pop-up. A player who has the tutorial off (or skipped it)
    // has opted out of hand-holding; the real game stays free of interruptions.
    startGame(createInitialState(cls, diff));
    saveGame(gameState);
  }

  function continueGame() {
    const saved = loadSave();
    if (saved) {
      updateDiscovery(saved); // dispel fog around the king (also migrates old saves)
      startGame(saved);
      scanVisibleTips(gameState);
    } else {
      newGame();
    }
  }

  function goNextFloor() {
    // LEAVING THE TRAINING GROUNDS (by stair or skip portal) drops him into the REAL first floor as a
    // pristine king — not floor 2. Otherwise, the boon was already earned by slaying the boss;
    // descending just builds the next floor (no level-up screen here).
    if (gameState && gameState.tutorial) {
      lastTutSerial = 0;
      applyState(leaveTutorial(gameState), false);
    } else {
      applyState(nextFloor(gameState), false);
    }
    enemyQueue = [];
    animTimer = 0;
    pendingAction = null;
    startFloorFade('in', FLOOR_FADE_IN); // the new floor rises out of the black
    saveGame(gameState);
    scanVisibleTips(gameState);
  }

  // Slaying a boss queues the level-up mid-floor; open the screen once the turn has
  // fully resolved (the king then chooses a boon and walks to the now-open stair).
  function maybeOpenLevelUp() {
    if (gameState && screen === 'playing' && gameState.pendingLevelUp && (gameState.levelPerks || []).length) {
      // A guardian has fallen: blare a triumphant FANFARE, hold the player still for a beat (a little
      // victory pause), THEN raise the boon menu. The pending action freezes input meanwhile.
      if (pendingAction !== 'levelup') {
        GameAudio.play('fanfare');
        Renderer.effect('key'); // a bright gold flash to punctuate the kill
        pendingAction = 'levelup';
        animTimer = LEVELUP_LEAD_TIME;
      }
      return true;
    }
    if (gameState && gameState.pendingLevelUp && !(gameState.levelPerks || []).length) {
      gameState.pendingLevelUp = false; // nothing left to offer (deep NG+)
    }
    return false;
  }

  // Compose the end-of-run summary (score + earned conducts) into the given node.
  function fillRunSummary(statsEl) {
    const score = finalScore(gameState);
    const conducts = earnedConducts(gameState.player);
    statsEl.innerHTML = '';
    const line = document.createElement('p');
    line.className = 'overlay-sub';
    line.textContent = `Reached floor ${gameState.floor} in ${gameState.player.totalTurns} turns · Score ${score}`;
    statsEl.append(line);
    if (conducts.length) {
      const heading = document.createElement('p');
      heading.className = 'overlay-sub';
      heading.textContent = 'Conducts honoured:';
      statsEl.append(heading);
      const list = document.createElement('ul');
      list.className = 'conduct-list';
      for (const c of conducts) {
        const li = document.createElement('li');
        li.textContent = `${c.name} — ${c.desc}`;
        list.append(li);
      }
      statsEl.append(list);
    }
  }

  // Compact date label for the run table (e.g. "Jun 30").
  function shortDate(ts) {
    try {
      return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    } catch {
      return '';
    }
  }

  // Build one labelled scores table (a heading plus rows). Highlights the row
  // whose id matches `highlightId` (the run that just finished).
  function buildScoreTable(heading, rows, highlightId) {
    const wrap = document.createElement('div');
    wrap.className = 'score-block';
    const h = document.createElement('p');
    h.className = 'score-heading';
    h.textContent = heading;
    wrap.append(h);

    const table = document.createElement('table');
    table.className = 'score-table';
    table.innerHTML = '<thead><tr><th>#</th><th>Score</th><th>Floor</th><th>Turns</th></tr></thead>';
    const body = document.createElement('tbody');
    rows.forEach((run, i) => {
      const tr = document.createElement('tr');
      if (run.id && run.id === highlightId) {
        tr.className = 'score-row-current';
      }
      const mark = run.won ? ' ♚' : '';
      tr.innerHTML =
        `<td>${i + 1}</td>` +
        `<td>${run.score}${mark}</td>` +
        `<td>${run.floor}</td>` +
        `<td>${run.turns}</td>` +
        `<td class="score-date">${shortDate(run.date)}</td>`;
      body.append(tr);
    });
    table.append(body);
    wrap.append(table);
    return wrap;
  }

  // Render the persistent run history into a container: best runs of all time,
  // and the most recent runs. `highlightId` flags the just-finished run.
  function renderRunTable(container, highlightId) {
    if (!container) {
      return;
    }
    container.innerHTML = '';
    const scores = readRunScores();
    if (!scores.length) {
      const empty = document.createElement('p');
      empty.className = 'score-empty';
      empty.textContent = 'No runs yet — descend and make your mark.';
      container.append(empty);
      return;
    }
    const best = scores.slice().sort((a, b) => b.score - a.score).slice(0, 5);
    const recent = scores.slice(0, 5); // stored newest-first already
    container.append(buildScoreTable('Best runs', best, highlightId));
    container.append(buildScoreTable('Recent runs', recent, highlightId));
  }

  // Bank the run's badges and show them on the run-end screen. Freshly-won / upgraded plaques glow;
  // ones already in the case sit muted so the shelf still reads as a record of the run.
  // One badge chip: a struck medallion in the badge's own metal beside its name. `tier` null means
  // still locked. Shared by the run summary and the trophy room so the two can never drift apart.
  function badgeChip(a, tier, note, extraClass) {
    const el = document.createElement('div');
    el.className = `ach-badge ${extraClass}`;
    el.style.color = tier ? (ACH_TIER_COLOR[tier] || '#cbd5e1') : '#64748b';
    el.innerHTML =
      `<span class="badge-medal" aria-hidden="true">${tier ? '★' : '🔒'}</span>`
      + '<span class="badge-text">'
      + `<span class="badge-name">${a.name}</span>`
      + `<span class="badge-tier">${tier ? ACH_TIER_LABEL[tier] || tier : 'Locked'}${note || ''}</span>`
      + `<span class="badge-desc">${a.desc}</span>`
      + '</span>';
    return el;
  }

  function renderBadges(container, won) {
    if (!container) {
      return;
    }
    container.innerHTML = '';
    let earned = [];
    try {
      earned = recordRun(gameState, won) || [];
    } catch {
      earned = [];
    }
    if (!earned.length) {
      return;
    }
    const fresh = earned.filter((a) => a.fresh || a.upgraded);
    const held = earned.filter((a) => !a.fresh && !a.upgraded);
    const head = document.createElement('p');
    head.className = 'overlay-sub';
    head.textContent = fresh.length
      ? `${fresh.length} badge${fresh.length > 1 ? 's' : ''} earned!`
      : 'No new badges this run.';
    container.append(head);
    for (const a of [...fresh, ...held]) {
      const note = a.upgraded ? ' — upgraded!' : a.fresh ? ' — new!' : '';
      container.append(badgeChip(a, a.tier, note, a.fresh || a.upgraded ? 'badge-new' : 'badge-old'));
    }
  }

  // The king's DEATH THROES — fired once at the moment the run is lost, during the GAMEOVER_LEAD_TIME
  // beat before the death screen drops: he DISSOLVES like a felled guardian (over the blood pool he
  // left, game.js checkDeath) and grunts his last. `kingDeathBegun` guards against a death caught by two
  // paths in one frame stacking two dissolves; it is cleared whenever a living state is applied.
  const DEATH_CRIES = ['Guh!', 'Oof!', 'Argh!', 'Nngh!', 'Gah!', 'Ackh!'];
  let kingDeathBegun = false;
  function beginKingDeath() {
    if (kingDeathBegun || !gameState) return;
    kingDeathBegun = true;
    if (Renderer.dissolveKing) {
      const col = (typeof CLASSES !== 'undefined' && CLASSES[gameState.player.className]) ? CLASSES[gameState.player.className].color : null;
      Renderer.dissolveKing(col, GAMEOVER_LEAD_TIME); // size the fade to outlast the pre-screen hold
    }
    Renderer.shout(gameState.player.x, gameState.player.y, DEATH_CRIES[Math.floor(Math.random() * DEATH_CRIES.length)], false);
  }

  function onGameOver() {
    // DYING ON THE TRAINING GROUNDS costs nothing — it is a place to make mistakes. Rebuild the floor
    // and wake the king back at the start rather than ending the run.
    if (gameState && gameState.tutorial) {
      const cls = gameState.player.className;
      const diff = gameState.player.difficulty;
      startGame(buildTutorialFloor(cls, diff));
      // Wake him NEXT TO the welcome sign, not ON it — so the move lesson does not pop up again on
      // every death — and greet him with a speech bubble, the way a boss taunts.
      gameState.player.x += 1; // one step east, onto the path, off the sign tile
      gameState.tutOnSign = null;
      lastTutSerial = gameState.tutTipSerial; // suppress the auto-tip this respawn
      logMessage('You fell in the training grounds — back to the start. Nothing lost.');
      Renderer.centerOn(gameState.player.x, gameState.player.y);
      Renderer.shout(gameState.player.x, gameState.player.y, "Let's try that again", false);
      saveGame(gameState);
      return;
    }
    screen = 'gameover';
    document.body.classList.remove('in-game');
    hideTilePopover();
    clearSave();
    const entry = recordRunScore({
      score: finalScore(gameState),
      floor: gameState.floor,
      turns: gameState.player.totalTurns,
      won: false,
    });
    fillRunSummary(gameoverStats);
    renderBadges(gameoverBadges, false);
    renderRunTable(gameoverRunTable, entry.id);
    hideOverlays();
    gameoverScreen.classList.remove('hidden');
  }

  function onVictory() {
    screen = 'victory';
    document.body.classList.remove('in-game');
    hideTilePopover();
    clearSave();
    const score = finalScore(gameState);
    const entry = recordRunScore({
      score,
      floor: gameState.floor,
      turns: gameState.player.totalTurns,
      won: true,
    });
    victoryStats.textContent = `Reached floor ${gameState.floor} in ${gameState.player.totalTurns} turns · Score ${score}`;
    renderBadges(victoryBadges, true);
    renderRunTable(victoryRunTable, entry.id);
    hideOverlays();
    victoryScreen.classList.remove('hidden');
    // NEW GAME+ : the door onward, and only after the hardest clear.
    if (victoryContinueButton) victoryContinueButton.classList.toggle('hidden', !newGamePlusUnlocked());
  }

  // New Game + : having won, press on into the endless depths, build intact.
  // DISABLED for now — its button is commented out in index.html and the listener below is too. The
  // function is kept intact so restoring the mode is just un-commenting those three places.
  // NEW GAME+ : having won on NIGHTMARE, press on — not into a floor 9, but into the room BETWEEN
  // realms, where he chooses which worse place to walk into next (or takes the win and stops).
  // Nightmare only, on purpose: this is the reward for the hardest clear, not for any clear.
  function continueAfterVictory() {
    if (!newGamePlusUnlocked()) return; // belt-and-braces: the button is hidden, but never act if the door is shut
    screen = 'playing';
    gameState.won = false;
    document.body.classList.add('in-game');
    document.body.classList.remove('on-title');
    hideOverlays();
    applyState(buildPortalRoom(gameState.player, gameState.score || 0, gameState.player.clearedRealms), false);
    enemyQueue = [];
    animTimer = 0;
    pendingAction = null;
    saveGame(gameState);
  }
  // DEBUG ONLY (CONFIG.debugMenu — see src/config.js). Skip the nightmare run and stand in the room
  // between realms at once, as a finished king of the chosen class.
  //
  // Deliberately built on the SAME path a real arrival takes (`applyState` + `saveGame`), so a debug
  // session behaves like a real one in every respect that matters for testing: the save is real, the
  // camera settles the same way, and the portal gates read the same player object.
  function debugToPortalRoom(className, difficulty) {
    if (!(typeof CONFIG !== 'undefined' && CONFIG.debugMenu)) return; // belt as well as braces
    screen = 'playing';
    document.body.classList.add('in-game');
    document.body.classList.remove('on-title');
    hideOverlays();
    applyState(debugPortalRoom(className, difficulty), false);
    enemyQueue = [];
    animTimer = 0;
    pendingAction = null;
    saveGame(gameState);
  }

  // The debug tile's action: ask for a class, then a difficulty, then warp. Plain prompts on
  // purpose — this is a door that must not ship, and styling it would be effort spent on something
  // destined for deletion.
  function promptDebugWarp() {
    const keys = Object.keys(CLASSES);
    const menu = keys.map((k, i) => `${i + 1}. ${CLASSES[k].name}`).join('\n');
    const pick = window.prompt(`DEBUG — warp to the portal room as:\n${menu}\n\nEnter a number:`, '1');
    if (pick === null) return;
    const idx = Number.parseInt(pick, 10) - 1;
    const className = keys[Number.isFinite(idx) && idx >= 0 && idx < keys.length ? idx : 0];
    // Difficulty matters as much as class: it sets his hearts, and a realm that is a fair fight at
    // 12 HP is a different level at 5.
    const diffs = ['easy', 'hard', 'nightmare'];
    const dMenu = diffs.map((d, i) => `${i + 1}. ${d}`).join('\n');
    const dPick = window.prompt(`DEBUG — at which difficulty?\n${dMenu}\n\nEnter a number:`, '3');
    if (dPick === null) return;
    const dIdx = Number.parseInt(dPick, 10) - 1;
    const difficulty = diffs[Number.isFinite(dIdx) && dIdx >= 0 && dIdx < diffs.length ? dIdx : 2];
    debugToPortalRoom(className, difficulty);
  }

  // Whether that door is open to him at all.
  //
  // ANY difficulty. It used to require a NIGHTMARE clear, on the reasoning that the hardest win
  // should earn the extra content — but that got it backwards: it locked three whole realms behind
  // the one setting the fewest players finish, so the reward for the hardest thing in the game was
  // the only way to see most of the game. Beating the dungeon is the achievement; New Game+ is where
  // you go next, and it is difficulty-agnostic because the realms carry their own difficulty with
  // them. (The MEDALS still differ by setting — that is where the nightmare bragging rights live.)
  function newGamePlusUnlocked() {
    // Gated by the build switch (see src/config.js). With it off, the victory screen's "Continue"
    // button stays hidden and the run simply ends — no route to the portal room or its NG+ realms.
    if (!(typeof CONFIG !== 'undefined' && CONFIG.newGamePlus)) return false;
    return Boolean(gameState && gameState.player);
  }

  /* ------------------------------ level up ------------------------------- */

  // After each descent, choose one of two class boons (reusing the altar overlay).
  function renderLevelUp() {
    setOverlayHeading('Level Up', 'Choose one boon for your class.');
    if (altarMessage) altarMessage.textContent = `Level ${gameState.player.level} — choose a boon.`;
    altarList.innerHTML = '';
    const perks = gameState.levelPerks || rollLevelPerks(gameState.player, 3);
    const cls = CLASSES[gameState.player.className];
    const chainColors = (cls && cls.chains) || {};
    for (const perk of perks) {
      const row = document.createElement('li');
      row.className = 'shop-item';
      const info = document.createElement('div');
      info.className = 'shop-info';
      const chainColor = chainColors[perk.chain];
      const nameStyle = chainColor ? ` style="color:${chainColor}"` : '';
      const chainTag = perk.chain ? `<span class="shop-desc"${nameStyle}>${perk.chain}</span>` : '';
      info.innerHTML = `<span class="shop-name"${nameStyle}>${perk.name}</span>${chainTag}<span class="shop-desc">${perk.short || perk.desc}</span>`;
      const take = document.createElement('button');
      take.type = 'button';
      take.textContent = 'Take';
      take.addEventListener('click', () => {
        applyState(learnPerk(gameState, perk.id), false);
        // Flash the colour of the subclass this perk belongs to (its class colour if the
        // chain has none), rather than a fixed green.
        Renderer.effect('powerup', chainColor || (cls && cls.color));
        GameAudio.play('buy');
        closeLevelUp();
      });
      row.append(info, take);
      altarList.append(row);
    }
  }

  // THE ALTAR. Reuses the boon overlay, because it is the same shape of moment — a short list, one
  // choice, and (unlike a level-up) a Skip that is always the safe answer. Every row here COSTS him
  // something, so the wording leads with what is given up rather than what is gained.
  function renderAltar() {
    setOverlayHeading('The Altar', 'A bargain, named before you pay it.');
    if (altarMessage) altarMessage.textContent = 'An altar. It names its price — or you may walk away.';
    altarList.innerHTML = '';
    // The offers were rolled the moment he stepped on it and are held on the state, so what is on
    // screen is exactly what he gets. Naming both ends is the whole point: this is a decision about
    // the build he is holding, not a coin-flip with flavour text on it.
    (gameState.altarOffers || []).forEach((offer, i) => {
      const row = document.createElement('li');
      row.className = 'shop-item';
      const info = document.createElement('div');
      info.className = 'shop-info';
      info.innerHTML = `<span class="shop-name" style="color:#e879f9">${offer.name}</span>`
        + `<span class="shop-desc">${offer.desc}</span>`;
      const take = document.createElement('button');
      take.type = 'button';
      take.textContent = 'Offer';
      take.addEventListener('click', () => {
        applyState(useAltar(gameState, i), false);
        Renderer.effect('powerup', '#e879f9');
        GameAudio.play('buy');
        closeAltar();
      });
      row.append(info, take);
      altarList.append(row);
    });
  }
  // STEPPING THROUGH A PORTAL IS NOT UNDOABLE, so it asks first. Every other irreversible thing in
  // this room already does — the altar names its price before he pays it — and a door that swallows
  // him the instant he brushes it is the one interaction here that could be an accident. Reuses the
  // altar overlay wholesale: same list, same Skip button, and "walk away" simply leaves him standing
  // on the portal, exactly as walking away from an altar leaves him standing on that.
  function renderPortalConfirm() {
    const gate = pendingPortal;
    if (!gate) return;
    const going = gate.accept ? 'end your run here' : portalRealmName(gate.realm);
    setOverlayHeading(
      gate.accept ? 'The Way Home' : portalRealmName(gate.realm),
      gate.accept ? 'Step through and the run is over.' : 'A door standing open. Step through?',
    );
    if (altarMessage) {
      altarMessage.textContent = gate.accept
        ? 'The way home. Step through and the run is over — everything you have won is yours to keep.'
        : `${going}. Step through, and there is no coming back until it is cleared.`;
    }
    altarList.innerHTML = '';
    const row = document.createElement('li');
    row.className = 'shop-item';
    const info = document.createElement('div');
    info.className = 'shop-info';
    const color = gate.accept ? '#fbbf24' : portalRealmColor(gate.realm);
    info.innerHTML = `<span class="shop-name" style="color:${color}">${gate.accept ? 'End the run' : `Enter ${going}`}</span>`
      + `<span class="shop-desc">${gate.accept
        ? 'Close the book. Your orbs, badges and this run are recorded as they stand.'
        : 'Your build, your hearts and your orbs all come with you.'}</span>`;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'shop-buy';
    btn.textContent = gate.accept ? 'Finish' : 'Step through';
    btn.addEventListener('click', () => confirmPortal());
    row.appendChild(info);
    row.appendChild(btn);
    altarList.appendChild(row);
  }
  function openPortalConfirm(gate) {
    pendingPortal = gate;
    screen = 'altar'; // the overlay's own screen id — Skip routes back through closeAltar
    renderPortalConfirm();
    altarScreen.classList.remove('hidden');
  }
  function confirmPortal() {
    const gate = pendingPortal;
    pendingPortal = null;
    altarScreen.classList.add('hidden');
    screen = 'playing';
    if (!gate) return;
    if (gate.accept) {
      // Stepping into the light IS a portal — warp through it, then the win fanfare and the book closes.
      GameAudio.play('warp');
      GameAudio.play('win');
      gameState.won = true;
      onVictory();
      return;
    }
    // A REALM portal: warp out to violet, build the realm behind the curtain, warp back in. The board
    // is torn down and rebuilt in the 'enter-realm' resolver once the curtain is full (see stepFrame).
    GameAudio.play('warp');
    gameState.enteringRealm = gate.realm;
    startFloorFade('out', PORTAL_FADE_OUT, PORTAL_TINT);
    pendingAction = 'enter-realm';
    animTimer = PORTAL_FADE_OUT;
  }

  function openAltar() {
    screen = 'altar';
    renderAltar();
    altarScreen.classList.remove('hidden');
  }
  function closeAltar() {
    // A PORTAL CONFIRM shares this overlay: cancelling simply leaves him standing on the door, with
    // nothing spent and the altar bookkeeping below deliberately skipped.
    if (pendingPortal) {
      pendingPortal = null;
      altarScreen.classList.add('hidden');
      screen = 'playing';
      logMessage('You step back from the portal.');
      updateHud();
      return;
    }
    // Walking away is always allowed, and always spends the altar — it is a decision, not a shop.
    if (gameState && gameState.pendingAltar) {
      gameState.pendingAltar = false;
      gameState.altarOffers = null;
      if (gameState.altar) gameState.altar.used = true;
      logMessage('You leave the altar as you found it.');
    }
    altarScreen.classList.add('hidden');
    screen = 'playing';
    updateHud();
    saveGame(gameState);
  }
  // Raised once the turn has fully resolved, exactly as the boon screen is.
  function maybeOpenAltar() {
    if (gameState && screen === 'playing' && gameState.pendingAltar) openAltar();
  }

  function openLevelUp() {
    screen = 'levelup';
    renderLevelUp();
    altarScreen.classList.remove('hidden');
  }

  function closeLevelUp() {
    // Clear the pending boon (taking a perk already did; skipping must too) so it
    // does not re-open every turn.
    if (gameState) {
      gameState.pendingLevelUp = false;
      gameState.levelPerks = null;
    }
    screen = 'playing';
    altarScreen.classList.add('hidden');
    setExamineEmpty('Aim an ability to see what it does.');
    saveGame(gameState);
    scanVisibleTips(gameState);
  }

  /* ------------------------------ turn flow ------------------------------ */

  // Every player-initiated move/card goes through here. If the resolved move would
  // DESCEND the stair while the floor's boss is still alive (the king is slipping past
  // it, forfeiting the boon), confirm first; otherwise apply immediately.
  function commitMove(result) {
    // ...but NOT in New Game+. The warning's whole content is "you will earn no boon", and a NG+
    // king is already at the seven-boon ceiling — guardians there pay out nothing. So the prompt was
    // asking him to confirm a cost that does not exist, on every single stair, for four floors.
    const ngPlus = typeof realmDef === 'function' && realmDef(result.realm).newGamePlus;
    // STEPPING INTO THE SKIP PORTAL turns the tutorial off for good (it stops auto-loading on new
    // games) — so confirm it first, and point the player at where to switch it back on. Cancelling
    // simply discards the move: the king never leaves the tile.
    if (result.tutSkipped) {
      openConfirm(
        'You can re-enable the tutorial through the Options menu at any time.',
        () => { setTutorialsEnabled(false); processPlayerResult(result); },
        { title: 'Skip the tutorial?', yesLabel: 'Skip tutorial' },
      );
      return;
    }
    // Never warn about a forfeited boon on the training grounds: its guardian grants none, and the
    // "descend without slaying the guardian" prompt is entirely about a lost boon.
    if (result.lastAction === 'exit' && !ngPlus && !result.tutorial && !bossDefeated(result)) {
      openConfirm(
        'Descend without slaying the guardian? You will earn no boon this floor.',
        () => processPlayerResult(result),
      );
      return;
    }
    processPlayerResult(result);
  }

  // `opts` (optional) overrides the modal's heading and its confirm-button label; defaults keep the
  // original descend-past-boss wording so that caller needs no change.
  function openConfirm(text, onYes, opts) {
    const o = opts || {};
    pendingConfirm = onYes;
    if (confirmText) confirmText.textContent = text;
    if (confirmTitleEl) confirmTitleEl.textContent = o.title || 'Descend?';
    if (confirmYesButton) confirmYesButton.textContent = o.yesLabel || 'Descend anyway';
    screenBeforeModal = screen;
    screen = 'confirm';
    if (confirmScreen) confirmScreen.classList.remove('hidden');
  }

  function closeConfirm() {
    pendingConfirm = null;
    if (confirmScreen) confirmScreen.classList.add('hidden');
    // Return to whatever raised the modal — the game (descend-past-boss), the title, or the options
    // menu (a new-game confirm). It used to hardcode 'playing', which was fine when only the in-game
    // descend prompt used it; a confirm raised from the title would have dumped the player into a
    // dead 'playing' screen with no gameState.
    screen = screenBeforeModal;
  }

  // Starting a fresh run WIPES the single save slot. If a run is in progress, make the player confirm
  // before it is gone; with nothing saved there is nothing to lose, so go straight through.
  function confirmNewGame(proceed) {
    if (typeof hasSave === 'function' && hasSave()) {
      openConfirm('Starting a new game will erase your current run — this cannot be undone.', proceed,
        { title: 'New Game?', yesLabel: 'Erase & start over' });
    } else {
      proceed();
    }
  }

  function processPlayerResult(nextState) {
    if (nextState.lastAction === 'blocked') {
      // A blocked action (card recharging, no target, weapon while wading, nothing to swap with,
      // nothing to banish, nowhere to blink...) changes no positions — just surface its message.
      // Do NOT reset the renderer/camera (that caused the move-and-snap-back).
      //
      // The BEEP is here rather than at each refusal because every one of them sets this same flag:
      // one sound, one place, and any refusal added later gets it for free.
      GameAudio.play('nope');
      gameState = nextState;
      updateHud();
      return;
    }
    // A ranged/spell card: fly the arrow/bolt to the target FIRST, then resolve the hit +
    // death + screen shake once it lands (state stays as-is so the target is still shown).
    const shot = nextState.lastShot;
    if (shot && (shot.role === 'arrow' || shot.role === 'bolt' || shot.role === 'fireball')) {
      Renderer.rangedShot(shot.fromX, shot.fromY, shot.toX, shot.toY, shot.role, shot.tiles);
      GameAudio.play(shot.role === 'fireball' ? 'cast' : 'attack');
      nextState.lastShot = null;
      pendingShot = nextState;
      pendingAction = 'shot';
      animTimer = SHOT_LEAD_TIME;
      return;
    }
    // FOOTSTEP: a plain WALK — lastAction 'move' that actually changed the king's tile — gets a soft
    // step underfoot. A held turn (skipTurn is also 'move', but the tile is unchanged) and every bump
    // or capture ('combat', which already has its own thud) get none. gameState is still the PRE-move
    // state here; resolveCommitted swaps the new one in below, so this compares old tile vs new.
    if (nextState.lastAction === 'move' && gameState
        && (gameState.player.x !== nextState.player.x || gameState.player.y !== nextState.player.y)) {
      GameAudio.play('step');
    }
    // BOSS CAPTURE: the king ended his move ON a felled floor GUARDIAN's tile (a melee capture, or a
    // knight-jump card onto it). Hold the capture — the guardian DISSOLVES where it stood (fade to dark
    // red, see Renderer.dissolve) and only THEN does the king glide on to claim the tile. Minis/rush die
    // instantly (they die too often to earn the beat), and a RANGED kill leaves the king off the tile,
    // so neither matches here. gameState is still the PRE-move state, so the slain boss is still in it.
    if (gameState && !nextState.gameOver && typeof Renderer.dissolve === 'function') {
      const px = nextState.player.x;
      const py = nextState.player.y;
      const slain = gameState.enemies.find((e) => e.boss && !e.mini && !e.rush
        && e.x === px && e.y === py && !nextState.enemies.some((n) => n.id === e.id));
      if (slain) {
        // The guardian SCREAMS first and still STANDING (it isn't dissolving yet — Renderer.dissolve is
        // held back), THEN it unmakes itself: the death cry leads the death anim, not the reverse. Strip
        // 'wail' from the cues so applyState (after the hold) doesn't play a second one.
        if (Array.isArray(nextState.cues)) nextState.cues = nextState.cues.filter((c) => c !== 'wail');
        GameAudio.play('wail');
        pendingBossKill = nextState;
        pendingBossKillId = slain.id;
        pendingAction = 'bosskill-lead';
        animTimer = BOSS_SCREAM_LEAD;
        return;
      }
    }
    resolveCommitted(nextState);
  }

  function resolveCommitted(nextState) {
    const prevEnemies = gameState ? gameState.enemies.length : 0;
    const hadKey = Boolean(gameState && gameState.key && gameState.key.collected);
    const hpBefore = gameState ? gameState.player.hp : nextState.player.hp;

    applyState(nextState, true);
    // BANISH: the foe is already gone from the state — all that is left to show is the smoke where
    // it stood. Cleared so it fires exactly once.
    if (gameState.banished) {
      Renderer.puff(gameState.banished.x, gameState.banished.y);
      GameAudio.play('unsummon');
      gameState.banished = null;
    }
    maybeShowLockedExitTip(nextState); // explain the seal ONLY if he just stepped onto the locked stair
    Renderer.centerOn(nextState.player.x, nextState.player.y); // keep the king in view after a move
    // The king struck a survivor and bounced off it: pounce onto its tile, then ease to where he
    // ended (a leap-onto-foe recoil). Cleared so it fires only once.
    if (nextState.lungeAt) {
      Renderer.lunge(nextState.lungeAt.x, nextState.lungeAt.y);
      nextState.lungeAt = null;
    }

    // A yellow flash when the floor key is first collected.
    if (nextState.key && nextState.key.collected && !hadKey) {
      Renderer.effect('key');
      GameAudio.play('buy');
    }

    // BLOOD HE SPILLS HIMSELF. Only landEnemyMove compared HP, so a wound taken on the king's OWN
    // turn — wading into lava, phasing into a wall-torch — cost him a heart in total silence: no
    // flash, no shake, no sound, just a number quietly ticking down while he strolled across a lake
    // of fire. Every source is caught here rather than at each one, so anything self-inflicted added
    // later gets the same feedback for free.
    if (nextState.player.hp < hpBefore) {
      Renderer.effect(nextState.gameOver ? 'death' : 'hit');
      GameAudio.play(nextState.gameOver ? 'death' : 'hit');
      flashHealth();
    }

    const felled = prevEnemies - nextState.enemies.length; // captures this action
    const struck = nextState.lastAction === 'combat' || nextState.lastAction === 'move-free';

    // Feedback flashes for what just happened.
    if (struck) {
      Renderer.effect('kill');
    }

    if (nextState.won) {
      // Let the victory flash play for a beat before the overlay drops.
      Renderer.effect('victory');
      GameAudio.play('win');
      pendingAction = 'victory';
      animTimer = PLAYER_MOVE_TIME * 3;
      return;
    }
    if (nextState.gameOver) {
      // HOLD the death screen back a beat — the death flash (above), the pool of blood he left
      // (game.js checkDeath), his dissolve + dying grunt (beginKingDeath) all land before the modal.
      beginKingDeath();
      pendingAction = 'gameover';
      animTimer = GAMEOVER_LEAD_TIME;
      return;
    }
    if (nextState.lastAction === 'exit') {
      GameAudio.play('descend');
      startFloorFade('out', FLOOR_FADE_OUT); // darken the old floor before it is torn down
      pendingAction = 'floor';
      animTimer = FLOOR_FADE_OUT; // hold the (darkening) old floor on screen until it is fully black
      return;
    }
    // A NEW GAME+ realm is finished: back to the room between realms, that door dark behind him.
    if (nextState.lastAction === 'realm-cleared') {
      GameAudio.play('warp'); // back through the portal to the room between realms
      startFloorFade('out', PORTAL_FADE_OUT, PORTAL_TINT);
      pendingAction = 'portalroom';
      animTimer = PORTAL_FADE_OUT;
      return;
    }
    // He stepped onto a portal IN that room — into a realm, or into the light.
    if (nextState.lastAction === 'portal-enter' || nextState.lastAction === 'portal-accept') {
      // ASK FIRST — this is the one move in the game that cannot be taken back. He has walked onto
      // the tile; the overlay decides whether he walks THROUGH. Cancelling leaves him standing on it
      // (see closeAltar), exactly as walking away from an altar does.
      const gate = (nextState.portalGates || []).find(
        (g) => g.x === nextState.player.x && g.y === nextState.player.y,
      );
      if (gate) {
        openPortalConfirm(gate);
        return;
      }
      // No gate found (should not happen) — fall back to the old immediate behaviour rather than
      // stranding him on a tile that does nothing, but still warp through the same violet curtain.
      GameAudio.play('warp');
      if (nextState.lastAction === 'portal-accept') {
        GameAudio.play('win');
        pendingAction = 'accept-victory';
        animTimer = PLAYER_MOVE_TIME;
      } else {
        startFloorFade('out', PORTAL_FADE_OUT, PORTAL_TINT);
        pendingAction = 'enter-realm';
        animTimer = PORTAL_FADE_OUT;
      }
      return;
    }
    // A strike either felled a piece (kill) or merely chipped it (attack) — but shattering a
    // summoning circle by stepping on it is a hollow SWOOSH / power-down, not a combat hit.
    if (nextState.message && nextState.message.indexOf('summoning circle') !== -1) GameAudio.play('unsummon');
    else if (felled > 0) GameAudio.play('kill');
    else if (struck) GameAudio.play('attack');
    // Double Cast: the first bolt has landed — stay up and let the caster aim a second
    // shot at whatever still stands. (If nothing targetable remains, end the turn.)
    if (nextState.lastAction === 'card-followup') {
      const idx = gameState.player.cards.findIndex((c) => c && c.doubleReady);
      const foeLeft = idx >= 0 && (typeof spellCanHitFoe === 'function'
        ? spellCanHitFoe(gameState, gameState.player.cards[idx])
        : getCardMoves(gameState, gameState.player.cards[idx]).length > 0);
      if (foeLeft) {
        toggleCardTargeting(idx); // re-open the aim overlay for the bonus shot — only if a UNIT still stands
        if (cardTargeting === idx) {
          awaitingFollowup = true;
          return;
        }
      }
      endFollowupTurn(); // couldn't re-open / no target left — just end the turn
      return;
    }
    // Quick weapons / Bloodrush kills cost no turn — no enemy phase.
    if (nextState.enemyTurn === false || nextState.lastAction === 'card-free' || nextState.lastAction === 'move-free') {
      // A free action hands control STRAIGHT back to him, so this is a moment he has to be able to
      // act — and the enemy phase (where stalemate is normally judged) never runs. Blinking onto an
      // island of pits is exactly the move that does this, and without the check here the game would
      // simply sit there waiting for an input he cannot give.
      if (typeof checkStalemate === 'function' && checkStalemate(gameState)) {
        applyState(gameState, true);
        Renderer.effect('death');
        GameAudio.play('death');
        beginKingDeath();
        pendingAction = 'gameover';
        animTimer = GAMEOVER_LEAD_TIME;
        return;
      }
      maybeOpenLevelUp(); // a free-action boss kill still earns its boon
      maybeOpenAltar();
      return;
    }

    // The king's ALLIES strike first — before the foes, not after. Acting last meant they were
    // routinely cut down before they ever swung; moving first they trade properly.
    const alliesBefore = nextState.enemies.length;
    const withAllies = runAllyPhase(nextState);
    applyState(withAllies, true);
    // An ally's kill should LAND like the king's — the same pale impact flash, screenshake and cue —
    // instead of a foe silently blinking out of existence. (The ally's own pounce onto the tile is
    // its glide; `lunge` is not used here because that drives the KING's token, not an ally's.)
    if (withAllies.enemies.length < alliesBefore) {
      Renderer.effect('kill');
      GameAudio.play('kill');
    }
    // Pieces newly in view freeze in surprise; the rest get to move.
    const hpBeforePhase = gameState.player.hp;
    const phase = beginEnemyPhase(gameState);
    applyState(phase.state, true);
    // THE FLOOR'S OWN BLOW. Damage dealt at the START of the enemy phase — scalding geyser steam, a
    // burning tree, the molten floor — lands inside beginEnemyPhase, so neither the self-inflicted
    // check (the king's own turn) nor landEnemyMove (a per-mover blow) ever saw it, and a geyser could
    // take a heart in total silence. Environmental damage now flashes and shakes like any other hit.
    if (gameState.player.hp < hpBeforePhase && !gameState.gameOver) {
      Renderer.effect('hit');
      GameAudio.play('hit');
      flashHealth();
    }
    // A guardian STARTLED this phase roars now — on the same turn its "!" goes up. That shout is
    // raised by the phase itself, not by a mover (a gasping boss doesn't act), so nothing in the
    // per-mover path would ever show it.
    showBossShout();
    // The FLOOR ITSELF can kill him at the very START of the enemy phase — a geyser erupting under his
    // feet, the molten floor closing in, a burning tree — all before any foe moves. That death lands
    // inside beginEnemyPhase, not in a per-mover landEnemyMove, so it must be caught HERE: otherwise
    // the queue runs on a dead king and the defeat overlay never drops (the game just hangs).
    if (gameState.gameOver) {
      Renderer.effect('death');
      GameAudio.play('death');
      flashHealth();
      beginKingDeath();
      enemyQueue = [];
      pendingAction = 'gameover';
      animTimer = GAMEOVER_LEAD_TIME;
      return;
    }
    enemyQueue = phase.moverIds;
    animTimer = PLAYER_MOVE_TIME;
    scanVisibleTips(phase.state);
  }

  // Everything that happens once an enemy's move has actually LANDED: apply it and react to the
  // blow. Split out so a projectile can defer all of it until its arrow arrives. Returns true if
  // the queue must stop here (the king died).
  // A guardian's first-sighting ROAR: the log line, the speech bubble over its head, and the blare.
  // Shared by the phase (a boss startled into a gasp) and the per-mover path (one that wakes already
  // hunting), so a roar looks and sounds the same however it is triggered. Cleared so it fires once.
  function showBossShout() {
    if (gameState.bossLine) { logMessage(gameState.bossLine); gameState.bossLine = null; }
    if (gameState.bossShout) {
      Renderer.shout(gameState.bossShout.x, gameState.bossShout.y, gameState.bossShout.text, gameState.bossShout.demon);
      // A waking guardian BELLOWS. The DYING wail is not played here — it rides the cue channel from
      // defeatBoss so it sounds on every death, not just the two-in-three that raise a death bubble.
      if (!gameState.bossShout.death) GameAudio.play('roar');
      gameState.bossShout = null;
    }
  }

  function landEnemyMove(next, hpBefore) {
    applyState(next, true);
    showBossShout();
    // A foe that swung at the king lunges at him and recoils. AFTER applyState, because sync()
    // retargets every token — it leaves render.x alone, which is exactly what lets the nudge ride
    // on top and ease back on its own.
    if (gameState.strikeBump) {
      Renderer.bumpEnemy(gameState.strikeBump.id, gameState.strikeBump.dx, gameState.strikeBump.dy);
      gameState.strikeBump = null;
    }
    // REFLECT (Sentinel): the king ripostes a foe that ended its blow adjacent. Replay it so the counter
    // READS — the slain foe's blow rings off the raised guard (a blue block flash), then it is cut down.
    // Renderer.riposte ghosts the foe (already removed from the state) lunging in and fading; the king's
    // own lunge onto its tile is the counter-stroke.
    if (gameState.reflectAt) {
      const r = gameState.reflectAt;
      Renderer.riposte(r);      // ghost of the slain foe: lunge in, ring off the guard, fade as it's cut down
      Renderer.lunge(r.x, r.y); // the king's counter-stroke onto its tile
      Renderer.effect('kill');
      GameAudio.play('kill');
      gameState.reflectAt = null;
      // NB: the blue block flash + 'deflect' sound come from the player.deflected branch just below —
      // a parried blow sets that flag, so we don't fire them here (it would double up).
    }
    if (gameState.player.hp < hpBefore) {
      Renderer.effect(gameState.gameOver ? 'death' : 'hit');
      GameAudio.play(gameState.gameOver ? 'death' : 'hit');
      flashHealth();
      // (No "you took damage" pop-up — the heart flash says it, and the tutorial already taught it.)
    } else if (gameState.player.deflected) {
      // A blow landed but was warded/parried away — flash a blue block.
      Renderer.effect('deflect');
      GameAudio.play('deflect');
    }
    if (gameState.gameOver) {
      enemyQueue = [];
      // Let the death flash/shake, the blood pool, and his dissolve + dying grunt land before the overlay.
      beginKingDeath();
      pendingAction = 'gameover';
      animTimer = GAMEOVER_LEAD_TIME;
      return true;
    }
    return false;
  }

  function advanceEnemyQueue() {
    while (enemyQueue.length) {
      const id = enemyQueue.shift();
      if (!gameState.enemies.some((enemy) => enemy.id === id)) {
        continue; // Piece vanished (e.g. captured) before its turn.
      }
      const hpBefore = gameState.player.hp;
      const next = moveEnemy(gameState, id);
      // A projectile must FLY before it lands. Hold the whole outcome — the wound, the flash, the
      // death — until the arrow arrives, exactly as the king's own shots do (see pendingShot).
      // Resolving now instead would register the blow a beat BEFORE the bolt visibly got there.
      const shot = next.lastShot;
      if (shot && (shot.role === 'arrow' || shot.role === 'bolt' || shot.role === 'fireball')) {
        Renderer.rangedShot(shot.fromX, shot.fromY, shot.toX, shot.toY, shot.role, shot.tiles);
        GameAudio.play(shot.role === 'fireball' ? 'cast' : 'attack');
        next.lastShot = null;
        pendingEnemyShot = { state: next, hpBefore };
        pendingAction = 'enemyshot';
        animTimer = SHOT_LEAD_TIME;
        return;
      }
      // DEFENESTRATED: a knockback (or a Warper's swap) bowled the king onto the open stair and he
      // tumbled down. Descend exactly as a stepped exit does, and stop the queue here — the rest of it
      // belongs to a floor that is about to be replaced.
      if (next.lastAction === 'exit') {
        applyState(next, true);
        GameAudio.play('descend');
        startFloorFade('out', FLOOR_FADE_OUT); // same curtain as a stepped exit
        enemyQueue = [];
        pendingAction = 'floor';
        animTimer = FLOOR_FADE_OUT;
        return;
      }
      // A piece that did NOTHING you can see — a turret sweeping an empty lane, a circle groping
      // for a camouflaged king, a guardian sitting on its key — must not cost a beat of animation.
      // Otherwise the game stutters between the king's turns in proportion to how many idle guns
      // happen to be on screen, which is worst exactly when he is playing well and staying out of
      // their lanes. Apply it and move straight on to the next mover.
      if (next.lastAction === 'idle') {
        applyState(next, true);
        continue;
      }
      if (landEnemyMove(next, hpBefore)) return;
      animTimer = ENEMY_MOVE_TIME;
      return;
    }

    // Turn complete (allies already struck, BEFORE the foes) — now the floor may turn on him.
    applyState(maybeSpawnEnemy(gameState), true);
    // A tutorial SIGN the king just stepped onto is read by tickTutorial (inside maybeSpawnEnemy),
    // which runs AFTER the earlier scanVisibleTips this turn — so surface it here, on the SAME turn he
    // reached the sign, not a turn late.
    scanVisibleTips(gameState);
    if (gameState.dangerEvent) {
      // A danger event fired — a gentle rumble tinted the event's OWN colour (so the player reads
      // at a glance which hazard struck), the alarm cue, the exact log line, and a one-time tip.
      Renderer.effect('danger', DANGER_TINTS[gameState.dangerEvent.kind] || DANGER_TINTS.wave);
      GameAudio.play('doom');
      logMessage(gameState.dangerEvent.message);
      // The screen-shake, the doom cue and the log line carry it — no pop-up interrupts the run.
    }
    saveGame(gameState);
    maybeOpenLevelUp(); // if this turn slew the boss, offer the boon now
    maybeOpenAltar(); // ...and if he ended it standing on an altar, raise its offer
  }

  // DIAGONAL BY TWO KEYS. Two CARDINAL keys pressed within DIAG_COMBO_MS of each other combine into a
  // diagonal — W+A is up-left, S+D is down-right — so a player who never learns Q E Z C can still move
  // on the diagonals every piece in this game lives on. The cost is a small hold: a lone cardinal waits
  // that long for a partner before it commits. An EXPLICIT diagonal key (or a numpad diagonal) skips
  // the wait and moves at once.
  const DIAG_COMBO_MS = 60;
  let pendingStep = null;      // a cardinal [dx,dy] awaiting a possible perpendicular partner
  let pendingStepTimer = null;
  function clearPendingStep() {
    if (pendingStepTimer) { clearTimeout(pendingStepTimer); pendingStepTimer = null; }
    pendingStep = null;
  }
  function firePendingStep() {
    pendingStepTimer = null;
    const p = pendingStep; pendingStep = null;
    if (p) handleStep(p.dx, p.dy);
  }
  function queueStep(dx, dy) {
    if (dx !== 0 && dy !== 0) { clearPendingStep(); handleStep(dx, dy); return; } // explicit diagonal — go now
    if (pendingStep) {
      const p = pendingStep;
      const perpendicular = (p.dx === 0) !== (dx === 0); // one is vertical, the other horizontal
      if (perpendicular) { clearPendingStep(); handleStep(p.dx + dx, p.dy + dy); return; } // W+A → diagonal
      // same axis (or a repeat) — let the waiting one go on its own, then hold this one for its partner
      if (pendingStepTimer) clearTimeout(pendingStepTimer);
      pendingStep = null;
      handleStep(p.dx, p.dy);
    }
    pendingStep = { dx, dy };
    pendingStepTimer = setTimeout(firePendingStep, DIAG_COMBO_MS);
  }

  /* ------------------- tutorial spotlight & single-target input gate -------------------
     On the TRAINING FLOOR only: at a tricky juncture (strike the ferz, the ability-card puzzle,
     shatter the circle, grab the key, reach the stair) the game FREEZES and only the one glowing
     tile — or the one glowing ability card — answers a tap. Everything below returns null/false off
     the training floor, so the real game is never gated. See tutJuncture (game.js) for the geography. */

  // The one thing the player must tap right now, or null. Wraps the pure juncture and adds the
  // ability card's press → aim sub-steps. Shapes: { phase:'card', card:0 } (press the glowing card),
  // { phase:'cardTarget', tiles } (card aimed — tap a glowing tile to fire), or
  // { phase:'strike'|'circle'|'key'|'stair', tiles:[one tile] } (step onto the glowing tile).
  function tutGuide() {
    if (!gameState || !gameState.tutorial || screen !== 'playing') return null;
    if (typeof tutJuncture !== 'function') return null;
    const j = tutJuncture(gameState);
    if (!j) return null;
    if (j.kind === 'ability') {
      if (cardTargeting === 0) return { phase: 'cardTarget', tiles: abilityTargetTiles(), card: null };
      const c = gameState.player.cards[0];
      if (c && c.remaining > 0) return null; // already fired — let the shot resolve, don't re-lock
      return { phase: 'card', tiles: null, card: 0 };
    }
    return { phase: j.kind, tiles: [{ x: j.x, y: j.y }], card: null };
  }

  // The tile(s) the starter ability card must hit to open the barrier — read live from getCardMoves,
  // the same way the walkthrough test's crossBarrier does, so it can never drift from the real rule.
  function abilityTargetTiles() {
    if (!gameState) return [];
    const c = gameState.player.cards[0];
    if (!c) return [];
    const p = gameState.player;
    const moves = getCardMoves(gameState, c) || [];
    const cls = p.className;
    let picks;
    if (cls === 'ranger') picks = moves.filter((m) => terrainAt(gameState, m.x, m.y) === 'switch');
    else if (cls === 'warrior') picks = moves.filter((m) => m.viaJump && m.x > p.x); // leap east over the pit
    else picks = moves.filter((m) => m.y === p.y && m.x > p.x); // sorcerer: bolt straight east into the ice
    return picks.map((m) => ({ x: m.x, y: m.y }));
  }

  // Input gates. true = the guide forbids this action right now (freeze).
  function tutBlocksMove(tx, ty) {
    const g = tutGuide();
    if (!g) return false;
    if (g.card != null) return true;                 // must press the card, not step
    if (!g.tiles || !g.tiles.length) return true;
    return !g.tiles.some((t) => t.x === tx && t.y === ty);
  }
  function tutBlocksCard(idx) {
    const g = tutGuide();
    if (!g) return false;
    if (g.phase === 'card') return idx !== g.card;
    if (g.phase === 'cardTarget') return idx !== 0; // only the aimed card re-answers (fire / cancel)
    return true;                                    // a tile juncture wants no card pressed at all
  }

  // Push the board veil + ability-card highlight to match the guide. Cheap; called once per frame.
  function syncTutSpotlight() {
    const g = tutGuide();
    if (Renderer && typeof Renderer.setTutSpotlight === 'function') {
      Renderer.setTutSpotlight(g ? (g.card != null ? [] : g.tiles) : null);
    }
    const slot = g && g.card != null ? g.card : null;
    if (cardBar) {
      cardBar.classList.toggle('tut-guiding', slot != null);
      const kids = cardBar.children;
      for (let i = 0; i < kids.length; i += 1) kids[i].classList.toggle('tut-target', i === slot);
    }
  }

  function handleStep(dx, dy) {
    if (!isIdle()) {
      return;
    }
    if (tutBlocksMove(gameState.player.x + dx, gameState.player.y + dy)) {
      GameAudio.play('nope'); // frozen at a lesson juncture — only the glowing tile / card answers
      Renderer.bump(dx, dy);
      return;
    }
    clearPathProposal(); // any actual step invalidates a pending move-path proposal preview
    const result = movePlayer(gameState, dx, dy);
    if (result.lastAction === 'boulder-stuck') {
      // A committed shove against an immovable boulder: it SPENDS the turn (enemy phase runs),
      // but the king and rock still visibly strain and rebound.
      const bx = gameState.player.x + dx;
      const by = gameState.player.y + dy;
      if (terrainAt(gameState, bx, by) === 'boulder') Renderer.bumpBoulder(bx, by, dx, dy);
      Renderer.bump(dx, dy);
      commitMove(result);
      return;
    }
    if (result.lastAction === 'blocked') {
      // Walked into a wall / impassable tile: a lean-and-bounce BUMP that spends no turn and,
      // crucially, does NOT reset the renderer — so the camera never snaps (the old bug). The beep
      // says "that did nothing, and it cost you nothing" — the bump alone was easy to miss.
      GameAudio.play('nope');
      gameState = result;
      updateHud();
      Renderer.bump(dx, dy);
      // Shoved an immovable boulder? Vibrate the rock too (it wouldn't budge).
      const bx = gameState.player.x + dx;
      const by = gameState.player.y + dy;
      if (terrainAt(gameState, bx, by) === 'boulder') Renderer.bumpBoulder(bx, by, dx, dy);
      return;
    }
    commitMove(result);
  }

  function handleClick(event) {
    if (!gameState) {
      return;
    }
    clearPendingStep(); // a click is a fresh intent — drop any half-formed keyboard diagonal
    const rect = canvas.getBoundingClientRect();
    const scale = canvas.width / rect.width;
    const { x: tileX, y: tileY } = Renderer.screenToTile((event.clientX - rect.left) * scale, (event.clientY - rect.top) * scale);

    // TUTORIAL FREEZE: at a juncture, only the glowing tile acts. A click anywhere else just re-centres
    // the view (looking around stays free) — it never moves, fires, or cancels an aim by accident.
    const guide = tutGuide();
    if (guide) {
      const onTarget = Boolean(guide.tiles && guide.tiles.some((t) => t.x === tileX && t.y === tileY));
      if (!onTarget) {
        if (tileX >= 0 && tileX < WORLD_SIZE && tileY >= 0 && tileY < WORLD_SIZE) Renderer.centerOn(tileX, tileY);
        return;
      }
    }

    // Aiming a card: a click on a highlighted tile plays it; anything else cancels.
    if (cardTargeting !== null) {
      if (!isIdle()) {
        return;
      }
      const target = cardTargets.find((move) => move.x === tileX && move.y === tileY);
      const index = cardTargeting;
      const wasFollowup = awaitingFollowup;
      awaitingFollowup = false;
      cancelCardTargeting();
      if (target) {
        GameAudio.play('cast');
        commitMove(useCard(gameState, index, tileX, tileY));
      } else if (wasFollowup) {
        endFollowupTurn(); // clicking away declines the bonus shot and ends the turn
      }
      // a click on a non-target simply cancelled the card (above)
      return;
    }

    // A click on his OWN tile holds the ground (Warrior's Discipline) — the mouse equivalent of Space.
    // A non-warrior click on the king falls through to re-centre (its old, harmless behaviour).
    if (tileX === gameState.player.x && tileY === gameState.player.y && gameState.player.discipline) {
      if (isIdle()) commitMove(skipTurn(gameState)); // self-guards: beeps if nothing is in sight to wait for
      return;
    }

    // A click on a reachable tile moves the king there; any OTHER click SCROLLS the view to centre on
    // it — clicking a distant tile is how a desktop mouse looks around (examining tiles was removed).
    const canMove = isIdle() && getPlayerMoves(gameState).some((move) => move.x === tileX && move.y === tileY);
    if (canMove) {
      commitMove(movePlayerTo(gameState, tileX, tileY));
    } else if (tileX >= 0 && tileX < WORLD_SIZE && tileY >= 0 && tileY < WORLD_SIZE) {
      Renderer.centerOn(tileX, tileY);
    }
  }

  /* ------------------------------ game loop ------------------------------ */

  let lastTime = 0;

  function stepFrame(timestamp) {
    if (!lastTime) {
      lastTime = timestamp;
    }
    const delta = (timestamp - lastTime) / 1000;
    lastTime = timestamp;

    if (floorFade) {
      floorFade.t += delta;
      // OUT holds at full black until goNextFloor swaps it to IN (the new floor is built behind the
      // curtain); only the IN phase clears itself once the new floor has fully risen into view.
      if (floorFade.phase === 'in' && floorFade.t >= floorFade.dur) floorFade = null;
    }

    tickAutoMove(); // advance a confirmed auto-walk (only when idle)

    if (screen === 'playing' && animTimer > 0) {
      animTimer = Math.max(0, animTimer - delta);
      if (animTimer === 0) {
        if (pendingAction === 'shot') {
          pendingAction = null;
          const s = pendingShot;
          pendingShot = null;
          if (s) resolveCommitted(s);
        } else if (pendingAction === 'bosskill-lead') {
          // The scream has led — NOW the guardian begins to dissolve (it stood, screaming, until here).
          pendingAction = 'bossdissolve';
          if (pendingBossKillId != null && Renderer.dissolve) Renderer.dissolve(pendingBossKillId);
          pendingBossKillId = null;
          animTimer = BOSS_DISSOLVE_TIME;
        } else if (pendingAction === 'bossdissolve') {
          // The guardian has finished dissolving — NOW the king glides onto its empty tile and the turn
          // resolves as normal (enemy phase, boon, and the rest).
          pendingAction = null;
          const s = pendingBossKill;
          pendingBossKill = null;
          if (s) resolveCommitted(s);
        } else if (pendingAction === 'enemyshot') {
          // The foe's arrow just arrived — NOW its blow lands, and the queue moves on.
          pendingAction = null;
          const s = pendingEnemyShot;
          pendingEnemyShot = null;
          if (s && !landEnemyMove(s.state, s.hpBefore)) {
            animTimer = ENEMY_MOVE_TIME;
          }
        } else if (pendingAction === 'floor') {
          pendingAction = null;
          goNextFloor();
        } else if (pendingAction === 'portalroom') {
          pendingAction = null;
          applyState(returnToPortalRoom(gameState), false);
          enemyQueue = []; animTimer = 0;
          startFloorFade('in', PORTAL_FADE_IN, PORTAL_TINT); // the room rises out of the violet
          saveGame(gameState);
        } else if (pendingAction === 'enter-realm') {
          pendingAction = null;
          applyState(enterRealm(gameState, gameState.enteringRealm), false);
          enemyQueue = []; animTimer = 0;
          startFloorFade('in', PORTAL_FADE_IN, PORTAL_TINT); // the realm rises out of the violet
          saveGame(gameState);
          scanVisibleTips(gameState);
        } else if (pendingAction === 'accept-victory') {
          // He has chosen to be done. The victory was already his; this just closes the book.
          pendingAction = null;
          gameState.won = true;
          onVictory();
        } else if (pendingAction === 'gameover') {
          pendingAction = null;
          onGameOver();
        } else if (pendingAction === 'victory') {
          pendingAction = null;
          onVictory();
        } else if (pendingAction === 'levelup') {
          pendingAction = null;
          openLevelUp(); // the victory beat has passed — present the boon
        } else {
          advanceEnemyQueue();
        }
      }
    }

    // Continuous edge-of-screen panning while playing.
    if (screen === 'playing' && (edgePan.x || edgePan.y)) {
      Renderer.panBy(edgePan.x * EDGE_PAN_SPEED * delta, edgePan.y * EDGE_PAN_SPEED * delta);
    }

    // At max danger the turn counter pulses amber<->red (a louder alarm than the
    // steady red of merely-high danger) — matched by the doubled spawn rate.
    if (gameState && screen === 'playing' && gameState.turn >= (gameState.dreadTurns || MAX_TURNS_SCARY)) {
      turnLabel.style.color = Math.floor(timestamp / 350) % 2 ? '#fde047' : '#ef4444';
    }

    // Each screen carries its own score: the title theme, a warm theme at the altar (and on
    // victory), a lament on death, and the exploring loop in play. Modal overlays (options /
    // character / tips / confirm) deliberately set nothing, so the music doesn't lurch when one
    // pops open over whatever was already playing.
    if (screen === 'title' || screen === 'class') GameAudio.setTrack('title');
    // The run-over screen: the death lament normally — but if the run was actually WON, the victory
    // jingle (which plays once, not looped), so a win never sounds like a defeat even on this screen.
    else if (screen === 'gameover') GameAudio.setTrack(gameState && gameState.won ? 'altar' : 'death');
    else if (screen === 'levelup' || screen === 'victory') GameAudio.setTrack('altar');
    // The demon realm gets its own loop — the same wandering shape, dragged down into the pit. An
    // OVERWORLD floor gone molten in the overstay switches to it too: once the lava wells up, the
    // dread is hell's, and so is the score.
    else if (screen === 'playing') {
      const hellish = gameState && ((gameState.floor || 1) >= DEMON_FLOOR || (gameState.turn || 0) >= MAX_TURNS_SCARY);
      GameAudio.setTrack(hellish ? 'hell' : 'explore');
    }

    // The exploring score HURRIES a gear at a time as the floor's dread climbs (so the pressure to
    // get off the floor is audible), and darkens to the tense progression past the danger line.
    const dread = Boolean(gameState) && screen === 'playing'
      ? dreadFraction(gameState.turn, gameState.dreadTurns)
      : 0;
    GameAudio.setDanger(dread);
    // Past the 60% mark of the CLIMB (not of the whole cycle — the grace isn't dread).
    const inDanger = Boolean(gameState) && screen === 'playing' && dread >= 0.6;
    GameAudio.setTension(inDanger);

    // Show the "loading music" cue only during the brief warm-up before the first track has decoded.
    if (musicLoadingEl) musicLoadingEl.classList.toggle('visible', GameAudio.isWarming());

    Renderer.update(delta);
    if (screen === 'title') {
      // The whole title screen is the board now — the menu options are tiles on it.
      Renderer.drawTitle(withDebugOption(titleMenuModel()));
    } else if (screen === 'class' && !gameState && typeof Renderer.drawPickScene === 'function') {
      // CHARACTER CREATION: three kings on the board, one per class (then per difficulty) — pick one.
      Renderer.drawPickScene(classPickModel());
    } else if (screen === 'trophies' && !gameState && typeof Renderer.drawTrophyScene === 'function') {
      // THE TROPHY ROOM: the king in a hall, this room's trophies around him, doorways to the rest.
      Renderer.drawTrophyScene(trophySceneModel());
    } else if (!gameState) {
      // A pre-game screen with no board of its own (options opened from the title): show the living
      // board behind the card rather than a black void. Screens with a gameState (gameover, victory,
      // and modals opened mid-run) fall through and keep their board.
      Renderer.drawBoardBackdrop();
    } else {
      // While aiming a card, show its reachable tiles instead of moves.
      const aiming = cardTargeting !== null;
      const targets = aiming ? cardTargets : null;
      const aoe = aiming ? spellAoeTiles(gameState, cardTargeting, cardCursor) : null;
      syncTutSpotlight(); // training floor: dim the board / light the one tile or card to tap next
      Renderer.draw(gameState, isIdle() && !aiming, targets, aiming ? cardCursor : null, aoe);
    }
    // The descent curtain rides ABOVE the board (and even a modal's board backdrop) so the whole view
    // sinks to black and rises again between floors.
    const fadeA = floorFadeAlpha();
    if (fadeA > 0 && typeof Renderer.drawFade === 'function') Renderer.drawFade(fadeA, floorFade && floorFade.color);
  }

  // The animation loop, wrapped so ONE bad frame can't freeze the whole game. On an uncaught error we
  // surface a reload prompt (the run auto-saves on every move, so a reload resumes it) and keep the loop
  // scheduling — a transient hiccup recovers, and the prompt is shown only once. A window-level 'error'
  // backstop catches crashes in event handlers (clicks/keys) that fall outside this loop.
  let crashed = false;
  function reportCrash(err) {
    if (crashed) return;
    crashed = true;
    console.error('Chess Dungeon — unrecoverable error:', err);
    if (crashScreen) crashScreen.classList.remove('hidden');
  }
  function step(timestamp) {
    try {
      stepFrame(timestamp);
    } catch (err) {
      reportCrash(err);
    }
    requestAnimationFrame(step);
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('error', (e) => { if (e && e.error) reportCrash(e.error); });
  }

  /* ------------------------------- wiring -------------------------------- */

  document.addEventListener('keydown', (event) => {

    // F2 saves a PNG of the board — handy for grabbing store-page screenshots. Works on any screen.
    if (event.key === 'F2') {
      event.preventDefault();
      saveScreenshot();
      return;
    }

    // A tutorial tip is up: ANY key dismisses it (F2 for a screenshot is handled above). One tap to
    // move on — no button to hunt for.
    if (screen === 'tutorial') {
      event.preventDefault();
      dismissTip();
      return;
    }

    // Diegetic MENUS are keyboard-navigable: the usual movement keys (WASD, numpad) AND the arrows
    // move the highlight from option to option; Enter/Space fires the highlighted one, exactly as a
    // click would. `menuDir` folds both key sets into a single [dx,dy], and a 1-D menu reads whichever
    // axis the player pushed (so up OR left both step "back" through a row of options).
    const menuDir = (ev) => resolveMove(ev) || resolvePan(ev);
    const isConfirmKey = (ev) => ev.key === 'Enter' || ev.key === ' ' || ev.code === 'Space';

    // TITLE menu: the four icons ring the throne (New Game left, Continue right, Trophies down-left,
    // Options down-right). A pressed DIRECTION lands on the icon that lies that way from the centre —
    // press left → the left icon, down-left → the down-left icon — rather than rotating through a list.
    if (screen === 'title') {
      const opts = withDebugOption(titleMenuModel()).options.filter((o) => o.enabled);
      if (!opts.length) return;
      const dir = menuDir(event);
      if (dir) {
        event.preventDefault();
        const id = Renderer.titleOptionInDirection(dir[0], dir[1]);
        if (id) titleHover = id; // no icon that way → keep the current highlight
        else if (titleHover == null) titleHover = opts[0].id;
        return;
      }
      if (isConfirmKey(event)) {
        event.preventDefault();
        const sel = opts.find((o) => o.id === titleHover) || opts[0];
        if (sel && sel.action) pressMenu(sel.id, sel.action);
      }
      return;
    }

    // A yes/no confirm modal (e.g. descending past a live boss): Enter = yes, Esc = no.
    if (screen === 'confirm') {
      if (event.key === 'Enter') {
        event.preventDefault();
        const act = pendingConfirm;
        closeConfirm();
        if (act) act();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        closeConfirm();
      }
      return;
    }

    // The diegetic pre-game scenes: arrow keys WALK the trophy rooms; Escape steps back a level
    // (difficulty → class → title, or out of the trophy hall). No other key acts on them.
    if (screen === 'class' || screen === 'trophies') {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (screen === 'class' && pickStage === 'difficulty') { pickStage = 'class'; sceneHover = null; } else showTitle();
        return;
      }
      if (screen === 'trophies' && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
        event.preventDefault();
        pageTrophies(event.key === 'ArrowRight' ? 1 : -1);
        return;
      }
      // TROPHY HALL: the NUMPAD (and WASD) directionally SELECT a medallion — press up-left → the
      // top-left trophy, right → the right one, etc. (Arrows are reserved for walking room to room,
      // above.) Any trophy can be read this way, earned or not; the blurb shows its name and condition.
      if (screen === 'trophies') {
        const dir = resolveMove(event); // numpad + WASD only, NOT the arrows
        if (dir) {
          event.preventDefault();
          const id = Renderer.trophyInDirection(dir[0], dir[1]);
          if (id) sceneHover = id;
          return;
        }
        return;
      }
      // CLASS SELECT is keyboard-navigable: a movement key walks the row of kings (or difficulties),
      // Enter/Space chooses the highlighted one — the same handler a click runs.
      if (screen === 'class') {
        const ids = pickStage === 'class' ? Object.keys(CLASSES) : Object.keys(DIFFICULTY_HP);
        const dir = menuDir(event);
        if (dir) {
          event.preventDefault();
          if (sceneHover == null || !ids.includes(sceneHover)) { sceneHover = ids[0]; return; }
          const step = (dir[0] || dir[1]) > 0 ? 1 : -1;
          const i = (ids.indexOf(sceneHover) + step + ids.length) % ids.length;
          sceneHover = ids[i];
          return;
        }
        if (isConfirmKey(event)) {
          event.preventDefault();
          handleSceneClick(ids.includes(sceneHover) ? sceneHover : ids[0]);
          return;
        }
      }
      return;
    }

    // While aiming a card: movement keys CYCLE through valid targets; Enter/Space —
    // or pressing the same card's hotkey again — confirms; another card's hotkey
    // switches to it; Escape cancels.
    if (cardTargeting !== null) {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (awaitingFollowup) {
          // Declining the bonus Double-Cast shot simply ends the turn.
          cancelCardTargeting();
          endFollowupTurn();
          return;
        }
        cancelCardTargeting();
        gameState.message = 'Card cancelled.';
        updateHud();
        return;
      }
      if (event.key === 'Enter' || event.key === ' ' || event.code === 'Space') {
        event.preventDefault();
        confirmCardCursor();
        return;
      }
      const aimingCardKey = /^Digit([1-9])$/.exec(event.code);
      if (aimingCardKey) {
        event.preventDefault();
        const idx = Number(aimingCardKey[1]) - 1;
        if (idx === cardTargeting) confirmCardCursor(); // same hotkey again = fire
        else toggleCardTargeting(idx); // a different card's hotkey re-aims that one
        return;
      }
      const aim = resolveMove(event);
      if (aim) {
        event.preventDefault();
        aimCardCursor(aim[0], aim[1]); // push a direction → the target that way
        return;
      }
      // Arrows still PAN while aiming (they only move the king outside aim mode) — so you can look
      // around before you fire without disturbing the target cursor. Consume them here so they never
      // fall through to the king-movement block below.
      const aimPan = resolvePan(event);
      if (aimPan) {
        event.preventDefault();
        Renderer.panBy(aimPan[0] * KEY_PAN_STEP, aimPan[1] * KEY_PAN_STEP);
        return;
      }
    }

    // Not aiming and not in a confirm: Escape toggles the Options menu.
    if (event.key === 'Escape') {
      if (screen === 'options') {
        event.preventDefault();
        closeOptions();
        return;
      }
      if (screen === 'playing') {
        event.preventDefault();
        openOptions();
        return;
      }
    }

    // Top-row number keys (Digit1-9, never the numpad) select/aim a weapon card.
    const cardKey = /^Digit([1-9])$/.exec(event.code);
    if (cardKey) {
      event.preventDefault();
      toggleCardTargeting(Number(cardKey[1]) - 1);
      return;
    }

    // DISCIPLINE (Warrior's innate): Space / '.' / numpad-5 holds the ground — a spent turn with no
    // move, so foes come to him. Only when he actually has the trait; otherwise these keys fall
    // through (Space does nothing while playing, numpad-5 is not a direction).
    if (screen === 'playing' && gameState && gameState.player.discipline
        && (event.key === ' ' || event.code === 'Space' || event.key === '.' || event.code === 'Period' || event.code === 'Numpad5')) {
      event.preventDefault();
      if (isIdle()) commitMove(skipTurn(gameState));
      return;
    }

    // MOVE the king — WASD, the numpad, OR the arrow keys (arrows no longer pan; the camera follows
    // him, and you scroll by dragging, the minimap, or clicking a tile). Two cardinals within the
    // combo window make a diagonal, so ↑+← is up-left just like W+A.
    const move = resolveMove(event) || resolvePan(event);
    if (move) {
      event.preventDefault();
      clearAutoMove(); // a manual keypress takes over from any mobile auto-walk
      queueStep(move[0], move[1]); // cardinals may combine into a diagonal; see queueStep
      return;
    }
    // Zoom: Page Up / '+' / '=' zoom in; Page Down / '-' / '_' zoom out.
    if (event.key === 'PageUp' || event.key === '+' || event.key === '=') {
      event.preventDefault();
      Renderer.zoomBy(KEY_ZOOM_STEP);
    } else if (event.key === 'PageDown' || event.key === '-' || event.key === '_') {
      event.preventDefault();
      Renderer.zoomBy(-KEY_ZOOM_STEP);
    }
  });

  // A tap OR a mouse-click at a client point, dispatched by screen. Both the mouse `click` listener and
  // the touch `touchend` tap call this with a bare {clientX, clientY} — handleClick and the option
  // hit-tests only ever read those two fields, so a synthesized point works exactly like a real event.
  // PRESS FEEDBACK for the diegetic menus (title / class-select / trophy). A tap or Enter used to fire
  // the action instantly and hard-cut to the next screen — nothing acknowledged the press, worst on
  // touch where there is no hover. Now: a UI tick + a bright flash on the pressed option (Renderer.
  // setPressed drives the flash off the same hit-rects), held ~110ms so it READS, then the action runs.
  // Guarded so a double-tap can't fire twice or stack transitions.
  const MENU_PRESS_MS = 110;
  let menuPressing = false;
  function pressMenu(id, action) {
    if (menuPressing) return;
    menuPressing = true;
    GameAudio.play('select');
    if (Renderer.setPressed) Renderer.setPressed(id);
    setTimeout(() => {
      menuPressing = false;
      if (Renderer.setPressed) Renderer.setPressed(null);
      if (typeof action === 'function') action();
    }, MENU_PRESS_MS);
  }

  function dispatchTap(clientX, clientY) {
    if (screen === 'title') {
      const rect = canvas.getBoundingClientRect();
      const scale = canvas.width / rect.width;
      const id = Renderer.titleOptionAt((clientX - rect.left) * scale, (clientY - rect.top) * scale);
      if (id) {
        const opt = withDebugOption(titleMenuModel()).options.find((o) => o.id === id);
        if (opt && opt.enabled && opt.action) pressMenu(opt.id, opt.action);
      }
      return;
    }
    if (screen === 'class' || screen === 'trophies') {
      const rect = canvas.getBoundingClientRect();
      const scale = canvas.width / rect.width;
      const id = Renderer.sceneOptionAt((clientX - rect.left) * scale, (clientY - rect.top) * scale);
      if (id) handleSceneClick(id);
      return;
    }
    handleClick({ clientX, clientY });
  }

  canvas.addEventListener('click', (event) => {
    if (suppressClick) {
      suppressClick = false; // this "click" was the end of a drag
      return;
    }
    clearAutoMove();
    dispatchTap(event.clientX, event.clientY);
  });

  // A click on the diegetic class-select or trophy scene, by the hit-rect id the renderer reported.
  // Routed through pressMenu so it flashes + ticks + holds a beat before acting, exactly like the title.
  function handleSceneClick(id) {
    pressMenu(id, () => applySceneChoice(id));
  }
  function applySceneChoice(id) {
    if (id === 'back') {
      if (screen === 'class' && pickStage === 'difficulty') { pickStage = 'class'; sceneHover = null; } else showTitle();
      return;
    }
    if (screen === 'trophies') {
      if (id === 'prev') pageTrophies(-1);
      else if (id === 'next') pageTrophies(1);
      return; // trophy medallions themselves only ever HOVER (to show their condition)
    }
    // Class select: a king was chosen. First the class, then the difficulty, then the run begins.
    // Validate the id against the CURRENT stage — a click landing a frame before the scene redraws
    // could otherwise pass a class key where a difficulty is expected (and vice-versa).
    if (pickStage === 'class') {
      if (CLASSES[id]) { pickedClass = id; pickStage = 'difficulty'; sceneHover = null; }
    } else if (DIFFICULTY_HP[id]) {
      newGame(pickedClass, id);
    }
  }

  // Mouse wheel zooms toward / away.
  canvas.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      Renderer.zoomBy(event.deltaY < 0 ? WHEEL_ZOOM_STEP : -WHEEL_ZOOM_STEP);
    },
    { passive: false },
  );

  // Click-and-drag panning, edge-of-window panning, and the hover popover all key
  // off mouse position.
  let dragging = false;
  let dragMoved = false;
  let suppressClick = false;
  let dragLast = { x: 0, y: 0 };
  let miniDragging = false; // true while dragging on the minimap (suppresses edge-panning)

  canvas.addEventListener('mousedown', (event) => {
    dragging = true;
    dragMoved = false;
    dragLast = { x: event.clientX, y: event.clientY };
  });

  window.addEventListener('mouseup', () => {
    if (dragging && dragMoved) {
      suppressClick = true; // swallow the click that follows a drag
    }
    dragging = false;
  });

  // --- MOBILE AUTO-MOVE + move-path PROPOSAL. A far TAP PROPOSES a path (previewed on the board, see
  // pathProposal); a second tap on that same destination commits an auto-walk, ticked from the game loop
  // ONLY while idle (so it respects animations and the enemy phase) and stopping on danger.
  const STEP_DIRS = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
  let autoMove = null;         // { mode:'path', tx, ty, lastHp } or null
  let pathProposal = null;     // a tapped-but-unconfirmed destination { tx, ty }, previewed on the board
  function clearAutoMove() { autoMove = null; }
  function clearPathProposal() {
    pathProposal = null;
    if (Renderer && typeof Renderer.setPathPreview === 'function') Renderer.setPathPreview(null);
  }

  function tileFromClient(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const scale = canvas.width / rect.width;
    return Renderer.screenToTile((clientX - rect.left) * scale, (clientY - rect.top) * scale);
  }

  // A flood from the target over what the KING can SEE. Unlike allyPathField (which knows the whole
  // floor — a "maphack" when the player only meant "head that way"), an UNEXPLORED tile is assumed
  // PASSABLE, so a route runs straight through fog and only bends around walls he has actually revealed.
  // Recomputed every step as he walks, so it repaths the moment fresh ground shows a wall in the way.
  function pathField(state, tx, ty) {
    const W = WORLD_SIZE;
    const dist = new Int16Array(W * W).fill(-1);
    const id = (x, y) => y * W + x;
    const explored = state.explored || {};
    const open = (x, y) => {
      if (x < 0 || y < 0 || x >= W || y >= W) return false;
      if (!explored[`${x},${y}`]) return true; // fog: optimistically passable until revealed
      return standableFor(terrainAt(state, x, y), { lavaOk: false });
    };
    const queue = [];
    if (open(tx, ty)) { dist[id(tx, ty)] = 0; queue.push([tx, ty]); }
    else {
      // A known obstacle on the target itself: flood from the open ground around it instead.
      for (const [dx, dy] of STEP_DIRS) {
        const x = tx + dx, y = ty + dy;
        if (open(x, y)) { dist[id(x, y)] = 1; queue.push([x, y]); }
      }
    }
    for (let h = 0; h < queue.length; h += 1) {
      const [x, y] = queue[h];
      const d = dist[id(x, y)];
      for (const [dx, dy] of STEP_DIRS) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= W) continue;
        if (dist[id(nx, ny)] !== -1 || !open(nx, ny)) continue;
        dist[id(nx, ny)] = d + 1;
        queue.push([nx, ny]);
      }
    }
    return { dist, id };
  }

  // The king's best legal step toward (tx,ty): rank his moves by the fog-aware flood (pathField) and take
  // the one that gets STRICTLY closer the way he'd have to WALK. Null if nothing gets closer (already as
  // near as the floor allows, or walled off).
  function nextStepToward(state, tx, ty) {
    const moves = getPlayerMoves(state);
    if (!moves.length) return null;
    const { dist, id } = pathField(state, tx, ty);
    const here = dist[id(state.player.x, state.player.y)];
    let best = null;
    let bestD = here >= 0 ? here : Infinity;
    for (const m of moves) {
      const d = dist[id(m.x, m.y)];
      if (d >= 0 && d < bestD) { bestD = d; best = m; }
    }
    // Adjacent to a target the flood can't stand on (an enemy to strike, the king wading): allow the
    // finishing step ONTO it.
    if (!best) { const onto = moves.find((m) => m.x === tx && m.y === ty); if (onto) best = onto; }
    return best;
  }

  // Trace the whole walking route from the king to (tx,ty) by following the fog-aware flood downhill —
  // the tiles he'd step through, ending at the destination (or the nearest reachable tile). For the
  // on-board path PREVIEW; goes straight through fog. Null if he can't get any closer at all.
  function computePath(state, tx, ty) {
    const { dist, id } = pathField(state, tx, ty);
    let x = state.player.x, y = state.player.y;
    const tiles = [];
    let guard = 0;
    while (!(x === tx && y === ty) && guard++ < 400) {
      const here = dist[id(x, y)];
      let best = null;
      let bestD = here >= 0 ? here : Infinity;
      for (const [dx, dy] of STEP_DIRS) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= WORLD_SIZE || ny >= WORLD_SIZE) continue;
        const d = dist[id(nx, ny)];
        if (d >= 0 && d < bestD) { bestD = d; best = [nx, ny]; }
      }
      if (!best) break;
      x = best[0]; y = best[1];
      tiles.push({ x, y });
    }
    return tiles.length ? tiles : null;
  }

  // Advance a confirmed auto-walk (from the loop, only while idle): step toward the destination as fast
  // as animations allow, recomputing the (fog-aware) route each step, and STOP if he took damage, if the
  // next tile is a threatened (red) one, or if he can no longer get any closer.
  function tickAutoMove() {
    if (!autoMove || !gameState || screen !== 'playing' || cardTargeting !== null || !isIdle()) return;
    if (tutGuide()) { clearAutoMove(); return; } // a lesson juncture takes over — no auto-walk through it
    const p = gameState.player;
    if (p.x === autoMove.tx && p.y === autoMove.ty) { clearAutoMove(); return; }          // arrived
    if (typeof autoMove.lastHp === 'number' && p.hp < autoMove.lastHp) { clearAutoMove(); return; } // got hit
    // The last step made NO progress (a stuck boulder shove, a knockback that cancelled it…) → stop
    // rather than hammer the same spot.
    if (autoMove.lastPos && autoMove.lastPos.x === p.x && autoMove.lastPos.y === p.y) { clearAutoMove(); return; }
    const m = nextStepToward(gameState, autoMove.tx, autoMove.ty);
    if (!m) { clearAutoMove(); return; }                                                   // can no longer path there
    const threats = getThreatenedTiles(gameState);                                         // Map keyed "x,y"
    if (threats && threats.has(`${m.x},${m.y}`)) { clearAutoMove(); return; }               // won't walk INTO danger
    // A step ONTO a breakable obstacle (a tree, a gate…) is a HIT, not a move — untouched it would be
    // hacked at until felled. Strike it just ONCE if he KNEW it was there when he set out (he chose to
    // path into it), and never if it only surfaced from the fog (don't waste a turn on a surprise).
    if (typeof isChoppable === 'function' && isChoppable(terrainAt(gameState, m.x, m.y))) {
      if (autoMove.knownAtStart && autoMove.knownAtStart.has(`${m.x},${m.y}`)) {
        clearPendingStep();
        handleStep(Math.sign(m.x - p.x), Math.sign(m.y - p.y)); // one strike at a known obstacle
      }
      clearAutoMove(); // then stop — after the single known hit, or immediately for a fog surprise
      return;
    }
    autoMove.lastHp = p.hp;
    autoMove.lastPos = { x: p.x, y: p.y }; // remember where he stepped FROM, to catch a no-op next tick
    clearPendingStep();
    handleStep(Math.sign(m.x - p.x), Math.sign(m.y - p.y));
  }

  // A mobile TAP while playing. An adjacent/reachable tile = move or strike NOW. A FAR tile shows a
  // move-path PROPOSAL highlighted on the board; tapping that same destination a SECOND time commits the
  // auto-walk. Menus / card-aiming fall back to the normal tap dispatch (option select / fire card).
  function mobileTap(clientX, clientY) {
    // TUTORIAL FREEZE: at a juncture only the glowing tile (or the ability card) answers. A tap on the
    // card phase does nothing here (the DOM card handles it); a tap off the target tile is swallowed.
    const guide = tutGuide();
    if (guide) {
      if (guide.card != null) return;
      const gt = tileFromClient(clientX, clientY);
      if (!guide.tiles || !guide.tiles.some((t) => t.x === gt.x && t.y === gt.y)) return;
    }
    if (screen !== 'playing' || cardTargeting !== null || !gameState) { dispatchTap(clientX, clientY); return; }
    const tile = tileFromClient(clientX, clientY);
    // Adjacent / reachable in one move → act immediately.
    if (getPlayerMoves(gameState).some((m) => m.x === tile.x && m.y === tile.y)) {
      clearPathProposal(); clearPendingStep();
      commitMove(movePlayerTo(gameState, tile.x, tile.y));
      return;
    }
    // His OWN tile: hold your ground (Warrior's Discipline) — tapping the king spends the turn in place,
    // exactly like pressing Space. skipTurn self-guards (it refuses with a beep if no foe is in sight).
    if (tile.x === gameState.player.x && tile.y === gameState.player.y) {
      clearPathProposal();
      if (gameState.player.discipline && isIdle()) commitMove(skipTurn(gameState));
      return;
    }
    // Off the board → just clear any proposal.
    if (tile.x < 0 || tile.y < 0 || tile.x >= WORLD_SIZE || tile.y >= WORLD_SIZE) {
      clearPathProposal();
      return;
    }
    // Second tap on the SAME proposed destination → COMMIT the auto-walk.
    if (pathProposal && pathProposal.tx === tile.x && pathProposal.ty === tile.y) {
      clearPathProposal();
      autoMove = {
        mode: 'path', tx: tile.x, ty: tile.y, lastHp: gameState.player.hp,
        // What he had ALREADY discovered when he set out — so a breakable obstacle he KNEW about gets one
        // strike, but one he only uncovers from the fog en route stops him instead of being hacked at.
        knownAtStart: new Set(Object.keys(gameState.explored || {})),
      };
      return;
    }
    // Otherwise PROPOSE a path to the tapped tile (if he can get anywhere toward it).
    const path = computePath(gameState, tile.x, tile.y);
    if (path) {
      pathProposal = { tx: tile.x, ty: tile.y };
      Renderer.setPathPreview({ tiles: path, dx: tile.x, dy: tile.y });
    } else {
      clearPathProposal();
    }
  }

  // --- TOUCH (phones/tablets). ONE finger: a still TAP navigates (adjacent = move/strike; a FAR tile
  // proposes a move-path — tap it again to walk there, see mobileTap), and a DRAG pans the camera. TWO
  // fingers pinch to zoom (and drag to pan). `touch-action:none` (styles.css) stops the page scrolling
  // under us; a mouse never emits touch events, so desktop is untouched.
  let touchStart = null;      // {x,y} where a one-finger gesture began (client coords)
  let touchMoved = false;     // has this touch passed TAP_SLOP? (then it's a pan-drag, not a tap)
  let panLast = null;         // last client pos while panning, for the incremental delta
  let pinch = null;           // two-finger gesture state, or null

  const fingerGap = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  const fingerMid = (t) => ({ cx: (t[0].clientX + t[1].clientX) / 2, cy: (t[0].clientY + t[1].clientY) / 2 });

  canvas.addEventListener('touchstart', (event) => {
    clearAutoMove(); // any new touch cancels a running auto-walk
    hideTilePopover();
    if (event.touches.length === 1) {
      const t = event.touches[0];
      touchStart = { x: t.clientX, y: t.clientY };
      touchMoved = false; pinch = null;
    } else if (event.touches.length === 2) {
      pinch = { dist: fingerGap(event.touches), ...fingerMid(event.touches) };
      touchStart = null; touchMoved = true;
    }
  }, { passive: false });

  canvas.addEventListener('touchmove', (event) => {
    // TWO fingers: zoom by the change in separation, pan by the change in midpoint — both at once.
    if (pinch && event.touches.length === 2) {
      event.preventDefault();
      const gap = fingerGap(event.touches);
      const mid = fingerMid(event.touches);
      const rect = canvas.getBoundingClientRect();
      const scale = canvas.width / rect.width;
      const zoomDelta = (gap - pinch.dist) * PINCH_ZOOM_SCALE;
      if (zoomDelta) Renderer.zoomBy(zoomDelta);
      Renderer.panByPixels((mid.cx - pinch.cx) * scale, (mid.cy - pinch.cy) * scale);
      pinch = { dist: gap, cx: mid.cx, cy: mid.cy };
      return;
    }
    // ONE finger: once it clearly moves it's a DRAG → PAN the camera (movement is by tapping).
    if (!touchStart || !event.touches.length) return;
    const t = event.touches[0];
    if (!touchMoved && Math.abs(t.clientX - touchStart.x) + Math.abs(t.clientY - touchStart.y) > TAP_SLOP) {
      touchMoved = true;
      panLast = { x: t.clientX, y: t.clientY };
    }
    if (touchMoved) {
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const scale = canvas.width / rect.width;
      Renderer.panByPixels((t.clientX - panLast.x) * scale, (t.clientY - panLast.y) * scale);
      panLast = { x: t.clientX, y: t.clientY };
    }
  }, { passive: false });

  canvas.addEventListener('touchend', (event) => {
    // A clean TAP (still finger, no drag): move/strike an adjacent tile, or propose/confirm a far path.
    if (touchStart && !touchMoved && event.changedTouches.length) {
      event.preventDefault();
      const t = event.changedTouches[0];
      mobileTap(t.clientX, t.clientY);
    }
    if (!event.touches.length) { touchStart = null; pinch = null; }
  }, { passive: false });

  canvas.addEventListener('touchcancel', () => {
    touchStart = null; pinch = null; touchMoved = false;
  });

  // KEEP THE INTERFACE A FIXED SIZE ON MOBILE. iOS Safari ignores our <meta user-scalable=no>, so a
  // two-finger pinch (or a double-tap) that lands on the HUD zooms the WHOLE PAGE and mangles the
  // layout. The PLAY AREA has its own pinch-to-zoom, but that runs on TOUCH events on the <canvas>
  // (see the handlers above) — Safari's page zoom rides on the separate GESTURE events, which we cancel
  // document-wide here. So the board still zooms; the interface never rescales.
  ['gesturestart', 'gesturechange', 'gestureend'].forEach((type) => {
    document.addEventListener(type, (event) => { event.preventDefault(); }, { passive: false });
  });
  // Double-tap-to-zoom is a second mechanism (and also rescales the page). Cancel the quick second tap
  // — but ONLY off the board: the canvas owns its own taps (and already suppresses their default), and
  // a one-finger SCROLL inside the full-screen modals never trips this (it needs two taps ≤300ms apart).
  let lastTouchEndAt = 0;
  document.addEventListener('touchend', (event) => {
    if (event.target && event.target.closest && event.target.closest('#game')) return;
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    if (now - lastTouchEndAt <= 300 && event.cancelable) event.preventDefault();
    lastTouchEndAt = now;
  }, { passive: false });

  canvas.addEventListener('mousemove', (event) => {
    const rect = canvas.getBoundingClientRect();
    const scale = canvas.width / rect.width;
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    if (dragging) {
      const dx = event.clientX - dragLast.x;
      const dy = event.clientY - dragLast.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) {
        dragMoved = true;
      }
      Renderer.panByPixels(dx * scale, dy * scale);
      dragLast = { x: event.clientX, y: event.clientY };
    }

    if (screen === 'title') {
      titleHover = Renderer.titleOptionAt(x * scale, y * scale);
      canvas.style.cursor = titleHover ? 'pointer' : 'default';
      return; // the popover is a play-screen thing
    }
    if (screen === 'class' || screen === 'trophies') {
      sceneHover = Renderer.sceneOptionAt(x * scale, y * scale);
      // On class select every king (and Back) is clickable; in the trophy room only the doorways and
      // Back are — a hovered medallion just shows its condition, so it gets no pointer cursor.
      const clickable = screen === 'class'
        ? Boolean(sceneHover)
        : sceneHover === 'back' || sceneHover === 'prev' || sceneHover === 'next';
      canvas.style.cursor = clickable ? 'pointer' : 'default';
      return;
    }
    // While AIMING, hovering a valid target moves the aim cursor there — so the AoE / spell-path
    // preview follows the MOUSE, not only the keyboard. This is what makes the Spectral Steed show its
    // whole L-path to wherever you point (it only ever tracked the keyboard cursor before).
    if (screen === 'playing' && cardTargeting !== null && cardTargets.length && typeof Renderer.screenToTile === 'function') {
      const tile = Renderer.screenToTile(x * scale, y * scale);
      const t = cardTargets.find((c) => c.x === tile.x && c.y === tile.y);
      if (t) cardCursor = { x: t.x, y: t.y };
    }
  });

  canvas.addEventListener('mouseleave', () => {
    dragging = false;
    hideTilePopover();
  });

  // Edge-of-WINDOW panning: the camera glides only when the cursor rests near an edge of the whole
  // browser window (not merely the play area) — so it works over the side panels too, and a mouse
  // resting inside the board never triggers it. Suppressed while dragging the board or the minimap,
  // or when the cursor is over the minimap itself (its bottom-right corner sits by the edge).
  const overMinimap = (event) => {
    if (!minimapEl) return false;
    const r = minimapEl.getBoundingClientRect();
    return event.clientX >= r.left && event.clientX <= r.right && event.clientY >= r.top && event.clientY <= r.bottom;
  };
  window.addEventListener('mousemove', (event) => {
    // Edge panning is opt-in (Options) — off by default, since the camera follows the king on every
    // move and drag / arrows / minimap all pan on purpose.
    if (!edgeScrollEnabled() || screen !== 'playing' || dragging || miniDragging || overMinimap(event)) {
      edgePan = { x: 0, y: 0 };
      return;
    }
    const w = window.innerWidth;
    const h = window.innerHeight;
    edgePan = {
      x: event.clientX < EDGE_MARGIN ? -1 : event.clientX > w - EDGE_MARGIN ? 1 : 0,
      y: event.clientY < EDGE_MARGIN ? -1 : event.clientY > h - EDGE_MARGIN ? 1 : 0,
    };
  });
  // Pointer left the window entirely (or the tab lost focus) — stop panning.
  document.addEventListener('mouseleave', () => { edgePan = { x: 0, y: 0 }; });
  window.addEventListener('blur', () => { edgePan = { x: 0, y: 0 }; });

  // Click-and-drag anywhere on the MINIMAP to pan the main view: the tile under the cursor snaps
  // to the center of the screen (and the minimap's view frame), so you can fling the camera across
  // the whole level at a glance. Works with mouse and touch.
  if (minimapEl) {
    const miniCenter = (clientX, clientY) => {
      if (!gameState || screen !== 'playing') return;
      const rect = minimapEl.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const px = (clientX - rect.left) * (minimapEl.width / rect.width);
      const py = (clientY - rect.top) * (minimapEl.height / rect.height);
      const tile = Renderer.minimapToTile(px, py);
      if (tile) Renderer.centerCameraOn(tile.x, tile.y);
    };
    minimapEl.addEventListener('mousedown', (event) => {
      event.preventDefault();
      miniDragging = true;
      miniCenter(event.clientX, event.clientY);
    });
    window.addEventListener('mousemove', (event) => {
      if (miniDragging) miniCenter(event.clientX, event.clientY);
    });
    window.addEventListener('mouseup', () => {
      miniDragging = false;
    });
    minimapEl.addEventListener('touchstart', (event) => {
      if (!event.touches.length) return;
      event.preventDefault();
      miniDragging = true;
      miniCenter(event.touches[0].clientX, event.touches[0].clientY);
    }, { passive: false });
    minimapEl.addEventListener('touchmove', (event) => {
      if (!miniDragging || !event.touches.length) return;
      event.preventDefault();
      miniCenter(event.touches[0].clientX, event.touches[0].clientY);
    }, { passive: false });
    window.addEventListener('touchend', () => {
      miniDragging = false;
    });
  }

  newGameButton.addEventListener('click', openClassSelect);
  classBackButton.addEventListener('click', showTitle);
  continueButton.addEventListener('click', continueGame);
  titleOptionsButton.addEventListener('click', openOptions);
  if (trophyButton) trophyButton.addEventListener('click', openTrophies);
  if (trophyCloseButton) trophyCloseButton.addEventListener('click', showTitle); // DOM back button (the trophy room is diegetic now; this is a harmless fallback)
  playAgainButton.addEventListener('click', openClassSelect);
  toTitleButton.addEventListener('click', showTitle);
  if (victoryContinueButton) victoryContinueButton.addEventListener('click', continueAfterVictory);
  victoryAgainButton.addEventListener('click', openClassSelect);
  victoryTitleButton.addEventListener('click', showTitle);
  // ONE overlay, TWO uses — the Skip button has to know which moment it is closing.
  if (altarCloseButton) altarCloseButton.addEventListener('click', () => (screen === 'altar' ? closeAltar() : closeLevelUp()));
  // Clicking ANYWHERE on the tip overlay dismisses it — the "Got it" button is just a visible cue
  // (its click bubbles up to this one handler, so a single tip is dismissed, not two).
  if (tutorialScreen) tutorialScreen.addEventListener('click', dismissTip);
  optionsButton.addEventListener('click', openOptions);
  optionsCloseButton.addEventListener('click', closeOptions);
  if (logToggle) {
    logToggle.addEventListener('click', () => {
      // Two modes: SHORT (a few lines) <-> LONG (fills the pane).
      const long = logEl.classList.toggle('long');
      logEl.classList.toggle('short', !long);
      logToggle.setAttribute('aria-expanded', String(long));
      logToggle.textContent = long ? '▾ Log' : '▸ Log';
      logEl.scrollTop = logEl.scrollHeight; // keep the newest line in view
    });
  }
  if (optionsCharacterButton) optionsCharacterButton.addEventListener('click', openCharacter);
  if (characterCloseButton) characterCloseButton.addEventListener('click', closeCharacter);
  if (confirmYesButton) confirmYesButton.addEventListener('click', () => {
    const act = pendingConfirm;
    closeConfirm();
    if (act) act();
  });
  if (confirmNoButton) confirmNoButton.addEventListener('click', closeConfirm);
  optionsToggle.addEventListener('click', () => {
    setTutorialsEnabled(!tutorialsEnabled());
    refreshOptions();
  });
  if (optionsSoundToggle) {
    optionsSoundToggle.addEventListener('click', () => {
      GameAudio.toggle();
      refreshOptions();
    });
  }
  if (optionsEdgeScroll) {
    optionsEdgeScroll.addEventListener('click', () => {
      setEdgeScrollEnabled(!edgeScrollEnabled());
      edgePan = { x: 0, y: 0 }; // stop any glide the instant it is switched off
      refreshOptions();
    });
  }
  optionsTitleButton.addEventListener('click', () => {
    // "Title Screen" in the options menu — the run auto-saves each move, so save the current state once
    // more and bail to the title; "Continue" there picks it right back up. (Restart Run was removed —
    // starting fresh belongs to the title's New Game, not a mid-run button.)
    if (gameState) saveGame(gameState);
    showTitle();
  });

  showTitle();
  requestAnimationFrame(step);
})();

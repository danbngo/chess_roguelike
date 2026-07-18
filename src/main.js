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
  const restartButton = document.getElementById('restart');
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
  const altarCloseButton = document.getElementById('altar-close');
  const cardBar = document.getElementById('card-bar');
  const cardHint = document.getElementById('card-hint');
  const invBar = document.getElementById('inv-bar');
  const invHint = document.getElementById('inv-hint');
  const tilePopover = document.getElementById('tile-popover');
  const tutorialScreen = document.getElementById('tutorial-screen');
  const tutorialTitle = document.getElementById('tutorial-title');
  const tutorialText = document.getElementById('tutorial-text');
  const optionsScreen = document.getElementById('options-screen');
  const optionsStatus = document.getElementById('options-tutorial-status');
  const optionsToggle = document.getElementById('options-toggle-tutorial');
  const optionsSoundToggle = document.getElementById('options-toggle-sound');
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
  const tutorialOkButton = document.getElementById('tutorial-ok');
  const tutorialDisableButton = document.getElementById('tutorial-disable');
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
  let pendingAction = null; // null | 'floor' | 'shot' | 'enemyshot' (resolve after the projectile lands)
  let pendingShot = null; // the player state to resolve once a ranged/spell projectile lands
  let pendingEnemyShot = null; // { state, hpBefore } — an ENEMY's volley in flight; its blow lands with it
  const PLAYER_MOVE_TIME = 0.16;
  const ENEMY_MOVE_TIME = 0.16;
  const SHOT_LEAD_TIME = 0.19; // arrow/bolt flies for this long before its hit resolves
  const LEVELUP_LEAD_TIME = 1.5; // beat between a guardian's death fanfare and the boon menu

  // Modal bookkeeping: which screen to return to when a tip / options closes.
  let pendingTips = [];
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
  }

  // Character level as a row of small star badges.
  function renderLevelBadges(level) {
    if (!levelLabel) return;
    levelLabel.innerHTML = '';
    for (let i = 0; i < level; i += 1) {
      const b = document.createElement('span');
      b.className = 'badge';
      b.textContent = '★';
      levelLabel.append(b);
    }
    levelLabel.title = `Level ${level}`;
  }

  function updateHud() {
    if (!gameState) {
      return;
    }
    const p = gameState.player;
    floorLabel.textContent = `Floor ${toRoman(gameState.floor)} · ${playerTitle(p)}`; // subclass name once committed
    if (floorNameLabel) floorNameLabel.textContent = floorName(gameState.floor);
    turnLabel.textContent = `Turn ${gameState.turn}${p.promotion > 0 ? ` · ♛ Beast Form ${p.promotion}` : ''}`;
    renderHearts(p.hp, p.maxHp);
    renderLevelBadges(p.level || 1);
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
    if (!invBar) return;
    invBar.innerHTML = '';
    if (invHint) invHint.classList.add('hidden');
    if (!gameState) return;
    const held = [];
    // The Orb of Victory is the last floor's key wearing a different hat (key.orb) — so it lands
    // here for free, and reads as the run-defining thing it is rather than another gold key.
    if (gameState.key && gameState.key.collected) {
      held.push(gameState.key.orb
        ? { cls: 'orb', glyph: '◉', title: 'Orb of Victory — the portal will open for you' }
        : { cls: 'key', glyph: '⚷', title: 'Floor key — the stair down is unlocked' });
    }
    for (const item of held) {
      const slot = document.createElement('div');
      slot.className = `inv-slot ${item.cls}`;
      slot.textContent = item.glyph;
      slot.title = item.title;
      invBar.append(slot);
    }
    if (invHint && held.length) invHint.classList.remove('hidden');
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
    if (/you have fallen|the king falls|game over|hurled screaming|blasts the king|slams into the king|bowls the king aside|strikes the king|wounds the king|the king is struck/.test(t)) {
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
    if (!text || text === lastLogged) {
      return;
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
    logEl.scrollTop = logEl.scrollHeight;
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
    // Owned cards, in inventory order (their 1-based index is the hotkey).
    gameState.player.cards.forEach((card, i) => {
      cardBar.append(makeCardSlot(card, i));
    });
    // The caption only shows when he actually HAS a card to press.
    if (cardHint && gameState.player.cards.length) cardHint.classList.remove('hidden');
    // The first time a card is armed, spell out what these things are and how to swing them.
    if (gameState.player.cards.some((c) => c.remaining === 0)) queueTip('cards');
  }

  // How many turns a card's ONGOING effect still has to run (0 = not currently active). Only cards
  // that cast a timed field of effect qualify — a plain strike has nothing to show here.
  function activeEffectTurns(card) {
    const p = gameState.player;
    if (card.kind === 'silence') return p.silence || 0;
    if (card.kind === 'promotion') return p.promotion || 0;
    return 0;
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
    if (!card || card.remaining > 0) {
      return;
    }
    // Can't even AIM a weapon card while wading (Amphibious/Druid lifts this); ability
    // cards (promotion / reload / swap) are exempt, matching useCard's own guard.
    const isAbilityCard = card.kind === 'promotion' || card.kind === 'reload' || card.kind === 'swap' || card.kind === 'blink' || card.kind === 'silence';
    const p = gameState.player;
    if (!isAbilityCard && !p.terrainImmune && isSlowTerrain(terrainAt(gameState, p.x, p.y))) {
      gameState.message = `You can't ready a weapon while wading through ${terrainAt(gameState, p.x, p.y)}.`;
      updateHud();
      return;
    }
    cardTargeting = index;
    cardTargets = getCardMoves(gameState, card);
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
    // Snap the cursor to the NEAREST HITTABLE ENEMY by default (offensive cards want a
    // foe, not empty ground) — falling back to the nearest reachable tile if none is armed.
    const foeTargets = cardTargets.filter((t) => gameState.enemies.some((e) => e.x === t.x && e.y === t.y));
    const preferred = (foeTargets.length ? foeTargets : cardTargets).slice().sort((a, b) => distToKing(a) - distToKing(b))[0];
    cardCursor = { x: preferred.x, y: preferred.y };
    gameState.message = `Aiming the ${classCategory(gameState.player.className)} ${card.kind} — cycle targets with the numpad/WSAD, then Enter/Space (or press ${index + 1} again) to fire; Esc to cancel.`;
    showCardInfo(card);
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
      case 'swap': return 'Target any unit in sight to trade places with it; arriving shoves other adjacent foes back a tile.';
      case 'enpassant': return 'Step 1 tile; also strikes one foe you pass (marked ✕).';
      case 'doublestep': return 'Dash the FULL 2 tiles in one direction (capturing at the end).';
      case 'horse': return 'A spectral steed tramples an L-shaped path to an aimed knight tile — you don’t move.';
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

  // Show the card being aimed in the right pane (BRIEF description, not the full piece text).
  function showCardInfo(card) {
    examineEl.innerHTML = '';
    addExamineBlock(`${card.kind} — ${classCategory(gameState.player.className)}`, cardInfoLines(card));
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

    if (card.kind === 'horse') {
      // The phantom steed scorches the whole L-path to the aimed knight tile.
      for (const t of knightLPath(p.x, p.y, cursor.x - p.x, cursor.y - p.y, gameState)) push(t.x, t.y);
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

  /* ------------------------------ tile popover --------------------------- */

  const TERRAIN_NAMES = {
    normal: 'Open ground',
    wall: 'Wall — blocks sight & movement',
    lava: 'Lava — crossable, but burns you 1 HP per turn you end on it (enemies wade free); clear to see through',
    water: 'Water — slow (cross one per move); no cards while wading',
    pit: 'Pit — a bottomless hole: nothing can cross it, but shots (yours OR a turret’s/boss’s) fly right over',
    boulder: 'Boulder — blocks sight & movement; step into it to SHOVE it (into a pit/lava/water fills the hole). Leaps crush it; spells blast it. Knocked, it ROLLS until it hits something',
    ice: 'Ice — a see-through slab: impassable to walkers (but a JUMPER can perch on it), and you can look past it. Fire/spells MELT it to water; a foe SLAMMED into it shatters it — but a leap onto it leaves it intact',
    geyser: 'Geyser — a demon-realm vent: every 3rd turn ALL geysers blow at once, scalding whatever stands on one for 1 HP (a tall plume warns the turn before). The erupting gas also blocks sight for that turn. Shove a boulder onto it to cap it; enemies shy off them',
    devilgrass: 'Tall grass — blocks sight but not movement; walk right through. Fire/spells WITHER it away; a rolling boulder flattens it',
    devilgrass_demon: 'Devilgrass — dry, dead husks that still block sight but not movement; walk right through. Fire/spells WITHER it away; a rolling boulder flattens it',
    gate: 'Gate — iron bars: they BAR the way but not the view. You can see (and shoot) straight through them, so you can case a room before committing to it. Walk into it to cut it down (3 swings); a rolling boulder buckles it, and a foe slammed into it bends the bars. Iron does not burn — spellfire will not touch it',
    tree: 'Tree — solid timber: blocks sight & movement, but it can come DOWN. Walk into it to chop (3 swings); a rolling boulder shears it through; a foe slammed into it cracks the trunk. Spellfire sets it ALIGHT — it burns where it stands, then is gone, leaving scorched ground',
    door: 'Door (shut) — blocks sight & fire, but you can walk/leap right onto it; doing so pushes it OPEN',
    dooropen: 'Doorway (open) — a clear, walkable threshold; blocks nothing. Left empty, it starts swinging shut',
    doorajar: 'Door (swinging shut) — still passable and clear, but it will close fully next turn unless something is in it',
  };

  // The level's outer edge is solid STONE (impassable rock), distinct from interior brick walls.
  function terrainLabel(tx, ty) {
    const t = terrainAt(gameState, tx, ty);
    if (t === 'wall' && (tx === 0 || ty === 0 || tx === WORLD_SIZE - 1 || ty === WORLD_SIZE - 1)) {
      return 'Stone — the impassable rock edge of the level';
    }
    // Same terrain, different realm: living grass up top, dry devilgrass husks below.
    if (t === 'devilgrass' && gameState && (gameState.floor || 1) >= DEMON_FLOOR) {
      return TERRAIN_NAMES.devilgrass_demon;
    }
    return TERRAIN_NAMES[t] || t;
  }

  // Build a human description of a tile (or null if there is nothing to say).
  function describeTile(tx, ty) {
    if (!gameState || tx < 0 || tx >= WORLD_SIZE || ty < 0 || ty >= WORLD_SIZE) {
      return null;
    }
    if (!(gameState.explored && gameState.explored[`${tx},${ty}`])) {
      return 'Unexplored — shrouded in fog of war.';
    }
    const visible = inLineOfSight(gameState, tx, ty);
    const lines = [];
    if (gameState.player.x === tx && gameState.player.y === ty) {
      lines.push('Your king');
    }
    lines.push(terrainLabel(tx, ty));
    if (visible) {
      const enemy = gameState.enemies.find((e) => e.x === tx && e.y === ty);
      if (enemy) {
        let tag;
        if (enemy.turret) {
          tag = enemy.fire
            ? ` (FIRE turret — piercing spellfire through units; 3-turn cycle; HP ${enemy.hp}/${enemy.maxHp})`
            : ` (turret — fixed; fires its pattern; HP ${enemy.hp}/${enemy.maxHp})`;
        } else if (enemy.summonCircle) {
          tag = ' (summoning circle — spawns foes; step on it to destroy)';
        } else if (enemy.boss) {
          const perks = (enemy.bossPerks && enemy.bossPerks.length ? enemy.bossPerks : [enemy.bossPerk]).filter(Boolean);
          const perk = perks.length ? `; ${perks.join(', ')}` : '';
          tag = ` (${enemy.mini ? 'mini-boss' : 'boss'} — HP ${enemy.hp}/${enemy.maxHp}${perk})`;
        } else {
          tag = enemy.asleep ? ' (asleep)' : enemy.surprised ? ' (surprised)' : enemy.awake ? ' (hostile)' : '';
        }
        // Confusion is true of EVERY kind of piece, so it is appended to whatever tag the branches
        // above chose rather than being one more case inside them — a confused turret is still a
        // turret, and the player wants to read both facts.
        if (enemy.confused) tag += ' — CONFUSED';
        if (gameState.player.beastFriend && typeof isNeutralBeast === 'function' && isNeutralBeast(gameState, enemy)) tag += ' — neutral (step beside it to tame it)';
        lines.push(`Enemy: ${enemy.kind}${tag}`);
      }
    }
    const ally = (gameState.allies || []).find((a) => a.x === tx && a.y === ty);
    if (ally) {
      lines.push(`Ally: ${ally.kind}${ally.familiar ? ' (familiar)' : ally.undead ? ' (undead)' : ''}`);
    }
    const onBuilding = (b) => b && b.x === tx && b.y === ty && (b.discovered || visible);
    if (onBuilding(gameState.exit)) {
      if (gameState.exit.portal) lines.push(gameState.exit.locked ? 'Victory portal — dormant until you seize the Orb' : 'Victory portal — step in to escape and win!');
      else lines.push(gameState.exit.locked ? 'Stairs down — sealed until you find the key' : 'Stairs down to the next floor');
    }
    if (gameState.key && !gameState.key.collected && onBuilding(gameState.key)) {
      lines.push(gameState.key.orb ? 'Orb of Victory — seize it to open the portal (but guardians will converge!)' : 'Floor key — collect it to unlock the stair');
    }
    // The way he came IN. Cosmetic — but it has to SAY that, or a stair-shaped thing you cannot use
    // just reads as a bug.
    if (gameState.upstair && gameState.upstair.x === tx && gameState.upstair.y === ty) {
      lines.push('Collapsed stairway — the way you came in, caved in behind you. There is no going back; it only marks where this floor began.');
    }
    return lines.join('\n');
  }

  function showTilePopover(event, canvasX, canvasY) {
    if (screen !== 'playing') {
      hideTilePopover();
      return;
    }
    const { x, y } = Renderer.screenToTile(canvasX, canvasY);
    // Ring whoever covers this square. threatenersOf is the SAME reckoning that paints the red tint
    // (same ghost: his body out of the way, the key gone, doors judged open), so the highlight can
    // never contradict the colour of the tile the player is pointing at.
    Renderer.markThreats(gameState ? threatenersOf(gameState, x, y).map((e) => e.id) : []);
    const text = describeTile(x, y);
    if (!text) {
      hideTilePopover();
      return;
    }
    tilePopover.textContent = text;
    tilePopover.style.left = `${event.clientX + 14}px`;
    tilePopover.style.top = `${event.clientY + 14}px`;
    tilePopover.classList.remove('hidden');
  }

  function hideTilePopover() {
    Renderer.markThreats([]); // the cursor is gone — so are the rings
    tilePopover.classList.add('hidden');
    tilePopover.classList.remove('wide'); // reset the class-details widening
  }

  /* ------------------------------ examine pane --------------------------- */

  const PIECE_INFO = {
    pawn: 'Steps one tile orthogonally; captures one tile diagonally.',
    mann: 'Steps and captures one tile in any direction — a non-royal king. Skeletal: the Necromancer’s risen familiar.',
    berolina: 'Steps one tile diagonally; captures one tile orthogonally.',
    knight: 'Leaps in an L (two and one), clear over anything between.',
    bishop: 'Slides any distance diagonally.',
    rook: 'Slides any distance orthogonally.',
    queen: 'Slides any distance in any direction.',
    nightrider: 'Repeats a knight’s leap outward in a line — bounding across the floor until a body or a wall halts it. Cannot touch what stands beside it.',
    archbishop: 'Moves as a bishop or a knight.',
    chancellor: 'Moves as a rook or a knight.',
    amazon: 'Moves as a queen or a knight — the realm’s final guardian.',
    king: 'Moves one tile in any direction — a weak, common foe worth capturing.',
    ferz: 'Steps and captures one tile diagonally — a feeble, dazed piece (what a Hex warps a foe into).',
    enpassant: 'Step one tile in any direction (capturing a foe there), and strike one foe you pass — a piece that was beside your starting tile.',
    doublestep: 'Dash up to two tiles in any one direction, repositioning onto open ground or capturing a foe at the far tile. A nimble on-demand maneuver.',
    banish: 'Send ANY foe, turret or rogue mini-boss you can see clean out of the world — it is simply gone, leaving a puff of smoke. It is NOT a kill: no boon, no corpse. A floor guardian and a summoning circle cannot be shifted. Cooldown 9.',
    silence: 'Every foe you can SEE drops into a dead sleep for 3 turns — walk through them, or walk away. A free action; it breaks the instant you strike anything. Cooldown 9.',
    confuse: 'Every foe you can SEE loses track of which side it is on. A confused piece either strikes whatever is nearest — its OWN kind included — or blunders off at random, an even chance of each. Nothing is immune: turrets, guardians and summoning circles all lose the thread. The fog lifts by itself about every other turn, and ANY blow you land snaps that piece straight out of it. Costs a turn. Cooldown 9.',
    blink: 'Flicker to a random SAFE tile in sight — one no visible foe threatens. A free action (costs no turn); does nothing if there is no refuge. Cooldown 6.',
    fireball: 'Hurl a fireball along any queen line. It strikes your target AND washes spellfire over every tile around it — which burns YOU and your allies if you are standing in the ring. Cooldown 7.',
    promotion: 'Become an INVINCIBLE warhorse for 3 turns: leap like a knight (and step a tile), take no damage, use no weapon cards. Free to cast, cooldown 9.',
    reload: 'Spend your turn to recharge every other card at once.',
    swap: 'Trade places with any unit in sight — enemy or turret. No damage.',
  };

  // One-line descriptions of each enemy role (for the examine pane).
  const ROLE_INFO = {
    turret: 'Turret — fixed; fires its piece pattern (1 turn to lock on, then fires). Destructible (3 HP), struck in place like a boss. FIRE turrets (reddish, floor 5+) loose piercing spellfire THROUGH units on a slower 3-turn cycle.',
    circle: 'Summoning circle — conjures foes while it sees you; step on it to destroy it.',
    boss: 'Boss — a high-mobility guardian with a HP bar.',
  };

  function setExamineEmpty(text) {
    examineEl.innerHTML = '';
    const p = document.createElement('p');
    p.className = 'examine-empty';
    p.textContent = text;
    examineEl.append(p);
  }

  function addExamineBlock(title, lines) {
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

  // Populate the right pane with full detail about a clicked tile.
  function examineTile(tx, ty) {
    if (!gameState || tx < 0 || tx >= WORLD_SIZE || ty < 0 || ty >= WORLD_SIZE) {
      setExamineEmpty('Click a tile to inspect it.');
      return;
    }
    if (!(gameState.explored && gameState.explored[`${tx},${ty}`])) {
      setExamineEmpty('Unexplored — shrouded in fog of war.');
      return;
    }
    examineEl.innerHTML = '';
    const visible = inLineOfSight(gameState, tx, ty);
    addExamineBlock(`Tile (${tx}, ${ty})`, terrainLabel(tx, ty));

    if (gameState.player.x === tx && gameState.player.y === ty) {
      const p = gameState.player;
      const stats = [`HP ${p.hp}/${p.maxHp}`, `Sight ${p.vision}`, `Move ${p.moveRange}`, `Level ${p.level || 1}`];
      stats.push(`Cards — ${(p.cards || []).length} ${classCategory(p.className)}`);
      const cls = CLASSES[p.className];
      addExamineBlock(cls ? `${cls.name} King` : 'Your King', stats);
      if (cls && (cls.startPerk || (p.takenPerks || []).length)) {
        const names = [];
        if (cls.startPerk) names.push(`${cls.startPerk.name} (innate)`);
        for (const id of (p.takenPerks || [])) names.push((cls.perks.find((k) => k.id === id) || { name: id }).name);
        addExamineBlock('Perks', names);
      }
    }

    if (visible) {
      const enemy = gameState.enemies.find((e) => e.x === tx && e.y === ty);
      if (enemy) {
        const st = gameState.player.beastFriend && typeof isNeutralBeast === 'function' && isNeutralBeast(gameState, enemy)
          ? 'Neutral — a wild beast at truce. It roams and takes no interest in you, and nothing else picks a fight with it. Step BESIDE it and it joins you; strike it and the truce is off for good'
          : enemy.confused
          ? 'Confused — strikes whatever is nearest, its own side included, or blunders off at random. Any blow you land snaps it out of it'
          : enemy.boss && enemy.dormant
          ? (gameState.key && gameState.key.orb ? 'Dormant — guarding the Orb (wakes on sight)' : 'Dormant — guarding the key (wakes on sight)')
          : enemy.surprised
            ? 'Surprised — frozen this turn'
            : enemy.frustrated
              ? 'Frustrated — no legal move'
              : enemy.awake
                ? 'Hostile — hunting the king'
                : 'Unaware — wandering';
        const hpLine = enemy.boss && enemy.maxHp ? `HP ${enemy.hp}/${enemy.maxHp}` : null;
        const perkLine = enemy.boss && enemy.bossPerk ? (BOSS_PERK_LABELS[enemy.bossPerk] || null) : null;
        const title = enemy.boss ? `${enemy.mini ? 'Mini-boss' : 'Boss'} — ${(enemy.bossName || enemy.kind).replace(/^the /, '')}` : `Enemy — ${enemy.kind}`;
        addExamineBlock(title, [PIECE_INFO[enemy.kind] || '', ROLE_INFO[enemyRole(enemy)] || null, hpLine, perkLine, st]);
      }
    }

    const onBuilding = (b) => b && b.x === tx && b.y === ty && (b.discovered || visible);
    if (onBuilding(gameState.exit)) {
      if (gameState.exit.portal) {
        addExamineBlock('Victory portal', gameState.exit.locked
          ? 'The way home — but it lies dormant until you seize the Orb of Victory. Step in with the Orb to win the run.'
          : 'Step into the portal to escape the realm and WIN the run.');
      } else {
        addExamineBlock('Stairs', gameState.exit.locked
          ? 'Descend to the next floor — but the stair is sealed until you collect this floor’s key.'
          : 'Descend to the next floor — you fully heal and gain a level.');
      }
    }
    if (gameState.key && !gameState.key.collected && onBuilding(gameState.key)) {
      if (gameState.key.orb) addExamineBlock('Orb of Victory', 'Seize it to open the portal home — but the realm’s guardians will converge on you the moment you do.');
      else addExamineBlock('Floor key', 'Walk onto it to collect it — the stair down then unlocks.');
    }

    const scar = (gameState.scars || []).find((s) => s.x === tx && s.y === ty);
    if (scar && (gameState.explored || {})[`${tx},${ty}`]) {
      addExamineBlock('Ruined circle', 'A shattered summoning circle — it conjures no more.');
    }
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

  // Restart the HP counter's damage animation (re-add the class after a reflow).
  function flashHealth() {
    healthLabel.classList.remove('damage');
    void healthLabel.offsetWidth;
    healthLabel.classList.add('damage');
  }

  function applyState(nextState, animate) {
    gameState = nextState;
    updateHud();
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
      for (const b of nextState.shoveBumps) Renderer.bumpEnemy(b.id, b.dx, b.dy);
      nextState.shoveBumps = [];
    }
    // Drain SMOKE PUFFS: a Warper/Shadowstep/Burrower leaves smoke where it vanished and where it
    // reappears. Drained here so it fires once, from whichever phase produced it.
    if (nextState.puffs && nextState.puffs.length) {
      for (const pf of nextState.puffs) Renderer.puff(pf.x, pf.y);
      nextState.puffs = [];
    }
    if (animate) {
      Renderer.sync(nextState);
    } else {
      Renderer.reset(nextState);
    }
  }

  /* ------------------------------ tutorials ------------------------------ */

  // Queue a tip if tips are on and this one hasn't been seen, then show it as
  // soon as no other modal is up. Showing a tip pauses the game.
  function queueTip(id) {
    if (!tutorialsEnabled() || tipSeen(id) || pendingTips.includes(id) || !TUTORIALS[id]) {
      return;
    }
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
    tutorialTitle.textContent = TUTORIALS[id].title;
    tutorialText.textContent = TUTORIALS[id].text;
    tutorialScreen.classList.remove('hidden');
  }

  function dismissTip() {
    const id = pendingTips.shift();
    if (id) {
      markTipSeen(id);
    }
    if (pendingTips.length) {
      presentTip(pendingTips[0]);
    } else {
      tutorialScreen.classList.add('hidden');
      screen = screenBeforeModal;
    }
  }

  function disableTipsFromModal() {
    setTutorialsEnabled(false);
    pendingTips = [];
    tutorialScreen.classList.add('hidden');
    screen = screenBeforeModal;
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
    void state;
  }

  // Show the "sealed stair / portal" explainer ONLY the first time the king stands on a locked exit.
  function maybeShowLockedExitTip(state) {
    if (!state || !state.exit || !state.exit.locked) return;
    if (state.player.x === state.exit.x && state.player.y === state.exit.y) {
      queueTip(state.exit.portal ? 'portalLocked' : 'stairLocked');
    }
  }

  /* ------------------------------- options ------------------------------- */

  function refreshOptions() {
    const enabled = tutorialsEnabled();
    optionsStatus.textContent = `Tutorial tips are currently ${enabled ? 'ON' : 'OFF'}.`;
    optionsToggle.textContent = enabled ? 'Disable tutorials' : 'Enable tutorials';
    if (optionsSoundToggle) optionsSoundToggle.textContent = GameAudio.isEnabled() ? 'Sound: On' : 'Sound: Off';
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
    // The INNATE class trait leads the list, tagged so it reads apart from the perks he CHOSE.
    const perkRows = [];
    if (cls && cls.startPerk) {
      perkRows.push({ text: `${cls.startPerk.name} (innate) — ${cls.startPerk.desc}`, color: cls.color || null });
    }
    if (taken.length && cls) {
      for (const id of taken) {
        const perk = cls.perks.find((k) => k.id === id) || { name: id, desc: '' };
        const text = perk.desc ? `${perk.name} — ${perk.desc}` : perk.name;
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

  function openTrophies() {
    screen = 'trophies';
    gameState = null;
    trophyPage = 0;
    sceneHover = null;
    buildTrophyPages();
    document.body.classList.remove('in-game');
    document.body.classList.add('on-title');
    hideOverlays(); // the diegetic hall IS the screen — no DOM card
  }

  function pageTrophies(delta) {
    const pageCount = Math.max(1, trophyPages.length);
    trophyPage = Math.max(0, Math.min(pageCount - 1, trophyPage + delta));
    sceneHover = null;
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
    logEl.innerHTML = '';
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
    setExamineEmpty('Click a tile to inspect it.');
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
  const PIECE_GLYPH = { knight: '♞', bishop: '♝', rook: '♜', king: '♚' };
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
    resetSeenTips(); // tutorial tips reset every run, so they play again on a fresh game
    startGame(createInitialState(classKey || 'warrior', difficulty || 'hard'));
    saveGame(gameState);
    queueTip('welcome');
    scanVisibleTips(gameState);
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
    // The boon was already earned by slaying the boss; descending just builds the
    // next floor (no level-up screen here).
    applyState(nextFloor(gameState), false);
    enemyQueue = [];
    animTimer = 0;
    pendingAction = null;
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

  function onGameOver() {
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
    queueTip('newGamePlus');
  }

  // New Game + : having won, press on into the endless depths, build intact.
  function continueAfterVictory() {
    screen = 'playing';
    gameState.won = false;
    document.body.classList.add('in-game');
    document.body.classList.remove('on-title');
    hideOverlays();
    goNextFloor();
  }

  /* ------------------------------ level up ------------------------------- */

  // After each descent, choose one of two class boons (reusing the altar overlay).
  function renderLevelUp() {
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

  function openLevelUp() {
    screen = 'levelup';
    renderLevelUp();
    altarScreen.classList.remove('hidden');
    queueTip('levelup');
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
    setExamineEmpty('Click a tile to inspect it.');
    saveGame(gameState);
    scanVisibleTips(gameState);
  }

  /* ------------------------------ turn flow ------------------------------ */

  // Every player-initiated move/card goes through here. If the resolved move would
  // DESCEND the stair while the floor's boss is still alive (the king is slipping past
  // it, forfeiting the boon), confirm first; otherwise apply immediately.
  function commitMove(result) {
    if (result.lastAction === 'exit' && !bossDefeated(result)) {
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
      onGameOver();
      return;
    }
    if (nextState.lastAction === 'exit') {
      GameAudio.play('descend');
      pendingAction = 'floor';
      animTimer = PLAYER_MOVE_TIME;
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
      const idx = gameState.player.cards.findIndex((c) => c.doubleReady);
      if (idx >= 0 && getCardMoves(gameState, gameState.player.cards[idx]).length > 0) {
        toggleCardTargeting(idx); // re-open the aim overlay for the bonus shot
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
        onGameOver();
        return;
      }
      maybeOpenLevelUp(); // a free-action boss kill still earns its boon
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
    const phase = beginEnemyPhase(gameState);
    applyState(phase.state, true);
    // A guardian STARTLED this phase roars now — on the same turn its "!" goes up. That shout is
    // raised by the phase itself, not by a mover (a gasping boss doesn't act), so nothing in the
    // per-mover path would ever show it.
    showBossShout();
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
      GameAudio.play('roar');
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
    if (gameState.player.hp < hpBefore) {
      Renderer.effect(gameState.gameOver ? 'death' : 'hit');
      GameAudio.play(gameState.gameOver ? 'death' : 'hit');
      flashHealth();
      if (!gameState.gameOver) {
        queueTip('hp');
      }
    } else if (gameState.player.deflected) {
      // A blow landed but was warded/parried away — flash a blue block.
      Renderer.effect('deflect');
      GameAudio.play('deflect');
    }
    if (gameState.gameOver) {
      enemyQueue = [];
      // Let the death flash/shake play for a beat before the overlay drops.
      pendingAction = 'gameover';
      animTimer = ENEMY_MOVE_TIME * 2.5;
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
        enemyQueue = [];
        pendingAction = 'floor';
        animTimer = PLAYER_MOVE_TIME;
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
    if (gameState.dangerEvent) {
      // A danger event fired — a gentle rumble tinted the event's OWN colour (so the player reads
      // at a glance which hazard struck), the alarm cue, the exact log line, and a one-time tip.
      Renderer.effect('danger', DANGER_TINTS[gameState.dangerEvent.kind] || DANGER_TINTS.wave);
      GameAudio.play('doom');
      logMessage(gameState.dangerEvent.message);
      queueTip('dangerEvent');
    }
    saveGame(gameState);
    maybeOpenLevelUp(); // if this turn slew the boss, offer the boon now
  }

  function handleStep(dx, dy) {
    if (!isIdle()) {
      return;
    }
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
    const rect = canvas.getBoundingClientRect();
    const scale = canvas.width / rect.width;
    const { x: tileX, y: tileY } = Renderer.screenToTile((event.clientX - rect.left) * scale, (event.clientY - rect.top) * scale);

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
      } else {
        examineTile(tileX, tileY);
      }
      return;
    }

    // A click on a reachable tile moves the king there; any other click inspects
    // the tile in the right-hand pane.
    const canMove = isIdle() && getPlayerMoves(gameState).some((move) => move.x === tileX && move.y === tileY);
    if (canMove) {
      commitMove(movePlayerTo(gameState, tileX, tileY));
    } else {
      examineTile(tileX, tileY);
    }
  }

  /* ------------------------------ game loop ------------------------------ */

  let lastTime = 0;

  function step(timestamp) {
    if (!lastTime) {
      lastTime = timestamp;
    }
    const delta = (timestamp - lastTime) / 1000;
    lastTime = timestamp;

    if (screen === 'playing' && animTimer > 0) {
      animTimer = Math.max(0, animTimer - delta);
      if (animTimer === 0) {
        if (pendingAction === 'shot') {
          pendingAction = null;
          const s = pendingShot;
          pendingShot = null;
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
    else if (screen === 'gameover') GameAudio.setTrack('death');
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

    Renderer.update(delta);
    if (screen === 'title') {
      // The whole title screen is the board now — the menu options are tiles on it.
      Renderer.drawTitle(titleMenuModel());
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
      Renderer.draw(gameState, isIdle() && !aiming, targets, aiming ? cardCursor : null, aoe);
    }
    requestAnimationFrame(step);
  }

  /* ------------------------------- wiring -------------------------------- */

  document.addEventListener('keydown', (event) => {

    // F2 saves a PNG of the board — handy for grabbing store-page screenshots. Works on any screen.
    if (event.key === 'F2') {
      event.preventDefault();
      saveScreenshot();
      return;
    }

    // A tutorial tip is up: Enter / Space / Escape all dismiss it (like the "Got it" button).
    if (screen === 'tutorial') {
      if (event.key === 'Enter' || event.key === 'Escape' || event.key === ' ' || event.code === 'Space') {
        event.preventDefault();
        dismissTip();
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

    const move = resolveMove(event);
    if (move) {
      event.preventDefault();
      handleStep(move[0], move[1]);
      return;
    }
    // Arrow keys pan the camera.
    const pan = resolvePan(event);
    if (pan) {
      event.preventDefault();
      Renderer.panBy(pan[0] * KEY_PAN_STEP, pan[1] * KEY_PAN_STEP);
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

  canvas.addEventListener('click', (event) => {
    if (suppressClick) {
      suppressClick = false; // this "click" was the end of a drag
      return;
    }
    if (screen === 'title') {
      const rect = canvas.getBoundingClientRect();
      const scale = canvas.width / rect.width;
      const id = Renderer.titleOptionAt((event.clientX - rect.left) * scale, (event.clientY - rect.top) * scale);
      if (id) {
        const opt = titleMenuModel().options.find((o) => o.id === id);
        if (opt && opt.enabled && opt.action) opt.action();
      }
      return;
    }
    if (screen === 'class' || screen === 'trophies') {
      const rect = canvas.getBoundingClientRect();
      const scale = canvas.width / rect.width;
      const id = Renderer.sceneOptionAt((event.clientX - rect.left) * scale, (event.clientY - rect.top) * scale);
      if (id) handleSceneClick(id);
      return;
    }
    handleClick(event);
  });

  // A click on the diegetic class-select or trophy scene, by the hit-rect id the renderer reported.
  function handleSceneClick(id) {
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
    showTilePopover(event, x * scale, y * scale);
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
    if (screen !== 'playing' || dragging || miniDragging || overMinimap(event)) {
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
  victoryContinueButton.addEventListener('click', continueAfterVictory);
  victoryAgainButton.addEventListener('click', openClassSelect);
  victoryTitleButton.addEventListener('click', showTitle);
  if (altarCloseButton) altarCloseButton.addEventListener('click', closeLevelUp);
  tutorialOkButton.addEventListener('click', dismissTip);
  tutorialDisableButton.addEventListener('click', disableTipsFromModal);
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
    if (tutorialsEnabled()) {
      setTutorialsEnabled(false);
    } else {
      setTutorialsEnabled(true);
      resetSeenTips(); // Let the tips play again from the start.
    }
    refreshOptions();
  });
  if (optionsSoundToggle) {
    optionsSoundToggle.addEventListener('click', () => {
      GameAudio.toggle();
      refreshOptions();
    });
  }
  restartButton.addEventListener('click', () => {
    confirmNewGame(newGame); // "Restart Run" in the options menu — confirm before wiping the current one
  });

  showTitle();
  requestAnimationFrame(step);
})();

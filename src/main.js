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
  let pendingAction = null; // null | 'floor' | 'shot' (resolve after the projectile lands)
  let pendingShot = null; // the player state to resolve once a ranged/spell projectile lands
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
    if (cardTargeting === i) {
      slot.classList.add('targeting');
    } else if (onCooldown) {
      slot.classList.add('cooldown');
    } else {
      slot.classList.add('ready');
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
    const isAbilityCard = card.kind === 'promotion' || card.kind === 'reload' || card.kind === 'swap';
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
      for (const t of knightLPath(p.x, p.y, cursor.x - p.x, cursor.y - p.y)) push(t.x, t.y);
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
    ice: 'Ice — a see-through slab: impassable, but you can look past it. Fire/spells MELT it to water; a leap onto it (or a foe slammed into it) SHATTERS it',
    devilgrass: 'Devilgrass — blocks sight but not movement; walk right through. Fire/spells WITHER it away; a rolling boulder flattens it',
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
          const perk = enemy.bossPerk ? `; ${enemy.bossPerk}` : '';
          tag = ` (${enemy.mini ? 'mini-boss' : 'boss'} — HP ${enemy.hp}/${enemy.maxHp}${perk})`;
        } else {
          tag = enemy.asleep ? ' (asleep)' : enemy.surprised ? ' (surprised)' : enemy.awake ? ' (hostile)' : '';
        }
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
    return lines.join('\n');
  }

  function showTilePopover(event, canvasX, canvasY) {
    if (screen !== 'playing') {
      hideTilePopover();
      return;
    }
    const { x, y } = Renderer.screenToTile(canvasX, canvasY);
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
    archbishop: 'Moves as a bishop or a knight.',
    chancellor: 'Moves as a rook or a knight.',
    amazon: 'Moves as a queen or a knight — the realm’s final guardian.',
    king: 'Moves one tile in any direction — a weak, common foe worth capturing.',
    ferz: 'Steps and captures one tile diagonally — a feeble, dazed piece (what a Hex warps a foe into).',
    enpassant: 'Step one tile in any direction (capturing a foe there), and strike one foe you pass — a piece that was beside your starting tile.',
    doublestep: 'Dash up to two tiles in any one direction, repositioning onto open ground or capturing a foe at the far tile. A nimble on-demand maneuver.',
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
      if ((p.takenPerks || []).length && cls) {
        addExamineBlock('Perks', p.takenPerks.map((id) => (cls.perks.find((k) => k.id === id) || { name: id }).name));
      }
    }

    if (visible) {
      const enemy = gameState.enemies.find((e) => e.x === tx && e.y === ty);
      if (enemy) {
        const st = enemy.boss && enemy.dormant
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
    characterBody.append(characterBlock(`Perks (${taken.length})`, taken.length && cls
      ? taken.map((id) => {
          const perk = cls.perks.find((k) => k.id === id) || { name: id, desc: '' };
          const text = perk.desc ? `${perk.name} — ${perk.desc}` : perk.name;
          return { text, color: chainColors[perk.chain] || null };
        })
      : ['No perks taken yet.']));
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

  // The TROPHY ROOM: the whole badge case, earned and unearned, off the title screen. Locked badges
  // are listed too (greyed, with their condition spelled out) — they double as a to-do list.
  function renderTrophies() {
    if (!trophyBody) return;
    trophyBody.innerHTML = '';
    let store = {};
    try {
      store = loadAchievements() || {};
    } catch {
      store = {};
    }
    const all = typeof ACHIEVEMENTS !== 'undefined' ? ACHIEVEMENTS : [];
    const held = all.filter((a) => store[a.id]);
    if (trophySub) {
      trophySub.textContent = `${held.length} of ${all.length} earned`
        + (held.length ? ` · ${held.filter((a) => store[a.id] === 'gold').length} gold` : '');
    }
    const shelf = document.createElement('div');
    shelf.className = 'badge-shelf trophy-shelf';
    // Earned first (gold → silver → bronze), then the ones still to win.
    const rank = (a) => (store[a.id] ? 3 - ['bronze', 'silver', 'gold'].indexOf(store[a.id]) : 9);
    for (const a of all.slice().sort((x, y) => rank(x) - rank(y))) {
      const tier = store[a.id];
      const el = document.createElement('div');
      el.className = `ach-badge ${tier ? 'badge-new' : 'badge-locked'}`;
      el.style.color = tier ? (ACH_TIER_COLOR[tier] || '#cbd5e1') : '#64748b';
      el.innerHTML =
        `<span class="badge-name">${tier ? '' : '🔒 '}${a.name}</span>` +
        `<span class="badge-tier">${tier ? ACH_TIER_LABEL[tier] : 'Locked'}</span>` +
        `<span class="badge-desc">${a.desc}</span>`;
      shelf.append(el);
    }
    trophyBody.append(shelf);
  }

  function openTrophies() {
    screenBeforeModal = screen;
    screen = 'trophies';
    renderTrophies();
    if (trophyScreen) trophyScreen.classList.remove('hidden');
  }

  function closeTrophies() {
    if (trophyScreen) trophyScreen.classList.add('hidden');
    screen = screenBeforeModal === 'trophies' ? 'title' : screenBeforeModal;
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
    titleScreen.classList.remove('hidden');
    continueButton.disabled = !hasSave();
    renderRunTable(titleRunTable, null);
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
    cls.perks.forEach((perk) => lines.push(`   – ${perk.name}: ${perk.desc}`));
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
  function openClassSelect() {
    screen = 'class';
    hideOverlays();
    classScreen.classList.remove('hidden');
    classList.innerHTML = '';
    for (const key of Object.keys(CLASSES)) {
      const cls = CLASSES[key];
      const row = document.createElement('li');
      row.className = 'shop-item class-item';
      const info = document.createElement('div');
      info.className = 'shop-info';
      info.innerHTML =
        `<span class="shop-name" style="color:${cls.color}">${cls.name}</span>` +
        `<span class="shop-desc">${cls.blurb}</span>`;
      const pick = document.createElement('button');
      pick.type = 'button';
      pick.textContent = 'Choose';
      pick.addEventListener('click', () => {
        hideClassPopover();
        openDifficultySelect(key);
      });
      row.addEventListener('mouseenter', (e) => showClassPopover(key, e));
      row.addEventListener('mousemove', (e) => showClassPopover(key, e));
      row.addEventListener('mouseleave', hideClassPopover);
      row.append(info, pick);
      classList.append(row);
    }
  }

  // After the class, pick a difficulty for the run (reuses the class-select screen).
  // Difficulty is ONE dial: starting HP. The dungeon itself — spawns, dread clock, foes — is
  // identical at every setting. Achievements badge bronze / silver / gold for easy / hard / nightmare.
  const DIFFICULTIES = [
    { key: 'easy', name: 'Easy', color: '#4ade80', blurb: 'A forgiving descent — the thickest skin. Badges earn BRONZE.' },
    { key: 'hard', name: 'Hard', color: '#fbbf24', blurb: 'The standard trial. Badges earn SILVER.', recommended: true },
    { key: 'nightmare', name: 'Nightmare', color: '#ef4444', blurb: 'The same dungeon, met with a thin skin. Badges earn GOLD.' },
  ];
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
      row.append(info, pick);
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
      const el = document.createElement('div');
      el.className = `ach-badge ${a.fresh || a.upgraded ? 'badge-new' : 'badge-old'}`;
      el.style.color = ACH_TIER_COLOR[a.tier] || '#cbd5e1';
      el.innerHTML =
        `<span class="badge-name">${a.name}</span>` +
        `<span class="badge-tier">${ACH_TIER_LABEL[a.tier] || a.tier}${a.upgraded ? ' — upgraded!' : a.fresh ? ' — new!' : ''}</span>` +
        `<span class="badge-desc">${a.desc}</span>`;
      container.append(el);
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
      info.innerHTML = `<span class="shop-name"${nameStyle}>${perk.name}</span>${chainTag}<span class="shop-desc">${perk.desc}</span>`;
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

  function openConfirm(text, onYes) {
    pendingConfirm = onYes;
    if (confirmText) confirmText.textContent = text;
    screenBeforeModal = screen;
    screen = 'confirm';
    if (confirmScreen) confirmScreen.classList.remove('hidden');
  }

  function closeConfirm() {
    pendingConfirm = null;
    if (confirmScreen) confirmScreen.classList.add('hidden');
    screen = 'playing';
  }

  function processPlayerResult(nextState) {
    if (nextState.lastAction === 'blocked') {
      // A blocked action (card recharging, no target, etc.) changes no positions — just surface
      // its message. Do NOT reset the renderer/camera (that caused the move-and-snap-back).
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

    applyState(nextState, true);
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
    enemyQueue = phase.moverIds;
    animTimer = PLAYER_MOVE_TIME;
    scanVisibleTips(phase.state);
  }

  function advanceEnemyQueue() {
    while (enemyQueue.length) {
      const id = enemyQueue.shift();
      if (!gameState.enemies.some((enemy) => enemy.id === id)) {
        continue; // Piece vanished (e.g. captured) before its turn.
      }
      const hpBefore = gameState.player.hp;
      applyState(moveEnemy(gameState, id), true);
      // A boss's first-sighting ROAR is logged separately so it doesn't cost the boss its action.
      if (gameState.bossLine) { logMessage(gameState.bossLine); gameState.bossLine = null; }
      // ...and pops a short speech bubble over its head for a beat (only on this scream turn).
      if (gameState.bossShout) { Renderer.shout(gameState.bossShout.x, gameState.bossShout.y, gameState.bossShout.text); gameState.bossShout = null; }
      if (gameState.lastShot) {
        const s = gameState.lastShot;
        Renderer.rangedShot(s.fromX, s.fromY, s.toX, s.toY, s.role, s.tiles);
        if (s.role === 'fireball') GameAudio.play('cast');
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
        return;
      }
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
      // crucially, does NOT reset the renderer — so the camera never snaps (the old bug).
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
    else if (screen === 'playing') GameAudio.setTrack('explore');

    // The exploring score HURRIES a gear at a time as the floor's dread climbs (so the pressure to
    // get off the floor is audible), and darkens to the tense progression past the danger line.
    const dread = Boolean(gameState) && screen === 'playing'
      ? Math.min(1, gameState.turn / (gameState.dreadTurns || MAX_TURNS_SCARY))
      : 0;
    GameAudio.setDanger(dread);
    const inDanger = Boolean(gameState) && screen === 'playing' && gameState.turn >= Math.floor((gameState.dreadTurns || MAX_TURNS_SCARY) * 0.6);
    GameAudio.setTension(inDanger);

    Renderer.update(delta);
    // While aiming a card, show its reachable tiles instead of moves.
    const aiming = cardTargeting !== null;
    const targets = aiming ? cardTargets : null;
    const aoe = aiming ? spellAoeTiles(gameState, cardTargeting, cardCursor) : null;
    Renderer.draw(gameState, isIdle() && !aiming, targets, aiming ? cardCursor : null, aoe);
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
      if (screen === 'trophies') {
        event.preventDefault();
        closeTrophies();
        return;
      }
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
    handleClick(event);
  });

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
  if (trophyCloseButton) trophyCloseButton.addEventListener('click', closeTrophies);
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
    newGame(); // lives in the options menu now; starts a fresh run
  });

  showTitle();
  requestAnimationFrame(step);
})();

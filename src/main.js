// App controller: owns the screen state machine, the turn flow, the render
// loop, tutorial tips, and all DOM wiring. Depends on every other script first.

(function () {
  const canvas = document.getElementById('game');
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
  // near a canvas edge; the constants tune the pan / zoom feel.
  let edgePan = { x: 0, y: 0 };
  const EDGE_MARGIN = 42; // px from an edge that starts panning
  const EDGE_PAN_SPEED = 9; // tiles per second while at an edge
  const KEY_PAN_STEP = 1.4; // tiles per arrow-key press
  const WHEEL_ZOOM_STEP = 0.12;
  const KEY_ZOOM_STEP = 0.25;

  // screen: 'title' | 'class' | 'playing' | 'levelup' | 'character' | 'confirm' | 'gameover' | 'victory' | 'tutorial' | 'options'
  let screen = 'title';
  let gameState = null;

  // Card targeting: the index of the card currently awaiting a destination, or
  // null when not aiming. `cardTargets` are the tiles it can reach; `cardCursor`
  // is the keyboard-controlled target square.
  let cardTargeting = null;
  let cardTargets = [];
  let cardCursor = null;

  // The enemy turn is resolved one piece at a time so each move animates.
  let enemyQueue = [];
  let animTimer = 0;
  let pendingAction = null; // null | 'floor' (descend once the move animates)
  const PLAYER_MOVE_TIME = 0.16;
  const ENEMY_MOVE_TIME = 0.16;

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
    const cls = CLASSES[highestClass(p)];
    floorLabel.textContent = `Floor ${toRoman(gameState.floor)}${cls ? ' · ' + cls.name : ''}`;
    if (floorNameLabel) floorNameLabel.textContent = floorName(gameState.floor);
    turnLabel.textContent = `Turn ${gameState.turn}`;
    renderHearts(p.hp, p.maxHp);
    renderLevelBadges(p.level || 1);
    logMessage(gameState.message);

    // Dread rises as the king lingers.
    turnLabel.style.color = scaryColor(Math.min(1, gameState.turn / MAX_TURNS_SCARY));
    renderCards();
  }

  /* -------------------------------- log --------------------------------- */

  let lastLogged = null;
  const LOG_MAX = 14;

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

  function renderCards() {
    cardBar.innerHTML = '';
    if (!gameState) {
      return;
    }
    // Owned cards, in inventory order (their 1-based index is the hotkey).
    gameState.player.cards.forEach((card, i) => {
      cardBar.append(makeCardSlot(card, i));
    });
  }

  function makeCardSlot(card, i) {
    const cat = classCategory(gameState.player.className);
    const slot = document.createElement('button');
    slot.type = 'button';
    slot.className = 'card-slot';
    slot.style.borderColor = CATEGORY_COLOR[cat] || '#888';
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
    slot.disabled = onCooldown && cardTargeting !== i;
    slot.addEventListener('click', () => toggleCardTargeting(i));
    return slot;
  }


  // Start (or cancel) aiming a card. While aiming, its reachable tiles glow.
  function toggleCardTargeting(index) {
    if (!isIdle()) {
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
    // Start the cursor on the reachable tile nearest the king.
    const nearest = cardTargets.slice().sort((a, b) => distToKing(a) - distToKing(b))[0];
    cardCursor = { x: nearest.x, y: nearest.y };
    gameState.message = `Aiming the ${classCategory(gameState.player.className)} ${card.kind} — cycle targets with the numpad/WSAD, then Enter/Space (or press ${index + 1} again) to fire; Esc to cancel.`;
    showCardInfo(card);
    updateHud();
  }

  // Show the card being aimed (category, movement) in the pane.
  function showCardInfo(card) {
    examineEl.innerHTML = '';
    const cat = classCategory(gameState.player.className);
    const verb = card.kind === 'enpassant' ? 'Dashes past; strikes the two tiles you flank.' : cat === 'melee' ? 'Strikes by moving onto the foe.' : cat === 'ranged' ? 'Fires from afar (blocked by cover); you hold your tile.' : 'A bolt that pierces everything on its path; you hold your tile.';
    addExamineBlock(`${card.kind} — ${cat}`, [PIECE_INFO[card.kind] || '', verb, `Cooldown ${card.cooldown} turns`]);
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

  /* ------------------------------ tile popover --------------------------- */

  const TERRAIN_NAMES = {
    normal: 'Open ground',
    wall: 'Wall — blocks sight & movement',
    lava: 'Lava — you cannot cross it (enemies can); clear to see through',
    water: 'Water — slow (cross one per move); no cards while wading',
  };

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
    const terrain = terrainAt(gameState, tx, ty);
    lines.push(TERRAIN_NAMES[terrain] || terrain);
    if (visible) {
      const enemy = gameState.enemies.find((e) => e.x === tx && e.y === ty);
      if (enemy) {
        let tag;
        if (enemy.turret) {
          tag = ' (turret — fixed, fires its pattern)';
        } else if (enemy.summonCircle) {
          tag = ' (summoning circle — spawns foes; step on it to destroy)';
        } else if (enemy.boss) {
          tag = ` (boss — HP ${enemy.hp}/${enemy.maxHp})`;
        } else {
          tag = enemy.surprised ? ' (surprised)' : enemy.awake ? ' (hostile)' : '';
        }
        lines.push(`Enemy: ${enemy.kind}${tag}`);
      }
    }
    const onBuilding = (b) => b && b.x === tx && b.y === ty && (b.discovered || visible);
    if (onBuilding(gameState.exit)) {
      lines.push('Stairs down to the next floor');
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
    berolina: 'Steps one tile diagonally; captures one tile orthogonally.',
    knight: 'Leaps in an L (two and one), clear over anything between.',
    bishop: 'Slides any distance diagonally.',
    rook: 'Slides any distance orthogonally.',
    queen: 'Slides any distance in any direction.',
    archbishop: 'Moves as a bishop or a knight.',
    chancellor: 'Moves as a rook or a knight.',
    amazon: 'Moves as a queen or a knight — the realm’s final guardian.',
    king: 'Moves one tile in any direction — a weak, common foe worth capturing.',
    enpassant: 'Dashes 2 tiles orthogonally onto empty ground, striking the two tiles it flanks on the way.',
  };

  // One-line descriptions of each enemy role (for the examine pane).
  const ROLE_INFO = {
    turret: 'Turret — fixed; fires its piece pattern, cannot be destroyed.',
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
    const terrain = terrainAt(gameState, tx, ty);
    addExamineBlock(`Tile (${tx}, ${ty})`, TERRAIN_NAMES[terrain] || terrain);

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
          ? 'Dormant — guarding the stair'
          : enemy.surprised
            ? 'Surprised — frozen this turn'
            : enemy.frustrated
              ? 'Frustrated — no legal move'
              : enemy.awake
                ? 'Hostile — hunting the king'
                : 'Unaware — wandering';
        const hpLine = enemy.boss && enemy.maxHp ? `HP ${enemy.hp}/${enemy.maxHp}` : null;
        const title = enemy.boss ? `Boss — ${(enemy.bossName || enemy.kind).replace(/^the /, '')}` : `Enemy — ${enemy.kind}`;
        addExamineBlock(title, [PIECE_INFO[enemy.kind] || '', ROLE_INFO[enemyRole(enemy)] || null, hpLine, st]);
      }
    }

    const onBuilding = (b) => b && b.x === tx && b.y === ty && (b.discovered || visible);
    if (onBuilding(gameState.exit)) {
      addExamineBlock('Stairs', 'Descend to the next floor — you fully heal and gain a level.');
    }

    const scar = (gameState.scars || []).find((s) => s.x === tx && s.y === ty);
    if (scar && (gameState.explored || {})[`${tx},${ty}`]) {
      addExamineBlock('Ruined circle', 'A shattered summoning circle — it conjures no more.');
    }
  }

  // Step the targeting cursor to the next (+1) or previous (-1) valid target, wrapping
  // around the ring. A movement key that heads right/down cycles forward; left/up back.
  function cycleCardCursor(step) {
    if (cardTargeting === null || !cardTargets.length) {
      return;
    }
    let idx = cardCursor ? cardTargets.findIndex((t) => t.x === cardCursor.x && t.y === cardCursor.y) : -1;
    idx = idx < 0 ? 0 : (idx + step + cardTargets.length) % cardTargets.length;
    const t = cardTargets[idx];
    cardCursor = { x: t.x, y: t.y };
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
    cancelCardTargeting();
    GameAudio.play('cast');
    commitMove(useCard(gameState, index, target.x, target.y));
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
  function scanVisibleTips(state) {
    const visible = getVisibleEnemies(state);
    if (visible.some((enemy) => enemy.surprised)) {
      queueTip('surprise');
    }
    if (visible.some((enemy) => enemy.kind === 'knight')) {
      queueTip('knight');
    }
    if (visible.some((enemy) => enemy.kind === 'king')) {
      queueTip('enemyKing');
    }
    if (visible.some((enemy) => enemy.turret)) {
      queueTip('turret');
    }
    if (visible.some((enemy) => enemy.summonCircle)) {
      queueTip('circle');
    }
    if (visible.some((enemy) => enemy.boss)) {
      queueTip('boss');
    }
    if (visible.some((enemy) => isJumperKind(enemy.kind) && enemy.awake)) {
      queueTip('jumper');
    }
    if (getThreatenedTiles(state).size > 0) {
      queueTip('threat');
    }
    // Once dread crosses the halfway mark, warn about the rising tide of foes.
    if (state.turn >= MAX_TURNS_SCARY / 2) {
      queueTip('danger');
    }
    // First sighting of each terrain type pops an explanatory tip.
    for (const key of computeVisibleTiles(state)) {
      const [tx, ty] = key.split(',').map(Number);
      const type = terrainAt(state, tx, ty);
      if (TUTORIALS[`terrain-${type}`]) {
        queueTip(`terrain-${type}`);
      }
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
          return { text: `${getPieceLabel(c.kind)}  ${c.kind} — ${cat} (${ready})`, color: CATEGORY_COLOR[cat] };
        })
      : ['No cards.']));

    const taken = p.takenPerks || [];
    characterBody.append(characterBlock(`Perks (${taken.length})`, taken.length && cls
      ? taken.map((id) => {
          const perk = cls.perks.find((k) => k.id === id) || { name: id, desc: '' };
          return perk.desc ? `${perk.name} — ${perk.desc}` : perk.name;
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
    if (confirmScreen) confirmScreen.classList.add('hidden');
    pendingConfirm = null;
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
        newGame(key);
      });
      row.addEventListener('mouseenter', (e) => showClassPopover(key, e));
      row.addEventListener('mousemove', (e) => showClassPopover(key, e));
      row.addEventListener('mouseleave', hideClassPopover);
      row.append(info, pick);
      classList.append(row);
    }
  }

  function newGame(classKey) {
    startGame(createInitialState(classKey || 'warrior'));
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
      openLevelUp();
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
    for (const perk of perks) {
      const row = document.createElement('li');
      row.className = 'shop-item';
      const info = document.createElement('div');
      info.className = 'shop-info';
      info.innerHTML = `<span class="shop-name">${perk.name}</span><span class="shop-desc">${perk.desc}</span>`;
      const take = document.createElement('button');
      take.type = 'button';
      take.textContent = 'Take';
      take.addEventListener('click', () => {
        applyState(learnPerk(gameState, perk.id), false);
        Renderer.effect('powerup');
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
      applyState(nextState, false);
      return;
    }

    const prevEnemies = gameState ? gameState.enemies.length : 0;

    applyState(nextState, true);
    Renderer.centerOn(nextState.player.x, nextState.player.y); // keep the king in view after a move

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
      queueTip('exit');
      pendingAction = 'floor';
      animTimer = PLAYER_MOVE_TIME;
      return;
    }
    // A strike either felled a piece (kill) or merely chipped it (attack).
    if (felled > 0) GameAudio.play('kill');
    else if (struck) GameAudio.play('attack');
    // Quick weapons / Bloodrush kills cost no turn — no enemy phase.
    if (nextState.enemyTurn === false || nextState.lastAction === 'card-free' || nextState.lastAction === 'move-free') {
      maybeOpenLevelUp(); // a free-action boss kill still earns its boon
      return;
    }

    // Pieces newly in view freeze in surprise; the rest get to move.
    const phase = beginEnemyPhase(nextState);
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
      if (gameState.lastShot) {
        const s = gameState.lastShot;
        Renderer.rangedShot(s.fromX, s.fromY, s.toX, s.toY, s.role);
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

    // Turn complete: maybe reinforce, then persist.
    applyState(maybeSpawnEnemy(gameState), true);
    saveGame(gameState);
    maybeOpenLevelUp(); // if this turn slew the boss, offer the boon now
  }

  function handleStep(dx, dy) {
    if (!isIdle()) {
      return;
    }
    commitMove(movePlayer(gameState, dx, dy));
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
      cancelCardTargeting();
      if (target) {
        GameAudio.play('cast');
        commitMove(useCard(gameState, index, tileX, tileY));
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
        if (pendingAction === 'floor') {
          pendingAction = null;
          goNextFloor();
        } else if (pendingAction === 'gameover') {
          pendingAction = null;
          onGameOver();
        } else if (pendingAction === 'victory') {
          pendingAction = null;
          onVictory();
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
    if (gameState && screen === 'playing' && gameState.turn >= MAX_TURNS_SCARY) {
      turnLabel.style.color = Math.floor(timestamp / 350) % 2 ? '#fde047' : '#ef4444';
    }

    Renderer.update(delta);
    // While aiming a card, show its reachable tiles instead of moves.
    const aiming = cardTargeting !== null;
    const targets = aiming ? cardTargets : null;
    Renderer.draw(gameState, isIdle() && !aiming, targets, aiming ? cardCursor : null);
    requestAnimationFrame(step);
  }

  /* ------------------------------- wiring -------------------------------- */

  document.addEventListener('keydown', (event) => {

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
        // Right/down cycles forward through the target ring; left/up cycles back.
        const forward = aim[0] !== 0 ? aim[0] > 0 : aim[1] > 0;
        cycleCardCursor(forward ? 1 : -1);
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

  // Click-and-drag panning, edge-of-screen panning, and the hover popover all key
  // off mouse position.
  let dragging = false;
  let dragMoved = false;
  let suppressClick = false;
  let dragLast = { x: 0, y: 0 };

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
      edgePan = { x: 0, y: 0 }; // dragging overrides edge panning
    } else {
      // Hovering near an edge pans the camera that way.
      edgePan = {
        x: x < EDGE_MARGIN ? -1 : x > rect.width - EDGE_MARGIN ? 1 : 0,
        y: y < EDGE_MARGIN ? -1 : y > rect.height - EDGE_MARGIN ? 1 : 0,
      };
    }

    showTilePopover(event, x * scale, y * scale);
  });

  canvas.addEventListener('mouseleave', () => {
    edgePan = { x: 0, y: 0 };
    dragging = false;
    hideTilePopover();
  });

  newGameButton.addEventListener('click', openClassSelect);
  classBackButton.addEventListener('click', showTitle);
  continueButton.addEventListener('click', continueGame);
  titleOptionsButton.addEventListener('click', openOptions);
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
      const collapsed = logEl.classList.toggle('collapsed');
      logToggle.setAttribute('aria-expanded', String(!collapsed));
      logToggle.textContent = collapsed ? '▸ Log' : '▾ Log';
      if (!collapsed) logEl.scrollTop = logEl.scrollHeight;
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

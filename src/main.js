// App controller: owns the screen state machine, the turn flow, the render
// loop, tutorial tips, and all DOM wiring. Depends on every other script first.

(function () {
  const canvas = document.getElementById('game');
  const floorLabel = document.getElementById('floor');
  const turnLabel = document.getElementById('turn');
  const healthLabel = document.getElementById('health');
  const goldLabel = document.getElementById('gold');
  const logEl = document.getElementById('log');
  const examineEl = document.getElementById('examine');
  const restartButton = document.getElementById('restart');
  const optionsButton = document.getElementById('options');

  const titleScreen = document.getElementById('title-screen');
  const gameoverScreen = document.getElementById('gameover-screen');
  const gameoverStats = document.getElementById('gameover-stats');
  const victoryScreen = document.getElementById('victory-screen');
  const victoryStats = document.getElementById('victory-stats');
  const altarScreen = document.getElementById('altar-screen');
  const altarList = document.getElementById('altar-list');
  const altarMessage = document.getElementById('altar-message');
  const weaponshopScreen = document.getElementById('weaponshop-screen');
  const weaponshopGold = document.getElementById('weaponshop-gold');
  const weaponshopList = document.getElementById('weaponshop-list');
  const weaponshopMessage = document.getElementById('weaponshop-message');
  const cardBar = document.getElementById('card-bar');
  const tilePopover = document.getElementById('tile-popover');
  const tutorialScreen = document.getElementById('tutorial-screen');
  const tutorialTitle = document.getElementById('tutorial-title');
  const tutorialText = document.getElementById('tutorial-text');
  const optionsScreen = document.getElementById('options-screen');
  const optionsStatus = document.getElementById('options-tutorial-status');
  const optionsToggle = document.getElementById('options-toggle-tutorial');

  const newGameButton = document.getElementById('new-game');
  const continueButton = document.getElementById('continue-game');
  const titleOptionsButton = document.getElementById('title-options');
  const playAgainButton = document.getElementById('play-again');
  const toTitleButton = document.getElementById('to-title');
  const victoryContinueButton = document.getElementById('victory-continue');
  const victoryAgainButton = document.getElementById('victory-again');
  const victoryTitleButton = document.getElementById('victory-title');
  const altarCloseButton = document.getElementById('altar-close');
  const weaponshopCloseButton = document.getElementById('weaponshop-close');
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

  // screen: 'title' | 'playing' | 'altar' | 'weaponshop' | 'gameover' | 'victory' | 'tutorial' | 'options'
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

  function isIdle() {
    return screen === 'playing' && animTimer <= 0 && enemyQueue.length === 0 && pendingAction === null && !gameState.gameOver;
  }

  function updateHud() {
    if (!gameState) {
      return;
    }
    const finalNote = gameState.isFinalFloor ? ' (final)' : '';
    floorLabel.textContent = `Floor ${gameState.floor}${finalNote}`;
    turnLabel.textContent = `Turn ${gameState.turn}`;
    healthLabel.textContent = `HP ${gameState.player.hp}/${gameState.player.maxHp}`;
    goldLabel.textContent = `Gold ${gameState.player.gold}`;
    logMessage(gameState.message);

    // Dread rises as the king lingers and as his health falls.
    turnLabel.style.color = scaryColor(Math.min(1, gameState.turn / MAX_TURNS_SCARY));
    healthLabel.style.color = scaryColor(1 - gameState.player.hp / gameState.player.maxHp);
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
  function renderCards() {
    cardBar.innerHTML = '';
    if (!gameState) {
      return;
    }
    const { cards, maxCards } = gameState.player;
    for (let i = 0; i < maxCards; i += 1) {
      const card = cards[i];
      const slot = document.createElement('button');
      slot.type = 'button';
      slot.className = 'card-slot';
      if (!card) {
        slot.classList.add('empty');
        slot.textContent = 'empty';
        slot.disabled = true;
        cardBar.append(slot);
        continue;
      }
      slot.textContent = getPieceLabel(card.kind);
      slot.title = card.trait ? `${card.kind} card · ${TRAIT_INFO[card.trait].name}` : `${card.kind} card`;
      const onCooldown = card.remaining > 0;
      if (cardTargeting === i) {
        slot.classList.add('targeting');
      } else if (onCooldown) {
        slot.classList.add('cooldown');
      } else {
        slot.classList.add('ready');
      }
      if (card.trait) {
        // A small corner pip marks a card that carries a weapon trait.
        const pip = document.createElement('span');
        pip.className = 'card-trait';
        pip.textContent = TRAIT_INFO[card.trait].name[0];
        slot.append(pip);
      }
      if (onCooldown) {
        const badge = document.createElement('span');
        badge.className = 'card-cooldown';
        badge.textContent = String(card.remaining);
        slot.append(badge);
      }
      slot.disabled = onCooldown && cardTargeting !== i;
      slot.addEventListener('click', () => toggleCardTargeting(i));
      cardBar.append(slot);
    }
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
    cardTargets = getCardMoves(gameState, card.kind);
    if (!cardTargets.length) {
      gameState.message = 'That card has nowhere to go from here.';
      cancelCardTargeting();
      updateHud();
      return;
    }
    // Start the keyboard cursor on the reachable tile nearest the king.
    cardCursor = cardTargets
      .slice()
      .sort((a, b) => distToKing(a) - distToKing(b))[0];
    cardCursor = { x: cardCursor.x, y: cardCursor.y };
    gameState.message = `Aiming the ${card.kind} card — click a tile or use the numpad, then Enter (Esc to cancel).`;
    showCardInfo(card);
    updateHud();
  }

  // Show the card being aimed (movement + any trait) in the right-hand pane.
  function showCardInfo(card) {
    examineEl.innerHTML = '';
    addExamineBlock(`${card.kind} card`, [PIECE_INFO[card.kind] || '', `Cooldown ${card.cooldown} turns`]);
    if (card.trait) {
      addExamineBlock(`Trait — ${TRAIT_INFO[card.trait].name}`, TRAIT_INFO[card.trait].desc);
    }
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
    water: 'Water — impassable, but clear to see through',
    mud: 'Mud — cross at most two in a move',
    ice: 'Ice — slippery, you slide across',
    mist: 'Mist — passable but blocks sight',
  };

  // Build a human description of a tile (or null if there is nothing to say).
  function describeTile(tx, ty) {
    if (!gameState || tx < 0 || tx >= WORLD_SIZE || ty < 0 || ty >= WORLD_SIZE) {
      return null;
    }
    if (!(gameState.explored && gameState.explored[`${tx},${ty}`])) {
      return 'Unexplored — shrouded in fog of war.';
    }
    const visible = inLineOfSight(gameState, tx, ty) && terrainAt(gameState, tx, ty) !== 'mist';
    const lines = [];
    if (gameState.player.x === tx && gameState.player.y === ty) {
      lines.push('Your king');
    }
    const terrain = terrainAt(gameState, tx, ty);
    lines.push(TERRAIN_NAMES[terrain] || terrain);
    if (visible) {
      const enemy = gameState.enemies.find((e) => e.x === tx && e.y === ty);
      if (enemy) {
        const tag = enemy.surprised ? ' (surprised)' : enemy.awake ? ' (hostile)' : '';
        lines.push(`Enemy: ${enemy.kind}${tag}`);
      }
      const item = gameState.items.find((i) => i.x === tx && i.y === ty);
      if (item) {
        lines.push(item.kind === 'heart' ? 'Heart — restores 1 HP' : `Gold — ${item.amount}`);
      }
    }
    const onBuilding = (b) => b && b.x === tx && b.y === ty && (b.discovered || visible);
    if (onBuilding(gameState.exit)) {
      lines.push('Stairs down to the next floor');
    }
    if (onBuilding(gameState.altar)) {
      lines.push(gameState.altar.used ? 'Altar — already spent' : 'Altar — a free blessing');
    }
    if (onBuilding(gameState.weaponShop)) {
      lines.push('Weapon shop — buy cards');
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
  }

  /* ------------------------------ examine pane --------------------------- */

  const PIECE_INFO = {
    pawn: 'Steps one tile orthogonally; captures one tile diagonally.',
    berolina: 'Steps one tile diagonally; captures one tile orthogonally.',
    knight: 'Leaps in an L (two and one), clear over anything between.',
    bishop: 'Slides any distance diagonally.',
    rook: 'Slides any distance orthogonally.',
    queen: 'Slides any distance in any direction.',
    camel: 'Leaps in a (3,1) pattern, clear over anything between.',
    archbishop: 'Moves as a bishop or a knight.',
    chancellor: 'Moves as a rook or a knight.',
    amazon: 'Moves as a queen or a knight.',
    nightrider: 'Rides repeated knight leaps in a straight line.',
    king: 'Moves one tile in any direction. Capture it to win the floor.',
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
    const visible = inLineOfSight(gameState, tx, ty) && terrainAt(gameState, tx, ty) !== 'mist';
    const terrain = terrainAt(gameState, tx, ty);
    addExamineBlock(`Tile (${tx}, ${ty})`, TERRAIN_NAMES[terrain] || terrain);

    if (gameState.player.x === tx && gameState.player.y === ty) {
      const p = gameState.player;
      addExamineBlock('Your King', [`HP ${p.hp}/${p.maxHp}`, `Sight ${p.vision}`, `Gold ${p.gold}`, `Card slots ${p.maxCards}`]);
    }

    if (visible) {
      const enemy = gameState.enemies.find((e) => e.x === tx && e.y === ty);
      if (enemy) {
        const state = enemy.surprised
          ? 'Surprised — frozen this turn'
          : enemy.frustrated
            ? 'Frustrated — no legal move'
            : enemy.awake
              ? 'Hostile — hunting the king'
              : 'Unaware — wandering';
        const buyable = isCardKind(enemy.kind) ? 'Can be bought as a card.' : null;
        addExamineBlock(`Enemy — ${enemy.kind}`, [PIECE_INFO[enemy.kind] || '', state, buyable]);
      }
      const item = gameState.items.find((i) => i.x === tx && i.y === ty);
      if (item) {
        addExamineBlock('Item', item.kind === 'heart' ? 'Heart — restores 1 HP.' : `Gold — worth ${item.amount}.`);
      }
    }

    const onBuilding = (b) => b && b.x === tx && b.y === ty && (b.discovered || visible);
    if (onBuilding(gameState.exit)) {
      addExamineBlock('Stairs', 'Descend to the next floor (the king mends a little).');
    }
    if (onBuilding(gameState.altar)) {
      addExamineBlock('Altar', gameState.altar.used ? 'Already spent — dormant.' : 'A free blessing: pick one of two upgrades.');
    }
    if (onBuilding(gameState.weaponShop)) {
      addExamineBlock('Weapon Shop', 'Buy movement cards drawn from foes you have seen.');
    }
  }

  // Move the targeting cursor to the nearest valid target in the given direction.
  function moveCardCursor(dx, dy) {
    if (cardTargeting === null || !cardCursor) {
      return;
    }
    let best = null;
    let bestScore = Infinity;
    for (const t of cardTargets) {
      const ox = t.x - cardCursor.x;
      const oy = t.y - cardCursor.y;
      if (ox === 0 && oy === 0) continue;
      // Must head in the pressed direction on each constrained axis.
      if (dx !== 0 && Math.sign(ox) !== dx) continue;
      if (dy !== 0 && Math.sign(oy) !== dy) continue;
      if (dx === 0 && ox !== 0) continue; // pure vertical: stay in column-ish
      if (dy === 0 && oy !== 0) continue; // pure horizontal: stay in row-ish
      const score = ox * ox + oy * oy;
      if (score < bestScore) {
        bestScore = score;
        best = t;
      }
    }
    // If nothing lined up exactly, fall back to the closest target in that half-plane.
    if (!best) {
      for (const t of cardTargets) {
        const ox = t.x - cardCursor.x;
        const oy = t.y - cardCursor.y;
        if (ox === 0 && oy === 0) continue;
        if (dx !== 0 && Math.sign(ox) !== dx) continue;
        if (dy !== 0 && Math.sign(oy) !== dy) continue;
        const score = ox * ox + oy * oy;
        if (score < bestScore) {
          bestScore = score;
          best = t;
        }
      }
    }
    if (best) {
      cardCursor = { x: best.x, y: best.y };
      Renderer.centerOn(cardCursor.x, cardCursor.y); // keep the cursor in view
    }
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
    processPlayerResult(useCard(gameState, index, target.x, target.y));
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
      queueTip('finalFloor');
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

  /* --------------------------- screen handling --------------------------- */

  function hideOverlays() {
    titleScreen.classList.add('hidden');
    gameoverScreen.classList.add('hidden');
    victoryScreen.classList.add('hidden');
    altarScreen.classList.add('hidden');
    weaponshopScreen.classList.add('hidden');
    tutorialScreen.classList.add('hidden');
    optionsScreen.classList.add('hidden');
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

  function newGame() {
    startGame(createInitialState());
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
    applyState(nextFloor(gameState), false);
    enemyQueue = [];
    animTimer = 0;
    pendingAction = null;
    saveGame(gameState);
    if (gameState.floor > FINAL_FLOOR) {
      queueTip('newGamePlus');
    }
    if (gameState.isFinalFloor) {
      queueTip('finalFloor');
    }
    scanVisibleTips(gameState);
  }

  // Carry the run on past a defeated king into the next floor (new game plus).
  function continueNewGamePlus() {
    hideOverlays();
    screen = 'playing';
    goNextFloor();
  }

  function onGameOver() {
    screen = 'gameover';
    document.body.classList.remove('in-game');
    hideTilePopover();
    clearSave();
    gameoverStats.textContent = `Floor ${gameState.floor} · score ${gameState.score} · ${gameState.turn} turns.`;
    hideOverlays();
    gameoverScreen.classList.remove('hidden');
  }

  function onVictory() {
    screen = 'victory';
    document.body.classList.remove('in-game');
    hideTilePopover();
    clearSave();
    victoryStats.textContent = `Score ${gameState.score} · ${gameState.turn} turns on the final floor.`;
    hideOverlays();
    victoryScreen.classList.remove('hidden');
  }

  /* ------------------------------- altar -------------------------------- */

  function renderAltar() {
    altarMessage.textContent = gameState.altarMessage || '';
    altarList.innerHTML = '';

    const offers = (gameState.altar && gameState.altar.offers) || [];
    const counts = gameState.player.upgradeCounts || {};
    for (const id of offers) {
      const upgrade = ALTAR_UPGRADES.find((u) => u.id === id);
      if (!upgrade) continue;
      const taken = counts[id] || 0;
      const maxed = taken >= MAX_UPGRADES_PER_TYPE;

      const row = document.createElement('li');
      row.className = 'shop-item';

      const info = document.createElement('div');
      info.className = 'shop-info';
      info.innerHTML = `<span class="shop-name">${upgrade.name} <small>(${taken}/${MAX_UPGRADES_PER_TYPE})</small></span><span class="shop-desc">${upgrade.desc}</span>`;

      const take = document.createElement('button');
      take.type = 'button';
      if (maxed) {
        take.textContent = 'Maxed';
        take.disabled = true;
      } else {
        take.textContent = 'Take';
        take.addEventListener('click', () => {
          applyState(useAltar(gameState, id), true);
          if (gameState.altar && gameState.altar.used) {
            closeAltar(); // a blessing was claimed; the altar is spent
          } else {
            renderAltar(); // e.g. maxed pick — let them choose again
          }
        });
      }

      row.append(info, take);
      altarList.append(row);
    }
  }

  function openAltar() {
    screen = 'altar';
    gameState.altarMessage = '';
    renderAltar();
    altarScreen.classList.remove('hidden');
    queueTip('altar');
  }

  function closeAltar() {
    screen = 'playing';
    altarScreen.classList.add('hidden');
    saveGame(gameState);
  }

  /* ----------------------------- weapon shop ----------------------------- */

  // A "knight · Slash" style label for a card / offer.
  function cardName(kind, trait) {
    const traitName = trait ? ` · ${TRAIT_INFO[trait].name}` : '';
    return `${getPieceLabel(kind)} ${kind}${traitName}`;
  }

  function cardDesc(kind, trait) {
    const parts = [`cooldown ${cardCooldown(kind)}`];
    if (trait) {
      parts.push(TRAIT_INFO[trait].desc);
    }
    return parts.join(' · ');
  }

  function renderWeaponShop() {
    weaponshopGold.textContent = `Gold ${gameState.player.gold}`;
    weaponshopMessage.textContent = gameState.shopMessage || '';
    weaponshopList.innerHTML = '';

    const p = gameState.player;
    const offers = (gameState.weaponShop && gameState.weaponShop.offers) || [];
    if (!offers.length) {
      const empty = document.createElement('li');
      empty.className = 'shop-item';
      empty.textContent = 'No wares yet — face more foes to learn their forms.';
      weaponshopList.append(empty);
      return;
    }

    offers.forEach((offer, index) => {
      const cost = cardCost(offer.kind, Boolean(offer.trait));
      const slotsFull = p.cards.length >= p.maxCards;

      const row = document.createElement('li');
      row.className = 'shop-item';

      const info = document.createElement('div');
      info.className = 'shop-info';
      info.innerHTML = `<span class="shop-name">${cardName(offer.kind, offer.trait)}</span><span class="shop-desc">${cardDesc(offer.kind, offer.trait)}</span>`;

      const buy = document.createElement('button');
      buy.type = 'button';
      if (offer.sold) {
        buy.textContent = 'Sold';
        buy.disabled = true;
      } else {
        buy.textContent = `${cost}g`;
        buy.disabled = p.gold < cost;
        buy.addEventListener('click', () => {
          if (slotsFull) {
            promptReplaceCard(index);
          } else {
            applyState(buyCard(gameState, index), true);
            renderWeaponShop();
          }
        });
      }

      row.append(info, buy);
      weaponshopList.append(row);
    });
  }

  // With slots full, ask which card to replace (a row of swap buttons), then buy.
  function promptReplaceCard(offerIndex) {
    const p = gameState.player;
    const offer = gameState.weaponShop.offers[offerIndex];
    if (p.gold < cardCost(offer.kind, Boolean(offer.trait))) {
      gameState.shopMessage = 'Not enough gold.';
      renderWeaponShop();
      return;
    }
    weaponshopMessage.textContent = `Replace which card with the ${offer.kind}?`;
    weaponshopList.innerHTML = '';
    p.cards.forEach((card, index) => {
      const row = document.createElement('li');
      row.className = 'shop-item';
      const info = document.createElement('div');
      info.className = 'shop-info';
      info.innerHTML = `<span class="shop-name">${cardName(card.kind, card.trait)}</span><span class="shop-desc">${cardDesc(card.kind, card.trait)}</span>`;
      const swap = document.createElement('button');
      swap.type = 'button';
      swap.textContent = 'Replace';
      swap.addEventListener('click', () => {
        applyState(buyCard(gameState, offerIndex, index), true);
        renderWeaponShop();
      });
      row.append(info, swap);
      weaponshopList.append(row);
    });
    const cancel = document.createElement('li');
    cancel.className = 'shop-item';
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', renderWeaponShop);
    cancel.append(cancelBtn);
    weaponshopList.append(cancel);
  }

  function openWeaponShop() {
    screen = 'weaponshop';
    gameState.shopMessage = '';
    renderWeaponShop();
    weaponshopScreen.classList.remove('hidden');
    queueTip('weaponShop');
  }

  function closeWeaponShop() {
    screen = 'playing';
    weaponshopScreen.classList.add('hidden');
    saveGame(gameState);
  }

  /* ------------------------------ turn flow ------------------------------ */

  function processPlayerResult(nextState) {
    if (nextState.lastAction === 'blocked') {
      applyState(nextState, false);
      return;
    }

    applyState(nextState, true);
    Renderer.centerOn(nextState.player.x, nextState.player.y); // keep the king in view after a move

    if (nextState.lastAction === 'item') {
      queueTip(nextState.pickupKind === 'gold' ? 'gold' : 'heart');
    }
    if (nextState.won) {
      onVictory();
      return;
    }
    if (nextState.gameOver) {
      onGameOver();
      return;
    }
    if (nextState.lastAction === 'exit') {
      queueTip('exit');
      pendingAction = 'floor';
      animTimer = PLAYER_MOVE_TIME;
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
      if (gameState.player.hp < hpBefore) {
        Renderer.hit();
        flashHealth();
        if (!gameState.gameOver) {
          queueTip('hp');
        }
      }
      if (gameState.gameOver) {
        enemyQueue = [];
        onGameOver();
        return;
      }
      animTimer = ENEMY_MOVE_TIME;
      return;
    }

    // Turn complete: maybe reinforce, persist, then open a building if stepped on.
    applyState(maybeSpawnEnemy(gameState), true);
    const altarPending = gameState.pendingAltar;
    const weaponShopPending = gameState.pendingWeaponShop;
    gameState.pendingAltar = false;
    gameState.pendingWeaponShop = false;
    saveGame(gameState);
    if (altarPending) {
      openAltar();
    } else if (weaponShopPending) {
      openWeaponShop();
    }
  }

  function handleStep(dx, dy) {
    if (!isIdle()) {
      return;
    }
    processPlayerResult(movePlayer(gameState, dx, dy));
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
        processPlayerResult(useCard(gameState, index, tileX, tileY));
      } else {
        examineTile(tileX, tileY);
      }
      return;
    }

    // A click on a reachable tile moves the king there; any other click inspects
    // the tile in the right-hand pane.
    const canMove = isIdle() && getPlayerMoves(gameState).some((move) => move.x === tileX && move.y === tileY);
    if (canMove) {
      processPlayerResult(movePlayerTo(gameState, tileX, tileY));
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
        } else {
          advanceEnemyQueue();
        }
      }
    }

    // Continuous edge-of-screen panning while playing.
    if (screen === 'playing' && (edgePan.x || edgePan.y)) {
      Renderer.panBy(edgePan.x * EDGE_PAN_SPEED * delta, edgePan.y * EDGE_PAN_SPEED * delta);
    }

    Renderer.update(delta);
    // While aiming a card, show its reachable tiles instead of the normal moves.
    const aiming = cardTargeting !== null;
    Renderer.draw(gameState, isIdle() && !aiming, aiming ? cardTargets : null, aiming ? cardCursor : null);
    requestAnimationFrame(step);
  }

  /* ------------------------------- wiring -------------------------------- */

  document.addEventListener('keydown', (event) => {
    // While aiming a card: movement keys steer the cursor, Enter/Space confirm,
    // Escape cancels.
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
      const aim = resolveMove(event);
      if (aim) {
        event.preventDefault();
        moveCardCursor(aim[0], aim[1]);
        return;
      }
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
    // Page Up / Page Down zoom in / out.
    if (event.key === 'PageUp') {
      event.preventDefault();
      Renderer.zoomBy(KEY_ZOOM_STEP);
    } else if (event.key === 'PageDown') {
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

  newGameButton.addEventListener('click', newGame);
  continueButton.addEventListener('click', continueGame);
  titleOptionsButton.addEventListener('click', openOptions);
  playAgainButton.addEventListener('click', newGame);
  toTitleButton.addEventListener('click', showTitle);
  victoryContinueButton.addEventListener('click', continueNewGamePlus);
  victoryAgainButton.addEventListener('click', newGame);
  victoryTitleButton.addEventListener('click', showTitle);
  altarCloseButton.addEventListener('click', closeAltar);
  weaponshopCloseButton.addEventListener('click', closeWeaponShop);
  tutorialOkButton.addEventListener('click', dismissTip);
  tutorialDisableButton.addEventListener('click', disableTipsFromModal);
  optionsButton.addEventListener('click', openOptions);
  optionsCloseButton.addEventListener('click', closeOptions);
  optionsToggle.addEventListener('click', () => {
    if (tutorialsEnabled()) {
      setTutorialsEnabled(false);
    } else {
      setTutorialsEnabled(true);
      resetSeenTips(); // Let the tips play again from the start.
    }
    refreshOptions();
  });
  restartButton.addEventListener('click', () => {
    newGame(); // lives in the options menu now; starts a fresh run
  });

  showTitle();
  requestAnimationFrame(step);
})();

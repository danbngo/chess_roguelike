// App controller: owns the screen state machine, the turn flow, the render
// loop, tutorial tips, and all DOM wiring. Depends on every other script first.

(function () {
  const canvas = document.getElementById('game');
  const floorLabel = document.getElementById('floor');
  const turnLabel = document.getElementById('turn');
  const healthLabel = document.getElementById('health');
  const goldLabel = document.getElementById('gold');
  const scoreLabel = document.getElementById('score');
  const statusLabel = document.getElementById('status');
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

  // Card targeting: the index of the card currently awaiting a destination click,
  // or null when not aiming. `cardTargets` are the tiles it can reach.
  let cardTargeting = null;
  let cardTargets = [];

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
    scoreLabel.textContent = `Score ${gameState.score}`;
    statusLabel.textContent = gameState.message;
    renderCards();
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
      slot.title = `${card.kind} card · cooldown ${card.cooldown}`;
      const onCooldown = card.remaining > 0;
      if (cardTargeting === i) {
        slot.classList.add('targeting');
      } else if (onCooldown) {
        slot.classList.add('cooldown');
      } else {
        slot.classList.add('ready');
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
    gameState.message = `Aiming the ${card.kind} card — click a highlighted tile (Esc to cancel).`;
    updateHud();
  }

  function cancelCardTargeting() {
    cardTargeting = null;
    cardTargets = [];
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
    hideOverlays();
    titleScreen.classList.remove('hidden');
    continueButton.disabled = !hasSave();
    statusLabel.textContent = 'The king awaits your command.';
  }

  function startGame(state) {
    applyState(state, false);
    enemyQueue = [];
    animTimer = 0;
    pendingAction = null;
    pendingTips = [];
    cancelCardTargeting();
    screen = 'playing';
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
    clearSave();
    gameoverStats.textContent = `Floor ${gameState.floor} · score ${gameState.score} · ${gameState.turn} turns.`;
    hideOverlays();
    gameoverScreen.classList.remove('hidden');
  }

  function onVictory() {
    screen = 'victory';
    clearSave();
    victoryStats.textContent = `Score ${gameState.score} · ${gameState.turn} turns on the final floor.`;
    hideOverlays();
    victoryScreen.classList.remove('hidden');
  }

  /* ------------------------------- altar -------------------------------- */

  function statValue(id) {
    const p = gameState.player;
    return { vision: p.vision, maxCards: p.maxCards }[id];
  }

  function renderAltar() {
    altarMessage.textContent = gameState.altarMessage || '';
    altarList.innerHTML = '';

    for (const upgrade of ALTAR_UPGRADES) {
      const maxed = upgrade.stat && upgrade.max != null && gameState.player[upgrade.stat] >= upgrade.max;

      const row = document.createElement('li');
      row.className = 'shop-item';

      const info = document.createElement('div');
      info.className = 'shop-info';
      info.innerHTML = `<span class="shop-name">${upgrade.name}</span><span class="shop-desc">${upgrade.desc}</span>`;

      const take = document.createElement('button');
      take.type = 'button';
      if (maxed) {
        take.textContent = 'Maxed';
        take.disabled = true;
      } else {
        take.textContent = 'Take';
        take.addEventListener('click', () => {
          applyState(useAltar(gameState, upgrade.id), true);
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

  // Buyable cards = card-eligible enemy kinds the king has seen.
  function shopCardKinds() {
    return gameState.player.seenKinds.filter((kind) => isCardKind(kind));
  }

  function renderWeaponShop() {
    weaponshopGold.textContent = `Gold ${gameState.player.gold}`;
    weaponshopMessage.textContent = gameState.shopMessage || '';
    weaponshopList.innerHTML = '';

    const p = gameState.player;
    const kinds = shopCardKinds();
    if (!kinds.length) {
      const empty = document.createElement('li');
      empty.className = 'shop-item';
      empty.textContent = 'No wares yet — face more foes to learn their forms.';
      weaponshopList.append(empty);
      return;
    }

    for (const kind of kinds) {
      const stats = CARD_STATS[kind];
      const slotsFull = p.cards.length >= p.maxCards;

      const row = document.createElement('li');
      row.className = 'shop-item';

      const info = document.createElement('div');
      info.className = 'shop-info';
      info.innerHTML = `<span class="shop-name">${getPieceLabel(kind)} ${kind}</span><span class="shop-desc">cooldown ${stats.cooldown} · move like a ${kind}</span>`;

      const buy = document.createElement('button');
      buy.type = 'button';
      buy.textContent = `${stats.cost}g`;
      buy.disabled = p.gold < stats.cost;
      buy.addEventListener('click', () => {
        if (slotsFull) {
          promptReplaceCard(kind);
        } else {
          applyState(buyCard(gameState, kind), true);
          renderWeaponShop();
        }
      });

      row.append(info, buy);
      weaponshopList.append(row);
    }
  }

  // With slots full, ask which card to replace (a row of swap buttons), then buy.
  function promptReplaceCard(kind) {
    const p = gameState.player;
    if (p.gold < CARD_STATS[kind].cost) {
      gameState.shopMessage = 'Not enough gold.';
      renderWeaponShop();
      return;
    }
    weaponshopMessage.textContent = `Replace which card with the ${kind}?`;
    weaponshopList.innerHTML = '';
    p.cards.forEach((card, index) => {
      const row = document.createElement('li');
      row.className = 'shop-item';
      const info = document.createElement('div');
      info.className = 'shop-info';
      info.innerHTML = `<span class="shop-name">${getPieceLabel(card.kind)} ${card.kind}</span><span class="shop-desc">cooldown ${card.cooldown}</span>`;
      const swap = document.createElement('button');
      swap.type = 'button';
      swap.textContent = 'Replace';
      swap.addEventListener('click', () => {
        applyState(buyCard(gameState, kind, index), true);
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
    if (cardTargeting !== null) {
      cancelCardTargeting(); // a keyboard move cancels card aiming
    }
    if (!isIdle()) {
      return;
    }
    processPlayerResult(movePlayer(gameState, dx, dy));
  }

  function handleClick(event) {
    if (!isIdle()) {
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const scale = canvas.width / rect.width;
    const { x: tileX, y: tileY } = Renderer.screenToTile((event.clientX - rect.left) * scale, (event.clientY - rect.top) * scale);

    // Aiming a card: a click on a highlighted tile plays it; anything else cancels.
    if (cardTargeting !== null) {
      const target = cardTargets.find((move) => move.x === tileX && move.y === tileY);
      const index = cardTargeting;
      cancelCardTargeting();
      if (target) {
        processPlayerResult(useCard(gameState, index, tileX, tileY));
      } else {
        updateHud();
      }
      return;
    }

    const reachable = getPlayerMoves(gameState).some((move) => move.x === tileX && move.y === tileY);
    if (reachable) {
      processPlayerResult(movePlayerTo(gameState, tileX, tileY));
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
    Renderer.draw(gameState, isIdle() && !aiming, aiming ? cardTargets : null);
    requestAnimationFrame(step);
  }

  /* ------------------------------- wiring -------------------------------- */

  document.addEventListener('keydown', (event) => {
    // Escape cancels card aiming.
    if (event.key === 'Escape' && cardTargeting !== null) {
      event.preventDefault();
      cancelCardTargeting();
      gameState.message = 'Card cancelled.';
      updateHud();
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
    // Page Up / Page Down zoom in / out.
    if (event.key === 'PageUp') {
      event.preventDefault();
      Renderer.zoomBy(KEY_ZOOM_STEP);
    } else if (event.key === 'PageDown') {
      event.preventDefault();
      Renderer.zoomBy(-KEY_ZOOM_STEP);
    }
  });

  canvas.addEventListener('click', handleClick);

  // Mouse wheel zooms toward / away.
  canvas.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      Renderer.zoomBy(event.deltaY < 0 ? WHEEL_ZOOM_STEP : -WHEEL_ZOOM_STEP);
    },
    { passive: false },
  );

  // Hovering near a canvas edge pans the camera that way; track the direction.
  canvas.addEventListener('mousemove', (event) => {
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    edgePan = {
      x: x < EDGE_MARGIN ? -1 : x > rect.width - EDGE_MARGIN ? 1 : 0,
      y: y < EDGE_MARGIN ? -1 : y > rect.height - EDGE_MARGIN ? 1 : 0,
    };
  });
  canvas.addEventListener('mouseleave', () => {
    edgePan = { x: 0, y: 0 };
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
    if (screen === 'playing' || screen === 'gameover' || screen === 'victory') {
      newGame();
    }
  });

  showTitle();
  requestAnimationFrame(step);
})();

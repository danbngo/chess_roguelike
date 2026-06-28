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
  const shopScreen = document.getElementById('shop-screen');
  const shopGold = document.getElementById('shop-gold');
  const shopList = document.getElementById('shop-list');
  const shopMessage = document.getElementById('shop-message');
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
  const shopCloseButton = document.getElementById('shop-close');
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

  // screen: 'title' | 'playing' | 'shop' | 'gameover' | 'victory' | 'tutorial' | 'options'
  let screen = 'title';
  let gameState = null;

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
    shopScreen.classList.add('hidden');
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

  /* -------------------------------- shop -------------------------------- */

  function renderShop() {
    shopGold.textContent = `Gold ${gameState.player.gold}`;
    shopMessage.textContent = gameState.shopMessage || '';
    shopList.innerHTML = '';

    for (const upgrade of UPGRADES) {
      const owned = upgrade.id === 'jump' && gameState.player.canJump;
      const maxed =
        (upgrade.id === 'range' && gameState.player.moveRange >= upgrade.max) ||
        (upgrade.id === 'vision' && gameState.player.vision >= upgrade.max);
      const affordable = gameState.player.gold >= upgrade.cost;

      const row = document.createElement('li');
      row.className = 'shop-item';

      const info = document.createElement('div');
      info.className = 'shop-info';
      info.innerHTML = `<span class="shop-name">${upgrade.name}</span><span class="shop-desc">${upgrade.desc}</span>`;

      const buy = document.createElement('button');
      buy.type = 'button';
      if (owned) {
        buy.textContent = 'Owned';
        buy.disabled = true;
      } else if (maxed) {
        buy.textContent = 'Maxed';
        buy.disabled = true;
      } else {
        buy.textContent = `${upgrade.cost}g`;
        buy.disabled = !affordable;
        buy.addEventListener('click', () => {
          applyState(buyUpgrade(gameState, upgrade.id), true);
          renderShop();
        });
      }

      row.append(info, buy);
      shopList.append(row);
    }
  }

  function openShop() {
    screen = 'shop';
    gameState.shopMessage = '';
    renderShop();
    shopScreen.classList.remove('hidden');
    queueTip('shop');
  }

  function closeShop() {
    screen = 'playing';
    shopScreen.classList.add('hidden');
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

    // Turn complete: maybe reinforce, persist, then open a shop if stepped on.
    applyState(maybeSpawnEnemy(gameState), true);
    const shopPending = gameState.pendingShop;
    gameState.pendingShop = false;
    saveGame(gameState);
    if (shopPending) {
      openShop();
    }
  }

  function handleStep(dx, dy) {
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
    Renderer.draw(gameState, isIdle());
    requestAnimationFrame(step);
  }

  /* ------------------------------- wiring -------------------------------- */

  document.addEventListener('keydown', (event) => {
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
  shopCloseButton.addEventListener('click', closeShop);
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

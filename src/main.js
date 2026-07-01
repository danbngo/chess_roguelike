// App controller: owns the screen state machine, the turn flow, the render
// loop, tutorial tips, and all DOM wiring. Depends on every other script first.

(function () {
  const canvas = document.getElementById('game');
  const floorLabel = document.getElementById('floor');
  const floorNameLabel = document.getElementById('floor-name');
  const turnLabel = document.getElementById('turn');
  const healthLabel = document.getElementById('health');
  const goldLabel = document.getElementById('gold');
  const rewardLabel = document.getElementById('reward');
  const statusLabel = document.getElementById('status');
  const consumableBar = document.getElementById('consumable-bar');
  const logEl = document.getElementById('log');
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
  const equipShopScreen = document.getElementById('equipshop-screen');
  const equipShopGold = document.getElementById('equipshop-gold');
  const equipShopList = document.getElementById('equipshop-list');
  const equipShopMessage = document.getElementById('equipshop-message');
  const potionShopScreen = document.getElementById('potionshop-screen');
  const potionShopGold = document.getElementById('potionshop-gold');
  const potionShopList = document.getElementById('potionshop-list');
  const potionShopMessage = document.getElementById('potionshop-message');
  const potionShopCloseButton = document.getElementById('potionshop-close');
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
  const equipShopCloseButton = document.getElementById('equipshop-close');
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

  // screen: 'title' | 'playing' | 'altar' | 'equipshop' | 'weaponshop' | 'potionshop' | 'gameover' | 'victory' | 'tutorial' | 'options'
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
    floorLabel.textContent = `Floor ${gameState.floor}`;
    if (floorNameLabel) floorNameLabel.textContent = floorName(gameState.floor);
    turnLabel.textContent = `Turn ${gameState.turn}`;
    healthLabel.textContent = `HP ${gameState.player.hp}/${gameState.player.maxHp}`;
    goldLabel.textContent = `Gold ${gameState.player.gold}`;
    if (rewardLabel) rewardLabel.textContent = `Descend reward ${floorGoldReward(gameState)}`;
    logMessage(gameState.message);

    // Dread rises as the king lingers and as his health falls.
    turnLabel.style.color = scaryColor(Math.min(1, gameState.turn / MAX_TURNS_SCARY));
    healthLabel.style.color = scaryColor(1 - gameState.player.hp / gameState.player.maxHp);
    // The descend reward also bleeds from green to red as it decays.
    if (rewardLabel) rewardLabel.style.color = scaryColor(Math.min(1, gameState.turn / MAX_TURNS_SCARY));
    updateStatusLine();
    renderCards();
    renderConsumables();
  }

  // Show any active timed statuses (e.g. Barkskin) with their remaining turns.
  function updateStatusLine() {
    if (!statusLabel) {
      return;
    }
    const statuses = (gameState && gameState.player && gameState.player.statuses) || {};
    const parts = [];
    if (statuses.barkskin > 0) {
      parts.push(`Barkskin ${statuses.barkskin}`);
    }
    statusLabel.textContent = parts.join(' · ');
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

  // The held-potion bar: click a potion to drink it (costs a turn, unless the
  // Alchemist's Quick Draw makes it free).
  function renderConsumables() {
    if (!consumableBar) return;
    consumableBar.innerHTML = '';
    if (!gameState) return;
    const { consumables, maxConsumables } = gameState.player;
    for (let i = 0; i < maxConsumables; i += 1) {
      const key = consumables[i];
      const slot = document.createElement('button');
      slot.type = 'button';
      slot.className = 'card-slot consumable-slot';
      if (!key) {
        slot.classList.add('empty');
        slot.textContent = '·';
        slot.disabled = true;
        consumableBar.append(slot);
        continue;
      }
      const info = CONSUMABLES[key];
      slot.textContent = info.glyph;
      slot.style.color = info.color;
      slot.title = `${info.name} — ${info.desc} (click to drink)`;
      slot.classList.add('ready');
      slot.disabled = !isIdle();
      slot.addEventListener('click', () => useConsumableAt(i));
      consumableBar.append(slot);
    }
  }

  function useConsumableAt(index) {
    if (!isIdle()) return;
    cancelCardTargeting();
    const result = consumeItem(gameState, index);
    if (result.lastAction === 'blocked') {
      applyState(result, false);
      return;
    }
    Renderer.effect('heal');
    if (result.lastAction === 'consume-free') {
      applyState(result, true); // Quick Draw: no enemy phase
      return;
    }
    processPlayerResult(result); // costs a turn — enemies then move
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
        if (enemy.statue) {
          tag = ' (statue — wakes if you step beside it)';
        } else if (enemy.turret) {
          tag = ' (turret — fixed, fires its pattern)';
        } else if (enemy.boss && bossShielded(gameState)) {
          tag = ' (boss — invulnerable while guards remain)';
        } else if (enemy.boss) {
          tag = ' (boss — vulnerable!)';
        } else if (enemy.mage) {
          tag = ' (mage — piercing bolt on odd turns)';
        } else if (enemy.skirmisher) {
          tag = ' (skirmisher — strikes and darts away)';
        } else if (enemy.armored) {
          tag = ' (armored — one hit shatters its armor & flings you back)';
        } else if (enemy.summoner) {
          tag = ' (summoner — conjures minions)';
        } else if (enemy.summoned) {
          tag = ' (summoned — fades without a summoner near)';
        } else {
          tag = enemy.surprised ? ' (surprised)' : enemy.awake ? ' (hostile)' : '';
        }
        lines.push(`Enemy: ${enemy.kind}${tag}`);
      }
      const item = gameState.items.find((i) => i.x === tx && i.y === ty);
      if (item) {
        lines.push(item.kind === 'consumable' ? potionLabel(item.potion) : `Gold — ${item.amount}`);
      }
    }
    const onBuilding = (b) => b && b.x === tx && b.y === ty && (b.discovered || visible);
    if (onBuilding(gameState.exit)) {
      lines.push(gameState.exit.locked ? 'Stairs down — barred until the guardian falls' : 'Stairs down to the next floor');
    }
    if (onBuilding(gameState.altar)) {
      lines.push(gameState.altar.used ? 'Class altar — spent' : 'Class altar — take a class perk');
    }
    if (onBuilding(gameState.equipShop)) {
      lines.push('Equipment shop — buy passive gear');
    }
    if (onBuilding(gameState.weaponShop)) {
      lines.push('Weapon shop — buy cards');
    }
    if (onBuilding(gameState.potionShop)) {
      lines.push('Apothecary — buy potions');
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
    archbishop: 'Moves as a bishop or a knight.',
    chancellor: 'Moves as a rook or a knight.',
    amazon: 'Moves as a queen or a knight — the realm’s final guardian.',
    king: 'Moves one tile in any direction — a weak, common foe worth capturing.',
  };

  // One-line descriptions of each special enemy role (for the examine pane).
  const ROLE_INFO = {
    statue: 'Statue — inert until you step beside it, then it wakes.',
    turret: 'Turret — fixed; fires its piece pattern, cannot be destroyed.',
    boss: 'Boss — invulnerable while its guards remain in sight.',
    mage: 'Mage — fires a piercing bolt down its line (odd turns), slaying all in the way.',
    skirmisher: 'Skirmisher — strikes from a clear line (odd turns), then retreats.',
    armored: 'Armored — first hit shatters its armor and flings you back; slow.',
    summoner: 'Summoner — conjures minions (odd turns); never attacks directly.',
    summoned: 'Summoned — vanishes when no summoner is in sight.',
  };

  // Boss ability descriptions, keyed by ability id.
  const BOSS_ABILITY_INFO = {
    summon: 'Conjures a fresh guardian to shield itself.',
    blink: 'Teleports next to the king and strikes.',
    pierce: 'Looses a searing bolt down its line.',
    warden: 'Summons guardians and looses piercing bolts.',
    sovereign: 'Summons, blinks, and pierces — the realm’s mightiest.',
  };

  // A short "Name — effect" label for a consumable, from the shared CONSUMABLES data.
  function potionLabel(potion) {
    const info = CONSUMABLES[potion];
    return info ? `${info.name} — ${info.desc}` : 'A mysterious potion.';
  }

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
      const stats = [`HP ${p.hp}/${p.maxHp}`, `Sight ${p.vision}`, `Move ${p.moveRange}`, `Gold ${p.gold}`];
      stats.push(`Weapon slots ${p.maxCards} · Equip slots ${p.maxEquipment}`);
      if (p.evade) stats.push(`Evasion ${Math.round(p.evade * 100)}%`);
      addExamineBlock('Your King', stats);

      // Classes the king has taken, with their level.
      const classes = Object.keys(p.classLevels || {}).filter((k) => p.classLevels[k] > 0);
      if (classes.length) {
        const lines = classes.map((k) => `${CLASSES[k].name} Lv ${p.classLevels[k]}`);
        addExamineBlock('Classes', lines);
      }
      // Worn equipment.
      if ((p.equipment || []).length) {
        addExamineBlock('Equipment', p.equipment.map((w) => `${equipItemName(w)} — ${equipItemDesc(w)}`));
      }
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
        const bossLine = enemy.boss && enemy.ability ? BOSS_ABILITY_INFO[enemy.ability] : null;
        addExamineBlock(`Enemy — ${enemy.kind}`, [PIECE_INFO[enemy.kind] || '', ROLE_INFO[enemyRole(enemy)] || null, bossLine, state, buyable]);
      }
      const item = gameState.items.find((i) => i.x === tx && i.y === ty);
      if (item) {
        addExamineBlock('Item', item.kind === 'consumable' ? potionLabel(item.potion) : `Gold — worth ${item.amount}.`);
      }
    }

    const onBuilding = (b) => b && b.x === tx && b.y === ty && (b.discovered || visible);
    if (onBuilding(gameState.exit)) {
      addExamineBlock(
        'Stairs',
        gameState.exit.locked
          ? 'Barred by the floor’s guardian — defeat the boss to unbar it.'
          : 'Descend to the next floor (the king mends a little).',
      );
    }
    if (onBuilding(gameState.altar)) {
      addExamineBlock(
        'Class Altar',
        gameState.altar.used ? 'Spent — dormant.' : 'Embrace one class path: a rule-changing perk for your build.',
      );
    }
    if (onBuilding(gameState.equipShop)) {
      addExamineBlock('Equipment shop', 'Buy passive equipment (worn in your equipment slots) for gold.');
    }
    if (onBuilding(gameState.weaponShop)) {
      addExamineBlock('Weapon Shop', 'Buy movement cards drawn from foes you have seen.');
    }
    if (onBuilding(gameState.potionShop)) {
      addExamineBlock('Apothecary', 'Buy potions into your satchel, to drink later (costs a turn).');
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
      queueTip('enemyKing');
    }
    if (visible.some((enemy) => enemy.statue)) {
      queueTip('statue');
    }
    if (visible.some((enemy) => enemy.turret)) {
      queueTip('turret');
    }
    if (visible.some((enemy) => enemy.boss)) {
      queueTip('boss');
    }
    if (visible.some((enemy) => enemy.mage)) {
      queueTip('mage');
    }
    if (visible.some((enemy) => enemy.skirmisher)) {
      queueTip('skirmisher');
    }
    if (visible.some((enemy) => enemy.armored)) {
      queueTip('armored');
    }
    if (visible.some((enemy) => enemy.summoner)) {
      queueTip('summoner');
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
    equipShopScreen.classList.add('hidden');
    potionShopScreen.classList.add('hidden');
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
    scanVisibleTips(gameState);
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

  /* ----------------------------- class altar ---------------------------- */

  function renderAltar() {
    altarMessage.textContent = gameState.altarMessage || '';
    altarList.innerHTML = '';
    const offers = (gameState.altar && gameState.altar.offers) || [];
    const levels = gameState.player.classLevels || {};
    for (const classKey of offers) {
      const cls = CLASSES[classKey];
      if (!cls) continue;
      const level = levels[classKey] || 0;
      const perk = cls.perks[level];
      if (!perk) continue;

      const row = document.createElement('li');
      row.className = 'shop-item';
      const info = document.createElement('div');
      info.className = 'shop-info';
      info.innerHTML =
        `<span class="shop-name">${cls.name} <small>Lv ${level + 1}/${cls.perks.length}</small></span>` +
        `<span class="shop-desc">${perk.name} — ${perk.desc}</span>`;
      const take = document.createElement('button');
      take.type = 'button';
      take.textContent = 'Take';
      take.addEventListener('click', () => {
        applyState(useClassAltar(gameState, classKey), true);
        Renderer.effect('powerup');
        closeAltar(); // one perk per altar, then it's spent
      });
      row.append(info, take);
      altarList.append(row);
    }
  }

  function openAltar() {
    screen = 'altar';
    gameState.altarMessage = '';
    renderAltar();
    altarScreen.classList.remove('hidden');
    queueTip('classAltar');
  }

  function closeAltar() {
    screen = 'playing';
    altarScreen.classList.add('hidden');
    saveGame(gameState);
  }

  /* ---------------------------- apothecary ------------------------------ */

  function renderPotionShop() {
    const p = gameState.player;
    potionShopGold.textContent = `Gold ${p.gold} · Satchel ${p.consumables.length}/${p.maxConsumables}`;
    potionShopMessage.textContent = gameState.shopMessage || 'Potions are used later from your satchel.';
    potionShopList.innerHTML = '';
    const offers = (gameState.potionShop && gameState.potionShop.offers) || [];
    offers.forEach((offer, index) => {
      const def = CONSUMABLES[offer.key];
      if (!def) return;
      const row = document.createElement('li');
      row.className = 'shop-item';
      const info = document.createElement('div');
      info.className = 'shop-info';
      info.innerHTML = `<span class="shop-name" style="color:${def.color}">${def.glyph} ${def.name}</span><span class="shop-desc">${def.desc}</span>`;
      const buy = document.createElement('button');
      buy.type = 'button';
      buy.textContent = `${def.cost}g`;
      buy.disabled = p.gold < def.cost || p.consumables.length >= p.maxConsumables;
      buy.addEventListener('click', () => {
        applyState(buyConsumable(gameState, index), true);
        renderPotionShop();
      });
      row.append(info, buy);
      potionShopList.append(row);
    });
  }

  function openPotionShop() {
    screen = 'potionshop';
    gameState.shopMessage = '';
    renderPotionShop();
    potionShopScreen.classList.remove('hidden');
    queueTip('potionShop');
  }

  function closePotionShop() {
    screen = 'playing';
    potionShopScreen.classList.add('hidden');
    saveGame(gameState);
  }

  /* --------------------------- equipment shop --------------------------- */

  // Names / descriptions that fold in a rare armor enchantment, if present.
  function equipItemName(it) {
    return EQUIPMENT[it.key].name + (it.enchant ? ` ${it.enchant.name}` : '');
  }
  function equipItemDesc(it) {
    return equipDesc(it.key) + (it.enchant ? ` · ${bonusDesc(it.enchant.stat, it.enchant.amount)}` : '');
  }

  // The king's currently worn equipment, as a short summary line.
  function wornEquipmentSummary() {
    const worn = gameState.player.equipment || [];
    if (!worn.length) {
      return 'Nothing equipped.';
    }
    return `Worn: ${worn.map((w) => equipItemName(w)).join(', ')}`;
  }

  function renderEquipShop() {
    equipShopGold.textContent = `Gold ${gameState.player.gold} · Slots ${gameState.player.equipment.length}/${gameState.player.maxEquipment}`;
    equipShopMessage.textContent = gameState.shopMessage || wornEquipmentSummary();
    equipShopList.innerHTML = '';

    const p = gameState.player;
    const offers = (gameState.equipShop && gameState.equipShop.offers) || [];
    offers.forEach((offer, index) => {
      const def = EQUIPMENT[offer.key];
      if (!def) return;
      const slotsFull = p.equipment.length >= p.maxEquipment;

      const row = document.createElement('li');
      row.className = 'shop-item';

      const info = document.createElement('div');
      info.className = 'shop-info';
      info.innerHTML = `<span class="shop-name">${equipItemName(offer)}</span><span class="shop-desc">${equipItemDesc(offer)}</span>`;

      const buy = document.createElement('button');
      buy.type = 'button';
      if (offer.sold) {
        buy.textContent = 'Sold';
        buy.disabled = true;
      } else {
        buy.textContent = `${def.cost}g`;
        buy.disabled = p.gold < def.cost;
        buy.addEventListener('click', () => {
          if (slotsFull) {
            promptReplaceEquipment(index);
          } else {
            applyState(buyEquipment(gameState, index), true);
            Renderer.effect('powerup');
            renderEquipShop();
          }
        });
      }

      row.append(info, buy);
      equipShopList.append(row);
    });
  }

  // With equipment slots full, ask which worn piece to swap out, then buy.
  function promptReplaceEquipment(offerIndex) {
    const p = gameState.player;
    const offer = gameState.equipShop.offers[offerIndex];
    const def = EQUIPMENT[offer.key];
    if (p.gold < def.cost) {
      gameState.shopMessage = 'Not enough gold.';
      renderEquipShop();
      return;
    }
    equipShopMessage.textContent = `Replace which piece with the ${def.name}?`;
    equipShopList.innerHTML = '';
    p.equipment.forEach((worn, index) => {
      const row = document.createElement('li');
      row.className = 'shop-item';
      const info = document.createElement('div');
      info.className = 'shop-info';
      info.innerHTML = `<span class="shop-name">${equipItemName(worn)}</span><span class="shop-desc">${equipItemDesc(worn)}</span>`;
      const swap = document.createElement('button');
      swap.type = 'button';
      swap.textContent = 'Replace';
      swap.addEventListener('click', () => {
        applyState(buyEquipment(gameState, offerIndex, index), true);
        renderEquipShop();
      });
      row.append(info, swap);
      equipShopList.append(row);
    });
    const cancel = document.createElement('li');
    cancel.className = 'shop-item';
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', renderEquipShop);
    cancel.append(cancelBtn);
    equipShopList.append(cancel);
  }

  function openEquipShop() {
    screen = 'equipshop';
    gameState.shopMessage = '';
    renderEquipShop();
    equipShopScreen.classList.remove('hidden');
    queueTip('equipshop');
  }

  function closeEquipShop() {
    screen = 'playing';
    equipShopScreen.classList.add('hidden');
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

    // Feedback flashes for what just happened.
    if (nextState.lastAction === 'combat') {
      Renderer.effect('kill');
    } else if (nextState.lastAction === 'item' && nextState.pickupKind !== 'gold') {
      Renderer.effect('heal');
    }

    if (nextState.lastAction === 'item') {
      queueTip(nextState.pickupKind === 'gold' ? 'gold' : 'consumable');
    }
    if (nextState.won) {
      // Let the victory flash play for a beat before the overlay drops.
      Renderer.effect('victory');
      pendingAction = 'victory';
      animTimer = PLAYER_MOVE_TIME * 3;
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
      if (gameState.lastShot) {
        const s = gameState.lastShot;
        Renderer.rangedShot(s.fromX, s.fromY, s.toX, s.toY, s.role);
      }
      if (gameState.player.hp < hpBefore) {
        Renderer.effect(gameState.gameOver ? 'death' : 'hit');
        flashHealth();
        if (!gameState.gameOver) {
          queueTip('hp');
        }
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

    // Turn complete: maybe reinforce, persist, then open a building if stepped on.
    applyState(maybeSpawnEnemy(gameState), true);
    const altarPending = gameState.pendingAltar;
    const equipShopPending = gameState.pendingEquipShop;
    const weaponShopPending = gameState.pendingWeaponShop;
    const potionShopPending = gameState.pendingPotionShop;
    gameState.pendingAltar = false;
    gameState.pendingEquipShop = false;
    gameState.pendingWeaponShop = false;
    gameState.pendingPotionShop = false;
    saveGame(gameState);
    if (altarPending) {
      openAltar();
    } else if (equipShopPending) {
      openEquipShop();
    } else if (weaponShopPending) {
      openWeaponShop();
    } else if (potionShopPending) {
      openPotionShop();
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
  victoryContinueButton.addEventListener('click', continueAfterVictory);
  victoryAgainButton.addEventListener('click', newGame);
  victoryTitleButton.addEventListener('click', showTitle);
  altarCloseButton.addEventListener('click', closeAltar);
  equipShopCloseButton.addEventListener('click', closeEquipShop);
  potionShopCloseButton.addEventListener('click', closePotionShop);
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

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

  // screen: 'title' | 'class' | 'playing' | 'altar' | 'weaponshop' | 'potionshop' | 'gameover' | 'victory' | 'tutorial' | 'options'
  let screen = 'title';
  let gameState = null;

  // Card targeting: the index of the card currently awaiting a destination, or
  // null when not aiming. `cardTargets` are the tiles it can reach; `cardCursor`
  // is the keyboard-controlled target square.
  let cardTargeting = null;
  let cardTargets = [];
  let cardCursor = null;

  // Blink-scroll targeting: the satchel index of the blink scroll being aimed (or
  // null), and the tiles it may hop to.
  let blinkTargeting = null;
  let blinkTiles = [];
  let blinkKind = null; // 'blink' | 'digging'

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
    const p = gameState.player;
    const cls = CLASSES[highestClass(p)];
    floorLabel.textContent = `Floor ${gameState.floor}${cls ? ' · ' + cls.name : ''}`;
    if (floorNameLabel) floorNameLabel.textContent = floorName(gameState.floor);
    turnLabel.textContent = `Turn ${gameState.turn} · ${p.exp || 0} exp`;
    healthLabel.textContent = `HP ${p.hp}/${p.maxHp}`;
    goldLabel.textContent = `Gold ${p.gold}`;
    if (rewardLabel) rewardLabel.textContent = `Boss bounty ${floorGoldReward(gameState)}`;
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
    if (statuses.invisible > 0) {
      parts.push(`Invisible ${statuses.invisible}`);
    }
    if (gameState && gameState.fogClouds && Object.keys(gameState.fogClouds).length) {
      parts.push('Fogged');
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
  // Colors per weapon category (border tint on the card slot).
  const CATEGORY_COLOR = { melee: '#dc2626', ranged: '#65a30d', spell: '#a855f7' };

  function renderCards() {
    cardBar.innerHTML = '';
    if (!gameState) {
      return;
    }
    const { cards, caps } = gameState.player;
    const capCounts = caps || { melee: 0, ranged: 0, spell: 0 };

    // Owned cards first, in inventory order (their 1-based index is the hotkey).
    cards.forEach((card, i) => {
      cardBar.append(makeCardSlot(card, i));
    });
    // Then an empty placeholder per unused category capacity.
    for (const cat of ['melee', 'ranged', 'spell']) {
      const owned = cards.filter((c) => (c.category || 'melee') === cat).length;
      for (let k = owned; k < (capCounts[cat] || 0); k += 1) {
        const slot = document.createElement('button');
        slot.type = 'button';
        slot.className = 'card-slot empty';
        slot.textContent = cat[0].toUpperCase();
        slot.title = `Empty ${cat} slot`;
        slot.style.borderColor = CATEGORY_COLOR[cat];
        slot.disabled = true;
        cardBar.append(slot);
      }
    }
  }

  function makeCardSlot(card, i) {
    const cat = card.category || 'melee';
    const slot = document.createElement('button');
    slot.type = 'button';
    slot.className = 'card-slot';
    slot.style.borderColor = CATEGORY_COLOR[cat] || '#888';
    slot.textContent = getPieceLabel(card.kind);
    const traits = card.traits || [];
    const traitText = traits.length ? ` · ${traits.map((t) => TRAIT_INFO[t].name).join(', ')}` : '';
    slot.title = `[${i + 1}] ${cat} ${card.kind} (rating ${card.rating || 1})${traitText}`;
    const onCooldown = card.remaining > 0;
    if (cardTargeting === i) {
      slot.classList.add('targeting');
    } else if (onCooldown) {
      slot.classList.add('cooldown');
    } else {
      slot.classList.add('ready');
    }
    // A tiny hotkey number in one corner, and the rating in another.
    const key = document.createElement('span');
    key.className = 'card-trait';
    key.style.left = '2px';
    key.style.right = 'auto';
    key.textContent = String(i + 1);
    slot.append(key);
    if ((card.rating || 1) > 1) {
      const rate = document.createElement('span');
      rate.className = 'card-trait';
      rate.textContent = `${card.rating}★`;
      slot.append(rate);
    }
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
    // Blink and digging scrolls need a target tile — enter aiming mode instead.
    const key = gameState.player.consumables[index];
    if (key === 'blink' || key === 'digging') {
      startScrollTargeting(index, key);
      return;
    }
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

  function startScrollTargeting(index, kind) {
    blinkKind = kind;
    blinkTiles = kind === 'digging' ? diggingTargets(gameState) : blinkTargets(gameState);
    if (!blinkTiles.length) {
      gameState.message = kind === 'digging' ? 'Nothing to dig.' : 'Nowhere in sight to blink to.';
      updateHud();
      return;
    }
    blinkTargeting = index;
    gameState.message = kind === 'digging' ? 'Dig: click along a straight line.' : 'Blink: click a tile you can see.';
    updateHud();
  }

  function cancelBlinkTargeting() {
    blinkTargeting = null;
    blinkTiles = [];
    blinkKind = null;
  }

  // Resolve a blink/dig to the chosen tile (costs a turn unless Quick Draw).
  function confirmBlink(tileX, tileY) {
    const index = blinkTargeting;
    const kind = blinkKind;
    cancelBlinkTargeting();
    const result = kind === 'digging' ? useDigging(gameState, index, tileX, tileY) : useBlink(gameState, index, tileX, tileY);
    if (result.lastAction === 'blocked') {
      applyState(result, false);
      return;
    }
    Renderer.effect('powerup');
    if (result.lastAction === 'consume-free') {
      applyState(result, true);
    } else {
      processPlayerResult(result);
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
    cardTargets = getCardMoves(gameState, card);
    if (!cardTargets.length) {
      gameState.message = 'That card has no target in reach.';
      cancelCardTargeting();
      updateHud();
      return;
    }
    // Start the keyboard cursor on the reachable tile nearest the king.
    cardCursor = cardTargets
      .slice()
      .sort((a, b) => distToKing(a) - distToKing(b))[0];
    cardCursor = { x: cardCursor.x, y: cardCursor.y };
    gameState.message = `Aiming the ${card.category || 'melee'} ${card.kind} — click a target or steer with the numpad, then Enter (Esc to cancel).`;
    showCardInfo(card);
    updateHud();
  }

  // Show the card being aimed (category, movement, rating, traits) in the pane.
  function showCardInfo(card) {
    examineEl.innerHTML = '';
    const cat = card.category || 'melee';
    const verb = cat === 'melee' ? 'Strikes by moving onto the foe.' : cat === 'ranged' ? 'Fires from afar (blocked by cover); you hold your tile.' : 'A bolt that pierces everything on its path; you hold your tile.';
    addExamineBlock(`${card.kind} — ${cat} · rating ${card.rating || 1}`, [PIECE_INFO[card.kind] || '', verb, `Cooldown ${card.cooldown} turns`]);
    for (const t of card.traits || []) {
      addExamineBlock(`Trait — ${TRAIT_INFO[t].name}`, TRAIT_INFO[t].desc);
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
    blinkTargeting = null; // never aim a card and a blink at once
    blinkTiles = [];
  }

  /* ------------------------------ tile popover --------------------------- */

  const TERRAIN_NAMES = {
    normal: 'Open ground',
    wall: 'Wall — blocks sight & movement',
    lava: 'Lava — you cannot cross it (demons can); clear to see through',
    fire: 'Fire — burns non-demons caught in it; dies down after 2 turns',
    water: 'Water — slow (cross one per move); no cards while wading',
    mud: 'Mud — slow (cross one per move); no cards while slogging',
    ice: 'Ice — slippery, you slide across',
    brush: 'Brush — blocks sight; trampled when stepped on',
    trees: 'Trees — block sight, but you can move through',
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
        } else if (enemy.boss) {
          tag = ` (boss — HP ${enemy.hp}/${enemy.maxHp})`;
        } else if (enemy.mage) {
          tag = ' (mage — piercing bolt on odd turns)';
        } else if (enemy.skirmisher) {
          tag = ' (skirmisher — strikes and darts away)';
        } else if (enemy.brokenShield) {
          tag = ' (shield broken — re-arms out of sight)';
        } else if (enemy.armored) {
          tag = ' (armored — a hit shatters its shield; it survives the first blow)';
        } else if (enemy.flying) {
          tag = ' (flying — crosses any terrain but walls)';
        } else if (enemy.summoner) {
          tag = ' (summoner — conjures minions)';
        } else {
          tag = enemy.surprised ? ' (surprised)' : enemy.awake ? ' (hostile)' : '';
        }
        const label = (typeof enemyDisplayName === 'function' && enemyDisplayName(enemy)) || enemy.kind;
        lines.push(`Enemy: ${label}${tag}`);
      }
      const item = gameState.items.find((i) => i.x === tx && i.y === ty);
      if (item) {
        lines.push(item.kind === 'consumable' ? potionLabel(item.potion) : `Gold — ${item.amount}`);
      }
    }
    const onBuilding = (b) => b && b.x === tx && b.y === ty && (b.discovered || visible);
    if (onBuilding(gameState.exit)) {
      lines.push('Stairs down to the next floor');
    }
    if (onBuilding(gameState.altar)) {
      lines.push(gameState.altar.used ? 'Class altar — spent' : 'Class altar — spend exp on a perk');
    }
    if (onBuilding(gameState.weaponShop)) {
      lines.push(`${SHOP_VARIANT_NAMES[gameState.weaponShop.variant] || 'Weapon shop'} — buy ${gameState.weaponShop.category || 'melee'} cards`);
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
  };

  // One-line descriptions of each special enemy role (for the examine pane).
  const ROLE_INFO = {
    statue: 'Statue — inert until you step beside it, then it wakes.',
    turret: 'Turret — fixed; fires its piece pattern, cannot be destroyed.',
    boss: 'Boss — a guardian with a HP bar and a signature ability.',
    mage: 'Mage — fires a piercing bolt down its line (odd turns), slaying all in the way.',
    skirmisher: 'Skirmisher — strikes from a clear line (odd turns), then retreats.',
    armored: 'Armored — survives the first hit (its shield shatters); it re-arms out of sight.',
    flying: 'Flying — moves over any terrain except walls.',
    summoner: 'Summoner — conjures minions (odd turns); never attacks directly.',
  };

  // Boss ability descriptions, keyed by the boss `special` id.
  const BOSS_ABILITY_INFO = {
    armorAura: 'Armor Aura — adjacent minions gain armor; it summons reinforcements.',
    doubleAct: 'Relentless — acts twice each turn, loosing shots from its line.',
    frostwake: 'Frostwake — freezes the ground it moves across.',
    siege: 'Siege — smashes through walls and never loses your trail.',
    aquatic: 'Aquatic — crosses any terrain but walls/lava; mends every other turn.',
    undying: 'Undying — rises again when slain (you keep its gold from the first death).',
    gore: 'Gore — every blow knocks you back for triple damage.',
    petrify: 'Petrify — turns every other unit to stone and sears you while visible.',
    bonehide: 'Bonehide — immune to ranged blows; strike it up close.',
    inferno: 'Inferno — wreathes itself in fire each turn (searing you if adjacent); hurls searing bolts at range.',
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
      const stats = [`HP ${p.hp}/${p.maxHp}`, `Sight ${p.vision}`, `Move ${p.moveRange}`, `Gold ${p.gold} · ${p.exp || 0} exp`];
      const caps = p.caps || { melee: 0, ranged: 0, spell: 0 };
      const usedByCat = (cat) => (p.cards || []).filter((c) => (c.category || 'melee') === cat).length;
      stats.push(`Cards — melee ${usedByCat('melee')}/${caps.melee} · ranged ${usedByCat('ranged')}/${caps.ranged} · spell ${usedByCat('spell')}/${caps.spell}`);
      stats.push(`Potion slots ${p.maxConsumables}`);
      addExamineBlock('Your King', stats);

      // Classes the king has invested in, with their level and perks.
      const classes = Object.keys(p.classLevels || {}).filter((k) => p.classLevels[k] > 0);
      if (classes.length) {
        const lines = classes.map((k) => `${CLASSES[k].name} Lv ${p.classLevels[k]}`);
        addExamineBlock('Classes', lines);
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
        const bossLine = enemy.boss && enemy.special ? BOSS_ABILITY_INFO[enemy.special] : null;
        const hpLine = enemy.boss && enemy.maxHp ? `HP ${enemy.hp}/${enemy.maxHp} · form ${(enemy.phase || 0) + 1}/${(enemy.phases || [0]).length}` : null;
        const display = typeof enemyDisplayName === 'function' ? enemyDisplayName(enemy) : null;
        const title = enemy.boss
          ? `Boss — ${(enemy.bossName || enemy.kind).replace(/^the /, '')}`
          : display
            ? `${display} — ${enemy.kind}`
            : `Enemy — ${enemy.kind}`;
        addExamineBlock(title, [PIECE_INFO[enemy.kind] || '', ROLE_INFO[enemyRole(enemy)] || null, bossLine, hpLine, state, buyable]);
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
        gameState.altar.used ? 'Spent — dormant.' : 'Spend exp to learn a class perk (1 exp per floor descended).',
      );
    }
    if (onBuilding(gameState.weaponShop)) {
      const v = gameState.weaponShop.variant;
      addExamineBlock(SHOP_VARIANT_NAMES[v] || 'Weapon Shop', `Buy ${gameState.weaponShop.category || 'melee'} cards drawn from foes you have seen.`);
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
    if (visible.some((enemy) => enemy.armored || enemy.brokenShield)) {
      queueTip('armored');
    }
    if (visible.some((enemy) => enemy.flying)) {
      queueTip('flying');
    }
    if (visible.some((enemy) => isJumperKind(enemy.kind) && enemy.awake)) {
      queueTip('jumper');
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
    classScreen.classList.add('hidden');
    gameoverScreen.classList.add('hidden');
    victoryScreen.classList.add('hidden');
    altarScreen.classList.add('hidden');
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

  // The class's starting kit, as a one-line bullet.
  function classStartLine(cls) {
    if (cls.weapon) {
      const w = cls.weapon;
      const traits = w.traits && w.traits.length ? ` (${w.traits.map((t) => TRAIT_INFO[t].name).join(', ')})` : '';
      return `Starts with a ${w.category || 'melee'} ${w.kind} card, rating ${w.rating || 1}${traits}`;
    }
    if (cls.startKit === 'potions') return 'Starts with a satchel of random potions';
    return 'Starts with a satchel of random scrolls';
  }

  // The full hover detail for a class: heading, blurb, card caps, then a bullet per
  // starting kit and per perk (L1-L3).
  function classDetailText(key) {
    const cls = CLASSES[key];
    const caps = cls.caps || { melee: 0, ranged: 0, spell: 0 };
    const lines = [cls.name, cls.blurb, ''];
    lines.push(`Card slots — melee ${caps.melee} · ranged ${caps.ranged} · spell ${caps.spell}`);
    lines.push(`• ${classStartLine(cls)}`);
    cls.perks.forEach((perk, i) => lines.push(`• L${i + 1} ${perk.name} — ${perk.desc}`));
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
    startGame(createInitialState(classKey || 'valkyrie'));
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


  /* ----------------------------- weapon shop ----------------------------- */

  // A "knight · Cleave, Leech" style label for a card / offer.
  function cardName(c) {
    const traits = c.traits || [];
    const list = traits.length ? ` · ${traits.map((t) => TRAIT_INFO[t].name).join(', ')}` : '';
    const cat = c.category || 'melee';
    const star = (c.rating || 1) > 1 ? ` ${c.rating}★` : '';
    return `${getPieceLabel(c.kind)} ${cat} ${c.kind}${star}${list}`;
  }

  function cardDesc(c) {
    const cat = c.category || 'melee';
    const parts = [`reach ${cardReach(c.kind, c.rating || 1)}`, `cooldown ${cardCooldown(c.kind, cat)}`];
    for (const t of c.traits || []) parts.push(TRAIT_INFO[t].desc);
    return parts.join(' · ');
  }

  function renderWeaponShop() {
    const shop = gameState.weaponShop || {};
    const variantName = SHOP_VARIANT_NAMES[shop.variant] || 'Weapon Shop';
    const category = shop.category || 'melee';
    weaponshopGold.textContent = `Gold ${gameState.player.gold}`;
    weaponshopMessage.textContent = gameState.shopMessage || `${variantName} — ${category} cards.`;
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
      const cost = cardCost(offer.kind, (offer.traits || []).length, offer.rating || 1);
      const cat = offer.category || 'melee';
      const catFull = cardCountByCategory(p, cat) >= cardCapFor(p, cat);
      const noRoom = cardCapFor(p, cat) <= 0;

      const row = document.createElement('li');
      row.className = 'shop-item';

      const info = document.createElement('div');
      info.className = 'shop-info';
      info.innerHTML = `<span class="shop-name">${cardName(offer)}</span><span class="shop-desc">${cardDesc(offer)}</span>`;

      const buy = document.createElement('button');
      buy.type = 'button';
      if (offer.sold) {
        buy.textContent = 'Sold';
        buy.disabled = true;
      } else if (noRoom) {
        buy.textContent = 'N/A';
        buy.disabled = true;
        buy.title = `Your class can't wield ${cat} cards.`;
      } else {
        buy.textContent = `${cost}g`;
        buy.disabled = p.gold < cost;
        buy.addEventListener('click', () => {
          if (catFull) {
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
    const cat = offer.category || 'melee';
    if (p.gold < cardCost(offer.kind, (offer.traits || []).length, offer.rating || 1)) {
      gameState.shopMessage = 'Not enough gold.';
      renderWeaponShop();
      return;
    }
    weaponshopMessage.textContent = `Replace which ${cat} card with the ${offer.kind}?`;
    weaponshopList.innerHTML = '';
    p.cards.forEach((card, index) => {
      if ((card.category || 'melee') !== cat) return; // only same-category swaps keep caps valid
      const row = document.createElement('li');
      row.className = 'shop-item';
      const info = document.createElement('div');
      info.className = 'shop-info';
      info.innerHTML = `<span class="shop-name">${cardName(card)}</span><span class="shop-desc">${cardDesc(card)}</span>`;
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
    if (nextState.lastAction === 'combat' || nextState.lastAction === 'move-free') {
      Renderer.effect('kill');
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
    // Quick weapons / Bloodrush kills / free potions cost no turn — no enemy phase.
    if (nextState.enemyTurn === false || nextState.lastAction === 'card-free' || nextState.lastAction === 'move-free' || nextState.lastAction === 'consume-free') {
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
    const weaponShopPending = gameState.pendingWeaponShop;
    const potionShopPending = gameState.pendingPotionShop;
    gameState.pendingAltar = false;
    gameState.pendingWeaponShop = false;
    gameState.pendingPotionShop = false;
    saveGame(gameState);
    if (altarPending) {
      openAltar();
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

    // Aiming a blink scroll: a click on a lit tile blinks there; else cancels.
    if (blinkTargeting !== null) {
      if (!isIdle()) {
        return;
      }
      const target = blinkTiles.find((t) => t.x === tileX && t.y === tileY);
      if (target) {
        confirmBlink(tileX, tileY);
      } else {
        cancelBlinkTargeting();
        examineTile(tileX, tileY);
      }
      return;
    }

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
    // While aiming a card or a blink, show its reachable tiles instead of moves.
    const aiming = cardTargeting !== null;
    const blinking = blinkTargeting !== null;
    const targets = aiming ? cardTargets : blinking ? blinkTiles : null;
    Renderer.draw(gameState, isIdle() && !aiming && !blinking, targets, aiming ? cardCursor : null);
    requestAnimationFrame(step);
  }

  /* ------------------------------- wiring -------------------------------- */

  document.addEventListener('keydown', (event) => {
    // While aiming a blink scroll (click-targeted): Escape cancels; swallow the rest.
    if (blinkTargeting !== null) {
      if (event.key === 'Escape') {
        event.preventDefault();
        cancelBlinkTargeting();
        gameState.message = 'Blink cancelled.';
        updateHud();
      }
      return;
    }

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
  altarCloseButton.addEventListener('click', closeAltar);
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

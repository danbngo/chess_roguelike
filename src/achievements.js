// Achievements: a badge case, persisted in localStorage.
//
// Every badge is earned by finishing a run that satisfies its `test`. DIFFICULTY only ever decides
// the badge's METAL — bronze (easy) < silver (hard) < gold (nightmare) — so re-earning one on a
// harder run UPGRADES it and never downgrades it. The store is a flat map of id -> tier.
//
// The player's run-long ledger lives on `player` (see createPlayer's "ACHIEVEMENT trackers"): it is
// all "never did X" flags and "how many X" counters, so a test is a plain predicate over the final
// state — no bookkeeping here.

const ACH_KEY = 'chess-roguelike-achievements';
const ACH_TIERS = ['bronze', 'silver', 'gold'];
const ACH_TIER_BY_DIFFICULTY = { easy: 'bronze', hard: 'silver', nightmare: 'gold' };
const ACH_TIER_LABEL = { bronze: 'Bronze', silver: 'Silver', gold: 'Gold' };
const ACH_TIER_COLOR = { bronze: '#c88a4a', silver: '#c9d1d9', gold: '#f5c542' };

// Which metal a run of this difficulty stamps, and whether it beats what's already in the case.
function achTierFor(difficulty) {
  return ACH_TIER_BY_DIFFICULTY[difficulty] || 'silver';
}
function achTierRank(tier) {
  const i = ACH_TIERS.indexOf(tier);
  return i < 0 ? -1 : i;
}

/* ------------------------------- the badges ------------------------------- */

// `test(p, state)` — p is the final player (the ledger), state the final game state. `won` badges
// are only ever offered on a victory; the list is checked top-to-bottom for display order.
const ACHIEVEMENTS = (() => {
  const list = [];
  const add = (id, name, desc, test, opts) => list.push({ id, name, desc, test, ...(opts || {}) });

  // --- Mastery: every perk in a subclass chain (three tiers) ---------------
  for (const classKey of Object.keys(CLASSES)) {
    const cls = CLASSES[classKey];
    const chains = {};
    for (const perk of cls.perks) (chains[perk.chain] = chains[perk.chain] || []).push(perk.id);
    for (const chain of Object.keys(chains)) {
      const ids = chains[chain];
      add(
        `mastery:${classKey}:${chain}`,
        `${chain} Mastery`,
        `Take every perk in the ${chain} chain (${cls.name}).`,
        (p) => p.className === classKey && ids.every((id) => (p.takenPerks || []).includes(id)),
      );
    }
  }

  // --- Victory: per subclass, per class, and the full set ------------------
  const subclassOf = (p) => {
    // The chain he invested in most — a win "with" a subclass means he actually walked it.
    const cls = CLASSES[p.className];
    if (!cls) return null;
    const count = {};
    for (const perk of cls.perks) {
      if ((p.takenPerks || []).includes(perk.id)) count[perk.chain] = (count[perk.chain] || 0) + 1;
    }
    let best = null;
    for (const chain of Object.keys(count)) if (!best || count[chain] > count[best]) best = chain;
    return best;
  };
  for (const classKey of Object.keys(CLASSES)) {
    const cls = CLASSES[classKey];
    const chains = [...new Set(cls.perks.map((perk) => perk.chain))];
    for (const chain of chains) {
      add(
        `win:${classKey}:${chain}`,
        `${chain} Victor`,
        `Win a run as the ${cls.name}, walking the ${chain} path.`,
        (p) => p.className === classKey && subclassOf(p) === chain,
        { won: true },
      );
    }
    add(`winclass:${classKey}`, `${cls.name} Victor`, `Win a run as the ${cls.name}.`, (p) => p.className === classKey, { won: true });
  }
  // "Win with ALL" can't be judged from one run — it is awarded by scanning the case (see below).
  add('winclass:all', 'Triple Crown', 'Win a run as every class.', () => false, { won: true, derived: true });

  // --- Conduct: how he took the dungeon -----------------------------------
  add('floor:unhit', 'Untouched Floor', 'Clear a whole floor without taking a single hit.', (p) => Boolean(p.clearedFloorUnhit));
  add('run:unhit', 'Flawless', 'Win the run without ever being hit.', (p) => !p.wasHit, { won: true });
  add('boss:all', 'Giantslayer', 'Win having felled every floor guardian.', (p, s) => p.bossesSlain >= (s.floor || FINAL_FLOOR), { won: true });
  add('boss:none', 'Ghost of the Deep', 'Win without felling a single floor guardian.', (p) => !p.bossesSlain, { won: true });
  add('turret:none', 'Let Them Rust', 'Win without destroying a single turret.', (p) => !p.turretsDestroyed, { won: true });
  add('circle:none', 'Leave the Gate Open', 'Win without dispelling a single summoning circle.', (p) => !p.circlesDispelled, { won: true });
  add('mini:none', 'Beneath Notice', 'Win without felling a single mini-boss.', (p) => !p.miniBossesSlain, { won: true });
  // The inverse: hunt down every rogue that ever claws in. (At least one must have shown up — an
  // empty run is not a hunt.)
  add(
    'mini:all', 'Kingslayer', 'Win having felled every mini-boss that dared show itself.',
    (p) => p.miniBossesSpawned > 0 && p.miniBossesSlain >= p.miniBossesSpawned,
    { won: true },
  );
  add('kill:none', 'Pacifist', 'Win without killing a single enemy.', (p) => !p.killedEnemy, { won: true });

  // --- Conduct: pace ------------------------------------------------------
  add('pace:150', 'Brisk', 'Win never spending more than 150 turns on any one floor.', (p) => p.maxFloorTurns <= 150, { won: true });
  add('pace:100', 'Relentless', 'Win never spending more than 100 turns on any one floor.', (p) => p.maxFloorTurns <= 100, { won: true });
  add('pace:75', 'Blur', 'Win never spending more than 75 turns on any one floor.', (p) => p.maxFloorTurns <= 75, { won: true });

  // --- Conduct: restraint -------------------------------------------------
  add('card:none', 'Bare Hands', 'Win without ever playing a weapon card.', (p) => !p.usedCard, { won: true });
  add('attack:none', 'Never Lifted a Finger', 'Win without ever landing a plain attack.', (p) => !p.usedNormalAttack, { won: true });
  add('door:none', 'No Doors Were Opened', 'Win without opening a single door.', (p) => !p.openedDoor, { won: true });
  add('boulder:none', 'Immovable', 'Win without pushing a single boulder.', (p) => !p.pushedBoulder, { won: true });
  add('ice:none', 'Thin Ice', 'Win without breaking or melting a single ice slab.', (p) => !p.brokeIce, { won: true });
  add('water:none', 'Bone Dry', 'Win without ever touching water.', (p) => !p.touchedWater, { won: true });


  // --- Devotion: purity and its opposite -----------------------------------
  // Which chains he actually put perks into, and how many in each.
  const chainTally = (p) => {
    const cls = CLASSES[p.className];
    const out = {};
    if (!cls) return out;
    for (const id of p.takenPerks || []) {
      const perk = (cls.perks || []).find((k) => k.id === id);
      if (perk && perk.chain) out[perk.chain] = (out[perk.chain] || 0) + 1;
    }
    return out;
  };
  for (const classKey of Object.keys(CLASSES)) {
    const cls = CLASSES[classKey];
    for (const chain of [...new Set(cls.perks.map((perk) => perk.chain))]) {
      add(
        `purist:${classKey}:${chain}`,
        `${chain} Purist`,
        `Win a run taking perks from the ${chain} chain and NOTHING else.`,
        // At least one perk, and every one of them from this chain. "Took nothing at all" is not
        // purity — it is the Pacifist badge's problem, not this one.
        (p) => {
          if (p.className !== classKey) return false;
          const tally = chainTally(p);
          return (tally[chain] || 0) > 0 && Object.keys(tally).length === 1;
        },
        { won: true },
      );
    }
  }
  add(
    'jack:4', 'Jack of All Trades', 'Win a run holding at least one perk from four different subclasses.',
    (p) => Object.keys(chainTally(p)).length >= 4,
    { won: true },
  );

  // --- Conduct: the fire ---------------------------------------------------
  add(
    'fire:none', 'Cold Blooded', 'Win without fire ever touching you — no lava, no torch, no burning tree, no spellfire.',
    (p) => !p.burnedByFire,
    { won: true },
  );

  // --- Slaughter -----------------------------------------------------------
  add('kill:floor100', 'Abattoir', 'Fell 100 enemies on a single floor.', (p) => (p.maxKillsOnFloor || 0) >= 100);
  add('kill:mini10', 'Rogues Gallery', 'Fell 10 mini-bosses on a single floor.', (p) => (p.maxMinisOnFloor || 0) >= 10);
  add('kill:turret10', 'Scrap Merchant', 'Destroy 10 turrets on a single floor.', (p) => (p.maxTurretsOnFloor || 0) >= 10);
  add('kill:turn5', 'Five Finger Discount', 'Fell five enemies in a single turn.', (p) => (p.maxKillsInTurn || 0) >= 5);
  add('kill:turn8', 'Octuple Homicide', 'Fell EIGHT enemies in a single turn.', (p) => (p.maxKillsInTurn || 0) >= 8);
  add('kill:final', 'Regicide', 'Fell the last guardian of the Demon Castle.', (p) => Boolean(p.killedFinalBoss));

  // --- Slaughter: by means other than the sword ----------------------------
  add('kill:boulder', 'Between a Rock', 'Kill an enemy with a rolling boulder.', (p) => Boolean(p.killedWithBoulder));
  add('kill:lava', 'Sending Its Regards', 'Knock an enemy into lava.', (p) => Boolean(p.knockedIntoLava));
  add('kill:pit', 'Mind the Gap', 'Knock an enemy into a pit.', (p) => Boolean(p.knockedIntoPit));
  add('kill:foewithfoe', 'Friendly Fire', 'Kill an enemy WITH another enemy.', (p) => Boolean(p.killedFoeWithFoe));
  add('kill:beast', 'Beast Mode', 'Fell a guardian while running as the warhorse.', (p) => Boolean(p.bossKilledAsBeast));

  // --- Nerve ---------------------------------------------------------------
  add('nerve:defenestrated', 'Defenestrated', 'Get knocked clean down the stair and into the next floor.', (p) => Boolean(p.defenestrated));
  add('nerve:pitdive', 'Down the Rabbit Hole', 'Cornered with no move left, dive into a pit and scramble out the far side.', (p) => Boolean(p.pitDived));
  add('kill:alltraits', 'Trait Collector', 'In a single run, fell guardians bearing EVERY possible trait between them.', (p) => typeof BOSS_PERKS !== 'undefined' && BOSS_PERKS.every((k) => p.slainBossTraits && p.slainBossTraits[k]));
  add('nerve:floor', 'Hanging by a Thread', 'Take a stair down on your very last heart.', (p) => Boolean(p.finishedFloorOnOneHeart));
  add('nerve:win', 'Photo Finish', 'Win the run on your very last heart.', (p) => p.hp === 1, { won: true });
  add('hoard:spells', 'Full Deck', 'Hold five cards at once.', (p) => (p.cards || []).length >= 5);
  add('win:first', 'The Long Way Down', 'Win. However you managed it.', () => true, { won: true });

  // --- The stranger deaths of the king -------------------------------------
  // A plain read of the tags checkDeath banked. Only the RARE or the RIDICULOUS ends are worth a
  // badge — dying to a boss or a turret is a Tuesday, so those earn nothing. These do.
  const died = (tag) => (p, s) => Boolean(s && s.gameOver) && (p.deathTags || []).includes(tag);
  add('death:pit', 'The Floor Is Absent', 'Die falling into a pit.', died('pit'));
  add('death:lava', 'Well Done', 'Die to lava.', died('lava'));
  add('death:boulder', 'Rock Bottom', 'Die to a rolling boulder.', died('boulder'));
  add('death:ferz', 'Ferz Degree Murder', 'Die to a ferz. A FERZ.', died('ferz'));
  add('death:tree', 'Out of the Frying Pan', 'Die to a burning tree.', died('burningtree'));
  add('death:torch', 'Carrying a Torch', 'Die to a wall-torch.', died('torch'));
  add('death:confused', 'It Meant to Do That', 'Die to an enemy that had no idea what it was doing.', died('confused'));
  add('death:orb', 'So Close', 'Die with the Orb of Victory in your hands.', (p, s) => Boolean(s && s.gameOver) && Boolean(p.diedHoldingOrb));
  add('death:stalemate', 'Painted Into a Corner', 'Strand yourself somewhere with nowhere to step and nothing to spend.', died('stalemate'));

  return list;
})();

/* ------------------------------ the badge case ---------------------------- */

// The stored case: { id: tier }. Guarded so a blocked/full store fails quietly.
function loadAchievements() {
  try {
    const raw = localStorage.getItem(ACH_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}
function saveAchievements(store) {
  try {
    localStorage.setItem(ACH_KEY, JSON.stringify(store));
  } catch {
    /* ignore */
  }
}
function clearAchievements() {
  try {
    localStorage.removeItem(ACH_KEY);
  } catch {
    /* ignore */
  }
}

// Which badges this finished run satisfies, at what metal. `won` badges need a victory.
function achievementsForRun(state, won) {
  const p = state && state.player;
  if (!p) return [];
  const tier = achTierFor(p.difficulty);
  const earned = [];
  for (const a of ACHIEVEMENTS) {
    if (a.derived) continue; // awarded by scanning the case, not by one run
    if (a.won && !won) continue;
    let ok = false;
    try {
      ok = Boolean(a.test(p, state));
    } catch {
      ok = false;
    }
    if (ok) earned.push({ id: a.id, name: a.name, desc: a.desc, tier });
  }
  return earned;
}

// Bank a finished run: returns what it earned, each tagged `fresh` (brand new) or `upgraded`
// (already held, but this run's metal beats it). Badges already held at an equal-or-better metal
// are returned too, flagged neither — the run screen can still show them, greyed.
function recordRun(state, won) {
  const store = loadAchievements();
  const earned = achievementsForRun(state, won);
  const out = [];
  for (const e of earned) {
    const had = store[e.id];
    const fresh = !had;
    const upgraded = Boolean(had) && achTierRank(e.tier) > achTierRank(had);
    if (fresh || upgraded) store[e.id] = e.tier;
    out.push({ ...e, tier: store[e.id] || e.tier, fresh, upgraded });
  }
  // "Triple Crown": held once a class-victory badge exists for every class.
  const classes = Object.keys(CLASSES);
  const classTiers = classes.map((c) => store[`winclass:${c}`]).filter(Boolean);
  if (classTiers.length === classes.length) {
    // Its metal is the WEAKEST link — you've only truly done it all at the lowest metal you hold.
    const weakest = ACH_TIERS[Math.min(...classTiers.map(achTierRank))];
    const had = store['winclass:all'];
    const fresh = !had;
    const upgraded = Boolean(had) && achTierRank(weakest) > achTierRank(had);
    if (fresh || upgraded) store['winclass:all'] = weakest;
    if (fresh || upgraded) {
      const def = ACHIEVEMENTS.find((a) => a.id === 'winclass:all');
      out.push({ id: def.id, name: def.name, desc: def.desc, tier: weakest, fresh, upgraded });
    }
  }
  saveAchievements(store);
  return out;
}

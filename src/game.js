// Core game rules: building floors, and resolving king / enemy / shop actions.
// Pure logic — no DOM, no canvas, no storage.

/* --------------------------------- enemies -------------------------------- */

function createEnemy(type, x, y) {
  return {
    id: `${type}-${x}-${y}-${Math.random().toString(16).slice(2, 8)}`,
    kind: type,
    x,
    y,
    homeX: x,
    homeY: y,
    awake: false,
    surprised: false,
    frustrated: false,
    // Object roles (at most one): fixed turret, boss, or a destroyable summoning
    // circle. Ordinary enemies carry none.
    turret: false,
    boss: false,
    summonCircle: false, // stationary spawner; destroyed by stepping on it
    summoned: false, // a STATE: conjured, dispelled if it turns non-hostile
    charged: true, // turrets / circles act only when charged (not two turns running)
    lastSeen: null, // {x,y}: last tile the king was seen on (out-of-sight pursuit)
    lastSeenTtl: 0,
  };
}

// The single role a piece carries (or 'normal'), for display / icons.
function enemyRole(enemy) {
  if (enemy.boss) return 'boss';
  if (enemy.turret) return 'turret';
  if (enemy.summonCircle) return 'circle';
  return 'normal';
}

const JUMPER_KINDS = ['knight', 'nightrider', 'archbishop', 'chancellor', 'amazon'];
function isJumperKind(kind) {
  return JUMPER_KINDS.includes(kind);
}

// Whether an enemy may be attacked by the king right now. A summoning circle is
// destroyed by stepping on it; a boss and now a TURRET are targetable but soak HP
// (struck in place — see damageBoss / damageTurret). Ordinary pieces die in one.
function isCapturable(state, enemy) {
  if (!enemy) return false;
  return true;
}
function capturableAt(state, x, y) {
  return isCapturable(state, state.enemies.find((e) => e.x === x && e.y === y));
}

// Whether felling this piece should trigger the king's on-kill perks (cleave, leech,
// Quick Draw, Dazzle, Bloodrush). Only real enemy pieces count — NOT summoning
// circles or other structures (and never a mere non-lethal hit, handled by callers).
function isKillablePiece(enemy) {
  return Boolean(enemy) && !enemy.turret && !enemy.summonCircle;
}

// Has the floor's boss been defeated? True when no FLOOR GUARDIAN remains — mini-bosses and
// finale rush-bosses don't count (they're extra threats, not the floor's key-guardian).
function bossDefeated(state) {
  return !state.enemies.some((e) => e.boss && !e.mini && !e.rush);
}

// Wild Empathy (Druid): enemy / mini-boss KNIGHTS, NIGHTRIDERS and AMAZONS (never a true floor
// guardian) are wild beasts, and they are NEUTRAL to him. A neutral beast roams and takes no
// interest in the king whatever — it never hunts him, never strikes him, and nothing else on the
// board picks a fight with it either. It is simply not part of the war.
//
// It only JOINS him when he walks up and puts a hand on it (see charmBeasts). It used to bow the
// instant he laid EYES on one, which handed a Druid a free amazon from clean across the room for
// no more effort than turning a corner — the whole floor came over to his side while he stood
// still. Making him walk to it costs him the turns, the ground and the exposure.
//
// Striking one (setting `provokedBeast`) breaks the truce for good and it turns hostile.
function isNeutralBeast(state, e) {
  if (!e || !state.player.beastFriend) return false;
  if (e.provokedBeast) return false; // he struck it — the truce is off
  if (e.turret || e.summonCircle) return false;
  if (e.boss && !e.mini && !e.rush) return false; // a floor guardian is never tamed
  // ONLY horses — the knight and the nightrider (a horse that never stops running). Amazons are no
  // longer kin. Wild Empathy makes these roam harmlessly; it no longer turns them into allies.
  return e.kind === 'knight' || e.kind === 'nightrider';
}

// Wild Empathy no longer BEFRIENDS. It once let the king walk up to a neutral beast and take it as
// an ally; that is gone — the perk now only makes horses roam harmlessly (isNeutralBeast), nothing
// more. (Animal Form still rallies the horses to his side — see rallyHorses — but that is its own,
// deliberate ultimate.) Kept as a no-op so its call site and the ally machinery need no surgery.
function charmBeasts(state) {
  void state;
}

// ANIMAL FORM's herd-call: while the Ranger runs as a unicorn, every wild HORSE on the board — the
// knights and nightriders, never a guardian, turret or rune — recognises kin and rallies to his
// side. They become allies outright (reusing the ally machinery), so they fight the rest of the
// floor with him. Returns how many came over.
function rallyHorses(state) {
  if (!Array.isArray(state.allies)) state.allies = [];
  const horses = state.enemies.filter((e) => (e.kind === 'knight' || e.kind === 'nightrider')
    && !e.boss && !e.turret && !e.summonCircle);
  for (const e of horses) {
    state.enemies = state.enemies.filter((x) => x.id !== e.id);
    state.allies.push({ id: e.id, kind: e.kind, x: e.x, y: e.y, charmed: true });
  }
  return horses.length;
}

// When Animal Form wears off the herd disbands — every horse it rallied (`charmed`) reverts to a
// WILD horse and gallops off on its own again (neutral, since the Druid still has Wild Empathy). The
// rally was the whole runaway strength of the Druid: a permanent, growing warband it kept forever.
// The horses only serve while the king IS the beast; the moment he is a man again, they are wild.
function unrallyHorses(state) {
  if (!Array.isArray(state.allies)) return 0;
  const charmed = state.allies.filter((a) => a.charmed);
  if (!charmed.length) return 0;
  state.allies = state.allies.filter((a) => !a.charmed);
  let freed = 0;
  for (const a of charmed) {
    const taken = (state.player.x === a.x && state.player.y === a.y)
      || (state.enemies || []).some((e) => e.x === a.x && e.y === a.y)
      || (state.allies || []).some((o) => o.x === a.x && o.y === a.y);
    if (taken) continue; // its old ground is occupied — the horse simply scatters and is gone
    const horse = createEnemy(a.kind, a.x, a.y);
    horse.awake = false; // a wild horse again — Wild Empathy keeps it neutral (isNeutralBeast)
    state.enemies.push(horse);
    freed += 1;
  }
  return freed;
}

// The uncollected floor key sits on this tile — enemies and structures may never enter
// or spawn on it (only the king may walk over it, to collect it).
function keyTileAt(state, x, y) {
  return Boolean(state.key) && !state.key.collected && state.key.x === x && state.key.y === y;
}

// The player's ally (Necromancer familiar / undead) standing on this tile, if any.
function allyAt(state, x, y) {
  return (state.allies || []).find((a) => a.x === x && a.y === y) || null;
}
function hasLivingFamiliar(state) {
  return (state.allies || []).some((a) => a.familiar);
}

// The spawn pool for a floor. Floors 1-4 draw from the standard pieces; from floor 5 the fairy
// pieces take over for everything that LIVES down there.
//
// `includeMortal` widens it back out to the standard roster as well. STRUCTURES — turrets and
// summoning circles — are BUILT things, not natives of the realm, so even in the demon floors they
// may be raised around a mortal piece. Living foes (wanderers, mini-bosses, guardians) never are.
function enemyRosterForFloor(floor, includeMortal) {
  const demon = floor >= DEMON_FLOOR;
  const allowed = demon ? (includeMortal ? [...DEMON_KINDS, ...STANDARD_KINDS] : DEMON_KINDS) : STANDARD_KINDS;
  const pool = ENEMY_UNLOCKS.filter((e) => floor >= e.floor && allowed.includes(e.kind)).map((e) => e.kind);
  return pool.length ? pool : [demon ? 'berolina' : 'pawn'];
}
function randomEnemyKind(floor, includeMortal) {
  const pool = enemyRosterForFloor(floor, includeMortal);
  return pool[randomInt(pool.length)];
}
// Once a floor has gone MOLTEN (the overstay lava — see tickLavaEncroachment) HELL takes over: ordinary
// monsters would just die in the spreading fire, so the natives change. `moltenActive` is true from
// max dread on (and the floor "counts as hell" for dread purposes — see isHellNow). `spawnKindForFloor`
// swaps a would-be mortal spawn for a DEMON kind (lava-immune leapers that wade the flood), ignoring the
// usual per-floor unlocks — hell does not queue politely. On a real demon floor both are no-ops.
function moltenActive(state) {
  return overstayFraction(state.turn || 0) > 0;
}
function isHellNow(state) {
  return (state.floor || 1) >= DEMON_FLOOR || moltenActive(state);
}
function spawnKindForFloor(state) {
  if (moltenActive(state) && (state.floor || 1) < DEMON_FLOOR) return DEMON_KINDS[randomInt(DEMON_KINDS.length)];
  return randomEnemyKind(state.floor);
}
// The piece a summoning CIRCLE is bound to — a rune may bind a mortal piece even in the demon
// realm, unlike the realm's living natives.
function randomStructureKind(floor) {
  return randomEnemyKind(floor, true);
}

// The piece a TURRET is built around — ALWAYS a mortal kind, on every floor, demon realm included.
// A turret is a fixed gun whose "movement" IS its firing lane, and the demon pieces all leap or
// capture off-line (archbishop / chancellor / amazon jump; a berolina takes on a different axis than
// it steps), which reads as nonsense for a line of fire. So none are ever built.
function randomTurretKind(floor) {
  const pool = ENEMY_UNLOCKS.filter((e) => floor >= e.floor && STANDARD_KINDS.includes(e.kind)).map((e) => e.kind);
  return pool.length ? pool[randomInt(pool.length)] : 'rook';
}

// Floor 8 is the ABSOLUTE last floor — there is no descent past it. Instead of a stair it
// holds a portal, and instead of a key an Orb of Victory; grabbing the orb opens the portal
// (and rouses the finale's boss-rush), and stepping into the portal wins the run.
function isFinalFloor(floor) {
  return floor >= FINAL_FLOOR;
}

// Does this guardian bear `perk`? Guardians can carry SEVERAL now (see rollBossPerks), so never
// test `boss.bossPerk === x` directly. Falls back to the single `bossPerk` for older saves.
function bossHas(boss, perk) {
  if (!boss) return false;
  if (boss.bossPerk === perk) return true; // the primary (and the only field an older save carries)
  return Array.isArray(boss.bossPerks) && boss.bossPerks.includes(perk);
}

// Perks that would step on each other if one guardian rolled two from the same group — only one of
// a group can ever fire, so pairing them would silently waste a slot:
//   attack   — Volley and Sorcerer each REPLACE its attack; it can only shoot one way.
//   reaction — Shifting and Blinkborn both trigger on being wounded (applyBossHitReaction picks one).
const BOSS_PERK_GROUPS = {
  ranged: 'attack', sorcerer: 'attack',
  shapeshifter: 'reaction', blinker: 'reaction',
  summoner: 'swarm', lich: 'swarm', mechanic: 'swarm', petowner: 'swarm', // only one thing that fills the board with units
  warper: 'teleport', shadowstep: 'teleport', burrower: 'teleport', // only one on-turn displacement
  hotblooded: 'terraform', icygrasp: 'terraform', gardener: 'terraform', // only one thing reshaping the floor
};

// Roll `count` DISTINCT perks, never two from the same exclusive group.
// `kind` is optional only for old callers; pass it, because it is what keeps Volley and Sorcerer off
// the melee pieces. A king or a pawn has no line to loose a bolt down — the trait was a dead slot on
// them at best, and at worst (see bossRangedAttack) it made them shoot across the whole floor.
function rollBossPerks(count, kind) {
  const demon = kind && isDemonKind(kind);
  const pool = BOSS_PERKS.slice()
    .filter((perk) => !((perk === 'ranged' || perk === 'sorcerer') && kind && !hasFiringLine(kind)))
    // Realm-locked traits: hellfire and shadow are the demon guardians' alone; the overgrowth is the
    // mortal wild's. (When kind is unknown — an old caller — nothing is filtered, as before.)
    .filter((perk) => !(kind && DEMON_ONLY_PERKS.includes(perk) && !demon))
    .filter((perk) => !(kind && MORTAL_ONLY_PERKS.includes(perk) && demon));
  for (let i = pool.length - 1; i > 0; i -= 1) { const j = randomInt(i + 1); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const picked = [];
  const groups = new Set();
  for (const perk of pool) {
    if (picked.length >= count) break;
    const group = BOSS_PERK_GROUPS[perk];
    if (group && groups.has(group)) continue; // it would be a dead slot beside the one already taken
    if (group) groups.add(group);
    picked.push(perk);
  }
  return picked;
}

// Build the floor's boss at (x, y): a high-mobility piece with a HP pool.
// The kinds a floor's guardian may be rolled from: a sliding window over its tier, so the pool
// advances AND stays plural. Position 0 in a tier draws from its weakest two, position 3 from its
// strongest two — a floor-1 guardian can never be a queen, and a floor-4 one is never a knight.
// The demon tier (floor 5+) restarts the same window with its own four kinds.
function bossPoolForFloor(floor) {
  const tier = floor >= DEMON_FLOOR ? BOSS_TIER_DEMON : BOSS_TIER_MORTAL;
  const t = Math.max(0, Math.min(tier.length - 1, (floor - 1) % tier.length));
  const lo = Math.max(0, t - 1);
  const hi = Math.min(tier.length - 1, t + 1);
  return tier.slice(lo, hi + 1);
}

// A guardian's name, derived wholly from what it IS: an epithet from its primary perk over a noun
// hashed from kind + traits. No per-floor authoring, and the same monster always earns the same
// name. Falls back to a bare noun if the perk has no epithet.
function bossNameFor(kind, perks) {
  const nouns = BOSS_NOUNS[kind] || ['Guardian'];
  const tag = `${kind}|${[...(perks || [])].sort().join(',')}`;
  let hash = 0;
  for (let i = 0; i < tag.length; i += 1) hash = (hash * 31 + tag.charCodeAt(i)) >>> 0;
  const noun = nouns[hash % nouns.length];
  const epithet = BOSS_EPITHETS[(perks || [])[0]];
  return epithet ? `the ${epithet} ${noun}` : `the ${noun}`;
}

function createBoss(floor, x, y) {
  const spec = (levelForFloor(floor) || { boss: { hp: 4 } }).boss;
  const pool = bossPoolForFloor(floor);
  const kind = pool[randomInt(pool.length)];
  const boss = createEnemy(kind, x, y);
  boss.boss = true;
  boss.maxHp = spec.hp || 4;
  boss.originalKind = kind; // a Shifting boss never grows stronger than this
  // The DEMON REALM's guardians are doubly cursed — two perks each. The FINAL guardian wears three
  // and is a thing apart (see finalBoss: its own black-and-fire livery and worse threats).
  boss.finalBoss = isFinalFloor(floor);
  const perkCount = boss.finalBoss ? 3 : (floor >= DEMON_FLOOR ? 2 : 1);
  boss.bossPerks = rollBossPerks(perkCount, kind);
  boss.bossPerk = boss.bossPerks[0]; // the PRIMARY — drives its crown, epithet and one-line summary
  boss.bossName = bossNameFor(kind, boss.bossPerks); // named for what it is, once its traits are known
  // Hardened scales with the guardian rather than adding a flat +3. That flat bonus was written
  // against a 14-HP finale (a ~20% bump); once the HP curve was halved it became +75% on a floor-4
  // boss — the single biggest swing in the game, decided by one perk roll.
  if (bossHas(boss, 'tough')) boss.maxHp = Math.ceil(boss.maxHp * 4 / 3); // Hardened: a third again, rounded up
  boss.hp = boss.maxHp;
  boss.dormant = true; // holds the stair/portal until it spies the king or is struck
  // Demon-floor guardians (the fairy/demon pieces from floor 5) shrug off lava; earlier
  // guardians do not (and the finale's rush of vanilla-type bosses stays vulnerable to it).
  boss.lavaImmune = floor >= DEMON_FLOOR;
  return boss;
}

// A boss's blow strength — Brutal guardians hit twice as hard.
function bossDamage(boss) {
  return boss && bossHas(boss, 'brutal') ? 2 : 1;
}

// Leech guardians knit a wound shut each time they draw the king's blood (capped at max
// HP). Call this only when a boss's blow ACTUALLY lands (not when it's warded/deflected).
function bossLeech(boss) {
  if (boss && bossHas(boss, 'leech') && boss.hp < boss.maxHp) boss.hp += 1;
}

// A wounded boss's reaction: Shifting bosses morph to a lesser form; Blinkborn
// bosses flicker away. Called from damageBoss on any non-fatal hit.
function applyBossHitReaction(state, boss) {
  if (bossHas(boss, 'shapeshifter')) {
    const origRank = PIECE_RANK.indexOf(boss.originalKind || boss.kind);
    const pool = PIECE_RANK.filter((k, i) => i <= origRank && k !== boss.kind);
    if (pool.length) {
      boss.kind = pool[randomInt(pool.length)];
      state.message += ` It shifts into a ${boss.kind}!`;
    }
  } else if (bossHas(boss, 'blinker')) {
    if (bossBlink(state, boss)) state.message += ' It blinks away!';
  }
  // HOT-BLOODED (demon): a wound boils a patch of nearby ground to lava — never the king's own tile.
  // Independent of the reaction above (a boss can shift AND bleed fire), and gated on it being seen.
  if (bossHas(boss, 'hotblooded') && bossSeenAndHunting(state, boss)) {
    if (terraformNearby(state, boss.x, boss.y, 'lava')) { cue(state, 'hiss'); state.message += ' Its blood boils the ground to lava!'; }
  }
}

// Flicker a struck boss to a random standable tile a few squares off, never adjacent
// to the king. Returns false if there's nowhere to go.
function bossBlink(state, boss) {
  const king = state.player;
  const spots = [];
  for (let dx = -4; dx <= 4; dx += 1) {
    for (let dy = -4; dy <= 4; dy += 1) {
      const x = boss.x + dx;
      const y = boss.y + dy;
      if (x < 0 || x >= WORLD_SIZE || y < 0 || y >= WORLD_SIZE) continue;
      if (chebyshev(x, y, boss.x, boss.y) < 2) continue; // a real jump, not a shuffle
      if (chebyshev(x, y, king.x, king.y) <= 1) continue; // never blink into melee
      // Only ever blink to a tile the KING can actually SEE (in his window, strict LOS) — an
      // enemy never flickers off through / behind a wall to somewhere the player can't watch.
      if (!isWithinBounds(getVisibleBounds(state), x, y) || !hasLineOfSight(state, king.x, king.y, x, y, false)) continue;
      if (!isStandable(terrainAt(state, x, y))) continue;
      if (x === king.x && y === king.y) continue;
      if (keyTileAt(state, x, y) || allyAt(state, x, y)) continue;
      if (state.enemies.some((e) => e.id !== boss.id && e.x === x && e.y === y)) continue;
      if (!kindCanMove(state, boss.kind, x, y)) continue;
      spots.push({ x, y });
    }
  }
  if (!spots.length) return false;
  const dest = spots[randomInt(spots.length)];
  boss.x = dest.x;
  boss.y = dest.y;
  return true;
}

// The gate the "reshapes the floor / conjures things / wards its retinue" traits share: the guardian
// must be genuinely IN the fight and ON screen — awake (not dormant/asleep), and in the king's sight.
// A boss the player has never seen never quietly terraforms the floor or breeds turrets from off in
// the dark; it has to be a threat he is actually watching.
function bossSeenAndHunting(state, boss) {
  if (!boss || boss.dormant || boss.asleep) return false;
  if (typeof isConfused === 'function' && isConfused(boss)) return false; // a boss that has lost its wits wards nothing and reshapes nothing
  if (!boss.awake && !boss.provoked && !(boss.lastSeen && boss.lastSeenTtl > 0)) return false;
  return unitInSight(state, boss.x, boss.y);
}

// GUARDIAN aura: each enemy phase, a hostile, visible Guardian WARDS ONE foe beside it (parry) — that
// single retainer turns aside the first killing blow and must be struck again. Just ONE at a time, not
// the whole retinue: it shields its front rank, and it picks the adjacent foe NEAREST the king (the
// one most in the fight), so the ward lands where it bites. Rebuilt from scratch each turn, so a foe
// that walks out of reach (or whose guardian dies) loses it. Environmental deaths never route through
// the ward (see resolveKill) — fire, pits and lava cut straight through, which is its counter-play.
function tickGuardianWards(state) {
  for (const e of state.enemies) if (e.warded === 'guardian') { e.parry = false; e.warded = null; }
  // WARY: a guardian that ends the turn OUT of the king's reach has time to set itself, and raises its
  // own guard for his turn. Toe to toe it never gets the chance. Refreshed here, from FINAL positions,
  // so what the board shows going into his turn is exactly what his blow will meet.
  for (const e of state.enemies) if (e.warded === 'wary') { e.parry = false; e.warded = null; }
  for (const b of state.enemies) {
    if (!b.boss || !bossHas(b, 'wary') || b.parry) continue;
    if (!bossSeenAndHunting(state, b)) continue; // not in the fight / not on screen — no stance to take
    if (chebyshev(b.x, b.y, state.player.x, state.player.y) <= 1) continue; // beside him: no time to set itself
    b.parry = true;
    b.warded = 'wary';
  }
  const guardians = state.enemies.filter((b) => b.boss && bossHas(b, 'guardian') && bossSeenAndHunting(state, b));
  if (!guardians.length) return;
  const king = state.player;
  for (const g of guardians) {
    const beside = state.enemies
      .filter((e) => !e.boss && !e.turret && !e.summonCircle && !e.parry && chebyshev(g.x, g.y, e.x, e.y) === 1)
      .sort((a, b) => chebyshev(a.x, a.y, king.x, king.y) - chebyshev(b.x, b.y, king.x, king.y));
    if (beside.length) { beside[0].parry = true; beside[0].warded = 'guardian'; }
  }
}

// Convert ONE random non-wall tile adjacent to (cx,cy) to `type` — the shared primitive of the
// terraform traits (Hot-Blooded's lava, Icy Grasp's ice, Gardener's wild). Never a wall, the king's
// own tile, the key, the exit, a tile already that type, or a tile a unit stands on. Undoes itself if
// the change would seal the king off from what he needs. Returns the converted {x,y}, or null.
function terraformNearby(state, cx, cy, type, avoid) {
  const spots = [];
  for (const [dx, dy] of [...ORTHO, ...DIAG]) {
    const x = cx + dx;
    const y = cy + dy;
    if (x < 1 || x >= WORLD_SIZE - 1 || y < 1 || y >= WORLD_SIZE - 1) continue;
    const t = terrainAt(state, x, y);
    if (t === 'wall' || t === type) continue;
    if (x === state.player.x && y === state.player.y) continue;
    if (keyTileAt(state, x, y)) continue;
    if (state.exit && x === state.exit.x && y === state.exit.y) continue;
    if (state.enemies.some((e) => e.x === x && e.y === y) || allyAt(state, x, y)) continue;
    if (avoid && avoid(x, y)) continue;
    spots.push({ x, y });
  }
  if (!spots.length) return null;
  const dest = spots[randomInt(spots.length)];
  const k = `${dest.x},${dest.y}`;
  const was = Object.prototype.hasOwnProperty.call(state.terrain, k) ? state.terrain[k] : undefined;
  state.terrain[k] = type;
  if (typeof dangerReachOk === 'function' && !dangerReachOk(state)) { // never wall him off from key/stair
    if (was === undefined) delete state.terrain[k]; else state.terrain[k] = was;
    return null;
  }
  return dest;
}

// When a GUARDIAN's blow actually lands on the king, its on-hit traits fire. Icy Grasp sheets a tile
// beside him with ice. Called from every path a boss can hurt him (melee, knockback, bolt).
function bossOnHitKing(state, boss) {
  if (!boss || !boss.boss) return;
  if (bossHas(boss, 'icygrasp') && bossSeenAndHunting(state, boss)) {
    if (terraformNearby(state, state.player.x, state.player.y, 'ice')) cue(state, 'freeze');
  }
}

function bossTitle(boss) {
  const name = boss.bossName || `${boss.kind} guardian`;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

// "a nightrider" / "an archbishop" — the indefinite article a word takes, for log lines. A turret
// is named "turret" whatever piece it is built on, since that is what the player sees it as.
function aWord(word) {
  return `${/^[aeiou]/i.test(word) ? 'an' : 'a'} ${word}`;
}
function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}
// The label a FALLEN foe wears in the log — a turret reads as a turret, everything else by its kind.
function foeLabel(enemy) {
  return enemy.turret ? 'turret' : enemy.kind;
}

// A demon-kind guardian (the fairy/demon pieces of the deeper floors) — its threats are nastier.
// A demon (fairy) piece — immune to lava (see tickLavaDamage) and drawn with horns/wings.
// BANISH (Translocations T3): what can be sent clean out of the world? Anything that IS a creature
// and isn't holding the floor together. A summoning circle is a rune cut into the ground, not a
// thing that can be moved; a floor GUARDIAN is anchored to the key it sits on, and banishing it
// would hand the player the floor for one card. A rogue mini/rush boss is fair game.
function isBanishable(e) {
  if (!e) return false;
  if (e.summonCircle) return false;
  if (e.boss && !e.mini && !e.rush) return false;
  return true;
}

// ---- SOUND CUES ---------------------------------------------------------------------------
// The logic layer has no business knowing what anything SOUNDS like — but it is the only thing that
// knows a boulder just started rolling, or that the king waded rather than leapt. So it NAMES the
// events; the view drains the list and decides how they sound (see GameAudio.play in main.js).
//
// Deduped per action on purpose: one shove that bonks five foes is ONE bonk, not five stacked into
// a clipped mess.
function cue(state, name) {
  if (!state) return;
  if (!Array.isArray(state.cues)) state.cues = [];
  if (!state.cues.includes(name)) state.cues.push(name);
}

// Queue a SMOKE PUFF at (x,y) for the view — a teleport leaves one where it vanished and where it
// reappears. Drained in main.js's applyState (see Renderer.puff).
function puffSmoke(state, x, y) {
  if (!state) return;
  if (!Array.isArray(state.puffs)) state.puffs = [];
  state.puffs.push({ x, y });
}

// Queue a GRAY SCORCH puff at (x,y) — drifts up wherever lava or fire seared a unit (king, foe or
// ally). Drained in main.js's applyState (see Renderer.smoke).
function addSmoke(state, x, y) {
  if (!state) return;
  if (!Array.isArray(state.smoke)) state.smoke = [];
  state.smoke.push({ x, y });
}

// FOG: a drifting cloud that blocks the LOOK (like tall grass — it is HAZE, so soft-sight sees through
// it) for FOG_TURNS before it thins. Stored as an overlay map "x,y" -> turns left, ticked in passTurn.
// Kept separate from `terrain`, like torches and burning trees, so it never overwrites the ground.
function addFog(state, x, y, turns) {
  if (!state || x < 0 || x >= WORLD_SIZE || y < 0 || y >= WORLD_SIZE) return;
  if (!state.fog) state.fog = {};
  const k = `${x},${y}`;
  state.fog[k] = Math.max(state.fog[k] || 0, turns || FOG_TURNS);
}
function fogAt(state, x, y) {
  return Boolean(state && state.fog && state.fog[`${x},${y}`] > 0);
}
function tickFog(state) {
  if (!state.fog) return;
  for (const k in state.fog) {
    state.fog[k] -= 1;
    if (state.fog[k] <= 0) delete state.fog[k];
  }
}

// A boulder rolling into a hazard makes the hazard's own sound as it swallows the rock: a SPLASH into
// water, a HISS into lava (which also gouts steam — see the fog it leaves), a distant FALL into a pit.
function cueHazardFill(state, t, x, y) {
  if (t === 'water') cue(state, 'splash');
  else if (t === 'lava') { cue(state, 'hiss'); addSmoke(state, x, y); addFog(state, x, y); } // molten rock flashes the boulder to steam/fog
  else if (t === 'pit') cue(state, 'fall');
}

// The sound of the ground the king is STANDING on. Only the tile he ends on ever sounds: a leap
// passes clean OVER water without touching it, so nothing under the arc is cued — but a leap that
// LANDS in water still splashes. Pathfinder wades WATER quietly (no splash), but LAVA still sears it,
// so the lava hiss stays.
function cueStandingOn(state) {
  const p = state.player;
  const t = terrainAt(state, p.x, p.y);
  if (t === 'water') { if (!p.pathfinder) cue(state, 'splash'); }
  else if (t === 'lava') cue(state, 'hiss');
  else if (t === 'devilgrass') cue(state, 'swish');
  if (hasTorch(state, p.x, p.y)) cue(state, 'hiss'); // only a phaser can stand inside a burning wall
}

function isDemonKind(kind) {
  return DEMON_KINDS.includes(kind);
}
// Is this piece safe in FIRE — lava, or a wall-torch it has phased into? Demon-kind pieces are born
// to it, a Winged guardian soars over it, and a demon-realm guardian is explicitly marked immune.
//
// This is the ONE source of truth, deliberately: tickLavaDamage burns exactly what this calls
// unsafe, and pieceTerrainOpts keeps exactly that out of the fire. Tying both to the same predicate
// is what stops a foe walking into something that will kill it — they used to disagree, so mortal
// foes cheerfully charged into lava and immolated themselves reaching the king.
function isLavaSafe(unit) {
  if (!unit) return false;
  return Boolean(unit.lavaImmune) || isDemonKind(unit.kind) || bossHas(unit, 'flying');
}
function isDemonBoss(boss) {
  return isDemonKind(boss.originalKind || boss.kind);
}
// The line a guardian snarls the first time it turns hostile toward the king (shown in the log).
// Demon guardians get scarier, hungrier threats.
function bossHostileLine(boss) {
  const name = bossTitle(boss);
  const demon = [
    `${name} fixes its burning gaze on you: "Your soul will feed the abyss!"`,
    `${name} snarls, "Fresh meat... I will wear your bones, little king."`,
    `${name} shrieks, "Kneel and be devoured, mortal!"`,
    `${name} hisses, "The dark has waited so long for you to bleed."`,
  ];
  const mortal = [
    `${name} bellows, "You shall not pass, intruder!"`,
    `${name} levels its guard: "Turn back, or be cut down."`,
    `${name} roars, "Come no further — meet your end here!"`,
    `${name} growls, "This is where your journey ends."`,
  ];
  const finale = [
    `${name} unfolds to its full height, and the castle SHUDDERS: "I am the last door, little king — and it opens onto NOTHING."`,
    `${name} drags its burning gaze across you: "Eight floors of corpses behind you. You built that road for ME."`,
    `${name} laughs, and the sound cracks the stone: "Your realm ends where I stand. Come and be UNMADE."`,
    `${name} whispers, and it is worse than the roar: "I have eaten kings. I remember none of them."`,
    `${name} spreads its wings across the whole hall: "There is no floor beneath this one. Only my hunger."`,
  ];
  const pool = boss.finalBoss ? finale : (isDemonBoss(boss) ? demon : mortal);
  return pool[randomInt(pool.length)];
}

// A SHORT battle-shout for the speech bubble that pops over a guardian the moment it turns
// hostile — one punchy word or two, demon guardians nastier than mortal ones.
function bossShoutLine(boss) {
  const demon = ['Die!', 'Bleed!', 'Kneel!', 'Perish!', 'Suffer!', 'Feed me!'];
  const mortal = ['Halt!', 'No further!', 'Turn back!', 'Face me!', 'Come, then!', 'Your end!'];
  const finale = ['BE UNMADE!', 'I AM THE LAST!', 'NOTHING FOLLOWS!', 'YOUR REALM DIES!', 'KNEEL AND END!'];
  const pool = boss.finalBoss ? finale : (isDemonBoss(boss) ? demon : mortal);
  return pool[randomInt(pool.length)];
}

// A DYING cry, for the bubble that pops the moment a guardian falls — the bookend to its battle-shout.
// A mortal guardian dies like a man; a demon dies like something being dragged back where it came
// from; the last boss of all does not get to be dignified about it.
function bossDeathLine(boss) {
  const demon = ['AAAIEEEE!', 'The dark takes me!', 'I burn! I BURN!', 'Back... to the pit...', 'You are DAMNED!', 'AAAGH!'];
  const mortal = ['AAARGH!', 'AIEEE!', 'NOOO!', 'I... fall...', 'It cannot be...', 'Ungh!'];
  const finale = ['NO! NOT LIKE THIS!', 'IMPOSSIBLE!!', 'THE REALM DIES WITH ME!', 'I AM ETERNAAAL—', 'YOU HAVE DOOMED US ALL!'];
  const pool = boss.finalBoss ? finale : (isDemonBoss(boss) ? demon : mortal);
  return pool[randomInt(pool.length)];
}

// Deal `amount` damage to a boss. Returns 'slain' if it fell, else 'hurt'.
// A boss perk's short name, for the log ("Brutal — its blows land twice as hard" -> "Brutal").

function damageBoss(state, boss, amount, opts) {
  boss.provokedBeast = true; // a struck beast (Wild Empathy) turns hostile for good
  // A RAISED GUARD (the Wary trait, or a Guardian's ward) turns the blow aside — the guard is SPENT and
  // no wound lands. It still rouses the thing: you hit it, it knows. The GROUND is exempt, exactly as
  // the king's own Parry never stops lava or steam — callers pass `{ ground: true }` for those.
  if (boss.parry && !(opts && opts.ground)) {
    boss.parry = false;
    boss.warded = null;
    boss.provoked = true;
    boss.awake = true;
    boss.surprised = false;
    boss.asleep = false;
    boss.hushed = false;
    rememberKing(state, boss);
    cue(state, 'deflect');
    state.message = `${boss.bossName || `The ${boss.kind} guardian`} turns the blow aside!`;
    state.lastAction = 'combat';
    return 'hurt'; // it is still standing — callers land beside it exactly as for a survived hit
  }
  boss.hp -= amount;
  if (boss.hp > 0) {
    // Struck and still standing — it now HUNTS the king, seeing through Silent's veil. A foe you
    // wound is provoked into the chase however far off you stand (a Ghost can still shake it by
    // breaking its sight).
    boss.provoked = true;
    boss.awake = true;
    boss.surprised = false;
    boss.asleep = false; // a blow wakes the one struck — even out of a Silence, which now holds only what he leaves be
    boss.hushed = false;
    rememberKing(state, boss);
    state.message = `The king strikes ${boss.bossName} (${boss.hp}/${boss.maxHp}).`;
    state.lastAction = 'combat';
    applyBossHitReaction(state, boss);
    return 'hurt';
  }
  state.enemies = state.enemies.filter((e) => e.id !== boss.id);
  // A guardian's death is GORY — a wide, dense pool of blood. A true floor boss bleeds far more
  // than a lesser mini/rush boss.
  const gushes = (boss.mini || boss.rush) ? 4 : 8;
  const gmx = Math.sign(boss.x - state.player.x);
  const gmy = Math.sign(boss.y - state.player.y);
  for (let i = 0; i < gushes; i += 1) addSpatter(state, boss.x, boss.y, gmx, gmy, isDemonBoss(boss));
  addCorpse(state, boss.x, boss.y, boss.kind, BOSS_CORPSE_LIFE); // a boss's remains linger far longer
  state.player.killedEnemy = true;
  defeatBoss(state, boss);
  return 'slain';
}

// A turret soaks HP like a boss (a flat, non-scaling pool) and is struck IN PLACE. It
// grants no boon and is not an "on-kill" trigger — it's a structure, just a destructible one.
// Build a turret of `kind` at (x,y). From floor 5 a turret may be a FIRE turret — it looses
// piercing spellfire (through units) on a slower 3-beat cycle (aim, fire, recover).
function makeTurret(state, kind, x, y) {
  const t = createEnemy(kind, x, y);
  t.turret = true;
  t.hp = TURRET_HP;
  t.maxHp = TURRET_HP;
  // Once fire turrets exist at all (floor 5), the two kinds are an EVEN split — a gun you meet is as
  // likely to be one as the other, so neither reads as the "special" case after the introduction.
  if ((state.floor || 1) >= 5 && Math.random() < 0.5) t.fire = true;
  return t;
}

function damageTurret(state, turret, amount) {
  turret.dozing = false; // a struck turret isn't rendered dozing (Camouflage re-sleeps it by distance)
  turret.provoked = true; // it KNOWS he is out there now — the view shows it frustrated, not asleep
  turret.hp -= amount;
  if (turret.hp > 0) {
    state.message = `The ${turret.kind} turret sparks (${turret.hp}/${turret.maxHp}).`;
    state.lastAction = 'combat';
    return 'hurt';
  }
  state.enemies = state.enemies.filter((e) => e.id !== turret.id);
  state.player.turretsDestroyed = (state.player.turretsDestroyed || 0) + 1; // badge ledger
  tallyKill(state, turret);
  addScrap(state, turret.x, turret.y); // a MACHINE leaves rusty wreckage — no blood, no corpse
  state.message = `The ${turret.kind} turret is destroyed!`;
  state.lastAction = 'combat';
  return 'slain';
}

// Resolve a boss being slain. The floor GUARDIAN earns the level-up boon RIGHT HERE (the king
// does not descend yet — the stair/portal it guarded is now clear, and he must still walk onto
// it). A conjured "rush" boss (the finale's converging guardians) is pure threat — no boon. The
// run is NEVER won by a kill now; victory comes only from stepping into the portal with the Orb.
function defeatBoss(state, boss) {
  // THE DEATH SCREAM. A floor guardian (and the last boss) always cries out; a MINI-boss only
  // sometimes — they die often enough that a scream every time would turn a real moment into
  // punctuation. Rides the same one-shot channel as the battle-shout, flagged `death` so the view
  // plays the dying wail instead of the bellow.
  if (boss && (!(boss.mini || boss.rush) || randomInt(3) === 0)) {
    state.bossShout = { x: boss.x, y: boss.y, text: bossDeathLine(boss), demon: isDemonBoss(boss), death: true };
  }
  // Badge ledger: remember every TRAIT the felled guardian wore this run, for the "one of each" trophy.
  if (boss && Array.isArray(boss.bossPerks)) {
    if (!state.player.slainBossTraits) state.player.slainBossTraits = {};
    for (const perk of boss.bossPerks) state.player.slainBossTraits[perk] = true;
  }
  if (boss && (boss.mini || boss.rush)) {
    // A MINI-BOSS (finale rush OR the "a mini-boss rises" event) is pure threat — no boon.
    state.player.miniBossesSlain = (state.player.miniBossesSlain || 0) + 1;
    tallyKill(state, boss);
    if (state.player.promotion > 0) state.player.bossKilledAsBeast = true;
    state.message = `${bossTitle(boss)} is destroyed!`;
    state.lastAction = 'combat';
    return;
  }
  const p = state.player;
  p.bossesSlain = (p.bossesSlain || 0) + 1; // a floor GUARDIAN felled (badge ledger)
  tallyKill(state, boss);
  if (p.promotion > 0) p.bossKilledAsBeast = true; // felled it while running as the warhorse
  if (isFinalFloor(state.floor) && boss.finalBoss) p.killedFinalBoss = true;
  p.level = (p.level || 1) + 1;
  state.pendingLevelUp = true;
  state.levelPerks = rollLevelPerks(p, LEVEL_PERK_CHOICES);
  const tail = isFinalFloor(state.floor) ? 'choose a boon.' : 'choose a boon, then take the stair.';
  state.message = `The guardian falls! You reach level ${p.level} — ${tail}`;
}

/* ------------------------------- the king --------------------------------- */

// Resolve the king dropping to 0 HP: Undying revives once per floor at his start.
// WHAT KILLED HIM. Tags rather than one label, because the interesting deaths overlap: a hexed ferz
// swinging at him is a ferz AND confused AND an ordinary piece, and the badge case should be able to
// ask about any of those without three near-identical fields.
//
// Set at the moment of the blow (nothing else knows who threw it — by the time hp hits 0 the
// attacker is long out of scope), and read by checkDeath.
function foeDeathTags(e) {
  const tags = [];
  if (!e) return ['something'];
  if (e.confused) tags.push('confused');
  if (e.turret) tags.push('turret');
  else if (e.boss && (e.mini || e.rush)) tags.push('miniboss');
  else if (e.boss) tags.push('boss');
  if (e.kind) tags.push(e.kind);
  return tags.length ? tags : ['something'];
}
function hurtBy(state, tags) {
  state.player.lastHurtTags = Array.isArray(tags) ? tags : [tags];
}

// STALEMATE. It is his turn, and there is nothing in the world he can do: no legal move, no card he
// can play. The dungeon does not offer a pass — the inability to simply WAIT is the shape of the
// whole game — so a king who has sealed himself somewhere with nothing left to spend has lost. He
// starves there.
//
// Note what counts as an out, because most of them are real: a chop or a boulder-shove is a move; a
// self-cast Blink teleports him; Animal Form turns him into something that LEAPS; even Reload is an
// out, because the card it recharges might be the knight card that carries him off the island. So
// this only fires when every one of those has been exhausted — which is exactly when he is stuck.
function isStalemate(state) {
  if (state.gameOver || state.won || state.pendingLevelUp) return false;
  if (getPlayerMoves(state).length > 0) return false;
  for (const card of state.player.cards || []) {
    if (cardBlockedReason(state, card)) continue; // spent, or the ground forbids it
    if (getCardMoves(state, card).length > 0) return false; // he can still DO something
  }
  return true;
}

function checkStalemate(state) {
  if (!isStalemate(state)) return false;
  state.gameOver = true;
  state.player.deathTags = ['stalemate'];
  state.player.diedHoldingOrb = Boolean(state.key && state.key.orb && state.key.collected);
  state.message = 'Nowhere to step, nothing left to spend. The king is stranded — and the dungeon does not wait.';
  return true;
}

function checkDeath(state) {
  const p = state.player;
  if (p.hp > 0) return;
  if (p.extraLife && !p.extraLifeUsed) {
    p.extraLifeUsed = true;
    p.hp = 1;
    p.x = (state.upstair && state.upstair.x != null) ? state.upstair.x : PLAYER_START.x;
    p.y = (state.upstair && state.upstair.y != null) ? state.upstair.y : PLAYER_START.y;
    state.message = 'Undying — you rise again at your start!';
    state.lastAction = 'enemy';
    updateDiscovery(state);
    return;
  }
  state.gameOver = true;
  // Bank what did it, and whether he was carrying the run home when it happened.
  p.deathTags = p.lastHurtTags || ['something'];
  p.diedHoldingOrb = Boolean(state.key && state.key.orb && state.key.collected);
  state.message = 'The king falls.';
}

// Resolve whether an incoming hit is shrugged off: a Bulwark ward (first hit each
// turn), or a Parry ward from a strike last turn. Null means the hit lands. When a
// hit IS deflected, `player.deflected` is flagged so the view can flash a block.
// WAITING only turns aside a shot from AFAR. A blow struck by something standing next to him lands
// however still he holds — the stance is about reading a missile in flight, not shrugging off a mace.
// So it covers turrets and a guardian's bolt/volley (and anything else that reaches him without
// closing), and nothing that is toe to toe. A null attacker is the GROUND (lava, steam, a fall), which
// nothing has ever stopped.
function waitingCovers(state, attacker) {
  if (!attacker) return false; // the ground is not an attack
  if (attacker.turret) return true; // a gun, always at range — even a knight-pattern one
  // A JUMPER launches its blow from two tiles off, but the leap CLOSES that distance: it lands on top
  // of him. That is melee however the arithmetic reads, so the hold does not answer it.
  if (isJumperKind(attacker.kind)) return false;
  return chebyshev(attacker.x, attacker.y, state.player.x, state.player.y) > 1; // it struck without closing
}

function rollMitigation(state, attacker) {
  const player = state.player;
  let mit = null;
  if (player.invuln && waitingCovers(state, attacker)) {
    mit = 'invuln'; // a Sentinel WAITING out the turn reads a shot from afar and turns it aside
  } else if (player.warded) {
    mit = 'parry';
  } else if (player.firstHitEachTurn && player.guardUp) {
    // PARRY is a guard you RAISE and then SPEND. Ending a turn without striking raises it (see
    // passTurn); the next blow that would land is turned aside and the guard drops, whatever else
    // you did in between.
    //
    // Unconditional it negated a hit EVERY turn, for the whole run, while he attacked freely — a
    // guard you never choose to hold is not a choice, and the bot measured it at a 70% win rate on
    // its own. Requiring the immediately-previous turn to be blow-free went too far the other way:
    // it made the perk worthless to anyone actually fighting. As a charge it is a real decision —
    // spend a turn covering up, bank one hit — and it survives you taking the fight to them.
    player.guardUp = false;
    mit = 'ward';
  }
  if (mit) player.deflected = true;
  return mit;
}

// RIPOSTE (Sentinel T3): the counter comes off the GUARD. Only a foe whose blow his raised Parry
// turned aside — and which ENDS its turn adjacent — is cut down where it stands, out of turn. A blow
// that simply lands earns nothing: the riposte is what the guard buys, not a passive thorns aura, so
// it costs a banked Parry every time. A lesser piece dies to it; a boss or turret soaks 1. Ranged
// attackers are never adjacent, so they are safe. Sets `reflectAt` so the view can play the counter.
function applyReflect(state, attacker, mit) {
  if (!state.player.reflect || !attacker || attacker.summonCircle || state.gameOver || state.won) return;
  if (mit !== 'ward' && mit !== 'parry') return; // only a blow the GUARD turned aside is answered
  if (chebyshev(attacker.x, attacker.y, state.player.x, state.player.y) > 1) return;
  if (!state.enemies.some((e) => e.id === attacker.id)) return; // already gone (e.g. its own blow felled it)
  state.reflectAt = { x: attacker.x, y: attacker.y };
  if (attacker.boss) damageBoss(state, attacker, 1);
  else if (attacker.turret) damageTurret(state, attacker, 1);
  else if (isCapturable(state, attacker)) resolveKill(state, attacker);
}
function mitigationMessage(mit, kind) {
  // The FOE is the actor here, and the wording has to say so. "The warhorse charges through a rook"
  // read as the KING doing something — so the log never once told the player he was being attacked,
  // and the whole board looked like it had stopped fighting back.
  if (mit === 'invuln') return `A ${kind} strikes the waiting king — but the blow finds nothing to wound!`;
  if (mit === 'parry') return `The king parries a ${kind}!`;
  if (mit === 'ward') return `A ward absorbs a ${kind}'s blow!`;
  return `The king shrugs off a ${kind}!`;
}

// Return up to `count` distinct random members of `items` (a shuffled sample).
function pickSome(items, count) {
  const pool = items.slice();
  const picked = [];
  while (pool.length && picked.length < count) {
    picked.push(pool.splice(randomInt(pool.length), 1)[0]);
  }
  return picked;
}

/* --------------------------- classes & the king --------------------------- */

// Perk grant flags that are simply switched on.
const PERK_FLAGS = [
  'reflect', 'firstHitEachTurn', 'freeKillMove', 'extraLife',
  'revealFloor', 'spellHaste', 'freeSpell', 'spellSurprise',
  'meleeCleave', 'meleeLeech', 'rangedRapid', 'spellDazzle',
  'meleeRefund', 'meleePierce', 'leapShock', 'meleeFlourish',
  'pathfinder', 'seeThroughWalls', 'trueSight', 'seeAllFoes', 'beastFriend', 'elusive', 'camouflage', 'recoil', 'shrapnel',
  'phase', 'hexDemote', 'doubleCast',
  'familiar', 'necromancy', 'generalForm',
  // Innate CLASS traits (granted at createPlayer, never rolled): the Warrior's hold-your-ground, the
  // Sorcerer's wider level-up choice. (The Ranger's Sharpened Senses is a plain stat bump — no flag.)
  'discipline', 'studious',
  // Sentinel: Waiting turns a skipped turn into a turn of invincibility; Reflect makes a Parry bite back.
  'waiting',
];

// A SELF-CAST ability, as opposed to a weapon: it is aimed at the king's own tile and costs him no
// swing. Kept as one list because two rules read it — wading forbids readying a WEAPON but never an
// ability, and the view greys the buttons by the same reckoning.
function isAbilityCard(card) {
  const k = card && card.kind;
  return k === 'promotion' || k === 'reload' || k === 'swap' || k === 'blink' || k === 'silence' || k === 'confuse';
}

// Why he cannot WIELD this card at all — what he currently IS, and the ground he stands on — or
// null. Kept apart from the cooldown question because getCardMoves needs exactly this half: a
// caller may legitimately ask what a spent card could reach, but nobody should ever be handed a
// target for a card he physically cannot play.
function cardUnusableReason(state, card) {
  const p = state.player;
  // ANIMAL FORM: he roams as the warhorse and wields nothing.
  if (p.promotion > 0) return 'The warhorse needs no cards — strike by leaping.';
  const under = terrainAt(state, p.x, p.y);
  // Wading WATER ties up both hands keeping him upright, so he can't ready a weapon there (Pathfinder
  // wades at a walk, hands free). LAVA no longer blocks a card — it only SEARS (see passTurn): dashing
  // across fire is dangerous, not disarming. A self-cast ability needs no hands at all.
  if (under === 'water' && !p.pathfinder && !isAbilityCard(card)) {
    const noun = classCategory(p.className) === 'spell' ? 'spell' : classCategory(p.className) === 'ranged' ? 'bow' : 'weapon';
    return `You can't ready a ${noun} while wading through ${under}.`;
  }
  return null;
}

// Why this card cannot be played RIGHT NOW — the message to show — or null if it can.
//
// The view greys a button with this and useCard refuses with it, so the two can never drift into
// disagreeing about what is playable. A button that looks live and then says "you can't do that" is
// the same bug as one that looks dead and works.
function cardBlockedReason(state, card) {
  if (!card) return 'No such card.';
  if (card.remaining > 0) return 'That card is still recharging.';
  return cardUnusableReason(state, card);
}

// Build a card record. The category (from the owning class) sets the cooldown but
// is NOT stored on the card — it is re-derived from the class wherever needed. `color`
// is the card's subclass colour for the UI (the class colour for a starter card).
function makeCard(kind, category, cooldownOverride, color) {
  const cooldown = cooldownOverride != null ? cooldownOverride : cardCooldown(kind, category || 'melee');
  return { kind, cooldown, remaining: 0, color: color || null };
}

// Apply a perk's grants to a player (stat bumps, a card, or a rule flag). `cardColor`
// tints any card the perk grants (its subclass colour).
function applyPerk(player, grants, cardColor) {
  if (!grants) return;
  if (grants.maxHp) {
    player.maxHp += grants.maxHp;
    player.hp += grants.maxHp;
  }
  if (grants.vision) player.vision += grants.vision; // a normal (two-way) sight bump
  if (grants.visionOneWay) {
    // Oracle: extends the king's SIGHT window but not his footprint — foes out in the new band
    // can't see him back (see enemyAwareOfKing / getAwarenessBounds).
    player.vision += grants.visionOneWay;
    player.visionOneWay = (player.visionOneWay || 0) + grants.visionOneWay;
  }
  if (grants.moveRange) player.moveRange += grants.moveRange;
  if (grants.cardReach) player.cardReach = (player.cardReach || 0) + grants.cardReach;
  if (grants.gainCard) player.cards.push(makeCard(grants.gainCard, classCategory(player.className), grants.gainCooldown, cardColor));
  for (const flag of PERK_FLAGS) {
    if (grants[flag]) player[flag] = true;
  }
}

// Build a fresh king of the chosen class: base stats + its starting card.
function createPlayer(classKey) {
  const cls = CLASSES[classKey] || CLASSES.warrior;
  const startHp = cls.hp || STARTING_HP; // Warrior is sturdier, Sorcerer frailer
  const player = {
    x: PLAYER_START.x,
    y: PLAYER_START.y,
    hp: startHp,
    maxHp: startHp,
    level: 1,
    className: CLASSES[classKey] ? classKey : 'warrior',
    moveRange: 1,
    vision: STARTING_VISION,
    visionOneWay: 0, // how much of `vision` is one-way Oracle sight (foes there can't see the king back)
    cardReach: 0,
    promotion: 0, // turns remaining as an amazon (Ranger's Promotion); 0 = normal
    cards: [],
    takenPerks: [], // perk ids taken (unique ones can't be offered again)
    warded: false,
    guardUp: false, // Parry: a raised guard, banked until a blow spends it
    invuln: false, // Waiting (Sentinel): invincible from a skipped turn until the next — cleared in settleTurn
    blinkedThisTurn: false, // Blink fires at most once per turn
    // Per-floor flags reset on descent:
    extraLifeUsed: false,
    attacked: false,
    totalTurns: 0,
    // Conduct trackers:
    killedEnemy: false,
    wasHit: false,
    // ACHIEVEMENT trackers — a running tally of the whole descent (see achievements.js). Every one
    // is a "never did X" / "how many X" ledger, so they only ever move one way.
    hitThisFloor: false, // reset each descent; feeds clearedFloorUnhit
    clearedFloorUnhit: false, // he took a WHOLE floor without a scratch at least once
    bossesSlain: 0,
    miniBossesSlain: 0,
    miniBossesSpawned: 0,
    turretsDestroyed: 0,
    circlesDispelled: 0,
    maxFloorTurns: 0, // the longest he ever lingered on a single floor
    usedCard: false,
    usedNormalAttack: false, // struck by simply moving onto a foe (no card)
    openedDoor: false,
    pushedBoulder: false,
    brokeIce: false, // shattered or melted an ice slab by his own hand
    touchedWater: false,
    burnedByFire: false, // lava, a wall-torch, a burning tree, or enemy spellfire ever touched him
    killedFinalBoss: false,
    killsThisFloor: 0, // reset each descent; feeds maxKillsOnFloor
    maxKillsOnFloor: 0,
    minisThisFloor: 0,
    maxMinisOnFloor: 0,
    turretsThisFloor: 0,
    maxTurretsOnFloor: 0,
    killsThisTurn: 0, // reset each action; feeds maxKillsInTurn
    maxKillsInTurn: 0,
    killedWithBoulder: false, // a rolled rock did the killing
    knockedIntoLava: false,
    knockedIntoPit: false,
    defenestrated: false, // knocked/warped onto the open stair and down to the next floor
    pitDived: false, // escaped a corner by diving into a pit
    slainBossTraits: {}, // every boss/mini trait felled THIS run (for the "one of each" trophy)
    killedFoeWithFoe: false, // shoved one into another hard enough to end it
    killStreak: 0, // consecutive turns (right now) on each of which he felled a foe
    bestKillStreak: 0, // the longest such run this game (feeds the kill-streak trophies)
    bossKilledAsBeast: false, // felled a guardian while in Animal Form
    finishedFloorOnOneHeart: false,
    maxCardsHeld: 0,
  };
  for (const flag of PERK_FLAGS) player[flag] = false;
  player.cards.push(makeCard(cls.start, cls.category, cls.startCooldown, cls.color));
  // The class's INNATE trait (Discipline / Sharpened Senses / Studious): a quality-of-life boon every
  // king of that class is born with. Applied like any perk, but never rolled and not added to
  // takenPerks — the character sheet reads cls.startPerk directly (see renderCharacter).
  if (cls.startPerk) applyPerk(player, cls.startPerk.grants, cls.color);
  return player;
}

// Is a perk offerable right now? Not already taken, and its prerequisite (if any)
// has been taken — so tier-2/3 chain perks only surface once their tier below is in.
function perkAvailable(player, perk) {
  const taken = player.takenPerks || [];
  if (taken.includes(perk.id)) return false;
  if (perk.requires && !taken.includes(perk.requires)) return false;
  return true;
}

// The perks offered on a descent (up to `count`): the currently-unlocked, untaken
// tiers of the king's class chains. May return fewer than `count` late in a run.
function rollLevelPerks(player, count) {
  const cls = CLASSES[player.className] || CLASSES.warrior;
  const eligible = cls.perks.filter((perk) => perkAvailable(player, perk));
  // STUDIOUS (the Sorcerer's innate trait) widens the choice: at least THREE perks on offer each
  // descent instead of the usual two, so a mage can steer his build rather than take what he's given.
  let n = count || LEVEL_PERK_CHOICES;
  if (player.studious) n = Math.max(n, 3);
  return pickSome(eligible, n);
}

// Learn a level-up perk (by id) from the king's class pool.
function learnPerk(state, perkId) {
  const next = structuredClone(state);
  const p = next.player;
  const cls = CLASSES[p.className] || CLASSES.warrior;
  const perk = cls.perks.find((k) => k.id === perkId);
  if (!perk || !perkAvailable(p, perk)) {
    next.pendingLevelUp = false;
    return next;
  }
  applyPerk(p, { ...perk.grants }, chainColorFor(p.className, perk.chain));
  p.takenPerks.push(perkId);
  // Necromancy: the familiar joins at once; the General upgrade re-forges any living one.
  if (p.generalForm) {
    for (const a of next.allies || []) {
      if (!a.familiar) continue;
      a.kind = 'vampiress';
      if (!a.maxHp) { a.maxHp = VAMPIRESS_HP; a.hp = VAMPIRESS_HP; } // risen anew: she gains her wounds pool
    }
  }
  if (p.familiar && !hasLivingFamiliar(next)) spawnFamiliar(next);
  next.viewSize = p.vision;
  next.pendingLevelUp = false;
  next.levelPerks = null;
  next.message = `You gain ${perk.name}.`;
  updateDiscovery(next);
  return next;
}

// The class a run belongs to (single class now — kept for the token tint helper).
function highestClass(player) {
  return player.className || 'warrior';
}

// The king's DISPLAYED title: once he has COMMITTED to a subclass — its tier-3 capstone taken, or
// 2+ of its perks — he is named for that chain (e.g. "Fletcher"); otherwise his base class name.
// His TITLE: the subclass he has committed to. It used to flip at TWO perks in a chain, which is
// why a king holding two Duellist perks was already calling himself a Duellist — with the third
// still unbought and the other chains just as open to him. It now takes a FULL chain, and once
// earned it is his for the rest of the run.
function playerTitle(player) {
  const cls = CLASSES[player.className];
  if (!cls) return player.className || 'warrior';
  return committedChain(player) || cls.name;
}

/* ----------------------------- floor building ----------------------------- */

function findFreeTile(occupied, predicate, attempts) {
  for (let i = 0; i < (attempts || 300); i += 1) {
    const x = randomInt(WORLD_SIZE);
    const y = randomInt(WORLD_SIZE);
    const key = `${x},${y}`;
    if (occupied.has(key)) continue;
    if (predicate && !predicate(x, y)) continue;
    return { x, y, key };
  }
  return null;
}

// Tiles the KING can walk between (8-directional flood over floor/water — walls and
// lava block him). Used to guarantee the exit is reachable.
// CHOPPABLE tiles count as PASSABLE here, though standableFor rightly says otherwise. This asks
// "can the king GET there", not "can he stand there this instant", and a tree or a gate never truly
// seals anything: he walks into it and cuts it down, three swings, no resource spent. Counting them
// as walls made every room behind a gate read as a sealed pocket, so connectWalledPockets punched a
// fresh corridor through the wall beside it — which is precisely the way in the gate was there to be.
// The gate ended up decorative, bypassed by a hole two tiles away.
function playerReachable(state, sx, sy) {
  const seen = new Set();
  const walkable = (x, y) => x >= 0 && x < WORLD_SIZE && y >= 0 && y < WORLD_SIZE
    && (isChoppable(terrainAt(state, x, y)) || standableFor(terrainAt(state, x, y), { lavaOk: false }));
  if (!walkable(sx, sy)) return seen;
  const stack = [[sx, sy]];
  seen.add(`${sx},${sy}`);
  while (stack.length) {
    const [x, y] = stack.pop();
    for (const [dx, dy] of [...ORTHO, ...DIAG]) {
      const nx = x + dx;
      const ny = y + dy;
      const key = `${nx},${ny}`;
      if (seen.has(key) || !walkable(nx, ny)) continue;
      seen.add(key);
      stack.push([nx, ny]);
    }
  }
  return seen;
}

// Clear a walkable L-shaped corridor between two points. Turns walls (and, unless
// `wallsOnly`, lava) to floor.
function carveCorridor(state, x0, y0, x1, y1, wallsOnly) {
  let x = x0;
  let y = y0;
  const open = (cx, cy) => {
    if (cx <= 0 || cx >= WORLD_SIZE - 1 || cy <= 0 || cy >= WORLD_SIZE - 1) return;
    if (state.fixedDoors && state.fixedDoors.has(`${cx},${cy}`)) return; // never carve out a deliberate gate (a gaol's bars)
    const t = terrainAt(state, cx, cy);
    if (t === 'wall' || isChoppable(t) || t === 'boulder' || t === 'pit' || t === 'ice' || (!wallsOnly && t === 'lava')) delete state.terrain[`${cx},${cy}`];
  };
  while (x !== x1) { open(x, y); x += Math.sign(x1 - x); }
  while (y !== y1) { open(x, y); y += Math.sign(y1 - y); }
  open(x, y);
}

// Clear the minimum-wall path from (sx,sy) to (tx,ty), routing AROUND lava (a 0-1 BFS:
// stepping on floor/water is free, breaking a wall costs 1, lava is impassable). Turns
// only the walls on that path to floor. Returns false if the target is unreachable even
// through walls (i.e. genuinely lava-isolated) — such a pocket is left alone.
function carveWallPathTo(state, sx, sy, tx, ty) {
  const key = (x, y) => `${x},${y}`;
  const protectedGate = (x, y) => Boolean(state.fixedDoors && state.fixedDoors.has(`${x},${y}`));
  const passable = (x, y) => x > 0 && x < WORLD_SIZE - 1 && y > 0 && y < WORLD_SIZE - 1
    && terrainAt(state, x, y) !== 'lava'
    && !protectedGate(x, y); // never route a carve THROUGH a deliberate gate (a gaol's bars, etc.)
  const breakable = (t) => t === 'wall' || isChoppable(t) || t === 'boulder' || t === 'pit' || t === 'ice'; // barriers a carve can clear
  // What a carve may clear is not what it should PREFER. Cutting a tree or a gate is far cheaper than
  // quarrying stone, so a path that must cross one goes THROUGH it — otherwise the carve smashes the
  // wall beside a gate to get around it, leaving the gate framing nothing.
  const carveCost = (t) => (t === 'wall' || t === 'boulder' ? 2 : isChoppable(t) ? 1 : 0);
  const cost = new Map([[key(sx, sy), 0]]);
  const prev = new Map();
  const deque = [[sx, sy]];
  while (deque.length) {
    const [x, y] = deque.shift();
    if (x === tx && y === ty) break;
    const base = cost.get(key(x, y));
    for (const [dx, dy] of [...ORTHO, ...DIAG]) {
      const nx = x + dx;
      const ny = y + dy;
      if (!passable(nx, ny)) continue;
      const nc = base + carveCost(terrainAt(state, nx, ny));
      if (!cost.has(key(nx, ny)) || nc < cost.get(key(nx, ny))) {
        cost.set(key(nx, ny), nc);
        prev.set(key(nx, ny), key(x, y));
        if (nc === base) deque.unshift([nx, ny]); // free step — stays at the front (0-1-2 BFS)
        else deque.push([nx, ny]);
      }
    }
  }
  if (!cost.has(key(tx, ty))) return false; // lava-isolated — leave it be
  let cur = key(tx, ty);
  while (cur) {
    if (breakable(terrainAt(state, ...cur.split(',').map(Number)))) delete state.terrain[cur];
    cur = prev.get(cur);
  }
  return true;
}

// No walkable region may be fully WALLED off from the king. Flood from his start; for
// each pocket he can't reach, carve the min-wall path to it (routing around lava, so
// genuinely lava-isolated islands are left as intended).
function connectWalledPockets(state, sx, sy) {
  const tried = new Set();
  for (let guard = 0; guard < 60; guard += 1) {
    const reach = playerReachable(state, sx, sy);
    let pocket = null;
    for (let y = 1; y < WORLD_SIZE - 1 && !pocket; y += 1) {
      for (let x = 1; x < WORLD_SIZE - 1; x += 1) {
        const key = `${x},${y}`;
        if (reach.has(key) || tried.has(key)) continue;
        // A GAOL CELL is sealed behind its gate ON PURPOSE — the prisoner inside is the whole point,
        // and cutting the bars is the player's choice to make. Never carve it open here (that stripped
        // the gate off ~1 cell in 5 and let the prisoner stroll out before he ever saw it).
        if (state.enemies.some((e) => e.caged && e.x === x && e.y === y)) { tried.add(key); continue; }
        if (standableFor(terrainAt(state, x, y), { lavaOk: false })) pocket = { x, y };
      }
    }
    if (!pocket) break;
    for (const k of playerReachable(state, pocket.x, pocket.y)) tried.add(k); // whole pocket, once
    if (!carveWallPathTo(state, sx, sy, pocket.x, pocket.y)) {
      // LAVA-ISOLATED land: carveWallPathTo routes AROUND lava and gives up when no dry route exists,
      // which left a patch of ground ringed by fire marooned — reachable only by wading (and burning)
      // across. Lay a BRIDGE straight to it instead: carveCorridor turns the lava it crosses to floor,
      // so every island of land has at least one DRY way on and off it.
      carveCorridor(state, sx, sy, pocket.x, pocket.y);
    }
  }
}

// Would this enemy, as its piece, have at least one legal move from where it stands?
function enemyHasMove(state, enemy) {
  return getPieceMoves(enemy, state).length > 0;
}

// Could a piece of `kind` at (x,y) move at all, judged by TERRAIN alone (other units
// ignored — they shift/die)? Used to avoid spawning a piece somewhere it's stuck (e.g.
// a knight boxed into a corridor whose every L-tile is a wall).
function kindCanMove(state, kind, x, y) {
  const probe = { kind, x, y, id: '__probe' };
  return getPieceMoves(probe, { ...state, enemies: [probe] }).length > 0;
}

// How many tiles a turret of `kind` planted at (x,y) would cover, judged by TERRAIN
// alone (transient units don't count — they move/die). Avoids boxing a turret in where
// walls leave it firing at almost nothing.
function turretCoverage(state, kind, x, y) {
  const probe = { kind, x, y, id: '__probe' };
  return getPieceThreats(probe, { ...state, enemies: [probe] }).length;
}

// Would a turret (a solid, impassable machine) at (x,y) PLUG a hallway — sever the walkable ground
// around it? Treating the turret's tile as blocked, the open tiles of its 3x3 ring must all stay
// mutually reachable in a single king step (chebyshev 1); if they split into 2+ groups the turret
// would wall a corridor/doorway shut. (The king may squeeze diagonally, so a turret in a mere
// CORNER blocks nothing.) Purely a terrain check — transient units aren't part of the hallway.
function turretBlocksHallway(state, x, y) {
  const ring = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];
  const open = ring.map(([dx, dy]) => ({ x: x + dx, y: y + dy })).filter((t) => isStandable(terrainAt(state, t.x, t.y)));
  if (open.length < 2) return false; // a dead-end / lone opening — nothing passes THROUGH it
  const seen = new Set();
  let groups = 0;
  for (const start of open) {
    const sk = `${start.x},${start.y}`;
    if (seen.has(sk)) continue;
    groups += 1;
    const stack = [start];
    seen.add(sk);
    while (stack.length) {
      const c = stack.pop();
      for (const o of open) {
        const ok = `${o.x},${o.y}`;
        if (!seen.has(ok) && Math.max(Math.abs(o.x - c.x), Math.abs(o.y - c.y)) === 1) {
          seen.add(ok);
          stack.push(o);
        }
      }
    }
  }
  return groups > 1; // more than one group → the turret would plug the passage between them
}

// Could a summoning circle of `kind` at (x,y) conjure a minion onto an adjacent tile
// from which that minion could move (terrain-wise)? (Don't place circles that would
// only ever spawn stuck pieces.)
function circleCanSpawnMobile(state, kind, x, y) {
  for (const [dx, dy] of [...ORTHO, ...DIAG]) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || nx >= WORLD_SIZE || ny < 0 || ny >= WORLD_SIZE) continue;
    if (isStandable(terrainAt(state, nx, ny)) && kindCanMove(state, kind, nx, ny)) return true;
  }
  return false;
}

// Does the ground on one side of a doorway open into a REAL space rather than a one-tile nook? A
// bounded flood of open floor out from (sx,sy) that never crosses the door tile itself, stopping the
// moment `min` is reached — so it stays cheap even beside a huge room.
// Open FLOOR for doorway purposes: plain ground, and a GEYSER vent — a walkable tile (you cross it;
// it merely scalds every third turn), so a doorway opening onto one still leads into real space. At
// generation time no tile is a vent yet, so this is identical to "normal" then; it only matters when
// isDoorwaySpot is re-run over a finished demon floor (a geyser is laid after doors are judged).
function isOpenFloor(t) {
  return t === 'normal' || t === 'geyser';
}
function areaOpensUp(at, sx, sy, doorKey, min) {
  const seen = new Set([doorKey]);
  const stack = [[sx, sy]];
  let count = 0;
  while (stack.length && count < min) {
    const [cx, cy] = stack.pop();
    const k = `${cx},${cy}`;
    if (seen.has(k)) continue;
    seen.add(k);
    if (!isOpenFloor(at(cx, cy))) continue;
    count += 1;
    for (const [dx, dy] of [...ORTHO, ...DIAG]) stack.push([cx + dx, cy + dy]);
  }
  return count >= min;
}

// A SENSIBLE place to hang a door: a WALL tile that frames a genuine 1-wide doorway — open floor on
// two opposite sides (the passage) and flanking WALL on the other two that EXTENDS past the gap (so
// it's a real barrier you pass THROUGH, not a stub you stroll around) — AND a real space on BOTH
// sides, so it never opens onto a dead-end nook or solid rock. `at(x,y)` → terrain type.
function isDoorwaySpot(at, x, y) {
  if (at(x, y) !== 'wall') return false;
  const wall = (dx, dy) => at(x + dx, y + dy) === 'wall';
  const floor = (dx, dy) => isOpenFloor(at(x + dx, y + dy));
  const key = `${x},${y}`;
  const MIN_AREA = 6; // a door must JOIN two rooms — never lead nowhere
  // Passage N-S through an E-W wall that extends two tiles each way, opening into space both ways.
  const vertical = floor(0, -1) && floor(0, 1) && wall(1, 0) && wall(-1, 0) && wall(2, 0) && wall(-2, 0)
    && areaOpensUp(at, x, y - 1, key, MIN_AREA) && areaOpensUp(at, x, y + 1, key, MIN_AREA);
  // Passage E-W through a N-S wall, likewise.
  const horizontal = floor(-1, 0) && floor(1, 0) && wall(0, -1) && wall(0, 1) && wall(0, -2) && wall(0, 2)
    && areaOpensUp(at, x - 1, y, key, MIN_AREA) && areaOpensUp(at, x + 1, y, key, MIN_AREA);
  return vertical || horizontal;
}

// Doors are hung against the RAW terrain, but the boss chamber's ring (and other later structure)
// is laid down afterwards and can strand one against fresh rock — a door that leads nowhere. Re-test
// every door against the FINAL map and revert the duds to the solid wall they were carved from.
// Runs before the reachability carve, so reverting can never seal the king in.
// THE GATE'S PRECINCT: a small court cleared around a way into hell (or the portal home), with a
// standing pillar at each corner. A gate like that is not a hole in the floorboards — something
// built it, and it should read as a PLACE.
//
// The court is cleared FIRST, and that is the whole trick. Simply dropping pillars on whatever was
// there placed almost none of them: floor 4 is the Drowned Lake and floor 7 the Lake of Fire, so the
// corners were water and lava, and a pillar refuses to stand in either. Clearing the ground is also
// what the precinct IS — you cannot have a court that is half underwater.
//
// It writes over nothing that matters: the key is never buried (a pillar on it would hide the very
// thing he is hunting), and the four ORTHOGONALS are left open so the ring is a colonnade rather
// than a cage. That last part is load-bearing — seal the gate and connectWalledPockets will smash a
// corridor straight through the ring to reach it, leaving the columns looking like broken rubble.
function buildGatePrecinct(state, cx, cy) {
  const keyHere = (x, y) => state.key && !state.key.collected && state.key.x === x && state.key.y === y;
  for (let dx = -2; dx <= 2; dx += 1) {
    for (let dy = -2; dy <= 2; dy += 1) {
      const x = cx + dx;
      const y = cy + dy;
      if (x < 1 || x >= WORLD_SIZE - 1 || y < 1 || y >= WORLD_SIZE - 1) continue;
      delete state.terrain[`${x},${y}`]; // flagstones: no water, no lava, no timber, no rubble
      if (state.treeHp) delete state.treeHp[`${x},${y}`];
    }
  }
  for (const [dx, dy] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) {
    const x = cx + dx;
    const y = cy + dy;
    if (x < 1 || x >= WORLD_SIZE - 1 || y < 1 || y >= WORLD_SIZE - 1) continue;
    if (keyHere(x, y)) continue;
    state.terrain[`${x},${y}`] = 'wall';
  }
}

// An ordinary (mortal-to-mortal) stair is a plain stair — but now and then it, too, sits in a small
// evocative RING: a GROVE of timber, a CAIRN of boulders, a NOOK of ice, or a ring of PILLARS. It is
// a 5x5 feature (the ring at chebyshev 2 around the stair), with the whole side FACING THE KING left
// open so he can always walk straight in. Never over the stair tile, the key, the collapsed upstair,
// or a piece already standing there. The reachability pass that follows guarantees a way in
// regardless — this only has to read as a PLACE, the way the guarded chamber does.
const STAIR_FEATURES = [
  { kind: 'grove', terr: 'tree' },
  { kind: 'cairn', terr: 'boulder' },
  { kind: 'nook', terr: 'ice' },
  { kind: 'pillars', terr: 'wall' },
];
function buildStairFeature(state, x, y, toward) {
  const feat = STAIR_FEATURES[randomInt(STAIR_FEATURES.length)];
  const gx = Math.sign(toward.x - x);
  const gy = Math.sign(toward.y - y);
  for (let dx = -2; dx <= 2; dx += 1) {
    for (let dy = -2; dy <= 2; dy += 1) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== 2) continue; // the ring, at chebyshev 2 only
      // Leave the king-facing face(s) OPEN — the mouth he walks in through.
      if ((gx !== 0 && dx === 2 * gx) || (gy !== 0 && dy === 2 * gy)) continue;
      const rx = x + dx;
      const ry = y + dy;
      if (rx < 1 || rx >= WORLD_SIZE - 1 || ry < 1 || ry >= WORLD_SIZE - 1) continue;
      if (state.key && !state.key.collected && rx === state.key.x && ry === state.key.y) continue;
      if (state.upstair && rx === state.upstair.x && ry === state.upstair.y) continue;
      if (state.enemies.some((e) => e.x === rx && e.y === ry)) continue; // never wall a piece in
      // A PILLAR ring is colonnade, not a cage — leave its corners open so it reads as columns, not a box.
      if (feat.kind === 'pillars' && Math.abs(dx) === 2 && Math.abs(dy) === 2) continue;
      state.terrain[`${rx},${ry}`] = feat.terr;
      if (state.treeHp) delete state.treeHp[`${rx},${ry}`];
    }
  }
}

function pruneUselessDoors(state) {
  const at = (x, y) => terrainAt(state, x, y);
  for (const key in state.terrain) {
    const t = state.terrain[key];
    // GATES are vetted by the same rule and stranded by the same things (the chamber ring and other
    // later structure land AFTER them), so they get re-judged here too. Miss them and a gate can end
    // up barring a nonsense gap that leads nowhere — exactly what this pass exists to prevent.
    if (t !== 'door' && t !== 'dooropen' && t !== 'doorajar' && t !== 'gate') continue;
    if (state.fixedDoors && state.fixedDoors.has(key)) continue; // a hand-built structure's own door
    const [x, y] = key.split(',').map(Number);
    state.terrain[key] = 'wall'; // judge it as the wall it was cut from...
    if (isDoorwaySpot(at, x, y)) state.terrain[key] = t; // ...a real doorway: put the door/gate back
  }
}

// Build the floor's terrain: a solid wall border enclosing everything, then rooms,
// hallways and water/lava per the level recipe. The tiles around the king's start
// stay clear.
// `garrison` (optional) is how a structure asks for an OCCUPANT. Terrain is built here, but enemies
// do not exist until generateFloor — so a cell wants a prisoner, an alcove wants a gun, and this is
// where they say so. generateFloor honours the list once there is somebody to put in them.
//
// `keepDoors` (optional) is how a structure says "this door/gate is DELIBERATE, leave it alone".
// pruneUselessDoors re-judges every door and gate with isDoorwaySpot, which demands >= 6 tiles of
// open space on BOTH sides — a rule for doors that RANDOM structure stranded. A gaol cell has one
// tile behind its bars by design, so every one of them was being reverted to solid wall and the
// prisoner bricked in alive. A hand-built structure knows what it meant; the prune does not.
function generateTerrain(floor, player, garrison, keepDoors) {
  const terrain = {};
  const nearStart = (x, y) => chebyshev(x, y, player.x, player.y) <= 2;
  // Tiles the SET-PIECES own. Everything generated afterwards flows around them: the noise passes
  // (blobs, wall runs, rooms, pits, doors, pillars) all refuse to write here. Without this the
  // set-pieces had to be squeezed in LAST, hunting for a clear footprint on an already-cluttered
  // floor — a 7x7 clear box existed on 2% of floors and a 9x9 on none, so a storeroom essentially
  // never appeared. Reserving up front inverts it: they are laid on open ground and the noise
  // works around them.
  const reserved = new Set();
  const isReserved = (x, y) => reserved.has(`${x},${y}`);
  // Interior placement only (never the border, never on the king's doorstep, never a set-piece).
  const put = (x, y, type) => {
    if (x < 1 || x >= WORLD_SIZE - 1 || y < 1 || y >= WORLD_SIZE - 1) return;
    if (nearStart(x, y) || isReserved(x, y)) return;
    terrain[`${x},${y}`] = type;
  };
  const clear = (x, y) => {
    if (x < 1 || x >= WORLD_SIZE - 1 || y < 1 || y >= WORLD_SIZE - 1) return;
    if (isReserved(x, y)) return;
    delete terrain[`${x},${y}`];
  };
  const atT = (x, y) => terrain[`${x},${y}`] || 'normal';

  // 1) A wall wraps the whole map so the king is always enclosed.
  for (let i = 0; i < WORLD_SIZE; i += 1) {
    terrain[`${i},0`] = 'wall';
    terrain[`${i},${WORLD_SIZE - 1}`] = 'wall';
    terrain[`0,${i}`] = 'wall';
    terrain[`${WORLD_SIZE - 1},${i}`] = 'wall';
  }

  // 2) SET-PIECES, laid FIRST on open ground: small recurring structures (a storeroom, a fountain,
  // a garden, an island pond) that break the noise up into places the player RECOGNISES. With
  // turrets and circles no longer huddled round the boss chamber, these give the floor other things
  // worth walking to, so the guarded key stops being the only structure on the map.
  //
  // Each reserves its footprint PLUS a one-tile margin. The margin is not cosmetic: pruneUselessDoors
  // later re-judges every door with isDoorwaySpot, which requires real open ground on both sides —
  // so a storeroom whose door got walled in from outside would have its door reverted to rock,
  // leaving a sealed block of stone where the room should be.
  const reserve = (bx, by, w, h) => {
    for (let x = bx - 1; x <= bx + w; x += 1) for (let y = by - 1; y <= by + h; y += 1) reserved.add(`${x},${y}`);
  };
  const boxFree = (bx, by, w, h) => {
    if (bx < 2 || by < 2 || bx + w > WORLD_SIZE - 2 || by + h > WORLD_SIZE - 2) return false;
    for (let x = bx - 1; x <= bx + w; x += 1) {
      for (let y = by - 1; y <= by + h; y += 1) {
        if (nearStart(x, y) || isReserved(x, y) || atT(x, y) !== 'normal') return false;
      }
    }
    return true;
  };
  const tryPlace = (w, h, build) => {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const bx = 2 + randomInt(Math.max(1, WORLD_SIZE - w - 4));
      const by = 2 + randomInt(Math.max(1, WORLD_SIZE - h - 4));
      if (!boxFree(bx, by, w, h)) continue;
      reserve(bx, by, w, h);
      build(bx, by, w, h);
      return true;
    }
    return false;
  };

  // A STOREROOM: a walled box with exactly ONE door — a room you must choose to enter.
  // Odd, and at least 5 on a side, with the door at the exact MIDPOINT of a wall: isDoorwaySpot
  // demands the door's wall run two tiles either side and >= 6 tiles of space within. A 3x3 or 4x4
  // box (interior 1 or 4 tiles) fails both and gets its door pruned back to solid rock.
  const storeroom = () => {
    const w = 5 + 2 * randomInt(2); // 5 or 7
    const h = 5 + 2 * randomInt(2);
    return tryPlace(w, h, (bx, by) => {
      for (let x = bx; x < bx + w; x += 1) {
        for (let y = by; y < by + h; y += 1) {
          if (x === bx || x === bx + w - 1 || y === by || y === by + h - 1) terrain[`${x},${y}`] = 'wall';
        }
      }
      const mx = bx + (w - 1) / 2;
      const my = by + (h - 1) / 2;
      const door = [{ x: mx, y: by }, { x: mx, y: by + h - 1 }, { x: bx, y: my }, { x: bx + w - 1, y: my }][randomInt(4)];
      terrain[`${door.x},${door.y}`] = 'door';
    });
  };
  // A FOUNTAIN: a single pool with a pillar at each corner — a tiny landmark, and cover.
  const fountain = () => tryPlace(3, 3, (bx, by) => {
    terrain[`${bx + 1},${by + 1}`] = 'water';
    for (const [cx, cy] of [[0, 0], [2, 0], [0, 2], [2, 2]]) terrain[`${bx + cx},${by + cy}`] = 'wall';
  });
  // A GARDEN: a rectangle of grass with a pillar or two standing in it (sight-blocking, walkable).
  const garden = () => {
    const w = 4 + randomInt(3);
    const h = 3 + randomInt(3);
    return tryPlace(w, h, (bx, by) => {
      for (let x = bx; x < bx + w; x += 1) for (let y = by; y < by + h; y += 1) terrain[`${x},${y}`] = 'devilgrass';
      for (let i = 0; i < 1 + randomInt(2); i += 1) {
        terrain[`${bx + 1 + randomInt(Math.max(1, w - 2))},${by + 1 + randomInt(Math.max(1, h - 2))}`] = 'wall';
      }
    });
  };
  // A POND with an ISLAND: water with a patch of dry ground marooned at its heart. Water is slow
  // terrain — you wade one tile per move — so the island is a real commitment to reach.
  const pond = () => {
    const w = 5 + 2 * randomInt(2);
    return tryPlace(w, w, (bx, by) => {
      const c = (w - 1) / 2;
      for (let x = 0; x < w; x += 1) {
        for (let y = 0; y < w; y += 1) {
          if (Math.max(Math.abs(x - c), Math.abs(y - c)) > c) continue;
          if (Math.abs(x - c) + Math.abs(y - c) > c + 1) continue; // round the corners off
          terrain[`${bx + x},${by + y}`] = 'water';
        }
      }
      delete terrain[`${bx + c},${by + c}`]; // the island
    });
  };
  // An IGLOO: a dome of ICE with one way in. Ice is not stone — a boulder shears it, spellfire thaws
  // it, and a leaper shatters it landing — so the walls of this room are a suggestion. It reads as
  // shelter and is anything but.
  const igloo = () => {
    const w = 5 + 2 * randomInt(2);
    return tryPlace(w, w, (bx, by) => {
      // A SQUARE box of ice, walls running straight along the edges. A diamond of diagonal ice left
      // a gap at every corner a piece could just walk through, so the shelter shut nothing in or
      // out — an igloo has to be a wall, not a lattice.
      for (let x = 0; x < w; x += 1) {
        for (let y = 0; y < w; y += 1) {
          if (x === 0 || x === w - 1 || y === 0 || y === w - 1) terrain[`${bx + x},${by + y}`] = 'ice';
        }
      }
      const c = (w - 1) / 2;
      const gap = [[c, 0], [c, w - 1], [0, c], [w - 1, c]][randomInt(4)]; // one way in, mid a wall
      delete terrain[`${bx + gap[0]},${by + gap[1]}`];
    });
  };

  // A BRIDGE: a lava pond with one dry span across it. The only safe crossing is a single file of
  // stone, so the pond becomes a decision — walk the bridge and be predictable, or wade and burn.
  const bridge = () => {
    const w = 7 + 2 * randomInt(2);
    const h = 5;
    return tryPlace(w, h, (bx, by) => {
      for (let x = 0; x < w; x += 1) {
        for (let y = 0; y < h; y += 1) {
          if (x === 0 || x === w - 1 || y === 0 || y === h - 1) continue; // a dry lip round the pond
          terrain[`${bx + x},${by + y}`] = 'lava';
        }
      }
      const span = by + 1 + randomInt(h - 2); // the one row that is not fire
      for (let x = 0; x < w; x += 1) delete terrain[`${bx + x},${span}`];
    });
  };

  // A COPSE: an irregular stand of trees — clumps at wandering spots with clearings between, NOT a
  // tended grid (that read as an orchard someone planted; a wild wood does not line its trees up).
  // Still a sight-line puzzle — you can thread through it but not see across it — just a natural one.
  const orchard = () => {
    const w = 5 + 2 * randomInt(3);
    const h = 5 + 2 * randomInt(2);
    return tryPlace(w, h, (bx, by) => {
      const clumps = 2 + randomInt(3);
      for (let c = 0; c < clumps; c += 1) {
        const ccx = 1 + randomInt(Math.max(1, w - 2));
        const ccy = 1 + randomInt(Math.max(1, h - 2));
        const n = 3 + randomInt(4);
        for (let i = 0; i < n; i += 1) {
          const tx = ccx + randomInt(3) - 1;
          const ty = ccy + randomInt(3) - 1;
          if (tx < 0 || ty < 0 || tx >= w || ty >= h) continue;
          if (Math.random() < 0.78) terrain[`${bx + tx},${by + ty}`] = 'tree';
        }
      }
    });
  };

  // A HEDGE MAZE: a proper maze of timber, carved by recursive backtracking on the odd lattice.
  // Every cell is reachable and there is exactly one route between any two — but it is TREES, so a
  // player with an axe (or a boulder, or a fireball) writes his own shortcut and pays turns for it.
  const hedgeMaze = () => {
    const w = 9 + 2 * randomInt(3); // odd
    const h = 7 + 2 * randomInt(3);
    return tryPlace(w, h, (bx, by) => {
      for (let x = 0; x < w; x += 1) for (let y = 0; y < h; y += 1) terrain[`${bx + x},${by + y}`] = 'tree';
      const seen = new Set();
      const key = (x, y) => `${x},${y}`;
      const carve = (x, y) => {
        seen.add(key(x, y));
        delete terrain[`${bx + x},${by + y}`];
        const dirs = [[2, 0], [-2, 0], [0, 2], [0, -2]];
        for (let i = dirs.length - 1; i > 0; i -= 1) { const j = randomInt(i + 1); [dirs[i], dirs[j]] = [dirs[j], dirs[i]]; }
        for (const [dx, dy] of dirs) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 1 || nx >= w - 1 || ny < 1 || ny >= h - 1 || seen.has(key(nx, ny))) continue;
          delete terrain[`${bx + x + dx / 2},${by + y + dy / 2}`]; // knock the hedge between them through
          carve(nx, ny);
        }
      };
      carve(1, 1);
      // Two ways in, so it is a maze and not a trap.
      delete terrain[`${bx},${by + 1}`];
      delete terrain[`${bx + w - 1},${by + h - 2}`];
    });
  };

  // A GAOL: a walled hall of one-tile cells, each barred by a GATE with something behind it. You can
  // SEE what is in every cell (that is what gates are for) and walk the corridor untouched — or cut
  // one open. The whole structure is a question the player asks himself.
  const gaol = () => {
    const w = 7;
    const h = 5;
    return tryPlace(w, h, (bx, by) => {
      for (let x = 0; x < w; x += 1) {
        for (let y = 0; y < h; y += 1) {
          if (x === 0 || x === w - 1 || y === 0 || y === h - 1) terrain[`${bx + x},${by + y}`] = 'wall';
        }
      }
      terrain[`${bx + (w - 1) / 2},${by + h - 1}`] = 'door'; // the way in
      if (keepDoors) keepDoors.add(`${bx + (w - 1) / 2},${by + h - 1}`);
      // The cell block, along the top: a row of one-tile cells (by+1), each barred by its own gate
      // (by+2), opening onto the corridor (by+3).
      //
      // The rows matter. The prisoner used to be posted at `by` — which is the OUTER WALL — so it
      // was never placed at all and every gaol was an empty corridor of gates. Its cell is the tile
      // BEHIND the gate, not the masonry behind that.
      for (let x = 1; x < w - 1; x += 2) {
        delete terrain[`${bx + x},${by + 1}`]; // the cell itself
        terrain[`${bx + x},${by + 2}`] = 'gate'; // ...and the bars across it
        if (keepDoors) keepDoors.add(`${bx + x},${by + 2}`); // deliberate: a cell has ONE tile behind it
        if (garrison) garrison.push({ kind: 'prisoner', x: bx + x, y: by + 1 });
      }
      for (let x = 2; x < w - 1; x += 2) { // the masonry between one cell and the next
        terrain[`${bx + x},${by + 1}`] = 'wall';
        terrain[`${bx + x},${by + 2}`] = 'wall';
      }
    });
  };

  // A BATTERY: turrets set back in alcoves, so their lanes rake the room while they themselves are
  // awkward to reach. A gun you cannot walk up to is a very different problem from one you can.
  const battery = () => {
    const w = 7;
    const h = 7;
    return tryPlace(w, h, (bx, by) => {
      for (let x = 0; x < w; x += 1) {
        for (let y = 0; y < h; y += 1) {
          const edge = x === 0 || x === w - 1 || y === 0 || y === h - 1;
          if (edge) terrain[`${bx + x},${by + y}`] = 'wall';
        }
      }
      // RECESSES in two opposite walls, each with a gun set at the back of it: the gun rakes the room
      // down its lane, but reaching it means stepping INTO the alcove — one tile, no room to dodge,
      // and its own muzzle at the end of it.
      const c = (h - 1) / 2;
      for (const side of [1, w - 2]) {
        delete terrain[`${bx + side},${by + c}`]; // the mouth of the recess
        if (garrison) garrison.push({ kind: 'turret', x: bx + side, y: by + c });
      }
      terrain[`${bx + (w - 1) / 2},${by}`] = 'door';
      terrain[`${bx + (w - 1) / 2},${by + h - 1}`] = 'door';
      if (keepDoors) { keepDoors.add(`${bx + (w - 1) / 2},${by}`); keepDoors.add(`${bx + (w - 1) / 2},${by + h - 1}`); }
    });
  };

  // A CRUCIBLE: a summoning circle behind a gate. Diabolical, and fair: you can SEE the rune ticking
  // over, you can shoot it through the bars, and you can watch what it makes walk out of a door on
  // the far side. Everything about it is visible and none of it is convenient.
  // A QUARRY: rows of boulders. Ammunition, cover, and a shoving puzzle all at once — the only
  // structure on the floor whose walls you can pick up and throw at things.
  const quarry = () => {
    const w = 5 + 2 * randomInt(2);
    const h = 5;
    return tryPlace(w, h, (bx, by) => {
      for (let x = 0; x < w; x += 2) {
        for (let y = 1; y < h - 1; y += 2) terrain[`${bx + x},${by + y}`] = 'boulder';
      }
    });
  };

  // A CATACOMB: a grid of alcoves with the dead laid in them. Pure atmosphere on most floors — and
  // then one day a Lich walks in, and the room is a magazine.
  const catacomb = () => {
    const w = 7;
    const h = 5;
    return tryPlace(w, h, (bx, by) => {
      for (let x = 0; x < w; x += 1) {
        for (let y = 0; y < h; y += 1) {
          if (x === 0 || x === w - 1 || y === 0 || y === h - 1) terrain[`${bx + x},${by + y}`] = 'wall';
        }
      }
      terrain[`${bx + (w - 1) / 2},${by + h - 1}`] = 'door';
      if (keepDoors) keepDoors.add(`${bx + (w - 1) / 2},${by + h - 1}`);
      for (let x = 1; x < w - 1; x += 2) terrain[`${bx + x},${by + 2}`] = 'wall'; // the shelving
      if (garrison) {
        for (let x = 1; x < w - 1; x += 2) garrison.push({ kind: 'bones', x: bx + x, y: by + 1 });
      }
    });
  };

  // A WELL: a shaft ringed by stone with one way in. A hole you have to WANT to stand next to —
  // which is exactly what makes it worth shoving something toward.
  const well = () => tryPlace(5, 5, (bx, by) => {
    for (let x = 0; x < 5; x += 1) {
      for (let y = 0; y < 5; y += 1) {
        const r = Math.max(Math.abs(x - 2), Math.abs(y - 2));
        if (r === 2) terrain[`${bx + x},${by + y}`] = 'wall';
        else if (r === 0) terrain[`${bx + x},${by + y}`] = 'pit';
      }
    }
    const gap = [[2, 0], [2, 4], [0, 2], [4, 2]][randomInt(4)];
    delete terrain[`${bx + gap[0]},${by + gap[1]}`];
  });

  // A BRAZIER HALL: a colonnade of lit torches. Every pillar is a hazard to a phaser and a light in
  // the dark to everyone else.
  const brazierHall = () => {
    const w = 7;
    const h = 3;
    return tryPlace(w, h, (bx, by) => {
      for (let x = 0; x < w; x += 2) {
        for (const y of [0, h - 1]) {
          terrain[`${bx + x},${by + y}`] = 'wall';
          if (garrison) garrison.push({ kind: 'torch', x: bx + x, y: by + y });
        }
      }
    });
  };

  // A set-piece has to belong to the floor it stands on. The RECIPE is the spec — "each floor is
  // made of what its name says" — so an orchard only grows where trees grow, and a lava bridge only
  // spans a floor that has lava to span. Left ungated, these quietly put a hedge maze in the
  // Whispering Crypt and a fire pond in the Old Forest, which is precisely what the recipes exist
  // to prevent. Masonry, water and ice are at home anywhere.
  const floorRecipe = (levelForFloor(floor) || {}).recipe || {};
  const SET_PIECES = [
    ['storeroom', storeroom], ['fountain', fountain], ['garden', garden], ['pond', pond],
    ['igloo', igloo], ['gaol', gaol], ['battery', battery],
    ['quarry', quarry], ['catacomb', catacomb], ['well', well], ['brazier', brazierHall],
  ];
  if (floorRecipe.tree) SET_PIECES.push(['orchard', orchard], ['hedgemaze', hedgeMaze]);
  if (floorRecipe.lava) SET_PIECES.push(['bridge', bridge]);
  // ONE OF EACH PER RUN. A structure is a place you RECOGNISE — that is the entire reason they
  // exist — and the second igloo is worth a fraction of the first. `seenStructures` rides on the
  // player, which is the only thing that survives a descent, so the run remembers what it has
  // already shown him and spends the rest of its vocabulary instead.
  //
  // If he outlives the vocabulary the slate is wiped rather than the floor going bare: eight floors
  // of nothing but open ground would be worse than a repeat.
  const seen = new Set(player.seenStructures || []);
  let pool = SET_PIECES.filter(([name]) => !seen.has(name));
  if (!pool.length) { seen.clear(); pool = SET_PIECES.slice(); }
  for (let i = pool.length - 1; i > 0; i -= 1) { const j = randomInt(i + 1); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  for (let i = 0, n = Math.min(pool.length, 3 + randomInt(3)); i < n; i += 1) {
    const [name, build] = pool[i];
    if (build()) seen.add(name); // only remember it if it actually FOUND room
  }
  player.seenStructures = [...seen];

  const blob = (type, patches, spread) => {
    for (let i = 0; i < patches; i += 1) {
      const cx = randomInt(WORLD_SIZE);
      const cy = randomInt(WORLD_SIZE);
      const cells = 3 + randomInt(spread);
      for (let j = 0; j < cells; j += 1) put(cx + randomInt(3) - 1, cy + randomInt(3) - 1, type);
    }
  };
  // Straight wall runs — the bones of hallways.
  const wallLine = (segments, length) => {
    for (let i = 0; i < segments; i += 1) {
      let x = 1 + randomInt(WORLD_SIZE - 2);
      let y = 1 + randomInt(WORLD_SIZE - 2);
      const horizontal = Math.random() < 0.5;
      for (let j = 0; j < length; j += 1) {
        put(x, y, 'wall');
        if (horizontal) x += 1;
        else y += 1;
      }
    }
  };
  // Rectangular rooms — a wall outline with one or two doorway gaps.
  const rooms = (count) => {
    for (let i = 0; i < count; i += 1) {
      const w = 4 + randomInt(5);
      const h = 4 + randomInt(5);
      const rx = 2 + randomInt(Math.max(1, WORLD_SIZE - w - 3));
      const ry = 2 + randomInt(Math.max(1, WORLD_SIZE - h - 3));
      const edge = [];
      for (let x = rx; x < rx + w; x += 1) { put(x, ry, 'wall'); put(x, ry + h - 1, 'wall'); edge.push([x, ry], [x, ry + h - 1]); }
      for (let y = ry; y < ry + h; y += 1) { put(rx, y, 'wall'); put(rx + w - 1, y, 'wall'); edge.push([rx, y], [rx + w - 1, y]); }
      const doors = 1 + randomInt(2);
      for (let d = 0; d < doors && edge.length; d += 1) {
        const [dx, dy] = edge[randomInt(edge.length)];
        clear(dx, dy);
        clear(dx, dy); // widen the gap a touch by clearing a neighbour too
      }
    }
  };

  const level = levelForFloor(floor);
  const recipe = (level && level.recipe) || {};
  const cycle = Math.floor((floor - 1) / FINAL_FLOOR);
  const scale = (1 + cycle * 0.5) * (WORLD_SIZE / 20); // more seeds for the bigger board
  const seeds = (type) => Math.round((recipe[type] || 0) * scale);
  if (seeds('water')) blob('water', 2 * seeds('water'), 5);
  if (seeds('lava')) blob('lava', 2 * seeds('lava'), 5);
  if (seeds('wall')) wallLine(3 * seeds('wall'), 5);
  // ROOMS are part of the RECIPE now. They used to be a flat 3-5 on every floor, whatever the
  // recipe said — which is why every floor came out 23-36% stone: the Battlefield had more wall
  // than the Drowned Lake, and the Old Forest was a masonry maze with a pond in it. A crypt and a
  // castle are made of rooms; a forest and an open field are not.
  if (seeds('rooms')) rooms(seeds('rooms'));
  // TREES: solid, sight-blocking timber (3 wounds, see damageTree). A forest and a hedge maze are
  // MADE of these — they are the reason those floors read as anything but corridors.
  if (seeds('tree')) {
    // Irregular COPSES rather than an even stipple: each stand gets its OWN random spread (1-3 tiles)
    // and cell count, so a wood comes out as tight thickets, the odd broad stand, and clearings
    // between — not trees marching at a regular pitch.
    for (let i = 0, stands = 2 * seeds('tree'); i < stands; i += 1) {
      const cx = randomInt(WORLD_SIZE);
      const cy = randomInt(WORLD_SIZE);
      const rad = 1 + randomInt(3); // this stand's spread
      const cells = 3 + randomInt(2 * rad + 2);
      for (let j = 0; j < cells; j += 1) put(cx + randomInt(2 * rad + 1) - rad, cy + randomInt(2 * rad + 1) - rad, 'tree');
    }
  }
  // Depth hazards: bottomless PITS from floor 2, pushable BOULDERS from floor 3, scattered
  // as a few small clusters. (Connectivity is guaranteed afterward — carves clear both.)
  if (floor >= 2) for (let i = 0; i < 3 + Math.floor(floor / 2); i += 1) put(2 + randomInt(WORLD_SIZE - 4), 2 + randomInt(WORLD_SIZE - 4), 'pit');
  if (floor >= 3) for (let i = 0; i < 2 + Math.floor(floor / 3); i += 1) put(2 + randomInt(WORLD_SIZE - 4), 2 + randomInt(WORLD_SIZE - 4), 'boulder');
  // ICE slabs (frozen, see-through barriers) from floor 2 — the odd floor gets a small ice
  // chamber, a ragged ring of slabs. Ice melts to water when struck by fire and shatters when
  // leapt on or slammed into.
  if (floor >= 2) {
    blob('ice', 1 + Math.floor(floor / 3), 4);
    if (Math.random() < 0.5) {
      // A small ice CHAMBER: a SOLID box of slabs (corners included) with one ORTHOGONAL way in. The
      // old version left the corners as loose diagonal slabs with walk-through gaps — a ragged ring
      // that read as a LATTICE of diagonal ice, which is exactly what an ice room should not look
      // like (the same fix the igloo already had). Ortho walls only now.
      const cx = 4 + randomInt(WORLD_SIZE - 8);
      const cy = 4 + randomInt(WORLD_SIZE - 8);
      for (let dx = -1; dx <= 1; dx += 1) for (let dy = -1; dy <= 1; dy += 1) {
        if (dx === 0 && dy === 0) continue; // hollow centre
        put(cx + dx, cy + dy, 'ice');
      }
      const door = [[0, -1], [0, 1], [-1, 0], [1, 0]][randomInt(4)]; // one orthogonal entrance
      clear(cx + door[0], cy + door[1]);
    }
  }
  // GRASS — tall enough to block sight but not passage; withers when scorched and is flattened by
  // a rolling boulder. Same terrain everywhere; only its look changes, to dry pink-grey DEVILGRASS
  // husks in the demon realm. Per-RECIPE now: a forest is deep in it, a crypt has none. It used to
  // be a flat trickle on every floor, so every floor had the same ~3% of it, forest or not.
  if (seeds('grass')) blob('devilgrass', 2 * seeds('grass'), 5);

  // SHUT DOORS: hang a handful in genuine doorways (1-wide gaps a wall already frames) — walkable,
  // but sight-/fire-blocking until pushed open. A few more the deeper he goes.
  const doorSpots = [];
  for (const key in terrain) {
    if (terrain[key] !== 'wall') continue;
    const [dx, dy] = key.split(',').map(Number);
    if (dx < 2 || dx >= WORLD_SIZE - 2 || dy < 2 || dy >= WORLD_SIZE - 2) continue;
    if (nearStart(dx, dy) || isReserved(dx, dy)) continue; // a set-piece owns its own doors
    if (isDoorwaySpot(atT, dx, dy)) doorSpots.push([dx, dy]);
  }
  for (let i = doorSpots.length - 1; i > 0; i -= 1) { const j = randomInt(i + 1); [doorSpots[i], doorSpots[j]] = [doorSpots[j], doorSpots[i]]; }
  // GATES hang in the SAME doorways, and the vetting problem is already solved: isDoorwaySpot has
  // established that each of these is a real way in — a 1-wide gap a wall genuinely frames, opening
  // into real space (>= 6 tiles) on BOTH sides. A gate can no more land somewhere daft than a door can.
  // The point of a gate is the INVERSE of a door: a door hides what is past it, a gate shows you. You
  // see (and shoot) straight through the bars; you just cannot walk through until you have cut them
  // down, three swings. A way in you can case before committing to.
  //
  // Both are hung from ONE shuffled list in ONE pass, alternating, and every spot is RE-CHECKED against
  // the terrain as it stands right now. That re-check is load-bearing: the list was vetted against the
  // solid wall, but hanging something at A un-walls A, and isDoorwaySpot demands wall at +/-2 — so a
  // door hung early silently invalidates any candidate within two tiles of it. Judging the stale list
  // would hang the later ones in gaps that no longer frame anything. Alternating (rather than doors
  // taking the whole list first) is what stops gates from being starved on wall-poor floors: doors want
  // 3-7 of them, and on a sparse floor that was every spot there was.
  const wantDoors = 3 + Math.floor(floor / 2);
  const wantGates = 1 + randomInt(3); // 1-3
  let doors = 0;
  let gates = 0;
  for (const [dx, dy] of doorSpots) {
    if (doors >= wantDoors && gates >= wantGates) break;
    if (!isDoorwaySpot(atT, dx, dy)) continue; // re-vet: an earlier door/gate may have unframed this
    // Alternate, so neither starves the other; fall through to whichever still wants spots.
    const wantsGate = gates < wantGates && (doors >= wantDoors || (doors + gates) % 2 === 1);
    terrain[`${dx},${dy}`] = wantsGate ? 'gate' : 'door';
    if (wantsGate) gates += 1; else doors += 1;
  }

  // PILLARS: colonnades of LONE wall tiles (each ringed by floor) dropped into OPEN areas — cover to
  // fight around, so a big empty room turns perilous. Two parallel rows preferred; a lone tile never
  // blocks passage (you step around it).
  const loneSpot = (x, y) => {
    if (x < 2 || x >= WORLD_SIZE - 2 || y < 2 || y >= WORLD_SIZE - 2) return false;
    if (nearStart(x, y) || isReserved(x, y)) return false;
    for (let ddx = -1; ddx <= 1; ddx += 1) for (let ddy = -1; ddy <= 1; ddy += 1) {
      if (atT(x + ddx, y + ddy) !== 'normal') return false; // the tile AND all 8 neighbours must be open floor
    }
    return true;
  };
  const colonnade = () => {
    const horiz = Math.random() < 0.5;
    const len = 3 + randomInt(3); // 3-5 pillars per row
    const rows = Math.random() < 0.7 ? 2 : 1; // usually a PAIR of parallel rows
    // Hunt for a start where enough of the pattern lands in open ground before committing, so a
    // colonnade reads as a real row rather than a stray block.
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const sx = 3 + randomInt(Math.max(1, WORLD_SIZE - 8));
      const sy = 3 + randomInt(Math.max(1, WORLD_SIZE - 8));
      const spots = [];
      for (let r = 0; r < rows; r += 1) {
        for (let i = 0; i < len; i += 1) {
          const x = sx + (horiz ? i * 2 : r * 3); // pillars 2 apart along a row, rows 3 apart
          const y = sy + (horiz ? r * 3 : i * 2);
          if (loneSpot(x, y)) spots.push([x, y]);
        }
      }
      if (spots.length >= Math.min(3, rows * len)) { // a decent stretch fits — lay it
        for (const [x, y] of spots) terrain[`${x},${y}`] = 'wall';
        return;
      }
    }
  };
  const formations = 2 + randomInt(2); // 2-3 colonnade attempts (open floors get more; cramped ones fewer)
  for (let i = 0; i < formations; i += 1) colonnade();

  return terrain;
}

// The STYLES a guarded chamber (and its decoys) can take. Each is a 7x7 footprint: a cleared 5x5
// court ringed at chebyshev 3, with one open doorway facing the king. ONE style is chosen per floor
// (pickChamberStyle) and used for the REAL chamber AND every decoy, so a false court is
// indistinguishable from the true one until you are inside it. The boss stands at the centre with its
// eight neighbours always cleared, so it never wants for a move.
//   ring       - what the wall of the court is made of (wall / lava / water / tree / ice)
//   sideDoors  - punch 1-2 SHUT doors into a STONE ring (more ways in, sealed from sight)
//   extraGap   - cut one more OPEN mouth into a timber/ice ring (there is no framing a door in a hedge)
//   clutter    - strew the court CORNERS with boulders and pits (never the boss's ring or the approach)
const CHAMBER_STYLES = {
  keep: { ring: 'wall', sideDoors: true }, // a walled keep with barred side-doors
  moatFire: { ring: 'lava' }, // a moat of fire
  moatDeep: { ring: 'water' }, // a moat of deep water
  copse: { ring: 'tree', extraGap: true }, // a stockade of timber — chop, burn or leap in
  sanctum: { ring: 'ice', extraGap: true }, // an icy sanctum — see through it, shatter or melt in
  quarry: { ring: 'wall', sideDoors: true, clutter: true }, // a walled court strewn with boulders and pits
};

// Pick a chamber style for the floor. A lake of fire guards its own with fire and a lake with water;
// a forest favours a timber stockade; otherwise it is a weighted roll across the walled, cluttered
// and icy variants, so the guarded key rarely looks the same two floors running.
function pickChamberStyle(level) {
  const recipe = (level && level.recipe) || {};
  // A floor DEFINED by fire or water guards its own with a matching moat (and keeps the floor reading
  // as its name says). A merely damp floor — the forest's stream, the castle's fire-veins — is free to
  // grow something else. Threshold at 5 seeds: the Lake of Fire (10), the Drowned Lake (10) and the
  // Sunken Ruins (5) keep their moats; the Old Forest (water 2) and Demon Castle (lava 3) do not.
  if ((recipe.lava || 0) >= 5) return CHAMBER_STYLES.moatFire;
  if ((recipe.water || 0) >= 5) return CHAMBER_STYLES.moatDeep;
  const pool = [];
  if (recipe.tree) pool.push('copse', 'copse'); // forests lean toward a stockade
  pool.push('keep', 'keep', 'quarry', 'sanctum');
  return CHAMBER_STYLES[pool[randomInt(pool.length)]] || CHAMBER_STYLES.keep;
}

// Lay a CHAMBER of `style` at (cx,cy). Returns the open doorway, which the caller must keep reachable.
function buildChamber(state, cx, cy, style, toward) {
  const ring = style.ring;
  for (let dx = -2; dx <= 2; dx += 1) {
    for (let dy = -2; dy <= 2; dy += 1) {
      delete state.terrain[`${cx + dx},${cy + dy}`];
      if (state.treeHp) delete state.treeHp[`${cx + dx},${cy + dy}`];
    }
  }
  const doorX = cx + Math.sign(toward.x - cx) * 3;
  const doorY = cy + Math.sign(toward.y - cy) * 3;
  for (let dx = -3; dx <= 3; dx += 1) {
    for (let dy = -3; dy <= 3; dy += 1) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== 3) continue;
      const rx = cx + dx;
      const ry = cy + dy;
      if (rx < 1 || rx >= WORLD_SIZE - 1 || ry < 1 || ry >= WORLD_SIZE - 1) continue;
      if (chebyshev(rx, ry, doorX, doorY) === 0) continue;
      state.terrain[`${rx},${ry}`] = ring;
      if (state.treeHp) delete state.treeHp[`${rx},${ry}`]; // a fresh ring-tree starts whole
    }
  }
  delete state.terrain[`${doorX},${doorY}`];
  // The mid-tiles of the three non-doorway sides: candidates for a second way in.
  const midSides = [[3, 0], [-3, 0], [0, 3], [0, -3]].map(([dx, dy]) => ({ x: cx + dx, y: cy + dy }))
    .filter((t) => t.x > 1 && t.x < WORLD_SIZE - 2 && t.y > 1 && t.y < WORLD_SIZE - 2 && chebyshev(t.x, t.y, doorX, doorY) > 1);
  if (style.sideDoors && ring === 'wall') {
    // Doors only where it's a GENUINE doorway — court within, real open ground without. A ring tile
    // backed by solid rock would be a door that leads nowhere.
    const atS = (x, y) => terrainAt(state, x, y);
    const doorSpots = midSides.filter((t) => isDoorwaySpot(atS, t.x, t.y));
    for (let i = doorSpots.length - 1; i > 0; i -= 1) { const j = randomInt(i + 1); [doorSpots[i], doorSpots[j]] = [doorSpots[j], doorSpots[i]]; }
    const nDoors = Math.min(doorSpots.length, 1 + randomInt(2)); // 1-2 chamber doors
    for (let i = 0; i < nDoors; i += 1) state.terrain[`${doorSpots[i].x},${doorSpots[i].y}`] = 'door';
  } else if (style.extraGap && midSides.length) {
    const g = midSides[randomInt(midSides.length)];
    delete state.terrain[`${g.x},${g.y}`]; // a second, open mouth in the timber/ice ring
  }
  if (style.clutter) {
    // Court CORNERS only (the chebyshev-2 diagonals): never the boss's own ring, never a knight's
    // landing tiles, never the doorway approach — hazards that enrich the court without penning anyone.
    for (const [dx, dy] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) {
      if (Math.random() < 0.35) continue; // leave some corners clear
      state.terrain[`${cx + dx},${cy + dy}`] = Math.random() < 0.5 ? 'boulder' : 'pit';
    }
  }
  return { doorX, doorY };
}

// The king's start is roughly CENTRED — a good default — but jittered a few tiles each floor so it
// never looks quite the same twice (dead centre every time goes stale). Kept well inside the border
// and a safe distance from the floor's guarded chamber, so he never spawns inside the boss court.
// Everything downstream reads his ACTUAL position (terrain-clearing, the chamber doorway's facing,
// the exit's distance checks), so the whole floor arranges itself around wherever he lands.
function randomizedStart(floor) {
  const anchor = chamberAnchorForFloor(floor);
  const clamp = (v) => Math.max(4, Math.min(WORLD_SIZE - 5, v));
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const x = clamp(PLAYER_START.x + randomInt(13) - 6); // centre +/- 6
    const y = clamp(PLAYER_START.y + randomInt(13) - 6);
    if (chebyshev(x, y, anchor.x, anchor.y) >= 8) return { x, y };
  }
  return { x: PLAYER_START.x, y: PLAYER_START.y }; // fallback: dead centre
}

// Build (or rebuild) a floor. Carries the player's stats forward between floors.
function generateFloor(floor, carryPlayer, score) {
  const player = carryPlayer ? { ...carryPlayer } : createPlayer('warrior');
  const start = randomizedStart(floor);
  player.x = start.x;
  player.y = start.y;

  // What the set-pieces want putting inside them: a prisoner behind each gate, a gun in each alcove,
  // Collected while the terrain is laid; honoured below, once enemies exist.
  const garrison = [];
  const keepDoors = new Set(); // doors/gates a set-piece built ON PURPOSE — the prune must not judge them
  const state = {
    worldSize: WORLD_SIZE,
    viewSize: player.vision,
    player,
    terrain: generateTerrain(floor, player, garrison, keepDoors),
    fixedDoors: keepDoors,
    explored: {},
    enemies: [],
    spatters: [],
    corpses: [], // fading remains of slain pieces (cosmetic)
    ashes: [], // fading ash piles left by spell kills (cosmetic)
    rubble: [], // fading rock piles left by crushed / blasted boulders (cosmetic)
    scorches: [], // fading soot where spellfire washed over bare stone (cosmetic)
    sticks: [], // fading sticks & leaves left by a felled tree (cosmetic)
    treeHp: {}, // per-tile wounds left in each standing tree (terrain has nowhere to hang a number)
    burningTrees: {}, // trees lit by spellfire — they burn away next turn (tickBurningTrees)
    scrap: [], // fading rusty wreckage left by destroyed turrets (cosmetic)
    iceShards: [], // fading pale-blue splinters left by shattered ice (cosmetic)
    scars: [], // permanent marks (shattered summoning circles)
    exit: null,
    key: null, // the floor key; the stair stays locked until it is collected
    allies: [], // the Necromancer's familiar / undead pieces (the player's side)
    floor,
    turn: 0,
    geyserPhase: 0, // the shared geyser clock — starts calm, ticks each turn (passTurn); see geyserErupting
    score: score || 0,
    enemyTurn: false,
    gameOver: false,
    won: false,
    pendingLevelUp: false,
    levelPerks: null,
    message: 'A new floor. Find the floor key to unlock the stair down.',
    lastAction: 'start',
    spawnInterval: Math.max(3, 9 - floor),
    turnsSinceSpawn: 0,
    lastDreadGear: 0, // the HURRY gear last seen — every rise fires a hostile event
    dreadTurns: dreadTurnsFor(), // turns until the dread clock maxes (the same at every difficulty)
  };

  const occupied = new Set([`${player.x},${player.y}`]);
  const standable = (x, y) => isStandable(terrainAt(state, x, y));
  const seen = (x, y) => inLineOfSight(state, x, y);

  function place(predicate) {
    const tile = findFreeTile(occupied, predicate);
    if (tile) occupied.add(tile.key);
    return tile;
  }
  // Spawn a MOBILE enemy guaranteed to have a legal move: if the chosen kind is walled in where it
  // stands, re-cast it as some other kind from its OWN realm's roster that can move from there; if
  // nothing in the roster can, don't spawn it at all — never leave a piece frozen in place.
  //
  // NB: this used to fall back to a plain 'king', which quietly smuggled a MORTAL piece onto the
  // demon floors, where only natives belong.
  function addMobileEnemy(type, x, y, surprised) {
    const enemy = createEnemy(type, x, y);
    enemy.surprised = Boolean(surprised);
    // EVERYTHING seeded with the floor starts ASLEEP — posted where it was placed, holding its ground,
    // doing nothing until the king is seen or lands a blow. That is what makes the initial population
    // read as a garrison: foes guarding the ground they were put on. Only reinforcements (dread events,
    // the ambient trickle, summons) arrive already WANDERING, hunting for him — see maybeSpawnEnemy.
    // Once one wakes it never sleeps again; it wanders or hunts from then on.
    enemy.asleep = true;
    state.enemies.push(enemy);
    if (!enemyHasMove(state, enemy)) {
      const roster = enemyRosterForFloor(floor); // natives only — never a mortal down in the realm
      let freed = false;
      for (const alt of roster) {
        enemy.kind = alt;
        if (enemyHasMove(state, enemy)) { freed = true; break; }
      }
      if (!freed) {
        state.enemies.pop();
        return null;
      }
    }
    return enemy;
  }

  // GARRISON the set-pieces: whatever they asked for, now that there is somebody to put in them.
  // A structure is only worth building if the thing that makes it interesting is actually IN it —
  // an empty gaol is a corridor, an empty battery is a room with holes in the walls.
  for (const post of garrison) {
    if (post.x < 1 || post.x >= WORLD_SIZE - 1 || post.y < 1 || post.y >= WORLD_SIZE - 1) continue;
    // Scenery (bones, a lit torch) is not a unit and does not care what is standing there.
    if (post.kind !== 'bones' && post.kind !== 'torch'
        && state.enemies.some((e) => e.x === post.x && e.y === post.y)) continue;
    if (post.kind === 'turret') {
      state.enemies.push(makeTurret(state, randomTurretKind(floor), post.x, post.y));
    } else if (post.kind === 'circle') {
      const k = randomStructureKind(floor);
      const c = createEnemy(k, post.x, post.y);
      c.summonCircle = true;
      state.enemies.push(c);
    } else if (post.kind === 'bones') {
      // The catacomb's dead: real corpses on the real decay clock, so they fade like any other body
      // — and a Lich that walks in while they are still fresh has a magazine.
      addCorpse(state, post.x, post.y, randomEnemyKind(floor));
    } else if (post.kind === 'torch') {
      if (!state.torches) state.torches = {};
      state.torches[`${post.x},${post.y}`] = true;
    } else {
      // A PRISONER: asleep behind its gate. Asleep because the cell is a thing to look at and think
      // about — cut it open on your terms, or leave it and walk on. A cell full of something already
      // awake and hammering the bars is just a fight you did not choose.
      const e = createEnemy(randomEnemyKind(floor), post.x, post.y);
      e.asleep = true;
      e.caged = true; // DELIBERATELY immobile: walled in its cell behind a gate. Exempt from the
      // frozen-piece prune below (which drops wanderers that terrain sealed in) — a prisoner with no
      // move is the POINT of the cell, not an accident to clean up. Cut the gate and it walks out.
      state.enemies.push(e);
    }
  }

  // Every initial cohort is scaled to 0.75x for a gentler starting population.
  const initCount = (n) => Math.round(n * 0.75);

  // The floor's standing garrison — posted off-screen and asleep at their stations, growing with depth.
  const offscreenCount = Math.min(initCount(8 + floor * 4), MAX_ENEMIES);
  for (let i = 0; i < offscreenCount; i += 1) {
    const tile = place((x, y) => standable(x, y) && !seen(x, y) && chebyshev(x, y, player.x, player.y) >= 2);
    if (!tile) break;
    addMobileEnemy(randomEnemyKind(floor), tile.x, tile.y, false);
  }



  // The floor KEY (or the Orb of Victory on the last floor) sits GUARDED in a walled chamber at
  // the floor's fixed anchor: the boss stands ON it, dormant, until it spies the king, ringed by
  // a wall (or lava/water moat) with a doorway facing the king, plus a backup cohort. The EXIT is
  // placed SEPARATELY near the king's start (below) — he spawns beside the way out and must
  // journey to the guarded key and back to leave.
  const level = levelForFloor(floor);
  const anchor = chamberAnchorForFloor(floor);
  const ax = Math.max(3, Math.min(WORLD_SIZE - 4, anchor.x)); // clamped so the larger 7x7 chamber fits
  const ay = Math.max(3, Math.min(WORLD_SIZE - 4, anchor.y));
  const portalFloor = isFinalFloor(floor);
  state.isPortalFloor = portalFloor;
  occupied.add(`${ax},${ay}`);
  // ONE chamber style per floor — a moat of fire/water, a walled keep, a timber copse, an icy
  // sanctum, or a hazard-strewn quarry — shared by the real chamber and its decoys alike.
  const chamberStyle = pickChamberStyle(level);
  // The guarded chamber: its ring's open doorway faces the king. Its shut side-doors (or a second
  // gap) keep more than one way in and out, and the fight sealed from sight until he pushes through.
  const { doorX, doorY } = buildChamber(state, ax, ay, chamberStyle, player);

  // FALSE CHAMBERS: the same court, ring and doors — but empty. The real chamber sits at a FIXED
  // anchor per floor, so a walled court on the horizon used to be proof of where the key was. A
  // decoy or two means you have to go and look. They are laid before the wanderers are placed, so
  // foes drift through them like any other room.
  // Usually none: a decoy should be an occasional surprise, not standard furniture. ~45% of
  // floors get one, ~11% get two.
  const wantDecoys = Math.random() < 0.55 ? 0 : (Math.random() < 0.75 ? 1 : 2);
  for (let i = 0; i < wantDecoys; i += 1) {
    let spot = null;
    for (let attempt = 0; attempt < 40 && !spot; attempt += 1) {
      const cx = 4 + randomInt(Math.max(1, WORLD_SIZE - 8));
      const cy = 4 + randomInt(Math.max(1, WORLD_SIZE - 8));
      // Well clear of the true chamber (so the two never merge into one blob) and of the king's
      // start (he must not begin inside a decoy).
      if (chebyshev(cx, cy, ax, ay) < 8) continue;
      if (chebyshev(cx, cy, player.x, player.y) < 6) continue;
      spot = { x: cx, y: cy };
    }
    if (spot) buildChamber(state, spot.x, spot.y, chamberStyle, player);
  }

  // The KEY / Orb at the chamber's heart — the boss stands on it and guards it. A wanderer
  // scattered earlier may have landed on the anchor before it was reserved; clear it so the
  // guardian (and the key beneath it) sit alone.
  state.key = { x: ax, y: ay, collected: false, discovered: false, orb: portalFloor };
  state.enemies = state.enemies.filter((e) => !(e.x === ax && e.y === ay));
  const boss = createBoss(floor, ax, ay);
  state.enemies.push(boss);
  // Belt and braces: a jumper penned by a barrier ring (wall, timber, ice) that somehow has no move
  // once roused gets its ring flooded to water, so any piece can wade out. (The cleared court almost
  // always leaves it a move; this is the last resort.)
  if (!enemyHasMove(state, boss)) {
    for (let dx = -3; dx <= 3; dx += 1) {
      for (let dy = -3; dy <= 3; dy += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== 3) continue;
        const key = `${ax + dx},${ay + dy}`;
        const t = state.terrain[key];
        if (t === 'wall' || t === 'tree' || t === 'ice') {
          state.terrain[key] = 'water';
          if (state.treeHp) delete state.treeHp[key];
        }
      }
    }
  }

  // The EXIT (stair / victory portal). It is DISCOVERED from the off — he always knows where the
  // way out IS — but it no longer sits on his doorstep. He used to start beside it, which made the
  // floor a single out-and-back errand: walk to the key, walk home. Now the stair, the key and the
  // king are three separate places, so the route is a real decision.
  //
  // It is kept clear of the guarded chamber too, so the stair and the key never collapse into one
  // trip. Each fallback relaxes the constraints in turn; the last accepts any standable ground,
  // because a floor with no stair is unplayable.
  const EXIT_MIN_FROM_KING = 8;
  const farFromKing = (x, y, lo) => standable(x, y) && chebyshev(x, y, player.x, player.y) >= lo;
  const exitTile = place((x, y) => farFromKing(x, y, EXIT_MIN_FROM_KING) && chebyshev(x, y, ax, ay) >= 7)
    || place((x, y) => farFromKing(x, y, EXIT_MIN_FROM_KING) && chebyshev(x, y, ax, ay) >= 5)
    || place((x, y) => farFromKing(x, y, 6) && chebyshev(x, y, ax, ay) >= 4)
    || place((x, y) => farFromKing(x, y, 5))
    || place((x, y) => standable(x, y) && chebyshev(x, y, player.x, player.y) >= 2);
  const exx = exitTile ? exitTile.x : Math.min(WORLD_SIZE - 2, player.x + 8);
  const exy = exitTile ? exitTile.y : player.y;
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dy = -1; dy <= 1; dy += 1) { const k = `${exx + dx},${exy + dy}`; if (state.terrain[k] === 'wall') delete state.terrain[k]; }
  }
  // The stair's OWN tile holds nothing whatever. Clearing only walls above was not enough: `place`
  // accepts any STANDABLE tile, and a door is standable — so the stair could be set down on a
  // doorway, and pruneUselessDoors would then judge that door, find it leads nowhere in particular,
  // and revert it to solid rock. With the stair under it. (Measured at ~1 floor in 1000, which is
  // exactly the rate a test that generates 120 floors a run had been flaking at.)
  //
  // fireDangerEvent already enforces this at runtime — "the exit and the key tile must NEVER hold
  // terrain" — so this is the same rule, finally applied where the floor is built.
  delete state.terrain[`${exx},${exy}`];
  if (state.key && !state.key.collected) delete state.terrain[`${state.key.x},${state.key.y}`];
  // NOT discovered. He used to start beside the stair, so knowing where it was cost nothing — now
  // that it is across the floor, having it painted through the fog would hand him the map. He must
  // FIND it, exactly as he must find the key: two things to locate, and a real choice which first.
  // (updateDiscovery flips this the moment he lays eyes on it, and it persists in fog thereafter.)
  state.exit = { x: exx, y: exy, discovered: false, portal: portalFloor, locked: Boolean(state.key) };
  // A gate that opens onto the DEMON REALM (floor 4's stair down, and every stair below it) or the
  // portal home gets a built precinct: a cleared court and standing pillars. An ordinary stair
  // between two mortal floors stays an ordinary stair — if every one of them had columns, none of
  // them would mean anything. Placed AFTER state.exit/state.key exist, so it can refuse to bury them.
  if (portalFloor || floor + 1 >= DEMON_FLOOR) {
    buildGatePrecinct(state, exx, exy);
    // DEMONS AT THE DOOR: a berolina or two dozing in the precinct. They are the point of the whole
    // gate — on floor 4 they are the first demons he ever lays eyes on, asleep at their post on the
    // wrong side of the threshold, and they tell him exactly what is waiting below before he takes
    // a single step down.
    //
    // ASLEEP, so the precinct is a warning rather than an ambush: he can see them, walk around them
    // and take the stair, or wake them (a blow, or coming within a tile) and fight for it. Either
    // way that is his choice to make, and he makes it knowing.
    const guards = 1 + randomInt(2);
    for (let i = 0; i < guards; i += 1) {
      const spot = place((x, y) => standable(x, y)
        && chebyshev(x, y, exx, exy) === 2       // in the court, never blocking the threshold itself
        && !(x === exx && y === exy)
        && !state.enemies.some((e) => e.x === x && e.y === y));
      if (!spot) break;
      const beast = addMobileEnemy('berolina', spot.x, spot.y, false);
      if (beast) beast.asleep = true;
    }
  } else if (Math.random() < 0.45) {
    // An ORDINARY stair: now and then, dress it in a small feature (a grove, a cairn, an ice nook, a
    // ring of pillars) so it reads as a place worth reaching, not just a hole in the floor. The mouth
    // faces the king; connectivity is guaranteed by the reachability pass below either way.
    buildStairFeature(state, exx, exy, player);
  }
  // The COLLAPSED upstair he arrived by: pure scenery, on his starting tile. It cannot be used —
  // there is no going back — but it marks where he came onto the floor, which is the one landmark
  // that never moves and now the only thing he starts out knowing.
  state.upstair = { x: player.x, y: player.y };
  state.message = portalFloor
    ? 'The final floor. Seize the Orb of Victory, then reach the portal to escape!'
    : 'A new floor. You start by the stair — find the floor key to unlock it.';

  const nearChamber = (x, y) => isStandable(terrainAt(state, x, y)) && chebyshev(x, y, ax, ay) >= 2 && chebyshev(x, y, ax, ay) <= 7 && chebyshev(x, y, player.x, player.y) >= 3 && !seen(x, y);
  // CLOSE PROTECTORS stand INSIDE the chamber alongside the guardian (the enlarged court has room).
  const insideChamber = (x, y) => isStandable(terrainAt(state, x, y)) && chebyshev(x, y, ax, ay) <= 2 && !(x === ax && y === ay);
  for (let i = 0; i < initCount(2 + Math.floor(floor / 2)); i += 1) {
    const spot = place(insideChamber);
    if (spot) addMobileEnemy(randomEnemyKind(floor), spot.x, spot.y, false);
  }
  // A thicker screen of guards posted just OUTSIDE the chamber walls.
  for (let i = 0; i < initCount(4 + Math.floor(floor / 2)); i += 1) {
    const spot = place(nearChamber);
    if (spot) addMobileEnemy(randomEnemyKind(floor), spot.x, spot.y, false);
  }
  // WHERE a turret / circle stands. These used to be laid ONLY in the chamber's ring, which
  // advertised the key: find the guns, find the door. They now scatter across the whole floor —
  // but WEIGHTED, so the key still feels guarded without the guards drawing a map to it. The court
  // is the densest ground by far: it is ~24 tiles against the open floor's several hundred, so
  // even a quarter of the roll lands far more per-tile there than anywhere else.
  const inCourt = (x, y) => isStandable(terrainAt(state, x, y)) && chebyshev(x, y, ax, ay) <= 2 && !(x === ax && y === ay);
  const anywhere = (x, y) => isStandable(terrainAt(state, x, y)) && chebyshev(x, y, player.x, player.y) >= 5 && !seen(x, y);
  // Roll a zone, then fall back OUTWARD through the others so a structure is never simply lost when
  // its first choice is full.
  const structureSpot = (extra) => {
    const r = randomInt(100);
    const zones = r < 25 ? [inCourt, nearChamber, anywhere] // 25% — inside the court itself
      : r < 55 ? [nearChamber, anywhere, inCourt] // 30% — its environs
        : [anywhere, nearChamber, inCourt]; // 45% — loose on the floor
    for (const zone of zones) {
      const spot = place((x, y) => zone(x, y) && extra(x, y));
      if (spot) return spot;
    }
    return null;
  };
  // Turrets (from floor 3) — placed ONLY where they cover real ground (never boxed into hitting
  // no/few tiles) and never plugging a hallway.
  if (floor >= 3) {
    for (let i = 0; i < initCount(5 + Math.floor(floor / 2)); i += 1) {
      const kind = randomTurretKind(floor); // a turret is a mortal gun — never a leaping demon
      const spot = structureSpot((x, y) => turretCoverage(state, kind, x, y) >= 4 && !turretBlocksHallway(state, x, y));
      if (spot) state.enemies.push(makeTurret(state, kind, spot.x, spot.y));
    }
  }
  // Summoning circles (from floor 2) — placed ONLY where the piece they conjure has
  // room to move. The shown piece type is the ONLY kind each conjures.
  if (floor >= 2) {
    for (let i = 0; i < initCount(3 + Math.floor(floor / 2)); i += 1) {
      const kind = randomStructureKind(floor); // a circle is a RUNE: it may bind a mortal piece even down here
      const spot = structureSpot((x, y) => circleCanSpawnMobile(state, kind, x, y));
      if (spot) {
        const c = createEnemy(kind, spot.x, spot.y);
        c.summonCircle = true;
        state.enemies.push(c);
      }
    }
  }

  // ROGUE MINI-BOSSES already lairing on the floor, from floor 3 down. Before this a lesser guardian
  // only ever appeared because a danger event conjured one, so a floor was rank-and-file until the
  // clock said otherwise. Seeding a few at generation gives the floor teeth to FIND.
  //
  // They are laid LAST, so the boss chamber, the stair and every set-piece already exist to aim at —
  // a rogue guardian belongs at something WORTH guarding (a unique room, the way down, the court by
  // the boss), not dropped on random floor. Each picks an anchor, tries to lair within a few tiles of
  // it, and only falls back to open ground if that anchor is crowded out.
  //
  // ASLEEP, like the gaol prisoners and the demons at the gate: finding one dozing at its post is a
  // decision (cut it down now, or slip past and leave it behind you), where one already prowling is
  // just an ambush you did not get to see coming.
  if (floor >= 3) {
    const miniCount = Math.min(3, 1 + Math.floor((floor - 3) / 2)); // 1 from floor 3, up to 3 by the finale
    // Places worth guarding, best first: the boss's court, the stair down, then each set-piece room.
    const lairs = [{ x: ax, y: ay }, { x: exx, y: exy }];
    for (const post of garrison) {
      if (post.kind === 'bones' || post.kind === 'torch') continue; // scenery, not a room worth holding
      lairs.push({ x: post.x, y: post.y });
    }
    // Shuffle ALL of them, boss court and stair included — so which landmarks are held varies floor to
    // floor. Always guarding the same two would make "walled court = rogue guardian" a rule you learn
    // once and never think about again.
    for (let i = lairs.length - 1; i > 0; i -= 1) {
      const j = randomInt(i + 1);
      [lairs[i], lairs[j]] = [lairs[j], lairs[i]];
    }
    for (let i = 0; i < miniCount; i += 1) {
      const kind = randomEnemyKind(floor);
      const fits = (x, y) => standable(x, y) && terrainAt(state, x, y) !== 'geyser'
        && chebyshev(x, y, player.x, player.y) >= 6 // never lairing on his doorstep
        && !keyTileAt(state, x, y) && !(state.exit && x === state.exit.x && y === state.exit.y)
        && kindCanMove(state, kind, x, y); // never seat one walled in where it cannot act
      let tile = null;
      for (const lair of lairs) { // near something worth guarding, if any such spot is free
        tile = place((x, y) => fits(x, y) && chebyshev(x, y, lair.x, lair.y) >= 2 && chebyshev(x, y, lair.x, lair.y) <= 4);
        if (tile) break;
      }
      if (!tile) tile = place((x, y) => fits(x, y) && !seen(x, y)); // nowhere interesting left — anywhere off-screen
      if (!tile) break;
      const mb = makeMiniBoss(state, kind, tile.x, tile.y);
      mb.asleep = true; // dozing at its post until he strikes it or blunders within a tile
      state.enemies.push(mb);
    }
  }

  pruneUselessDoors(state); // drop any door later structure stranded — BEFORE the carve re-links things

  // Guarantee the king can reach the stair: if walls/lava seal the doorway off, carve
  // to it — then make sure NO walkable pocket anywhere is fully walled off.
  const reachable = playerReachable(state, player.x, player.y);
  if (!reachable.has(`${doorX},${doorY}`)) {
    carveCorridor(state, player.x, player.y, doorX, doorY);
  }
  connectWalledPockets(state, player.x, player.y);

  // Final guard: the chamber ring and corridor-carving happen after the wanderers are scattered, so
  // one may have been sealed in by terrain. Any mobile piece with no move even in isolation is
  // re-cast as another kind from its OWN realm's roster, or dropped if it's truly walled solid —
  // never leave a frozen piece on the board. (Re-casting to a plain 'king' here, as this once did,
  // smuggled a MORTAL piece onto the demon floors, where only natives belong.)
  const nativeRoster = enemyRosterForFloor(floor);
  state.enemies = state.enemies.filter((e) => {
    if (e.boss || e.turret || e.summonCircle || e.caged) return true;
    const solo = { ...state, enemies: [e] };
    if (getPieceMoves(e, solo).length > 0) return true;
    for (const alt of nativeRoster) {
      e.kind = alt;
      if (getPieceMoves(e, solo).length > 0) return true;
    }
    return false;
  });

  // The king always lands on a quiet-looking floor — EVERY floor (the first included):
  // guarantee NO enemy sits in his line of sight on arrival, so he explores into danger
  // rather than starting beside it and tutorials never pop in a pile. (The far-off boss
  // on the stair is always out of view.) The corridor carving above can newly expose an
  // otherwise-hidden piece, so this is the final check — a spotted piece slips to the
  // nearest hidden tile, or is dropped if none exists.
  for (const e of state.enemies) {
    if (e.boss) continue;
    if (e.caged) continue; // a prisoner belongs in its cell — never drag it out to hide it from the king
    if (!seen(e.x, e.y)) continue;
    const canGo = (x, y) =>
      isStandable(terrainAt(state, x, y)) &&
      !seen(x, y) &&
      chebyshev(x, y, player.x, player.y) >= 2 &&
      (e.turret || e.summonCircle || kindCanMove(state, e.kind, x, y));
    const hidden = e.turret
      ? findFreeTile(occupied, (x, y) => canGo(x, y) && turretCoverage(state, e.kind, x, y) >= 4 && !turretBlocksHallway(state, x, y))
        || findFreeTile(occupied, (x, y) => canGo(x, y) && !turretBlocksHallway(state, x, y))
      : findFreeTile(occupied, canGo);
    if (hidden) {
      occupied.delete(`${e.x},${e.y}`);
      e.x = hidden.x;
      e.y = hidden.y;
      occupied.add(hidden.key);
    } else {
      e.hideFailed = true; // nowhere out of sight to hide it — drop it entirely
    }
  }
  state.enemies = state.enemies.filter((e) => !e.hideFailed);

  // (The old Premonition full-floor reveal is gone — it's now a foe-radar; see seeAllFoes.)

  // The Necromancer's familiar rejoins him on each fresh floor (undead do not follow down).
  if (player.familiar) spawnFamiliar(state);

  scatterGeysers(state, floor, occupied); // demon-realm vents (floors 6+), laid LAST so nothing sits on one
  scatterTorches(state, floor); // bracket wall-torches, thicker the deeper he goes
  updateDiscovery(state);
  return state;
}

// GEYSERS are a DEMON-REALM hazard: the deeper floors of each cycle (6, 7, 8 — the Hedge Maze, the
// Lake of Fire, the Demon Castle) are riddled with vents that blow scalding gas on a shared 3-turn
// clock (tickGeysers / geyserErupting). Scattered singly on OPEN ground, laid last of all so no unit,
// structure, key, stair or upstair ever sits on one — the user's rule: never spawn a foe/circle/boss
// on a vent. Placed on plain floor only; a vent over water or lava would make no sense.
function isDemonRealmFloor(floor) {
  return (((floor - 1) % FINAL_FLOOR) + 1) >= 6;
}
function scatterGeysers(state, floor, occupied) {
  if (!isDemonRealmFloor(floor)) return;
  const taken = new Set(occupied || []);
  for (const e of state.enemies) taken.add(`${e.x},${e.y}`);
  for (const a of (state.allies || [])) taken.add(`${a.x},${a.y}`);
  taken.add(`${state.player.x},${state.player.y}`);
  if (state.key) taken.add(`${state.key.x},${state.key.y}`);
  if (state.exit) taken.add(`${state.exit.x},${state.exit.y}`);
  if (state.upstair) taken.add(`${state.upstair.x},${state.upstair.y}`);
  const want = Math.round((5 + randomInt(4)) * (WORLD_SIZE / 20)); // 5-8, scaled to the board
  let placed = 0;
  for (let attempt = 0; attempt < 400 && placed < want; attempt += 1) {
    const x = 2 + randomInt(WORLD_SIZE - 4);
    const y = 2 + randomInt(WORLD_SIZE - 4);
    const key = `${x},${y}`;
    if (taken.has(key)) continue;
    if (chebyshev(x, y, state.player.x, state.player.y) < 2) continue; // never on the king's doorstep
    if (terrainAt(state, x, y) !== 'normal') continue; // open ground only — not water/lava/wall/tree
    state.terrain[key] = 'geyser';
    taken.add(key);
    placed += 1;
  }
}

// Wall-torch density climbs with depth: a rare flicker on the first floors, a hall of fire by the
// finale (floor 8 ≈ half the interior walls lit). A torch sears any non-lava-immune creature that
// PHASES into that wall, just like lava.
function torchChance(floor) {
  return Math.min(0.55, 0.08 + 0.06 * ((floor || 1) - 1));
}
// Sprinkle torches onto INTERIOR walls (never the stone border) at the floor's density.
function scatterTorches(state, floor) {
  state.torches = state.torches || {};
  const chance = torchChance(floor);
  for (const key in state.terrain) {
    if (state.terrain[key] !== 'wall') continue;
    const [x, y] = key.split(',').map(Number);
    if (x <= 0 || y <= 0 || x >= WORLD_SIZE - 1 || y >= WORLD_SIZE - 1) continue; // skip the rampart
    if (Math.random() < chance) state.torches[key] = true;
  }
}

// Difficulty (chosen after the class) is now ONE simple dial: starting HP. Nothing else changes —
// the dread clock, spawns and foes are identical at every setting, so a Nightmare run is the same
// dungeon met with a thinner skin. See DIFFICULTY_HP for the per-class table.
function startingHpFor(classKey, difficulty) {
  const table = DIFFICULTY_HP[difficulty] || DIFFICULTY_HP.hard;
  return table[classKey] || table.warrior;
}
function createInitialState(classKey, difficulty) {
  const cls = classKey || 'warrior';
  const player = createPlayer(cls);
  player.difficulty = DIFFICULTY_HP[difficulty] ? difficulty : 'hard';
  player.maxHp = startingHpFor(cls, player.difficulty);
  player.hp = player.maxHp;
  return generateFloor(1, player, 0);
}
// How many turns until the dread meter maxes (danger events reach their fastest cadence). The same
// at every difficulty now — only starting HP differs.
function dreadTurnsFor() {
  return MAX_TURNS_SCARY;
}

// The floor's DREAD, 0..1 — the ONE source of truth for how far it has turned against the king
// (danger cadence, wave size, music tempo). Returns a flat 0 through the opening GRACE steps, then
// climbs to 1 across the ramp steps. Scaled off `horizon` rather than the raw constants so a floor
// carrying its own dreadTurns still gets a proportional grace.
function dreadFraction(turn, horizon) {
  const total = horizon || MAX_TURNS_SCARY;
  const grace = total * (DREAD_GRACE_STEPS / DREAD_TOTAL_STEPS);
  const climb = total * (DREAD_RAMP_STEPS / DREAD_TOTAL_STEPS);
  if (climb <= 0) return 0;
  return Math.max(0, Math.min(1, (turn - grace) / climb));
}
// Is the floor still in its opening grace — the stretch where nothing is allowed to stir yet?
function inDreadGrace(turn, horizon) {
  return turn < (horizon || MAX_TURNS_SCARY) * (DREAD_GRACE_STEPS / DREAD_TOTAL_STEPS);
}
// The OVERSTAY, 0..1 — how deep PAST max dread the king has lingered. Zero until MAX_TURNS_SCARY (the
// 8th tick, where dread itself maxes), then climbs to 1 over the five overstay steps (to MAX_TURNS_LAVA,
// tick 13). It drives the two things that make lingering fatal: the encroaching lava's intensity and
// the now-unbounded spawn cap.
function overstayFraction(turn) {
  const span = MAX_TURNS_LAVA - MAX_TURNS_SCARY;
  if (span <= 0) return 0;
  return Math.max(0, Math.min(1, ((turn || 0) - MAX_TURNS_SCARY) / span));
}

// Descending the stair: fully heal and refresh cards, then build the next floor. The
// level-up boon is NOT granted here — it is earned earlier, by slaying the floor's
// boss (see defeatBoss). Slipping past a boss and descending thus yields nothing.
function nextFloor(state) {
  const healed = { ...state.player, hp: state.player.maxHp };
  healed.cards = (healed.cards || []).map((c) => ({ ...c, remaining: 0 }));
  healed.extraLifeUsed = false;
  // Transformations END at the stair — the king walks onto the floor below as a MAN, never mid-form.
  // (Animal Form's rallied horses were this floor's; the new floor spawns its own, so nothing to undo.)
  healed.promotion = 0;
  healed.invuln = false;
  healed.silence = 0;
  // Badge ledger: he just took a WHOLE floor start-to-stair. Bank it if he did it unbloodied, then
  // wipe the slate for the floor below. maxFloorTurns is banked in passTurn as the floor runs.
  if (!healed.hitThisFloor) healed.clearedFloorUnhit = true;
  healed.hitThisFloor = false;
  healed.maxFloorTurns = Math.max(healed.maxFloorTurns || 0, state.turn);
  // He walked off this floor on his last heart. Banked HERE — before the descent heals him — which
  // is the only moment the fact exists.
  if (state.player.hp === 1) healed.finishedFloorOnOneHeart = true;
  // Bank the floor's tallies and wipe the slate for the one below.
  healed.maxKillsOnFloor = Math.max(healed.maxKillsOnFloor || 0, healed.killsThisFloor || 0);
  healed.maxMinisOnFloor = Math.max(healed.maxMinisOnFloor || 0, healed.minisThisFloor || 0);
  healed.maxTurretsOnFloor = Math.max(healed.maxTurretsOnFloor || 0, healed.turretsThisFloor || 0);
  healed.killsThisFloor = 0;
  healed.minisThisFloor = 0;
  healed.turretsThisFloor = 0;
  const next = generateFloor(state.floor + 1, healed, state.score);
  next.pendingLevelUp = false;
  next.message = 'You descend the stair to the next floor.';
  return next;
}

/* ---------------------------------- turn ---------------------------------- */

// Spatter a hit tile with blood, PLUS a few satellite droplets flung to adjacent tiles.
// The satellites lean toward `momX,momY` (the way the blow carried — e.g. hit from the
// left, blood sprays right), but not every time, for a natural scatter. Satellites may
// land on walls, where they render as downward smears.
function addSpatter(state, x, y, momX, momY, ichor) {
  if (!Array.isArray(state.spatters)) state.spatters = [];
  // `ichor`: a DEMON bleeds dark green, not red. Pass isDemonKind(bleeder.kind) wherever the
  // bleeder is known; the king and mortal pieces leave the default red.
  state.spatters.push({ x, y, life: SPATTER_LIFE, max: SPATTER_LIFE, seed: randomInt(1000), ichor: Boolean(ichor) });
  const extras = 1 + randomInt(2); // 1-2 satellite spatters
  const dirs = [...ORTHO, ...DIAG];
  const hasMomentum = Boolean(momX || momY);
  for (let i = 0; i < extras; i += 1) {
    let dir;
    if (hasMomentum && Math.random() < 0.7) {
      // Bias into the hemisphere the blow carried toward (positive dot product).
      const arc = dirs.filter(([dx, dy]) => dx * momX + dy * momY > 0);
      dir = arc.length ? arc[randomInt(arc.length)] : dirs[randomInt(dirs.length)];
    } else {
      dir = dirs[randomInt(dirs.length)];
    }
    const nx = x + dir[0];
    const ny = y + dir[1];
    if (nx < 0 || nx >= WORLD_SIZE || ny < 0 || ny >= WORLD_SIZE) continue;
    state.spatters.push({ x: nx, y: ny, life: SPATTER_LIFE, max: SPATTER_LIFE, seed: randomInt(1000), satellite: true, ichor: Boolean(ichor) });
  }
}
function decaySpatters(spatters) {
  if (!Array.isArray(spatters)) return [];
  return spatters.map((s) => ({ ...s, life: s.life - 1 })).filter((s) => s.life > 0);
}
// Splash blood ONTO a piece (0..1), so combat leaves it visibly stained. It dries off
// over a few turns (see passTurn). Being struck stains more than landing a blow.
// HP-bearing pieces (the king, bosses, turrets) are EXEMPT — their gore is drawn from
// how wounded they are (missing HP), not a fading stain, so it recedes when they heal.
function bloody(unit, amount) {
  if (!unit || unit.maxHp) return;
  unit.blood = Math.min(1, (unit.blood || 0) + amount);
}
// A random in-tile jitter (offset + slant) so stacked remains form a natural-looking pile
// rather than a single overlaid stamp. Offsets are kept small so a body stays on its tile.
function remainsJitter() {
  return {
    ox: (Math.random() * 2 - 1) * 0.2,
    oy: (Math.random() * 2 - 1) * 0.2,
    rot: (Math.random() * 2 - 1) * 0.6,
  };
}
// A corpse: the slain piece's flattened, darkening remains — purely cosmetic, fades faster
// than blood. (An enemy raised as a Necromancer ally leaves no body.) `life` overrides the
// default lifespan (a boss's remains linger far longer).
function addCorpse(state, x, y, kind, life) {
  if (!Array.isArray(state.corpses)) state.corpses = [];
  const span = life || CORPSE_LIFE;
  // `blood` (0..1) drives the gore spattered on the body when it's drawn.
  state.corpses.push({ x, y, kind, life: span, max: span, blood: 0.5 + Math.random() * 0.4, ...remainsJitter() });
}
// An ash pile: what a foe felled by a SPELL leaves instead of a corpse. It decays at the
// same rate as a corpse and carries no piece identity (all ash looks alike).
function addAsh(state, x, y) {
  if (!Array.isArray(state.ashes)) state.ashes = [];
  state.ashes.push({ x, y, life: CORPSE_LIFE, max: CORPSE_LIFE, ...remainsJitter() });
}
// Rubble: the scattered rocks a crushed / blasted boulder (or a collapsed wall) leaves behind.
// Each pile gets a random `seed` (the view draws a unique, rotated scatter from it) and flings a
// couple of stray chunks onto neighbouring tiles — so debris spreads and piles OVERLAP, the same
// way blood spatter throws satellites (see addSpatter).
function addRubble(state, x, y) {
  cue(state, 'crush'); // rock breaking up — every rubble pile is something that just gave way
  if (!Array.isArray(state.rubble)) state.rubble = [];
  state.rubble.push({ x, y, life: CORPSE_LIFE, max: CORPSE_LIFE, seed: randomInt(1000) });
  const extras = 1 + randomInt(2); // 1-2 satellite chunks flung to adjacent tiles
  const dirs = [...ORTHO, ...DIAG];
  for (let i = 0; i < extras; i += 1) {
    const [dx, dy] = dirs[randomInt(dirs.length)];
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || nx >= WORLD_SIZE || ny < 0 || ny >= WORLD_SIZE) continue;
    state.rubble.push({ x: nx, y: ny, life: CORPSE_LIFE, max: CORPSE_LIFE, seed: randomInt(1000), satellite: true });
  }
}
// Scrap: the twisted rusty wreckage a DESTROYED turret leaves — a distinct (metallic) remains,
// coloured apart from grey wall/boulder rubble.
// A felled tree leaves sticks and leaves — the same fading-debris idea as a broken wall's rubble
// or a wrecked turret's scrap, with its own look.
function addSticks(state, x, y, iron) {
  if (!Array.isArray(state.sticks)) state.sticks = [];
  // `iron` marks the wreck of a GATE rather than a tree: twisted bar-ends and rivets, not branches
  // and leaves. It was leaving a drift of green leaves behind a felled iron gate.
  state.sticks.push({ x, y, life: CORPSE_LIFE, max: CORPSE_LIFE, seed: randomInt(1000), iron: Boolean(iron) });
}
// What a felled TREE or GATE leaves behind. Read the terrain BEFORE it is cleared: by the time the
// debris is laid the tile is already bare, so the caller has to say which it was.
function addTreeDebris(state, x, y, iron) {
  addSticks(state, x, y, iron);
}

function addScrap(state, x, y) {
  if (!Array.isArray(state.scrap)) state.scrap = [];
  state.scrap.push({ x, y, life: CORPSE_LIFE, max: CORPSE_LIFE, ...remainsJitter() });
}

// One turn's upkeep: age counters, recharge cards, fade blood, and lapse wards.
function passTurn(state) {
  // KILL STREAK: turns in an unbroken row on each of which he felled at least one foe. Read the tally
  // from the action just resolved BEFORE it is wiped below; a turn with no kill breaks the streak.
  if ((state.player.killsThisTurn || 0) > 0) {
    state.player.killStreak = (state.player.killStreak || 0) + 1;
    state.player.bestKillStreak = Math.max(state.player.bestKillStreak || 0, state.player.killStreak);
  } else {
    state.player.killStreak = 0;
  }
  state.player.killsThisTurn = 0; // badge ledger: a fresh turn, a fresh tally (maxKillsInTurn is banked as they land)
  const p = state.player;
  // What he is standing on, sounded ONCE on arrival — a turn he did not move must not re-splash,
  // or wading a pond becomes a metronome.
  if (p.x !== p.lastTileX || p.y !== p.lastTileY) cueStandingOn(state);
  p.lastTileX = p.x;
  p.lastTileY = p.y;
  state.turn += 1;
  // NB: the steam does NOT thin here. It used to, and that cost every bank a turn of life before
  // anyone could walk into it: steam laid on turn N was already down one by the time he could step in
  // on turn N+1, and a geyser's 1-turn vent expired during his move — so walking into a gout of steam
  // could never burn you, only standing in one when it went off. It now thins at the END of the enemy
  // phase, straight after tickFogDamage, so a bank scalds for exactly as many turns as it claims.
  state.geyserPhase = (state.geyserPhase || 0) + 1; // the shared geyser clock (every third turn they blow)
  p.totalTurns = (p.totalTurns || 0) + 1;
  const calmHaste = Boolean(p.spellHaste) && getVisibleEnemies(state).length === 0;
  for (const card of p.cards || []) {
    // A card fired THIS turn doesn't tick down now (so the bar shows its full cooldown);
    // it starts counting down next turn.
    if (card.remaining > 0 && !card.justFired) {
      const tick = calmHaste && classCategory(p.className) === 'spell' ? 2 : 1;
      card.remaining = Math.max(0, card.remaining - tick);
    }
    card.justFired = false;
  }
  state.spatters = decaySpatters(state.spatters);
  if (Array.isArray(state.corpses)) state.corpses = state.corpses.map((c) => ({ ...c, life: c.life - 1 })).filter((c) => c.life > 0);
  if (Array.isArray(state.ashes)) state.ashes = state.ashes.map((a) => ({ ...a, life: a.life - 1 })).filter((a) => a.life > 0);
  if (Array.isArray(state.rubble)) state.rubble = state.rubble.map((r) => ({ ...r, life: r.life - 1 })).filter((r) => r.life > 0);
  if (Array.isArray(state.scorches)) state.scorches = state.scorches.map((sc) => ({ ...sc, life: sc.life - 1 })).filter((sc) => sc.life > 0);
  if (Array.isArray(state.scrap)) state.scrap = state.scrap.map((s) => ({ ...s, life: s.life - 1 })).filter((s) => s.life > 0);
  if (Array.isArray(state.iceShards)) state.iceShards = state.iceShards.map((s) => ({ ...s, life: s.life - 1 })).filter((s) => s.life > 0);
  // Blood on pieces dries off over a few turns.
  const dryBlood = (u) => {
    if (u && u.blood) {
      u.blood *= BLOOD_DRY;
      if (u.blood < 0.06) u.blood = 0;
    }
  };
  dryBlood(p);
  for (const e of state.enemies || []) dryBlood(e);
  for (const a of state.allies || []) dryBlood(a);
  // Hex (Sorcerer): each turn, one adjacent foe is warped into a confused (startled) FERZ (a
  // weak 1-step diagonal mover). Ferzes, bosses and structures are immune — but pawns are NOT.
  if (p.hexDemote) {
    for (const [dx, dy] of [...ORTHO, ...DIAG]) {
      const e = state.enemies.find((en) => en.x === p.x + dx && en.y === p.y + dy);
      if (e && !e.boss && !e.turret && !e.summonCircle && e.kind !== 'ferz') {
        e.kind = 'ferz';
        // STARTLED, not confused. Confusion was tried here and it quietly gutted the perk: a
        // confused piece ACTS at once (the phase makes it a mover before any surprise is reckoned),
        // and half of what it does is swing at whatever is nearest — which is him, since the hex
        // only ever reaches something already adjacent. Measured: the new ferz hit him 48% of the
        // time on the turn it was made, and never once gasped. The bot had a ferz as the Hexer's
        // single biggest killer, ahead of bosses.
        //
        // Startled, it loses that turn — which is the whole point of unmaking a foe beside you.
        startle(e);
        break;
      }
    }
  }
  if (p.promotion > 0) { p.promotion -= 1; if (p.promotion === 0) unrallyHorses(state); } // form ends -> the herd scatters back to the wild
  // SILENCE holds for its full run of turns now — striking a foe no longer snuffs the WHOLE hush.
  // Instead only the foe he HITS wakes (damageBoss wakes a struck guardian; a lesser foe just dies),
  // and the rest of the room sleeps on, so he can pick a hushed room apart one piece at a time. That
  // is the utility the card was missing; the timer is its only cost.
  if (p.silence > 0) {
    p.silence = p.silence - 1;
    if (p.silence <= 0) {
      p.silence = 0;
      // Wake only what the hush itself put down. It used to wake EVERY sleeping thing on the floor,
      // which would have hauled a naturally-slumbering piece out of a sleep the spell never gave it.
      for (const e of state.enemies) {
        if (e.hushed) { e.asleep = false; e.hushed = false; }
      }
    }
  }
  // Lava sears the king for 1 HP each turn he ends on it. NOTHING negates it now — not Pathfinder
  // (no lava pass), not Waiting (the ground is not a blow). He CAN cross lava; it just costs blood.
  if (terrainAt(state, p.x, p.y) === 'lava') {
    p.hp -= 1;
    p.wasHit = true; p.hitThisFloor = true;
    addSpatter(state, p.x, p.y);
    addSmoke(state, p.x, p.y);
    hurtBy(state, 'lava');
    p.burnedByFire = true; // badge ledger: fire has touched him
    if (state.message) state.message += ' The lava sears the king!';
    else state.message = 'The lava sears the king!';
    checkDeath(state);
  }
  // A tree ABLAZE around him sears exactly as a wall-torch does: same fire, same price. A PATHFINDER
  // can walk through a trunk now, so this is his risk to run — timber is his road, but a BURNING road
  // still burns (Pathfinder is no lava/fire pass).
  if (state.burningTrees && state.burningTrees[`${p.x},${p.y}`]) {
    p.hp -= 1;
    p.wasHit = true; p.hitThisFloor = true;
    addSpatter(state, p.x, p.y);
    addSmoke(state, p.x, p.y);
    hurtBy(state, 'burningtree');
    p.burnedByFire = true; // badge ledger: fire has touched him
    if (state.message) state.message += ' The burning tree sears the king!';
    else state.message = 'The burning tree sears the king!';
    checkDeath(state);
  }
  // A wall-torch sears the phasing king for 1 HP each turn he ends EMBEDDED in it — the same price
  // lava exacts. Only the Phase perk can put him inside a wall at all.
  if (hasTorch(state, p.x, p.y)) {
    p.hp -= 1;
    p.wasHit = true; p.hitThisFloor = true;
    addSpatter(state, p.x, p.y);
    addSmoke(state, p.x, p.y);
    hurtBy(state, 'torch');
    p.burnedByFire = true; // badge ledger: fire has touched him
    if (state.message) state.message += ' The wall-torch sears the king!';
    else state.message = 'The wall-torch sears the king!';
    checkDeath(state);
  }
  p.warded = false;
  p.blinkedThisTurn = false;
  // PARRY: end a turn without striking and the guard goes UP, to be spent on the next blow that
  // would land (rollMitigation). Striking never lowers a guard already raised — it just doesn't
  // raise one. `p.attacked` is this turn's, and deliberately survives into the enemy phase.
  if (p.firstHitEachTurn && !p.attacked) p.guardUp = true;
  // Badge ledger: the longest he has ever lingered on ONE floor, and whether he ever waded.
  p.maxFloorTurns = Math.max(p.maxFloorTurns || 0, state.turn);
  if (terrainAt(state, p.x, p.y) === 'water') p.touchedWater = true;
  tickDoors(state); // vacated doors drift shut: open → ajar → shut, one step per turn
  // NB: p.attacked is NOT cleared here — it must survive into the enemy phase so a foe
  // can tell the Silent king struck this turn (it is reset at the start of each action).
}

function revealSeen(state) {
  if (!state.explored) state.explored = {};
  const p = state.player;
  if (!Array.isArray(p.seenTerrain)) p.seenTerrain = [];
  for (const key of computeVisibleTiles(state)) {
    state.explored[key] = true;
    // Remember which hazard terrains the king has laid eyes on — danger events only unleash
    // a hazard he has already met (see fireDangerEvent), tying them to normal progression.
    const [x, y] = key.split(',').map(Number);
    const t = terrainAt(state, x, y);
    if (t !== 'normal' && t !== 'wall' && !p.seenTerrain.includes(t)) p.seenTerrain.push(t);
  }
}

// Reveal newly-seen ground and remember the exit once explored.
// A SHUT ('door') or half-closing ('doorajar') door any creature now stands on swings fully OPEN
// ('dooropen') — you push through it the way you'd walk into a wall if walls let you. While open it
// no longer blocks sight or fire. (Doors are always walkable; only their SIGHT-blocking flips.)
function openDoorsUnderUnits(state) {
  const open = (x, y) => {
    const t = terrainAt(state, x, y);
    if (t === 'door' || t === 'doorajar') state.terrain[`${x},${y}`] = 'dooropen';
    return t === 'door'; // it was SHUT and we just pushed it open
  };
  if (state.player && open(state.player.x, state.player.y)) { state.player.openedDoor = true; cue(state, 'creak'); } // badge ledger
  for (const e of state.enemies || []) open(e.x, e.y);
  for (const a of state.allies || []) open(a.x, a.y);
}

// Once per turn, an UNoccupied door drifts back shut over two turns: fully open → ajar (starting to
// close) → shut. Any creature standing on it holds it fully open (and the ajar/shut steps reset).
function tickDoors(state) {
  const occupied = (x, y) => (state.player && state.player.x === x && state.player.y === y)
    || (state.enemies || []).some((e) => e.x === x && e.y === y)
    || (state.allies || []).some((a) => a.x === x && a.y === y);
  for (const key in state.terrain) {
    const t = state.terrain[key];
    if (t !== 'dooropen' && t !== 'doorajar') continue;
    const [x, y] = key.split(',').map(Number);
    if (occupied(x, y)) { state.terrain[key] = 'dooropen'; continue; } // held open while someone's in it
    state.terrain[key] = t === 'dooropen' ? 'doorajar' : 'door'; // open → ajar this turn → shut next
  }
}

function updateDiscovery(state) {
  openDoorsUnderUnits(state); // a unit standing on a shut door has pushed it open
  revealSeen(state);
  // REVELATION (Oracle capstone): the floor keeps no secrets. The fog is gone the moment he arrives
  // and he knows where the key and the stair lie.
  //
  // Note what it does NOT give him: SIGHT. He still only sees — and shoots — what is inside his own
  // window, and foes stay hidden in the dark exactly as before. This is a MAP, not x-ray: it answers
  // "where am I going", which is the one question the fog made into busywork rather than a decision.
  if (state.player.revealFloor) {
    for (let x = 0; x < WORLD_SIZE; x += 1) {
      for (let y = 0; y < WORLD_SIZE; y += 1) state.explored[`${x},${y}`] = true;
    }
  }
  if (state.exit && state.explored[`${state.exit.x},${state.exit.y}`]) state.exit.discovered = true;
  // Once the king lays eyes on the key it is remembered through the fog (like the stair).
  if (state.key && state.explored[`${state.key.x},${state.key.y}`]) state.key.discovered = true;
}

/* ----------------------------- player movement ---------------------------- */

// Every tile the king may move to.
function getPlayerMoves(state) {
  const p = state.player;
  // The king stops on a foe (capture) OR an ally (a swap) — both are valid destinations.
  const enemyAt = (x, y) => state.enemies.find((e) => e.x === x && e.y === y) || allyAt(state, x, y) || null;
  const isEnemy = (x, y) => capturableAt(state, x, y) || Boolean(allyAt(state, x, y));
  const moves = [];
  const seen = new Set();
  const add = (tile) => {
    const key = `${tile.x},${tile.y}`;
    if (seen.has(key)) return;
    seen.add(key);
    // NB: this rebuilds the move rather than passing it through, so EVERY flag a caller sets must
    // be listed here or it is silently dropped — which is exactly what happened to `chop`: the tile
    // was offered as a plain move and the king walked into the tree.
    moves.push({ x: tile.x, y: tile.y, viaJump: Boolean(tile.viaJump), capture: Boolean(tile.capture), push: Boolean(tile.push), chop: Boolean(tile.chop), embedded: Boolean(tile.embedded), pitDive: Boolean(tile.pitDive) });
  };
  if (p.promotion > 0) {
    // Animal Form (Druid): the king becomes a swift UNICORN — it glides like a bishop AND rides like a
    // nightrider for a few turns, taking no damage and playing no cards.
    //
    // Its reach is CAPPED to his AWARENESS window — how far he can naturally, two-way see. The beast's
    // raw bishop glide is unbounded, which let it cross half the board in a step; worse, it let him
    // move INTO the one-way Oracle band (Hawk Eyes' extended sight), so sight perks were quietly
    // buying movement. Awareness is the right cap because it EXCLUDES `visionOneWay`: the Ranger's own
    // Sharpened Senses (two-way) does widen the beast's range, while Oracle's one-way band never does.
    // He can never step onto ground he could not have reached without those perks.
    const opts = { pathfinder: Boolean(p.pathfinder), phaseWalls: Boolean(p.phase) };
    const reach = getAwarenessBounds(state);
    for (const t of generateMoves('unicorn', state, p.x, p.y, enemyAt, isEnemy, opts)) {
      if (isWithinBounds(reach, t.x, t.y)) add(t);
    }
    return moves;
  }
  const opts = { pathfinder: Boolean(p.pathfinder), phaseWalls: Boolean(p.phase) };
  for (const [dx, dy] of [...ORTHO, ...DIAG]) {
    const stops = slideStops(state, p.x, p.y, dx, dy, p.moveRange, enemyAt, isEnemy, opts);
    // The king must COMMIT to the full slide (his moveRange) — he can only stop short
    // where he collides (a wall, edge, or a foe he captures). So only the furthest
    // reachable tile in each direction is a legal destination, never an inner one.
    if (stops.length) add(stops[stops.length - 1]);
    // Boulder shove: ANY adjacent boulder is a valid "push" action. If its far side is
    // clear it rolls forward (and the king takes its tile); if something blocks it, the
    // king shoves in vain and merely wastes the turn (see resolveBoulderPush).
    const bx = p.x + dx;
    const by = p.y + dy;
    if (terrainAt(state, bx, by) === 'boulder') add({ x: bx, y: by, push: true });
    // CHOP: an adjacent TREE is a valid action too. A tree is not standable, so it would otherwise
    // never appear as a move at all — the king would simply have no way to cut one down by hand.
    // He hacks at it for a wound and stays put; it takes TREE_HP swings to bring one down.
    if (isChoppable(terrainAt(state, bx, by))) add({ x: bx, y: by, chop: true });
  }
  // PIT DIVE — a last resort offered ONLY when he is otherwise STRANDED (not one other move on the
  // board): he scrambles down into an adjacent pit and hauls himself out the nearest side for a
  // wound, rather than being stalemated on the spot. A Pathfinder king already treads pits freely.
  if (!moves.length && !p.pathfinder) {
    for (const [dx, dy] of [...ORTHO, ...DIAG]) {
      if (terrainAt(state, p.x + dx, p.y + dy) === 'pit') add({ x: p.x + dx, y: p.y + dy, pitDive: true });
    }
  }
  return moves;
}

/* -------------------------------- boulders -------------------------------- */

// The floor's DOWNSTAIR — a boulder must never be shoved onto it (it would bury the way out, and a
// boulder can't be pushed off an exit tile cleanly). The uncollected key is guarded the same way.
function boulderBlockedTile(state, x, y) {
  if (keyTileAt(state, x, y)) return true; // never bury the floor key
  if (state.exit && x === state.exit.x && y === state.exit.y) return true; // never bury the downstair
  return false;
}
// Can the king shove the boulder at (bx,by) one step in (dx,dy)? The tile beyond must be
// on-board, not a wall/boulder, hold no unit, and not the floor key or the downstair.
function canPushBoulder(state, bx, by, dx, dy) {
  const tx = bx + dx;
  const ty = by + dy;
  if (tx < 0 || tx >= WORLD_SIZE || ty < 0 || ty >= WORLD_SIZE) return false;
  const t = terrainAt(state, tx, ty);
  if (t === 'wall' || t === 'boulder' || t === 'ice') return false; // an ice slab stops a shove like a wall
  if (tx === state.player.x && ty === state.player.y) return false;
  if (state.enemies.some((e) => e.x === tx && e.y === ty) || allyAt(state, tx, ty)) return false;
  if (boulderBlockedTile(state, tx, ty)) return false; // never bury the key or the downstair
  return true;
}
// Shove the boulder at (bx,by) one step. Driven into a PIT / LAVA / WATER it FILLS the
// hazard (both tiles become open floor); onto open ground it simply rolls one tile. The
// king follows into the vacated tile.
function pushBoulder(state, bx, by, dx, dy) {
  state.player.pushedBoulder = true; // badge ledger: the king put his shoulder to a rock
  const tx = bx + dx;
  const ty = by + dy;
  const t = terrainAt(state, tx, ty);
  delete state.terrain[`${bx},${by}`]; // the boulder leaves its tile
  if (t === 'pit' || t === 'lava' || t === 'water') {
    cueHazardFill(state, t, tx, ty);
    delete state.terrain[`${tx},${ty}`]; // hazard filled, boulder consumed
  } else {
    state.terrain[`${tx},${ty}`] = 'boulder';
  }
  state.player.x = bx;
  state.player.y = by;
}
// Shove a boulder up to `dist` tiles in (dx,dy) — a running charge (Double Step) rolls it two
// tiles where a plain move heaves it one. It travels until a wall / boulder / unit / edge / the
// floor key halts it (coming to rest on the last clear tile), or drops into a pit / lava / water
// and FILLS that hazard (consumed). The king always follows one tile, into the boulder's old
// square. Returns true if the boulder actually moved.
function pushBoulderFar(state, bx, by, dx, dy, dist) {
  state.player.pushedBoulder = true; // badge ledger
  let cx = bx;
  let cy = by;
  let moved = false;
  for (let i = 0; i < dist; i += 1) {
    const nx = cx + dx;
    const ny = cy + dy;
    if (nx < 0 || nx >= WORLD_SIZE || ny < 0 || ny >= WORLD_SIZE) break;
    const t = terrainAt(state, nx, ny);
    if (t === 'wall' || t === 'boulder' || t === 'ice') break;
    if (nx === state.player.x && ny === state.player.y) break;
    if (state.enemies.some((e) => e.x === nx && e.y === ny) || allyAt(state, nx, ny)) break;
    if (boulderBlockedTile(state, nx, ny)) break; // never bury the key or the downstair
    if (t === 'pit' || t === 'lava' || t === 'water') {
      cueHazardFill(state, t, nx, ny);
      delete state.terrain[`${bx},${by}`];
      delete state.terrain[`${nx},${ny}`]; // hazard filled, boulder consumed
      state.player.x = bx;
      state.player.y = by;
      return true;
    }
    cx = nx;
    cy = ny;
    moved = true;
  }
  if (moved) {
    delete state.terrain[`${bx},${by}`];
    state.terrain[`${cx},${cy}`] = 'boulder';
    state.player.x = bx;
    state.player.y = by;
  }
  return moved;
}
// ---- TREES ---------------------------------------------------------------------------------
// A tree is solid timber: it blocks movement AND sight exactly like a wall (see terrain.js), but
// unlike a wall it can be brought DOWN. It carries TREE_HP wounds, tracked in `state.treeHp` —
// terrain is a flat type map with nowhere to hang a number, so the pool lives beside it, keyed by
// tile, and is cleared whenever the tile stops being a tree.
//
// Chop it and it falls, leaving sticks and leaves (the same fading-debris idea as a broken wall or
// turret). Set it ALIGHT with spellfire and it does not fall at once: it burns where it stands for
// a turn (blocking sight the whole time), then is gone, leaving a scorch.
// A GATE is a tree made of iron: same 3 wounds, same chopping, same debris — it simply does not
// block the look. Everything below treats the two as one thing so they can never drift apart.
function isChoppable(t) {
  return t === 'tree' || t === 'gate';
}
function treeHpAt(state, x, y) {
  if (!isChoppable(terrainAt(state, x, y))) return 0;
  const k = `${x},${y}`;
  if (!state.treeHp) state.treeHp = {};
  if (state.treeHp[k] == null) state.treeHp[k] = TREE_HP; // a tree generated without a pool starts whole
  return state.treeHp[k];
}
function clearTree(state, x, y) {
  delete state.terrain[`${x},${y}`];
  if (state.treeHp) delete state.treeHp[`${x},${y}`];
  if (state.burningTrees) delete state.burningTrees[`${x},${y}`];
}
// Chop a tree for `amount` wounds. Returns 'felled' | 'hurt' | null (there was no tree).
// This is the ONE way a tree takes damage — every source routes through it (a normal attack, a
// spell bolt, a rolled boulder, a foe slammed into it), so they can never disagree.
function damageTree(state, x, y, amount) {
  if (!isChoppable(terrainAt(state, x, y))) return null;
  const k = `${x},${y}`;
  const left = treeHpAt(state, x, y) - (amount || 1);
  if (left > 0) {
    state.treeHp[k] = left;
    cue(state, 'chop'); // a bite out of the trunk — it still stands
    return 'hurt';
  }
  const wasIron = terrainAt(state, x, y) === 'gate'; // read it BEFORE clearTree wipes the tile
  clearTree(state, x, y);
  cue(state, 'timber'); // it comes DOWN — a crash, not the chip of another axe blow
  addTreeDebris(state, x, y, wasIron); // sticks and leaves, or twisted bar-ends
  return 'felled';
}
// Spellfire doesn't chop — it LIGHTS. The tree stands and burns for a turn (still blocking the
// look), then is gone. tickBurningTrees resolves it.
// Fire lights TIMBER. Iron does not burn — a gate must be cut down, which is what makes it a
// different problem from a tree rather than the same one twice.
function igniteTree(state, x, y) {
  if (terrainAt(state, x, y) !== 'tree') return false;
  if (!state.burningTrees) state.burningTrees = {};
  if (state.burningTrees[`${x},${y}`]) return false; // already alight
  state.burningTrees[`${x},${y}`] = 1;
  return true;
}
// Once per turn: every tree set alight last turn burns away, leaving scorched ground — and as it goes
// it SPREADS, with a 50% chance to catch each adjacent tree, which then burns the turn after. A
// forest fire rolls through the timber this way, opening sight lines and combining with the Gardener's
// growth and any spellfire. Newly-caught trees are lit AFTER the old ones are cleared, so they burn
// on the NEXT tick (never all in one flash).
function tickBurningTrees(state) {
  if (!state.burningTrees) return;
  const catching = new Set();
  for (const k of Object.keys(state.burningTrees)) {
    const [x, y] = k.split(',').map(Number);
    for (const [dx, dy] of [...ORTHO, ...DIAG]) {
      const nx = x + dx;
      const ny = y + dy;
      if (terrainAt(state, nx, ny) === 'tree' && !state.burningTrees[`${nx},${ny}`] && Math.random() < 0.5) catching.add(`${nx},${ny}`);
    }
    clearTree(state, x, y);
    scorchGround(state, x, y); // the fire leaves its mark on the bare ground
  }
  state.burningTrees = {};
  for (const k of catching) {
    const [x, y] = k.split(',').map(Number);
    igniteTree(state, x, y); // it catches now, and burns away next tick
  }
}

// Smash a boulder to rubble: clear the tile and leave a fading pile of rocks (cosmetic).
function smashBoulder(state, x, y) {
  if (terrainAt(state, x, y) !== 'boulder') return;
  delete state.terrain[`${x},${y}`];
  addRubble(state, x, y);
}
// A leaper that lands on a BOULDER crushes it (leaving rubble). ICE it does NOT break — a jumper
// PERCHES on the intact slab (a leap is a valid way onto ice; walkers still can't set foot on it).
function crushBoulderUnder(state, unit) {
  smashBoulder(state, unit.x, unit.y);
}
// Collapse a wall to open floor, leaving a fading pile of rubble (cosmetic) — the same remains a
// crushed boulder leaves. Used wherever a wall is destroyed in play (e.g. a cave-in).
function smashWall(state, x, y) {
  if (terrainAt(state, x, y) !== 'wall') return;
  delete state.terrain[`${x},${y}`];
  if (state.torches) delete state.torches[`${x},${y}`]; // its torch falls with the wall
  addRubble(state, x, y);
}

// Spellfire washing OVER a tile marks the ground it crosses — it need not have struck anything
// there. Plain stone is left SCORCHED (a sooty stain that slowly fades, like rubble or scrap); open
// WATER is boiled away to bare floor instead, and that fresh floor is deliberately left unscorched —
// the steam took the heat. Everything else (walls, lava, ice, devilgrass) has its own reaction
// where the bolt is resolved, so it is left alone here.
function scorchGround(state, x, y) {
  const t = terrainAt(state, x, y);
  if (t === 'water') { addFog(state, x, y); return; } // the bolt steams the water into a bank of FOG — the water STAYS
  if (t !== 'normal') return;
  if (!Array.isArray(state.scorches)) state.scorches = [];
  const already = state.scorches.find((s) => s.x === x && s.y === y);
  if (already) { already.life = CORPSE_LIFE; return; } // a fresh burn over an old one just renews it
  state.scorches.push({ x, y, life: CORPSE_LIFE, max: CORPSE_LIFE, seed: randomInt(1000) });
}

// Pale-blue splinters left where an ice slab shattered (cosmetic, like rubble but frosted).
function addIceShards(state, x, y) {
  if (!Array.isArray(state.iceShards)) state.iceShards = [];
  state.iceShards.push({ x, y, life: CORPSE_LIFE, max: CORPSE_LIFE, ...remainsJitter() });
}
// Ice SHATTERS (leapt on / slammed into / a wall-breaking cave-in): slab → open floor + shards.
function smashIce(state, x, y) {
  if (terrainAt(state, x, y) !== 'ice') return false;
  cue(state, 'crush'); // the slab goes
  delete state.terrain[`${x},${y}`];
  addIceShards(state, x, y);
  return true;
}
// Ice MELTS (struck by fire / a spell): slab → water, and the flash of heat throws up a bank of FOG.
function meltIce(state, x, y) {
  if (terrainAt(state, x, y) !== 'ice') return false;
  state.terrain[`${x},${y}`] = 'water';
  addFog(state, x, y); // the slab flashes to steam as it thaws
  return true;
}
// Devilgrass is cleared away (scorched by a spell, or flattened by a rolling boulder) → floor.
function clearDevilgrass(state, x, y) {
  if (terrainAt(state, x, y) !== 'devilgrass') return false;
  delete state.terrain[`${x},${y}`];
  return true;
}
// A single spell tile's terrain reaction — thaw ice, wither devilgrass, blast a boulder. Shared
// by the bolt path and Blast so a Blast tile behaves exactly like a tile on the bolt's own path.
function scorchTileTerrain(next, x, y) {
  const t = terrainAt(next, x, y);
  if (t === 'ice') { if (meltIce(next, x, y)) next.player.brokeIce = true; } // badge ledger
  else if (t === 'devilgrass') clearDevilgrass(next, x, y);
  else if (t === 'tree') igniteTree(next, x, y); // fire doesn't fell a tree — it LIGHTS it (see tickBurningTrees)
  // NB: a BOULDER is spell-proof — fire neither blasts nor targets it. It stops the bolt like a wall
  // (see the bolt paths) but is never destroyed; only a shove rolls one away.
}

// ICE IS SLICK. A leaper that comes down on an ice slab keeps GOING — it skids in the direction of its
// leap across slab after slab until it reaches solid footing, or fetches up against something it can't
// cross (a wall, a boulder, a body, the key, the board's edge, a hazard), stopping on the last slab.
// Symmetric: the king and any leaping foe (a knight / nightrider) both slide. Bounded, so a closed box
// of ice can never loop — it just stops at the far wall (from which it can step off next turn).
function iceSlide(state, unit, dx, dy) {
  if ((!dx && !dy) || terrainAt(state, unit.x, unit.y) !== 'ice') return;
  const blocked = (t) => t === 'wall' || t === 'tree' || t === 'gate' || t === 'boulder' || t === 'pit' || t === 'lava';
  const taken = (x, y) => (state.player !== unit && state.player.x === x && state.player.y === y)
    || state.enemies.some((e) => e !== unit && e.x === x && e.y === y)
    || (state.allies || []).some((a) => a !== unit && a.x === x && a.y === y)
    || keyTileAt(state, x, y);
  for (let i = 0; i < 24; i += 1) {
    const nx = unit.x + dx;
    const ny = unit.y + dy;
    if (nx < 0 || nx >= WORLD_SIZE || ny < 0 || ny >= WORLD_SIZE) break; // the edge halts the skid
    const t = terrainAt(state, nx, ny);
    if (blocked(t) || taken(nx, ny)) break; // fetches up here — perch on the current slab
    unit.x = nx;
    unit.y = ny;
    if (t !== 'ice') break; // reached solid footing — the skid ends
  }
}
// If `unit` ended a LEAP on an ice slab, skid it along the leap's own heading.
function settleLeapOnIce(state, unit, fromX, fromY) {
  if (terrainAt(state, unit.x, unit.y) !== 'ice') return;
  iceSlide(state, unit, Math.sign(unit.x - fromX), Math.sign(unit.y - fromY));
}

// Resolve the king arriving on (x, y): attack a boss in place, destroy a summoning
// circle / capture a foe, grab an item, and take the stair.
function applyArrival(next, x, y, embedded) {
  const pl = next.player;
  pl.attacked = false; // a fresh action — set true only if the king actually strikes
  const fromX = pl.x; // where the king stood before this arrival (for bounce / land-beside)
  const fromY = pl.y;

  // The target sits EMBEDDED in cover (a phasing foe in a wall/ice) with a clear path between.
  // The king strikes THROUGH but cannot stand there — he holds his ground and deals the blow.
  if (embedded) {
    pl.attacked = true; pl.usedNormalAttack = true; // badge ledger: struck without a card
    const occ = next.enemies.find((e) => e.x === x && e.y === y);
    let realKill = false;
    if (occ && occ.boss) { if (damageBoss(next, occ, 1) === 'slain') { pl.killedEnemy = true; realKill = true; } }
    else if (occ && occ.turret) { damageTurret(next, occ, 1); }
    else if (occ) { realKill = isKillablePiece(occ); resolveKill(next, occ); }
    if (realKill && !next.gameOver && !next.won) applyOnKill(next, x, y, Math.sign(x - fromX), Math.sign(y - fromY));
    next.message = 'The king strikes through the cover!';
    if (realKill && pl.freeKillMove) {
      next.enemyTurn = false;
      next.lastAction = 'move-free';
    } else {
      passTurn(next);
      next.enemyTurn = true;
      next.lastAction = 'combat';
    }
    updateDiscovery(next);
    return next;
  }

  // A LEAP is an L-shaped arrival (a knight / nightrider pounce, e.g. Animal Form) — both axes move
  // and unequally. A plain king step or a bishop-style glide is not a leap. It changes how the king
  // treats a NEUTRAL beast or one of his own ALLIES on the destination tile (below).
  const leapAdx = Math.abs(x - fromX);
  const leapAdy = Math.abs(y - fromY);
  const viaLeap = leapAdx !== leapAdy && leapAdx > 0 && leapAdy > 0;

  // A NEUTRAL beast (Wild Empathy): a plain STEP or glide onto its tile TRADES places with it, the way
  // moving onto an ally does — the truce holds and the king slips past. A LEAP, though, comes down ON
  // it and crushes it. Handled BEFORE the boss block so a neutral MINI-BOSS horse swaps too rather
  // than eating a hit (which would wrongly break the truce).
  const neutralHere = next.enemies.find((e) => e.x === x && e.y === y && isNeutralBeast(next, e));
  if (neutralHere) {
    if (viaLeap) {
      pl.attacked = true; pl.usedNormalAttack = true;
      const rk = isKillablePiece(neutralHere);
      resolveKill(next, neutralHere); // crushed under the pounce
      if (rk) pl.killedEnemy = true;
      pl.x = x; pl.y = y;
      next.message = `The king comes down on ${aWord(neutralHere.kind)}, crushing it!`;
      if (rk && !next.gameOver && !next.won) applyOnKill(next, x, y, Math.sign(x - fromX), Math.sign(y - fromY));
    } else {
      pl.x = x; pl.y = y;
      neutralHere.x = fromX; neutralHere.y = fromY; // trade places — the beast is unruffled, still neutral
      next.message = `The king slips past the ${neutralHere.kind}.`;
    }
    collectKeyIfHere(next);
    if (!viaLeap && tryDescend(next)) return next;
    passTurn(next);
    next.enemyTurn = true;
    next.lastAction = viaLeap ? 'combat' : 'move';
    updateDiscovery(next);
    return next;
  }

  // Leapt onto a boulder? He crushes it to rubble as he lands. Onto an ice slab? He simply perches on
  // it — a leap lands ON ice without breaking it (only fire thaws it, or a slam shatters it).
  smashBoulder(next, x, y);

  // A boss soaks HP (it has a bar). The KILLING blow strides onto its tile (grabbing any guarded
  // key); a survived hit lands the king BESIDE it (nearest his origin) rather than freezing him.
  const bossHere = next.enemies.find((e) => e.x === x && e.y === y && e.boss);
  if (bossHere) {
    pl.attacked = true; pl.usedNormalAttack = true; // badge ledger: struck without a card
    const result = damageBoss(next, bossHere, 1);
    if (result === 'slain') {
      pl.killedEnemy = true;
      pl.x = x; pl.y = y; // the KILLING blow — the king strides onto the fallen guardian's tile
      collectKeyIfHere(next); // it was guarding the key/Orb, so grab it if it lies here
    } else {
      landBesideSurvivor(next, bossHere, x, y, fromX, fromY, false);
    }
    if (result === 'slain' && pl.freeKillMove) {
      next.enemyTurn = false;
      next.lastAction = 'move-free';
    } else {
      passTurn(next);
      next.enemyTurn = true;
      next.lastAction = 'combat';
    }
    updateDiscovery(next);
    return next;
  }

  // A turret is likewise struck IN PLACE (it soaks HP) — the king holds his ground and
  // chips it down; it grants no boon and no free move (a structure, not a "kill").
  const turretHere = next.enemies.find((e) => e.x === x && e.y === y && e.turret);
  if (turretHere) {
    pl.attacked = true; pl.usedNormalAttack = true; // badge ledger: struck without a card
    if (damageTurret(next, turretHere, 1) === 'slain') {
      pl.x = x; pl.y = y; // the king steps onto the wreckage of the turret he just destroyed
      collectKeyIfHere(next);
    } else {
      landBesideSurvivor(next, turretHere, x, y, fromX, fromY, false);
    }
    passTurn(next);
    next.enemyTurn = true;
    next.lastAction = 'combat';
    updateDiscovery(next);
    return next;
  }

  // A WARDED foe (a Guardian's retinue) turns the first blow aside: struck IN PLACE like a turret,
  // its guard drops, and the king lands beside it rather than striding onto a tile it still holds.
  const parriedHere = next.enemies.find((e) => e.x === x && e.y === y && e.parry && !e.boss && !e.turret && !e.summonCircle);
  if (parriedHere) {
    pl.attacked = true; pl.usedNormalAttack = true;
    resolveKill(next, parriedHere); // its parry soaks this — it survives, guard spent (returns false)
    landBesideSurvivor(next, parriedHere, x, y, fromX, fromY, false);
    passTurn(next);
    next.enemyTurn = true;
    next.lastAction = 'combat';
    updateDiscovery(next);
    return next;
  }

  // Moving onto an ally. A plain STEP/glide TRADES places with it (the Necromancer shuffles his
  // familiar in and out of the front line). A LEAP comes down ON it: it scrambles to a free tile
  // beside it if it can; if it is HEMMED IN, a 1-HP ally is crushed under the hooves and a sturdier
  // one holds firm so the king BOUNCES off beside it (as off a boss). The ally is his either way —
  // this never turns it hostile.
  const allyHere = allyAt(next, x, y);
  if (allyHere) {
    if (viaLeap) {
      const dodge = freeAdjacentTile(next, x, y);
      if (dodge) {
        allyHere.x = dodge.x; allyHere.y = dodge.y;
        next.player.x = x; next.player.y = y;
        next.message = `The ${allyHere.kind} scrambles aside as the king lands.`;
      } else if ((allyHere.hp || 1) <= 1) {
        next.allies = (next.allies || []).filter((a) => a.id !== allyHere.id);
        next.player.x = x; next.player.y = y;
        next.message = `Cornered, the king's own ${allyHere.kind} is crushed beneath his landing!`;
      } else {
        bounceOffTarget(next, x, y, fromX, fromY); // no room to dodge and too tough to crush — he bounds off beside it
        next.message = `The king bounds off his ${allyHere.kind}.`;
      }
    } else {
      next.player.x = x;
      next.player.y = y;
      allyHere.x = fromX;
      allyHere.y = fromY;
      next.message = `The king trades places with the ${allyHere.kind}.`;
    }
    next.enemyTurn = true;
    next.lastAction = 'move';
    collectKeyIfHere(next);
    if (tryDescend(next)) return next;
    passTurn(next);
    updateDiscovery(next);
    return next;
  }

  next.player.x = x;
  next.player.y = y;
  next.enemyTurn = true;
  next.lastAction = 'move';
  next.message = 'The king moves.';
  // Landing on ice here can only be a LEAP (a plain slide never stops on a slab) — an Animal-Form
  // unicorn riding like a nightrider onto ice. It skids off, same as a card leap does. A PHASING king
  // grips the slab (he can stand in it deliberately), so he never skids.
  if (!next.player.phase) settleLeapOnIce(next, next.player, fromX, fromY);

  const enemy = next.enemies.find((e) => e.x === x && e.y === y);
  let realKill = false;
  if (enemy) {
    realKill = isKillablePiece(enemy); // a circle is destroyed, but not an on-kill trigger
    resolveKill(next, enemy);
    pl.attacked = true; pl.usedNormalAttack = true; // badge ledger: struck without a card
    const adx = Math.abs(x - fromX);
    const ady = Math.abs(y - fromY);
    const leapt = (adx === 2 && ady === 1) || (adx === 1 && ady === 2); // a knight-style pounce (e.g. Animal Form)
    next.message = enemy.summonCircle
      ? 'The king shatters a summoning circle!'
      : `The king ${leapt ? 'crushes' : 'cuts down'} ${aWord(enemy.kind)}!`;
    next.lastAction = 'combat';
  }

  // A kill by moving fans out the Warrior's on-kill perks (Cleave/Pierce/Leech/Flourish);
  // Pierce strikes the foe directly behind the corpse, along the king's line of advance.
  if (realKill) applyOnKill(next, x, y, Math.sign(x - fromX), Math.sign(y - fromY));

  collectKeyIfHere(next);
  if (tryDescend(next)) return next;

  // CHARGE: EVERY move that kills costs no turn — chain them as long as you keep killing.
  if (realKill && pl.freeKillMove) {
    next.enemyTurn = false;
    next.lastAction = 'move-free';
  } else {
    passTurn(next);
  }
  updateDiscovery(next);
  return next;
}

// Resolve a piece being slain by the king. Bosses take HP damage; everything else
// is removed. Returns true if a unit was actually slain.
// ONE place that tallies a felling for the badge ledger, so a kill by hand, by card, by boulder or
// by shove all count the same. `killsThisTurn` is wiped at the top of each action (see passTurn),
// and the per-floor tallies are banked on the descent.
function tallyKill(state, enemy) {
  const p = state.player;
  if (!isKillablePiece(enemy)) {
    if (enemy.turret) { p.turretsThisFloor = (p.turretsThisFloor || 0) + 1; p.maxTurretsOnFloor = Math.max(p.maxTurretsOnFloor || 0, p.turretsThisFloor); }
    return;
  }
  p.killsThisFloor = (p.killsThisFloor || 0) + 1;
  p.maxKillsOnFloor = Math.max(p.maxKillsOnFloor || 0, p.killsThisFloor);
  p.killsThisTurn = (p.killsThisTurn || 0) + 1;
  p.maxKillsInTurn = Math.max(p.maxKillsInTurn || 0, p.killsThisTurn);
  if (enemy.boss && enemy.mini) { p.minisThisFloor = (p.minisThisFloor || 0) + 1; p.maxMinisOnFloor = Math.max(p.maxMinisOnFloor || 0, p.minisThisFloor); }
}

function resolveKill(state, enemy, opts) {
  if (enemy.boss) {
    damageBoss(state, enemy, 1);
    return true;
  }
  // GUARDIAN's PARRY: a warded foe turns the first KILLING blow aside — the guard drops and it must be
  // struck again. Environmental deaths (a pit, lava, spellfire, a crushing boulder) pass `bypassParry`
  // and cut straight through. Returns FALSE so the caller knows nothing fell (no on-kill, no boon).
  if (enemy.parry && !(opts && opts.bypassParry)) {
    enemy.parry = false;
    enemy.warded = null;
    enemy.awake = true;
    enemy.provoked = true;
    bloody(enemy, BLOOD_STRIKE);
    cue(state, 'deflect'); // a clang: its ward turned the blow
    state.message = `The ${enemy.kind} parries the blow — its guard drops!`;
    state.lastAction = 'combat';
    return false;
  }
  state.enemies = state.enemies.filter((e) => e.id !== enemy.id);
  const p = state.player;
  p.killedEnemy = true;
  tallyKill(state, enemy);
  const bySpell = Boolean(opts && opts.ash);
  // Necromancy: a felled real piece rises as an undead ally — but only ONE at a time.
  // When it dies, the next foe the king slays takes its place.
  if (p.necromancy && isKillablePiece(enemy) && !(state.allies || []).some((a) => a.undead)) {
    if (spawnAllyNear(state, enemy.kind, enemy.x, enemy.y, { undead: true })) {
      state.message = `The slain ${enemy.kind} rises to serve you!`;
      return true;
    }
  }
  // A circle is a RUNE cut into the floor, not a creature — it has no blood to shed. Breaking one
  // is a puff of arcane smoke over a scar, and nothing else. And a foe burnt down by SPELLFIRE is
  // reduced to ASH — there is no blood to fling, so it leaves an ash pile alone, not a stain under it.
  if (!enemy.summonCircle && !bySpell) {
    addSpatter(state, enemy.x, enemy.y, Math.sign(enemy.x - p.x), Math.sign(enemy.y - p.y), isDemonKind(enemy.kind)); // blood flings away from the king
  }
  // A shattered summoning circle leaves a permanent scar so its ruin stays visible; a foe
  // burnt down by a spell leaves an ash pile; an ordinary slain piece leaves a fading
  // corpse (a raised undead, above, left neither).
  if (enemy.summonCircle) {
    if (!Array.isArray(state.scars)) state.scars = [];
    state.scars.push({ x: enemy.x, y: enemy.y, kind: 'circle' });
    state.banished = { x: enemy.x, y: enemy.y }; // the view puffs arcane smoke where the rune broke
    state.player.circlesDispelled = (state.player.circlesDispelled || 0) + 1; // badge ledger
  } else if (bySpell) {
    addAsh(state, enemy.x, enemy.y);
  } else {
    addCorpse(state, enemy.x, enemy.y, enemy.kind);
  }
  return true;
}

// Strike a tile WITHOUT moving the king (spell path, ranged shot, cleave). Handles
// bosses (HP) and ordinary foes. Returns the slain enemy (or null if nothing fell).
function attackTile(state, tx, ty, opts) {
  const e = state.enemies.find((en) => en.x === tx && en.y === ty);
  if (e && isCapturable(state, e)) {
    // A summoning circle is a structure you can only break by STEPPING onto it (or being
    // shoved onto it) — a missile weapon or spell passes over it without dispelling it.
    if (e.summonCircle) return null;
    if (e.boss) return damageBoss(state, e, 1) === 'slain' ? e : null;
    if (e.turret) return damageTurret(state, e, 1) === 'slain' ? e : null;
    return resolveKill(state, e, opts) ? e : null; // a warded foe parries — nothing fell this hit
  }
  return null;
}

// A follow-through blow that lands on TIMBER. Cleave and Pierce carry the blade on into whatever
// stands behind the body, and timber and iron are not exempt from that — but only for ONE wound,
// the same as a deliberate swing: a follow-through is not a better axe than an axe.
//
// Never bites a tile a foe is standing in: a phasing guardian embedded in a trunk has already taken
// the blow itself, and the tree should not be hacked as a bonus on top of it.
function followThroughTimber(state, x, y) {
  if (state.enemies.some((e) => e.x === x && e.y === y)) return false;
  return Boolean(damageTree(state, x, y, 1));
}

function cleaveAdjacent(state, x, y) {
  // A BODY first — the sweep is aimed at foes, and it must not spend itself on a tree while a piece
  // stands on the other side of the king. Only when the sweep finds nothing to fell does it bite
  // the timber beside it, and then only one trunk, exactly as it only ever fells one foe.
  for (const [dx, dy] of [...ORTHO, ...DIAG]) {
    if (attackTile(state, x + dx, y + dy)) return;
  }
  for (const [dx, dy] of [...ORTHO, ...DIAG]) {
    if (followThroughTimber(state, x + dx, y + dy)) return;
  }
}

// Flourish (Duellist): after a kill, every foe adjacent to the king is caught off
// guard — its memory of the king is wiped so it burns its next turn gasping in
// surprise instead of striking (bosses/structures are unmoved).
// Catch every foe around (cx,cy) off guard: it forgets the king outright, so on the next enemy
// phase it gasps (the "!" telegraph) and loses that turn before it can act — one turn stolen.
// Bosses and structures are never caught out. Shared by the Duellist's Flourish (around the king,
// after a kill) and Blink (around the tile he vanished FROM).
// Make a piece GASP: wipe what it knows of the king, so beginEnemyPhase re-startles it and it burns
// its next turn catching its breath instead of striking.
//
// Setting `surprised = true` directly does NOTHING, which is worth stating plainly: the phase clears
// that flag and makes any AWAKE piece a mover. The gasp has to come from the piece genuinely having
// lost track of him — so losing track of him is what this does.
function startle(enemy) {
  enemy.awake = false;
  enemy.surprised = false;
  enemy.lastSeen = null;
  enemy.lastSeenTtl = 0;
}

/* ------------------------------- confusion -------------------------------- */
// A CONFUSED piece has lost track of which side it is on. Each turn it either lashes out at the
// nearest thing it can reach — friend, foe, or king, it cannot tell them apart — or blunders off in
// a random direction. Even chance of each.
//
// It is deliberately a plain boolean rather than a countdown: the wear-off is a coin flipped at the
// end of each of its turns, so confusion is a fog that MIGHT lift rather than a timer the player can
// count on. And any blow snaps it out of it — which is the tension of the thing: the chaos you
// unleashed is undone by the first piece you decide to hit.
function isConfused(enemy) {
  return Boolean(enemy && enemy.confused);
}

// Confuse a piece. Turrets, guardians and summoning circles are all fair game — nothing is too
// mindless or too mighty to be turned around.
function confuse(enemy) {
  if (!enemy) return false;
  enemy.confused = true;
  return true;
}

// NB: NOTHING clears confusion but the coin at the end of a confused piece's own turn. A blow used
// to snap a piece straight out of it, which made the card fight itself: the Hexer scattered a room
// and then could not touch any of it without sobering up whatever he hit. The fog lifts when it
// lifts, and hitting a confused guardian is simply free value.

// The blocker/target lookup for a confused piece: it can see bodies, but not whose they are. This
// is the ONE difference from an ordinary enemy's move generation (which targets only the king and
// his allies) — and it is what makes friendly fire fall out for free rather than being a special
// case bolted on. The key is still not a target: it is a thing on the floor, not a body.
function confusedPieceMoves(piece, state) {
  const unitAt = enemyUnitAt(state, piece);
  const isTarget = (x, y) => {
    const u = unitAt(x, y);
    return Boolean(u) && u !== 'key';
  };
  // A confused piece has NO self-preservation. pieceTerrainOpts is where a foe's good sense lives —
  // it routes around fire it cannot survive and never steps into a hole — and a piece that has lost
  // the thread has none of that. `flying`/`lavaOk` here do not make it immune to anything; they only
  // stop the move generator from refusing the tile. What happens when it lands there is the floor's
  // business, and the floor is not merciful (see confusedTurn).
  const opts = { ...pieceTerrainOpts(piece), lavaOk: true, flying: true };
  return generateMoves(piece.kind, state, piece.x, piece.y, unitAt, isTarget, opts);
}

// Timber and iron a confused piece could blunder into. They are not standable, so the move generator
// never offers them — but a thing flailing about swings at whatever is in front of it, and a tree is
// in front of it.
function confusedChopTargets(piece, state) {
  const out = [];
  for (const [dx, dy] of [...ORTHO, ...DIAG]) {
    const x = piece.x + dx;
    const y = piece.y + dy;
    if (x < 0 || x >= WORLD_SIZE || y < 0 || y >= WORLD_SIZE) continue;
    if (isChoppable(terrainAt(state, x, y))) out.push({ x, y, chop: true });
  }
  return out;
}

// One confused piece cutting down another. Deliberately NOT damageBoss/resolveKill: those speak in
// the king's name ("The king strikes...") and pay him the score, the on-kill perks and the boons.
// He did not do this — he only started it — so it fells the piece and nothing more.
function confusedFriendlyFire(state, attacker, target) {
  addSpatter(state, target.x, target.y, Math.sign(target.x - attacker.x), Math.sign(target.y - attacker.y), isDemonKind(target.kind));
  if (target.maxHp) { // a guardian or a turret soaks it
    target.hp -= 1;
    if (target.hp > 0) {
      state.message = `A confused ${attacker.kind} hammers ${target.bossName || `a ${target.kind}`} (${target.hp}/${target.maxHp})!`;
      return false;
    }
  }
  state.enemies = state.enemies.filter((e) => e.id !== target.id);
  state.message = `A confused ${attacker.kind} cuts down ${target.bossName || `a ${target.kind}`}!`;
  return true;
}

// A confused piece's whole turn.
function confusedTurn(state, enemy) {
  state.lastAction = 'enemy';
  // A summoning circle has no body to swing and no legs to blunder on. Confusing one simply stalls
  // the conjuring — which is a real effect, and a better one than pretending a rune can stagger.
  if (enemy.summonCircle) {
    state.message = 'A summoning circle sputters, its rune scrambled.';
    confusionMayLift(state, enemy);
    return state;
  }
  const moves = confusedPieceMoves(enemy, state);
  // Timber is a thing it can hit, so it counts as a strike — it is flailing, and a tree is in front
  // of it. (These are not standable, so the move generator never offers them.)
  const strikes = moves.filter((m) => m.capture).concat(confusedChopTargets(enemy, state));
  const steps = moves.filter((m) => !m.capture);
  const rooted = isStationary(enemy); // a turret, or a guardian still holding its stair
  const canStrike = strikes.length > 0;
  const canStep = steps.length > 0 && !rooted;
  // THE COIN: lash out, or blunder. A piece that cannot do what it rolled does the other instead —
  // one with nothing in reach staggers off, one boxed in lashes at what it can reach.
  //
  // A ROOTED piece has no "other": it cannot blunder anywhere, so its blunder is a wild swing at
  // nothing. That is deliberate and load-bearing. Falling back to a strike for anything that cannot
  // walk quietly deleted the coin for turrets — a confused turret fired every single turn, which
  // made confusing one strictly BETTER for the player than leaving it alone, since a confused
  // turret shot the room instead of him. It must be dangerous only every other turn.
  let doStrike = randomInt(2) === 0;
  if (doStrike && !canStrike && canStep) doStrike = false;
  else if (!doStrike && !canStep && !rooted && canStrike) doStrike = true;
  const pick = (list) => list[randomInt(list.length)];
  if (doStrike && canStrike) {
    const target = pick(strikes);
    const king = state.player;
    if (target.chop) {
      // It swings at the tree. Same three wounds as anyone else's axe — a confused rook is not a
      // better woodsman than the king.
      const what = terrainAt(state, target.x, target.y) === 'gate' ? 'gate' : 'tree';
      const res = damageTree(state, target.x, target.y, 1);
      state.message = res === 'felled'
        ? `A confused ${enemy.kind} hacks down a ${what}!`
        : `A confused ${enemy.kind} hammers at a ${what}.`;
      if (res === 'felled') updateDiscovery(state);
    } else if (target.x === king.x && target.y === king.y) {
      // It blunders into the king. Still a real blow — being confused makes it no less dangerous
      // to be next to, which is what stops the card being a free "everything stops hitting me".
      if (isJumperKind(enemy.kind) && !target.embedded) knockbackKing(state, enemy);
      else strikeKing(state, enemy);
    } else {
      const ally = allyAt(state, target.x, target.y);
      if (ally) {
        addSpatter(state, ally.x, ally.y, 0, 0, isDemonKind(ally.kind));
        if (damageAlly(state, ally, 1)) {
          if (!rooted) { enemy.x = target.x; enemy.y = target.y; }
          state.message = `A confused ${enemy.kind} cuts down your ${ally.kind}!`;
        } else {
          state.message = `A confused ${enemy.kind} hammers your ${ally.kind} (${ally.hp}/${ally.maxHp}).`;
        }
      } else {
        const foe = state.enemies.find((e) => e.id !== enemy.id && e.x === target.x && e.y === target.y);
        if (foe) {
          const felled = confusedFriendlyFire(state, enemy, foe);
          if (felled && !rooted) { enemy.x = target.x; enemy.y = target.y; }
        }
      }
    }
  } else if (!doStrike && canStep) {
    const step = pick(steps);
    enemy.x = step.x;
    enemy.y = step.y;
    crushBoulderUnder(state, enemy);
    state.message = `A confused ${enemy.kind} staggers about.`;
    // ...and it staggers onto whatever is there, having no sense left to avoid it. A piece with the
    // thread would route around fire and never walk into a hole; this one does both, and the floor
    // collects. Fires here rather than in the move generator because the generator's job is what is
    // REACHABLE — what it costs you to reach is the floor's business.
    if (confusedBlunderHarm(state, enemy)) return state; // it went over the edge: it is gone
  } else {
    state.message = `A confused ${enemy.kind} flails at nothing.`;
  }
  confusionMayLift(state, enemy);
  return state;
}

// A confused piece that has just staggered onto something that hurts. Returns true if it is gone.
//
// The PIT rules are exactly the ones a shoved foe already lives by (see knockbackEnemy): only the
// floor's own guardian is anchored enough to haul itself back out, for a wound. A rogue mini, a
// rush boss, an ordinary piece, a turret — all of them go all the way down. One rule, two ways in.
//
// Lava is left to tickLavaDamage, which burns whatever is standing in it at the start of the enemy
// phase — so a confused piece that wanders into fire simply cooks like anything else that does.
function confusedBlunderHarm(state, enemy) {
  if (terrainAt(state, enemy.x, enemy.y) !== 'pit') return false;
  cue(state, 'fall');
  if (enemy.boss && !enemy.mini && !enemy.rush) {
    const slain = damageBoss(state, enemy, 1) === 'slain';
    state.message = slain
      ? `${bossTitle(enemy)} blunders into a pit and does not climb out!`
      : `${bossTitle(enemy)} blunders into a pit and hauls itself back out!`;
    if (!slain) {
      const out = nearestFooting(state, enemy.x, enemy.y);
      if (out) { enemy.x = out.x; enemy.y = out.y; }
    }
    return slain;
  }
  if (!enemy.turret) addSpatter(state, enemy.x, enemy.y, 0, 0, isDemonKind(enemy.kind));
  state.enemies = state.enemies.filter((e) => e.id !== enemy.id);
  state.message = `A confused ${enemy.turret ? 'turret' : enemy.kind} staggers into a pit — gone!`;
  return true;
}

// The fog lifts on a coin flip, at the END of the turn — so a confusion always costs its victim at
// least one turn. Rolling at the START would let half of them shrug it off before it ever bit, and
// a nine-turn capstone that does nothing at all to half the room is not a capstone.
function confusionMayLift(state, enemy) {
  if (randomInt(2) === 0) {
    enemy.confused = false;
    // It comes to its senses knowing only that it is in a fight. It does NOT get its bearings on
    // the king for free — beginEnemyPhase decides that next turn, the same as for anything else.
    enemy.frustrated = false;
  }
}

function surpriseAround(state, cx, cy) {
  for (const [dx, dy] of [...ORTHO, ...DIAG]) {
    const e = state.enemies.find((en) => en.x === cx + dx && en.y === cy + dy);
    if (e && !e.boss && !e.turret && !e.summonCircle) startle(e);
  }
}
function flourishSurprise(state) {
  surpriseAround(state, state.player.x, state.player.y);
}

// Fan out the Warrior's on-kill perks after he fells a foe by moving or with a melee
// card. `ox,oy` is the origin the effects radiate from (the king's tile / the slain
// foe's tile); `dx,dy` is the strike direction (0,0 to skip Pierce). Fires once per
// action, so a single turn heals/flourishes/cleaves at most once.
function applyOnKill(state, ox, oy, dx, dy) {
  const p = state.player;
  if (state.gameOver || state.won) return;
  const before = state.enemies.length; // the main foe is already gone; count further kills
  if (p.meleeCleave) cleaveAdjacent(state, ox, oy);
  if (p.meleePierce && (dx || dy)) {
    // The thrust drives TWO tiles past the kill — into the next foe(s), or into the timber standing
    // there. Each tile is struck in turn (a foe, or a tree/gate); walls it simply cannot punch through.
    for (let step = 1; step <= 2; step += 1) {
      const tx = ox + dx * step;
      const ty = oy + dy * step;
      if (!attackTile(state, tx, ty)) followThroughTimber(state, tx, ty);
    }
  }
  // VAMPIRIC EDGE: a 1-in-3 chance of mending a wound for EACH foe he fells this action — the direct
  // kill AND anything Cleave or Pierce takes with it. applyOnKill fires only on real, killable pieces
  // (never a turret or circle — isKillablePiece draws that line), so every body counted here is his
  // blade finding flesh. `before - length` is the collateral; the +1 is the kill that got us here.
  if (p.meleeLeech) {
    const bodies = 1 + Math.max(0, before - state.enemies.length);
    for (let i = 0; i < bodies && p.hp < p.maxHp; i += 1) {
      if (randomInt(3) === 0) p.hp += 1;
    }
  }
  if (p.meleeFlourish) flourishSurprise(state);
}

// If the king now stands on the stair (and the run isn't already won/over), flag the
// descent so the controller drops to the next floor. Returns true when it fires.
function tryDescend(next) {
  if (next.won || next.gameOver) return false;
  if (next.exit && next.player.x === next.exit.x && next.player.y === next.exit.y) {
    if (next.exit.locked) {
      // The king reached the exit but it is sealed until he holds the key / Orb.
      next.message = next.exit.portal
        ? 'The portal lies dormant — seize the Orb of Victory first.'
        : 'The stair is sealed — find the floor key first.';
      return false;
    }
    if (next.exit.portal) {
      // The FINALE: stepping into the open portal, Orb in hand, wins the run outright. Flag it
      // as 'win' (not 'exit') so no caller tries to generate a floor 9 — there is none.
      next.won = true;
      next.lastAction = 'win';
      next.message = 'You step into the portal, Orb of Victory in hand — the realm is saved!';
      return true;
    }
    next.lastAction = 'exit';
    next.message = 'You step onto the stair and descend...';
    return true;
  }
  return false;
}

// The king has just been SHOVED (a knockback, or a Warper's swap) — if the shove dropped him onto the
// OPEN stair, he tumbles straight down to the next floor: "defenestrated". Sets lastAction 'exit', so
// the turn flow descends exactly as if he'd stepped on it himself. The finale portal is exempt: you
// win that on your own feet, Orb in hand, not by being thrown through it.
function checkDefenestration(state) {
  if (state.won || state.gameOver) return false;
  const ex = state.exit;
  if (!ex || ex.locked || ex.portal) return false;
  if (state.player.x !== ex.x || state.player.y !== ex.y) return false;
  state.player.defenestrated = true; // badge ledger
  state.player.knockedDownstair = true;
  state.message = 'The king is hurled clean down the stair — into the next floor!';
  state.lastAction = 'exit';
  return true;
}

// Blink (Sorcerer Translocations): teleport the king to a random tile in sight that is standable,
// empty, off the stair, and NOT threatened by any visible enemy. No-op when no such refuge exists.
// Returns true if he blinked.
//
// Driven by the BLINK CARD (cooldown 6) — it is no longer a reflex that fired free, every time, on
// every hit. Hence no `p.blink` flag: holding the card IS the permission.
function blinkToSafety(state) {
  const p = state.player;
  if (p.blinkedThisTurn || state.gameOver) return false;
  // Danger must be judged as if the king already stood on the candidate — so a slider's
  // FULL line counts (his own body must not "block" a threat behind himself). Compute each
  // visible enemy's reach from a ghost state whose king sits off-board.
  const ghost = { ...state, player: { ...p, x: -50, y: -50 } };
  const danger = new Set();
  for (const e of getVisibleEnemies(state)) {
    for (const t of getPieceThreats(e, ghost, true)) danger.add(`${t.x},${t.y}`);
  }
  const bounds = getVisibleBounds(state);
  const options = [];
  for (let yy = bounds.y; yy < bounds.y + bounds.height; yy += 1) {
    for (let xx = bounds.x; xx < bounds.x + bounds.width; xx += 1) {
      if (xx === p.x && yy === p.y) continue;
      // STRICT line of sight (seeWalls=false): never blink to a tile hidden behind a wall — not
      // even one the Ranger's Sixth Sense can x-ray. You only blink where you truly see.
      if (!hasLineOfSight(state, p.x, p.y, xx, yy, false)) continue;
      if (!standableFor(terrainAt(state, xx, yy), {})) continue; // solid ground only
      if (state.enemies.some((e) => e.x === xx && e.y === yy)) continue;
      if (state.exit && xx === state.exit.x && yy === state.exit.y) continue;
      if (danger.has(`${xx},${yy}`)) continue; // must be a SAFE tile
      options.push({ x: xx, y: yy });
    }
  }
  if (!options.length) return false;
  const fromX = p.x;
  const fromY = p.y;
  const pick = options[randomInt(options.length)];
  p.x = pick.x;
  p.y = pick.y;
  p.blinkedThisTurn = true;
  // The king simply ISN'T THERE any more: every foe that was crowding the tile he vanished from is
  // left swiping at empty air, and loses its next turn to the shock. That is what makes Blink an
  // escape rather than a shuffle — it buys distance AND a turn from the pack that had him cornered.
  surpriseAround(state, fromX, fromY);
  collectKeyIfHere(state);
  updateDiscovery(state); // reveal the fog around wherever he flickered to (a blink is a real move)
  state.message = 'The king blinks away — the foes he left behind swipe at empty air!';
  return true;
}

// Collect the floor key when the king stands on it: the stair unlocks for good.
function collectKeyIfHere(next) {
  const k = next.key;
  const p = next.player;
  if (k && !k.collected && p.x === k.x && p.y === k.y) {
    k.collected = true;
    k.discovered = true;
    if (next.exit) next.exit.locked = false;
    if (k.orb) {
      // The finale begins: the portal wakes and the realm's guardians start converging (see
      // maybeSpawnEnemy / spawnBossRush). From here it's a fighting retreat to the portal.
      next.orbTaken = true;
      next.bossRushTimer = 0;
      next.message = 'You seize the Orb of Victory — the portal roars open, and guardians converge!';
    } else {
      next.message = 'You seize the floor key — the stair unlocks!';
    }
    return true;
  }
  return false;
}

// The tiles strictly between two points along a straight (8-direction) line.
function straightPath(x0, y0, x1, y1) {
  const dx = Math.sign(x1 - x0);
  const dy = Math.sign(y1 - y0);
  const adx = Math.abs(x1 - x0);
  const ady = Math.abs(y1 - y0);
  if (!(adx === ady || adx === 0 || ady === 0) || (adx === 0 && ady === 0)) return [];
  const tiles = [];
  let x = x0 + dx;
  let y = y0 + dy;
  while (x !== x1 || y !== y1) {
    tiles.push({ x, y });
    x += dx;
    y += dy;
  }
  return tiles;
}

function canStandEmpty(state, x, y) {
  if (x < 0 || x >= WORLD_SIZE || y < 0 || y >= WORLD_SIZE) return false;
  if (!standableFor(terrainAt(state, x, y), {})) return false;
  if (state.enemies.some((e) => e.x === x && e.y === y)) return false;
  return true;
}

// Play a weapon card at (x, y): melee moves onto the target; ranged/spell hold the
// king's tile (spell pierces the whole path). Class perks add the effects.
function useCard(state, cardIndex, x, y) {
  const next = structuredClone(state);
  const p = next.player;
  p.attacked = false; // reset per action; a weapon card sets it true (breaking stealth)
  const card = p.cards[cardIndex];
  if (!card) {
    next.message = 'No such card.';
    next.lastAction = 'blocked';
    return next;
  }
  if (card.remaining > 0) {
    next.message = 'That card is still recharging.';
    next.lastAction = 'blocked';
    return next;
  }
  // NB: "the warhorse wields no cards" used to be a hardcoded refusal RIGHT HERE, which
  // cardBlockedReason knew nothing about — so through the whole of Animal Form every card button
  // sat there looking live, and pressing one just beeped at you. It lives in cardBlockedReason now,
  // which is the one thing both the view and this function ask.
  const blocked = cardBlockedReason(next, card);
  if (blocked) {
    next.message = blocked;
    next.lastAction = 'blocked';
    return next;
  }
  const move = getCardMoves(next, card).find((m) => m.x === x && m.y === y);
  if (!move) {
    next.message = 'That card cannot reach that tile.';
    next.lastAction = 'blocked';
    return next;
  }
  if (!isAbilityCard) p.usedCard = true; // badge ledger: he drew a WEAPON (Animal Form/Reload/Swap don't count)

  // FIREBALL: work out WHERE the burst will centre before anything resolves.
  //
  // A spell card is aimed at its ray's FAR END — the bolt always flies its full reach, and the
  // aimed tile only picks a direction (see the spell branch below). So the aimed (x,y) is usually
  // empty ground well past the foe, and bursting there would miss the thing the player meant to
  // hit. The burst centres on the FIRST foe along the ray instead. Captured NOW, because once the
  // bolt has flown that foe is ash and its tile is unknowable.
  let fireballCentre = null;
  if (card.kind === 'fireball') {
    const bdx = Math.sign(x - p.x);
    const bdy = Math.sign(y - p.y);
    const bReach = cardReach(card.kind, p.cardReach || 0);
    for (let i = 1; i <= bReach; i += 1) {
      const cx = p.x + bdx * i;
      const cy = p.y + bdy * i;
      if (cx < 0 || cx >= WORLD_SIZE || cy < 0 || cy >= WORLD_SIZE) break;
      // The fireball DETONATES at the first thing that stops it — the FIRST foe on the line, or the
      // first solid obstacle (a wall, a boulder, an ice slab, a tree). It bursts even against ice,
      // which merely stops an ordinary bolt (that is the whole point of the card). Empty ground past
      // the obstacle is never the centre, so the AoE lands on what the player actually aimed at.
      const bt = terrainAt(next, cx, cy);
      if (next.enemies.some((e) => e.x === cx && e.y === cy)) { fireballCentre = { x: cx, y: cy }; break; }
      if (bt === 'wall' || bt === 'boulder' || bt === 'ice' || bt === 'tree') { fireballCentre = { x: cx, y: cy }; break; }
    }
  }

  // Promotion (Animal Form): turns the king into a swift warhorse for a few turns — he glides and
  // leaps but can play no cards until it wears off. He still takes damage as normal. Taking the form
  // COSTS a turn (the transformation itself), so it is a real commitment, not a free reposition. The
  // +1 offsets passTurn's own decrement this turn, so the beast still gets its full PROMOTION_TURNS.
  if (card.kind === 'promotion') {
    p.promotion = PROMOTION_TURNS + 1;
    card.remaining = card.cooldown;
    const rallied = rallyHorses(next); // the wild horses recognise kin and join the herd
    next.message = rallied
      ? `The Ranger takes Animal Form — a swift UNICORN storms the board, and ${rallied} wild horse${rallied === 1 ? '' : 's'} rally to it!`
      : 'The Ranger takes Animal Form — a swift UNICORN storms the board!';
    passTurn(next); // transforming spends the turn
    next.enemyTurn = true;
    next.lastAction = 'card';
    updateDiscovery(next);
    return next;
  }
  // Reload: spend the turn to recharge every OTHER card at once.
  // BLINK: flicker to a random safe tile in sight. A FREE action (no turn spent) on a long
  // cooldown — it used to fire reflexively every time a foe landed a hit, which cost the player no
  // decision at all. If there is no refuge, the card is not spent.
  if (card.kind === 'blink') {
    if (!blinkToSafety(next)) {
      next.message = 'Nowhere safe to blink to.';
      next.lastAction = 'blocked';
      return next;
    }
    card.remaining = card.cooldown;
    card.justFired = true;
    next.enemyTurn = false;
    next.lastAction = 'move-free';
    updateDiscovery(next);
    return next;
  }
  // SILENCE: every foe he can SEE drops into a dead sleep. A free action on a long cooldown — it
  // buys a window to walk through a room or out of one, and it shuts the instant he takes a swing
  // (see passTurn). This replaced Silent, a passive that just switched the game off permanently.
  // MASS CONFUSION (Hexer capstone): every foe in sight loses the thread. Unlike Silence — which
  // holds the room STILL and breaks the moment he strikes — this leaves the room moving and
  // dangerous, just no longer aimed at him. It costs a turn, so the fog falls and the whole board
  // immediately blunders about under it; and any piece he then hits sobers up at once.
  if (card.kind === 'confuse') {
    const caught = getVisibleEnemies(next).filter((e) => confuse(e));
    card.remaining = card.cooldown;
    card.justFired = true;
    next.message = caught.length
      ? `The hex takes hold — ${caught.length} foe${caught.length === 1 ? '' : 's'} lose all sense of friend and foe!`
      : 'The hex goes out into an empty room.';
    passTurn(next);
    next.enemyTurn = true;
    next.lastAction = 'combat';
    updateDiscovery(next);
    return next;
  }
  if (card.kind === 'silence') {
    p.silence = SILENCE_TURNS;
    applySilence(next);
    card.remaining = card.cooldown;
    card.justFired = true;
    next.message = 'A hush falls — every foe in sight drops where it stands.';
    next.enemyTurn = false;
    next.lastAction = 'move-free';
    updateDiscovery(next);
    return next;
  }
  if (card.kind === 'reload') {
    for (const c of p.cards) if (c !== card) c.remaining = 0;
    card.remaining = card.cooldown;
    card.justFired = true;
    next.message = 'You reload — every other card is ready.';
    passTurn(next);
    next.enemyTurn = true;
    next.lastAction = 'combat';
    updateDiscovery(next);
    return next;
  }
  // BANISH: the target is simply GONE — no blood, no corpse, no boon, no kill credit. It was never
  // slain, so it feeds nothing that keys off killing (Charge, Vampiric Edge, the level-up boon).
  // What it leaves is smoke.
  if (card.kind === 'banish') {
    const unit = next.enemies.find((e) => e.x === x && e.y === y);
    if (!unit || !isBanishable(unit)) {
      next.message = 'That cannot be banished.';
      next.lastAction = 'blocked';
      return next;
    }
    next.enemies = next.enemies.filter((e) => e.id !== unit.id);
    next.banished = { x, y }; // the view puffs smoke where it stood (see main.js)
    p.attacked = true; // it IS aggression: it shatters Silence and raises no Parry guard
    card.remaining = card.cooldown;
    card.justFired = true;
    const what = unit.turret ? `${unit.kind} turret` : (unit.mini || unit.rush) ? bossTitle(unit) : unit.kind;
    next.message = `The king BANISHES the ${what} — nothing remains but smoke.`;
    passTurn(next);
    next.enemyTurn = true;
    next.lastAction = 'combat';
    updateDiscovery(next);
    return next;
  }
  // Displacement: trade tiles with the targeted unit (no damage), then spend the turn.
  if (card.kind === 'swap') {
    const unit = next.enemies.find((e) => e.x === x && e.y === y && !e.summonCircle);
    if (!unit) {
      // A summoning circle is a rune in the floor, not a unit — nothing to trade places with.
      next.message = next.enemies.some((e) => e.x === x && e.y === y && e.summonCircle)
        ? 'A summoning circle is cut into the floor — there is nothing there to swap with.'
        : 'Nothing to swap with there.';
      next.lastAction = 'blocked';
      return next;
    }
    const kx = p.x;
    const ky = p.y;
    p.x = x;
    p.y = y;
    unit.x = kx;
    unit.y = ky;
    card.remaining = card.cooldown;
    card.justFired = true;
    next.message = `The king swaps places with a ${unit.kind} — the air tears where he lands!`;
    // A SHOCKWAVE at the DESTINATION only: his violent arrival shoves every other foe (and loose
    // boulder) now beside him. The tile he vanished FROM is left calm now — the swap no longer tears
    // at both ends, only where he comes down. The just-swapped unit is spared.
    if (!next.gameOver && !next.won) {
      shoveAdjacentAway(next, p.x, p.y, unit.id);
    }
    collectKeyIfHere(next);
    passTurn(next);
    next.enemyTurn = true;
    next.lastAction = 'combat';
    updateDiscovery(next);
    return next;
  }

  // Double Step charge into a boulder: the running shove rolls it TWO tiles (a plain move
  // heaves it just one), the king following into the boulder's old square.
  if (move.push) {
    const dx = Math.sign(x - p.x);
    const dy = Math.sign(y - p.y);
    const rolled = pushBoulderFar(next, x, y, dx, dy, 2);
    next.message = rolled ? 'The king charges — the boulder rolls two tiles!' : 'The king charges the boulder — but it will not budge.';
    card.remaining = card.cooldown;
    card.justFired = true;
    p.attacked = false; // heaving a boulder is not an attack
    collectKeyIfHere(next);
    if (tryDescend(next)) { updateDiscovery(next); return next; }
    passTurn(next);
    next.enemyTurn = true;
    next.lastAction = 'move';
    updateDiscovery(next);
    return next;
  }

  const category = classCategory(p.className);
  const fromX = p.x;
  const fromY = p.y;
  const mainTarget = next.enemies.find((e) => e.x === x && e.y === y);
  let scored = false; // struck the main target (for the flavour message)
  let realKill = false; // felled a real enemy piece (gates the on-kill perks)
  const kills = []; // real pieces felled this cast (for Dazzle)
  const impactTiles = []; // every tile a spell's fireball detonates on (for the view)
  p.attacked = true;

  if (category === 'melee') {
    let survived = false;
    const isLeap = Boolean(move.viaJump) && isJumperKind(card.kind);
    // A CHARGE that reaches two tiles TRAMPLES whatever stood in the first one. The targeting only
    // offers the far tile when the near piece would actually die to the blow (a guardian or a turret
    // halts the charge on its own square instead), so this is a foe he is genuinely running down —
    // and it must be resolved BEFORE he arrives, or he would land on top of it.
    if (card.kind === 'doublestep' && chebyshev(x, y, fromX, fromY) === 2) {
      const tx = fromX + Math.sign(x - fromX);
      const ty = fromY + Math.sign(y - fromY);
      const trampled = next.enemies.find((e) => e.x === tx && e.y === ty && isCapturable(next, e));
      if (trampled) {
        resolveKill(next, trampled);
        scored = true;
        if (isKillablePiece(trampled)) realKill = true;
      }
    }
    // A leap card that lands on a boulder crushes it to rubble (the king ends up there); landing on
    // an ice slab does NOT break it — he perches on the intact slab.
    if (isLeap) smashBoulder(next, x, y);
    if (move.chop) {
      // He sprang at TIMBER or IRON. There is no landing on it: the blade goes in and he BOUNCES
      // OFF — coming down on the nearest tile beside the trunk, the way a knight rebounds off a boss
      // it cannot displace, not teleporting straight back to where he started. `lungeAt` drives the
      // view: it pounces him onto the trunk first, then eases him to where he actually settles.
      const what = terrainAt(next, x, y) === 'gate' ? 'gate' : 'tree';
      // A CHARGE lands twice — the Cavalier's whole idea is weight behind the blow. Everything else
      // bites once; this is what makes the card worth a slot.
      const blows = card.kind === 'doublestep' ? 2 : 1;
      const res = damageTree(next, x, y, blows);
      next.lungeAt = { x, y };
      // Felled it? Stride onto the cleared tile. Still standing? Bounce off it, landing beside it.
      if (res === 'felled') { p.x = x; p.y = y; collectKeyIfHere(next); }
      else bounceOffTarget(next, x, y, fromX, fromY);
      scored = res === 'felled';
      next.message = res === 'felled'
        ? (what === 'gate' ? 'The king leaps — the gate buckles and crashes down!' : 'The king leaps — the tree comes down in a crash of sticks and leaves!')
        : `The king hacks at the ${what} (${treeHpAt(next, x, y)}/${TREE_HP}).`;
      updateDiscovery(next); // a felled tree opens the view beyond it
    } else if (mainTarget && (mainTarget.boss || mainTarget.turret || mainTarget.parry)) {
      // A boss, turret, or WARDED foe (a Guardian's retinue) soaks the blow. The KILLING blow lets the king stride onto its now-empty tile
      // (grabbing any key it guarded); a survived hit lands him beside it (a leap first tries to
      // shove it back and take its square) — never leaving him frozen on his start tile.
      //
      // A CHARGE at something that can soak a blow lands TWICE. The whole idea of the Cavalier is
      // the weight behind it, and an adjacent guardian is exactly the moment the card should be
      // worth its slot.
      //
      // Two separate calls rather than damage(2), so every on-hit reaction fires per blow — a
      // Blinkborn flickers off after the first and the second finds nothing, a Shifting boss takes a
      // lesser form and THEN eats the second. That is what swinging twice means.
      const hit = () => {
        if (!mainTarget.boss && !mainTarget.turret && mainTarget.parry) return resolveKill(next, mainTarget) ? 'slain' : 'hurt'; // ward eats the first, next hoof fells it
        return mainTarget.boss ? damageBoss(next, mainTarget, 1) : damageTurret(next, mainTarget, 1);
      };
      let res = hit();
      const stillThere = () => next.enemies.some((e) => e.id === mainTarget.id && e.x === x && e.y === y);
      if (card.kind === 'doublestep' && res !== 'slain' && !next.gameOver && !next.won && stillThere()) {
        res = hit(); // the second hoof
      }

      survived = res !== 'slain';
      scored = !survived;
      realKill = scored && isKillablePiece(mainTarget); // a felled turret is not an on-kill
      // A foe struck THROUGH cover (embedded in a wall/ice) can't be stood upon — the king holds
      // his ground rather than striding onto or bouncing off it.
      if (move.embedded) { /* king stays put */ }
      else if (res === 'slain') { p.x = x; p.y = y; }
      else landBesideSurvivor(next, mainTarget, x, y, fromX, fromY, isLeap);
    } else if (mainTarget) {
      resolveKill(next, mainTarget);
      if (!move.embedded) { p.x = x; p.y = y; } // struck through cover → hold ground
      scored = true;
      realKill = isKillablePiece(mainTarget); // shattering a circle is not an on-kill
    } else {
      // No foe on the tile: a melee card can also be spent as a repositioning move
      // onto empty ground within reach.
      p.x = x;
      p.y = y;
      next.message = 'The king repositions.';
      if (isLeap && !p.phase) settleLeapOnIce(next, p, fromX, fromY); // a leap that lands on ice SKIDS off it (a phaser grips it)
    }
    // En Passant: after the step, strike one foe "in passing" (a piece that flanked the
    // ORIGIN square). `move.flanks[0]` is that target.
    if (card.kind === 'enpassant' && !next.gameOver && !next.won) {
      const passing = (move.flanks || [])[0];
      if (passing) {
        const felled = attackTile(next, passing.x, passing.y);
        if (felled) {
          scored = true;
          if (isKillablePiece(felled)) realKill = true;
        }
      }
      next.message = scored ? 'En passant — the king strikes as he slips by!' : 'The king slips past.';
    }
    // THUNDERING CHARGE (leapShock): when the king LANDS a knight leap, the shock of it goes through
    // the whole floor — every foe, turret and boulder he can SEE is hurled directly away from where
    // he came down. Not the ring around him: the room.
    //
    // Deliberately gated on a landed leap (`p.x === x`), so it is a thing he SETS UP rather than a
    // passive aura — a Cavalier lines the room up and then drops into the middle of it.
    if (isLeap && p.leapShock && p.x === x && p.y === y && !next.gameOver && !next.won) {
      thunderingCharge(next, x, y);
    }
    // On-kill perks fan out once (Cleave/Pierce/Leech/Flourish); Pierce strikes along
    // the king's line of advance.
    if (realKill && !next.gameOver && !next.won) {
      applyOnKill(next, x, y, Math.sign(x - fromX), Math.sign(y - fromY));
    }
    // A CHARGE (Double Step) gallops OVER the midpoint tile. If that tile is lava or fire, the king is
    // seared in passing — exactly as if he had ended a move on it (the tile he ENDS on is handled by
    // passTurn; this catches the one he only crossed). Skipped if he actually stopped ON the midpoint.
    if (card.kind === 'doublestep' && chebyshev(x, y, fromX, fromY) === 2 && (p.x !== fromX || p.y !== fromY) && !next.gameOver && !next.won) {
      const mx = fromX + Math.sign(x - fromX);
      const my = fromY + Math.sign(y - fromY);
      const mid = terrainAt(next, mx, my);
      const midBurns = mid === 'lava' || (next.burningTrees && next.burningTrees[`${mx},${my}`]) || hasTorch(next, mx, my);
      if (midBurns && !(mx === p.x && my === p.y)) {
        p.hp -= 1;
        p.wasHit = true; p.hitThisFloor = true;
        addSpatter(next, mx, my);
        addSmoke(next, mx, my);
        hurtBy(next, 'lava');
        p.burnedByFire = true;
        next.message = (next.message ? next.message + ' ' : '') + 'The fire sears the king as he charges across!';
        checkDeath(next);
      }
    }
  } else if (card.kind === 'horse') {
    // The Conjuration horse: a spectral steed charges the L-shaped path toward the aimed
    // knight tile — WITHOUT moving the king — scorching every foe along the L (leaving ash).
    for (const t of knightLPath(fromX, fromY, x - fromX, y - fromY, next)) {
      if (t.x < 0 || t.x >= WORLD_SIZE || t.y < 0 || t.y >= WORLD_SIZE) continue;
      impactTiles.push({ x: t.x, y: t.y });
      scorchGround(next, t.x, t.y); // the steed's spellfire burns the ground it charges over
      scorchTileTerrain(next, t.x, t.y); // ...and reacts with terrain like any spellfire: LIGHT timber, thaw ice, wither grass, blast a boulder
      dispelAllyAt(next, t.x, t.y);
      const felled = attackTile(next, t.x, t.y, { ash: true });
      if (felled) {
        if (t.x === x && t.y === y) scored = true;
        if (isKillablePiece(felled)) kills.push(felled);
      }
    }
    realKill = kills.length > 0; // Blast hurls survivors along the charge
    next.message = scored ? 'A spectral steed tramples through the ranks!' : 'The spectral steed charges past.';
  } else if (category === 'spell' && !move.viaJump) {
    // A sorcerer's bolt ALWAYS travels its FULL range in the aimed direction — every
    // tile out to `reach` is scorched, even past the nearest target (stopped only by a
    // wall or the board edge). The aimed tile just picks the direction.
    const reach = cardReach(card.kind, p.cardReach || 0);
    const dx = Math.sign(x - fromX);
    const dy = Math.sign(y - fromY);
    let cx = fromX;
    let cy = fromY;
    for (let i = 0; i < reach; i += 1) {
      cx += dx;
      cy += dy;
      if (cx < 0 || cx >= WORLD_SIZE || cy < 0 || cy >= WORLD_SIZE) break;
      const bt = terrainAt(next, cx, cy);
      if (bt === 'ice') { if (meltIce(next, cx, cy)) p.brokeIce = true; impactTiles.push({ x: cx, y: cy }); scored = true; break; } // fire thaws the slab to water and is spent
      if (bt === 'devilgrass') clearDevilgrass(next, cx, cy); // fire scorches the thicket away, then rages on
      if (bt === 'tree') { // fire doesn't blast a tree apart — it LIGHTS it, and the trunk stops the bolt
        igniteTree(next, cx, cy);
        impactTiles.push({ x: cx, y: cy });
        scored = true;
        break;
      }
      if ((bt === 'wall' || bt === 'boulder') && !p.seeThroughWalls) {
        break; // stone and boulders alike STOP the bolt — a boulder is spell-proof, never blasted to rubble
      }
      impactTiles.push({ x: cx, y: cy }); // every tile the fireball scorches
      scorchGround(next, cx, cy); // ...and it leaves its mark on the stone (boiling any water away)
      dispelAllyAt(next, cx, cy); // a piercing bolt dispels an ally in its path
      const felled = attackTile(next, cx, cy, { ash: true }); // spell kills leave ash
      if (felled) {
        if (cx === x && cy === y) scored = true; // struck the aimed tile (flavour)
        if (isKillablePiece(felled)) kills.push(felled);
      }
      // A FIREBALL does NOT pierce on: it DETONATES on the first foe it reaches (its burst centre) and
      // strikes that tile exactly once here. Everything else is caught by the ring of eight AROUND it
      // (below), so no tile is ever hit twice — the bolt hits the target, the burst hits its neighbours.
      if (card.kind === 'fireball' && fireballCentre && cx === fireballCentre.x && cy === fireballCentre.y) break;
    }
    realKill = kills.length > 0; // Blast: hurl any survivor along the bolt's path (farthest-first)
    if (!next.gameOver && !next.won && p.spellDazzle) {
      for (const s of kills) {
        for (const [dx2, dy2] of [...ORTHO, ...DIAG]) {
          const e = next.enemies.find((en) => en.x === s.x + dx2 && en.y === s.y + dy2);
          if (e && !e.boss && unitInSight(next, e.x, e.y)) e.awake = false;
        }
      }
    }
  } else {
    // Ranged (or a spell fired via a leap): a single shot that strikes only the target.
    dispelAllyAt(next, x, y);
    const mainFelled = attackTile(next, x, y);
    if (mainFelled) {
      scored = true;
      if (isKillablePiece(mainFelled)) kills.push(mainFelled);
    }
    realKill = kills.length > 0;
  }

  // Record the shot so the view can fly a projectile (arrow / bolt) from the king to the
  // target before the hit resolves. Only ranged/spell weapon cards fire one.
  if (category !== 'melee') {
    next.lastShot = {
      fromX, fromY, toX: x, toY: y,
      role: category === 'ranged' ? 'arrow' : 'fireball',
      tiles: category === 'spell' && impactTiles.length ? impactTiles : null,
    };
  }

  if (category === 'spell' && p.spellSurprise && !next.gameOver && !next.won) {
    for (const e of next.enemies) {
      // A gun does not gasp, and neither does a rune cut into the floor — there are no wits there to
      // scatter. A floor guardian is too mighty to be caught out by a light show.
      if (e.boss || e.turret || e.summonCircle) continue;
      if (!unitInSight(next, e.x, e.y)) continue;
      // startle(), NOT `awake = false`. beginEnemyPhase only lets a piece gasp if it has genuinely
      // lost him (`!remembersKing`), and clearing `awake` alone leaves its memory of him untouched —
      // so every foe actually CHASING him re-engaged at once without missing a beat. Cataclysm did
      // nothing whatever to the only foes it mattered against; it worked solely on pieces that had
      // already lost him, which had nothing to gasp about.
      startle(e);
    }
  }

  // Recoil (Marksman): a ranged/spell shot kicks the archer one tile back, away from the
  // target — landing on (and capturing) a foe there if one blocks the step — then a shockwave
  // SHOVES every adjacent foe back one tile (colliding with whatever's behind it).
  if (p.recoil && category !== 'melee' && !next.gameOver && !next.won) {
    const originX = p.x; // where he STOOD when he loosed the shot — the shockwave's true centre
    const originY = p.y;
    const rdx = Math.sign(p.x - x);
    const rdy = Math.sign(p.y - y);
    if (rdx || rdy) {
      const bx = p.x + rdx;
      const by = p.y + rdy;
      if (bx >= 0 && bx < WORLD_SIZE && by >= 0 && by < WORLD_SIZE && standableFor(terrainAt(next, bx, by), {})) {
        const foe = next.enemies.find((e) => e.x === bx && e.y === by);
        if (!foe) {
          p.x = bx;
          p.y = by;
        } else if (foe.summonCircle) {
          // Shoved back ONTO a summoning circle — he comes down on the rune and shatters it, exactly as
          // if he had stepped onto it. (It used to HALT the recoil, because a circle is not "capturable"
          // and never moves aside, so the kick simply fizzled against it.)
          resolveKill(next, foe);
          p.x = bx;
          p.y = by;
          next.message = 'The recoil flings the king back onto a summoning circle — it shatters!';
        } else if (isCapturable(next, foe)) {
          if (attackTile(next, bx, by)) {
            p.x = bx;
            p.y = by;
          }
        }
        // A wall/lava/edge or an untouchable turret behind him simply halts the recoil.
      }
    }
    // Shockwave: shove every MOBILE foe (and loose boulder) that was FORMERLY adjacent to him —
    // i.e. crowding his FIRING tile — back one tile, away from that spot. Anchoring on the firing
    // position (not his landing) means kicking back toward a foe that stood two tiles off no
    // longer rolls the king up next to it and wrongly punts it.
    shoveAdjacentAway(next, originX, originY, null);
  }

  // FIREBALL (Conjuration T3): the bolt BURSTS where it lands — spellfire washes over every tile
  // around the target. Indiscriminate on purpose: it burns the king and his own allies if they are
  // standing in the ring. That is the price of its reach, and the reason it isn't just a better
  // rook card.
  if (card.kind === 'fireball' && fireballCentre && !next.gameOver && !next.won) {
    const burst = [];
    const bcx = fireballCentre.x;
    const bcy = fireballCentre.y;
    for (const [dx, dy] of [...ORTHO, ...DIAG]) {
      if (next.gameOver || next.won) break;
      const fx = bcx + dx;
      const fy = bcy + dy;
      if (fx < 0 || fx >= WORLD_SIZE || fy < 0 || fy >= WORLD_SIZE) continue;
      burst.push({ x: fx, y: fy });
      scorchGround(next, fx, fy); // spellfire blackens the ground and boils off water
      if (next.player.x === fx && next.player.y === fy) {
        // His OWN blast. No parry, no ward: this is his fire, and he chose to stand in it.
        next.player.hp -= 1;
        next.player.wasHit = true;
        next.player.hitThisFloor = true;
        addSpatter(next, fx, fy);
        checkDeath(next);
        if (next.gameOver) break;
      }
      dispelAllyAt(next, fx, fy); // his own conjurations burn just as readily
      const felled = attackTile(next, fx, fy, { ash: true });
      if (felled) { scored = true; if (isKillablePiece(felled)) realKill = true; }
    }
    if (next.lastShot) next.lastShot.tiles = [...(next.lastShot.tiles || []), { x: bcx, y: bcy }, ...burst];
  }

  // EXPLOSIVE ROUND (Marksman T3): a ranged/spell shot DETONATES on impact — every foe around the
  // tile it hit is HURLED a tile OUTWARD (slamming into whatever is behind it — see Knockback),
  // rather than simply struck. Reworked from Shrapnel, which just damaged the ring and so did
  // almost exactly what the Conjurer's Fireball does; a shove is a different tool.
  if (p.shrapnel && category !== 'melee' && !next.gameOver && !next.won) {
    const frags = [];
    for (const [dx, dy] of [...ORTHO, ...DIAG]) {
      const fx = x + dx;
      const fy = y + dy;
      if (fx < 0 || fx >= WORLD_SIZE || fy < 0 || fy >= WORLD_SIZE) continue;
      frags.push({ x: fx, y: fy });
    }
    // Snapshot WHO is caught before shoving anyone: hurling the first foe must not change which
    // others the blast catches (a shoved foe could otherwise be blown twice, or dodge the ring).
    const caught = next.enemies.filter((e) => !e.summonCircle && chebyshev(e.x, e.y, x, y) === 1);
    for (const e of caught) {
      if (next.gameOver || next.won) break;
      knockbackEnemy(next, e, Math.sign(e.x - x), Math.sign(e.y - y));
    }
    if (next.lastShot) next.lastShot.tiles = [...(next.lastShot.tiles || []), { x, y }, ...frags]; // a burst at impact
  }

  // A melee reposition / En-Passant dash / Recoil can carry the king onto the key.
  collectKeyIfHere(next);
  // A melee card that fells the guardian leaves the king on the stair: descend.
  if (tryDescend(next)) {
    updateDiscovery(next);
    return next;
  }

  // Quick Draw (rangedRapid): a real-piece kill grants ONE immediate free follow-up.
  const rapidFollowup = Boolean(card.rapidReady);
  card.rapidReady = false;
  const rapidTrigger = category === 'ranged' && p.rangedRapid && realKill && !rapidFollowup;
  if (rapidTrigger) card.rapidReady = true;

  // Double Cast (Conjuration T3): after the FIRST spell shot, if a targetable foe still
  // stands, the caster stays up to fire ONCE more before the turn passes. The follow-up
  // shot — or cancelling it (see main.js) — ends the turn. The card only goes on cooldown
  // once the sequence completes, so it isn't double-charged.
  const doubleFollowup = Boolean(card.doubleReady);
  card.doubleReady = false;
  const canDoubleCast = category === 'spell' && p.doubleCast && !doubleFollowup
    && !next.gameOver && !next.won && spellCanHitFoe(next, card); // only if a real UNIT still stands (not just terrain)
  if (canDoubleCast) card.doubleReady = true;

  const free = (category === 'spell' && p.freeSpell) || rapidTrigger || canDoubleCast;
  if (!rapidTrigger && !canDoubleCast) {
    card.remaining = card.cooldown;
    // The turn this card fires does NOT tick its cooldown, so the bar shows the FULL
    // cooldown right after use (then counts down each following turn). Free casts skip
    // passTurn entirely, so they need no flag.
    if (!free) card.justFired = true;
  }
  // Keen Edge (meleeRefund): a card that scored a kill recharges far faster — its remaining
  // cooldown is CUT BY HALF (rounded down), not merely shaved by one.
  if (category === 'melee' && realKill && p.meleeRefund) card.remaining -= Math.floor(card.remaining / 2);
  if (!scored && !next.message) next.message = 'The card strikes.';
  if (free) {
    next.enemyTurn = false;
    // A pending double-cast keeps the caster up to aim a second shot (main.js re-opens
    // targeting); other free casts just yield a bonus action.
    next.lastAction = canDoubleCast ? 'card-followup' : 'card-free';
    if (canDoubleCast) next.message = 'The bolt flies — aim again, or cancel to end your turn.';
  } else {
    passTurn(next);
    next.enemyTurn = true;
    next.lastAction = 'combat';
  }
  updateDiscovery(next);
  return next;
}

// Does this spell card have a UNIT it could actually strike from here — a real foe on one of its
// firing lines, not merely a slab of ice or a tree to burn? Double Cast keys off this: a second cast
// is only offered while a TARGET (a body) remains, never just to blast leftover terrain.
function spellCanHitFoe(state, card) {
  const p = state.player;
  const reach = cardReach(card.kind, p.cardReach || 0);
  const shootWalls = Boolean(p.seeThroughWalls);
  const dirs = new Set();
  for (const m of getCardMoves(state, card)) dirs.add(`${Math.sign(m.x - p.x)},${Math.sign(m.y - p.y)}`);
  for (const key of dirs) {
    const [dx, dy] = key.split(',').map(Number);
    if (!dx && !dy) continue;
    for (let i = 1; i <= reach; i += 1) {
      const x = p.x + dx * i;
      const y = p.y + dy * i;
      if (x < 0 || x >= WORLD_SIZE || y < 0 || y >= WORLD_SIZE) break;
      if (state.enemies.some((e) => e.x === x && e.y === y && isCapturable(state, e) && !e.summonCircle)) return true;
      const t = terrainAt(state, x, y);
      if (t === 'wall' || t === 'boulder') { if (!shootWalls) break; } // opaque cover stops the bolt
      else if (t === 'ice' || t === 'tree') break; // the bolt is spent on the slab / trunk — no body here
    }
  }
  return false;
}

// End a turn that a Double Cast left hanging: the caster loosed one bolt and then either
// fired his bonus shot or declined it. Put the (single-fired) card on cooldown and pass
// the turn so the enemy phase runs. Used by the UI when the follow-up is cancelled or
// no target remains.
function finishFollowup(state) {
  const next = structuredClone(state);
  for (const c of next.player.cards || []) {
    if (c.doubleReady) {
      c.doubleReady = false;
      c.remaining = c.cooldown; // the one shot still spent the card
      c.justFired = true; // show its full cooldown after passTurn ticks
    }
  }
  passTurn(next);
  next.enemyTurn = true;
  next.lastAction = 'wait';
  return next;
}

// Move the king to a specific reachable tile (click-to-move).
function movePlayerTo(state, x, y) {
  const next = structuredClone(state);
  const move = getPlayerMoves(next).find((m) => m.x === x && m.y === y);
  if (!move) {
    next.message = 'The king cannot reach that tile.';
    next.lastAction = 'blocked';
    return next;
  }
  if (move.push) return resolveBoulderPush(next, x, y); // shove the boulder standing there
  if (move.chop) return resolveTreeChop(next, x, y); // hack at the tree standing there
  if (move.pitDive) return resolvePitDive(next, x, y); // stranded: drop into the pit and scramble out
  return applyArrival(next, x, y, move.embedded);
}

// The king, otherwise STRANDED, drops into an adjacent pit and hauls himself out the nearest solid
// side — a wound for the fall, then up onto the closest footing. His only escape from a would-be
// stalemate when a pit is all that borders him. Offered by getPlayerMoves only with no other move.
function resolvePitDive(next, x, y) {
  const p = next.player;
  p.pitDived = true; // badge ledger: he escaped a corner through the void
  cue(next, 'fall');
  hurtBy(next, 'pit');
  p.hp -= 1;
  p.wasHit = true; p.hitThisFloor = true;
  checkDeath(next);
  if (!next.gameOver) {
    const out = nearestFooting(next, x, y, p.x, p.y); // never back into the corner he just fled
    if (out) { p.x = out.x; p.y = out.y; }
    collectKeyIfHere(next);
    next.message = 'Cornered, the king drops into the pit and hauls himself out the far side!';
    next.lastAction = 'hit';
    if (tryDescend(next)) { updateDiscovery(next); return next; } // he might surface onto the open stair
  } else {
    next.message = 'The king drops into the pit — and does not climb out.';
    next.lastAction = 'hit';
  }
  next.enemyTurn = true;
  passTurn(next);
  updateDiscovery(next);
  return next;
}

// Resolve the king hacking at a tree: one wound a swing, and he holds his tile (a tree is solid
// until it falls). It IS an attack — it breaks Silence and raises no Parry guard — and the felling
// blow leaves sticks and leaves, not a corpse: a tree is scenery, so it grants no boon and counts
// toward nothing.
function resolveTreeChop(next, x, y) {
  const p = next.player;
  p.attacked = true;
  const what = terrainAt(next, x, y) === 'gate' ? 'gate' : 'tree';
  const res = damageTree(next, x, y, 1);
  next.message = res === 'felled'
    ? (what === 'gate' ? 'The gate buckles and crashes down!' : 'The king fells the tree — it comes down in a crash of sticks and leaves!')
    : `The king hacks at the ${what} (${treeHpAt(next, x, y)}/${TREE_HP}).`;
  next.lastAction = 'combat';
  passTurn(next);
  next.enemyTurn = true;
  updateDiscovery(next); // a felled tree opens the view beyond it
  return next;
}

// Resolve the king heaving a boulder. A successful shove spends the turn like a move; a FUTILE
// shove against an immovable boulder spends NO turn — it just BUMPS (like walking into a wall).
function resolveBoulderPush(next, x, y) {
  const p = next.player;
  const dx = Math.sign(x - p.x);
  const dy = Math.sign(y - p.y);
  p.attacked = false;
  cue(next, 'rumble'); // stone grinding on stone — whether it MOVES or he merely strains against it
  if (!canPushBoulder(next, x, y, dx, dy)) {
    // Heaving against an immovable boulder (wall/unit/edge behind it) still SPENDS the turn —
    // you strained and the enemy phase runs. (Walking into a wall is the no-turn "bump"; a
    // committed shove is not.)
    next.message = 'The boulder will not budge — you shove in vain.';
    next.lastAction = 'boulder-stuck'; // spends the turn; the view still vibrates the king + boulder
    passTurn(next);
    next.enemyTurn = true;
    updateDiscovery(next);
    return next;
  }
  pushBoulder(next, x, y, dx, dy);
  next.message = 'The king heaves a boulder aside.';
  next.lastAction = 'move';
  collectKeyIfHere(next);
  if (tryDescend(next)) {
    updateDiscovery(next);
    return next;
  }
  passTurn(next);
  next.enemyTurn = true;
  updateDiscovery(next);
  return next;
}

// Keyboard movement: a single ground step in a direction.
function movePlayer(state, dx, dy) {
  // Stepping into a boulder shoves it; stepping into a TREE chops it. Both are actions against a
  // tile the king can never STAND on, so neither is a "move" — and without routing them here they
  // fall through to the slide below, find no stop, and come back "the king cannot move that way".
  // (This is exactly what happened to trees: movePlayerTo offered the chop, but nothing walking in
  // with a direction ever reached it.)
  const ahead = terrainAt(state, state.player.x + dx, state.player.y + dy);
  // A boulder is shoved, timber/iron is chopped, and a PIT is dived into (movePlayerTo enforces that
  // the dive is only legal when he is stranded — otherwise it just reports he cannot go that way).
  if (ahead === 'boulder' || isChoppable(ahead) || ahead === 'pit') {
    return movePlayerTo(state, state.player.x + dx, state.player.y + dy);
  }
  const enemyAt = (x, y) => state.enemies.find((e) => e.x === x && e.y === y) || allyAt(state, x, y) || null;
  const isEnemy = (x, y) => capturableAt(state, x, y) || Boolean(allyAt(state, x, y));
  // Slide the king's FULL move range (normally 1), stopping only on collision —
  // the furthest reachable stop is the destination.
  const stops = slideStops(state, state.player.x, state.player.y, dx, dy, state.player.moveRange, enemyAt, isEnemy, { pathfinder: Boolean(state.player.pathfinder), phaseWalls: Boolean(state.player.phase) });
  if (!stops.length) {
    const next = structuredClone(state);
    next.message = 'The king cannot move that way.';
    next.lastAction = 'blocked';
    return next;
  }
  const dest = stops[stops.length - 1];
  return movePlayerTo(state, dest.x, dest.y);
}

// DISCIPLINE (the Warrior's innate trait): hold your ground for a turn. The king strikes nothing and
// stays put, so the enemy phase runs and foes close on him — a way to bait a charge, wait out a
// cooldown, or (ending a turn without a blow) bank a Sentinel's Parry guard. Only ever reached when
// the king actually has the trait; the input layer gates it.
function skipTurn(state) {
  // NOTHING TO WAIT FOR. Holding your ground with an empty screen burns turns — and the dread clock —
  // for no gain, and it is far too easy to lean on the key and lose a dozen of them without noticing.
  // So the hold is refused outright unless at least one foe is actually in sight; "let them come to
  // you" only means anything once there is a them. Refused as a `blocked` action: it costs no turn,
  // beeps, and says why.
  if (typeof getVisibleEnemies === 'function' && getVisibleEnemies(state).length === 0) {
    const blocked = structuredClone(state);
    blocked.message = 'Nothing in sight to hold your ground against — you only wait when a foe is coming.';
    blocked.lastAction = 'blocked';
    blocked.enemyTurn = false;
    return blocked;
  }
  const next = structuredClone(state);
  const p = next.player;
  p.attacked = false; // he swung at nothing — passTurn raises a Parry guard on this
  // WAITING (Sentinel): holding his ground turns him invincible until his next turn — set BEFORE
  // passTurn so even a lava/torch sear on the wait tile is shrugged off. settleTurn clears it once the
  // enemy phase has run.
  if (p.waiting) p.invuln = true;
  next.message = p.waiting ? 'The king holds his ground — untouchable.' : 'The king holds his ground.';
  next.lastAction = 'move'; // a spent, non-combat turn (no bump, no beep)
  passTurn(next);
  next.enemyTurn = true;
  updateDiscovery(next);
  return next;
}

/* --------------------------------- allies --------------------------------- */

// Place an ally on (x,y) or, failing that, an adjacent free tile — never the king, an
// enemy, another ally, or the floor key. Returns the placed ally, or null if hemmed in.
function spawnAllyNear(state, kind, x, y, props) {
  cue(state, 'thrum'); // something is being pulled into the world
  if (!Array.isArray(state.allies)) state.allies = [];
  const spots = [{ x, y }];
  for (const [dx, dy] of [...ORTHO, ...DIAG]) spots.push({ x: x + dx, y: y + dy });
  for (const s of spots) {
    if (s.x < 0 || s.x >= WORLD_SIZE || s.y < 0 || s.y >= WORLD_SIZE) continue;
    if (!isStandable(terrainAt(state, s.x, s.y))) continue;
    if (s.x === state.player.x && s.y === state.player.y) continue;
    if (state.enemies.some((e) => e.x === s.x && e.y === s.y)) continue;
    if (allyAt(state, s.x, s.y)) continue;
    if (keyTileAt(state, s.x, s.y)) continue;
    const ally = { id: `ally-${Math.random().toString(36).slice(2)}`, kind, x: s.x, y: s.y, ...(props || {}) };
    state.allies.push(ally);
    return ally;
  }
  return null;
}

// The king's summons are one-hit wisps — EXCEPT the General (Necromancy T3), a proper lieutenant
// carrying a mini-boss's pool of wounds, which is what makes the upgrade worth its tier.
function allyProps(kind, extra) {
  const props = { ...(extra || {}) };
  if (kind === 'vampiress') { props.hp = VAMPIRESS_HP; props.maxHp = VAMPIRESS_HP; }
  return props;
}

// Wound an ALLY by `amount`. A wisp dies to the first blow; the General soaks its HP pool first.
// Returns true if it FELL (the caller lays down the blood/corpse either way it likes).
function damageAlly(state, ally, amount) {
  if (!ally) return false;
  if (ally.maxHp) {
    ally.hp = (ally.hp || 0) - (amount || 1);
    if (ally.hp > 0) return false; // it holds the line
  }
  state.allies = (state.allies || []).filter((a) => a.id !== ally.id);
  return true;
}

// Summon (or resummon) the familiar beside the king — a skeletal MANN (a non-royal king: one
// step any direction, so it can actually keep up through doors and corners), or a General once
// upgraded. No-op if one already lives.
function spawnFamiliar(state) {
  if (!state.player.familiar || hasLivingFamiliar(state)) return null;
  const kind = state.player.generalForm ? 'vampiress' : 'king'; // the risen familiar is a (non-royal) king
  return spawnAllyNear(state, kind, state.player.x, state.player.y, allyProps(kind, { familiar: true }));
}

// The familiar returns once the coast is clear (no foe in sight).
function maybeRespawnFamiliar(state) {
  if (state.player.familiar && !hasLivingFamiliar(state) && getVisibleEnemies(state).length === 0) {
    spawnFamiliar(state);
  }
}

// The move (from `moves`) that steps CLOSEST to (tx,ty), skipping `blocked` tiles — or
// null if none beats standing still.
// A true walking distance to (tx,ty) for every tile an ally could stand on — flooded OUT from the
// target, so following it downhill is a real path round corners and through doorways.
//
// Passability mirrors what moveAlly's own generator allows (`lavaOk: false` — the king's summons are
// not fire-proof), so the field can never route it somewhere its legs refuse to go. Bodies are NOT
// obstacles here: they shuffle every turn, and treating them as walls made allies dither in a crowd.
function allyPathField(state, tx, ty) {
  const W = WORLD_SIZE;
  const dist = new Int16Array(W * W).fill(-1);
  const id = (x, y) => y * W + x;
  const open = (x, y) => x >= 0 && x < W && y >= 0 && y < W && standableFor(terrainAt(state, x, y), { lavaOk: false });
  if (!open(tx, ty)) {
    // The target itself is somewhere no ally can stand (the king wading in lava, phased into a
    // wall). Flood from the ground AROUND it instead, so it still walks to him rather than freezing.
    const q0 = [];
    for (const [dx, dy] of [...ORTHO, ...DIAG]) {
      const x = tx + dx;
      const y = ty + dy;
      if (open(x, y)) { dist[id(x, y)] = 1; q0.push([x, y]); }
    }
    return floodFrom(state, dist, id, open, q0);
  }
  dist[id(tx, ty)] = 0;
  return floodFrom(state, dist, id, open, [[tx, ty]]);
}

function floodFrom(state, dist, id, open, queue) {
  let h = 0;
  while (h < queue.length) {
    const [x, y] = queue[h];
    h += 1;
    const d = dist[id(x, y)];
    for (const [dx, dy] of [...ORTHO, ...DIAG]) {
      const nx = x + dx;
      const ny = y + dy;
      if (!open(nx, ny) || dist[id(nx, ny)] !== -1) continue;
      dist[id(nx, ny)] = d + 1;
      queue.push([nx, ny]);
    }
  }
  return { dist, id };
}

// The move that actually gets an ally CLOSER to (tx,ty) along the floor.
//
// This used to accept only a move that shortened the straight-line distance — so the instant
// anything stood between an ally and its target, no move qualified and it simply stopped. A wall, a
// boulder, a lake: the familiar pinned itself against the thing and stayed there for the rest of the
// floor while the king walked off. (Measured: 30 turns against a wall with an open gap four tiles
// away, one tile moved, and it mirrored the king's every step from where it stood.)
//
// It now reads a flood from the target, so "closer" means closer THE WAY IT WOULD HAVE TO WALK.
function allyStepToward(state, moves, ax, ay, tx, ty, blocked) {
  const { dist, id } = allyPathField(state, tx, ty);
  const here = dist[id(ax, ay)];
  let best = null;
  let bestD = here >= 0 ? here : Infinity; // unreachable from here: any step that IS on the path beats standing
  for (const m of moves) {
    if (blocked(m.x, m.y)) continue;
    const d = dist[id(m.x, m.y)];
    if (d < 0) continue; // that tile cannot reach the target at all
    if (d < bestD) { bestD = d; best = m; }
  }
  // Nothing on the floor leads there (a sealed pocket, or it is already as close as the floor
  // allows). Fall back to the old straight-line hunch rather than freeze — at worst it shuffles.
  if (!best && here < 0) {
    let bd = distanceSq(ax, ay, tx, ty);
    for (const m of moves) {
      if (blocked(m.x, m.y)) continue;
      const d = distanceSq(m.x, m.y, tx, ty);
      if (d < bd) { bd = d; best = m; }
    }
  }
  return best;
}

// One ally's turn: strike a foe it can reach, else advance on the nearest visible foe,
// else heel to the king. Allies see what the king sees.
function moveAlly(state, ally) {
  const king = state.player;
  const enemyHere = (x, y) => state.enemies.find((e) => e.x === x && e.y === y) || null;
  const unitAt = (x, y) => {
    if (x === king.x && y === king.y) return 'king';
    if (keyTileAt(state, x, y)) return 'key';
    const other = allyAt(state, x, y);
    if (other && other.id !== ally.id) return other;
    return enemyHere(x, y);
  };
  const isTarget = (x, y) => {
    const e = enemyHere(x, y);
    return Boolean(e) && isCapturable(state, e);
  };
  // The king's summons are NOT lava-immune, so they keep off it (lavaOk: false).
  const moves = generateMoves(ally.kind, state, ally.x, ally.y, unitAt, isTarget, { lavaOk: false });
  const cap = moves.find((m) => isTarget(m.x, m.y));
  if (cap) {
    const foe = enemyHere(cap.x, cap.y);
    if (foe) {
      const mx = Math.sign(foe.x - ally.x);
      const my = Math.sign(foe.y - ally.y);
      // Route an ally's blow EXACTLY as the king's is routed: a foe with an HP pool (a guardian,
      // a mini-boss, a turret) must be worn down over several blows. This used to filter the foe
      // straight out of existence, so a familiar one-shot the 14-HP finale guardian.
      let slain = true;
      if (foe.boss) {
        slain = damageBoss(state, foe, 1) === 'slain';
        if (!slain) state.message = `Your ${ally.kind} tears into ${bossTitle(foe)} (${foe.hp}/${foe.maxHp}).`;
      } else if (foe.turret) {
        slain = damageTurret(state, foe, 1) === 'slain';
        if (!slain) state.message = `Your ${ally.kind} batters the ${foe.kind} turret (${foe.hp}/${foe.maxHp}).`;
      } else {
        state.enemies = state.enemies.filter((e) => e.id !== foe.id);
        addSpatter(state, foe.x, foe.y, mx, my, isDemonKind(foe.kind));
        addCorpse(state, foe.x, foe.y, foe.kind);
      }
      bloody(ally, BLOOD_STRIKE); // the ally is spattered by its blow
      // The VAMPIRESS feeds on what she fells: each kill knits another wound shut, so a queen left
      // alive grows into the most dangerous thing on the floor. Capped so she cannot run away with it.
      // She feeds on BLOOD. A turret is dead metal and a summoning circle is a rune scratched in the
      // floor — there is nothing in either to drink, so breaking one never grows her. (isKillablePiece
      // draws exactly this line already, and is what keeps the king's own Vampiric Edge off turrets.)
      // She MENDS on a kill, up to her own maximum — she does not grow past it. Feeding used to raise
      // her cap as well, so a queen left alive quietly became the stoutest thing on the floor; the
      // point of her is that she keeps herself alive, not that she outgrows everything.
      if (slain && isKillablePiece(foe) && ally.kind === 'vampiress' && ally.maxHp && ally.hp < ally.maxHp) {
        ally.hp = Math.min(ally.maxHp, (ally.hp || 0) + 1);
        state.message = `Your vampiress drinks deep (${ally.hp}/${ally.maxHp}).`;
      }
      if (slain) { ally.x = cap.x; ally.y = cap.y; } // it only takes the tile if the foe actually FELL
    }
    return;
  }
  // WHAT IT IS ALLOWED TO FIGHT: only what the KING can see. getVisibleEnemies is his sight, not the
  // ally's — which is deliberate. An ally that went hunting things off in the dark wandered away
  // from him after foes the player did not know existed, and the first he heard of it was his
  // familiar dying somewhere he could not see. It fights beside him or it comes back to him.
  const foes = getVisibleEnemies(state);
  const blocked = (x, y) => isTarget(x, y);
  if (foes.length) {
    let target = foes[0];
    for (const f of foes) if (distanceSq(f.x, f.y, ally.x, ally.y) < distanceSq(target.x, target.y, ally.x, ally.y)) target = f;
    const step = allyStepToward(state, moves, ally.x, ally.y, target.x, target.y, blocked);
    if (step) { ally.x = step.x; ally.y = step.y; return; }
    // It cannot get at that foe (walled off, boxed in). Rather than stand there staring at it,
    // fall through and go to the king — which is what it should be doing anyway.
  }
  if (chebyshev(ally.x, ally.y, king.x, king.y) > 1) {
    const step = allyStepToward(state, moves, ally.x, ally.y, king.x, king.y, blocked);
    if (step) { ally.x = step.x; ally.y = step.y; }
  }
}

// The allies' turn: respawn a lost familiar, then move each ally once.
function advanceAllies(state) {
  maybeRespawnFamiliar(state);
  for (const ally of (state.allies || []).slice()) {
    if ((state.allies || []).includes(ally)) moveAlly(state, ally);
  }
}

// The ally phase as a fresh state (the controller runs it AFTER the foes have moved).
function runAllyPhase(state) {
  const next = structuredClone(state);
  advanceAllies(next);
  return next;
}

// A player AOE that crosses an ally's tile dispels it.
function dispelAllyAt(state, x, y) {
  if (state.allies) state.allies = state.allies.filter((a) => !(a.x === x && a.y === y));
}

/* ------------------------------ enemy phase ------------------------------- */

// SILENCE: lull every foe the king can SEE into a dead sleep. Turrets and circles are masonry, not
// creatures, and have their own dozing rules; a GUARDIAN is not spared, because the window ends the
// moment he strikes anything — so it can buy him out of a boss room, never through one.
function applySilence(state) {
  const p = state.player;
  if (!(p.silence > 0)) return;
  for (const enemy of state.enemies) {
    if (enemy.turret || enemy.summonCircle) continue;
    if (enemy.provoked) continue; // a foe the king has STRUCK stays awake — the hush only holds what he leaves be
    if (!unitInSight(state, enemy.x, enemy.y)) continue;
    enemy.asleep = true;
    enemy.hushed = true; // THIS spell put it down — so only this spell gets to pick it back up
    enemy.awake = false;
    enemy.surprised = false;
    enemy.lastSeen = null;
    enemy.lastSeenTtl = 0;
  }
}

// An unaware enemy shuffles one tile at random. Normally it steers clear of the king's
// sight (so it only pokes into view when the KING moves, and is reliably surprised). When
// `hidden` (this foe failed its Ghost roll and can't perceive him at all), it roams freely and may
// BLUNDER onto his tile — bumping (striking) him and waking at last.
// `hidden`: the king cannot be sensed (Camouflage), so the foe blunders about freely and may walk
// into him by accident. `roamFreely`: this piece has no interest in hiding from him at all.
function wanderEnemy(state, enemy, hidden, roamFreely) {
  const king = state.player;
  const unitAt = (x, y) => {
    if (x === king.x && y === king.y) return hidden ? null : 'player'; // a hidden king isn't sensed
    if (keyTileAt(state, x, y)) return 'key'; // enemies never path onto the floor key
    if (allyAt(state, x, y)) return 'ally';
    return state.enemies.find((other) => other.id !== enemy.id && other.x === x && other.y === y) || null;
  };
  const never = () => false;
  // Keyed to the PIECE, not the floor: a mortal summoned onto a demon floor burns just the same,
  // and a floor-wide flag let it wander into fire it could not survive.
  const opts = { lavaOk: isLavaSafe(enemy) };
  const candidates = [];
  for (const [dx, dy] of [...ORTHO, ...DIAG]) {
    const stops = slideStops(state, enemy.x, enemy.y, dx, dy, 1, unitAt, never, opts);
    if (!stops.length) continue;
    const dest = stops[stops.length - 1];
    // An unaware foe steers clear of tiles from which the KING would spot it — but by its
    // OWN (wall-blocked) sight line, so Sixth Sense doesn't make it cower behind walls.
    //
    // `roamFreely` opts out of that entirely, and a NEUTRAL BEAST must: it is not sneaking, it
    // simply does not care about him. Made to cower, one standing inside his sight window had
    // nowhere at all it was willing to step and froze solid — every wild horse on screen turned
    // into a statue the moment he looked at it.
    if (hidden || roamFreely || !enemyAwareOfKing(state, dest.x, dest.y)) candidates.push(dest);
  }
  if (!candidates.length) {
    // BOXED IN. A wanderer hemmed in by timber and iron does not stand there forever — it takes an axe
    // to whatever pens it. Only ever as a LAST resort (no step it was willing to take), so a foe with
    // open ground around it never starts felling the scenery; and only for a foe that is actually
    // wandering, never a neutral beast, which has no quarrel with a hedge.
    if (!roamFreely) {
      const blockers = [];
      for (const [dx, dy] of [...ORTHO, ...DIAG]) {
        const bx = enemy.x + dx;
        const by = enemy.y + dy;
        if (bx < 0 || bx >= WORLD_SIZE || by < 0 || by >= WORLD_SIZE) continue;
        const t = terrainAt(state, bx, by);
        if (t === 'tree' || t === 'gate') blockers.push({ x: bx, y: by, gate: t === 'gate' });
      }
      if (blockers.length) {
        const hit = blockers[randomInt(blockers.length)];
        const res = damageTree(state, hit.x, hit.y, 1);
        // Only SAY so if he can see it happen — otherwise every penned foe on the floor narrates its
        // woodcutting into his log from three rooms away.
        if (inLineOfSight(state, hit.x, hit.y)) {
          const what = hit.gate ? 'gate' : 'tree';
          state.message = res === 'felled'
            ? `A ${enemy.kind} hacks down a ${what}, forcing its way through!`
            : `A ${enemy.kind} hammers at a ${what}, penned in.`;
        }
        if (res === 'felled') updateDiscovery(state);
      }
    }
    return null;
  }
  const pick = candidates[randomInt(candidates.length)];
  if (hidden && pick.x === king.x && pick.y === king.y) {
    // It walks straight into the hidden king — an accidental blow that gives him away.
    strikeKing(state, enemy);
    enemy.awake = true;
    rememberKing(state, enemy);
    return true; // it BUMPED the king
  }
  enemy.x = pick.x;
  enemy.y = pick.y;
  return false;
}

// The tiles this enemy could move to like its piece, WITHOUT capturing — for
// pursuing the king's last-seen tile.
function movesTowardTile(state, enemy) {
  const unitAt = (x, y) => {
    if (x === state.player.x && y === state.player.y) return 'player';
    if (keyTileAt(state, x, y)) return 'key'; // pursuers never path onto the floor key
    return state.enemies.find((o) => o.id !== enemy.id && o.x === x && o.y === y) || null;
  };
  const never = () => false;
  // Keyed to the PIECE, not the floor: a mortal summoned onto a demon floor burns just the same,
  // and a floor-wide flag let it wander into fire it could not survive.
  const opts = { lavaOk: isLavaSafe(enemy) };
  return generateMoves(enemy.kind, state, enemy.x, enemy.y, unitAt, never, opts);
}

// A flood-fill of king-step distances from (tx,ty) over every tile THIS piece could stand on, so a
// pursuer can be steered AROUND walls toward the target instead of giving up the instant the straight
// line to it is blocked. This is what makes a foe follow the king round a corner or down a corridor,
// rather than shuffling toward the wall between them and then wandering off. Cached per (state,piece).
function navFieldTo(state, tx, ty, enemy) {
  const opts = pieceTerrainOpts(enemy);
  const phases = Boolean(opts.phaseWalls);
  const leaper = typeof isJumperKind === 'function' && isJumperKind(enemy.kind); // knights/nightriders land on ice/boulders
  // The flood only spreads over ground THIS piece could actually cross, so the distance it hands back
  // routes AROUND what the piece can't traverse — a walker goes the long way round a ring of ice, a
  // non-flier around a pit — instead of counting a straight line through it. A leaper treats ice and
  // boulders as landing tiles; a phaser walks stone; a lava-safe demon wades fire.
  const stand = (x, y) => {
    if (x < 0 || x >= WORLD_SIZE || y < 0 || y >= WORLD_SIZE) return false;
    const t = terrainAt(state, x, y);
    if (t === 'wall' || t === 'tree' || t === 'gate') return phases;
    if (t === 'boulder' || t === 'ice') return leaper || phases; // walkers route around; leapers land on them
    if (t === 'pit') return leaper || Boolean(opts.flying) || Boolean(opts.pitOk);
    if (t === 'lava') return opts.lavaOk !== false; // lava-safe pieces conduct fire; the rest route around it
    return true; // normal / water / door / grass / geyser all conduct
  };
  const dist = new Map();
  const q = [[tx, ty]];
  dist.set(`${tx},${ty}`, 0); // the goal tile seeds the flood even if the piece could not stand on it
  for (let i = 0; i < q.length; i += 1) {
    const [x, y] = q[i];
    const d = dist.get(`${x},${y}`);
    for (const [dx, dy] of [...ORTHO, ...DIAG]) {
      const nx = x + dx;
      const ny = y + dy;
      const k = `${nx},${ny}`;
      if (dist.has(k) || !stand(nx, ny)) continue;
      dist.set(k, d + 1);
      q.push([nx, ny]);
    }
  }
  return dist;
}

// An out-of-sight enemy hunts toward the king's last-seen tile. Returns true if it
// pursued; false if it gave up (then it wanders).
// How many turns THIS pursuit lasts: rolled fresh each time it lays eyes on him, so the trail never
// goes cold on a schedule the player can count.
// How many turns THIS pursuit lasts: rolled fresh each time a foe lays eyes on him, so the trail
// never goes cold on a schedule the player can count.
//
// NB: this deliberately does NOT scale with dread. Making foes hunt longer and longer was tried as
// an anti-kiting measure and it is the wrong lever — it quietly rewrites how every foe on the floor
// behaves in order to correct one habit of the BOT. Kiting is a real tool and the pursuit window is
// the honest cost of using it; if a bot leans on it too hard, that is the bot's policy to fix.
function pursuitTurns() {
  return PURSUIT_TTL_MIN + randomInt(PURSUIT_TTL_MAX - PURSUIT_TTL_MIN + 1);
}

// It has him. ONE place that records everything a pursuit needs: where he was, how long the memory
// holds, which way he was going, and a fresh right to guess once when the trail runs out. Eight call
// sites used to set the first two of those by hand, which is eight chances to forget the rest.
function rememberAt(enemy, x, y, heading, turns) {
  enemy.lastSeen = { x, y };
  enemy.lastSeenTtl = turns || pursuitTurns();
  // A heading of null is honest, not a gap: a foe that snaps awake beside him (a fresh spawn, a
  // blow out of nowhere) never watched him WALK anywhere, so it has nothing to cast along and will
  // simply give up at the tile rather than guess a direction it never saw.
  enemy.lastSeenDir = heading || null;
  enemy.guessed = false;
}

function rememberKing(state, enemy) {
  rememberAt(enemy, state.player.x, state.player.y, state.kingHeading, pursuitTurns());
}

function pursueLastSeen(state, enemy) {
  const target = enemy.lastSeen;
  if (!target) return false;
  const forget = () => {
    enemy.lastSeen = null;
    enemy.lastSeenTtl = 0;
  };
  if (enemy.x === target.x && enemy.y === target.y) {
    // It stands where it last had him — and he is not here. Rather than shrug and wander off the
    // instant it arrives, it CASTS ON: carries the chase a few tiles further along the way he was
    // heading, which is what a hunter does when its quarry rounds a corner. That is the difference
    // between a foe that gives up at the corner and one that comes round it after you.
    //
    // One guess per pursuit (`guessed`), and only while the memory still holds — so it cannot chain
    // guesses across the whole floor, and the recursion below can only ever go one level deep.
    if (!enemy.guessed && enemy.lastSeenTtl > 0 && enemy.lastSeenDir
        && (enemy.lastSeenDir.dx || enemy.lastSeenDir.dy)) {
      enemy.guessed = true;
      enemy.lastSeen = {
        x: clamp(target.x + enemy.lastSeenDir.dx * PURSUIT_GUESS, 0, WORLD_SIZE - 1),
        y: clamp(target.y + enemy.lastSeenDir.dy * PURSUIT_GUESS, 0, WORLD_SIZE - 1),
      };
      return pursueLastSeen(state, enemy); // hunt the guess on this same turn
    }
    forget();
    return false;
  }
  // Navigate by a flood-fill distance field AROUND walls, not by shrinking the straight line — that
  // is what lets a pursuer round a corner or thread a corridor toward the last-seen tile instead of
  // butting against the wall between them and giving up. Straight-line distance is only the tiebreak.
  const field = navFieldTo(state, target.x, target.y, enemy);
  const fieldAt = (x, y) => (field.has(`${x},${y}`) ? field.get(`${x},${y}`) : Infinity);
  const curF = fieldAt(enemy.x, enemy.y);
  let best = null;
  let bestF = Infinity;
  let bestTie = Infinity;
  for (const m of movesTowardTile(state, enemy)) {
    const f = fieldAt(m.x, m.y);
    const tie = distanceSq(m.x, m.y, target.x, target.y);
    if (f < bestF || (f === bestF && tie < bestTie)) {
      bestF = f;
      bestTie = tie;
      best = m;
    }
  }
  // No move gets it any closer along a real path (walled off, or the trail led nowhere it can follow).
  if (!best || bestF >= curF) {
    forget();
    return false;
  }
  enemy.x = best.x;
  enemy.y = best.y;
  crushBoulderUnder(state, enemy); // a leaper that PURSUES onto a boulder / ice slab shatters it, same as a hunting leap
  enemy.lastSeenTtl -= 1;
  if ((enemy.x === target.x && enemy.y === target.y) || enemy.lastSeenTtl <= 0) forget();
  return true;
}

// A stationary object (turret / summoning circle) never wanders.
function isStationary(enemy) {
  // A dormant guardian holds the stair like a turret does — it only stirs (in
  // bossMove) once the king strikes it or steps adjacent.
  return enemy.turret || enemy.summonCircle || (enemy.boss && enemy.dormant);
}

// Resolve sight at the start of an enemy turn, per piece, and collect the pieces
// that get to act (movers).
// Non-demonic enemies and allies SEAR in lava — one hit at the start of each enemy phase, so a
// foe knocked into a lava field burns down turn by turn (the king can now weaponise lava with
// knockback). Demon-kind pieces are immune; the king's own lava is handled in passTurn; a boss
// takes its lava wound in bossMove. Ordinary pieces carry no HP pool, so one hit removes them
// (burned to ash). Called once per turn from beginEnemyPhase.
function tickLavaDamage(state) {
  // Lava OR a wall-torch a creature is embedded in (only a phaser can be) burns any non-demon.
  const burns = (u) => (terrainAt(state, u.x, u.y) === 'lava' || hasTorch(state, u.x, u.y)) && !isLavaSafe(u);
  const doomedFoes = state.enemies.filter((e) => !e.boss && !e.turret && !e.summonCircle && burns(e));
  for (const e of doomedFoes) { addAsh(state, e.x, e.y); addSmoke(state, e.x, e.y); }
  if (doomedFoes.length) state.enemies = state.enemies.filter((e) => !doomedFoes.includes(e));
  const doomedAllies = (state.allies || []).filter((a) => burns(a));
  for (const a of doomedAllies) { addAsh(state, a.x, a.y); addSmoke(state, a.x, a.y); }
  if (doomedAllies.length) state.allies = state.allies.filter((a) => !doomedAllies.includes(a));
}

// SAFETY NET: no ordinary (non-phasing) piece should ever end a turn standing INSIDE a wall, boulder,
// ice slab or tree — but a terrain change can close one over it (a cave-in dropping a wall, a killing
// frost sheeting a floor to ice) or a generator slip can seat it wrong. Nudge any such piece to the
// nearest tile it can actually stand on; if it is wholly entombed with no footing in reach, it is
// crushed and removed. Circles are runes (they belong anywhere) and a PHASER belongs in walls — both
// exempt. This runs each enemy phase, so a walled piece is freed before it ever gets to act.
function dislodgeWalledEnemies(state) {
  const entombed = [];
  // Only SOLID cover entombs — stone, a boulder, an ice slab, timber, iron. Lava, water and pits are
  // walkable-or-hazard tiles a piece may legitimately stand on (a demon wades lava, a flier a pit), so
  // they are NOT "stuck". Guarding on this rather than isStandable is what stops the sweep from wrongly
  // hauling a lava-immune demon off the fire it is meant to be standing in.
  const entombing = (t) => t === 'wall' || t === 'boulder' || t === 'ice' || t === 'tree' || t === 'gate';
  for (const e of state.enemies) {
    if (e.summonCircle || e.turret || bossHas(e, 'phasing')) continue;
    if (!entombing(terrainAt(state, e.x, e.y))) continue;
    let moved = false;
    for (let r = 1; r <= 4 && !moved; r += 1) {
      for (let dx = -r; dx <= r && !moved; dx += 1) {
        for (let dy = -r; dy <= r && !moved; dy += 1) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; // just this ring
          const nx = e.x + dx;
          const ny = e.y + dy;
          if (nx < 0 || nx >= WORLD_SIZE || ny < 0 || ny >= WORLD_SIZE) continue;
          if (!isStandable(terrainAt(state, nx, ny))) continue;
          if (nx === state.player.x && ny === state.player.y) continue;
          if (keyTileAt(state, nx, ny) || allyAt(state, nx, ny)) continue;
          if (state.enemies.some((o) => o !== e && o.x === nx && o.y === ny)) continue;
          e.x = nx; e.y = ny; moved = true;
        }
      }
    }
    if (!moved) entombed.push(e.id);
  }
  if (entombed.length) state.enemies = state.enemies.filter((e) => !entombed.includes(e.id));
}

// A non-flying, non-burrowing piece that ENDS a turn standing on a PIT falls into the void — the
// mirror of the lava tick, so a CONFUSED foe that blunders onto a pit dies just as one that blunders
// onto lava burns (it used to perch on the hole, harmless). A shove already drops them elsewhere.
function tickPitFalls(state) {
  const falls = (u) => terrainAt(state, u.x, u.y) === 'pit' && !bossHas(u, 'flying') && !bossHas(u, 'burrower') && !u.pathfinder;
  const doomedFoes = state.enemies.filter((e) => !e.boss && !e.turret && !e.summonCircle && falls(e));
  if (doomedFoes.length) { cue(state, 'fall'); state.enemies = state.enemies.filter((e) => !doomedFoes.includes(e)); }
  const doomedAllies = (state.allies || []).filter((a) => falls(a));
  if (doomedAllies.length) { cue(state, 'fall'); state.allies = state.allies.filter((a) => !doomedAllies.includes(a)); }
}

// GEYSERS (demon floors 6+) share ONE clock: every third turn they all blow at once. `geyserPhase`
// ticks up each turn (passTurn); on a multiple of GEYSER_PERIOD every geyser erupts — scalding gas
// that also blocks the look. The turn a geyser SHOWS its tall warning plume (phase % 3 === 2), ending
// a turn on it means eating the blast, so the tell is a full turn ahead.
const GEYSER_PERIOD = 3;
function geyserErupting(state) {
  const phase = state.geyserPhase || 0;
  // phase 0 is FLOOR START, not an eruption: the clock has not ticked yet, so the vents are calm and
  // must not block sight before the king has taken a step. Real eruptions are the later multiples.
  return phase > 0 && (phase % GEYSER_PERIOD) === 0;
}
// One turn BEFORE an eruption the vent shows a tall warning plume — the tell that ending a turn on it
// now means eating the blast. (phase % 3 === 2 leads into the phase % 3 === 0 eruption.)
function geyserImminent(state) {
  return ((state.geyserPhase || 0) % GEYSER_PERIOD) === GEYSER_PERIOD - 1;
}
// A geyser ERUPTS by venting a gout of scalding STEAM (fog) over its own tile — it no longer wounds
// directly; the STEAM is what scalds whatever stands in it (see tickFogDamage), unifying geysers with
// every other bank of fog. Geyser steam is brief — 1 turn — where most fog lingers for two.
function tickGeysers(state) {
  if (!geyserErupting(state)) return;
  let blew = false;
  for (const key in (state.terrain || {})) {
    if (state.terrain[key] !== 'geyser') continue;
    const comma = key.indexOf(',');
    addFog(state, Number(key.slice(0, comma)), Number(key.slice(comma + 1)), 1); // 1-turn steam
    blew = true;
  }
  // Its OWN cue, not the lava/fire `hiss` — a vent blows every third turn all floor long, so it gets a
  // soft, dull exhale that yields to every other sound rather than the sharp hiss of fire on flesh.
  if (blew) cue(state, 'vent');
}

// FOG/STEAM SCALDS. Any unit standing in fog takes 1 damage as its side of the turn comes up — the
// king (no parry stops the ground, like lava), foes and allies alike; a lesser foe is destroyed, a
// boss or turret soaks 1. This is now the ONE place geyser steam, spellfire steam and a Steamweaver's
// murk all deal their damage. Called once per turn from beginEnemyPhase, AFTER the geysers vent.
function tickFogDamage(state) {
  if (!state.fog) return;
  const inFog = (u) => fogAt(state, u.x, u.y);
  const p = state.player;
  let scalded = false; // did the steam actually BURN anything this turn?
  if (inFog(p)) {
    hurtBy(state, 'steam');
    p.hp -= 1;
    p.wasHit = true; p.hitThisFloor = true;
    addSpatter(state, p.x, p.y);
    addSmoke(state, p.x, p.y);
    scalded = true;
    state.message = state.message ? `${state.message} The scalding steam sears the king!` : 'The scalding steam sears the king!';
    checkDeath(state);
  }
  const caughtFoes = state.enemies.filter((e) => !e.summonCircle && inFog(e));
  for (const e of caughtFoes) {
    addSmoke(state, e.x, e.y);
    scalded = true;
    if (e.boss) damageBoss(state, e, 1, { ground: true }); // steam is the GROUND — no guard turns it aside
    else if (e.turret) damageTurret(state, e, 1);
    else { addSpatter(state, e.x, e.y, 0, 0, isDemonKind(e.kind)); tallyKill(state, e); state.enemies = state.enemies.filter((o) => o.id !== e.id); }
  }
  for (const a of (state.allies || []).filter((al) => inFog(al))) { addSmoke(state, a.x, a.y); damageAlly(state, a, 1); scalded = true; }
  // Steam BITING flesh is the same sound as lava biting flesh — a sharp HISS. It fires only when the
  // scald actually lands; a vent merely blowing off with nobody in it keeps its soft `vent` breath.
  // (That separation is the fix for the constant hissing: the eruption itself used to cue the hiss.)
  if (scalded) cue(state, 'hiss');
}

// PAST max dread, a floor the king refuses to leave turns MOLTEN. From MAX_TURNS_SCARY onward, fresh
// LAVA wells up in new fissures near him AND existing lava creeps toward him — even under his feet —
// thickening as the overstay runs (overstayFraction). With the unbounded swarm this is a guaranteed
// kill: no perk shrugs off lava any more (Pathfinder wades water/trees/pits, never fire), and Waiting
// shrugs the horde but not the ground. The stair, uncollected key and upstair are spared so escape stays open.
function tickLavaEncroachment(state) {
  const intensity = overstayFraction(state.turn || 0);
  if (intensity <= 0) return;
  const p = state.player;
  // Only the way OUT and the key he still needs are spared — escape must stay possible. The collapsed
  // UPSTAIR is dead scenery (no going back), so the fire takes it like anything else: a king who camps
  // on his entry tile burns there just the same.
  const spared = (x, y) => (state.exit && state.exit.x === x && state.exit.y === y)
    || (state.key && !state.key.collected && state.key.x === x && state.key.y === y);
  // Where fresh lava may well up or creep: open ground, water, grass — or the king's own tile.
  const molten = (x, y) => {
    if (x < 1 || x >= WORLD_SIZE - 1 || y < 1 || y >= WORLD_SIZE - 1) return false;
    if (spared(x, y)) return false;
    if (x === p.x && y === p.y) return true; // the fire reaches under him
    const t = terrainAt(state, x, y);
    return t === 'normal' || t === 'water' || t === 'devilgrass';
  };
  const light = (x, y) => { state.terrain[`${x},${y}`] = 'lava'; if (state.treeHp) delete state.treeHp[`${x},${y}`]; };
  // 1) FISSURES: fresh vents erupt near the king, more of them the deeper the overstay.
  if (Math.random() < 0.3 + 0.6 * intensity) {
    const n = 1 + Math.floor(intensity * 3);
    for (let i = 0; i < n; i += 1) {
      const rad = 2 + randomInt(6);
      const fx = Math.max(1, Math.min(WORLD_SIZE - 2, p.x + randomInt(2 * rad + 1) - rad));
      const fy = Math.max(1, Math.min(WORLD_SIZE - 2, p.y + randomInt(2 * rad + 1) - rad));
      if (molten(fx, fy)) light(fx, fy);
    }
  }
  // 2) CREEP: existing lava reaches into adjacent open tiles, PREFERRING those nearer the king, so the
  // fire closes in on him rather than sprawling at random. Collected first, applied after, so it only
  // spreads one ring per turn (no chain-reaction flood in a single tick).
  const additions = [];
  for (const k in state.terrain) {
    if (state.terrain[k] !== 'lava') continue;
    const [lx, ly] = k.split(',').map(Number);
    for (const [dx, dy] of ORTHO) {
      const nx = lx + dx;
      const ny = ly + dy;
      if (!molten(nx, ny)) continue;
      const nearer = chebyshev(nx, ny, p.x, p.y) < chebyshev(lx, ly, p.x, p.y);
      if (Math.random() < intensity * (nearer ? 0.4 : 0.08)) additions.push([nx, ny]);
    }
  }
  for (const [ax, ay] of additions) if (molten(ax, ay)) light(ax, ay);
}

function beginEnemyPhase(state) {
  const next = structuredClone(state);
  let moverIds = [];
  const p = next.player;
  // WHICH WAY HE IS GOING. Worked out once, here, because this is the one function that runs exactly
  // once per turn — deriving it inside the movement code would mean touching all dozen paths that
  // can shift the king (a step, a card, a blink, a knockback) and getting the same answer from each.
  // A foe that sees him copies this; when it later loses him, it is what it casts along to guess
  // where he went round the corner.
  const was = next.kingWas;
  next.kingHeading = was ? { dx: Math.sign(p.x - was.x), dy: Math.sign(p.y - was.y) } : null;
  next.kingWas = { x: p.x, y: p.y };
  recordSeenEnemies(next);
  charmBeasts(next); // Wild Empathy: beasts in view bow and join the king's side before the foes act
  tickBurningTrees(next); // a tree lit last turn burns away now, leaving a scorch (and may spread)
  tickLavaDamage(next); // lava burns any non-demonic foe/ally standing in it this turn
  tickPitFalls(next); // anything that blundered onto a pit (a confused foe) falls in
  tickGeysers(next); // on the third turn, every geyser vents a gout of 1-turn STEAM (fog) over itself
  tickFogDamage(next); // steam/fog SCALDS whatever stands in it — geyser vents, spellfire steam, a Steamweaver's murk
  tickFog(next); // ...and only THEN thins by a turn, so every bank burns for its full advertised life
  tickLavaEncroachment(next); // past max dread: the floor turns molten and closes in on a lingering king
  dislodgeWalledEnemies(next); // SAFETY NET: nudge any ordinary piece a terrain change closed a wall over
  tickTurrets(next); // every turret re-scans: no target in its lane → it idles and drops its lock

  applySilence(next); // Silence: while the hush holds, everything in view stays down

  for (const enemy of next.enemies) {
    if (enemy.asleep) {
      // ASLEEP is the GUARD state: a foe posted somewhere, holding its ground, doing nothing at all
      // until the king turns up. It rouses on exactly the same terms a wanderer notices him — it SEES
      // him (`enemyAwareOfKing`: inside its two-way sight footprint with a clear line) — or he
      // STRIKES it, or he blunders within arm's reach whether it can see him or not.
      //
      // Sight here is strictly TWO-WAY. The Oracle's one-way band lets the king watch a sleeper from
      // outside its notice, which is the whole point of that perk; `enemyAwareOfKing` already reckons
      // from the awareness footprint rather than the display one, so the band never wakes anything.
      //
      // A held Silence overrides all of it: while the hush lasts the room stays down no matter how he
      // walks through it, which is the entire point of the card (and it already breaks the instant he
      // strikes anything, elsewhere).
      const near = chebyshev(enemy.x, enemy.y, p.x, p.y);
      const sensesWalls = bossHas(enemy, 'phasing'); // a Phasing boss senses him through stone
      const disturbed = enemy.provoked || near <= 1 || enemyAwareOfKing(next, enemy.x, enemy.y, sensesWalls);
      if (p.silence > 0 || !disturbed) continue;
      enemy.asleep = false;
      enemy.awake = true;
      enemy.surprised = true; // it comes to with a start — that gasp is the turn he bought by finding it asleep
      rememberKing(next, enemy);
      continue; // gasping, not swinging: it is NOT a mover this turn
    }
    // CONFUSED pieces act no matter what — they are not looking for the king, so none of the
    // awareness reckoning below applies to them. It must come before all of it: that code would
    // otherwise send an unaware confused piece off to wander normally, and the fog would never
    // show. A turret or a dormant guardian is a mover here too, though it never normally moves:
    // confusedTurn is what decides that a rooted thing can only lash out, not stagger.
    if (isConfused(enemy)) {
      enemy.frustrated = false;
      enemy.surprised = false;
      moverIds.push(enemy.id);
      continue;
    }
    // Wild Empathy: a befriended beast (untamed until struck) never hunts the king — it roams
    // idly (or holds if it's a stationary kind) and takes no hostile action.
    if (isNeutralBeast(next, enemy)) {
      enemy.awake = false;
      enemy.surprised = false;
      enemy.lastSeen = null;
      enemy.lastSeenTtl = 0;
      // It ROAMS — openly, in front of him, with no interest in staying out of his eyeline.
      if (!isStationary(enemy)) wanderEnemy(next, enemy, false, true);
      continue;
    }
    const wasSurprised = enemy.surprised;
    enemy.frustrated = false;
    const sensesWalls = bossHas(enemy, 'phasing'); // a Phasing boss sees the king through walls/boulders
    // GHOST (elusive): the king is a hard thing to fix on. A foe more than one tile away only truly
    // notices him on HALF the turns he stands in its view, so he can draw one foe off a pack and
    // fight it alone instead of the whole room turning on him the instant he is seen. This gates
    // only the CATCHING of its eye: a foe already awake stays awake, one within a tile always sees
    // him, and one he STRUCK is enraged regardless of distance.
    // A foe still HOLDING a live memory of him is exempt: Ghost must not quietly become the old
    // noChase by breaking pursuit — a foe that has him keeps him.
    const remembersKing = Boolean(enemy.lastSeen) && enemy.lastSeenTtl > 0;
    const elusiveMiss = Boolean(p.elusive) && !enemy.awake && !enemy.provoked && !remembersKing
      && chebyshev(enemy.x, enemy.y, p.x, p.y) > 1 && randomInt(2) === 0;
    if (elusiveMiss || !enemyAwareOfKing(next, enemy.x, enemy.y, sensesWalls)) {
      enemy.awake = false;
      enemy.surprised = false;
      // A SUMMONING CIRCLE that has lost sight of the king lets its wind-up EBB — one tick per turn,
      // the same rate it builds — instead of holding a stored charge to loose the moment he reappears.
      if (enemy.summonCircle) enemy.summonTick = Math.max(0, (enemy.summonTick || 0) - 1);
      if (!isStationary(enemy)) {
        if (elusiveMiss) {
          // Blind to him this turn: Ghost means this foe failed to fix on him. It wanders on, oblivious. Only BLUNDERING straight into the
          // king (a bump) gives him away now; merely wandering next to him doesn't — it will
          // notice next turn, once it's within a tile at the start of its turn.
          const bumped = wanderEnemy(next, enemy, true);
          if (bumped) {
            enemy.awake = true;
            enemy.surprised = true;
            rememberKing(next, enemy);
          }
        } else if (inLineOfSight(next, enemy.x, enemy.y)) {
          // ONE-WAY ORACLE BAND: the king SEES this foe (and can pick it off) but it's beyond his
          // two-way footprint, so it can't see him back. It still SENSES him closing and gives
          // CHASE — it just can't strike from out there.
          rememberKing(next, enemy);
          if (!pursueLastSeen(next, enemy)) wanderEnemy(next, enemy, false);
        } else {
          // It has lost sight of him — hunt his last-seen tile while the memory lasts.
          const canPursue = remembersKing && pursueLastSeen(next, enemy);
          if (!canPursue) wanderEnemy(next, enemy, false);
        }
      }
      // Pursuing/wandering can carry an enemy INTO the king's view. It has already
      // spent its move this turn, but it must NOT be left flagged "unaware" while
      // sitting on screen — a hunter that steps into sight is plainly hostile. Mark
      // it aware and refresh its memory so it acts as a mover next turn.
      // (A foe that MISSED its Ghost roll is exempt too — it never noticed him, so ending its
      // wander in view must not hand him straight back.)
      if (!elusiveMiss && enemyAwareOfKing(next, enemy.x, enemy.y, sensesWalls)) {
        enemy.awake = true;
        rememberKing(next, enemy);
      } else if (enemy.lastSeen && enemy.lastSeenTtl > 0) {
        // Still HUNTING — it holds a live memory of him and is chasing his last-seen tile. Keep it
        // flagged awake even out of sight, so re-sighting him never re-startles it. This is what kills
        // the "duck behind a wall for a turn to reset its surprise" dance: once a foe is on his trail
        // it stays on it until the trail actually goes cold (the memory expires), at which point — and
        // only then — a fresh sighting can catch it off guard again.
        enemy.awake = true;
      }
      continue;
    }
    // An enemy is only startled if it had truly lost track of the king (`remembersKing`, read above
    // — nothing has touched its memory since). If it still holds a live memory of him (it was
    // pursuing his last-seen tile), it re-engages at once rather than gasping in surprise again.
    rememberKing(next, enemy);
    // A foe is startled only if it has genuinely LOST him — `remembersKing`, which holds for the 5-10
    // turns of a live pursuit. So a hunter that loses sight of him for a moment and finds him again
    // re-engages at once; it is only once the trail has actually gone cold that he can catch it out.
    //
    // A `!enemy.provoked` clause briefly lived here — anything he had ever struck could never be
    // surprised again, ever. That was too blunt: a monster SHOULD lose track of him eventually, and
    // camping already pays for itself in turns against the dread clock. The pursuit window is the
    // right amount of memory; permanent memory is not.
    if (!enemy.awake && !wasSurprised && !remembersKing) {
      enemy.awake = true;
      enemy.surprised = true;
      // A GUARDIAN roars the moment it is startled — on the SAME turn the "!" goes up over its head.
      // Its roar used to live in bossMove, but a freshly-surprised boss is deliberately NOT a mover
      // (the gasp costs it the turn), so bossMove did not run and the bubble only appeared a turn
      // LATER, over a boss that was already swinging.
      //
      // `!enemy.dormant` used to gate this, which quietly undid the whole fix for the ordinary case:
      // a guardian is DORMANT for as long as it holds its stair, which is precisely the state it is
      // in when the king first walks into view. So it gasped in silence and bellowed a turn later as
      // it advanced. This branch is only reached once it is already aware of him — which is exactly
      // the moment it should roar, dormant or not. It stays dormant; bossMove rouses it next turn.
      if (enemy.boss && !enemy.spokeLine) {
        enemy.spokeLine = true;
        next.bossLine = bossHostileLine(enemy);
        next.bossShout = { x: enemy.x, y: enemy.y, text: bossShoutLine(enemy), demon: isDemonBoss(enemy) };
      }
    } else {
      enemy.awake = true;
      enemy.surprised = false;
      moverIds.push(enemy.id);
    }
  }

  // DEPRECATED — a conjured minion used to be DISPELLED when the circle that summoned it was
  // destroyed. That made breaking a circle far too cheap: one step onto the rune wiped out its
  // whole brood at no risk. A summon is now simply a NORMAL MONSTER — once it is in the world it
  // stays there on its own, and must be fought like anything else. `summoned` / `summonedBy` are
  // still recorded (they drive the violet tint and the conjuring puff), just no longer fatal.
  // Kept commented rather than deleted in case the old behaviour is ever wanted back.
  //
  // const before = next.enemies.length;
  // const liveIds = new Set(next.enemies.map((e) => e.id));
  // next.enemies = next.enemies.filter((e) => !(e.summoned && e.summonedBy && !liveIds.has(e.summonedBy)));
  // if (next.enemies.length !== before) moverIds = moverIds.filter((id) => next.enemies.some((e) => e.id === id));

  for (let i = moverIds.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [moverIds[i], moverIds[j]] = [moverIds[j], moverIds[i]];
  }
  openDoorsUnderUnits(next); // any foe that wandered/pursued onto a shut door pushes it open
  return { state: next, moverIds };
}

// A turret's turn: it holds ground and fires along its piece pattern.
// The direction {dx,dy} a FIRE turret can hit the king along (one of its piece's slide lines),
// or null. Spellfire pierces bodies, so only WALLS and BOULDERS between block it (units don't).
function fireTurretLineToKing(state, turret) {
  return fireTurretLineTo(state, turret, state.player.x, state.player.y);
}

// The firing line from a turret to an arbitrary tile, or null if it has none. Split out from
// fireTurretLineToKing so a gun can bear on ANY of his pieces, not only the man himself.
function fireTurretLineTo(state, turret, kx, ky) {
  const ddx = kx - turret.x;
  const ddy = ky - turret.y;
  if (ddx === 0 && ddy === 0) return null;
  if (!(ddx === 0 || ddy === 0 || Math.abs(ddx) === Math.abs(ddy))) return null;
  const dx = Math.sign(ddx);
  const dy = Math.sign(ddy);
  if (!cardSlideDirs(turret.kind).some(([sx, sy]) => sx === dx && sy === dy)) return null;
  let x = turret.x + dx;
  let y = turret.y + dy;
  while (x !== kx || y !== ky) {
    const t = terrainAt(state, x, y);
    if (t === 'wall' || t === 'boulder' || t === 'gate' || t === 'tree') return null; // cover stops the gout (bodies don't) — including a gate's bars
    x += dx;
    y += dy;
  }
  return { dx, dy };
}

// The first gate or tree standing between a turret and a tile on one of its firing lines — the thing
// its bolt strikes INSTEAD of the target beyond it. Returns { x, y, kind } or null if: the tile is
// off the turret's lines, the lane is clear to it, or solid cover (wall/boulder) stops the shot
// before any gate/tree (in which case the gun has no shot at all, not a shot at the barrier).
function turretLaneObstacle(state, turret, tx, ty) {
  const ddx = tx - turret.x;
  const ddy = ty - turret.y;
  if (ddx === 0 && ddy === 0) return null;
  if (!(ddx === 0 || ddy === 0 || Math.abs(ddx) === Math.abs(ddy))) return null;
  const dx = Math.sign(ddx);
  const dy = Math.sign(ddy);
  if (!cardSlideDirs(turret.kind).some(([sx, sy]) => sx === dx && sy === dy)) return null;
  let x = turret.x + dx;
  let y = turret.y + dy;
  while (x !== tx || y !== ty) {
    const t = terrainAt(state, x, y);
    if (t === 'wall' || t === 'boulder') return null; // solid cover — no shot reaches even the barrier
    if (t === 'gate' || t === 'tree') return { x, y, kind: t };
    x += dx;
    y += dy;
  }
  return null;
}

// A fire turret looses a PIERCING gout of spellfire down `line`: it scorches every tile to the
// first wall/boulder, wounds the king, and cuts down any units in the path — EXCEPT fire turrets
// (immune to their own and each other's flame). It then must recover a turn.
function fireTurretBlast(state, turret, line) {
  turret.recovering = true; // its cycle: cool down next turn before it can act again
  turret.aiming = false;
  const { dx, dy } = line;
  const tiles = [];
  let x = turret.x + dx;
  let y = turret.y + dy;
  let hitKing = false;
  let lastX = turret.x;
  let lastY = turret.y;
  while (x >= 0 && x < WORLD_SIZE && y >= 0 && y < WORLD_SIZE) {
    const t = terrainAt(state, x, y);
    if (t === 'wall') break;
    if (t === 'tree') { igniteTree(state, x, y); tiles.push({ x, y }); lastX = x; lastY = y; break; } // a turret's spellfire lights it too
    if (t === 'gate') { damageTree(state, x, y, 1); tiles.push({ x, y }); lastX = x; lastY = y; break; } // iron does not burn — the gout heats the bars, chipping them
    if (t === 'boulder') { smashBoulder(state, x, y); tiles.push({ x, y }); lastX = x; lastY = y; break; }
    if (t === 'ice') meltIce(state, x, y);
    else if (t === 'devilgrass') clearDevilgrass(state, x, y);
    tiles.push({ x, y });
    scorchGround(state, x, y); // a fire turret's gout burns the floor it crosses, too
    lastX = x; lastY = y;
    if (x === state.player.x && y === state.player.y) {
      hitKing = true;
    } else {
      const foe = state.enemies.find((e) => e.id !== turret.id && e.x === x && e.y === y);
      if (foe && !(foe.turret && foe.fire)) { // other fire turrets are immune to the flames
        dispelAllyAt(state, x, y);
        if (foe.boss) damageBoss(state, foe, 1);
        else if (foe.turret) damageTurret(state, foe, 1);
        else { addAsh(state, x, y); state.enemies = state.enemies.filter((e) => e.id !== foe.id); }
      }
    }
    x += dx;
    y += dy;
  }
  state.lastShot = { fromX: turret.x, fromY: turret.y, toX: lastX, toY: lastY, role: 'fireball', tiles };
  if (hitKing) {
    const mit = rollMitigation(state, turret);
    if (mit) { state.message = mitigationMessage(mit, 'fire turret'); state.lastAction = 'enemy'; return state; }
    hurtBy(state, ['turret', 'fire']);
    state.player.hp = state.player.hp - 1;
    state.player.burnedByFire = true; // spellfire, even from a machine
    state.player.wasHit = true; state.player.hitThisFloor = true;
    addSpatter(state, state.player.x, state.player.y);
    state.message = 'A fire turret engulfs the king in spellfire!';
    state.lastAction = 'hit';
    checkDeath(state);
    return state;
  }
  state.message = 'A fire turret looses a gout of spellfire!';
  state.lastAction = 'enemy';
  return state;
}

// Does this turret have the king in its firing lane RIGHT NOW — respecting cover, blockers and (for
// a FIRE turret) its piercing gout? The single source of truth for a turret's lock, shared by the
// per-turn scan and the turret's own action so the two can never disagree.
function turretTargetsKing(state, turret) {
  if (turret.fire) return Boolean(fireTurretLineToKing(state, turret));
  return getPieceThreats(turret, state).some((t) => t.x === state.player.x && t.y === state.player.y);
}

// Can this gun bear on a given tile?
function turretBearsOn(state, turret, x, y) {
  if (turret.fire) return Boolean(fireTurretLineTo(state, turret, x, y));
  return getPieceThreats(turret, state).some((t) => t.x === x && t.y === y);
}

// WHAT a turret is shooting at this turn: the king if it can reach him, else any of his ALLIES
// standing in its lane.
//
// It only ever looked for the king, which meant a summoned rook could park in front of a gun and
// take it apart at total leisure — it never once shot back. A turret is a machine that shoots what
// is in front of it; a familiar is not invisible to it.
//
// The king comes FIRST and that ordering matters: a gun that has him does not stop to shoot his
// dog, so parking an ally in the lane can never be used to draw its fire off him.
function turretTarget(state, turret) {
  if (turretTargetsKing(state, turret)) return { x: state.player.x, y: state.player.y, king: true };
  for (const a of state.allies || []) {
    if (turretBearsOn(state, turret, a.x, a.y)) return { x: a.x, y: a.y, ally: a };
  }
  // Nobody in a CLEAR lane — but a gate or tree may stand between the gun and the king (or an ally)
  // on its firing line. The bolt strikes that barrier and chips it; three shots bring a gate down
  // and expose the man behind it. Without this the gun would simply doze, and a gate would be a
  // permanent shield rather than a temporary one. King's lane first (he is the priority target).
  const kb = turretLaneObstacle(state, turret, state.player.x, state.player.y);
  if (kb) return { x: kb.x, y: kb.y, obstacle: kb };
  for (const a of state.allies || []) {
    const ab = turretLaneObstacle(state, turret, a.x, a.y);
    if (ab) return { x: ab.x, y: ab.y, obstacle: ab, forAlly: true };
  }
  return null;
}

// Turrets are machines that SCAN every turn — whether or not they get an action this phase. (They
// only act while the king is close enough to be "aware" of them, so without this a turret that
// locked on, then watched him walk out of sight, would keep its lock indefinitely and shoot him the
// instant he rounded the corner back in — the bug this fixes.) With no target in the lane, or a
// camouflaged king out of reach, it goes IDLE: shown dozing, and it FORGETS the lock — so entering
// its lane always costs it a fresh targeting turn first.
function tickTurrets(state) {
  for (const turret of state.enemies || []) {
    if (!turret.turret) continue;
    const blind = Boolean(state.player.camouflage)
      && chebyshev(turret.x, turret.y, state.player.x, state.player.y) > 1;
    // Camouflage hides the KING (and any barrier he shelters behind) from a gun more than a tile
    // away; it never hides an ally, so an ally target — or a gate/tree in an ally's lane — keeps
    // the gun awake either way. A barrier in the KING's lane only wakes it when it can see him.
    const target = turretTarget(state, turret);
    const forAlly = Boolean(target && (target.ally || target.forAlly));
    const hasTarget = Boolean(target) && (forAlly || !blind);
    if (!hasTarget) {
      turret.dozing = true;
      turret.aiming = false;
      turret.recovering = false;
      continue;
    }
    turret.dozing = false;
  }
}

function fireTurret(state, turret) {
  const label = turret.fire ? 'fire turret' : `${turret.kind} turret`;
  // WHO it is shooting at — the king, or one of his allies parked in its lane. Everything below
  // reads off this rather than assuming the man himself.
  const target = turretTarget(state, turret);
  const fireLine = turret.fire && target ? fireTurretLineTo(state, turret, target.x, target.y) : null;
  const hitsKing = Boolean(target);

  // Camouflage (Gloom Stalker): a camouflaged king is INVISIBLE to any turret MORE than one tile
  // away — it simply dozes (a sleep "z") and never fires, however he moves. Step ADJACENT (within
  // one tile) and it wakes and targets him exactly like an ordinary turret; back off and it sleeps
  // again. Purely a matter of distance now — no strike-to-provoke or line-of-fire bookkeeping.
  // Camouflage hides the KING. It does not hide his familiar — so a gun with an ally in its lane
  // stays awake and shoots that instead of dozing.
  if (state.player.camouflage && chebyshev(turret.x, turret.y, state.player.x, state.player.y) > 1
      && !(target && (target.ally || target.forAlly))) {
    turret.aiming = false;
    turret.recovering = false;
    turret.dozing = true;
    state.message = ''; // it dozes: nothing to see, nothing to log, no beat to pay
    state.lastAction = 'idle';
    return state;
  }
  turret.dozing = false;
  // FIRE turret's 3-beat cycle: after it fires it spends a turn RECOVERING (venting) before it
  // can lock on again. (A normal turret only aims then fires.)
  if (turret.fire && turret.recovering) {
    turret.recovering = false;
    turret.aiming = false;
    state.message = 'A fire turret glows white-hot, venting as it recovers.';
    state.lastAction = 'enemy';
    return state;
  }
  if (!hitsKing) {
    turret.aiming = false; // the king left its line — it must re-acquire before it can fire
    // A gun sweeping an EMPTY lane has done nothing. It used to log a line and cost the player a
    // full beat of animation, every turn, for every turret in view — which is why a Gloom Stalker
    // (whose whole game is never being in a lane) waded through "a turret sweeps for a target" and
    // watched the game stutter between his turns.
    state.message = '';
    state.lastAction = 'idle';
    return state;
  }
  // TARGETING (not windup): the king just entered the line — the turret needs ONE turn to lock
  // on before it can shoot, so he always has a turn to step clear.
  if (!turret.aiming) {
    turret.aiming = true;
    cue(state, 'alarm'); // it has him: a whirring lock-on, one turn before it fires
    if (target.obstacle) {
      state.message = `A ${label} takes aim at the ${target.obstacle.kind === 'gate' ? 'gate' : 'tree'} in its way.`;
    } else {
      state.message = target.ally
        ? `A ${label} swivels onto your ${target.ally.kind}!`
        : `A ${label} locks onto the king — move!`;
    }
    state.lastAction = 'enemy';
    return state;
  }
  // Fire turret: loose a piercing gout of spellfire down the line (then recover next turn).
  if (turret.fire) return fireTurretBlast(state, turret, fireLine);
  // Locked on and STILL in the line — it SHOOTS, and the recoil costs it the lock: it must spend
  // another turn re-targeting before it can fire again, so it never chains shots turn after turn.
  turret.aiming = false;
  // A GATE or TREE in the lane takes the bolt — the iron bars (or timber) stop the shot the king
  // shelters behind, and each hit chips it; three bring a gate down. No Reflect, no mitigation: the
  // barrier is not the king, and the bolt never reaches him this turn.
  if (target.obstacle) {
    state.lastShot = { fromX: turret.x, fromY: turret.y, toX: target.x, toY: target.y, role: 'turret' };
    const what = target.obstacle.kind === 'gate' ? 'gate' : 'tree';
    const res = damageTree(state, target.x, target.y, 1);
    state.message = res === 'felled'
      ? `A ${label}'s bolt shatters the ${what}!`
      : `A ${label}'s bolt chips the ${what}.`;
    state.lastAction = 'enemy';
    return state;
  }
  // An ALLY in the lane takes the bolt instead. Deliberately no Reflect and no mitigation roll:
  // both are the KING's (his ward, his parry, his mirror) and none of them are his familiar's.
  if (target.ally) {
    state.lastShot = { fromX: turret.x, fromY: turret.y, toX: target.x, toY: target.y, role: 'turret' };
    const a = target.ally;
    addSpatter(state, a.x, a.y, Math.sign(a.x - turret.x), Math.sign(a.y - turret.y), isDemonKind(a.kind));
    state.message = damageAlly(state, a, 1)
      ? `A ${label} blasts your ${a.kind} apart!`
      : `A ${label} blasts your ${a.kind} (${a.hp}/${a.maxHp}).`;
    state.lastAction = 'enemy';
    return state;
  }
  state.lastShot = { fromX: turret.x, fromY: turret.y, toX: state.player.x, toY: state.player.y, role: 'turret' };
  const mit = rollMitigation(state, turret);
  if (mit) {
    state.message = mitigationMessage(mit, `${turret.kind} turret`);
    state.lastAction = 'enemy';
    return state;
  }
  hurtBy(state, 'turret');
  state.player.hp -= 1;
  state.player.wasHit = true; state.player.hitThisFloor = true;
  addSpatter(state, state.player.x, state.player.y);
  state.message = `A ${turret.kind} turret blasts the king!`;
  state.lastAction = 'hit';
  checkDeath(state);
  return state;
}

// Conjure a fresh minion of `kind` on a free tile beside `origin`.
// A Lich calling ONE of the fallen back up, from a body lying beside it. Returns the kind raised.
//
// "Not too badly decayed" is the corpse's own decay clock (life/max, ticked in passTurn): once a
// body is more than half gone it is past answering. That is the counter-play and it is a real one —
// a corpse it has not reached in time is a corpse it never gets, so drawing a Lich AWAY from the
// bodies costs it the room. Reusing the existing clock rather than inventing a second one means the
// thing the player watches fade on the floor IS the thing the rule reads.
const LICH_FRESH = 0.5;
function raiseNearbyDead(state, boss) {
  const bodies = (state.corpses || []).filter((c) => chebyshev(c.x, c.y, boss.x, boss.y) <= 1
    && (c.life / (c.max || CORPSE_LIFE)) >= LICH_FRESH
    && !state.enemies.some((e) => e.x === c.x && e.y === c.y)
    && !(state.player.x === c.x && state.player.y === c.y)
    && !allyAt(state, c.x, c.y)
    && isStandable(terrainAt(state, c.x, c.y)));
  if (!bodies.length) return null;
  const body = bodies[randomInt(bodies.length)]; // ONE a turn — it is a lich, not a chorus
  state.corpses = state.corpses.filter((c) => c !== body);
  const risen = createEnemy(body.kind, body.x, body.y);
  risen.awake = true;
  risen.summoned = true; // drawn violet, like anything else conjured into the world
  rememberAt(risen, state.player.x, state.player.y, state.kingHeading);
  state.enemies.push(risen);
  cue(state, 'thrum');
  // Logged on the SEPARATE boss line, not state.message. Raising is a free action — the Lich acts as
  // normal straight afterwards — so whatever it then does (advance, strike, fire) overwrites
  // state.message and the player never learns why there is suddenly another pawn on the board.
  // `bossLine` is the channel the view already drains for exactly this: a thing a guardian did that
  // is worth its own line in the log.
  state.bossLine = `${bossTitle(boss)} calls the fallen ${body.kind} back to its feet!`;
  return body.kind;
}

function summonAdjacent(state, origin, kind) {
  cue(state, 'thrum'); // something is being pulled into the world
  const dirs = [...ORTHO, ...DIAG];
  for (let i = dirs.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [dirs[i], dirs[j]] = [dirs[j], dirs[i]];
  }
  const minionKind = kind || randomEnemyKind(state.floor);
  for (const [dx, dy] of dirs) {
    const x = origin.x + dx;
    const y = origin.y + dy;
    if (x < 0 || x >= WORLD_SIZE || y < 0 || y >= WORLD_SIZE) continue;
    if (!isStandable(terrainAt(state, x, y))) continue;
    if (x === state.player.x && y === state.player.y) continue;
    if (keyTileAt(state, x, y)) continue; // never conjure a minion onto the floor key
    if (allyAt(state, x, y)) continue; // nor onto one of the king's allies
    if (state.enemies.some((e) => e.x === x && e.y === y)) continue;
    if (!kindCanMove(state, minionKind, x, y)) continue; // never conjure a stuck minion
    const minion = createEnemy(minionKind, x, y);
    minion.summoned = true;
    minion.summonedBy = origin.id; // the circle / summoner-boss whose magic sustains it
    minion.awake = true;
    state.enemies.push(minion);
    return true;
  }
  return false;
}

// A summoning circle's turn: while the king can see it, it conjures a minion of its
// OWN piece type on charged turns (never two running). It never moves or strikes.
function summonCircleTurn(state, circle) {
  // WILD EMPATHY (Druid T2): a circle that conjures HORSES — knights or nightriders — has nothing to
  // offer against a king they'd only roam neutral around. It stands inert (no charge, no conjuring)
  // rather than feeding him a stream of harmless steeds. Any OTHER kind of rune works as normal.
  if (state.player.beastFriend && (circle.kind === 'knight' || circle.kind === 'nightrider')) {
    circle.summonTick = 0;
    state.message = '';
    state.lastAction = 'idle';
    return state;
  }
  // Camouflage (Gloom Stalker): a circle can't sense a camouflaged king MORE than one tile away, so it
  // cannot conjure against him — and its wind-up EBBS at the same rate it builds (1/turn) rather than
  // holding the charge to loose the instant he reappears. Step adjacent (within one tile) and it
  // conjures as normal; he can also still step onto it to dispel it any time.
  if (state.player.camouflage && chebyshev(circle.x, circle.y, state.player.x, state.player.y) > 1) {
    circle.summonTick = Math.max(0, (circle.summonTick || 0) - 1);
    state.message = '';
    state.lastAction = 'idle';
    return state;
  }
  // Conjure every SUMMON_TURNS-th turn (3). It was four, which — once circles stopped huddling next
  // to each other and the turrets around the chamber — left a lone rune contributing almost nothing.
  circle.summonTick = (circle.summonTick || 0) + 1;
  if (circle.summonTick % SUMMON_TURNS === 0 && state.enemies.length < MAX_ENEMIES && summonAdjacent(state, circle, circle.kind)) {
    state.message = 'A summoning circle conjures a minion!';
    state.lastAction = 'enemy';
    return state;
  }
  state.message = 'A summoning circle pulses with dark light.';
  state.lastAction = 'enemy';
  return state;
}

// Enemies shy off geyser vents when they can — landing on one only if every other move is worse or
// there's nowhere dry to go. Knockbacks bypass this (they aren't chosen moves).
function preferNonGeyser(state, legal) {
  const dry = legal.filter((m) => terrainAt(state, m.x, m.y) !== 'geyser');
  return dry.length ? dry : legal;
}

function chooseHostileMove(moves, px, py, state, enemy) {
  if (!moves.length) return null;
  const key = `${px},${py}`;
  const onKing = moves.find((m) => `${m.x},${m.y}` === key);
  if (onKing) return onKing; // it can land ON the king this turn — always take the capture
  // PATH around obstacles, don't just shrink the straight line. Rank each candidate by its BFS distance
  // to the king over ground this piece can actually cross — so a foe boxed off by a ring of ice or a
  // wall corner takes the step that leads the long way AROUND, instead of shuffling toward the barrier
  // between them (the old greedy `distanceSq` bug: it would step "down" when the only real route to a
  // down-RIGHT king curled around a slab). Straight-line distance is only the tiebreak.
  if (state && enemy) {
    const field = navFieldTo(state, px, py, enemy);
    const fAt = (m) => (field.has(`${m.x},${m.y}`) ? field.get(`${m.x},${m.y}`) : Infinity);
    let best = null;
    let bestF = Infinity;
    let bestD = Infinity;
    for (const m of moves) {
      const f = fAt(m);
      const d = distanceSq(m.x, m.y, px, py);
      if (f < bestF || (f === bestF && (d < bestD || (d === bestD && Math.random() < 0.5)))) {
        bestF = f; bestD = d; best = m;
      }
    }
    if (best && bestF < Infinity) return best; // a real path exists — follow it
  }
  // Fallback (no state, or the king is wholly walled off): the old straight-line pick.
  let chosen = null;
  let best = Infinity;
  for (const m of moves) {
    const d = distanceSq(m.x, m.y, px, py);
    if (d < best || (d === best && Math.random() < 0.5)) { best = d; chosen = m; }
  }
  return chosen;
}

// A boss strikes without expending itself (a hit costs 1 HP by default).
function bossHit(state, boss, hitMsg) {
  markStrikeBump(state, boss); // no-op unless it is close enough to have actually swung
  const mit = rollMitigation(state, boss);
  if (!mit) {
    hurtBy(state, foeDeathTags(boss));
    state.player.hp -= bossDamage(boss);
    state.player.wasHit = true; state.player.hitThisFloor = true;
    bossLeech(boss); // a Leech guardian mends a wound as it draws blood
    addSpatter(state, state.player.x, state.player.y, Math.sign(state.player.x - boss.x), Math.sign(state.player.y - boss.y));
    state.message = hitMsg;
    state.lastAction = 'hit';
    if (!state.gameOver) bossOnHitKing(state, boss); // Icy Grasp: ice sheets the ground by the king
    checkDeath(state);
  } else {
    state.message = `The king withstands ${boss.bossName || `the ${boss.kind} guardian`}!`;
    state.lastAction = 'enemy';
  }
  applyReflect(state, boss, mit); // Riposte (Sentinel): only if his GUARD turned the blow aside (soaks 1)
  return state;
}

// A jumper leaps onto the king's tile and knocks him back, taking his ground.
// --- Knockback with collision ------------------------------------------------
// A shoved piece that slams into another unit deals it a hit: an ordinary piece (or an
// ally) is crushed and the shover takes its tile; an HP-bearing piece (boss, turret,
// king) withstands it, so the shover stops short and merely bumps it. These two helpers
// give EVERY knockback source (jumpers, boss Bulwark, Recoil, Trample, Displacement) the
// same consistent behaviour.

// Resolve a shove onto (tx,ty): damage whatever occupies it. Returns true if the tile is
// now CLEAR (the shover should advance onto it), false if it held (the shover stops).
// `moverId` is the shover's enemy id (null for the king); `moverIsKing` gives the king
// kill-credit for a foe he is driven into.
// `moverId` is what is being SHOVED; (tx,ty) the tile it is slamming into. Returns true if the tile
// is now free for it to take.
function resolveShoveInto(state, tx, ty, moverId, moverIsKing) {
  const shover = state.enemies.find((e) => e.id === moverId);
  if (shover && !moverIsKing) {
    // It has hit SOMETHING (that is what this function is for) — lurch it at whatever that was.
    const occupied = (tx === state.player.x && ty === state.player.y)
      || allyAt(state, tx, ty) || state.enemies.some((e) => e.id !== moverId && e.x === tx && e.y === ty);
    if (occupied) markShoveBump(state, moverId, Math.sign(tx - shover.x), Math.sign(ty - shover.y));
  }
  // Slammed into the king: he is UNHARMED. A piece stumbling into him as it is hurled back cannot
  // hurt him — he simply blocks it and it stops short. (Everything ELSE a knockback slams still takes
  // the hit; only the king is immune to being bumped this way.)
  if (tx === state.player.x && ty === state.player.y) {
    return false; // the shover stops short against him, no damage
  }
  // Slammed into one of the king's allies: it's crushed, the shover takes its tile.
  const ally = allyAt(state, tx, ty);
  if (ally) {
    state.allies = state.allies.filter((a) => a.id !== ally.id);
    addSpatter(state, tx, ty, 0, 0, isDemonKind(ally.kind));
    addCorpse(state, tx, ty, ally.kind);
    return true;
  }
  // Slammed into another piece.
  const foe = state.enemies.find((e) => e.id !== moverId && e.x === tx && e.y === ty);
  if (foe) {
    if (foe.boss) return damageBoss(state, foe, 1) === 'slain'; // a boss withstands it unless it falls
    if (foe.turret) return damageTurret(state, foe, 1) === 'slain';
    if (foe.summonCircle) {
      // shoved onto a summoning circle — it shatters into a scar, the shover takes its tile
      state.enemies = state.enemies.filter((e) => e.id !== foe.id);
      if (!Array.isArray(state.scars)) state.scars = [];
      state.scars.push({ x: tx, y: ty, kind: 'circle' });
      state.player.circlesDispelled = (state.player.circlesDispelled || 0) + 1; // badge ledger
      return true;
    }
    if (foe.parry) { // a warded foe turns aside the collision too — its guard drops, it holds its tile
      foe.parry = false; foe.warded = null; foe.awake = true; foe.provoked = true;
      bloody(foe, BLOOD_STRIKE);
      return false; // the shover stops short
    }
    if (moverIsKing) {
      resolveKill(state, foe); // the king's shove counts as his kill (boon / necromancy)
    } else {
      // A piece HE shoved has crushed another piece. That is his doing at one remove, so it counts.
      state.player.killedFoeWithFoe = true;
      const shoverName = shover ? (shover.boss ? bossTitle(shover) : capitalize(aWord(foeLabel(shover)))) : 'A piece';
      state.enemies = state.enemies.filter((e) => e.id !== foe.id);
      tallyKill(state, foe);
      addSpatter(state, tx, ty, 0, 0, isDemonKind(foe.kind));
      addCorpse(state, tx, ty, foe.kind);
      state.message = `${shoverName} smashes into ${aWord(foeLabel(foe))} — it dies!`;
    }
    return true;
  }
  return true; // empty ground
}

// Shove an ENEMY (or a turret — they're pushable now) one tile in (dx,dy), colliding with
// whatever's there. A wall / boulder / the board edge halts it; it may be driven across water
// and onto lava (where it then burns). Hurled over a PIT it PLUNGES to its death — except a
// boss / mini-boss, which clambers back out for 1 wound instead of falling in.
// A piece SLAMMING into something — flagged so the view can lurch it at what it hit, the way the
// king's own blows lurch.
//
// The sound was the only tell, and for the STOP-SHORT case (shoved into a guardian, which does not
// budge) literally nothing on screen moved: an HP bar ticked down somewhere and that was it. Even
// the kill case only read as an ordinary glide onto the vacated tile.
function markShoveBump(state, id, dx, dy) {
  if (!Array.isArray(state.shoveBumps)) state.shoveBumps = [];
  state.shoveBumps.push({ id, dx, dy });
}

function knockbackEnemy(state, enemy, dx, dy) {
  if (!dx && !dy) return;
  if (bossHas(enemy, 'anchored')) return; // ANCHORED: nothing shoves or hurls it — it holds its ground
  cue(state, 'bonk'); // something just got shoved (deduped: five foes hurled at once is ONE bonk)
  const tx = enemy.x + dx;
  const ty = enemy.y + dy;
  if (tx < 0 || tx >= WORLD_SIZE || ty < 0 || ty >= WORLD_SIZE) return; // the edge halts it
  const t = terrainAt(state, tx, ty);
  if (isChoppable(t)) { // hurled into timber or iron: it cracks, and the shove stops dead against it
    damageTree(state, tx, ty, 1);
    return;
  }
  if (t === 'wall' || t === 'boulder') return; // solid — the shove just stops
  if (t === 'ice') { // slammed into an ice slab — it SHATTERS and the foe crashes through onto the open tile
    smashIce(state, tx, ty);
    if (resolveShoveInto(state, tx, ty, enemy.id, false)) { enemy.x = tx; enemy.y = ty; }
    return;
  }
  if (t === 'pit') {
    cue(state, 'fall'); // it goes over the edge — even a guardian that climbs back out fell first
    // Only the floor's OWN GUARDIAN is anchored enough to haul itself back out (for a wound). A
    // rogue mini/rush boss is a loose piece like any other and goes all the way down; a turret is a
    // machine that clangs in and is gone. Same line isBanishable draws: the guardian holds the key
    // and the floor together, nothing else does.
    state.player.knockedIntoPit = true; // badge ledger: he put something over an edge
    if (enemy.boss && !enemy.mini && !enemy.rush) {
      const slain = damageBoss(state, enemy, 1) === 'slain';
      state.message = slain
        ? `${bossTitle(enemy)} is hurled screaming into the pit!`
        : `${bossTitle(enemy)} clambers back out of the pit!`;
    } else {
      if (!enemy.turret) addSpatter(state, enemy.x, enemy.y, 0, 0, isDemonKind(enemy.kind)); // a MACHINE leaves no blood as it clangs in
      state.enemies = state.enemies.filter((e) => e.id !== enemy.id);
      tallyKill(state, enemy);
      state.message = enemy.boss
        ? `${bossTitle(enemy)} is hurled screaming into the pit — gone!`
        : enemy.turret
          ? 'A turret clatters into the pit — gone!'
          : `${capitalize(aWord(enemy.kind))} falls to its death in the pit!`;
    }
    return;
  }
  if (resolveShoveInto(state, tx, ty, enemy.id, false)) {
    enemy.x = tx;
    enemy.y = ty;
    // Shoved into FIRE. It does not die here — tickLavaDamage burns it at the top of the next enemy
    // phase — but the shove is what put it there, so the credit belongs to this moment. Waiting for
    // the burn would lose the connection entirely: by then nobody knows who pushed it in.
    if (terrainAt(state, tx, ty) === 'lava' && !isLavaSafe(enemy)) state.player.knockedIntoLava = true;
  }
}

// Shove the BOULDER at (bx,by) — the knockback counterpart of a manual push. Where a shove
// nudges it one tile, a KNOCKBACK sets it ROLLING: it keeps travelling in (dx,dy) until
// something stops it. Along the way it fills a pit / lava / water (consumed there), flattens
// devilgrass, and PLOWS THROUGH ordinary foes (crushing each). It comes to rest — or ends —
// when it: rolls off the board or into a wall / ice / another boulder (SHATTERS to rubble);
// slams a boss / mini-boss / turret (deals 1, stops short); or slams the king (deals 1, stops
// short). The floor key is never buried.
function knockbackBoulder(state, bx, by, dx, dy) {
  if (!dx && !dy) return;
  if (terrainAt(state, bx, by) !== 'boulder') return;
  let cx = bx;
  let cy = by;
  cue(state, 'rumble'); // it's moving
  delete state.terrain[`${cx},${cy}`]; // the boulder is now in motion — vacate its start
  const rest = () => { state.terrain[`${cx},${cy}`] = 'boulder'; }; // come to rest where it is
  const shatter = () => { addRubble(state, cx, cy); }; // the roll ends in a burst of rubble
  for (let step = 0; step < WORLD_SIZE * 2; step += 1) {
    const nx = cx + dx;
    const ny = cy + dy;
    if (nx < 0 || nx >= WORLD_SIZE || ny < 0 || ny >= WORLD_SIZE) { shatter(); return; } // off the edge → breaks apart
    const t = terrainAt(state, nx, ny);
    if (isChoppable(t)) { // a boulder at speed shears a trunk through — and buckles a gate
      damageTree(state, nx, ny, TREE_HP);
      shatter();
      return;
    }
    if (t === 'wall' || t === 'ice' || t === 'boulder') { shatter(); return; } // slams something solid → breaks apart
    if (keyTileAt(state, nx, ny)) { rest(); return; } // never bury the floor key
    if (nx === state.player.x && ny === state.player.y) { // rolls into the king
      // A boulder is the ONE physical smash a raised guard turns aside — unlike fire, pits and lava,
      // which are the ground itself and no parry stops (see rollMitigation / the environmental sears).
      // No attacker to REFLECT onto — a boulder is not a foe.
      const mit = rollMitigation(state, null);
      if (mit) { state.message = mitigationMessage(mit, 'rolling boulder'); state.lastAction = 'enemy'; rest(); return; }
      hurtBy(state, 'boulder');
      state.player.hp -= 1;
      state.player.wasHit = true; state.player.hitThisFloor = true;
      state.lastAction = 'hit';
      state.message = 'A rolling boulder slams into the king!';
      checkDeath(state);
      rest();
      return;
    }
    const foe = state.enemies.find((e) => e.x === nx && e.y === ny);
    if (foe) {
      if (foe.boss) { damageBoss(state, foe, 1); rest(); return; } // a boss / mini-boss soaks 1 and halts the roll
      if (foe.turret) { damageTurret(state, foe, 1); rest(); return; } // a turret soaks 1 and halts the roll
      if (foe.summonCircle) { // shatters the circle, boulder rolls on over the scar
        state.enemies = state.enemies.filter((e) => e.id !== foe.id);
        if (!Array.isArray(state.scars)) state.scars = [];
        state.scars.push({ x: nx, y: ny, kind: 'circle' });
      } else { // an ordinary foe is crushed and the boulder PLOWS ON
        state.player.killedWithBoulder = true; // badge ledger: the rock did it
        addSpatter(state, nx, ny, 0, 0, isDemonKind(foe.kind));
        addCorpse(state, nx, ny, foe.kind);
        state.enemies = state.enemies.filter((e) => e.id !== foe.id);
        tallyKill(state, foe);
        state.message = `${capitalize(aWord(foeLabel(foe)))} is flattened by a rolling boulder!`;
      }
    } else if (allyAt(state, nx, ny)) { rest(); return; } // it won't crush your own ally — it stops short
    if (t === 'pit' || t === 'lava' || t === 'water') { cueHazardFill(state, t, nx, ny); delete state.terrain[`${nx},${ny}`]; return; } // rolls in, fills the hazard, consumed
    clearDevilgrass(state, nx, ny); // flattens any thicket it rolls over
    cx = nx;
    cy = ny;
  }
  rest();
}

// Shove everything ADJACENT to (cx,cy) — mobile foes, TURRETS (pushable now), AND loose boulders
// — one tile directly away, colliding with whatever's behind it. Summoning circles and the
// excluded piece stay put. Shared by Recoil, Trample, and Displacement.
// `exclude` takes an id OR a Set of ids, so a caller firing two shockwaves can spare anything the
// first one already threw (Displacement shoves both ends of its swap). Returns the ids it shoved.
// THUNDERING CHARGE: everything the king can SEE is hurled straight away from (cx,cy) — foes,
// turrets, boulders alike. Ordered FARTHEST FIRST, which is the whole trick: shove the near ones
// first and they slam into the far ones that have not moved yet, and half the room piles up instead
// of scattering. Going outside-in, every piece has somewhere to go before it is asked to go there.
function thunderingCharge(state, cx, cy) {
  const seen = getVisibleEnemies(state)
    .filter((e) => !e.summonCircle)
    .map((e) => ({ id: e.id, d: chebyshev(e.x, e.y, cx, cy) }))
    .sort((a, b) => b.d - a.d);
  for (const { id } of seen) {
    const foe = state.enemies.find((e) => e.id === id);
    if (!foe || (foe.x === cx && foe.y === cy)) continue;
    knockbackEnemy(state, foe, Math.sign(foe.x - cx), Math.sign(foe.y - cy));
  }
  // ...and every boulder in sight goes with them.
  const rocks = [];
  for (const k in state.terrain) {
    if (state.terrain[k] !== 'boulder') continue;
    const [x, y] = k.split(',').map(Number);
    if (!inLineOfSight(state, x, y)) continue;
    if (x === cx && y === cy) continue;
    rocks.push({ x, y, d: chebyshev(x, y, cx, cy) });
  }
  rocks.sort((a, b) => b.d - a.d); // farthest first, same reason
  for (const r of rocks) {
    if (terrainAt(state, r.x, r.y) !== 'boulder') continue; // something already moved it
    knockbackBoulder(state, r.x, r.y, Math.sign(r.x - cx), Math.sign(r.y - cy));
  }
  cue(state, 'rumble');
  state.message = 'The king lands like a thunderclap — the whole floor is hurled back!';
}

function shoveAdjacentAway(state, cx, cy, exclude) {
  const skip = exclude instanceof Set ? exclude : new Set(exclude ? [exclude] : []);
  const ids = state.enemies
    .filter((e) => !e.summonCircle && !skip.has(e.id) && chebyshev(e.x, e.y, cx, cy) === 1)
    .map((e) => e.id);
  for (const id of ids) {
    const foe = state.enemies.find((e) => e.id === id);
    if (foe) knockbackEnemy(state, foe, Math.sign(foe.x - cx), Math.sign(foe.y - cy));
  }
  for (const [dx, dy] of [...ORTHO, ...DIAG]) {
    if (terrainAt(state, cx + dx, cy + dy) === 'boulder') knockbackBoulder(state, cx + dx, cy + dy, dx, dy);
  }
  return ids;
}

// Place the king on the free tile ADJACENT to (tx,ty) nearest his origin (fromX,fromY) — so a
// dash lands just short of the foe and a leap bounces off it toward where he jumped from. If NO
// tile beside it is free he bounces all the way back to his origin. Returns true if he ended
// beside the foe (false = bounced home).
function bounceOffTarget(state, tx, ty, fromX, fromY) {
  const p = state.player;
  let best = null;
  let bestD = Infinity;
  for (const [dx, dy] of [...ORTHO, ...DIAG]) {
    const x = tx + dx;
    const y = ty + dy;
    if (x < 0 || x >= WORLD_SIZE || y < 0 || y >= WORLD_SIZE) continue;
    if (!standableFor(terrainAt(state, x, y), { phaseWalls: Boolean(p.phase), pathfinder: Boolean(p.pathfinder) })) continue;
    if (terrainAt(state, x, y) === 'lava') continue; // never bounce into searing lava
    if (state.enemies.some((e) => e.x === x && e.y === y) || allyAt(state, x, y)) continue;
    if (state.exit && x === state.exit.x && y === state.exit.y) continue; // don't stumble onto the stair
    const d = chebyshev(x, y, fromX, fromY);
    if (d < bestD) { bestD = d; best = { x, y }; }
  }
  if (best) { p.x = best.x; p.y = best.y; collectKeyIfHere(state); return true; }
  p.x = fromX; p.y = fromY; // nowhere beside it — bounce clean back home
  return false;
}

// The king struck a boss / turret that SURVIVED. A LEAP tries to knock it back a tile and take
// its vacated square; a SLIDE (or a leap that can't budge it) lands him on the tile beside it
// nearest his origin — else bounces him back home. Flags `lungeAt` so the view pounces onto the
// foe first, then settles where he ends.
function landBesideSurvivor(state, target, tx, ty, fromX, fromY, isLeap) {
  const p = state.player;
  state.lungeAt = { x: tx, y: ty };
  if (isLeap) {
    const adx = Math.sign(tx - fromX);
    const ady = Math.sign(ty - fromY);
    knockbackEnemy(state, target, adx, ady); // shove it away along the king's line of approach
    const gone = !state.enemies.some((e) => e.id === target.id) || target.x !== tx || target.y !== ty;
    if (gone) { p.x = tx; p.y = ty; collectKeyIfHere(state); return; } // it budged/fell — take its old tile
  }
  bounceOffTarget(state, tx, ty, fromX, fromY);
}

// A jumper (or a Bulwark boss) leaps onto the king and bowls him back one tile — into
// whatever stands behind him (crushing an ordinary foe/ally, bumping a boss/turret). The
// jumper then takes the ground the king vacated.
// The nearest ground a fallen king can HAUL HIMSELF OUT onto: the closest standable, unoccupied,
// non-hazardous tile to (x,y), searched ring by ring so he always surfaces as near the hole as the
// floor allows. isStandable bars lava and other pits, so he can never climb out of one hole into a
// worse one.
// The first free, standable tile ADJACENT to (x,y) — where a displaced ally scrambles when the king
// leaps onto its square. Excludes the king, other units, the key. Returns null if it is hemmed in.
function freeAdjacentTile(state, x, y) {
  for (const [dx, dy] of [...ORTHO, ...DIAG]) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || nx >= WORLD_SIZE || ny < 0 || ny >= WORLD_SIZE) continue;
    if (!isStandable(terrainAt(state, nx, ny))) continue;
    if (keyTileAt(state, nx, ny)) continue;
    if (nx === state.player.x && ny === state.player.y) continue;
    if (state.enemies.some((e) => e.x === nx && e.y === ny) || allyAt(state, nx, ny)) continue;
    return { x: nx, y: ny };
  }
  return null;
}

function nearestFooting(state, x, y, avoidX, avoidY) {
  for (let r = 1; r < WORLD_SIZE; r += 1) {
    const ring = [];
    for (let dx = -r; dx <= r; dx += 1) {
      for (let dy = -r; dy <= r; dy += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= WORLD_SIZE || ny < 0 || ny >= WORLD_SIZE) continue;
        if (nx === avoidX && ny === avoidY) continue; // e.g. a pit-diver never surfaces back in the corner he fled
        if (!isStandable(terrainAt(state, nx, ny))) continue;
        if (keyTileAt(state, nx, ny)) continue;
        if (state.enemies.some((e) => e.x === nx && e.y === ny)) continue;
        if (allyAt(state, nx, ny)) continue;
        ring.push({ x: nx, y: ny });
      }
    }
    if (ring.length) return ring[randomInt(ring.length)];
  }
  return null;
}

// A JUMPER that leapt at the king but could NOT shift him has to land somewhere: it bounces off and
// comes to rest ADJACENT to him, on the free tile nearest where it sprang from. It leapt — it does
// not hang in the air and reappear back at its start, which is what it used to do whenever the king
// had his back to a wall. The mirror of bounceOffTarget, which does this for the king.
function bounceJumperBeside(state, jumper, kx, ky, fromX, fromY) {
  let best = null;
  let bestD = Infinity;
  for (const [dx, dy] of [...ORTHO, ...DIAG]) {
    const x = kx + dx;
    const y = ky + dy;
    if (x < 0 || x >= WORLD_SIZE || y < 0 || y >= WORLD_SIZE) continue;
    if (!standableFor(terrainAt(state, x, y), pieceTerrainOpts(jumper))) continue;
    if (terrainAt(state, x, y) === 'lava' && !isLavaSafe(jumper)) continue; // it won't land in fire it can't survive
    if (terrainAt(state, x, y) === 'pit') continue; // nor down a hole
    if (keyTileAt(state, x, y)) continue;
    if (state.enemies.some((e) => e.id !== jumper.id && e.x === x && e.y === y) || allyAt(state, x, y)) continue;
    // The tile it came FROM is the natural place to fall back to — hence "logical angle": nearest
    // its origin, so it reads as a bounce back down its own line of approach rather than a teleport.
    const d = chebyshev(x, y, fromX, fromY);
    if (d < bestD) { bestD = d; best = { x, y }; }
  }
  if (!best) return false;
  jumper.x = best.x;
  jumper.y = best.y;
  return true;
}

function knockbackKing(state, enemy) {
  const king = state.player;
  markStrikeBump(state, enemy); // the leap was still made — animate it even when parried/warded away
  let pdx = Math.sign(king.x - enemy.x);
  let pdy = Math.sign(king.y - enemy.y);
  if (pdx === 0 && pdy === 0) pdx = 1;
  const bx = king.x + pdx;
  const by = king.y + pdy;
  const mit = rollMitigation(state, enemy);
  // WAITING (Sentinel) is the one mitigation that does NOT root him: the blow does no damage, but the
  // shove still lands (unlike Animal Form / a Parry, which turn the whole thing aside). A pit or lava
  // he is bowled into simply cannot hurt him while it holds.
  const shoveOnly = Boolean(king.invuln) && !(king.promotion > 0);
  if (!mit) {
    hurtBy(state, foeDeathTags(enemy));
    king.hp -= enemy.boss ? bossDamage(enemy) : 1;
    king.wasHit = true; king.hitThisFloor = true;
    bloody(enemy, BLOOD_STRIKE); // an ordinary jumper is flecked (a boss shows HP wounds)
    if (enemy.boss) bossLeech(enemy); // a Leech guardian mends as it lands the shove
    addSpatter(state, king.x, king.y, pdx, pdy); // blood carries in the shove direction
    if (!state.gameOver) bossOnHitKing(state, enemy); // Icy Grasp, if this shove was a guardian's
    checkDeath(state);
  }
  // The king is bowled back unless he just fell, or a wall/lava/edge halts him. Whatever
  // stands behind him is slammed (see resolveShoveInto); if it clears, he slides in and
  // the jumper takes his old tile.
  let pushed = false;
  if ((!mit || shoveOnly) && !state.gameOver) {
    const inBounds = bx >= 0 && bx < WORLD_SIZE && by >= 0 && by < WORLD_SIZE;
    // A PIT behind him is the one thing that doesn't merely halt the shove — he goes over the edge.
    // Rare (it needs a pit exactly behind him, and the blow must land), but it should be possible.
    // He hauls himself out the way a GUARDIAN does: another wound, and back onto the nearest ground
    // he can find. Not fatal — a hole is a beating, not an instant loss. Pathfinder simply treads over
    // it; WAITING does not — a pit is the GROUND, and Waiting shrugs off blows, never the ground.
    if (inBounds && terrainAt(state, bx, by) === 'pit' && !king.pathfinder) {
      cue(state, 'fall');
      hurtBy(state, 'pit'); // shoved over an edge: the HOLE is what got him, not the shover
      king.hp -= 1;
      king.wasHit = true; king.hitThisFloor = true;
      checkDeath(state);
      if (!state.gameOver) {
        const out = nearestFooting(state, bx, by);
        if (out) { king.x = out.x; king.y = out.y; }
        // bossTitle NEVER returns falsy (it falls back to "<kind> guardian"), so a `||` here would
        // be dead and a plain knight would be announced as a guardian. Ask what it IS.
        state.message = `${enemy.boss ? bossTitle(enemy) : `The ${enemy.kind}`} hurls the king into a pit — he claws his way out!`;
      } else {
        state.message = 'The king is hurled into the pit — and does not climb out.';
      }
      state.lastAction = 'hit';
      if (!state.gameOver) collectKeyIfHere(state); // he might climb out onto the key
      updateDiscovery(state);
      return state; // NB: callers do `return knockbackKing(...)` — this MUST hand the state back
    }
    if (inBounds && standableFor(terrainAt(state, bx, by), { phaseWalls: Boolean(king.phase) })) {
      if (resolveShoveInto(state, bx, by, null, true)) {
        const kx = king.x;
        const ky = king.y;
        king.x = bx;
        king.y = by;
        enemy.x = kx;
        enemy.y = ky;
        pushed = true;
      }
    }
  }
  // It leapt at him and could NOT move him (his back was to a wall, or the blow was warded). It
  // still has to come DOWN somewhere — it bounces off and lands beside him, nearest the side it
  // sprang from. Otherwise a king with his back to a wall watched a knight lunge at him and stay
  // exactly where it was, which read as the leap never happening.
  if (!pushed && !state.gameOver) bounceJumperBeside(state, enemy, king.x, king.y, enemy.x, enemy.y);
  if (mit) {
    state.message = mitigationMessage(mit, enemy.kind);
    state.lastAction = 'enemy';
  } else {
    state.message = pushed ? `A ${enemy.kind} bowls the king aside!` : `A ${enemy.kind} leaps upon the king!`;
    state.lastAction = 'hit';
  }
  if (!state.gameOver) collectKeyIfHere(state); // shoved onto the key? he grabs it
  if (!state.gameOver && pushed) checkDefenestration(state); // bowled onto the open stair? he tumbles down
  applyReflect(state, enemy, mit); // Riposte (Sentinel): only a leap his GUARD turned aside is answered
  updateDiscovery(state);
  return state;
}

// Can this (non-jumping) enemy strike the king from where it stands? Adjacent only.
function canMeleeStrike(state, enemy) {
  return chebyshev(enemy.x, enemy.y, state.player.x, state.player.y) === 1;
}

// A piece attacks ONLY if it can move onto the king this turn; otherwise it just
// advances. Never both. Jumpers knock him back; others strike (persisting).
// A ranged SLIDER (rook / bishop / queen) that can reach the king CLOSES IN before it strikes —
// it slides right up to the tile beside him along its approach line rather than sniping from across
// the room. (Leapers already close the whole gap via knockbackKing; bosses with Volley/Sorcerer and
// turrets legitimately fire from afar and never call this.) Already-adjacent pieces stay put. The
// tile beside the king lies on the just-verified capture path, so it's clear — but we re-check for
// safety and simply strike in place if it isn't (e.g. the king embedded in cover).
function closeInBeforeStrike(state, mover) {
  const king = state.player;
  if (chebyshev(mover.x, mover.y, king.x, king.y) <= 1) return; // already adjacent
  const ax = king.x - Math.sign(king.x - mover.x);
  const ay = king.y - Math.sign(king.y - mover.y);
  if (ax === mover.x && ay === mover.y) return;
  if (keyTileAt(state, ax, ay)) return;
  if (state.enemies.some((e) => e.id !== mover.id && e.x === ax && e.y === ay) || allyAt(state, ax, ay)) return;
  if (!standableFor(terrainAt(state, ax, ay), pieceTerrainOpts(mover))) return; // never slide into a wall/pit/ice
  mover.x = ax;
  mover.y = ay;
}

// A tree or a gate between a foe and the king is not cover — it is a door it can cut through. When
// nothing it may legally do brings it any closer, it hacks at the timber in its way instead of
// milling about. Without this a stand of trees made a piece harmless for the rest of the run: it
// would shuffle back and forth forever while the king shot it through the bars of a gate at leisure.
// Only timber that stands nearer the king than the foe itself counts — it cuts its way TOWARD him,
// never idly at a tree behind its back.
// A flood of grid distances OUT from the king over tiles a mover could plausibly cross — used to ask
// "is there a way AROUND this timber, or is cutting through it the only route?". Solid barriers a
// mover routes around (wall / boulder / pit / ice / lava) always block; TIMBER and IRON (choppable)
// block only when `blockChoppable`. Comparing the two floods tells us how much LONGER the detour is
// than plowing straight through. 8-directional, one step per tile — a rough proxy, but enough for the
// chop-or-go-around call. Enemies are ignored (terrain only), so it is the same for every mover this
// turn and cheap to run per blocked piece.
function floodDistFromKing(state, blockChoppable) {
  const dist = new Map();
  const passable = (x, y) => {
    if (x < 0 || x >= WORLD_SIZE || y < 0 || y >= WORLD_SIZE) return false;
    const t = terrainAt(state, x, y);
    if (t === 'wall' || t === 'boulder' || t === 'pit' || t === 'ice' || t === 'lava') return false;
    if (blockChoppable && isChoppable(t)) return false;
    return true;
  };
  dist.set(`${state.player.x},${state.player.y}`, 0);
  let frontier = [[state.player.x, state.player.y]];
  let d = 0;
  while (frontier.length) {
    const nextFrontier = [];
    d += 1;
    for (const [x, y] of frontier) {
      for (const [dx, dy] of [...ORTHO, ...DIAG]) {
        const nx = x + dx;
        const ny = y + dy;
        const k = `${nx},${ny}`;
        if (dist.has(k) || !passable(nx, ny)) continue;
        dist.set(k, d);
        nextFrontier.push([nx, ny]);
      }
    }
    frontier = nextFrontier;
  }
  return dist;
}

// Should a blocked mover GO AROUND the timber/iron in its way rather than hack through it? Yes when a
// route around EXISTS and is not much longer than plowing straight through — the flood with choppables
// blocked vs passable measures exactly that gap. When it says "go around", the caller simply lets the
// piece take its ordinary advance (which steps to the side and rounds a lone tree on its own); only a
// genuine wall of timber, or a detour far longer than cutting through, is worth stopping to chop.
// (No move is made here — deciding is all this does, so a slider's own multi-tile step does the going
// around, which a one-grid-step proxy would wrongly read as "no progress" and send it back to chopping.)
const DETOUR_SLACK = 4; // go around unless the way around is more than this many tiles longer
function preferDetour(state, enemy) {
  const ek = `${enemy.x},${enemy.y}`;
  const around = floodDistFromKing(state, true);
  const dAround = around.has(ek) ? around.get(ek) : Infinity;
  if (dAround === Infinity) return false; // no way around at all — the choppable is a true chokepoint
  const through = floodDistFromKing(state, false);
  const dThrough = through.has(ek) ? through.get(ek) : Infinity;
  return dAround <= dThrough + DETOUR_SLACK; // around is comparable to through → round it, don't chop
}

function chopTowardKing(state, enemy) {
  const king = state.player;
  const here = chebyshev(enemy.x, enemy.y, king.x, king.y);
  let best = null;
  for (const [dx, dy] of [...ORTHO, ...DIAG]) {
    const x = enemy.x + dx;
    const y = enemy.y + dy;
    if (!isChoppable(terrainAt(state, x, y))) continue;
    const d = chebyshev(x, y, king.x, king.y);
    if (d >= here) continue; // it is not in the way
    if (!best || d < best.d) best = { x, y, d };
  }
  if (!best) return false;
  const what = terrainAt(state, best.x, best.y) === 'gate' ? 'gate' : 'tree';
  // It LUNGES at the barrier as it swings — the same strike-nudge it makes at the king — so hacking a
  // gate or tree reads as a blow, not a piece sitting inert beside it. Toward the TILE, not the king.
  state.strikeBump = { id: enemy.id, dx: Math.sign(best.x - enemy.x), dy: Math.sign(best.y - enemy.y) };
  const res = damageTree(state, best.x, best.y, 1);
  state.message = res === 'felled'
    ? `A ${enemy.kind} hacks down the ${what} in its way!`
    : `A ${enemy.kind} hacks at the ${what} in its way.`;
  state.lastAction = 'enemy';
  if (res === 'felled') updateDiscovery(state); // it just opened the view beyond
  return true;
}

function meleeMove(state, enemy) {
  const king = state.player;
  const moves = getPieceMoves(enemy, state);
  const capMove = moves.find((m) => m.x === king.x && m.y === king.y);
  if (capMove) {
    // A king EMBEDDED in cover (phased into a wall/ice) is struck in place — the foe can't
    // stand on the tile, so even a jumper merely lands a blow without knocking him back.
    if (isJumperKind(enemy.kind) && !capMove.embedded) return knockbackKing(state, enemy);
    if (!capMove.embedded) closeInBeforeStrike(state, enemy); // a slider slides up adjacent first
    strikeKing(state, enemy);
    return state;
  }
  // The king is out of reach — cut down one of his allies if one is in range instead.
  const allyHit = moves.find((m) => allyAt(state, m.x, m.y));
  if (allyHit) {
    const a = allyAt(state, allyHit.x, allyHit.y);
    addSpatter(state, allyHit.x, allyHit.y, 0, 0, isDemonKind(a.kind));
    // A General soaks the blow and holds its ground; a wisp falls and the foe takes its tile.
    if (!damageAlly(state, a, 1)) {
      state.message = `A ${enemy.kind} hammers your ${a.kind} (${a.hp}/${a.maxHp}).`;
      state.lastAction = 'enemy';
      return state;
    }
    enemy.x = allyHit.x;
    enemy.y = allyHit.y;
    state.message = `A ${enemy.kind} cuts down your ${a.kind}!`;
    state.lastAction = 'enemy';
    return state;
  }
  const legal = preferNonGeyser(state, moves.filter((m) => !(m.x === king.x && m.y === king.y) && !allyAt(state, m.x, m.y)));
  // Cornered, or able to move but never any NEARER: if timber bars the way, cut it down. Checking
  // "can I actually close?" rather than merely "am I stuck?" is what makes a foe chop through a
  // hedge instead of pacing along it forever — pacing is a legal move, so it never looked stuck.
  const here = chebyshev(enemy.x, enemy.y, king.x, king.y);
  const closes = legal.some((m) => chebyshev(m.x, m.y, king.x, king.y) < here);
  // Blocked from getting nearer by a straight step. Cut down the timber/iron in the way — UNLESS
  // there's an easy way around, in which case fall through to the ordinary advance and round it. A
  // foe should not stop to chop a lone tree or a hedge it could just walk past.
  if (!closes && !preferDetour(state, enemy) && chopTowardKing(state, enemy)) return state;
  if (!legal.length) {
    enemy.frustrated = true;
    state.message = 'A cornered piece fumes, unable to move.';
    state.lastAction = 'enemy';
    return state;
  }
  const chosen = chooseHostileMove(legal, king.x, king.y, state, enemy);
  const fromX = enemy.x;
  const fromY = enemy.y;
  enemy.x = chosen.x;
  enemy.y = chosen.y;
  crushBoulderUnder(state, enemy); // a leaper that lands on a boulder crushes it
  if (!bossHas(enemy, 'phasing')) settleLeapOnIce(state, enemy, fromX, fromY); // a leaping foe skids off ice too (a phasing boss grips it)
  state.message = `${capitalize(aWord(enemy.kind))} advances.`;
  state.lastAction = 'enemy';
  return state;
}

// A blow has to be SEEN to land. A foe that strikes without moving did it in total silence: the
// king simply lost a heart while every piece on the board stood perfectly still. Flag the striker
// and the way it swung, and the view shoves its token at him and snaps it back — the mirror of the
// king's own lunge into something he can't fell in one blow.
//
// ADJACENCY is the test for "did it swing". A turret or a ranged guardian hits from across the room
// and already shows a bolt in flight; it must not lurch forward. Keying off distance rather than a
// per-piece flag means any ranged attacker added later is silently correct without touching this.
function markStrikeBump(state, attacker) {
  const k = state.player;
  if (!attacker || chebyshev(attacker.x, attacker.y, k.x, k.y) > 1) return; // a shot, not a swing
  state.strikeBump = { id: attacker.id, dx: Math.sign(k.x - attacker.x), dy: Math.sign(k.y - attacker.y) };
}

// Resolve an ordinary enemy striking the king (it persists — never expends itself).
function strikeKing(state, enemy) {
  markStrikeBump(state, enemy); // a parried blow was still swung — mark it before mitigation
  const mit = rollMitigation(state, enemy);
  if (!mit) {
    hurtBy(state, foeDeathTags(enemy));
    state.player.hp -= 1;
    state.player.wasHit = true; state.player.hitThisFloor = true;
    bloody(enemy, BLOOD_STRIKE); // the striker is flecked (the king shows HP wounds)
    addSpatter(state, state.player.x, state.player.y, Math.sign(state.player.x - enemy.x), Math.sign(state.player.y - enemy.y));
    state.message = `A ${enemy.kind} strikes the king!`;
    state.lastAction = 'hit';
    checkDeath(state);
  } else {
    state.message = mitigationMessage(mit, enemy.kind);
    state.lastAction = 'enemy';
  }
  applyReflect(state, enemy, mit); // Riposte (Sentinel): only a blow his GUARD turned aside is answered
  return state;
}

// A Volley/Sorcerer boss looses a bolt at the king when he lies along one of the boss's
// OWN movement lines — a bishop only down its diagonals, a rook only down ranks/files, a
// queen either. (It never fires a line its piece can't travel.) A plain Volley is stopped
// by anything in the lane (cover or a body); a Sorcerer's bolt pierces every unit on the
// path, wounding each. Walls stop both. Returns true if it fired, false to fall back to a
// normal advancing move.
function bossRangedAttack(state, boss) {
  const king = state.player;
  const ddx = king.x - boss.x;
  const ddy = king.y - boss.y;
  if (ddx === 0 && ddy === 0) return false;
  const onLine = ddx === 0 || ddy === 0 || Math.abs(ddx) === Math.abs(ddy);
  if (!onLine) return false;
  const dx = Math.sign(ddx);
  const dy = Math.sign(ddy);
  // The king must sit on a ray the boss's piece can actually slide along...
  if (!cardSlideDirs(boss.kind).some(([sx, sy]) => sx === dx && sy === dy)) return false;
  // ...and WITHIN ITS REACH. A bolt travels the piece's own line and no further: Volley changes what
  // happens when it strikes down that line, not how far the line goes. Without this the ray ran to
  // the edge of the world on nothing but a direction match, so a KING boss (reach: one step, but
  // eight legal directions) sniped the player from across the floor — while the threat map, reading
  // its real one-tile pattern, promised him the ground was safe.
  if (!hasFiringLine(boss.kind)) return false;
  const reach = pieceLineReach(boss.kind);
  if (Math.max(Math.abs(ddx), Math.abs(ddy)) > reach) return false;
  const pierce = bossHas(boss, 'sorcerer');
  const path = [];
  const shattered = []; // boulders the bolt smashes through on its way to the king
  let x = boss.x + dx;
  let y = boss.y + dy;
  let reached = false;
  let step = 0;
  while (x >= 0 && x < WORLD_SIZE && y >= 0 && y < WORLD_SIZE && ++step <= reach) {
    const terr = terrainAt(state, x, y);
    if (terr === 'wall') return false; // stone stops any bolt cold
    if (terr === 'tree') return false; // a trunk stops it too — a Sorcerer LIGHTS it instead (below)
    if (terr === 'boulder') shattered.push({ x, y }); // the bolt blasts it apart in passing (incidental)
    if (terr === 'ice') { if (!pierce) return false; shattered.push({ x, y, melt: true }); } // only a Sorcerer's fire thaws through an ice slab
    if (terr === 'devilgrass') { if (!pierce) return false; shattered.push({ x, y, grass: true }); } // a plain volley can't see through the thicket; fire burns it
    if (x === king.x && y === king.y) {
      reached = true;
      break;
    }
    const inLane = state.enemies.some((e) => e.id !== boss.id && e.x === x && e.y === y) || allyAt(state, x, y);
    if (inLane && !pierce) return false; // a plain volley can't shoot past a body
    path.push({ x, y });
    x += dx;
    y += dy;
  }
  if (!reached) return false;
  // The shot is confirmed — anything that stood in the bolt's path is dealt with: boulders
  // blasted to rubble, ice thawed to water, devilgrass scorched away.
  for (const b of shattered) {
    if (b.melt) meltIce(state, b.x, b.y);
    else if (b.grass) clearDevilgrass(state, b.x, b.y);
    else smashBoulder(state, b.x, b.y);
  }
  // A Sorcerer boss looses a piercing fireball that scorches every tile on the path
  // (its own bolt lands on the king's tile); a Volley boss looses a plain arrow.
  state.lastShot = {
    fromX: boss.x, fromY: boss.y, toX: king.x, toY: king.y,
    role: pierce ? 'fireball' : 'arrow',
    tiles: pierce ? [...path.map((t) => ({ x: t.x, y: t.y })), { x: king.x, y: king.y }] : null,
  };
  if (pierce) {
    state.player.burnedByFire = true; // its bolt is spellfire, and it is about to wash over him
    // A SORCERER's bolt is SPELLFIRE, and fire does the same things to the floor whoever throws it.
    // This used to shatter a boulder and stop there — no scorch, no lit trees, no boiled water —
    // so the same bolt left a completely different world behind depending on which end it came from.
    // scorchTileTerrain and scorchGround are the king's own, reused verbatim rather than restated.
    for (const t of [...path, { x: king.x, y: king.y }]) {
      scorchTileTerrain(state, t.x, t.y); // thaw ice, wither grass, LIGHT trees, blast boulders
      scorchGround(state, t.x, t.y); // ...and blacken the stone, boiling off any water
    }
    // Everything caught on the path is wounded (the boss spares only itself).
    for (const t of path) {
      const ally = allyAt(state, t.x, t.y);
      if (ally) {
        state.allies = state.allies.filter((a) => a.id !== ally.id);
        addSpatter(state, t.x, t.y, dx, dy, isDemonKind(ally.kind));
        addAsh(state, t.x, t.y); // burnt down by the sorcerer's bolt
        continue;
      }
      const foe = state.enemies.find((e) => e.id !== boss.id && !e.boss && e.x === t.x && e.y === t.y);
      if (foe) {
        state.enemies = state.enemies.filter((e) => e.id !== foe.id);
        addSpatter(state, t.x, t.y, dx, dy, isDemonKind(foe.kind));
        addAsh(state, t.x, t.y);
      }
    }
  }
  const mit = rollMitigation(state, boss);
  if (!mit) {
    king.hp -= 1;
    king.wasHit = true; king.hitThisFloor = true;
    bossLeech(boss); // a Leech guardian mends a wound as its bolt bites
    addSpatter(state, king.x, king.y, dx, dy); // blood sprays along the bolt's path
    state.message = pierce
      ? `${bossTitle(boss)} looses a searing bolt through all in its path!`
      : `${bossTitle(boss)} looses a bolt at the king!`;
    state.lastAction = 'hit';
    checkDeath(state);
  } else {
    state.message = mitigationMessage(mit, boss.kind);
    state.lastAction = 'enemy';
  }
  return true;
}

// A boss's turn: hunt like its piece, and strike ONLY if it can capture the king.
// WARPER (boss trait): swap the boss and the king if the BOSS'S tile is markedly more dangerous to
// the king than his own — measured by the very threat map the player sees (how many foes could hit
// him if he stood there). Never when adjacent (its strike is for that), and only from a genuinely
// worse tile, so it reads as "you lured me somewhere lethal — now YOU stand here". Returns true if it
// swapped. `getThreatenedTiles` lives in board.js (loaded first), so it is a global here at runtime.
// --- ON-TURN GUARDIAN TRAITS -------------------------------------------------
// Each is gated on the boss being SEEN and HUNTING (bossSeenAndHunting) — a guardian the player has
// never laid eyes on never breeds turrets, grows forests, or teleports from off in the dark.

// MECHANIC: a 1-in-4 chance each turn to bolt a fresh turret onto sound nearby ground (spends the
// turn, like Summoner). Returns true if it built one.
function bossBuildTurret(state, boss) {
  if (Math.random() >= 0.25) return false;
  const spots = [];
  for (let dx = -2; dx <= 2; dx += 1) for (let dy = -2; dy <= 2; dy += 1) {
    const x = boss.x + dx;
    const y = boss.y + dy;
    if (dx === 0 && dy === 0) continue;
    if (x < 1 || x >= WORLD_SIZE - 1 || y < 1 || y >= WORLD_SIZE - 1) continue;
    if (terrainAt(state, x, y) !== 'normal') continue; // plain ground only
    if (x === state.player.x && y === state.player.y) continue;
    if (keyTileAt(state, x, y) || (state.exit && x === state.exit.x && y === state.exit.y)) continue;
    if (state.enemies.some((e) => e.x === x && e.y === y) || allyAt(state, x, y)) continue;
    if (turretBlocksHallway(state, x, y)) continue; // never plug a corridor with it
    spots.push({ x, y });
  }
  if (!spots.length) return false;
  const s = spots[randomInt(spots.length)];
  state.enemies.push(makeTurret(state, randomTurretKind(state.floor), s.x, s.y));
  cue(state, 'thrum');
  state.message = `${bossTitle(boss)} bolts together a turret!`;
  state.lastAction = 'enemy';
  return true;
}

// BEASTMASTER (pet owner): keeps a ferz familiar. Whenever NO hostile ferz is in view, it conjures a
// fresh one at its side — so the pet cannot be permanently killed while the master lives. Spends the turn.
// BEASTMASTER (petowner): keeps a ferz familiar at heel. Whistling up a fresh one is a FREE effect
// now — it does NOT cost the boss its turn (it still hunts/strikes the same turn), so the pet is a
// standing threat the boss maintains rather than a turn it trades away.
function bossSpawnPet(state, boss) {
  const hasFerz = getVisibleEnemies(state).some((e) => e.kind === 'ferz' && !e.summonCircle && !isNeutralBeast(state, e));
  if (hasFerz) return false;
  if (!summonAdjacent(state, boss, 'ferz')) return false;
  const pet = state.enemies[state.enemies.length - 1];
  if (pet) { pet.awake = true; pet.provoked = true; rememberAt(pet, state.player.x, state.player.y, state.kingHeading); }
  return true;
}

// FOGWEAVER: each turn it breathes out a bank of fog on 1-8 tiles around itself, blinding the king to
// the room. A FREE effect (it still hunts and strikes). Fog is HAZE, so the Oracle's Premonition peers
// through it. It fogs its OWN tile too, so a Steamweaver is often hidden in its own murk.
function bossFog(state, boss) {
  const n = 1 + randomInt(8); // 1..8 tiles this turn
  // AROUND itself, never its OWN tile — steam scalds, and a Steamweaver must not choke in its own murk.
  const dirs = [...ORTHO, ...DIAG];
  for (let i = dirs.length - 1; i > 0; i -= 1) { const j = randomInt(i + 1); [dirs[i], dirs[j]] = [dirs[j], dirs[i]]; }
  let laid = 0;
  for (const [dx, dy] of dirs) {
    if (laid >= n) break;
    const fx = boss.x + dx;
    const fy = boss.y + dy;
    // Never fog the tile the KING is standing on — steam damages now, and conjuring it directly under
    // him would be an unavoidable, undodgeable hit. It has to well up on a tile he can still step off.
    if (fx === state.player.x && fy === state.player.y) continue;
    addFog(state, fx, fy);
    laid += 1;
  }
  if (laid) cue(state, 'thrum');
}

// GARDENER (mortal): now and then the wild grows up around it — a handful of adjacent tiles turn to
// grass, timber or a pool. A FREE effect (it still acts); never touches walls or the king's tile.
const GARDEN_TYPES = ['devilgrass', 'tree', 'water'];
function bossGarden(state, boss) {
  if (Math.random() >= 0.34) return;
  let grew = false;
  const n = 1 + randomInt(3); // some, not all
  for (let i = 0; i < n; i += 1) {
    if (terraformNearby(state, boss.x, boss.y, GARDEN_TYPES[randomInt(GARDEN_TYPES.length)])) grew = true;
  }
  if (grew) cue(state, 'thrum');
}

// SHADOWSTEP (demon): slip through the dark to a tile inside the screen that the king cannot directly
// SEE (behind a wall / in fog) and that is CLOSER to him than where it stands. Premonition's x-ray
// does NOT shield a tile from this — only true line of sight does. Returns true if it stepped.
function bossShadowstep(state, boss) {
  const king = state.player;
  const bounds = getVisibleBounds(state);
  const here = chebyshev(boss.x, boss.y, king.x, king.y);
  let best = null;
  for (let y = bounds.y; y < bounds.y + bounds.height; y += 1) {
    for (let x = bounds.x; x < bounds.x + bounds.width; x += 1) {
      if (hasLineOfSight(state, king.x, king.y, x, y, false)) continue; // must be UNSEEN (true sight only)
      const d = chebyshev(x, y, king.x, king.y);
      if (d < 1 || d >= here) continue; // never onto him, and only if it CLOSES the gap
      if (!isStandable(terrainAt(state, x, y))) continue;
      if (keyTileAt(state, x, y) || (state.exit && x === state.exit.x && y === state.exit.y)) continue;
      if (state.enemies.some((e) => e.id !== boss.id && e.x === x && e.y === y) || allyAt(state, x, y)) continue;
      if (!kindCanMove(state, boss.kind, x, y)) continue;
      if (!best || d < best.d) best = { x, y, d };
    }
  }
  if (!best) return false;
  puffSmoke(state, boss.x, boss.y);
  boss.x = best.x;
  boss.y = best.y;
  puffSmoke(state, boss.x, boss.y);
  cue(state, 'thrum');
  state.message = `${bossTitle(boss)} melts into shadow and reappears, closer!`;
  state.lastAction = 'enemy';
  updateDiscovery(state);
  return true;
}

// BURROWER: tear open a fresh pit on a VISIBLE, unoccupied tile nearer the king and drop into it (it
// treads the void as solid ground). The pit devours whatever was there — grass, timber, a boulder —
// but never stone, lava, or water. Returns true if it burrowed.
function bossBurrowTeleport(state, boss) {
  const king = state.player;
  const bounds = getVisibleBounds(state);
  const here = chebyshev(boss.x, boss.y, king.x, king.y);
  let best = null;
  for (let y = bounds.y; y < bounds.y + bounds.height; y += 1) {
    for (let x = bounds.x; x < bounds.x + bounds.width; x += 1) {
      if (!hasLineOfSight(state, king.x, king.y, x, y, false)) continue; // surfaces where he can SEE it
      const t = terrainAt(state, x, y);
      if (t === 'wall' || t === 'lava' || t === 'water') continue; // cannot bore through these
      const d = chebyshev(x, y, king.x, king.y);
      if (d < 1 || d >= here) continue;
      if (x === king.x && y === king.y) continue;
      if (keyTileAt(state, x, y) || (state.exit && x === state.exit.x && y === state.exit.y)) continue;
      if (state.enemies.some((e) => e.id !== boss.id && e.x === x && e.y === y) || allyAt(state, x, y)) continue;
      if (!best || d < best.d) best = { x, y, d };
    }
  }
  if (!best) return false;
  const k = `${best.x},${best.y}`;
  const was = Object.prototype.hasOwnProperty.call(state.terrain, k) ? state.terrain[k] : undefined;
  smashBoulder(state, best.x, best.y); // a boulder there is torn up as the pit opens
  state.terrain[k] = 'pit';
  if (typeof dangerReachOk === 'function' && !dangerReachOk(state)) { // never seal him off with the new hole
    if (was === undefined) delete state.terrain[k]; else state.terrain[k] = was;
    return false;
  }
  puffSmoke(state, boss.x, boss.y);
  boss.x = best.x;
  boss.y = best.y;
  puffSmoke(state, boss.x, boss.y);
  cue(state, 'rumble');
  state.message = `${bossTitle(boss)} burrows and erupts from a fresh pit!`;
  state.lastAction = 'enemy';
  updateDiscovery(state);
  return true;
}

const WARP_DANGER_GAP = 2; // the boss tile must threaten the king with at least this many MORE foes
function bossWarpSwap(state, boss) {
  const king = state.player;
  if (chebyshev(boss.x, boss.y, king.x, king.y) <= 1) return false; // adjacent: it strikes, never warps
  if (typeof getThreatenedTiles !== 'function') return false;
  const threat = getThreatenedTiles(state);
  const bossDanger = threat.get(`${boss.x},${boss.y}`) || 0;
  const kingDanger = threat.get(`${king.x},${king.y}`) || 0;
  if (bossDanger < kingDanger + WARP_DANGER_GAP) return false; // its tile isn't worse ENOUGH to bother
  const bx = boss.x;
  const by = boss.y;
  puffSmoke(state, bx, by); // smoke at both ends of the wrench
  puffSmoke(state, king.x, king.y);
  boss.x = king.x;
  boss.y = king.y;
  king.x = bx;
  king.y = by;
  cue(state, 'thrum');
  collectKeyIfHere(state); // wrenched onto the key? he grabs it
  checkDefenestration(state); // wrenched onto the open stair? he tumbles to the next floor
  updateDiscovery(state);
  if (state.lastAction !== 'exit') {
    state.message = `${bossTitle(boss)} wrenches reality — you and it trade places!`;
    state.lastAction = 'enemy';
  }
  return true;
}

function bossMove(state, boss) {
  const king = state.player;
  // A non-immune guardian (an earlier-age piece, or one of the finale's rush bosses) sears in
  // lava it stands on — 1 wound at the start of its turn, so the king can lure or knock a
  // vanilla-type boss into a lava field to whittle it down. Demon-floor guardians are immune.
  if (!boss.lavaImmune && terrainAt(state, boss.x, boss.y) === 'lava') {
    addSmoke(state, boss.x, boss.y);
    if (damageBoss(state, boss, 1, { ground: true }) === 'slain') { state.lastAction = 'combat'; return state; }
  }
  // Likewise a non-immune Phasing guardian embedded in a wall-torch sears — so its own wall-hiding
  // can be turned against it near a torch (it normally routes around them — see pieceTerrainOpts).
  if (!boss.lavaImmune && hasTorch(state, boss.x, boss.y)) {
    if (damageBoss(state, boss, 1, { ground: true }) === 'slain') { state.lastAction = 'combat'; return state; }
  }
  // Regenerating: it knits one wound shut every fourth turn (ticked whether it acts or recovers).
  if (bossHas(boss, 'regen')) {
    boss.regenTick = (boss.regenTick || 0) + 1;
    if (boss.regenTick % 4 === 0 && boss.hp < boss.maxHp) boss.hp += 1;
  }
  // LICH: it calls the fallen back up — one a turn, from a body still fresh enough to answer.
  //
  // Ticked HERE, beside regen and above the recovering gate, because raising is not an ACTION: it
  // does not have to stop to do it, so it raises on the turns it swings AND the turns it stands
  // there getting its breath back. Below the gate it would only manage one every OTHER turn, which
  // is not what "one a turn" means.
  //
  // The pressure it makes is unlike Summoner's. A Summoner adds to the room out of nothing, so it
  // is a clock you race. A Lich adds nothing — it recycles what the king has ALREADY killed, so it
  // turns his own victories into the thing beating him, and the only answer is to kill IT. Fighting
  // one in a room you have already fought through is exactly the wrong idea.
  // Only a COIN-FLIP each turn, so it recycles the dead at half pace — a room it fought through does
  // not refill under the king faster than he can clear it. Still at most one a turn when it does fire.
  if (bossHas(boss, 'lich') && Math.random() < 0.5) raiseNearbyDead(state, boss);
  // A giant guardian must catch its breath after every exertion: the turn AFTER it acts it
  // only RECOVERS, giving the king a window to strike or reposition. (This is what makes
  // these long-reach, high-HP bosses fair to fight.)
  if (boss.recovering) {
    boss.recovering = false;
    state.message = `${bossTitle(boss)} lumbers, catching its breath.`;
    state.lastAction = 'enemy';
    return state;
  }
  // A dormant guardian holds the stair/portal until it SEES the king (line of sight within
  // view) or is struck (hp < maxHp) — then it rouses for good. Seeing him is the trigger now,
  // not merely stepping adjacent, so a guardian on the far side of the room stirs on sight.
  if (boss.dormant) {
    if (boss.hp < boss.maxHp || enemyAwareOfKing(state, boss.x, boss.y, bossHas(boss, 'phasing'))) {
      boss.dormant = false;
    } else {
      const guarded = state.key && state.key.orb ? 'Orb' : 'key';
      state.message = `${bossTitle(boss)} guards the ${guarded}, unmoving.`;
      state.lastAction = 'idle'; // it sits: worth SAYING once, but not worth a beat of animation
      return state;
    }
  }
  // The first time it turns hostile, a guardian ROARS its threat — logged separately (state.bossLine)
  // so it does NOT cost the boss its action: a boss already awake/chasing (not freshly surprised)
  // strikes or advances THIS turn, then recovers. The surprise-freeze is its only telegraph.
  if (!boss.spokeLine) {
    boss.spokeLine = true;
    state.bossLine = bossHostileLine(boss);
    // A one-turn speech bubble. `demon` flips it to black-and-red in the view.
    state.bossShout = { x: boss.x, y: boss.y, text: bossShoutLine(boss), demon: isDemonBoss(boss) };
  }
  boss.recovering = true; // whatever the boss does below, it must recover next turn
  // Summoner: every third turn it conjures a minion of its own kind instead of acting.
  if (bossHas(boss, 'summoner')) {
    boss.perkTick = (boss.perkTick || 0) + 1;
    if (boss.perkTick % 3 === 0) {
      const made = summonAdjacent(state, boss, boss.kind);
      state.message = made
        ? `${bossTitle(boss)} conjures a ${boss.kind}!`
        : `${bossTitle(boss)} reaches for aid, but finds no room.`;
      state.lastAction = 'enemy';
      return state;
    }
  }
  // BEASTMASTER: if its ferz familiar has fallen, whistle up a new one — a FREE effect, so it still
  // acts (hunts/strikes) this same turn.
  if (bossHas(boss, 'petowner') && bossSeenAndHunting(state, boss)) bossSpawnPet(state, boss);
  // MECHANIC: a 1-in-4 chance to bolt together a turret instead of acting.
  if (bossHas(boss, 'mechanic') && bossSeenAndHunting(state, boss) && bossBuildTurret(state, boss)) return state;
  // GARDENER: the wild sometimes grows around it — a FREE effect, so it still acts below.
  if (bossHas(boss, 'gardener') && bossSeenAndHunting(state, boss)) bossGarden(state, boss);
  // FOGWEAVER: breathe out fog around itself — FREE, so it still acts below.
  if (bossHas(boss, 'steamweaver') && bossSeenAndHunting(state, boss)) bossFog(state, boss);
  // Volley / Sorcerer: loose a bolt down an open line rather than closing to melee.
  if ((bossHas(boss, 'ranged') || bossHas(boss, 'sorcerer')) && bossRangedAttack(state, boss)) {
    return state;
  }
  const moves = getPieceMoves(boss, state);
  const canCapture = moves.some((m) => m.x === king.x && m.y === king.y);
  if (canCapture) {
    if (isJumperKind(boss.kind) || bossHas(boss, 'knockback')) return knockbackKing(state, boss);
    // A non-ranged slider guardian slides up beside the king before it strikes (Volley/Sorcerer
    // guardians fired from afar above and never reach here).
    if (terrainAt(state, king.x, king.y) !== 'wall' && terrainAt(state, king.x, king.y) !== 'ice') closeInBeforeStrike(state, boss);
    return bossHit(state, boss, `${bossTitle(boss)} strikes the king!`);
  }
  // WARPER: it cannot reach him this turn — but if it STANDS somewhere far deadlier to him than where
  // he stands, it wrenches the two of them into each other's places, shoving him into the crossfire
  // and taking the safe ground for itself. (Its whole counter to being lured onto a dangerous tile.)
  if (bossHas(boss, 'warper') && bossWarpSwap(state, boss)) return state;
  // SHADOWSTEP / BURROWER: displace closer to the king when it can't reach him by walking — through
  // the dark to an unseen tile, or by tearing open a new pit to erupt from. Both only if it CLOSES in.
  if (bossHas(boss, 'shadowstep') && bossSeenAndHunting(state, boss) && bossShadowstep(state, boss)) return state;
  if (bossHas(boss, 'burrower') && bossSeenAndHunting(state, boss) && bossBurrowTeleport(state, boss)) return state;
  const bossAlly = moves.find((m) => allyAt(state, m.x, m.y));
  if (bossAlly) {
    const a = allyAt(state, bossAlly.x, bossAlly.y);
    state.allies = state.allies.filter((al) => al.id !== a.id);
    addSpatter(state, bossAlly.x, bossAlly.y, 0, 0, isDemonKind(a.kind));
    boss.x = bossAlly.x;
    boss.y = bossAlly.y;
    state.message = `${bossTitle(boss)} destroys your ${a.kind}!`;
    state.lastAction = 'enemy';
    return state;
  }
  const legal = preferNonGeyser(state, moves.filter((m) => !(m.x === king.x && m.y === king.y) && !allyAt(state, m.x, m.y)));
  if (!legal.length) {
    boss.frustrated = true;
    state.message = `${bossTitle(boss)} fumes.`;
    state.lastAction = 'enemy';
    return state;
  }
  const chosen = chooseHostileMove(legal, king.x, king.y, state, boss);
  boss.x = chosen.x;
  boss.y = chosen.y;
  crushBoulderUnder(state, boss); // a leaping boss crushes a boulder it lands on
  state.message = `${bossTitle(boss)} advances.`;
  state.lastAction = 'enemy';
  // HASTY: neither the first step nor this one may LAND a blow (this is the advance branch, so the
  // first drew no blood), and the second is only worth taking if it gets the boss CLOSER (or into
  // striking range for next turn). It never chains into an attack — two moves, never move-then-hit.
  if (bossHas(boss, 'hasty')) bossHastySecondMove(state, boss);
  return state;
}

function bossHastySecondMove(state, boss) {
  const king = state.player;
  const here = chebyshev(boss.x, boss.y, king.x, king.y);
  const legal = getPieceMoves(boss, state).filter((m) => !(m.x === king.x && m.y === king.y) && !allyAt(state, m.x, m.y));
  if (!legal.length) return;
  const chosen = chooseHostileMove(legal, king.x, king.y, state, boss);
  if (chebyshev(chosen.x, chosen.y, king.x, king.y) >= here) return; // no closer → don't bother (never paces)
  boss.x = chosen.x;
  boss.y = chosen.y;
  crushBoulderUnder(state, boss);
  state.message = `${bossTitle(boss)} surges forward again!`;
}

// Move a single (seen, aware) enemy.
function moveEnemy(state, enemyId) {
  const next = structuredClone(state);
  next.lastShot = null;
  next.strikeBump = null; // set below only if THIS enemy actually swings at him
  next.reflectAt = null; // set only if THIS enemy's blow earns a Sentinel riposte
  next.player.deflected = false; // set true only if THIS enemy's blow is deflected
  const enemy = next.enemies.find((piece) => piece.id === enemyId);
  if (!enemy) return next;
  let result;
  // Confusion overrides everything a piece would otherwise do — a guardian's cunning, a turret's
  // firing solution, a rune's count. It cannot tell the king from the thing standing next to it.
  if (isConfused(enemy)) result = confusedTurn(next, enemy);
  else if (enemy.boss) result = bossMove(next, enemy);
  else if (enemy.turret) result = fireTurret(next, enemy);
  else if (enemy.summonCircle) result = summonCircleTurn(next, enemy);
  else result = meleeMove(next, enemy);
  openDoorsUnderUnits(result); // the foe may have stepped onto (and thus opened) a shut door
  return result;
}

/* ------------------------------ danger events ----------------------------- */
// The floor turns against the king the longer he lingers: at intervals (shorter as dread
// climbs) ONE random hostile "event" fires. This REPLACES the old faster-and-faster spawn
// trickle. Each event sets `state.dangerEvent` so the view can shake + play an ominous cue.

// Every open floor tile the king still has a safe path to the exit / key over — used to
// revert any terrain change that would seal him off.
function dangerReachOk(next) {
  const reach = playerReachable(next, next.player.x, next.player.y);
  const need = [];
  if (next.exit) need.push(`${next.exit.x},${next.exit.y}`);
  if (next.key && !next.key.collected) need.push(`${next.key.x},${next.key.y}`);
  return need.every((k) => reach.has(k));
}
// Safety net: guarantee the king can still reach the exit AND the (uncollected) key. If he's
// been walled off — shifting terrain, boulders shoved into a pocket, etc. — wrench him to a
// random open tile in the exit's connected region (which also holds the key) and log it.
function ensureReachable(state) {
  const p = state.player;
  if (!state.exit) return false;
  if (p.phase || p.pathfinder) return false; // he can cross walls / water / pits — never truly boxed in
  if (terrainAt(state, p.x, p.y) === 'lava') return false; // mid lava-crossing — he'll step off; don't yank him
  if (dangerReachOk(state)) return false; // he already reaches all he needs
  const region = playerReachable(state, state.exit.x, state.exit.y); // the exit+key component
  const spots = [];
  for (const k of region) {
    const [x, y] = k.split(',').map(Number);
    if (x === state.exit.x && y === state.exit.y) continue;
    if (state.key && !state.key.collected && x === state.key.x && y === state.key.y) continue;
    if (!isStandable(terrainAt(state, x, y))) continue;
    if (state.enemies.some((e) => e.x === x && e.y === y) || allyAt(state, x, y)) continue;
    spots.push({ x, y });
  }
  if (!spots.length) return false;
  // The NEAREST reachable tile, not a random one. A random pick across the whole exit-region could
  // fling him clear across the map — most vividly when he leaps into the middle of an ice field and
  // shatters only his landing tile, marooning himself on one square ringed by slabs: the net then
  // teleported him a dozen tiles off. Nearest turns that into a minimal nudge — he slides off the
  // ice to the closest solid ground — which is what the fairness net should feel like.
  let dest = spots[0];
  let bestD = chebyshev(dest.x, dest.y, p.x, p.y);
  for (const s of spots) {
    const d = chebyshev(s.x, s.y, p.x, p.y);
    if (d < bestD) { bestD = d; dest = s; }
  }
  state.player.x = dest.x;
  state.player.y = dest.y;
  state.message = 'The shifting walls seal you off — you are wrenched to safer ground!';
  updateDiscovery(state);
  return true;
}
// How many OPEN (normal) interior floor tiles remain.
function openFloorCount(state) {
  let n = 0;
  for (let y = 1; y < WORLD_SIZE - 1; y += 1) for (let x = 1; x < WORLD_SIZE - 1; x += 1) if (terrainAt(state, x, y) === 'normal') n += 1;
  return n;
}
// A terrain-event's tile count: a PERCENTAGE of the open floor (so it spreads widely across the
// whole map early on, but naturally slows as the floor fills — it can never flood everything),
// clamped to [min, max].
function hazardCount(state, pct, min, max) {
  return Math.max(min, Math.min(max, Math.round(openFloorCount(state) * pct)));
}
// Convert up to `count` open floor tiles (well clear of the king, never the exit/key/units)
// to `type`. Undoes ALL of it if that would cut the exit or key off from the king.
function scatterTerrain(next, type, count) {
  const p = next.player;
  const changed = [];
  // A candidate tile: open floor, never ON or adjacent to the king (he needs a step of room),
  // never the exit/key/a unit.
  const ok = (x, y) => terrainAt(next, x, y) === 'normal'
    && chebyshev(x, y, p.x, p.y) >= 2
    && !(next.exit && x === next.exit.x && y === next.exit.y)
    && !(next.key && !next.key.collected && x === next.key.x && y === next.key.y)
    && !next.enemies.some((e) => e.x === x && e.y === y) && !allyAt(next, x, y);
  const drop = (requireVisible) => {
    for (let tries = 0; tries < 300; tries += 1) {
      const x = 1 + randomInt(WORLD_SIZE - 2);
      const y = 1 + randomInt(WORLD_SIZE - 2);
      if (!ok(x, y)) continue;
      if (requireVisible && !inLineOfSight(next, x, y)) continue;
      next.terrain[`${x},${y}`] = type;
      changed.push(`${x},${y}`);
      return true;
    }
    return false;
  };
  // Guarantee that at least HALF the hazard erupts IN the king's view — the danger must read on
  // screen — then let the rest spread anywhere on the floor.
  const visibleWanted = Math.max(1, Math.ceil(count / 2));
  for (let i = 0; i < visibleWanted; i += 1) drop(true);
  while (changed.length < count) { if (!drop(false)) break; }
  if (!dangerReachOk(next)) for (const k of changed) delete next.terrain[k];
  return changed.length;
}
// A cold snap: convert up to `count` tiles to ICE. Unlike a plain scatter, freeze grips open
// floor, PITS, and WATER (never lava, walls, or border stone) — a bridge of ice over a chasm.
// Half erupt in view; undoes all of it if the ice would wall the king off from exit/key.
function freezeTerrain(next, count) {
  const p = next.player;
  const changed = [];
  const ok = (x, y) => {
    const t = terrainAt(next, x, y);
    if (t !== 'normal' && t !== 'pit' && t !== 'water') return false; // floor / pit / water only
    return chebyshev(x, y, p.x, p.y) >= 2
      && !(next.exit && x === next.exit.x && y === next.exit.y)
      && !(next.key && !next.key.collected && x === next.key.x && y === next.key.y)
      && !next.enemies.some((e) => e.x === x && e.y === y) && !allyAt(next, x, y);
  };
  const drop = (requireVisible) => {
    for (let tries = 0; tries < 300; tries += 1) {
      const x = 1 + randomInt(WORLD_SIZE - 2);
      const y = 1 + randomInt(WORLD_SIZE - 2);
      if (!ok(x, y)) continue;
      if (requireVisible && !inLineOfSight(next, x, y)) continue;
      const was = terrainAt(next, x, y); // remember floor/pit/water so a revert restores it exactly
      next.terrain[`${x},${y}`] = 'ice';
      changed.push({ k: `${x},${y}`, was });
      return true;
    }
    return false;
  };
  const visibleWanted = Math.max(1, Math.ceil(count / 2));
  for (let i = 0; i < visibleWanted; i += 1) drop(true);
  while (changed.length < count) { if (!drop(false)) break; }
  if (!dangerReachOk(next)) for (const c of changed) { if (c.was === 'normal') delete next.terrain[c.k]; else next.terrain[c.k] = c.was; }
  return changed.length;
}
// A freshly-spawned foe that the king can already SEE arrives STARTLED: shown "!" the VERY turn it
// materialises (never left wandering), frozen for that turn, then it acts the next. Seeding its
// last-seen memory means even a spawn in the one-way vision band gives chase rather than idling.
function startleSpawn(enemy, king) {
  enemy.awake = true;
  enemy.surprised = true;
  rememberAt(enemy, king.x, king.y, null); // a foe startled awake never watched him walk anywhere
}

// A wave of fresh foes: SOME materialise right in the king's view (a couple of tiles off, so he
// sees them arrive), the rest pour in nearby (a few further off / out of sight).
function spawnWave(next) {
  const cap = Math.min(MAX_ENEMIES, 14 + next.floor * 5 + Math.round(overstayFraction(next.turn) * 50)); // rises UNBOUNDED with overstay, up to the perf ceiling
  const p = next.player;
  const occupied = new Set([`${p.x},${p.y}`]);
  for (const e of next.enemies) occupied.add(`${e.x},${e.y}`);
  let placed = 0;
  const ramp = dreadFraction(next.turn, next.dreadTurns);
  const want = 3 + randomInt(3) + Math.round(ramp * 4); // 3-5 early → 7-9 at max dread
  const drop = (pred, inSight) => {
    if (next.enemies.length >= cap) return false;
    const kind = spawnKindForFloor(next);
    const tile = findFreeTile(occupied, (x, y) => pred(x, y) && isStandable(terrainAt(next, x, y))
      && terrainAt(next, x, y) !== 'geyser' // a spawning foe never materialises on a vent
      && !keyTileAt(next, x, y) && !allyAt(next, x, y) && kindCanMove(next, kind, x, y));
    if (!tile) return false;
    occupied.add(tile.key);
    const e = createEnemy(kind, tile.x, tile.y);
    // ANY spawn the king can actually SEE arrives startled ("!") the instant it appears, regardless
    // of which placement bucket dropped it — so an in-view spawn is never left wandering.
    if (inSight || inLineOfSight(next, tile.x, tile.y)) startleSpawn(e, p);
    next.enemies.push(e);
    placed += 1;
    return true;
  };
  // At least half arrive IN sight (2-6 tiles away, never adjacent — startled, they freeze one turn).
  const visibleWanted = Math.max(1, Math.ceil(want / 2));
  for (let i = 0; i < visibleWanted && placed < want; i += 1) {
    if (!drop((x, y) => chebyshev(x, y, p.x, p.y) >= 2 && chebyshev(x, y, p.x, p.y) <= 6 && inLineOfSight(next, x, y), true)) break;
  }
  // The rest close in from nearby (some out of sight, further off).
  for (let i = 0; i < 40 && placed < want; i += 1) {
    drop((x, y) => chebyshev(x, y, p.x, p.y) >= 2 && chebyshev(x, y, p.x, p.y) <= 9, false);
  }
  return placed ? 'A wave of enemies pours in nearby!' : 'The shadows stir uneasily.';
}
// The reinstated AMBIENT trickle: a lone wanderer creeps onto the map from somewhere OUT of the
// king's sight (anywhere on the floor, not hovering near him — hostile events already crowd his
// heels). It roams until it spots him. Returns true if one slipped in.
function spawnAmbientWanderer(next) {
  const cap = Math.min(MAX_ENEMIES, 14 + next.floor * 5 + Math.round(overstayFraction(next.turn) * 50)); // rises UNBOUNDED with overstay, up to the perf ceiling
  if (next.enemies.length >= cap) return false;
  const p = next.player;
  const occupied = new Set([`${p.x},${p.y}`]);
  for (const e of next.enemies) occupied.add(`${e.x},${e.y}`);
  const kind = spawnKindForFloor(next);
  const tile = findFreeTile(occupied, (x, y) => x >= 1 && x < WORLD_SIZE - 1 && y >= 1 && y < WORLD_SIZE - 1
    && chebyshev(x, y, p.x, p.y) >= 4 && !inLineOfSight(next, x, y) // just out of sight (closer, so they reach him sooner)
    && isStandable(terrainAt(next, x, y)) && terrainAt(next, x, y) !== 'geyser' // never drop a wanderer onto a vent
    && !keyTileAt(next, x, y) && !allyAt(next, x, y) && kindCanMove(next, kind, x, y));
  if (!tile) return false;
  next.enemies.push(createEnemy(kind, tile.x, tile.y));
  return true;
}
// Build a MINI-BOSS of `kind` at (x,y): a lesser guardian — fewer wounds than a floor boss and
// drawn smaller — that grants NO boon when slain (see defeatBoss). Used by the finale's rush and
// by the "a mini-boss rises" danger event. Lava-immune only if it's a demon-kind piece.
function makeMiniBoss(next, kind, x, y) {
  next.player.miniBossesSpawned = (next.player.miniBossesSpawned || 0) + 1; // badge ledger
  const b = createEnemy(kind, x, y);
  b.boss = true;
  b.mini = true; // smaller, lower-HP, no-boon variant
  b.bossName = `a rogue ${kind}`;
  b.originalKind = kind;
  // Same treatment as the floor guardians: the shallowest mini is unchanged, but it grows at half
  // the old rate (was floor/3, topping out at 4). A rogue piece should be a nasty surprise, not a
  // second boss fight — and at the old rate a late-game mini outlasted an early guardian.
  b.maxHp = 2 + Math.floor(next.floor / 6); // clearly fewer wounds than a floor guardian
  b.bossPerks = rollBossPerks(1, kind); // a mini stays lesser: ONE perk, and never the Hardened +3
  b.bossPerk = b.bossPerks[0];
  b.hp = b.maxHp;
  b.lavaImmune = isDemonKind(kind);
  b.dormant = false;
  return b;
}
// The finale's boss-rush: once the Orb is taken, one lesser MINI-BOSS claws in near the king every
// BOSS_RUSH_INTERVAL turns (capped so the board never chokes). It uses an EARLIER, vanilla piece
// kind. It arrives SURPRISED (createEnemy defaults awake:false/surprised:false → a fresh sighting
// freezes it one turn), then turns hostile.
function spawnBossRush(next) {
  const liveRush = next.enemies.filter((e) => e.boss && e.rush).length;
  if (liveRush >= BOSS_RUSH_CAP) return ''; // only one rogue guardian loose at a time
  const p = next.player;
  const kind = STANDARD_KINDS[randomInt(STANDARD_KINDS.length)]; // an earlier-age piece
  const occupied = new Set([`${p.x},${p.y}`]);
  for (const e of next.enemies) occupied.add(`${e.x},${e.y}`);
  const near = (x, y) => isStandable(terrainAt(next, x, y)) && terrainAt(next, x, y) !== 'geyser' && !keyTileAt(next, x, y) && !allyAt(next, x, y) && kindCanMove(next, kind, x, y);
  const tile = findFreeTile(occupied, (x, y) => near(x, y) && chebyshev(x, y, p.x, p.y) >= 2 && chebyshev(x, y, p.x, p.y) <= 5)
    || findFreeTile(occupied, (x, y) => near(x, y) && chebyshev(x, y, p.x, p.y) <= 7);
  if (!tile) return '';
  const b = makeMiniBoss(next, kind, tile.x, tile.y);
  b.rush = true;
  b.lavaImmune = false; // vanilla-age: lava still burns it
  if (inLineOfSight(next, tile.x, tile.y)) startleSpawn(b, next.player); // startled ROAR ("!" telegraph) if it claws in on-screen
  next.enemies.push(b);
  return `A rogue ${kind} mini-boss claws into the world nearby!`;
}
// Danger event: a single MINI-BOSS rises somewhere on the floor to hunt the king — a kind drawn
// from the floor's own (or a weaker) roster. Prefers to appear IN view, else anywhere clear.
function spawnMiniBoss(next) {
  if (next.enemies.filter((e) => e.boss && e.mini && !e.rush).length >= 2) return 'A distant roar — but no new terror rises.';
  const p = next.player;
  const kind = spawnKindForFloor(next);
  const occupied = new Set([`${p.x},${p.y}`]);
  for (const e of next.enemies) occupied.add(`${e.x},${e.y}`);
  const near = (x, y) => isStandable(terrainAt(next, x, y)) && terrainAt(next, x, y) !== 'geyser' && !keyTileAt(next, x, y) && !allyAt(next, x, y) && kindCanMove(next, kind, x, y);
  const tile = findFreeTile(occupied, (x, y) => near(x, y) && chebyshev(x, y, p.x, p.y) >= 3 && chebyshev(x, y, p.x, p.y) <= 6 && inLineOfSight(next, x, y))
    || findFreeTile(occupied, (x, y) => near(x, y) && chebyshev(x, y, p.x, p.y) >= 3);
  if (!tile) return 'A distant roar — but no new terror rises.';
  const mb = makeMiniBoss(next, kind, tile.x, tile.y);
  if (inLineOfSight(next, tile.x, tile.y)) startleSpawn(mb, next.player); // rears up with a startled ROAR (a "!" telegraph turn)
  next.enemies.push(mb);
  occupied.add(`${tile.x},${tile.y}`);
  // It does not rise ALONE: a rogue guardian drags a knot of floor-appropriate underlings up with
  // it, so the event lands as a real incursion rather than one wandering body.
  const cap = Math.min(MAX_ENEMIES, 14 + next.floor * 5 + Math.round(overstayFraction(next.turn) * 50)); // rises UNBOUNDED with overstay, up to the perf ceiling
  const wanted = 1 + randomInt(3); // 1-3
  let brought = 0;
  for (let i = 0; i < wanted && next.enemies.length < cap; i += 1) {
    const kin = spawnKindForFloor(next);
    const spot = findFreeTile(occupied, (x, y) => chebyshev(x, y, tile.x, tile.y) <= 2 // clustered around its master
      && chebyshev(x, y, p.x, p.y) >= 2 && isStandable(terrainAt(next, x, y))
      && !keyTileAt(next, x, y) && !allyAt(next, x, y) && kindCanMove(next, kin, x, y));
    if (!spot) break;
    occupied.add(spot.key);
    const minion = createEnemy(kin, spot.x, spot.y);
    if (inLineOfSight(next, spot.x, spot.y)) startleSpawn(minion, next.player);
    next.enemies.push(minion);
    brought += 1;
  }
  return brought
    ? `A ${kind} mini-boss rises to hunt you — with ${brought} of its brood!`
    : `A ${kind} mini-boss rises to hunt you!`;
}
// (The old "moveStair" danger event — relocating the stair after the key was claimed — was
// removed for being confusing.)
// A few turrets grind up around the map, at least one IN the king's view (a few tiles off, where
// it covers real ground) so he sees the threat rise; the rest further out.
function dropTurrets(next) {
  const p = next.player;
  const occupied = new Set([`${p.x},${p.y}`]);
  for (const e of next.enemies) occupied.add(`${e.x},${e.y}`);
  let placed = 0;
  const want = 2 + randomInt(2);
  const drop = (pred) => {
    const kind = randomTurretKind(next.floor); // a turret is a mortal gun — never a leaping demon
    const tile = findFreeTile(occupied, (x, y) => pred(x, y) && isStandable(terrainAt(next, x, y))
      && !keyTileAt(next, x, y) && !allyAt(next, x, y) && turretCoverage(next, kind, x, y) >= 4
      && !turretBlocksHallway(next, x, y));
    if (!tile) return false;
    occupied.add(tile.key);
    next.enemies.push(makeTurret(next, kind, tile.x, tile.y));
    placed += 1;
    return true;
  };
  // At least one rises in view (kept 3+ tiles off — turrets fire, so give the king a beat).
  drop((x, y) => chebyshev(x, y, p.x, p.y) >= 3 && chebyshev(x, y, p.x, p.y) <= 6 && inLineOfSight(next, x, y));
  for (let i = 0; i < 40 && placed < want; i += 1) drop((x, y) => chebyshev(x, y, p.x, p.y) >= 3);
  return placed ? 'Turrets grind up from the floor around you!' : 'The floor rumbles ominously.';
}
// Interior wall tiles, SHUFFLED and then ordered so the ones in the king's view come first — so
// a wall-warping event always shows some of its work on screen.
function interiorWallsVisibleFirst(next) {
  const walls = [];
  for (const k in next.terrain) {
    if (next.terrain[k] !== 'wall') continue;
    const [x, y] = k.split(',').map(Number);
    if (x > 1 && x < WORLD_SIZE - 2 && y > 1 && y < WORLD_SIZE - 2) walls.push([x, y]);
  }
  for (let i = walls.length - 1; i > 0; i -= 1) { const j = randomInt(i + 1); [walls[i], walls[j]] = [walls[j], walls[i]]; }
  walls.sort((a, b) => (inLineOfSight(next, b[0], b[1]) ? 1 : 0) - (inLineOfSight(next, a[0], a[1]) ? 1 : 0));
  return walls;
}
// A fifth of the interior walls slump into lava (opening the map but adding hazard) — visible
// walls first, so the king sees it happen.
function wallsToLava(next) {
  const walls = interiorWallsVisibleFirst(next);
  if (!walls.length) return 'The walls groan, but hold.';
  const n = Math.max(1, Math.round(walls.length * 0.2));
  for (let i = 0; i < n && i < walls.length; i += 1) {
    const key = `${walls[i][0]},${walls[i][1]}`;
    next.terrain[key] = 'lava';
    if (next.torches) delete next.torches[key]; // the wall (and its torch) is gone — now open lava
  }
  return 'Walls slump into rivers of lava!';
}

// A cave-in also collapses a few STANDING interior walls to open floor, each leaving a fading
// pile of rubble — visible walls first, so the collapse reads on screen. Removing a wall only ever
// OPENS the map, so it can never seal off a path.
function collapseWalls(next, count) {
  const walls = interiorWallsVisibleFirst(next); // visible walls ordered first
  let done = 0;
  for (const [x, y] of walls) {
    if (done >= count) break;
    smashWall(next, x, y);
    done += 1;
  }
  return done;
}

function fireDangerEvent(next, ramp) {
  // Only unleash a hazard the king has ALREADY encountered, so danger events keep pace with
  // the game's normal progression (no lava/pits/boulders/turrets before he's met one).
  const seen = next.player.seenTerrain || [];
  const dread = Math.min(1, ramp || 0);
  // ENEMY pressure is the CORE of a danger event; terrain-reshaping is occasional flavour. Weight
  // the pool so real threats dominate — and MORE so as dread climbs — otherwise, once many hazard
  // types have been seen, most events would dilute into harmless scenery-shuffling and a maxed
  // dread meter would still starve the board of foes. Waves scale from 3 entries early to 8 at max.
  const waveWeight = 3 + Math.round(dread * 5);
  const pool = [];
  for (let i = 0; i < waveWeight; i += 1) pool.push('wave');
  pool.push('miniBoss', 'miniBoss'); // always available (enemies always exist)
  if (next.player.seenTurret) pool.push('turrets');
  // Terrain reshaping — each seen hazard contributes ONE entry (kept as garnish, not the main course).
  // FLOOD is a mortal-realm hazard only. Down in hell, water rising through the ash is the wrong
  // story — and mechanically it is nearly a KINDNESS there: water merely stops a slide, while the
  // lava it would displace costs a heart every turn. Below the demon floor the same roll wells up
  // lava instead, which is what the realm should be doing to him anyway.
  // Once the floor counts as HELL — a real demon floor, OR an overworld floor gone molten in the
  // overstay — the dread effects turn hellish: no more flood (water is the wrong story down here, and
  // a near-kindness beside lava), and lava wells up in its place.
  if (seen.includes('water') && !isHellNow(next)) pool.push('flood');
  if (seen.includes('lava')) pool.push('lavaSpread', 'wallsToLava');
  if (isHellNow(next) && seen.includes('lava')) pool.push('lavaSpread'); // hell's share of the old flood roll
  if (seen.includes('pit')) pool.push('pits');
  if (seen.includes('boulder')) pool.push('caveIn');
  if (seen.includes('ice')) pool.push('freeze');
  // NB: no 'devilgrass' event. Grass blocks SIGHT but not movement, so a floor full of it is
  // COVER — it makes the king harder to see and easier to break away from. Every other entry in
  // this pool costs him something; that one was a gift wearing a hazard's name.
  const runOne = (kind) => {
    switch (kind) {
      case 'wave': return spawnWave(next);
      case 'miniBoss': return spawnMiniBoss(next);
      case 'turrets': return dropTurrets(next);
      case 'wallsToLava': return wallsToLava(next);
      case 'lavaSpread': return scatterTerrain(next, 'lava', hazardCount(next, 0.05, 3, 13)) ? 'Lava wells up across the floor!' : 'The floor smoulders.';
      case 'flood': return scatterTerrain(next, 'water', hazardCount(next, 0.05, 4, 14)) ? 'Water floods across the floor!' : 'A damp chill spreads.';
      case 'pits': return scatterTerrain(next, 'pit', hazardCount(next, 0.04, 2, 11)) ? 'The ground gives way — pits yawn open across the floor!' : 'The ground shudders.';
      case 'freeze': return freezeTerrain(next, hazardCount(next, 0.04, 3, 12)) ? 'A killing frost sweeps in — ice sheets over the floor!' : 'Your breath fogs in a sudden chill.';
      case 'caveIn':
        scatterTerrain(next, 'boulder', hazardCount(next, 0.035, 2, 9));
        scatterTerrain(next, 'wall', hazardCount(next, 0.02, 1, 5));
        collapseWalls(next, 1 + randomInt(3)); // some standing walls give way, leaving rubble
        return 'The ceiling caves in — rubble crashes down!';
      default: return 'The floor darkens with menace.';
    }
  };
  // An event can FIZZLE: the mini-boss cap is already full, a wave finds no room, a hazard has
  // nowhere left to scatter. It then reports something like "a distant roar — but no new terror
  // rises" and is SPENT. Harmless on the ordinary timer (it comes round again in a few turns) —
  // but every dread STEP-UP now fires one of these, and the music has just promised the player that
  // something is happening. A silent step-up makes the score a liar.
  //
  // So: measure whether the world actually CHANGED, and if it did not, try a different kind. The
  // footprint is deliberately crude (piece count + terrain count) rather than a per-event success
  // flag — every event either adds a piece or writes terrain, and this cannot rot when a new event
  // is added and someone forgets to return a flag.
  const footprint = () => next.enemies.length * 1000 + Object.keys(next.terrain).length;
  let kind = null;
  let msg = '';
  let choices = pool.slice();
  while (choices.length) {
    const pick = choices[randomInt(choices.length)];
    kind = pick;
    const before = footprint();
    msg = runOne(pick);
    if (footprint() !== before) break; // it landed
    // It fizzled — and re-rolling the SAME pool would just pick it again, because 'wave' and
    // 'miniBoss' ARE most of the pool by design. Both cap out on a crowded floor (spawnWave stops
    // at 14 + 5/floor; two live mini-bosses block a third), so a naive retry re-picked a capped
    // event over and over and still came up empty. Strike the kind and try a genuinely different
    // one — which pushes a full floor onto the terrain events, and those can always land.
    choices = choices.filter((k) => k !== pick);
  }
  if (!choices.length) {
    // Everything the floor could throw is capped or not yet unlocked — the spawn caps are full and
    // he has met no hazard to turn against him. The score has still just changed gear, and a step-up
    // that does nothing makes the music a liar. So ROUSE the floor instead: every foe that had not
    // noticed him does now, and comes. It costs no piece and no tile, which is exactly why it can
    // never fizzle — and being hunted by what is already here is a real cost.
    let roused = 0;
    for (const e of next.enemies) {
      if (e.turret || e.summonCircle || e.boss || e.awake) continue;
      e.awake = true;
      e.asleep = false;
      rememberKing(next, e);
      roused += 1;
    }
    kind = 'rouse';
    msg = roused
      ? 'A shudder runs through the floor — every foe knows where you are!'
      : 'The floor darkens with menace.';
  }
  // The exit (stair / portal) and the key/orb tile must NEVER hold terrain — always clear floor.
  if (next.exit) delete next.terrain[`${next.exit.x},${next.exit.y}`];
  if (next.key && !next.key.collected) delete next.terrain[`${next.key.x},${next.key.y}`];
  next.dangerEvent = { kind, message: msg };
  next.message = msg;
  updateDiscovery(next);
}

// Once per turn: tick the danger timer and, at ever-shorter intervals as dread climbs,
// unleash one random hostile event. This is the game's escalating pressure now.
function maybeSpawnEnemy(state) {
  const next = structuredClone(state);
  next.dangerEvent = null; // cleared each turn; set below only when an event fires
  // The FINALE: once the Orb is taken on the portal floor, the realm's guardians converge —
  // every so often a fresh boss claws into the world near the king, replacing ordinary danger.
  if (next.isPortalFloor && next.orbTaken) {
    next.bossRushTimer = (next.bossRushTimer || 0) + 1;
    if (!next.bossRushEvery) next.bossRushEvery = BOSS_RUSH_MIN + randomInt(BOSS_RUSH_MAX - BOSS_RUSH_MIN + 1);
    if (next.bossRushTimer >= next.bossRushEvery) {
      next.bossRushTimer = 0;
      next.bossRushEvery = BOSS_RUSH_MIN + randomInt(BOSS_RUSH_MAX - BOSS_RUSH_MIN + 1); // re-roll the next gap
      const msg = spawnBossRush(next);
      if (msg) { next.dangerEvent = { kind: 'bossRush', message: msg }; next.message = msg; }
    }
    return next;
  }
  // Floor 1 is a gentle on-ramp: NO ambient spawns and NO hostile events — the dungeon only
  // starts turning against the king from floor 2 onward.
  if ((next.floor || 1) < 2) { settleTurn(next); return next; }
  next.turnsSinceSpawn = (next.turnsSinceSpawn || 0) + 1;
  const ramp = dreadFraction(next.turn, next.dreadTurns); // 0 through the grace, then 0 -> 1 over the climb

  // Ambient trickle: beyond the big hostile events, lone wanderers filter in from around the map.
  // Its cadence quickens STEEPLY as dread climbs — gentle early, relentless once the floor has
  // fully turned against the king — and at high dread they arrive in small BURSTS, so a maxed
  // meter actually keeps the board full rather than dribbling one distant foe every ~24 turns.
  next.ambientSpawnTimer = (next.ambientSpawnTimer || 0) + 1;
  const ambientInterval = Math.max(8, Math.round(48 - 40 * ramp)); // ~48 turns early → ~8 at max dread
  if (next.ambientSpawnTimer >= ambientInterval) {
    next.ambientSpawnTimer = 0;
    const burst = 1 + Math.round(ramp * 2); // 1 wanderer early → up to 3 at once at max dread
    for (let i = 0; i < burst; i += 1) spawnAmbientWanderer(next);
  }

  // EVERY dread STEP-UP is itself a hostile event. The score changing gear and the floor turning on
  // the king are now the SAME moment, which is the whole point: what he HEARS is what just happened.
  // Before, the tempo climbed on one clock and events fired on another, so the music was a mood
  // rather than a tell. (dreadGear is shared with audio.js — see constants.js.)
  const gear = dreadGear(ramp);
  const steppedUp = gear > (next.lastDreadGear || 0);
  next.lastDreadGear = gear;

  // Through the GRACE the floor stays its own: no event fires at all, however long the timer has
  // run. The timer keeps counting, so the first hint of dread lands the moment grace lifts — which
  // is also gear 1, so that first event and the first tempo change are one and the same.
  const interval = Math.max(7, Math.round(32 - 25 * ramp)); // ~32 turns early → ~7 at max dread (events pile on fast when maxed)
  if (!steppedUp && (next.turnsSinceSpawn < interval || inDreadGrace(next.turn, next.dreadTurns))) { settleTurn(next); return next; }
  next.turnsSinceSpawn = 0;
  fireDangerEvent(next, ramp);
  settleTurn(next);
  return next;
}

// How every turn ENDS, however maybeSpawnEnemy got there. Order is the whole rule.
//
// ensureReachable is a fairness net: if he can still WALK but the floor has shifted so that no route
// to the key or stair is left, it wrenches him back to solid ground. That is right — the dungeon did
// that to him, not the other way round.
//
// But it never asked whether he could move AT ALL, so it was also quietly bailing him out of the one
// thing he genuinely earned: leaping onto an island of pits with an empty hand. Judged FIRST, a king
// with nowhere to step and nothing to spend is finished, and the net only catches what it was built
// for. (There were three exits from maybeSpawnEnemy, each calling ensureReachable by hand — so the
// rule went in at one of them and two paths quietly kept rescuing him.)
function settleTurn(state) {
  tickGuardianWards(state); // refresh Guardian wards from FINAL positions, ready for the king's turn
  // WAITING (Sentinel) invincibility lasts exactly one enemy phase — the one right after he holds his
  // ground — and lifts here, at its close, so his next turn is played as a mortal king again.
  if (state.player.invuln) state.player.invuln = false;
  if (checkStalemate(state)) return;
  ensureReachable(state);
}

/* --------------------------------- upkeep --------------------------------- */

// Record any enemy kinds the king can currently see.
function recordSeenEnemies(state) {
  const p = state.player;
  if (!Array.isArray(p.seenKinds)) p.seenKinds = [];
  for (const enemy of getVisibleEnemies(state)) {
    if (!p.seenKinds.includes(enemy.kind)) p.seenKinds.push(enemy.kind);
    if (enemy.turret) p.seenTurret = true; // gates the "turrets" danger event
  }
}

/* --------------------------------- scoring -------------------------------- */

function earnedConducts(player) {
  const conducts = [];
  if (!player.killedEnemy) conducts.push({ name: 'Pacifist', desc: 'Never killed an enemy.' });
  if (!player.wasHit) conducts.push({ name: 'Untouchable', desc: 'Never took a hit.' });
  return conducts;
}

function finalScore(state) {
  const turns = Math.max(1, state.player.totalTurns || 0);
  return Math.round((Math.pow(state.floor, 1.25) * 100) / turns);
}

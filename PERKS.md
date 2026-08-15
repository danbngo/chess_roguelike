# Perks — themed subclass chains

Each floor, on **slaying the guardian**, you pick 1 of 2 offered perks. Perks form **tiered
chains** (T1 → T2 → T3): a tier only appears once the tier below it is taken. Think of each
chain as a **D&D-style subclass** — commit down one and you become that archetype.

This document mirrors the **live** perks in `src/constants.js` (`CLASSES[...].perks`). If the two
ever disagree, the code wins.

Effect keys used below (the `grant` column):
- Stat bumps: `maxHp`, `vision` (+2 = +1 sight radius, two-way), `visionOneWay` (+2 = +1 radius the
  king sees but foes can't see back), `cardReach` (+1 card range).
- Cards: `gainCard:<piece>` (+ optional `gainCooldown:<n>`).
- Flags (simply switched on): `firstHitEachTurn`, `meleeRefund`, `meleeCleave`, `meleeLeech`,
  `meleePierce`, `leapShock`, `meleeFlourish`, `freeKillMove`, `terrainImmune`, `seeAllFoes`,
  `beastFriend`, `elusive`, `camouflage`, `recoil`, `shrapnel`, `phase`,
  `hexDemote`, `spellSurprise`, `doubleCast`, `familiar`, `necromancy`,
  `generalForm`.

_(Note: the old `seeThroughWalls` / `revealFloor` / `trueSight` flags are GONE — no perk grants them any more.)_

---

## WARRIOR — the Fighter  (melee · start: **knight**, cooldown 3 · **5 HP**)
_A sturdy frontline fighter who lunges in and trades blows._ The starting knight LEAPS in an L
onto a foe (or empty ground), clearing anything between.

### ⛨ Sentinel — "Hold the line; fall to no one." (chain colour #3b82f6)
| tier | id | name | effect | `grant` |
|---|---|---|---|---|
| 1 | `w_hp1` | Hardy | **+1 max HP per difficulty level** (Easy +3, Hard +2, Nightmare +1) | `maxHp` (scaled) |
| 2 | `w_hp2` | Ironhide | **+1 max HP per difficulty level** (Easy +3, Hard +2, Nightmare +1) | `maxHp` (scaled) |
| 3 | `w_bulwark` | Parry | end a turn WITHOUT striking and you raise your guard (a steel shield shows over your token). The next blow that would land is turned aside and the guard drops — whatever you did in between. **Bank it, then fight.** | `firstHitEachTurn` |

_Sentinel's HP perks are the **only** grant that scales with difficulty (`SENTINEL_HP_GAIN` in
`constants.js`, applied in `learnPerk`). A flat +1/+2 was a rounding error on Nightmare's 5 HP and a
formality on Easy's 12; scaling makes the chain worth the same SHARE of your health everywhere:_

| difficulty | base | Hardy | Ironhide |
|---|---|---|---|
| easy | 12 | 15 | 18 |
| hard | 9 | 11 | 13 |
| nightmare | 5 | 6 | 7 |

### ⚔ Reaver — "Carve a red road through the ranks." (#b91c1c)
| tier | id | name | effect | `grant` |
|---|---|---|---|---|
| 1 | `w_edge` | Keen Edge | a card that scores a kill has its remaining cooldown CUT IN HALF (rounded down) | `meleeRefund` |
| 2 | `w_cleave` | Cleave | when you fell a foe, one adjacent foe dies too. Finding no second body, the sweep bites an adjacent **tree/gate** for 1 instead (bodies always come first) | `meleeCleave` |
| 3 | `w_leech` | Vampiric Edge | every foe you fell **yourself** (by moving into it, or with a card) has a **50% chance** to mend 1 HP. Never a turret or a summoning circle — there is nothing in dead metal to drink — and collateral from Cleave/Pierce does not feed you | `meleeLeech` |

### 🐎 Cavalier — "Charge and trample through the ranks." (#f59e0b)
| tier | id | name | effect | `grant` |
|---|---|---|---|---|
| 1 | `w_fleet` | Double-Step | gain a double-step card (cd 3): **two steps in one direction, and either may be a blow**. Anything that DIES to the first is trampled and you carry on into the second; anything that SURVIVES (a guardian, a turret) halts the charge on its own tile and eats **both** blows. An adjacent **boulder** is charged instead (rolled 2 tiles), and **timber** takes 2 wounds | `gainCard:doublestep, gainCooldown:3` |
| 2 | `w_pierce` | Pierce | a kill by moving also strikes the foe directly behind it — **including on a knight LEAP**, where "behind" is the diagonal bearing `(sign dx, sign dy)`, i.e. the tile on from your target away from where you sprang. The thrust carries into a **tree/gate** standing there, for 1 | `meleePierce` |
| 3 | `w_trample` | **Thundering Charge** | when you LAND a knight leap, the shock goes through the whole floor: **every foe, turret and boulder you can SEE** is hurled directly away from where you came down (Knockback rules — so anything with a pit, a wall or a lava river behind it takes what it gets). Farthest-first, so the room scatters instead of piling up | `leapShock` |

### 🛡 Duellist — the flashy fencer. (#ec4899)
| tier | id | name | effect | `grant` |
|---|---|---|---|---|
| 1 | `w_enpassant` | En Passant | gain an en-passant card: step 1 tile (capturing there) AND strike one foe you pass (adjacent to your start) | `gainCard:enpassant` |
| 2 | `w_flourish` | Flourish | after a kill, foes beside you are caught off guard (surprised) | `meleeFlourish` |
| 3 | `w_rush` | **Blade Dance** | **EVERY** move that kills costs no turn — chain kill after kill in one turn for as long as you keep felling foes | `freeKillMove` |

---

## RANGER — the Hunter  (ranged · start: **bishop**, cooldown 3 · **5 HP**)
_A hunter who fells foes from across the room._ Ranged cards fire a single shot to the first foe,
blocked by cover / the first body. (HP was raised 4 → 5 once foes began closing in to melee.)

### 🌲 Druid — the survivalist who masters the wild, then becomes the beast. (#16a34a)
| tier | id | name | effect | `grant` |
|---|---|---|---|---|
| 1 | `r_wade` | **Fairy Wings** | flit over water, lava, AND pits — walk, card, or leap onto/across them freely: no slow, no burn, no falling | `terrainImmune` |
| 2 | `r_xray` | **Wild Empathy** | enemy & mini-boss **knights, nightriders and amazons** (never a floor guardian) turn **neutral** (♡): they roam, take no interest in you, and nothing else on the board picks a fight with them. Walk up **beside** one and it bows and joins your side as an ally. Striking one breaks the truce for good | `beastFriend` |
| 3 | `r_promo` | **Animal Form** | gain an Animal Form card (cd 9): become an INVINCIBLE **amazon-beast** (slides like a queen AND leaps like a knight) for 3 turns — take 0 damage, play no cards | `gainCard:promotion, gainCooldown:9` |

### 🎯 Oracle — the seer: see through cover, then one-way sight-and-reach, twice. (#14b8a6)
| tier | id | name | effect | `grant` |
|---|---|---|---|---|
| 1 | `r_eagle` | **Premonition** | within your sight radius you SEE and SHOOT straight through walls, boulders, and devilgrass — cover no longer blinds you. ONE-WAY: a foe with a wall between you can't strike back (but it wakes and starts closing in) | `seeThroughWalls` |
| 2 | `r_eyes2` | Hawk Eyes | **+2 sight radius AND +2 card reach** — the extra sight is **ONE-WAY** (foes out in the band can't see or strike you back) | `visionOneWay:4, cardReach:2` |
| 3 | `r_reach` | **Revelation** | the fog is torn away the instant you arrive, and you know where the **key** and the **stair** lie. It is a MAP, not x-ray: you still only see (and shoot) what is inside your own sight, and foes stay hidden in the dark | `revealFloor` |

_Premonition grants **`seeThroughWalls`** (see + shoot through cover within radius). Hawk Eyes & Power Draw grant **`visionOneWay`** — sight that extends the king's DISPLAY window but not his awareness "footprint" (`getVisibleBounds` vs `getAwarenessBounds`). Foes seen through cover, OR out in the extended band, can't see/strike him — they only start **closing in** (they pursue, but can't attack until they get a clear, in-range line). Both safe zones are drawn with a cyan wash so the "safe to shoot" tiles are obvious. (The bot has effective wallhack, so it can't leverage any of this — expect Oracle to score low on the bot but play strong for a human.)_

### 🌑 Gloom Stalker — the ghost: hard to fix on, ignored, unnoticed. (#6366f1)
| tier | id | name | effect | `grant` |
|---|---|---|---|---|
| 1 | `r_ghost` | Ghost | a foe more than one tile away has only a **50% chance each turn** to notice you at all — so you can draw one off a pack and fight it alone. Adjacent it always sees you; one you have STRUCK is enraged regardless; and a foe that already has you keeps you (it never breaks pursuit) | `elusive` |
| 2 | `r_camo` | Camouflage | **turrets** and **summoning circles** more than one tile away are BLIND to you — turrets doze (a sleep "z") and never fire, circles conjure nothing. Step ADJACENT (within one tile) and they wake and work as normal (purely distance now — no strike-to-provoke or line tracking) | `camouflage` |
| 3 | `r_stealth` | **Silence** | gain a Silence card (cd 9): every foe you can SEE drops into a dead sleep (a "z") for 3 turns — walk through them, or walk away. A free action; it shatters the instant you strike anything. (Was **Silent**, a passive that simply switched the game off) | `gainCard:silence, gainCooldown:9` |

### 🏹 Marksman — the sharpshooter: kickback, a big bow, then exploding shots. (#a3e635)
| tier | id | name | effect | `grant` |
|---|---|---|---|---|
| 1 | `r_recoil` | Recoil | firing a weapon card kicks you one tile back from the target (striking a foe there) AND shoves every adjacent foe back one tile where the ground behind it is clear | `recoil` |
| 2 | `r_longbow` | Ballista | gain a queen card (cd 9) — a devastating volley in any direction | `gainCard:queen, gainCooldown:9` |
| 3 | `r_shrapnel` | **Explosive Round** | every weapon card you fire DETONATES on impact — every foe around the tile you hit is HURLED a tile outward (Knockback rules), on top of the target being struck. | `shrapnel` |

_The old **Fletcher** chain (Reload → Ballista → Recoil) became **Marksman** (Recoil → Ballista → Shrapnel). **Reload was dropped**; Recoil moved to T1 (back to its knockback behaviour); new T3 **Shrapnel** is an on-impact splash._

---

## SORCERER — the Wizard  (spell · start: **rook**, cooldown 5 · **4 HP**)
_A fragile caster whose bolts PIERCE the whole path._ The rook scorches every tile along its
rank/file, hitting every unit on the line. (HP was raised 3 → 4 once foes began closing in.)

### 🌀 Translocations — the blinkmage: swap, phase, and finally UNMAKE. (#8b5cf6)
| tier | id | name | effect | `grant` |
|---|---|---|---|---|
| 1 | `s_swap` | **Displacement** | gain a swap card (cd 3): trade places with any unit in sight. A **shockwave at BOTH ends** — every other foe beside where you ARRIVE and beside the tile you LEFT is hurled back a tile (Knockback rules). The swapped unit is spared, and nothing is thrown twice | `gainCard:swap, gainCooldown:3` |buff m
| 2 | `s_phase` | Phase | move onto wall AND ice tiles | `phase` |
| 3 | `s_banish` | **Banish** | gain a Banish card (cd 9): send ANY foe, turret or rogue mini-boss you can see clean out of the world — simply gone, leaving a puff of smoke. **Not a kill**: no corpse, no blood, no boon, and it feeds nothing that keys off killing. A floor **guardian** (anchored to its key) and a **summoning circle** (a rune in the floor) are immune | `gainCard:banish, gainCooldown:9` |

### 💫 Hexes — the curse-weaver: demote, dazzle, lull. (#e879f9)
| tier | id | name | effect | `grant` |
|---|---|---|---|---|
| 1 | `s_hex` | Hex | at the start of each turn, one adjacent foe is warped into a confused **ferz** (a feeble 1-step diagonal mover); bosses & structures are immune | `hexDemote` |
| 2 | `s_cata` | Cataclysm | every visible foe is surprised when you cast a spell | `spellSurprise` |
| 3 | `s_confuse` | **Mass Confusion** | gain a Mass Confusion card (**cooldown 9**, costs a turn): every foe you can **see** loses track of which side it is on. Each turn a confused piece either strikes whatever is nearest — **its own kind included** — or blunders off at random, an even chance of each. **Nothing is immune**: turrets, guardians and summoning circles all lose the thread (a rooted piece can only lash out or swing wild — it has nowhere to blunder to). The fog lifts on a coin at the end of each of its turns, and **any** blow you land snaps that piece straight out of it | `gainCard:confuse, gainCooldown:9` |


### 🌀 Conjuration — the artillery-mage: a drifting globe, a double cast, chain lightning. (#8b5cf6)
| tier | id | name | effect | `grant` |
|---|---|---|---|---|
| 1 | `s_staff` | **Globe of Fire** | gain a `globe` card (cd 4): conjure a ball of spellfire on an empty tile beside you and send it drifting one way — ONE tile each turn. It floats over ground/water/lava/pits but DETONATES the instant its path meets anything solid (wall, tree, gate, or any unit — foe, ally or **you**), scorching that tile + all 8 around it | `gainCard:globe, gainCooldown:4` |
| 2 | `s_barrage` | Double Cast | after firing a spell, if a targetable foe remains you may aim + fire once more before your turn ends | `doubleCast` |
| 3 | `s_fireball` | **Chain Lightning** | gain a `chainlight` card (cd 6): a self-cast bolt leaps to the NEAREST foe in sight and arcs on through every unit CHAINED to it (adjacency network of bodies) — one jolt, one damage each. Your allies and **you** conduct too: stand in the chain and share the shock | `gainCard:chainlight, gainCooldown:6` |


_**Globe of Fire** is a persistent hazard on `state.fireGlobes` — `tickFireGlobes` (in `beginEnemyPhase`)
advances each globe one tile and `detonateFire`s it on contact (`globeBlocked`). **Chain Lightning**
reuses the Workshop's `dischargeElectricity` from the nearest visible foe: on a normal floor only BODIES
conduct, so the arc runs through a cluster of adjacent units, lighting the whole circuit (`state.arc`)._

### 🔥 Necromancy — the summoner: a familiar, then undead, then a General. (#65a30d)
| tier | id | name | effect | `grant` |
|---|---|---|---|---|
| 1 | `s_familiar` | Familiar | summon a king ally that follows you, auto-fights foes, swaps places when you step onto it, and respawns each floor / when no foe is in sight | `familiar` |
| 2 | `s_undead` | Grave Bond | a foe you slay rises as an undead ally — one at a time (the next kill replaces it); undead don't follow you downstairs | `necromancy` |
| 3 | `s_general` | **Vampiress** | your familiar rises as a **queen** with 3 wounds who FEEDS: every foe she fells knits one of them shut again. Her pool is **fixed at 3** — she heals up to it, never past it: the point is that she keeps herself alive, not that she outgrows everything | `generalForm` |

_Allies are green tokens with a ♥; enemies will cut them down but always prefer the king when they can reach both._

---

## COMBAT NOTE — ranged sliders close in

Every enemy (and non-ranged guardian) that can reach the king by SLIDING — rook/bishop/queen —
now **slides up to the tile beside him and then strikes**, rather than sniping from across the
room. Only **Volley/Sorcerer guardians** (below) and **turrets** attack from range.

## FLOOR GENERATION — order matters

The board is **25x25**. Generation runs in this order (`generateTerrain`, then `generateFloor`), and
the order is load-bearing:

1. **Border wall.**
2. **SET-PIECES** — a storeroom, fountain, garden, or island pond, 3-5 per floor, drawn at random.
   Each reserves its footprint **plus a one-tile margin** in `reserved`; every later pass refuses to
   write there. They go FIRST because they need clear ground: laid last, a 7x7 clear box existed on
   only 2% of floors and a 9x9 on none, so a storeroom essentially never appeared.
3. **Noise** — recipe blobs, wall runs, rooms, pits, boulders, ice, grass. All flow around `reserved`.
4. **Doors**, then **pillar colonnades**. Both skip `reserved` — a set-piece owns its own doors, and a
   colonnade must not march through a storeroom's court.
5. **Chambers** (`buildChamber`) — the real guarded one at the floor's fixed anchor, plus **0-2
   decoys** (~45% of floors get one). Same shape, same doors, no key and no guardian: the real
   chamber sits at a FIXED anchor, so a walled court on the horizon used to be proof of where the
   key was.

**A storeroom must be odd and >= 5 on a side, with its door at the exact wall MIDPOINT.**
`pruneUselessDoors` re-judges every door with `isDoorwaySpot`, which demands the door's wall run two
tiles either side AND >= 6 tiles of open space on both sides. A 3x3 or 4x4 box (interior 1 or 4
tiles) fails, its door reverts to rock, and the "storeroom" becomes a solid block of stone.

**Turrets and summoning circles scatter over the WHOLE floor**, weighted by zone (`structureSpot`):
25% roll for the chamber court, 30% its environs, 45% loose ground, each falling back outward. They
used to sit only in the chamber's ring, which advertised the key — find the guns, find the door. The
court is still by far the most defended ground (~155 structures per 1000 tiles against ~11 out on the
floor) because it is tiny; it just no longer draws a map to itself.

## TERRAIN — what stops you, what burns you

**Water and LAVA are both "slow" terrain** (`isSlowTerrain` in `terrain.js`): you wade **one tile**
of either per move and must stop there — no sliding clean across a channel — and you can't ready a
weapon while standing in one. Lava used to stop nobody, so a rook slid over a fire river as if it
were floor. Projectiles are exempt: a bolt still flies over both (`slideStops`' `projectile`).

**Fire burns whatever ENDS its turn in it** — lava, or a wall-torch a phaser has slipped into:
the king takes 1 HP (`passTurn`), a guardian takes 1 (`bossMove`), and ordinary foes and allies
carry no HP pool, so they are simply burned to ash (`tickLavaDamage`).

**Nothing walks into fire it cannot survive.** `isLavaSafe(unit)` is the single predicate: demon-kind
pieces, a Winged guardian, and anything flagged `lavaImmune`. `tickLavaDamage` burns exactly what it
calls unsafe and `pieceTerrainOpts` keeps exactly that out of the fire — so a chasing mortal routes
around lava instead of immolating itself to reach the king. Pits need no such rule: `standableFor`
already bars everything but a flier.

## SUMMONS — a conjured foe is just a monster

What a summoning circle conjures is a **normal monster**. It is NOT dispelled when its circle dies:
stepping on one rune used to wipe out its whole brood for free, which was far too cheap. `summoned` /
`summonedBy` are still recorded — they drive the violet tint and the conjuring puff — but no longer
kill it. The old dispel sits commented out in `beginEnemyPhase` in case it is ever wanted back.

## KNOCKBACK — one consistent collision rule

Every knockback source shares the same behaviour (`resolveShoveInto` / `knockbackEnemy` /
`knockbackKing` in `game.js`). When a shoved piece is driven into an occupied tile it **slams**:
- an **ordinary piece or ally** is crushed (destroyed) and the shover takes its tile;
- an **HP-bearing piece** (boss, turret, or the king) withstands it — takes 1 damage and the
  shover **stops short**;
- a **wall / ice / boulder / lava / board edge** (or a surviving occupant) halts the shove.

**A PIT swallows everything but the floor's own GUARDIAN.** A plain foe, a **turret**, and a rogue
**mini/rush boss** all plunge and are gone outright — no HP check. Only the floor guardian is
anchored enough to haul itself back out, for 1 wound. (Same line `isBanishable` draws: the guardian
holds the key and the floor together; nothing else does.) This makes "shove it in the hole" a real
one-card kill for Recoil, Trample, Explosive Round, Displacement's shockwave, and a rolled boulder.

A foe the **king** is driven into counts as his kill (boon / Necromancy). Sources: jumper captures,
the **Bulwark** boss perk, **Recoil**, **Trample**, **Displacement**, and a rolling **boulder**.

## GUARDIANS — no unique monsters, ever

A floor guardian has **no unique powers**. It is only ever:

- **a piece kind**, ROLLED from a sliding window over its tier (`bossPoolForFloor`) — floors 1-4 draw
  from `knight, bishop, rook, queen`, floors 5-8 from `nightrider, archbishop, chancellor, amazon`.
  The window advances with depth, so a floor-1 guardian is never a queen and a floor-4 one is never a
  knight, but each pool stays plural — a floor is a different fight each run.
- **plus rolled `BOSS_PERKS`** (below). That's the whole of it.

So the player only ever has twelve boss abilities to learn, and nothing is hand-authored per floor.
Only its **HP** is authored (`LEVELS[].boss.hp` — 3/4/4/5/5/6/8/14), because that IS the
floor-to-floor difficulty ramp.

Its **name** is derived, not written: an epithet from its primary perk over a noun hashed from kind +
traits (`bossNameFor`, `BOSS_NOUNS`, `BOSS_EPITHETS`) — "the Brutal Warlord", "the Winged Devourer".
The same monster always earns the same name; floor 8 alone can field 72 of them.

## BOSS PERKS — rolled per floor guardian (12 possible)

Guardians roll their perks at creation (`BOSS_PERKS` in `constants.js`; `rollBossPerks` /
`createBoss` / `bossMove` / `damageBoss` in `game.js`). All of them are shown in the Examine panel.

**How many** scales with depth — the demon realm's guardians are doubly cursed:

| floor | perks |
|---|---|
| 1-4 (mortal) | **1** |
| 5-7 (demon realm) | **2** |
| 8 (the finale) | **3** — and its own black-and-fire livery, 14 base HP, and far worse threats |
| any mini-boss | **1** (it stays lesser, and never gets Hardened) |

Never two perks from the same **exclusive group**, since only one of a group can ever fire and the
second would be a dead slot (`BOSS_PERK_GROUPS`):

- **attack** — `ranged` (Volley) vs `sorcerer`: each REPLACES its attack; it can only shoot one way.
- **reaction** — `shapeshifter` vs `blinker`: both trigger on being wounded, and `applyBossHitReaction` takes only the first.

Test a perk with `bossHas(boss, 'x')` — **never** `boss.bossPerk === 'x'`, which sees only the primary.

| id | name | effect |
|---|---|---|
| `summoner` | Summoner | conjures a minion of its own kind every third turn instead of acting |
| `blinker` | Blinkborn | flickers away to a random tile a few squares off after each wound (never into melee) |
| `brutal` | Brutal | its blows land twice as hard (2 damage) |
| `ranged` | Volley | looses a bolt (1 dmg) **down its own move pattern** instead of closing — never further than the piece could slide; a body or wall stops the shot. Only rolls on pieces with a real LINE (rook/bishop/queen/archbishop/chancellor/amazon) — **never** a king, pawn, mann or knight |
| `sorcerer` | Sorcerer | like Volley but the bolt PIERCES every unit on the path (walls still stop it). Same line/reach limits, and the same restriction on which kinds can roll it |
| `knockback` | Bulwark | its capturing blow hammers the king backward (like a jumper) every time |
| `shapeshifter` | Shifting | morphs into a random LESSER form after each wound |
| `tough` | Hardened | +33% max HP, rounded up |
| `leech` | Leech | heals 1 HP each time it wounds the king |
| `flying` | Winged | soars over pits, water, and lava unharmed |
| `phasing` | Phantom | sees and drifts through walls and boulders |
| `regen` | Regenerating | knits one wound shut every fourth turn |
| `lich` | Lich | calls **one** adjacent corpse back to its feet each turn, while the body is still fresh (over half-decayed and it will not answer). Ticks whether it acts or recovers, and it acts as normal afterwards. It recycles what **you** killed — draw it off the bodies and they rot. Never rolls alongside Summoner |

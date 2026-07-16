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
  `beastFriend`, `elusive`, `camouflage`, `stealth`, `recoil`, `shrapnel`, `blink`, `phase`,
  `hexDemote`, `spellSurprise`, `sleepAura`, `spellBlast`, `doubleCast`, `familiar`, `necromancy`,
  `generalForm`.

_(Note: the old `seeThroughWalls` / `revealFloor` / `trueSight` flags are GONE — no perk grants them any more.)_

---

## WARRIOR — the Fighter  (melee · start: **knight**, cooldown 3 · **5 HP**)
_A sturdy frontline fighter who lunges in and trades blows._ The starting knight LEAPS in an L
onto a foe (or empty ground), clearing anything between.

### ⛨ Sentinel — "Hold the line; fall to no one." (chain colour #3b82f6)
| tier | id | name | effect | `grant` |
|---|---|---|---|---|
| 1 | `w_hp1` | Hardy | +1 max HP | `maxHp:1` |
| 2 | `w_hp2` | Ironhide | +2 max HP | `maxHp:2` |
| 3 | `w_bulwark` | Parry | the first hit each turn is negated | `firstHitEachTurn` |

### ⚔ Reaver — "Carve a red road through the ranks." (#b91c1c)
| tier | id | name | effect | `grant` |
|---|---|---|---|---|
| 1 | `w_edge` | Keen Edge | a card that scores a kill has its remaining cooldown CUT IN HALF (rounded down) | `meleeRefund` |
| 2 | `w_cleave` | Cleave | when you fell a foe, one adjacent foe dies too | `meleeCleave` |
| 3 | `w_leech` | Vampiric Edge | any turn you fell a foe, heal 1 HP | `meleeLeech` |

### 🐎 Cavalier — "Charge and trample through the ranks." (#f59e0b)
| tier | id | name | effect | `grant` |
|---|---|---|---|---|
| 1 | `w_fleet` | Double-Step | gain a double-step card: dash up to 2 tiles any direction (capturing at the end), cd 3 | `gainCard:doublestep, gainCooldown:3` |
| 2 | `w_pierce` | Pierce | a kill by moving also strikes the foe directly behind it | `meleePierce` |
| 3 | `w_trample` | Trample | landing a knight leap HURLS every adjacent foe back a tile (Knockback rules), not a hit-in-place | `leapShock` |

### 🛡 Duellist — the flashy fencer. (#ec4899)
| tier | id | name | effect | `grant` |
|---|---|---|---|---|
| 1 | `w_enpassant` | En Passant | gain an en-passant card: step 1 tile (capturing there) AND strike one foe you pass (adjacent to your start) | `gainCard:enpassant` |
| 2 | `w_flourish` | Flourish | after a kill, foes beside you are caught off guard (surprised) | `meleeFlourish` |
| 3 | `w_rush` | Charge | the FIRST move that kills each turn costs no turn (further kill-moves that turn cost a turn) | `freeKillMove` |

---

## RANGER — the Hunter  (ranged · start: **bishop**, cooldown 3 · **5 HP**)
_A hunter who fells foes from across the room._ Ranged cards fire a single shot to the first foe,
blocked by cover / the first body. (HP was raised 4 → 5 once foes began closing in to melee.)

### 🌲 Druid — the survivalist who masters the wild, then becomes the beast. (#16a34a)
| tier | id | name | effect | `grant` |
|---|---|---|---|---|
| 1 | `r_wade` | **Fairy Wings** | flit over water, lava, AND pits — walk, card, or leap onto/across them freely: no slow, no burn, no falling | `terrainImmune` |
| 2 | `r_xray` | **Wild Empathy** | enemy & mini-boss **knights and amazons** (never a floor boss) never attack you — and the instant you SEE one it bows and JOINS your side, fighting as your ally (striking one breaks the bond) | `beastFriend` |
| 3 | `r_promo` | **Animal Form** | gain an Animal Form card (cd 9): become an INVINCIBLE **amazon-beast** (slides like a queen AND leaps like a knight) for 3 turns — take 0 damage, play no cards | `gainCard:promotion, gainCooldown:9` |

### 🎯 Oracle — the seer: see through cover, then one-way sight-and-reach, twice. (#14b8a6)
| tier | id | name | effect | `grant` |
|---|---|---|---|---|
| 1 | `r_eagle` | **Premonition** | within your sight radius you SEE and SHOOT straight through walls, boulders, and devilgrass — cover no longer blinds you. ONE-WAY: a foe with a wall between you can't strike back (but it wakes and starts closing in) | `seeThroughWalls` |
| 2 | `r_eyes2` | Hawk Eyes | +1 sight radius AND +1 card reach — the extra sight is **ONE-WAY** | `visionOneWay:2, cardReach:1` |
| 3 | `r_reach` | Power Draw | +1 sight radius AND +1 card reach again — the extra sight is likewise one-way | `visionOneWay:2, cardReach:1` |

_Premonition grants **`seeThroughWalls`** (see + shoot through cover within radius). Hawk Eyes & Power Draw grant **`visionOneWay`** — sight that extends the king's DISPLAY window but not his awareness "footprint" (`getVisibleBounds` vs `getAwarenessBounds`). Foes seen through cover, OR out in the extended band, can't see/strike him — they only start **closing in** (they pursue, but can't attack until they get a clear, in-range line). Both safe zones are drawn with a cyan wash so the "safe to shoot" tiles are obvious. (The bot has effective wallhack, so it can't leverage any of this — expect Oracle to score low on the bot but play strong for a human.)_

### 🌑 Gloom Stalker — the ghost: hard to fix on, ignored, unnoticed. (#6366f1)
_Ghost was `noChase` (foes gave up the instant you broke sight). It read as stealth but PUNISHED
good play: a foe could never be drawn off its pack, so you could never isolate one. It now slows the
CATCHING of your eye rather than ending the chase._
| tier | id | name | effect | `grant` |
|---|---|---|---|---|
| 1 | `r_ghost` | Ghost | a foe more than one tile away has only a **50% chance each turn** to notice you at all — so you can draw one off a pack and fight it alone. Adjacent it always sees you; one you have STRUCK is enraged regardless; and a foe that already has you keeps you (it never breaks pursuit) | `elusive` |
| 2 | `r_camo` | Camouflage | **turrets** and **summoning circles** more than one tile away are BLIND to you — turrets doze (a sleep "z") and never fire, circles conjure nothing. Step ADJACENT (within one tile) and they wake and work as normal (purely distance now — no strike-to-provoke or line tracking) | `camouflage` |
| 3 | `r_stealth` | Silent | foes never notice or attack you unless you are ADJACENT (within one tile) — even one already hunting loses you, and even firing a weapon won't give you away. A wandering foe can still blunder onto your tile, striking you by accident | `stealth` |

### 🏹 Marksman — the sharpshooter: kickback, a big bow, then exploding shots. (#a3e635)
| tier | id | name | effect | `grant` |
|---|---|---|---|---|
| 1 | `r_recoil` | Recoil | firing a weapon card kicks you one tile back from the target (striking a foe there) AND shoves every adjacent foe back one tile where the ground behind it is clear | `recoil` |
| 2 | `r_longbow` | Ballista | gain a queen card (cd 9) — a devastating volley in any direction | `gainCard:queen, gainCooldown:9` |
| 3 | `r_shrapnel` | Shrapnel | every weapon card you fire SHATTERS on impact — striking every foe adjacent to the tile you hit, on top of the target | `shrapnel` |

_The old **Fletcher** chain (Reload → Ballista → Recoil) became **Marksman** (Recoil → Ballista → Shrapnel). **Reload was dropped**; Recoil moved to T1 (back to its knockback behaviour); new T3 **Shrapnel** is an on-impact splash._

---

## SORCERER — the Wizard  (spell · start: **rook**, cooldown 5 · **4 HP**)
_A fragile caster whose bolts PIERCE the whole path._ The rook scorches every tile along its
rank/file, hitting every unit on the line. (HP was raised 3 → 4 once foes began closing in.)

### 🔮 Translocations — the blink-mage: dodge, phase, displace. (#22d3ee)
| tier | id | name | effect | `grant` |
|---|---|---|---|---|
| 1 | `s_blink` | Blink | when a foe hits you, blink to a random safe tile in sight (if any) | `blink` |
| 2 | `s_phase` | Phase | move onto **wall AND ice** tiles; while embedded in opaque cover (a wall or boulder) your sight shrinks | `phase` |
| 3 | `s_swap` | Displacement | gain a swap card (cd 3): trade places with any unit in sight; arriving knocks every OTHER adjacent foe back a tile | `gainCard:swap, gainCooldown:3` |

### 💫 Hexes — the curse-weaver: demote, dazzle, lull. (#e879f9)
| tier | id | name | effect | `grant` |
|---|---|---|---|---|
| 1 | `s_hex` | Hex | at the start of each turn, one adjacent foe is warped into a confused **ferz** (a feeble 1-step diagonal mover); bosses & structures are immune | `hexDemote` |
| 2 | `s_cata` | Cataclysm | every visible foe is surprised when you cast a spell | `spellSurprise` |
| 3 | `s_slumber` | Slumber | non-boss foes adjacent to you fall asleep (blue "z"); with Hex, a hexed foe drops straight to sleep | `sleepAura` |

_Hex now warps foes into a **ferz** (not a "pawn" as the old draft said)._

### 🌀 Conjuration — the artillery-mage: a blast, a phantom steed, a double cast. (#8b5cf6)
| tier | id | name | effect | `grant` |
|---|---|---|---|---|
| 1 | `s_amp` | **Blast** | any foe your spell strikes but does NOT kill (a boss, mini-boss, or turret) is HURLED one tile along the bolt's path — survivors are shoved farthest-first so they never pile up | `spellBlast` |
| 2 | `s_staff` | Phantom Steed | gain a horse card (cd 4): a spectral steed tramples an L-shaped path (aimed via spell targeting), scorching every foe along it — it does NOT move you | `gainCard:horse, gainCooldown:4` |
| 3 | `s_barrage` | Double Cast | after firing a spell, if a targetable foe remains you may aim + fire once more before your turn ends | `doubleCast` |

_T1 was formerly **Amplify** (+1 card reach), then a 3-tile collateral AoE; it is now **Blast** (knockback of surviving foes along the bolt) — the reach bonus is gone from this chain, and the AoE overlap with Marksman's Shrapnel is gone._

### 🔥 Necromancy — the summoner: a familiar, then undead, then a General. (#65a30d)
| tier | id | name | effect | `grant` |
|---|---|---|---|---|
| 1 | `s_familiar` | Familiar | summon a berolina ally that follows you, auto-fights foes, swaps places when you step onto it, and respawns each floor / when no foe is in sight | `familiar` |
| 2 | `s_undead` | Grave Bond | a foe you slay rises as an undead ally — one at a time (the next kill replaces it); undead don't follow you downstairs | `necromancy` |
| 3 | `s_general` | Undead General | your familiar upgrades to a General — a king that can also leap like a knight | `generalForm` |

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
| any mini-boss | **1** (it stays lesser, and never gets Hardened's +3) |

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
| `ranged` | Volley | looses a bolt (1 dmg) down an open orthogonal/diagonal line instead of closing; a body or wall stops the shot |
| `sorcerer` | Sorcerer | like Volley but the bolt PIERCES every unit on the path (walls still stop it) |
| `knockback` | Bulwark | its capturing blow hammers the king backward (like a jumper) every time |
| `shapeshifter` | Shifting | morphs into a random LESSER form after each wound |
| `tough` | Hardened | +3 max HP |
| `leech` | Leech | heals 1 HP each time it wounds the king |
| `flying` | Winged | soars over pits, water, and lava unharmed |
| `phasing` | Phantom | sees and drifts through walls and boulders |
| `regen` | Regenerating | knits one wound shut every fourth turn |

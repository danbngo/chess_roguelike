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
  `beastFriend`, `noChase`, `camouflage`, `stealth`, `recoil`, `shrapnel`, `blink`, `phase`,
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

### 🌑 Gloom Stalker — the ghost: unchased, ignored, unnoticed. (#6366f1)
| tier | id | name | effect | `grant` |
|---|---|---|---|---|
| 1 | `r_ghost` | Ghost | foes stop chasing the instant you break their sight | `noChase` |
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

## KNOCKBACK — one consistent collision rule

Every knockback source shares the same behaviour (`resolveShoveInto` / `knockbackEnemy` /
`knockbackKing` in `game.js`). When a shoved piece is driven into an occupied tile it **slams**:
- an **ordinary piece or ally** is crushed (destroyed) and the shover takes its tile;
- an **HP-bearing piece** (boss, turret, or the king) withstands it — takes 1 damage and the
  shover **stops short**;
- a **wall / ice / boulder / lava / board edge** (or a surviving occupant) halts the shove.

A foe the **king** is driven into counts as his kill (boon / Necromancy). Sources: jumper captures,
the **Bulwark** boss perk, **Recoil**, **Trample**, **Displacement**, and a rolling **boulder**.

## BOSS PERKS — one rolled per floor guardian (12 possible)

Every floor boss (and mini-boss) rolls **one** perk at creation (`BOSS_PERKS` in `constants.js`;
`createBoss` / `bossMove` / `damageBoss` in `game.js`). Shown in the Examine panel.

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

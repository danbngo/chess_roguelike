# Perks — themed subclass chains (brainstorm proposal)

Each floor, on **slaying the boss**, you pick 1 of 2 offered perks. Perks form **tiered
chains** (T1 → T2 → T3): a tier only appears once the tier below it is taken. Think of
each chain as a **D&D-style subclass** — commit down one and you become that archetype.

This draft only **re-themes and re-slots** perks; the underlying effects are the current
live ones (rebalance the numbers/effects next). **Only the Warrior was actually juggled**
(its defence was spread across 3 chains); Ranger & Sorcerer chains were already coherent —
Sorcerer's four even line up with the D&D wizard schools.

Effect keys: `maxHp`, `vision` (+2 = +1 sight radius), `moveRange` (now a forced full
slide), `cardReach`, `gainCard:<piece>` (+ optional `gainCooldown:<n>` override), and
flags: `firstHitEachTurn`, `reflect`, `meleeRefund`, `meleeCleave`, `meleeLeech`,
`meleePierce`, `leapShock`, `meleeFlourish`, `freeKillMove`, `extraLife`, `revealFloor`,
`terrainImmune`, `seeThroughWalls`, `noChase`, `camouflage`, `recoil`, `stealth`,
`rangedRapid`, `spellHaste`, `freeSpell`, `spellDazzle`, `spellSurprise`.

---

## WARRIOR — the Fighter  (melee · start: knight · 5 HP)  ✅ IMPLEMENTED
_A sturdy frontline fighter who lunges in and trades blows._
The starting knight card has base cooldown 3 (unchanged; the class default).

### ⛨ Sentinel — "Hold the line; fall to no one."
An immovable bastion who simply refuses to die.
| tier | id | name | effect | `grant` |
|---|---|---|---|---|
| 1 | `w_hp1` | Hardy | +1 max HP | `maxHp:1` |
| 2 | `w_hp2` | Ironhide | +2 max HP | `maxHp:2` |
| 3 | `w_bulwark` | Parry | the first hit each turn is negated | `firstHitEachTurn` |

### ⚔ Reaver — "Carve a red road through the ranks."
A bloodletter who feeds on the crowd he cuts down.
| tier | id | name | effect | `grant` |
|---|---|---|---|---|
| 1 | `w_edge` | Keen Edge | a card that scores a kill recharges 1 turn faster | `meleeRefund` |
| 2 | `w_cleave` | Cleave | when you fell a foe, one adjacent foe dies too | `meleeCleave` |
| 3 | `w_leech` | Vampiric Edge | any turn you fell a foe, heal 1 HP | `meleeLeech` |

### 🐎 Cavalier — "Charge and trample through the ranks."
A relentless charger who kills on the move and crushes on landing.
| tier | id | name | effect | `grant` |
|---|---|---|---|---|
| 1 | `w_fleet` | Double-Step | gain a double-step card: dash up to 2 tiles in any direction (capturing at the end), cooldown 3 | `gainCard:doublestep, gainCooldown:3` |
| 2 | `w_pierce` | Pierce | a kill by moving also strikes the foe directly behind it | `meleePierce` |
| 3 | `w_trample` | Trample | landing a knight leap HURLS every adjacent foe back a tile (collision rules apply — see Knockback) | `leapShock` |

### 🛡 Duellist — the flashy fencer.
A show-off who fights with tempo and a signature dash.
| tier | id | name | effect | `grant` |
|---|---|---|---|---|
| 1 | `w_enpassant` | En Passant | gain an en-passant card (cd 3): step 1 tile in any direction (capturing a foe there) AND strike one foe "in passing" — a piece that was beside your starting tile (marked ✕ while aiming) | `gainCard:enpassant` |
| 2 | `w_flourish` | Flourish | after a kill, foes beside you are caught off guard (surprised) | `meleeFlourish` |
| 3 | `w_rush` | Charge | a move that kills costs no turn | `freeKillMove` |

---

## RANGER — the Hunter  (ranged · start: bishop, cooldown 3 · 4 HP)  ✅ IMPLEMENTED
_A hunter who fells foes from across the room._

### 🌲 Druid — "Weather any storm the wild throws at you."
The survivalist who masters the terrain, then becomes the beast.
| tier | id | name | effect | `grant` |
|---|---|---|---|---|
| 1 | `r_wade` | Amphibious | water no longer slows your moves or blocks your cards | `terrainImmune` |
| 2 | `r_xray` | Sixth Sense | see and shoot over walls — ONE-WAY: foes on the far side of a wall don't spot you or wake unless you attack them or step adjacent | `seeThroughWalls` |
| 3 | `r_promo` | Promotion | gain a promotion card: free to cast; for 3 turns move as an amazon (queen + knight) and use no weapon cards | `gainCard:promotion` |

### 🎯 Deadeye — "One shot. Then another, before they blink."
Reach, sight, and foreknowledge.
| tier | id | name | effect | `grant` |
|---|---|---|---|---|
| 1 | `r_eyes2` | Hawk Eyes | +1 sight radius | `vision:2` |
| 2 | `r_reach` | Power Draw | +1 card reach | `cardReach:1` |
| 3 | `r_eagle` | Premonition | continually see the ENTIRE floor — terrain, stair, key, and every enemy (out of sight, faded); PLUS +1 sight radius and +1 card reach | `revealFloor`, `vision:2`, `cardReach:1` |

### 🌑 Gloom Stalker — "Seen only when it's already too late."
The ghost: unchased, ignored by structures, unnoticed.
| tier | id | name | effect | `grant` |
|---|---|---|---|---|
| 1 | `r_ghost` | Ghost | foes stop chasing once you leave their sight | `noChase` |
| 2 | `r_camo` | Camouflage | turrets and summoning circles ignore you | `camouflage` |
| 3 | `r_stealth` | Silent | unaware foes don't spot you at range (they roam showing "?"). You're given away by: attacking (all visible foes wake), any foe ending its turn adjacent to you (it wakes at once — or ~11% bumps you for 1), or you stepping next to one | `stealth` |

### 🏹 Fletcher — "A bow for every range, and the feet to use them."
The quartermaster: reload, a bigger bow, and kickback.
| tier | id | name | effect | `grant` |
|---|---|---|---|---|
| 1 | `r_reload` | Reload | gain a reload card: spend a turn to recharge all your OTHER cards (cooldown 3) | `gainCard:reload` |
| 2 | `r_longbow` | Longbow | gain a rook card (cooldown 5) | `gainCard:rook`, `gainCooldown:5` |
| 3 | `r_recoil` | Recoil | firing a weapon card kicks you one tile back from the target (striking a foe there), AND shoves every adjacent foe back one tile where the ground behind it is clear (structures don't budge) | `recoil` |

_Ranger changes: starter knight → bishop (cd 3); DROPPED the old HP chain (r_hp1/2, r_bulwark), Quick Draw (r_rapid), Keen Eyes (r_eyes1), Shortbow (r_bow), and Fleet (r_fleet). Silent kept its "(or you attack)" wording — the "in front of them" directional nuance is not yet built._

---

## SORCERER — the Wizard  (spell · start: rook, cooldown 5 · 3 HP)  ✅ IMPLEMENTED
_A fragile caster whose bolts pierce straight through the ranks — his mighty cards make up for his low HP._
The starting rook is slow (cd 5) and pierces every tile en route to (and including) the target.

### 🔮 Translocations — cyan — the blink-mage: dodge, phase, displace.
| tier | id | name | effect | `grant` |
|---|---|---|---|---|
| 1 | `s_blink` | Blink | when a foe hits you, blink to a random safe tile in sight (if any) | `blink` |
| 2 | `s_phase` | Phase | move onto wall tiles; while embedded your sight shrinks to 1 | `phase` |
| 3 | `s_swap` | Displacement | gain a swap card: trade places with any unit in sight (cooldown 3); arriving knocks every other adjacent foe back a tile | `gainCard:swap`, `gainCooldown:3` |

### 💫 Hexes — fuchsia — the curse-weaver: demote, dazzle, lull.
| tier | id | name | effect | `grant` |
|---|---|---|---|---|
| 1 | `s_hex` | Hex | at the start of each turn, one adjacent foe is warped into a confused (startled) pawn — pawns and bosses are immune | `hexDemote` |
| 2 | `s_cata` | Cataclysm | every visible foe is surprised when you cast a spell | `spellSurprise` |
| 3 | `s_slumber` | Slumber | non-boss foes adjacent to you fall asleep (blue "z" icon); with Hex (T1), a hexed pawn drops straight to sleep instead of merely confused | `sleepAura` |

### 🌀 Conjuration — violet — the artillery-mage: reach, a queen, a double cast.
| tier | id | name | effect | `grant` |
|---|---|---|---|---|
| 1 | `s_amp` | Amplify | +1 card reach | `cardReach:1` |
| 2 | `s_staff` | Archstaff | gain a queen card (cooldown 9) | `gainCard:queen`, `gainCooldown:9` |
| 3 | `s_barrage` | Double Cast | after firing a spell, if a targetable foe remains you may aim + fire once more before your turn ends (cancelling the aim ends the turn) | `doubleCast` |

### 🔥 Necromancy — necro-green — the summoner: a familiar, then undead, then a General.  ✅ IMPLEMENTED
| tier | id | name | effect | `grant` |
|---|---|---|---|---|
| 1 | `s_familiar` | Familiar | summon a berolina ally that follows you, auto-attacks foes, swaps places when you step onto it, and respawns each floor / when no foe is in sight (your AOE dispels it) | `familiar` |
| 2 | `s_undead` | Grave Bond | a foe you slay rises as an undead ally — one at a time; when it dies the next kill replaces it. Undead don't follow you downstairs | `necromancy` |
| 3 | `s_general` | General | your familiar is upgraded to a General — a king that can also leap like a knight | `generalForm` |

_Allies are green tokens with a ♥ mark; enemies (and bosses) will strike them down but always prefer the king when they can reach both._

## KNOCKBACK — one consistent collision rule  ✅ IMPLEMENTED

Every knockback source shares the same behaviour (`resolveShoveInto` / `knockbackEnemy` /
`knockbackKing` in `game.js`). When a shoved piece is driven into a tile that already holds
a unit, it **slams** into it:
- an **ordinary piece or ally** is crushed (destroyed), and the shover takes its tile;
- an **HP-bearing piece** (boss, turret, or the king) withstands it — it takes 1 damage and
  the shover **stops short**, merely bumping it;
- a **wall / lava / board edge** (or a surviving occupant) halts the shove in place.

A foe the **king** is driven into counts as the king's kill (boon / Necromancy). Sources:
jumper captures & the **Bulwark** boss perk (shove the king), and **Recoil**, **Trample**,
and **Displacement** (shove adjacent foes).

## BOSS PERKS — one rolled per floor guardian  ✅ IMPLEMENTED

Every floor boss rolls **one** perk at creation (see `BOSS_PERKS` in `constants.js`,
`createBoss` / `bossMove` / `damageBoss` in `game.js`). Shown in the Examine panel.

| id | name | effect |
|---|---|---|
| `summoner` | Summoner | every third turn it conjures a minion of its **own** kind instead of acting |
| `blinker` | Blinkborn | flickers to a random tile a few squares off after each wound (never into melee) |
| `brutal` | Brutal | its blows (melee, knockback) deal **2** damage instead of 1 |
| `ranged` | Volley | when the king stands on an open orthogonal/diagonal line, it looses a bolt (1 dmg) instead of closing; a body or wall in the lane stops the shot |
| `sorcerer` | Sorcerer | like Volley but the bolt **pierces** every unit on the path — wounding the king and cutting down any ally/minion in the way (walls still stop it) |
| `knockback` | Bulwark | its capturing blow shoves the king backward (like a jumper) every time |
| `shapeshifter` | Shifting | after each wound it morphs into a **random lesser** form (never ranked above its original kind) |
| `tough` | Hardened | +3 max HP |
| `leech` | Leech | heals 1 HP each time it wounds the king (a landed blow — melee, shove, or bolt; never past max) |

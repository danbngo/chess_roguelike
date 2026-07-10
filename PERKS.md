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
| 1 | `w_fleet` | Fleet | +1 move range (forces a full 2-tile slide) | `moveRange:1` |
| 2 | `w_pierce` | Pierce | a kill by moving also strikes the foe directly behind it | `meleePierce` |
| 3 | `w_trample` | Trample | landing a knight leap strikes every adjacent foe | `leapShock` |

### 🛡 Duellist — the flashy fencer.
A show-off who fights with tempo and a signature dash.
| tier | id | name | effect | `grant` |
|---|---|---|---|---|
| 1 | `w_enpassant` | En Passant | gain an en-passant card: dash 2 tiles orthogonally onto empty ground, striking the two tiles you flank (base cooldown 3). The hit area is shown while targeting. | `gainCard:enpassant` |
| 2 | `w_flourish` | Flourish | after a kill, foes beside you are caught off guard (surprised) | `meleeFlourish` |
| 3 | `w_rush` | Charge | a move that kills costs no turn | `freeKillMove` |

_Dropped from the old Warrior: Long Arms (+reach), Reflection, the bishop/rook card
grants, and Undying — replaced by the four chains above (survive / butcher / charge / duel)._


---

## RANGER — the Hunter  (ranged · start: bishop, cooldown 3 · 4 HP)  ✅ IMPLEMENTED
_A hunter who fells foes from across the room._

### 🌲 Druid — "Weather any storm the wild throws at you."
The survivalist who masters the terrain, then becomes the beast.
| tier | id | name | effect | `grant` |
|---|---|---|---|---|
| 1 | `r_wade` | Amphibious | water no longer slows your moves or blocks your cards | `terrainImmune` |
| 2 | `r_xray` | Sixth Sense | see and shoot over walls (symmetric — you can also be seen through them) | `seeThroughWalls` |
| 3 | `r_promo` | Promotion | gain a promotion card: free to cast; for 3 turns move as an amazon (queen + knight) and use no weapon cards | `gainCard:promotion` |

### 🎯 Deadeye — "One shot. Then another, before they blink."
Reach, sight, and foreknowledge.
| tier | id | name | effect | `grant` |
|---|---|---|---|---|
| 1 | `r_reach` | Power Draw | +1 card reach | `cardReach:1` |
| 2 | `r_eyes2` | Hawk Eyes | +1 sight radius | `vision:2` |
| 3 | `r_eagle` | Premonition | fresh floors reveal fully the moment you arrive | `revealFloor` |

### 🌑 Gloom Stalker — "Seen only when it's already too late."
The ghost: unchased, ignored by structures, unnoticed.
| tier | id | name | effect | `grant` |
|---|---|---|---|---|
| 1 | `r_ghost` | Ghost | foes stop chasing once you leave their sight | `noChase` |
| 2 | `r_camo` | Camouflage | turrets and summoning circles ignore you | `camouflage` |
| 3 | `r_stealth` | Silent | unaware foes don't notice you unless adjacent (or you attack) | `stealth` |

### 🏹 Fletcher — "A bow for every range, and the feet to use them."
The quartermaster: reload, a bigger bow, and kickback.
| tier | id | name | effect | `grant` |
|---|---|---|---|---|
| 1 | `r_reload` | Reload | gain a reload card: spend a turn to recharge all your OTHER cards (cooldown 3) | `gainCard:reload` |
| 2 | `r_longbow` | Longbow | gain a rook card (cooldown 5) | `gainCard:rook`, `gainCooldown:5` |
| 3 | `r_recoil` | Recoil | firing a weapon card kicks you one tile back from the target (and can strike a foe there) | `recoil` |

_Ranger changes: starter knight → bishop (cd 3); DROPPED the old HP chain (r_hp1/2, r_bulwark), Quick Draw (r_rapid), Keen Eyes (r_eyes1), Shortbow (r_bow), and Fleet (r_fleet). Silent kept its "(or you attack)" wording — the "in front of them" directional nuance is not yet built._

---

## SORCERER — the Wizard  (spell · start: rook, cooldown 5 · 3 HP)  ✅ 3/4 CHAINS IMPLEMENTED
_A fragile caster whose bolts pierce straight through the ranks — his mighty cards make up for his low HP._
The starting rook is slow (cd 5) and pierces every tile en route to (and including) the target.

### 🔮 Translocations — cyan — the blink-mage: dodge, phase, displace.
| tier | id | name | effect | `grant` |
|---|---|---|---|---|
| 1 | `s_blink` | Blink | when a foe hits you, blink to a random safe tile in sight (if any) | `blink` |
| 2 | `s_phase` | Phase | move onto wall tiles; while embedded your sight shrinks to 1 | `phase` |
| 3 | `s_swap` | Displacement | gain a swap card: trade places with any unit in sight (cooldown 3) | `gainCard:swap`, `gainCooldown:3` |

### 💫 Hexes — fuchsia — the curse-weaver: demote, dazzle, lull.
| tier | id | name | effect | `grant` |
|---|---|---|---|---|
| 1 | `s_hex` | Hex | moving so a non-pawn foe stands one tile ahead demotes it to a pawn and startles it | `hexDemote` |
| 2 | `s_cata` | Cataclysm | every visible foe is surprised when you cast a spell | `spellSurprise` |
| 3 | `s_slumber` | Slumber | non-boss foes adjacent to you fall asleep (blue "z" icon) | `sleepAura` |

### 🌀 Conjuration — violet — the artillery-mage: reach, a queen, a full barrage.
| tier | id | name | effect | `grant` |
|---|---|---|---|---|
| 1 | `s_amp` | Amplify | +1 card reach | `cardReach:1` |
| 2 | `s_staff` | Archstaff | gain a queen card (cooldown 9) | `gainCard:queen`, `gainCooldown:9` |
| 3 | `s_barrage` | Barrage | your spell fires down EVERY line the piece commands (rook 4, queen 8) | `multiShot` |

### 🔥 Necromancy — necro-green — ⏳ DEFERRED (the ally faction — a dedicated build)
_Familiar (a berolina-pawn ally that follows, auto-attacks, and respawns), convert-on-kill undead, and a General upgrade. Introduces allies as a new faction (their AI, rendering with a heart icon, swap-on-move, "enemies can attack allies"), so it's slated as its own pass._

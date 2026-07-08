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

## WARRIOR — the Fighter  (melee · start: knight · 7 HP)  ✅ IMPLEMENTED
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
| 2 | `w_rush` | Charge | a move that kills costs no turn | `freeKillMove` |
| 3 | `w_flourish` | Flourish | after a kill, foes beside you are caught off guard (surprised) | `meleeFlourish` |

_Dropped from the old Warrior: Long Arms (+reach), Reflection, the bishop/rook card
grants, and Undying — replaced by the four chains above (survive / butcher / charge / duel)._


---

## RANGER — the Hunter  (ranged · start: bishop, cooldown 4 · 5 HP)  ✅ IMPLEMENTED
_A hunter who fells foes from across the room._

### 🌲 Druid — "Weather any storm the wild throws at you."
The survivalist who masters the terrain, then becomes the beast.
| tier | id | name | effect | `grant` |
|---|---|---|---|---|
| 1 | `r_wade` | Amphibious | water no longer slows your moves or blocks your cards | `terrainImmune` |
| 2 | `r_xray` | Sixth Sense | see and shoot over walls (symmetric — you can also be seen through them) | `seeThroughWalls` |
| 3 | `r_beast` | Beastform | gain a beastform card: free to cast; for 3 turns move only by knight-leaps and use no weapon cards | `gainCard:beastform` |

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

_Ranger changes: starter knight → bishop (cd 4); DROPPED the old HP chain (r_hp1/2, r_bulwark), Quick Draw (r_rapid), Keen Eyes (r_eyes1), Shortbow (r_bow), and Fleet (r_fleet). Silent kept its "(or you attack)" wording — the "in front of them" directional nuance is not yet built._

---

## SORCERER — the Wizard  (spell · start: rook · 3 HP)
_A fragile caster whose bolts pierce straight through the ranks._
_(the four chains are the four D&D schools of magic)_

starting rook should have cooldown 5 and hits all tiles en route to the target as well as the target with an animation (if not the case already)
the wizard's low hp makes up for his great cards

### 🔮 Translocations 
| tier | id | name | effect | `grant` |
|---|---|---|---|---|
You can move into wall tiles. While doing so reduces your vision radius to 1.
Add a castling card here. Lets you swap places with any enemy or turret on screen. Cooldown 5.


### 🔥 Time Magic
Raw destructive throughput: reach, haste, and free casts.
| tier | id | name | effect | `grant` |
|---|---|---|---|---|
| 3 | `s_free` | Free Casting | cards cost no turn to cast | `freeSpell` |
| 2 | `s_haste` | Attunement | cards recharge twice as fast | `spellHaste` |
Add a card that gives every enemy on screen the frustrated state for the next 3 turns. Cooldown 9.


### 💫 Hexes — "Their eyes glaze; their guard drops."
Crowd control through dazzling, mind-fogging bolts.
| tier | id | name | effect | `grant` |
|---|---|---|---|---|

| 3 | `s_cata` | Cataclysm | every visible foe is surprised when you cast a spell | `spellSurprise` |

### 🌀 Conjuration — "Summon a bigger weapon."
Conjure escalating armaments — up to a queen — and reach further.
| tier | id | name | effect | `grant` |
|---|---|---|---|---|
| 1 | `s_wand` | Wand | gain a bishop card (cooldown: 3) | `gainCard:bishop` |
| 2 | `s_staff` | Archstaff | gain a queen card (cooldown: 9) | `gainCard:queen` |
| 3 | `s_amp` | Amplify | +1 card reach | `cardReach:1` |

_Sorcerer changes: none — chains kept, just themed as the four schools._

---

## Ideas to push further (optional, needs new mechanics = code)
- **Warlord → Champion** capstone: a **queen** melee card (the ultimate weapon) instead of Parry.
- **Cavalier → Overrun**: moving costs no turn if you didn't attack (a true mobility capstone) — NEW flag.
- **Gloom Stalker → Assassinate**: first strike from stealth cleaves/×2 — NEW flag.
- **Enchantment → Dominate**: a slain foe's tile leaves the survivors frozen 2 turns — extend `spellDazzle`.
- Give each class's survival chain a **distinct** T3 (Warrior=Undying, Ranger=Bulwark, Sorcerer=Spell Mirror) — already done above, so they don't feel like the same "Toughness" pick.

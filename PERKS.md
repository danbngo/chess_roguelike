# Perks — themed subclass chains (brainstorm proposal)

Each floor, on **slaying the boss**, you pick 1 of 2 offered perks. Perks form **tiered
chains** (T1 → T2 → T3): a tier only appears once the tier below it is taken. Think of
each chain as a **D&D-style subclass** — commit down one and you become that archetype.

This draft only **re-themes and re-slots** perks; the underlying effects are the current
live ones (rebalance the numbers/effects next). **Only the Warrior was actually juggled**
(its defence was spread across 3 chains); Ranger & Sorcerer chains were already coherent —
Sorcerer's four even line up with the D&D wizard schools.

Effect keys: `maxHp`, `vision` (+2 = +1 sight radius), `moveRange` (now a forced full
slide), `cardReach`, `gainCard:<piece>`, and flags: `firstHitEachTurn`, `reflect`,
`meleeRefund`, `meleeCleave`, `meleeLeech`, `meleePierce`, `leapShock`, `meleeFlourish`,
`freeKillMove`, `extraLife`, `revealFloor`, `stealth`, `rangedRapid`, `spellHaste`,
`freeSpell`, `spellDazzle`, `spellSurprise`.

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

## RANGER — the Hunter  (ranged · start: bishop · 5 HP)
_A hunter who fells foes from across the room._
make sure its starting bishop has 4 cooldown

### 🌲 Druid — "Weather any storm the wild throws at you."
The survivalist: hard to hurt, first blow shrugged off.
| tier | id | name | effect | `grant` |
|---|---|---|---|---|
Water no longer effects your moves or prevents your weapon usage
Can see and shoot over (with cards) walls
Beastform - costs 0 turns to activate. turns you into a knight for 3 turns. You can only move by jumping and cannot use weapon cards.

### 🎯 Deadeye — "One shot. Then another, before they blink."
Extreme range and rapid follow-up shots.
| tier | id | name | effect | `grant` |
|---|---|---|---|---|
| 3 | `r_eagle` | Premonition | fresh floors reveal fully the moment you arrive | `revealFloor` |
| 2 | `r_eyes2` | Hawk Eyes | +1 sight radius | `vision:2` |
| 1 | `r_reach` | Power Draw | +1 card reach | `cardReach:1` |

### 🌑 Gloom Stalker — "Seen only when it's already too late."
All-seeing and unseen — the perfect ambusher.
| tier | id | name | effect | `grant` |
|---|---|---|---|---|
Enemies no longer chase you if you move out of their sight
camouflage - turrets and summoning circles dont attack you
| 3 | `r_stealth` | Silent | unaware foes don't notice you unless adjacent or if you use an attack in front of them | `stealth` |

### 🏹 Fletcher — "A bow for every range, and the feet to use them."
A versatile skirmisher who kites with a full quiver.
| tier | id | name | effect | `grant` |
|---|---|---|---|---|
reload - an ability card that skips your turn but recharges all OTHER cooldowns. cooldown: 3.
| 2 | `r_longbow` | Longbow | gain a rook card with cooldown 5 | `gainCard:rook` |
Recoil - whenever you use a weapon card, move away from the target. this move CAN hit an enemy.

---

## SORCERER — the Wizard  (spell · start: rook · 4 HP)
_A fragile caster whose bolts pierce straight through the ranks._
_(the four chains are the four D&D schools of magic)_

### 🔮 Abjuration — "Ward, and let their spite recoil."
The protective mage — extra life and a mirror against magic.
| tier | id | name | effect | `grant` |
|---|---|---|---|---|
Add a castling card here. Lets you hop over an enemy 2 or 3 squares away orthogonally if landing tile is valid/unblocked. This does not consume a turn.

### 🔥 mysticism — "Rain bolts, fast, far, and free."
Raw destructive throughput: reach, haste, and free casts.
| tier | id | name | effect | `grant` |
|---|---|---|---|---|
| 2 | `s_haste` | Attunement | spell cards recharge twice as fast with no enemy in sight | `spellHaste` |
| 3 | `s_free` | Free Casting | spell cards cost no turn to cast | `freeSpell` |


### 💫 Enchantment — "Their eyes glaze; their guard drops."
Crowd control through dazzling, mind-fogging bolts.
| tier | id | name | effect | `grant` |
|---|---|---|---|---|
| 1 | `s_eyes` | Third Eye | +1 sight radius | `vision:2` |
| 2 | `s_dazzle` | Dazzle | foes beside those a spell slays are caught by surprise | `spellDazzle` |
| 3 | `s_cata` | Cataclysm | every visible foe is surprised when you cast a spell | `spellSurprise` |

### 🌀 Conjuration — "Summon a bigger weapon."
Conjure escalating armaments — up to a queen — and reach further.
| tier | id | name | effect | `grant` |
|---|---|---|---|---|
| 1 | `s_wand` | Wand | gain a bishop card | `gainCard:bishop` |
| 2 | `s_staff` | Archstaff | gain a queen card | `gainCard:queen` |
| 3 | `s_amp` | Amplify | +1 card reach | `cardReach:1` |

_Sorcerer changes: none — chains kept, just themed as the four schools._

---

## Ideas to push further (optional, needs new mechanics = code)
- **Warlord → Champion** capstone: a **queen** melee card (the ultimate weapon) instead of Parry.
- **Cavalier → Overrun**: moving costs no turn if you didn't attack (a true mobility capstone) — NEW flag.
- **Gloom Stalker → Assassinate**: first strike from stealth cleaves/×2 — NEW flag.
- **Enchantment → Dominate**: a slain foe's tile leaves the survivors frozen 2 turns — extend `spellDazzle`.
- Give each class's survival chain a **distinct** T3 (Warrior=Undying, Ranger=Bulwark, Sorcerer=Spell Mirror) — already done above, so they don't feel like the same "Toughness" pick.

# Chess Roguelike — Systems Reference & Balance Review

A complete catalogue of the game's content systems (as currently implemented), followed by
analysis and rebalancing recommendations at the bottom.

Core numbers for reference: **Start** 3 HP, 1 regen/descent, vision 5 (a 5×5 window),
1 weapon-card slot, 2 equipment slots, 3 potion slots. **Run length** 10 floors (floors
1–5 standard pieces, 6–10 add fairy pieces; the Amazon boss + victory on floor 10, 20, …).
World is 20×20 with fog of war. Gold now comes from a **decaying descend reward** (base
`30 + floor×10`, losing ~1% of base per turn, hitting 0 near turn 100) plus **+2 per capture**.

---

## 1. Weapons (movement cards) & traits

Bought at **weapon shops** (appear once you've seen a card-eligible foe; then ~50%/floor).
A card lets the king move **once like that piece** (capturing along the way), then goes on
cooldown. Cards are range-capped to `floor(vision/2) + cardRangeBonus` (default **2** tiles).
Cost = piece value × (×2 if it carries a trait). Slots start at **1** (only the Ranger grows them).

| Card | Value/cost | Cooldown | Movement |
|---|---|---|---|
| Pawn | 1 (×2, always trait) | 1 | step orthogonally; capture diagonally |
| Berolina | 1 (×2, always trait) | 3 | step diagonally; capture orthogonally |
| King | 2 (×2, always trait) | 2 | one tile any direction |
| Knight | 3 | 3 | L-leap (jumps over anything) |
| Bishop | 3 | 3 | diagonal slide |
| Rook | 5 | 3 | orthogonal slide |
| Archbishop | 7 | 3 | bishop + knight |
| Chancellor | 8 | 3 | rook + knight |
| Queen | 9 | 3 | any slide |
| Amazon | 12 | — | queen + knight (**never sold** — final boss only) |

**Weapon traits** — fire when *that card* scores a kill. Pawn/King/Berolina cards always
carry one; other cards roll one with a floor-scaled chance (0 on floor 1 → up to **50%** by
floor 10). A trait doubles the card's price.

| Trait | Effect |
|---|---|
| Riposte | Take no damage on the enemy turn after the kill. |
| Slash | Also slay enemies on the 4 **diagonal** tiles. |
| Thrust | Also slay enemies on the 4 **cardinal** tiles. |
| Shoot | Snap back to your starting tile. |
| Flourish | Every visible enemy is caught by surprise. |

---

## 2. Equipment & armor

Bought at **equipment shops** (~50%/floor), worn in **equipment slots** (start 2), passive
while equipped, swappable (removing one strips its bonus). Offers are a weighted sample of 2.
Vision & movement are deliberately rare (weight 1) and pricey.

| Item | Bonus | Cost | Weight | Armor? |
|---|---|---|---|---|
| Vigor Charm | +1 max HP | 4 | 3 | – |
| Renewal Band | +1 regen (HP on descent) | 4 | 3 | – |
| Plate Armor | +2 max HP | 7 | 2 | ✔ |
| Buckler | +15% evade | 6 | 2 | ✔ |
| Spyglass | +2 sight | 6 | 1 | – |
| Swift Boots | +1 move range | 9 | 1 | – |

**Armor enchantments** — only **armor** (Plate/Buckler) may roll a bonus (30% chance): a
second smaller boon — *of Renewal* (+1 regen), *of Warding* (+10% evade), *of Vigor* (+1 HP),
or *of Farsight* (+1 sight).

---

## 3. Consumables

Bought at the **apothecary** (~50%/floor, offers 3 of 7), held in the **satchel** (3 slots),
used on demand by clicking (costs a turn — unless the Alchemist's Quick Draw makes it free).

| Potion / Scroll | Cost | Effect |
|---|---|---|
| Potion of Healing | 4 | Restore all HP. |
| Potion of Mending | 5 | Recharge every weapon card. |
| Potion of Barkskin | 7 | Invincible for **5** turns. |
| Fog Scroll | 5 | Fog clouds on every visible tile (block LOS; 33%/turn to dissipate). On the cast turn you can only see/be hit from adjacent tiles. |
| Potion of Invisibility | 8 | Enemies lose track of you for **6** turns (they wander; may still *bump* you by accident). Attacking or being hit reveals you. |
| Teleport Scroll | 6 | Whisk to a random passable tile on the floor. |
| Blink Scroll | 6 | Click a visible passable tile to hop to it. |

---

## 4. Classes (class altars)

Class altars appear ~55%/floor. Each class is a **3-rung ladder** taken in order (D&D-style:
level 2 needs level 1). An altar always offers the next rung of your **strongest** class so a
build keeps climbing. Perks are rule-changers (no flat +stat, no weapon/armor-trait overlap).

| Class | L1 | L2 | L3 |
|---|---|---|---|
| **Warrior** | Bulwark — negate the first hit each floor | Retaliation — after a hit lands, no more damage this enemy phase | Second Wind — descending grants 5 turns of Barkskin |
| **Barbarian** | Pillage — captures pay gold = piece value | Frenzy — each capture shaves 1 off every card cooldown | Bloodlust — capturing below half HP heals 1 |
| **Ranger** | Quiver — +1 weapon slot | Far Shot — cards reach +1 tile | Twin Quiver — +1 weapon slot |
| **Mage** | Channeling — cards recharge 1 faster | Arcane Recovery — descending refreshes every card | Focus — cards recharge 1 more faster |
| **Witch** | Glamour — 20% evade | Shadowstep — after a capture, no damage next enemy phase | Veil — +20% evade |
| **Alchemist** | Bandolier — +2 potion slots | Quick Draw — potions cost no turn | Potent Brews — empowered potions (healing also wards, mending also heals, barkskin/invis last longer) |

---

## 5. Bosses

A boss **guards the exit** (chance from floor 2; **guaranteed** on the final floor 10/20/…).
The stair is **barred** until it falls. A boss is **invulnerable while any killable guard is in
your sight** (blue aura → gold when vulnerable). Its kind is the floor's strongest piece
(possibly one tier up); the **final boss is always the Amazon** (the only Amazon in the game).
Bosses **never expend themselves** on a hit and strike from adjacency or range. Lair is a small
walled **keep** with sleeping bodyguards.

| Depth (within the 10-floor cycle) | Ability | Behavior |
|---|---|---|
| Floors 2–3 | **Summon** | Conjures a fresh guard on charged turns (also re-shields itself). |
| Floors 4–5 | **Blink** | Teleports adjacent to the king, then strikes. |
| Floors 6–7 | **Pierce** | Fires a mage-like bolt down its line, slaying everything between. |
| Floors 8–9 | **Warden** | Summon + Pierce. |
| Floor 10 (Amazon) | **Sovereign** | Summon + Blink + Pierce. |

(Charged = an ability can't fire two turns in a row.)

---

## 6. Enemy unit types & roles

### Piece kinds (the *movement*)

| Kind | Value | Movement | First floor |
|---|---|---|---|
| Pawn | 1 | step orthogonally; capture diagonally | 1 |
| King | 2 | one tile any direction | 1 |
| Knight | 3 | L-leap over anything | 2 |
| Bishop | 3 | diagonal slide | 3 |
| Rook | 5 | orthogonal slide | 4 |
| Queen | 9 | any slide | 5 |
| Berolina | 1 | step diagonally; capture orthogonally | 6 |
| Archbishop | 7 | bishop + knight | 8 |
| Chancellor | 8 | rook + knight | 10 |
| Amazon | 12 | queen + knight | — (final boss only) |

A floor's spawn pool is every kind unlocked at/before it, at equal odds.

### Roles (a *status* overlaid on a kind — one per piece, gated by floor)

| Role | From | Behavior |
|---|---|---|
| **Normal** | 1 | Hunts the king (closest reachable move); expends itself on a hit. |
| **Statue** | 2 | Inert & uncapturable until the king steps beside it, then wakes; often guards features. |
| **Turret** | (placed) | Fixed & **indestructible**; fires its piece pattern each turn; sited so it never covers a shop/exit/start. |
| **Skirmisher** | 3 | Ranged strike-and-retreat **every turn** on a clear firing line; *frustrated* if a unit blocks the line; knight/compound leapers ignore blockers. Not pawn/king. |
| **Armored** | 4 | First hit only **shatters its armor** (it survives) and **recoils the king to his start**; then fights on. Moves every other turn. |
| **Mage** | 5 | Fires a **piercing bolt** down its line, slaying *everything* between it and the king; **can't fire two turns running** (recharges). Not pawn/king. |
| **Summoner** | 6 | Conjures pawn minions on adjacent tiles (can't summon two turns running); **never strikes** the king; *frustrated* if hemmed in. |
| **Summoned** | — | Conjured pawns; **vanish the moment they leave your sight**. |
| **Boss** | 2 | See §5. |

### Main AI states (the behavioral state, shown by icon)

`Sleeping` (out of sight) → `Wandering` (out of sight, drifting) → `Surprised` (frozen 1 turn
on first sighting; **never two turns running**) → `Hostile` (hunting) → `Frustrated` (no legal
action). Colored **hats** show the role; **icons** show the state.

---

## 7. Terrain

(Mist was removed; only walls now block sight, keeping "blocked sight" unambiguous.)

| Terrain | From | Rules |
|---|---|---|
| Normal | – | Open ground. |
| Wall | 2 | Blocks movement **and** line of sight; cannot be leapt over. |
| Mud | 3 | At most **two** mud tiles crossed per move; a leap clears it. |
| Ice | 4 | Cannot stop on it — you **slide** to the far end (or until you hit a wall/unit). |
| Water | 5 | Impassable, but **does not block sight**; leapers jump clean over it. |

Density of each grows with depth. Plus two non-terrain sight systems: **fog of war**
(permanent per-floor exploration memory) and temporary **fog clouds** (from a Fog Scroll).

---

# Analysis & Recommendations

## What's working (pros)

- **Strong core identity.** Chess-threat geometry + fog of war + the surprise/telegraph loop
  is distinctive and readable. The role system (mage/skirmisher/summoner/turret/armored/statue)
  turned a one-note "everything rushes you" AI into genuine positional puzzles.
- **Coherent economic tension.** The decaying descend reward pushes *speed*, while shops/altars
  and capture-gold pull toward *lingering*. That's a real, legible decision every floor.
- **Two clean build axes.** Passive **equipment** (flat, reliable) vs. rule-changing **class
  perks** vs. active **consumables** — three different flavors that don't step on each other.
- **Bosses now give runs a shape** — gated exits + escalating abilities + a guaranteed Amazon
  finale fixed the biggest structural hole (the old dead victory).

## Cross-cutting risks (cons)

1. **Cognitive load is high.** 9 piece kinds × 8 roles × 5 states × 5 terrains × traits ×
   equipment × 6 classes × 7 consumables. It's rich, but a new player faces a wall. The hats/
   icons/tips help; the content itself may be past the point of diminishing returns.
2. **Weapon cards are a minor system.** You start with **1 slot** and only the Ranger grows it,
   yet cards are pricey (piece value, doubled with a trait) and compete with 2 other shops for a
   now-scarcer gold supply. Consequently **weapon traits rarely fire** (few card kills happen),
   which undercuts a whole content layer (Slash/Thrust/Riposte/Shoot/Flourish).
3. **Three class ladders are "the same perk twice."** Ranger (Quiver/Twin Quiver both +1 slot),
   Mage (Channeling/Focus both −1 cooldown), Witch (Glamour/Veil both +evade). L1 and L3 are
   identical — the ladder has no payoff/capstone. Warrior, Barbarian, Alchemist are the good
   models (three distinct, escalating ideas).
4. **Equipment is almost entirely flat stats.** By design (classes took the "interesting" role),
   but it makes gear shopping a math exercise, not a decision. Only the rare armor enchant adds
   texture.
5. **Escape tools may over-trivialize danger.** Blink + Teleport + Invisibility + Barkskin +
   Fog is a *lot* of "get out of jail." With **Alchemist Quick Draw** (free potions), a full
   satchel of Blink/Invisibility becomes near-unlimited kiting. Bounded only by satchel size and
   gold — but it's the most likely balance outlier.
6. **Summon-boss stall risk.** A boss is invulnerable while a killable guard is visible, and the
   Summon/Warden/Sovereign bosses *re-summon guards*. If it summons faster than you can clear +
   reach it, the fight can drag or soft-lock into attrition. Needs a guard-rail.

## Recommendations, by priority

### Cut / consolidate
- **Collapse the redundant class L1/L3 perks into capstones.** Give Ranger L3 something like
  "cards also strike the tile you pass through," Mage L3 "every 3rd card is free," Witch L3
  "after evading, you're invisible for 1 turn." Same effort, far more identity.
- **Consider trimming the piece roster or the role matrix** rather than adding more. A *queen
  mage* (pierces the whole board) or *chancellor turret* can be brutal/unfun — either exclude
  the nastiest kind×role combos or cap their reach. Depth ≠ every combination.
- **Water vs. Wall overlap** — both impassable; the only difference (water doesn't block sight,
  leapers cross) is subtle. Either lean into it (make water do something — slow, extinguish,
  drown non-leapers) or drop one.

### Expand
- **Make weapon cards matter** so traits actually see play. Options: start with 2 slots; make
  slots cheaper to grow (a common equipment "Bandolier" for weapon slots, or a base +1 at a
  depth milestone); or cut card cooldowns. If cards stay a 1-slot niche, consider folding a few
  traits onto the king's *own* melee so the trait layer isn't wasted.
- **Add 2–3 rule-changing equipment pieces** (not stats): e.g., "Warding Cloak — the first
  enemy each floor that would see you is surprised instead," "Spiked Pauldron — armored foes'
  recoil doesn't move you." Gives the equipment shop real decisions.
- **Terrain interactions.** The engine already supports terrain rules cheaply — a hazard tile
  (fire/chasm), a teleporter pad, or breakable walls would multiply tactical variety with little
  new UI.

### Improve / rebalance (specific knobs)
- **Guard-rail the summon bosses:** cap total re-summons (e.g., a boss can hold at most N live
  guards), or make the boss *briefly vulnerable right after summoning*, so summon-lock can't
  stall the fight.
- **Rein in free-action escapes:** either exclude Blink/Teleport/Invisibility from Quick Draw,
  or give Invisibility/Blink a short self-cooldown so they can't be chain-cast. Alternatively,
  cap satchel size lower for those and let Alchemist Bandolier raise it — making the Alchemist
  the *intended* way to spam them, as a build choice rather than a default.
- **Revisit weapon-card pricing vs. the new gold curve.** With gold now front-loaded and
  decaying, high-value cards (Queen 9→18) may be unreachable without Pillage. Either flatten card
  costs or raise early gold so the weapon layer is accessible without a Barbarian dip.
- **Baseline survivability vs. ranged density.** 3 starting HP against piercing mages, turrets,
  and blink-bosses is swingy — a single unseen mage line can be a third of your health. Consider
  4 starting HP, or making the *first* mage/turret sighting always telegraph a turn (they already
  surprise, but verify piercing lines are readable before they fire).
- **Economy sinks vs. sources.** With 3–4 competing shops but random appearance and a decaying
  reward, audit whether a typical run can afford anything meaningful. If gold feels tight, lower
  costs or raise `FLOOR_GOLD_BASE`; if flush, add a premium sink (a rare "artifact" shop).

### Highest-leverage single changes
1. **Fix the three copy-paste class ladders** (cheap, big identity win).
2. **Make weapon cards accessible** (slots and/or cost) so the trait system stops being dead
   content.
3. **Guard-rail summon bosses** (prevents the one genuine soft-lock).
4. **Decide the escape-tool power budget** (Quick Draw + Blink/Invis is the likely outlier).

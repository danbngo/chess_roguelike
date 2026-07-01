// Shared configuration. Loaded first; every other script reads from these.

const WORLD_SIZE = 20; // The full board is WORLD_SIZE x WORLD_SIZE tiles.
const STARTING_VISION = 5; // The king starts seeing a 5x5 window (odd, so centered).
const VISION_STEP = 2; // Each Keen Eyes upgrade widens the window by 2 (5 -> 7 -> 9...).
const PLAYER_START = { x: 8, y: 8 };
const STARTING_HP = 3;
const STARTING_REGEN = 1; // HP mended on descending to the next floor.
const STARTING_CARD_SLOTS = 1; // Card slots the king begins with.
const MAX_UPGRADES_PER_TYPE = 4; // Each altar upgrade type can be taken at most 4 times.
const MAX_TURNS_SCARY = 100; // Lingering this many turns on a floor maxes spawn rate / dread.
const SPATTER_LIFE = 5; // Turns a blood spatter lingers before fading away.
const BARKSKIN_TURNS = 5; // Turns the Barkskin potion keeps the king invincible.

// Consumables replace the old hearts: rarer pickups with weighted spawn rates,
// each an immediate boon or a short status. Weights bias drops toward the humble
// healing potion; barkskin is the rare prize.
const CONSUMABLES = {
  health: { name: 'Potion of Healing', desc: 'Restores all HP.', weight: 5, glyph: '♥', color: '#f472b6' },
  mana: { name: 'Potion of Mending', desc: 'Recharges every card.', weight: 3, glyph: '✦', color: '#60a5fa' },
  barkskin: { name: 'Potion of Barkskin', desc: `Invincible for ${BARKSKIN_TURNS} turns.`, weight: 2, glyph: '◈', color: '#a3e635' },
};

// Terrain is introduced gradually across the run: floor 1 is empty ground, and
// each listed floor unlocks a new hazard type that grows denser on deeper floors
// (so the final floor is crowded). The first sighting of each type pops a tip.
const TERRAIN_UNLOCK = { wall: 2, mud: 3, ice: 4, water: 5 };

const FINAL_FLOOR = 15; // Every multiple of this is a final-boss floor: the Amazon, and victory (15, 30, ...).
const MAX_ENEMIES = 40; // Hard safety cap so over-time spawning can't run away.

// Enemy variety ramps with depth. A floor's spawn pool is every kind unlocked at
// or before it, each chosen with equal probability (so spawn rates are even per
// unit). The enemy king is now an ordinary foe present from the very first floor
// (no longer a boss). The full standard set arrives before floor 15, berolina
// pawns just after, and the whole endgame set by floor 30.
const ENEMY_UNLOCKS = [
  { kind: 'pawn', floor: 1 },
  { kind: 'king', floor: 1 }, // a common, weak enemy — moves one tile, worth capturing
  { kind: 'knight', floor: 3 },
  { kind: 'bishop', floor: 6 },
  { kind: 'rook', floor: 9 },
  { kind: 'queen', floor: 12 }, // full standard set in hand before the final floor (15)
  { kind: 'berolina', floor: 16 }, // endgame fairies appear only in New Game +
  { kind: 'archbishop', floor: 22 },
  { kind: 'chancellor', floor: 25 },
  // The amazon is intentionally absent here: she exists ONLY as the final boss.
];

// Equipment cards: bought (not free) at equipment shops and worn in a limited set
// of equipment slots, granting a passive stat bonus for as long as they are
// equipped. Swapping one out removes its bonus, just like a worn item. Vision is
// deliberately scarcer and pricier (lower weight) so it isn't stacked every floor.
const STARTING_EQUIP_SLOTS = 2; // Equipment slots the king begins with.
const EQUIPMENT = {
  // Common boons.
  vigor: { name: 'Vigor Charm', stat: 'hp', amount: 1, cost: 4, weight: 3 },
  renewal: { name: 'Renewal Band', stat: 'regen', amount: 1, cost: 4, weight: 3 },
  // Armor: defensive, and the only gear that may roll a rare bonus enchantment.
  plate: { name: 'Plate Armor', stat: 'hp', amount: 2, cost: 7, weight: 2, armor: true },
  buckler: { name: 'Buckler', stat: 'evade', amount: 0.15, cost: 6, weight: 2, armor: true },
  // Rare utility (sight and movement are deliberately scarce and pricey).
  spyglass: { name: 'Spyglass', stat: 'vision', amount: 2, cost: 6, weight: 1 },
  boots: { name: 'Swift Boots', stat: 'moveRange', amount: 1, cost: 9, weight: 1 },
};

// Rare bonus enchantments an armor offer may carry (a second, smaller boon).
const EQUIP_ENCHANTS = [
  { stat: 'regen', amount: 1, name: 'of Renewal' },
  { stat: 'evade', amount: 0.1, name: 'of Warding' },
  { stat: 'hp', amount: 1, name: 'of Vigor' },
  { stat: 'vision', amount: 1, name: 'of Farsight' },
];
const EQUIP_ENCHANT_CHANCE = 0.3; // chance a given armor offer is enchanted

// A human-readable phrase for any equipment stat bonus.
function bonusDesc(stat, amount) {
  if (stat === 'hp') return `+${amount} max HP`;
  if (stat === 'vision') return `+${amount} sight range`;
  if (stat === 'regen') return `+${amount} HP mended on descent`;
  if (stat === 'evade') return `+${Math.round(amount * 100)}% evade`;
  if (stat === 'moveRange') return `+${amount} move range`;
  return '';
}

function equipDesc(key) {
  const e = EQUIPMENT[key];
  return e ? bonusDesc(e.stat, e.amount) : '';
}

const SHOP_CHOICES = 3; // Cards a weapon shop offers.
const EQUIP_SHOP_CHOICES = 2; // Equipment offered per shop (a weighted sample).

// Class altars (shrines) let the king invest in a play-style. Each class is a
// ladder of perks taken in order (D&D-style: level 2 needs level 1). Perks are
// rule-changers that lean into a fantasy and weave through the other systems —
// weapon traits on melee captures, card cooldown / range, movement, sight, slots,
// evasion. An altar offers a few classes' next perks, always including the next
// rung of the king's strongest class so a build can keep climbing.
const CLASS_ALTAR_CHOICES = 3;
const CLASSES = {
  warrior: {
    name: 'Warrior',
    blurb: 'Unyielding in the press of battle.',
    perks: [
      { id: 'war1', name: 'Toughness', desc: '+3 max HP', grants: { maxHp: 3 } },
      { id: 'war2', name: 'Stalwart', desc: '20% chance to shrug off a hit', grants: { evade: 0.2 } },
      { id: 'war3', name: 'Juggernaut', desc: '+1 equipment slot', grants: { maxEquipment: 1 } },
    ],
  },
  barbarian: {
    name: 'Barbarian',
    blurb: 'Strikes again and again, and again.',
    perks: [
      { id: 'bar1', name: 'Cleave', desc: 'Melee captures also slay the 4 cardinal neighbours', grants: { meleeTrait: 'thrust' } },
      { id: 'bar2', name: 'Plunder', desc: '+3 gold per capture', grants: { goldPerKill: 3 } },
      { id: 'bar3', name: 'Long Reach', desc: '+1 move range (step & strike farther)', grants: { moveRange: 1 } },
    ],
  },
  thief: {
    name: 'Thief',
    blurb: 'Finds the gold and slips the blade.',
    perks: [
      { id: 'thi1', name: 'Treasure Sense', desc: 'Sense every item on the floor', grants: { detectItems: true } },
      { id: 'thi2', name: 'Nimble', desc: '25% chance to evade a hit', grants: { evade: 0.25 } },
      { id: 'thi3', name: 'Acrobat', desc: '+1 move range', grants: { moveRange: 1 } },
    ],
  },
  ranger: {
    name: 'Ranger',
    blurb: 'Master of sight and the long shot.',
    perks: [
      { id: 'ran1', name: 'Eagle Eye', desc: '+2 sight range', grants: { vision: 2 } },
      { id: 'ran2', name: 'Quiver', desc: '+1 weapon card slot', grants: { maxCards: 1 } },
      { id: 'ran3', name: 'Far Shot', desc: 'Weapon cards reach 1 tile farther', grants: { cardRangeBonus: 1 } },
    ],
  },
  mage: {
    name: 'Mage',
    blurb: 'Bends arcane bursts to the fray.',
    perks: [
      { id: 'mag1', name: 'Spark', desc: 'Melee captures also slay the 4 diagonal neighbours', grants: { meleeTrait: 'slash' } },
      { id: 'mag2', name: 'Channeling', desc: 'Weapon cards recharge 1 turn faster', grants: { cooldownReduction: 1 } },
      { id: 'mag3', name: 'Arcane Nova', desc: 'Melee captures surprise every visible foe', grants: { meleeTrait: 'flourish' } },
    ],
  },
  witch: {
    name: 'Witch',
    blurb: 'Trickster of wards and glamours.',
    perks: [
      { id: 'wit1', name: 'Witch Sight', desc: 'Sense items, +1 sight range', grants: { detectItems: true, vision: 1 } },
      { id: 'wit2', name: 'Riposte Ward', desc: 'After a melee kill, take no damage next turn', grants: { meleeTrait: 'riposte' } },
      { id: 'wit3', name: 'Glamour', desc: '25% chance to evade a hit', grants: { evade: 0.25 } },
    ],
  },
};

// A card lets the king move once like the given unit. Its gold cost equals the
// piece's traditional chess value; cards share a fixed cooldown, except pawns
// (fast) and kings (a touch slower). A card may also carry a weapon trait, which
// doubles its price — pawn, king and berolina cards must always have one.
const CARD_POINTS = {
  pawn: 1,
  berolina: 1,
  knight: 3,
  bishop: 3,
  rook: 5,
  archbishop: 7,
  chancellor: 8,
  queen: 9,
  amazon: 12, // never sold (no amazon enemies to learn from); kept for the final boss
  king: 2,
};
const CARD_COOLDOWN = 3; // Fixed recharge for most cards.
const TRAIT_REQUIRED_KINDS = ['pawn', 'king', 'berolina']; // these cards always bear a trait

function isCardKind(kind) {
  return Object.prototype.hasOwnProperty.call(CARD_POINTS, kind);
}

function cardCooldown(kind) {
  if (kind === 'pawn') return 1;
  if (kind === 'king') return 2;
  return CARD_COOLDOWN;
}

function cardMustHaveTrait(kind) {
  return TRAIT_REQUIRED_KINDS.includes(kind);
}

function cardCost(kind, hasTrait) {
  return CARD_POINTS[kind] * (hasTrait ? 2 : 1);
}

// Weapon traits, each triggering when the card scores a kill. Pawn, king and
// berolina cards always have one; other cards gain one with a floor-scaled chance
// (0 on floor 1 up to 50% by the final floor).
const TRAIT_INFO = {
  riposte: { name: 'Riposte', desc: 'Take no damage on the enemy turn after a kill with this card.' },
  slash: { name: 'Slash', desc: 'On a kill, also slay enemies on the 4 diagonal tiles.' },
  thrust: { name: 'Thrust', desc: 'On a kill, also slay enemies on the 4 cardinal tiles.' },
  shoot: { name: 'Shoot', desc: 'On a kill, snap back to your starting tile.' },
  flourish: { name: 'Flourish', desc: 'On a kill, every visible enemy is caught by surprise.' },
};
const CARD_TRAITS = Object.keys(TRAIT_INFO);
const MAX_TRAIT_CHANCE = 0.5; // Highest chance (reached on the final floor) a card bears a trait.

// Movement direction tables, reused by the piece-move generators.
const ORTHO = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
const DIAG = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];
const KNIGHT_STEPS = [
  [1, 2],
  [2, 1],
  [-1, 2],
  [-2, 1],
  [1, -2],
  [2, -1],
  [-1, -2],
  [-2, -1],
];

// localStorage key for the single save slot.
const SAVE_KEY = 'chess-roguelike-save-v1';

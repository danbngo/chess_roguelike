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

// Terrain is introduced gradually across the run: floor 1 is empty ground, and
// each listed floor unlocks a new hazard type that grows denser on deeper floors
// (so the final floor is crowded). The first sighting of each type pops a tip.
const TERRAIN_UNLOCK = { wall: 2, mud: 3, ice: 4, mist: 5, water: 6 };

const FINAL_FLOOR = 15; // Every multiple of this holds the solo enemy king (15, 30, ...).
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
  { kind: 'berolina', floor: 16 }, // just past the final floor
  { kind: 'camel', floor: 19 },
  { kind: 'archbishop', floor: 22 },
  { kind: 'chancellor', floor: 25 },
  { kind: 'nightrider', floor: 28 },
  { kind: 'amazon', floor: 30 }, // 2x final floor: the complete endgame set
];

// Altar upgrades: free, but a given altar offers only two of these and grants one
// before it goes dormant. Each type can be taken at most MAX_UPGRADES_PER_TYPE times.
const ALTAR_UPGRADES = [
  { id: 'hp', name: 'Vitality', desc: '+1 max HP (and heal 1)' },
  { id: 'vision', name: 'Keen Eyes', desc: '+2 sight range (see farther)' },
  { id: 'regen', name: 'Renewal', desc: '+1 HP mended each time you descend' },
  { id: 'cards', name: 'Arsenal', desc: '+1 card slot' },
];

const SHOP_CHOICES = 3; // Cards a weapon shop offers.
const ALTAR_CHOICES = 2; // Blessings an altar offers.

// A card lets the king move once like the given unit. Its gold cost equals the
// piece's traditional chess value; cards share a fixed cooldown, except pawns
// (fast) and kings (a touch slower). A card may also carry a weapon trait, which
// doubles its price — pawn, king and berolina cards must always have one.
const CARD_POINTS = {
  pawn: 1,
  berolina: 1,
  camel: 2,
  knight: 3,
  bishop: 3,
  rook: 5,
  nightrider: 5,
  archbishop: 7,
  chancellor: 8,
  queen: 9,
  amazon: 12,
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
// Camel: a (3,1) leaper.
const CAMEL_STEPS = [
  [3, 1],
  [1, 3],
  [-3, 1],
  [-1, 3],
  [3, -1],
  [1, -3],
  [-3, -1],
  [-1, -3],
];

// localStorage key for the single save slot.
const SAVE_KEY = 'chess-roguelike-save-v1';

// Shared configuration. Loaded first; every other script reads from these.

const WORLD_SIZE = 20; // The full board is WORLD_SIZE x WORLD_SIZE tiles.
const STARTING_VISION = 5; // The king starts seeing a 5x5 window (odd, so centered).
const VISION_STEP = 2; // Each Keen Eyes upgrade widens the window by 2 (5 -> 7 -> 9...).
const PLAYER_START = { x: 8, y: 8 };
const STARTING_HP = 3;
const STARTING_REGEN = 1; // HP mended on descending to the next floor.
const STARTING_CARD_SLOTS = 1; // Card slots the king begins with.
const MAX_UPGRADES_PER_TYPE = 4; // Each altar upgrade type can be taken at most 4 times.
const MAX_TURNS_SCARY = 50; // Lingering this many turns on a floor maxes spawn rate / dread.
const SPATTER_LIFE = 5; // Turns a blood spatter lingers before fading away.

// Terrain is introduced gradually across the run: floor 1 is empty ground, and
// each listed floor unlocks a new hazard type that grows denser on deeper floors
// (so the final floor is crowded). The first sighting of each type pops a tip.
const TERRAIN_UNLOCK = { wall: 2, water: 3, ice: 4, mist: 5 };

const FINAL_FLOOR = 5; // Every multiple of this holds the solo enemy king (5, 10, ...).
const MAX_ENEMIES = 40; // Hard safety cap so over-time spawning can't run away.

// Enemy variety ramps with depth. A floor's spawn pool is every kind unlocked at
// or before it, each chosen with equal probability (so spawn rates are even per
// unit). The solo enemy king is the boss of each "final" floor and is placed
// separately — it is never drawn from this pool. Floors line up with FINAL_FLOOR:
// the full standard set arrives by floor 5, berolina pawns just after (floor 6),
// and the whole endgame set by floor 10 (2x final — i.e. new game plus).
const ENEMY_UNLOCKS = [
  { kind: 'pawn', floor: 1 },
  { kind: 'knight', floor: 2 },
  { kind: 'bishop', floor: 3 },
  { kind: 'rook', floor: 4 },
  { kind: 'queen', floor: 5 }, // final floor: full standard set
  { kind: 'berolina', floor: 6 }, // just past the final floor
  { kind: 'camel', floor: 7 },
  { kind: 'archbishop', floor: 8 },
  { kind: 'chancellor', floor: 9 },
  { kind: 'amazon', floor: 10 }, // 2x final floor: the complete endgame set
  { kind: 'nightrider', floor: 11 }, // deeper new game plus: the knight-rider
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

// Cards the weapon shop can sell: any seen enemy unit except pawns and the king.
// Higher cooldowns (and prices) for more powerful pieces. A card lets the king
// move like that unit once, then it must recharge over `cooldown` turns.
const CARD_STATS = {
  knight: { cooldown: 2, cost: 12 },
  berolina: { cooldown: 2, cost: 12 },
  camel: { cooldown: 2, cost: 14 },
  bishop: { cooldown: 3, cost: 16 },
  rook: { cooldown: 3, cost: 18 },
  nightrider: { cooldown: 4, cost: 30 },
  archbishop: { cooldown: 4, cost: 26 },
  chancellor: { cooldown: 4, cost: 28 },
  queen: { cooldown: 5, cost: 34 },
  amazon: { cooldown: 6, cost: 44 },
};

// Whether an enemy kind can be bought as a card (not pawns, not the enemy king).
function isCardKind(kind) {
  return Object.prototype.hasOwnProperty.call(CARD_STATS, kind);
}

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

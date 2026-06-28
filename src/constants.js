// Shared configuration. Loaded first; every other script reads from these.

const WORLD_SIZE = 20; // The full board is WORLD_SIZE x WORLD_SIZE tiles.
const STARTING_VISION = 4; // The king starts seeing a 4x4 window (half the old 8).
const VISION_MAX = 8; // Sight range upgrades back up to a chessboard's worth.
const PLAYER_START = { x: 8, y: 8 };
const STARTING_HP = 5;

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
];

// Purchasable in the shop. `repeatable` upgrades can be bought many times;
// `max` caps a repeatable stat. Costs are flat for simplicity.
const UPGRADES = [
  { id: 'heart', name: 'Extra Heart', desc: '+1 max HP (and heal 1)', cost: 14, repeatable: true },
  { id: 'heal', name: 'Mend Wounds', desc: 'Restore HP to full', cost: 10, repeatable: true },
  { id: 'range', name: 'Long Stride', desc: '+1 king move range (click to use)', cost: 22, repeatable: true, max: 4 },
  { id: 'vision', name: 'Keen Eyes', desc: '+1 sight range (see farther)', cost: 16, repeatable: true, max: VISION_MAX },
  { id: 'jump', name: 'Knight Leap', desc: 'Leap like a knight (click blue tiles)', cost: 38, repeatable: false },
];

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

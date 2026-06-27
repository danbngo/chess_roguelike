// Shared configuration. Loaded first; every other script reads from these.

const WORLD_SIZE = 20; // The full board is WORLD_SIZE x WORLD_SIZE tiles.
const VIEW_SIZE = 8; // The king sees an 8x8 window (a chessboard's worth).
const PLAYER_START = { x: 8, y: 8 };
const STARTING_HP = 5;

const FINAL_FLOOR = 5; // The floor that holds the enemy king instead of an exit.
const MAX_ENEMIES = 28; // Hard cap so over-time spawning can't run away.

const PIECE_TYPES = ['pawn', 'rook', 'bishop', 'knight', 'queen'];

// Purchasable in the shop. `repeatable` upgrades can be bought many times;
// `max` caps a repeatable stat. Costs are flat for simplicity.
const UPGRADES = [
  { id: 'heart', name: 'Extra Heart', desc: '+1 max HP (and heal 1)', cost: 14, repeatable: true },
  { id: 'heal', name: 'Mend Wounds', desc: 'Restore HP to full', cost: 10, repeatable: true },
  { id: 'range', name: 'Long Stride', desc: '+1 king move range (click to use)', cost: 22, repeatable: true, max: 4 },
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

// localStorage key for the single save slot.
const SAVE_KEY = 'chess-roguelike-save-v1';

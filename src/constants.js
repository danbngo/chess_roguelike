// Shared configuration. Loaded first; every other script reads from these.

const WORLD_SIZE = 20; // The full board is WORLD_SIZE x WORLD_SIZE tiles (walled border).
const STARTING_VISION = 7; // The king starts seeing a 7x7 window (odd, so centered).
const VISION_STEP = 2; // Each +1 sight perk widens the window by 2 (7 -> 9 -> 11...).
const PLAYER_START = { x: 10, y: 10 };
const STARTING_HP = 5; // Default; each class overrides it (see CLASSES[].hp).
const MAX_TURNS_SCARY = 50; // Lingering this many turns on a floor maxes spawn rate / dread.
const SPATTER_LIFE = 5; // Turns a blood spatter lingers before fading away.
const PURSUIT_TTL = 6; // Turns an enemy hunts toward the king's last-seen tile before losing the trail.
const MAX_ENEMIES = 45; // Hard safety cap so over-time spawning can't run away.

// --- Floors -----------------------------------------------------------------

const FINAL_FLOOR = 8; // An eight-floor run (an 8x8-board's worth), victory on floor 8.
const DEMON_FLOOR = 5; // From floor 5 the fairy/demon pieces take over the roster.
const STANDARD_KINDS = ['pawn', 'king', 'knight', 'bishop', 'rook', 'queen'];
const DEMON_KINDS = ['berolina', 'archbishop', 'chancellor', 'amazon'];
const ENEMY_UNLOCKS = [
  { kind: 'pawn', floor: 1 },
  { kind: 'king', floor: 1 },
  { kind: 'knight', floor: 2 },
  { kind: 'bishop', floor: 3 },
  { kind: 'rook', floor: 3 },
  { kind: 'queen', floor: 4 },
  { kind: 'berolina', floor: 5 },
  { kind: 'archbishop', floor: 6 },
  { kind: 'chancellor', floor: 7 },
  { kind: 'amazon', floor: 8 },
];

// The eight authored floors. Each: a themed name, a terrain `recipe` (blob/segment
// seed counts for the ONLY three terrain types — wall, water, lava), and a UNIQUE
// boss (a high-mobility piece with HP, guarded by an authored backup cohort). The
// exit + boss chamber sit at a fixed anchor; wanderers and potions scatter.
const LEVELS = [
  { name: 'The Battlefield', recipe: { wall: 3 }, boss: { name: 'the Warlord', kind: 'knight', hp: 3 } },
  { name: 'The Old Forest', recipe: { wall: 2, water: 2 }, boss: { name: 'the Centaur', kind: 'bishop', hp: 4 } },
  { name: 'The Sunken Ruins', recipe: { wall: 6 }, boss: { name: 'the Stone Golem', kind: 'rook', hp: 4 } },
  { name: 'The Drowned Lake', recipe: { water: 8 }, boss: { name: 'the Leviathan', kind: 'queen', hp: 5 } },
  { name: 'The Whispering Crypt', recipe: { wall: 7 }, boss: { name: 'the Lich', kind: 'archbishop', hp: 5 } },
  { name: 'The Hedge Maze', recipe: { wall: 8 }, boss: { name: 'the Minotaur', kind: 'chancellor', hp: 6 } },
  { name: 'The Lake of Fire', recipe: { lava: 8, wall: 2 }, boss: { name: 'the Bone Dragon', kind: 'amazon', hp: 6 } },
  { name: 'The Demon Castle', recipe: { wall: 6, lava: 3 }, boss: { name: 'the Balrog', kind: 'amazon', hp: 8 } },
];

function levelForFloor(floor) {
  return LEVELS[((floor - 1) % FINAL_FLOOR + FINAL_FLOOR) % FINAL_FLOOR] || null;
}

function floorName(floor) {
  const level = levelForFloor(floor);
  const base = level ? level.name : `Floor ${floor}`;
  const cycle = Math.floor((floor - 1) / FINAL_FLOOR);
  return cycle > 0 ? `${base} +${cycle}` : base;
}

// Fixed exit / boss-chamber anchors, one per floor (never random). Kept clear of
// the king's central start and spread around the board's edges.
const CHAMBER_ANCHORS = [
  { x: 16, y: 16 },
  { x: 3, y: 3 },
  { x: 16, y: 3 },
  { x: 3, y: 16 },
  { x: 16, y: 10 },
  { x: 3, y: 10 },
  { x: 10, y: 16 },
  { x: 10, y: 3 },
];
function chamberAnchorForFloor(floor) {
  return CHAMBER_ANCHORS[((floor - 1) % FINAL_FLOOR + FINAL_FLOOR) % FINAL_FLOOR];
}

// Terrain unlock floors (only walls, water, lava exist now).
const TERRAIN_UNLOCK = { wall: 2, water: 3, lava: 5 };

// --- Cards ------------------------------------------------------------------

// A weapon card lets the king attack once, moving/striking like the given piece.
// Cards come in three CATEGORIES, tied to the class that grants them:
//   melee  - the king moves ONTO the target.
//   ranged - the king holds his tile; the shot is blocked by units in the way
//            (leaps excepted).
//   spell  - the king holds his tile; the bolt pierces everything on its path,
//            and costs 2x cooldown.
// A card's category is NOT stored per card — it is a property of the player's
// CLASS (Warrior melee / Ranger ranged / Sorcerer spell), resolved via
// classCategory(). There are no traits or ratings; card power comes from perks.
const STEPPER_KINDS = ['king', 'pawn', 'knight']; // reach 1; sliders reach 3
const CARD_KINDS = ['pawn', 'king', 'knight', 'bishop', 'rook', 'archbishop', 'chancellor', 'queen', 'amazon'];
const CARD_COOLDOWN = 3;

function isCardKind(kind) {
  return CARD_KINDS.includes(kind);
}

// The card category shared by every card of a given class (defaults to melee).
function classCategory(className) {
  return (CLASSES[className] && CLASSES[className].category) || 'melee';
}

// How far a card reaches: steppers/knights 1 tile/leap; sliders 3 tiles. A Farsight
// perk adds `bonus` to both.
function cardReach(kind, bonus) {
  return (STEPPER_KINDS.includes(kind) ? 1 : 3) + (bonus || 0);
}

// Spell cards recharge twice as slowly; the king card is a touch faster.
function cardCooldown(kind, category) {
  const base = kind === 'king' ? 2 : CARD_COOLDOWN;
  return category === 'spell' ? base * 2 : base;
}

// --- Classes & level-up perks -----------------------------------------------

// Three classes, one per card category, with distinct starting HP (the melee
// Warrior is sturdiest, the fragile Sorcerer least). Each starts with a single card
// and, on every descent, chooses ONE of TWO offered perks. Perks form TIERED CHAINS:
// a perk with `requires` only appears once its prerequisite is taken, so the strong
// capstones are always gated behind cheaper stat bumps (tier 1 -> 2 -> 3).
const CLASSES = {
  warrior: {
    name: 'Warrior',
    blurb: 'A sturdy frontline fighter who lunges in and trades blows.',
    color: '#dc2626',
    category: 'melee', // every Warrior card strikes by moving onto the target
    // A knight LEAP: bound in an L onto a foe (or, now, onto empty ground) — a jumping
    // gap-closer that clears walls and pieces between. Not a piece his perks grant
    // (those give bishop & rook), so no overlap.
    start: 'knight',
    hp: 7,
    perks: [
      // Vigor chain
      { id: 'w_hp1', tier: 1, name: 'Hardy', desc: '+1 max HP', grants: { maxHp: 1 } },
      { id: 'w_hp2', tier: 2, requires: 'w_hp1', name: 'Toughness', desc: '+2 max HP', grants: { maxHp: 2 } },
      { id: 'w_bulwark', tier: 3, requires: 'w_hp2', name: 'Bulwark', desc: 'The first hit each turn is negated', grants: { firstHitEachTurn: true } },
      // Onslaught chain
      { id: 'w_reach', tier: 1, name: 'Long Arms', desc: '+1 card reach', grants: { cardReach: 1 } },
      { id: 'w_cleave', tier: 2, requires: 'w_reach', name: 'Cleave', desc: 'A melee-card kill also slays one adjacent enemy', grants: { meleeCleave: true } },
      { id: 'w_leech', tier: 3, requires: 'w_cleave', name: 'Vampiric Edge', desc: 'A melee-card kill heals 1 HP', grants: { meleeLeech: true } },
      // Fury chain
      { id: 'w_fleet', tier: 1, name: 'Fleet', desc: '+1 move range', grants: { moveRange: 1 } },
      { id: 'w_rush', tier: 2, requires: 'w_fleet', name: 'Bloodrush', desc: 'A normal move that kills costs no turn', grants: { freeKillMove: true } },
      { id: 'w_reflect', tier: 3, requires: 'w_rush', name: 'Reflection', desc: 'Reflect missiles and spells back at the attacker', grants: { reflect: true } },
      // Warband chain
      { id: 'w_bishop', tier: 1, name: 'Crusader', desc: 'Gain a bishop card', grants: { gainCard: 'bishop' } },
      { id: 'w_rook', tier: 2, requires: 'w_bishop', name: 'Warhammer', desc: 'Gain a rook card', grants: { gainCard: 'rook' } },
      { id: 'w_undying', tier: 3, requires: 'w_rook', name: 'Undying', desc: 'Revive once per floor at your start', grants: { extraLife: true } },
    ],
  },
  ranger: {
    name: 'Ranger',
    blurb: 'A hunter who fells foes from across the room.',
    color: '#65a30d',
    category: 'ranged', // every Ranger card fires from afar (blocked by cover)
    start: 'knight',
    hp: 5,
    perks: [
      // Vigor chain
      { id: 'r_hp1', tier: 1, name: 'Hardy', desc: '+1 max HP', grants: { maxHp: 1 } },
      { id: 'r_hp2', tier: 2, requires: 'r_hp1', name: 'Toughness', desc: '+2 max HP', grants: { maxHp: 2 } },
      { id: 'r_bulwark', tier: 3, requires: 'r_hp2', name: 'Bulwark', desc: 'The first hit each turn is negated', grants: { firstHitEachTurn: true } },
      // Marksman chain
      { id: 'r_reach', tier: 1, name: 'Farsight', desc: '+1 card reach', grants: { cardReach: 1 } },
      { id: 'r_rapid', tier: 2, requires: 'r_reach', name: 'Quick Draw', desc: 'A ranged-card kill lets you fire again at once (once)', grants: { rangedRapid: true } },
      { id: 'r_eagle', tier: 3, requires: 'r_rapid', name: 'Eagle Eye', desc: 'Fresh floors reveal fully the moment you arrive', grants: { revealFloor: true } },
      // Scouting chain
      { id: 'r_eyes1', tier: 1, name: 'Keen Eyes', desc: '+1 sight radius', grants: { vision: 2 } },
      { id: 'r_eyes2', tier: 2, requires: 'r_eyes1', name: 'Hawk Eyes', desc: '+1 sight radius', grants: { vision: 2 } },
      { id: 'r_stealth', tier: 3, requires: 'r_eyes2', name: 'Silent', desc: 'Unaware foes do not notice you unless adjacent (or you attack)', grants: { stealth: true } },
      // Ranging chain
      { id: 'r_bow', tier: 1, name: 'Shortbow', desc: 'Gain a bishop card', grants: { gainCard: 'bishop' } },
      { id: 'r_longbow', tier: 2, requires: 'r_bow', name: 'Longbow', desc: 'Gain a rook card', grants: { gainCard: 'rook' } },
      { id: 'r_fleet', tier: 3, requires: 'r_longbow', name: 'Fleet', desc: '+1 move range', grants: { moveRange: 1 } },
    ],
  },
  sorcerer: {
    name: 'Sorcerer',
    blurb: 'A fragile caster whose bolts pierce straight through the ranks.',
    color: '#a855f7',
    category: 'spell', // every Sorcerer card is a bolt that pierces the whole path
    start: 'rook',
    hp: 4,
    perks: [
      // Vigor chain
      { id: 's_hp1', tier: 1, name: 'Hardy', desc: '+1 max HP', grants: { maxHp: 1 } },
      { id: 's_hp2', tier: 2, requires: 's_hp1', name: 'Toughness', desc: '+2 max HP', grants: { maxHp: 2 } },
      { id: 's_reflect', tier: 3, requires: 's_hp2', name: 'Reflection', desc: 'Reflect missiles and spells back at the attacker', grants: { reflect: true } },
      // Arcana chain
      { id: 's_reach', tier: 1, name: 'Farsight', desc: '+1 card reach', grants: { cardReach: 1 } },
      { id: 's_haste', tier: 2, requires: 's_reach', name: 'Attunement', desc: 'Spell cards recharge twice as fast with no enemy in sight', grants: { spellHaste: true } },
      { id: 's_free', tier: 3, requires: 's_haste', name: 'Free Casting', desc: 'Spell cards cost no turn to cast', grants: { freeSpell: true } },
      // Mysticism chain
      { id: 's_eyes', tier: 1, name: 'Keen Eyes', desc: '+1 sight radius', grants: { vision: 2 } },
      { id: 's_dazzle', tier: 2, requires: 's_eyes', name: 'Dazzle', desc: 'Enemies beside those a spell slays are caught by surprise', grants: { spellDazzle: true } },
      { id: 's_cata', tier: 3, requires: 's_dazzle', name: 'Cataclysm', desc: 'Every visible enemy is surprised when you cast a spell', grants: { spellSurprise: true } },
      // Evocation chain
      { id: 's_wand', tier: 1, name: 'Wand', desc: 'Gain a bishop card', grants: { gainCard: 'bishop' } },
      { id: 's_staff', tier: 2, requires: 's_wand', name: 'Archstaff', desc: 'Gain a queen card', grants: { gainCard: 'queen' } },
      { id: 's_amp', tier: 3, requires: 's_staff', name: 'Amplify', desc: '+1 card reach', grants: { cardReach: 1 } },
    ],
  },
};
const LEVEL_PERK_CHOICES = 2; // perks offered per descent

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
const SAVE_KEY = 'chess-roguelike-save-v2';

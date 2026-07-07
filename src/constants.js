// Shared configuration. Loaded first; every other script reads from these.

const WORLD_SIZE = 28; // The full board is WORLD_SIZE x WORLD_SIZE tiles (walled border).
const STARTING_VISION = 7; // The king starts seeing a 7x7 window (odd, so centered).
const VISION_STEP = 2; // Each +1 sight perk widens the window by 2 (7 -> 9 -> 11...).
const PLAYER_START = { x: 14, y: 14 };
const STARTING_HP = 5;
const MAX_TURNS_SCARY = 100; // Lingering this many turns on a floor maxes spawn rate / dread.
const SPATTER_LIFE = 5; // Turns a blood spatter lingers before fading away.
const PURSUIT_TTL = 6; // Turns an enemy hunts toward the king's last-seen tile before losing the trail.
const MAX_ENEMIES = 70; // Hard safety cap so over-time spawning can't run away.
const TRAP_SPAWN_COUNT = 3; // Foes conjured when a trap enters the king's sight.

// Consumables: just two potions now, held in the satchel and used on demand. They
// found on the floor (dropped on the ground) and quaffed the instant the king steps
// onto one — but ONLY if it would help right now; otherwise it's left where it lies
// (and remembered through the fog) for when it's needed.
const CONSUMABLES = {
  health: { name: 'Potion of Healing', desc: 'Restores all HP.', glyph: '♥', color: '#f472b6' },
  mana: { name: 'Potion of Mending', desc: 'Recharges every card.', glyph: '✦', color: '#60a5fa' },
};
const POTION_KINDS = ['health', 'mana'];

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
  { name: 'The Whispering Crypt', recipe: { wall: 7 }, statues: 6, boss: { name: 'the Lich', kind: 'archbishop', hp: 5 } },
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
  { x: 22, y: 22 },
  { x: 5, y: 5 },
  { x: 22, y: 5 },
  { x: 5, y: 22 },
  { x: 22, y: 14 },
  { x: 5, y: 14 },
  { x: 14, y: 22 },
  { x: 14, y: 5 },
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

// Three classes, one per card category. Each starts with a single card and, on
// every descent, chooses ONE of three offered perks from its pool. Perks are
// roughly equal in value: simple stat bumps (repeatable), extra cards, and
// rule-changing boons. `repeatable` perks can be offered/taken more than once.
const CLASSES = {
  warrior: {
    name: 'Warrior',
    blurb: 'A frontline fighter who wades in and trades blows.',
    color: '#dc2626',
    category: 'melee', // every Warrior card strikes by moving onto the target
    start: 'king',
    perks: [
      { id: 'w_hp', name: 'Toughness', desc: '+2 max HP', grants: { maxHp: 2 }, repeatable: true },
      { id: 'w_reach', name: 'Long Arms', desc: '+1 card reach', grants: { cardReach: 1 } },
      { id: 'w_fleet', name: 'Fleet', desc: '+1 move range', grants: { moveRange: 1 } },
      { id: 'w_bulwark', name: 'Bulwark', desc: 'The first hit each turn is negated', grants: { firstHitEachTurn: true } },
      { id: 'w_reflect', name: 'Reflection', desc: 'Reflect missiles and spells back at the attacker', grants: { reflect: true } },
      { id: 'w_cleave', name: 'Cleave', desc: 'A melee-card kill also slays one adjacent enemy', grants: { meleeCleave: true } },
      { id: 'w_leech', name: 'Vampiric Edge', desc: 'A melee-card kill heals 1 HP', grants: { meleeLeech: true } },
      { id: 'w_rush', name: 'Bloodrush', desc: 'A normal move that kills costs no turn', grants: { freeKillMove: true } },
      { id: 'w_undying', name: 'Undying', desc: 'Revive once per floor at your start', grants: { extraLife: true } },
      { id: 'w_knight', name: 'Cavalier', desc: 'Gain a knight card', grants: { gainCard: 'knight' } },
      { id: 'w_rook', name: 'Warhammer', desc: 'Gain a rook card', grants: { gainCard: 'rook' } },
    ],
  },
  ranger: {
    name: 'Ranger',
    blurb: 'A hunter who fells foes from across the room.',
    color: '#65a30d',
    category: 'ranged', // every Ranger card fires from afar (blocked by cover)
    start: 'knight',
    perks: [
      { id: 'r_hp', name: 'Toughness', desc: '+2 max HP', grants: { maxHp: 2 }, repeatable: true },
      { id: 'r_eyes', name: 'Keen Eyes', desc: '+1 sight radius', grants: { vision: 2 }, repeatable: true },
      { id: 'r_reach', name: 'Farsight', desc: '+1 card reach', grants: { cardReach: 1 } },
      { id: 'r_fleet', name: 'Fleet', desc: '+1 move range', grants: { moveRange: 1 } },
      { id: 'r_rapid', name: 'Quick Draw', desc: 'A ranged-card kill lets you fire again at once (once)', grants: { rangedRapid: true } },
      { id: 'r_path', name: 'Pathfinder', desc: 'Immune to slow terrain (water)', grants: { terrainImmune: true } },
      { id: 'r_stealth', name: 'Silent', desc: 'Unaware foes do not notice you unless adjacent (or you attack)', grants: { stealth: true } },
      { id: 'r_eagle', name: 'Eagle Eye', desc: 'Fresh floors reveal fully the moment you arrive', grants: { revealFloor: true } },
      { id: 'r_bow', name: 'Shortbow', desc: 'Gain a bishop card', grants: { gainCard: 'bishop' } },
      { id: 'r_longbow', name: 'Longbow', desc: 'Gain a rook card', grants: { gainCard: 'rook' } },
    ],
  },
  sorcerer: {
    name: 'Sorcerer',
    blurb: 'A caster whose bolts pierce straight through the ranks.',
    color: '#a855f7',
    category: 'spell', // every Sorcerer card is a bolt that pierces the whole path
    start: 'rook',
    perks: [
      { id: 's_hp', name: 'Toughness', desc: '+2 max HP', grants: { maxHp: 2 }, repeatable: true },
      { id: 's_eyes', name: 'Keen Eyes', desc: '+1 sight radius', grants: { vision: 2 }, repeatable: true },
      { id: 's_reach', name: 'Farsight', desc: '+1 card reach', grants: { cardReach: 1 } },
      { id: 's_haste', name: 'Attunement', desc: 'Spell cards recharge twice as fast with no enemy in sight', grants: { spellHaste: true } },
      { id: 's_free', name: 'Free Casting', desc: 'Spell cards cost no turn to cast', grants: { freeSpell: true } },
      { id: 's_dazzle', name: 'Dazzle', desc: 'Enemies beside those a spell slays are caught by surprise', grants: { spellDazzle: true } },
      { id: 's_cata', name: 'Cataclysm', desc: 'Every visible enemy is surprised when you cast a spell', grants: { spellSurprise: true } },
      { id: 's_reflect', name: 'Reflection', desc: 'Reflect missiles and spells back at the attacker', grants: { reflect: true } },
      { id: 's_wand', name: 'Wand', desc: 'Gain a bishop card', grants: { gainCard: 'bishop' } },
      { id: 's_staff', name: 'Archstaff', desc: 'Gain a queen card', grants: { gainCard: 'queen' } },
    ],
  },
};
const LEVEL_PERK_CHOICES = 3; // perks offered per descent

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

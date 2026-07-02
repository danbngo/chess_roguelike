// Shared configuration. Loaded first; every other script reads from these.

const WORLD_SIZE = 20; // The full board is WORLD_SIZE x WORLD_SIZE tiles.
const STARTING_VISION = 5; // The king starts seeing a 5x5 window (odd, so centered).
const VISION_STEP = 2; // Each Keen Eyes upgrade widens the window by 2 (5 -> 7 -> 9...).
const PLAYER_START = { x: 8, y: 8 };
const STARTING_HP = 3;
const STARTING_REGEN = 1; // (Descending now fully heals; kept for legacy saves.)
const STARTING_CARD_SLOTS = 2; // Weapon slots every class begins with.
const MAX_TURNS_SCARY = 100; // Lingering this many turns on a floor maxes spawn rate / dread.
const SPATTER_LIFE = 5; // Turns a blood spatter lingers before fading away.
const BARKSKIN_TURNS = 3; // Turns the Barkskin potion keeps the king invincible.
const INVIS_TURNS = 5; // Turns the Invisibility potion hides the king.
const FOG_DISSIPATE = 0.33; // Per-turn chance each fog cloud clears.

// Consumables are bought at the apothecary and used from the satchel. `blink` and
// `digging` need a target tile (handled by the UI); the rest apply at once.
const CONSUMABLES = {
  health: { name: 'Potion of Healing', desc: 'Restores all HP.', cost: 4, glyph: '♥', color: '#f472b6' },
  mana: { name: 'Potion of Mending', desc: 'Recharges every card.', cost: 5, glyph: '✦', color: '#60a5fa' },
  barkskin: { name: 'Potion of Barkskin', desc: `Invincible for ${BARKSKIN_TURNS} turns.`, cost: 7, glyph: '◈', color: '#a3e635' },
  fog: { name: 'Fog Scroll', desc: 'Cloaks your sight in fog clouds that block line of sight.', cost: 5, glyph: '☁', color: '#cbd5e1' },
  invis: { name: 'Potion of Invisibility', desc: `Enemies lose track of you for ${INVIS_TURNS} turns.`, cost: 8, glyph: '◍', color: '#818cf8' },
  teleport: { name: 'Teleport Scroll', desc: 'Whisk to a random tile on the floor.', cost: 6, glyph: '⇢', color: '#f0abfc' },
  blink: { name: 'Blink Scroll', desc: 'Step to any tile you can see.', cost: 6, glyph: '✧', color: '#38bdf8', targeted: true },
  digging: { name: 'Scroll of Digging', desc: 'Clears a whole line of terrain to open ground.', cost: 5, glyph: '⛏', color: '#d6a24a', targeted: true },
  summoning: { name: 'Scroll of Summoning', desc: 'Summon a random ally from foes you have seen.', cost: 7, glyph: '☥', color: '#34d399' },
};
const CONSUMABLE_SHOP_CHOICES = 3; // Potions offered per consumable shop.
const STARTING_CONSUMABLE_SLOTS = 3; // How many potions the king can carry.
const POTION_KINDS = ['health', 'mana', 'barkskin', 'invis']; // Alchemist starting kit
const SCROLL_KINDS = ['fog', 'teleport', 'blink', 'digging', 'summoning']; // Sorcerer starting kit
const MAX_ALLIES = 2; // Cap on summoned allies (necromancer reanimation, etc.).

// Speed-based floor reward: gold you claim by descending, decaying ~1% of its
// base each turn you linger (hits zero around MAX_TURNS_SCARY turns).
const FLOOR_GOLD_BASE = 30; // plus a per-floor bonus (see floorGoldReward)

// Minimum floor each enemy role may first appear on — roles ramp in gradually.
const ROLE_MIN_FLOOR = {
  statue: 2,
  skirmisher: 3,
  armored: 4,
  mounted: 4,
  flying: 5,
  mage: 5,
  summoner: 6,
  boss: 2, // ordinary (non-final) bosses start guarding exits from floor 2
};

// Terrain is introduced gradually across the run: floor 1 is empty ground, and
// each listed floor unlocks a new hazard type that grows denser on deeper floors
// (so the final floor is crowded). The first sighting of each type pops a tip.
const TERRAIN_UNLOCK = { wall: 2, trees: 2, water: 2, brush: 3, mud: 3, ice: 4, lava: 5 };

const FINAL_FLOOR = 10; // A ten-floor run: floors 1-5 standard pieces, 6-10 add fairies. Amazon boss + victory on 10 (and 20, 30…).
const MAX_ENEMIES = 40; // Hard safety cap so over-time spawning can't run away.

// Named themes per floor, shown in the HUD. Beyond the tenth floor (New Game +)
// the cycle repeats.
const FLOOR_NAMES = [
  'The Threshold',
  'Mossy Halls',
  'The Sunken Ward',
  'Frostbitten Vault',
  'The Ember Deep',
  'Whispering Catacombs',
  'The Shifting Maze',
  'Hall of Mirrors',
  'The Obsidian Reach',
  'Throne of the Amazon',
];

function floorName(floor) {
  const level = levelForFloor(floor);
  const base = level ? level.name : FLOOR_NAMES[(floor - 1) % FLOOR_NAMES.length];
  const cycle = Math.floor((floor - 1) / FINAL_FLOOR);
  return cycle > 0 ? `${base} +${cycle}` : base;
}

// The ten authored levels. Each floor of a run (cycling every FINAL_FLOOR) is one
// of these: a theme (which drives the terrain recipe and authored features), and a
// UNIQUE boss with a multi-phase form sequence, borrowed traits, a signature
// ability, and a sleeping cohort that guards its chamber. Terrain `recipe` counts
// are "blob/segment" seeds fed to the themed generator; the boss chamber, exit,
// and cohort are authored (not random), while wanderers/shops/altars still scatter.
//   phases  - the sequence of piece-kinds the boss becomes as it is struck down
//             (a two/three-headed guardian: the fight ends only on the last).
//   traits  - role flags stamped on every phase (armored / mounted / mage /
//             skirmisher / flying).
//   special - the boss's signature behaviour (see bossSpecialTurn / boss death).
//   damage  - HP a successful boss hit costs (default 1).
//   feature - an authored terrain flourish carved near the chamber.
const LEVELS = [
  {
    theme: 'battlefield', name: 'The Battlefield',
    recipe: { wall: 3, brush: 2 }, feature: 'redoubt',
    boss: { name: 'the Warlord', phases: ['king', 'king'], traits: [], special: 'rally', damage: 1 },
    cohort: ['pawn', 'pawn', 'knight', 'knight'],
  },
  {
    theme: 'forest', name: 'The Old Forest',
    recipe: { trees: 5, brush: 3, water: 1 }, feature: 'grove',
    boss: { name: 'the Centaur', phases: ['knight', 'king'], traits: ['skirmisher'], special: 'trueshot', damage: 1 },
    cohort: ['pawn', 'knight', 'bishop', 'pawn'],
  },
  {
    theme: 'tundra', name: 'The Frozen Tundra',
    recipe: { ice: 5, water: 2, wall: 1 }, feature: 'floes',
    boss: { name: 'the Yeti', phases: ['bishop', 'king'], traits: ['mounted'], special: 'frostwake', damage: 1 },
    cohort: ['pawn', 'bishop', 'knight', 'bishop'],
  },
  {
    theme: 'ruins', name: 'The Sunken Ruins',
    recipe: { wall: 6, brush: 2, water: 2 }, feature: 'rooms',
    boss: { name: 'the Iron Giant', phases: ['rook', 'king'], traits: ['armored'], special: 'siege', damage: 1 },
    cohort: ['rook', 'knight', 'pawn', 'bishop'],
  },
  {
    theme: 'lake', name: 'The Drowned Lake',
    recipe: { water: 8, brush: 2 }, feature: 'island',
    boss: { name: 'the Hydra', phases: ['queen', 'king'], traits: ['flying'], special: 'aquatic', damage: 1, respawnMelee: true },
    cohort: ['bishop', 'rook', 'knight', 'bishop'],
  },
  {
    theme: 'crypt', name: 'The Whispering Crypt',
    recipe: { wall: 6, brush: 2 }, feature: 'sanctum',
    boss: { name: 'the Lich', phases: ['king', 'king', 'king'], traits: [], special: 'necromancy', damage: 1, respawnDeath: true },
    cohort: ['berolina', 'berolina', 'archbishop', 'berolina'],
  },
  {
    theme: 'maze', name: 'The Hedge Maze',
    recipe: { trees: 8, brush: 4 }, feature: 'maze',
    boss: { name: 'the Minotaur', phases: ['knight', 'king', 'king'], traits: ['mounted'], special: 'gore', damage: 3 },
    cohort: ['berolina', 'archbishop', 'berolina', 'archbishop'],
  },
  {
    theme: 'demon-forest', name: 'The Demon Wood',
    recipe: { trees: 6, lava: 3, brush: 3 }, feature: 'grove',
    boss: { name: 'the Medusa', phases: ['bishop', 'king', 'king'], traits: ['mage'], special: 'gaze', damage: 1 },
    cohort: ['archbishop', 'chancellor', 'berolina', 'archbishop'],
  },
  {
    theme: 'lava', name: 'The Lake of Fire',
    recipe: { lava: 8, wall: 2 }, feature: 'island',
    boss: { name: 'the Bone Dragon', phases: ['rook', 'king', 'king'], traits: [], special: 'bonehide', damage: 1, meleeOnly: true },
    cohort: ['chancellor', 'archbishop', 'chancellor', 'berolina'],
  },
  {
    theme: 'castle', name: 'The Demon Castle',
    recipe: { wall: 8, lava: 3 }, feature: 'throne',
    boss: { name: 'the Balrog', phases: ['queen', 'king', 'king'], traits: [], special: 'inferno', damage: 1 },
    cohort: ['amazon', 'chancellor', 'archbishop', 'chancellor'],
  },
];

// The authored level for a floor (cycling every FINAL_FLOOR for New Game +).
function levelForFloor(floor) {
  return LEVELS[((floor - 1) % FINAL_FLOOR + FINAL_FLOOR) % FINAL_FLOOR] || null;
}

// Fixed exit / boss-chamber anchors, one per authored floor (never random). Kept
// clear of the king's central start and spread around the board's edges.
const CHAMBER_ANCHORS = [
  { x: 16, y: 16 },
  { x: 3, y: 3 },
  { x: 16, y: 3 },
  { x: 3, y: 16 },
  { x: 16, y: 10 },
  { x: 3, y: 10 },
  { x: 10, y: 16 },
  { x: 10, y: 3 },
  { x: 16, y: 8 },
  { x: 4, y: 12 },
];
function chamberAnchorForFloor(floor) {
  return CHAMBER_ANCHORS[((floor - 1) % FINAL_FLOOR + FINAL_FLOOR) % FINAL_FLOOR];
}

// The run splits at floor 5: floors 1-4 are the mortal dungeon (standard pieces),
// then the king steps through a portal to the DEMON REALM (floor 5+), where only
// fairy/demonic pieces spawn — the standard pieces no longer appear (though they
// can still be summoned). The amazon exists only as the final boss.
const DEMON_FLOOR = 5; // First floor of the demon realm.
const STANDARD_KINDS = ['pawn', 'king', 'knight', 'bishop', 'rook', 'queen'];
const DEMON_KINDS = ['berolina', 'archbishop', 'chancellor', 'amazon'];
const ENEMY_UNLOCKS = [
  // Mortal dungeon (floors 1-4).
  { kind: 'pawn', floor: 1 },
  { kind: 'king', floor: 1 },
  { kind: 'knight', floor: 2 },
  { kind: 'bishop', floor: 3 },
  { kind: 'rook', floor: 4 },
  { kind: 'queen', floor: 4 },
  // Demon realm (floor 5+).
  { kind: 'berolina', floor: 5 },
  { kind: 'archbishop', floor: 7 },
  { kind: 'chancellor', floor: 8 },
  { kind: 'amazon', floor: 9 }, // the amazon prowls the deepest floors again
];

const SHOP_CHOICES = 3; // Cards a weapon shop offers.

// Classes. The king CHOOSES a class at the start (gaining its level-1 perk and a
// starting weapon), then spends EXP at class altars to buy further perks — each
// class's three perks cost 1, 2, then 3 exp. He earns 1 exp per floor descended,
// and may spread exp across classes. His king token is tinted by his top class.
const CLASS_ALTAR_CHOICES = 3;
const CLASSES = {
  valkyrie: {
    name: 'Valkyrie',
    blurb: 'A shieldmaiden who turns aside blade, bolt, and spell.',
    color: '#e0b341',
    weapon: { kind: 'king', traits: ['parry'] },
    perks: [
      { id: 'val1', name: 'Aegis', desc: '+3 max HP', grants: { maxHp: 3 } },
      { id: 'val2', name: 'Ward', desc: 'The first hit each turn is negated', grants: { firstHitEachTurn: true } },
      { id: 'val3', name: 'Reflection', desc: 'Reflect missiles and spells back at the attacker', grants: { reflect: true } },
    ],
  },
  barbarian: {
    name: 'Barbarian',
    blurb: 'A whirlwind of blades that never stops swinging.',
    color: '#dc2626',
    weapon: { kind: 'king', traits: ['cleave'] },
    perks: [
      { id: 'bar1', name: 'Arsenal', desc: '+1 weapon slot', grants: { maxCards: 1 } },
      { id: 'bar2', name: 'Frenzy', desc: 'Each kill shaves 1 turn off a random weapon cooldown', grants: { frenzy: true } },
      { id: 'bar3', name: 'Bloodrush', desc: 'A normal move that kills does not cost a turn', grants: { freeKillMove: true } },
    ],
  },
  ranger: {
    name: 'Ranger',
    blurb: 'A hunter at home in every wild, whose shot fells anything.',
    color: '#65a30d',
    weapon: { kind: 'knight', traits: ['shoot'] },
    perks: [
      { id: 'ran1', name: 'Keen Eyes', desc: '+1 sight radius', grants: { vision: 2 } },
      { id: 'ran2', name: 'Pathfinder', desc: 'Immune to terrain effects (except lava & walls)', grants: { terrainImmune: true } },
      { id: 'ran3', name: 'Deadshot', desc: 'Kill any unit in one hit, ignoring its defenses (even bosses)', grants: { ignoreDefenses: true } },
    ],
  },
  ninja: {
    name: 'Ninja',
    blurb: 'A shadow that slips past sentries unseen.',
    color: '#4b5563',
    weapon: { kind: 'king', traits: ['quick'] },
    perks: [
      { id: 'nin1', name: 'Fleet', desc: '+1 move range', grants: { moveRange: 1 } },
      { id: 'nin2', name: 'Shadow', desc: 'Statues and turrets ignore you', grants: { stealthStructures: true } },
      { id: 'nin3', name: 'Silent', desc: 'Unaware foes do not notice you unless adjacent (or you attack)', grants: { stealth: true } },
    ],
  },
  sorcerer: {
    name: 'Sorcerer',
    blurb: 'A caster who opens with a satchel of scrolls.',
    color: '#a855f7',
    weapon: null, // starts with random scrolls instead of a weapon
    startKit: 'scrolls',
    perks: [
      { id: 'sor1', name: 'Overload', desc: 'A weapon kill surprises adjacent enemies', grants: { weaponKillSurprise: true } },
      { id: 'sor2', name: 'Piercing', desc: 'Weapons can target through units', grants: { pierceTargeting: true } },
      { id: 'sor3', name: 'Ruin', desc: 'Weapons also slay enemies en route to the target', grants: { pierceDamage: true } },
    ],
  },
  necromancer: {
    name: 'Necromancer',
    blurb: 'A death-speaker who bends the slain to his will.',
    color: '#0ea5e9',
    weapon: { kind: 'king', traits: ['leech'] },
    perks: [
      { id: 'nec1', name: 'Familiar', desc: 'A demon familiar (berolina ally) that respawns each descent', grants: { familiar: true } },
      { id: 'nec2', name: 'Reanimate', desc: `A slain foe rises as your ally (up to ${MAX_ALLIES})`, grants: { reanimate: true } },
      { id: 'nec3', name: 'Undying', desc: 'One extra life per floor (respawn at your start)', grants: { extraLife: true } },
    ],
  },
  alchemist: {
    name: 'Alchemist',
    blurb: 'A brewer who turns a satchel of potions into an arsenal.',
    color: '#10b981',
    weapon: null, // starts with random potions instead of a weapon
    startKit: 'potions',
    perks: [
      { id: 'alc1', name: 'Satchel', desc: '+2 consumable slots', grants: { maxConsumables: 2 } },
      { id: 'alc2', name: 'Quick Draw', desc: 'Consumables cost no turn to use', grants: { freePotion: true } },
      { id: 'alc3', name: 'Transmute', desc: 'Killed enemies grant 1 gold', grants: { goldOnKill: true } },
    ],
  },
};
const CLASS_PERK_COST = [1, 2, 3]; // exp cost of the 1st / 2nd / 3rd perk in a ladder

// A weapon card lets the king attack once by moving like the given unit ONTO an
// enemy (cards can only be used to strike, never to reposition). Its gold cost is
// the piece's chess value, raised for each weapon trait it bears. Cards share a
// fixed cooldown; the king card recharges a touch faster.
const CARD_POINTS = {
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

function isCardKind(kind) {
  return Object.prototype.hasOwnProperty.call(CARD_POINTS, kind);
}

function cardCooldown(kind) {
  if (kind === 'king') return 2;
  return CARD_COOLDOWN;
}

// Cost rises with the number of traits (each trait adds the base value again).
function cardCost(kind, traitCount) {
  return CARD_POINTS[kind] * (1 + (traitCount || 0));
}

// Weapon traits, each triggering when the card scores a kill (except Quick, which
// acts on use). A card can carry several traits, but extra traits are increasingly
// rare (see rollCardTraits).
const TRAIT_INFO = {
  parry: { name: 'Parry', desc: 'Take no damage on the enemy turn after a kill with this card.' },
  cleave: { name: 'Cleave', desc: 'On a kill, also slay up to 1 adjacent enemy.' },
  shoot: { name: 'Shoot', desc: 'On a kill, snap back to your starting tile.' },
  quick: { name: 'Quick', desc: 'Using this card costs no turn.' },
  leech: { name: 'Leech', desc: 'Gain 1 HP when this card kills an enemy.' },
};
const CARD_TRAITS = Object.keys(TRAIT_INFO);
const MAX_TRAIT_CHANCE = 0.5; // Highest chance (reached on the final floor) a card bears a first trait.

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

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
  health: { name: 'Potion of Healing', desc: 'Restores all HP.', cost: 4, weight: 5, glyph: '♥', color: '#f472b6' },
  mana: { name: 'Potion of Mending', desc: 'Recharges every card.', cost: 5, weight: 3, glyph: '✦', color: '#60a5fa' },
  barkskin: { name: 'Potion of Barkskin', desc: `Invincible for ${BARKSKIN_TURNS} turns.`, cost: 7, weight: 2, glyph: '◈', color: '#a3e635' },
};
const CONSUMABLE_SHOP_CHOICES = 3; // Potions offered per consumable shop.
const STARTING_CONSUMABLE_SLOTS = 3; // How many potions the king can carry.

// Speed-based floor reward: gold you claim by descending, decaying ~1% of its
// base each turn you linger (hits zero around MAX_TURNS_SCARY turns).
const FLOOR_GOLD_BASE = 30; // plus a per-floor bonus (see floorGoldReward)

// Minimum floor each enemy role may first appear on — roles ramp in gradually.
const ROLE_MIN_FLOOR = {
  statue: 2,
  skirmisher: 3,
  armored: 4,
  mage: 5,
  summoner: 6,
  boss: 2, // ordinary (non-final) bosses start guarding exits from floor 2
};

// Terrain is introduced gradually across the run: floor 1 is empty ground, and
// each listed floor unlocks a new hazard type that grows denser on deeper floors
// (so the final floor is crowded). The first sighting of each type pops a tip.
const TERRAIN_UNLOCK = { wall: 2, mud: 3, ice: 4, water: 5 };

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
  const base = FLOOR_NAMES[(floor - 1) % FLOOR_NAMES.length];
  const cycle = Math.floor((floor - 1) / FLOOR_NAMES.length);
  return cycle > 0 ? `${base} +${cycle}` : base;
}

// Enemy variety ramps with depth. A floor's spawn pool is every kind unlocked at
// or before it, each chosen with equal probability. Floors 1-5 hold the standard
// pieces; the fairy pieces mix in over floors 6-10. The amazon is intentionally
// absent — she exists ONLY as the final boss.
const ENEMY_UNLOCKS = [
  { kind: 'pawn', floor: 1 },
  { kind: 'king', floor: 1 }, // a common, weak enemy — moves one tile, worth capturing
  { kind: 'knight', floor: 2 },
  { kind: 'bishop', floor: 3 },
  { kind: 'rook', floor: 4 },
  { kind: 'queen', floor: 5 }, // full standard set in hand by the halfway mark
  { kind: 'berolina', floor: 6 }, // fairies mix in over the back half
  { kind: 'archbishop', floor: 8 },
  { kind: 'chancellor', floor: 10 },
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
// Perks are rule-changers that lean into a fantasy and interact with the run's
// other systems (cards, gold, consumables, defense). None is a plain +stat, and
// none duplicates a weapon or armor trait.
const CLASSES = {
  warrior: {
    name: 'Warrior',
    blurb: 'Weathers blows others could not.',
    perks: [
      { id: 'war1', name: 'Bulwark', desc: 'The first hit each floor is negated', grants: { firstHitShield: true } },
      { id: 'war2', name: 'Retaliation', desc: 'After a hit lands, you take no more damage this enemy phase', grants: { retaliate: true } },
      { id: 'war3', name: 'Second Wind', desc: `Descending grants ${BARKSKIN_TURNS} turns of Barkskin`, grants: { wardOnDescend: true } },
    ],
  },
  barbarian: {
    name: 'Barbarian',
    blurb: 'Feeds on the frenzy of the kill.',
    perks: [
      { id: 'bar1', name: 'Pillage', desc: 'Captures pay gold equal to the piece’s value', grants: { pillage: true } },
      { id: 'bar2', name: 'Frenzy', desc: 'Each capture shaves 1 turn off every card cooldown', grants: { frenzy: true } },
      { id: 'bar3', name: 'Bloodlust', desc: 'Capturing below half HP heals 1', grants: { bloodlust: true } },
    ],
  },
  ranger: {
    name: 'Ranger',
    blurb: 'Carries a fuller quiver, and a longer reach.',
    perks: [
      { id: 'ran1', name: 'Quiver', desc: '+1 weapon card slot', grants: { maxCards: 1 } },
      { id: 'ran2', name: 'Far Shot', desc: 'Weapon cards reach 1 tile farther', grants: { cardRangeBonus: 1 } },
      { id: 'ran3', name: 'Twin Quiver', desc: '+1 weapon card slot', grants: { maxCards: 1 } },
    ],
  },
  mage: {
    name: 'Mage',
    blurb: 'Keeps the arcane close at hand.',
    perks: [
      { id: 'mag1', name: 'Channeling', desc: 'Weapon cards recharge 1 turn faster', grants: { cooldownReduction: 1 } },
      { id: 'mag2', name: 'Arcane Recovery', desc: 'Descending refreshes every card', grants: { descendRefresh: true } },
      { id: 'mag3', name: 'Focus', desc: 'Weapon cards recharge 1 more turn faster', grants: { cooldownReduction: 1 } },
    ],
  },
  witch: {
    name: 'Witch',
    blurb: 'Slips blows and cloaks herself in kills.',
    perks: [
      { id: 'wit1', name: 'Glamour', desc: '20% chance to evade a hit', grants: { evade: 0.2 } },
      { id: 'wit2', name: 'Shadowstep', desc: 'After a capture, take no damage next enemy phase', grants: { wardOnKill: true } },
      { id: 'wit3', name: 'Veil', desc: '20% more chance to evade a hit', grants: { evade: 0.2 } },
    ],
  },
  alchemist: {
    name: 'Alchemist',
    blurb: 'Turns a satchel of potions into an arsenal.',
    perks: [
      { id: 'alc1', name: 'Bandolier', desc: '+2 potion slots', grants: { maxConsumables: 2 } },
      { id: 'alc2', name: 'Quick Draw', desc: 'Drinking a potion no longer costs a turn', grants: { freePotion: true } },
      { id: 'alc3', name: 'Potent Brews', desc: 'Potions are empowered (healing also wards, mending also heals…)', grants: { potionPotency: true } },
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

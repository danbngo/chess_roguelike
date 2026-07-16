// Shared configuration. Loaded first; every other script reads from these.

const WORLD_SIZE = 20; // The full board is WORLD_SIZE x WORLD_SIZE tiles (walled border).
const STARTING_VISION = 7; // The king starts seeing a 7x7 window (odd, so centered).
const VISION_STEP = 2; // Each +1 sight perk widens the window by 2 (7 -> 9 -> 11...).
const PLAYER_START = { x: 10, y: 10 };
const STARTING_HP = 5; // Default; each class overrides it (see CLASSES[].hp).
const MAX_TURNS_SCARY = 200; // Lingering this many turns on a floor maxes the dread meter / tension music (a slow ramp).
const SPAWN_RAMP_TURNS = 200; // Turns over which the SPAWN rate ramps to its ceiling — 2x slower than the dread meter, so methodical play isn't punished as harshly.
const SPATTER_LIFE = 12; // Turns a blood spatter lingers before fading away.
const CORPSE_LIFE = 18; // Turns a corpse (or ash pile) lingers before fully fading.
const BOSS_CORPSE_LIFE = 40; // A slain boss leaves remains that linger far longer than a common corpse.
// Blood that clings to a PIECE from combat (0..1 intensity, rendered as specks on its
// token). Being struck stains it heavily; landing a blow stains it lightly. It dries
// (fades) fairly quickly — see the decay in passTurn.
const BLOOD_HIT = 0.7; // splashed on a unit that IS struck
const BLOOD_STRIKE = 0.28; // splashed on a unit that DEALS a blow
const BLOOD_DRY = 0.6; // per-turn survival factor (lower = dries faster)
const PURSUIT_TTL = 6; // Turns an enemy hunts toward the king's last-seen tile before losing the trail.
const MAX_ENEMIES = 45; // Hard safety cap so over-time spawning can't run away.

// --- Floors -----------------------------------------------------------------

const FINAL_FLOOR = 8; // An eight-floor run (an 8x8-board's worth) — floor 8 is the ABSOLUTE last.
const DEMON_FLOOR = 5; // From floor 5 the fairy/demon pieces take over the roster.
// The floor-8 finale: after the Orb of Victory is taken, a single lesser boss claws in near the
// king every so often (a random BOSS_RUSH_MIN..BOSS_RUSH_MAX turns), never more than
// BOSS_RUSH_CAP of them alive at once.
const BOSS_RUSH_MIN = 10;
const BOSS_RUSH_MAX = 20;
const BOSS_RUSH_CAP = 1;
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
const CARD_KINDS = ['pawn', 'king', 'knight', 'bishop', 'rook', 'archbishop', 'chancellor', 'queen', 'amazon', 'enpassant', 'doublestep', 'promotion', 'reload', 'swap', 'horse'];
const CARD_COOLDOWN = 3;
const PROMOTION_TURNS = 3; // how many turns the Ranger's Promotion (amazon form) lasts
const TURRET_HP = 3; // turrets are destructible: a flat, non-scaling HP pool (< a boss's)

// Each floor guardian rolls ONE of these boss perks at creation, making every boss
// fight a little different. See createBoss / bossMove / damageBoss for the behaviour.
const BOSS_PERKS = ['summoner', 'blinker', 'brutal', 'ranged', 'sorcerer', 'knockback', 'shapeshifter', 'tough', 'leech', 'flying', 'phasing', 'regen'];
const BOSS_PERK_LABELS = {
  summoner: 'Summoner — conjures its own kind every third turn',
  blinker: 'Blinkborn — flickers away after each wound',
  brutal: 'Brutal — its blows land twice as hard',
  ranged: 'Volley — looses bolts down open lines instead of closing',
  sorcerer: 'Sorcerer — hurls piercing bolts through everything in their path',
  knockback: 'Bulwark — hammers the king backward with every blow',
  shapeshifter: 'Shifting — takes a new, lesser form after each wound',
  tough: 'Hardened — bears three extra wounds',
  leech: 'Leech — heals a wound each time it draws the king’s blood',
  flying: 'Winged — soars over pits, water, and lava unharmed',
  phasing: 'Phantom — sees and drifts through walls and boulders',
  regen: 'Regenerating — knits a wound shut every fourth turn',
};
// Ordered weakest→strongest; a Shifting boss never becomes a form ranked above its origin.
const PIECE_RANK = ['pawn', 'knight', 'bishop', 'rook', 'berolina', 'archbishop', 'chancellor', 'queen', 'amazon'];

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
  if (kind === 'doublestep') return 2 + (bonus || 0); // a fixed two-tile dash
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
    hp: 5,
    // Each subclass chain has its own colour; the class colour is the starter card's.
    chains: { Sentinel: '#3b82f6', Reaver: '#b91c1c', Cavalier: '#f59e0b', Duellist: '#ec4899' },
    perks: [
      // ⛨ Sentinel — the immovable bastion: pile on HP, then shrug off the first blow.
      { id: 'w_hp1', chain: 'Sentinel', tier: 1, name: 'Hardy', desc: '+1 max HP', grants: { maxHp: 1 } },
      { id: 'w_hp2', chain: 'Sentinel', tier: 2, requires: 'w_hp1', name: 'Ironhide', desc: '+2 max HP', grants: { maxHp: 2 } },
      { id: 'w_bulwark', chain: 'Sentinel', tier: 3, requires: 'w_hp2', name: 'Parry', desc: 'The first hit each turn is negated', grants: { firstHitEachTurn: true } },
      // ⚔ Reaver — the bloodletter: kills fuel more kills.
      { id: 'w_edge', chain: 'Reaver', tier: 1, name: 'Keen Edge', desc: "A card kill cuts that card's cooldown by 1", grants: { meleeRefund: true } },
      { id: 'w_cleave', chain: 'Reaver', tier: 2, requires: 'w_edge', name: 'Cleave', desc: 'When you fell a foe, one adjacent foe dies too', grants: { meleeCleave: true } },
      { id: 'w_leech', chain: 'Reaver', tier: 3, requires: 'w_cleave', name: 'Vampiric Edge', desc: 'Any turn you fell a foe, heal 1 HP', grants: { meleeLeech: true } },
      // 🐎 Cavalier — the charger: kill on the move, trample on landing.
      { id: 'w_fleet', chain: 'Cavalier', tier: 1, name: 'Double-Step', desc: 'Gain a double-step card: dash up to 2 tiles in any direction (capturing at the end), cooldown 3', grants: { gainCard: 'doublestep', gainCooldown: 3 } },
      { id: 'w_pierce', chain: 'Cavalier', tier: 2, requires: 'w_fleet', name: 'Pierce', desc: 'A kill by moving also strikes the foe directly behind it', grants: { meleePierce: true } },
      { id: 'w_trample', chain: 'Cavalier', tier: 3, requires: 'w_pierce', name: 'Trample', desc: 'Landing a knight leap HURLS every adjacent foe back a tile (slamming it into whatever’s behind — see Knockback), rather than striking it in place', grants: { leapShock: true } },
      // 🛡 Duellist — the flashy fencer: a signature dash, free-tempo kills, a dazzling flourish.
      { id: 'w_enpassant', chain: 'Duellist', tier: 1, name: 'En Passant', desc: 'Gain an en-passant card: step 1 tile (capturing there) AND strike one foe you pass (adjacent to your start)', grants: { gainCard: 'enpassant' } },
      { id: 'w_flourish', chain: 'Duellist', tier: 2, requires: 'w_enpassant', name: 'Flourish', desc: 'After a kill, foes beside you are caught off guard', grants: { meleeFlourish: true } },
      { id: 'w_rush', chain: 'Duellist', tier: 3, requires: 'w_flourish', name: 'Charge', desc: 'The FIRST move that kills each turn costs no turn (further kill-moves that turn cost a turn as usual)', grants: { freeKillMove: true } },
    ],
  },
  ranger: {
    name: 'Ranger',
    blurb: 'A hunter who fells foes from across the room.',
    color: '#65a30d',
    category: 'ranged', // every Ranger card fires from afar (blocked by cover)
    start: 'rook', // the Ranger opens with an orthogonal longbow
    startCooldown: 5, // the rook's own cooldown (cooldowns are per-UNIT, not per-class)
    hp: 5, // sturdier than a glass cannon — foes now close in, so a ranged hunter needs a buffer
    chains: { Druid: '#16a34a', Oracle: '#14b8a6', 'Gloom Stalker': '#6366f1', Marksman: '#a3e635' },
    perks: [
      // 🌲 Druid — the survivalist: master the terrain, then ride to war.
      { id: 'r_wade', chain: 'Druid', tier: 1, name: 'Fairy Wings', desc: 'You flit over water, lava, and pits — walking, carding, or leaping onto and across them freely, with no slow, no burn, and no falling', grants: { terrainImmune: true } },
      { id: 'r_xray', chain: 'Druid', tier: 2, requires: 'r_wade', name: 'Wild Empathy', desc: 'Beasts of the wild — enemy and mini-boss knights and amazons (never a floor boss) — never attack you, and the moment you SEE one it bows and JOINS your side, fighting as your ally (until you strike it, which breaks the bond)', grants: { beastFriend: true } },
      { id: 'r_promo', chain: 'Druid', tier: 3, requires: 'r_xray', name: 'Animal Form', desc: 'Gain an Animal Form card (cooldown 9): become an INVINCIBLE beast — an AMAZON (slides like a queen AND leaps like a knight) — for 3 turns, taking no damage and playing no cards', grants: { gainCard: 'promotion', gainCooldown: 9 } },
      // 🎯 Oracle — the seer: know the floor, then see (and shoot) beyond your foes' sight.
      { id: 'r_eagle', chain: 'Oracle', tier: 1, name: 'Premonition', desc: 'Cover no longer blinds you: within your sight radius you SEE and SHOOT straight through walls, boulders, and devilgrass. It is ONE-WAY — a foe with a wall between you can’t strike back, but it DOES wake and start closing in on you', grants: { seeThroughWalls: true } },
      { id: 'r_eyes2', chain: 'Oracle', tier: 2, requires: 'r_eagle', name: 'Hawk Eyes', desc: '+1 sight radius AND +1 card reach. This extra sight is ONE-WAY — foes out in the new band can’t see or strike you back (though they’ll start closing in)', grants: { visionOneWay: 2, cardReach: 1 } },
      { id: 'r_reach', chain: 'Oracle', tier: 3, requires: 'r_eyes2', name: 'Power Draw', desc: '+1 sight radius AND +1 card reach (again) — the extra sight is likewise one-way, so you pick foes off from outside their reach', grants: { visionOneWay: 2, cardReach: 1 } },
      // 🌑 Gloom Stalker — the ghost: unchased, ignored by structures, unnoticed.
      { id: 'r_ghost', chain: 'Gloom Stalker', tier: 1, name: 'Ghost', desc: 'Foes stop chasing once you leave their sight', grants: { noChase: true } },
      { id: 'r_camo', chain: 'Gloom Stalker', tier: 2, requires: 'r_ghost', name: 'Camouflage', desc: 'Turrets are BLIND to you (a sleep “z”) and never fire — a turret only wakes if you STRIKE it, and even then it dozes off again the moment you slip out of its firing line. Summoning circles likewise never conjure while you’re hidden', grants: { camouflage: true } },
      { id: 'r_stealth', chain: 'Gloom Stalker', tier: 3, requires: 'r_camo', name: 'Silent', desc: 'Unaware foes more than one tile away never notice you (until you strike); any within one tile — even one that blunders into you — detects you normally', grants: { stealth: true } },
      // 🏹 Marksman — the sharpshooter: kickback, a big bow, then exploding shots.
      { id: 'r_recoil', chain: 'Marksman', tier: 1, name: 'Recoil', desc: 'Firing a weapon card kicks you one tile back from the target (striking a foe there) AND shoves every adjacent foe back one tile where the ground behind it is clear', grants: { recoil: true } },
      { id: 'r_longbow', chain: 'Marksman', tier: 2, requires: 'r_recoil', name: 'Ballista', desc: 'Gain a queen card (cooldown 9) — a devastating volley in any direction', grants: { gainCard: 'queen', gainCooldown: 9 } },
      { id: 'r_shrapnel', chain: 'Marksman', tier: 3, requires: 'r_longbow', name: 'Shrapnel', desc: 'Every weapon card you fire SHATTERS on impact — striking every foe adjacent to the tile you hit, as well as the target', grants: { shrapnel: true } },
    ],
  },
  sorcerer: {
    name: 'Sorcerer',
    blurb: 'A fragile caster whose bolts pierce straight through the ranks.',
    color: '#a855f7',
    category: 'spell', // every Sorcerer card is a bolt that pierces the whole path
    start: 'bishop', // the Sorcerer opens with a diagonal bolt
    startCooldown: 3, // the bishop's own cooldown (cooldowns are per-UNIT, not per-class)
    hp: 4, // was 3 — a fragile caster still, but with a little more cushion now that foes close in
    // Four subclass chains, each a full 3-tier build (Necromancy is the ally-summoning line).
    chains: { Translocations: '#22d3ee', Necromancy: '#65a30d', Hexes: '#e879f9', Conjuration: '#8b5cf6' },
    perks: [
      // 🔮 Translocations — the blink-mage: dodge, phase, and displace.
      { id: 's_blink', chain: 'Translocations', tier: 1, name: 'Blink', desc: 'When a foe hits you, blink to a random safe tile in sight (if any)', grants: { blink: true } },
      { id: 's_phase', chain: 'Translocations', tier: 2, requires: 's_blink', name: 'Phase', desc: 'Move onto wall AND ice tiles; while embedded in opaque cover (a wall or boulder) your sight shrinks', grants: { phase: true } },
      { id: 's_swap', chain: 'Translocations', tier: 3, requires: 's_phase', name: 'Displacement', desc: 'Gain a swap card: trade places with any unit in sight (cooldown 3); arriving knocks every other adjacent foe back a tile', grants: { gainCard: 'swap', gainCooldown: 3 } },
      // 💫 Hexes — the curse-weaver: demote, dazzle, and lull.
      { id: 's_hex', chain: 'Hexes', tier: 1, name: 'Hex', desc: 'At the start of each turn, one foe adjacent to you is warped into a confused ferz — a feeble one-step diagonal mover (bosses and structures are immune)', grants: { hexDemote: true } },
      { id: 's_cata', chain: 'Hexes', tier: 2, requires: 's_hex', name: 'Cataclysm', desc: 'Every visible enemy is surprised when you cast a spell', grants: { spellSurprise: true } },
      { id: 's_slumber', chain: 'Hexes', tier: 3, requires: 's_cata', name: 'Slumber', desc: 'Non-boss foes adjacent to you fall asleep', grants: { sleepAura: true } },
      // 🌀 Conjuration — the artillery-mage: reach, a queen, then a full barrage.
      { id: 's_amp', chain: 'Conjuration', tier: 1, name: 'Blast', desc: 'Every spell you cast also detonates on 3 random tiles next to your target — a burst of collateral fire', grants: { spellBlast: true } },
      { id: 's_staff', chain: 'Conjuration', tier: 2, requires: 's_amp', name: 'Phantom Steed', desc: 'Gain a horse card: a spectral steed that tramples an L-shaped path, scorching every foe along it (cooldown 4)', grants: { gainCard: 'horse', gainCooldown: 4 } },
      { id: 's_barrage', chain: 'Conjuration', tier: 3, requires: 's_staff', name: 'Double Cast', desc: 'After firing a spell, if a targetable foe remains you may aim and fire once more before your turn ends', grants: { doubleCast: true } },
      // 🔥 Necromancy — the summoner: a familiar, then undead, then a General.
      { id: 's_familiar', chain: 'Necromancy', tier: 1, name: 'Familiar', desc: 'Summon a berolina familiar that follows you, fights foes, and respawns each floor / when clear', grants: { familiar: true } },
      { id: 's_undead', chain: 'Necromancy', tier: 2, requires: 's_familiar', name: 'Grave Bond', desc: 'A foe you slay rises as an undead ally (one at a time; undead do not follow you downstairs)', grants: { necromancy: true } },
      { id: 's_general', chain: 'Necromancy', tier: 3, requires: 's_undead', name: 'Undead General', desc: 'Your familiar becomes an Undead General — a king that can also leap like a knight', grants: { generalForm: true } },
    ],
  },
};

// Flat lookup: subclass chain name -> its colour (chain names are unique across classes).
const SUBCLASS_COLORS = {};
for (const cls of Object.values(CLASSES)) {
  for (const [chainName, color] of Object.entries(cls.chains || {})) SUBCLASS_COLORS[chainName] = color;
}
// The colour a granted card should wear: its subclass colour, else the class colour.
function chainColorFor(className, chainName) {
  const cls = CLASSES[className];
  return (cls && cls.chains && cls.chains[chainName]) || (cls && cls.color) || '#888';
}
// The colour the king's own token wears: his base class colour, UPGRADED to a subclass
// colour once he earns that chain's tier-3 capstone (the most recent capstone wins).
function playerDisplayColor(player) {
  const className = (player && player.className) || 'warrior';
  const cls = CLASSES[className] || CLASSES.warrior;
  let color = cls.color;
  for (const id of (player && player.takenPerks) || []) {
    const perk = cls.perks.find((k) => k.id === id);
    if (perk && perk.tier === 3) color = chainColorFor(className, perk.chain);
  }
  return color;
}
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

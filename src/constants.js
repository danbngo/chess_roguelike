// Shared configuration. Loaded first; every other script reads from these.

// 25x25 — 1.25x the old 20x20 board. The extra ground pays for the scattered set-pieces (storage
// rooms, fountains, gardens, ponds) and for turrets/circles no longer huddling round the chamber,
// so the OPEN floor a player actually walks stays about what it was.
const WORLD_SIZE = 25; // The full board is WORLD_SIZE x WORLD_SIZE tiles (walled border).
const STARTING_VISION = 7; // The king starts seeing a 7x7 window (odd, so centered).
const VISION_STEP = 2; // Each +1 sight perk widens the window by 2 (7 -> 9 -> 11...).
const PLAYER_START = { x: 12, y: 12 }; // the board's centre
const STARTING_HP = 5; // Default; each class overrides it (see CLASSES[].hp).
// DIFFICULTY is one simple dial: starting HP, per class. Nothing else changes between settings —
// the dread clock, the spawns and the foes are identical, so Nightmare is the same dungeon met with
// a thinner skin. (Achievements badge bronze/silver/gold for easy/hard/nightmare.)
const DIFFICULTY_HP = {
  easy: { warrior: 12, ranger: 11, sorcerer: 8 },
  hard: { warrior: 9, ranger: 7, sorcerer: 5 },
  nightmare: { warrior: 5, ranger: 4, sorcerer: 3 },
};
// The DREAD CYCLE runs EIGHT steps — an 8x8 board's worth. The first three are a GRACE: the floor
// holds still, no danger event fires, and the score keeps its calm tempo. Dread then climbs across
// the remaining five, which are exactly the five HURRY tempo gears in audio.js.
//
// A step is 20 turns: 60 of grace, then the floor turns on you across 100. It was 40, and that ramp
// was so gradual it BOILED THE FROG — you never felt the moment it turned, you only slowly noticed.
// Short steps mean a player moving at a decent clip is off the floor inside the grace and never
// meets it at all, while one who dawdles gets urgency that ARRIVES rather than creeps.
// Softened so a MODESTLY-skilled clear (~120 turns) still finishes inside the grace: a long quiet
// opening, then dread climbs across the middle, then — for a king who WILL NOT leave — the molten
// overstay. Each of the three phases is 120 turns: grace 0-120 (first danger tick at 120), dread ramp
// 120-240 (max dread + first lava at 240), lava ramp 240-360 (molten peak at 360). The grace holds 5
// steps and the ramp 5 (fixed by the audio's HURRY gears), so a step is 24 turns.
const DREAD_STEP_TURNS = 24;
const DREAD_GRACE_STEPS = 5; // the quiet opening — nothing stirs (5 * 24 = 120 turns)
const DREAD_RAMP_STEPS = 5; // must match HURRY.length in audio.js
const DREAD_TOTAL_STEPS = DREAD_GRACE_STEPS + DREAD_RAMP_STEPS; // 10
const DREAD_GRACE_TURNS = DREAD_STEP_TURNS * DREAD_GRACE_STEPS; // 120 — the first danger tick lands here
const MAX_TURNS_SCARY = DREAD_STEP_TURNS * DREAD_TOTAL_STEPS; // 240 — dread maxes, and the first lava wells up
// PAST max dread, a floor the king WILL NOT LEAVE turns lethal: five more OVERSTAY steps (turns
// 240-360) over which LAVA wells up and closes in (tickLavaEncroachment) and the swarm runs unbounded.
// It peaks at turn 360 — by then the molten floor and the horde together kill any build. See
// overstayFraction. (Nothing crosses the fire now — Pathfinder wades water/trees/pits but lava sears
// all; Waiting shrugs the horde but not the ground; no build survives the molten peak, so lingering
// is always fatal in the end.)
const DREAD_OVERSTAY_STEPS = 5;
const MAX_TURNS_LAVA = MAX_TURNS_SCARY + DREAD_STEP_TURNS * DREAD_OVERSTAY_STEPS; // 360 — the molten floor peaks here
// Which HURRY gear a dread fraction sits in. Gear 0 is the GRACE; 1..DREAD_RAMP_STEPS are the
// climbing steps.
//
// THE one definition, on purpose. audio.js sets the score's tempo from it and game.js fires a
// hostile event on every change, so the gear you HEAR and the floor turning on you are the same
// event — not two clocks drifting past each other. If these two ever computed the gear separately
// they would disagree, and the music would go back to being a vague mood instead of a tell.
function dreadGear(frac) {
  const f = Math.max(0, Math.min(1, Number(frac) || 0));
  return f <= 0 ? 0 : Math.min(DREAD_RAMP_STEPS, 1 + Math.floor(f * DREAD_RAMP_STEPS));
}
const SPATTER_LIFE = 48; // Turns a blood spatter lingers before fading away (long — the floor gets messy).
const SUMMON_TURNS = 3; // turns a summoning circle winds up before it conjures. The renderer draws
// the charge preview from this too — hardcoding it in both is how they silently desync.
const TREE_HP = 3; // wounds a tree takes before it falls (see damageTree)
const CORPSE_LIFE = 72; // Turns a corpse / ash / rubble / scrap / ice-shards linger before fully fading.
const BOSS_CORPSE_LIFE = 160; // A slain boss leaves remains that linger far longer than a common corpse.
// Blood that clings to a PIECE from combat (0..1 intensity, rendered as specks on its
// token). Being struck stains it heavily; landing a blow stains it lightly. It dries
// (fades) fairly quickly — see the decay in passTurn.
const BLOOD_HIT = 0.7; // splashed on a unit that IS struck
const BLOOD_STRIKE = 0.28; // splashed on a unit that DEALS a blow
const BLOOD_DRY = 0.6; // per-turn survival factor (lower = dries faster)
// How long a foe hunts the king's last-seen tile before the trail goes cold. A RANGE, rolled fresh
// for each pursuit, so a player cannot learn one number and count it down: at a fixed 6 he knew
// exactly how many turns to hold still behind a hedge. Now he has to actually guess.
const PURSUIT_TTL_MIN = 5;
const PURSUIT_TTL_MAX = 10;
// Having reached the spot where it lost him, a hunter casts on this many tiles further along the way
// he was heading — the "he must have gone round that corner" guess. One guess per pursuit.
const PURSUIT_GUESS = 3;
// FOG: a drifting cloud (spellfire over water, steam off lava/ice, a Steamweaver boss) that blocks the
// look for this many turns before it thins away. It is HAZE — Premonition (soft-sight) peers through.
const FOG_TURNS = 2;
const MAX_ENEMIES = 90; // A PERFORMANCE ceiling only. The per-floor cap now RISES with overstay (spawns
// are MEANT to run unbounded the longer he lingers — see the caps in maybeSpawnEnemy); this just stops
// the enemy array from exploding past what the per-turn clone can carry.

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
const DEMON_KINDS = ['berolina', 'archbishop', 'chancellor', 'nightrider', 'amazon'];
// When each kind joins the roster. A kind NEVER leaves it once unlocked, and the spawn pick is
// UNIFORM across everything unlocked — so a floor is always an even mix and the low-tier pieces keep
// showing up to the end (pawn/king 50/50 → +knight 33/33/33 → +bishop/rook 20% each → +queen ~17%
// each). Nothing ever becomes "all queens".
//
// The DEMON tier restarts that curve at DEMON_FLOOR with its own five kinds, widening 2→3→4→5 over
// floors 5–8. Two unlock together on floor 5 for the same reason: one kind alone would make the
// whole floor a single repeated enemy.
//
// Demon order is MEASURED, not theoretical — average legal moves on real generated floors, weakest
// first: berolina ~1.9, nightrider ~4, archbishop ~5.8, chancellor ~6.8, amazon ~10.9. The nightrider
// reads as a monster on an open board but this dungeon is cramped, and its rides die on the first
// wall, so it lands near the bottom. Re-measure before reordering; don't trust reputations here.
const ENEMY_UNLOCKS = [
  { kind: 'pawn', floor: 1 },
  { kind: 'king', floor: 1 },
  { kind: 'knight', floor: 2 },
  { kind: 'bishop', floor: 3 },
  { kind: 'rook', floor: 3 },
  { kind: 'queen', floor: 4 },
  { kind: 'berolina', floor: 5 },
  { kind: 'nightrider', floor: 5 },
  { kind: 'archbishop', floor: 6 },
  { kind: 'chancellor', floor: 7 },
  { kind: 'amazon', floor: 8 },
];

// The eight authored floors. Each: a themed name, a terrain `recipe` (blob/segment seed counts for
// the ONLY three terrain types — wall, water, lava), and its guardian's HP. The guardian's KIND and
// NAME are NOT authored — they are rolled and derived per run (see createBoss / bossPoolForFloor /
// bossNameFor). Only `hp` stays fixed, because it is the floor-to-floor difficulty ramp. The exit +
// boss chamber sit at a fixed anchor; wanderers and potions scatter.
// A recipe now names the PLACE, not just "how much wall". Vocabulary: `wall` (straight runs —
// hallway bones), `rooms` (walled rectangles with doorways), `tree` (solid, sight-blocking timber),
// `grass` (sight-blocking but walkable), `water`, `lava`. Every value is a seed count, scaled by
// board size and cycle.
//
// These were re-cut after MEASURING what each floor actually contained: every one came out 23-36%
// stone wall and ~3% grass whatever its name said, because `rooms()` ran flat on all of them and
// grass was a flat trickle. The Old Forest was a masonry maze with a pond; the Sunken Ruins had
// LESS water than it; the Battlefield had more wall than the Drowned Lake. Now the name is the spec.
const LEVELS = [
  // An open FIELD: room to manoeuvre, a little cover, no masonry to speak of.
  { name: 'The Battlefield', recipe: { wall: 2, rooms: 1, grass: 3 }, boss: { hp: 3 } },
  // A FOREST: timber and undergrowth, a stream through it, almost no stone.
  { name: 'The Old Forest', recipe: { tree: 11, grass: 6, water: 2, wall: 1 }, boss: { hp: 4 } },
  // RUINS, and SUNKEN ones: broken rooms half under water.
  { name: 'The Sunken Ruins', recipe: { wall: 4, rooms: 4, water: 5, grass: 1 }, boss: { hp: 4 } },
  // A LAKE: water is the floor, and what isn't water is shore.
  { name: 'The Drowned Lake', recipe: { water: 10, wall: 1, rooms: 1, grass: 2 }, boss: { hp: 4 } },
  // A CRYPT: stone chambers, dry, dead. No green at all.
  { name: 'The Whispering Crypt', recipe: { wall: 5, rooms: 5 }, boss: { hp: 4 } },
  // A HEDGE maze — hedges, not walls. Trees ARE the maze; they can be cut through at a price.
  { name: 'The Hedge Maze', recipe: { tree: 17, grass: 4, wall: 1, rooms: 1 }, boss: { hp: 5 } },
  // A LAKE OF FIRE: lava is the floor.
  { name: 'The Lake of Fire', recipe: { lava: 10, wall: 2, rooms: 1 }, boss: { hp: 6 } },
  // A CASTLE: halls and chambers, with fire running through them.
  { name: 'The Demon Castle', recipe: { wall: 4, rooms: 5, lava: 3, grass: 1 }, boss: { hp: 7 } }, // the FINALE: three perks (see createBoss). Its HP is just the curve's next step — no bonus on top; the perks ARE its escalation
];

// ---- REALMS -----------------------------------------------------------------------------------
// A REALM is a self-contained run of floors with its own level table, its own chamber anchors, its
// own roster and its own rules. The OVERWORLD is the original eight-floor descent (floors 1-6 mortal,
// 6-8 the demon realm at its foot). New Game+ realms are shorter, harder places reached through the
// portal room, and each is DATA rather than code: adding a third realm should mean adding an entry
// here, not touching the floor arithmetic.
//
// The floor number restarts at 1 inside each realm, so `(floor - 1) % FINAL_FLOOR` — which the whole
// engine used to be built on — is now `(floor - 1) % realmFinalFloor(realm)`.
const NG_PLUS_REALMS = ['undead', 'workshop', 'elemental'];

// THE WORKSHOP. Somebody's forge, still running long after they stopped. Half the usual population,
// because every one of them is a GOLEM that cannot be killed — only switched off — and a room of
// four things that keep getting back up is worth more than eight that stay down. Its hazards are
// mechanical rather than natural: current in the floor, doors that shut on you, guns wired to
// switches. Nothing here is alive, so nothing here can be reasoned with or burned.
const WORKSHOP_LEVELS = [
  { name: 'The Assembly Floor', recipe: { wall: 4, rooms: 5 }, boss: { hp: 7 } },
  { name: 'The Wire Gallery', recipe: { wall: 5, rooms: 6 }, boss: { hp: 7 } },
  { name: 'The Furnace Line', recipe: { wall: 4, rooms: 5, lava: 3 }, boss: { hp: 7 } },
  { name: 'The Machinist', recipe: { wall: 6, rooms: 6 }, boss: { hp: 7 } },
];
const WORKSHOP_ANCHORS = [
  { x: 20, y: 4 },
  { x: 4, y: 20 },
  { x: 20, y: 20 },
  { x: 4, y: 4 },
];
// The most BOONS a king can ever hold. An ordinary run fells seven guardians before the last, so
const UNDEAD_LEVELS = [
  // A BONEYARD: open ash and cairns, nothing green, nothing burning.
  { name: 'The Boneyard', recipe: { wall: 2, rooms: 2 }, boss: { hp: 7 } },
  // FLOODED CATACOMBS: black water standing in stone galleries.
  { name: 'The Drowned Catacombs', recipe: { wall: 4, rooms: 5, water: 5 }, boss: { hp: 7 } },
  // The CHARNEL WARRENS: rooms upon rooms, and the dead in all of them.
  { name: 'The Charnel Warrens', recipe: { wall: 6, rooms: 6 }, boss: { hp: 7 } },
  // The PALE THRONE: where whatever is running this sits.
  { name: 'The Pale Throne', recipe: { wall: 4, rooms: 4, water: 2 }, boss: { hp: 7 } },
];
const UNDEAD_ANCHORS = [
  { x: 20, y: 20 },
  { x: 4, y: 4 },
  { x: 20, y: 4 },
  { x: 4, y: 20 },
];
// THE ELEMENTAL REALM. The other two realms each pick one idea and hold it for four floors; this one
// changes underfoot every time he takes a stair. Earth, then water, then fire, then air — four
// distinct terrains, four distinct rosters, four distinct ways to die, and almost nothing carries
// over between them. A king cannot settle into it.
//
// The ELEMENTALS are its spine, and the rule they share is that DAMAGE IS NOT THE ANSWER. Each one
// has exactly one counter and no HP bar: the earth elemental is shoved like a boulder, the ice one
// wants spellfire, the fire one wants water, the electric one wants to be walked into. A player who
// arrives here swinging finds that swinging does nothing at all.
const ELEMENTAL_LEVELS = [
  // EARTH: dense, closed, heavy. Boulders and pits, and stone that will not yield to anything.
  { name: 'The Deepstone', element: 'earth', recipe: { wall: 7, rooms: 4, boulder: 6 }, boss: { hp: 7 } },
  // WATER: open and drowning. Ice, geysers, and depths that take him if he stops moving.
  { name: 'The Sunken Reach', element: 'water', recipe: { wall: 3, rooms: 3, water: 8, ice: 4 }, boss: { hp: 7 } },
  // FIRE: bright and lethal. Lava, torchlight everywhere, trees that never stop burning.
  { name: 'The Emberworks', element: 'fire', recipe: { wall: 4, rooms: 4, lava: 7, tree: 4 }, boss: { hp: 7 } },
  // AIR: nearly nothing. Islands over void, and the only ground is what he can reach.
  { name: 'The Riven Sky', element: 'air', recipe: { wall: 1, rooms: 2 }, boss: { hp: 7 } },
];
const ELEMENTAL_ANCHORS = [
  { x: 4, y: 4 },
  { x: 20, y: 20 },
  { x: 4, y: 20 },
  { x: 20, y: 4 },
];
const ELEMENTS = ['earth', 'water', 'fire', 'air'];

// Fixed exit / boss-chamber anchors, one per floor (never random). Kept clear of the king's central
// start and spread around the board's edges. Declared HERE, above REALMS, because the realm registry
// holds a reference to it — a `const` below its use would be a temporal-dead-zone error at load.
const CHAMBER_ANCHORS_OVERWORLD = [
  { x: 20, y: 20 },
  { x: 4, y: 4 },
  { x: 20, y: 4 },
  { x: 4, y: 20 },
  { x: 20, y: 12 },
  { x: 4, y: 12 },
  { x: 12, y: 20 },
  { x: 12, y: 4 },
];

const REALMS = {
  overworld: {
    name: 'The Overworld',
    levels: LEVELS,
    anchors: CHAMBER_ANCHORS_OVERWORLD,
    finalFloor: 8,
    demonFrom: 6, // floors 6-8 are the demon realm at the overworld's foot
    newGamePlus: false,
    // EVERY realm ends on an ORB. The overworld's is the one the whole base game is about; the New
    // Game+ realms each have their own, and they are pure COLLECTIBLES — no power, no stat, nothing
    // but a shelf of them under his pack proving where he has been. That is the point: the reward
    // for clearing a realm you did not have to enter is the fact of having done it.
    orb: { name: 'Orb of Victory', short: 'Victory', glyph: '◈', color: '#fbbf24' },
  },
  undead: {
    name: 'The Undead Realm',
    levels: UNDEAD_LEVELS,
    anchors: UNDEAD_ANCHORS,
    finalFloor: 4,
    demonFrom: 0, // NEVER. The undead realm has its own roster and no demon floors.
    noLava: true, // nothing burns here — see generateTerrain
    undeadRoster: true, // every native is a zombie / skeleton / vampire (see makeUndead)
    deathWater: true, // its water is the RIVER OF DEATH: green, and it eats the living
    theme: 'undead', // the view renders it blacker than the demon realm
    orb: { name: 'Orb of the Grave', short: 'Grave', glyph: '☾', color: '#7dd3a0' },
    newGamePlus: true,
  },
  workshop: {
    name: 'The Workshop',
    levels: WORKSHOP_LEVELS,
    anchors: WORKSHOP_ANCHORS,
    finalFloor: 4,
    demonFrom: 0,
    golemRoster: true, // every native is a GOLEM: switched off, never killed (see makeGolem)
    halfPopulation: true, // ...so there are half as many of them
    doubleTurrets: true, // and twice the usual number of guns
    metalDoors: true, // its doors are METAL: opened at will, they never swing shut again
    theme: 'workshop',
    orb: { name: 'Orb of Making', short: 'Making', glyph: '⚙', color: '#7dd3fc' },
    newGamePlus: true,
  },
  elemental: {
    name: 'The Elemental Realm',
    levels: ELEMENTAL_LEVELS,
    anchors: ELEMENTAL_ANCHORS,
    finalFloor: 4,
    demonFrom: 0,
    // NOTE: this realm carries no realm-wide terrain flag, because it has no realm-wide terrain. Its
    // character is per-FLOOR: ask `elementForFloor(floor, realm)`, never `realmDef(realm).element`.
    // The fire floor is the only one that wants lava and the water floor actively forbids it, so a
    // realm-level `noLava` would be wrong in both directions.
    elementalRoster: true,
    theme: 'elemental',
    orb: { name: 'Orb of the Elements', short: 'Elements', glyph: '❈', color: '#c4b5fd' },
    newGamePlus: true,
  },
};
const DEFAULT_REALM = 'overworld';
// The realms a New Game+ king may actually walk into, in the order the portal room lists them. The
// overworld and the demon realm are NOT here: he has already been through both, and their portals
// stand collapsed in the room as a record of it.
// seven is what the base game hands out — and New Game+ must not quietly raise that ceiling. Its
// realms are extra places to go, not extra power to bank: a king walking into the undead realm is as
// strong as he will ever be, and the difficulty there has to be met with what he already has.
const MAX_BOONS = 7;
function realmDef(realm) {
  return REALMS[realm] || REALMS[DEFAULT_REALM];
}
function realmFinalFloor(realm) {
  return realmDef(realm).finalFloor;
}

// WHICH ELEMENT IS UNDERFOOT. The elemental realm is the first whose floors differ from one another,
// so every hazard, roster and palette decision there routes through here rather than through a realm
// flag. Returns null everywhere else, and callers must treat null as "the ordinary rules apply" —
// that keeps the other three realms (and every old save) on exactly the path they were on before.
function elementForFloor(floor, realm) {
  const level = levelForFloor(floor, realm);
  return (level && level.element) || null;
}
function isElementFloor(floor, realm, element) {
  return elementForFloor(floor, realm) === element;
}

function levelForFloor(floor, realm) {
  const def = realmDef(realm);
  const n = def.levels.length;
  return def.levels[((floor - 1) % n + n) % n] || null;
}

function floorName(floor, realm) {
  const level = levelForFloor(floor, realm);
  const base = level ? level.name : `Floor ${floor}`;
  const cycle = Math.floor((floor - 1) / realmFinalFloor(realm));
  return cycle > 0 ? `${base} +${cycle}` : base;
}

// Fixed exit / boss-chamber anchors, one per floor (never random). Kept clear of
// the king's central start and spread around the board's edges.
// Kept as an alias: plenty of code (and tests) refer to the overworld's anchors by the old name.
const CHAMBER_ANCHORS = CHAMBER_ANCHORS_OVERWORLD;
function chamberAnchorForFloor(floor, realm) {
  const anchors = realmDef(realm).anchors;
  const n = anchors.length;
  return anchors[((floor - 1) % n + n) % n];
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
const STEPPER_KINDS = ['king', 'pawn', 'knight', 'mann']; // reach 1; sliders reach 3
const CARD_KINDS = ['pawn', 'king', 'knight', 'bishop', 'rook', 'archbishop', 'chancellor', 'queen', 'amazon', 'enpassant', 'doublestep', 'promotion', 'reload', 'swap', 'horse', 'blink', 'fireball', 'silence', 'banish', 'confuse'];
const CARD_COOLDOWN = 3;
const PROMOTION_TURNS = 3; // how many turns the Ranger's Promotion (amazon form) lasts
const SILENCE_TURNS = 3; // how many turns the Gloom Stalker's Silence holds the room asleep
const TURRET_HP = 3; // turrets are destructible: a flat, non-scaling HP pool (< a boss's)
// The Necromancer's Vampiress (Necromancy T3): a QUEEN with a mini-boss's wounds who FEEDS — every
// foe she fells knits one of them shut again. Her pool is FIXED: she heals up to it, never past it.
// (She used to raise her own cap with every kill, up to 9, so a queen left alive quietly became the
// stoutest thing on the floor. The point of her is that she keeps herself alive.)
const VAMPIRESS_HP = 3;

// Each floor guardian rolls ONE of these boss perks at creation, making every boss
// fight a little different. See createBoss / bossMove / damageBoss for the behaviour.
const BOSS_PERKS = ['summoner', 'blinker', 'brutal', 'ranged', 'sorcerer', 'knockback', 'shapeshifter', 'tough', 'leech', 'flying', 'phasing', 'regen', 'lich', 'warper', 'guardian', 'mechanic', 'hotblooded', 'icygrasp', 'shadowstep', 'anchored', 'gardener', 'petowner', 'hasty', 'burrower', 'steamweaver', 'wary'];
// Traits keyed to a REALM: some only demon-kind guardians may roll, some only mortal ones.
const DEMON_ONLY_PERKS = ['hotblooded', 'icygrasp', 'shadowstep'];
const MORTAL_ONLY_PERKS = ['gardener'];
const BOSS_PERK_LABELS = {
  summoner: 'Summoner — conjures its own kind every third turn',
  blinker: 'Blinkborn — flickers away after each wound',
  brutal: 'Brutal — its blows land twice as hard',
  ranged: 'Volley — looses bolts down its own lines instead of closing',
  sorcerer: 'Sorcerer — hurls piercing bolts through everything in their path',
  knockback: 'Bulwark — hammers the king backward with every blow',
  shapeshifter: 'Shifting — takes a new, lesser form after each wound',
  tough: 'Hardened — a third again as much life',
  leech: 'Leech — heals a wound each time it draws the king’s blood',
  flying: 'Winged — soars over pits, water, and lava unharmed',
  phasing: 'Phantom — sees and drifts through walls and boulders',
  regen: 'Regenerating — knits a wound shut every fourth turn',
  lich: 'Lich — calls the fallen back up around it, one a turn, while the bodies are still fresh',
  warper: 'Warper — from afar, wrenches places with the king when its own tile is far the deadlier one — shoving him into the crossfire',
  guardian: 'Guardian — wards ONE foe beside it; that retainer turns aside the first blow and must be struck again (fire, pits and lava cut straight through the ward)',
  mechanic: 'Mechanic — bolts together a fresh turret on nearby ground now and then',
  hotblooded: 'Hot-Blooded — its own wounds boil a patch of nearby ground to lava',
  icygrasp: 'Icy Grasp — sheets the ground beside the king with ice each time it strikes him',
  shadowstep: 'Shadowstep — slips through the dark to a tile you cannot see, closing on you',
  anchored: 'Anchored — nothing can shove, hurl or knock it back',
  gardener: 'Gardener — the wild grows up around it: grass, timber and pools spread from its feet',
  petowner: 'Beastmaster — keeps a ferz familiar beside it, conjuring a new one the moment the last is gone',
  hasty: 'Hasty — moves a second time in a turn, so long as neither step draws blood',
  burrower: 'Burrower — walks on the void unharmed, and tears open a fresh pit to lunge from',
  steamweaver: 'Steamweaver — boils out scalding steam around itself each turn, blinding you to the room and searing whatever stands in it (Premonition sees through it)',
  wary: 'Wary — any turn it does NOT end beside you it raises its guard, and the next blow is turned aside. Close with it and it has no time to set itself (lava and steam ignore the guard)',
};
// A guardian has NO unique powers — it is simply a piece kind plus rolled BOSS_PERKS, so the player
// only ever has to learn that one list. Its KIND is rolled too, from a sliding window over its tier
// (see bossPoolForFloor), so a floor plays differently each run while still escalating. Its NAME is
// derived from kind + traits: an epithet from its primary perk over a noun hashed from the roll, so
// the same monster always earns the same name without any of it being hand-authored per floor.
// Ordered weakest→strongest within each tier.
const BOSS_TIER_MORTAL = ['knight', 'bishop', 'rook', 'queen'];
const BOSS_TIER_DEMON = ['nightrider', 'archbishop', 'chancellor', 'amazon'];
const BOSS_NOUNS = {
  knight: ['Warlord', 'Charger', 'Destrier'],
  bishop: ['Centaur', 'Inquisitor', 'Zealot'],
  rook: ['Stone Golem', 'Bastion', 'Juggernaut'],
  queen: ['Leviathan', 'Tyrant', 'Usurper'],
  nightrider: ['Bone Dragon', 'Wyrm', 'Hunter'],
  archbishop: ['Lich', 'Hierophant', 'Cardinal'],
  chancellor: ['Minotaur', 'Marshal', 'Warden'],
  amazon: ['Balrog', 'Archdemon', 'Devourer'],
};
// The epithet a guardian earns from its PRIMARY perk — so its name telegraphs its worst trait.
const BOSS_EPITHETS = {
  summoner: 'Teeming', blinker: 'Flickering', brutal: 'Brutal', ranged: 'Cruel',
  sorcerer: 'Burning', knockback: 'Hammering', shapeshifter: 'Shifting', tough: 'Hardened',
  leech: 'Thirsting', flying: 'Winged', phasing: 'Phantom', regen: 'Undying',
};
// Ordered weakest→strongest; a Shifting boss never becomes a form ranked above its origin.
const PIECE_RANK = ['pawn', 'knight', 'bishop', 'rook', 'berolina', 'nightrider', 'archbishop', 'chancellor', 'queen', 'amazon'];

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
    hp: 9, // the HARD baseline; the difficulty dial sets the real value (see DIFFICULTY_HP)
    // Each subclass chain has its own colour; the class colour is the starter card's.
    chains: { Sentinel: '#3b82f6', Reaver: '#b91c1c', Cavalier: '#f59e0b', Duellist: '#ec4899' },
    // INNATE trait, granted at creation (never rolled): a quality-of-life boon shown on the sheet.
    startPerk: { id: 'w_discipline', name: 'Discipline', short: 'Skip a turn (Space / “.” / numpad-5) to let a foe in sight come to you', desc: 'Hold your ground — press Space, “.” or numpad-5 to skip a turn and let foes come to you. Only works while at least one foe is IN SIGHT: with an empty screen there is nothing to wait for, and the hold is refused rather than quietly burning your turns. A plainer boon than the others: the Warrior is strong enough already.', grants: { discipline: true } },
    perks: [
      // ⛨ Sentinel — the immovable bastion: wait out a blow untouched, guard the next, punish the rest.
      { id: 'w_waiting', chain: 'Sentinel', tier: 1, name: 'Waiting', short: 'Skip a turn to turn aside attacks from AFAR until your next turn', desc: 'Skip a turn (Discipline) and you read incoming fire: no RANGED attack — a turret’s bolt, a guardian’s volley — can hurt you until your next turn, though knockback still shoves you. A foe standing NEXT to you strikes home regardless; holding still does not stop a mace. The GROUND still bites too: lava, torches, steam and a fall into a pit burn as ever. A halo marks you while it holds.', grants: { waiting: true } },
      { id: 'w_bulwark', chain: 'Sentinel', tier: 2, requires: 'w_waiting', name: 'Parry', short: 'End a turn without attacking to block the next hit', desc: 'End a turn without striking and you RAISE your guard (a shield shows over your token). The next blow that would land is turned aside, and the guard drops — whatever you did in between. Bank it, then take the fight to them', grants: { firstHitEachTurn: true } },
      { id: 'w_reflect', chain: 'Sentinel', tier: 3, requires: 'w_bulwark', name: 'Riposte', short: 'A foe your PARRY turns aside, still adjacent, is cut down in return', desc: 'When your raised guard (Parry) turns a blow aside and that foe ENDS its turn next to you, it is struck down where it stands — a counter-blow out of turn. The riposte comes off the guard, so it costs a banked Parry each time; a blow that simply lands earns nothing. A common foe dies to it; a boss or turret soaks 1. Ranged attackers across the room are out of reach.', grants: { reflect: true } },
      // ⚔ Reaver — the bloodletter: kills fuel more kills.
      { id: 'w_edge', chain: 'Reaver', tier: 1, name: 'Keen Edge', short: 'A card kill halves that card’s cooldown', desc: "A card kill cuts that card's cooldown IN HALF (rounded down)", grants: { meleeRefund: true } },
      { id: 'w_cleave', chain: 'Reaver', tier: 2, requires: 'w_edge', name: 'Cleave', short: 'A kill also fells one adjacent foe (or tree/gate)', desc: 'When you fell a foe, one adjacent foe dies too — or, finding no second body, the sweep bites into an adjacent tree or gate', grants: { meleeCleave: true } },
      { id: 'w_leech', chain: 'Reaver', tier: 3, requires: 'w_cleave', name: 'Vampiric Edge', short: 'Each foe you fell (incl. Cleave/Pierce) has a 1-in-3 chance to heal 1', desc: 'Every foe you fell — the direct kill AND anything Cleave or Pierce takes with it — has a 1-in-3 chance of mending 1 HP. Turrets are dead metal: there is nothing in them to drink.', grants: { meleeLeech: true } },
      // 🐎 Cavalier — the charger: kill on the move, trample on landing.
      { id: 'w_fleet', chain: 'Cavalier', tier: 1, name: 'Double-Step', short: 'Card: charge two tiles, trampling anything that dies', desc: 'Gain a Double-Step card (cooldown 3): TWO steps in one direction, and either may be a blow. Anything that dies to the first is trampled and you carry on through it; anything that survives — a guardian, a turret — halts the charge and takes BOTH blows. A boulder in the way is charged instead (rolled two tiles), and timber takes two wounds', grants: { gainCard: 'doublestep', gainCooldown: 3 } },
      { id: 'w_pierce', chain: 'Cavalier', tier: 2, requires: 'w_fleet', name: 'Pierce', short: 'A kill by moving drives the thrust through the TWO tiles behind the foe', desc: 'A kill by moving drives the thrust through the TWO tiles beyond it — striking foes there, or the timber/gate standing in them. On a knight LEAP, “behind” runs diagonally on from your target, away from where you sprang.', grants: { meleePierce: true } },
      { id: 'w_trample', chain: 'Cavalier', tier: 3, requires: 'w_pierce', name: 'Thundering Charge', short: 'Landing a knight leap knocks back every foe in sight', desc: 'When you LAND a knight leap, the shock of it goes through the whole floor: every foe, turret and boulder you can SEE is hurled directly away from where you came down (Knockback rules — so anything with a pit, a wall or a lava river behind it takes what it gets)', grants: { leapShock: true } },
      // 🛡 Duellist — the flashy fencer: a signature dash, free-tempo kills, a dazzling flourish.
      { id: 'w_enpassant', chain: 'Duellist', tier: 1, name: 'En Passant', short: 'Card: step one tile and strike a foe you pass', desc: 'Gain an en-passant card: step 1 tile (capturing there) AND strike one foe you pass (adjacent to your start)', grants: { gainCard: 'enpassant' } },
      { id: 'w_flourish', chain: 'Duellist', tier: 2, requires: 'w_enpassant', name: 'Flourish', short: 'After a kill, adjacent foes are caught off guard', desc: 'After a kill, foes beside you are caught off guard', grants: { meleeFlourish: true } },
      { id: 'w_rush', chain: 'Duellist', tier: 3, requires: 'w_flourish', name: 'Blade Dance', short: 'Every move that kills is free — keep chaining kills', desc: 'EVERY move that kills costs no turn — chain kill after kill in a single turn for as long as you keep felling foes', grants: { freeKillMove: true } },
    ],
  },
  ranger: {
    name: 'Ranger',
    blurb: 'A hunter who fells foes from across the room.',
    color: '#65a30d',
    category: 'ranged', // every Ranger card fires from afar (blocked by cover)
    start: 'bishop', // the Ranger opens with a DIAGONAL bow (swapped with the Sorcerer's — the shorter cooldown suits the hunter)
    startCooldown: 3, // the bishop's own cooldown
    hp: 7, // the HARD baseline (see DIFFICULTY_HP) — sturdier than a glass cannon, frailer than the warrior
    chains: { Druid: '#16a34a', Oracle: '#14b8a6', 'Gloom Stalker': '#6366f1', Marksman: '#a3e635' },
    // `vision` is the WINDOW size (odd, so centred) — a +1 RADIUS is +2 to it, exactly as Hawk Eyes
    // grants even amounts to stay odd. A +1 here would make the window even and shove it off-centre.
    startPerk: { id: 'r_senses', name: 'Sharpened Senses', short: '+1 sight radius and +1 card reach', desc: '+1 sight radius and +1 card reach — a hunter’s eye for lining up a bishop shot. Stacks with the Oracle’s Hawk Eyes.', grants: { vision: 2, cardReach: 1 } },
    perks: [
      // 🌲 Druid — the survivalist: master the terrain, then ride to war.
      { id: 'r_wade', chain: 'Druid', tier: 1, name: 'Pathfinder', short: 'Cross water, trees and pits freely — no slow, no fall (lava still burns)', desc: 'The wild is no obstacle: you wade WATER at a walk, push straight through TREES, and tread PITS without falling — walking, carding, or leaping across them all. Only LAVA still stops you, searing as ever.', grants: { pathfinder: true } },
      { id: 'r_xray', chain: 'Druid', tier: 2, requires: 'r_wade', name: 'Wild Empathy', short: 'Wild horses (knights & nightriders) roam neutral — they ignore you', desc: 'Wild HORSES — enemy and mini-boss knights and nightriders (never a floor guardian, never an amazon) — turn NEUTRAL: they roam, take no interest in you, and nothing else on the board picks a fight with them. Strike one and the truce is off for good.', grants: { beastFriend: true } },
      { id: 'r_promo', chain: 'Druid', tier: 3, requires: 'r_xray', name: 'Animal Form', short: 'Card: become a unicorn for 3 turns; wild horses rally to you', desc: 'Gain an Animal Form card (cooldown 9): become a UNICORN (glides like a bishop AND rides like a nightrider) for 3 turns, playing no cards — and every wild horse on the board rallies to your side as an ally. You still take damage as normal — the beast is fast and deadly, not invulnerable.', grants: { gainCard: 'promotion', gainCooldown: 9 } },
      // 🎯 Oracle — the seer: know the floor, then see (and shoot) beyond your foes' sight.
      { id: 'r_eagle', chain: 'Oracle', tier: 1, name: 'Premonition', short: 'See and shoot through haze — tall grass and geyser steam (one-way)', desc: 'Haze no longer blinds you: within your sight radius you SEE and SHOOT straight through tall grass and erupting geyser steam. Solid cover — walls, boulders, trees — still blocks you. It is ONE-WAY: a foe hidden in the haze can’t strike back, but it DOES wake and start closing in on you', grants: { trueSight: true } },
      { id: 'r_reach', chain: 'Oracle', tier: 2, requires: 'r_eagle', name: 'Revelation', short: 'Arrive knowing the whole floor — key, stair, circles and turrets marked', desc: 'The floor holds no secrets from you: the fog is torn away the instant you arrive, you know where the key and the stair lie, and summoning circles and turrets stay marked even in the dark. You still only SEE (and shoot) living foes within your sight — but you never again walk a floor not knowing where you are going or what waits in the fog', grants: { revealFloor: true } },
      { id: 'r_eyes2', chain: 'Oracle', tier: 3, requires: 'r_reach', name: 'Hawk Eyes', short: '+2 sight radius (one-way) and +2 card reach', desc: '+2 sight radius AND +2 card reach. Like Premonition, the extra sight is ONE-WAY — foes out in the new band cannot see or strike you back (though they will start closing in), so you pick them off from range.', grants: { visionOneWay: 4, cardReach: 2 } },
      // 🌑 Gloom Stalker — the ghost: unchased, ignored by structures, unnoticed.
      // Ghost used to grant `noChase` (foes gave up the moment you broke sight). That read as
      // stealth but PUNISHED good play: it made a foe impossible to draw off its pack, so you could
      // never isolate one. It now slows the CATCHING of your eye instead of ending the chase.
      { id: 'r_ghost', chain: 'Gloom Stalker', tier: 1, name: 'Ghost', short: 'Distant foes notice you only half the time', desc: 'Foes are slow to fix on you: one more than a tile away has only a 50% chance each turn to notice you at all — so you can draw a single foe off a pack and fight it alone. Adjacent, it always sees you, and one you have struck is enraged regardless', grants: { elusive: true } },
      { id: 'r_camo', chain: 'Gloom Stalker', tier: 2, requires: 'r_ghost', name: 'Camouflage', short: 'Turrets and circles beyond 1 tile ignore you', desc: 'Turrets and summoning circles more than one tile away are BLIND to you — turrets doze (a sleep “z”) and never fire, circles conjure nothing. Step adjacent (within one tile) and they wake and work as normal', grants: { camouflage: true } },
      // Silent (foes never noticed you at all beyond a tile) was a passive that simply switched the game
      // off. Silence is the same fantasy as an ABILITY: a window you open deliberately, and close the
      // moment you take a swing.
      { id: 'r_stealth', chain: 'Gloom Stalker', tier: 3, requires: 'r_camo', name: 'Silence', short: 'Card: every foe you see sleeps for 3 turns', desc: 'Gain a Silence card (cooldown 9): every foe you can see drops into a dead sleep (a “z”) for 3 turns — walk through them, or walk away. It breaks the instant you strike anything', grants: { gainCard: 'silence', gainCooldown: 9 } },
      // 🏹 Marksman — the sharpshooter: kickback, a big bow, then exploding shots.
      { id: 'r_recoil', chain: 'Marksman', tier: 1, name: 'Recoil', short: 'Firing kicks you back a tile and shoves adjacent foes', desc: 'Firing a weapon card kicks you one tile back from the target (striking a foe there) AND shoves every adjacent foe back one tile where the ground behind it is clear', grants: { recoil: true } },
      { id: 'r_longbow', chain: 'Marksman', tier: 2, requires: 'r_recoil', name: 'Ballista', short: 'Card: a queen-range volley in any direction', desc: 'Gain a queen card (cooldown 9) — a devastating volley in any direction', grants: { gainCard: 'queen', gainCooldown: 9 } },
      { id: 'r_shrapnel', chain: 'Marksman', tier: 3, requires: 'r_longbow', name: 'Explosive Round', short: 'Your shots detonate, knocking foes back around the hit', desc: 'Every weapon card you fire DETONATES on impact — every foe around the tile you hit is HURLED a tile outward (slammed into whatever is behind it — see Knockback), on top of the target being struck', grants: { shrapnel: true } },
    ],
  },
  sorcerer: {
    name: 'Sorcerer',
    blurb: 'A fragile caster whose bolts pierce straight through the ranks.',
    color: '#a855f7',
    category: 'spell', // every Sorcerer card is a bolt that pierces the whole path
    start: 'rook', // the Sorcerer opens with an ORTHOGONAL piercing bolt (swapped with the Ranger's)
    startCooldown: 5, // the rook's own cooldown
    hp: 5, // the HARD baseline (see DIFFICULTY_HP) — the frailest of the three
    // Four subclass chains, each a full 3-tier build (Necromancy is the ally-summoning line).
    chains: { Translocations: '#22d3ee', Necromancy: '#65a30d', Hexes: '#e879f9', Conjuration: '#8b5cf6' },
    startPerk: { id: 's_studious', name: 'Studious', short: 'Choose from 3 level-up perks instead of 2', desc: 'Choose from THREE perks at each level-up instead of two — an easier build to steer and customise.', grants: { studious: true } },
    perks: [
      // 🔮 Translocations — the blink-mage: dodge, phase, and displace.
      // Reordered: Displacement leads (it is the chain's escape AND its opener), Phase holds the
      // middle, and Banish crowns it. The chain measured worst in the game — avg floor 3.5, 0% past
      // floor 6 — for one reason: it was three utilities and NO way to remove anything. Banish is
      // that way.
      //
      // BLINK is retired. Its card machinery is intact (see blinkToSafety / the 'blink' card kind)
      // if it is ever wanted back, but with Displacement at T1 it was a second escape doing the
      // first one's job, and the chain has only three slots.
      // { id: 's_blink', chain: 'Translocations', tier: 1, name: 'Blink', desc: '...', grants: { gainCard: 'blink', gainCooldown: 6 } },
      { id: 's_swap', chain: 'Translocations', tier: 1, name: 'Displacement', short: 'Card: swap places with any unit; shockwave where you land', desc: 'Gain a swap card: trade places with any unit in sight (cooldown 3). A SHOCKWAVE bursts where you ARRIVE — every other foe beside you is hurled back a tile (slamming into whatever is behind it). The unit you swapped with, and the tile you left, are spared. A summoning circle is a rune cut into the floor, not a body — it cannot be swapped with.', grants: { gainCard: 'swap', gainCooldown: 3 } },
      { id: 's_phase', chain: 'Translocations', tier: 2, requires: 's_swap', name: 'Phase', short: 'Walk onto walls and ice (sight shrinks while embedded)', desc: 'Move onto wall AND ice tiles; while embedded in opaque cover (a wall or boulder) your sight shrinks', grants: { phase: true } },
      { id: 's_banish', chain: 'Translocations', tier: 3, requires: 's_phase', name: 'Banish', short: 'Card: erase any foe/turret/mini-boss you see (no reward)', desc: 'Gain a Banish card (cooldown 9): send ANY foe, turret or rogue mini-boss you can see clean out of the world — it is simply gone, leaving nothing but a puff of smoke. A floor guardian is anchored to its key and a summoning circle is a rune in the floor: neither can be shifted', grants: { gainCard: 'banish', gainCooldown: 9 } },
      // 💫 Hexes — the curse-weaver: demote, dazzle, and lull.
      { id: 's_hex', chain: 'Hexes', tier: 1, name: 'Hex', short: 'Each turn, warp one adjacent foe into a feeble ferz', desc: 'At the start of each turn, one foe adjacent to you is warped into a confused ferz — a feeble one-step diagonal mover (bosses and structures are immune)', grants: { hexDemote: true } },
      { id: 's_cata', chain: 'Hexes', tier: 2, requires: 's_hex', name: 'Cataclysm', short: 'Casting a spell startles every foe you can see', desc: 'Every visible enemy is surprised when you cast a spell', grants: { spellSurprise: true } },
      { id: 's_confuse', chain: 'Hexes', tier: 3, requires: 's_cata', name: 'Mass Confusion', short: 'Card: every visible foe turns on its own side', desc: 'Gain a Mass Confusion card (cooldown 9): every foe you can see loses track of which side it is on. A confused piece either lashes out at whatever is nearest — its OWN kind included — or blunders off at random, an even chance of each. Nothing is immune: turrets, guardians and summoning circles all lose the thread. The fog lifts on its own about every other turn, and ANY blow snaps a piece straight out of it', grants: { gainCard: 'confuse', gainCooldown: 9 } },
      // 🌀 Conjuration — the artillery-mage: reach, a queen, then a full barrage.
      // Reordered: the chain used to OPEN on Blast, which overlapped Marksman's shrapnel and gave
      // the Conjurer nothing to conjure. It now leads with the steed and crowns with Fireball.
      { id: 's_staff', chain: 'Conjuration', tier: 1, name: 'Spectral Steed', short: 'Card: a horse tramples an L-path, scorching all on it', desc: 'Gain a horse card: a spectral steed that tramples an L-shaped path, scorching every foe along it (cooldown 4)', grants: { gainCard: 'horse', gainCooldown: 4 } },
      { id: 's_barrage', chain: 'Conjuration', tier: 2, requires: 's_staff', name: 'Double Cast', short: 'After a spell, fire a second if a target remains', desc: 'After firing a spell, if a targetable foe remains you may aim and fire once more before your turn ends', grants: { doubleCast: true } },
      { id: 's_fireball', chain: 'Conjuration', tier: 3, requires: 's_barrage', name: 'Fireball', short: 'Card: a blast that scorches everything around the hit', desc: 'Gain a Fireball card (cooldown 7): hurl it along any queen line. It strikes your target AND washes spellfire over every tile around it — which will burn YOU and your allies if you stand too close', grants: { gainCard: 'fireball', gainCooldown: 7 } },
      // 🔥 Necromancy — the summoner: a familiar, then undead, then a General.
      { id: 's_familiar', chain: 'Necromancy', tier: 1, name: 'Familiar', short: 'A skeletal ally follows and fights, respawning each floor', desc: 'Summon a skeletal MANN familiar (steps one tile any direction) that follows you, fights foes, and respawns each floor / when clear', grants: { familiar: true } },
      { id: 's_undead', chain: 'Necromancy', tier: 2, requires: 's_familiar', name: 'Grave Bond', short: 'A foe you kill rises as an undead ally (one at a time)', desc: 'A foe you slay rises as an undead ally (one at a time; undead do not follow you downstairs)', grants: { necromancy: true } },
      { id: 's_general', chain: 'Necromancy', tier: 3, requires: 's_undead', name: 'Vampiress', short: 'Your familiar becomes a queen that heals on each kill', desc: 'Your familiar rises as a VAMPIRESS — a queen with 3 wounds who FEEDS: every foe she fells knits one of them shut again. She heals up to her pool, never past it — left alive and fed, she simply refuses to die', grants: { generalForm: true } },
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
// The subclass the king has COMMITTED to — the first chain he finishes, and his for the rest of the
// run. Every chain is a strict T1 -> T2 -> T3 line (each perk requires the one below it), so holding
// all THREE of a chain's perks is the same statement as holding its capstone; there is no need to
// count. And `takenPerks` is in the order he took them, so "the first chain he finished" reads
// straight off it — no extra bookkeeping to record, and it survives a save/load for free.
//
// Returns null until he finishes one: until then he is just his class.
function committedChain(player) {
  const cls = CLASSES[(player && player.className) || 'warrior'];
  if (!cls) return null;
  for (const id of (player && player.takenPerks) || []) {
    const perk = (cls.perks || []).find((k) => k.id === id);
    if (perk && perk.tier === 3) return perk.chain; // the first capstone he earned
  }
  return null;
}

// The colour the king's own token wears: his base class colour, upgraded to his committed
// subclass's colour. Reads the SAME commitment his title does — the two used to disagree, since
// this took the most recent capstone while the title took the biggest chain, so a king could be
// captioned one subclass and coloured another.
function playerDisplayColor(player) {
  const className = (player && player.className) || 'warrior';
  const cls = CLASSES[className] || CLASSES.warrior;
  const chain = committedChain(player);
  return chain ? chainColorFor(className, chain) : cls.color;
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

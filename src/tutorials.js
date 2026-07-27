// Tutorial tip copy, keyed by id. Each tip is shown once (per "seen" record) the
// first time its in-game trigger fires. Pure data — no logic here.

const TUTORIALS = {
  welcome: {
    title: 'Long live the King',
    text:
      'Move the king with WASD, the diagonals Q E Z C, the numpad, or by clicking a highlighted ' +
      'tile. Pan with the arrow keys or the screen edges, and zoom with the mouse wheel. You see ' +
      'only a short distance — unexplored ground is fogged until you reach it. RED tiles are squares ' +
      'a visible enemy could strike next turn, so never end your move on one. HOVER any tile or ' +
      'piece to read exactly what it is and does. You begin beside the stair down — explore to find ' +
      'the key that unlocks it.',
  },
  cards: {
    title: 'Your abilities win fights',
    text:
      'The glowing slots under the board are your ABILITY CARDS — they are the whole point of your ' +
      'class, and a plain step will not carry you far without them. A card PULSES while it is ready. ' +
      'Press its number (1-9) or click it to AIM, then push a DIRECTION to swing the target onto what ' +
      'you want, and press the number again (or Enter) to fire. Escape cancels. Each card then ' +
      'recharges for a few turns, so spend them, do not hoard them — they cost you nothing but time.',
  },
  surprise: {
    title: 'Caught by surprise',
    text:
      'An enemy marked with a ! has just spotted you. It is frozen in surprise for ' +
      'one turn before it hunts — use that turn to reposition.',
  },
  threat: {
    title: 'Danger squares',
    text:
      'Red tiles mark where visible enemies could capture you next turn. The deeper ' +
      'the red, the more foes cover it — never end your move on a red tile. An enemy ' +
      'only strikes if it can move ONTO your square, so a red tile is a real threat.',
  },
  hp: {
    title: 'Taking damage',
    text:
      'That strike cost you 1 HP. Lose every point and the run ends — there is no ' +
      'healing on a floor, so avoid blows. You fully heal each time you descend.',
  },
  knight: {
    title: 'Knights leap',
    text:
      'Knights move in an L — two squares one way and one across — jumping clean ' +
      'over anything between. Their threat squares are easy to overlook.',
  },
  jumper: {
    title: 'Leapers charge',
    text:
      'A leaper (knight and the compound pieces) attacks by leaping ONTO your tile, ' +
      'knocking you back a square. If the space behind you is blocked, the blow ' +
      'still lands but you keep your footing.',
  },
  enemyKing: {
    title: 'Enemy kings',
    text:
      'An enemy king shuffles one tile at a time toward you and strikes when it can ' +
      'step onto your square. Weak alone, dangerous in a crowd.',
  },
  turret: {
    title: 'Turrets',
    text:
      'A turret is a fixed emplacement that fires along its piece’s pattern (its red threat ' +
      'tiles). When you step into its line it spends ONE turn locking on (“move!”) before it ' +
      'can fire — so you always have a chance to slip clear. It has a small HP bar: strike it ' +
      'to smash it (leaving scrap), or knock it into a pit. Stay off the red.',
  },
  miniBoss: {
    title: 'Mini-bosses',
    text:
      'A mini-boss is a lesser guardian — an ashen, grey-green piece with a HP bar, smaller than ' +
      'a floor boss. It rolls a boss trait and hunts you, but grants NO level-up boon when slain. ' +
      'They claw in from hostile events (and swarm the finale), so cut them down or slip away.',
  },
  circle: {
    title: 'Summoning circles',
    text:
      'A summoning circle sits fixed and conjures a fresh foe beside it whenever it ' +
      'can see you. It never strikes directly — but step ONTO it to shatter it and ' +
      'stop the flow of reinforcements.',
  },
  boss: {
    title: 'The floor guardian',
    text:
      'A crowned boss GUARDS this floor’s key — a high-mobility piece with a HP bar, sitting ' +
      'on the key in a walled chamber. It holds still until it SEES you (or you strike it), ' +
      'then roars and hunts. SLAY it (each hit chips the bar) to claim the key AND earn a ' +
      'level-up boon — or bait it away and grab the key without the kill, forgoing the boon.',
  },
  key: {
    title: 'The floor key',
    text:
      'That glinting key unlocks the stair down. WALK ONTO it to pick it up — until you do, ' +
      'the stair stays sealed. It is GUARDED by the floor’s boss in a walled chamber, so you ' +
      'must get past the guardian to claim it.',
  },
  stairLocked: {
    title: 'A sealed stair',
    text:
      'You start beside the stair down, but it is SEALED until you collect this floor’s key. ' +
      'The key is guarded by the boss elsewhere on the floor — claim it, then return here and ' +
      'step onto the stair to descend. (Slaying the guardian also earns a level-up boon.)',
  },
  orb: {
    title: 'The Orb of Victory',
    text:
      'This is the LAST floor — no stair down, only a portal home. That radiant Orb opens it, ' +
      'but it is GUARDED by the final guardian. Seize the Orb and the realm’s guardians ' +
      'converge on you: claim it, then fight your way to the portal to escape and WIN.',
  },
  portalLocked: {
    title: 'The victory portal',
    text:
      'The way home lies dormant until you seize the Orb of Victory somewhere on this floor. ' +
      'Take the Orb, then step into the open portal to win the run — but expect a rush of ' +
      'guardians the instant the Orb is yours.',
  },
  exit: {
    title: 'Descending',
    text:
      'Step onto the stair to descend — you fully heal and your cards recharge. A level-up ' +
      'boon comes ONLY from slaying the floor guardian (the one guarding the key); grab the ' +
      'key without the kill and you descend empty-handed.',
  },
  levelup: {
    title: 'Level up',
    text:
      'Slaying a floor guardian earns a boon: pick one of two drawn from your class. ' +
      'Boons come in tiered chains — take the cheap tier-1 bump and it unlocks the ' +
      'stronger tier-2, then the tier-3 capstone. Build toward the run you want.',
  },
  // Terrain tips fire the first time each type comes into view.
  'terrain-water': {
    title: 'Water',
    text:
      'Water is passable but SLOW — you cross at most one water tile per move, and ' +
      'you cannot ready a weapon card while wading. It does not block sight; leapers ' +
      'jump clean over it.',
  },
  'terrain-lava': {
    title: 'Lava',
    text:
      'You CAN cross lava, but it sears you for 1 HP each turn you end standing on it — ' +
      'so dash across, never linger. Enemies wade it freely (it shields them). It does ' +
      'not block sight, and nothing you can learn makes you immune to the burning.',
  },
  'terrain-pit': {
    title: 'Pits',
    text:
      'A pit is a bottomless hole — NOTHING can step into or over it on foot (you, foes, ' +
      'and allies alike). But it does not block shots: your arrows and bolts fly right ' +
      'across it — and so do a turret’s or boss’s. Only leaping pieces (a knight’s hop, ' +
      'the amazon form) can jump clean over a pit.',
  },
  'terrain-boulder': {
    title: 'Boulders',
    text:
      'A boulder blocks movement and sight like a wall — but you can SHOVE it: step into ' +
      'it and it rolls one tile ahead (if the way is clear; otherwise you shove in vain ' +
      'and waste the turn). Push one into a pit, lava, or water to FILL the hazard. A ' +
      'leap crushes a boulder you land on; a spell blasts one you fire at.',
  },
  dangerEvent: {
    title: 'The floor turns against you',
    text:
      'The longer you linger, the more the dungeon itself fights back. At quickening ' +
      'intervals a DANGER EVENT strikes — a wave of foes, turrets rising, the ground ' +
      'opening into pits or lava, a cave-in, every enemy suddenly hunting you, and more. ' +
      'The screen heaves and an ominous note sounds each time. Don’t dawdle — descend.',
  },

  // --- THE TRAINING GROUNDS: ONE short pop-up per stage (see buildTutorialFloor / tickTutorial). ---
  // These are the ONLY tutorial pop-ups in the whole game — the real dungeon shows none. Each is a
  // single instruction the player acts on to open the ward ahead; keep them to a sentence or two.
  tutWelcome: {
    title: 'Move',
    text:
      'Follow the corridors EAST to begin. Move with WASD, the NUMPAD, or by clicking a highlighted ' +
      'tile. For DIAGONALS, press two of WASD together (W+A = up-left) or use Q E Z C. The view follows ' +
      'you — DRAG the board or use the ARROW KEYS to look around. To skip the tutorial, walk WEST into ' +
      'the PORTAL.',
  },
  tutAttack: {
    title: 'Attack',
    text:
      'MOVE ONTO a foe to strike it — a plain step is an attack. Cut down the foe ahead FAST: it hits ' +
      'back if you linger beside it. (RED tiles show where a foe could strike; never end a turn on one.)',
  },
  // One per class: the ability puzzle blocking the corridor demands the class’s real signature move.
  // Fire a card by clicking its slot (or pressing its NUMBER), aiming a DIRECTION, then confirming.
  tutAbilityWarrior: {
    title: 'Leap the pit',
    text:
      'A pit blocks the way. Fire your KNIGHT card — click its slot below (or press its number), then ' +
      'aim at the ledge across the gap. It leaps in an L, clean over the pit.',
  },
  tutAbilityRanger: {
    title: 'Shoot the switch',
    text:
      'An iron GATE blocks the way — it will not budge by hand. Fire your BOW — click its slot below ' +
      '(or press its number), then aim DIAGONALLY at the SWITCH across the pit. The gate grinds open.',
  },
  tutAbilitySorcerer: {
    title: 'Melt the ice',
    text:
      'A wall of ice blocks the way. Fire your BOLT — click its slot below (or press its number), then ' +
      'aim STRAIGHT at the ice. It melts to water and throws up scalding STEAM — cross quickly, and ' +
      'never END a turn standing in the steam or it will burn you.',
  },
  tutTurret: {
    title: 'Turret — strike from safety',
    text:
      'A TURRET fires along the red lines and needs a turn to lock on (“move!”). Don’t face it head-on ' +
      '— step OFF its lines and STRIKE it from a diagonal, where it cannot shoot back.',
  },
  tutCircle: {
    title: 'Summoning circle — rush it',
    text:
      'A SUMMONING CIRCLE conjures a fresh foe every few turns. Don’t let it build a horde — RUSH it ' +
      'and step ONTO it to shatter it.',
  },
  tutKeyBoss: {
    title: 'Key, guardian & stair',
    text:
      'Grab the KEY to unlock the stair, then reach it. The GUARDIAN can strike you — but you needn’t ' +
      'fight it: dodge around and DIVE for the stair, or trade blows if you like. In the real dungeon, ' +
      'felling a floor’s guardian grants a level-up UPGRADE — though this practice one gives none. If ' +
      'you fall here, you wake back at the start. Step on the stair to descend for real — good luck, King!',
  },
};

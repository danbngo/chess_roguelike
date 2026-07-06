// Tutorial tip copy, keyed by id. Each tip is shown once (per "seen" record) the
// first time its in-game trigger fires. Pure data — no logic here.

const TUTORIALS = {
  welcome: {
    title: 'Long live the King',
    text:
      'Move the king with WASD, the diagonals Q E Z X, the numpad, or by clicking ' +
      'a highlighted tile. Pan with the arrow keys or the screen edges, and zoom ' +
      'with the mouse wheel. You see only a short distance — unexplored ground is ' +
      'shrouded in fog of war until you reach it. Explore to find the stair down.',
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
      'That strike cost you 1 HP. Lose every point and the run ends. Drink a Potion ' +
      'of Healing to recover, and you fully heal each time you descend.',
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
  statue: {
    title: 'Statues',
    text:
      'A statue stands inert and cannot be captured — until the king steps onto a ' +
      'neighbouring tile, when it cracks to life and joins the hunt. They often ' +
      'guard the stair.',
  },
  turret: {
    title: 'Turrets',
    text:
      'A turret is a fixed emplacement that cannot be moved or destroyed. Each turn ' +
      'it fires along its piece’s pattern (its red threat tiles), striking the king ' +
      'if he stands in the line. Stay off the red and slip past.',
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
      'A crowned boss sits ON the stair down — a high-mobility piece with a HP bar. ' +
      'It holds still until you strike it or step adjacent, then hunts. Fell it (each ' +
      'hit chips the bar) and you descend the moment it drops.',
  },
  danger: {
    title: 'The longer you linger...',
    text:
      'Danger climbs the more turns you spend on a floor — enemies spawn faster and ' +
      'faster (watch the Turn counter redden). Don’t dawdle: find the stairs.',
  },
  exit: {
    title: 'Descending',
    text:
      'Step onto the stair to descend. You fully heal, your cards recharge, and you ' +
      'gain a level — choose one of three boons for your class.',
  },
  levelup: {
    title: 'Level up',
    text:
      'Each descent you pick one of three boons drawn from your class: a stat bump, ' +
      'a new card, or a rule-changing power. Build toward the run you want.',
  },
  // Terrain tips fire the first time each type comes into view.
  'terrain-wall': {
    title: 'Walls',
    text: 'Stone walls block movement AND line of sight, and cannot be leapt over. Route around them — and beware what they hide.',
  },
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
      'You cannot cross lava — but ENEMIES can wade right through it, so it shields ' +
      'them, not you. Leapers on either side jump over it, and it does not block ' +
      'sight.',
  },
};

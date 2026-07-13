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
      'It holds still until you strike it or step adjacent, then hunts. SLAY it (each ' +
      'hit chips the bar) to descend AND earn a level-up boon. You can also bait it ' +
      'off the stair and slip past — but then you descend with NO boon and stay weak.',
  },
  danger: {
    title: 'The longer you linger...',
    text:
      'Danger climbs the more turns you spend on a floor — enemies spawn faster and ' +
      'faster (watch the Turn counter redden). When it flashes amber-and-red you have ' +
      'lingered to the limit and foes now pour in twice as fast. Don’t dawdle: find ' +
      'the stairs.',
  },
  key: {
    title: 'The floor key',
    text:
      'That glinting key unlocks the stair down. WALK ONTO it to pick it up — until you ' +
      'do, the stair stays sealed. It is always tucked well away from the stair, so you ' +
      'will have to explore the floor to reach it.',
  },
  stairLocked: {
    title: 'A sealed stair',
    text:
      'The stair down is SEALED until you collect this floor’s key — find the key first, ' +
      'then step onto the stair. (A guardian also holds the stair; slay it to earn your ' +
      'level-up boon on the way down.)',
  },
  exit: {
    title: 'Descending',
    text:
      'Step onto the stair to descend — you fully heal and your cards recharge. But a ' +
      'level-up boon comes ONLY from slaying the guardian first; slip past it and you ' +
      'descend empty-handed.',
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
      'not block sight. (Winged Boots makes you immune to the burning.)',
  },
};

// Tutorial tip copy, keyed by id. Each tip is shown once (per "seen" record)
// the first time its in-game trigger fires. Pure data — no logic here.

const TUTORIALS = {
  welcome: {
    title: 'Long live the King',
    text:
      'Move the king with WASD, the diagonals Q E Z X, the numpad, or by clicking ' +
      'a highlighted tile. Pan the camera with the arrow keys or by nudging the ' +
      'mouse to a screen edge, and zoom with the mouse wheel or Page Up / Page ' +
      'Down. You see only a short distance, and unexplored ground is shrouded in ' +
      'fog of war until you reach it — explore to find the stairs down. Buy Keen ' +
      'Eyes at a shop to see farther.',
  },
  surprise: {
    title: 'Caught by surprise',
    text:
      'An enemy marked with a ! has just spotted you. It is frozen in surprise ' +
      'for one turn before it begins to hunt — use that turn to your advantage.',
  },
  knight: {
    title: 'Knights leap',
    text:
      'Knights move in an L: two squares one way and one across, jumping over ' +
      'anything between. Their threat squares can be easy to overlook.',
  },
  threat: {
    title: 'Danger squares',
    text:
      'Red tiles mark where visible enemies could capture you next turn. The ' +
      'deeper the red, the more enemies cover that square — never step there.',
  },
  hp: {
    title: 'Taking damage',
    text:
      'That strike cost you 1 HP. Lose every heart and the run is over. Collect ' +
      '♥ hearts to recover, and you also mend 1 HP each time you descend.',
  },
  gold: {
    title: 'Gold',
    text:
      'Gold is spent at weapon shops ($) on cards. You also earn a little for ' +
      'every enemy piece you capture.',
  },
  heart: {
    title: 'Hearts',
    text: 'Hearts restore 1 HP, up to your maximum. Grab them before an enemy tramples them!',
  },
  altar: {
    title: 'The altar',
    text:
      'Altars grant one free blessing — more max HP, sharper sight, faster healing ' +
      'on descent, or another card slot — then fall dormant. Choose wisely.',
  },
  weaponShop: {
    title: 'The weapon shop',
    text:
      'Weapon shops sell cards in the form of enemies you have seen. A card lets ' +
      'the king move (and capture) like that piece once, then recharges over a few ' +
      'turns. Click a ready card below the board, then click where to strike. Buy ' +
      'more card slots at altars.',
  },
  exit: {
    title: 'Descending',
    text:
      'These stairs lead to the next floor. Deeper floors grow more dangerous, ' +
      'but the king recovers 1 HP on the way down.',
  },
  finalFloor: {
    title: 'The enemy king',
    text:
      'This floor holds the solo enemy king (♚) instead of an exit. Hunt it down ' +
      'and capture it to win. It strikes back, so approach with care.',
  },
  newGamePlus: {
    title: 'New Game +',
    text:
      'The realm runs deeper than one king. Stranger pieces now appear — berolina ' +
      'pawns, camels, and the great compound pieces (archbishop, chancellor, ' +
      'amazon) — and another enemy king waits below. How far can you descend?',
  },
  danger: {
    title: 'The longer you linger...',
    text:
      'Danger climbs the more turns you spend on a floor — enemies spawn faster ' +
      'and faster (watch the Turn counter redden), peaking after about 100 turns. ' +
      'Don’t dawdle: find the stairs and press on.',
  },

  // Terrain tips fire the first time each hazard type comes into view. Their ids
  // match `terrain-<type>` so the renderer/controller can map a tile to its tip.
  'terrain-wall': {
    title: 'Walls',
    text:
      'Stone walls block movement and line of sight, and cannot be leapt over. ' +
      'Route around them — and beware what they might be hiding.',
  },
  'terrain-water': {
    title: 'Water',
    text:
      'Deep water is impassable — you cannot wade in. It does not block your ' +
      'sight, though, and leapers can still jump clean over it.',
  },
  'terrain-mud': {
    title: 'Mud',
    text:
      'You may slog across at most two mud tiles in a single move. A leap clears ' +
      'mud entirely.',
  },
  'terrain-ice': {
    title: 'Ice',
    text:
      'You cannot stop on ice. Step onto it and you slide in that direction ' +
      'until you hit a wall, a unit, or solid ground.',
  },
  'terrain-mist': {
    title: 'Mist',
    text:
      'Mist is passable but blocks line of sight, concealing whatever stands ' +
      'within it. Step carefully — an enemy could be lurking inside.',
  },
};

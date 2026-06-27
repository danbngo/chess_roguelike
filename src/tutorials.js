// Tutorial tip copy, keyed by id. Each tip is shown once (per "seen" record)
// the first time its in-game trigger fires. Pure data — no logic here.

const TUTORIALS = {
  welcome: {
    title: 'Long live the King',
    text:
      'Move with WASD or the arrow keys, the diagonals Q E Z X, the numpad, ' +
      'or by clicking a highlighted tile. You only see an 8×8 window around ' +
      'you — explore to find the stairs down.',
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
      'Gold is spent at shops ($) on upgrades. You also earn a little for every ' +
      'enemy piece you capture.',
  },
  heart: {
    title: 'Hearts',
    text: 'Hearts restore 1 HP, up to your maximum. Grab them before an enemy tramples them!',
  },
  shop: {
    title: 'The shop',
    text:
      'Spend gold here on upgrades: extra hearts, a quick heal, a longer stride, ' +
      'or the knight leap. Leave the shop when you are done.',
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
      'This is the final floor — there is no exit. Hunt down and capture the ' +
      'black enemy king (♚) to win. It strikes back, so approach with care.',
  },
};

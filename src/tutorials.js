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
      'That strike cost you 1 HP. Lose every point and the run is over. Drink ' +
      'potions to recover, and you also mend a little each time you descend.',
  },
  gold: {
    title: 'Gold & the descend reward',
    text:
      'Gold is no longer strewn about — instead each floor holds a purse you claim ' +
      'by reaching the stair, and it shrinks about 1% every turn you linger (watch ' +
      'the "Descend reward" in the panel). Capturing foes still pays a little. ' +
      'Spend gold at weapon, equipment, and potion shops.',
  },
  potionShop: {
    title: 'The apothecary',
    text:
      'Buy potions and scrolls here into your satchel, then use them later by ' +
      'clicking them in the panel (costs a turn). Healing / Mending / Barkskin ' +
      'mend, recharge, and shield you. Scrolls bend space: a Fog Scroll blinds the ' +
      'area, Invisibility hides you, a Teleport Scroll flings you anywhere, and a ' +
      'Blink Scroll lets you click a visible tile to hop to. The Alchemist class ' +
      'empowers potions and makes them free to use.',
  },
  consumable: {
    title: 'Potions',
    text:
      'Potions are one-use boons — healing (full HP), mending (recharge every ' +
      'card), or barkskin (a few turns of invincibility). They are scarce, and ' +
      'an enemy will trample one left in the open, so grab them while you can.',
  },
  classAltar: {
    title: 'Class altars',
    text:
      'Class altars let you embrace a play-style — Warrior, Barbarian, Thief, ' +
      'Ranger, Mage, or Witch. Each grants one rule-changing perk, and you must ' +
      'climb a class in order (level 2 needs level 1). An altar always offers the ' +
      'next rung of your strongest class, so a build keeps growing. Perks weave ' +
      'into your weapons, movement, and sight — mix classes or specialise deep.',
  },
  weaponShop: {
    title: 'The weapon shop',
    text:
      'Weapon shops sell cards in the form of enemies you have seen. A card lets ' +
      'the king move (and capture) like that piece once, then recharges over a few ' +
      'turns. Click a ready card below the board, then click where to strike.',
  },
  exit: {
    title: 'Descending',
    text:
      'These stairs lead to the next floor. Deeper floors grow more dangerous, ' +
      'but the king recovers 1 HP on the way down.',
  },
  enemyKing: {
    title: 'An enemy king',
    text:
      'Enemy kings (♚) are common, weak foes — they shuffle one tile at a time. ' +
      'Capture them like any other piece; there is no boss to slay, only how deep ' +
      'you can descend.',
  },
  newGamePlus: {
    title: 'New Game +',
    text:
      'The realm runs deeper than one king. Stranger pieces now appear — berolina ' +
      'berolina pawns and the great compound pieces (archbishop, chancellor) — ' +
      'and the dungeon runs ever deeper. How far can you descend?',
  },
  statue: {
    title: 'Statues',
    text:
      'A statue stands inert and cannot be captured — until the king steps onto ' +
      'a neighbouring tile, when it cracks to life and joins the hunt. They lurk ' +
      'at random and often stand guard beside stairs and shops.',
  },
  turret: {
    title: 'Turrets',
    text:
      'A turret is a fixed emplacement that cannot be moved or destroyed. Each ' +
      'turn it fires along its piece’s pattern (its red threat tiles), striking ' +
      'the king if he stands in the line. Stay off the red and slip past.',
  },
  mage: {
    title: 'Mages',
    text:
      'A mage (violet cap) fires a piercing bolt down its line on odd turns — a ' +
      'rook-mage along ranks and files, a bishop-mage along diagonals. The bolt ' +
      'slays EVERY unit between it and you (even its own kin), then strikes you. ' +
      'Break its line of fire, or put a wall between you.',
  },
  skirmisher: {
    title: 'Skirmishers',
    text:
      'A skirmisher (amber cap) strikes from a clear firing line on odd turns, ' +
      'then bounds back to where it started. Unlike a mage its shot is blocked by ' +
      'anything in the way — keep a unit between you and it, or close the gap.',
  },
  armored: {
    title: 'Armored foes',
    text:
      'An armored piece (steel cap) shrugs off your first blow — the hit only ' +
      'shatters its armor, and the recoil hurls you back to where you entered the ' +
      'floor. It then fights on as an ordinary piece.',
  },
  mounted: {
    title: 'Mounted foes',
    text:
      'A mounted piece (bronze cap) charges you down — it barrels INTO your tile ' +
      'and tramples you back a square. If the space behind you is blocked, it ' +
      'strikes as an ordinary piece instead. Leapers are never mounted.',
  },
  flying: {
    title: 'Flying foes',
    text:
      'A flying piece (sky-blue cap) soars over any terrain but stone walls — ' +
      'water, lava, mud, brush and ice mean nothing to it. Only a wall (or ' +
      'another unit) will halt its line.',
  },
  summoner: {
    title: 'Summoners',
    text:
      'A summoner (violet cap) conjures fresh minions beside it on odd turns and ' +
      'never strikes you itself. Its summoned pieces wink out once no summoner is ' +
      'in sight — so cut down the summoner and its brood goes with it.',
  },
  boss: {
    title: 'The floor guardian',
    text:
      'A crowned boss guards the way down. It is invulnerable while any of its ' +
      'guards still stand in your sight (a blue ring). Clear the guards, and the ' +
      'ring turns gold — then strike it down to open the descent.',
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
      'sight, though; leapers jump clean over it and flyers soar across.',
  },
  'terrain-lava': {
    title: 'Lava',
    text:
      'Molten rock scars the demon depths. You cannot cross it — but demonic ' +
      'foes wade through unharmed, and flyers pass over it. Keep it between you ' +
      'and them where you can.',
  },
  'terrain-trees': {
    title: 'Trees',
    text:
      'A stand of trees blocks line of sight — neither you nor your foes can see ' +
      'through it — but you may walk right through. Use the cover to break a ' +
      'mage’s bolt or slip past a sentry.',
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
};

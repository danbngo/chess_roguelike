# Chess Dungeon

A browser-based **chess-piece roguelike**, built in vanilla HTML5 Canvas + JavaScript — no
frameworks, no build step, no external assets. You play a lone king descending an eight-floor
dungeon: each floor's stair is sealed until you claim its key from the guardian that stands on it,
while shifting terrain and a quickening tide of hostile events turn the floor against you.

## Play
- Move the king with **WASD**, diagonals **Q E Z X**, the numpad, or by **clicking** a highlighted tile.
- Pan with the **arrow keys** or the screen edges; **zoom** with the mouse wheel.
- Weapon/ability **cards** are played from the left bar (click, then click a target).
- **Goal:** find and step on each floor's **key** to unlock the stair, descend, and on the final floor
  seize the **Orb of Victory** and escape through the portal.
- **Hover** any tile or piece for a full description. **F2** saves a PNG screenshot of the board.
- Pick a **class** (Warrior / Ranger / Sorcerer) and a **difficulty** at the start; slaying a floor
  guardian grants a boon from your class's tiered perk chains.

## Run locally
Any static server works, e.g.:

```
python -m http.server 8000
```

then open <http://127.0.0.1:8000/>. (It also runs by opening `index.html` directly.)

## Tests
`npm test` runs the turn-logic test suite (Node's built-in test runner).

## Publishing
The playable build is just `index.html`, `styles.css`, and `src/`. Zip those with `index.html` at
the **top level** and upload to itch.io as an HTML project. The `tests/`, `*.md` docs, and
`package.json` are dev-only and don't need to ship.

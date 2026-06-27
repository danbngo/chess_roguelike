# chess_roguelike

A browser-based chess roguelike prototype built with HTML canvas.

## How to play
- Move the king with the arrow keys or WASD.
- The game shows an 8x8 view around the king, like a chessboard window.
- Each time you move, one enemy piece gets a turn.
- Defeat enemies to gain score, and avoid taking too many hits.

## Run locally
- Start a local server from the project folder:
  - `python -m http.server 8000`
- Open http://127.0.0.1:8000/ in a browser.

## Tests
- Run `npm test` to verify the turn logic.

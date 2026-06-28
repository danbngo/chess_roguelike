// Keyboard mapping. Resolves a key event to a [dx, dy] step, or null.

// Numpad keys map to their physical 3x3 layout (event.code, so Num Lock is irrelevant).
const NUMPAD_MOVES = {
  Numpad7: [-1, -1],
  Numpad8: [0, -1],
  Numpad9: [1, -1],
  Numpad4: [-1, 0],
  Numpad6: [1, 0],
  Numpad1: [-1, 1],
  Numpad2: [0, 1],
  Numpad3: [1, 1],
};

// WSADQEZX move the king; the arrow keys are reserved for panning the camera.
const KEY_MOVES = {
  w: [0, -1],
  s: [0, 1],
  a: [-1, 0],
  d: [1, 0],
  // Diagonals around WASD.
  q: [-1, -1],
  e: [1, -1],
  z: [-1, 1],
  x: [1, 1],
};

// Arrow keys pan the camera rather than moving the king.
const PAN_KEYS = {
  arrowup: [0, -1],
  arrowdown: [0, 1],
  arrowleft: [-1, 0],
  arrowright: [1, 0],
};

function resolveMove(event) {
  return NUMPAD_MOVES[event.code] ?? KEY_MOVES[event.key.toLowerCase()] ?? null;
}

// Returns a [dx, dy] pan direction for arrow keys, or null.
function resolvePan(event) {
  return PAN_KEYS[event.key.toLowerCase()] ?? null;
}

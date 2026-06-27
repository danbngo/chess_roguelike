// Single-slot save/load backed by localStorage. All access is guarded so a
// blocked or full store (private mode, quota) fails quietly instead of crashing.

function hasSave() {
  try {
    return Boolean(localStorage.getItem(SAVE_KEY));
  } catch {
    return false;
  }
}

function saveGame(state) {
  if (!state || state.gameOver) {
    return;
  }
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    return parsed && parsed.player && Array.isArray(parsed.enemies) ? parsed : null;
  } catch {
    return null;
  }
}

function clearSave() {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    /* ignore */
  }
}

/* ----------------------------- tutorial prefs ----------------------------- */

const TUTORIAL_ENABLED_KEY = 'chess-roguelike-tutorial-enabled';
const TUTORIAL_SEEN_KEY = 'chess-roguelike-tutorial-seen';

// Tips are on by default; only an explicit opt-out turns them off.
function tutorialsEnabled() {
  try {
    return localStorage.getItem(TUTORIAL_ENABLED_KEY) !== 'false';
  } catch {
    return true;
  }
}

function setTutorialsEnabled(enabled) {
  try {
    localStorage.setItem(TUTORIAL_ENABLED_KEY, enabled ? 'true' : 'false');
  } catch {
    /* ignore */
  }
}

function readSeenTips() {
  try {
    const raw = localStorage.getItem(TUTORIAL_SEEN_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function tipSeen(id) {
  return readSeenTips().includes(id);
}

function markTipSeen(id) {
  try {
    const seen = readSeenTips();
    if (!seen.includes(id)) {
      seen.push(id);
      localStorage.setItem(TUTORIAL_SEEN_KEY, JSON.stringify(seen));
    }
  } catch {
    /* ignore */
  }
}

function resetSeenTips() {
  try {
    localStorage.removeItem(TUTORIAL_SEEN_KEY);
  } catch {
    /* ignore */
  }
}

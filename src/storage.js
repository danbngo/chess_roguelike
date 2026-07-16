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
    if (!(parsed && parsed.player && Array.isArray(parsed.enemies))) {
      return null;
    }
    rehydratePerkText(parsed); // refresh rolled perk wording from the live class defs (post-patch)
    return parsed;
  } catch {
    return null;
  }
}

// A perk's NAME/DESCRIPTION is definition data, not save data — but the whole state (including the
// rolled level-up choices) is serialized, so a save taken before a balance patch can carry stale
// wording. Re-point each stored choice at its CURRENT class definition, matched by id, on load.
function rehydratePerkText(state) {
  const cls = (typeof CLASSES !== 'undefined') && state.player && CLASSES[state.player.className];
  if (!cls || !Array.isArray(state.levelPerks)) {
    return;
  }
  state.levelPerks = state.levelPerks.map((perk) => cls.perks.find((k) => k.id === (perk && perk.id)) || perk);
}

function clearSave() {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    /* ignore */
  }
}

/* ------------------------------ run history ------------------------------- */

// A persistent table of finished runs, newest first. Each entry records the
// final score, depth reached, turns taken, whether the run was won, and when it
// ended. The list is capped so the store can't grow without bound.
const SCORES_KEY = 'chess-roguelike-scores-v1';
const SCORES_MAX = 50;

function readRunScores() {
  try {
    const raw = localStorage.getItem(SCORES_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Append a finished run and persist. Returns the stored entry (with its id /
// timestamp filled in) so the caller can highlight it in the table.
function recordRunScore(entry) {
  const record = {
    score: Math.max(0, Math.round(entry.score || 0)),
    floor: entry.floor || 1,
    turns: entry.turns || 0,
    won: Boolean(entry.won),
    date: Date.now(),
    id: `run-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
  };
  try {
    const scores = readRunScores();
    scores.unshift(record);
    localStorage.setItem(SCORES_KEY, JSON.stringify(scores.slice(0, SCORES_MAX)));
  } catch {
    /* ignore */
  }
  return record;
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

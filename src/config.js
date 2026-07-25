// BUILD CONFIG. Small, deliberately dependency-free, and loaded FIRST — before constants.js — so
// anything else may read it at definition time.
//
// This is the one file you edit to change how a build behaves rather than what the game is. Keep it
// to switches: no game rules, no tables, nothing another file needs to stay in sync with.
const CONFIG = {
  // THE DEBUG MENU. Adds a "Debug" button to the title screen that warps straight into the New
  // Game+ portal room with a finished king — a nightmare clear's worth of perks, full hearts and the
  // Orb of Victory already on the shelf.
  //
  // It exists because reaching the portal room legitimately means winning a NIGHTMARE run first,
  // which is far too long a road to walk every time an NG+ floor needs looking at.
  //
  // >>> SET THIS TO false BEFORE SHIPPING TO ITCH. <<<
  // Nothing else gates it: the button is drawn if and only if this is true.
  debugMenu: false,

  // NEW GAME+. When false, winning the game just shows the victory screen and returns to the title —
  // the "Continue" button (into the portal room and its NG+ realms) is never offered. Set false to
  // ship the base game without the unfinished NG+ content behind the win screen.
  //
  // Only gates the DOOR. The realms, the portal room and the debug warp all still exist and work; a
  // player simply has no in-game route to them, so nothing else needs touching to hide them.
  newGamePlus: false,
};

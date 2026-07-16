// Procedural audio: one looping ambient music track plus short synthesized sound
// effects, all generated live with the Web Audio API so the game needs NO binary
// sound files (it still runs straight off the filesystem). A single mute toggle
// (persisted in localStorage) gates everything. Nothing plays until the first user
// gesture, since browsers block audio before that.

const GameAudio = (function () {
  const STORE_KEY = 'chess-roguelike-sound';
  let ctx = null;
  let master = null; // final output bus
  let sfxBus = null; // sound-effect volume
  let musicBus = null; // music volume
  let enabled = true;
  let unlocked = false; // has the first user gesture happened?
  let musicTimer = null;
  let nextNoteTime = 0;
  let step = 0;

  try {
    enabled = localStorage.getItem(STORE_KEY) !== 'off';
  } catch (e) {
    /* localStorage may be unavailable — default to on */
  }

  function AudioCtor() {
    return typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
  }

  // Lazily build the audio graph (master -> {sfx, music}). Returns the context, or
  // null when the Web Audio API is unavailable.
  function ensure() {
    if (ctx) return ctx;
    const AC = AudioCtor();
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.85;
    master.connect(ctx.destination);
    sfxBus = ctx.createGain();
    sfxBus.gain.value = 0.9;
    sfxBus.connect(master);
    musicBus = ctx.createGain();
    musicBus.gain.value = 0.5;
    musicBus.connect(master);
    return ctx;
  }

  // One enveloped oscillator note (optionally gliding to another pitch).
  function tone(freq, start, dur, o) {
    o = o || {};
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(Math.max(20, freq), start);
    if (o.slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.slideTo), start + dur);
    const peak = o.gain != null ? o.gain : 0.2;
    const atk = o.attack != null ? o.attack : 0.006;
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(peak, start + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(g);
    g.connect(o.bus || sfxBus);
    osc.start(start);
    osc.stop(start + dur + 0.03);
  }

  // A short burst of white noise that fades out (impacts / splashes).
  function noise(start, dur, gain) {
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = gain != null ? gain : 0.2;
    src.connect(g);
    g.connect(sfxBus);
    src.start(start);
    src.stop(start + dur + 0.02);
  }

  // Each effect schedules its voices starting at time t.
  const SFX = {
    attack(t) {
      tone(200, t, 0.09, { type: 'square', gain: 0.16, slideTo: 120 });
      noise(t, 0.05, 0.12);
    },
    hit(t) {
      tone(240, t, 0.2, { type: 'sawtooth', gain: 0.2, slideTo: 70 });
      noise(t, 0.12, 0.18);
    },
    deflect(t) {
      tone(900, t, 0.14, { type: 'triangle', gain: 0.16, slideTo: 1300 });
      noise(t, 0.04, 0.08);
    },
    kill(t) {
      tone(330, t, 0.12, { type: 'triangle', gain: 0.2, slideTo: 150 });
      tone(160, t + 0.05, 0.14, { type: 'square', gain: 0.14, slideTo: 90 });
      noise(t, 0.06, 0.15);
    },
    death(t) {
      tone(200, t, 0.7, { type: 'sawtooth', gain: 0.22, slideTo: 45 });
      noise(t, 0.2, 0.16);
    },
    cast(t) {
      tone(320, t, 0.22, { type: 'sine', gain: 0.15, slideTo: 760 });
      tone(480, t, 0.22, { type: 'triangle', gain: 0.06, slideTo: 1140 });
    },
    pickup(t) {
      tone(660, t, 0.09, { type: 'sine', gain: 0.16 });
      tone(990, t + 0.08, 0.12, { type: 'sine', gain: 0.16 });
    },
    buy(t) {
      tone(523.25, t, 0.1, { type: 'triangle', gain: 0.16 });
      tone(783.99, t + 0.09, 0.14, { type: 'triangle', gain: 0.16 });
    },
    quaff(t) {
      tone(400, t, 0.18, { type: 'sine', gain: 0.14, slideTo: 820 });
      noise(t, 0.05, 0.05);
    },
    descend(t) {
      [440, 349.23, 261.63].forEach((f, i) => tone(f, t + i * 0.13, 0.22, { type: 'triangle', gain: 0.18 }));
    },
    win(t) {
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, t + i * 0.12, 0.24, { type: 'triangle', gain: 0.2 }));
      [523.25, 659.25, 783.99].forEach((f) => tone(f, t + 0.5, 0.75, { type: 'triangle', gain: 0.12 }));
    },
    // A slow, dull, ominous low swell — the floor turning against the king (a danger event). No
    // percussive crack (that read as a "hit"); just a soft rising dread.
    doom(t) {
      tone(68, t, 1.2, { type: 'sine', gain: 0.17, slideTo: 46, attack: 0.28 });
      tone(102, t + 0.05, 1.05, { type: 'sine', gain: 0.08, slideTo: 68, attack: 0.32 });
      tone(137, t + 0.1, 0.9, { type: 'triangle', gain: 0.045, slideTo: 94, attack: 0.32 });
    },
    // A hollow SWOOSH / power-down — a summoning circle collapsing as the king steps onto it.
    unsummon(t) {
      tone(520, t, 0.5, { type: 'sine', gain: 0.13, slideTo: 90, attack: 0.02 });
      tone(340, t + 0.02, 0.55, { type: 'triangle', gain: 0.07, slideTo: 70 });
      noise(t, 0.28, 0.05);
    },
    // A triumphant FANFARE when a floor guardian falls — a rising arpeggio into a held major chord.
    fanfare(t) {
      [392.00, 523.25, 659.25, 783.99].forEach((f, i) => tone(f, t + i * 0.09, 0.2, { type: 'triangle', gain: 0.17 }));
      [523.25, 659.25, 783.99].forEach((f) => tone(f, t + 0.4, 0.7, { type: 'triangle', gain: 0.14 }));
      tone(261.63, t + 0.4, 0.7, { type: 'sine', gain: 0.11 }); // bass root
    },
  };

  function play(name) {
    if (!enabled || !unlocked || !ensure()) return;
    if (ctx.state === 'suspended') ctx.resume();
    const fn = SFX[name];
    if (fn) fn(ctx.currentTime + 0.01);
  }

  // --- Ambient music: a slow arpeggio over a shifting bass, looped forever. ---
  // Each SCREEN gets its own short track (see setTrack): the title theme, a warm theme at the
  // altar, a lament on death, and the exploring loop — which swaps to a darker, faster,
  // tritone-laden variant with a throbbing bass once `tense` is set (danger is high).
  let track = 'explore';
  let tense = false;
  let dangerStep = 0;
  const ARP = [0, 1, 2, 1, 0, 1, 2, 1];
  // The in-play score HURRIES in gears as the floor's dread climbs — the same tune, wound tighter —
  // so the urgency of getting off the floor is audible. Beat multipliers (lower = faster), one per
  // fifth of the dread meter. Only the exploring/tense loop hurries; screen themes keep their tempo.
  // Tempo gears, one per step of the dread cycle. Gear 0 is the GRACE — no hurry at all — and the
  // five below it are the five climbing steps, so every dread step has its own audibly faster
  // tempo. Length must stay DREAD_RAMP_STEPS + 1.
  const HURRY = [1, 0.9, 0.8, 0.71, 0.63, 0.55];
  const TRACKS = {
    // Exploring: a calm, wandering minor loop (Am–F–G–Em).
    explore: {
      beat: 0.34,
      prog: [[220.0, 261.63, 329.63], [174.61, 261.63, 349.23], [196.0, 246.94, 293.66], [164.81, 207.65, 246.94]],
      type: 'triangle', gain: 0.05, bass: 0.07,
    },
    // Danger: the same pulse turned tritone-laden and dark, with an insistent low throb driving the
    // dread home. Its TEMPO comes from the HURRY gears above, like the calm loop's.
    tense: {
      beat: 0.34,
      prog: [[174.61, 246.94, 293.66], [155.56, 220.0, 277.18], [164.81, 233.08, 311.13], [146.83, 207.65, 246.94]],
      type: 'triangle', gain: 0.05, bass: 0.07, throb: true,
    },
    // Title / character select: deliberately UNLIKE anything in the dungeon — far-off sine BELLS two
    // octaves up over a deep sustained drone, slow and cavernous. The dungeon waiting for you.
    title: {
      beat: 0.5,
      prog: [[220.0, 261.63, 329.63], [196.0, 246.94, 293.66], [174.61, 220.0, 261.63], [164.81, 207.65, 246.94]],
      type: 'sine', gain: 0.045, bass: 0.09, octave: 4, drone: true,
    },
    // The altar (choosing a boon) / victory: a bright, hopeful major turn (C–G–Am–F).
    altar: {
      beat: 0.30,
      prog: [[261.63, 329.63, 392.0], [196.0, 246.94, 293.66], [220.0, 261.63, 329.63], [174.61, 220.0, 261.63]],
      type: 'sine', gain: 0.06, bass: 0.06,
    },
    // Death: a full LAMENT on a descending ground bass — A-G-F-E-D-C-B falling step by step, then
    // the dominant E turning it back to the top to begin again. Eight chords, not four: it used to
    // be the title's own progression an octave down, which is exactly why it rang hollow. A bell
    // tolls over each chord and the high voice sighs down across it.
    death: {
      beat: 0.66,
      prog: [
        [220.0, 261.63, 329.63], // Am  — the fall begins
        [196.0, 246.94, 293.66], // G
        [174.61, 220.0, 261.63], // F
        [164.81, 207.65, 246.94], // E
        [146.83, 174.61, 220.0], // Dm
        [130.81, 164.81, 196.0], // C
        [123.47, 146.83, 174.61], // Bdim — the darkest step
        [164.81, 207.65, 246.94], // E   — the dominant, pulling it round again
      ],
      type: 'sine', gain: 0.06, bass: 0.08, sigh: true, toll: true, octave: 1, // sunk an octave — low and mournful
    },
  };

  // The track actually playing: `tense` only darkens the exploring loop, never the screen themes.
  function current() {
    return TRACKS[track === 'explore' && tense ? 'tense' : track] || TRACKS.explore;
  }

  // The in-play loop speeds up a gear at a time with the floor's dread; the title / altar / death
  // themes always keep their own tempo.
  function beat() {
    const hurry = track === 'explore' ? (HURRY[dangerStep] || 1) : 1;
    return current().beat * hurry;
  }

  function scheduleStep(s, when) {
    const t = current();
    const chord = t.prog[Math.floor(s / ARP.length) % t.prog.length];
    const inChord = s % ARP.length;
    tone(chord[ARP[inChord]] * (t.octave || 2), when, t.beat * 0.9, { type: t.type, gain: t.gain, bus: musicBus });
    if (inChord === 0) {
      tone(chord[0] / 2, when, t.beat * ARP.length, { type: 'sine', gain: t.bass, bus: musicBus, attack: t.drone ? 0.5 : 0.08 });
      // A DRONE track lays a second, far deeper pad beneath the root — the cavernous title bed.
      if (t.drone) {
        tone(chord[0] / 4, when, t.beat * ARP.length, { type: 'triangle', gain: t.bass * 0.55, bus: musicBus, attack: 0.6 });
      }
      if (t.sigh) {
        // A high voice slides mournfully down over the chord — the sound of the run ending.
        tone(chord[2] * 2, when, t.beat * 3.2, { type: 'sine', gain: 0.04, bus: musicBus, slideTo: chord[0] * 2, attack: 0.25 });
      }
      if (t.toll) {
        // A bell struck over each chord and left to ring on into the next — sounded on the THIRD so
        // it colours the harmony rather than merely doubling the root the arp is already playing.
        tone(chord[1] * 2, when, t.beat * ARP.length * 1.3, { type: 'sine', gain: 0.03, bus: musicBus, attack: 0.004 });
      }
    }
    if (t.throb) {
      tone(chord[0] / 2, when, t.beat * 0.5, { type: 'sawtooth', gain: 0.045, bus: musicBus });
    }
  }

  function musicTick() {
    if (!ctx) return;
    while (nextNoteTime < ctx.currentTime + 0.15) {
      scheduleStep(step, nextNoteTime);
      nextNoteTime += beat();
      step += 1;
    }
  }

  // Switch the looping score by screen ('title' | 'explore' | 'altar' | 'death'). A no-op if it's
  // already playing, so callers may set it every frame. The new track starts at the top of its
  // phrase rather than cutting in mid-figure.
  function setTrack(name) {
    if (!TRACKS[name] || track === name) return;
    track = name;
    step = 0;
  }

  // Darken the EXPLORING loop once danger is high (a no-op if already in that mode).
  function setTension(on) {
    tense = Boolean(on);
  }

  // How far the floor's dread meter has CLIMBED (0..1 — already 0 through the opening grace; see
  // dreadFraction). Quantised into HURRY's gears so the score steps up audibly rather than drifting
  // imperceptibly. Gear 0 is reserved for the grace itself: the instant dread starts at all the
  // tempo ticks up, so the first stepup is the player's cue that the floor has turned.
  function setDanger(frac) {
    const f = Math.max(0, Math.min(1, Number(frac) || 0));
    // Dread hasn't started (the grace) — hold the calm tempo. The moment it starts at all, the
    // score steps up: that first gear change IS the cue that the floor has turned on the king.
    dangerStep = f <= 0 ? 0 : Math.min(HURRY.length - 1, 1 + Math.floor(f * (HURRY.length - 1)));
  }

  function startMusic() {
    if (!enabled || !unlocked || musicTimer || !ensure()) return;
    if (ctx.state === 'suspended') ctx.resume();
    nextNoteTime = ctx.currentTime + 0.12;
    musicTimer = setInterval(musicTick, 40);
  }

  function stopMusic() {
    if (musicTimer) {
      clearInterval(musicTimer);
      musicTimer = null;
    }
  }

  // Unlock audio on the first user gesture (required by browser autoplay policy).
  function unlock() {
    unlocked = true;
    if (!enabled || !ensure()) return;
    if (ctx.state === 'suspended') ctx.resume();
    startMusic();
  }
  if (typeof document !== 'undefined') {
    const once = () => {
      unlock();
      document.removeEventListener('pointerdown', once);
      document.removeEventListener('keydown', once);
    };
    document.addEventListener('pointerdown', once);
    document.addEventListener('keydown', once);
  }

  function isEnabled() {
    return enabled;
  }
  function setEnabled(on) {
    enabled = Boolean(on);
    try {
      localStorage.setItem(STORE_KEY, enabled ? 'on' : 'off');
    } catch (e) {
      /* ignore */
    }
    if (enabled) unlock();
    else stopMusic();
  }
  function toggle() {
    setEnabled(!enabled);
    return enabled;
  }

  return { play, startMusic, stopMusic, setTension, setTrack, setDanger, isEnabled, setEnabled, toggle };
})();

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
  };

  function play(name) {
    if (!enabled || !unlocked || !ensure()) return;
    if (ctx.state === 'suspended') ctx.resume();
    const fn = SFX[name];
    if (fn) fn(ctx.currentTime + 0.01);
  }

  // --- Ambient music: a slow arpeggio over a shifting bass, looped forever. ---
  const BEAT = 0.34;
  const PROG = [
    [220.0, 261.63, 329.63], // Am
    [174.61, 261.63, 349.23], // F
    [196.0, 246.94, 293.66], // G
    [164.81, 207.65, 246.94], // Em
  ];
  const ARP = [0, 1, 2, 1, 0, 1, 2, 1];

  function scheduleStep(s, when) {
    const chord = PROG[Math.floor(s / ARP.length) % PROG.length];
    const inChord = s % ARP.length;
    tone(chord[ARP[inChord]] * 2, when, BEAT * 0.9, { type: 'triangle', gain: 0.05, bus: musicBus });
    if (inChord === 0) {
      tone(chord[0] / 2, when, BEAT * ARP.length, { type: 'sine', gain: 0.07, bus: musicBus, attack: 0.08 });
    }
  }

  function musicTick() {
    if (!ctx) return;
    while (nextNoteTime < ctx.currentTime + 0.15) {
      scheduleStep(step, nextNoteTime);
      nextNoteTime += BEAT;
      step += 1;
    }
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

  return { play, startMusic, stopMusic, isEnabled, setEnabled, toggle };
})();

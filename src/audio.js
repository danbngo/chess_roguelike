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
  let sfxDuck = 1; // set by play() while a cue schedules itself — see the mixing notes below

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
    const peak = (o.gain != null ? o.gain : 0.2) * (o.bus === musicBus ? 1 : sfxDuck);
    const atk = o.attack != null ? o.attack : 0.006;
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(peak, start + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(g);
    g.connect(o.bus || sfxBus);
    osc.start(start);
    osc.stop(start + dur + 0.03);
  }

  // A burst of white noise that fades out (impacts / splashes). `o.filter` shapes it — which is the
  // ONLY thing separating a hiss from a rumble from a splash: they are all noise, and the band is
  // the character. `o.hold` keeps it flat instead of decaying (for a sustained hiss).
  function noise(start, dur, gain, o) {
    o = o || {};
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i += 1) {
      const env = o.hold ? Math.min(1, (1 - i / len) * 3) : (1 - i / len);
      data[i] = (Math.random() * 2 - 1) * env;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = (gain != null ? gain : 0.2) * sfxDuck;
    let node = src;
    if (o.filter) {
      const f = ctx.createBiquadFilter();
      f.type = o.filter;
      f.frequency.setValueAtTime(o.freq || 1000, start);
      if (o.sweepTo) f.frequency.exponentialRampToValueAtTime(Math.max(40, o.sweepTo), start + dur);
      f.Q.value = o.q || 1;
      node.connect(f);
      node = f;
    }
    node.connect(g);
    g.connect(o.bus || sfxBus);
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
    // A guardian's ROAR as it spots the king: a loud, blaring, angry rise — two detuned sawtooths
    // sliding UP against each other (the beating between them is what makes it sound furious rather
    // than merely loud), over a growling sub and a gout of noise.
    // A BELLOW, not a blow. The old one cracked in fast (attack 0.03) and slid UP (90 -> 190), which
    // is the exact shape of an impact — so a guardian's battle-cry read as somebody being punched.
    //
    // A bellow is the opposite in every respect: it SWELLS instead of cracking (a long attack, so
    // there is no transient to mistake for a hit), it FALLS instead of rising (a throat opening and
    // running out of air), and it is long enough to sit under the speech bubble rather than flick
    // past it. The pitch drop is what sells the size of the thing — big animals fall, small ones rise.
    roar(t) {
      tone(128, t, 1.15, { type: 'sawtooth', gain: 0.2, slideTo: 62, attack: 0.14 }); // the voice
      tone(129.6, t, 1.15, { type: 'sawtooth', gain: 0.15, slideTo: 62.8, attack: 0.15 }); // detuned against it: a chorus, a chest
      tone(64, t, 1.25, { type: 'square', gain: 0.13, slideTo: 31, attack: 0.16 }); // the octave below — the weight
      tone(192, t, 0.8, { type: 'sawtooth', gain: 0.06, slideTo: 94, attack: 0.2 }); // a fifth on top: rasp, not edge
      // Breath: a wide band that opens with the voice and closes with it. `hold` keeps it flat so it
      // swells WITH the tone rather than decaying away underneath it like an impact's dust.
      noise(t, 1.0, 0.075, { filter: 'bandpass', freq: 420, sweepTo: 130, q: 0.7, hold: true });
    },
    // A guardian's DYING WAIL — the mirror image of `roar`. The bellow swells and falls from a low
    // throat (a big thing filling its chest); the wail CRACKS in high and collapses, sliding down
    // hard and thinning as it goes, because a scream is a thing losing its grip rather than taking a
    // breath. Slightly shorter than the roar so death lands as a full stop, not another announcement.
    wail(t) {
      tone(340, t, 0.9, { type: 'sawtooth', gain: 0.18, slideTo: 88, attack: 0.02 }); // the cry, falling away
      tone(344, t, 0.9, { type: 'sawtooth', gain: 0.13, slideTo: 86, attack: 0.02 }); // detuned against it — a ragged throat
      tone(510, t, 0.55, { type: 'square', gain: 0.05, slideTo: 130, attack: 0.02 }); // a thin edge on top: pain, not size
      tone(170, t, 1.0, { type: 'sawtooth', gain: 0.09, slideTo: 44, attack: 0.03 }); // the octave under it — the body going down
      // Breath running OUT: a band that closes fast (no `hold`, unlike the roar's swelling gout).
      noise(t, 0.7, 0.06, { filter: 'bandpass', freq: 900, sweepTo: 160, q: 0.8 });
    },
    // A dull, low ERROR beep — "that did nothing, and it cost you nothing". Deliberately soft and
    // short: it fires on ordinary fumbles (walking into a wall, readying a weapon while wading), so
    // it must read as a nudge, never as a hit.
    nope(t) {
      tone(150, t, 0.1, { type: 'square', gain: 0.07, slideTo: 110 });
      tone(75, t + 0.05, 0.1, { type: 'square', gain: 0.05, slideTo: 62 });
    },
    // ---- TERRAIN & INCIDENT CUES --------------------------------------------------------------
    // A door pushed open: timber groaning on a dry hinge. The wobbling slide IS the creak.
    creak(t) {
      tone(160, t, 0.34, { type: 'sawtooth', gain: 0.05, slideTo: 92, attack: 0.05 });
      tone(240, t + 0.04, 0.26, { type: 'square', gain: 0.02, slideTo: 300 });
      noise(t, 0.3, 0.03, { filter: 'bandpass', freq: 700, q: 4 });
    },
    // A boulder starting to roll: low, gritty, and long — it is the heaviest thing on the floor.
    rumble(t) {
      tone(58, t, 0.55, { type: 'sawtooth', gain: 0.1, slideTo: 40, attack: 0.04 });
      noise(t, 0.5, 0.14, { filter: 'lowpass', freq: 320, sweepTo: 120, hold: true });
    },
    // Wading in: soft and fluid — a LOWPASS gulp with a low bloom under it, not a bright burst.
    // A bandpass at 1.5k read as a hiss/crackle: that is the sound of spray, not of a boot going
    // into water. Water is mostly low-mid, and it opens rather than snaps — hence the soft attack.
    splash(t) {
      noise(t, 0.3, 0.075, { filter: 'lowpass', freq: 900, sweepTo: 240 });
      tone(300, t, 0.17, { type: 'sine', gain: 0.05, slideTo: 150, attack: 0.025 });
      tone(175, t + 0.05, 0.2, { type: 'sine', gain: 0.032, slideTo: 105, attack: 0.035 }); // the low bloom
    },
    // Fire meeting flesh: a sustained band of white noise sliding up, no pitch at all.
    hiss(t) {
      noise(t, 0.45, 0.09, { filter: 'highpass', freq: 1400, sweepTo: 3800, hold: true });
      tone(2200, t, 0.2, { type: 'sine', gain: 0.015, slideTo: 3000 });
    },
    // A GEYSER venting: a soft, low breath of steam — deliberately NOT the `hiss` of fire on flesh.
    // Vents blow every third turn for a whole floor, so this is the most frequent sound in the game:
    // it is short, quiet and LOWPASSED (dull rather than bright), sitting under the mix instead of
    // competing with it. Paired with the lowest priority and a long debounce (see below), a field of
    // vents reads as one soft exhale rather than a wall of hissing.
    vent(t) {
      noise(t, 0.22, 0.032, { filter: 'lowpass', freq: 1000, sweepTo: 420 });
      tone(300, t, 0.13, { type: 'sine', gain: 0.011, slideTo: 200, attack: 0.035 });
    },
    // Pushing through tall grass — soft, brief, high.
    swish(t) {
      noise(t, 0.16, 0.05, { filter: 'highpass', freq: 2200, sweepTo: 900 });
    },
    // Going over the edge: a long tumbling drop, then a distant thud far below.
    fall(t) {
      tone(520, t, 0.55, { type: 'triangle', gain: 0.1, slideTo: 60 });
      tone(340, t + 0.03, 0.5, { type: 'sine', gain: 0.05, slideTo: 45 });
      tone(70, t + 0.55, 0.16, { type: 'sine', gain: 0.09, slideTo: 40 }); // it lands, a long way down
      noise(t + 0.55, 0.12, 0.05, { filter: 'lowpass', freq: 300 });
    },
    // A turret locking on: a whirring servo, two rising blips. It has ONE turn on him.
    // Dropped an octave and off the square wave — at 880/1180 with square's odd harmonics it was a
    // shrill smoke-detector beep that cut through the whole mix. A lock-on should sound like a
    // MECHANISM noticing you: lower, rounder, still unmistakable.
    alarm(t) {
      tone(420, t, 0.1, { type: 'triangle', gain: 0.1 });
      tone(560, t + 0.11, 0.13, { type: 'triangle', gain: 0.1 });
      tone(190, t, 0.26, { type: 'sawtooth', gain: 0.035, slideTo: 330 }); // the servo winding up
    },
    // Something solid giving way — rock or ice.
    crush(t) {
      noise(t, 0.16, 0.16, { filter: 'lowpass', freq: 1400, sweepTo: 400 });
      tone(120, t, 0.13, { type: 'square', gain: 0.08, slideTo: 55 });
    },
    // A shove landing: a soft, dull bonk. Deliberately quiet — it fires a LOT.
    bonk(t) {
      tone(190, t, 0.08, { type: 'sine', gain: 0.09, slideTo: 120 });
      noise(t, 0.04, 0.04, { filter: 'lowpass', freq: 800 });
    },
    // Something pulled into the world: a rising thrum with a beat in it (two close pitches
    // interfering), so a conjuring sounds like an EVENT and not just a note.
    // A conjuring WINDS UP: wu — wu — WU. Three pulses, each starting where the last left off and
    // climbing higher and louder, over a tone that rises the whole way and a bright ring as the
    // thing arrives.
    //
    // The old one was a single slow swell from 110Hz with a long attack — which is the shape of a
    // grunt, not a charge, and it landed as an "oof". A wind-up needs STEPS: the ear reads rising
    // repetition as energy gathering, where one smooth ramp just reads as a noise going up.
    thrum(t) {
      tone(140, t, 0.52, { type: 'triangle', gain: 0.05, slideTo: 560, attack: 0.05 }); // the climb underneath
      const steps = [[165, 262, 0.05], [262, 392, 0.07], [392, 660, 0.11]]; // wu / wu / WU
      steps.forEach(([from, to, g], i) => {
        const at = t + i * 0.1;
        tone(from, at, 0.13, { type: 'square', gain: g, slideTo: to, attack: 0.012 });
        tone(from * 1.012, at, 0.13, { type: 'square', gain: g * 0.55, slideTo: to * 1.012, attack: 0.012 }); // detuned: it shimmers
      });
      tone(880, t + 0.23, 0.24, { type: 'sine', gain: 0.05, slideTo: 1320, attack: 0.02 }); // it ARRIVES
    },
    // A tree coming DOWN: a splintering crack, then the whole crown crashing through itself into
    // the ground. Bigger and longer than `crush` (a rock giving way) — a felled tree is an event.
    timber(t) {
      tone(180, t, 0.1, { type: 'square', gain: 0.1, slideTo: 70 }); // the trunk cracks
      noise(t, 0.12, 0.1, { filter: 'bandpass', freq: 2600, q: 1.2 }); // splintering
      noise(t + 0.1, 0.5, 0.13, { filter: 'lowpass', freq: 1800, sweepTo: 300 }); // the crown coming through
      tone(60, t + 0.42, 0.22, { type: 'sine', gain: 0.11, slideTo: 38 }); // and it hits the floor
    },
    // A tree being CHIPPED — one axe blow that didn't fell it. Short, woody, clearly not the crash.
    chop(t) {
      tone(300, t, 0.06, { type: 'square', gain: 0.07, slideTo: 150 });
      noise(t, 0.05, 0.06, { filter: 'bandpass', freq: 1400, q: 2 });
    },
    // A triumphant FANFARE when a floor guardian falls — a rising arpeggio into a held major chord.
    fanfare(t) {
      [392.00, 523.25, 659.25, 783.99].forEach((f, i) => tone(f, t + i * 0.09, 0.2, { type: 'triangle', gain: 0.17 }));
      [523.25, 659.25, 783.99].forEach((f) => tone(f, t + 0.4, 0.7, { type: 'triangle', gain: 0.14 }));
      tone(261.63, t + 0.4, 0.7, { type: 'sine', gain: 0.11 }); // bass root
    },
  };

  // ---- MIXING: keeping a busy turn from becoming a cacophony ---------------------------------
  // A single turn can easily fire a dozen cues: a spell washes five foes (five kills), Explosive
  // Round hurls the ring (five bonks), two land in water (splash), one goes down a pit (fall), a
  // turret locks on (alarm). Played naively they arrive in the same millisecond, sum into clipping,
  // and the ONE cue that mattered — the king taking a hit — is buried.
  //
  // Three standard game-audio techniques, layered. None needs a mixer graph; they are all decisions
  // about what NOT to play:
  //
  //   1. PRIORITY CULLING. Every cue carries a rank. If something clearly more important is already
  //      speaking in this instant, the lesser cue is simply dropped. You never lose a death sting to
  //      a footstep. (Games call this voice stealing / priority-based voice allocation.)
  //   2. PER-CUE DEBOUNCE. A cue cannot retrigger within its own window. Five foes shoved at once
  //      make ONE bonk rather than five stacked into a clipped mess. Chosen per cue: a bonk repeats
  //      constantly and needs a long guard; a kill is rarer and needs almost none.
  //   3. VOICE-COUNT DUCKING. Each cue that starts alongside others is quieter than the last, so a
  //      busy turn gets DENSER rather than LOUDER. This is what stops the sum clipping.
  const PRIORITY = {
    death: 10, win: 10, roar: 10, wail: 10, hit: 9, fanfare: 8, doom: 8, descend: 8, // a guardian's bellow outranks a blow: it is the floor announcing itself
    deflect: 7, kill: 6, cast: 6, alarm: 6, fall: 6, unsummon: 5, thrum: 5,
    attack: 5, quaff: 5, pickup: 5, buy: 5, crush: 4, rumble: 4,
    timber: 6, splash: 3, hiss: 3, creak: 3, bonk: 3, chop: 3, nope: 2, swish: 1,
    vent: 1, // a geyser: the most frequent sound on a demon floor — it yields to everything else
  };
  // Milliseconds a cue must wait before it may sound again.
  const DEBOUNCE = {
    bonk: 110, swish: 160, splash: 130, hiss: 130, creak: 160, rumble: 170,
    vent: 400, // a whole FIELD of vents blowing at once is one soft exhale, never a stack of them
    crush: 90, thrum: 110, fall: 110, alarm: 140, nope: 220, attack: 40, chop: 60, timber: 200,
  };
  const WINDOW = 0.09; // seconds counted as "the same instant"
  let recent = []; // { t, pri } for cues started inside WINDOW
  const lastAt = {}; // cue -> when it last sounded

  function play(name) {
    if (!enabled || !unlocked || !ensure()) return;
    const fn = SFX[name];
    if (!fn) return;
    if (ctx.state === 'suspended') ctx.resume();
    const now = ctx.currentTime;
    // (2) DEBOUNCE — don't let a cue stack on itself.
    const gap = (DEBOUNCE[name] || 0) / 1000;
    if (gap && lastAt[name] != null && now - lastAt[name] < gap) return;
    recent = recent.filter((r) => now - r.t < WINDOW);
    const pri = PRIORITY[name] != null ? PRIORITY[name] : 5;
    // (1) PRIORITY — something well above this is already speaking; stay out of its way. The margin
    // means only a CLEARLY bigger cue silences one, so equals still layer.
    if (recent.length && pri < Math.max(...recent.map((r) => r.pri)) - 2) return;
    // (3) DUCK — the more voices in this instant, the quieter each one.
    sfxDuck = 1 / (1 + recent.length * 0.5);
    recent.push({ t: now, pri });
    lastAt[name] = now;
    fn(now + 0.01);
    sfxDuck = 1;
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
      type: 'triangle', gain: 0.05, bass: 0.075, bassType: 'sine', // a round, woody bass under the triangle arp
    },
    // Danger: the same pulse turned tritone-laden and dark, with an insistent low throb driving the
    // dread home. Its TEMPO comes from the HURRY gears above, like the calm loop's.
    tense: {
      beat: 0.34,
      prog: [[174.61, 246.94, 293.66], [155.56, 220.0, 277.18], [164.81, 233.08, 311.13], [146.83, 207.65, 246.94]],
      type: 'triangle', gain: 0.05, bass: 0.075, bassType: 'sawtooth', throb: true, // the bass grows teeth when the floor turns
    },
    // HELL (floors 5+): the exploring loop's sibling, dragged down into the pit. Same wandering
    // shape so the floor still feels like the same game — but a semitone-clashing minor progression
    // (Fm–C#dim–Bbm–C7), everything sunk an octave, a SAWTOOTH arp instead of the soft triangle, and
    // the tense loop's throb underneath. It is not a different tune; it is the same tune, and
    // something has got at it.
    hell: {
      beat: 0.36,
      prog: [
        [174.61, 207.65, 261.63], // Fm
        [138.59, 164.81, 196.00], // C#dim — the semitone slide down that makes it wrong
        [116.54, 138.59, 174.61], // Bbm
        [130.81, 164.81, 233.08], // C7 — a tritone in it, hauling back to the top
      ],
      type: 'sawtooth', gain: 0.038, bass: 0.085, bassType: 'sawtooth', throb: true, octave: 1,
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
      type: 'sine', gain: 0.06, bass: 0.065, bassType: 'triangle', // a soft, bowed bass under the bright turn
    },
    // Death: a full LAMENT on a descending ground bass — A-G-F-E-D-C-B falling step by step, then
    // the dominant E turning it back to the top to begin again. Eight chords, not four: it used to
    // be the title's own progression an octave down, which is exactly why it rang hollow. A bell
    // tolls over each chord.
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
      type: 'sine', gain: 0.06, bass: 0.085, bassType: 'triangle', toll: true, octave: 1, // sunk an octave — low and mournful
    },
  };

  // The track actually playing: `tense` only darkens the exploring loop, never the screen themes.
  function current() {
    // In HELL the tense variant is the hell loop itself — it is already the dark one, and swapping to
    // the mortal `tense` track down there would jump you back UP out of the pit at the worst moment.
    if (track === 'hell') return TRACKS.hell;
    return TRACKS[track === 'explore' && tense ? 'tense' : track] || TRACKS.explore;
  }

  // The in-play loop speeds up a gear at a time with the floor's dread; the title / altar / death
  // themes always keep their own tempo.
  function beat() {
    const hurry = (track === 'explore' || track === 'hell') ? (HURRY[dangerStep] || 1) : 1;
    return current().beat * hurry;
  }

  function scheduleStep(s, when) {
    const t = current();
    const chord = t.prog[Math.floor(s / ARP.length) % t.prog.length];
    const inChord = s % ARP.length;
    tone(chord[ARP[inChord]] * (t.octave || 2), when, t.beat * 0.9, { type: t.type, gain: t.gain, bus: musicBus });
    // ---- THE BASS: a second instrument, not a pad -------------------------------------------
    // It used to be ONE note — the chord root, held flat under the whole bar. That is a drone, and
    // with the arp running the same four chords over it the whole score read as a single voice
    // playing four notes forever. A bass should WALK: sparse, slow, and moving.
    //
    // So: root on the downbeat, the FIFTH halfway through, each held half a bar. Two notes to the
    // arp's eight — the usual bass job — in its own timbre (`bassType`), so it separates from the
    // melody instead of thickening it. A DRONE track (the title bed) is exempt: its flat, endless
    // pad IS its identity.
    const halfBar = ARP.length / 2;
    if (inChord === 0) {
      tone(chord[0] / 2, when, t.beat * (t.drone ? ARP.length : halfBar * 0.94), {
        type: t.drone ? 'sine' : (t.bassType || 'triangle'), gain: t.bass, bus: musicBus, attack: t.drone ? 0.5 : 0.03,
      });
      // A DRONE track lays a second, far deeper pad beneath the root — the cavernous title bed.
      if (t.drone) {
        tone(chord[0] / 4, when, t.beat * ARP.length, { type: 'triangle', gain: t.bass * 0.55, bus: musicBus, attack: 0.6 });
      }
      if (t.toll) {
        // A bell struck over each chord and left to ring on into the next — sounded on the THIRD so
        // it colours the harmony rather than merely doubling the root the arp is already playing.
        tone(chord[1] * 2, when, t.beat * ARP.length * 1.3, { type: 'sine', gain: 0.03, bus: musicBus, attack: 0.004 });
      }
    }
    // The walk: up to the FIFTH for the second half of the bar. This is the whole reason the score
    // now has two voices rather than one — the bass moves against the arp instead of sitting under it.
    if (inChord === halfBar && !t.drone) {
      tone(chord[2] / 2, when, t.beat * halfBar * 0.94, {
        type: t.bassType || 'triangle', gain: t.bass * 0.82, bus: musicBus, attack: 0.03,
      });
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
    // dreadGear (constants.js) is shared with the floor itself: every gear change here is also the
    // moment a hostile event fires, so a tempo shift is never decorative — it means something just
    // happened. HURRY must stay DREAD_RAMP_STEPS + 1 long for the two to line up.
    dangerStep = Math.min(HURRY.length - 1, dreadGear(frac));
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

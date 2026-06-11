/**
 * AudioEngine — the blockchain scoring itself.
 *
 * Two layers:
 *
 *  1. THE HONEST MAPPING — every sound is a real chain event (the SAME events that grow the
 *     crystal in Strata.ts):
 *       onSlot(slot, missed)        THE HEARTBEAT → a sub kick on the beat (missed → a ghost dropout)
 *       onLeaderChange(leaderIndex) every 4 slots → the pad moves to the next chord on the downbeat
 *       onFinality(slot)            ~every 12s    → a slow resolving swell toward the tonic
 *       onTransaction(type, value01?) a real tx   → one melody note (the tx stream WRITES the tune
 *                                                   in 'walk' mode); magnitude accents the dynamics
 *       setActivity(tps)            continuous    → ENERGY (texture, brightness, lead level) — never a note
 *       onEpochProgress(p01)        0..1 of epoch → a slow drone shift; a rollover triggers the Sunrise
 *
 *  2. THE DIRECTOR — shapes the long arc on top of the honest mapping: a slow `intensity` that
 *     rises with real network energy and opens a master "movement" filter (dark when calm, bright
 *     when surging); a melodic LEAD the chain advances one note per block; a walking chord
 *     PROGRESSION for longer harmonic arcs; and the SUNRISE — a build → ecstasy → daylight (the
 *     harmony lifts to major, the reverb blooms) → the blinds slam shut → back into the dark with a
 *     heavy kick. The Sunrise fires on the real epoch rollover (the network's "new day"), on a
 *     manual trigger (the studio's DJ button), or on a timed cycle for the dancefloor.
 *
 * THE GRID (measured Solana facts): one slot ≈ 396ms ≈ 151 BPM; one leader = 4 slots = a 1.585s
 * bar (4/4); finality ≈ 12s ≈ 7.5 bars. ONE SLOT = ONE BEAT, ONE LEADER = ONE BAR. A Tone.Transport
 * runs at 151 BPM and every event is QUANTIZED to the grid (a tiny, honest nudge).
 *
 * MUSICALITY = CONSTRAINT: a fixed key (A minor; the Sunrise lifts to a bright major pentatonic);
 * notes only ever come from the scale; big reverb + dub delay; gentle, sub-heavy-but-soft. Built
 * to run 10 hours: a master limiter, a tx throttle, nothing harsh.
 *
 * TUNE BY EAR: edit AUDIO_CONFIG below, or — much better — open the live STUDIO (studio.html) and
 * ride every knob while it plays. The studio also exports your tuning back to paste in here.
 */

import * as Tone from 'tone';

export type TxType = 'transfer' | 'defi' | 'nft' | 'stake';

/* ───────────────────────────────────────────────────────────────────────────────────────────
 * AUDIO_CONFIG — the tuning surface. Linear gains (0..1-ish); times in seconds unless they are
 * Tone "Time" strings ('4n' = quarter, '16n' = sixteenth, '1m' = a bar). The studio writes to
 * this object live, so it is intentionally a plain (mutable) object.
 * ─────────────────────────────────────────────────────────────────────────────────────────── */
export const AUDIO_CONFIG = {
  /** The grid. 151 BPM ⇒ one beat ≈ 396ms ≈ one slot. */
  tempoBpm: 151,

  /** Master bus — glue compression then a brickwall limiter so it never clips over 10 hours. */
  master: {
    outputGain: 0.9, // level into the limiter; the global "volume"
    ceilingDb: -1.0, // limiter ceiling (true-peak headroom)
    compThresholdDb: -22,
    compRatio: 2.5,
    muteRampSec: 0.08,
  },

  /** The optional ambient bed (a long, seamless loop). Removable: pass bedUrl:null to disable. */
  bed: {
    gain: 0.5,
    sendReverb: 0.15,
    fadeSec: 2.0,
    loadTimeoutMs: 6000,
  },

  /** Global space: a long convolution reverb + a tempo-synced dub delay (echoes wash into reverb). */
  reverb: { decaySec: 9, preDelaySec: 0.04 },
  delay: { time: '4n', feedback: 0.42 },

  /** Master 3-band EQ — the mixing table. Bass / mid / high gains in dB (0 = flat), with the two
   *  crossover frequencies. (A bipolar master filter sweep also lives on the master; it has no
   *  resting state to store.) */
  eq: { low: 0, mid: 0, high: 0, lowFrequency: 250, highFrequency: 2500 },

  /** SIDECHAIN PUMP — each kick ducks the sustained layers (pad/texture/drone/bed) and they swell
   *  back between beats. THE dub-techno breathing; driven by real slots, so the network pumps the
   *  room. depth 0 = off, ~0.3 = gentle, 0.6+ = heavy. */
  pump: { depth: 0.32, attackSec: 0.02, releaseSec: 0.28 },

  /** The key. Everything maps into this scale — never raw chromatic. */
  key: {
    root: 'A',
    baseOctave: 2,
    scale: [0, 2, 3, 5, 7, 8, 10], // A natural minor (Aeolian): A B C D E F G
    scaleName: 'A natural minor',
    /** Diatonic 7th chords as scale-degree stacks of thirds (root in the bass). The Director walks
     *  these for the harmonic arc; in 'leader' mode each leaderIndex picks one. */
    progression: [
      [0, 2, 4, 6], // i   — Am7
      [5, 7, 9, 11], // VI  — Fmaj7
      [3, 5, 7, 9], // iv  — Dm7
      [4, 6, 8, 10], // v   — Em7
      [2, 4, 6, 8], // III — Cmaj7
      [6, 8, 10, 12], // VII — G7
    ],
    progressionNames: ['i', 'VI', 'iv', 'v', 'III', 'VII'], // roman numerals — key-independent (the key itself is a separate readout)
  },

  /** THE DIRECTOR — the long arc on top of the honest event mapping. */
  director: {
    /** Energy. Derived from real TPS (honest) unless the studio pins it. Slow on purpose so the
     *  network's surges feel like earned buildups, not flicker. */
    intensityFromTps: true,
    intensityAttackSec: 12, // how slowly energy rises
    intensityReleaseSec: 22, // how slowly it falls
    /** Master "movement" lowpass — opens with energy. Min keeps the kick + bass; only the air/
     *  shimmer rolls off when calm, so a build = the whole mix brightening. */
    movementCutoffMin: 620,
    movementCutoffMax: 18000,
    /** Harmonic arc. 'sequential' walks the progression (longer arcs); 'leader' ties the chord to
     *  leaderIndex (each validator's signature — maximally honest). */
    progressionMode: 'sequential' as 'sequential' | 'leader',
    chordChangeEveryBars: 2, // advance the chord every N leader-changes (bigger = more epic)
    /** Autonomous DJ cycle: trigger a Sunrise every N minutes for the dancefloor. 0 = off (only the
     *  real epoch rollover + the manual button trigger it — the honest default). */
    autoCycleMin: 0,
  },

  /** THE HEARTBEAT — a soft sub kick on each produced slot. */
  slot: {
    note: 'A1',
    dur: 0.28,
    velocity: 0.8,
    gain: 0.9,
    minGapSec: 0.06,
    pitchDecay: 0.045,
    octaves: 5,
    quantize: '16n',
    sendReverb: 0.08,
    sendDelay: 0.0,
  },

  /** A MISSED slot — no kick; a short filtered-noise "ghost" with a downward sweep. */
  missed: {
    dur: 0.18,
    velocity: 0.5,
    gain: 0.35,
    filterStart: 1400,
    filterEnd: 180,
    quantize: '16n',
    sendReverb: 0.3,
    sendDelay: 0.28,
  },

  /** LEADER CHANGE — the pad crossfades to the next chord on the downbeat. */
  leader: {
    padOctave: 1,
    gain: 0.16,
    velocity: 0.45,
    attack: 2.5,
    decay: 1.0,
    sustain: 0.8,
    release: 5.0,
    maxPolyphony: 32, // covers the 5s-release crossfade × bar cadence (or chord notes drop)
    quantize: '1m',
    sendReverb: 0.5,
    sendDelay: 0.15,
  },

  /** FINALITY — a slow resolving swell on the tonic triad. */
  finality: {
    chord: [0, 2, 4],
    octave: 1,
    gain: 0.22,
    velocity: 0.5,
    attack: 2.5,
    decay: 1.0,
    sustain: 0.7,
    release: 5.0,
    noteLen: 3.5,
    filterFrom: 300,
    filterTo: 2200,
    quantize: '2n',
    sendReverb: 0.7,
    sendDelay: 0.2,
  },

  /** TRANSACTIONS — a short shimmer/pluck per real tx; distinct timbre + register per type, pitched
   *  to the current chord's tones. A throttle caps density (gallery safety + honest sampling). */
  tx: {
    minIntervalSec: 0.07,
    maxPolyphony: 12,
    quantize: '16n',
    /** Value accents: a tx's on-chain magnitude (0..1, passed by the orchestrator) scales the
     *  note's velocity and length around the per-type base — whales accent, dust ghosts. The
     *  amounts are the full swing (0.6 ⇒ ±30% around base). 0 disables. */
    accentVelocity: 0.6,
    accentDuration: 1.0,
    transfer: { octave: 1, gain: 0.18, velocity: 0.5, dur: 0.25, sendReverb: 0.35, sendDelay: 0.3 },
    defi: { octave: 2, gain: 0.15, velocity: 0.45, dur: 0.4, sendReverb: 0.4, sendDelay: 0.45 },
    nft: { octave: 2, gain: 0.13, velocity: 0.4, dur: 0.3, sendReverb: 0.45, sendDelay: 0.6 },
    stake: { octave: 0, gain: 0.2, velocity: 0.5, dur: 0.5, sendReverb: 0.3, sendDelay: 0.15 },
  },

  /** THE MELODIC WALK — in 'walk' mode the transaction stream WRITES the melody: a melodic cursor
   *  moves through the scale, each sampled tx stepping it by its type's interval (stake pulls
   *  toward the root — the network's bassline). Counterpoint constraints make it sing rather than
   *  wander: notes on strong beats snap to chord tones, leaps resolve stepwise in contrary motion,
   *  and the first note of each bar anchors on the chord root. 'arpeggio' = the old rotation. */
  melody: {
    mode: 'walk' as 'walk' | 'arpeggio',
    octave: 1, // tessitura of the walk (scale-degree 0 sits at baseOctave + this)
    range: 13, // walk span in scale degrees (~two octaves), reflecting at the edges
    intervals: { transfer: 1, defi: -2, nft: 3, stake: 0 } as Record<TxType, number>,
    leapThreshold: 3, // |interval| ≥ this is a leap → next note resolves one step back
    stakeOctaveDown: true, // stake plays an octave below the cursor — a bass answer
  },

  /** THE LEAD — a melodic line the chain advances one note per block (a music box the network
   *  cranks). Its LEVEL rides `intensity`, so the melody emerges as the build grows and recedes
   *  when calm. Notes are scale degrees (never chromatic); the Sunrise swaps in a brighter motif. */
  lead: {
    enabled: true,
    motif: [0, 2, 4, 7, 4, 9, 7, 2], // dark, modal phrase (scale degrees)
    brightMotif: [0, 2, 4, 3, 4, 2, 4, 7], // used during the Sunrise daylight
    everySlots: 2, // step the melody every N produced slots
    octave: 2,
    velocity: 0.5,
    dur: 0.22,
    quantize: '8n',
    gainByIntensity: 0.17, // dry level at full intensity (0 when calm)
    sendReverb: 0.45,
    sendDelay: 0.55,
  },

  /** ACTIVITY → ENERGY. Continuous network density modulates intensity (texture, brightness, lead
   *  level, delay feedback). NEVER triggers a note. */
  activity: {
    maxTps: 4000,
    textureGainMax: 0.12,
    textureCutoffMin: 220,
    textureCutoffMax: 3000,
    delayFeedbackBusy: 0.6,
  },

  /** EPOCH (0..1) — a very slow drone evolution across the epoch (~2 days). */
  epoch: {
    rootDeg: 0,
    fifthDeg: 4,
    octave: 0,
    gain: 0.16,
    cutoffMin: 160,
    cutoffMax: 700,
    detuneMax: 14,
    overtoneMax: 0.08,
    smoothingSec: 4.0,
    sendReverb: 0.5,
    triggerSunriseOnRollover: true, // the network's "new day" opens the blinds
  },

  /** THE SUNRISE — build → ecstasy → daylight → blinds shut → dark heavy kick. Lengths in bars. */
  sunrise: {
    buildBars: 16, // the slow build to the peak
    lightBars: 6, // the blinds open — daylight held
    closeBars: 2, // the blinds slam shut
    brightScale: [0, 2, 4, 7, 9], // A major pentatonic — the "sunlight" (can't sound wrong)
    brightChord: [0, 2, 4], // a bright tonic triad in the bright scale
    riserGain: 0.16, // the rising noise sweep through the build
    reverbBloom: 1.7, // reverb-bus multiplier at the peak (the room floods with light)
    kickSoftOnLight: 0.18, // the kick softens to this while the light is held...
    kickSlamOnClose: 1.05, // ...then slams back to this on the close (the dark returns)
    grooveIntensity: 0.5, // energy settles here after the Sunrise
    keyLiftSemis: 2, // the gospel lift: the whole key rises this many semitones while the blinds are open (0 = off)
  },
};

/** Pristine defaults, snapshotted before any studio/preset mutation — the preset diff baseline. */
export const DEFAULT_AUDIO_CONFIG: typeof AUDIO_CONFIG = JSON.parse(JSON.stringify(AUDIO_CONFIG));

/** The selectable modes for setKey(). All 7-note, so the diatonic progression machinery holds. */
export const KEY_MODES: Record<string, { name: string; scale: number[] }> = {
  minor: { name: 'minor', scale: [0, 2, 3, 5, 7, 8, 10] }, // Aeolian — the dark home
  dorian: { name: 'Dorian', scale: [0, 2, 3, 5, 7, 9, 10] }, // the dub classic (raised 6th)
  phrygian: { name: 'Phrygian', scale: [0, 1, 3, 5, 7, 8, 10] }, // darker still (flat 2nd)
  major: { name: 'major', scale: [0, 2, 4, 5, 7, 9, 11] }, // Ionian — full daylight
};

/** A shareable snapshot: config diff-from-default + the mixer strip states. */
export interface StudioPreset {
  v: 1;
  name?: string;
  config?: Record<string, unknown>;
  strips?: Record<string, { level: number; reverb: number; delay: number; muted: boolean }>;
}

/** Deep-diff `obj` against `base`: keep only changed leaves (arrays compared wholesale). */
function diffDeep(obj: Record<string, any>, base: Record<string, any>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(obj)) {
    const a = obj[k];
    const b = base?.[k];
    if (Array.isArray(a) || typeof a !== 'object' || a === null) {
      if (JSON.stringify(a) !== JSON.stringify(b)) out[k] = a;
    } else {
      const d = diffDeep(a, b ?? {});
      if (Object.keys(d).length) out[k] = d;
    }
  }
  return out;
}

/** Deep-assign `src` into `dst` (arrays replaced wholesale). */
function assignDeep(dst: Record<string, any>, src: Record<string, any>): void {
  for (const k of Object.keys(src)) {
    const v = src[k];
    if (Array.isArray(v) || typeof v !== 'object' || v === null) {
      dst[k] = Array.isArray(v) ? v.slice() : v;
    } else {
      if (typeof dst[k] !== 'object' || dst[k] === null) dst[k] = {};
      assignDeep(dst[k], v);
    }
  }
}

type Disposable = { dispose(): void };

/** A mixer channel strip: a per-voice fader + dry/reverb/delay sends, with mute/solo. */
interface Strip {
  level: Tone.Gain; // fader (mute/solo gate this)
  dry: Tone.Gain;
  rev: Tone.Gain;
  del: Tone.Gain;
  userLevel: number; // the fader value, preserved across mute/solo
  muted: boolean;
  soloed: boolean;
}

interface Graph {
  master: Tone.Gain;
  movementFilter: Tone.Filter; // the Director's "open with energy" master lowpass
  reverb: Tone.Reverb;
  reverbBus: Tone.Gain;
  delayBus: Tone.Gain;
  delay: Tone.FeedbackDelay;
  eq3: Tone.EQ3;
  djFilter: Tone.Filter;
  analyser: Tone.Analyser;
  limiter: Tone.Limiter;
  pumpDucks: Tone.Gain[]; // the sidechain duck nodes on the sustained layers
  reverbReady: Promise<void>;

  kick: Tone.MembraneSynth;
  ghost: Tone.NoiseSynth;
  ghostFilter: Tone.Filter;
  pad: Tone.PolySynth<Tone.Synth>;
  swell: Tone.PolySynth<Tone.Synth>;
  swellFilter: Tone.Filter;
  tx: Record<TxType, Tone.PolySynth<any>>;
  lead: Tone.PolySynth<any>;
  leadIntensityGain: Tone.Gain;

  droneA: Tone.Oscillator;
  droneB: Tone.Oscillator;
  droneOvertone: Tone.Oscillator;
  droneOvertoneGain: Tone.Gain;
  droneFilter: Tone.Filter;

  texture: Tone.Noise;
  textureFilter: Tone.Filter;
  textureGain: Tone.Gain;

  riser: Tone.Noise;
  riserFilter: Tone.Filter;
  riserGain: Tone.Gain;

  strips: Record<string, Strip>;

  bed: Tone.Player | null;
  bedGain: Tone.Gain | null;

  disposables: Disposable[];
}

const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export class AudioEngine {
  private graph: Graph | null = null;
  private _started = false;
  private _muted = false;
  private _disposed = false;

  private readonly bedUrl: string | null;

  private lastTps = 0;
  private lastEpochP = 0;

  // Harmony: the active scale (the Sunrise swaps in a bright one), the current chord, the walking
  // progression step, and the held pad voices.
  private activeScale: number[] = AUDIO_CONFIG.key.scale;
  private currentChordDegrees: number[] = AUDIO_CONFIG.key.progression[0].slice();
  private progStep = 0;
  private leaderChangeCount = 0;
  private heldPad: number[] | null = null;
  private lastLeaderIndex = -1;

  // Lead sequencer.
  private slotCount = 0;
  private leadStep = 0;
  private useBrightMotif = false;

  // The melodic walk (tx-written melody).
  private melodyCursor = 7; // start mid-tessitura
  private melodyLastInterval = 0;
  private melodyLastBar = -1;

  // Key state: the current mode key (into KEY_MODES) and the Sunrise's temporary semitone lift.
  private modeKey = 'minor';
  private liftSemis = 0;

  // Recording (a tap on the master limiter).
  private recDest: MediaStreamAudioDestinationNode | null = null;
  private recorder: MediaRecorder | null = null;
  private recChunks: Blob[] = [];

  // Intensity (energy).
  private intensityTarget = 0;
  private intensityManual = false;

  // Sunrise scheduling.
  private _sunriseActive = false;
  private sunriseTimers: number[] = [];
  private autoCycleTimer: number | null = null;

  // Mono / throttle guards.
  private lastKickTime = 0;
  private lastTxTime = 0;
  private txRot: Record<TxType, number> = { transfer: 0, defi: 0, nft: 0, stake: 0 };

  private cachedRootMidi: number | null = null;

  constructor(opts?: { bedUrl?: string | null }) {
    this.bedUrl = opts && 'bedUrl' in opts ? (opts.bedUrl ?? null) : '/audio/bed.mp3';
  }

  get started(): boolean {
    return this._started;
  }

  /* ── lifecycle ─────────────────────────────────────────────────────────────────────────── */

  async start(): Promise<void> {
    if (this._disposed || this._started) return;

    await Tone.start(); // resume the AudioContext — requires a user gesture

    if (!this.graph) this.graph = this.build();
    const g = this.graph;

    // Don't block start() on the long reverb IR — let the space bloom in (instant, robust start).
    void g.reverbReady.catch(() => {});

    const transport = Tone.getTransport();
    transport.bpm.value = AUDIO_CONFIG.tempoBpm;

    g.droneA.start();
    g.droneB.start();
    g.droneOvertone.start();
    g.texture.start();
    g.riser.start();

    transport.start();

    g.master.gain.value = this._muted ? 0 : AUDIO_CONFIG.master.outputGain;
    this.applyEpoch(this.lastEpochP);
    this.rampIntensityTo(this.intensityTarget, 0.1);

    this.attackChord(this.currentChordDegrees, Tone.now() + 0.05);

    this._started = true;
    this.armAutoCycle();
    void this.loadAndStartBed();
  }

  stop(): void {
    if (!this.graph || !this._started) return;
    const g = this.graph;
    const t = Tone.now();

    this.cancelSunrise();
    this.disarmAutoCycle();

    if (this.heldPad) {
      try {
        g.pad.triggerRelease(this.heldPad, t);
      } catch {
        /* noop */
      }
      this.heldPad = null;
    }

    try {
      g.droneA.stop();
      g.droneB.stop();
      g.droneOvertone.stop();
      g.texture.stop();
      g.riser.stop();
      g.bed?.stop();
    } catch {
      /* noop */
    }

    Tone.getTransport().stop();
    this._started = false;
  }

  setMuted(muted: boolean): void {
    this._muted = muted;
    if (!this.graph) return;
    this.graph.master.gain.rampTo(
      muted ? 0 : AUDIO_CONFIG.master.outputGain,
      AUDIO_CONFIG.master.muteRampSec,
    );
  }

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this.cancelSunrise();
    this.disarmAutoCycle();
    try {
      this.stop();
    } catch {
      /* noop */
    }
    if (this.graph) {
      for (const node of this.graph.disposables) {
        try {
          node.dispose();
        } catch {
          /* noop */
        }
      }
      this.graph = null;
    }
    this._started = false;
  }

  /* ── chain event sinks ─────────────────────────────────────────────────────────────────── */

  onSlot(_slot: number, missed: boolean): void {
    const g = this.guard();
    if (!g) return;

    if (missed) {
      const time = this.quantize(AUDIO_CONFIG.missed.quantize);
      const f = g.ghostFilter.frequency;
      try {
        f.cancelScheduledValues(time);
        f.setValueAtTime(AUDIO_CONFIG.missed.filterStart, time);
        f.exponentialRampToValueAtTime(AUDIO_CONFIG.missed.filterEnd, time + AUDIO_CONFIG.missed.dur);
      } catch {
        /* overlapping ghosts can collide on the shared filter param — harmless */
      }
      g.ghost.triggerAttackRelease(AUDIO_CONFIG.missed.dur, time, AUDIO_CONFIG.missed.velocity);
      return;
    }

    let time = this.quantize(AUDIO_CONFIG.slot.quantize);
    time = Math.max(time, this.lastKickTime + AUDIO_CONFIG.slot.minGapSec);
    this.lastKickTime = time;
    g.kick.triggerAttackRelease(
      AUDIO_CONFIG.slot.note,
      AUDIO_CONFIG.slot.dur,
      time,
      AUDIO_CONFIG.slot.velocity,
    );
    this.schedulePump(time); // the sustained layers duck with the kick and swell back — the pump

    // The chain advances the melody — one step every `everySlots` produced blocks.
    this.slotCount += 1;
    if (AUDIO_CONFIG.lead.enabled && this.slotCount % AUDIO_CONFIG.lead.everySlots === 0) {
      this.stepLead();
    }
  }

  onLeaderChange(leaderIndex: number): void {
    const g = this.guard();
    if (!g) return;
    if (leaderIndex === this.lastLeaderIndex) return;
    this.lastLeaderIndex = leaderIndex;
    this.leaderChangeCount += 1;

    // Advance the harmony. Sequential = walk the progression on a slower harmonic rhythm (longer
    // arcs); leader = each validator's signature chord.
    const prog = AUDIO_CONFIG.key.progression;
    let chord: number[];
    if (AUDIO_CONFIG.director.progressionMode === 'sequential') {
      const every = Math.max(1, AUDIO_CONFIG.director.chordChangeEveryBars);
      if (this.leaderChangeCount % every !== 0 && this.heldPad) return; // hold the chord
      chord = prog[this.progStep % prog.length];
      this.progStep += 1;
    } else {
      const idx = ((leaderIndex % prog.length) + prog.length) % prog.length;
      chord = prog[idx];
    }
    this.currentChordDegrees = chord.slice();

    const time = this.quantize(AUDIO_CONFIG.leader.quantize);
    if (this.heldPad) {
      try {
        g.pad.triggerRelease(this.heldPad, time);
      } catch {
        /* noop */
      }
    }
    this.attackChord(chord, time);
  }

  onFinality(_slot: number): void {
    const g = this.guard();
    if (!g) return;
    const c = AUDIO_CONFIG.finality;
    const time = this.quantize(c.quantize);

    const f = g.swellFilter.frequency;
    try {
      f.cancelScheduledValues(time);
      f.setValueAtTime(c.filterFrom, time);
      f.linearRampToValueAtTime(c.filterTo, time + c.attack);
      f.linearRampToValueAtTime(c.filterFrom, time + c.noteLen + c.release);
    } catch {
      /* noop */
    }

    const freqs = c.chord.map((d) => this.degreeToFreq(d, c.octave));
    g.swell.triggerAttackRelease(freqs, c.noteLen, time, c.velocity);
  }

  /** A real transaction → one note. In 'walk' mode the tx stream WRITES the melody (the cursor
   *  moves by the type's interval under counterpoint constraints); value01 (the tx's on-chain
   *  magnitude, 0..1) accents the note's velocity and length. Throttled — we sample the stream. */
  onTransaction(type: TxType, value01?: number): void {
    const g = this.guard();
    if (!g) return;

    const now = Tone.now();
    if (now - this.lastTxTime < AUDIO_CONFIG.tx.minIntervalSec) return; // throttle
    this.lastTxTime = now;

    const voiceCfg = AUDIO_CONFIG.tx[type];
    const time = this.quantize(AUDIO_CONFIG.tx.quantize);

    let freq: number;
    if (AUDIO_CONFIG.melody.mode === 'walk') {
      const { degree, octaveOffset } = this.walkNote(type, time);
      freq = this.degreeToFreq(degree, octaveOffset);
    } else {
      const degrees = this.currentChordDegrees;
      const rot = this.txRot[type] % degrees.length;
      this.txRot[type] = (this.txRot[type] + 1) % 1024;
      freq = this.degreeToFreq(degrees[rot], voiceCfg.octave);
    }

    // Accent: magnitude scales dynamics symmetrically around the per-type base.
    const v = value01 === undefined ? 0.5 : clamp(value01, 0, 1);
    const vel = clamp(voiceCfg.velocity * (1 + AUDIO_CONFIG.tx.accentVelocity * (v - 0.5)), 0.05, 1);
    const dur = voiceCfg.dur * (1 + AUDIO_CONFIG.tx.accentDuration * (v - 0.5));

    g.tx[type].triggerAttackRelease(freq, dur, time, vel);
  }

  /** CONTINUOUS density → ENERGY (texture/brightness/lead level/feedback). Never a note. */
  setActivity(tps: number): void {
    this.lastTps = tps;
    if (!this.graph || this.intensityManual || this._sunriseActive) return;
    if (!AUDIO_CONFIG.director.intensityFromTps) return;
    const target = clamp(tps / AUDIO_CONFIG.activity.maxTps, 0, 1);
    const rising = target > this.intensityTarget;
    const sec = rising
      ? AUDIO_CONFIG.director.intensityAttackSec
      : AUDIO_CONFIG.director.intensityReleaseSec;
    this.rampIntensityTo(target, sec);
  }

  onEpochProgress(p01: number): void {
    const p = clamp(p01, 0, 1);
    // A rollover (p wraps from ~1 back to ~0) is the network's "new day" → open the blinds.
    if (
      AUDIO_CONFIG.epoch.triggerSunriseOnRollover &&
      this._started &&
      this.lastEpochP > 0.85 &&
      p < 0.15
    ) {
      this.triggerSunrise();
    }
    this.lastEpochP = p;
    if (!this.graph) return;
    this.applyEpoch(p);
  }

  /* ── the Director / Sunrise (public; the studio drives these) ───────────────────────────── */

  get intensity(): number {
    return this.intensityTarget;
  }

  /** Pin the energy manually (the studio's intensity fader). Call clearManualIntensity() to hand
   *  control back to live TPS. */
  setIntensity(v: number): void {
    this.intensityManual = true;
    this.rampIntensityTo(clamp(v, 0, 1), 0.4);
  }

  clearManualIntensity(): void {
    this.intensityManual = false;
  }

  get sunriseActive(): boolean {
    return this._sunriseActive;
  }

  /** THE MOMENT. Build → ecstasy → daylight → the blinds slam → back into the dark. */
  triggerSunrise(): void {
    const g = this.guard();
    if (!g || this._sunriseActive) return;
    this._sunriseActive = true;
    this.intensityManual = true;

    const s = AUDIO_CONFIG.sunrise;
    const barSec = (60 / AUDIO_CONFIG.tempoBpm) * 4;
    const buildSec = Math.max(1, s.buildBars * barSec);
    const lightSec = Math.max(0.5, s.lightBars * barSec);
    const closeSec = Math.max(0.5, s.closeBars * barSec);
    const now = Tone.now();

    // BUILD — open the master filter, lift the energy, sweep a riser up into the peak.
    try {
      g.movementFilter.frequency.cancelScheduledValues(now);
      g.movementFilter.frequency.rampTo(AUDIO_CONFIG.director.movementCutoffMax, buildSec);
      this.rampIntensityTo(1, buildSec);
      g.riserGain.gain.cancelScheduledValues(now);
      g.riserGain.gain.setValueAtTime(0.0001, now);
      g.riserGain.gain.linearRampToValueAtTime(s.riserGain, now + buildSec);
      g.riserFilter.frequency.cancelScheduledValues(now);
      g.riserFilter.frequency.setValueAtTime(300, now);
      g.riserFilter.frequency.exponentialRampToValueAtTime(9000, now + buildSec);
    } catch {
      /* noop */
    }

    this.sunriseTimers.push(
      window.setTimeout(() => this.sunrisePeak(), buildSec * 1000),
      window.setTimeout(() => this.sunriseClose(), (buildSec + lightSec) * 1000),
      window.setTimeout(() => this.sunriseEnd(), (buildSec + lightSec + closeSec) * 1000),
    );
  }

  private sunrisePeak(): void {
    const g = this.graph;
    if (!g || !this._sunriseActive) return;
    const s = AUDIO_CONFIG.sunrise;
    const now = Tone.now();

    // The blinds open: the whole harmony lifts to the bright (major) scale — and the gospel lift:
    // the entire key rises keyLiftSemis while the light is in, the drones gliding up under it.
    this.activeScale = s.brightScale;
    this.useBrightMotif = true;
    this.currentChordDegrees = s.brightChord.slice();
    if (s.keyLiftSemis) {
      this.liftSemis = s.keyLiftSemis;
      this.retuneDrones((60 / AUDIO_CONFIG.tempoBpm) * 4); // glide up over ~a bar
    }

    try {
      g.riserGain.gain.cancelScheduledValues(now);
      g.riserGain.gain.linearRampToValueAtTime(0.0001, now + 0.25); // cut the riser
      g.reverbBus.gain.rampTo(s.reverbBloom, 0.4); // light floods the room
      if (this.graph) {
        const kickStrip = this.graph.strips['kick'];
        if (kickStrip) kickStrip.level.gain.rampTo(this.gateValue(kickStrip, s.kickSoftOnLight), 1.0);
      }
    } catch {
      /* noop */
    }

    // A big bright chord + swell.
    const time = this.quantize('4n');
    if (this.heldPad) {
      try {
        g.pad.triggerRelease(this.heldPad, time);
      } catch {
        /* noop */
      }
    }
    this.attackChord(s.brightChord, time);
    const swellFreqs = s.brightChord.map((d) => this.degreeToFreq(d, AUDIO_CONFIG.finality.octave));
    try {
      g.swell.triggerAttackRelease(swellFreqs, AUDIO_CONFIG.sunrise.lightBars * 0.4 + 1, time, 0.6);
    } catch {
      /* noop */
    }
  }

  private sunriseClose(): void {
    const g = this.graph;
    if (!g || !this._sunriseActive) return;
    const s = AUDIO_CONFIG.sunrise;
    const barSec = (60 / AUDIO_CONFIG.tempoBpm) * 4;
    const closeSec = Math.max(0.5, s.closeBars * barSec);

    // The blinds slam shut: back to the dark minor (and the home key), the room snaps tight,
    // the heavy kick returns.
    this.activeScale = AUDIO_CONFIG.key.scale;
    this.useBrightMotif = false;
    if (this.liftSemis) {
      this.liftSemis = 0;
      this.retuneDrones(closeSec * 0.5); // fall back home with the dark
    }
    this.currentChordDegrees = AUDIO_CONFIG.key.progression[this.progStep % AUDIO_CONFIG.key.progression.length].slice();

    try {
      g.reverbBus.gain.rampTo(1, closeSec * 0.6);
      g.movementFilter.frequency.rampTo(AUDIO_CONFIG.director.movementCutoffMin, closeSec * 0.5);
      this.rampIntensityTo(s.grooveIntensity, closeSec);
      const kickStrip = g.strips['kick'];
      if (kickStrip) kickStrip.level.gain.rampTo(this.gateValue(kickStrip, s.kickSlamOnClose), 0.1);
    } catch {
      /* noop */
    }

    const time = this.quantize('1m');
    if (this.heldPad) {
      try {
        g.pad.triggerRelease(this.heldPad, time);
      } catch {
        /* noop */
      }
    }
    this.attackChord(this.currentChordDegrees, time);
  }

  private sunriseEnd(): void {
    const g = this.graph;
    this._sunriseActive = false;
    this.intensityManual = false;
    this.useBrightMotif = false;
    this.sunriseTimers = [];
    if (g) {
      const kickStrip = g.strips['kick'];
      if (kickStrip) kickStrip.level.gain.rampTo(this.gateValue(kickStrip, kickStrip.userLevel), 0.5);
    }
  }

  private cancelSunrise(): void {
    for (const t of this.sunriseTimers) window.clearTimeout(t);
    this.sunriseTimers = [];
    if (this._sunriseActive) {
      this._sunriseActive = false;
      this.intensityManual = false;
      this.useBrightMotif = false;
      this.activeScale = AUDIO_CONFIG.key.scale;
      if (this.liftSemis) {
        this.liftSemis = 0;
        this.retuneDrones(0.3);
      }
      const g = this.graph;
      if (g) {
        try {
          g.reverbBus.gain.rampTo(1, 0.3);
          g.riserGain.gain.rampTo(0.0001, 0.3);
        } catch {
          /* noop */
        }
      }
    }
  }

  private armAutoCycle(): void {
    this.disarmAutoCycle();
    const min = AUDIO_CONFIG.director.autoCycleMin;
    if (min > 0) {
      this.autoCycleTimer = window.setInterval(() => this.triggerSunrise(), min * 60_000);
    }
  }

  private disarmAutoCycle(): void {
    if (this.autoCycleTimer !== null) {
      window.clearInterval(this.autoCycleTimer);
      this.autoCycleTimer = null;
    }
  }

  /* ── mixer / FX control (the studio drives these) ──────────────────────────────────────── */

  get stripNames(): string[] {
    return this.graph ? Object.keys(this.graph.strips) : [];
  }

  getStripState(name: string): { level: number; reverb: number; delay: number; muted: boolean; soloed: boolean } | null {
    const s = this.graph?.strips[name];
    if (!s) return null;
    return { level: s.userLevel, reverb: s.rev.gain.value, delay: s.del.gain.value, muted: s.muted, soloed: s.soloed };
  }

  setStripLevel(name: string, v: number): void {
    const s = this.graph?.strips[name];
    if (!s) return;
    s.userLevel = v;
    s.level.gain.rampTo(this.gateValue(s, v), 0.04);
  }

  setStripSend(name: string, bus: 'reverb' | 'delay', v: number): void {
    const s = this.graph?.strips[name];
    if (!s) return;
    (bus === 'reverb' ? s.rev : s.del).gain.rampTo(v, 0.04);
  }

  setMute(name: string, muted: boolean): void {
    const s = this.graph?.strips[name];
    if (!s) return;
    s.muted = muted;
    this.recomputeMixer();
  }

  setSolo(name: string, soloed: boolean): void {
    const s = this.graph?.strips[name];
    if (!s) return;
    s.soloed = soloed;
    this.recomputeMixer();
  }

  setMasterGain(v: number): void {
    AUDIO_CONFIG.master.outputGain = v;
    if (this.graph && !this._muted) this.graph.master.gain.rampTo(v, 0.05);
  }

  setReverbDecay(sec: number): void {
    AUDIO_CONFIG.reverb.decaySec = sec;
    if (this.graph) {
      this.graph.reverb.decay = sec;
      void this.graph.reverb.generate().catch(() => {});
    }
  }

  setReverbAmount(v: number): void {
    this.graph?.reverbBus.gain.rampTo(v, 0.1);
  }

  setDelayFeedback(v: number): void {
    AUDIO_CONFIG.delay.feedback = v;
    this.graph?.delay.feedback.rampTo(clamp(v, 0, 0.95), 0.1);
  }

  setDelayAmount(v: number): void {
    this.graph?.delayBus.gain.rampTo(v, 0.1);
  }

  /* ── master mixing table (3-band EQ + DJ filter + spectrum) ──────────────────────────────── */

  /** Set a master EQ band gain in dB (0 = flat; negative cuts, positive boosts). */
  setEQ(band: 'low' | 'mid' | 'high', db: number): void {
    AUDIO_CONFIG.eq[band] = db;
    const g = this.graph;
    if (!g) return;
    const sig = band === 'low' ? g.eq3.low : band === 'mid' ? g.eq3.mid : g.eq3.high;
    sig.rampTo(db, 0.05);
  }

  /** Move an EQ crossover frequency (Hz): 'low' = bass/mid split, 'high' = mid/treble split. */
  setEQCrossover(which: 'low' | 'high', hz: number): void {
    const g = this.graph;
    if (!g) return;
    if (which === 'low') {
      AUDIO_CONFIG.eq.lowFrequency = hz;
      g.eq3.lowFrequency.rampTo(hz, 0.05);
    } else {
      AUDIO_CONFIG.eq.highFrequency = hz;
      g.eq3.highFrequency.rampTo(hz, 0.05);
    }
  }

  /** Bipolar master filter sweep: 0 = open, −1 = full lowpass (muffled), +1 = full highpass (thin). */
  setMasterFilter(v: number): void {
    const g = this.graph;
    if (!g) return;
    const x = clamp(v, -1, 1);
    let type: 'lowpass' | 'highpass';
    let freq: number;
    if (x < -0.02) {
      type = 'lowpass';
      freq = 20000 * Math.pow(150 / 20000, -x); // sweep down toward ~150 Hz
    } else if (x > 0.02) {
      type = 'highpass';
      freq = 20 * Math.pow(6000 / 20, x); // sweep up toward ~6 kHz
    } else {
      type = 'lowpass';
      freq = 20000; // effectively bypassed
    }
    if (g.djFilter.type !== type) g.djFilter.type = type;
    g.djFilter.frequency.rampTo(freq, 0.05);
  }

  /** The master output spectrum (FFT, dB per bin) for the studio's analyzer. Empty until started. */
  getSpectrum(): Float32Array {
    const g = this.graph;
    if (!g) return new Float32Array(0);
    const v = g.analyser.getValue();
    return v instanceof Float32Array ? v : new Float32Array(0);
  }

  setTempo(bpm: number): void {
    AUDIO_CONFIG.tempoBpm = bpm;
    if (this._started) Tone.getTransport().bpm.rampTo(bpm, 0.1);
  }

  /** Set the autonomous Sunrise cycle (minutes; 0 = off) and re-arm it live. */
  setAutoCycleMinutes(min: number): void {
    AUDIO_CONFIG.director.autoCycleMin = min;
    if (this._started) this.armAutoCycle();
  }

  /* ── key changes ───────────────────────────────────────────────────────────────────────── */

  /** Modulate to a new key (root note, e.g. 'A'/'C#'/'F', and optionally a mode from KEY_MODES).
   *  Musical by construction: the drones GLIDE to the new root (portamento over ~2 bars), the held
   *  pad releases with its long tail in the old key, and the new tonic attacks on the next
   *  downbeat. All melodic state is scale-degree-based, so everything else follows instantly. */
  setKey(root: string, modeKey?: string): void {
    if (modeKey && KEY_MODES[modeKey]) this.modeKey = modeKey;
    const mode = KEY_MODES[this.modeKey] ?? KEY_MODES.minor;
    AUDIO_CONFIG.key.root = root;
    AUDIO_CONFIG.key.scale = mode.scale.slice();
    AUDIO_CONFIG.key.scaleName = `${root} ${mode.name}`;
    this.cachedRootMidi = null;
    if (!this._sunriseActive) this.activeScale = AUDIO_CONFIG.key.scale;

    const barSec = (60 / AUDIO_CONFIG.tempoBpm) * 4;
    this.retuneDrones(barSec * 2); // the portamento modulation

    const g = this.graph;
    if (g && this._started) {
      const time = this.quantize('1m');
      if (this.heldPad) {
        try {
          g.pad.triggerRelease(this.heldPad, time);
        } catch {
          /* noop */
        }
      }
      this.attackChord(this.currentChordDegrees, time);
    }
  }

  get currentKey(): { root: string; mode: string; name: string } {
    return { root: AUDIO_CONFIG.key.root, mode: this.modeKey, name: AUDIO_CONFIG.key.scaleName };
  }

  /** Glide the always-on drones to the current key's root/fifth (the audible modulation). */
  private retuneDrones(glideSec: number): void {
    const g = this.graph;
    if (!g) return;
    const e = AUDIO_CONFIG.epoch;
    const root = this.degreeToFreq(e.rootDeg, e.octave);
    const fifth = this.degreeToFreq(e.fifthDeg, e.octave);
    try {
      g.droneA.frequency.rampTo(root, glideSec);
      g.droneB.frequency.rampTo(fifth, glideSec);
      g.droneOvertone.frequency.rampTo(root * 2, glideSec);
    } catch {
      /* noop */
    }
  }

  /** Audition one voice once (the studio's per-sound test button). */
  audition(name: string): void {
    const g = this.guard();
    if (!g) return;
    const t = this.quantize('16n');
    switch (name) {
      case 'kick':
        g.kick.triggerAttackRelease(AUDIO_CONFIG.slot.note, AUDIO_CONFIG.slot.dur, t, AUDIO_CONFIG.slot.velocity);
        break;
      case 'ghost':
        g.ghost.triggerAttackRelease(AUDIO_CONFIG.missed.dur, t, AUDIO_CONFIG.missed.velocity);
        break;
      case 'pad':
        this.attackChord(this.currentChordDegrees, t);
        break;
      case 'swell':
        this.onFinality(0);
        break;
      case 'lead':
        this.stepLead();
        break;
      case 'tx_transfer':
        g.tx.transfer.triggerAttackRelease(this.degreeToFreq(this.currentChordDegrees[0], AUDIO_CONFIG.tx.transfer.octave), AUDIO_CONFIG.tx.transfer.dur, t, AUDIO_CONFIG.tx.transfer.velocity);
        break;
      case 'tx_defi':
        g.tx.defi.triggerAttackRelease(this.degreeToFreq(this.currentChordDegrees[1 % this.currentChordDegrees.length], AUDIO_CONFIG.tx.defi.octave), AUDIO_CONFIG.tx.defi.dur, t, AUDIO_CONFIG.tx.defi.velocity);
        break;
      case 'tx_nft':
        g.tx.nft.triggerAttackRelease(this.degreeToFreq(this.currentChordDegrees[2 % this.currentChordDegrees.length], AUDIO_CONFIG.tx.nft.octave), AUDIO_CONFIG.tx.nft.dur, t, AUDIO_CONFIG.tx.nft.velocity);
        break;
      case 'tx_stake':
        g.tx.stake.triggerAttackRelease(this.degreeToFreq(this.currentChordDegrees[0], AUDIO_CONFIG.tx.stake.octave), AUDIO_CONFIG.tx.stake.dur, t, AUDIO_CONFIG.tx.stake.velocity);
        break;
      default:
        break;
    }
  }

  /** The current AUDIO_CONFIG as pretty JSON — paste it back into AudioEngine.ts to keep a sound. */
  exportConfig(): string {
    return JSON.stringify(AUDIO_CONFIG, null, 2);
  }

  get config(): typeof AUDIO_CONFIG {
    return AUDIO_CONFIG;
  }

  /* ── presets (shareable state) ─────────────────────────────────────────────────────────── */

  /** Snapshot everything tunable: the config as a diff-from-default + the mixer strip states. */
  exportState(name?: string): StudioPreset {
    const strips: NonNullable<StudioPreset['strips']> = {};
    for (const n of this.stripNames) {
      const s = this.getStripState(n);
      if (s) strips[n] = { level: s.level, reverb: s.reverb, delay: s.delay, muted: s.muted };
    }
    return { v: 1, name, config: diffDeep(AUDIO_CONFIG, DEFAULT_AUDIO_CONFIG), strips };
  }

  /** Restore a preset: reset config to defaults, overlay the diff, push everything into the live
   *  graph, then restore the mixer strips. Safe to call while playing. */
  applyState(preset: StudioPreset): void {
    assignDeep(AUDIO_CONFIG, JSON.parse(JSON.stringify(DEFAULT_AUDIO_CONFIG)));
    if (preset.config) assignDeep(AUDIO_CONFIG, preset.config);
    // Re-derive the mode key from the restored scale so the key UI stays truthful.
    const scaleJson = JSON.stringify(AUDIO_CONFIG.key.scale);
    for (const [k, m] of Object.entries(KEY_MODES)) {
      if (JSON.stringify(m.scale) === scaleJson) {
        this.modeKey = k;
        break;
      }
    }
    this.applyConfigLive();
    if (preset.strips) {
      for (const [n, s] of Object.entries(preset.strips)) {
        if (!this.graph?.strips[n]) continue;
        this.setStripLevel(n, s.level);
        this.setStripSend(n, 'reverb', s.reverb);
        this.setStripSend(n, 'delay', s.delay);
        this.setMute(n, s.muted);
      }
    }
  }

  /** Push the current AUDIO_CONFIG values into the running graph (tempo, EQ, space, envelopes,
   *  key, auto-cycle). Strip faders are restored separately by applyState. */
  applyConfigLive(): void {
    this.cachedRootMidi = null;
    if (!this._sunriseActive) this.activeScale = AUDIO_CONFIG.key.scale;
    if (this._started) Tone.getTransport().bpm.rampTo(AUDIO_CONFIG.tempoBpm, 0.1);
    const g = this.graph;
    if (g) {
      const c = AUDIO_CONFIG;
      try {
        if (!this._muted) g.master.gain.rampTo(c.master.outputGain, 0.1);
        g.eq3.low.rampTo(c.eq.low, 0.1);
        g.eq3.mid.rampTo(c.eq.mid, 0.1);
        g.eq3.high.rampTo(c.eq.high, 0.1);
        g.eq3.lowFrequency.rampTo(c.eq.lowFrequency, 0.1);
        g.eq3.highFrequency.rampTo(c.eq.highFrequency, 0.1);
        g.delay.feedback.rampTo(clamp(c.delay.feedback, 0, 0.95), 0.1);
        g.delay.delayTime.value = Tone.Time(c.delay.time).toSeconds();
        g.kick.set({ pitchDecay: c.slot.pitchDecay, octaves: c.slot.octaves });
        g.pad.set({
          envelope: { attack: c.leader.attack, decay: c.leader.decay, sustain: c.leader.sustain, release: c.leader.release },
        });
        g.swell.set({
          envelope: { attack: c.finality.attack, decay: c.finality.decay, sustain: c.finality.sustain, release: c.finality.release },
        });
        // The reverb impulse is expensive — only regenerate when the decay actually changed.
        if (Math.abs(Number(g.reverb.decay) - c.reverb.decaySec) > 0.01) {
          g.reverb.decay = c.reverb.decaySec;
          void g.reverb.generate().catch(() => {});
        }
      } catch {
        /* a node mid-dispose — harmless */
      }
      this.retuneDrones(0.6);
      this.rampIntensityTo(this.intensityTarget, 0.5);
    }
    if (this._started) this.armAutoCycle();
  }

  /* ── recording (a tap on the master limiter — post EQ/comp, exactly what the room hears) ── */

  get recording(): boolean {
    return this.recorder !== null && this.recorder.state === 'recording';
  }

  /** Start capturing the master output. Returns false if recording is unsupported. */
  startRecording(): boolean {
    const g = this.graph;
    if (!g || this.recording) return false;
    try {
      if (typeof MediaRecorder === 'undefined') return false;
      if (!this.recDest) {
        const raw = Tone.getContext().rawContext as AudioContext;
        this.recDest = raw.createMediaStreamDestination();
        g.limiter.connect(this.recDest);
      }
      const mime = ['audio/webm;codecs=opus', 'audio/webm'].find((m) => MediaRecorder.isTypeSupported(m));
      this.recorder = new MediaRecorder(this.recDest.stream, mime ? { mimeType: mime } : undefined);
      this.recChunks = [];
      this.recorder.ondataavailable = (ev: BlobEvent): void => {
        if (ev.data && ev.data.size > 0) this.recChunks.push(ev.data);
      };
      this.recorder.start(1000); // gather chunks every second
      return true;
    } catch (e) {
      console.warn('[AudioEngine] recording unavailable', e);
      this.recorder = null;
      return false;
    }
  }

  /** Stop and return the take (webm/opus), or null if nothing was recording. */
  stopRecording(): Promise<Blob | null> {
    return new Promise((resolve) => {
      const r = this.recorder;
      if (!r || r.state !== 'recording') {
        resolve(null);
        return;
      }
      r.onstop = (): void => {
        const blob = new Blob(this.recChunks, { type: r.mimeType || 'audio/webm' });
        this.recChunks = [];
        this.recorder = null;
        resolve(blob);
      };
      try {
        r.stop();
      } catch {
        this.recorder = null;
        resolve(null);
      }
    });
  }

  /** The name of the chord currently sounding (for the studio readout). */
  get currentChordName(): string {
    if (this._sunriseActive) return '☀ daylight';
    const prog = AUDIO_CONFIG.key.progression;
    const names = AUDIO_CONFIG.key.progressionNames;
    for (let i = 0; i < prog.length; i++) {
      if (
        prog[i].length === this.currentChordDegrees.length &&
        prog[i].every((d, j) => d === this.currentChordDegrees[j])
      ) {
        return names[i] ?? `chord ${i + 1}`;
      }
    }
    return '—';
  }

  /* ── internal application ──────────────────────────────────────────────────────────────── */

  private rampIntensityTo(v: number, sec: number): void {
    this.intensityTarget = clamp(v, 0, 1);
    const g = this.graph;
    if (!g) return;
    const i = this.intensityTarget;
    const d = AUDIO_CONFIG.director;
    const a = AUDIO_CONFIG.activity;
    try {
      g.movementFilter.frequency.rampTo(lerp(d.movementCutoffMin, d.movementCutoffMax, i), sec);
      g.leadIntensityGain.gain.rampTo(i * AUDIO_CONFIG.lead.gainByIntensity, sec);
      g.textureGain.gain.rampTo(i * a.textureGainMax, sec);
      g.textureFilter.frequency.rampTo(lerp(a.textureCutoffMin, a.textureCutoffMax, i), sec);
      g.delay.feedback.rampTo(lerp(AUDIO_CONFIG.delay.feedback, a.delayFeedbackBusy, i), sec);
    } catch {
      /* noop */
    }
  }

  private applyEpoch(p: number): void {
    if (!this.graph) return;
    const e = AUDIO_CONFIG.epoch;
    try {
      this.graph.droneFilter.frequency.rampTo(lerp(e.cutoffMin, e.cutoffMax, p), e.smoothingSec);
      this.graph.droneB.detune.rampTo(lerp(0, e.detuneMax, p), e.smoothingSec);
      this.graph.droneOvertoneGain.gain.rampTo(p * e.overtoneMax, e.smoothingSec);
    } catch {
      /* noop */
    }
  }

  /* ── the melodic walk: the tx stream writes the melody ─────────────────────────────────── */

  /** Advance the melodic cursor for one sampled tx and return the note to play. Counterpoint
   *  constraints: bar-first notes anchor on the chord root, leaps resolve one step in contrary
   *  motion, strong-beat notes snap to chord tones, and the cursor reflects at the range edges. */
  private walkNote(type: TxType, time: number): { degree: number; octaveOffset: number } {
    const m = AUDIO_CONFIG.melody;
    const transport = Tone.getTransport();
    let ticks = 0;
    try {
      ticks = Math.round(transport.getTicksAtTime(time));
    } catch {
      /* idle transport — treat as tick 0 */
    }
    const ppq = transport.PPQ;
    const bar = Math.floor(ticks / (ppq * 4));
    const beatPos = ticks % ppq;
    const onBeat = beatPos <= 1 || ppq - beatPos <= 1; // tolerance for rounding

    let next: number;
    if (bar !== this.melodyLastBar) {
      // First note of the bar: anchor the phrase on the chord root.
      next = this.nearestDegreeOfClass(this.melodyCursor, this.currentChordDegrees[0]);
      this.melodyLastBar = bar;
    } else if (Math.abs(this.melodyLastInterval) >= m.leapThreshold) {
      // A leap resolves stepwise in contrary motion (the oldest rule in the book).
      next = this.melodyCursor - Math.sign(this.melodyLastInterval);
    } else if (type === 'stake') {
      // Stake pulls toward the root — the network staking is the bassline gravitating home.
      next = this.stepTowardRoot(this.melodyCursor);
    } else {
      next = this.melodyCursor + m.intervals[type];
    }

    // Reflect at the range edges so the line turns around instead of escaping.
    if (next < 0) next = -next;
    if (next > m.range) next = 2 * m.range - next;
    next = clamp(Math.round(next), 0, m.range);

    if (onBeat) next = this.snapToChord(next);

    this.melodyLastInterval = next - this.melodyCursor;
    this.melodyCursor = next;

    const octDown = type === 'stake' && m.stakeOctaveDown ? -1 : 0;
    return { degree: next, octaveOffset: m.octave + octDown };
  }

  /** Nearest degree to `from` sharing `target`'s pitch class (mod scale length). */
  private nearestDegreeOfClass(from: number, target: number): number {
    const len = this.activeScale.length;
    const pc = ((target % len) + len) % len;
    let best = from;
    let bestDist = Infinity;
    for (let d = pc; d <= AUDIO_CONFIG.melody.range; d += len) {
      const dist = Math.abs(d - from);
      if (dist < bestDist) {
        bestDist = dist;
        best = d;
      }
    }
    return best;
  }

  /** Move up to two steps toward the nearest octave of the current chord root. */
  private stepTowardRoot(cur: number): number {
    const target = this.nearestDegreeOfClass(cur, this.currentChordDegrees[0]);
    if (target === cur) return cur;
    return cur + Math.sign(target - cur) * Math.min(2, Math.abs(target - cur));
  }

  /** Snap a degree to the nearest chord tone (searching outward, preferring downward). */
  private snapToChord(deg: number): number {
    const len = this.activeScale.length;
    const pcs = this.currentChordDegrees.map((d) => ((d % len) + len) % len);
    for (let r = 0; r <= 3; r++) {
      for (const cand of [deg - r, deg + r]) {
        if (cand >= 0 && cand <= AUDIO_CONFIG.melody.range && pcs.includes(((cand % len) + len) % len)) {
          return cand;
        }
      }
    }
    return deg;
  }

  /* ── the sidechain pump ────────────────────────────────────────────────────────────────── */

  /** Duck the sustained layers at the kick and swell back — scheduled on the kick's exact grid
   *  time so the pump locks to the heartbeat. */
  private schedulePump(time: number): void {
    const g = this.graph;
    if (!g) return;
    const p = AUDIO_CONFIG.pump;
    if (p.depth <= 0.001) return;
    for (const duck of g.pumpDucks) {
      try {
        duck.gain.cancelScheduledValues(time);
        duck.gain.setValueAtTime(duck.gain.value, time);
        duck.gain.linearRampToValueAtTime(1 - p.depth, time + p.attackSec);
        duck.gain.linearRampToValueAtTime(1, time + p.attackSec + p.releaseSec);
      } catch {
        /* a duck mid-dispose — harmless */
      }
    }
  }

  setPumpDepth(v: number): void {
    AUDIO_CONFIG.pump.depth = clamp(v, 0, 0.9);
  }

  private stepLead(): void {
    const g = this.graph;
    if (!g) return;
    const cfg = AUDIO_CONFIG.lead;
    const motif = this.useBrightMotif ? cfg.brightMotif : cfg.motif;
    if (motif.length === 0) return;
    const deg = motif[this.leadStep % motif.length];
    this.leadStep += 1;
    const freq = this.degreeToFreq(deg, cfg.octave);
    const time = this.quantize(cfg.quantize);
    try {
      g.lead.triggerAttackRelease(freq, cfg.dur, time, cfg.velocity);
    } catch {
      /* noop */
    }
  }

  private recomputeMixer(): void {
    const g = this.graph;
    if (!g) return;
    const anySolo = Object.values(g.strips).some((s) => s.soloed);
    for (const s of Object.values(g.strips)) {
      const audible = s.muted ? false : anySolo ? s.soloed : true;
      s.level.gain.rampTo(audible ? s.userLevel : 0, 0.05);
    }
  }

  /** The fader value a strip should hold given mute/solo, so live changes respect gating. */
  private gateValue(s: Strip, desired: number): number {
    if (!this.graph) return desired;
    const anySolo = Object.values(this.graph.strips).some((x) => x.soloed);
    const audible = s.muted ? false : anySolo ? s.soloed : true;
    return audible ? desired : 0;
  }

  /* ── helpers ───────────────────────────────────────────────────────────────────────────── */

  private guard(): Graph | null {
    return this._started && !this._disposed ? this.graph : null;
  }

  private quantize(grid: string): number {
    const transport = Tone.getTransport();
    if (transport.state !== 'started') return Tone.now() + 0.02;
    return transport.nextSubdivision(grid);
  }

  private attackChord(degrees: readonly number[], time: number): void {
    if (!this.graph) return;
    const freqs = degrees.map((d) => this.degreeToFreq(d, AUDIO_CONFIG.leader.padOctave));
    try {
      this.graph.pad.triggerAttack(freqs, time, AUDIO_CONFIG.leader.velocity);
    } catch {
      /* noop */
    }
    this.heldPad = freqs;
  }

  private rootMidi(): number {
    if (this.cachedRootMidi === null) {
      this.cachedRootMidi = Tone.Frequency(
        `${AUDIO_CONFIG.key.root}${AUDIO_CONFIG.key.baseOctave}`,
      ).toMidi();
    }
    return this.cachedRootMidi + this.liftSemis; // liftSemis = the Sunrise's temporary key lift
  }

  /** Map a scale degree (with octave wrap) to a frequency in the ACTIVE scale (minor, or the bright
   *  scale during the Sunrise). Never chromatic. */
  private degreeToFreq(degree: number, octaveOffset: number): number {
    const scale = this.activeScale;
    const len = scale.length;
    const idx = ((degree % len) + len) % len;
    const oct = Math.floor(degree / len) + octaveOffset;
    const midi = this.rootMidi() + scale[idx] + 12 * oct;
    return Tone.Frequency(midi, 'midi').toFrequency();
  }

  /* ── graph construction ────────────────────────────────────────────────────────────────── */

  private build(): Graph {
    const D: Disposable[] = [];
    const reg = <T extends Disposable>(n: T): T => {
      D.push(n);
      return n;
    };

    // Master bus: everything → master (mute) → movement filter (Director) → comp → limiter → out.
    const master = reg(new Tone.Gain(this._muted ? 0 : AUDIO_CONFIG.master.outputGain));
    const movementFilter = reg(
      new Tone.Filter({ type: 'lowpass', frequency: AUDIO_CONFIG.director.movementCutoffMin, Q: 0.6, rolloff: -12 }),
    );
    const comp = reg(
      new Tone.Compressor({
        threshold: AUDIO_CONFIG.master.compThresholdDb,
        ratio: AUDIO_CONFIG.master.compRatio,
        attack: 0.01,
        release: 0.25,
      }),
    );
    const limiter = reg(new Tone.Limiter(AUDIO_CONFIG.master.ceilingDb));
    // The mixing table: a 3-band EQ + a bipolar DJ filter sit between the Director's movement
    // filter and the mastering comp/limiter; an analyser taps the final output for the spectrum.
    const eq3 = reg(
      new Tone.EQ3({
        low: AUDIO_CONFIG.eq.low,
        mid: AUDIO_CONFIG.eq.mid,
        high: AUDIO_CONFIG.eq.high,
        lowFrequency: AUDIO_CONFIG.eq.lowFrequency,
        highFrequency: AUDIO_CONFIG.eq.highFrequency,
      }),
    );
    const djFilter = reg(new Tone.Filter({ type: 'lowpass', frequency: 20000, Q: 0.7 }));
    const analyser = reg(new Tone.Analyser('fft', 256)); // 256 bins ≈ 86 Hz each — fine enough to see the bass band move
    master.connect(movementFilter);
    movementFilter.connect(eq3);
    eq3.connect(djFilter);
    djFilter.connect(comp);
    comp.connect(limiter);
    limiter.connect(analyser);
    limiter.toDestination();

    // Space.
    const reverb = reg(
      new Tone.Reverb({ decay: AUDIO_CONFIG.reverb.decaySec, preDelay: AUDIO_CONFIG.reverb.preDelaySec, wet: 1 }),
    );
    reverb.connect(master);
    const delay = reg(
      new Tone.FeedbackDelay({ delayTime: AUDIO_CONFIG.delay.time, feedback: AUDIO_CONFIG.delay.feedback, wet: 1 }),
    );
    delay.connect(reverb);
    const reverbBus = reg(new Tone.Gain(1));
    reverbBus.connect(reverb);
    const delayBus = reg(new Tone.Gain(1));
    delayBus.connect(delay);

    const strips: Record<string, Strip> = {};
    const pumpDucks: Tone.Gain[] = [];
    // The sustained layers breathe with the kick (the sidechain pump). One-shots are exempt.
    const PUMPED = new Set(['pad', 'texture', 'drone', 'bed']);
    // A named channel strip: src → level (fader) [→ duck] → dry/reverb/delay sends.
    const makeStrip = (
      name: string,
      src: Tone.ToneAudioNode,
      opt: { level: number; reverb?: number; delay?: number },
    ): void => {
      const level = reg(new Tone.Gain(opt.level));
      src.connect(level);
      let out: Tone.Gain = level;
      if (PUMPED.has(name)) {
        const duck = reg(new Tone.Gain(1));
        level.connect(duck);
        pumpDucks.push(duck);
        out = duck;
      }
      const dry = reg(new Tone.Gain(1));
      const rev = reg(new Tone.Gain(opt.reverb ?? 0));
      const del = reg(new Tone.Gain(opt.delay ?? 0));
      out.connect(dry);
      dry.connect(master);
      out.connect(rev);
      rev.connect(reverbBus);
      out.connect(del);
      del.connect(delayBus);
      strips[name] = { level, dry, rev, del, userLevel: opt.level, muted: false, soloed: false };
    };

    // ── Heartbeat kick ──
    const kick = reg(new Tone.MembraneSynth());
    kick.set({
      pitchDecay: AUDIO_CONFIG.slot.pitchDecay,
      octaves: AUDIO_CONFIG.slot.octaves,
      oscillator: { type: 'sine' },
      envelope: { attack: 0.001, decay: 0.4, sustain: 0.0, release: 0.4 },
    });
    makeStrip('kick', kick, { level: AUDIO_CONFIG.slot.gain, reverb: AUDIO_CONFIG.slot.sendReverb, delay: AUDIO_CONFIG.slot.sendDelay });

    // ── Ghost (missed slot) ──
    const ghost = reg(new Tone.NoiseSynth());
    ghost.set({ noise: { type: 'white' }, envelope: { attack: 0.004, decay: AUDIO_CONFIG.missed.dur, sustain: 0 } });
    const ghostFilter = reg(new Tone.Filter({ type: 'bandpass', frequency: AUDIO_CONFIG.missed.filterStart, Q: 1.2 }));
    ghost.connect(ghostFilter);
    makeStrip('ghost', ghostFilter, { level: AUDIO_CONFIG.missed.gain, reverb: AUDIO_CONFIG.missed.sendReverb, delay: AUDIO_CONFIG.missed.sendDelay });

    // ── Leader pad ──
    const pad = new Tone.PolySynth(Tone.Synth);
    reg(pad);
    pad.maxPolyphony = AUDIO_CONFIG.leader.maxPolyphony;
    pad.set({
      oscillator: { type: 'fatsine', spread: 18, count: 2 },
      envelope: {
        attack: AUDIO_CONFIG.leader.attack,
        decay: AUDIO_CONFIG.leader.decay,
        sustain: AUDIO_CONFIG.leader.sustain,
        release: AUDIO_CONFIG.leader.release,
      },
    });
    makeStrip('pad', pad, { level: AUDIO_CONFIG.leader.gain, reverb: AUDIO_CONFIG.leader.sendReverb, delay: AUDIO_CONFIG.leader.sendDelay });

    // ── Finality swell ──
    const swell = new Tone.PolySynth(Tone.Synth);
    reg(swell);
    swell.maxPolyphony = 12;
    swell.set({
      oscillator: { type: 'fatsawtooth', spread: 14, count: 2 },
      envelope: {
        attack: AUDIO_CONFIG.finality.attack,
        decay: AUDIO_CONFIG.finality.decay,
        sustain: AUDIO_CONFIG.finality.sustain,
        release: AUDIO_CONFIG.finality.release,
      },
    });
    const swellFilter = reg(new Tone.Filter({ type: 'lowpass', frequency: AUDIO_CONFIG.finality.filterFrom, Q: 0.7 }));
    swell.connect(swellFilter);
    makeStrip('swell', swellFilter, { level: AUDIO_CONFIG.finality.gain, reverb: AUDIO_CONFIG.finality.sendReverb, delay: AUDIO_CONFIG.finality.sendDelay });

    // ── Transaction voices ──
    const mkSynth = (): Tone.PolySynth<any> => {
      const s = new Tone.PolySynth(Tone.Synth);
      s.maxPolyphony = AUDIO_CONFIG.tx.maxPolyphony;
      return s;
    };
    const txTransfer = reg(mkSynth());
    txTransfer.set({ oscillator: { type: 'triangle' }, envelope: { attack: 0.002, decay: 0.18, sustain: 0.0, release: 0.3 } });
    const txDefi = reg(new Tone.PolySynth(Tone.FMSynth));
    txDefi.maxPolyphony = AUDIO_CONFIG.tx.maxPolyphony;
    txDefi.set({
      harmonicity: 2.5,
      modulationIndex: 6,
      oscillator: { type: 'sine' },
      envelope: { attack: 0.003, decay: 0.3, sustain: 0.0, release: 0.5 },
      modulation: { type: 'sine' },
      modulationEnvelope: { attack: 0.01, decay: 0.2, sustain: 0, release: 0.3 },
    });
    const txNft = reg(mkSynth());
    txNft.set({ oscillator: { type: 'sine' }, envelope: { attack: 0.002, decay: 0.25, sustain: 0.0, release: 0.4 } });
    const txStake = reg(new Tone.PolySynth(Tone.AMSynth));
    txStake.maxPolyphony = AUDIO_CONFIG.tx.maxPolyphony;
    txStake.set({
      harmonicity: 2,
      oscillator: { type: 'sine' },
      envelope: { attack: 0.004, decay: 0.4, sustain: 0.0, release: 0.6 },
      modulation: { type: 'square' },
      modulationEnvelope: { attack: 0.02, decay: 0.3, sustain: 0, release: 0.4 },
    });
    const tx: Record<TxType, Tone.PolySynth<any>> = { transfer: txTransfer, defi: txDefi, nft: txNft, stake: txStake };
    makeStrip('tx_transfer', txTransfer, { level: AUDIO_CONFIG.tx.transfer.gain, reverb: AUDIO_CONFIG.tx.transfer.sendReverb, delay: AUDIO_CONFIG.tx.transfer.sendDelay });
    makeStrip('tx_defi', txDefi, { level: AUDIO_CONFIG.tx.defi.gain, reverb: AUDIO_CONFIG.tx.defi.sendReverb, delay: AUDIO_CONFIG.tx.defi.sendDelay });
    makeStrip('tx_nft', txNft, { level: AUDIO_CONFIG.tx.nft.gain, reverb: AUDIO_CONFIG.tx.nft.sendReverb, delay: AUDIO_CONFIG.tx.nft.sendDelay });
    makeStrip('tx_stake', txStake, { level: AUDIO_CONFIG.tx.stake.gain, reverb: AUDIO_CONFIG.tx.stake.sendReverb, delay: AUDIO_CONFIG.tx.stake.sendDelay });

    // ── Lead (melodic line; level rides intensity) ──
    const lead = reg(new Tone.PolySynth(Tone.FMSynth));
    lead.maxPolyphony = 8;
    lead.set({
      harmonicity: 1.5,
      modulationIndex: 3,
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.005, decay: 0.3, sustain: 0.1, release: 0.5 },
      modulation: { type: 'sine' },
      modulationEnvelope: { attack: 0.02, decay: 0.2, sustain: 0, release: 0.3 },
    });
    const leadIntensityGain = reg(new Tone.Gain(0)); // intensity opens this; the strip is the user fader
    lead.connect(leadIntensityGain);
    makeStrip('lead', leadIntensityGain, { level: 1, reverb: AUDIO_CONFIG.lead.sendReverb, delay: AUDIO_CONFIG.lead.sendDelay });

    // ── Epoch drone ──
    const droneRoot = this.degreeToFreq(AUDIO_CONFIG.epoch.rootDeg, AUDIO_CONFIG.epoch.octave);
    const droneFifth = this.degreeToFreq(AUDIO_CONFIG.epoch.fifthDeg, AUDIO_CONFIG.epoch.octave);
    const droneA = reg(new Tone.Oscillator(droneRoot, 'sine'));
    const droneB = reg(new Tone.Oscillator(droneFifth, 'sine'));
    const droneOvertone = reg(new Tone.Oscillator(droneRoot * 2, 'triangle'));
    const droneOvertoneGain = reg(new Tone.Gain(0));
    droneOvertone.connect(droneOvertoneGain);
    const droneFilter = reg(new Tone.Filter({ type: 'lowpass', frequency: AUDIO_CONFIG.epoch.cutoffMin, Q: 0.5 }));
    droneA.connect(droneFilter);
    droneB.connect(droneFilter);
    droneOvertoneGain.connect(droneFilter);
    makeStrip('drone', droneFilter, { level: AUDIO_CONFIG.epoch.gain, reverb: AUDIO_CONFIG.epoch.sendReverb });

    // ── Activity texture (level/brightness ride intensity) ──
    const texture = reg(new Tone.Noise('pink'));
    const textureFilter = reg(new Tone.Filter({ type: 'lowpass', frequency: AUDIO_CONFIG.activity.textureCutoffMin, Q: 0.4 }));
    const textureGain = reg(new Tone.Gain(0));
    texture.connect(textureFilter);
    textureFilter.connect(textureGain);
    makeStrip('texture', textureGain, { level: 1, reverb: 0.4 });

    // ── Riser (the Sunrise sweep) ──
    const riser = reg(new Tone.Noise('white'));
    const riserFilter = reg(new Tone.Filter({ type: 'bandpass', frequency: 300, Q: 1.5 }));
    const riserGain = reg(new Tone.Gain(0.0001));
    riser.connect(riserFilter);
    riserFilter.connect(riserGain);
    makeStrip('riser', riserGain, { level: 1, reverb: 0.5, delay: 0.3 });

    return {
      master,
      movementFilter,
      reverb,
      reverbBus,
      delayBus,
      delay,
      eq3,
      djFilter,
      analyser,
      limiter,
      pumpDucks,
      reverbReady: reverb.ready,
      kick,
      ghost,
      ghostFilter,
      pad,
      swell,
      swellFilter,
      tx,
      lead,
      leadIntensityGain,
      droneA,
      droneB,
      droneOvertone,
      droneOvertoneGain,
      droneFilter,
      texture,
      textureFilter,
      textureGain,
      riser,
      riserFilter,
      riserGain,
      strips,
      bed: null,
      bedGain: null,
      disposables: D,
    };
  }

  private async loadAndStartBed(): Promise<void> {
    const g = this.graph;
    if (!g) return;
    if (this.bedUrl === null || this.bedUrl === '') return;
    if (g.bed) {
      try {
        g.bed.start();
      } catch {
        /* noop */
      }
      return;
    }

    const url = this.bedUrl;
    try {
      const player = await new Promise<Tone.Player>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('bed load timeout')), AUDIO_CONFIG.bed.loadTimeoutMs);
        const p: Tone.Player = new Tone.Player({
          url,
          loop: true,
          fadeIn: AUDIO_CONFIG.bed.fadeSec,
          fadeOut: AUDIO_CONFIG.bed.fadeSec,
          onload: () => {
            clearTimeout(timeout);
            resolve(p);
          },
          onerror: (e: Error) => {
            clearTimeout(timeout);
            reject(e);
          },
        });
      });

      if (this._disposed || !this.graph) {
        player.dispose();
        return;
      }

      const bedGain = new Tone.Gain(AUDIO_CONFIG.bed.gain);
      const bedDuck = new Tone.Gain(1); // the bed pumps with the kick too
      const bedReverb = new Tone.Gain(AUDIO_CONFIG.bed.sendReverb);
      player.connect(bedGain);
      bedGain.connect(bedDuck);
      bedDuck.connect(this.graph.master);
      bedDuck.connect(bedReverb);
      bedReverb.connect(this.graph.reverbBus);
      this.graph.pumpDucks.push(bedDuck);
      this.graph.disposables.push(player, bedGain, bedDuck, bedReverb);
      this.graph.bed = player;
      this.graph.bedGain = bedGain;
      // a simple strip handle so the studio can fade the bed too
      this.graph.strips['bed'] = { level: bedGain, dry: bedGain, rev: bedReverb, del: bedReverb, userLevel: AUDIO_CONFIG.bed.gain, muted: false, soloed: false };
      if (this._started) player.start();
    } catch (e) {
      console.warn('[AudioEngine] bed track unavailable — running reactive-only.', url, e);
    }
  }
}

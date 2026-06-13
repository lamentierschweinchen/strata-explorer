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
 * THE GRID: the chain's measured tempo — one slot ≈ 397ms ≈ 151 BPM; ONE SLOT = ONE BEAT, ONE
 * LEADER (4 slots) = ONE BAR; finality ≈ 12s ≈ 7.5 bars. Events QUANTIZE to the grid (a tiny,
 * honest nudge); the kick's normalization is selectable (slot.gridMode: locked / loose / raw),
 * with surplus same-beat slots voiced as pickup double-kicks in 'locked'.
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
  /** The grid: the chain's TRUE measured tempo — one slot ≈ 397ms ≈ 151 BPM, one beat per slot.
   *  (Setting 150 = the spec's 400ms is also honest, differently: the hot-running chain then
   *  laps the metronome ~once a minute and the surplus slots surface as regular pickup doubles.
   *  The studio's Tempo slider is the switch.) */
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

  /** The key. Everything maps into this scale — never raw chromatic.
   *
   *  WHY E: the chain's heartbeat IS a pitch. One slot = 396ms = 2.525 Hz; five octaves up that is
   *  80.8 Hz ≈ E2 (−34 cents). At spec (400ms) Solana would sit in the crack between D# and E —
   *  the real network runs slightly hot, and that overdelivery commits it to E. Voiced DORIAN (the
   *  dub mode: minor with a lit 6th), with the kick on E1 = 41.2 Hz — the canonical club sub. */
  key: {
    root: 'E',
    baseOctave: 2,
    scale: [0, 2, 3, 5, 7, 9, 10], // E Dorian: E F# G A B C# D
    scaleName: 'E Dorian',
    /** Global tuning offset. 0 = concert pitch (stay in tune with the bed / the world).
     *  −34 = the chain's TRUE pitch (the measured 396ms slot, octave-shifted, exactly). */
    tuningOffsetCents: 0,
    /** THE EPOCH ACT — the 2-day key gets an inner arc: the progression's center of gravity
     *  migrates with epoch progress — tonic (dawn third) → subdominant (midday) → dominant (dusk),
     *  so the whole epoch is one giant cadence and the rollover Sunrise RESOLVES it into the next
     *  key. Functional harmony at the network's calendar scale. */
    actBias: true,
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
    /** EPOCH MODULATION — each Solana epoch (~2 days) is its own key, stepping a perfect fifth
     *  from home per epoch (the circle of fifths: 12 epochs ≈ 24 days tours all 12 keys and comes
     *  home). The rollover Sunrise lands IN the new key — each network day in a new light. */
    epochModulation: { enabled: true, stepSemis: 7 },
  },

  /** MOMENTS — rare, honest gestures fired by detectors on real network behavior. Each also has
   *  a manual trigger (the studio's MOMENTS buttons) for tuning by ear. Cooldowns keep the gallery
   *  calm; every gesture maps to one real cause. */
  moments: {
    /** ⚡ SURGE — activity spike: TPS crosses `ratio` × its trailing average (EMA, `emaTauSec`)
     *  above an absolute floor → a mini-build (the Sunrise's little cousin): energy climbs, the
     *  riser sweeps, the dub delay storms, then it exhales. No key change, kick keeps driving. */
    surge: {
      enabled: true,
      ratio: 1.6,
      floorTps: 1200,
      emaTauSec: 240,
      cooldownSec: 240,
      buildBars: 6,
      holdBars: 2,
      releaseBars: 8,
      delayThrow: 0.78, // feedback pushed here at the peak, easing back over the release
      settleIntensity: 0.55,
    },
    /** 🐋 DEEP — a whale: a single tx with magnitude ≥ threshold → one deep gong on the key root,
     *  long tail, the room ringing around it. Rare by construction. */
    deep: {
      enabled: true,
      threshold: 0.95,
      cooldownSec: 30,
      octave: 0, // root at baseOctave (E2) — felt more than heard
      subOctaveDown: true, // double an octave below (E1) for the chest
      dur: 2.5,
      velocity: 0.65,
    },
    /** 𝄽 STUMBLE — the network trips: ≥ `misses` missed slots within the last `windowSlots` →
     *  the kick drops out for `dropBars` and the room holds its breath, then the floor returns. */
    stumble: {
      enabled: true,
      misses: 3,
      windowSlots: 8,
      dropBars: 1,
      cooldownSec: 90,
    },
    /** ⨀ THE MILLIONTH LAYER — the slot counter crossing a 1,000,000 boundary (~every 4.6 days):
     *  one grand bell — the deep gong under a bright tonic swell and a momentary reverb bloom.
     *  The HUD's slot number rolls over at the same instant; sight and sound agree. */
    milestone: {
      enabled: true,
      everySlots: 1_000_000,
    },
  },

  /** THE ARRANGER — phrase-level musical storytelling. The CLOCK is musical convention (8-bar
   *  phrases, 32-bar sections ≈ 51s — club pacing); the DECISIONS are the chain's: at every
   *  section boundary the arranger reads what the network actually did during the last section
   *  (average TPS vs its trailing baseline, miss rate) and chooses the next block:
   *    GROOVE — the driving default;
   *    DUB    — the network cooled / stumbled: strip back, slower harmony, deeper echoes;
   *    LIFT   — the network is heating: faster harmonic rhythm, busier melody, a riser into the turn;
   *    BREAK  — energy is high and it's been a while: the kick VANISHES for `breakKickOutBars`,
   *             the pad blooms, a riser climbs — then the DROP: floor back, delay throw, deep hit.
   *  Every 8th bar the hats breathe (the phrase made audible). The chain DJs the room. */
  arranger: {
    enabled: true,
    sectionBars: 32,
    phraseBars: 8,
    breakKickOutBars: 8,
    liftTpsRatio: 1.15, // section avg TPS ≥ this × baseline → LIFT
    dubTpsRatio: 0.85, // ≤ this × baseline (or missy) → DUB
    dubMissRate: 0.06,
    breakMinIntensity: 0.55, // BREAK only when the room has energy to spend
    minSectionsBetweenBreaks: 3,
  },

  /** THE HEARTBEAT — a soft sub kick on each produced slot. The note tracks the key root
   *  (setKey retunes it): home = E1 ≈ 41.2 Hz, the canonical club sub.
   *
   *  THE FLOOR — three normalization options (the studio's Floor switch), all honest, none
   *  ever inventing a kick (no slot = no kick; the hole is the network's truth):
   *    'locked'  every kick EXACTLY on a beat (measured arrivals: median 392ms, 90% within
   *              −80/+97ms — nearly every slot claims its own beat). A second slot arriving for
   *              a claimed beat voices as a softer PICKUP double at doublePosition (0.75 = the
   *              last 16th before the next downbeat — the classic drive figure); further
   *              same-beat slots merge silently. The metronomic dance floor.
   *    'loose'   snapped to the 16th grid: musical but arrival-true (the gentle limp).
   *    'raw'     no grid at all — the kick fires at arrival, the chain's naked jitter. */
  slot: {
    note: 'E1',
    dur: 0.28,
    velocity: 0.8,
    gain: 0.9,
    gridMode: 'locked' as 'locked' | 'loose' | 'raw',
    minGapSec: 0.06, // the beat-claim window ('locked'/'loose') / mono retrigger guard ('raw')
    doubleOnMerge: true, // 'locked' only: surplus same-beat slots become pickup doubles
    doublePosition: 0.75, // where the surplus slot lands, as a fraction of the beat
    doubleVelocity: 0.85, // × velocity — a pickup, not a flam
    pitchDecay: 0.045,
    octaves: 5,
    sendReverb: 0.08,
    sendDelay: 0.0,
  },

  /** THE EXHALE — an off-beat hat fired by the SAME slot event as the kick (one real event, two
   *  voices in a fixed musical relationship: kick on the beat, hat half a beat later — the slot's
   *  inhale/exhale). A missed slot produces NEITHER (audible honesty). Velocity rides intensity:
   *  on a calm network the hats vanish entirely (pure dub); on a busy one the floor shakes. */
  hat: {
    gain: 0.16,
    velocity: 0.55,
    dur: 0.045,
    highpassHz: 7500,
    minIntensity: 0.12, // below this energy the hats stay out
    minGapSec: 0.05,
    sendReverb: 0.1,
    sendDelay: 0.18,
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

  /** LEADER CHANGE — the pad crossfades to the next chord on the downbeat. THE GIANT'S BAR:
   *  when the leading validator's stake is enormous (≥ giantStakeSol), its chord carries an
   *  extra root an octave down — the heavyweights make the ground sit deeper for their bar. */
  leader: {
    padOctave: 1,
    gain: 0.16,
    velocity: 0.45,
    giantStakeSol: 15_000_000, // ≈ the top handful of validators by stake
    giantSubRoot: true,
    attack: 2.5,
    decay: 1.0,
    sustain: 0.8,
    release: 5.0,
    maxPolyphony: 32, // covers the 5s-release crossfade × bar cadence (or chord notes drop)
    quantize: '1m',
    sendReverb: 0.5,
    sendDelay: 0.15,
  },

  /** FINALITY — a slow resolving swell on the tonic triad. On the LIVE chain the root advances
   *  almost every slot (finality is a continuous march, ~31 slots behind the tip), so the swell
   *  SAMPLES it — at most one swell per minIntervalSec, matching the felt ~12s cadence. Same
   *  sampling discipline as the transaction shimmer. */
  finality: {
    chord: [0, 2, 4],
    octave: 1,
    minIntervalSec: 10,
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
    /** THE SOUND FOLLOWS THE SPOTLIGHT: the melody voices pan to the current leader's position
     *  in the validator cloud (the same position the visual leader beam jumps to), gliding there
     *  each bar. 0 = mono center, 1 = full orbit. */
    spatialWidth: 0.6,
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

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** Transpose a root note name by semitones (octave-agnostic). */
function transposeRoot(root: string, semis: number): string {
  const i = NOTE_NAMES.indexOf(root);
  if (i < 0) return root;
  return NOTE_NAMES[(((i + semis) % 12) + 12) % 12];
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
  melodyPanners: Tone.Panner[]; // the melody voices' stereo position (follows the leader)
  reverbReady: Promise<void>;

  kick: Tone.MembraneSynth;
  hat: Tone.NoiseSynth;
  hatFilter: Tone.Filter;
  ghost: Tone.NoiseSynth;
  ghostFilter: Tone.Filter;
  pad: Tone.PolySynth<Tone.Synth>;
  swell: Tone.PolySynth<Tone.Synth>;
  swellFilter: Tone.Filter;
  tx: Record<TxType, Tone.PolySynth<any>>;
  lead: Tone.PolySynth<any>;
  leadIntensityGain: Tone.Gain;
  deep: Tone.PolySynth<any>;

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
  private allSlotCount = 0; // includes missed slots (the stumble detector's clock)
  private leadStep = 0;
  private useBrightMotif = false;

  // The melodic walk (tx-written melody).
  private melodyCursor = 7; // start mid-tessitura
  private melodyLastInterval = 0;
  private melodyLastBar = -1;

  // Key state: the current mode key (into KEY_MODES) and the Sunrise's temporary semitone lift.
  private modeKey = 'dorian';
  private liftSemis = 0;

  // Epoch→key modulation: each new epoch steps a fifth FROM THE CURRENT KEY — so manual key
  // choices and restored presets re-anchor the calendar, and the network walks on from there.
  private lastEpochNumber: number | null = null;

  // Moment detectors: trailing-average TPS (surge), cooldown stamps, missed-slot ring (stumble).
  private tpsEma: number | null = null;
  private lastTpsAt = 0;
  private _surgeActive = false;
  private surgeTimers: number[] = [];
  private lastSurgeAt = -Infinity;
  private lastDeepAt = -Infinity;
  private missedSlotMarks: number[] = []; // slotCount indices of recent misses
  private lastStumbleAt = -Infinity;
  private stumbleTimer: number | null = null;

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
  private lastDoubleAt = 0; // the off-grid pickup slot already voiced for the current beat
  private lastHatTime = 0;
  private lastGhostTime = 0;
  private lastTxTime = 0;
  private lastFinalityAt = -Infinity;

  // Leader spatial state: pan target (the leader's position in the cloud) + the giant flag.
  private leaderPan = 0;
  private leaderIsGiant = false;

  // Milestone era (slot / everySlots, anchored on the first slot seen — never fires on startup).
  private milestoneEra: number | null = null;
  /** The last 1,000,000-boundary slot celebrated (the desk toasts it). */
  public lastMilestoneSlot: number | null = null;

  // AudioContext watchdog (gallery: external suspensions get auto-resumed).
  private watchdogTimer: number | null = null;

  // ── The Arranger: phrase/section state on the leader-bar clock. The clock is musical
  // convention; the section CHOICE is the chain's (stats gathered per section, read at the turn).
  private arrSection: 'GROOVE' | 'DUB' | 'LIFT' | 'BREAK' = 'GROOVE';
  private arrReason = 'opening';
  private arrBarInSection = 0;
  private arrSectionsSinceBreak = 99;
  private arrStats = { slots: 0, miss: 0, tpsSum: 0, tpsN: 0, whales: 0 };
  private arrEmaAtStart: number | null = null;
  private arrTimers: number[] = [];
  // live per-section performance overrides (consulted at trigger time; never mutate user config)
  private arrHatMult = 1;
  private arrLeadEvery: number | null = null;
  private arrChordBars: number | null = null;
  private arrDelayBias = 0;
  private arrKickHeld = false;
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

    // Gallery watchdog: a 10-hour installation can have its AudioContext suspended from outside
    // (output-device changes, OS power events). We never suspend it ourselves, so any suspension
    // is unwanted — quietly resume. Checked every few seconds; free when all is well.
    if (this.watchdogTimer === null) {
      this.watchdogTimer = window.setInterval(() => {
        if (this._disposed || !this._started) return;
        const raw = Tone.getContext().rawContext as AudioContext;
        if (raw.state === 'suspended' || (raw.state as string) === 'interrupted') {
          void raw.resume().catch(() => {});
        }
      }, 4000);
    }

    void this.loadAndStartBed();
  }

  /** One-line health snapshot for soak checks (call from the console: strataAudio.getHealth()). */
  getHealth(): {
    contextState: string;
    started: boolean;
    transportSec: number;
    key: string;
    section: string;
    intensity: number;
  } {
    return {
      contextState: (Tone.getContext().rawContext as AudioContext).state,
      started: this._started,
      transportSec: Math.round(Tone.getTransport().seconds),
      key: AUDIO_CONFIG.key.scaleName,
      section: this.arrSection,
      intensity: +this.intensityTarget.toFixed(2),
    };
  }

  stop(): void {
    if (!this.graph || !this._started) return;
    const g = this.graph;
    const t = Tone.now();

    this.cancelSunrise();
    this.cancelMoments();
    this.cancelArranger();
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
    if (this.watchdogTimer !== null) {
      window.clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
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
    this.cancelMoments();
    this.cancelArranger();
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

  onSlot(slot: number, missed: boolean): void {
    const g = this.guard();
    if (!g) return;

    this.allSlotCount += 1;

    if (missed) {
      // Mono guard: a burst of misses in one tick (e.g. a WS catch-up) must not retrigger the
      // mono noise source at the same instant — nudge each ghost forward like the kick.
      let time = this.quantize(AUDIO_CONFIG.missed.quantize);
      time = Math.max(time, this.lastGhostTime + 0.03);
      this.lastGhostTime = time;
      const f = g.ghostFilter.frequency;
      try {
        f.cancelScheduledValues(time);
        f.setValueAtTime(AUDIO_CONFIG.missed.filterStart, time);
        f.exponentialRampToValueAtTime(AUDIO_CONFIG.missed.filterEnd, time + AUDIO_CONFIG.missed.dur);
      } catch {
        /* overlapping ghosts can collide on the shared filter param — harmless */
      }
      try {
        g.ghost.triggerAttackRelease(AUDIO_CONFIG.missed.dur, time, AUDIO_CONFIG.missed.velocity);
      } catch {
        /* a same-instant retrigger race — drop this ghost rather than throw */
      }

      this.arrStats.miss += 1;

      // 𝄽 STUMBLE detector: a cluster of misses = the network tripping → the floor drops out.
      const st = AUDIO_CONFIG.moments.stumble;
      this.missedSlotMarks.push(this.allSlotCount);
      this.missedSlotMarks = this.missedSlotMarks.filter((m) => this.allSlotCount - m < st.windowSlots);
      if (
        st.enabled &&
        this.missedSlotMarks.length >= st.misses &&
        Tone.now() - this.lastStumbleAt > st.cooldownSec
      ) {
        this.missedSlotMarks = [];
        this.triggerStumble();
      }
      return;
    }

    // THE FLOOR (config.slot.gridMode) — how the kick is normalized onto the grid:
    //   'raw'    fire at arrival (mono guard only) — the chain's naked jitter;
    //   'loose'  snap to the 16th grid — musical but arrival-true;
    //   'locked' snap to the BEAT — a metronomic floor; a SECOND slot arriving for a claimed
    //            beat voices as a softer pickup double (the surplus block, made audible), and
    //            further same-beat slots merge silently. No mode ever invents a kick.
    const sc = AUDIO_CONFIG.slot;
    const mode = sc.gridMode;
    const beatSec = 60 / AUDIO_CONFIG.tempoBpm;
    let voicedAt: number | null = null;
    let isDouble = false;
    let onBeat = false; // a primary voicing (drives the pump and the hat)
    if (mode === 'raw') {
      const t = Tone.now() + 0.02;
      if (t > this.lastKickTime + 0.03) {
        voicedAt = t;
        onBeat = true;
        this.lastKickTime = t;
      }
    } else {
      const time = this.quantize(mode === 'locked' ? '4n' : '16n');
      if (time > this.lastKickTime + sc.minGapSec) {
        voicedAt = time;
        onBeat = true;
        this.lastKickTime = time;
      } else if (mode === 'locked' && sc.doubleOnMerge) {
        const dbl = this.lastKickTime + beatSec * sc.doublePosition;
        if (dbl > this.lastDoubleAt + 0.01 && dbl > Tone.now()) {
          voicedAt = dbl;
          isDouble = true;
          this.lastDoubleAt = dbl;
        }
      }
    }
    if (voicedAt !== null) {
      if (onBeat) this.schedulePump(voicedAt); // the pump breathes with primary kicks only
      // Frequency (not note-name) so the global tuning offset applies to the heartbeat too.
      g.kick.triggerAttackRelease(
        this.tuned(Tone.Frequency(sc.note).toFrequency()),
        sc.dur,
        voicedAt,
        sc.velocity * (isDouble ? sc.doubleVelocity : 1),
      );
    }
    this.arrStats.slots += 1; // every slot counts, voiced or merged — they all happened

    // ⨀ THE MILLIONTH LAYER — the slot counter crosses a 1,000,000 boundary (~every 4.6 days).
    const ms = AUDIO_CONFIG.moments.milestone;
    if (ms.enabled && ms.everySlots > 0) {
      const era = Math.floor(slot / ms.everySlots);
      if (this.milestoneEra === null) {
        this.milestoneEra = era; // anchor on the first slot seen — never fires on startup
      } else if (era > this.milestoneEra) {
        this.milestoneEra = era;
        this.triggerMilestone(era * ms.everySlots);
      }
    }

    // THE EXHALE — the same slot fires an off-beat hat half a beat after its kick. Intensity
    // gates it (calm network = no hats, pure dub) and the phrase's final bar breathes (hats rest).
    const hcfg = AUDIO_CONFIG.hat;
    const phraseBreath =
      AUDIO_CONFIG.arranger.enabled &&
      this.arrBarInSection % AUDIO_CONFIG.arranger.phraseBars === AUDIO_CONFIG.arranger.phraseBars - 1;
    const hatLevel = this.intensityTarget * this.arrHatMult;
    if (onBeat && voicedAt !== null && hatLevel >= hcfg.minIntensity && !phraseBreath) {
      let hatTime = voicedAt + beatSec / 2;
      hatTime = Math.max(hatTime, this.lastHatTime + hcfg.minGapSec);
      this.lastHatTime = hatTime;
      try {
        g.hat.triggerAttackRelease(hcfg.dur, hatTime, hcfg.velocity * (0.25 + 0.75 * hatLevel));
      } catch {
        /* same-instant retrigger race — drop this hat rather than throw */
      }
    }

    // The chain advances the melody — one step every `everySlots` produced blocks (the arranger
    // may densify or sparsen the rate per section).
    this.slotCount += 1;
    const leadEvery = Math.max(1, this.arrLeadEvery ?? AUDIO_CONFIG.lead.everySlots);
    if (AUDIO_CONFIG.lead.enabled && this.slotCount % leadEvery === 0) {
      this.stepLead();
    }
  }

  /** Where the new leader STANDS (its position in the validator cloud, −1..1 across the stage)
   *  and how HEAVY it is (raw stake in SOL). Call just before onLeaderChange for the same bar:
   *  the melody voices glide to the leader's side — the sound follows the spotlight — and a
   *  giant's chord carries a sub-octave root. Both optional; unset = centered, ordinary. */
  setLeaderSpatial(pan: number, stakeSol = 0): void {
    this.leaderPan = clamp(pan, -1, 1);
    this.leaderIsGiant =
      AUDIO_CONFIG.leader.giantSubRoot && stakeSol >= AUDIO_CONFIG.leader.giantStakeSol;
    const g = this.graph;
    if (!g) return;
    const target = this.leaderPan * clamp(AUDIO_CONFIG.melody.spatialWidth, 0, 1);
    for (const p of g.melodyPanners) {
      try {
        p.pan.rampTo(target, 0.5); // a glide, not a jump — the stage rotates with the schedule
      } catch {
        /* noop */
      }
    }
  }

  onLeaderChange(leaderIndex: number): void {
    const g = this.guard();
    if (!g) return;
    if (leaderIndex === this.lastLeaderIndex) return;
    this.lastLeaderIndex = leaderIndex;
    this.leaderChangeCount += 1;
    this.arrangerBarTick(); // one leader = one bar = the arranger's clock

    // Advance the harmony. Sequential = walk the progression on a slower harmonic rhythm (longer
    // arcs); leader = each validator's signature chord. The arranger may override the cadence
    // (BREAK holds, LIFT accelerates), and the EPOCH ACT rotates the walk's starting chord so the
    // progression's center migrates i → iv → v across the network's 2-day "day".
    const prog = AUDIO_CONFIG.key.progression;
    let chord: number[];
    if (AUDIO_CONFIG.director.progressionMode === 'sequential') {
      const every = Math.max(1, this.arrChordBars ?? AUDIO_CONFIG.director.chordChangeEveryBars);
      if (this.leaderChangeCount % every !== 0 && this.heldPad) return; // hold the chord
      const actOffset = AUDIO_CONFIG.key.actBias ? (this.lastEpochP < 1 / 3 ? 0 : this.lastEpochP < 2 / 3 ? 2 : 3) : 0;
      chord = prog[(this.progStep + actOffset) % prog.length];
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
    // Sample the continuous root march — on the live chain this fires ~every slot.
    const nowS = Tone.now();
    if (nowS - this.lastFinalityAt < c.minIntervalSec) return;
    this.lastFinalityAt = nowS;
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

    // 🐋 DEEP detector: a whale-magnitude tx → one deep gong on the root (cooldown-guarded).
    const dp = AUDIO_CONFIG.moments.deep;
    if (dp.enabled && v >= dp.threshold) {
      this.arrStats.whales += 1;
      if (Tone.now() - this.lastDeepAt > dp.cooldownSec) this.triggerDeep(v);
    }
  }

  /** CONTINUOUS density → ENERGY (texture/brightness/lead level/feedback). Never a note. */
  setActivity(tps: number): void {
    this.lastTps = tps;
    if (!this.graph) return;

    // Trailing average (EMA, dt-aware) — the surge detector's sense of "normal".
    const nowS = Tone.now();
    const sg = AUDIO_CONFIG.moments.surge;
    if (this.tpsEma === null) {
      this.tpsEma = tps;
    } else {
      const dt = Math.max(0.05, Math.min(10, nowS - this.lastTpsAt));
      const alpha = 1 - Math.exp(-dt / Math.max(1, sg.emaTauSec));
      this.tpsEma += (tps - this.tpsEma) * alpha;
    }
    this.lastTpsAt = nowS;
    this.arrStats.tpsSum += tps;
    this.arrStats.tpsN += 1;

    // ⚡ SURGE detector: a genuine spike — well above the trailing average AND an absolute floor.
    if (
      sg.enabled &&
      !this._surgeActive &&
      !this._sunriseActive &&
      !this.intensityManual &&
      tps >= sg.floorTps &&
      this.tpsEma > 0 &&
      tps / this.tpsEma >= sg.ratio &&
      nowS - this.lastSurgeAt > sg.cooldownSec
    ) {
      this.triggerSurge();
    }

    if (this.intensityManual || this._sunriseActive || this._surgeActive) return;
    if (!AUDIO_CONFIG.director.intensityFromTps) return;
    const target = clamp(tps / AUDIO_CONFIG.activity.maxTps, 0, 1);
    const rising = target > this.intensityTarget;
    const sec = rising
      ? AUDIO_CONFIG.director.intensityAttackSec
      : AUDIO_CONFIG.director.intensityReleaseSec;
    this.rampIntensityTo(target, sec);
  }

  /** Epoch position (and, when known, the epoch NUMBER — enables the key calendar). */
  onEpochProgress(p01: number, epoch?: number): void {
    const p = clamp(p01, 0, 1);

    // EPOCH MODULATION — each epoch is a key, a fifth up from the last (the circle of fifths).
    // The first epoch we see anchors "home"; the rollover Sunrise then LANDS in the new key
    // (setKey glides the drones beneath the build — each network day in a new light).
    if (epoch !== undefined && Number.isFinite(epoch)) {
      if (this.lastEpochNumber !== null && epoch !== this.lastEpochNumber && this._started) {
        const em = AUDIO_CONFIG.director.epochModulation;
        if (em.enabled) {
          // Walk fifths FROM THE CURRENT KEY: a manual key choice or a restored preset becomes
          // the new anchor, and the network's calendar keeps walking from wherever you took it.
          const delta = epoch - this.lastEpochNumber;
          const semis = ((em.stepSemis * delta) % 12 + 12) % 12;
          if (semis !== 0) this.setKey(transposeRoot(AUDIO_CONFIG.key.root, semis));
        }
        if (AUDIO_CONFIG.epoch.triggerSunriseOnRollover) this.triggerSunrise();
      }
      this.lastEpochNumber = epoch; // first sighting just anchors the calendar
    } else if (
      // Fallback rollover detection (no epoch number provided): p wraps from ~1 back to ~0.
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

  /* ── MOMENTS — rare honest gestures (detectors call these; so do the studio's buttons) ──── */

  get surgeActive(): boolean {
    return this._surgeActive;
  }

  /** ⚡ SURGE — the Sunrise's little cousin for activity spikes: a mini-build (energy climbs, the
   *  riser sweeps, the delay storms at the peak), a short hold, then a long exhale. No key change,
   *  the kick keeps driving throughout. */
  triggerSurge(): void {
    const g = this.guard();
    if (!g || this._surgeActive || this._sunriseActive) return;
    const s = AUDIO_CONFIG.moments.surge;
    this._surgeActive = true;
    this.lastSurgeAt = Tone.now();
    this.intensityManual = true;

    const barSec = (60 / AUDIO_CONFIG.tempoBpm) * 4;
    const buildSec = Math.max(1, s.buildBars * barSec);
    const holdSec = Math.max(0, s.holdBars * barSec);
    const releaseSec = Math.max(1, s.releaseBars * barSec);
    const now = Tone.now();

    try {
      this.rampIntensityTo(1, buildSec);
      g.riserGain.gain.cancelScheduledValues(now);
      g.riserGain.gain.setValueAtTime(0.0001, now);
      g.riserGain.gain.linearRampToValueAtTime(AUDIO_CONFIG.sunrise.riserGain * 0.7, now + buildSec);
      g.riserFilter.frequency.cancelScheduledValues(now);
      g.riserFilter.frequency.setValueAtTime(400, now);
      g.riserFilter.frequency.exponentialRampToValueAtTime(7000, now + buildSec);
    } catch {
      /* noop */
    }

    this.surgeTimers.push(
      window.setTimeout(() => {
        // Peak: cut the riser, throw the delay into a short storm that eases back.
        const gg = this.graph;
        if (!gg || !this._surgeActive) return;
        const t = Tone.now();
        try {
          gg.riserGain.gain.cancelScheduledValues(t);
          gg.riserGain.gain.linearRampToValueAtTime(0.0001, t + 0.2);
          gg.delay.feedback.rampTo(clamp(s.delayThrow, 0, 0.95), 0.25);
        } catch {
          /* noop */
        }
      }, buildSec * 1000),
      window.setTimeout(() => {
        // Exhale: feedback home, energy settles, control returns to live TPS.
        const gg = this.graph;
        if (!gg) return;
        try {
          gg.delay.feedback.rampTo(AUDIO_CONFIG.delay.feedback, releaseSec * 0.5);
        } catch {
          /* noop */
        }
        this.rampIntensityTo(s.settleIntensity, releaseSec);
      }, (buildSec + holdSec) * 1000),
      window.setTimeout(() => {
        this._surgeActive = false;
        this.intensityManual = false;
        this.surgeTimers = [];
      }, (buildSec + holdSec + releaseSec) * 1000),
    );
  }

  /** 🐋 DEEP — one whale: a single deep gong on the key root, long tail, the room ringing. */
  triggerDeep(value01 = 1): void {
    const g = this.guard();
    if (!g) return;
    const d = AUDIO_CONFIG.moments.deep;
    this.lastDeepAt = Tone.now();
    const time = this.quantize('8n');
    const vel = clamp(d.velocity * (0.8 + 0.4 * clamp(value01, 0, 1)), 0.05, 1);
    try {
      g.deep.triggerAttackRelease(this.degreeToFreq(0, d.octave), d.dur, time, vel);
      if (d.subOctaveDown) {
        g.deep.triggerAttackRelease(this.degreeToFreq(0, d.octave - 1), d.dur * 1.2, time, vel * 0.8);
      }
    } catch {
      /* noop */
    }
  }

  /** ⨀ THE MILLIONTH LAYER — one grand bell for a 1,000,000-slot boundary: the deep gong under a
   *  bright tonic swell, the room blooming for a breath. The HUD's odometer rolls at the same
   *  instant — sight and sound agree on the milestone. */
  triggerMilestone(boundarySlot: number): void {
    const g = this.guard();
    if (!g) return;
    this.lastMilestoneSlot = boundarySlot;
    const time = this.quantize('4n');
    try {
      // The deep toll…
      g.deep.triggerAttackRelease(this.degreeToFreq(0, 0), 3.5, time, 0.7);
      g.deep.triggerAttackRelease(this.degreeToFreq(0, -1), 4, time, 0.55);
      // …a bright tonic above it…
      const high = [0, 4].map((d) => this.degreeToFreq(d, 2));
      g.swell.triggerAttackRelease(high, 2.5, time, 0.4);
      // …and the room blooms for a breath, then settles.
      g.reverbBus.gain.rampTo(1.35, 0.6);
      g.reverbBus.gain.rampTo(1, 6, Tone.now() + 1.5);
    } catch {
      /* noop */
    }
  }

  /** 𝄽 STUMBLE — the network trips: the kick drops out for a bar; the floor returns after. */
  triggerStumble(): void {
    const g = this.guard();
    if (!g || this._sunriseActive) return; // the Sunrise owns the kick while it runs
    if (this.arrKickHeld) return; // the arranger's BREAK already has the floor out
    const st = AUDIO_CONFIG.moments.stumble;
    this.lastStumbleAt = Tone.now();
    const kick = g.strips['kick'];
    if (!kick) return;
    const barSec = (60 / AUDIO_CONFIG.tempoBpm) * 4;
    try {
      kick.level.gain.rampTo(0, 0.06); // the floor falls away
    } catch {
      /* noop */
    }
    if (this.stumbleTimer !== null) window.clearTimeout(this.stumbleTimer);
    this.stumbleTimer = window.setTimeout(() => {
      this.stumbleTimer = null;
      const gg = this.graph;
      if (!gg) return;
      const k = gg.strips['kick'];
      if (k) {
        try {
          k.level.gain.rampTo(this.gateValue(k, k.userLevel), 0.1); // …and returns
        } catch {
          /* noop */
        }
      }
    }, Math.max(0.5, st.dropBars * barSec) * 1000);
  }

  private cancelMoments(): void {
    for (const t of this.surgeTimers) window.clearTimeout(t);
    this.surgeTimers = [];
    if (this._surgeActive) {
      this._surgeActive = false;
      this.intensityManual = false;
    }
    if (this.stumbleTimer !== null) {
      window.clearTimeout(this.stumbleTimer);
      this.stumbleTimer = null;
      const g = this.graph;
      const k = g?.strips['kick'];
      if (k) {
        try {
          k.level.gain.rampTo(this.gateValue(k, k.userLevel), 0.1);
        } catch {
          /* noop */
        }
      }
    }
  }

  /* ── THE ARRANGER — chain-chosen 32-bar sections (the phrase-level storytelling) ────────── */

  /** Live arranger state for the desk readout. */
  get arrangerState(): { section: string; reason: string; bar: number; sectionBars: number } {
    return {
      section: this.arrSection,
      reason: this.arrReason,
      bar: this.arrBarInSection + 1,
      sectionBars: AUDIO_CONFIG.arranger.sectionBars,
    };
  }

  /** One leader = one bar. Advance the section clock; at the turn, let the chain pick the next. */
  private arrangerBarTick(): void {
    if (!AUDIO_CONFIG.arranger.enabled) return;
    this.arrBarInSection += 1;
    if (this.arrBarInSection < Math.max(4, AUDIO_CONFIG.arranger.sectionBars)) return;

    // The turn: read what the network DID this section, then choose the next block.
    const a = AUDIO_CONFIG.arranger;
    const s = this.arrStats;
    const avgTps = s.tpsN > 0 ? s.tpsSum / s.tpsN : 0;
    const baseline = this.arrEmaAtStart ?? this.tpsEma ?? avgTps;
    const tpsRatio = baseline > 0 ? avgTps / baseline : 1;
    const missRate = s.slots + s.miss > 0 ? s.miss / (s.slots + s.miss) : 0;

    let next: typeof this.arrSection = 'GROOVE';
    let reason = 'steady';
    if (this.arrSection === 'BREAK') {
      next = 'GROOVE';
      reason = 'the payoff after the drop';
    } else if (
      this.intensityTarget >= a.breakMinIntensity &&
      this.arrSectionsSinceBreak >= a.minSectionsBetweenBreaks &&
      !this._sunriseActive &&
      !this._surgeActive
    ) {
      next = 'BREAK';
      reason = `energy ${this.intensityTarget.toFixed(2)} — earned a breakdown`;
    } else if (tpsRatio >= a.liftTpsRatio) {
      next = 'LIFT';
      reason = `TPS +${Math.round((tpsRatio - 1) * 100)}% vs baseline`;
    } else if (missRate >= a.dubMissRate || tpsRatio <= a.dubTpsRatio) {
      next = 'DUB';
      reason = missRate >= a.dubMissRate ? `missy (${(missRate * 100).toFixed(1)}%)` : `TPS −${Math.round((1 - tpsRatio) * 100)}%`;
    }

    this.applySection(next, reason);
  }

  /** Enter a section: reset the per-section overrides, then shape this block. */
  private applySection(section: 'GROOVE' | 'DUB' | 'LIFT' | 'BREAK', reason: string): void {
    const g = this.graph;
    const a = AUDIO_CONFIG.arranger;
    for (const t of this.arrTimers) window.clearTimeout(t);
    this.arrTimers = [];
    this.restoreArrangerKick(); // never carry a held kick across sections
    this.arrSection = section;
    this.arrReason = reason;
    this.arrBarInSection = 0;
    this.arrSectionsSinceBreak = section === 'BREAK' ? 0 : this.arrSectionsSinceBreak + 1;
    this.arrEmaAtStart = this.tpsEma;
    this.arrStats = { slots: 0, miss: 0, tpsSum: 0, tpsN: 0, whales: 0 };

    // Baseline (GROOVE) overrides.
    this.arrHatMult = 1;
    this.arrLeadEvery = null;
    this.arrChordBars = null;
    this.arrDelayBias = 0;

    const barSec = (60 / AUDIO_CONFIG.tempoBpm) * 4;
    if (!g) return;

    if (section === 'DUB') {
      // Strip back: hats recede, melody sparser, harmony slower, echoes deeper.
      this.arrHatMult = 0.35;
      this.arrLeadEvery = AUDIO_CONFIG.lead.everySlots * 2;
      this.arrChordBars = Math.max(2, AUDIO_CONFIG.director.chordChangeEveryBars * 2);
      this.arrDelayBias = 0.08;
    } else if (section === 'LIFT') {
      // Tension: harmonic rhythm accelerates, melody densifies, a riser climbs into the turn.
      this.arrHatMult = 1.15;
      this.arrLeadEvery = 1;
      this.arrChordBars = 1;
      this.arrDelayBias = 0.1;
      const riserStartSec = Math.max(0, (a.sectionBars - 8) * barSec);
      this.arrTimers.push(
        window.setTimeout(() => {
          const gg = this.graph;
          if (!gg || this.arrSection !== 'LIFT' || this._sunriseActive || this._surgeActive) return;
          const t = Tone.now();
          try {
            gg.riserGain.gain.cancelScheduledValues(t);
            gg.riserGain.gain.setValueAtTime(0.0001, t);
            gg.riserGain.gain.linearRampToValueAtTime(AUDIO_CONFIG.sunrise.riserGain * 0.5, t + 8 * barSec);
            gg.riserFilter.frequency.cancelScheduledValues(t);
            gg.riserFilter.frequency.setValueAtTime(500, t);
            gg.riserFilter.frequency.exponentialRampToValueAtTime(6500, t + 8 * barSec);
          } catch {
            /* noop */
          }
        }, riserStartSec * 1000),
      );
    } else if (section === 'BREAK') {
      // The breakdown: the floor vanishes, the pad blooms, a riser climbs — then the DROP.
      this.arrHatMult = 0;
      this.arrChordBars = Math.max(4, a.breakKickOutBars); // harmony suspends
      this.arrDelayBias = 0.06;
      const kick = g.strips['kick'];
      if (kick) {
        this.arrKickHeld = true;
        try {
          kick.level.gain.rampTo(0, 0.1);
        } catch {
          /* noop */
        }
      }
      try {
        g.reverbBus.gain.rampTo(1.25, 2); // the room opens while the floor is gone
      } catch {
        /* noop */
      }
      const outSec = Math.max(1, a.breakKickOutBars * barSec);
      // riser across the back half of the kick-out
      this.arrTimers.push(
        window.setTimeout(() => {
          const gg = this.graph;
          if (!gg || this.arrSection !== 'BREAK') return;
          const t = Tone.now();
          try {
            gg.riserGain.gain.cancelScheduledValues(t);
            gg.riserGain.gain.setValueAtTime(0.0001, t);
            gg.riserGain.gain.linearRampToValueAtTime(AUDIO_CONFIG.sunrise.riserGain * 0.6, t + outSec / 2);
            gg.riserFilter.frequency.cancelScheduledValues(t);
            gg.riserFilter.frequency.setValueAtTime(400, t);
            gg.riserFilter.frequency.exponentialRampToValueAtTime(8000, t + outSec / 2);
          } catch {
            /* noop */
          }
        }, (outSec / 2) * 1000),
        // THE DROP: floor back on the phrase, riser cut, delay throw, one deep hit.
        window.setTimeout(() => {
          const gg = this.graph;
          if (!gg || this.arrSection !== 'BREAK') return;
          this.restoreArrangerKick();
          this.arrHatMult = 1.2;
          const t = Tone.now();
          try {
            gg.riserGain.gain.cancelScheduledValues(t);
            gg.riserGain.gain.linearRampToValueAtTime(0.0001, t + 0.15);
            gg.reverbBus.gain.rampTo(1, 4);
            gg.delay.feedback.rampTo(clamp(AUDIO_CONFIG.moments.surge.delayThrow, 0, 0.95), 0.2);
          } catch {
            /* noop */
          }
          this.arrTimers.push(
            window.setTimeout(() => {
              try {
                this.graph?.delay.feedback.rampTo(AUDIO_CONFIG.delay.feedback, 6);
              } catch {
                /* noop */
              }
            }, 2500),
          );
          this.triggerDeep(0.8); // the hit that lands the drop
        }, outSec * 1000),
      );
    }
  }

  /** Hand the kick back (drop landed, section changed, or teardown). */
  private restoreArrangerKick(): void {
    if (!this.arrKickHeld) return;
    this.arrKickHeld = false;
    const k = this.graph?.strips['kick'];
    if (k) {
      try {
        k.level.gain.rampTo(this.gateValue(k, k.userLevel), 0.06);
      } catch {
        /* noop */
      }
    }
  }

  private cancelArranger(): void {
    for (const t of this.arrTimers) window.clearTimeout(t);
    this.arrTimers = [];
    this.restoreArrangerKick();
    this.arrHatMult = 1;
    this.arrLeadEvery = null;
    this.arrChordBars = null;
    this.arrDelayBias = 0;
    this.arrSection = 'GROOVE';
    this.arrBarInSection = 0;
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
    AUDIO_CONFIG.slot.note = `${root}1`; // the heartbeat sub follows the key (a tuned kick)
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
      case 'hat':
        g.hat.triggerAttackRelease(AUDIO_CONFIG.hat.dur, t, AUDIO_CONFIG.hat.velocity);
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
      case 'deep':
        this.triggerDeep(1);
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
      // The arranger biases the echo depth per section (DUB sinks deeper, LIFT creeps up).
      g.delay.feedback.rampTo(
        clamp(lerp(AUDIO_CONFIG.delay.feedback, a.delayFeedbackBusy, i) + this.arrDelayBias, 0, 0.92),
        sec,
      );
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
    // The giant's bar: a heavyweight leader's chord carries its root an octave down.
    if (this.leaderIsGiant) freqs.push(this.degreeToFreq(degrees[0], AUDIO_CONFIG.leader.padOctave - 1));
    try {
      this.graph.pad.triggerAttack(freqs, time, AUDIO_CONFIG.leader.velocity);
    } catch {
      /* noop */
    }
    this.heldPad = freqs; // includes the sub-root, so the release lets it go too
  }

  private rootMidi(): number {
    if (this.cachedRootMidi === null) {
      this.cachedRootMidi = Tone.Frequency(
        `${AUDIO_CONFIG.key.root}${AUDIO_CONFIG.key.baseOctave}`,
      ).toMidi();
    }
    return this.cachedRootMidi + this.liftSemis; // liftSemis = the Sunrise's temporary key lift
  }

  /** Apply the global tuning offset (0 = concert pitch; −34 = the chain's true measured pitch). */
  private tuned(freq: number): number {
    const cents = AUDIO_CONFIG.key.tuningOffsetCents;
    return cents === 0 ? freq : freq * Math.pow(2, cents / 1200);
  }

  /** Map a scale degree (with octave wrap) to a frequency in the ACTIVE scale (minor, or the bright
   *  scale during the Sunrise). Never chromatic. */
  private degreeToFreq(degree: number, octaveOffset: number): number {
    const scale = this.activeScale;
    const len = scale.length;
    const idx = ((degree % len) + len) % len;
    const oct = Math.floor(degree / len) + octaveOffset;
    const midi = this.rootMidi() + scale[idx] + 12 * oct;
    return this.tuned(Tone.Frequency(midi, 'midi').toFrequency());
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
    const melodyPanners: Tone.Panner[] = [];
    // The sustained layers breathe with the kick (the sidechain pump). One-shots are exempt.
    const PUMPED = new Set(['pad', 'texture', 'drone', 'bed']);
    // The melody voices sit WHERE THE LEADER STANDS — panned per bar to the leader's cloud
    // position (the same spot the visual beam jumps to). Kick/pad/drone stay centered (the floor).
    const PANNED = new Set(['tx_transfer', 'tx_defi', 'tx_nft', 'tx_stake', 'lead']);
    // A named channel strip: src → level (fader) [→ duck] [→ pan] → dry/reverb/delay sends.
    const makeStrip = (
      name: string,
      src: Tone.ToneAudioNode,
      opt: { level: number; reverb?: number; delay?: number },
    ): void => {
      const level = reg(new Tone.Gain(opt.level));
      src.connect(level);
      let out: Tone.ToneAudioNode = level;
      if (PUMPED.has(name)) {
        const duck = reg(new Tone.Gain(1));
        out.connect(duck);
        pumpDucks.push(duck);
        out = duck;
      }
      if (PANNED.has(name)) {
        const pan = reg(new Tone.Panner(0));
        out.connect(pan);
        melodyPanners.push(pan);
        out = pan;
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

    // ── Hat (the slot's exhale — off-beat, intensity-gated) ──
    const hat = reg(new Tone.NoiseSynth());
    hat.set({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: AUDIO_CONFIG.hat.dur, sustain: 0 } });
    const hatFilter = reg(new Tone.Filter({ type: 'highpass', frequency: AUDIO_CONFIG.hat.highpassHz, Q: 0.8 }));
    hat.connect(hatFilter);
    makeStrip('hat', hatFilter, { level: AUDIO_CONFIG.hat.gain, reverb: AUDIO_CONFIG.hat.sendReverb, delay: AUDIO_CONFIG.hat.sendDelay });

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

    // ── Deep gong (the whale voice — one low root, long tail, mostly reverb) ──
    const deep = new Tone.PolySynth(Tone.Synth);
    reg(deep);
    deep.maxPolyphony = 4;
    deep.set({
      oscillator: { type: 'sine' },
      envelope: { attack: 0.015, decay: 0.9, sustain: 0.4, release: 7 },
    });
    makeStrip('deep', deep, { level: 0.5, reverb: 0.8, delay: 0.2 });

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
      melodyPanners,
      reverbReady: reverb.ready,
      kick,
      hat,
      hatFilter,
      ghost,
      ghostFilter,
      pad,
      swell,
      swellFilter,
      tx,
      lead,
      leadIntensityGain,
      deep,
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

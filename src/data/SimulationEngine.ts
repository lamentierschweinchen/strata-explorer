import type { SolanaCallbacks, TransactionInfo } from './DataSource';
import { seededRandom } from '../utils/math';

/**
 * Tunable knobs for the pacing layer. All have sensible defaults; override per-field via the
 * SimulationEngine constructor. Times are in seconds, rates in events/second.
 */
export interface SimulationEngineOptions {
  /** Real network TPS source (e.g. `() => dataSource.getTps?.() ?? 0`). Drives synthetic fill. */
  getTps?: () => number;

  // --- Drain queue (real transactions) ---
  /** Backlog is spread over roughly this many seconds. Lower = snappier, higher = smoother. */
  drainHorizonSec?: number;
  /** Floor on drain rate so a tiny queue still trickles out instead of stalling. */
  minDrainRate?: number;
  /** Ceiling on drain rate so the engine can catch up after a burst without dumping it. */
  maxDrainRate?: number;
  /** Hard cap on the real-tx backlog; oldest are dropped (with a warning) past this. */
  maxQueue?: number;

  // --- Synthetic density fill (visual-only particles) ---
  /** Synthetic particles/sec ≈ TPS × this factor. ~0.3 keeps ~930 TPS lively yet pool-safe. */
  densityFactor?: number;
  /** Ceiling on synthetic spawn rate (guards the particle pool, which is finite). */
  maxSyntheticRate?: number;
  /** Per-frame cap on synthetic spawns, so a long frame (large dt) can't dump a huge batch. */
  maxSyntheticPerFrame?: number;
}

const DEFAULTS: Required<Omit<SimulationEngineOptions, 'getTps'>> = {
  drainHorizonSec: 1.0,
  minDrainRate: 2,
  maxDrainRate: 40, // > LiveData's 30/s intake cap, so the queue can drain faster than it fills
  maxQueue: 240,
  densityFactor: 0.3,
  maxSyntheticRate: 360,
  maxSyntheticPerFrame: 64,
};

/** Aesthetic mix for ambient synthetic particles (visual filler only — NOT a measured statistic). */
const SYNTH_TYPE_WEIGHTS: ReadonlyArray<[TransactionInfo['type'], number]> = [
  ['transfer', 0.42],
  ['defi', 0.34],
  ['nft', 0.14],
  ['stake', 0.10],
];

/**
 * SimulationEngine — a pacing layer that sits between data arrival and visual spawning.
 *
 * It does two jobs, both driven by `update(dt)` from the render loop:
 *
 *  1. DRAIN QUEUE — real transactions arrive in clumps (3 independent logsSubscribe streams,
 *     or bursty mock ticks). They are buffered and released *evenly* over a short horizon so
 *     bursts don't strobe and quiet moments don't go dead. Real txns are never fabricated, so
 *     a truly empty queue simply emits nothing — the synthetic fill keeps the scene alive.
 *
 *  2. SYNTHETIC DENSITY FILL — the RPC only surfaces a sliver of mainnet's ~930 TPS (three
 *     programs, rate-capped). To make the particle field *feel* as busy as the headline TPS,
 *     the engine spawns extra VISUAL-ONLY particles proportional to real TPS. These carry no
 *     signature, are flagged `synthetic`, and are emitted on a SEPARATE sink so they can never
 *     reach the human-readable feed. Only real transactions are ever displayed.
 *
 * The engine is deliberately decoupled from the Three.js scene (it lives in the data lane and
 * cannot import scene code). Integrators wire two sink callbacks and call `update(dt)` each
 * frame. See src/data/INTEGRATION.md for the wiring recipe.
 */
export class SimulationEngine {
  // --- Sinks (set by the integrator / WIRING lane) ---

  /**
   * Real, paced transactions → feed + particle. Called at most once per frame with the batch
   * drained this frame. If unset when `intercept()` is used, it defaults to the wrapped scene's
   * `onTransactions`.
   */
  onRealTransactions?: (txs: TransactionInfo[]) => void;

  /**
   * Visual-only synthetic density particles → particle spawn ONLY. Called at most once per
   * frame. The integrator MUST NOT route these into the feed. Every item has `synthetic: true`
   * and an empty signature.
   */
  onSyntheticParticles?: (txs: TransactionInfo[]) => void;

  private readonly opts: Required<Omit<SimulationEngineOptions, 'getTps'>>;
  private readonly getTps: () => number;
  private readonly rng = seededRandom(0x57a7a); // deterministic synthetic variety

  // Drain-queue state
  private queue: TransactionInfo[] = [];
  private drainAcc = 0;
  private droppedSinceWarn = 0;

  // Synthetic-fill state
  private synthAcc = 0;

  constructor(options: SimulationEngineOptions = {}) {
    const { getTps, ...rest } = options;
    this.getTps = getTps ?? (() => 0);
    this.opts = { ...DEFAULTS, ...stripUndefined(rest) };
  }

  /**
   * Feed real transactions into the pacing buffer. Call this from the data source's
   * `onTransactions` callback (or let `intercept()` do it for you). Order is preserved, so any
   * diversity ordering done upstream (LiveData) survives the queue.
   */
  enqueue(txs: TransactionInfo[]): void {
    if (txs.length === 0) return;
    this.queue.push(...txs);
    const overflow = this.queue.length - this.opts.maxQueue;
    if (overflow > 0) {
      this.queue.splice(0, overflow); // drop oldest; feed/particles favor the freshest
      this.droppedSinceWarn += overflow;
      if (this.droppedSinceWarn >= this.opts.maxQueue) {
        console.warn(
          `[sim] real-tx backlog exceeded ${this.opts.maxQueue}; dropped ${this.droppedSinceWarn} oldest (intake outran drain).`,
        );
        this.droppedSinceWarn = 0;
      }
    }
  }

  /** Drive the pacing layer. Call once per frame from the render loop. */
  update(dt: number): void {
    if (dt > 0) {
      this.drainRealQueue(dt);
      this.fillSynthetic(dt);
    }
  }

  /** Release buffered real transactions evenly over the drain horizon. */
  private drainRealQueue(dt: number): void {
    const n = this.queue.length;
    if (n === 0) {
      this.drainAcc = 0; // don't bank credit while idle, else the next arrival dumps a burst
      return;
    }
    const rate = clamp(n / this.opts.drainHorizonSec, this.opts.minDrainRate, this.opts.maxDrainRate);
    this.drainAcc += rate * dt;
    const count = Math.min(Math.floor(this.drainAcc), n);
    if (count <= 0) return;
    this.drainAcc -= count;

    const batch = this.queue.splice(0, count);
    this.onRealTransactions?.(batch);
  }

  /** Spawn visual-only synthetic particles proportional to real network TPS. */
  private fillSynthetic(dt: number): void {
    if (!this.onSyntheticParticles) return;
    const tps = this.getTps();
    if (!(tps > 0)) {
      this.synthAcc = 0;
      return;
    }
    const rate = Math.min(tps * this.opts.densityFactor, this.opts.maxSyntheticRate);
    this.synthAcc += rate * dt;
    let count = Math.floor(this.synthAcc);
    if (count <= 0) return;
    this.synthAcc -= count;
    count = Math.min(count, this.opts.maxSyntheticPerFrame);

    const batch: TransactionInfo[] = new Array(count);
    for (let i = 0; i < count; i++) batch[i] = this.makeSyntheticParticle();
    this.onSyntheticParticles(batch);
  }

  private makeSyntheticParticle(): TransactionInfo {
    return {
      signature: '',
      type: this.pickSyntheticType(),
      // Log-uniform, skewed small (~0.02–3) so ambient filler stays smaller than real txns,
      // which derive size from real log volume. Visual-only — never displayed.
      value: 0.02 * Math.pow(10, this.rng() * 2.2),
      synthetic: true,
    };
  }

  private pickSyntheticType(): TransactionInfo['type'] {
    let r = this.rng();
    for (const [type, w] of SYNTH_TYPE_WEIGHTS) {
      r -= w;
      if (r <= 0) return type;
    }
    return 'transfer';
  }

  /**
   * Convenience wrapper. Returns a `SolanaCallbacks` to hand to `dataSource.start(...)` that
   * intercepts `onTransactions` into the pacing buffer and passes every other callback straight
   * through to `scene`. Also defaults `onRealTransactions` to `scene.onTransactions` (feed +
   * particle) if you haven't set it. You still set `onSyntheticParticles` yourself, since the
   * scene has no particle-only entry point in the base contract.
   */
  intercept(scene: SolanaCallbacks): SolanaCallbacks {
    if (!this.onRealTransactions) {
      this.onRealTransactions = (txs) => scene.onTransactions(txs);
    }
    return {
      onSlot: (slot, leader, missed) => scene.onSlot(slot, leader, missed),
      onValidatorsUpdated: (validators) => scene.onValidatorsUpdated(validators),
      onRootAdvance: (rootSlot) => scene.onRootAdvance(rootSlot),
      onTransactions: (txs) => this.enqueue(txs),
    };
  }

  /** Clear all buffered state. Call when swapping data sources (e.g. live → mock fallback). */
  reset(): void {
    this.queue.length = 0;
    this.drainAcc = 0;
    this.synthAcc = 0;
    this.droppedSinceWarn = 0;
  }

  /** Pending real transactions not yet released to the scene. */
  get pendingReal(): number {
    return this.queue.length;
  }

  /** Snapshot for debugging / the dev `window.__strata` handle. */
  getDebugState(): { pendingReal: number; tps: number; syntheticRate: number } {
    const tps = this.getTps();
    return {
      pendingReal: this.queue.length,
      tps,
      syntheticRate: this.onSyntheticParticles
        ? Math.min(Math.max(tps, 0) * this.opts.densityFactor, this.opts.maxSyntheticRate)
        : 0,
    };
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Drop undefined-valued keys so they don't clobber defaults via spread. */
function stripUndefined<T extends object>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const k in obj) {
    if (obj[k] !== undefined) out[k] = obj[k];
  }
  return out;
}

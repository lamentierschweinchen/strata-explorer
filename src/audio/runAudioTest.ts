/**
 * runAudioTest — drive the AudioEngine with SYNTHETIC chain events on Solana's REAL cadence, so
 * the sound can be auditioned without a live RPC connection. It fires exactly the sinks the
 * orchestrator fires, on the measured grid:
 *
 *   • a slot every ~396ms (occasionally "missed" → a ghost dropout)
 *   • a leader change every 4 slots (one bar), walking the chord progression
 *   • a finalization every 30 slots (~12s ≈ 7.5 bars)
 *   • a handful of transactions per produced slot (weighted by type)
 *   • a wandering TPS into setActivity (continuous texture only)
 *   • a slowly advancing epoch position (ACCELERATED here so the drone shift is audible in minutes,
 *     not the real ~2 days)
 *
 * Returns a handle to stop it and read live state (for the listen page's readouts).
 */

import type { AudioEngine, TxType } from './AudioEngine';

export interface AudioTestState {
  slot: number;
  bar: number;
  leaderIndex: number;
  lastTx: TxType | null;
  tps: number;
  epochP: number;
  epoch: number;
  finalities: number;
  missed: number;
}

export interface AudioTestOptions {
  /** Real slot time. Default 396ms. */
  slotMs?: number;
  /** Probability a slot is missed (→ ghost dropout). Default 0.04. */
  missedRate?: number;
  /** Max transactions fired per produced slot. Default 3. */
  txPerSlotMax?: number;
  /** Seconds for one full epoch sweep (accelerated for audibility). Default 180. */
  epochSweepSec?: number;
  /** Called after every slot tick with the latest state (for UI readouts). */
  onTick?: (s: Readonly<AudioTestState>) => void;
}

export interface AudioTestHandle {
  stop(): void;
  readonly state: Readonly<AudioTestState>;
}

const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);

// Weighted transaction mix — transfers dominate real Solana traffic, then DeFi, then NFT/stake.
const TX_WEIGHTS: ReadonlyArray<readonly [TxType, number]> = [
  ['transfer', 0.5],
  ['defi', 0.28],
  ['nft', 0.14],
  ['stake', 0.08],
];

function pickTxType(): TxType {
  let r = Math.random();
  for (const [type, w] of TX_WEIGHTS) {
    if (r < w) return type;
    r -= w;
  }
  return 'transfer';
}

export function runAudioTest(engine: AudioEngine, opts: AudioTestOptions = {}): AudioTestHandle {
  const slotMs = opts.slotMs ?? 396;
  const missedRate = opts.missedRate ?? 0.04;
  const txPerSlotMax = opts.txPerSlotMax ?? 3;
  const epochSweepSec = opts.epochSweepSec ?? 180;
  const epochPerSlot = slotMs / 1000 / epochSweepSec;

  // Start mid-epoch on a plausible mainnet slot number so the readouts look real.
  const state: AudioTestState = {
    slot: 281_000_000,
    bar: 0,
    leaderIndex: 0,
    lastTx: null,
    tps: 1500,
    epochP: 0.37,
    epoch: 650,
    finalities: 0,
    missed: 0,
  };

  let tps = state.tps;
  let surgeWaveLeft = 0; // occasional synthetic activity spike so the ⚡ Surge detector is audible

  const id = window.setInterval(() => {
    state.slot += 1;
    const slot = state.slot;

    // Heartbeat (or dropout).
    const missed = Math.random() < missedRate;
    engine.onSlot(slot, missed);
    if (missed) state.missed += 1;

    // New leader every 4 slots → walk the progression (sequential = a pleasing chord cycle).
    if (slot % 4 === 0) {
      state.leaderIndex += 1;
      state.bar += 1;
      engine.onLeaderChange(state.leaderIndex);
    }

    // Finality every 30 slots (~12s).
    if (slot % 30 === 0) {
      engine.onFinality(slot - 30);
      state.finalities += 1;
    }

    // Transactions only land in produced blocks (a missed slot has none — honest).
    if (!missed) {
      const n = Math.floor(Math.random() * (txPerSlotMax + 1));
      for (let i = 0; i < n; i++) {
        const t = pickTxType();
        // Magnitude skews small with occasional whales — mirrors the chain's log-normal reality.
        const value01 = Math.random() < 0.03 ? 0.9 + Math.random() * 0.1 : Math.pow(Math.random(), 2.5);
        engine.onTransaction(t, value01);
        state.lastTx = t;
      }
    }

    // Continuous density — a smooth random walk, with occasional sustained spikes (a mint, a
    // frenzy) so the Surge detector has something real-shaped to catch.
    if (surgeWaveLeft > 0) {
      surgeWaveLeft -= 1;
      tps = clamp(tps + 500, 200, 3800);
    } else {
      if (Math.random() < 0.004) surgeWaveLeft = 45; // ~every few minutes, a ~18s wave
      tps = clamp(tps + (Math.random() - 0.5) * 600, 200, 3800);
    }
    state.tps = Math.round(tps);
    engine.setActivity(tps);

    // Epoch position drifts (accelerated); the wrap is a new epoch → new key + Sunrise.
    const nextP = state.epochP + epochPerSlot;
    if (nextP >= 1) state.epoch += 1;
    state.epochP = nextP % 1;
    engine.onEpochProgress(state.epochP, state.epoch);

    opts.onTick?.(state);
  }, slotMs);

  return {
    stop(): void {
      window.clearInterval(id);
    },
    get state(): Readonly<AudioTestState> {
      return state;
    },
  };
}

/**
 * Snapshot the REAL chain facts at capture time — the honesty core of the artifact.
 *
 * Everything here reads the public `SolanaDataSource` getters and `engine.getHealth()`; it never
 * fabricates or approximates. If the data source isn't a live mainnet connection, `live` is false
 * and the facts are marked un-verifiable, so the metadata can tell the truth.
 *
 * `SolanaDataSource` is imported as a *type* only (erased at compile — no data-layer code pulled in).
 */
import type { SolanaDataSource } from '../data/DataSource';
import type { ChainFacts } from './types';

/** A point-in-time read of the chain. Taken at recording start and again at stop. */
export interface ChainSample {
  slot: number;
  rootSlot: number;
  epoch: number;
  slotIndex: number;
  slotsInEpoch: number;
  leader: string | null;
  atISO: string;
}

/** Read the current chain state. Pure getters — no side effects, no mutation of the source. */
export function sampleChain(ds: SolanaDataSource, atISO: string): ChainSample {
  const e = ds.getEpochInfo();
  return {
    slot: ds.getCurrentSlot(),
    rootSlot: ds.getRootSlot(),
    epoch: e.epoch,
    slotIndex: e.slotIndex,
    slotsInEpoch: e.slotsInEpoch,
    leader: safeLeader(ds),
    atISO,
  };
}

function safeLeader(ds: SolanaDataSource): string | null {
  try {
    return ds.getCurrentLeader();
  } catch {
    return null;
  }
}

/**
 * Is this a LIVE mainnet source (so the slots are independently verifiable)?
 *
 * Positive signals, most-explicit first: the class name (holds in dev / unminified), then the
 * presence of `getTps()` — which only `LiveSolanaData` implements; `MockSolanaData` does not.
 * The result is always shown to the artist and stamped into metadata, so a misread can't mislead.
 */
export function detectLive(ds: SolanaDataSource): boolean {
  const name = (ds as { constructor?: { name?: string } }).constructor?.name ?? '';
  if (name === 'LiveSolanaData') return true;
  if (name === 'MockSolanaData') return false;
  return typeof (ds as { getTps?: unknown }).getTps === 'function';
}

/** Combine a start + stop sample with the engine's musical state into the verifiable fact record. */
export function buildChainFacts(
  start: ChainSample,
  stop: ChainSample,
  health: { key: string; section: string },
  live: boolean,
): ChainFacts {
  return {
    startSlot: start.slot,
    stopSlot: stop.slot,
    rootSlot: stop.rootSlot,
    slotSpan: Math.max(0, stop.slot - start.slot),
    epoch: stop.epoch,
    slotIndex: stop.slotIndex,
    slotsInEpoch: stop.slotsInEpoch,
    leader: stop.leader ?? start.leader,
    key: health.key,
    section: health.section,
    factCluster: live ? 'mainnet-beta' : 'unknown',
    live,
    startISO: start.atISO,
    stopISO: stop.atISO,
  };
}

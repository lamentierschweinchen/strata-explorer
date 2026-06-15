/**
 * The shapes that flow through the mint surface.
 *
 * A `Moment` is a captured "minute of Solana" before it becomes files: the real chain facts,
 * the mix the engine was running, the audio it actually emitted, and a cover. Everything the
 * artifact IS — assembled by `capture.ts`, written to a bundle by `bundle.ts`, uploaded by
 * `storage.ts`, and minted by `mint.ts`.
 *
 * This module is type-only and dependency-free. It imports `StudioPreset` as a *type* from the
 * audio engine (erased at compile time — pulls no audio code into any bundle).
 */
import type { StudioPreset } from '../audio/AudioEngine';

/** Real, independently-verifiable chain facts, sampled live at recording start and stop. */
export interface ChainFacts {
  /** Real slot when recording started. */
  startSlot: number;
  /** Real slot when recording stopped. */
  stopSlot: number;
  /** Real finalized (root) slot at stop — the chain's confirmed past at that instant. */
  rootSlot: number;
  /** Slot span (stopSlot − startSlot); 0 if the chain didn't advance (e.g. mock paused). */
  slotSpan: number;
  /** Epoch number at stop. */
  epoch: number;
  /** Position within the epoch at stop. */
  slotIndex: number;
  /** Slots per epoch (the epoch's length). */
  slotsInEpoch: number;
  /** Leader pubkey at stop, if known. */
  leader: string | null;
  /** Musical key the engine was in, e.g. "E Dorian" (from `engine.getHealth().key`). */
  key: string;
  /** Arranger section at stop (GROOVE / DUB / LIFT / BREAK), from `engine.getHealth().section`. */
  section: string;
  /**
   * The cluster the FACTS describe — where these slots are real and checkable. Live data is
   * always 'mainnet-beta'. NOTE: this is independent of the cluster the NFT is MINTED on
   * (see MintNetwork). The two must never be conflated.
   */
  factCluster: 'mainnet-beta' | 'devnet' | 'unknown';
  /**
   * Honesty flag: true only when the facts came from a LIVE chain connection. Mock/demo data
   * is synthetic — the slots are NOT independently verifiable, and the metadata says so.
   */
  live: boolean;
  /** ISO-8601 (UTC) wall-clock of recording start. */
  startISO: string;
  /** ISO-8601 (UTC) wall-clock of recording stop. */
  stopISO: string;
}

/** The lossless audio the engine emitted, decoded from the opus take and re-encoded as WAV. */
export interface AudioArtifact {
  blob: Blob;
  mime: string; // 'audio/wav'
  ext: string; // 'wav'
  durationSec: number;
  sampleRate: number;
  channels: number;
}

/** The cover image. `source` records HOW it was produced — honesty, surfaced in metadata. */
export interface CoverArtifact {
  blob: Blob;
  mime: string; // 'image/png'
  ext: string; // 'png'
  width: number;
  height: number;
  /** 'canvas' = the live crystal at that instant; 'waveform'/'card' = a self-contained fallback. */
  source: 'canvas' | 'waveform' | 'card';
}

/** A captured moment — everything the artifact is, before it is written or uploaded. */
export interface Moment {
  /** The real chain facts. The honesty core. */
  facts: ChainFacts;
  /** The exact mix the engine was running (re-summonable as the live "instrument"). */
  preset: StudioPreset;
  /** The audio, lossless WAV. */
  audio: AudioArtifact;
  /** The source take exactly as `stopRecording()` returned it (webm/opus) — kept for provenance. */
  source: { blob: Blob; mime: string; ext: string };
  /** The cover image. */
  cover: CoverArtifact;
  /** Human title (timestamp + epoch + slot span). */
  title: string;
  /** ISO-8601 (UTC) capture-stop timestamp (canonical timestamp for the artifact). */
  capturedAtISO: string;
  /** Human, CET-localized capture-stop timestamp, e.g. "2026-06-15 15:40 CET". */
  capturedAtCET: string;
  /** Recording length in seconds. */
  durationSec: number;
}

/** Where the bytes live after Phase 2 (Arweave gateway URIs returned by Irys). */
export interface UploadedUris {
  imageUri: string;
  animationUri: string;
  metadataUri: string;
}

/** The result of a successful mint (Phase 3). */
export interface MintResult {
  /** The new Core asset address (the NFT). */
  asset: string;
  /** The mint transaction signature. */
  signature: string;
  cluster: 'devnet' | 'mainnet-beta';
  /** Ready-to-open explorer link for the asset. */
  explorerUrl: string;
  /** Explorer link for the mint transaction. */
  txUrl: string;
  uris: UploadedUris;
}

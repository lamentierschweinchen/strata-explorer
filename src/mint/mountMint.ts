/**
 * THE FROZEN MOUNT SEAM.
 *
 * The project coordinator wires a one-line lazy import into the studio / dj path:
 *
 *     const { mountMint } = await import('./mint/mountMint');
 *     const handle = mountMint({ engine, dataSource, getCanvas, container });
 *
 * That dynamic import is the code-split boundary: nothing in `src/mint/` (and none of its heavy
 * chain deps) enters the art bundle until this module is imported. Everything mountMint touches
 * from the art is a TYPE-ONLY import (erased at compile) — it consumes public APIs only and never
 * modifies the engine, the scene, or the data source.
 */
import type { AudioEngine } from '../audio/AudioEngine';
import type { SolanaDataSource } from '../data/DataSource';
import { MintPanel } from './MintPanel';

export interface MountMintOptions {
  /** The shared chain-reactive audio engine (post EQ/comp recorder + preset + health). */
  engine: AudioEngine;
  /** The live (or demo) Solana data source — the real chain facts at capture time. */
  dataSource: SolanaDataSource;
  /** Returns the art canvas for the cover still, if one exists in this surface. */
  getCanvas?: () => HTMLCanvasElement | null;
  /** Where the panel mounts (a drawer, modal, or page section the coordinator sizes). */
  container: HTMLElement;
  /** Optional: show a close button that calls this. */
  onClose?: () => void;
}

export interface MintHandle {
  destroy(): void;
}

/** Mount the "Mint a moment" panel into `container`. Returns a handle to tear it down. */
export function mountMint(opts: MountMintOptions): MintHandle {
  const panel = new MintPanel(opts);
  return {
    destroy: () => panel.destroy(),
  };
}

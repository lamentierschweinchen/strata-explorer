import type { StudioPreset } from './AudioEngine';

/**
 * THE GALLERY MIX — Lukas' signed-off master (2026-06-12, mixed on the live chain at
 * exploresolana.art/studio): the transaction melody pushed way forward, kick near unity.
 * MIXER ONLY — the key stays wherever the music is (home E; the epoch calendar walks it).
 *
 * Single source of truth: main.ts bakes it as the speaker toggle's DEFAULT_PRESET, and
 * StudioDesk surfaces it as the "Lukas' Mix" factory chip. Tweak HERE (or re-export from
 * the studio and paste) — both stay in sync.
 */
export const LUKAS_MIX: StudioPreset = {
  v: 1,
  name: "Lukas' Mix",
  config: {
    eq: { lowFrequency: 355 },
  },
  strips: {
    kick: { level: 0.98, reverb: 0.08, delay: 0, muted: false },
    hat: { level: 0.81, reverb: 0.1, delay: 0.18, muted: false },
    ghost: { level: 0.95, reverb: 0.3, delay: 0.28, muted: false },
    pad: { level: 0.18, reverb: 0.5, delay: 0.15, muted: false },
    swell: { level: 0.22, reverb: 0.7, delay: 0.2, muted: false },
    tx_transfer: { level: 0.31, reverb: 0.35, delay: 0.3, muted: false },
    tx_defi: { level: 0.44, reverb: 0.4, delay: 0.45, muted: false },
    tx_nft: { level: 0.5, reverb: 0.45, delay: 0.6, muted: false },
    tx_stake: { level: 0.65, reverb: 0.3, delay: 0.15, muted: false },
    lead: { level: 0.93, reverb: 0.45, delay: 0.55, muted: false },
    deep: { level: 0.68, reverb: 0.8, delay: 0.2, muted: false },
    drone: { level: 0.17, reverb: 0.5, delay: 0, muted: false },
    texture: { level: 0.91, reverb: 0.4, delay: 0, muted: false },
    riser: { level: 1, reverb: 0.5, delay: 0.3, muted: false },
    bed: { level: 0.5, reverb: 0.15, delay: 0.15, muted: false },
  },
};

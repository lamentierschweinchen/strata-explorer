import * as THREE from 'three';

/** Color palette for The Strata */
export const COLORS = {
  // Validator mineral deposits
  MINERAL_BASE: new THREE.Color(1.0, 0.75, 0.3),     // warm amber
  MINERAL_LOW_COMM: new THREE.Color(0.5, 1.0, 0.5),   // green (healthy, low commission)
  MINERAL_HIGH_COMM: new THREE.Color(1.0, 0.4, 0.3),   // red (high commission)

  // Transaction types
  TX_TRANSFER: new THREE.Color(1.0, 0.85, 0.4),       // gold
  TX_DEFI: new THREE.Color(0.3, 0.85, 1.0),           // cyan
  TX_NFT: new THREE.Color(0.85, 0.4, 1.0),            // purple
  TX_STAKE: new THREE.Color(0.3, 1.0, 0.6),           // green

  // Crystalline cluster — saturated jewel hues on the Solana brand axis (REFERENCES.md
  // reference 1): per-leader families of purple / magenta / green gem material, all
  // converging through deep violet into dark matrix as they finalize, with the amber
  // ember band (reference 3) burning at the finality depth.
  CRYSTAL_CORE: new THREE.Color(0.88, 0.86, 1.06),    // violet-white hot core (slightly >1 to bloom)
  CRYSTAL_PURPLE: new THREE.Color(0.600, 0.271, 1.0), // Solana purple #9945FF — family anchor
  CRYSTAL_MAGENTA: new THREE.Color(0.92, 0.20, 0.80), // magenta between the brand poles
  CRYSTAL_GREEN: new THREE.Color(0.078, 0.945, 0.584),// Solana green #14F195 — family anchor
  CRYSTAL_YOUNG: new THREE.Color(0.60, 0.40, 1.0),    // generic young-gem violet (coma/legend tint)
  CRYSTAL_SETTING: new THREE.Color(0.36, 0.20, 0.66), // deep violet (mid, crystallizing)
  CRYSTAL_OLD: new THREE.Color(0.072, 0.060, 0.118),  // dark indigo matrix (finalized, quiet)
  CRYSTAL_AMBER: new THREE.Color(1.0, 0.66, 0.28),    // the burning ember band / inner warmth
  // Leader thread — the luminous filament carrying each slot's light to the nucleus
  THREAD_GOLD: new THREE.Color(1.0, 0.80, 0.42),      // warm validator gold, softer than tracer amber

  // Seismic waves
  WAVE_COLOR: new THREE.Color(0.8, 0.7, 0.5),         // warm subtle

  // Background
  BG_CLEAR: new THREE.Color(0.02, 0.015, 0.03),       // near-black with purple tint
  DUST_COLOR: new THREE.Color(0.4, 0.35, 0.5),        // faint purple-grey

  // Leader spotlight
  LEADER_GLOW: new THREE.Color(1.0, 0.95, 0.7),       // bright warm white

  // Crystal growth-tip light — warm white that washes the inner validator cloud
  TIP_LIGHT: new THREE.Color(1.0, 0.86, 0.62),
} as const;

/** Get transaction color by type */
export function getTxColor(type: 'transfer' | 'defi' | 'nft' | 'stake'): THREE.Color {
  switch (type) {
    case 'transfer': return COLORS.TX_TRANSFER;
    case 'defi': return COLORS.TX_DEFI;
    case 'nft': return COLORS.TX_NFT;
    case 'stake': return COLORS.TX_STAKE;
  }
}

/** Display names for transaction types */
export const TX_TYPE_DISPLAY: Record<string, string> = {
  transfer: 'Transfer',
  defi: 'DeFi Swap',
  nft: 'NFT Mint',
  stake: 'Stake',
};

/** Hex colors for transaction types (used in DOM elements) */
export const TX_TYPE_HEX: Record<string, string> = {
  transfer: '#ffd700',
  defi: '#00e5ff',
  nft: '#aa66ff',
  stake: '#4cd964',
};

/**
 * Get validator color based on commission. Accepts 0–100 (real RPC) or 0–10 (mock);
 * saturates at ≥10%. Commission stays the primary signal (green = low, red = high),
 * but an optional deterministic `seed` (0–1) applies a small ±hue/lightness jitter so
 * the cloud reads as a *family of ambers* rather than a flat wash of identical dots.
 */
export function getCommissionColor(commission: number, seed?: number): THREE.Color {
  const t = Math.max(0, Math.min(1, commission / 10));
  const color = new THREE.Color();
  color.lerpColors(COLORS.MINERAL_LOW_COMM, COLORS.MINERAL_HIGH_COMM, t);
  // Blend toward base amber so the whole cloud trends warm
  color.lerp(COLORS.MINERAL_BASE, 0.5);

  if (seed !== undefined) {
    const hsl = { h: 0, s: 0, l: 0 };
    color.getHSL(hsl);
    // ±~14° hue jitter, gentle saturation/lightness variation — keeps the commission
    // reading intact while giving each deposit its own tint.
    hsl.h = ((hsl.h + (seed - 0.5) * 0.08) % 1 + 1) % 1;
    hsl.s = Math.max(0, Math.min(1, hsl.s + (seed - 0.5) * 0.12));
    hsl.l = Math.max(0, Math.min(1, hsl.l + (seed - 0.5) * 0.1));
    color.setHSL(hsl.h, hsl.s, hsl.l);
  }
  return color;
}

// ----- Far star-shell backdrop -----

// Cool-leaning stellar temperature palette (complements the warm amber cloud + icy
// crystal): mostly white / blue-white, a scatter of warm and deep-blue accents.
const STAR_TEMPERATURE_COLORS: { color: THREE.Color; weight: number }[] = [
  { color: new THREE.Color(0.95, 0.96, 1.0), weight: 28 }, // white
  { color: new THREE.Color(0.78, 0.85, 1.0), weight: 26 }, // blue-white
  { color: new THREE.Color(0.62, 0.74, 1.0), weight: 14 }, // hot blue
  { color: new THREE.Color(1.0, 0.95, 0.85), weight: 14 }, // yellow-white
  { color: new THREE.Color(1.0, 0.85, 0.62), weight: 9 },  // warm amber
  { color: new THREE.Color(1.0, 0.66, 0.45), weight: 5 },  // orange
  { color: new THREE.Color(0.45, 0.55, 1.0), weight: 4 },  // deep blue
];

// Pre-expanded weighted palette for O(1) sampling.
const TEMPERATURE_PALETTE: THREE.Color[] = [];
for (const entry of STAR_TEMPERATURE_COLORS) {
  for (let i = 0; i < entry.weight; i++) TEMPERATURE_PALETTE.push(entry.color);
}

/** Pick a random star color from the temperature distribution. */
export function randomStarColor(): THREE.Color {
  return TEMPERATURE_PALETTE[Math.floor(Math.random() * TEMPERATURE_PALETTE.length)].clone();
}

/** Power-law size distribution — many tiny stars, a few bright ones. */
export function powerLawSize(baseSize: number, variation: number): number {
  const u = Math.random();
  return baseSize * 0.3 + Math.pow(u, 3.0) * variation * 2.5;
}

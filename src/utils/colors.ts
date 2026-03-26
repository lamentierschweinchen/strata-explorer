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

  // Crystal axis
  CRYSTAL_CORE: new THREE.Color(0.9, 0.92, 1.0),      // white-silver
  CRYSTAL_YOUNG: new THREE.Color(0.7, 0.85, 1.0),     // soft blue glow
  CRYSTAL_OLD: new THREE.Color(0.15, 0.12, 0.2),      // dark bedrock

  // Seismic waves
  WAVE_COLOR: new THREE.Color(0.8, 0.7, 0.5),         // warm subtle

  // Background
  BG_CLEAR: new THREE.Color(0.02, 0.015, 0.03),       // near-black with purple tint
  DUST_COLOR: new THREE.Color(0.4, 0.35, 0.5),        // faint purple-grey

  // Leader spotlight
  LEADER_GLOW: new THREE.Color(1.0, 0.95, 0.7),       // bright warm white
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

/** Get validator color based on commission (0-10) */
export function getCommissionColor(commission: number): THREE.Color {
  const t = commission / 10;
  const color = new THREE.Color();
  color.lerpColors(COLORS.MINERAL_LOW_COMM, COLORS.MINERAL_HIGH_COMM, t);
  // Blend with base amber
  color.lerp(COLORS.MINERAL_BASE, 0.5);
  return color;
}

/**
 * Mint-surface configuration: the two Solana clusters we can mint on, the Irys nodes that store
 * the bytes, explorer link builders, and the project attribution.
 *
 * DEVNET is the default everywhere. MAINNET is gated: it requires BOTH an explicit opt-in flag
 * (`allowMainnet`, sourced from `VITE_MINT_ALLOW_MAINNET=true`) AND a typed confirmation in the
 * UI before any mainnet transaction is built. No key is ever embedded — mainnet always signs
 * through the connected wallet.
 *
 * Dependency-free. Reads only `import.meta.env` (Vite inlines `VITE_*` at build time).
 */

export type MintCluster = 'devnet' | 'mainnet-beta';

export interface MintNetwork {
  cluster: MintCluster;
  /** Solana JSON-RPC endpoint umi talks to. */
  rpcUrl: string;
  /** Irys node that pins to Arweave. Devnet uses devnet SOL; mainnet uses real SOL. */
  irysAddress: string;
}

/** `?cluster=` param to a Solana-Explorer query suffix. Devnet needs the suffix; mainnet omits it. */
function explorerClusterSuffix(cluster: MintCluster): string {
  return cluster === 'mainnet-beta' ? '' : '?cluster=devnet';
}

// Vite inlines `import.meta.env` in the browser build; under Node (the devnet proof script) it is
// absent, so fall back to an empty object (defaults below then apply). Read through a cast so this
// module stays self-contained (no global type augmentation of files the art shares).
const META = import.meta as unknown as { env?: Record<string, string | undefined> };
const ENV: Record<string, string | undefined> = META.env ?? {};

const DEVNET: MintNetwork = {
  cluster: 'devnet',
  rpcUrl: ENV.VITE_MINT_RPC_DEVNET || 'https://api.devnet.solana.com',
  irysAddress: ENV.VITE_MINT_IRYS_DEVNET || 'https://devnet.irys.xyz',
};

const MAINNET: MintNetwork = {
  cluster: 'mainnet-beta',
  // The public mainnet RPC is heavily rate-limited; a real mint should set VITE_MINT_RPC_MAINNET
  // to a provider URL (the same Helius key the art uses works fine).
  rpcUrl: ENV.VITE_MINT_RPC_MAINNET || 'https://api.mainnet-beta.solana.com',
  irysAddress: ENV.VITE_MINT_IRYS_MAINNET || 'https://uploader.irys.xyz',
};

export function networkFor(cluster: MintCluster): MintNetwork {
  return cluster === 'mainnet-beta' ? { ...MAINNET } : { ...DEVNET };
}

/** Mainnet is allowed only when explicitly opted in. The UI adds a typed-confirm on top of this. */
export const MAINNET_ALLOWED: boolean =
  (ENV.VITE_MINT_ALLOW_MAINNET || '').toLowerCase() === 'true';

/** Explorer link for a minted asset (the NFT), on the cluster it was minted on. */
export function assetExplorerUrl(address: string, cluster: MintCluster): string {
  return `https://explorer.solana.com/address/${address}${explorerClusterSuffix(cluster)}`;
}

/** Explorer link for a transaction, on the cluster it landed on. */
export function txExplorerUrl(signature: string, cluster: MintCluster): string {
  return `https://explorer.solana.com/tx/${signature}${explorerClusterSuffix(cluster)}`;
}

/**
 * Verify links for a REAL chain slot. These always point at the public mainnet explorers —
 * a captured moment's slots are facts about mainnet-beta, regardless of where the NFT is minted.
 */
export function solscanSlotUrl(slot: number): string {
  return `https://solscan.io/block/${slot}`;
}
export function explorerSlotUrl(slot: number): string {
  return `https://explorer.solana.com/block/${slot}`;
}

/** Where the embedded preset can be re-summoned as a LIVE instrument. */
export const STUDIO_BASE = 'https://exploresolana.art/studio';
export const SITE_URL = 'https://exploresolana.art';

/** The artist. */
export const ATTRIBUTION = 'Lukas Seel · @chessucation · exploresolana.art';

/** On-chain collection symbol. */
export const SYMBOL = 'STRATA';

/** Versioned spec tag stamped into metadata, so a reader knows how to interpret the `strata` block. */
export const SPEC = 'strata-moment/1';

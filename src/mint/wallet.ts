/**
 * Browser wallet connection → a umi ready to upload (Irys web) and mint (Core).
 *
 * Vanilla (no React): instantiates the Phantom / Solflare / Backpack adapters (each auto-detects
 * its extension via Wallet Standard) and wraps the chosen one with umi's `walletAdapterIdentity`.
 * Mainnet vs devnet only changes the RPC + Irys node; the wallet signs either way — NO key is ever
 * embedded. Behind the dynamic `mintFlow` import, so all of this loads only on the mint surface.
 */
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { mplCore } from '@metaplex-foundation/mpl-core';
import { irysUploader } from '@metaplex-foundation/umi-uploader-irys/web';
import { walletAdapterIdentity } from '@metaplex-foundation/umi-signer-wallet-adapters';
import type { Umi } from '@metaplex-foundation/umi';
import { WalletReadyState, type WalletAdapter } from '@solana/wallet-adapter-base';
import { networkFor, type MintCluster } from './config';
import { ensurePolyfills } from './polyfill';

export interface WalletOption {
  name: string;
  installed: boolean;
}

export interface ConnectedWallet {
  name: string;
  address: string;
  umi: Umi;
  cluster: MintCluster;
  disconnect: () => Promise<void>;
}

let cache: WalletAdapter[] | null = null;

async function getAdapters(): Promise<WalletAdapter[]> {
  if (cache) return cache;
  await ensurePolyfills();
  const [phantom, solflare, backpack] = await Promise.all([
    import('@solana/wallet-adapter-phantom'),
    import('@solana/wallet-adapter-solflare'),
    import('@solana/wallet-adapter-backpack'),
  ]);
  cache = [
    new phantom.PhantomWalletAdapter(),
    new solflare.SolflareWalletAdapter(),
    new backpack.BackpackWalletAdapter(),
  ];
  return cache;
}

const isReady = (a: WalletAdapter): boolean =>
  a.readyState === WalletReadyState.Installed || a.readyState === WalletReadyState.Loadable;

/** The wallets we can offer, flagged by whether they're detected in this browser. */
export async function listWallets(): Promise<WalletOption[]> {
  const adapters = await getAdapters();
  return adapters.map((a) => ({ name: a.name, installed: isReady(a) }));
}

/** Connect (prompting the extension) and build a umi bound to that wallet + the chosen cluster. */
export async function connectWallet(cluster: MintCluster, walletName?: string): Promise<ConnectedWallet> {
  const adapters = await getAdapters();
  const adapter =
    (walletName ? adapters.find((a) => a.name === walletName) : undefined) ??
    adapters.find(isReady) ??
    adapters[0];
  if (!adapter) throw new Error('No supported wallet found. Install Phantom, Solflare, or Backpack.');

  await adapter.connect();
  if (!adapter.publicKey) throw new Error('Wallet did not return a public key.');

  const net = networkFor(cluster);
  const umi = createUmi(net.rpcUrl)
    .use(mplCore())
    .use(irysUploader({ address: net.irysAddress }))
    // The adapter satisfies umi's signer interface; cast bridges any web3.js version skew.
    .use(walletAdapterIdentity(adapter as never));

  return {
    name: adapter.name,
    address: adapter.publicKey.toString(),
    umi,
    cluster,
    disconnect: async () => {
      try {
        await adapter.disconnect();
      } catch {
        /* already gone */
      }
    },
  };
}

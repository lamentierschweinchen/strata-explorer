/**
 * The OWNED test entry for mint.html — exercises the real capture/mint flow in isolation.
 *
 * It imports only mint code + its own test data sources, and pulls the AudioEngine via DYNAMIC
 * import — which shares the art's existing AudioEngine chunk, so adding this entry to the build
 * leaves the main/studio art bundles byte-identical (verified in dist).
 *
 * URL flags:  ?mock / ?demo → synthetic DemoSource (captures marked DEMO);  default → real
 * mainnet reader (RpcLiveSource; captures marked LIVE + verifiable).
 */
import type { SolanaDataSource } from '../data/DataSource';
import { mountMint } from './mountMint';
import { DemoSource, RpcLiveSource } from './testSources';

const ENV = import.meta.env as unknown as Record<string, string | undefined>;

async function main(): Promise<void> {
  const root = document.getElementById('mint-root');
  if (!root) return;

  const params = new URLSearchParams(location.search);
  const demo = params.has('mock') || params.has('demo');

  // Public mainnet RPC is enough for HTTP slot/epoch polling (no key, no WS). A provider URL in
  // VITE_SOLANA_RPC_HTTP is used if present.
  const rpc = ENV.VITE_SOLANA_RPC_HTTP || 'https://api.mainnet-beta.solana.com';
  const dataSource: SolanaDataSource = demo ? new DemoSource() : new RpcLiveSource(rpc);
  try {
    await dataSource.initialize();
  } catch (e) {
    console.warn('[mint test] live RPC init failed — falling back to demo', e);
  }
  dataSource.start({
    onSlot: () => {},
    onValidatorsUpdated: () => {},
    onTransactions: () => {},
    onRootAdvance: () => {},
  });

  const { AudioEngine } = await import('../audio/AudioEngine');
  const engine = new AudioEngine({ bedUrl: null });
  (window as unknown as { strataMintEngine: unknown }).strataMintEngine = engine;

  mountMint({
    engine,
    dataSource,
    getCanvas: () => document.querySelector('canvas'),
    container: root,
  });
}

void main();

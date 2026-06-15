import { defineConfig } from 'vite';
import path from 'path';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

/**
 * OWNED test-surface config for the mint module (src/mint/) — this is NOT the art build.
 *
 * The gallery ships via vite.config.ts, which I leave byte-for-byte untouched. This separate config
 * adds the mint.html entry plus the Node polyfills the Irys / web3.js deps require in the browser
 * (stream, crypto, Buffer, …). It builds into its own outDir so the art's dist is never affected.
 *
 * COORDINATOR NOTE: to ship the in-app mint (the one-line dynamic import into the studio/dj path),
 * add this same `nodePolyfills()` plugin to vite.config.ts — it is the standard requirement for any
 * Solana + Vite app that uploads via Irys. That is the only build-config change integration needs.
 */
export default defineConfig({
  resolve: {
    alias: { '~': path.resolve(__dirname, 'src') },
  },
  plugins: [
    nodePolyfills({
      globals: { Buffer: true, global: true, process: true },
    }),
  ],
  server: { port: 5180 },
  build: {
    outDir: 'dist-mint',
    rollupOptions: {
      input: { mint: path.resolve(__dirname, 'mint.html') },
    },
  },
});

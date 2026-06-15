/**
 * Self-contained browser polyfills for the chain libs (umi / irys / web3.js expect Node globals).
 *
 * Called once at the top of the mint flow so the COORDINATOR needs zero extra setup — the shims
 * live inside the lazy-loaded mint chunk, never in the art bundle. No-ops under Node (the proof
 * script), where these globals already exist.
 */
export async function ensurePolyfills(): Promise<void> {
  const g = globalThis as unknown as {
    global?: unknown;
    Buffer?: unknown;
    process?: { env?: Record<string, unknown> };
  };
  if (typeof g.global === 'undefined') g.global = globalThis;
  if (typeof g.process === 'undefined') g.process = { env: {} };
  if (typeof g.Buffer === 'undefined') {
    const { Buffer } = await import('buffer');
    g.Buffer = Buffer;
  }
}

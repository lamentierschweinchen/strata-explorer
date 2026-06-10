import { Strata } from './scene/Strata';
import { MockSolanaData } from './data/MockData';
import { LiveSolanaData } from './data/LiveData';
import type { SolanaDataSource } from './data/DataSource';

/** Diegetic loading copy (canonical: COPY.md). */
const LOADING_COPY = {
  connecting: 'Reaching the Solana network…',
  demo: 'Crystallizing a recent memory of the network…',
  fallback: 'Can’t reach the network. Crystallizing a recent memory instead…',
} as const;

function hasWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return !!(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

const container = document.getElementById('app')!;
const errorEl = document.getElementById('webgl-error')!;
const loadingEl = document.getElementById('loading');

/** 'mock' or 'live' — URL (?mock / ?live) overrides VITE_DATA_SOURCE; default is live. */
function pickMode(): 'live' | 'mock' {
  const params = new URLSearchParams(window.location.search);
  if (params.has('mock')) return 'mock';
  if (params.has('live')) return 'live';
  return import.meta.env.VITE_DATA_SOURCE === 'mock' ? 'mock' : 'live';
}

async function startWith(dataSource: SolanaDataSource): Promise<void> {
  const strata = await Strata.create(container, dataSource);
  if (loadingEl) loadingEl.style.display = 'none';

  // Dev-only introspection handle (stripped from production builds).
  if (import.meta.env.DEV) (window as any).__strata = strata;

  let lastTime = performance.now();
  function loop(): void {
    requestAnimationFrame(loop);
    const now = performance.now();
    const dt = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;
    strata.update(dt);
    strata.render();
  }
  requestAnimationFrame(loop);
  window.addEventListener('resize', () => strata.resize());
}

if (!hasWebGL()) {
  errorEl.style.display = 'block';
} else {
  (async () => {
    const mode = pickMode();
    if (loadingEl) {
      loadingEl.style.display = 'block';
      loadingEl.textContent = mode === 'live' ? LOADING_COPY.connecting : LOADING_COPY.demo;
    }

    try {
      await startWith(mode === 'mock' ? new MockSolanaData() : new LiveSolanaData());
    } catch (e) {
      console.error('Strata initialization failed:', e);

      // If live data couldn't load, fall back to mock so the site still renders something.
      if (mode === 'live') {
        console.warn('[strata] Live data unavailable — falling back to mock data.');
        if (loadingEl) {
          loadingEl.style.display = 'block';
          loadingEl.textContent = LOADING_COPY.fallback;
        }
        try {
          await startWith(new MockSolanaData());
          return;
        } catch (e2) {
          console.error('Mock fallback failed:', e2);
        }
      }

      errorEl.style.display = 'block';
      if (loadingEl) loadingEl.style.display = 'none';
    }
  })();
}

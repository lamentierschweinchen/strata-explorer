import { Strata } from './scene/Strata';
import { MockSolanaData } from './data/MockData';
import type { SolanaDataSource } from './data/DataSource';

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

if (!hasWebGL()) {
  errorEl.style.display = 'block';
} else {
  (async () => {
    const dataSource: SolanaDataSource = new MockSolanaData();

    if (loadingEl) {
      loadingEl.style.display = 'block';
      loadingEl.textContent = 'Crystallizing...';
    }

    try {
      const strata = await Strata.create(container, dataSource);

      if (loadingEl) loadingEl.style.display = 'none';

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
    } catch (e) {
      console.error('Strata initialization failed:', e);
      errorEl.style.display = 'block';
      if (loadingEl) loadingEl.style.display = 'none';
    }
  })();
}

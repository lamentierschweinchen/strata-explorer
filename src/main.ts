import { Strata } from './scene/Strata';
import { MockSolanaData } from './data/MockData';
import { LiveSolanaData } from './data/LiveData';
import type { SolanaDataSource } from './data/DataSource';
// Type-only — erased at compile time, so the heavy tone chunk stays dynamically imported.
import type { AudioEngine, StudioPreset } from './audio/AudioEngine';
// The signed-off gallery mix (tiny data module — pulls no audio code into this bundle).
import { LUKAS_MIX } from './audio/defaultMix';

/**
 * The shipped sound: every visitor's speaker click starts from Lukas' signed-off mix
 * (canonical object in audio/defaultMix.ts — also the desk's "Lukas' Mix" factory chip).
 * To re-bake: tune at exploresolana.art/studio, COPY LINK or export, update defaultMix.ts.
 */
const DEFAULT_PRESET: StudioPreset | null = LUKAS_MIX;

/** Diegetic loading copy (canonical: COPY.md). */
const LOADING_COPY = {
  connecting: 'Connecting to the Solana network…',
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

  // The speaker toggle (bottom-right) IS the sound switch: first click loads + starts the
  // chain-reactive engine at the default studio settings (the click is the audio gesture),
  // later clicks mute/unmute the running engine — the transport keeps the chain's beat.
  strata.audio.onFirstEnable = async () => {
    const { ensureStarted, engine } = await getChainAudio(strata);
    await ensureStarted();
    engine.setMuted(false);
  };
  strata.audio.onMuteToggle = (muted) => {
    void getChainAudio(strata).then(({ engine }) => engine.setMuted(muted));
  };
  // The mixer button beside the speaker: opens the DJ booth right over the piece
  // (the click is the audio gesture if sound isn't running yet).
  strata.audio.onOpenStudio = async () => {
    await openDjBooth(strata);
  };

  // ?dj — the full mixing desk overlaid on the live scene (same shared engine as the toggle).
  // Dynamically imported: zero cost without the flag.
  if (new URLSearchParams(window.location.search).has('dj')) {
    void mountDjMode(strata);
  }

  // Rehearsal hook: ?ceremony fires the epoch-rollover choreography once, ~5s after
  // load — for previewing on any screen. The real one fires on actual epoch rollover.
  if (new URLSearchParams(window.location.search).has('ceremony')) {
    window.setTimeout(() => strata.triggerEpochCeremony(), 5000);
  }

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

/**
 * The ONE chain-audio instance, shared by the speaker toggle and ?dj: the engine (code-split
 * behind a dynamic import), wired once to strata.eventTap — the SAME events that grow the
 * crystal make the sound. Applies DEFAULT_PRESET (the baked studio mix) when set.
 */
let chainAudio: Promise<{
  engine: AudioEngine;
  readouts: () => { slot?: number; tps?: number; bar?: number };
  /** start() + apply the baked mix ONCE after the graph exists (strip levels live in the
   *  graph, which start() builds — a pre-start applyState silently skips them). */
  ensureStarted: () => Promise<void>;
}> | null = null;

function getChainAudio(strata: Strata) {
  chainAudio ??= (async () => {
    const { AudioEngine } = await import('./audio/AudioEngine');
    // Bed-free by owner's call: the piece runs purely on the programmatic chain-reactive
    // layers (pass a bedUrl here again if an ambient bed ever returns).
    const engine = new AudioEngine({ bedUrl: null });
    // Pre-start: applies the CONFIG half of the baked mix (key/eq/etc.). The strip levels
    // need the graph — ensureStarted() re-applies the full preset once after start().
    if (DEFAULT_PRESET) engine.applyState(DEFAULT_PRESET);
    let primed = false;
    const ensureStarted = async (): Promise<void> => {
      if (!engine.started) await engine.start();
      if (!primed) {
        primed = true;
        if (DEFAULT_PRESET) engine.applyState(DEFAULT_PRESET);
      }
    };
    (window as any).strataAudio = engine; // console hook, same as the standalone studio

    // Live readouts for the desk header, fed by the tap below.
    const live: { slot?: number; tps?: number; bar?: number } = {};
    let leaderChanges = 0;
    let lastLeaderIdx = -1;

    // The tx `value` is a coarse log-normal magnitude (~1..300, real on-chain log volume in
    // live mode) — compress it to 0..1 for the accent, as the visuals compress it for size.
    const valueTo01 = (v: number): number =>
      Math.max(0, Math.min(1, Math.log10(1 + Math.max(0, v)) / 2.5));

    strata.eventTap = {
      onSlot: (slot, missed) => {
        live.slot = slot;
        engine.onSlot(slot, missed);
      },
      onLeaderIndex: (leaderIndex) => {
        engine.onLeaderChange(leaderIndex); // engine dedups repeats itself
        if (leaderIndex !== lastLeaderIdx) {
          lastLeaderIdx = leaderIndex;
          live.bar = ++leaderChanges; // one leader = one bar
        }
      },
      onTransactions: (txs) => {
        for (const tx of txs) {
          if (tx.synthetic) continue; // defense-in-depth: density particles are visual-only
          engine.onTransaction(tx.type, valueTo01(tx.value));
        }
      },
      onFinality: (rootSlot) => engine.onFinality(rootSlot),
      onTps: (tps) => {
        live.tps = Math.round(tps);
        engine.setActivity(tps);
      },
      onEpochProgress: (p01, epoch) => engine.onEpochProgress(p01, epoch),
      // Epoch rollover (or ?ceremony rehearsal): the engine's sunrise — build, bright
      // lift, back to dark — answers the golden waves. No-op until start()ed.
      onEpochRollover: () => engine.triggerSunrise(),
    };

    return { engine, readouts: () => live, ensureStarted };
  })();
  return chainAudio;
}

/**
 * The DJ booth, opened from the mixer button: ensure the shared engine is running
 * (the click that got us here is the gesture), then mount the desk over the piece.
 */
let deskHandle: { destroy(): void } | null = null;
async function openDjBooth(strata: Strata): Promise<void> {
  if (deskHandle) return; // one desk at a time
  const [{ engine, readouts, ensureStarted }, { mountStudio }] = await Promise.all([
    getChainAudio(strata),
    import('./audio/StudioDesk'),
  ]);
  if (!engine.started) {
    await ensureStarted();
    engine.setMuted(false);
  }
  deskHandle = mountStudio(engine, { overlay: true, readouts, sourceLabel: 'LIVE' });
}

/**
 * ?dj mode: the full mixing desk over the live scene, on the SAME shared engine as the
 * speaker toggle. Sound still starts behind a user gesture (the pill, or the toggle).
 */
async function mountDjMode(strata: Strata): Promise<void> {
  const [{ engine, readouts, ensureStarted }, { mountStudio }] = await Promise.all([
    getChainAudio(strata),
    import('./audio/StudioDesk'),
  ]);

  // Browsers require a user gesture for audio: a small pill, then the desk.
  const pill = document.createElement('button');
  pill.textContent = '▶ TAP FOR SOUND';
  pill.style.cssText =
    "position:fixed;bottom:24px;right:80px;z-index:31;font-family:'ABC Diatype Semi-Mono','SF Mono',ui-monospace,monospace;" +
    'background:rgba(5,5,16,0.85);border:1px solid rgba(255,255,255,0.3);color:rgba(255,255,255,0.9);' +
    'border-radius:999px;padding:12px 22px;font-size:12px;letter-spacing:2px;cursor:pointer;backdrop-filter:blur(8px);';
  pill.addEventListener('click', () => {
    void (async () => {
      try {
        await ensureStarted();
        engine.setMuted(false);
        pill.remove();
        mountStudio(engine, { overlay: true, readouts });
      } catch (e) {
        console.error('[dj] audio start failed', e);
        pill.textContent = '✕ AUDIO FAILED';
      }
    })();
  });
  document.body.appendChild(pill);
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

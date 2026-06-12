/**
 * The Strata — audio STUDIO (standalone page).
 *
 *   npm run dev   →   http://localhost:5173/studio.html
 *
 * Tap to begin (the user gesture browsers require), then the desk (StudioDesk.mountStudio) gives
 * you every knob over the engine — and the engine plays THE LIVE CHAIN by default: the same
 * Helius feed the crystal runs on (LiveSolanaData), paced through the same SimulationEngine, real
 * transactions only. You are mixing the actual network.
 *
 *   ?demo (or ?mock)  →  the synthetic driver instead (runAudioTest): Solana's real cadence with
 *                        controllable epoch pace + surge waves — the tuning sandbox. Also the
 *                        automatic fallback if the live connection can't be established.
 *
 * The ?dj flag on the MAIN app overlays this same desk on the live visuals.
 */

import { AudioEngine } from './AudioEngine';
import { LUKAS_MIX } from './defaultMix';
import { mountStudio } from './StudioDesk';
import { runAudioTest, type AudioTestHandle, type AudioTestState } from './runAudioTest';
import { LiveSolanaData } from '../data/LiveData';
import { SimulationEngine } from '../data/SimulationEngine';
import type { SolanaDataSource } from '../data/DataSource';
import { CONFIG } from '../utils/config';

// Bed-free by owner's call (matches the gallery wiring in main.ts): the piece runs purely on the
// chain-reactive layers — a fixed-pitch bed would clash once the epoch calendar modulates the key.
const engine = new AudioEngine({ bedUrl: null });
// Dev hook: poke the live engine from the console (strataAudio.setEQ('low', -12), .triggerSunrise(), …).
(window as unknown as { strataAudio: AudioEngine }).strataAudio = engine;

const params = new URLSearchParams(window.location.search);
const wantDemo = params.has('demo') || params.has('mock');

let test: AudioTestHandle | null = null;
let latest: Readonly<AudioTestState> | null = null;
const live: { slot?: number; bar?: number; tps?: number } = {};
let liveSource: SolanaDataSource | null = null;
let disposed = false;

document.body.style.cssText = 'margin:0;min-height:100vh;background:#050510;';

/* ── tap-to-begin (the audio gesture) ─────────────────────────────────────────────────────── */
const overlay = document.createElement('div');
overlay.style.cssText =
  'position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;' +
  "gap:14px;background:#050510;z-index:50;cursor:pointer;text-align:center;color:rgba(255,255,255,0.85);" +
  "font-family:'SF Mono','Fira Code',ui-monospace,monospace;";
overlay.innerHTML =
  '<div style="font-size:11px;letter-spacing:3px;color:rgba(255,255,255,0.42)">THE STRATA</div>' +
  '<div style="font-size:22px;letter-spacing:1px">audio studio</div>' +
  '<div style="font-size:12px;color:rgba(255,255,255,0.42);max-width:460px;line-height:1.7">' +
  (wantDemo
    ? 'Demo chain: Solana’s real cadence, synthesized — with a controllable epoch clock.'
    : 'You are about to mix the LIVE Solana network — every sound a real event, happening now.') +
  '</div>' +
  '<div style="margin-top:14px;padding:11px 26px;border:1px solid rgba(255,255,255,0.25);border-radius:999px;letter-spacing:2px;font-size:13px">▶ TAP TO BEGIN</div>';
document.body.appendChild(overlay);

/** Same compression the visuals use for particle size: coarse log-normal magnitude → 0..1. */
const valueTo01 = (v: number): number => Math.max(0, Math.min(1, Math.log10(1 + Math.max(0, v)) / 2.5));

/** Wire the REAL chain through the same pacing layer the crystal uses. Returns false on failure. */
async function startLive(): Promise<boolean> {
  try {
    const ds = new LiveSolanaData();
    await ds.initialize();
    liveSource = ds;

    const sim = new SimulationEngine({ getTps: () => ds.getTps?.() ?? 0 });
    // Synthetic density particles are visual-only; the studio has no particles — drop them.
    sim.onSyntheticParticles = () => {};

    let lastLeaderIdx = -1;
    let bars = 0;
    ds.start(
      sim.intercept({
        onSlot: (slot, _leader, missed) => {
          live.slot = slot;
          engine.onSlot(slot, missed);
          const idx = ds.getCurrentLeaderIndex();
          const v = ds.getValidator(idx);
          // The sound follows the spotlight: pan to the leader's cloud position; giants sit deeper.
          engine.setLeaderSpatial(
            v ? Math.max(-1, Math.min(1, v.position.x / CONFIG.CLOUD_OUTER_RADIUS)) : 0,
            v?.stake ?? 0,
          );
          engine.onLeaderChange(idx); // engine dedups repeats
          if (idx !== lastLeaderIdx) {
            lastLeaderIdx = idx;
            live.bar = ++bars;
          }
          const ep = ds.getEpochInfo();
          engine.onEpochProgress(ep.slotIndex / Math.max(1, ep.slotsInEpoch), ep.epoch);
        },
        onValidatorsUpdated: () => {},
        onTransactions: (txs) => {
          for (const tx of txs) {
            if (tx.synthetic) continue; // defense-in-depth: visual-only density never sounds
            engine.onTransaction(tx.type, valueTo01(tx.value));
          }
        },
        onRootAdvance: (rootSlot) => engine.onFinality(rootSlot), // engine samples the root march
      }),
    );

    // Pump the pacing layer (it drips real txs evenly between slots).
    let lastT = performance.now();
    const pump = (): void => {
      if (disposed) return;
      requestAnimationFrame(pump);
      const now = performance.now();
      const dt = Math.min((now - lastT) / 1000, 0.1);
      lastT = now;
      sim.update(dt);
    };
    requestAnimationFrame(pump);

    // Real network TPS → energy, once a second (same cadence as the HUD).
    window.setInterval(() => {
      if (disposed) return;
      const tps = ds.getTps?.();
      if (tps !== undefined && tps > 0) {
        live.tps = Math.round(tps);
        engine.setActivity(tps);
      }
    }, 1000);

    return true;
  } catch (e) {
    console.warn('[studio] live chain unavailable — falling back to the demo driver.', e);
    try {
      liveSource?.stop();
    } catch {
      /* noop */
    }
    liveSource = null;
    return false;
  }
}

function startDemo(): void {
  test = runAudioTest(engine, { onTick: (s) => (latest = s) });
}

async function begin(): Promise<void> {
  try {
    await engine.start();
  } catch (e) {
    overlay.innerHTML = '<div style="color:#ff7a7a">Could not start audio — see console.</div>';
    console.error('[studio] start failed', e);
    return;
  }
  // The shipped default IS Lukas' Mix — the studio opens where the gallery sounds, and
  // the desk's faders read this state back. (Post-start on purpose: strip levels live in
  // the graph start() just built; a pre-start apply silently skips them.)
  engine.applyState(LUKAS_MIX);
  engine.setMuted(false);
  overlay.remove();

  const isLive = !wantDemo && (await startLive());
  if (!isLive) startDemo();

  mountStudio(engine, {
    sourceLabel: isLive ? 'LIVE' : 'DEMO',
    readouts: () =>
      isLive ? live : { slot: latest?.slot, bar: latest?.bar, tps: latest?.tps },
    // Chain controls only exist for the demo driver — the live network cannot be paused.
    chain: isLive
      ? null
      : {
          running: () => test !== null,
          stop: (): void => {
            test?.stop();
            test = null;
          },
          start: (): void => {
            if (!test) startDemo();
          },
          setEpochSweepSec: (sec: number): void => test?.setEpochSweepSec(sec),
        },
  });
}

overlay.addEventListener('click', () => void begin());
window.addEventListener('beforeunload', () => {
  disposed = true;
  try {
    liveSource?.stop();
  } catch {
    /* noop */
  }
  engine.dispose();
});

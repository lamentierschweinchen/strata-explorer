/**
 * The Strata — audio STUDIO (standalone page).
 *
 *   npm run dev   →   http://localhost:5173/studio.html
 *
 * Tap to begin (the user gesture browsers require), then the synthetic chain (runAudioTest)
 * drives the engine on Solana's real cadence while the full desk (StudioDesk.mountStudio) gives
 * you every knob: the master mixing table, per-sound strips, space, the Director, key changes,
 * presets, link sharing and REC. The same desk overlays the live app under ?dj.
 */

import { AudioEngine } from './AudioEngine';
import { mountStudio } from './StudioDesk';
import { runAudioTest, type AudioTestHandle, type AudioTestState } from './runAudioTest';

const engine = new AudioEngine();
// Dev hook: poke the live engine from the console (strataAudio.setEQ('low', -12), .triggerSunrise(), …).
(window as unknown as { strataAudio: AudioEngine }).strataAudio = engine;

let test: AudioTestHandle | null = null;
let latest: Readonly<AudioTestState> | null = null;

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
  '<div style="font-size:12px;color:rgba(255,255,255,0.42);max-width:440px;line-height:1.7">' +
  'Tap to begin — the synthetic chain plays on Solana’s real cadence (396ms slots · 1.585s bars) ' +
  'while you mix. Sharing a mix link? It loads after the tap.</div>' +
  '<div style="margin-top:14px;padding:11px 26px;border:1px solid rgba(255,255,255,0.25);border-radius:999px;letter-spacing:2px;font-size:13px">▶ TAP TO BEGIN</div>';
document.body.appendChild(overlay);

async function begin(): Promise<void> {
  try {
    await engine.start();
  } catch (e) {
    overlay.innerHTML = '<div style="color:#ff7a7a">Could not start audio — see console.</div>';
    console.error('[studio] start failed', e);
    return;
  }
  engine.setMuted(false);
  overlay.remove();

  test = runAudioTest(engine, { onTick: (s) => (latest = s) });

  mountStudio(engine, {
    readouts: () => ({ slot: latest?.slot, bar: latest?.bar, tps: latest?.tps }),
    chain: {
      running: () => test !== null,
      stop: (): void => {
        test?.stop();
        test = null;
      },
      start: (): void => {
        if (!test) test = runAudioTest(engine, { onTick: (s) => (latest = s) });
      },
    },
  });
}

overlay.addEventListener('click', () => void begin());
window.addEventListener('beforeunload', () => engine.dispose());

/**
 * Listen test page — auditions the AudioEngine without a live chain.
 *
 * Open it with `npm run dev`, then visit  http://localhost:5173/audiotest.html
 *
 * (main.ts is owned by another lane and can't host a `?audiotest` branch, so the listen test is
 * this dedicated dev-only page. It is NOT part of the production build.)
 *
 * Tap to begin (browsers require a user gesture to start audio), then the page fires synthetic
 * slots / leaders / finalizations / transactions on Solana's real cadence and shows live readouts
 * so you can match each sound to its event while tuning AUDIO_CONFIG in AudioEngine.ts (HMR).
 */

import { AudioEngine, AUDIO_CONFIG } from './AudioEngine';
import { runAudioTest, type AudioTestHandle, type AudioTestState } from './runAudioTest';
import type { TxType } from './AudioEngine';

const MONO = "'SF Mono', 'Fira Code', ui-monospace, monospace";
const DIM = 'rgba(255,255,255,0.45)';
const BRIGHT = 'rgba(255,255,255,0.85)';

// Mirrors AudioEngine's leaderIndex % progression mapping, for the readout.
const CHORD_LABELS = ['Am7', 'Fmaj7', 'Cmaj7', 'G7', 'Dm7', 'Em7'];
const TX_COLORS: Record<TxType, string> = {
  transfer: '#7ee0c8',
  defi: '#9b8cff',
  nft: '#ff9bd2',
  stake: '#ffcf7e',
};

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  css: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.style.cssText = css;
  if (text !== undefined) node.textContent = text;
  return node;
}

const fmt = (n: number): string => n.toLocaleString('en-US');

document.body.style.cssText =
  'margin:0;width:100vw;height:100vh;overflow:hidden;background:#050510;' +
  `font-family:${MONO};color:${BRIGHT};`;

const engine = new AudioEngine();
let test: AudioTestHandle | null = null;
let muted = false;

/* ── tap-to-begin overlay ─────────────────────────────────────────────────────────────────── */
const overlay = el(
  'div',
  'position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;' +
    'justify-content:center;gap:14px;cursor:pointer;z-index:100;background:#050510;text-align:center;',
);
overlay.appendChild(el('div', 'font-size:11px;letter-spacing:3px;color:' + DIM, 'THE STRATA'));
overlay.appendChild(el('div', 'font-size:22px;letter-spacing:1px;color:' + BRIGHT, 'audio engine · listen test'));
overlay.appendChild(
  el(
    'div',
    `font-size:12px;line-height:1.7;max-width:440px;color:${DIM};margin-top:6px`,
    'Synthetic slots, leaders, finalizations and transactions fired on Solana’s real cadence ' +
      '(396ms slots · 1.585s bars · finality ~12s). Every sound maps to one event.',
  ),
);
const tapBtn = el(
  'div',
  'margin-top:18px;padding:12px 28px;border:1px solid rgba(255,255,255,0.25);border-radius:999px;' +
    `font-size:13px;letter-spacing:2px;color:${BRIGHT};`,
  '▶  TAP TO BEGIN',
);
overlay.appendChild(tapBtn);
const overlayErr = el('div', `margin-top:14px;font-size:11px;color:#ff7a7a;min-height:14px`, '');
overlay.appendChild(overlayErr);
document.body.appendChild(overlay);

/* ── main panel (revealed after start) ────────────────────────────────────────────────────── */
const panel = el(
  'div',
  'position:fixed;inset:0;display:none;flex-direction:column;align-items:center;' +
    'justify-content:center;gap:22px;padding:24px;box-sizing:border-box;',
);

const header = el('div', 'text-align:center;display:flex;flex-direction:column;gap:6px;');
header.appendChild(el('div', 'font-size:10px;letter-spacing:3px;color:' + DIM, 'THE STRATA · LISTEN TEST'));
header.appendChild(
  el(
    'div',
    `font-size:11px;color:${DIM}`,
    `${AUDIO_CONFIG.tempoBpm} BPM · ${AUDIO_CONFIG.key.scaleName} · the blockchain scoring itself`,
  ),
);
panel.appendChild(header);

// Readout grid.
const grid = el(
  'div',
  'display:grid;grid-template-columns:repeat(4,minmax(96px,1fr));gap:14px 26px;' +
    'padding:20px 26px;border:1px solid rgba(255,255,255,0.08);border-radius:12px;' +
    'background:rgba(255,255,255,0.02);min-width:460px;',
);
function readout(label: string): HTMLElement {
  const cell = el('div', 'display:flex;flex-direction:column;gap:5px;');
  cell.appendChild(el('div', `font-size:9px;letter-spacing:1.5px;color:${DIM}`, label));
  const val = el('div', `font-size:16px;color:${BRIGHT};font-variant-numeric:tabular-nums;`, '—');
  cell.appendChild(val);
  grid.appendChild(cell);
  return val;
}
const rSlot = readout('SLOT');
const rChord = readout('LEADER · CHORD');
const rTx = readout('LAST TX');
const rTps = readout('TPS');
const rEpoch = readout('EPOCH');
const rFinal = readout('FINALIZED');
const rMissed = readout('MISSED');
const rBar = readout('BAR');
panel.appendChild(grid);

// TPS bar.
const tpsBarWrap = el(
  'div',
  'width:460px;height:3px;background:rgba(255,255,255,0.08);border-radius:2px;overflow:hidden;',
);
const tpsBar = el('div', 'height:100%;width:0%;background:rgba(126,224,200,0.8);transition:width 0.4s ease;');
tpsBarWrap.appendChild(tpsBar);
panel.appendChild(tpsBarWrap);

// Event → sound legend.
const legend = el(
  'div',
  `display:grid;grid-template-columns:repeat(2,auto);gap:6px 26px;font-size:11px;color:${DIM};` +
    'line-height:1.4;',
);
for (const [glyph, txt] of [
  ['●', 'slot → sub kick (heartbeat)'],
  ['◌', 'missed slot → ghost dropout'],
  ['▦', 'leader / 4 slots → chord pad'],
  ['◆', 'finality ~12s → resolving swell'],
  ['✦', 'transaction → shimmer (per type)'],
  ['◷', 'epoch → slow drone shift'],
  ['~', 'TPS → texture air (continuous)'],
  ['▮', 'bed → optional ambient loop'],
] as const) {
  const row = el('div', 'display:flex;gap:9px;align-items:baseline;');
  row.appendChild(el('span', `width:14px;color:${BRIGHT}`, glyph));
  row.appendChild(el('span', '', txt));
  legend.appendChild(row);
}
panel.appendChild(legend);

// Controls.
const controls = el('div', 'display:flex;gap:12px;margin-top:4px;');
function ctrlBtn(text: string): HTMLButtonElement {
  const b = el(
    'button',
    'padding:9px 20px;border:1px solid rgba(255,255,255,0.2);border-radius:999px;' +
      `background:rgba(255,255,255,0.04);color:${BRIGHT};font-family:${MONO};font-size:12px;` +
      'letter-spacing:1px;cursor:pointer;',
    text,
  );
  b.onmouseenter = (): void => {
    b.style.background = 'rgba(255,255,255,0.1)';
  };
  b.onmouseleave = (): void => {
    b.style.background = 'rgba(255,255,255,0.04)';
  };
  return b;
}
const muteBtn = ctrlBtn('◼ MUTE');
const stopBtn = ctrlBtn('■ STOP');
controls.appendChild(muteBtn);
controls.appendChild(stopBtn);
panel.appendChild(controls);

const hint = el('div', `font-size:10px;color:rgba(255,255,255,0.3);margin-top:2px;text-align:center;max-width:480px;`,
  'Tune by ear in src/audio/AudioEngine.ts → AUDIO_CONFIG (HMR-live). Epoch is accelerated here so the drone shift is audible in minutes.');
panel.appendChild(hint);

document.body.appendChild(panel);

/* ── wiring ───────────────────────────────────────────────────────────────────────────────── */
function render(s: Readonly<AudioTestState>): void {
  rSlot.textContent = fmt(s.slot);
  rBar.textContent = String(s.bar);
  rChord.textContent = `#${s.leaderIndex} · ${CHORD_LABELS[s.leaderIndex % CHORD_LABELS.length]}`;
  if (s.lastTx) {
    rTx.textContent = s.lastTx;
    rTx.style.color = TX_COLORS[s.lastTx];
  }
  rTps.textContent = fmt(s.tps);
  rEpoch.textContent = `${(s.epochP * 100).toFixed(1)}%`;
  rFinal.textContent = String(s.finalities);
  rMissed.textContent = String(s.missed);
  tpsBar.style.width = `${Math.min(100, (s.tps / AUDIO_CONFIG.activity.maxTps) * 100).toFixed(0)}%`;
}

async function begin(): Promise<void> {
  try {
    await engine.start();
  } catch (e) {
    overlayErr.textContent = 'Could not start audio — check the console.';
    console.error('[audiotest] engine.start() failed', e);
    return;
  }
  engine.setMuted(false);
  overlay.style.display = 'none';
  panel.style.display = 'flex';
  test = runAudioTest(engine, { onTick: render });
}

overlay.addEventListener('click', () => void begin());

muteBtn.addEventListener('click', () => {
  muted = !muted;
  engine.setMuted(muted);
  muteBtn.textContent = muted ? '▶ UNMUTE' : '◼ MUTE';
  muteBtn.style.color = muted ? '#ffcf7e' : BRIGHT;
});

let stopped = false;
stopBtn.addEventListener('click', () => {
  if (!stopped) {
    test?.stop();
    test = null;
    engine.stop();
    stopBtn.textContent = '▶ RESTART';
    stopped = true;
  } else {
    void (async (): Promise<void> => {
      await engine.start();
      engine.setMuted(muted);
      test = runAudioTest(engine, { onTick: render });
      stopBtn.textContent = '■ STOP';
      stopped = false;
    })();
  }
});

window.addEventListener('beforeunload', () => engine.dispose());

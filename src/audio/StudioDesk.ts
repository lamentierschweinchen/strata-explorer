/**
 * StudioDesk — the mountable mixing desk for the AudioEngine.
 *
 * Two homes, one module:
 *   • STANDALONE (studio.html): full-page desk driven by the synthetic chain (runAudioTest).
 *   • OVERLAY (?dj on the main app): a translucent right-hand drawer over the live crystal —
 *     the SAME events drive the visuals and the sound, and your hands are on the mix.
 *
 * mountStudio(engine, opts) assumes engine.start() has already happened (the caller owns the
 * user gesture). Everything here drives the engine through its public API only.
 *
 * Presets: factory chips + named localStorage saves + URL-hash sharing (#p=<base64url(json)>).
 * REC: captures the master limiter via MediaRecorder and downloads a .webm take.
 */

import { AudioEngine, AUDIO_CONFIG, KEY_MODES, type StudioPreset } from './AudioEngine';
import { LUKAS_MIX } from './defaultMix';

export interface StudioReadouts {
  slot?: number;
  bar?: number;
  tps?: number;
}

export interface StudioMountOptions {
  /** Where to mount. Default: document.body. */
  root?: HTMLElement;
  /** Overlay mode: a fixed, translucent, collapsible right drawer (for ?dj over the scene). */
  overlay?: boolean;
  /** Live readouts the desk can't know itself (slot/bar/tps from the driving chain). */
  readouts?: () => StudioReadouts;
  /** What's driving the engine — shown in the header ('LIVE' / 'DEMO'). */
  sourceLabel?: string;
  /** Synthetic-chain controls (standalone only) — hidden when absent (the live chain never stops).
   *  setEpochSweepSec adjusts the DEMO epoch pace (the real chain's epoch is ~2 days). */
  chain?: {
    running: () => boolean;
    stop: () => void;
    start: () => void;
    setEpochSweepSec?: (sec: number) => void;
  } | null;
}

export interface StudioHandle {
  destroy(): void;
}

/* ── style ────────────────────────────────────────────────────────────────────────────────── */

const CSS = `
  .sdsk{font-family:'SF Mono','Fira Code',ui-monospace,monospace;font-size:12px;color:rgba(255,255,255,0.86)}
  .sdsk *{box-sizing:border-box}
  .sdsk .wrap{display:flex;flex-direction:column;gap:14px;padding:18px 22px 28px}
  .sdsk.standalone .wrap{min-height:100vh}
  .sdsk.ovl{position:fixed;top:0;right:0;bottom:0;width:460px;max-width:96vw;z-index:30;
    background:rgba(5,5,16,0.74);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);
    border-left:1px solid rgba(255,255,255,0.1);overflow-y:auto;overscroll-behavior:contain;
    transition:transform .35s cubic-bezier(.4,0,.2,1)}
  .sdsk.ovl.hidden{transform:translateX(105%)}
  .sdsk .dim{color:rgba(255,255,255,0.42)}
  .sdsk .hdr{display:flex;align-items:baseline;gap:16px;flex-wrap:wrap}
  .sdsk .hdr .t{font-size:13px;letter-spacing:3px}
  .sdsk .reads{display:flex;gap:16px;flex-wrap:wrap;margin-left:auto;align-items:center}
  .sdsk .read{display:flex;flex-direction:column;gap:2px}
  .sdsk .read b{font-size:14px;font-weight:400;font-variant-numeric:tabular-nums}
  .sdsk .read span{font-size:8px;letter-spacing:1.5px;color:rgba(255,255,255,0.4)}
  .sdsk .ibar{width:110px;height:4px;background:rgba(255,255,255,0.1);border-radius:2px;overflow:hidden}
  .sdsk .ibar>div{height:100%;width:0;background:linear-gradient(90deg,#5a6cff,#7ee0c8,#ffcf7e);transition:width .2s}
  .sdsk .grid{display:grid;grid-template-columns:1.5fr 1fr 1fr;gap:14px}
  .sdsk.ovl .grid{grid-template-columns:1fr}
  @media(max-width:900px){.sdsk .grid{grid-template-columns:1fr}}
  .sdsk .panel{border:1px solid rgba(255,255,255,0.08);border-radius:10px;background:rgba(255,255,255,0.015);padding:14px 16px}
  .sdsk .panel h2{font-size:9px;letter-spacing:2px;color:rgba(255,255,255,0.45);margin:0 0 12px;font-weight:400}
  .sdsk .panel h3{font-size:9px;letter-spacing:2px;color:rgba(255,255,255,0.45);margin:14px 0 8px;font-weight:400;
    border-top:1px solid rgba(255,255,255,0.06);padding-top:12px}
  .sdsk .strip{display:grid;grid-template-columns:78px 1fr 46px 46px auto;gap:9px;align-items:center;padding:5px 0;border-bottom:1px solid rgba(255,255,255,0.04)}
  .sdsk .strip .nm{font-size:10px}
  .sdsk .strip .nm i{display:block;color:rgba(255,255,255,0.35);font-style:normal;font-size:8px}
  .sdsk .ctl{display:flex;flex-direction:column;gap:3px}
  .sdsk .ctl label{font-size:8px;letter-spacing:1px;color:rgba(255,255,255,0.4);display:flex;justify-content:space-between}
  .sdsk input[type=range]{-webkit-appearance:none;appearance:none;width:100%;height:3px;background:rgba(255,255,255,0.14);border-radius:2px;outline:none;cursor:pointer}
  .sdsk input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:12px;height:12px;border-radius:50%;background:#cfd2ff;cursor:pointer}
  .sdsk button{font-family:inherit;color:inherit;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.14);
    border-radius:6px;padding:5px 9px;font-size:10px;letter-spacing:.5px;cursor:pointer;transition:background .15s,border-color .15s}
  .sdsk button:hover{background:rgba(255,255,255,0.11)}
  .sdsk button.on{background:rgba(126,224,200,0.18);border-color:rgba(126,224,200,0.5);color:#bff4e6}
  .sdsk button.solo.on{background:rgba(255,207,126,0.2);border-color:rgba(255,207,126,0.55);color:#ffe2ad}
  .sdsk button.mute.on{background:rgba(255,122,122,0.18);border-color:rgba(255,122,122,0.5);color:#ffb3b3}
  .sdsk button.rec{border-color:rgba(255,122,122,0.45)}
  .sdsk button.rec.on{background:rgba(255,60,60,0.25);border-color:#ff5c5c;color:#ffc9c9;animation:sdskpulse 1.1s ease-in-out infinite}
  .sdsk .sbtns{display:flex;gap:4px}
  .sdsk .sbtns button{padding:3px 7px;font-size:9px}
  .sdsk .field{display:flex;flex-direction:column;gap:5px;margin-bottom:13px}
  .sdsk .field>label{font-size:9px;letter-spacing:1px;color:rgba(255,255,255,0.5);display:flex;justify-content:space-between}
  .sdsk .field>label b{color:rgba(255,255,255,0.8);font-weight:400}
  .sdsk .sunrise{width:100%;padding:16px;margin:6px 0 14px;font-size:13px;letter-spacing:3px;
    background:linear-gradient(100deg,rgba(90,108,255,0.16),rgba(255,207,126,0.16));
    border:1px solid rgba(255,207,126,0.4);border-radius:10px;color:#ffe8c4}
  .sdsk .sunrise:hover{background:linear-gradient(100deg,rgba(90,108,255,0.26),rgba(255,207,126,0.28))}
  @keyframes sdskpulse{0%,100%{border-color:rgba(255,207,126,0.4)}50%{border-color:rgba(255,92,92,0.95)}}
  .sdsk .seg{display:flex;gap:0;border:1px solid rgba(255,255,255,0.14);border-radius:6px;overflow:hidden}
  .sdsk .seg button{border:none;border-radius:0;flex:1}
  .sdsk .bar{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
  .sdsk .bar .sp{margin-left:auto}
  .sdsk select{font-family:inherit;font-size:10px;color:inherit;background:rgba(255,255,255,0.05);
    border:1px solid rgba(255,255,255,0.14);border-radius:6px;padding:5px 7px;cursor:pointer}
  .sdsk select option{background:#0a0a18}
  .sdsk .mtable{display:grid;grid-template-columns:1fr 300px;gap:20px;align-items:start}
  .sdsk.ovl .mtable{grid-template-columns:1fr}
  @media(max-width:760px){.sdsk .mtable{grid-template-columns:1fr}}
  .sdsk .spec{width:100%;height:120px;background:rgba(0,0,0,0.4);border:1px solid rgba(255,255,255,0.07);border-radius:8px;display:block}
  .sdsk .speclabels{display:flex;justify-content:space-between;font-size:8px;color:rgba(255,255,255,0.3);margin:5px 0 12px;letter-spacing:1px}
  .sdsk .eqrow{display:flex;gap:14px;align-items:flex-end;justify-content:center;padding-top:4px}
  .sdsk .eqband{display:flex;flex-direction:column;align-items:center;gap:8px}
  .sdsk .eqband .bl{font-size:10px;letter-spacing:1px;color:rgba(255,255,255,0.7)}
  .sdsk .eqband .bv{font-size:9px;color:rgba(255,255,255,0.5);font-variant-numeric:tabular-nums;min-height:11px}
  .sdsk input[type=range].vert{writing-mode:vertical-lr;direction:rtl;width:22px;height:120px;padding:0}
  .sdsk .eqband.filt{border-left:1px solid rgba(255,255,255,0.08);padding-left:14px;margin-left:4px}
  .sdsk .keys{display:flex;flex-wrap:wrap;gap:5px;margin-bottom:10px}
  .sdsk .keys button{padding:5px 0;width:34px;text-align:center;font-size:10px}
  .sdsk-toast{position:fixed;bottom:18px;left:50%;transform:translateX(-50%);background:rgba(126,224,200,0.16);
    border:1px solid rgba(126,224,200,0.5);color:#bff4e6;padding:8px 16px;border-radius:8px;font-size:11px;
    opacity:0;transition:opacity .25s;pointer-events:none;z-index:60;font-family:'SF Mono',ui-monospace,monospace}
  .sdsk-fab{position:fixed;bottom:24px;right:24px;z-index:31;font-family:'SF Mono',ui-monospace,monospace;
    background:rgba(5,5,16,0.8);border:1px solid rgba(255,255,255,0.25);color:rgba(255,255,255,0.85);
    border-radius:999px;padding:10px 18px;font-size:11px;letter-spacing:2px;cursor:pointer;backdrop-filter:blur(8px)}
  .sdsk-fab:hover{background:rgba(255,255,255,0.12)}
  .sdsk-explain{position:fixed;inset:0;z-index:70;display:flex;align-items:center;justify-content:center;
    background:rgba(3,3,10,0.82);backdrop-filter:blur(10px);cursor:pointer;
    font-family:'SF Mono','Fira Code',ui-monospace,monospace}
  .sdsk-explain .card{max-width:640px;max-height:86vh;overflow-y:auto;margin:20px;padding:30px 34px;
    background:rgba(8,8,20,0.96);border:1px solid rgba(255,255,255,0.14);border-radius:14px;cursor:auto;
    color:rgba(255,255,255,0.82);font-size:12.5px;line-height:1.75}
  .sdsk-explain h1{font-size:15px;letter-spacing:3px;font-weight:400;margin:0 0 4px;color:#fff}
  .sdsk-explain .sub{color:rgba(255,255,255,0.45);margin-bottom:18px}
  .sdsk-explain .row{display:flex;gap:12px;margin:9px 0;align-items:baseline}
  .sdsk-explain .row b{flex:0 0 96px;font-weight:400;color:#bff4e6;font-size:11.5px}
  .sdsk-explain .foot{margin-top:18px;padding-top:14px;border-top:1px solid rgba(255,255,255,0.1);
    color:rgba(255,255,255,0.5);font-style:italic}
  .sdsk-explain .x{float:right;color:rgba(255,255,255,0.4);cursor:pointer;font-size:14px;padding:2px 8px}
`;

/* ── small DOM helpers ────────────────────────────────────────────────────────────────────── */

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html?: string): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html !== undefined) n.innerHTML = html;
  return n;
}

function slider(
  label: string,
  min: number,
  max: number,
  step: number,
  value: number,
  fmt: (v: number) => string,
  onInput: (v: number) => void,
): HTMLElement {
  const wrap = el('div', 'field');
  const lab = el('label');
  const valEl = el('b', '', fmt(value));
  lab.append(document.createTextNode(label), valEl);
  const input = el('input');
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  input.addEventListener('input', () => {
    const v = parseFloat(input.value);
    valEl.textContent = fmt(v);
    onInput(v);
  });
  wrap.append(lab, input);
  return wrap;
}

const fmtInt = (v: number): string => String(Math.round(v));
const fmt2 = (v: number): string => v.toFixed(2);

/* ── presets ──────────────────────────────────────────────────────────────────────────────── */

const LS_KEY = 'strata-studio-presets';

/** Factory starting points — config diffs from the engine defaults. */
const FACTORY_PRESETS: Array<{ name: string; preset: StudioPreset }> = [
  {
    name: 'Gallery Calm',
    preset: {
      v: 1,
      config: {
        master: { outputGain: 0.75 },
        pump: { depth: 0.12 },
        reverb: { decaySec: 11 },
        director: { chordChangeEveryBars: 4, movementCutoffMin: 900 },
        tx: { minIntervalSec: 0.12 },
        sunrise: { buildBars: 24 },
      },
    },
  },
  {
    name: 'Peak Time',
    preset: {
      v: 1,
      config: {
        pump: { depth: 0.5 },
        slot: { velocity: 0.95 },
        delay: { feedback: 0.5 },
        director: { chordChangeEveryBars: 1, movementCutoffMin: 480 },
        lead: { gainByIntensity: 0.22 },
        sunrise: { buildBars: 12, lightBars: 8 },
      },
    },
  },
  {
    name: 'Panorama 6am',
    preset: {
      v: 1,
      config: {
        pump: { depth: 0.35 },
        reverb: { decaySec: 13 },
        director: { chordChangeEveryBars: 2, autoCycleMin: 8 },
        sunrise: { buildBars: 32, lightBars: 10, closeBars: 3 },
      },
    },
  },
  {
    // Lukas' first signed-off mix (2026-06-12) — THE shipped gallery default. Canonical
    // object lives in defaultMix.ts (main.ts bakes the same one as DEFAULT_PRESET).
    name: "Lukas' Mix",
    preset: LUKAS_MIX,
  },
];

function b64encode(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64decode(s: string): string {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(padded);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function loadSavedPresets(): Record<string, StudioPreset> {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) ?? '{}') as Record<string, StudioPreset>;
  } catch {
    return {};
  }
}

function storeSavedPresets(p: Record<string, StudioPreset>): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(p));
  } catch {
    /* storage full/blocked — non-fatal */
  }
}

/** Read a shared preset from the URL hash (#p=...), if present. */
function presetFromHash(): StudioPreset | null {
  const m = /[#&]p=([A-Za-z0-9\-_]+)/.exec(window.location.hash);
  if (!m) return null;
  try {
    return JSON.parse(b64decode(m[1])) as StudioPreset;
  } catch {
    return null;
  }
}

/* ── the desk ─────────────────────────────────────────────────────────────────────────────── */

const STRIP_DEFS: Array<[string, string, string]> = [
  ['kick', 'Kick', 'slot'],
  ['hat', 'Hat', 'exhale'],
  ['pad', 'Pad', 'leader'],
  ['lead', 'Lead', 'melody'],
  ['swell', 'Swell', 'finality'],
  ['tx_transfer', 'Transfer', 'tx'],
  ['tx_defi', 'DeFi', 'tx'],
  ['tx_nft', 'NFT', 'tx'],
  ['tx_stake', 'Stake', 'tx'],
  ['ghost', 'Ghost', 'missed'],
  ['deep', 'Deep', 'whale'],
  ['drone', 'Drone', 'epoch'],
  ['texture', 'Texture', 'TPS'],
  ['riser', 'Riser', 'sunrise'],
  ['bed', 'Bed', 'loop'],
];

// Root chips in circle-of-fifths order — neighbours are musically near.
const ROOTS = ['A', 'E', 'B', 'F#', 'C#', 'G#', 'D#', 'A#', 'F', 'C', 'G', 'D'];

/** The "what the hell is happening?" card — every sound, mapped to its on-chain cause.
 *  (Canonical copy: src/audio/HOW-TO-HEAR.md — keep the two in sync.) */
const EXPLAINER_HTML = `
  <span class="x">✕</span>
  <h1>HOW TO HEAR THE STRATA</h1>
  <div class="sub">Every sound is a real event on Solana, happening now. Nothing is looped, nothing is faked.</div>
  <div class="row"><b>the kick</b><span>a block (a “slot”), ~2.5 per second — the network's heartbeat. The off-beat hat is the same block's exhale; it fades in as the network gets busy.</span></div>
  <div class="row"><b>a skipped beat</b><span>+ a hiss of static = a slot the leader missed. Several in a row and the whole floor stumbles — the kick drops out for a bar.</span></div>
  <div class="row"><b>the melody</b><span>written by transactions, one note each: transfers step up, DeFi steps down, NFTs leap, staking pulls the line home (the bassline). Louder notes are bigger transactions.</span></div>
  <div class="row"><b>a deep gong</b><span>a whale — one enormous transaction, rung once.</span></div>
  <div class="row"><b>the chords</b><span>a new validator leads the network every 4 beats (one bar); the harmony moves with the leader schedule — and the melody sits where the leader stands, panning across the stage as the schedule rotates. When a giant leads (an enormous stake), its chord carries a root an octave deeper.</span></div>
  <div class="row"><b>a great bell</b><span>the slot counter crossing a million — watch the number roll over as it tolls (~every 4½ days).</span></div>
  <div class="row"><b>the swell</b><span>finality — every ~12 seconds the chain makes its recent past irreversible, and the music resolves with it.</span></div>
  <div class="row"><b>the air</b><span>the bright hiss riding above everything is live TPS — transactions per second, as texture.</span></div>
  <div class="row"><b>the sections</b><span>every 32 bars the music re-reads the network: heating up → it builds; cooling → it strips back to dub; spending high energy → the kick vanishes… and drops.</span></div>
  <div class="row"><b>the sunrise</b><span>every ~2 days an epoch ends — the validator schedule turns over. The whole piece builds, daylight opens (the harmony lifts to major), and the key steps a fifth: the network's new day, in a new light.</span></div>
  <div class="row"><b>the key</b><span>E — derived, not chosen: one slot every 396ms is a frequency, and five octaves up that frequency <i>is</i> an E. The blockchain hums it; we just tuned to it.</span></div>
  <div class="foot">The crystal is the network made visible. This is the network made audible — the same events, the same moment, scoring itself.</div>
`;

export function mountStudio(engine: AudioEngine, opts: StudioMountOptions = {}): StudioHandle {
  const root = opts.root ?? document.body;
  const overlay = opts.overlay === true;

  // Scoped stylesheet (id-deduped so two mounts don't double-inject).
  let styleEl = document.getElementById('sdsk-style') as HTMLStyleElement | null;
  if (!styleEl) {
    styleEl = el('style');
    styleEl.id = 'sdsk-style';
    styleEl.textContent = CSS;
    document.head.appendChild(styleEl);
  }

  const host = el('div', `sdsk ${overlay ? 'ovl' : 'standalone'}`);
  root.appendChild(host);

  const toast = el('div', 'sdsk-toast');
  document.body.appendChild(toast);
  let toastTimer = 0;
  const showToast = (msg: string): void => {
    toast.textContent = msg;
    toast.style.opacity = '1';
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => (toast.style.opacity = '0'), 1800);
  };

  let fab: HTMLButtonElement | null = null;
  if (overlay) {
    fab = el('button', 'sdsk-fab', '🎛 STUDIO');
    fab.addEventListener('click', () => {
      host.classList.toggle('hidden');
      fab!.textContent = host.classList.contains('hidden') ? '🎛 STUDIO' : '✕ CLOSE';
    });
    fab.textContent = '✕ CLOSE';
    document.body.appendChild(fab);
  }

  /* — live state the readout loop updates — */
  let specRAF = 0;
  let readTimer = 0;
  let recTimer = 0;
  let recStartedAt = 0;
  let bedRendered = false;
  let destroyed = false;

  // readout nodes (rebuilt with the desk)
  let rSlot: HTMLElement, rBar: HTMLElement, rChord: HTMLElement, rKey: HTMLElement, rTps: HTMLElement, rSun: HTMLElement, rSection: HTMLElement, iFill: HTMLElement;
  let lastSection = '';
  let lastMilestone: number | null = null;

  function readBlock(node: HTMLElement, label: string): HTMLElement {
    const b = el('div', 'read');
    b.append(node, el('span', '', label));
    return b;
  }

  function startSpectrum(canvas: HTMLCanvasElement): void {
    if (specRAF) cancelAnimationFrame(specRAF);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const NYQUIST = 22050;
    const draw = (): void => {
      if (destroyed) return;
      specRAF = requestAnimationFrame(draw);
      const data = engine.getSpectrum();
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      const n = data.length;
      if (!n) return;
      const lowF = AUDIO_CONFIG.eq.lowFrequency;
      const highF = AUDIO_CONFIG.eq.highFrequency;
      const bw = w / n;
      for (let i = 0; i < n; i++) {
        let db = data[i];
        if (!isFinite(db)) db = -100;
        const v = Math.max(0, Math.min(1, (db + 100) / 100));
        const bh = v * (h - 2);
        const freq = (i / n) * NYQUIST;
        ctx.fillStyle =
          freq < lowF ? 'rgba(120,140,255,0.85)' : freq < highF ? 'rgba(126,224,200,0.85)' : 'rgba(255,207,126,0.85)';
        ctx.fillRect(i * bw, h - bh, Math.max(1, bw - 1), bh);
      }
    };
    draw();
  }

  /* — panels — */

  function buildMaster(): HTMLElement {
    const panel = el('div', 'panel');
    panel.appendChild(el('h2', '', 'MASTER · MIXING TABLE — bass / mid / high · DJ filter · live spectrum'));
    const table = el('div', 'mtable');

    const left = el('div');
    const canvas = document.createElement('canvas');
    canvas.className = 'spec';
    canvas.width = 600;
    canvas.height = 120;
    left.appendChild(canvas);
    const sl = el('div', 'speclabels');
    sl.append(el('span', '', '20 Hz'), el('span', '', 'BASS · MID · HIGH'), el('span', '', '20 kHz'));
    left.appendChild(sl);
    left.appendChild(slider('Bass / Mid crossover (Hz)', 80, 800, 5, AUDIO_CONFIG.eq.lowFrequency, fmtInt, (v) => engine.setEQCrossover('low', v)));
    left.appendChild(slider('Mid / High crossover (Hz)', 800, 8000, 20, AUDIO_CONFIG.eq.highFrequency, fmtInt, (v) => engine.setEQCrossover('high', v)));
    left.appendChild(slider('Master volume', 0, 1.2, 0.01, AUDIO_CONFIG.master.outputGain, fmt2, (v) => engine.setMasterGain(v)));
    table.appendChild(left);

    const right = el('div', 'eqrow');
    const bands: Array<['BASS' | 'MID' | 'HIGH', 'low' | 'mid' | 'high']> = [
      ['BASS', 'low'],
      ['MID', 'mid'],
      ['HIGH', 'high'],
    ];
    const eqCtls: Array<{ input: HTMLInputElement; bv: HTMLElement; key: 'low' | 'mid' | 'high' }> = [];
    for (const [lbl, key] of bands) {
      const b = el('div', 'eqband');
      b.appendChild(el('div', 'bl', lbl));
      const input = el('input');
      input.type = 'range';
      input.className = 'vert';
      input.min = '-40';
      input.max = '6';
      input.step = '0.5';
      input.value = String(AUDIO_CONFIG.eq[key]);
      const bv = el('div', 'bv', `${AUDIO_CONFIG.eq[key].toFixed(1)} dB`);
      input.addEventListener('input', () => {
        const v = parseFloat(input.value);
        bv.textContent = `${v.toFixed(1)} dB`;
        engine.setEQ(key, v);
      });
      b.append(input, bv);
      right.appendChild(b);
      eqCtls.push({ input, bv, key });
    }
    const fb = el('div', 'eqband filt');
    fb.appendChild(el('div', 'bl', 'FILTER'));
    const fin = el('input');
    fin.type = 'range';
    fin.className = 'vert';
    fin.min = '-1';
    fin.max = '1';
    fin.step = '0.01';
    fin.value = '0';
    const fbv = el('div', 'bv', 'open');
    fin.addEventListener('input', () => {
      const v = parseFloat(fin.value);
      fbv.textContent = Math.abs(v) < 0.02 ? 'open' : v < 0 ? `LP ${Math.round(-v * 100)}` : `HP ${Math.round(v * 100)}`;
      engine.setMasterFilter(v);
    });
    fb.append(fin, fbv);
    right.appendChild(fb);
    table.appendChild(right);
    panel.appendChild(table);

    const reset = el('button', '', '⟲ RESET EQ + FILTER');
    reset.style.marginTop = '12px';
    reset.addEventListener('click', () => {
      for (const c of eqCtls) {
        c.input.value = '0';
        c.bv.textContent = '0.0 dB';
        engine.setEQ(c.key, 0);
      }
      fin.value = '0';
      fbv.textContent = 'open';
      engine.setMasterFilter(0);
    });
    panel.appendChild(reset);

    startSpectrum(canvas);
    return panel;
  }

  function buildMixer(): HTMLElement {
    const mixer = el('div', 'panel');
    mixer.appendChild(el('h2', '', 'MIXER — per-sound level · reverb · delay · solo/mute · audition'));
    for (const [name, label, sub] of STRIP_DEFS) {
      const st = engine.getStripState(name);
      if (!st) continue;
      if (name === 'bed') bedRendered = true;
      const row = el('div', 'strip');
      row.appendChild(el('div', 'nm', `${label}<i>${sub}</i>`));

      const lvl = el('div', 'ctl');
      const lvlIn = el('input');
      lvlIn.type = 'range';
      lvlIn.min = '0';
      lvlIn.max = '1.5';
      lvlIn.step = '0.01';
      lvlIn.value = String(st.level);
      lvlIn.addEventListener('input', () => engine.setStripLevel(name, parseFloat(lvlIn.value)));
      lvl.appendChild(lvlIn);
      row.appendChild(lvl);

      const mkSend = (bus: 'reverb' | 'delay', init: number, lab: string): HTMLElement => {
        const c = el('div', 'ctl');
        c.appendChild(el('label', '', `<span style="font-size:7px;color:rgba(255,255,255,0.3)">${lab}</span>`));
        const i = el('input');
        i.type = 'range';
        i.min = '0';
        i.max = '1';
        i.step = '0.01';
        i.value = String(init);
        i.addEventListener('input', () => engine.setStripSend(name, bus, parseFloat(i.value)));
        c.appendChild(i);
        return c;
      };
      row.appendChild(mkSend('reverb', st.reverb, 'REV'));
      row.appendChild(mkSend('delay', st.delay, 'DLY'));

      const sbtns = el('div', 'sbtns');
      const sBtn = el('button', 'solo', 'S');
      if (st.soloed) sBtn.classList.add('on');
      sBtn.addEventListener('click', () => {
        sBtn.classList.toggle('on');
        engine.setSolo(name, sBtn.classList.contains('on'));
      });
      const mBtn = el('button', 'mute', 'M');
      if (st.muted) mBtn.classList.add('on');
      mBtn.addEventListener('click', () => {
        mBtn.classList.toggle('on');
        engine.setMute(name, mBtn.classList.contains('on'));
      });
      const aBtn = el('button', '', '▶');
      aBtn.addEventListener('click', () => engine.audition(name));
      sbtns.append(sBtn, mBtn, aBtn);
      row.appendChild(sbtns);
      mixer.appendChild(row);
    }
    return mixer;
  }

  function buildSpaceAndKey(): HTMLElement {
    const space = el('div', 'panel');
    space.appendChild(el('h2', '', 'SPACE'));
    space.appendChild(slider('Tempo (BPM)', 110, 175, 1, AUDIO_CONFIG.tempoBpm, fmtInt, (v) => engine.setTempo(v)));
    space.appendChild(slider('Reverb decay (s)', 1, 16, 0.5, AUDIO_CONFIG.reverb.decaySec, (v) => v.toFixed(1), (v) => engine.setReverbDecay(v)));
    space.appendChild(slider('Reverb amount', 0, 2, 0.01, 1, fmt2, (v) => engine.setReverbAmount(v)));
    space.appendChild(slider('Delay feedback', 0, 0.92, 0.01, AUDIO_CONFIG.delay.feedback, fmt2, (v) => engine.setDelayFeedback(v)));
    space.appendChild(slider('Delay amount', 0, 2, 0.01, 1, fmt2, (v) => engine.setDelayAmount(v)));
    space.appendChild(
      slider('Stereo orbit (melody follows the leader)', 0, 1, 0.01, AUDIO_CONFIG.melody.spatialWidth, fmt2, (v) => (AUDIO_CONFIG.melody.spatialWidth = v)),
    );

    // ── KEY — root wheel (circle of fifths) + mode. Changes land musically on the next bar. ──
    space.appendChild(el('h3', '', 'KEY — modulates on the next downbeat, drones glide'));
    const keys = el('div', 'keys');
    const keyBtns: HTMLButtonElement[] = [];
    const highlight = (): void => {
      const cur = engine.currentKey;
      keyBtns.forEach((b) => b.classList.toggle('on', b.textContent === cur.root));
      modeBtns.forEach((b) => b.classList.toggle('on', b.dataset.mode === cur.mode));
    };
    for (const r of ROOTS) {
      const b = el('button', '', r);
      b.addEventListener('click', () => {
        engine.setKey(r);
        showToast(`Key → ${engine.currentKey.name} (lands next bar)`);
        highlight();
      });
      keys.appendChild(b);
      keyBtns.push(b);
    }
    space.appendChild(keys);
    const modeSeg = el('div', 'seg');
    const modeBtns: HTMLButtonElement[] = [];
    for (const [mk, m] of Object.entries(KEY_MODES)) {
      const b = el('button', '', m.name);
      b.dataset.mode = mk;
      b.addEventListener('click', () => {
        engine.setKey(engine.currentKey.root, mk);
        showToast(`Key → ${engine.currentKey.name}`);
        highlight();
      });
      modeSeg.appendChild(b);
      modeBtns.push(b);
    }
    space.appendChild(modeSeg);
    highlight();
    return space;
  }

  function buildDirector(): HTMLElement {
    const dir = el('div', 'panel');
    dir.appendChild(el('h2', '', 'DIRECTOR — the arc'));

    const sunBtn = el('button', 'sunrise', '☀  SUNRISE');
    sunBtn.addEventListener('click', () => engine.triggerSunrise());
    dir.appendChild(sunBtn);

    const intField = el('div', 'field');
    const intLab = el('label');
    const intVal = el('b', '', engine.intensity.toFixed(2));
    intLab.append(document.createTextNode('Intensity (energy)'), intVal);
    const intInput = el('input');
    intInput.type = 'range';
    intInput.min = '0';
    intInput.max = '1';
    intInput.step = '0.01';
    intInput.value = String(engine.intensity);
    const autoBtn = el('button', 'on', 'AUTO (follow live TPS)');
    autoBtn.style.marginTop = '6px';
    intInput.addEventListener('input', () => {
      intVal.textContent = parseFloat(intInput.value).toFixed(2);
      engine.setIntensity(parseFloat(intInput.value));
      autoBtn.classList.remove('on');
    });
    autoBtn.addEventListener('click', () => {
      const on = !autoBtn.classList.contains('on');
      autoBtn.classList.toggle('on', on);
      if (on) engine.clearManualIntensity();
      else engine.setIntensity(parseFloat(intInput.value));
    });
    intField.append(intLab, intInput, autoBtn);
    dir.appendChild(intField);

    dir.appendChild(slider('Pump (sidechain depth)', 0, 0.8, 0.01, AUDIO_CONFIG.pump.depth, fmt2, (v) => engine.setPumpDepth(v)));

    // ── MOMENTS — the honest event gestures (manual triggers for tuning by ear; the live
    // detectors fire the same functions on real network behavior). ──
    dir.appendChild(el('h3', '', 'MOMENTS — spikes, whales, stumbles (manual triggers)'));
    const momRow = el('div', 'bar');
    const surgeBtn = el('button', '', '⚡ SURGE');
    surgeBtn.addEventListener('click', () => {
      engine.triggerSurge();
      showToast('Surge — a 6-bar build, then the exhale');
    });
    const deepBtn = el('button', '', '🐋 DEEP');
    deepBtn.addEventListener('click', () => engine.triggerDeep(1));
    const stumbleBtn = el('button', '', '𝄽 STUMBLE');
    stumbleBtn.addEventListener('click', () => {
      engine.triggerStumble();
      showToast('Stumble — the kick drops for a bar');
    });
    momRow.append(surgeBtn, deepBtn, stumbleBtn);
    dir.appendChild(momRow);

    // ── ARRANGER — phrase-level storytelling: the chain picks each 32-bar block. ──
    dir.appendChild(el('h3', '', 'ARRANGER — the chain DJs in 32-bar sections'));
    const arrRow = el('div', 'bar');
    const arrBtn = el('button', AUDIO_CONFIG.arranger.enabled ? 'on' : '', '▦ SECTIONS');
    arrBtn.addEventListener('click', () => {
      const on = !AUDIO_CONFIG.arranger.enabled;
      AUDIO_CONFIG.arranger.enabled = on;
      arrBtn.classList.toggle('on', on);
      showToast(on ? 'Arranger on — GROOVE/DUB/LIFT/BREAK chosen by chain stats' : 'Arranger off — pure flow');
    });
    arrRow.appendChild(arrBtn);
    dir.appendChild(arrRow);
    dir.appendChild(slider('Section length (bars)', 8, 64, 4, AUDIO_CONFIG.arranger.sectionBars, fmtInt, (v) => (AUDIO_CONFIG.arranger.sectionBars = v)));
    dir.appendChild(slider('Break spacing (sections)', 1, 8, 1, AUDIO_CONFIG.arranger.minSectionsBetweenBreaks, fmtInt, (v) => (AUDIO_CONFIG.arranger.minSectionsBetweenBreaks = v)));

    // Demo-only: how fast the synthetic chain sweeps an "epoch" (real network: ~2 days).
    if (opts.chain?.setEpochSweepSec) {
      dir.appendChild(
        slider('Epoch demo pace (min — real: ~2 days)', 2, 30, 1, 10, fmtInt, (v) =>
          opts.chain!.setEpochSweepSec!(v * 60),
        ),
      );
    }

    const epochModBtn = el(
      'button',
      AUDIO_CONFIG.director.epochModulation.enabled ? 'on' : '',
      '☉ EPOCH → NEW KEY (fifths)',
    );
    epochModBtn.style.marginTop = '8px';
    epochModBtn.addEventListener('click', () => {
      const on = !AUDIO_CONFIG.director.epochModulation.enabled;
      AUDIO_CONFIG.director.epochModulation.enabled = on;
      epochModBtn.classList.toggle('on', on);
      showToast(on ? 'Each epoch modulates a fifth up — 12 epochs tours all keys' : 'Epoch key calendar off');
    });
    dir.appendChild(epochModBtn);

    // Melody source: the tx stream as composer vs. the plain chord arpeggio.
    const melField = el('div', 'field');
    melField.appendChild(el('label', '', 'Transactions write…'));
    const melSeg = el('div', 'seg');
    const walkB = el('button', AUDIO_CONFIG.melody.mode === 'walk' ? 'on' : '', 'The melody (walk)');
    const arpB = el('button', AUDIO_CONFIG.melody.mode === 'arpeggio' ? 'on' : '', 'An arpeggio');
    walkB.addEventListener('click', () => {
      AUDIO_CONFIG.melody.mode = 'walk';
      walkB.classList.add('on');
      arpB.classList.remove('on');
    });
    arpB.addEventListener('click', () => {
      AUDIO_CONFIG.melody.mode = 'arpeggio';
      arpB.classList.add('on');
      walkB.classList.remove('on');
    });
    melSeg.append(walkB, arpB);
    melField.appendChild(melSeg);
    dir.appendChild(melField);

    const modeField = el('div', 'field');
    modeField.appendChild(el('label', '', 'Progression'));
    const seg = el('div', 'seg');
    const seqB = el('button', AUDIO_CONFIG.director.progressionMode === 'sequential' ? 'on' : '', 'Walking');
    const ldrB = el('button', AUDIO_CONFIG.director.progressionMode === 'leader' ? 'on' : '', 'Per-leader');
    seqB.addEventListener('click', () => {
      AUDIO_CONFIG.director.progressionMode = 'sequential';
      seqB.classList.add('on');
      ldrB.classList.remove('on');
    });
    ldrB.addEventListener('click', () => {
      AUDIO_CONFIG.director.progressionMode = 'leader';
      ldrB.classList.add('on');
      seqB.classList.remove('on');
    });
    seg.append(seqB, ldrB);
    modeField.appendChild(seg);
    dir.appendChild(modeField);

    dir.appendChild(slider('Chord changes every (bars)', 1, 8, 1, AUDIO_CONFIG.director.chordChangeEveryBars, fmtInt, (v) => (AUDIO_CONFIG.director.chordChangeEveryBars = v)));
    dir.appendChild(slider('Movement floor (Hz)', 200, 4000, 20, AUDIO_CONFIG.director.movementCutoffMin, fmtInt, (v) => (AUDIO_CONFIG.director.movementCutoffMin = v)));
    dir.appendChild(slider('Sunrise · build (bars)', 4, 48, 1, AUDIO_CONFIG.sunrise.buildBars, fmtInt, (v) => (AUDIO_CONFIG.sunrise.buildBars = v)));
    dir.appendChild(slider('Sunrise · daylight (bars)', 1, 24, 1, AUDIO_CONFIG.sunrise.lightBars, fmtInt, (v) => (AUDIO_CONFIG.sunrise.lightBars = v)));
    dir.appendChild(slider('Sunrise · close (bars)', 1, 8, 1, AUDIO_CONFIG.sunrise.closeBars, fmtInt, (v) => (AUDIO_CONFIG.sunrise.closeBars = v)));
    dir.appendChild(slider('Sunrise · key lift (semis)', 0, 4, 1, AUDIO_CONFIG.sunrise.keyLiftSemis, fmtInt, (v) => (AUDIO_CONFIG.sunrise.keyLiftSemis = v)));
    dir.appendChild(slider('Auto-cycle (min · 0=off)', 0, 30, 1, AUDIO_CONFIG.director.autoCycleMin, (v) => (v === 0 ? 'off' : fmtInt(v)), (v) => engine.setAutoCycleMinutes(v)));
    return dir;
  }

  function buildBottomBar(): HTMLElement {
    const bar = el('div', 'bar');

    let muted = false;
    const muteBtn = el('button', '', '◼ MUTE');
    muteBtn.addEventListener('click', () => {
      muted = !muted;
      engine.setMuted(muted);
      muteBtn.textContent = muted ? '▶ UNMUTE' : '◼ MUTE';
      muteBtn.classList.toggle('on', muted);
    });
    bar.appendChild(muteBtn);

    if (opts.chain) {
      const chainBtn = el('button', '', opts.chain.running() ? '■ STOP CHAIN' : '▶ START CHAIN');
      chainBtn.addEventListener('click', () => {
        if (opts.chain!.running()) {
          opts.chain!.stop();
          chainBtn.textContent = '▶ START CHAIN';
        } else {
          opts.chain!.start();
          chainBtn.textContent = '■ STOP CHAIN';
        }
      });
      bar.appendChild(chainBtn);
    }

    // ● REC — capture the master, download the take.
    const recBtn = el('button', 'rec', '● REC');
    recBtn.addEventListener('click', () => {
      if (!engine.recording) {
        if (engine.startRecording()) {
          recStartedAt = performance.now();
          recBtn.classList.add('on');
          recTimer = window.setInterval(() => {
            const s = Math.floor((performance.now() - recStartedAt) / 1000);
            recBtn.textContent = `■ REC ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
          }, 500);
          showToast('Recording the master…');
        } else {
          showToast('Recording not supported here');
        }
      } else {
        window.clearInterval(recTimer);
        recBtn.classList.remove('on');
        recBtn.textContent = '● REC';
        void engine.stopRecording().then((blob) => {
          if (!blob || blob.size === 0) {
            showToast('Nothing captured');
            return;
          }
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          const t = new Date();
          a.download = `strata-take-${t.getHours()}${String(t.getMinutes()).padStart(2, '0')}.webm`;
          a.click();
          window.setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
          showToast(`Take saved (${(blob.size / 1024 / 1024).toFixed(1)} MB)`);
        });
      }
    });
    bar.appendChild(recBtn);

    // Presets: factory + saved in one select, save, copy-link.
    const sel = el('select');
    const refreshSelect = (): void => {
      sel.innerHTML = '';
      sel.appendChild(el('option', '', 'Presets…'));
      const fg = document.createElement('optgroup');
      fg.label = 'Factory';
      for (const f of FACTORY_PRESETS) fg.appendChild(new Option(f.name, `f:${f.name}`));
      sel.appendChild(fg);
      const saved = loadSavedPresets();
      const names = Object.keys(saved);
      if (names.length) {
        const sg = document.createElement('optgroup');
        sg.label = 'Saved';
        for (const n of names) sg.appendChild(new Option(n, `s:${n}`));
        sel.appendChild(sg);
      }
    };
    refreshSelect();
    sel.addEventListener('change', () => {
      const v = sel.value;
      let preset: StudioPreset | undefined;
      if (v.startsWith('f:')) preset = FACTORY_PRESETS.find((f) => f.name === v.slice(2))?.preset;
      else if (v.startsWith('s:')) preset = loadSavedPresets()[v.slice(2)];
      if (preset) {
        engine.applyState(preset);
        showToast(`Preset: ${v.slice(2)}`);
        renderDesk(); // rebuild so every control shows the new values
      }
    });
    bar.appendChild(sel);

    const saveBtn = el('button', '', '💾 SAVE');
    saveBtn.addEventListener('click', () => {
      const name = window.prompt('Preset name:', 'My mix');
      if (!name) return;
      const saved = loadSavedPresets();
      saved[name] = engine.exportState(name);
      storeSavedPresets(saved);
      refreshSelect();
      showToast(`Saved “${name}”`);
    });
    bar.appendChild(saveBtn);

    const linkBtn = el('button', '', '⧉ COPY LINK');
    linkBtn.addEventListener('click', () => {
      const preset = engine.exportState();
      const url = `${location.origin}${location.pathname}#p=${b64encode(JSON.stringify(preset))}`;
      if (navigator.clipboard) {
        navigator.clipboard.writeText(url).then(
          () => showToast('Mix link copied — anyone who opens it hears your tuning'),
          () => showToast('Copy blocked — link logged to console'),
        );
      } else showToast('Clipboard unavailable — link logged to console');
      console.log('[studio] mix link:', url);
    });
    bar.appendChild(linkBtn);

    const hint = el('div', 'dim sp', overlay ? 'Mixing the live network' : 'Tune live · save or share when it sings');
    bar.appendChild(hint);
    return bar;
  }

  /** The "what the hell is happening?" card — click anywhere outside (or ✕) to dismiss. */
  function openExplainer(): void {
    if (document.querySelector('.sdsk-explain')) return;
    const veil = el('div', 'sdsk-explain');
    const card = el('div', 'card', EXPLAINER_HTML);
    card.addEventListener('click', (e) => e.stopPropagation());
    card.querySelector('.x')?.addEventListener('click', () => veil.remove());
    veil.addEventListener('click', () => veil.remove());
    veil.appendChild(card);
    document.body.appendChild(veil);
  }

  /* — assembly + readout loop — */

  function renderDesk(): void {
    if (specRAF) cancelAnimationFrame(specRAF);
    host.innerHTML = '';
    bedRendered = false;

    const wrap = el('div', 'wrap');
    const hdr = el('div', 'hdr');
    const title = `${overlay ? 'STRATA · DJ' : 'STRATA · STUDIO'}${opts.sourceLabel ? ' · ' + opts.sourceLabel : ''}`;
    hdr.append(el('div', 't', title));
    const helpBtn = el('button', '', '? how to hear it');
    helpBtn.addEventListener('click', openExplainer);
    hdr.appendChild(helpBtn);
    const reads = el('div', 'reads');
    rSlot = el('b', '', '—');
    rBar = el('b', '', '—');
    rChord = el('b', '', '—');
    rKey = el('b', '', AUDIO_CONFIG.key.scaleName);
    rTps = el('b', '', '—');
    rSun = el('b', '', '○');
    rSection = el('b', '', '—');
    iFill = el('div');
    const ibar = el('div', 'ibar');
    ibar.appendChild(iFill);
    reads.append(
      readBlock(rSlot, 'SLOT'),
      readBlock(rBar, 'BAR'),
      readBlock(rKey, 'KEY'),
      readBlock(rChord, 'CHORD'),
      readBlock(rSection, 'SECTION'),
      readBlock(rTps, 'TPS'),
      readBlock(rSun, 'SUNRISE'),
      (() => {
        const b = el('div', 'read');
        b.append(ibar, el('span', '', 'INTENSITY'));
        return b;
      })(),
    );
    hdr.appendChild(reads);
    wrap.appendChild(hdr);

    wrap.appendChild(buildMaster());

    const grid = el('div', 'grid');
    grid.appendChild(buildMixer());
    grid.appendChild(buildSpaceAndKey());
    grid.appendChild(buildDirector());
    wrap.appendChild(grid);

    wrap.appendChild(buildBottomBar());
    host.appendChild(wrap);
  }

  function tick(): void {
    if (destroyed) return;
    const r = opts.readouts?.() ?? {};
    if (rSlot) rSlot.textContent = r.slot !== undefined ? r.slot.toLocaleString('en-US') : '—';
    if (rBar) rBar.textContent = r.bar !== undefined ? String(r.bar) : '—';
    if (rTps) rTps.textContent = r.tps !== undefined ? r.tps.toLocaleString('en-US') : '—';
    if (rChord) rChord.textContent = engine.currentChordName;
    if (rKey) rKey.textContent = engine.currentKey.name;
    const arr = engine.arrangerState;
    if (rSection) rSection.textContent = AUDIO_CONFIG.arranger.enabled ? `${arr.section} ${arr.bar}/${arr.sectionBars}` : 'off';
    if (arr.section !== lastSection) {
      if (lastSection !== '') showToast(`Section → ${arr.section} (${arr.reason})`);
      lastSection = arr.section;
    }
    if (engine.lastMilestoneSlot !== null && engine.lastMilestoneSlot !== lastMilestone) {
      lastMilestone = engine.lastMilestoneSlot;
      showToast(`⨀ SLOT ${lastMilestone.toLocaleString('en-US')} — the millionth layer`);
    }
    if (iFill) iFill.style.width = `${Math.round(engine.intensity * 100)}%`;
    if (rSun) {
      rSun.textContent = engine.sunriseActive ? '☀ OPEN' : '○';
      rSun.style.color = engine.sunriseActive ? '#ffcf7e' : '';
    }
    // The bed strip arrives a beat after start — fold it in once it exists.
    if (!bedRendered && engine.getStripState('bed')) renderDesk();
  }

  renderDesk();
  readTimer = window.setInterval(tick, 400);

  // A shared mix in the URL? Apply it once the desk is up.
  const shared = presetFromHash();
  if (shared) {
    engine.applyState(shared);
    renderDesk();
    showToast(shared.name ? `Loaded shared mix “${shared.name}”` : 'Loaded shared mix from link');
  }

  return {
    destroy(): void {
      destroyed = true;
      if (specRAF) cancelAnimationFrame(specRAF);
      window.clearInterval(readTimer);
      window.clearInterval(recTimer);
      host.remove();
      toast.remove();
      fab?.remove();
    },
  };
}

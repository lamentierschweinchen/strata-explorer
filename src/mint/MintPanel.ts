/**
 * The "Mint a moment" panel — vanilla DOM, dark-glass + Semi-Mono to match the studio desk.
 *
 * Flow: arm → REC (manual or a fixed window) → STOP → a Moment is assembled → preview (cover,
 * facts, a playable WAV, verify links) → download the bundle (Phase 1, no chain). The permanent
 * mint (Arweave + Solana) is lazy-loaded into the result view's mint slot in Phase 3 — its heavy
 * deps never touch this module's chunk until the artist clicks "Continue to mint".
 *
 * Consumes only public APIs (engine + data source + an optional canvas grab). Type-only imports.
 */
import type { AudioEngine } from '../audio/AudioEngine';
import type { SolanaDataSource } from '../data/DataSource';
import type { Moment } from './types';
import { CaptureController } from './capture';
import { detectLive } from './chainFacts';
import { buildBundle, downloadBlob } from './bundle';
import { solscanSlotUrl } from './config';

export interface MintPanelOptions {
  engine: AudioEngine;
  dataSource: SolanaDataSource;
  getCanvas?: () => HTMLCanvasElement | null;
  container: HTMLElement;
  /** Optional: render a close affordance that calls this. */
  onClose?: () => void;
}

type State = 'idle' | 'recording' | 'processing' | 'ready';

const WINDOWS: Array<{ label: string; sec: number }> = [
  { label: 'Manual', sec: 0 },
  { label: '30s', sec: 30 },
  { label: '60s', sec: 60 },
  { label: '90s', sec: 90 },
];

export class MintPanel {
  readonly el: HTMLElement;
  private readonly opts: MintPanelOptions;
  private readonly capture: CaptureController;
  private readonly live: boolean;

  private state: State = 'idle';
  private windowSec = 0;
  private tick: number | null = null;
  private autoStopAt = 0;
  private moment: Moment | null = null;
  private objectUrls: string[] = [];

  // refs
  private recBtn!: HTMLButtonElement;
  private recReadout!: HTMLElement;
  private windowRow!: HTMLElement;
  private hint!: HTMLElement;
  private processingEl!: HTMLElement;
  private resultEl!: HTMLElement;

  constructor(opts: MintPanelOptions) {
    this.opts = opts;
    this.capture = new CaptureController(opts.engine, opts.dataSource, opts.getCanvas);
    this.live = detectLive(opts.dataSource);
    this.el = this.build();
    opts.container.appendChild(this.el);
  }

  destroy(): void {
    this.stopTick();
    void this.capture.cancel();
    this.revokeUrls();
    this.el.remove();
  }

  /* ── build ─────────────────────────────────────────────────────────────────────────────── */

  private build(): HTMLElement {
    const root = document.createElement('div');
    root.className = 'stx-mint';
    root.innerHTML = STYLE;

    const card = document.createElement('div');
    card.className = 'stx-card';
    root.appendChild(card);

    // Header
    const head = document.createElement('div');
    head.className = 'stx-head';
    head.innerHTML = `
      <div>
        <div class="stx-title">MINT A MOMENT</div>
        <div class="stx-sub">a minute of Solana, scored by itself, kept forever</div>
      </div>
      <div class="stx-headright">
        <span class="stx-badge ${this.live ? 'live' : 'demo'}">${this.live ? '● LIVE' : '○ DEMO'}</span>
      </div>`;
    if (this.opts.onClose) {
      const close = document.createElement('button');
      close.className = 'stx-close';
      close.textContent = '✕';
      close.title = 'Close';
      close.addEventListener('click', () => this.opts.onClose?.());
      head.querySelector('.stx-headright')!.appendChild(close);
    }
    card.appendChild(head);

    if (!this.live) {
      const warn = document.createElement('div');
      warn.className = 'stx-warn';
      warn.textContent =
        'Demo data — captures will be marked SIMULATED and the slots are not on-chain-verifiable.';
      card.appendChild(warn);
    }

    // Capture block
    const cap = document.createElement('div');
    cap.className = 'stx-capture';

    this.recBtn = document.createElement('button');
    this.recBtn.className = 'stx-rec';
    this.recBtn.addEventListener('click', () => void this.onRecClick());
    cap.appendChild(this.recBtn);

    this.recReadout = document.createElement('div');
    this.recReadout.className = 'stx-readout';
    cap.appendChild(this.recReadout);

    this.windowRow = document.createElement('div');
    this.windowRow.className = 'stx-windows';
    WINDOWS.forEach((w, i) => {
      const b = document.createElement('button');
      b.className = 'stx-win' + (i === 0 ? ' on' : '');
      b.textContent = w.label;
      b.addEventListener('click', () => this.selectWindow(w.sec, b));
      this.windowRow.appendChild(b);
    });
    cap.appendChild(this.windowRow);

    this.hint = document.createElement('div');
    this.hint.className = 'stx-hint';
    cap.appendChild(this.hint);

    card.appendChild(cap);

    // Processing
    this.processingEl = document.createElement('div');
    this.processingEl.className = 'stx-processing';
    this.processingEl.style.display = 'none';
    this.processingEl.innerHTML =
      '<div class="stx-spin"></div><div>Transcoding to WAV · grabbing cover · reading the chain…</div>';
    card.appendChild(this.processingEl);

    // Result
    this.resultEl = document.createElement('div');
    this.resultEl.className = 'stx-result';
    this.resultEl.style.display = 'none';
    card.appendChild(this.resultEl);

    this.renderIdle();
    return root;
  }

  /* ── state rendering ───────────────────────────────────────────────────────────────────── */

  private renderIdle(): void {
    this.state = 'idle';
    this.recBtn.classList.remove('on');
    this.recBtn.innerHTML = '<span class="dot"></span><span>REC</span>';
    this.recReadout.textContent = '';
    this.windowRow.style.display = 'flex';
    this.hint.textContent = this.opts.engine.started
      ? 'Records exactly what plays. Pick a window or stop manually.'
      : 'REC starts the sound (a click counts as the gesture), then records it.';
    this.processingEl.style.display = 'none';
    this.resultEl.style.display = 'none';
  }

  private async onRecClick(): Promise<void> {
    if (this.state === 'idle') {
      // A click is a user gesture — safe to start the engine if it isn't already.
      if (!this.opts.engine.started) {
        try {
          await this.opts.engine.start();
          this.opts.engine.setMuted(false);
        } catch {
          this.hint.textContent = '⚠ Could not start audio. Try the speaker button first.';
          return;
        }
      }
      const ok = this.capture.start();
      if (!ok) {
        this.hint.textContent = '⚠ Recording unavailable in this browser.';
        return;
      }
      this.state = 'recording';
      this.autoStopAt = this.windowSec > 0 ? this.windowSec : 0;
      this.recBtn.classList.add('on');
      this.recBtn.innerHTML = '<span class="sq"></span><span>STOP</span>';
      this.windowRow.style.display = 'none';
      this.hint.textContent = 'Recording the chain…';
      this.startTick();
    } else if (this.state === 'recording') {
      await this.finishRecording();
    }
  }

  private async finishRecording(): Promise<void> {
    this.stopTick();
    this.state = 'processing';
    this.recBtn.classList.remove('on');
    this.recBtn.innerHTML = '<span class="dot"></span><span>REC</span>';
    this.processingEl.style.display = 'flex';
    this.resultEl.style.display = 'none';
    this.hint.textContent = '';
    try {
      const moment = await this.capture.stop();
      if (!moment) {
        this.hint.textContent = '⚠ Nothing was captured.';
        this.renderIdle();
        return;
      }
      this.moment = moment;
      this.renderResult(moment);
    } catch (e) {
      console.error('[mint] capture failed', e);
      this.hint.textContent = '⚠ Capture failed — see console.';
      this.renderIdle();
    }
  }

  private renderResult(moment: Moment): void {
    this.state = 'ready';
    this.processingEl.style.display = 'none';
    this.recReadout.textContent = '';
    this.windowRow.style.display = 'flex';
    this.recBtn.innerHTML = '<span class="dot"></span><span>RE-REC</span>';
    this.hint.textContent = 'Captured. Download the bundle, or continue to a permanent mint.';

    const f = moment.facts;
    const coverUrl = this.url(moment.cover.blob);
    const audioUrl = this.url(moment.audio.blob);

    const verify = f.live
      ? `<div class="stx-verify">verify ·
          <a href="${solscanSlotUrl(f.startSlot)}" target="_blank" rel="noopener">start slot</a> ·
          <a href="${solscanSlotUrl(f.stopSlot)}" target="_blank" rel="noopener">stop slot</a></div>`
      : `<div class="stx-verify demo">simulated — not independently verifiable</div>`;

    const slots = f.live
      ? `${f.startSlot.toLocaleString('en-US')} → ${f.stopSlot.toLocaleString('en-US')}`
      : 'simulated';

    this.resultEl.innerHTML = `
      <div class="stx-preview">
        <img class="stx-coverimg" src="${coverUrl}" alt="cover" />
        <div class="stx-meta">
          <div class="stx-mtitle">${escapeHtml(moment.title)}</div>
          <div class="stx-facts">
            ${fact('Epoch', String(f.epoch))}
            ${fact('Slots', slots)}
            ${fact('Finalized', f.live ? f.rootSlot.toLocaleString('en-US') : '—')}
            ${fact('Key', f.key)}
            ${fact('Section', f.section)}
            ${fact('Duration', `${Math.round(moment.durationSec)}s`)}
            ${fact('Captured', moment.capturedAtCET)}
            ${fact('Cover', moment.cover.source)}
          </div>
          ${verify}
        </div>
      </div>
      <audio class="stx-audio" controls src="${audioUrl}"></audio>
      <div class="stx-actions">
        <button class="stx-btn primary" data-act="download">⬇ Download bundle (.zip)</button>
      </div>
      <div class="stx-mintslot"></div>`;

    this.resultEl.querySelector<HTMLButtonElement>('[data-act="download"]')!.addEventListener('click', () =>
      void this.onDownload(),
    );

    this.mountMintSlot(moment);
    this.resultEl.style.display = 'block';
  }

  /** Phase 3 fills this. Lazy-loads the wallet/storage/mint flow only on demand. */
  private mountMintSlot(moment: Moment): void {
    const slot = this.resultEl.querySelector<HTMLElement>('.stx-mintslot');
    if (!slot) return;
    const cta = document.createElement('button');
    cta.className = 'stx-btn ghost';
    cta.textContent = 'Continue to permanent mint →';
    cta.addEventListener('click', () => void this.startMint(slot, moment, cta));
    slot.appendChild(cta);
  }

  // Replaced/expanded in Phase 3 (dynamic import of the chain flow).
  private async startMint(slot: HTMLElement, moment: Moment, cta: HTMLButtonElement): Promise<void> {
    cta.disabled = true;
    cta.textContent = 'Loading mint…';
    try {
      const { mountMintFlow } = await import('./mintFlow');
      cta.remove();
      mountMintFlow({ slot, moment, engine: this.opts.engine });
    } catch (e) {
      console.error('[mint] flow load failed', e);
      cta.disabled = false;
      cta.textContent = 'Continue to permanent mint →';
      const msg = document.createElement('div');
      msg.className = 'stx-verify demo';
      msg.textContent = '⚠ Mint flow failed to load — see console.';
      slot.appendChild(msg);
    }
  }

  private async onDownload(): Promise<void> {
    if (!this.moment) return;
    const btn = this.resultEl.querySelector<HTMLButtonElement>('[data-act="download"]');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Packaging…';
    }
    try {
      const { blob, filename } = await buildBundle(this.moment);
      downloadBlob(blob, filename);
      if (btn) btn.textContent = '✓ Downloaded — download again';
    } catch (e) {
      console.error('[mint] bundle failed', e);
      if (btn) btn.textContent = '⚠ Failed — retry';
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  /* ── small helpers ─────────────────────────────────────────────────────────────────────── */

  private selectWindow(sec: number, btn: HTMLElement): void {
    if (this.state === 'recording') return;
    this.windowSec = sec;
    this.windowRow.querySelectorAll('.stx-win').forEach((b) => b.classList.remove('on'));
    btn.classList.add('on');
  }

  private startTick(): void {
    this.stopTick();
    const update = (): void => {
      const e = this.capture.elapsedSec();
      const remaining = this.autoStopAt > 0 ? Math.max(0, this.autoStopAt - e) : 0;
      const shown = this.autoStopAt > 0 ? remaining : e;
      const slot = this.capture.currentSlot();
      this.recReadout.innerHTML =
        `<span class="stx-time">${fmtTime(shown)}</span>` +
        (slot ? `<span class="stx-slot">slot ${slot.toLocaleString('en-US')}</span>` : '');
      if (this.autoStopAt > 0 && e >= this.autoStopAt) void this.finishRecording();
    };
    update();
    this.tick = window.setInterval(update, 200);
  }

  private stopTick(): void {
    if (this.tick !== null) {
      clearInterval(this.tick);
      this.tick = null;
    }
  }

  private url(blob: Blob): string {
    const u = URL.createObjectURL(blob);
    this.objectUrls.push(u);
    return u;
  }

  private revokeUrls(): void {
    for (const u of this.objectUrls) URL.revokeObjectURL(u);
    this.objectUrls = [];
  }
}

function fact(label: string, value: string): string {
  return `<div class="stx-fact"><span>${label}</span><b>${escapeHtml(value)}</b></div>`;
}

function fmtTime(sec: number): string {
  const s = Math.floor(sec);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  );
}

const STYLE = `<style>
.stx-mint { font-family: "ABC Diatype Semi-Mono","SF Mono",ui-monospace,monospace; color: rgba(255,255,255,0.92);
  width: 100%; height: 100%; display: flex; align-items: flex-start; justify-content: center; overflow: auto; padding: 18px; box-sizing: border-box; }
.stx-card { width: 100%; max-width: 560px; background: rgba(8,8,20,0.92); border: 1px solid rgba(255,255,255,0.12);
  border-radius: 16px; padding: 22px; box-sizing: border-box; backdrop-filter: blur(10px); }
.stx-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
.stx-title { font-size: 15px; letter-spacing: 3px; font-weight: 500; }
.stx-sub { font-size: 11px; color: rgba(255,255,255,0.42); margin-top: 4px; letter-spacing: 0.5px; }
.stx-headright { display: flex; align-items: center; gap: 8px; }
.stx-badge { font-size: 10px; letter-spacing: 1.5px; padding: 4px 9px; border-radius: 999px; border: 1px solid rgba(255,255,255,0.16); }
.stx-badge.live { color: #14f195; border-color: rgba(20,241,149,0.4); }
.stx-badge.demo { color: rgba(255,255,255,0.5); }
.stx-close { background: none; border: 1px solid rgba(255,255,255,0.15); color: rgba(255,255,255,0.6);
  border-radius: 8px; width: 28px; height: 28px; cursor: pointer; font-size: 12px; }
.stx-close:hover { color: #fff; border-color: rgba(255,255,255,0.4); }
.stx-warn { margin-top: 14px; font-size: 11px; color: #ffce6e; background: rgba(255,206,110,0.08);
  border: 1px solid rgba(255,206,110,0.25); border-radius: 8px; padding: 8px 10px; line-height: 1.5; }
.stx-capture { display: flex; flex-direction: column; align-items: center; gap: 14px; margin: 22px 0 6px; }
.stx-rec { display: flex; align-items: center; gap: 10px; background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.2); color: #fff; border-radius: 999px; padding: 12px 26px;
  font-family: inherit; font-size: 13px; letter-spacing: 2px; cursor: pointer; transition: all .15s; }
.stx-rec:hover { border-color: rgba(255,255,255,0.5); background: rgba(255,255,255,0.07); }
.stx-rec .dot { width: 11px; height: 11px; border-radius: 50%; background: #ff4d4d; box-shadow: 0 0 8px #ff4d4d; }
.stx-rec.on { border-color: rgba(255,77,77,0.7); background: rgba(255,77,77,0.12); animation: stxpulse 1.4s infinite; }
.stx-rec .sq { width: 10px; height: 10px; background: #ff4d4d; border-radius: 2px; }
@keyframes stxpulse { 0%,100%{ box-shadow: 0 0 0 0 rgba(255,77,77,0.4);} 50%{ box-shadow: 0 0 0 7px rgba(255,77,77,0);} }
.stx-readout { display: flex; gap: 16px; align-items: baseline; min-height: 18px; }
.stx-time { font-size: 22px; letter-spacing: 2px; }
.stx-slot { font-size: 11px; color: rgba(255,255,255,0.45); }
.stx-windows { display: flex; gap: 6px; }
.stx-win { background: none; border: 1px solid rgba(255,255,255,0.14); color: rgba(255,255,255,0.6);
  border-radius: 7px; padding: 5px 12px; font-family: inherit; font-size: 11px; cursor: pointer; }
.stx-win.on { color: #fff; border-color: rgba(153,69,255,0.7); background: rgba(153,69,255,0.14); }
.stx-hint { font-size: 11px; color: rgba(255,255,255,0.4); text-align: center; min-height: 15px; line-height: 1.5; }
.stx-processing { display: flex; align-items: center; gap: 12px; justify-content: center; padding: 22px 0;
  font-size: 12px; color: rgba(255,255,255,0.6); }
.stx-spin { width: 16px; height: 16px; border: 2px solid rgba(255,255,255,0.2); border-top-color: #9945ff;
  border-radius: 50%; animation: stxspin .8s linear infinite; }
@keyframes stxspin { to { transform: rotate(360deg);} }
.stx-result { margin-top: 8px; }
.stx-preview { display: flex; gap: 14px; }
.stx-coverimg { width: 132px; height: 132px; border-radius: 10px; object-fit: cover; border: 1px solid rgba(255,255,255,0.12); flex: 0 0 auto; }
.stx-meta { flex: 1; min-width: 0; }
.stx-mtitle { font-size: 12px; line-height: 1.5; color: rgba(255,255,255,0.86); margin-bottom: 10px; word-break: break-word; }
.stx-facts { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 14px; }
.stx-fact { display: flex; justify-content: space-between; gap: 8px; font-size: 10.5px; border-bottom: 1px solid rgba(255,255,255,0.06); padding: 2px 0; }
.stx-fact span { color: rgba(255,255,255,0.38); }
.stx-fact b { color: rgba(255,255,255,0.82); font-weight: 500; text-align: right; }
.stx-verify { margin-top: 10px; font-size: 10.5px; color: rgba(255,255,255,0.42); }
.stx-verify a { color: #3bd9ff; text-decoration: none; }
.stx-verify a:hover { text-decoration: underline; }
.stx-verify.demo { color: #ffce6e; }
.stx-audio { width: 100%; margin: 14px 0 12px; height: 34px; }
.stx-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.stx-btn { font-family: inherit; font-size: 12px; letter-spacing: 1px; border-radius: 9px; padding: 11px 16px;
  cursor: pointer; border: 1px solid rgba(255,255,255,0.18); background: rgba(255,255,255,0.04); color: #fff; }
.stx-btn:hover { border-color: rgba(255,255,255,0.45); }
.stx-btn.primary { border-color: rgba(20,241,149,0.5); background: rgba(20,241,149,0.1); color: #b9ffe4; }
.stx-btn.ghost { width: 100%; margin-top: 14px; color: rgba(255,255,255,0.7); }
.stx-btn:disabled { opacity: .55; cursor: default; }
.stx-mintslot { }
</style>`;

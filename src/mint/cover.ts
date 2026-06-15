/**
 * The cover image — a square 1080² PNG.
 *
 * Preferred: the live crystal at the captured instant (`getCanvas()`), grabbed best-effort and
 * VALIDATED non-blank (the art's WebGL context has no preserveDrawingBuffer, so a grab can come
 * back empty — we never ship a black square). Fallback: the waveform of the take itself, which is
 * deeply on-theme — the literal shape of the sound the chain made. Either way a branded caption
 * strip carries the verifiable facts.
 *
 * Dependency-free; browser-only (2D canvas + Web Audio for the waveform).
 */
import type { ChainFacts, CoverArtifact } from './types';

const BRAND = {
  bg: '#050510',
  purple: '#9945ff', // Solana purple
  green: '#14f195', // Solana green
  gold: '#ffce6e',
  cyan: '#3bd9ff',
  ink: 'rgba(255,255,255,0.94)',
  dim: 'rgba(255,255,255,0.45)',
  faint: 'rgba(255,255,255,0.16)',
};

const MONO = '"ABC Diatype Semi-Mono", ui-monospace, SFMono-Regular, Menlo, monospace';

export interface CoverOptions {
  getCanvas?: () => HTMLCanvasElement | null;
  /** The opus take — decoded to a waveform for the fallback cover. */
  sourceBlob: Blob;
  facts: ChainFacts;
  durationSec: number;
  cet: string;
  size?: number;
}

export async function captureCover(opts: CoverOptions): Promise<CoverArtifact> {
  const size = opts.size ?? 1080;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable for cover');

  // Best-effort: paint with the brand faces loaded so the caption renders in Semi-Mono.
  try {
    await (document as unknown as { fonts?: { ready?: Promise<unknown> } }).fonts?.ready;
  } catch {
    /* fonts API absent — falls back to monospace */
  }

  const captionH = Math.round(size * 0.165);
  const artH = size - captionH;

  paintBackground(ctx, size, artH);

  let source: CoverArtifact['source'] = 'card';
  const live = opts.getCanvas?.() ?? null;
  if (live && probeCanvas(live)) {
    drawCrystalStill(ctx, live, size, artH);
    source = 'canvas';
  } else {
    const peaks = await safePeaks(opts.sourceBlob);
    if (peaks && peaks.length) {
      drawWaveform(ctx, peaks, size, artH);
      source = 'waveform';
    }
  }

  drawCaption(ctx, size, artH, captionH, opts.facts, opts.durationSec, opts.cet);

  const blob = await canvasToPng(canvas);
  return { blob, mime: 'image/png', ext: 'png', width: size, height: size, source };
}

/* ── painters ──────────────────────────────────────────────────────────────────────────────── */

function paintBackground(ctx: CanvasRenderingContext2D, size: number, artH: number): void {
  ctx.fillStyle = BRAND.bg;
  ctx.fillRect(0, 0, size, size);
  // A soft violet→green radial glow centered in the art area.
  const g = ctx.createRadialGradient(size * 0.5, artH * 0.46, size * 0.04, size * 0.5, artH * 0.46, size * 0.62);
  g.addColorStop(0, 'rgba(153,69,255,0.20)');
  g.addColorStop(0.55, 'rgba(20,241,149,0.06)');
  g.addColorStop(1, 'rgba(5,5,16,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, artH);
}

/** Draw the live canvas into the art area, object-fit: cover (center-cropped). */
function drawCrystalStill(ctx: CanvasRenderingContext2D, src: HTMLCanvasElement, size: number, artH: number): void {
  const sw = src.width;
  const sh = src.height;
  const scale = Math.max(size / sw, artH / sh);
  const dw = sw * scale;
  const dh = sh * scale;
  const dx = (size - dw) / 2;
  const dy = (artH - dh) / 2;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, size, artH);
  ctx.clip();
  try {
    ctx.drawImage(src, dx, dy, dw, dh);
  } catch {
    /* grab failed at draw time — caption strip still renders */
  }
  ctx.restore();
}

/** Mirror-bar waveform across the art area's center line, colored along the Solana axis. */
function drawWaveform(ctx: CanvasRenderingContext2D, peaks: number[], size: number, artH: number): void {
  const cy = artH * 0.5;
  const pad = size * 0.08;
  const usableW = size - pad * 2;
  const n = peaks.length;
  const barW = usableW / n;
  const maxAmp = artH * 0.34;

  const grad = ctx.createLinearGradient(pad, 0, size - pad, 0);
  grad.addColorStop(0, BRAND.purple);
  grad.addColorStop(0.5, BRAND.gold);
  grad.addColorStop(1, BRAND.green);
  ctx.fillStyle = grad;

  for (let i = 0; i < n; i++) {
    const amp = Math.max(2, peaks[i] * maxAmp);
    const x = pad + i * barW;
    const w = Math.max(1, barW * 0.62);
    ctx.fillRect(x, cy - amp, w, amp * 2);
  }
  // A faint baseline.
  ctx.strokeStyle = BRAND.faint;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad, cy);
  ctx.lineTo(size - pad, cy);
  ctx.stroke();
}

function drawCaption(
  ctx: CanvasRenderingContext2D,
  size: number,
  artH: number,
  captionH: number,
  facts: ChainFacts,
  durationSec: number,
  cet: string,
): void {
  // Divider + caption panel.
  ctx.fillStyle = 'rgba(5,5,16,0.86)';
  ctx.fillRect(0, artH, size, captionH);
  ctx.strokeStyle = BRAND.faint;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, artH + 0.5);
  ctx.lineTo(size, artH + 0.5);
  ctx.stroke();

  const padX = size * 0.06;
  const baseY = artH + captionH * 0.42;

  // Wordmark.
  ctx.fillStyle = BRAND.ink;
  ctx.font = `600 ${Math.round(size * 0.036)}px ${MONO}`;
  ctx.textBaseline = 'middle';
  ctx.save();
  // Letter-spaced manually for the brand feel.
  drawTracked(ctx, 'STRATA', padX, baseY, size * 0.012);
  ctx.restore();

  // Live / demo pill at top-right.
  const pillText = facts.live ? '● LIVE' : '○ DEMO';
  ctx.font = `500 ${Math.round(size * 0.018)}px ${MONO}`;
  ctx.fillStyle = facts.live ? BRAND.green : BRAND.dim;
  const pw = ctx.measureText(pillText).width;
  ctx.fillText(pillText, size - padX - pw, baseY);

  // Facts, two muted lines.
  ctx.font = `400 ${Math.round(size * 0.0185)}px ${MONO}`;
  ctx.fillStyle = BRAND.dim;
  const span = facts.live
    ? `EPOCH ${facts.epoch}  ·  SLOTS ${facts.startSlot.toLocaleString('en-US')}–${facts.stopSlot.toLocaleString('en-US')}`
    : `EPOCH ${facts.epoch}  ·  SIMULATED — NOT VERIFIABLE`;
  const line2 = `${facts.key}  ·  ${Math.round(durationSec)}s  ·  ${cet}`;
  const lineY = baseY + captionH * 0.26;
  ctx.fillText(span, padX, lineY);
  ctx.fillText(line2, padX, lineY + captionH * 0.2);
}

/** Render text with a fixed inter-letter gap (canvas has no letter-spacing before recent specs). */
function drawTracked(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, gap: number): void {
  let cursor = x;
  for (const ch of text) {
    ctx.fillText(ch, cursor, y);
    cursor += ctx.measureText(ch).width + gap;
  }
}

/* ── helpers ───────────────────────────────────────────────────────────────────────────────── */

/** True if the candidate canvas has real, non-uniform content (not a cleared WebGL buffer). */
function probeCanvas(src: HTMLCanvasElement): boolean {
  try {
    if (!src.width || !src.height) return false;
    const probe = document.createElement('canvas');
    probe.width = 24;
    probe.height = 24;
    const pctx = probe.getContext('2d', { willReadFrequently: true });
    if (!pctx) return false;
    pctx.drawImage(src, 0, 0, 24, 24);
    const { data } = pctx.getImageData(0, 0, 24, 24);
    let min = 255;
    let max = 0;
    let anyAlpha = false;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] > 8) anyAlpha = true;
      const lum = (data[i] + data[i + 1] + data[i + 2]) / 3;
      if (lum < min) min = lum;
      if (lum > max) max = lum;
    }
    return anyAlpha && max - min > 6; // has pixels and some contrast
  } catch {
    return false;
  }
}

/** Decode the take and reduce it to a normalized peak-per-bucket envelope. */
async function safePeaks(blob: Blob, buckets = 280): Promise<number[] | null> {
  try {
    const buf = await blob.arrayBuffer();
    const Ctx: typeof AudioContext =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ac = new Ctx();
    let audio: AudioBuffer;
    try {
      audio = await ac.decodeAudioData(buf.slice(0));
    } finally {
      void ac.close();
    }
    const ch = audio.getChannelData(0);
    const block = Math.max(1, Math.floor(ch.length / buckets));
    const peaks: number[] = [];
    for (let b = 0; b < buckets; b++) {
      let peak = 0;
      const start = b * block;
      for (let i = 0; i < block && start + i < ch.length; i++) {
        const v = Math.abs(ch[start + i]);
        if (v > peak) peak = v;
      }
      peaks.push(peak);
    }
    let max = 1e-4;
    for (const p of peaks) if (p > max) max = p;
    return peaks.map((p) => p / max);
  } catch {
    return null;
  }
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('cover toBlob failed'))), 'image/png');
  });
}

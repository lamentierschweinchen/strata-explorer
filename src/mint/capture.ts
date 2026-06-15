/**
 * CaptureController — the recording lifecycle, consuming only the engine + data-source public APIs.
 *
 * start():  taps the engine's master recorder and snapshots the chain at that instant.
 * stop():   stops the take, transcodes opus→WAV, snapshots the chain again, reads the engine's
 *           musical state + mix preset, grabs a cover, and assembles a `Moment`.
 *
 * It never starts the engine itself (that needs a user gesture and would make sound play) — the
 * panel ensures the engine is running before calling start(). Type-only imports of engine/source.
 */
import type { AudioEngine } from '../audio/AudioEngine';
import type { SolanaDataSource } from '../data/DataSource';
import type { Moment } from './types';
import { buildChainFacts, detectLive, sampleChain, type ChainSample } from './chainFacts';
import { blobToWav } from './wav';
import { captureCover } from './cover';
import { berlinTimeString, buildTitle } from './metadata';

export class CaptureController {
  private startSample: ChainSample | null = null;
  private startMs = 0;
  private _recording = false;

  constructor(
    private readonly engine: AudioEngine,
    private readonly dataSource: SolanaDataSource,
    private readonly getCanvas?: () => HTMLCanvasElement | null,
  ) {}

  get isRecording(): boolean {
    return this._recording;
  }

  /** Begin a take. Returns false if the engine can't record (not started yet / unsupported). */
  start(): boolean {
    if (this._recording) return false;
    const ok = this.engine.startRecording();
    if (!ok) return false;
    this.startSample = sampleChain(this.dataSource, new Date().toISOString());
    this.startMs = performance.now();
    this._recording = true;
    return true;
  }

  /** Stop, transcode, snapshot facts + preset, grab cover → a Moment (null if nothing recorded). */
  async stop(): Promise<Moment | null> {
    if (!this._recording) return null;
    this._recording = false;

    const stopISO = new Date().toISOString();
    const blob = await this.engine.stopRecording();
    if (!blob || !this.startSample) return null;

    const stopSample = sampleChain(this.dataSource, stopISO);
    const health = this.engine.getHealth();
    const live = detectLive(this.dataSource);
    const facts = buildChainFacts(
      this.startSample,
      stopSample,
      { key: health.key, section: health.section },
      live,
    );

    const wav = await blobToWav(blob);
    const sourceExt = blob.type.includes('ogg') ? 'ogg' : 'webm';
    const stopDate = new Date(stopISO);
    const cet = berlinTimeString(stopDate);
    const durationSec = wav.durationSec || (performance.now() - this.startMs) / 1000;
    const preset = this.engine.exportState();

    const cover = await captureCover({
      getCanvas: this.getCanvas,
      sourceBlob: blob,
      facts,
      durationSec,
      cet,
    });

    return {
      facts,
      preset,
      audio: {
        blob: wav.blob,
        mime: 'audio/wav',
        ext: 'wav',
        durationSec,
        sampleRate: wav.sampleRate,
        channels: wav.channels,
      },
      source: { blob, mime: blob.type || 'audio/webm', ext: sourceExt },
      cover,
      title: buildTitle(facts, cet),
      capturedAtISO: stopISO,
      capturedAtCET: cet,
      durationSec,
    };
  }

  /** Abandon an in-flight take without producing a Moment. */
  async cancel(): Promise<void> {
    if (!this._recording) return;
    this._recording = false;
    await this.engine.stopRecording().catch(() => null);
  }

  /** Seconds since start() (0 when not recording) — for the live timer. */
  elapsedSec(): number {
    return this._recording ? (performance.now() - this.startMs) / 1000 : 0;
  }

  /** The live slot right now (for the recording readout). */
  currentSlot(): number {
    try {
      return this.dataSource.getCurrentSlot();
    } catch {
      return 0;
    }
  }
}

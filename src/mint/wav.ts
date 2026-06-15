/**
 * Transcode the recorder's take (webm/opus, exactly what `engine.stopRecording()` returns) into a
 * real, ownable WAV.
 *
 * WHY WAV, not MP3:
 *  • The source is already lossy opus. Re-encoding lossy→MP3 stacks a second lossy generation
 *    (tandem-coding artifacts) for little size win, and pulls in a heavy wasm encoder.
 *  • WAV is lossless relative to the decoded opus, plays in every player / DAW / marketplace,
 *    and needs ZERO dependencies — we decode via the platform's Web Audio and write the 44-byte
 *    PCM header ourselves. Lean, honest, archival.
 *  • Size (~10 MB/min stereo 44.1k·16-bit) is fine for a 1/1 art piece on pay-once Arweave.
 *
 * The original opus take is kept alongside the WAV in the bundle for provenance ("the exact bytes
 * the engine emitted"). Dependency-free; browser-only (uses AudioContext / Blob).
 */

export interface DecodedWav {
  blob: Blob;
  sampleRate: number;
  channels: number;
  durationSec: number;
}

/** Decode an audio blob to PCM, then re-encode it as a 16-bit little-endian WAV. */
export async function blobToWav(blob: Blob): Promise<DecodedWav> {
  const arrayBuf = await blob.arrayBuffer();
  const Ctx: typeof AudioContext =
    window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx();
  let audio: AudioBuffer;
  try {
    // slice(0) hands decodeAudioData its own copy (it may detach the buffer).
    audio = await ctx.decodeAudioData(arrayBuf.slice(0));
  } finally {
    void ctx.close();
  }
  const wav = encodeWav(audio);
  return {
    blob: new Blob([wav], { type: 'audio/wav' }),
    sampleRate: audio.sampleRate,
    channels: audio.numberOfChannels,
    durationSec: audio.duration,
  };
}

/** Write an AudioBuffer to a canonical 16-bit PCM WAV (RIFF/WAVE). */
function encodeWav(buffer: AudioBuffer): ArrayBuffer {
  const numCh = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const numFrames = buffer.length;
  const bytesPerSample = 2;
  const blockAlign = numCh * bytesPerSample;
  const dataSize = numFrames * blockAlign;

  const out = new ArrayBuffer(44 + dataSize);
  const view = new DataView(out);
  const writeStr = (off: number, s: string): void => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // audio format = PCM
  view.setUint16(22, numCh, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true); // byte rate
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true); // bits per sample
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  const channels: Float32Array[] = [];
  for (let c = 0; c < numCh; c++) channels.push(buffer.getChannelData(c));

  let off = 44;
  for (let i = 0; i < numFrames; i++) {
    for (let c = 0; c < numCh; c++) {
      let s = channels[c][i];
      s = s < -1 ? -1 : s > 1 ? 1 : s; // clamp before quantizing
      view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      off += 2;
    }
  }
  return out;
}

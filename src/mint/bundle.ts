/**
 * Phase 1 deliverable: turn a captured Moment into one downloadable `.zip` — the artist's archival
 * master. Stands entirely alone: no wallet, no chain, no network. Everything an owner needs to play
 * the take, see the cover, read the facts, verify the slots, and re-summon the instrument.
 *
 * Bundle contents:
 *   audio.wav      — lossless master (decoded from the opus take)
 *   cover.png      — the cover (live crystal still, or the waveform of the take)
 *   source.webm    — the exact bytes the engine emitted, for provenance
 *   metadata.json  — the full, honest provenance record (mirrors the on-chain metadata)
 *   preset.json    — the bare mix preset (re-loadable in the studio)
 *   README.txt     — what this is + how to verify + the re-summon link
 *
 * Dependency-free (uses the local zip writer). Browser-only.
 */
import type { Moment } from './types';
import { buildMetadata, buildResummonLink } from './metadata';
import { makeZip, type ZipFile } from './zip';
import { ATTRIBUTION, SITE_URL, explorerSlotUrl, solscanSlotUrl } from './config';

const NAMES = {
  audio: 'audio.wav',
  cover: 'cover.png',
  metadata: 'metadata.json',
  preset: 'preset.json',
  readme: 'README.txt',
} as const;

/** Build the downloadable zip + its filename. The metadata points at the in-zip filenames. */
export async function buildBundle(moment: Moment): Promise<{ blob: Blob; filename: string }> {
  const enc = new TextEncoder();
  const sourceName = `source.${moment.source.ext}`;
  const metadata = buildMetadata(moment, { imageUri: NAMES.cover, animationUri: NAMES.audio });

  const files: ZipFile[] = [
    { name: NAMES.audio, data: await bytes(moment.audio.blob) },
    { name: NAMES.cover, data: await bytes(moment.cover.blob) },
    { name: sourceName, data: await bytes(moment.source.blob) },
    { name: NAMES.metadata, data: enc.encode(JSON.stringify(metadata, null, 2)) },
    { name: NAMES.preset, data: enc.encode(JSON.stringify(moment.preset, null, 2)) },
    { name: NAMES.readme, data: enc.encode(readmeText(moment, sourceName)) },
  ];

  return { blob: makeZip(files, new Date(moment.capturedAtISO)), filename: bundleName(moment) };
}

/** `strata-moment-epoch742-slot281234712.zip` (or a demo/time variant when not live). */
export function bundleName(moment: Moment): string {
  const f = moment.facts;
  const tail = f.live ? `slot${f.stopSlot}` : `demo-${moment.capturedAtISO.slice(0, 19).replace(/[:T]/g, '')}`;
  return `strata-moment-epoch${f.epoch}-${tail}.zip`;
}

/** Trigger a browser download of a blob. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke after the click has had a chance to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

async function bytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

function readmeText(moment: Moment, sourceName: string): string {
  const f = moment.facts;
  const lines: string[] = [];
  lines.push('STRATA — a minute of Solana, scored by itself, and kept forever.');
  lines.push('');
  lines.push(moment.title);
  lines.push('');
  lines.push('WHAT THIS IS');
  lines.push('  A real recording of the Solana network, scored live by the STRATA engine.');
  lines.push('  Every sound is a real on-chain event — if you can hear it, it happened.');
  lines.push('');
  lines.push('THE FACTS');
  lines.push(`  Captured (UTC) : ${moment.capturedAtISO}`);
  lines.push(`  Captured (local): ${moment.capturedAtCET}`);
  lines.push(`  Epoch          : ${f.epoch}`);
  if (f.live) {
    lines.push(`  Slot range     : ${f.startSlot.toLocaleString('en-US')} → ${f.stopSlot.toLocaleString('en-US')} (${f.slotSpan} slots)`);
    lines.push(`  Finalized slot : ${f.rootSlot.toLocaleString('en-US')}`);
  } else {
    lines.push('  Slot range     : SIMULATED (demo data — not independently verifiable)');
  }
  lines.push(`  Key            : ${f.key}`);
  lines.push(`  Section        : ${f.section}`);
  lines.push(`  Duration       : ${Math.round(moment.durationSec)}s`);
  lines.push(`  Data source    : ${f.live ? 'live · mainnet-beta' : 'demo (simulated)'}`);
  lines.push('');
  if (f.live) {
    lines.push('VERIFY ON SOLANA');
    lines.push('  These slots are real. Confirm the blocks exist:');
    lines.push(`    start  ${solscanSlotUrl(f.startSlot)}`);
    lines.push(`    stop   ${solscanSlotUrl(f.stopSlot)}`);
    lines.push(`    (explorer: ${explorerSlotUrl(f.startSlot)} )`);
    lines.push('');
  }
  lines.push('RE-SUMMON THE INSTRUMENT');
  lines.push('  Open this exact mix, live on the current chain:');
  lines.push(`    ${buildResummonLink(moment.preset)}`);
  lines.push('');
  lines.push('FILES');
  lines.push(`  ${NAMES.audio}     lossless master (decoded from ${sourceName})`);
  lines.push(`  ${NAMES.cover}     the cover (${moment.cover.source})`);
  lines.push(`  ${sourceName}   the exact opus take the engine emitted`);
  lines.push(`  ${NAMES.metadata}  full provenance (mirrors the on-chain metadata)`);
  lines.push(`  ${NAMES.preset}    the bare mix preset`);
  lines.push('');
  lines.push(`${ATTRIBUTION}`);
  lines.push(SITE_URL);
  return lines.join('\n');
}

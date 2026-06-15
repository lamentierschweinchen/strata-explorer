/**
 * END-TO-END DEVNET PROOF — run with: `npx tsx src/mint/scripts/proveDevnet.ts`
 *
 * Exercises the exact Phase-2 + Phase-3 core the browser uses (uploadMoment + mintMoment), but
 * driven by a gitignored devnet keypair instead of a wallet, so it runs headless. It:
 *   1. loads/creates a devnet keypair (gitignored — NEVER a mainnet secret),
 *   2. ensures it has devnet SOL (airdrops, or tells you to `solana airdrop`),
 *   3. builds a SAMPLE moment — synthetic tone + a generated branded PNG — with REAL mainnet chain
 *      facts (so the verify links resolve); the artifact labels itself a proof (honest),
 *   4. funds Irys (devnet) and uploads cover + audio + metadata to Arweave,
 *   5. mints a Metaplex Core NFT on DEVNET,
 *   6. prints the explorer link.
 *
 * Security: this script only ever touches DEVNET and a local gitignored key. Mainnet minting is a
 * browser-wallet-only path; no key is ever embedded for it.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { mplCore } from '@metaplex-foundation/mpl-core';
import { irysUploader } from '@metaplex-foundation/umi-uploader-irys';
import {
  createSignerFromKeypair,
  signerIdentity,
  sol,
  type Keypair,
  type SolAmount,
  type Umi,
} from '@metaplex-foundation/umi';
import { uploadMoment } from '../storage';
import { mintMoment } from '../mint';
import { networkFor } from '../config';
import { berlinTimeString, buildTitle } from '../metadata';
import type { ChainFacts, Moment } from '../types';

const SECRET_DIR = path.resolve('src/mint/scripts/.secrets');
const KEYPAIR_FILE = process.env.MINT_DEVNET_KEYPAIR || path.join(SECRET_DIR, 'devnet.json');

/* ── keypair (gitignored) ──────────────────────────────────────────────────────────────────── */

function loadOrCreateKeypair(umi: Umi): Keypair {
  if (fs.existsSync(KEYPAIR_FILE)) {
    const secret = Uint8Array.from(JSON.parse(fs.readFileSync(KEYPAIR_FILE, 'utf8')) as number[]);
    return umi.eddsa.createKeypairFromSecretKey(secret);
  }
  const kp = umi.eddsa.generateKeypair();
  fs.mkdirSync(SECRET_DIR, { recursive: true });
  fs.writeFileSync(KEYPAIR_FILE, JSON.stringify(Array.from(kp.secretKey)));
  console.log(`• generated devnet keypair → ${KEYPAIR_FILE} (gitignored)`);
  return kp;
}

/* ── sample artifact bytes ─────────────────────────────────────────────────────────────────── */

/** A short stereo-ish sine as a 16-bit WAV (stand-in for the engine's take). */
function makeWav(seconds = 2, sr = 48000, freq = 220): Uint8Array<ArrayBuffer> {
  const n = Math.floor(seconds * sr);
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * freq * i) / sr) * 0.5 * 0x7fff), 44 + i * 2);
  return Uint8Array.from(buf);
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
/** A branded purple→green gradient PNG (Solana axis), generated with node zlib — no deps. */
function makePng(w = 640, h = 640): Uint8Array<ArrayBuffer> {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  let o = 0;
  for (let y = 0; y < h; y++) {
    raw[o++] = 0; // filter: none
    for (let x = 0; x < w; x++) {
      const t = (x / w + y / h) / 2;
      raw[o++] = Math.round(153 + (20 - 153) * t);
      raw[o++] = Math.round(69 + (241 - 69) * t);
      raw[o++] = Math.round(255 + (149 - 255) * t);
      raw[o++] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const png = Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
  return Uint8Array.from(png);
}

/* ── real chain facts (mainnet — what STRATA captures) ─────────────────────────────────────── */

async function fetchMainnetFacts(): Promise<ChainFacts> {
  const rpc = process.env.MINT_FACTS_RPC || 'https://api.mainnet-beta.solana.com';
  const call = async <T>(method: string, params: unknown[] = []): Promise<T> => {
    const r = await fetch(rpc, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    return (await r.json() as { result: T }).result;
  };
  const nowISO = new Date().toISOString();
  try {
    const e = await call<{ epoch: number; slotIndex: number; slotsInEpoch: number; absoluteSlot: number }>('getEpochInfo');
    const stop = e.absoluteSlot;
    const start = stop - 150; // a ~60s window
    return {
      startSlot: start, stopSlot: stop, rootSlot: stop - 32, slotSpan: stop - start,
      epoch: e.epoch, slotIndex: e.slotIndex, slotsInEpoch: e.slotsInEpoch, leader: null,
      key: 'E Dorian', section: 'GROOVE', factCluster: 'mainnet-beta', live: true,
      startISO: nowISO, stopISO: nowISO,
    };
  } catch (err) {
    console.warn('• mainnet facts fetch failed; using static placeholder facts (still marked live=false)');
    return {
      startSlot: 0, stopSlot: 0, rootSlot: 0, slotSpan: 0, epoch: 0, slotIndex: 0, slotsInEpoch: 432000,
      leader: null, key: 'E Dorian', section: 'GROOVE', factCluster: 'unknown', live: false,
      startISO: nowISO, stopISO: nowISO,
    };
  }
}

/* ── irys uploader (the irys-specific methods umi.uploader exposes) ─────────────────────────── */

interface IrysUploader {
  getBalance(): Promise<SolAmount>;
  fund(amount: SolAmount, skipBalanceCheck: boolean): Promise<void>;
  getUploadPriceFromBytes(bytes: number): Promise<SolAmount>;
}

async function ensureIrysFunded(umi: Umi, bytes: number): Promise<void> {
  const up = umi.uploader as unknown as IrysUploader;
  const price = await up.getUploadPriceFromBytes(bytes);
  const balance = await up.getBalance();
  console.log(`• irys balance ${fmt(balance)} SOL, est. price ${fmt(price)} SOL`);
  if (balance.basisPoints < price.basisPoints) {
    const top = sol(0.02); // devnet is cheap; a small top-up covers several MB
    console.log(`• funding irys node with ${fmt(top)} SOL…`);
    await up.fund(top, false);
  }
}

const fmt = (a: SolAmount): string => (Number(a.basisPoints) / 1e9).toFixed(6);

/* ── main ──────────────────────────────────────────────────────────────────────────────────── */

async function main(): Promise<void> {
  const net = networkFor('devnet');
  // Allow a devnet RPC override (e.g. a Helius devnet URL with a reliable faucet) without baking
  // any key into source — passed via env at run time.
  const rpcUrl = process.env.MINT_DEVNET_RPC || net.rpcUrl;
  console.log(`\nSTRATA devnet mint proof\n  rpc:  ${rpcUrl.replace(/api-key=[^&]+/, 'api-key=***')}\n  irys: ${net.irysAddress}\n`);

  const umi = createUmi(rpcUrl).use(mplCore()).use(irysUploader({ address: net.irysAddress }));
  const keypair = loadOrCreateKeypair(umi);
  umi.use(signerIdentity(createSignerFromKeypair(umi, keypair)));
  console.log(`• payer: ${keypair.publicKey}`);

  // Ensure devnet SOL.
  let balance = await umi.rpc.getBalance(keypair.publicKey);
  console.log(`• balance: ${fmt(balance)} SOL`);
  if (balance.basisPoints < sol(0.3).basisPoints) {
    console.log('• requesting devnet airdrop (2 SOL)…');
    try {
      await umi.rpc.airdrop(keypair.publicKey, sol(2));
      balance = await umi.rpc.getBalance(keypair.publicKey);
      console.log(`• balance after airdrop: ${fmt(balance)} SOL`);
    } catch (e) {
      console.warn('• airdrop failed (rate limit?). Fund manually then re-run:');
      console.warn(`    solana airdrop 2 ${keypair.publicKey} --url devnet`);
    }
    if (balance.basisPoints < sol(0.05).basisPoints) {
      throw new Error(`Insufficient devnet SOL. Airdrop to ${keypair.publicKey} and re-run.`);
    }
  }

  // Build the sample moment with REAL mainnet facts.
  const facts = await fetchMainnetFacts();
  const wav = makeWav();
  const png = makePng();
  const cet = berlinTimeString(new Date(facts.stopISO));
  const moment: Moment = {
    facts,
    preset: { v: 1, name: 'STRATA · proof', config: {}, strips: {} },
    audio: { blob: new Blob([wav], { type: 'audio/wav' }), mime: 'audio/wav', ext: 'wav', durationSec: 2, sampleRate: 48000, channels: 1 },
    source: { blob: new Blob([wav], { type: 'audio/wav' }), mime: 'audio/wav', ext: 'wav' },
    cover: { blob: new Blob([png], { type: 'image/png' }), mime: 'image/png', ext: 'png', width: 640, height: 640, source: 'card' },
    title: buildTitle(facts, cet),
    capturedAtISO: facts.stopISO,
    capturedAtCET: cet,
    durationSec: 2,
  };

  // Fund Irys for the total payload, then upload.
  await ensureIrysFunded(umi, wav.length + png.length + 4096);
  console.log('• uploading to Arweave via Irys…');
  const uris = await uploadMoment(moment, umi, {
    onProgress: (m) => console.log(`   ${m}`),
    metaTransform: (md) => ({
      ...md,
      name: `${md.name} · DEVNET PROOF`,
      description: `[STRATA devnet mint pipeline proof — sample tone; the chain facts/slots are real and verifiable.] ${md.description}`,
    }),
  });
  console.log(`• image:    ${uris.imageUri}`);
  console.log(`• audio:    ${uris.animationUri}`);
  console.log(`• metadata: ${uris.metadataUri}`);

  // Mint on devnet.
  console.log('• minting Metaplex Core asset on devnet…');
  const result = await mintMoment(moment, uris, umi, 'devnet');

  console.log('\n✓ MINTED ON DEVNET');
  console.log(`  asset:     ${result.asset}`);
  console.log(`  signature: ${result.signature}`);
  console.log(`  explorer:  ${result.explorerUrl}`);
  console.log(`  tx:        ${result.txUrl}\n`);

  // Persist the proof so the explorer link is captured even when run unattended.
  const stamp = new Date().toISOString();
  const doc = `# STRATA — devnet mint proof

Generated by \`src/mint/scripts/proveDevnet.ts\` at ${stamp}.

A real Metaplex Core NFT minted on **devnet** through the exact Phase-2 (Irys/Arweave) + Phase-3
(mpl-core) code the browser uses. The artifact is a labeled proof (sample tone) with **real,
verifiable mainnet chain facts**.

| | |
|---|---|
| Asset (NFT) | \`${result.asset}\` |
| Signature | \`${result.signature}\` |
| Cluster | ${result.cluster} |
| **Explorer (NFT)** | ${result.explorerUrl} |
| Mint transaction | ${result.txUrl} |
| Cover (Arweave) | ${result.uris.imageUri} |
| Audio (Arweave) | ${result.uris.animationUri} |
| Metadata (Arweave) | ${result.uris.metadataUri} |
`;
  fs.writeFileSync(path.resolve('DEVNET-PROOF.md'), doc);
  console.log('• wrote DEVNET-PROOF.md');

  // Machine-readable line for tooling.
  console.log('RESULT_JSON ' + JSON.stringify(result));
}

main().catch((e) => {
  console.error('\n✗ proof failed:', e);
  process.exit(1);
});

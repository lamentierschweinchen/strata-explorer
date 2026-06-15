/**
 * Phase 2 — permanent storage on Arweave via Irys (pay-once, on-theme: "kept forever").
 *
 * Environment-agnostic: it takes a fully-built `umi` (browser builds it with a wallet identity +
 * the irys web uploader; the devnet proof script builds it with a keypair + the node uploader) and
 * uploads the cover, the audio, and finally the metadata JSON (which references the first two).
 *
 * This module lives behind the dynamic `mintFlow` import, so `@metaplex-foundation/umi` only loads
 * on the mint surface.
 */
import { createGenericFile, type Umi } from '@metaplex-foundation/umi';
import type { Moment, UploadedUris } from './types';
import { buildMetadata, type StrataMetadata } from './metadata';

export type Progress = (msg: string) => void;

export interface UploadOptions {
  onProgress?: Progress;
  /** Optional last-mile edit of the metadata before upload (e.g. the devnet proof labels itself). */
  metaTransform?: (m: StrataMetadata) => StrataMetadata;
}

/** Upload cover → audio → metadata to Arweave. Returns the three gateway URIs. */
export async function uploadMoment(moment: Moment, umi: Umi, opts: UploadOptions = {}): Promise<UploadedUris> {
  const onProgress = opts.onProgress;
  onProgress?.('Uploading cover…');
  const coverFile = createGenericFile(
    new Uint8Array(await moment.cover.blob.arrayBuffer()),
    'cover.png',
    { contentType: moment.cover.mime, tags: [{ name: 'Content-Type', value: moment.cover.mime }] },
  );
  const [imageUri] = await umi.uploader.upload([coverFile]);

  onProgress?.('Uploading audio (WAV)…');
  const audioFile = createGenericFile(
    new Uint8Array(await moment.audio.blob.arrayBuffer()),
    `audio.${moment.audio.ext}`,
    { contentType: moment.audio.mime, tags: [{ name: 'Content-Type', value: moment.audio.mime }] },
  );
  const [animationUri] = await umi.uploader.upload([audioFile]);

  onProgress?.('Uploading metadata…');
  const base = buildMetadata(moment, { imageUri, animationUri });
  const metadata = opts.metaTransform ? opts.metaTransform(base) : base;
  const metadataUri = await umi.uploader.uploadJson(metadata);

  return { imageUri, animationUri, metadataUri };
}

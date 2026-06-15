/**
 * Phase 3 — mint the moment as a Metaplex Core NFT (the current lightweight single-account standard;
 * legacy Token Metadata is the fallback if ever needed). `animation_url` = the audio, `image` = the
 * cover, `attributes` = the verifiable chain facts (all already written into the uploaded metadata
 * JSON by storage.ts).
 *
 * Environment-agnostic: takes a fully-built `umi` (must already have `mplCore()` registered and an
 * identity set). Behind the dynamic `mintFlow` import — mpl-core loads only on the mint surface.
 */
import { create } from '@metaplex-foundation/mpl-core';
import { generateSigner, type Umi } from '@metaplex-foundation/umi';
import { base58 } from '@metaplex-foundation/umi/serializers';
import type { Moment, MintResult, UploadedUris } from './types';
import { buildOnChainName } from './metadata';
import { assetExplorerUrl, txExplorerUrl, type MintCluster } from './config';

/** Create the Core asset pointing at the uploaded metadata. Returns the asset + signature + links. */
export async function mintMoment(
  moment: Moment,
  uris: UploadedUris,
  umi: Umi,
  cluster: MintCluster,
): Promise<MintResult> {
  const asset = generateSigner(umi);

  const tx = await create(umi, {
    asset,
    name: buildOnChainName(moment.facts),
    uri: uris.metadataUri,
  }).sendAndConfirm(umi);

  const signature = base58.deserialize(tx.signature)[0];
  const address = String(asset.publicKey);

  return {
    asset: address,
    signature,
    cluster,
    explorerUrl: assetExplorerUrl(address, cluster),
    txUrl: txExplorerUrl(signature, cluster),
    uris,
  };
}

/**
 * The metadata — the soul of the artifact, and where the honesty rule lives.
 *
 * Every fact written here is REAL: the slot range, epoch, finalized slot, timestamp, and key are
 * sampled live from the chain at capture time (see chainFacts.ts) and never approximated. If the
 * capture ran against demo data, the metadata says so plainly and the verify links are withheld —
 * we never claim a moment is verifiable when it isn't.
 *
 * The same builder produces both the local bundle's `metadata.json` (image/animation point at the
 * in-zip filenames) and the on-chain JSON (they point at Arweave URIs) — only the `uris` differ.
 *
 * Dependency-free. `StudioPreset` is a type-only import.
 */
import type { StudioPreset } from '../audio/AudioEngine';
import type { ChainFacts, Moment } from './types';
import { b64urlEncode } from './b64url';
import {
  ATTRIBUTION,
  SITE_URL,
  SPEC,
  STUDIO_BASE,
  SYMBOL,
  explorerSlotUrl,
  solscanSlotUrl,
} from './config';

export interface NftAttribute {
  trait_type: string;
  value: string | number;
}

/** Standard NFT metadata + a `strata` block carrying the preset, provenance, and verify hints. */
export interface StrataMetadata {
  name: string;
  symbol: string;
  description: string;
  image: string;
  animation_url: string;
  external_url: string;
  attributes: NftAttribute[];
  properties: {
    category: 'audio';
    files: Array<{ uri: string; type: string }>;
  };
  strata: {
    spec: string;
    live: boolean;
    capturedAtISO: string;
    capturedAtCET: string;
    durationSec: number;
    facts: ChainFacts;
    /** The exact mix the engine was running — the re-summonable "instrument". */
    preset: StudioPreset;
    /** One-click: re-open this instrument LIVE on the current chain. */
    resummon: string;
    verify: VerifyHint;
    attribution: string;
  };
}

interface VerifyHint {
  note: string;
  startSlotSolscan?: string;
  stopSlotSolscan?: string;
  startSlotExplorer?: string;
  stopSlotExplorer?: string;
}

/** Europe/Berlin wall-clock with its real tz abbreviation (CET in winter, CEST in summer). */
export function berlinTimeString(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZoneName: 'short',
  }).formatToParts(d);
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? '';
  const tz = get('timeZoneName') || 'CET';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')} ${tz}`;
}

/** Full, descriptive title for the metadata `name` (the slot range + epoch + local time). */
export function buildTitle(facts: ChainFacts, cet: string): string {
  const span = `${facts.startSlot.toLocaleString('en-US')}–${facts.stopSlot.toLocaleString('en-US')}`;
  const tag = facts.live ? '' : ' (demo)';
  return `STRATA · Epoch ${facts.epoch} · slots ${span} · ${cet}${tag}`;
}

/** Short on-chain asset name (kept compact; the full title lives in the metadata JSON). */
export function buildOnChainName(facts: ChainFacts): string {
  const name = `STRATA · Epoch ${facts.epoch}`;
  return name.length <= 32 ? name : name.slice(0, 32);
}

/** A `#p=` link that re-opens this exact mix in the live studio. */
export function buildResummonLink(preset: StudioPreset): string {
  return `${STUDIO_BASE}#p=${b64urlEncode(JSON.stringify(preset))}`;
}

function buildDescription(facts: ChainFacts): string {
  if (!facts.live) {
    return (
      'A minute of Solana, scored by itself. ⚠ This capture was made against DEMO data: the ' +
      'slot numbers are illustrative, not on-chain facts, and are NOT independently verifiable. ' +
      'The embedded mix preset re-summons the instrument live at ' +
      `${SITE_URL}. — ${ATTRIBUTION}`
    );
  }
  const span = `${facts.startSlot.toLocaleString('en-US')}–${facts.stopSlot.toLocaleString('en-US')}`;
  return (
    'A minute of Solana, scored by itself, and kept forever. This is a real recording of the ' +
    `network across slots ${span} in epoch ${facts.epoch}, captured live and scored in real time. ` +
    'Every sound is a real on-chain event — if you can hear it, it happened. The slots and epoch ' +
    'are facts on Solana mainnet-beta; verify them at the links in this metadata. The embedded mix ' +
    `preset re-summons the exact instrument that heard this moment, live, at ${SITE_URL}. — ${ATTRIBUTION}`
  );
}

function buildAttributes(m: Moment): NftAttribute[] {
  const f = m.facts;
  const attrs: NftAttribute[] = [
    { trait_type: 'Epoch', value: f.epoch },
    { trait_type: 'Start slot', value: f.startSlot },
    { trait_type: 'Stop slot', value: f.stopSlot },
    { trait_type: 'Finalized slot', value: f.rootSlot },
    { trait_type: 'Slot span', value: f.slotSpan },
    { trait_type: 'Key', value: f.key },
    { trait_type: 'Section', value: f.section },
    { trait_type: 'Duration (s)', value: Math.round(m.durationSec) },
    { trait_type: 'Captured (UTC)', value: m.capturedAtISO },
    { trait_type: 'Captured (local)', value: m.capturedAtCET },
    { trait_type: 'Data source', value: f.live ? 'live · mainnet-beta' : 'demo (simulated)' },
    { trait_type: 'Cover', value: m.cover.source },
  ];
  return attrs;
}

function buildVerify(facts: ChainFacts): VerifyHint {
  if (!facts.live) {
    return {
      note: 'Captured against demo data — slots are illustrative and not verifiable on-chain.',
    };
  }
  return {
    note:
      'These slots are real on Solana mainnet-beta. Open the links to confirm the blocks exist ' +
      'and bracket the recording window. (Solscan / Solana Explorer.)',
    startSlotSolscan: solscanSlotUrl(facts.startSlot),
    stopSlotSolscan: solscanSlotUrl(facts.stopSlot),
    startSlotExplorer: explorerSlotUrl(facts.startSlot),
    stopSlotExplorer: explorerSlotUrl(facts.stopSlot),
  };
}

/**
 * Build the full metadata object. Pass the URIs the `image` / `animation_url` should point at:
 *  • local bundle  → relative filenames ({ imageUri: 'cover.png', animationUri: 'audio.wav' })
 *  • on-chain mint → Arweave gateway URIs returned by Irys.
 */
export function buildMetadata(
  m: Moment,
  uris: { imageUri: string; animationUri: string },
): StrataMetadata {
  return {
    name: m.title,
    symbol: SYMBOL,
    description: buildDescription(m.facts),
    image: uris.imageUri,
    animation_url: uris.animationUri,
    external_url: SITE_URL,
    attributes: buildAttributes(m),
    properties: {
      category: 'audio',
      files: [
        { uri: uris.animationUri, type: m.audio.mime },
        { uri: uris.imageUri, type: m.cover.mime },
      ],
    },
    strata: {
      spec: SPEC,
      live: m.facts.live,
      capturedAtISO: m.capturedAtISO,
      capturedAtCET: m.capturedAtCET,
      durationSec: m.durationSec,
      facts: m.facts,
      preset: m.preset,
      resummon: buildResummonLink(m.preset),
      verify: buildVerify(m.facts),
      attribution: ATTRIBUTION,
    },
  };
}

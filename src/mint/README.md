# `src/mint/` — Mint a Moment

> **A minute of Solana, scored by itself, and kept forever.**

Capture a real, timestamped stretch of the chain — the sound the STRATA engine actually made +
a cover + the chain facts — and keep it as a verifiable Metaplex Core NFT whose metadata records
the **actual slots / epoch / timestamp**, so the moment it claims to be is independently checkable
on Solana. The honesty rule — *if you can hear it, it happened* — extended into ownership.

This module **consumes public APIs only**. It never modifies the audio engine, the Three.js scene,
or the data source. Everything it imports from the art is a **type-only** import (erased at
compile). The art bundle (`vite.config.ts` → `main` / `studio`) stays **byte-identical**.

---

## The three phases

1. **Capture → artifact (no chain).** Record via the engine, snapshot the real chain facts +
   preset, grab a cover, transcode opus→WAV, write `metadata.json`, download a `.zip`. Stands alone.
2. **Permanent storage.** Upload cover + audio + metadata to **Arweave via Irys** (pay-once),
   wallet-connected.
3. **Mint.** **Metaplex Core** (`create`) via **Umi** — `animation_url` = audio, `image` = cover,
   `attributes` = the verifiable chain facts. **Devnet by default; mainnet gated** behind a flag +
   a typed confirm. No private key is ever embedded; mainnet always signs through the wallet.

---

## Module layout

| File | Role | Loads |
|------|------|-------|
| `mountMint.ts` | **The frozen mount seam.** `mountMint(opts)` → `{ destroy }`. | art→here (dynamic) |
| `MintPanel.ts` | The capture/preview/download UI (vanilla DOM). | mint chunk |
| `capture.ts` | `CaptureController`: REC/STOP → a `Moment` (consumes engine + data source). | mint chunk |
| `chainFacts.ts` | Snapshot real slot range / epoch / key; `detectLive()` (honesty). | mint chunk |
| `wav.ts` | opus/webm → **lossless WAV** (Web Audio decode + WAV header). Zero deps. | mint chunk |
| `cover.ts` | Cover PNG: live crystal still (validated) or the **waveform of the take**. | mint chunk |
| `metadata.ts` | The honest `metadata.json` builder + re-summon link. | mint chunk |
| `zip.ts` | Dependency-free STORE-method ZIP writer. | mint chunk |
| `bundle.ts` | Assemble + download the `.zip` (Phase 1). | mint chunk |
| `config.ts` | Networks (devnet default / mainnet gated), explorer + verify links, attribution. | both |
| `types.ts` | `Moment`, `ChainFacts`, `MintResult`, … (type-only). | — |
| `b64url.ts` | URL-safe base64 (byte-compatible with the studio's `#p=` reader). | mint chunk |
| `mintFlow.ts` | **Phase 2 + 3 UI** — wallet → upload → mint. **The heavy-deps boundary.** | mintFlow chunk |
| `wallet.ts` | Browser wallet connect (Phantom/Solflare/Backpack) → a umi. | mintFlow chunk |
| `storage.ts` | `uploadMoment(moment, umi)` → Arweave URIs (Irys). | mintFlow chunk |
| `mint.ts` | `mintMoment(moment, uris, umi, cluster)` → Core NFT. | mintFlow chunk |
| `polyfill.ts` | Self-contained Buffer/global shim for the chain deps. | mintFlow chunk |
| `testSources.ts` | Test-only data sources (`RpcLiveSource`, `DemoSource`). **Never imported by the art.** | mint test |
| `standalone.ts` | Owned test entry for `mint.html`. | mint test |
| `scripts/proveDevnet.ts` | Headless end-to-end **devnet proof** (gitignored keypair). | node |

---

## The mount seam (frozen)

```ts
export function mountMint(opts: {
  engine: AudioEngine;                              // shared chain-reactive engine
  dataSource: SolanaDataSource;                     // live (or demo) chain facts
  getCanvas?: () => HTMLCanvasElement | null;       // for the cover still (optional)
  container: HTMLElement;                           // where the panel mounts
  onClose?: () => void;                             // optional close affordance
}): { destroy(): void }
```

### How the coordinator wires it (one line, into the studio/dj path)

```ts
const { mountMint } = await import('./mint/mountMint');           // ← code-split boundary
const handle = mountMint({
  engine,                                                         // the shared AudioEngine
  dataSource,                                                     // the live SolanaDataSource
  getCanvas: () => document.querySelector('canvas'),             // the art canvas (dj/main)
  container: someDrawerEl,
});
// …later: handle.destroy()
```

That dynamic import is the only integration in app code. **Plus one build-config line** (see
*Browser build* below) — the standard Node-polyfill plugin every Solana+Vite app needs for Irys.

---

## Audio format: **WAV** (and why)

The recorder returns **webm/opus** (already lossy). We ship **WAV**:

- **No second lossy generation.** Re-encoding opus→MP3 stacks tandem-coding artifacts for little
  size win and pulls in a heavy wasm encoder. WAV is **lossless relative to the decoded opus**.
- **Zero dependencies.** We decode with the platform's Web Audio and write the 44-byte PCM header
  ourselves (`wav.ts`). Lean — fits a lean art repo.
- **Universal + archival.** Every player, DAW, and marketplace plays WAV.
- **Size is fine for a 1/1** (~10 MB/min) on pay-once Arweave.

The original opus take is kept in the bundle as `source.webm` for provenance ("the exact bytes the
engine emitted"). *Trade-off:* WAV is bigger than MP3; if open-edition scale ever makes Arweave cost
matter, add an MP3/Opus rendition then — the seam supports adding a format without touching capture.

---

## Honesty (the soul)

- The metadata records the **real** `startSlot → stopSlot`, `epoch`, finalized slot, ISO + CET
  timestamp, and key — sampled live at capture (`chainFacts.ts`). Never fabricated.
- `detectLive()` distinguishes a real mainnet source from demo data. **Demo captures are clearly
  marked SIMULATED** and their verify links are withheld — we never claim verifiability we don't have.
- Verify hints link the start/stop slots to **Solscan / Solana Explorer** (mainnet), where anyone
  can confirm the blocks exist and bracket the recording window.
- The embedded **preset** + a `#p=` **re-summon link** let the holder re-open the exact instrument,
  live, at exploresolana.art.

---

## Dependencies (all dynamically imported → code-split)

`@metaplex-foundation/umi`, `umi-bundle-defaults`, `mpl-core`, `umi-uploader-irys`,
`umi-signer-wallet-adapters`, `@solana/wallet-adapter-{base,phantom,solflare,backpack}`,
`@solana/web3.js`, `buffer`. Dev-only: `tsx`, `vite-plugin-node-polyfills`.

**Proof of code-split** (`vite build --config vite.mint.config.ts`):

```
assets/mint-*.js        34 KB   ← Phase 1 panel/capture/wav/cover/zip (loads when panel opens)
assets/mintFlow-*.js   2.9 MB   ← ALL chain deps (umi/mpl-core/wallet/irys/web3) — loads on "mint"
assets/AudioEngine-*.js 297 KB  ← byte-identical shared chunk
```

The committed art build (`vite.config.ts`, no mint input) is **byte-identical** to before this
work — same chunk hashes for `main`, `studio`, `StudioDesk`, `defaultMix`, `AudioEngine`.

---

## Browser build (the one integration caveat)

Irys/web3 import Node built-ins (`stream`, `crypto`, …). A Vite browser build needs the standard
Node-polyfill plugin. My owned **`vite.mint.config.ts`** adds it for the test surface. When the
coordinator ships the in-app mint, add the same to `vite.config.ts`:

```ts
import { nodePolyfills } from 'vite-plugin-node-polyfills';
plugins: [nodePolyfills({ globals: { Buffer: true, global: true, process: true } })],
```

This is the only art-build change integration requires; it's expected for any Solana+Vite dApp.

---

## Config / env vars

| Var | Default | Meaning |
|-----|---------|---------|
| `VITE_MINT_RPC_DEVNET` | `https://api.devnet.solana.com` | devnet RPC |
| `VITE_MINT_RPC_MAINNET` | `https://api.mainnet-beta.solana.com` | mainnet RPC (set a provider URL for real mints) |
| `VITE_MINT_IRYS_DEVNET` | `https://devnet.irys.xyz` | Irys devnet node |
| `VITE_MINT_IRYS_MAINNET` | `https://uploader.irys.xyz` | Irys mainnet node |
| `VITE_MINT_ALLOW_MAINNET` | `false` | must be `true` to enable the mainnet option (UI still requires a typed confirm) |

---

## Artist UX flow

1. Open the mint panel (the speaker/mixer surface, or `/mint.html` in dev).
2. **REC** (manual, or a 30/60/90 s window) → **STOP**. The live slot counter ticks while recording.
3. Preview: cover, the verifiable facts, a playable WAV. **Download bundle (.zip)** — done, even
   with no wallet.
4. *Optional* **Continue to permanent mint →**: pick DEVNET (default), connect a wallet, **Store on
   Arweave & mint**. Get the explorer link.
5. Mainnet: only if enabled — pick MAINNET, type `MAINNET` to confirm, then mint with real SOL.

---

## Devnet proof

Headless end-to-end (gitignored keypair, never a mainnet secret):

```bash
npx tsx src/mint/scripts/proveDevnet.ts          # uses public devnet faucet
MINT_DEVNET_RPC="https://devnet.helius-rpc.com/?api-key=…" npx tsx src/mint/scripts/proveDevnet.ts
```

It airdrops devnet SOL (or tells you to `solana airdrop`), funds Irys, uploads cover+audio+metadata,
and mints a Core NFT on devnet — printing the explorer link. The artifact labels itself a *proof*
(sample tone), but its chain facts are real and verifiable.

**Latest devnet mint:** _see DEVNET-PROOF.md (written by the proof run)._

---

## What remains for mainnet

- Flip `VITE_MINT_ALLOW_MAINNET=true` + set a real `VITE_MINT_RPC_MAINNET` (provider URL).
- Mainnet Irys funding (real SOL) — confirm the cost-estimate/UX with the artist.
- A real wallet signing test on mainnet-beta (devnet is proven; mainnet is the same code path).
- Optional: a collection (group the 1/1s), royalty config, and a hosted player for marketplaces
  that don't render `animation_url` audio inline.

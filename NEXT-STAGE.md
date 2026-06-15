# NEXT STAGE — STRATA as collectible: a recording of the chain that the chain can verify

*Scoped plan for turning the studio into a producer of ownable artifacts. Grounded in what
already exists. Post-premiere, June 2026.*

---

## The idea, sharpened

STRATA is **live** — it has no fixed form; it is different every second because the chain
is. An NFT is **owned and fixed**. The honest reconciliation, and the one that's uniquely
ours:

> **A minute of Solana, scored by itself, and kept forever.**

Each artifact is a real, timestamped capture of a specific stretch of the chain's history,
rendered as sound and image. The metadata records the actual slots, the epoch, the
timestamp, the key. That makes it **verifiable**: the moment it claims to be is a real
moment on Solana, and Solana itself is the witness. It is not "an audio file" — it is a
*certified recording of a piece of the chain's history*. The honesty rule ("if you can hear
it, it happened") extended into ownership.

**Recommended form: the fossil, with the instrument embedded.** The artifact is the
recording (an ownable, playable file). Its metadata also carries the mix preset + a link
back to exploresolana.art, so the holder can re-summon that same instrument *live* on the
current chain. You own the moment **and** the lens that heard it.

The alternative (the NFT *is* the live preset, replayed forever) is gorgeous but fragile:
it depends on our site staying up and complicates permanence. Keep it as the embedded bonus,
not the primary artifact.

## What already exists (the hard parts, done)

- **Audio capture** — `engine.startRecording()` / `stopRecording()` tap the master limiter
  (post EQ/comp, exactly the room sound) → a webm/opus blob. Real, clean, done.
- **The mix preset** — `engine.exportState()` → `StudioPreset` JSON, already URL-hash
  shareable. The "instrument" half is fully serializable.
- **Visual capture** — the OG/postcard pipeline already grabs the canvas to a sized PNG.
- **Live chain provenance** — slot, epoch, key, section are all live-readable from the
  engine + data source at capture time. The metadata writes itself.

So the engineering left is **format, storage, and mint** — known, well-trodden work — plus
the product/curation decisions, which are the real substance.

## The build, phased

### Phase 1 — "Export this moment" (no chain, ships value immediately) · ~2–3 days
Turn the existing REC into a real artifact bundle:
- Transcode the webm/opus take → **WAV** (lossless, universal; ~10–30 MB for 1–3 min) or
  **MP3** (wasm encoder, smaller). Decode via Web Audio, re-encode in-browser.
- Grab a **matching cover** at stop time (still PNG now; a short canvas-MediaRecorder MP4/GIF
  loop later).
- Write a **`metadata.json` sidecar**: title, timestamp (ISO + CET), epoch, slot range,
  key, the embedded preset, a verify-on-Solscan hint, attribution.
- Download all three as a bundle.
**Value even if we stop here:** sellable/shareable tracks, an archive of the premiere, and
material for the launch thread. De-risks everything downstream.

### Phase 2 — Permanent storage · ~1–2 days
- Upload audio + cover + metadata to **Arweave via Irys** (pay-once, permanent — fits "kept
  forever"; IPFS/nft.storage is the lighter alternative).
- Wallet-connect (`@solana/wallet-adapter`) for the upload payment.

### Phase 3 — Mint on Solana · ~3–5 days
- **Metaplex Core** via **Umi** (newer single-account standard; lighter + cheaper than
  legacy Token Metadata — confirm current best practice at build time).
- Standard Metaplex metadata; `animation_url` = the audio, `image` = the cover, attributes
  = the verifiable chain facts.
- **Devnet first**, always. Then mainnet behind a wallet, with clear cost + signing UX.

### Phase 4 (optional) — scale + the live lens · ~1 week+
- **"Mint your moment"**: let any visitor capture + mint their own stretch of the chain
  (artist royalty on each). Turns every viewer into a collector; the business model.
- **Live-replay player**: a hosted page that takes a preset and plays it live as the NFT's
  `animation_url`, so marketplaces show the *instrument*, not just a waveform.

## Where it lives (clean seam, art untouched)

A **new, separate surface** — a `src/mint/` module + a "Mint this moment" panel in the
studio (or a `/mint` route). It only **consumes** `engine.stopRecording()`,
`engine.exportState()`, a canvas grab, and the live chain readouts. The art engine and the
gallery build are not modified. New deps (umi, wallet-adapter, irys, an mp3 encoder) are
heavy, so the mint surface is **code-split** — the art bundle stays exactly as light as it
is now.

## Effort & sequencing

- **~3 days** → Phase 1, a real exportable track. Do this first regardless.
- **~1 week** → a working **devnet** mint (Phases 1–3).
- **~2 weeks** → polished **mainnet** 1/1 mint flow.
- **+1 week** → the public "mint your moment" + live player.

## Real risks / honesty

- **Mainnet = real money + key custody + wallet edge cases.** Devnet proof is non-negotiable
  before any mainnet mint.
- **Marketplace audio rendering is inconsistent.** Lead with the downloadable file + our own
  hosted player; don't depend on a marketplace's audio widget.
- **Provenance is the differentiator** — the metadata must record real slot numbers +
  timestamp so the artifact is independently checkable. That's the whole magic; protect it.
- Format size, royalty enforcement, edition economics, tax — product/business calls, not code.

## Decisions for you (these gate the build)

1. **Concept** — fossil-with-embedded-preset (my rec) / pure fossil / the live instrument?
2. **Edition strategy** — start with a curated **1/1 of the premiere capture** (mythology +
   proof of concept; my rec), an open "mint your moment" for everyone, or both?
3. **Chain target** — devnet proof first (always yes), then mainnet when?
4. **Storage** — Arweave/Irys ("forever", on-theme) vs IPFS (lighter)?

**Suggested first move:** build Phase 1 now (a real "Export this moment" with the premiere
already capturable), then decide the mint specifics with a tangible artifact in hand.

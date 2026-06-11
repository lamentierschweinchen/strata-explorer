# The Strata — Copy (canonical)

**Voice:** plain, warm, a little awe. Metaphor first, meaning second, always pinned to something
real. Short declarative sentences. Second person. Name Solana, but let the crystal lead.
**Audience:** smart non-experts ("the parents of blockchainers") who should feel something before
they understand anything. No jargon, no metrics-speak. **No em dashes.**

Consumed by: **Design** lane (`Legend.ts`), **Wiring** lane (`main.ts` loading copy, `index.html` OG meta).

## Hero / one-liner
> The Solana blockchain as a living crystal, growing with each heartbeat of the network.

**Tagline** (share text, hero subline):
> Watch the network grow in real time.

## Legend — "What You're Looking At"
- **The crystal.** The crystal at the center is the network's timeline. It grows a new layer every time Solana agrees on what just happened. It never branches, and it never rewrites itself.
- **Light and dark.** The newest layers glow. The oldest harden into dark rock. Once a layer settles it can never change again. It becomes part of the record, forever.
- **The points of light.** Each one is a real validator, a computer somewhere in the world helping keep the network honest. The more it has staked, the larger it burns.
- **The flare.** Every fraction of a second, one validator is chosen to lay the next layer. It flares, and light reaches in toward the crystal. *(Design: richer flare visualization pending.)*
- **The drifting color.** Live activity, the transactions moving through the network this second. Gold is money moving. Cyan is a trade. Purple is an NFT. Green is someone staking.
- **The ripples.** When a ripple rolls outward, a new block has just spread across the whole network at once.

## Heartbeat caption (optional, near the slot counter)
> Every four-tenths of a second the network agrees, and the crystal grows. That's the heartbeat you're watching.

## Loading states (`main.ts` LOADING_COPY)
- `connecting`: Reaching the Solana network…
- `demo`: Crystallizing a recent memory of the network…
- `fallback`: Can't reach the network. Crystallizing a recent memory instead…

## Open Graph / share (`index.html`)
- `og:title`: The Strata · The Solana blockchain, alive
- `og:description`: Watch the network grow in real time. Hundreds of validators and a live stream of transactions, drawn as a growing crystal. Not a chart. Something alive.

## Validator card (hover)
> `[name]` · Committed `[stake]` SOL · Last agreed `[just now / Ns ago]` · `[Active / Offline]`
> *Footer:* Click to fly in.

## Feed
- Header: **Live transactions**
- Each row links to the real transaction on Solscan. Secondary column shows the real program (Raydium, Magic Eden, Stake Program) or landing slot. Never a fabricated amount.

## Honesty notes (the whole point: "all of it is real")
- Ambient motes include synthetic density particles to match real TPS, so their wording is "live activity" (true in aggregate). The named FEED is real-only (synthetic flag skipped) and every row is verifiable on the explorer.
- Gold/transfers appear in the color key as *meaning*. Plain transfers are not individually streamed (they flood the network); the live feed streams defi / nft / stake.

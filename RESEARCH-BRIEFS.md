# Research Briefs: Blockchain Cosmos Visualizations

Two research briefs for deep-research agents — one for Solana, one for Ethereum+Base. The goal is NOT to prescribe visual solutions. The goal is for each researcher to become an expert on their chain's architecture and come back with multiple creative proposals for how to visualize it.

---

## Shared Context: What We Built and Why

### The MultiversX Galaxy of Nodes

We built a real-time 3D WebGL visualization of the MultiversX blockchain network rendered as a living galaxy. Live at galaxy-of-nodes.vercel.app. Here's what it is and the decisions behind it.

### The Core Insight

Every blockchain has unique architectural properties. The visualization should make those properties *visible and felt* — not explained via dashboards or charts, but experienced spatially. The viewer should understand how the network works by watching it, even if they've never heard of the blockchain before.

### Architecture → Visual Mapping (MultiversX)

MultiversX has adaptive state sharding — the network splits into parallel processing lanes (shards), each with ~720 validators, coordinated by a metachain. This defined the visual:

| Architecture Property | Visual Decision | Why |
|---|---|---|
| 3 shards + metachain | 3 star clusters + bright central core | Sharding IS the defining feature — the spatial separation makes it legible |
| ~720 validators per shard | Each validator = a star within its cluster | 3,200 stars is renderable; each can be individually interactive |
| Validator rating (0-100) | Star brightness | Reliability is "how much light you emit" — intuitive |
| Validator stake (EGLD amount) | Star size | More economic weight = more visual mass |
| Intra-shard transaction | Fast particle within one cluster | Stays local, short-lived, shard-colored |
| Cross-shard transaction | Particle arcing between clusters (passing near metachain) | The arc shows the routing through the coordination layer |
| Transaction type (transfer/SC call/token) | Particle color (gold/cyan/purple) | Color-coding lets you see the mix of activity |
| Transaction value | Particle brightness + size (log scale) | Higher value = more visual energy |
| Block proposer (consensus leader) | Star flare — radial pulse expanding outward | The "heartbeat" of each shard, visible rhythmically |
| Metachain notarization | Core pulse (scale + brightness boost) | The center breathing = the coordination layer is alive |
| Block round (~6s) | Rhythm of proposer flares | The visual has a tempo driven by real block production |
| Epoch boundary (~24h) | Validator shuffle (stars migrate between clusters) | Rare but dramatic structural change |

### What Makes It Work Emotionally

- **The galaxy metaphor fits MultiversX's architecture.** Shards naturally map to star clusters. A metachain naturally maps to a gravitational core. The metaphor isn't decorative — it's structural.
- **Multiple timescales create rhythm.** Star twinkle (continuous), block proposals (every 6s), cluster breathing (2.5-4s waves), supernova bursts (every ~30s). Layered rhythms feel organic, not mechanical.
- **Everything is data-driven.** No decorative animations — every visual effect corresponds to a real network property. Brightness = rating, size = stake, particle color = tx type, particle velocity = intra vs cross-shard.
- **The "void" matters.** Dark space between clusters, faint dust, 80K background stars — these create depth and atmosphere that makes the active elements feel precious.
- **Post-processing sells it.** Bloom (stars glow), vignette (cinematic framing), film grain (organic texture), chromatic aberration (lens realism). Without these, it looks like a tech demo. With them, it looks alive.

### Technical Decisions

- **Three.js + custom GLSL shaders** for star rendering (soft glow falloff, diffraction spikes on bright stars, size attenuation with distance)
- **Instanced rendering** for 3,200 validators — each is a point with per-instance attributes (position, color, size, brightness)
- **800-slot particle pool** for transactions — object recycling, not allocation per transaction
- **6-second polling** matching block round time. Cached validators (only change at epoch boundaries).
- **DataSource interface** abstracts mock vs live data. Both feed the same render pipeline.
- **Auto-orbiting camera** with OrbitControls override. Resumes after 15s inactivity.

### The Key Constraint

**The visual metaphor must emerge from the architecture, not be imposed on it.** We didn't start with "let's make a galaxy" and force MultiversX into it. We started with "MultiversX has 3 parallel shards coordinated by a metachain" and the galaxy metaphor emerged naturally. The same process needs to happen for each new chain.

---

## Brief 1: Solana

### Your Mission

Become an expert on Solana's network architecture — how it's built, how data flows through it, what makes it structurally unique. Then propose **3-4 distinct visual directions** for how to represent it as an immersive 3D visualization.

### What We Know Going In

Solana is proudly monolithic — single global state, no sharding. It runs on a novel Proof of History (PoH) clock that creates a verifiable ordering of events before consensus. This means the MultiversX galaxy metaphor (multiple clusters) won't work. The visual needs to capture monolithic-but-fast differently.

We also know that a large percentage of Solana's transactions are validator votes rather than user transactions. This creates two overlapping layers of network activity that could be visually separated.

### What We Need You to Research

1. **Deep architecture understanding**: Learn how Solana actually works — PoH, Tower BFT, Turbine, Gulf Stream, Sealevel. Not surface-level summaries. Understand the data flow from a user submitting a transaction to it being confirmed. Understand the leader rotation, the slot/entry/transaction hierarchy, how block data propagates through the network.

2. **Entity inventory**: What are all the distinct components/actors in the network? Validators, leaders, vote accounts, programs, tokens — everything that could be a visual element. Get real numbers (how many validators, what's the stake distribution, what's the real TPS).

3. **Unique structural features**: What does Solana have that NO other chain has? PoH is the obvious one, but dig deeper. How does Turbine's tree propagation actually work? What does parallel execution look like? What does the leader rotation create in terms of rhythm and structure?

4. **Timescales and rhythms**: What are all the temporal cycles? Slot time, epoch length, leader rotation period, vote lockout periods. These become the heartbeats and breathing patterns of the visualization.

5. **API surface**: What data can we actually get in real-time? RPC endpoints, WebSocket subscriptions, rate limits, paid vs free providers. We need to know what's technically feasible for a browser-based visualization polling a public API.

### What We Need You to Propose

Come back with **3-4 distinct visual metaphor directions**. For each:

- What's the central spatial metaphor? (Not necessarily a galaxy — could be a neural network, a living organism, a weather system, a musical instrument, anything that *structurally fits* Solana's architecture)
- How do Solana's unique features (PoH, Turbine, Gulf Stream, Sealevel) become visible?
- What does the leader rotation look like? (This is the fastest "heartbeat" of any major chain — ~400ms)
- How do you handle the vote transaction volume? (50-80% of all activity — needs its own visual treatment)
- What's the emotional register? (MultiversX's galaxy feels vast and contemplative. Solana's might feel fast, electric, neural, rhythmic — your call based on what the architecture suggests)

**Don't self-censor.** Some proposals can be ambitious/experimental. We want range.

---

## Brief 2: Ethereum + Base

### Your Mission

Become an expert on (a) Ethereum's post-Merge architecture and (b) how Base (Coinbase's L2, OP Stack) connects to it. Then propose **3-4 distinct visual directions** for how to represent the L1+L2 relationship as an immersive 3D visualization.

### What We Know Going In

Ethereum hasn't delivered on sharding but has the richest L2 ecosystem. The interesting visual story isn't Ethereum alone — it's **the relationship between Ethereum L1 and an L2 like Base**. How does settlement work? What data flows between them? What does "security inheritance" look like spatially?

We also know that Ethereum has ~1M validators — orders of magnitude more than MultiversX's 3,200 or Solana's ~1,900. Rendering them individually is a non-starter. The researcher needs to figure out how to represent this *scale* without per-entity rendering, while still conveying the massive decentralization.

The other striking structural feature: Ethereum's heartbeat (12s blocks) is much slower than MultiversX (6s) or Solana (0.4s). Plus blob transactions (EIP-4844) are the literal data bridge between L1 and L2. These are architectural properties that should drive the visual, not be footnotes.

### What We Need You to Research

1. **Ethereum L1 architecture**: Post-Merge consensus (Beacon Chain) + execution layer separation. Validators, committees, attestations, proposers. How consensus works slot by slot. Finality mechanics (Casper FFG).

2. **Base L2 architecture**: OP Stack components — Sequencer, Batcher, Proposer. How transactions flow from user → sequencer → L2 block → batch → L1 blob. The fault proof / challenge system.

3. **The L1 ↔ L2 connection**: This is the most important part. Exactly how does Base post data to Ethereum (blob transactions)? How do deposits/withdrawals work? What's the timing cadence — Base blocks every 2s, Ethereum slots every 12s, blobs posted every few minutes, finality in ~13 minutes. This multi-timescale rhythm is potentially the defining visual feature.

4. **Scale challenge**: ~1M Ethereum validators. How are they distributed (solo vs pooled staking)? What aggregate representations could work? Think: density clouds, heat maps, particle systems that represent groups rather than individuals.

5. **Transaction types and visual diversity**: Ethereum has distinct transaction types (legacy, EIP-1559, blob). Blob transactions are structurally different — large, data-heavy, L2-facing. How does this contrast with regular user transactions?

6. **API surface for both layers**: Ethereum Beacon API, Execution API, Base JSON-RPC. What cross-layer data is available? Can we detect which L1 blob transactions belong to Base? Rate limits and provider requirements.

### What We Need You to Propose

Come back with **3-4 distinct visual metaphor directions**. For each:

- How do you represent the L1 ↔ L2 relationship spatially? (Two connected bodies? Nested structures? Parent-child? Symbiosis?)
- How do you convey Ethereum's scale (~1M validators) without rendering them individually?
- What does the blob data pipeline look like? (This is the "umbilical cord" between L1 and L2 — the most novel visual element)
- How do you express the multi-timescale rhythm? (2s Base blocks → 12s Ethereum slots → minutes between blob posts → minutes to finality)
- What does "settlement" and "security inheritance" look like visually? (Base relying on Ethereum for security is an abstract concept — how do you make it spatial and intuitive?)
- What's the emotional register? (Perhaps heavier, more gravitational than MultiversX — Ethereum is the settlement layer, the bedrock. Base is faster, lighter, orbiting.)

**The L1↔L2 relationship is the story here.** Ethereum alone is well-trodden. Base alone is not interesting enough. The magic is in visualizing the *connection* — making people understand how L2s actually work by watching data flow between layers.

---

## Deliverable Format

For each chain, return:

1. **Architecture deep-dive** — comprehensive understanding of how the chain works, with enough detail that we could design a DataSource interface from it
2. **Entity inventory** — every component that could be a visual element, with real counts and data properties
3. **Data flow map** — transaction lifecycle from user intent to finality, step by step, with real timings
4. **API assessment** — what we can fetch, how fast, rate limits, auth requirements, WebSocket availability
5. **3-4 visual direction proposals** — each with a central metaphor, key visual mappings, emotional register, and what makes it structurally honest to the architecture
6. **Performance notes** — entity counts, update frequencies, and any scale challenges we need to solve
7. **"Only on this chain" moments** — the 2-3 features that exist nowhere else and would make this visualization unmistakably *this* blockchain

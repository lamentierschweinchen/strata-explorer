# The Strata — Solana Visualization: Implementation Handoff

## For: A fresh Claude Code instance building this from scratch

---

## What You're Building

A real-time 3D WebGL visualization of the Solana blockchain network, rendered as a **growing crystal formation**. This is the second entry in the "Cosmos Explorers" series — the first being "Galaxy of Nodes" (MultiversX), live at galaxy-of-nodes.vercel.app.

The crystal metaphor emerged from Solana's architecture: a perfectly linear, unbranching Proof of History hash chain (the crystal axis), validators as mineral deposits surrounding it, block finality as crystallization (translucent → opaque), and Turbine block propagation as seismic waves rippling outward.

**One line: The blockchain as geological time-lapse — ancient process at millisecond speed.**

---

## The Reference Implementation: What We Learned Building Galaxy of Nodes

The Galaxy of Nodes codebase at `/Users/ls/Documents/MultiversX/galaxy-of-nodes/` is your primary reference. Study it before writing code. Here's what worked, what didn't, and what to carry forward.

### Architecture That Worked

```
src/
  scene/          # Three.js visual systems (one class per visual element)
  shaders/        # Custom GLSL (vertex + fragment per visual element)
  particles/      # Object pool for transaction particles
  data/           # DataSource interface → MockData + LiveDataSource
  interaction/    # Camera, raycaster, HUD, info overlay, audio, tooltip, legend
  utils/          # Config, colors, math helpers
```

**Key pattern: DataSource interface.** `src/data/DataSource.ts` defines an abstract interface. `MockDataGenerator` implements it with synthetic data. `LiveDataSource` implements it with real API calls. The entire render pipeline is data-source-agnostic. **Copy this pattern exactly.** Start with mock data, make it beautiful, plug in live data later.

**Key pattern: Galaxy.create() is async.** The main scene class has a static async factory method that initializes the data source, waits for validators to load, then constructs the scene. This allows showing a loading message during API fetch.

**Key pattern: Object pool for particles.** `TransactionPool` pre-allocates 800 particle slots. When a transaction fires, it grabs a slot from the pool. When the animation completes, the slot is recycled. No runtime allocation. This is critical for 60fps.

### Technical Decisions to Replicate

| Decision | Why |
|---|---|
| Vite + TypeScript (vanilla, no React) | Fast HMR, minimal overhead, Three.js works best without framework wrappers |
| Custom GLSL shaders for stars/particles | PointsMaterial is too limited for the visual quality we need. Vertex shader handles size attenuation; fragment shader handles soft glow falloff, diffraction spikes, additive blending |
| EffectComposer post-processing | UnrealBloomPass (star glow), custom color grading, vignette, film grain, chromatic aberration. These sell the "not a tech demo" feeling. Without them it looks flat. |
| Instanced rendering for validators | InstancedBufferGeometry with per-instance attributes (position, color, size, brightness). Handles 3,200+ points at 60fps easily. Solana has ~3,248 validators — same scale. |
| 6-second (now 600ms) polling with WebSocket fallback | Match the block time. For Solana: WebSocket `slotSubscribe` fires every ~400ms — use that as the primary heartbeat. Fall back to HTTP polling at 500ms if WS unavailable. |
| Mock data first | The visualization must look stunning with synthetic data. Real data is a layer on top, not a prerequisite. |
| Ambient soundtrack | Part of the experience. Include a toggle button (muted by default). |

### Visual Effects That Made Galaxy of Nodes Feel Alive

Every one of these should have an equivalent in The Strata:

| Galaxy of Nodes Effect | Purpose | Strata Equivalent |
|---|---|---|
| Star twinkle (per-validator brightness oscillation) | Organic aliveness even at rest | Mineral deposit shimmer — each validator point subtly pulses |
| Proposer flare (radial pulse on block proposal) | Heartbeat, shows which validator is active | Leader spotlight — bright glow sweeps to current leader every 400ms |
| Metachain core pulse (scale + brightness boost) | Central coordination layer breathing | Crystal growth pulse — new segment forms with a flash every 400ms |
| Cluster breathing (slow scale oscillation per shard) | Organic motion, prevents static feel | Strata breathing — subtle vertical oscillation of the formation |
| Transaction particles (color-coded, velocity-varied) | Network activity, type differentiation | Transaction atoms being incorporated into crystal — colored by type |
| Supernova burst (periodic high-tx event) | Dramatic moments, visual variety | Seismic event — periodic intense wave through the formation |
| Background starfield (80K ambient points) | Depth, atmosphere, cosmic setting | Background geological texture — dark cavern with ambient mineral glints |
| Dust field (3K drifting particles) | Subtle motion in negative space | Ambient crystal dust / suspended particles in the void |
| Bloom post-processing | Stars glow naturally | Crystal edges and active elements glow |
| Film grain + vignette | Cinematic framing, organic texture | Same — these are universal |

### Mistakes to Avoid

1. **Don't over-engineer the data layer early.** Build MockDataSource first. Make the visual stunning. Then wire up Solana RPC.
2. **Don't render vote transactions individually.** There are 3,000+ per slot. Aggregate them as a glow effect on validators (did this validator vote? → brightness pulse). The research confirms individual vote tx rendering is infeasible.
3. **Cross-shard arcs were initially too curved** in Galaxy of Nodes — user pushed back because transactions take the most direct path. Apply the same principle: seismic waves should propagate radially outward, not in decorative spirals.
4. **The info overlay and legend were initially too large on mobile.** Design these responsive from the start (195px panel on mobile, 230px on desktop).
5. **Audio file had spaces/parens in the filename** which caused issues. Use clean filenames from the start.
6. **The API URL was initially HTTP** and Vercel serves HTTPS, causing mixed content blocks. Always use HTTPS for API endpoints.

---

## The Strata: Detailed Visual Specification

### Core Structure

**The Crystal Axis (PoH Hash Chain)**
- A vertical crystalline column growing upward from the center of the scene
- Each slot (400ms) adds a new ring/segment to the top
- The crystal is perfectly linear — it never branches (this is the defining property of PoH)
- Implementation: cylindrical buffer of ring segments. Keep N most recent segments as active geometry. Older segments scroll downward and fade/solidify. This caps vertex count.
- Color: white/silver core with subtle prismatic refraction at edges

**Finality Gradient**
- Recent segments (top): translucent, glowing, slightly pulsing — "still crystallizing"
- Confirmed segments (middle): semi-translucent, dimmer — "setting"
- Finalized segments (bottom): opaque, solid, dark — "immutable bedrock"
- The gradient represents: recent → confirmed (~400ms) → finalized (6-12s with Tower BFT, or 100-150ms with Alpenglow)
- This is the most visually distinctive element. The crystal literally hardens as you watch.

**Validator Mineral Deposits**
- ~3,248 validators as glowing mineral points scattered in a roughly cylindrical arrangement around the crystal axis
- Position: distributed in a cloud around the crystal, with some natural clustering
- Size: maps to `activatedStake` (more stake = larger point)
- Brightness: maps to recent voting activity (`lastVote` recency)
- Color: warm amber base with commission-based hue shift (low commission = greener/healthier, high commission = redder)
- These are rendered as instanced points with custom shaders — same technique as Galaxy of Nodes validators

**Leader Rotation Spotlight**
- The current leader is highlighted with a bright spotlight/flare effect
- Every 400ms, the spotlight sweeps to the next leader
- Leaders serve 4 consecutive slots (1.6s total) — the spotlight stays on one validator for 4 pulses before moving
- The next 3-4 upcoming leaders glow dimly (the leader schedule is known in advance)
- This is the primary rhythm of the visualization — the 400ms pulse

**Seismic Waves (Turbine Propagation)**
- When a block is produced, a radial wave emanates outward from the crystal axis
- The wave passes through the validator cloud, causing each validator to briefly brighten as it reaches them
- 2-3 visible wavefronts (matching Turbine's 2-3 hop propagation)
- Duration: ~100-200ms for the wave to reach the outermost validators
- Implementation: expanding sphere/ring with shader-based falloff. Similar to Galaxy of Nodes proposer flare but larger scale.

**Transaction Atoms**
- User transactions (non-vote) appear as small colored particles that drift toward the crystal axis
- They enter from the outer edge (representing RPC ingestion / Gulf Stream routing)
- They converge on the current leader's position
- On incorporation into a block, they flash and become part of the crystal surface
- Color coding:
  - Gold/amber: SOL transfers
  - Cyan/blue: Program interactions (smart contract calls)
  - Purple/magenta: Token transfers (SPL tokens)
  - Green: DeFi operations (swaps, liquidity)
- Particle brightness scales with transaction value (log scale)
- Object pool: 600-800 slots (Solana processes more user TPS than MultiversX)

**Vote Activity Layer**
- NOT rendered as individual particles (3,000+ per slot would overwhelm)
- Instead: a subtle ambient glow layer around each validator that pulses when the validator votes
- Creates a "breathing" effect across the entire validator cloud every ~400ms
- Visually, it looks like the minerals are resonating with the crystal's growth

### Camera and Interaction

- **Default view:** Slightly angled, looking at the crystal from the side. The growth point (top) is centered. Slow orbital rotation.
- **Scroll zoom:** Zoom in to see individual validator deposits, zoom out to see the full formation with finality gradient
- **Click validator:** Zoom to that mineral deposit. Show tooltip: name, stake, commission, last vote, epoch credits
- **Click crystal segment:** Show slot info: slot number, leader, transaction count, timestamp
- **Auto-orbit:** Slow rotation resumes after 15s of inactivity (same as Galaxy of Nodes)

### HUD Overlay (Minimal)

Same philosophy as Galaxy of Nodes — not a dashboard, just floating context:

- **Top-left:** `SLOT [number]` / `EPOCH [number]`
- **Top-right:** `[count] VALIDATORS` / `[count] TRANSACTIONS` (cumulative, human-readable with M/B suffixes)
- **Bottom-center:** `NETWORK ACTIVITY` label + TPS bar (same as Galaxy of Nodes)
- **Bottom-left:** Galaxy-style legend button (tap/hover to reveal)
- **Bottom-right:** Sound toggle
- **Top-center:** Info overlay toggle ("i" button) → shard labels, leader name, transaction feed

### Legend Copy

```
The Solana blockchain,
visualized as a growing crystal

● Each glowing point is a network
  validator
  Brighter = voted recently · Larger = more stake

● The crystal axis is the Proof of
  History clock
  New segment every 400ms · Hardens as it finalizes

● Moving particles are transactions
  Converge on the current leader
  Bigger & brighter = higher value
  ● Transfer  ● Program  ● Token

● Spotlight = current block leader
  Rotates every 400ms · Serves 4 consecutive slots

● Ripple waves = block propagation
  Spreading from leader to all validators
```

---

## Solana Architecture → Data Mapping (Complete)

| Solana Concept | Visual Element | Data Source | Update Frequency |
|---|---|---|---|
| Proof of History tick | Crystal axis micro-growth | Derived from slot progression | Interpolated at 60fps |
| Slot (400ms) | New crystal ring segment | `slotSubscribe` WebSocket | Every ~400ms |
| Epoch (~2 days) | Major structural shift (validator reshuffle) | `getEpochInfo()` | Once per epoch |
| Validator | Mineral deposit point | `getVoteAccounts()` | Every 5-10s |
| Validator stake | Point size | `activatedStake` field | Every 5-10s |
| Validator commission | Point color hue | `commission` field | Every 5-10s |
| Validator voting | Point brightness pulse | `lastVote` field | Every 5-10s |
| Current leader | Spotlight/flare on validator | `slotSubscribe` → leader field | Every ~400ms |
| Leader schedule | Dim glow on upcoming leaders | `getLeaderSchedule()` | Once per epoch |
| Block production | Crystal growth flash + seismic wave | Slot progression | Every ~400ms |
| Block finality | Crystal hardening (translucent → opaque) | `rootSubscribe` WebSocket | Every ~6-12s |
| User transaction | Colored particle drifting to leader | Aggregate from performance samples | Every 1-2s |
| Vote transaction | Ambient validator glow pulse | Aggregated (don't render individually) | Every ~400ms |
| Turbine propagation | Radial seismic wave from crystal | Simulated (not exposed via API) | On block production |
| Transaction type | Particle color | Derived from transaction data | Per transaction |
| Transaction value | Particle brightness + size | Derived from transaction data | Per transaction |
| Missed slot (leader offline) | Crystal gap / dim segment | Slot without block | When detected |
| TPS | Ambient particle density + TPS bar | Performance samples or computed | Every 1-2s |

---

## Mock Data Specification

Build `MockSolanaData` following the same pattern as `galaxy-of-nodes/src/data/MockData.ts`.

### Validators (generate on init)
- Count: 3,248
- Each has: `pubkey` (random base58), `name` (from a pool of real Solana validator names), `stake` (log-normal distribution, median ~620K SOL, range 10K-10M), `commission` (0-10%, most at 5-7%), `lastVote` (recent slot), `epochCredits` (high number)
- Position: distributed in a cylindrical cloud around origin, radius 80-150 units, height spread ±50 units

### Slot Progression (simulated)
- 400ms interval (2.5 slots/second)
- Each slot: pick a leader from validator pool (stake-weighted), generate 5-20 user transactions, mark all validators as having voted (with 95-98% participation rate)
- 5% of slots are "missed" (no block produced) — the crystal should show a gap or dim segment

### Transaction Mix
- TPS range: 1,000-4,000 (user transactions only, excluding votes)
- Type distribution: 40% transfers, 30% program calls, 20% token transfers, 10% DeFi
- Value distribution: log-normal, most small, occasional large

### Timing
- Block interval: 400ms
- Finality delay: simulate ~12s for Tower BFT (30 slots behind current)
- Periodic intensity bursts every ~30s (simulating high-activity periods)

---

## API Integration (Phase 3 — After Mock Data Works)

### Primary: Helius (Recommended)
- Free tier: 30M compute units/month
- Supports WebSocket subscriptions
- Sign up at helius.dev, get API key
- Mainnet URL: `https://mainnet.helius-rpc.com/?api-key=YOUR_KEY`
- WebSocket: `wss://mainnet.helius-rpc.com/?api-key=YOUR_KEY`

### Key Calls

```typescript
// WebSocket (primary heartbeat — fires every ~400ms)
ws.send(JSON.stringify({
  jsonrpc: "2.0", id: 1,
  method: "slotSubscribe"
}));
// Returns: { slot, parent, root }

// WebSocket (finality tracking)
ws.send(JSON.stringify({
  jsonrpc: "2.0", id: 2,
  method: "rootSubscribe"
}));
// Returns: root slot number

// HTTP (polled every 5-10s)
POST /  { "jsonrpc":"2.0", "id":1, "method":"getVoteAccounts" }
// Returns: { current: [...validators], delinquent: [...] }

// HTTP (once per epoch)
POST /  { "jsonrpc":"2.0", "id":1, "method":"getLeaderSchedule" }
// Returns: { validatorPubkey: [slot indices...] }

// HTTP (once per epoch)
POST /  { "jsonrpc":"2.0", "id":1, "method":"getEpochInfo" }
// Returns: { epoch, slotIndex, slotsInEpoch, absoluteSlot }
```

### DataSource Interface

Extend the same `DataSource` pattern from Galaxy of Nodes:

```typescript
interface SolanaDataSource {
  initialize(): Promise<void>;
  start(callbacks: SolanaCallbacks): void;
  stop(): void;
  getValidators(): ValidatorInfo[];
  getValidator(index: number): ValidatorInfo | null;
  getCurrentSlot(): number;
  getCurrentLeader(): string | null;
  getUpcomingLeaders(count: number): string[];
  getRootSlot(): number; // finality
  getEpochInfo(): { epoch: number; slotIndex: number; slotsInEpoch: number };
}

interface SolanaCallbacks {
  onSlot: (slot: number, leader: string) => void;
  onValidatorsUpdated: (validators: ValidatorInfo[]) => void;
  onTransactions: (txs: TransactionInfo[]) => void;
  onRootAdvance: (rootSlot: number) => void;
}
```

---

## Project Setup

### Step 0: Workspace Organization

The project lives in the "Beautiful Blockchains" workspace. Before writing any code:

1. Copy reference files from Galaxy of Nodes into the Galaxy Explorer folder:
   ```bash
   cp -r /Users/ls/Documents/MultiversX/galaxy-of-nodes/* "/Users/ls/Documents/Beautiful Blockchains/Galaxy Explorer/"
   ```

2. Copy the handoff brief + research into the Strata Explorer folder:
   ```bash
   cp /Users/ls/Documents/MultiversX/galaxy-of-nodes/HANDOFF-SOLANA.md "/Users/ls/Documents/Beautiful Blockchains/Strata Explorer/"
   cp /Users/ls/Documents/MultiversX/galaxy-of-nodes/RESEARCH-SOLANA.md "/Users/ls/Documents/Beautiful Blockchains/Strata Explorer/"
   cp /Users/ls/Documents/MultiversX/galaxy-of-nodes/RESEARCH-BRIEFS.md "/Users/ls/Documents/Beautiful Blockchains/Strata Explorer/"
   ```

3. Initialize the Strata project inside that folder. All new code goes in:
   `/Users/ls/Documents/Beautiful Blockchains/Strata Explorer/`

4. The Galaxy Explorer folder is your **read-only reference**. Study the code patterns there (especially `src/data/DataSource.ts`, `src/scene/Galaxy.ts`, `src/shaders/`, and `src/data/MockData.ts`) but don't modify it.

### File Structure

```
/Users/ls/Documents/Beautiful Blockchains/Strata Explorer/
├── index.html
├── vite.config.ts
├── package.json          # three, vite, typescript
├── tsconfig.json
├── src/
│   ├── main.ts
│   ├── scene/
│   │   ├── Strata.ts            # Main scene (equivalent to Galaxy.ts)
│   │   ├── CrystalAxis.ts       # PoH crystal column (procedural geometry)
│   │   ├── ValidatorCloud.ts    # Instanced validator mineral deposits
│   │   ├── LeaderSpotlight.ts   # Current leader highlight effect
│   │   ├── SeismicWave.ts       # Turbine propagation ripple
│   │   ├── Background.ts        # Dark cavern / ambient environment
│   │   └── PostProcessing.ts    # Bloom, color grading, vignette, grain
│   ├── shaders/
│   │   ├── crystal.vert / .frag
│   │   ├── mineral.vert / .frag  # Validator points
│   │   ├── particle.vert / .frag # Transaction atoms
│   │   ├── wave.vert / .frag     # Seismic wave
│   │   └── postprocess/          # Custom post-processing shaders
│   ├── particles/
│   │   └── TransactionPool.ts
│   ├── data/
│   │   ├── DataSource.ts         # Interface
│   │   ├── MockData.ts           # Synthetic Solana data
│   │   ├── LiveDataSource.ts     # Real Solana RPC (Phase 3)
│   │   └── SimulationEngine.ts   # Mock slot progression + tx generation
│   ├── interaction/
│   │   ├── CameraController.ts
│   │   ├── Raycaster.ts
│   │   ├── HUD.ts
│   │   ├── InfoOverlay.ts
│   │   ├── Legend.ts
│   │   ├── AudioController.ts
│   │   └── Tooltip.ts
│   └── utils/
│       ├── config.ts
│       ├── colors.ts
│       └── math.ts
└── public/
    ├── favicon.svg
    ├── og-preview.png
    └── audio/
```

### Implementation Phases

**Phase 1: The Formation (static)**
Crystal axis geometry, validator mineral deposits positioned in cloud, background environment. No animation. Get the visual language right — it should already look like something you'd stare at.

**Phase 2: Crystallization (animation)**
Crystal grows upward every 400ms. Validators shimmer. Leader spotlight rotates. Finality gradient hardens. Seismic waves pulse outward. Mock data drives everything.

**Phase 3: Living Data**
Connect to Solana RPC via Helius. Real validators, real slot progression, real leader rotation, real finality tracking.

**Phase 4: Interaction**
Raycaster for hover/click on validators and crystal segments. HUD, info overlay, legend, tooltips.

**Phase 5: Polish**
Post-processing passes, audio, OG tags, favicon, README, mobile responsiveness, deploy to Vercel.

---

## Design Constraints (Non-Negotiable)

These come directly from the user's feedback across the Galaxy of Nodes build:

1. **No dashboard aesthetics.** This is art, not analytics.
2. **Every visual effect must correspond to real data.** No decorative filler.
3. **Visual honesty over visual drama.** If transactions take the most direct path, show a direct path — not a decorative arc.
4. **Graceful degradation.** If the API is slow, the crystal should still look beautiful with cached data.
5. **Mobile matters.** Test at 375px width. Legend panel 195px max on mobile. Tighter margins (16px vs 28px).
6. **The legend must be understandable by a non-technical observer.** "Each glowing point is a network validator" not "Instanced points represent consensus participants."
7. **Post-processing is not optional.** Bloom, vignette, film grain, chromatic aberration. Without these it looks like a tech demo.
8. **Ambient soundtrack.** Muted by default, toggle button bottom-right.
9. **Performance over completeness.** If rendering something tanks FPS, simplify or LOD it. 60fps is the floor.
10. **The 400ms heartbeat must be FELT.** This is the fastest major chain — the visualization should feel electric, not contemplative.

---

## Emotional Target

Galaxy of Nodes feels like floating in space watching a civilization breathe.

The Strata should feel like watching something ancient and inevitable happen at impossible speed. A crystal forming in geological time, compressed into seconds. The same awe as watching a time-lapse of ice crystals growing under a microscope — order emerging from chaos, structure assembling itself, the laws of physics made visible.

If Galaxy of Nodes is contemplative, The Strata is mesmerizing. You can't look away because something is always growing, always hardening, always being built.

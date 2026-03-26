# Solana: Deep Architecture Research
### For Galaxy of Nodes — 3D WebGL Immersive Visualization

---

## 1. Architecture Deep-Dive

### Proof of History: The Verifiable Clock

**Core Mechanism:**
Proof of History creates a cryptographically verifiable sequence of time by running a Verifiable Delay Function (VDF) based on SHA-256 hashing. A validator continuously computes sequential SHA-256 hashes where each hash depends on the previous one — no parallelization possible. This creates a tamper-proof temporal ordering.

**The Tick System:**
- **One tick** = 12,800 sequential SHA-256 hashes
- **Approximate time per tick** = 6.25 milliseconds
- **One slot** = 64 ticks = ~400 milliseconds total
- **One epoch** = 432,000 slots ≈ 2 days

Each tick is cryptographically linked to the previous tick, creating a continuous "proof of passage of time" that the entire network coordinates around. This removes the need for validators to constantly communicate to agree on ordering.

**Visual Property:** The PoH chain is a *sequential, unbranching hash chain*. Each entry in the chain has a `prev_hash` (cryptographic link), `num_hashes` (approximate time since last entry), and `transactions` (0-64 transactions hashed into this entry). This is uniquely Solana — a linear, deterministic timeline that never forks.

### Tower BFT → Alpenglow: The Consensus Mechanism

**Original Tower BFT (legacy):**
- Validators vote once per slot on blocks they observe
- A block requires ⅔ of total effective stake to confirm
- Finality achieved after 31+ blocks past the target block receive ⅔ votes
- Confirmation typically ~400ms, finality ~6-12 seconds

**Alpenglow (2026 rollout — 97%+ validator approval):**
- Replaces Tower BFT from the consensus layer
- **100-150ms finality** (vs. 6-12 seconds previously)
- Two-component system:
  - **Voter:** Super-fast consensus requiring only 1-2 voting rounds
  - **Rotor:** Data layer optimization reducing broadcast bottlenecks
- When 80% of validators online: finality in ~100ms (single round)
- When 60% participate initially: second round, ~150ms

**Visual Property:** Even with Alpenglow, finality follows a *rhythmic voting cycle*. The network reaches consensus in discrete pulses rather than continuously. This suggests visual representation as repetitive consensus waves.

### Turbine: Block Propagation as a Tree Network

**The Data Flow:**
1. Leader produces a block during their 400ms slot
2. Block is broken into ~1,228-byte shreds
3. Reed-Solomon erasure coding creates FEC pairs: **32 data shreds + 32 recovery shreds per block**
4. **Key property:** Any validator can recover the full block from any 32 of the 64 shreds (50% redundancy)

**Propagation Topology:**
- The cluster divides itself into hierarchical **layers** (tree structure)
- Leader broadcasts to first-hop validators
- Each first-hop forwards to second-hop validators
- The tree structure **changes every slot**, seeded deterministically from: `(slot_leader_id, slot_number, shred_index, shred_type)`

**Timing:**
- Total block propagation: **~100-200ms** across global cluster
- Usually **2-3 hops** maximum in the Turbine tree
- This allows validators distributed globally to reconstruct blocks nearly simultaneously

**Visual Property:** Block data spreads like *ripples through a dynamic tree*. The tree topology regenerates every slot, suggesting a *pulsing, breathing network structure* that reorganizes with the heartbeat of slot production.

### Gulf Stream: Mempool-Less Transaction Routing

**The Paradigm Shift:**
Unlike traditional blockchains where transactions wait in a shared mempool, Solana **forwards transactions directly to upcoming leaders before the current block finishes**.

**How It Works:**
1. Leader schedule is **known in advance for the entire epoch** (432,000 slots ahead)
2. When a user submits a transaction, the RPC node looks up current + next leader in the schedule
3. Forwards transaction directly to both current and next leader via QUIC protocol
4. Upcoming leader receives transaction **before their slot begins**

**Traffic Prioritization:**
- **80% of leader's connection slots** = reserved for staked validators
- **20%** = public network (non-staked)

**Visual Property:** Rather than pooling and gossiping, transactions move in *directed flows toward future leaders*. This is deterministic, suggesting visualization as *predictable paths converging on upcoming block producers*.

### Sealevel: Parallel Execution Engine

**Core Principle:**
Every transaction must **declare all accounts it will read or write** before execution. Sealevel analyzes transaction dependencies, identifies non-conflicting transactions, and executes them in parallel across multiple CPU cores/threads.

- Transactions accessing different writable accounts = execute in parallel
- Transactions accessing same writable account = execute sequentially (serialized)
- Read-only accounts = can be read by unlimited parallel transactions

**Visual Property:** Multiple *parallel pipelines/lanes* executing simultaneously. Certain transactions queue up when they conflict on accounts. This is assembly-line manufacturing, not single-worker craftsmanship.

### Transaction Lifecycle: Complete Flow

```
T=0ms       User submits transaction
            → Signature + serialized bytes + recent blockhash (anti-replay)

T=0ms       RPC ingestion
            → RPC node receives via HTTP, converts to QUIC, looks up leader schedule

T=0ms       Gulf Stream routing
            → Forwarded directly to current + next leader(s)

T=50-100ms  Leader processing (400ms slot window)
            → Fetch Stage: Deduplicates, checks format
            → Sig Verify: Validates signatures
            → Banking Stage: Sealevel identifies conflicts, schedules parallel lanes
            → Creates Entries with PoH hash chain linkage

T=200-300ms Leader completes block
            → Final entries committed, block signed

T=300ms     Turbine propagation begins
            → Block → 64 shreds (32 data + 32 recovery)
            → First-hop validators receive shreds
            → Hop 1 → 2 → 3, all validators reconstructing (100-200ms total)

T=400ms     Slot N+1 begins
            → Validators have reconstructed Block N
            → Begin validating Block N
            → ~3,000+ vote transactions generated (1 per validator)
            → Next leader L[N+1] now building

T=800-1200ms  Tower BFT confirmation (legacy)
            → ⅔ of stake has sent votes → Block N "confirmed"
            → (Alpenglow will compress this to 100-150ms)

T=6-12s     Tower BFT finality (legacy)
            → 31+ slots past Block N, each with ⅔ votes
            → Block N becomes finalized (immutable)
            → (Alpenglow: finality in 100-150ms)
```

**Critical Insight:** The 400ms slot is the **fundamental rhythm**. Everything pulses at this rate: leader rotation, new PoH entries, voting, block propagation.

### Slot/Epoch/Block Hierarchy

| Concept | Duration | Meaning |
|---------|----------|---------|
| **Tick** | 6.25ms | 12,800 SHA-256 hashes |
| **Slot** | 400ms | One leader's opportunity to produce |
| **Epoch** | ~2 days (432,000 slots) | Leader schedule rotation, voting stake adjustments |
| **Entry** | Variable | PoH-timestamped transaction batch |
| **Block** | ~400ms | Actual produced block (not all slots produce blocks) |

**Key:** Not all slots produce blocks. A leader might be offline, or the network might have preferred a different fork. **The visualization should reflect this variability.**

---

## 2. Entity Inventory

### Validators

| Metric | Current Value |
|--------|---------------|
| **Total Active Validators** | ~3,248 (March 2025) |
| **Community-Run Validators** | 1,900+ independent |
| **Top 30 Validator Concentration** | <30% of total stake |
| **Max Single Validator Stake** | <3.2% of total |
| **Nakamoto Coefficient** | ~20-21 |
| **Average Stake per Validator** | ~620,000 SOL |

**Geographic Distribution:**
- USA: 18.3%
- Netherlands: 13.7%
- UK: 13.7%
- Germany: 13.2%
- 45+ other countries: remainder

**Visual Properties per Validator:**
- `activatedStake` (u64 lamports) → size
- `commission` (0-100) → color hue variation
- `lastVote` (most recent voted slot) → activity/brightness
- `rootSlot` (last finalized slot) → reliability indicator
- `epochCredits` → performance history

### Slot/Leader Schedule Properties

| Property | Value |
|----------|-------|
| **Leader Slot Duration** | 400ms |
| **Consecutive Slots per Leader** | 4 slots = 1.6 seconds before rotation |
| **Total Leader Changes per Epoch** | 432,000 ÷ 4 = 108,000/epoch |
| **Schedule Availability** | Known in advance for entire epoch |
| **Schedule Determinism** | Stake-weighted: more stake = more frequent appearances |

### Vote Transactions

| Metric | Value |
|--------|-------|
| **Vote Tx as % of Total** | 60-75% (infrastructure traffic) |
| **Vote Transactions per Slot** | ~3,000+ (one per validator per slot) |
| **Vote Transactions per Epoch** | ~432,000 × ~3,248 = ~1.4 billion |

### Transaction Mix (Current 2026)

| Category | Daily Volume | % of Total | TPS Range |
|----------|-------------|------------|-----------|
| Non-Vote Transactions | 148 million | ~25-40% | 1,000-1,500 |
| Vote Transactions | ~310+ million | 60-75% | 2,000-2,500 |
| **Total (incl. votes)** | **~458+ million** | 100% | 3,500-4,000 |

### Shred Properties

| Property | Value |
|----------|-------|
| **Shred Size** | 1,228 bytes (max) |
| **Data Shreds per Block** | 32 |
| **Recovery Shreds per Block** | 32 |
| **FEC Threshold** | 32 of 64 (50% redundancy) |
| **Propagation Hops** | 2-3 average |
| **Propagation Time** | 100-200ms total |

---

## 3. API Assessment: Real-Time Data Access

### Public RPC Endpoints

**Public Mainnet (solana.com):**
- URL: `https://api.mainnet.solana.com`
- Rate limit: ~100 requests/10s per IP
- **Not suitable for production** — use paid provider

### WebSocket Subscriptions

| Method | Returns | Update Frequency |
|--------|---------|------------------|
| `slotSubscribe` | New slot number, leader, parent_slot, root | Every 400ms |
| `rootSubscribe` | Root slot (finalized blocks) | Every ~6-12s |
| `logsSubscribe` | Transaction logs (filtered by account/program) | Per transaction |
| `accountSubscribe` | Account data changes | Per update |

**Primary heartbeat:** `slotSubscribe` fires every ~400ms — perfect for driving visual animations.

### Key RPC Methods for DataSource

```
HTTP (polled every 1-2s):
├── getSlot() → current slot number
├── getLeaderSchedule(slot) → { validator_pubkey: [slot indices] }
├── getVoteAccounts() → array of validator info + stake + voting history
└── getEpochInfo() → { epoch, slotIndex, slotsInEpoch }

WebSocket (continuous):
├── slotSubscribe → { slot, leader, parent_slot, root }
├── rootSubscribe → { root }
└── logsSubscribe with vote account filter → vote activity per slot
```

### Recommended Providers

| Provider | Free Tier | Notes |
|----------|-----------|-------|
| **Helius** | 30M CU/month | Purpose-built Solana, gRPC streaming (LaserStream) |
| **Alchemy** | 30M CU/month | Most generous free tier, good WebSocket |
| **Triton One** | Paid | Ultra-low latency, Dragon's Mouth gRPC |

**Recommendation:** Start with **Helius** free tier. Sufficient for visualization data.

### What We CAN and CANNOT Get

✅ **Fetchable in real-time:**
- Current slot number + leader identity
- Full leader schedule for epoch
- All validator pubkeys + stake + commission + voting history
- Finality (root slot) progression

⚠️ **Possible but heavy:**
- Individual vote transaction details (3,000+ per slot)
- Full transaction accounts for user transactions

❌ **Not feasible:**
- Turbine tree topology (internal network)
- Exact block propagation paths and timing
- Gulf Stream transaction routing internals
- Real-time shred propagation

---

## 4. "Only on Solana" Moments

### 1. Proof of History as Universal Verifiable Timestamp
No other chain has this. Most chains rely on round-based consensus or external timestamps. Solana's PoH is a **self-verifying cryptographic clock embedded in the ledger itself**. The order and timing of transactions is cryptographically proven, not socially agreed upon.

**Visual potential:** Render the PoH hash chain as a glowing, infinitely extending timeline — like a DNA helix or fiber optic cable continuously growing, each link representing a tick or entry. This is uniquely Solana's.

### 2. Sub-Second Slot Duration: Fastest Heartbeat of Any Major Chain
- Solana: **400ms**
- Ethereum: 12,000ms
- Cosmos: 6,000+ms
- Avalanche: 1,000-2,000ms

The 400ms slot creates an **extremely fast consensus cycle** that must be felt in the visualization. This should feel electric, not contemplative.

### 3. Mempool-Less Predetermined Leader Schedule
The leader schedule is known **432,000 slots in advance**. Transactions flow in predictable, directed streams — not chaotic pools. This determinism is visually expressible as ordered flows converging on upcoming leaders.

### 4. Parallel Execution via Upfront Account Declaration
Every transaction declares all accounts it will touch. Sealevel schedules non-conflicting transactions in parallel across CPU cores. True multi-threaded blockchain execution — visualizable as multiple simultaneous processing lanes.

### 5. Jito MEV Monopoly as Network Feature
88% of network stake runs the Jito-Solana client. Jito controls the MEV relay, block engine, and staking. Creates a de facto MEV marketplace built into consensus. Bundles (atomic transaction groups) are Solana-native — a secondary auction layer above normal consensus.

---

## 5. Visual Direction Proposals

### Proposal 1: "The Chronicle" — Temporal DNA Helix

**Central metaphor:** A double-helix DNA strand representing the PoH hash chain. Two strands intertwine:
1. **Inner strand (white/silver):** The PoH hash chain itself — ticks as beads, entries as clusters
2. **Outer strand (dynamic color):** Validator voting activity spiraling around it

**How PoH becomes visible:** Glowing DNA double helix continuously extending. Each tick = one bead. Entries are slightly thicker clusters of ticks. The helix *never branches* — perfectly linear.

**How leader rotation looks:** A spotlight/laser beam rotates around the helix every 400ms. The current leader is illuminated; 3 upcoming leaders glow dimly ahead.

**Vote transaction treatment:** Outer helix strand is made of individual validator votes. 3,000+ thin colored threads spiral around the core PoH helix. Vote weight represented by thread thickness (stake = thickness).

**Turbine propagation:** When a block is built, ripples emanate outward from the helix. Ripples propagate through concentric rings (each ring = one Turbine hop).

**Emotional register:** Organic, alive, flowing, orderly yet layered. The helix suggests *continuity and inevitability* — this is the unbreakable timeline.

**Structural honesty:** PoH is Solana's most unique feature; it deserves the center. The helix is a real topological structure (hash chain is linear). Voting spiraling around the core reflects the actual role of consensus atop PoH.

**Ambition level:** Medium

---

### Proposal 2: "Velocity Field" — Electromagnetic Particle Accelerator

**Central metaphor:** A particle accelerator or tokamak (magnetic confinement fusion device). The network is a magnetic field that accelerates transactions through concentric rings.

**Core structure:**
- Central axis: PoH clock (pulsing electromagnetic field)
- Ring 1 (innermost): Leaders rotating around the axis
- Ring 2: Validators (3,248 points of light)
- Ring 3: Turbine propagation layer
- Ring 4 (outer): Transaction entry/exit points (RPC nodes)

**How PoH becomes visible:** Every 6.25ms (tick), the core emits a burst of energy. Every 400ms (slot), a larger pulse marks the leadership change.

**How leader rotation looks:** A charged particle rotates around the central axis every 400ms. As it rotates through Ring 1, validators in the path light up in preparation.

**Vote transaction treatment:** Votes are secondary particles orbiting in a separate, higher-energy track. They form a dense plasma around the validator ring, creating a feedback loop back toward the leader.

**Sealevel parallel execution:** Multiple transaction beams enter the accelerator simultaneously. Non-conflicting beams pass through parallel channels. Conflicting transactions collide and queue, creating localized energy bursts.

**Emotional register:** Fast, powerful, energetic, slightly chaotic but controlled. Immense forces held in balance. Suggests raw computational power.

**Structural honesty:** Concentric ring structure maps to actual network topology. Central pulsing PoH is the energy source. Parallel channels represent Sealevel's actual parallelism.

**Ambition level:** High — sophisticated particle systems, field simulation, potentially performance-intensive

---

### Proposal 3: "The Forge" — High-Tech Assembly Line *(Most Architecturally Honest)*

**Central metaphor:** A high-tech manufacturing assembly line with conveyor belts, robotic arms, inspection stations, and quality control checkpoints.

**Layout:**
```
Input Stations (RPC nodes)
    ↓
Conveyor Belt 1: Gulf Stream (transactions → upcoming leaders)
    ↓
Station A: Leader Processing (Sealevel parallel lanes)
    ├── Lane 1: Transaction A, C, E (non-conflicting)
    ├── Lane 2: Transaction B, D (different accounts)
    └── (executing in parallel within one slot)
    ↓
Station B: PoH Stamping (entry creation, hash chain extension)
    ↓
Station C: Block Finalization
    ↓
Conveyor Belt 2: Turbine Distribution (shreds → validators)
    ├── Hop 1: First-layer validators
    ├── Hop 2: Second-layer validators
    └── Hop 3: Leaf validators
    ↓
Station D: Reconstruction & Validation
    ↓
Station E: Voting (vote transactions flowing back upstream)
    ↓
Quality Control: Finality checkpoint
    ↓
Output: Finalized ledger state
```

**How PoH becomes visible:** Each station has a mechanical clock synchronized by the central PoH timer. Belt speed = PoH tick rate. Entries are "stamped" onto moving packages as they pass through Station B.

**How leader rotation looks:** The leader is a robotic arm that rotates around a turntable. Every 400ms, the arm moves to the next position. 4 consecutive slots = the arm performs 4 cycles on the same batch.

**Vote transaction treatment:** Votes are special high-priority packages on a separate, faster return conveyor. They create a visible feedback loop: transaction → processing → voting → new transaction.

**Emotional register:** Mechanical, precise, industrial, relentless. Like a Swiss watchmaker's workshop meeting a car factory. Deterministic and fair.

**Structural honesty:** This is the most architecturally accurate metaphor. Every element maps directly to a real system component. Assembly line = actual transaction pipeline stages. Parallel lanes = actual Sealevel parallelism.

**Ambition level:** Medium-to-High

---

### Proposal 4: "The Strata" — Crystal Formation *(Most Experimental)*

**Central metaphor:** A growing crystal formation or geological stratum. The blockchain is a mineral crystallizing in real-time, layer by layer. Validators are the crystal lattice points. Transactions are atoms being incorporated.

**Structure:** A landscape simultaneously:
1. A growing crystal (PoH hash chain = crystal axis)
2. A geology with layers (each slot = new stratum)
3. Mineral deposits scattered across the landscape (validators)
4. Seismic waves rippling through the ground (Turbine propagation)

**How PoH becomes visible:** Central crystal axis grows vertically every tick. Each tick = one additional crystal segment. Every 64 ticks (one slot), a thicker crystalline layer forms. The crystal is flawless and perfectly ordered — no cracks, no branches.

**How leader rotation looks:** A bright spot rotates around the crystal's circumference at 400ms intervals. As it passes over nearby validator deposits, they begin to glow in anticipation (upcoming leaders).

**Vote transaction treatment:** Validators are mineral deposits scattered around the formation. When they vote, they emit colored light that converges toward the crystal axis. Creates a radial glow pattern.

**Turbine propagation:** When a block finalizes, a seismic wave emanates from the central crystal. Ripples outward in expanding rings. Validators illuminate and darken in sequence as the wave passes.

**Finality:** As blocks finalize, recent layers are translucent and glowing. Older layers become opaque and solid (finalized, immutable). A visible gradient from glowing (recent) to dark (ancient).

**Emotional register:** Alive, organic, patient, ancient. Feels like geological time despite operating at millisecond speed. Meditative, almost sacred. Strikingly different from existing blockchain visualization.

**Structural honesty:** Crystal axis = linear, unbranching PoH chain. Layers = actual temporal structure. Mineral deposits = validators. Seismic waves = Turbine propagation. Hardening = finality progression.

**Ambition level:** Very High — requires procedural crystal growth algorithms, wave simulation, light baking. Potentially stunning.

---

## 6. Performance Notes

### Entity Counts & Rendering

| Entity | Count | Rendering Approach |
|--------|-------|-------------------|
| Validators (as nodes) | ~3,248 | Very manageable with instancing |
| Vote transactions per slot | ~3,000+ | Aggregate — don't render individually |
| Shreds per block | 64 | Manageable as ephemeral particles |
| Entries per slot | 10-100s | Procedural segments |

### Update Frequency Strategy

**Tier 1: Every ~400ms (WebSocket `slotSubscribe`):**
- Current slot number
- Current leader identity
- Next 4 upcoming leaders (derived from cached schedule)

**Tier 2: Every 5-10 seconds:**
- All validator stake + commission (`getVoteAccounts`)
- Root slot / finality indicator (`rootSubscribe`)

**Tier 3: Once per epoch (~2 days):**
- Full leader schedule (`getLeaderSchedule`)
- Epoch info (`getEpochInfo`)

**Tier 4: Aggregated/sampled:**
- Vote activity: aggregate into per-validator per-slot vote counts (did validator X vote? yes/no)
- Transaction activity: use performance samples, not individual transactions

### Key Technical Constraint

The visualization **cannot show:**
- Real-time Turbine tree topology (internal network, not exposed via RPC)
- Exact transaction routing within Gulf Stream
- Block propagation timing details
- MEV/Jito bundle processing

**It can show:**
- Validator identities, stake, commission, voting activity
- Leader rotation on schedule
- Finality progression
- Aggregate transaction throughput
- PoH clock ticking (derived from slot progression)

### Polygon Budget by Proposal

| Proposal | Est. Total Triangles | Performance |
|----------|---------------------|-------------|
| Chronicle (Helix) | ~60-80k | Mid-range GPU capable |
| Velocity Field | ~100-120k | Requires optimization |
| The Forge | ~50-70k | Most performant |
| The Strata | ~80-100k | Heaviest (wave simulation) |

All four are achievable on mid-range GPUs (RTX 3060+, M1 Pro+) at 60 FPS with proper WebGL optimization.

---

## 7. Recommendation

**Primary direction: "The Forge"** — most architecturally honest, most achievable, every visual element maps to a real system component.

**Ambitious fallback: "The Strata"** — most visually distinctive from anything existing, strikingly beautiful if executed well.

**Avoid:** "The Chronicle" (nested helices without major payoff) and "Velocity Field" (too abstract, loses connection to what's actually happening).

The **key visual truth** to preserve: Solana's 400ms heartbeat must be *felt*, not just observed. Whatever metaphor is chosen, the rhythm of leader rotation should drive the entire composition.

---

*Sources: Solana docs, Helius blog, Anza Labs documentation, Solana Beach validator stats, Helius decentralization report, Solana Compass, QuickNode Alpenglow coverage, RPC provider documentation.*

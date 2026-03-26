# The Strata — Phase 1+2 Design Spec

## Context

We're building a real-time 3D WebGL visualization of the Solana blockchain rendered as a growing crystal formation. This is the second entry in the "Cosmos Explorers" series after Galaxy of Nodes (MultiversX). The crystal metaphor maps Solana's linear Proof of History chain to a crystalline column, validators to mineral deposits, block propagation to seismic waves, and finality to crystallization (translucent → opaque).

This spec covers **Phase 1 (static formation) and Phase 2 (animation with mock data)**. Live API integration, full interaction, and polish are deferred to later phases.

**Emotional target:** Watching something ancient and inevitable happen at impossible speed. A crystal forming in geological time, compressed into seconds.

---

## Tech Stack

- **Three.js** (r183+) — 3D rendering
- **Vite** (v6+) — dev server and build
- **TypeScript** (v5.7+) — language
- **Vanilla** — no React, no framework wrappers
- **Custom GLSL** — vertex + fragment shaders for all visual elements
- **EffectComposer** — post-processing pipeline

---

## Architecture Overview

### File Structure

```
Strata Explorer/
├── index.html
├── vite.config.ts
├── package.json
├── tsconfig.json
└── src/
    ├── main.ts                     # Entry point, WebGL check, bootstrap
    ├── scene/
    │   ├── Strata.ts               # Main scene orchestrator (async factory)
    │   ├── CrystalAxis.ts          # PoH crystal column
    │   ├── ValidatorCloud.ts       # Instanced validator mineral deposits
    │   ├── LeaderSpotlight.ts      # Current leader highlight
    │   ├── SeismicWave.ts          # Turbine propagation ripple
    │   ├── Background.ts           # Dark void + ambient dust
    │   └── PostProcessing.ts       # Bloom, color grading, vignette, grain
    ├── shaders/
    │   ├── crystal.vert / .frag    # Crystal axis
    │   ├── mineral.vert / .frag    # Validator points
    │   ├── particle.vert / .frag   # Transaction atoms
    │   ├── wave.vert / .frag       # Seismic wave disc
    │   ├── dust.vert / .frag       # Background dust particles
    │   └── postprocess/            # Color grading, vignette, grain, aberration
    ├── particles/
    │   └── TransactionPool.ts      # 800-slot object pool
    ├── data/
    │   ├── DataSource.ts           # Interface
    │   ├── MockData.ts             # Synthetic Solana data
    │   └── SimulationEngine.ts     # 400ms heartbeat driver
    ├── interaction/
    │   ├── CameraController.ts     # Orbit, zoom, auto-rotate
    │   ├── HUD.ts                  # Slot/epoch/validator/TPS overlay
    │   └── AudioController.ts      # Mute toggle (placeholder, no audio file)
    └── utils/
        ├── config.ts               # All magic numbers
        ├── colors.ts               # Color palette
        └── math.ts                 # Cylindrical distribution, lerp helpers
```

### Key Patterns (carried from Galaxy of Nodes)

1. **DataSource interface** — abstract interface with `MockSolanaData` implementation. The entire render pipeline is data-source-agnostic.
2. **Async factory** — `Strata.create(container, dataSource)` initializes data, then constructs the scene.
3. **Object pool** — `TransactionPool` pre-allocates 800 particle slots. No runtime allocation.
4. **SimulationEngine** — drives the 400ms heartbeat in mock mode; will accept live callbacks in Phase 3.
5. **Dirty-flag buffer updates** — only mark GPU buffers as `needsUpdate` when data actually changes.
6. **`dispose()` method** — `Strata.dispose()` tears down all subsystems (geometry, materials, textures, render targets, event listeners). Critical for Vite HMR to not leak WebGL contexts.
7. **`resize()` method** — `Strata.resize()` updates renderer size, camera aspect, composer, and resolution-dependent post-processing uniforms.
8. **`frustumCulled = false`** — Set on all `Points` objects (ValidatorCloud, TransactionPool, Background dust). Without this, Three.js culls entire point clouds when their bounding sphere leaves the frustum.

### Shader Format

Shaders are stored as TypeScript files exporting template literal strings (same as Galaxy), not separate `.vert`/`.frag` files. This avoids needing a Vite GLSL plugin. Example: `crystal.ts` exports `crystalVertexShader` and `crystalFragmentShader` as strings. The file structure listing above uses `.vert/.frag` as conceptual labels — the actual files are `.ts`.

### Entry Point (`main.ts`)

- WebGL detection: test for `webgl2` context, fallback to `webgl`
- On failure: show `#webgl-error` fallback message
- Data mode: `?data=mock` (default for Phase 1+2)
- Main loop: `requestAnimationFrame` with delta time capped at 0.1s
- Resize handler: `window.addEventListener('resize', () => strata.resize())`

### Reference Files

| Pattern | Galaxy of Nodes file |
|---|---|
| Scene orchestrator | `Galaxy Explorer/src/scene/Galaxy.ts` |
| Validator rendering | `Galaxy Explorer/src/scene/ValidatorField.ts` |
| Particle pool | `Galaxy Explorer/src/particles/TransactionPool.ts` |
| DataSource interface | `Galaxy Explorer/src/data/DataSource.ts` |
| Mock data | `Galaxy Explorer/src/data/MockData.ts` |
| Simulation engine | `Galaxy Explorer/src/data/SimulationEngine.ts` |
| Star shader (→ mineral) | `Galaxy Explorer/src/shaders/star.ts` |
| Particle shader | `Galaxy Explorer/src/shaders/particle.ts` |
| Metachain shader (→ crystal) | `Galaxy Explorer/src/shaders/metachain.ts` |
| Post-processing | `Galaxy Explorer/src/shaders/postprocessing.ts` |
| Config | `Galaxy Explorer/src/utils/config.ts` |

---

## Rendering Systems

### 1. Crystal Axis (`CrystalAxis.ts`)

**What it represents:** Solana's Proof of History hash chain — a perfectly linear, unbranching sequence of slots.

**Geometry:** Ring buffer of `MAX_SEGMENTS = 200` cylindrical segments in a single `BufferGeometry`. Each segment is two circles of vertices (top/bottom cap) connected by triangle strips. 32 radial subdivisions per ring → ~12,800 vertices total. Single draw call.

**Ring buffer mechanics:**
- `headIndex` tracks the newest segment. On new slot, write vertices at `headIndex`, increment mod `MAX_SEGMENTS`.
- A `uScrollOffset` uniform in the vertex shader shifts all segments downward — no per-frame vertex position updates.
- Only the newly written segment's vertices are touched on each slot tick.

**Per-vertex attributes:**
- `aSegmentAge` (float, 0.0–1.0): Drives the finality gradient in the fragment shader.
  - `< 0.3`: Translucent, bright emissive glow, subtle pulse → "still crystallizing"
  - `0.3–0.7`: Semi-translucent, dimming → "setting"
  - `> 0.7`: Opaque, dark, solid → "immutable bedrock"
- `aFlash` (float): Set to 1.0 on segment birth, decays exponentially over ~200ms. Creates a white-hot burst.
- `aMissed` (float): 1.0 for missed slots → shader renders as darker gap.

**Shader (`crystal.vert` / `crystal.frag`):**
- Based on Galaxy's metachain shader (Fresnel rim glow, FBM surface noise)
- `aSegmentAge` drives alpha, emissive intensity, and surface noise amplitude
- `aFlash` adds white-hot additive burst
- Prismatic edge refraction: `vec3 rainbow = 0.5 + 0.5 * cos(6.28 * (fresnel * 2.0 + vec3(0.0, 0.33, 0.67)))`
- Young segments have stronger Fresnel glow; finalized segments are matte

**Buffer updates per frame:** Only ~30 crystallizing segments' `aSegmentAge` values + flash decay on ~5 segments. Finalized segments never update.

### 2. Validator Cloud (`ValidatorCloud.ts`)

**What it represents:** ~3,248 Solana validators as glowing mineral deposits surrounding the crystal.

**Geometry:** `THREE.Points` with `BufferGeometry` + custom `ShaderMaterial`. Same instanced-point approach as Galaxy's `ValidatorField`.

**Distribution:** Cylindrical cloud around the crystal axis.
- Radius: 80–150 units (inner–outer), per handoff spec
- Height: ±50 units
- Position: `(r * cos(θ), y, r * sin(θ))` with some Gaussian noise for organic clustering

**Per-instance attributes:**
- `position` (vec3): Cylindrical distribution
- `aSize` (float): From `activatedStake` (log scale, range ~2–12 px)
- `aColor` (vec3): Commission-based hue. Base warm amber `(1.0, 0.75, 0.3)`. Low commission shifts green, high commission shifts red.
- `aBrightness` (float): From `lastVote` recency (1.0 = just voted, decays)
- `aPhase` (float): Random per-validator, drives shimmer offset
- `aLeaderPulse` (float): 1.0 on current leader, decays. Triggers spotlight ring effect.
- `aVotePulse` (float): Set to 1.0 for validators that voted in the latest slot (~95%), decays over ~300ms. Creates network-wide breathing.
- `aUpcomingLeader` (float): 0.3–0.6 for the next 3–4 scheduled leaders (dimmer for further out). Shows the upcoming leader schedule as a faint pre-glow.

**Strata Breathing:** A slow global vertical oscillation (sine wave, ~8s period, ±1–2 units amplitude) applied to the entire validator cloud via a `uBreathOffset` uniform in the vertex shader. Equivalent to Galaxy's cluster breathing — prevents static feel even when no slot events fire.

**Shader (`mineral.vert` / `mineral.frag`):**
- Adapted from Galaxy's star shader
- Multi-frequency shimmer (3 sine waves with different frequencies per `aPhase`)
- Leader spotlight: animated ring pulse (like Galaxy's proposer flare)
- Seismic wave interaction: reads `uWaveOrigins[4]` / `uWaveTimes[4]` uniforms, adds brightness bump as wavefront passes
- Soft glow core + diffraction spikes for large/bright validators
- Additive blending, no depth write

### 3. Seismic Waves (`SeismicWave.ts`)

**What it represents:** Turbine block propagation — the wave of data spreading from the block producer to all validators.

**Geometry:** A single flat disc mesh (large enough to cover the validator cloud, ~200 unit radius). Custom shader draws expanding rings.

**Wave management:** Ring buffer of 4 wave slots.
```
{ origin: vec3, birthTime: float, active: boolean }
```

**Uniforms shared with validator cloud:**
- `uWaveOrigins[4]` (vec3[])
- `uWaveTimes[4]` (float[])
- `uWaveCount` (int)

**Shader (`wave.vert` / `wave.frag`):**
- For each active wave: compute ring at `radius = age * WAVE_SPEED`
- Gaussian falloff: `exp(-pow(dist - radius, 2.0) / ringWidth²)`
- Fade with age: `1.0 - smoothstep(0.0, MAX_LIFETIME, age)`
- Additive blending, subtle warm glow color

**Validator interaction:** The mineral shader reads the same wave uniforms and adds a brightness bump when the wavefront is near each validator's position. This makes validators "light up" as the wave passes through.

### 4. Transaction Particles (`TransactionPool.ts`)

**What it represents:** User transactions (non-vote) being ingested and incorporated into blocks.

**Pool:** 800 pre-allocated slots. Same recycling pattern as Galaxy.

**Particle lifecycle:**
1. **Spawn:** Random point beyond the validator cloud (r = 160, random θ and y) — outside the cloud to show ingestion from the network edge
2. **Travel:** Linear lerp toward current leader's world position
3. **Arrival:** Flash (brightness 2.0, size 1.5x for one frame), then deactivate

**Color mapping:**
- Gold `(1.0, 0.85, 0.4)` — SOL transfers (40%)
- Cyan `(0.3, 0.85, 1.0)` — Program interactions (30%)
- Purple `(0.85, 0.4, 1.0)` — Token transfers (20%)
- Green `(0.3, 1.0, 0.6)` — DeFi operations (10%)

**Per-particle attributes:** position, color, size, brightness, life (same as Galaxy). Value → brightness + size on log scale.

**Shader (`particle.vert` / `particle.frag`):** Carried from Galaxy — soft glow core, white-hot center, life-based fade, size attenuation.

### 5. Background (`Background.ts`)

**Minimal dark void** (intentionally sparse for Phase 1+2 — cavern texture deferred to Phase 5 polish):
- Near-black clear color `(0.02, 0.015, 0.03)` with slight purple tint
- ~500 ambient dust particles (simple `THREE.Points` with small random drift)
- Subtle fog gradient (darkening toward edges)

### 6. Post-Processing (`PostProcessing.ts`)

**Pipeline (same as Galaxy):**
1. **UnrealBloomPass** — crystal edges and active elements glow
2. **Color grading** — warm amber/teal palette, lift/gamma/gain
3. **Vignette** — radial darkening, subtle deep blue edge tint
4. **Film grain** — hash-based procedural, luminance-masked
5. **Chromatic aberration** — radial RGB channel separation

---

## Data Layer

### DataSource Interface (`DataSource.ts`)

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
  getRootSlot(): number;
  getEpochInfo(): EpochInfo;
}

interface SolanaCallbacks {
  onSlot: (slot: number, leader: string, missed: boolean) => void; // `missed` added vs handoff — needed for crystal gap rendering
  onValidatorsUpdated: (validators: ValidatorInfo[]) => void;
  onTransactions: (txs: TransactionInfo[]) => void;
  onRootAdvance: (rootSlot: number) => void;
}

interface ValidatorInfo {
  pubkey: string;
  name: string;
  stake: number;           // in SOL
  commission: number;      // 0-100
  lastVote: number;        // slot number
  epochCredits: number;
  position: { x: number; y: number; z: number };
  index: number;
}

interface TransactionInfo {
  signature: string;
  type: 'transfer' | 'program' | 'token' | 'defi';
  value: number;           // in SOL (log-scale for brightness)
}

interface EpochInfo {
  epoch: number;
  slotIndex: number;
  slotsInEpoch: number;
}
```

### MockSolanaData (`MockData.ts`)

**Validator generation (on init):**
- Count: 3,248
- Stake: log-normal distribution, median ~620K SOL, range 10K–10M
- Commission: 0–10%, clustered around 5–7%
- Names: pool of real Solana validator names
- Pubkeys: random base58 strings
- Positions: cylindrical distribution (see ValidatorCloud section)

**Leader schedule:**
- Stake-weighted random selection
- Each leader serves 4 consecutive slots (1.6s)
- Pre-generated for the epoch

### SimulationEngine (`SimulationEngine.ts`)

**400ms heartbeat loop:**
1. Advance slot counter
2. Check leader schedule → pick leader (or mark missed at 5% rate)
3. Generate 5–20 user transactions with type distribution (40/30/20/10)
4. Mark 95–98% of validators as voted
5. If `currentSlot - rootSlot > 30`, advance root (finality)
6. Every ~30s, trigger intensity burst (2x transaction rate for ~5s)
7. Fire callbacks: `onSlot`, `onTransactions`, `onRootAdvance`

---

## Interaction (Phase 1+2 scope)

### Camera (`CameraController.ts`)
- Default: slightly angled side view, crystal growth point centered
- Orbit controls: drag to rotate, scroll to zoom
- Zoom range: 15–200 units
- Auto-orbit: slow rotation resumes after 15s of inactivity

### HUD (`HUD.ts`)
- Top-left: `SLOT [number]` / `EPOCH [number]`
- Top-right: `[count] VALIDATORS` / `[count] TPS`
- Bottom-center: `NETWORK ACTIVITY` label + TPS bar (animated fill width proportional to current TPS / max TPS)
- HTML overlay, pointer-events: none
- Responsive: tighter margins on mobile (16px vs 28px)
- Note: Legend button (bottom-left) and info overlay toggle (top-center) are deferred to Phase 4

### Audio Toggle (`AudioController.ts`)
- Bottom-right mute/unmute button
- Wired up but no audio file — placeholder for Phase 5

---

## The 400ms Heartbeat (Animation Sequence)

Every 400ms, one slot tick fires this cascade:

1. **Crystal grows** — new segment appears at top with white flash, `aFlash = 1.0`
2. **Seismic wave spawns** — expands outward from crystal axis at ~200 units/sec
3. **Validators pulse** — ~95% get `aVotePulse = 1.0`, decays over 300ms
4. **Leader spotlight moves** — every 4th pulse (1.6s), `aLeaderPulse` sweeps to next leader
5. **Transactions spawn** — 5–20 particles appear at cylinder edge, drift toward leader
6. **Finality hardens** — segments 30 slots back cross `age > 0.7` threshold → opaque

Between ticks, the render loop at 60fps:
- Decays `aFlash`, `aVotePulse`, `aLeaderPulse`
- Advances particle positions (lerp toward leader)
- Expands seismic wave radii
- Updates shimmer oscillation via `uTime`

---

## Performance Budget

| System | Draw Calls | Vertices | Buffer Updates/Frame |
|---|---|---|---|
| Crystal Axis | 1 | ~12,800 | ~30 segment ages + flash decay |
| Validator Cloud | 1 | 3,248 | brightness, pulse (dirty flag) |
| Seismic Waves | 1 | ~100 | uniforms only |
| Transaction Pool | 1 | 800 | all active particle attrs |
| Background Dust | 1 | ~500 | drift positions |
| Post-processing | ~8–10 | fullscreen | uniforms only (UnrealBloom uses multiple internal blur passes) |
| **Total** | **~14–16** | **~17.5K** | **Well within 60fps** |

Galaxy of Nodes renders 3,200 validators + 800 particles + 80,000 background stars + 3,000 dust + bloom at 60fps. The Strata adds ~13K crystal vertices but removes the 80K starfield. Net GPU load is comparable or lighter.

---

## What's Deferred

| Component | Phase |
|---|---|
| LiveDataSource (Helius RPC) | Phase 3 |
| Raycaster (click validators/crystal) | Phase 4 |
| InfoOverlay (leader name, tx feed) | Phase 4 |
| Legend panel | Phase 4 |
| Tooltip (validator details) | Phase 4 |
| Audio file / soundtrack | Phase 5 |
| OG tags, favicon, README | Phase 5 |
| Mobile responsiveness polish | Phase 5 |
| Vercel deployment | Phase 5 |

---

## Verification

1. `npm run dev` → opens at localhost:5173
2. Crystal column grows upward every 400ms with visible finality gradient
3. ~3,248 validator points shimmer in a cylindrical cloud
4. Leader spotlight moves every 1.6s
5. Seismic wave rings expand outward on each slot
6. Transaction particles drift from edges toward leader, flash on arrival
7. Post-processing: bloom glow on crystal + active validators, vignette, grain visible
8. 60fps on mid-range hardware (check with browser DevTools performance panel)
9. No runtime allocation warnings in console

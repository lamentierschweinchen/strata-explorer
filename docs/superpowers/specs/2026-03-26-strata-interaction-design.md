# Strata Explorer — Interaction & Data Flow Design

**Date:** 2026-03-26
**Scope:** Visible data flow, raycaster exploration, info overlay, legend
**Data source:** Mock data (LiveDataSource deferred)
**Builds on:** Phase 1+2 (static crystal + animation, already complete)

---

## 1. Visible Data Flow

### 1.1 Leader Beam

A bright animated energy line connecting the current leader validator to the crystal's growth point (top of the axis).

**Geometry:** A screen-aligned billboard quad (two-triangle mesh) stretched between the leader position and the crystal growth point, with a custom `ShaderMaterial`. This avoids the complexity of `THREE.Line2`/`LineMaterial` (which don't support custom shaders) while giving full control over width, glow, and animation.

The quad's 4 vertices are computed each frame from the two endpoints, expanded perpendicular to the view direction by the desired beam width (~3-4 world units).

**Crystal growth point:** The crystal axis is centered at world origin `(0, 0, 0)`. The growth point is `(0, crystalAxis.getGrowthPointY(), 0)`. This Y value changes every slot (as new segments are added and scroll offset updates), so the beam endpoint must be updated **every frame** in the `update(dt)` call, not just on leader change.

**Visual:**
- Color: warm gold (#ffc850), matching the leader spotlight color
- Width: 3-4 world units with soft Gaussian falloff from center
- Animation: flowing dash pattern using `fract(vUv.x * 8.0 - uTime * 2.0)` with smoothstep edges
- Fade-in on leader change (~200ms), fade-out when leader rotates (~300ms)
- Only one beam active at a time

**Shader:** Vertex shader receives 4 corners of the billboard quad and passes UV coordinates (U along length, V across width). Fragment shader draws:
1. Soft Gaussian glow falloff across width (V axis)
2. Animated dashes along length (U axis)
3. Multiply by `uOpacity` uniform for fade transitions

**Uniform updates:**
- Quad vertex positions — updated every frame (leader pos + growth point Y)
- `uTime` — continuous
- `uOpacity` — lerped for fade-in (0→1 over 200ms) / fade-out (1→0 over 300ms)

### 1.2 Upcoming Leader Connections

Up to 4 dim connection lines from upcoming leaders to the crystal growth point.

**Visual:**
- Same billboard quad approach as leader beam, but thinner (1-2 world units), lower opacity (0.15-0.25)
- No dash animation — solid dim glow
- Color: muted gold, rgba(255, 200, 80, 0.2)
- Update positions every frame (growth point moves)

**Implementation:** A single `THREE.BufferGeometry` with 4 quads (16 vertices, 8 triangles). Shares the beam shader with different uniform values. Vertices for unused lines (fewer than 4 upcoming leaders) are collapsed to zero-area triangles.

### 1.3 Transaction Particle Flow Direction

Currently particles spawn from a random point on the cloud edge (r=160) and travel to the leader position. Change the flow so particles tell the right story:

**New flow:** Particles spawn FROM the leader validator's position and travel TO the crystal growth point `(0, growthPointY, 0)`.

**Modification to `TransactionPool.spawn()`:**
- `startPos` = leader position + random offset (±5 units in XZ, ±3 units in Y) for visual spread
- `endPos` = `(0, crystalGrowthPointY, 0)` — the crystal's current growth point
- The `leaderPos` parameter already passed from `Strata.onTransactions` becomes the spawn origin
- Add a `crystalTarget: THREE.Vector3` parameter for the endpoint

**Modification to `Strata.onTransactions`:**
- Pass both `leaderPos` and crystal growth point to `TransactionPool.spawn()`

### 1.4 Draw Call Budget

- +1 draw call for leader beam quad
- +1 draw call for upcoming leader lines (4 quads in one geometry)
- Net: ~16-18 total draw calls (from ~14-16)

---

## 2. Raycaster + Tooltips

### 2.1 Raycaster (`src/interaction/Raycaster.ts`)

Hover and click detection on `ValidatorCloud.points`.

**Pattern:** Matches Galaxy Explorer's `Raycaster.ts`.

**Setup requirements:**
- Call `ValidatorCloud.points.geometry.computeBoundingSphere()` after initial vertex population
- `THREE.Raycaster` with `params.Points.threshold = 2.0` (starting value — will need tuning based on camera distance; validators at r=80-150 from camera at r=180 means ~30-100 unit distances)

**Desktop:**
- Mouse position normalized to NDC on `mousemove`
- On intersection: cursor changes to `pointer`, fires `onHover(validatorIndex)` callback
- On no intersection: cursor resets, fires `onHoverEnd()`
- On `click`: fires `onClick(validatorIndex)` callback

**Mobile:**
- `touchstart`/`touchend` with distance threshold (20px) to distinguish taps from drags
- Tap triggers `onClick` callback (no separate hover on mobile)
- Tooltip shown for 3s then fades; subsequent taps reset the timer and switch to new validator
- Click-to-zoom also fires on tap (same as desktop click)

**Performance:**
- Raycaster runs every frame on desktop (cheap for Points geometry)
- `frustumCulled = false` already set on all Points objects

### 2.2 Tooltip (`src/interaction/Tooltip.ts`)

Floating dark panel near cursor showing validator data.

**DOM structure:** Appended to `#hud` container (already exists in index.html). Removed on `dispose()`.

**Styling:**
- Background: `rgba(5, 5, 16, 0.85)`
- Border: `1px solid rgba(255, 255, 255, 0.1)`
- Backdrop filter: `blur(8px)`
- Border radius: 6px
- Font: SF Mono / Fira Code / monospace, 11px
- Max width: 280px
- Pointer-events: none
- Z-index: 20
- Opacity transition: 0.15s

**Content layout:**
```
Validator #1847
─────────────────────────
STAKE          2,847,392 SOL
COMMISSION              5%
LAST VOTE      280,000,142
EPOCH CREDITS      348,291
STATUS            ● Active
```

- Validator name/index as header (13px, bold)
- Grid layout: label (left, dim, 9px uppercase) + value (right-aligned)
- Status derived from `lastVote` recency: "Active" (green #4ade80) if `lastVote >= currentSlot - 5`, "Delinquent" (red #ef4444) otherwise
- If validator is current leader, show gold "★ LEADER" badge below name

**Positioning:**
- 16px offset from cursor
- Flip horizontally/vertically if tooltip would exceed viewport bounds

**Data source:** `MockSolanaData.getValidator(index)` provides stake, commission, lastVote, epochCredits.

**Phase 5 placeholder:** Reserved space at bottom (below a thin separator) for sparkline vote history — last 10 slots as small colored dots (voted/missed).

### 2.3 Click-to-Zoom

On validator click, smoothly animate camera to center the selected validator.

**Animation:**
- Duration: 1.2s
- Easing: ease-out cubic
- Camera moves to position offset from validator (not directly on top — offset by ~30 units toward the camera's current azimuth)
- Crystal remains visible in background

**Integration with CameraController:**
- Add `zoomToValidator(position: THREE.Vector3)` method
- Set `controls.enabled = false` during animation to prevent OrbitControls from fighting the programmatic camera movement
- Lerp both `camera.position` and `controls.target` simultaneously
- On animation complete: set `controls.enabled = true`, restart inactivity timer (15s)
- User can interrupt: any `mousedown`/`touchstart` during animation cancels it, re-enables controls immediately

---

## 3. Info Overlay

### 3.1 Toggle Button (`src/interaction/InfoOverlay.ts`)

**Position:** Top-center, same pattern as Galaxy Explorer.

**DOM:** Appended to `#hud`. Removed on `dispose()`. Event listeners removed on `dispose()`.

**Styling:**
- 32×32px circle
- Border: `1px solid rgba(255, 255, 255, 0.2)`
- Background: `rgba(5, 5, 16, 0.5)` with `blur(8px)`
- Content: italic "i" character
- Hover: brightened border and text

**Toggles visibility of:** leader label, transaction feed.

### 3.2 Leader Label

When overlay is active, show the current leader's name/index as a floating label near the leader beam's origin.

**Styling:**
- Font: monospace, 10px, uppercase, letter-spacing 1px
- Color: #ffc850 (gold)
- Text: `● LEADER: VALIDATOR #1203`
- Positioned via 3D→2D projection of leader's world position (uses `camera` and `renderer.domElement` for projection)

**Update:** Requires camera reference. Called from `InfoOverlay.update(dt, camera)` each frame when visible.

### 3.3 Transaction Feed

Right-side panel showing recent transactions in a slow scroll.

**DOM:** Appended to `#hud`. Removed on `dispose()`.

**Styling:**
- Width: 220px (desktop), 160px (mobile)
- Position: absolute, right 16px, top 50px (when overlay active)
- Same glass styling as tooltip (dark bg, blur, subtle border)

**Feed behavior:**
- Max 10 visible rows
- New transactions trickle in at ~800ms intervals regardless of actual TPS
- High-throughput bursts are queued (FIFO) and drip-fed into the display
- Oldest row fades out (opacity 0 over 300ms) as new row fades in at top
- Queue has max depth of 50; excess is silently dropped (not summarized)

**Transaction type changes:**

The existing `TransactionInfo.type` uses `'transfer' | 'program' | 'token' | 'defi'`. Update to more user-friendly types:

| Old type | New type | Display name | Color | Feed example |
|----------|----------|-------------|-------|-------------|
| `transfer` | `transfer` | Transfer | Gold #ffd700 | `● Transfer  2.4 SOL` |
| `program` | `defi` | DeFi Swap | Cyan #00e5ff | `● DeFi Swap  148 USDC` |
| `token` | `nft` | NFT Mint | Purple #aa66ff | `● NFT Mint  0.5 SOL` |
| `defi` | `stake` | Stake | Green #4cd964 | `● Stake  500 SOL` |

**Files affected by type change:**
- `src/data/DataSource.ts` — update `TransactionInfo.type` union: `'transfer' | 'defi' | 'nft' | 'stake'`
- `src/data/MockData.ts` — update type generation to match new names; keep same distribution (40/30/20/10)
- `src/utils/colors.ts` — rename `TX_PROGRAM`→`TX_DEFI`, `TX_TOKEN`→`TX_NFT`, add `TX_STAKE`; update `getTxColor()`
- `src/particles/TransactionPool.ts` — uses `getTxColor()` which will be updated automatically

**Amount display:** The existing `TransactionInfo.value` field is already populated by `MockSolanaData` via `logNormal(this.rng, 0, 2)`. Use this field directly — no new `amount` field needed. Add display formatting per type:
- Transfer/NFT/Stake: `value.toFixed(1) + ' SOL'`
- DeFi: `(value * 150).toFixed(0) + ' USDC'` (approximate SOL→USDC conversion)

**Filter pills:**
- Row of small pill buttons above the feed: ALL | TRANSFER | DEFI | NFT | STAKE
- Each pill has the type's color as background tint (15% opacity)
- Active pill has stronger background (30% opacity) and brighter text
- Clicking a filter:
  - Filters the feed to show only that type
  - Also dims non-matching 3D transaction particles by multiplying their `aColor` RGB values by 0.1 (with additive blending this makes them nearly invisible — acceptable since we want strong filtering, not subtle dimming)
  - "ALL" resets to default (all types visible, full color restored)

**Filter→particle integration:** InfoOverlay exposes a `getActiveFilter(): string` method. `Strata.update()` reads this and, if changed, iterates active particles in TransactionPool to scale their colors. No new attributes needed.

---

## 4. Legend

### 4.1 Legend Button

**Position:** Bottom-left corner.

**DOM:** Appended to `#hud`. Removed on `dispose()`.

**Styling:**
- Same circular button style as info overlay (32×32px, glass bg)
- Content: "?" character
- Click toggles legend panel

### 4.2 Legend Panel (`src/interaction/Legend.ts`)

**Position:** Bottom-left, above the button. Grows upward.

**DOM:** Appended to `#hud`. Removed on `dispose()`.

**Styling:**
- Same glass panel style: dark bg, blur, subtle border
- Width: 280px
- Padding: 16px
- Font: monospace, 11px

**Content — pure explanation, no live data:**

| Indicator | Label | Description |
|-----------|-------|-------------|
| ◆ (blue gradient) | Crystal Axis | Solana's block history. Bright top = recent slots. Dark base = finalized. |
| ● (gold, large) | Validators | Mineral deposits. Brighter = more stake. Size = network influence. |
| ━ (gold beam) | Leader Spotlight | The golden beam shows who's producing the current block. |
| ◌ (expanding ring) | Seismic Waves | Ripples when a new slot is confirmed by the network. |
| ● (multi-color) | Transactions | Particles flowing into the crystal. Gold = transfers, Cyan = DeFi, Purple = NFT, Green = staking. |
| ▬ (dark band) | Missed Slots | Dark gaps in the crystal where a leader failed to produce a block. |

**Layout:**
- Each item: colored indicator (left) + label (bold) + description (normal weight, slightly dimmer)
- Stacked vertically with 12px gap between items
- Subtle separator line between items

---

## 5. Integration: Strata.ts Wiring

### Constructor additions:
```
this.leaderBeam = new LeaderBeam();
this.scene.add(this.leaderBeam.mesh);       // beam quad
this.scene.add(this.leaderBeam.upcoming);    // upcoming leader quads

this.raycaster = new Raycaster(this.camera, this.renderer.domElement, this.validatorCloud.points);
this.tooltip = new Tooltip();
this.infoOverlay = new InfoOverlay();
this.legend = new Legend();
```

### Callback wiring (onSlot):
```
// After existing leader/crystal/wave updates:
this.leaderBeam.setLeader(leaderPos, this.crystalAxis.getGrowthPointY());
this.leaderBeam.setUpcoming(upcomingPositions, this.crystalAxis.getGrowthPointY());
this.infoOverlay.setLeader(leader);
```

### Callback wiring (onTransactions):
```
// Change spawn to: leader → crystal
for (const tx of txs) {
  this.transactionPool.spawn(tx, leaderPos, crystalGrowthPoint);
}
this.infoOverlay.pushTransactions(txs);
```

### Update loop order:
```
// Existing updates first (crystal, validators, waves, particles, bg)
this.crystalAxis.update(dt);           // updates growth point Y
this.leaderBeam.update(dt, this.crystalAxis.getGrowthPointY());  // needs growth Y
this.validatorCloud.update(dt);
this.seismicWave.update(dt);
this.transactionPool.update(dt);
this.background.update(dt);

// Interaction (needs camera state from cameraController.update)
this.cameraController.update(dt);
this.raycaster.update(this.camera);    // runs raycast, fires callbacks
this.infoOverlay.update(dt, this.camera);  // updates leader label projection
this.postProcessing.update(dt);
this.hud.update(dt);

// Filter sync
const filter = this.infoOverlay.getActiveFilter();
if (filter !== this.lastFilter) {
  this.transactionPool.applyFilter(filter);
  this.lastFilter = filter;
}
```

### Raycaster callbacks:
```
this.raycaster.onHover = (index) => {
  const v = this.dataSource.getValidator(index);
  if (v) this.tooltip.show(v, mousePos);
};
this.raycaster.onHoverEnd = () => this.tooltip.hide();
this.raycaster.onClick = (index) => {
  const pos = this.validatorCloud.getPosition(index);
  this.cameraController.zoomToValidator(pos);
};
```

### Dispose:
```
// Add to existing dispose():
this.leaderBeam.dispose();
this.raycaster.dispose();   // removes event listeners
this.tooltip.dispose();     // removes DOM element from #hud
this.infoOverlay.dispose(); // removes DOM elements + event listeners
this.legend.dispose();      // removes DOM elements + event listeners
```

---

## 6. File Plan

### New files:
| File | Purpose |
|------|---------|
| `src/scene/LeaderBeam.ts` | Leader beam billboard quad + upcoming leader connection quads |
| `src/shaders/beam.ts` | Vertex/fragment shaders for animated beam glow + dashes |
| `src/interaction/Raycaster.ts` | Hover/click detection on validator points |
| `src/interaction/Tooltip.ts` | Floating validator detail tooltip |
| `src/interaction/InfoOverlay.ts` | "i" toggle, leader label, transaction feed + filters |
| `src/interaction/Legend.ts` | Legend panel with visual explanations |

### Modified files:
| File | Changes |
|------|---------|
| `src/scene/Strata.ts` | Wire LeaderBeam, Raycaster, InfoOverlay, Legend; change tx spawn; filter sync |
| `src/particles/TransactionPool.ts` | Spawn from leader position → crystal growth point; add `applyFilter()` |
| `src/data/DataSource.ts` | Update `TransactionInfo.type` to `'transfer' \| 'defi' \| 'nft' \| 'stake'` |
| `src/data/MockData.ts` | Update type names to match new union; keep same distribution |
| `src/interaction/CameraController.ts` | Add `zoomToValidator()` with OrbitControls disable/enable |
| `src/utils/colors.ts` | Rename TX colors, add TX_STAKE, update `getTxColor()` |

### Not modified:
- Crystal shader, validator shader, wave shader — no changes needed
- PostProcessing — no changes needed

---

## 7. Performance Notes

- Raycaster on Points is cheap (~0.1ms per frame for 3,248 points)
- Leader beam is 1 draw call with minimal geometry (4 vertices)
- Upcoming leader quads: 1 draw call (16 vertices)
- HTML overlays (tooltip, feed, legend) are DOM elements, not 3D — zero GPU cost
- Transaction feed queue caps at 50 to prevent memory growth
- Filter dimming modifies existing `aColor` attribute values — dirty flag update, no new attributes or draw calls
- `computeBoundingSphere()` called once at init for raycaster fast-reject

---

## 8. Deferred to Phase 5

- Sparkline vote history in tooltip (last 10 slots as colored dots)
- Crystal segment hover with color-coded transaction types
- Crystal segment click → slot detail tooltip
- Transaction feed links to Solana explorer (requires real tx hashes)
- Audio feedback on interactions (click, hover)

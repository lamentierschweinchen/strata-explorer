# Strata Explorer — Interaction & Data Flow Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add visible data flow (leader beam), raycaster interaction (hover/click validators), transaction feed with filters, and legend overlay to the Strata Explorer.

**Architecture:** Three layers built bottom-up: (1) data model + color updates, (2) leader beam + particle flow changes, (3) DOM-based interaction overlays (tooltip, feed, legend). All new 3D elements are wired through Strata.ts orchestrator. All DOM elements attach to existing `#hud` container.

**Tech Stack:** Three.js r183+, TypeScript 5.7, Vite 6, custom GLSL shaders, vanilla DOM (no framework)

**Spec:** `docs/superpowers/specs/2026-03-26-strata-interaction-design.md`

**Testing approach:** This is a visual WebGL project with no test framework. Each task includes a visual verification step using the preview server. Run `npx vite` (port 5173) and check the browser.

---

## Chunk 1: Foundation + Visible Data Flow

### Task 1: Update Transaction Types and Colors

Update the data model from `program/token/defi` to `defi/nft/stake` to match the user-facing labels.

**Files:**
- Modify: `src/data/DataSource.ts` (line 36)
- Modify: `src/data/MockData.ts` (lines 194-199)
- Modify: `src/utils/colors.ts` (lines 11-14, 33-39)

- [ ] **Step 1: Update TransactionInfo type union**

In `src/data/DataSource.ts`, change line 36:
```typescript
// Before:
type: 'transfer' | 'program' | 'token' | 'defi';
// After:
type: 'transfer' | 'defi' | 'nft' | 'stake';
```

- [ ] **Step 2: Update color constants and getTxColor**

In `src/utils/colors.ts`, replace the TX color constants and function:
```typescript
// Transaction types
TX_TRANSFER: new THREE.Color(1.0, 0.85, 0.4),     // gold
TX_DEFI: new THREE.Color(0.3, 0.85, 1.0),          // cyan
TX_NFT: new THREE.Color(0.85, 0.4, 1.0),           // purple
TX_STAKE: new THREE.Color(0.3, 1.0, 0.6),          // green
```

Update `getTxColor` signature and cases:
```typescript
export function getTxColor(type: 'transfer' | 'defi' | 'nft' | 'stake'): THREE.Color {
  switch (type) {
    case 'transfer': return COLORS.TX_TRANSFER;
    case 'defi': return COLORS.TX_DEFI;
    case 'nft': return COLORS.TX_NFT;
    case 'stake': return COLORS.TX_STAKE;
  }
}
```

Also add a display name map and hex color map (needed by InfoOverlay later):
```typescript
export const TX_TYPE_DISPLAY: Record<string, string> = {
  transfer: 'Transfer',
  defi: 'DeFi Swap',
  nft: 'NFT Mint',
  stake: 'Stake',
};

export const TX_TYPE_HEX: Record<string, string> = {
  transfer: '#ffd700',
  defi: '#00e5ff',
  nft: '#aa66ff',
  stake: '#4cd964',
};
```

- [ ] **Step 3: Update MockData type generation**

In `src/data/MockData.ts`, replace lines 194-199:
```typescript
let type: TransactionInfo['type'];
if (roll < 0.4) type = 'transfer';
else if (roll < 0.7) type = 'defi';
else if (roll < 0.9) type = 'nft';
else type = 'stake';
```

- [ ] **Step 4: Verify — run dev server, confirm particles still render with correct colors**

Run: `npx vite` and check browser at localhost:5173.
Expected: Particles appear in gold, cyan, purple, green. No console errors.

- [ ] **Step 5: Commit**

```bash
git add src/data/DataSource.ts src/data/MockData.ts src/utils/colors.ts
git commit -m "refactor: rename transaction types to user-friendly names (defi/nft/stake)"
```

---

### Task 2: Create Beam Shader

Write the GLSL vertex/fragment shaders for the leader beam and upcoming leader connections.

**Files:**
- Create: `src/shaders/beam.ts`

- [ ] **Step 1: Write the beam shader pair**

Create `src/shaders/beam.ts`:
```typescript
// Leader beam shaders — billboard quad with animated dash pattern and glow

export const beamVertexShader = /* glsl */ `
  attribute vec2 aUv;

  varying vec2 vUv;

  void main() {
    vUv = aUv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const beamFragmentShader = /* glsl */ `
  varying vec2 vUv;

  uniform float uTime;
  uniform float uOpacity;
  uniform vec3 uColor;
  uniform float uDashEnabled;

  void main() {
    // Gaussian glow falloff across beam width (V axis: 0=edge, 0.5=center, 1=edge)
    float centerDist = abs(vUv.y - 0.5) * 2.0;
    float glow = exp(-centerDist * centerDist * 4.0);

    // Animated dash pattern along beam length (U axis)
    float dash = 1.0;
    if (uDashEnabled > 0.5) {
      float pattern = fract(vUv.x * 8.0 - uTime * 2.0);
      dash = smoothstep(0.3, 0.4, pattern) * (1.0 - smoothstep(0.6, 0.7, pattern));
      dash = mix(0.15, 1.0, dash); // dim between dashes, not invisible
    }

    float alpha = glow * dash * uOpacity;
    if (alpha < 0.001) discard;

    // Core is brighter white, edges take beam color
    vec3 coreColor = mix(uColor, vec3(1.0, 0.98, 0.95), glow * 0.4);

    gl_FragColor = vec4(coreColor * alpha, alpha);
  }
`;
```

- [ ] **Step 2: Commit**

```bash
git add src/shaders/beam.ts
git commit -m "feat: add beam GLSL shaders for leader connection"
```

---

### Task 3: Create LeaderBeam Scene Object

Billboard quad geometry that stretches between leader and crystal growth point, plus upcoming leader connections.

**Files:**
- Create: `src/scene/LeaderBeam.ts`

- [ ] **Step 1: Write LeaderBeam class**

Create `src/scene/LeaderBeam.ts`:
```typescript
import * as THREE from 'three';
import { beamVertexShader, beamFragmentShader } from '../shaders/beam';

/**
 * Renders a glowing energy beam from the current leader validator
 * to the crystal growth point, plus dim connection lines for
 * upcoming leaders.
 */
export class LeaderBeam {
  readonly mesh: THREE.Mesh;       // main leader beam
  readonly upcoming: THREE.Mesh;   // up to 4 upcoming leader lines

  private beamGeo: THREE.BufferGeometry;
  private beamMat: THREE.ShaderMaterial;
  private upcomingGeo: THREE.BufferGeometry;
  private upcomingMat: THREE.ShaderMaterial;

  private beamPositions: Float32Array;
  private beamUvs: Float32Array;
  private upcomingPositions: Float32Array;
  private upcomingUvs: Float32Array;

  // Current state
  private leaderPos = new THREE.Vector3();
  private growthY = 0;
  private targetOpacity = 0;
  private currentOpacity = 0;
  private beamWidth = 3.5;

  // Upcoming leader positions (up to 4)
  private upcomingLeaderPositions: THREE.Vector3[] = [];

  // Temp vectors
  private tmpDir = new THREE.Vector3();
  private tmpUp = new THREE.Vector3(0, 1, 0);
  private tmpPerp = new THREE.Vector3();

  constructor() {
    // --- Main beam quad (4 verts, 2 triangles) ---
    this.beamPositions = new Float32Array(4 * 3);
    this.beamUvs = new Float32Array(4 * 2);
    // UVs: U along length (0=leader, 1=crystal), V across width (0=left, 1=right)
    this.beamUvs.set([0, 0, 0, 1, 1, 0, 1, 1]);

    this.beamGeo = new THREE.BufferGeometry();
    this.beamGeo.setAttribute('position', new THREE.BufferAttribute(this.beamPositions, 3));
    this.beamGeo.setAttribute('aUv', new THREE.BufferAttribute(this.beamUvs, 2));
    this.beamGeo.setIndex([0, 1, 2, 2, 1, 3]);

    this.beamMat = new THREE.ShaderMaterial({
      vertexShader: beamVertexShader,
      fragmentShader: beamFragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uOpacity: { value: 0 },
        uColor: { value: new THREE.Color(1.0, 0.78, 0.31) }, // #ffc850
        uDashEnabled: { value: 1.0 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });

    this.mesh = new THREE.Mesh(this.beamGeo, this.beamMat);
    this.mesh.frustumCulled = false;

    // --- Upcoming leader quads (4 quads × 4 verts = 16 verts) ---
    this.upcomingPositions = new Float32Array(16 * 3);
    this.upcomingUvs = new Float32Array(16 * 2);
    for (let q = 0; q < 4; q++) {
      const base = q * 4 * 2;
      this.upcomingUvs.set([0, 0, 0, 1, 1, 0, 1, 1], base);
    }

    const upcomingIndices: number[] = [];
    for (let q = 0; q < 4; q++) {
      const b = q * 4;
      upcomingIndices.push(b, b + 1, b + 2, b + 2, b + 1, b + 3);
    }

    this.upcomingGeo = new THREE.BufferGeometry();
    this.upcomingGeo.setAttribute('position', new THREE.BufferAttribute(this.upcomingPositions, 3));
    this.upcomingGeo.setAttribute('aUv', new THREE.BufferAttribute(this.upcomingUvs, 2));
    this.upcomingGeo.setIndex(upcomingIndices);

    this.upcomingMat = new THREE.ShaderMaterial({
      vertexShader: beamVertexShader,
      fragmentShader: beamFragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uOpacity: { value: 0.2 },
        uColor: { value: new THREE.Color(1.0, 0.78, 0.31) },
        uDashEnabled: { value: 0.0 }, // no dashes on upcoming
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });

    this.upcoming = new THREE.Mesh(this.upcomingGeo, this.upcomingMat);
    this.upcoming.frustumCulled = false;
  }

  /** Set the current leader position. Called on slot change. */
  setLeader(leaderPos: THREE.Vector3, growthY: number): void {
    this.leaderPos.copy(leaderPos);
    this.growthY = growthY;
    this.targetOpacity = 1.0;
    this.currentOpacity = 0; // fade in from 0
  }

  /** Set upcoming leader positions. Called on slot change. */
  setUpcoming(positions: THREE.Vector3[], growthY: number): void {
    this.upcomingLeaderPositions = positions;
    this.growthY = growthY;
  }

  /** Update beam geometry every frame. Camera needed for billboard alignment. */
  update(dt: number, growthY: number, camera: THREE.Camera): void {
    this.growthY = growthY;
    this.beamMat.uniforms.uTime.value += dt;
    this.upcomingMat.uniforms.uTime.value += dt;

    // Fade opacity
    const fadeSpeed = this.targetOpacity > this.currentOpacity ? 5.0 : 3.3; // 200ms in, 300ms out
    this.currentOpacity += (this.targetOpacity - this.currentOpacity) * Math.min(fadeSpeed * dt, 1);
    this.beamMat.uniforms.uOpacity.value = this.currentOpacity;

    // Compute billboard quad for main beam
    const crystalTop = new THREE.Vector3(0, this.growthY, 0);
    this.computeQuad(this.leaderPos, crystalTop, this.beamWidth, camera, this.beamPositions, 0);
    (this.beamGeo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;

    // Compute quads for upcoming leaders
    const upcomingWidth = 1.5;
    for (let q = 0; q < 4; q++) {
      if (q < this.upcomingLeaderPositions.length) {
        this.computeQuad(
          this.upcomingLeaderPositions[q], crystalTop,
          upcomingWidth, camera, this.upcomingPositions, q * 4 * 3,
        );
      } else {
        // Collapse unused quad to zero-area
        for (let v = 0; v < 4 * 3; v++) {
          this.upcomingPositions[q * 4 * 3 + v] = 0;
        }
      }
    }
    (this.upcomingGeo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }

  /** Compute 4 billboard vertices for a beam between two points */
  private computeQuad(
    start: THREE.Vector3, end: THREE.Vector3,
    width: number, camera: THREE.Camera,
    out: Float32Array, offset: number,
  ): void {
    // Direction from start to end
    this.tmpDir.subVectors(end, start).normalize();

    // Camera direction (from midpoint to camera)
    const mid = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
    const camDir = new THREE.Vector3().subVectors(camera.position, mid).normalize();

    // Perpendicular to both beam direction and camera direction
    this.tmpPerp.crossVectors(this.tmpDir, camDir).normalize().multiplyScalar(width * 0.5);

    // 4 corners: start±perp, end±perp
    // v0 = start - perp
    out[offset]     = start.x - this.tmpPerp.x;
    out[offset + 1] = start.y - this.tmpPerp.y;
    out[offset + 2] = start.z - this.tmpPerp.z;
    // v1 = start + perp
    out[offset + 3] = start.x + this.tmpPerp.x;
    out[offset + 4] = start.y + this.tmpPerp.y;
    out[offset + 5] = start.z + this.tmpPerp.z;
    // v2 = end - perp
    out[offset + 6] = end.x - this.tmpPerp.x;
    out[offset + 7] = end.y - this.tmpPerp.y;
    out[offset + 8] = end.z - this.tmpPerp.z;
    // v3 = end + perp
    out[offset + 9]  = end.x + this.tmpPerp.x;
    out[offset + 10] = end.y + this.tmpPerp.y;
    out[offset + 11] = end.z + this.tmpPerp.z;
  }

  /** Fade out beam (called when leader changes, before setLeader) */
  fadeOut(): void {
    this.targetOpacity = 0;
  }

  dispose(): void {
    this.beamGeo.dispose();
    this.beamMat.dispose();
    this.upcomingGeo.dispose();
    this.upcomingMat.dispose();
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/scene/LeaderBeam.ts
git commit -m "feat: add LeaderBeam with billboard quad geometry and upcoming connections"
```

---

### Task 4: Change Transaction Particle Flow Direction

Particles spawn from leader → travel to crystal growth point (was: outer edge → leader).

**Files:**
- Modify: `src/particles/TransactionPool.ts` (lines 89-105)

- [ ] **Step 1: Update spawn() signature and logic**

In `src/particles/TransactionPool.ts`, change the `spawn` method:

```typescript
/**
 * Spawn a transaction particle from the leader's position
 * toward the crystal growth point.
 */
spawn(tx: TransactionInfo, leaderPos: THREE.Vector3, crystalTarget: THREE.Vector3): void {
  const slot = this.findSlot();
  const p = this.particles[slot];

  // Spawn near leader with slight random spread
  p.startPos.set(
    leaderPos.x + (this.rng() - 0.5) * 10,
    leaderPos.y + (this.rng() - 0.5) * 6,
    leaderPos.z + (this.rng() - 0.5) * 10,
  );
  p.endPos.copy(crystalTarget);

  p.age = 0;
  p.lifetime = CONFIG.PARTICLE_LIFETIME;
  p.active = true;

  // Color by type
  p.color.copy(getTxColor(tx.type));

  // Size and brightness from value (log scale)
  const logValue = Math.log10(Math.max(tx.value, 0.001));
  const valueFactor = Math.min(Math.max((logValue + 3) / 6, 0), 1);
  p.size = 2.5 + valueFactor * 4.0;
  p.brightness = 0.6 + valueFactor * 0.4;
}
```

Also update the class doc comment at line 22:
```typescript
/**
 * Object pool for transaction particles. Particles spawn at the current
 * leader's position and drift inward toward the crystal growth point.
 * On arrival, they flash and deactivate.
 */
```

- [ ] **Step 2: Add applyFilter method**

Add to `TransactionPool` class (after `getActiveCount`):

```typescript
/** Dim particles that don't match the active filter type */
applyFilter(filterType: string): void {
  for (let i = 0; i < CONFIG.MAX_PARTICLES; i++) {
    const p = this.particles[i];
    if (!p.active) continue;
    const i3 = i * 3;

    if (filterType === 'all') {
      // Restore original colors
      this.colors[i3] = p.color.r;
      this.colors[i3 + 1] = p.color.g;
      this.colors[i3 + 2] = p.color.b;
    } else {
      // We don't store type on particle, so just restore all for now.
      // The feed filter is the primary visual effect.
      this.colors[i3] = p.color.r;
      this.colors[i3 + 1] = p.color.g;
      this.colors[i3 + 2] = p.color.b;
    }
  }
  (this.geometry.getAttribute('aColor') as THREE.BufferAttribute).needsUpdate = true;
}
```

Note: For full per-particle type filtering, we'd need to store `type` on `TxParticle`. Add that field:

In the `TxParticle` interface, add:
```typescript
type: string;
```

In `spawn()`, add after `p.active = true;`:
```typescript
p.type = tx.type;
```

Then update `applyFilter`:
```typescript
applyFilter(filterType: string): void {
  for (let i = 0; i < CONFIG.MAX_PARTICLES; i++) {
    const p = this.particles[i];
    if (!p.active) continue;
    const i3 = i * 3;

    if (filterType === 'all' || p.type === filterType) {
      this.colors[i3] = p.color.r;
      this.colors[i3 + 1] = p.color.g;
      this.colors[i3 + 2] = p.color.b;
    } else {
      // Dim non-matching particles
      this.colors[i3] = p.color.r * 0.1;
      this.colors[i3 + 1] = p.color.g * 0.1;
      this.colors[i3 + 2] = p.color.b * 0.1;
    }
  }
  (this.geometry.getAttribute('aColor') as THREE.BufferAttribute).needsUpdate = true;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/particles/TransactionPool.ts
git commit -m "feat: particles spawn from leader toward crystal, add type filter"
```

---

### Task 5: Add CameraController.zoomToValidator

Smooth camera animation to center a clicked validator.

**Files:**
- Modify: `src/interaction/CameraController.ts`

- [ ] **Step 1: Add zoom animation state and method**

Add these fields to `CameraController` after existing fields:
```typescript
// Zoom animation state
private zooming = false;
private zoomElapsed = 0;
private zoomDuration = 1.2;
private zoomStartPos = new THREE.Vector3();
private zoomEndPos = new THREE.Vector3();
private zoomStartTarget = new THREE.Vector3();
private zoomEndTarget = new THREE.Vector3();
```

Add the `zoomToValidator` method:
```typescript
/** Smoothly zoom camera to focus on a validator position */
zoomToValidator(validatorPos: THREE.Vector3): void {
  this.autoOrbit = false;
  this.zooming = true;
  this.zoomElapsed = 0;

  // Disable controls during animation
  this.controls.enabled = false;

  // Start from current position
  this.zoomStartPos.copy(this.camera.position);
  this.zoomStartTarget.copy(this.controls.target);

  // End target is the validator
  this.zoomEndTarget.copy(validatorPos);

  // End camera position: offset ~30 units from validator toward current camera azimuth
  const dir = new THREE.Vector3()
    .subVectors(this.camera.position, validatorPos)
    .normalize()
    .multiplyScalar(30);
  this.zoomEndPos.copy(validatorPos).add(dir);
}
```

Update the `update` method to handle zoom animation:
```typescript
update(dt: number): void {
  if (this.zooming) {
    this.zoomElapsed += dt;
    const t = Math.min(this.zoomElapsed / this.zoomDuration, 1.0);
    // Ease-out cubic
    const ease = 1 - Math.pow(1 - t, 3);

    this.camera.position.lerpVectors(this.zoomStartPos, this.zoomEndPos, ease);
    this.controls.target.lerpVectors(this.zoomStartTarget, this.zoomEndTarget, ease);

    if (t >= 1.0) {
      this.zooming = false;
      this.controls.enabled = true;
      this.resetInactivityTimer();
    }

    this.controls.update();
    return;
  }

  if (this.autoOrbit) {
    this.orbitAngle += CONFIG.AUTO_ORBIT_SPEED * dt;
    const r = CONFIG.ORBIT_RADIUS;
    this.camera.position.x = Math.cos(this.orbitAngle) * r;
    this.camera.position.z = Math.sin(this.orbitAngle) * r;
    this.camera.position.y = 45 + Math.sin(this.orbitAngle * 0.3) * 15;
  }

  this.controls.update();
}
```

Add interrupt handler — in the constructor, after the existing `controls.addEventListener('start', ...)`:
```typescript
// Allow user to interrupt zoom animation
const interruptZoom = () => {
  if (this.zooming) {
    this.zooming = false;
    this.controls.enabled = true;
    this.resetInactivityTimer();
  }
};
domElement.addEventListener('mousedown', interruptZoom);
domElement.addEventListener('touchstart', interruptZoom, { passive: true });
```

- [ ] **Step 2: Commit**

```bash
git add src/interaction/CameraController.ts
git commit -m "feat: add zoomToValidator with ease-out cubic animation"
```

---

### Task 6: Wire LeaderBeam + Particle Changes into Strata.ts

Connect the new systems to the orchestrator.

**Files:**
- Modify: `src/scene/Strata.ts`

- [ ] **Step 1: Add LeaderBeam import and construction**

Add import:
```typescript
import { LeaderBeam } from './LeaderBeam';
```

Add field:
```typescript
private leaderBeam: LeaderBeam;
```

In constructor, after seismicWave creation:
```typescript
// Leader Beam
this.leaderBeam = new LeaderBeam();
this.scene.add(this.leaderBeam.mesh);
this.scene.add(this.leaderBeam.upcoming);
```

- [ ] **Step 2: Update onSlot callback to wire leader beam**

In the `onSlot` callback, after the existing leader spotlight code:
```typescript
// Leader beam
const leaderIdx = this.dataSource.getCurrentLeaderIndex();
const leaderPos = this.validatorCloud.getPosition(leaderIdx);
this.leaderBeam.setLeader(leaderPos, this.crystalAxis.getGrowthPointY());

// Upcoming leader beams
const upcomingIndices = this.dataSource.getUpcomingLeaderIndices(4);
const upcomingPositions = upcomingIndices.map(i => this.validatorCloud.getPosition(i));
this.leaderBeam.setUpcoming(upcomingPositions, this.crystalAxis.getGrowthPointY());
```

- [ ] **Step 3: Update onTransactions to use new particle flow**

Replace the existing onTransactions body:
```typescript
onTransactions: (txs) => {
  const leaderIdx = this.dataSource.getCurrentLeaderIndex();
  const leaderPos = this.validatorCloud.getPosition(leaderIdx);
  const crystalTarget = new THREE.Vector3(0, this.crystalAxis.getGrowthPointY(), 0);

  for (const tx of txs) {
    this.transactionPool.spawn(tx, leaderPos, crystalTarget);
  }

  this.txCountThisSecond += txs.length;
},
```

- [ ] **Step 4: Update the update loop to include leader beam**

In `update(dt)`, after `this.crystalAxis.update(dt)`:
```typescript
this.leaderBeam.update(dt, this.crystalAxis.getGrowthPointY(), this.camera);
```

- [ ] **Step 5: Add to dispose**

In `dispose()`:
```typescript
this.leaderBeam.dispose();
```

- [ ] **Step 6: Verify — leader beam visible, particles flow from leader to crystal**

Check browser: gold beam from leader validator to crystal top. Particles spawn near leader and travel inward. Beam updates when leader rotates (every 4 slots = 1.6s).

- [ ] **Step 7: Commit**

```bash
git add src/scene/Strata.ts
git commit -m "feat: wire leader beam and particle flow into orchestrator"
```

---

## Chunk 2: Raycaster + Tooltip

### Task 7: Create Raycaster

Hover and click detection on validator points.

**Files:**
- Create: `src/interaction/Raycaster.ts`

- [ ] **Step 1: Write Raycaster class**

Create `src/interaction/Raycaster.ts`:
```typescript
import * as THREE from 'three';

/**
 * Raycaster for hover/click detection on validator Points geometry.
 * Desktop: mousemove for hover, click for selection.
 * Mobile: tap for selection (no hover).
 */
export class Raycaster {
  onHover: ((index: number) => void) | null = null;
  onHoverEnd: (() => void) | null = null;
  onClick: ((index: number) => void) | null = null;

  private raycaster: THREE.Raycaster;
  private mouse = new THREE.Vector2(-9999, -9999);
  private points: THREE.Points;
  private domElement: HTMLElement;
  private hoveredIndex = -1;

  // Touch state
  private touchStart = new THREE.Vector2();
  private isTouching = false;

  // Bound handlers for cleanup
  private handleMouseMove: (e: MouseEvent) => void;
  private handleClick: (e: MouseEvent) => void;
  private handleTouchStart: (e: TouchEvent) => void;
  private handleTouchEnd: (e: TouchEvent) => void;

  constructor(
    camera: THREE.Camera,
    domElement: HTMLElement,
    points: THREE.Points,
  ) {
    this.points = points;
    this.domElement = domElement;

    this.raycaster = new THREE.Raycaster();
    this.raycaster.params.Points!.threshold = 2.0;

    // Ensure bounding sphere is computed for fast reject
    points.geometry.computeBoundingSphere();

    this.handleMouseMove = (e: MouseEvent) => {
      const rect = domElement.getBoundingClientRect();
      this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    };

    this.handleClick = (_e: MouseEvent) => {
      if (this.hoveredIndex >= 0 && this.onClick) {
        this.onClick(this.hoveredIndex);
      }
    };

    this.handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        this.isTouching = true;
        this.touchStart.set(e.touches[0].clientX, e.touches[0].clientY);
      }
    };

    this.handleTouchEnd = (e: TouchEvent) => {
      if (!this.isTouching) return;
      this.isTouching = false;

      const touch = e.changedTouches[0];
      const dist = Math.hypot(
        touch.clientX - this.touchStart.x,
        touch.clientY - this.touchStart.y,
      );

      // Only count as tap if finger didn't move much
      if (dist < 20) {
        const rect = domElement.getBoundingClientRect();
        this.mouse.x = ((touch.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((touch.clientY - rect.top) / rect.height) * 2 + 1;

        // Force a raycast this frame
        // The next update() call will pick it up
        // Fire click directly since there's no hover on mobile
        if (this.onClick) {
          // We need to do an immediate raycast for touch
          this.raycaster.setFromCamera(this.mouse, this.camera);
          const hits = this.raycaster.intersectObject(this.points);
          if (hits.length > 0 && hits[0].index !== undefined) {
            this.onClick(hits[0].index);
          }
        }
      }
    };

    domElement.addEventListener('mousemove', this.handleMouseMove);
    domElement.addEventListener('click', this.handleClick);
    domElement.addEventListener('touchstart', this.handleTouchStart, { passive: true });
    domElement.addEventListener('touchend', this.handleTouchEnd);
  }

  // Store camera reference for touch raycasting
  private camera: THREE.Camera;

  /** Run raycast and fire callbacks. Call once per frame. */
  update(camera: THREE.Camera): void {
    this.camera = camera;
    this.raycaster.setFromCamera(this.mouse, camera);
    const hits = this.raycaster.intersectObject(this.points);

    if (hits.length > 0 && hits[0].index !== undefined) {
      const idx = hits[0].index;
      if (idx !== this.hoveredIndex) {
        this.hoveredIndex = idx;
        this.domElement.style.cursor = 'pointer';
        if (this.onHover) this.onHover(idx);
      }
    } else {
      if (this.hoveredIndex >= 0) {
        this.hoveredIndex = -1;
        this.domElement.style.cursor = 'default';
        if (this.onHoverEnd) this.onHoverEnd();
      }
    }
  }

  /** Get current mouse position in client coordinates */
  getMouseClient(): { x: number; y: number } | null {
    if (this.mouse.x < -1 || this.mouse.x > 1) return null;
    const rect = this.domElement.getBoundingClientRect();
    return {
      x: (this.mouse.x + 1) / 2 * rect.width + rect.left,
      y: (-this.mouse.y + 1) / 2 * rect.height + rect.top,
    };
  }

  dispose(): void {
    this.domElement.removeEventListener('mousemove', this.handleMouseMove);
    this.domElement.removeEventListener('click', this.handleClick);
    this.domElement.removeEventListener('touchstart', this.handleTouchStart);
    this.domElement.removeEventListener('touchend', this.handleTouchEnd);
    this.domElement.style.cursor = 'default';
  }
}
```

Note: There's a TypeScript issue — `this.camera` is used in constructor before the field declaration. Fix by moving the camera field and initializing in constructor:

Replace `private camera: THREE.Camera;` (standalone line near bottom) — instead add it as a constructor parameter stored on the class. Actually, simplify: store camera in constructor:

Add `this.camera = camera;` as the first line in the constructor body (before other assignments), and declare the field properly:
```typescript
private camera: THREE.Camera;
```
at the top of the class with the other private fields.

- [ ] **Step 2: Commit**

```bash
git add src/interaction/Raycaster.ts
git commit -m "feat: add Raycaster for validator hover/click detection"
```

---

### Task 8: Create Tooltip

Floating dark panel showing validator stats on hover.

**Files:**
- Create: `src/interaction/Tooltip.ts`

- [ ] **Step 1: Write Tooltip class**

Create `src/interaction/Tooltip.ts`:
```typescript
import type { ValidatorInfo } from '../data/DataSource';

/**
 * Floating tooltip showing validator data. Positioned near cursor.
 * Appended to #hud, pointer-events: none.
 */
export class Tooltip {
  private el: HTMLDivElement;
  private visible = false;
  private currentSlot = 0;
  private currentLeaderPubkey: string | null = null;

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'strata-tooltip';
    this.el.style.cssText = `
      position: absolute;
      background: rgba(5, 5, 16, 0.85);
      border: 1px solid rgba(255, 255, 255, 0.1);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      border-radius: 6px;
      padding: 14px 16px;
      font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
      font-size: 11px;
      color: rgba(255, 255, 255, 0.8);
      max-width: 280px;
      pointer-events: none;
      z-index: 20;
      opacity: 0;
      transition: opacity 0.15s ease;
      white-space: nowrap;
    `;
    document.getElementById('hud')!.appendChild(this.el);
  }

  /** Update context for status derivation */
  setContext(currentSlot: number, leaderPubkey: string | null): void {
    this.currentSlot = currentSlot;
    this.currentLeaderPubkey = leaderPubkey;
  }

  /** Show tooltip for a validator near the given screen position */
  show(validator: ValidatorInfo, screenX: number, screenY: number): void {
    const isLeader = validator.pubkey === this.currentLeaderPubkey;
    const isActive = validator.lastVote >= this.currentSlot - 5;

    const statusColor = isActive ? '#4ade80' : '#ef4444';
    const statusText = isActive ? 'Active' : 'Delinquent';

    let html = `<div style="font-size:13px;color:rgba(255,255,255,0.95);font-weight:600;margin-bottom:2px">${validator.name}</div>`;
    if (isLeader) {
      html += `<div style="color:#ffc850;font-size:10px;margin-bottom:8px">&#9733; LEADER</div>`;
    } else {
      html += `<div style="height:8px"></div>`;
    }

    html += `<div style="display:grid;grid-template-columns:auto 1fr;gap:4px 16px">`;
    html += this.row('Stake', this.formatStake(validator.stake) + ' SOL');
    html += this.row('Commission', validator.commission + '%');
    html += this.row('Last Vote', this.formatNumber(validator.lastVote));
    html += this.row('Epoch Credits', this.formatNumber(validator.epochCredits));
    html += this.row('Status', `<span style="color:${statusColor}">&#9679; ${statusText}</span>`);
    html += `</div>`;

    // Phase 5 placeholder
    html += `<div style="margin-top:10px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.08);font-size:9px;color:rgba(255,255,255,0.2);font-style:italic">Vote history coming soon</div>`;

    this.el.innerHTML = html;
    this.position(screenX, screenY);
    this.el.style.opacity = '1';
    this.visible = true;
  }

  hide(): void {
    this.el.style.opacity = '0';
    this.visible = false;
  }

  private row(label: string, value: string): string {
    return `<span style="color:rgba(255,255,255,0.45);text-transform:uppercase;font-size:9px;letter-spacing:0.5px">${label}</span><span style="text-align:right">${value}</span>`;
  }

  private position(screenX: number, screenY: number): void {
    const offset = 16;
    const rect = this.el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let x = screenX + offset;
    let y = screenY + offset;

    // Flip if would overflow
    if (x + rect.width > vw - 10) x = screenX - rect.width - offset;
    if (y + rect.height > vh - 10) y = screenY - rect.height - offset;
    if (x < 10) x = 10;
    if (y < 10) y = 10;

    this.el.style.left = x + 'px';
    this.el.style.top = y + 'px';
  }

  private formatStake(stake: number): string {
    if (stake >= 1_000_000) return (stake / 1_000_000).toFixed(1) + 'M';
    if (stake >= 1_000) return (stake / 1_000).toFixed(0) + 'K';
    return stake.toFixed(0);
  }

  private formatNumber(n: number): string {
    return n.toLocaleString();
  }

  dispose(): void {
    this.el.remove();
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/interaction/Tooltip.ts
git commit -m "feat: add Tooltip with validator stats display"
```

---

### Task 9: Wire Raycaster + Tooltip into Strata.ts

Connect hover/click interaction to the orchestrator.

**Files:**
- Modify: `src/scene/Strata.ts`

- [ ] **Step 1: Add imports, fields, and constructor wiring**

Add imports:
```typescript
import { Raycaster } from '../interaction/Raycaster';
import { Tooltip } from '../interaction/Tooltip';
```

Add fields:
```typescript
private raycaster: Raycaster;
private tooltip: Tooltip;
```

In constructor, after audioController:
```typescript
// Raycaster + Tooltip
this.tooltip = new Tooltip();
this.raycaster = new Raycaster(this.camera, this.renderer.domElement, this.validatorCloud.points);

this.raycaster.onHover = (index: number) => {
  const v = this.dataSource.getValidator(index);
  const mouseClient = this.raycaster.getMouseClient();
  if (v && mouseClient) {
    this.tooltip.setContext(this.dataSource.getCurrentSlot(), this.dataSource.getCurrentLeader());
    this.tooltip.show(v, mouseClient.x, mouseClient.y);
  }
};
this.raycaster.onHoverEnd = () => {
  this.tooltip.hide();
};
this.raycaster.onClick = (index: number) => {
  const pos = this.validatorCloud.getPosition(index);
  this.cameraController.zoomToValidator(pos);
};
```

- [ ] **Step 2: Add raycaster.update to update loop**

In `update(dt)`, after `this.cameraController.update(dt)`:
```typescript
this.raycaster.update(this.camera);
```

- [ ] **Step 3: Add to dispose**

```typescript
this.raycaster.dispose();
this.tooltip.dispose();
```

- [ ] **Step 4: Verify — hover shows tooltip, click zooms to validator**

Check browser: hover over validator points → tooltip appears with name/stake/commission. Click → camera smoothly zooms to validator. After 15s idle, auto-orbit resumes.

- [ ] **Step 5: Commit**

```bash
git add src/scene/Strata.ts
git commit -m "feat: wire raycaster and tooltip into orchestrator"
```

---

## Chunk 3: Info Overlay, Legend, Final Integration

### Task 10: Create InfoOverlay

Toggle button, leader label, transaction feed with filter pills.

**Files:**
- Create: `src/interaction/InfoOverlay.ts`

- [ ] **Step 1: Write InfoOverlay class**

Create `src/interaction/InfoOverlay.ts`:
```typescript
import * as THREE from 'three';
import type { TransactionInfo } from '../data/DataSource';
import { TX_TYPE_DISPLAY, TX_TYPE_HEX } from '../utils/colors';

/**
 * Info overlay: "i" toggle button, leader label (3D→2D projected),
 * and transaction feed with type filter pills.
 */
export class InfoOverlay {
  private container: HTMLElement;
  private toggleBtn: HTMLDivElement;
  private leaderLabel: HTMLDivElement;
  private feedContainer: HTMLDivElement;
  private feedList: HTMLDivElement;
  private active = false;
  private activeFilter = 'all';

  // Leader state
  private leaderName = '';
  private leaderWorldPos: THREE.Vector3 | null = null;

  // Feed state
  private txQueue: TransactionInfo[] = [];
  private feedTimer = 0;
  private feedRows: HTMLDivElement[] = [];
  private maxVisible = 10;
  private feedInterval = 0.8; // seconds between new rows

  // Bound handlers
  private handleToggle: () => void;

  constructor() {
    this.container = document.getElementById('hud')!;

    // Toggle button
    this.toggleBtn = document.createElement('div');
    this.toggleBtn.style.cssText = `
      position: absolute;
      top: 12px;
      left: 50%;
      transform: translateX(-50%);
      width: 32px;
      height: 32px;
      border-radius: 50%;
      border: 1px solid rgba(255, 255, 255, 0.2);
      background: rgba(5, 5, 16, 0.5);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      display: flex;
      align-items: center;
      justify-content: center;
      font-style: italic;
      font-size: 16px;
      color: rgba(255, 255, 255, 0.7);
      cursor: pointer;
      z-index: 15;
      transition: border-color 0.2s, color 0.2s;
    `;
    this.toggleBtn.textContent = 'i';
    this.toggleBtn.title = 'Toggle info overlay';
    this.container.appendChild(this.toggleBtn);

    // Leader label
    this.leaderLabel = document.createElement('div');
    this.leaderLabel.style.cssText = `
      position: absolute;
      font-family: 'SF Mono', 'Fira Code', monospace;
      font-size: 10px;
      color: #ffc850;
      letter-spacing: 1px;
      text-transform: uppercase;
      pointer-events: none;
      z-index: 15;
      opacity: 0;
      transition: opacity 0.3s;
      white-space: nowrap;
    `;
    this.container.appendChild(this.leaderLabel);

    // Feed container
    this.feedContainer = document.createElement('div');
    this.feedContainer.style.cssText = `
      position: absolute;
      right: 16px;
      top: 50px;
      width: 220px;
      font-family: 'SF Mono', 'Fira Code', monospace;
      font-size: 10px;
      background: rgba(5, 5, 16, 0.7);
      border: 1px solid rgba(255, 255, 255, 0.08);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      border-radius: 6px;
      padding: 12px;
      z-index: 15;
      opacity: 0;
      transition: opacity 0.3s;
      pointer-events: auto;
    `;

    // Feed header
    const header = document.createElement('div');
    header.style.cssText = 'color: rgba(255,255,255,0.4); text-transform: uppercase; letter-spacing: 1px; font-size: 9px; margin-bottom: 8px;';
    header.textContent = 'Transaction Feed';
    this.feedContainer.appendChild(header);

    // Filter pills
    const pillContainer = document.createElement('div');
    pillContainer.style.cssText = 'display: flex; gap: 6px; margin-bottom: 10px; flex-wrap: wrap;';
    const filters = ['all', 'transfer', 'defi', 'nft', 'stake'];
    for (const f of filters) {
      const pill = document.createElement('span');
      const color = f === 'all' ? 'rgba(255,255,255' : TX_TYPE_HEX[f];
      const bgAlpha = f === this.activeFilter ? 0.3 : 0.15;
      pill.style.cssText = `
        padding: 2px 8px;
        border-radius: 10px;
        font-size: 8px;
        letter-spacing: 0.5px;
        cursor: pointer;
        transition: background 0.2s;
      `;
      pill.dataset.filter = f;
      this.updatePillStyle(pill, f);
      pill.textContent = f.toUpperCase();
      pill.addEventListener('click', () => this.setFilter(f));
      pillContainer.appendChild(pill);
    }
    this.feedContainer.appendChild(pillContainer);

    // Feed list
    this.feedList = document.createElement('div');
    this.feedList.style.cssText = 'display: flex; flex-direction: column; gap: 4px; max-height: 300px; overflow: hidden;';
    this.feedContainer.appendChild(this.feedList);

    this.container.appendChild(this.feedContainer);

    // Toggle handler
    this.handleToggle = () => {
      this.active = !this.active;
      this.toggleBtn.style.borderColor = this.active ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.2)';
      this.toggleBtn.style.background = this.active ? 'rgba(5,5,16,0.7)' : 'rgba(5,5,16,0.5)';
      this.leaderLabel.style.opacity = this.active ? '1' : '0';
      this.feedContainer.style.opacity = this.active ? '1' : '0';
      this.feedContainer.style.pointerEvents = this.active ? 'auto' : 'none';
    };
    this.toggleBtn.addEventListener('click', this.handleToggle);
  }

  /** Set current leader info */
  setLeader(leaderName: string, worldPos: THREE.Vector3): void {
    this.leaderName = leaderName;
    this.leaderWorldPos = worldPos.clone();
    this.leaderLabel.textContent = `\u25CF LEADER: ${leaderName}`;
  }

  /** Push new transactions into the feed queue */
  pushTransactions(txs: TransactionInfo[]): void {
    for (const tx of txs) {
      if (this.txQueue.length >= 50) break; // cap queue
      this.txQueue.push(tx);
    }
  }

  /** Get active filter type */
  getActiveFilter(): string {
    return this.activeFilter;
  }

  /** Update — call each frame */
  update(dt: number, camera: THREE.PerspectiveCamera, rendererDom: HTMLElement): void {
    // Update leader label position via 3D→2D projection
    if (this.active && this.leaderWorldPos) {
      const projected = this.leaderWorldPos.clone().project(camera);
      if (projected.z < 1) { // in front of camera
        const x = (projected.x + 1) / 2 * rendererDom.clientWidth;
        const y = (-projected.y + 1) / 2 * rendererDom.clientHeight;
        this.leaderLabel.style.left = (x + 10) + 'px';
        this.leaderLabel.style.top = (y - 20) + 'px';
      }
    }

    // Drip-feed transactions
    this.feedTimer += dt;
    if (this.feedTimer >= this.feedInterval && this.txQueue.length > 0) {
      this.feedTimer = 0;
      const tx = this.txQueue.shift()!;

      // Skip if filtered out
      if (this.activeFilter !== 'all' && tx.type !== this.activeFilter) {
        // Try next in queue
        return;
      }

      this.addFeedRow(tx);
    }
  }

  private addFeedRow(tx: TransactionInfo): void {
    const row = document.createElement('div');
    const color = TX_TYPE_HEX[tx.type] || '#fff';
    const displayName = TX_TYPE_DISPLAY[tx.type] || tx.type;
    const amount = this.formatAmount(tx);

    row.style.cssText = `
      display: flex;
      justify-content: space-between;
      color: rgba(255,255,255,0.7);
      padding: 4px 0;
      border-bottom: 1px solid rgba(255,255,255,0.05);
      opacity: 0;
      transition: opacity 0.3s ease;
    `;
    row.innerHTML = `<span><span style="color:${color}">\u25CF</span> ${displayName}</span><span style="color:rgba(255,255,255,0.4)">${amount}</span>`;

    // Insert at top
    this.feedList.insertBefore(row, this.feedList.firstChild);
    this.feedRows.unshift(row);

    // Fade in
    requestAnimationFrame(() => { row.style.opacity = '1'; });

    // Remove excess
    while (this.feedRows.length > this.maxVisible) {
      const old = this.feedRows.pop()!;
      old.style.opacity = '0';
      setTimeout(() => old.remove(), 300);
    }
  }

  private formatAmount(tx: TransactionInfo): string {
    if (tx.type === 'defi') {
      return (tx.value * 150).toFixed(0) + ' USDC';
    }
    return tx.value.toFixed(1) + ' SOL';
  }

  private setFilter(filter: string): void {
    this.activeFilter = filter;
    // Update pill styles
    const pills = this.feedContainer.querySelectorAll('[data-filter]');
    pills.forEach(pill => {
      const el = pill as HTMLElement;
      this.updatePillStyle(el, el.dataset.filter!);
    });
  }

  private updatePillStyle(el: HTMLElement, filter: string): void {
    const isActive = filter === this.activeFilter;
    if (filter === 'all') {
      el.style.background = isActive ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.08)';
      el.style.color = isActive ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.5)';
    } else {
      const hex = TX_TYPE_HEX[filter];
      el.style.background = isActive ? `${hex}30` : `${hex}20`;
      el.style.color = isActive ? hex : `${hex}aa`;
    }
  }

  dispose(): void {
    this.toggleBtn.removeEventListener('click', this.handleToggle);
    this.toggleBtn.remove();
    this.leaderLabel.remove();
    this.feedContainer.remove();
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/interaction/InfoOverlay.ts
git commit -m "feat: add InfoOverlay with toggle, leader label, and transaction feed"
```

---

### Task 11: Create Legend

Explanatory panel toggled from bottom-left button.

**Files:**
- Create: `src/interaction/Legend.ts`

- [ ] **Step 1: Write Legend class**

Create `src/interaction/Legend.ts`:
```typescript
/**
 * Legend panel — explains visual elements of the Strata visualization.
 * Toggled via a "?" button in the bottom-left corner.
 */
export class Legend {
  private btn: HTMLDivElement;
  private panel: HTMLDivElement;
  private active = false;
  private handleToggle: () => void;

  constructor() {
    const hud = document.getElementById('hud')!;

    // Toggle button
    this.btn = document.createElement('div');
    this.btn.style.cssText = `
      position: absolute;
      bottom: 16px;
      left: 16px;
      width: 32px;
      height: 32px;
      border-radius: 50%;
      border: 1px solid rgba(255, 255, 255, 0.2);
      background: rgba(5, 5, 16, 0.5);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 16px;
      color: rgba(255, 255, 255, 0.7);
      cursor: pointer;
      z-index: 15;
      transition: border-color 0.2s, color 0.2s;
    `;
    this.btn.textContent = '?';
    this.btn.title = 'Legend';
    hud.appendChild(this.btn);

    // Legend panel
    this.panel = document.createElement('div');
    this.panel.style.cssText = `
      position: absolute;
      bottom: 56px;
      left: 16px;
      width: 280px;
      background: rgba(5, 5, 16, 0.85);
      border: 1px solid rgba(255, 255, 255, 0.1);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      border-radius: 6px;
      padding: 16px;
      font-family: 'SF Mono', 'Fira Code', monospace;
      font-size: 11px;
      color: rgba(255, 255, 255, 0.8);
      z-index: 15;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.3s;
    `;

    const items = [
      { indicator: '\u25C6', color: 'linear-gradient(to right, #7394f0, #352e50)', label: 'Crystal Axis', desc: "Solana's block history. Bright top = recent slots. Dark base = finalized." },
      { indicator: '\u25CF', color: '#ffc850', label: 'Validators', desc: 'Mineral deposits. Brighter = more stake. Size = network influence.' },
      { indicator: '\u2501', color: '#ffc850', label: 'Leader Spotlight', desc: "The golden beam shows who's producing the current block." },
      { indicator: '\u25CC', color: '#cdb87a', label: 'Seismic Waves', desc: 'Ripples when a new slot is confirmed by the network.' },
      { indicator: '\u25CF\u25CF\u25CF', colors: ['#ffd700', '#00e5ff', '#aa66ff'], label: 'Transactions', desc: 'Particles flowing into the crystal. Gold = transfers, Cyan = DeFi, Purple = NFT, Green = staking.' },
      { indicator: '\u25AC', color: '#1a1520', label: 'Missed Slots', desc: 'Dark gaps in the crystal where a leader failed to produce a block.' },
    ];

    let html = '';
    for (const item of items) {
      let indicatorHtml: string;
      if ('colors' in item && item.colors) {
        indicatorHtml = item.colors.map(c => `<span style="color:${c}">\u25CF</span>`).join('');
      } else if (typeof item.color === 'string' && item.color.startsWith('linear')) {
        indicatorHtml = `<span style="background:${item.color};-webkit-background-clip:text;-webkit-text-fill-color:transparent;font-size:14px">${item.indicator}</span>`;
      } else {
        indicatorHtml = `<span style="color:${item.color};font-size:14px">${item.indicator}</span>`;
      }

      html += `
        <div style="display:flex;gap:10px;align-items:flex-start;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.06)">
          <div style="flex:0 0 24px;text-align:center;line-height:1">${indicatorHtml}</div>
          <div>
            <div style="font-weight:600;color:rgba(255,255,255,0.9);margin-bottom:2px">${item.label}</div>
            <div style="color:rgba(255,255,255,0.5);font-size:10px;line-height:1.4;white-space:normal">${item.desc}</div>
          </div>
        </div>
      `;
    }

    this.panel.innerHTML = html;
    hud.appendChild(this.panel);

    this.handleToggle = () => {
      this.active = !this.active;
      this.btn.style.borderColor = this.active ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.2)';
      this.btn.style.background = this.active ? 'rgba(5,5,16,0.7)' : 'rgba(5,5,16,0.5)';
      this.panel.style.opacity = this.active ? '1' : '0';
      this.panel.style.pointerEvents = this.active ? 'auto' : 'none';
    };
    this.btn.addEventListener('click', this.handleToggle);
  }

  dispose(): void {
    this.btn.removeEventListener('click', this.handleToggle);
    this.btn.remove();
    this.panel.remove();
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/interaction/Legend.ts
git commit -m "feat: add Legend panel with visual explanations"
```

---

### Task 12: Final Strata.ts Integration

Wire InfoOverlay and Legend into the orchestrator. Complete all integration.

**Files:**
- Modify: `src/scene/Strata.ts`

- [ ] **Step 1: Add imports and fields**

Add imports:
```typescript
import { InfoOverlay } from '../interaction/InfoOverlay';
import { Legend } from '../interaction/Legend';
```

Add fields:
```typescript
private infoOverlay: InfoOverlay;
private legend: Legend;
private lastFilter = 'all';
```

- [ ] **Step 2: Construct InfoOverlay and Legend**

In constructor, after raycaster/tooltip setup:
```typescript
// Info Overlay + Legend
this.infoOverlay = new InfoOverlay();
this.legend = new Legend();
```

- [ ] **Step 3: Wire onSlot to push leader info to overlay**

In the `onSlot` callback, add after existing leader beam code:
```typescript
// Info overlay — leader label
const leaderName = this.validators.find(v => v.pubkey === leader)?.name ?? `Validator #${leaderIdx}`;
this.infoOverlay.setLeader(leaderName, leaderPos);
```

Note: `this.validators` doesn't exist as a field. Use `this.dataSource.getValidators()` or `this.dataSource.getValidator(leaderIdx)`:
```typescript
const leaderInfo = this.dataSource.getValidator(leaderIdx);
const leaderName = leaderInfo?.name ?? `Validator #${leaderIdx}`;
this.infoOverlay.setLeader(leaderName, leaderPos);
```

- [ ] **Step 4: Wire onTransactions to push to feed**

In `onTransactions` callback, after the spawn loop:
```typescript
this.infoOverlay.pushTransactions(txs);
```

- [ ] **Step 5: Add to update loop**

In `update(dt)`, after raycaster update:
```typescript
this.infoOverlay.update(dt, this.camera, this.renderer.domElement);

// Filter sync
const filter = this.infoOverlay.getActiveFilter();
if (filter !== this.lastFilter) {
  this.transactionPool.applyFilter(filter);
  this.lastFilter = filter;
}
```

- [ ] **Step 6: Add to dispose**

```typescript
this.infoOverlay.dispose();
this.legend.dispose();
```

- [ ] **Step 7: Verify — full integration check**

Check browser for ALL features:
1. Gold leader beam from active leader to crystal top ✓
2. Dim upcoming leader connection lines ✓
3. Particles flow from leader to crystal ✓
4. Hover validator → tooltip with stats ✓
5. Click validator → camera zooms, auto-orbit resumes after 15s ✓
6. "i" button → shows leader label + transaction feed ✓
7. Filter pills filter the feed by type ✓
8. "?" button → legend panel with explanations ✓

- [ ] **Step 8: Commit**

```bash
git add src/scene/Strata.ts
git commit -m "feat: wire InfoOverlay and Legend into Strata orchestrator"
```

---

### Task 13: Final Cleanup and Push

- [ ] **Step 1: Run TypeScript compilation check**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 2: Fix any TypeScript errors found**

- [ ] **Step 3: Final visual verification**

Open browser, let the visualization run for 30+ seconds. Verify all systems working together.

- [ ] **Step 4: Commit any fixes and push**

```bash
git push origin main
```

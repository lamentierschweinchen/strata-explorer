import * as THREE from 'three';
import { epochArcVertexShader, epochArcFragmentShader } from '../shaders/epochArc';
import { COLORS } from '../utils/colors';

/**
 * EPOCH PROGRESS ARC — a slow, luminous ring around the base of the crystal cluster
 * that fills as the current Solana epoch advances (an epoch is ~2–2.5 days). It is the
 * piece's second, much slower clock to the ~0.4 s block heartbeat: a quiet, sculptural
 * sense of deep time for an installation that runs unattended for hours.
 *
 * NOT a UI progress bar — an in-world light element. A thin horizontal halo lies in the
 * XZ plane around the geode base: the FILLED arc glows a Solana violet→green gradient,
 * the UNFILLED arc is a faint dark violet track, and a soft bright comet HEAD creeps
 * around the ring across the epoch, trailing a luminous tail. The fill eases toward its
 * target so the per-slot data jumps read as a smooth glide; an epoch rollover (the head
 * wrapping back past genesis) resets cleanly instead of unwinding backwards.
 *
 * Drawn with additive blending like the seismic-wave / leader-thread glows, and tuned to
 * the scene's bloom budget (BLOOM_THRESHOLD 0.72): the broad fill stays well under the
 * threshold and only the comet head crosses it, so the ring is a halo, not a gauge, and
 * never floods to white through the bloom mip chain.
 *
 * Wiring (an orchestrator owns this — Strata.ts):
 *   const arc = new EpochArc({ radius: 30, y: 2 });
 *   scene.add(arc.mesh);                                  // world-centred on the vertical axis
 *   // on each epoch poll:  arc.setProgress(slotIndex / slotsInEpoch); arc.setEpoch(epoch);
 *   // every frame:         arc.update(dt);
 */
export class EpochArc {
  private readonly group: THREE.Group;
  private readonly ringMesh: THREE.Mesh;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.ShaderMaterial;

  // Eased fill state. displayProgress chases targetProgress in update().
  private targetProgress = 0;
  private displayProgress = 0;
  private static readonly EASE_RATE = 0.8; // 1/s — gentle; data jumps per slot are tiny

  // Master fade-in: invisible until the first real progress arrives.
  private opacity = 0;
  private targetOpacity = 0;
  private activated = false;

  private time = 0;
  private epoch = -1;

  private static readonly ANGULAR_SEGMENTS = 256;

  /**
   * @param opts.color   Leading ("head/live") hue of the fill gradient. Default Solana
   *                     green #14F195. The genesis end of the gradient stays Solana violet
   *                     so the ring always sweeps along the brand axis.
   * @param opts.radius  Centre radius of the ring (local units). Default 30 — sits just
   *                     outside the geode's lower body (the cluster sprawls ~27–38 from the
   *                     axis at its belly; 30 reads as encircling the base).
   * @param opts.y       Local height of the ring plane. Default 2 — a low halo near the
   *                     matrix base / origin, below the hanging mass (its belly is ~y 7).
   */
  constructor(opts: { color?: THREE.Color; radius?: number; y?: number } = {}) {
    const radius = opts.radius !== undefined && opts.radius > 0 ? opts.radius : 30;
    const y = opts.y !== undefined ? opts.y : 2;
    const headColor = (opts.color ?? COLORS.CRYSTAL_GREEN).clone();

    this.geometry = EpochArc.buildRing(radius);

    // Head/tail/shimmer constants are expressed in WORLD arc-length and converted to the
    // shader's normalised-angle space here, so they stay visually constant if `radius`
    // changes. circumference guards radius→0 (clamped >0 above, but belt-and-braces).
    const circumference = Math.max(2 * Math.PI * radius, 1e-3);
    const headArcHalf = 5.0;  // half-width (units) of the comet head → FWHM ~10u
    const tailLength = 18.0;  // e-fold length (units) of the comet tail
    const flowWavelength = 10.0; // shimmer wavelength (units) around the ring
    const headHalfAngle = headArcHalf / circumference;
    const headSharp = Math.LN2 / Math.max(headHalfAngle * headHalfAngle, 1e-9);
    const trailRate = circumference / tailLength;
    const flowCycles = circumference / flowWavelength;

    this.material = new THREE.ShaderMaterial({
      vertexShader: epochArcVertexShader,
      fragmentShader: epochArcFragmentShader,
      uniforms: {
        uProgress: { value: 0 },
        uTime: { value: 0 },
        uOpacity: { value: 0 },
        uTrackColor: { value: COLORS.CRYSTAL_SETTING.clone() }, // faint dark violet track
        uStartColor: { value: COLORS.CRYSTAL_PURPLE.clone() },  // genesis: settled violet
        uHeadColor: { value: headColor },                       // live leading hue
        uHeadSharp: { value: headSharp },
        uTrailRate: { value: trailRate },
        uFlowCycles: { value: flowCycles },
        uEpochSeed: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });

    this.ringMesh = new THREE.Mesh(this.geometry, this.material);
    this.ringMesh.name = 'epoch-arc-ring';
    this.ringMesh.frustumCulled = false; // small, axis-centred — always near frame centre

    this.group = new THREE.Group();
    this.group.name = 'epoch-arc';
    this.group.position.set(0, y, 0);
    this.group.add(this.ringMesh);
  }

  /** The orchestrator adds this to the scene (or parents it to the crystal base). */
  get mesh(): THREE.Object3D {
    return this.group;
  }

  /**
   * Set the epoch position 0..1 (slotIndex / slotsInEpoch). The displayed fill eases
   * toward this. A large backward jump (the head wrapping past genesis at an epoch
   * rollover) snaps cleanly to the new value instead of sweeping backwards. The ring
   * fades in the first time real progress arrives.
   */
  setProgress(p01: number): void {
    const p = Number.isFinite(p01) ? Math.min(1, Math.max(0, p01)) : 0;
    this.targetProgress = p;
    if (!this.activated) {
      this.activated = true;
      this.targetOpacity = 1; // graceful fade-in; displayProgress sweeps up from 0 on load
    }
  }

  /**
   * Current epoch number. Optional, subtle: each epoch gets its own shimmer/breath phase
   * so consecutive epochs feel quietly distinct (a sense of deep time across the run).
   */
  setEpoch(epoch: number): void {
    if (!Number.isFinite(epoch) || epoch === this.epoch) return;
    this.epoch = epoch;
    // Golden-ratio hop → well-spread phase offsets, wrapped to [0,1).
    const seed = (((epoch * 0.6180339887) % 1) + 1) % 1;
    this.material.uniforms.uEpochSeed.value = seed;
  }

  /** Animate: eased fill + the flowing comet head/shimmer. Call once per frame. */
  update(dt: number): void {
    const step = Number.isFinite(dt) && dt > 0 ? dt : 0;
    this.time += step;

    // Ease the fill toward target; snap on a large backward jump (epoch rollover).
    const delta = this.targetProgress - this.displayProgress;
    if (delta < -0.5) {
      this.displayProgress = this.targetProgress;
    } else {
      this.displayProgress += delta * Math.min(EpochArc.EASE_RATE * step, 1);
    }

    // Master fade-in toward target opacity.
    this.opacity += (this.targetOpacity - this.opacity) * Math.min(2.0 * step, 1);

    const u = this.material.uniforms;
    u.uTime.value = this.time;
    u.uProgress.value = this.displayProgress;
    u.uOpacity.value = this.opacity;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }

  /**
   * A flat annulus in the local XZ plane (y = 0), centred on the origin. Two concentric
   * rings of vertices (inner / outer band edges) carry aAngle (0..1 around, CCW from +X)
   * and aRadial (0 inner → 1 outer); the shader draws the soft glowing line within the
   * band. The seam vertex is duplicated (aAngle 0 vs 1) so the wrap point is exactly the
   * epoch genesis — no gap, just an attribute discontinuity where the fill begins/ends.
   */
  private static buildRing(radius: number): THREE.BufferGeometry {
    const seg = EpochArc.ANGULAR_SEGMENTS;
    const bandHalf = Math.max(2.0, radius * 0.1); // band width scales gently with radius
    const rInner = Math.max(radius - bandHalf, 0.001);
    const rOuter = radius + bandHalf;

    const vertCount = (seg + 1) * 2;
    const positions = new Float32Array(vertCount * 3);
    const aAngle = new Float32Array(vertCount);
    const aRadial = new Float32Array(vertCount);
    const indices: number[] = [];

    for (let i = 0; i <= seg; i++) {
      const t = i / seg;                 // 0..1 around the ring
      const ang = t * Math.PI * 2;
      const cx = Math.cos(ang);
      const cz = Math.sin(ang);
      const vi = i * 2;                  // inner vertex index; outer is vi+1

      positions[vi * 3] = cx * rInner;
      positions[vi * 3 + 1] = 0;
      positions[vi * 3 + 2] = cz * rInner;
      aAngle[vi] = t;
      aRadial[vi] = 0;

      positions[(vi + 1) * 3] = cx * rOuter;
      positions[(vi + 1) * 3 + 1] = 0;
      positions[(vi + 1) * 3 + 2] = cz * rOuter;
      aAngle[vi + 1] = t;
      aRadial[vi + 1] = 1;

      if (i < seg) {
        const a = vi, b = vi + 1, c = vi + 2, d = vi + 3;
        indices.push(a, b, c, c, b, d);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aAngle', new THREE.BufferAttribute(aAngle, 1));
    geo.setAttribute('aRadial', new THREE.BufferAttribute(aRadial, 1));
    geo.setIndex(indices);
    return geo;
  }
}

import * as THREE from 'three';
import { crystalVertexShader, crystalFragmentShader } from '../shaders/crystal';
import { flareVertexShader, flareFragmentShader } from '../shaders/flare';
import { CONFIG } from '../utils/config';
import { COLORS } from '../utils/colors';

/**
 * The crystal axis — Solana's Proof of History rendered as a growing
 * translucent cylinder. Ring buffer of segments; newest at top, oldest
 * scrolling downward and solidifying.
 */
export class CrystalAxis {
  readonly mesh: THREE.Mesh;
  /** Real point light at the growth tip — pulses each slot, lights nearby validators. */
  readonly tipLight: THREE.PointLight;
  private geometry: THREE.BufferGeometry;
  private material: THREE.ShaderMaterial;

  // Growth-tip flare (single billboard sprite that bursts on each produced slot)
  private flare: THREE.Points;
  private flareMaterial: THREE.ShaderMaterial;
  private tipPulse = 0; // 0..1, boosted on a fresh slot, decays toward idle
  /** Cloud-illumination drive (steady wash + per-slot pulse), consumed by ValidatorCloud. */
  tipGlowIntensity: number = CONFIG.TIP_LIGHT_BASE;

  // Ring buffer state
  private headIndex = 0;
  private segmentCount = 0;
  private scrollOffset = 0;

  // Per-vertex attribute arrays
  private segmentAges: Float32Array;
  private flashes: Float32Array;
  private missedFlags: Float32Array;

  // Segment metadata (CPU-side)
  private segmentSlots: number[] = [];
  private segmentMissed: boolean[] = [];

  private readonly vertsPerRing: number;
  private readonly vertsPerSegment: number;
  private readonly maxSegments: number;

  constructor() {
    const subs = CONFIG.CRYSTAL_SUBDIVISIONS;
    const maxSeg = CONFIG.MAX_SEGMENTS;
    this.maxSegments = maxSeg;
    this.vertsPerRing = subs + 1; // +1 for UV seam
    this.vertsPerSegment = this.vertsPerRing * 2; // top + bottom ring

    const totalVerts = maxSeg * this.vertsPerSegment;
    const totalTris = maxSeg * subs * 2; // 2 triangles per quad

    // Allocate geometry buffers
    const positions = new Float32Array(totalVerts * 3);
    const normals = new Float32Array(totalVerts * 3);
    const uvs = new Float32Array(totalVerts * 2);
    this.segmentAges = new Float32Array(totalVerts);
    this.flashes = new Float32Array(totalVerts);
    this.missedFlags = new Float32Array(totalVerts);
    const indices = new Uint32Array(totalTris * 3);

    // Pre-build ring geometry for each segment slot
    for (let seg = 0; seg < maxSeg; seg++) {
      const baseVert = seg * this.vertsPerSegment;
      const segY = 0; // actual Y set when segment is written

      for (let ring = 0; ring < 2; ring++) {
        for (let i = 0; i <= subs; i++) {
          const vi = baseVert + ring * this.vertsPerRing + i;
          const theta = (i / subs) * Math.PI * 2;
          const cos = Math.cos(theta);
          const sin = Math.sin(theta);

          const vi3 = vi * 3;
          positions[vi3] = cos * CONFIG.CRYSTAL_RADIUS;
          positions[vi3 + 1] = segY;
          positions[vi3 + 2] = sin * CONFIG.CRYSTAL_RADIUS;

          normals[vi3] = cos;
          normals[vi3 + 1] = 0;
          normals[vi3 + 2] = sin;

          const vi2 = vi * 2;
          uvs[vi2] = i / subs;
          uvs[vi2 + 1] = ring;
        }
      }

      // Indices: connect bottom ring to top ring
      const baseIdx = seg * subs * 6;
      for (let i = 0; i < subs; i++) {
        const bl = baseVert + i;
        const br = baseVert + i + 1;
        const tl = baseVert + this.vertsPerRing + i;
        const tr = baseVert + this.vertsPerRing + i + 1;

        const idx = baseIdx + i * 6;
        indices[idx] = bl;
        indices[idx + 1] = tl;
        indices[idx + 2] = br;
        indices[idx + 3] = br;
        indices[idx + 4] = tl;
        indices[idx + 5] = tr;
      }
    }

    // Initially hide all segments
    this.segmentAges.fill(1.0);

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    this.geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    this.geometry.setAttribute('aSegmentAge', new THREE.BufferAttribute(this.segmentAges, 1));
    this.geometry.setAttribute('aFlash', new THREE.BufferAttribute(this.flashes, 1));
    this.geometry.setAttribute('aMissed', new THREE.BufferAttribute(this.missedFlags, 1));
    this.geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    // Start with no segments drawn
    this.geometry.setDrawRange(0, 0);

    this.material = new THREE.ShaderMaterial({
      vertexShader: crystalVertexShader,
      fragmentShader: crystalFragmentShader,
      uniforms: {
        uScrollOffset: { value: 0 },
        uTime: { value: 0 },
        uGrowthPointY: { value: 0 },
        uFinalityHeight: { value: CONFIG.FINALITY_DEPTH * CONFIG.SEGMENT_HEIGHT },
        uBreath: { value: 0.5 },
      },
      transparent: true,
      depthWrite: true,
      side: THREE.DoubleSide,
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);

    // --- Growth-tip light + flare ---
    // A genuine THREE.PointLight rides the growth tip and pulses each slot (it also
    // contributes to any standard-material meshes in the scene). Because the validator
    // cloud uses an additively-blended custom shader, its actual illumination is driven
    // by `tipGlowIntensity` (consumed by ValidatorCloud.setTipGlow) which tracks this
    // same light — so "the light lights the cloud" is real, not faked.
    this.tipLight = new THREE.PointLight(
      COLORS.TIP_LIGHT.getHex(),
      CONFIG.TIP_LIGHT_BASE,
      CONFIG.TIP_LIGHT_DISTANCE,
      2,
    );
    this.tipLight.position.set(0, this.getGrowthPointY(), 0);
    this.mesh.add(this.tipLight); // child of mesh → travels with it, no extra scene wiring

    const flareGeo = new THREE.BufferGeometry();
    flareGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0]), 3));
    this.flareMaterial = new THREE.ShaderMaterial({
      vertexShader: flareVertexShader,
      fragmentShader: flareFragmentShader,
      uniforms: {
        uSize: { value: 30 },
        uIntensity: { value: 0 },
        uColor: { value: COLORS.TIP_LIGHT.clone() },
        uTime: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.flare = new THREE.Points(flareGeo, this.flareMaterial);
    this.flare.frustumCulled = false;
    this.flare.position.set(0, this.getGrowthPointY(), 0);
    this.mesh.add(this.flare);

    // Initialize segment tracking
    for (let i = 0; i < maxSeg; i++) {
      this.segmentSlots.push(0);
      this.segmentMissed.push(false);
    }
  }

  /** Add a new segment at the top of the crystal */
  addSegment(missed: boolean): void {
    const seg = this.headIndex;
    const baseVert = seg * this.vertsPerSegment;
    const segHeight = CONFIG.SEGMENT_HEIGHT;

    // Compute Y position for this segment
    const topY = this.segmentCount * segHeight;
    const botY = topY - segHeight;

    // Update vertex Y positions for this segment
    const positions = this.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let ring = 0; ring < 2; ring++) {
      const y = ring === 0 ? botY : topY;
      for (let i = 0; i <= CONFIG.CRYSTAL_SUBDIVISIONS; i++) {
        const vi = baseVert + ring * this.vertsPerRing + i;
        positions.array[vi * 3 + 1] = y;
      }
    }
    positions.needsUpdate = true;

    // Set attributes for this segment
    for (let i = 0; i < this.vertsPerSegment; i++) {
      const vi = baseVert + i;
      this.segmentAges[vi] = 0.0; // brand new
      this.flashes[vi] = missed ? 0.0 : 1.0; // flash on non-missed
      this.missedFlags[vi] = missed ? 1.0 : 0.0;
    }

    // Track metadata
    this.segmentSlots[seg] = this.segmentCount;
    this.segmentMissed[seg] = missed;

    // Per-slot hero pulse: the tip flares and the light surges on a produced slot.
    // Missed slots leave a dark gap and do NOT flare (visual honesty).
    if (!missed) this.tipPulse = 1.0;

    // Advance ring buffer
    this.headIndex = (this.headIndex + 1) % this.maxSegments;
    this.segmentCount++;

    // Update scroll offset so the growth point stays centered
    this.scrollOffset = -(this.segmentCount - CONFIG.FINALITY_DEPTH * 0.5) * CONFIG.SEGMENT_HEIGHT;
    this.material.uniforms.uScrollOffset.value = this.scrollOffset;
    this.material.uniforms.uGrowthPointY.value = this.getGrowthPointY();

    // Update draw range
    const visibleSegments = Math.min(this.segmentCount, this.maxSegments);
    this.geometry.setDrawRange(0, visibleSegments * CONFIG.CRYSTAL_SUBDIVISIONS * 6);

    // Mark attribute buffers dirty
    (this.geometry.getAttribute('aSegmentAge') as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute('aFlash') as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute('aMissed') as THREE.BufferAttribute).needsUpdate = true;
  }

  update(dt: number): void {
    this.material.uniforms.uTime.value += dt;
    this.flareMaterial.uniforms.uTime.value += dt;

    // --- Dual-frequency idle breathing: brightness (uniform) + slight radius scale ---
    const t = this.material.uniforms.uTime.value;
    const breath = 0.6 * Math.sin(t * 0.7) + 0.4 * Math.sin(t * 1.13 + 1.7); // ~[-1, 1]
    const breath01 = breath * 0.5 + 0.5;
    this.material.uniforms.uBreath.value = breath01;
    const s = 1.0 + CONFIG.CRYSTAL_BREATH_SCALE * breath;
    this.mesh.scale.x = s;
    this.mesh.scale.z = s; // radius breathes; Y left at 1 so the stack height is stable

    // --- Tip pulse decay + position the light/flare at the (steady) growth point ---
    this.tipPulse = this.tipPulse > 0.001 ? this.tipPulse * Math.exp(-dt * 3.2) : 0;
    const tipY = this.getGrowthPointY();
    this.tipLight.position.set(0, tipY, 0);
    this.flare.position.set(0, tipY, 0);

    const idle = CONFIG.TIP_LIGHT_BASE * (0.85 + 0.15 * breath01);
    this.tipLight.intensity = idle + this.tipPulse * CONFIG.TIP_LIGHT_PULSE;
    this.flareMaterial.uniforms.uIntensity.value = this.tipPulse * 1.2 + 0.05; // faint idle ember
    // Steady inner wash + per-slot surge, consumed by the validator cloud shader.
    this.tipGlowIntensity = CONFIG.TIP_LIGHT_BASE * (0.6 + 0.2 * breath01) + this.tipPulse;

    let ageDirty = false;
    let flashDirty = false;

    const visibleSegments = Math.min(this.segmentCount, this.maxSegments);

    for (let s = 0; s < visibleSegments; s++) {
      const baseVert = s * this.vertsPerSegment;

      // Compute age based on distance from head
      let distFromHead = this.headIndex - 1 - s;
      if (distFromHead < 0) distFromHead += this.maxSegments;
      const age = Math.min(distFromHead / CONFIG.FINALITY_DEPTH, 1.0);

      // Only update crystallizing segments (age < 1.0) or recently changed
      const currentAge = this.segmentAges[baseVert];
      if (Math.abs(currentAge - age) > 0.001) {
        for (let i = 0; i < this.vertsPerSegment; i++) {
          this.segmentAges[baseVert + i] = age;
        }
        ageDirty = true;
      }

      // Decay flash
      if (this.flashes[baseVert] > 0.001) {
        const newFlash = this.flashes[baseVert] * Math.exp(-dt * 3.0); // ~230ms half-life
        for (let i = 0; i < this.vertsPerSegment; i++) {
          this.flashes[baseVert + i] = newFlash < 0.001 ? 0 : newFlash;
        }
        flashDirty = true;
      }
    }

    if (ageDirty) {
      (this.geometry.getAttribute('aSegmentAge') as THREE.BufferAttribute).needsUpdate = true;
    }
    if (flashDirty) {
      (this.geometry.getAttribute('aFlash') as THREE.BufferAttribute).needsUpdate = true;
    }
  }

  /** Get the current Y position of the crystal growth point */
  getGrowthPointY(): number {
    return this.segmentCount * CONFIG.SEGMENT_HEIGHT + this.scrollOffset;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.flare.geometry.dispose();
    this.flareMaterial.dispose();
  }
}

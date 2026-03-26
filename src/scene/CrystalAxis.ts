import * as THREE from 'three';
import { crystalVertexShader, crystalFragmentShader } from '../shaders/crystal';
import { CONFIG } from '../utils/config';

/**
 * The crystal axis — Solana's Proof of History rendered as a growing
 * translucent cylinder. Ring buffer of segments; newest at top, oldest
 * scrolling downward and solidifying.
 */
export class CrystalAxis {
  readonly mesh: THREE.Mesh;
  private geometry: THREE.BufferGeometry;
  private material: THREE.ShaderMaterial;

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
      },
      transparent: true,
      depthWrite: true,
      side: THREE.DoubleSide,
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);

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

    // Advance ring buffer
    this.headIndex = (this.headIndex + 1) % this.maxSegments;
    this.segmentCount++;

    // Update scroll offset so the growth point stays centered
    this.scrollOffset = -(this.segmentCount - CONFIG.FINALITY_DEPTH * 0.5) * CONFIG.SEGMENT_HEIGHT;
    this.material.uniforms.uScrollOffset.value = this.scrollOffset;

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
        const newFlash = this.flashes[baseVert] * Math.exp(-dt * 12.0); // ~80ms half-life
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
  }
}

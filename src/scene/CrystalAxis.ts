import * as THREE from 'three';
import { crystalVertexShader, crystalFragmentShader } from '../shaders/crystal';
import { flareVertexShader, flareFragmentShader } from '../shaders/flare';
import { CONFIG } from '../utils/config';
import { COLORS } from '../utils/colors';

/**
 * The crystal axis — Solana's Proof of History rendered as a growing FACETED QUARTZ
 * prism. An irregular hexagonal cross-section of flat, hard-edged facets runs the
 * height of the column; the vertex shader tapers the growing tip to a terminating
 * point. A ring buffer of segments scrolls downward: the newest glows at the tip,
 * older ones crystallize into opaque dark bedrock.
 *
 * Public API (consumed by the orchestrator, do not change): `mesh`, `tipLight`,
 * `addSegment(missed)`, `update(dt)`, `getGrowthPointY()`, `tipGlowIntensity`.
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

  // Per-vertex attribute arrays (one value per vertex, written per segment)
  private flashes: Float32Array;
  private missedFlags: Float32Array;
  private seeds: Float32Array;

  // Faceted-prism layout
  private readonly facets: number;
  private readonly vertsPerSegment: number; // 4 verts per facet (hard edges)
  private readonly trisPerSegment: number;
  private readonly maxSegments: number;
  private readonly indicesPerSegment: number;

  constructor() {
    const F = CONFIG.CRYSTAL_FACETS;
    const maxSeg = CONFIG.MAX_SEGMENTS;
    this.facets = F;
    this.maxSegments = maxSeg;
    this.vertsPerSegment = F * 4; // bottomA, bottomB, topA, topB per facet
    this.trisPerSegment = F * 2;
    this.indicesPerSegment = this.trisPerSegment * 3;

    // --- Irregular hexagonal cross-section, shared by every segment so the facets
    // run the full height of the column (long vertical quartz faces). Deterministic
    // jitter on each corner's angle + radius makes it read as natural, not machined.
    const R = CONFIG.CRYSTAL_RADIUS;
    const irr = CONFIG.CRYSTAL_IRREGULARITY;
    const frac = (x: number) => x - Math.floor(x);
    const rand = (s: number) => frac(Math.sin(s) * 43758.5453);
    const cornerX: number[] = [];
    const cornerZ: number[] = [];
    for (let k = 0; k < F; k++) {
      const angle = (k / F) * Math.PI * 2 + (rand(k * 12.9898 + 1.3) - 0.5) * (Math.PI / F) * irr * 1.2;
      const radius = R * (1 + (rand(k * 78.233 + 2.7) - 0.5) * irr * 2.0);
      cornerX.push(Math.cos(angle) * radius);
      cornerZ.push(Math.sin(angle) * radius);
    }

    // Per-facet flat outward normal + winding (so FrontSide culling keeps faces).
    const facetNx: number[] = [];
    const facetNz: number[] = [];
    const facetFlip: boolean[] = [];
    for (let f = 0; f < F; f++) {
      const a = f;
      const b = (f + 1) % F;
      const ex = cornerX[b] - cornerX[a];
      const ez = cornerZ[b] - cornerZ[a];
      // Edge rotated +90° → candidate outward normal.
      let nx = -ez;
      let nz = ex;
      const len = Math.hypot(nx, nz) || 1;
      nx /= len;
      nz /= len;
      const mx = (cornerX[a] + cornerX[b]) * 0.5;
      const mz = (cornerZ[a] + cornerZ[b]) * 0.5;
      let flip = false;
      if (nx * mx + nz * mz < 0) {
        nx = -nx;
        nz = -nz;
        flip = true;
      }
      facetNx.push(nx);
      facetNz.push(nz);
      facetFlip.push(flip);
    }

    const totalVerts = maxSeg * this.vertsPerSegment;
    const totalTris = maxSeg * this.trisPerSegment;

    const positions = new Float32Array(totalVerts * 3);
    const normals = new Float32Array(totalVerts * 3);
    const uvs = new Float32Array(totalVerts * 2);
    this.flashes = new Float32Array(totalVerts);
    this.missedFlags = new Float32Array(totalVerts);
    this.seeds = new Float32Array(totalVerts);
    const indices = new Uint32Array(totalTris * 3);

    // Pre-build facet geometry for each segment slot (Y is set when written).
    for (let seg = 0; seg < maxSeg; seg++) {
      const baseVert = seg * this.vertsPerSegment;
      const baseTri = seg * this.trisPerSegment;
      for (let f = 0; f < F; f++) {
        const a = f;
        const b = (f + 1) % F;
        const o = baseVert + f * 4; // local vert base for this facet
        // local order: 0 bottomA, 1 bottomB, 2 topA, 3 topB
        const corners = [
          [cornerX[a], cornerZ[a]], // bottomA
          [cornerX[b], cornerZ[b]], // bottomB
          [cornerX[a], cornerZ[a]], // topA
          [cornerX[b], cornerZ[b]], // topB
        ];
        const uvSet = [
          [0, 0],
          [1, 0],
          [0, 1],
          [1, 1],
        ];
        for (let i = 0; i < 4; i++) {
          const vi = o + i;
          positions[vi * 3] = corners[i][0];
          positions[vi * 3 + 1] = 0; // Y assigned in addSegment
          positions[vi * 3 + 2] = corners[i][1];
          normals[vi * 3] = facetNx[f];
          normals[vi * 3 + 1] = 0;
          normals[vi * 3 + 2] = facetNz[f];
          uvs[vi * 2] = uvSet[i][0];
          uvs[vi * 2 + 1] = uvSet[i][1];
        }
        // Two triangles per facet quad, wound so the outward face is front-facing.
        const ti = (baseTri + f * 2) * 3;
        const v0 = o + 0;
        const v1 = o + 1;
        const v2 = o + 2;
        const v3 = o + 3;
        if (!facetFlip[f]) {
          indices[ti] = v0; indices[ti + 1] = v1; indices[ti + 2] = v3;
          indices[ti + 3] = v0; indices[ti + 4] = v3; indices[ti + 5] = v2;
        } else {
          indices[ti] = v0; indices[ti + 1] = v3; indices[ti + 2] = v1;
          indices[ti + 3] = v0; indices[ti + 4] = v2; indices[ti + 5] = v3;
        }
      }
    }

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    this.geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    this.geometry.setAttribute('aFlash', new THREE.BufferAttribute(this.flashes, 1));
    this.geometry.setAttribute('aMissed', new THREE.BufferAttribute(this.missedFlags, 1));
    this.geometry.setAttribute('aSeed', new THREE.BufferAttribute(this.seeds, 1));
    this.geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    this.geometry.setDrawRange(0, 0); // nothing until the first segment is added

    this.material = new THREE.ShaderMaterial({
      vertexShader: crystalVertexShader,
      fragmentShader: crystalFragmentShader,
      uniforms: {
        uScrollOffset: { value: 0 },
        uTime: { value: 0 },
        uGrowthPointY: { value: 0 },
        uFinalityHeight: { value: CONFIG.FINALITY_DEPTH * CONFIG.SEGMENT_HEIGHT },
        uTipTaperHeight: { value: CONFIG.CRYSTAL_TIP_TAPER * CONFIG.SEGMENT_HEIGHT },
        uTipMinScale: { value: CONFIG.CRYSTAL_TIP_MIN_SCALE },
        uSegmentHeight: { value: CONFIG.SEGMENT_HEIGHT },
        uBreath: { value: 0.5 },
        uYoungColor: { value: COLORS.CRYSTAL_YOUNG.clone() },
        uSettingColor: { value: COLORS.CRYSTAL_SETTING.clone() },
        uFinalColor: { value: COLORS.CRYSTAL_OLD.clone() },
        uCoreColor: { value: COLORS.CRYSTAL_CORE.clone() },
      },
      transparent: true,
      depthWrite: true,
      side: THREE.FrontSide, // convex prism reads solid; internal depth is faked in-shader
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false; // it lives at the framed center; never cull it

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
        uSize: { value: 44 }, // larger to crown the bigger faceted crystal
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
  }

  /** Add a new segment at the top of the crystal */
  addSegment(missed: boolean): void {
    const seg = this.headIndex;
    const baseVert = seg * this.vertsPerSegment;
    const segHeight = CONFIG.SEGMENT_HEIGHT;

    // Compute Y position for this segment
    const topY = this.segmentCount * segHeight;
    const botY = topY - segHeight;

    // Update vertex Y positions: per facet, verts 0/1 sit at the bottom, 2/3 at the top.
    const positions = this.geometry.getAttribute('position') as THREE.BufferAttribute;
    const posArr = positions.array as Float32Array;
    for (let f = 0; f < this.facets; f++) {
      const o = baseVert + f * 4;
      posArr[(o + 0) * 3 + 1] = botY;
      posArr[(o + 1) * 3 + 1] = botY;
      posArr[(o + 2) * 3 + 1] = topY;
      posArr[(o + 3) * 3 + 1] = topY;
    }
    positions.needsUpdate = true;

    // Set per-vertex attributes for this segment
    const seed = Math.random();
    for (let i = 0; i < this.vertsPerSegment; i++) {
      const vi = baseVert + i;
      this.flashes[vi] = missed ? 0.0 : 1.0; // flash on non-missed
      this.missedFlags[vi] = missed ? 1.0 : 0.0;
      this.seeds[vi] = seed;
    }

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
    this.geometry.setDrawRange(0, visibleSegments * this.indicesPerSegment);

    // Mark attribute buffers dirty
    (this.geometry.getAttribute('aFlash') as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute('aMissed') as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute('aSeed') as THREE.BufferAttribute).needsUpdate = true;
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

    // --- Decay per-slot flash bursts ---
    let flashDirty = false;
    const visibleSegments = Math.min(this.segmentCount, this.maxSegments);
    for (let seg = 0; seg < visibleSegments; seg++) {
      const baseVert = seg * this.vertsPerSegment;
      if (this.flashes[baseVert] > 0.001) {
        const newFlash = this.flashes[baseVert] * Math.exp(-dt * 3.0); // ~230ms half-life
        const v = newFlash < 0.001 ? 0 : newFlash;
        for (let i = 0; i < this.vertsPerSegment; i++) {
          this.flashes[baseVert + i] = v;
        }
        flashDirty = true;
      }
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

import * as THREE from 'three';
import {
  shardVertexShader, shardFragmentShader,
  nucleusVertexShader, nucleusFragmentShader,
  spineVertexShader, spineFragmentShader,
} from '../shaders/crystal';
import { flareVertexShader, flareFragmentShader } from '../shaders/flare';
import { CONFIG } from '../utils/config';
import { COLORS } from '../utils/colors';

/**
 * THE CRYSTALLINE COMET — Solana's ledger as a living comet suspended in space.
 *
 * NUCLEUS  — a tumbling crystal cluster at a fixed point above the scene's heart:
 *            the growth front, where each slot's block condenses out of the leader's
 *            light. Wrapped in a soft coma; a real PointLight rides it.
 * TAIL     — the record. ONE shard per real slot, strung along a curved path that
 *            sweeps down and behind the nucleus. Every slot the whole stream glides
 *            one spacing away (the 400ms heartbeat, eased — felt as flow). Young
 *            shards are icy, luminous, loosely scattered and trembling; with
 *            finality they align, darken and fuse into a tight indigo braid that
 *            dissolves into space. Missed slots are dark cinders, knocked slightly
 *            out of the braid — permanent flaws that never ignite.
 * ACCRETION— the per-slot moment: the leader's droplet lands (orchestrator calls
 *            strike() on packet arrival), the nucleus blooms warm-then-icy, the
 *            newest shard ignites, and a pulse of light cascades down the tail —
 *            the record absorbing the block.
 *
 * PUBLIC API (consumed by the orchestrator — names kept from the column era, with
 * shifted meaning, documented here):
 *   mesh              — the tail-stream Mesh (root of the whole comet; nucleus,
 *                       spine, coma and tipLight are children). name: 'comet-tail'.
 *   tipLight          — PointLight at the NUCLEUS (the fixed growth point).
 *   addSegment(missed, slot?, leaderIndex?) — one call per real slot. Optional
 *                       metadata args are additive (orchestrator hook requested).
 *   strike()          — the accretion moment (packet arrival).
 *   update(dt)        — per-frame animation; shard transforms are CPU-side so
 *                       raycasts against the rendered geometry are exact.
 *   getGrowthPointY() — the NUCLEUS's fixed world Y (CONFIG.COMET_NUCLEUS_Y).
 *   tipGlowIntensity  — nucleus light drive consumed by the validator cloud.
 *
 * RAYCAST → SEGMENT MAPPING (for the tree-ring hover feature):
 *   Raycast against `mesh` (non-indexed; three respects drawRange). For a hit:
 *     ringIndex = Math.floor(intersection.faceIndex / TRIS_PER_SHARD)
 *   then call getSegmentInfoFromFaceIndex(intersection.faceIndex) which resolves
 *   the ring slot to { slot, missed, leaderIndex, slotsBehindHead } (or null for
 *   stale/never-written slots). Hits on the child named 'comet-nucleus' mean "the
 *   forming block" — present the current head slot.
 */
export class CrystalAxis {
  /** Tail-stream mesh; root of the comet group (children: nucleus, spine, coma, light). */
  readonly mesh: THREE.Mesh;
  /** Real point light at the nucleus — blooms each accretion, lights nearby validators. */
  readonly tipLight: THREE.PointLight;
  /** Cloud-illumination drive (steady wash + per-slot bloom), consumed by ValidatorCloud. */
  tipGlowIntensity: number = CONFIG.TIP_LIGHT_BASE;

  // --- Per-segment metadata (ring buffers, index = birth % MAX_SEGMENTS) -----------
  /** Slot number per segment (-1 until the orchestrator passes it; hover feature). */
  readonly segmentSlots: number[];
  /** Missed flag per segment. */
  readonly segmentMissed: Uint8Array;
  /** Leader validator index per segment (-1 unknown; hover feature). */
  readonly segmentLeaders: Int32Array;

  static readonly TRIS_PER_SHARD = CONFIG.SHARD_SIDES * 2;
  static readonly VERTS_PER_SHARD = CONFIG.SHARD_SIDES * 2 * 3;

  // --- Internals -------------------------------------------------------------------
  private tailGeo: THREE.BufferGeometry;
  private tailMat: THREE.ShaderMaterial;
  private nucleus: THREE.Mesh;
  private nucleusMat: THREE.ShaderMaterial;
  private spine: THREE.Mesh;
  private spineMat: THREE.ShaderMaterial;
  private coma: THREE.Points;
  private comaMat: THREE.ShaderMaterial;

  private readonly maxSegments = CONFIG.MAX_SEGMENTS;
  private headProgress = 0;   // segments added (absolute)
  private scrollPos = 0;      // eased follower of headProgress — the felt heartbeat
  private timeAcc = 0;
  private strikeT = 99;       // seconds since last accretion (starts "long ago")
  private tipPulse = 0;
  private tumbleAxis = new THREE.Vector3();

  // Per-segment state (ring buffers)
  private segmentBirth: Float64Array;     // absolute index at write time (-1 empty)
  private segmentBirthTime: Float32Array; // for the condensation scale-in
  private flashes: Float32Array;          // per-segment ignition energy (decays)
  private shardJitterTheta: Float32Array; // braid offset direction around the spine
  private shardJitterMag: Float32Array;   // braid offset magnitude factor
  private shardSeed: Float32Array;
  // Baked local shard geometry (tilt/roll folded in): VERTS_PER_SHARD per segment
  private shardLocalPos: Float32Array;
  private shardLocalNrm: Float32Array;

  // Dynamic GPU attributes
  private posAttr: THREE.BufferAttribute;
  private nrmAttr: THREE.BufferAttribute;
  private glowAttr: THREE.BufferAttribute;
  private ageAttr: THREE.BufferAttribute;
  private sAttr: THREE.BufferAttribute;
  private seedAttr: THREE.BufferAttribute;
  private missedAttr: THREE.BufferAttribute;

  // Tail curve lookup tables (uniform arc-length; local space, nucleus at origin)
  private static readonly CURVE_RES = 512;
  private curvePos: Float32Array;
  private curveT: Float32Array;
  private curveN: Float32Array;
  private curveB: Float32Array;
  private curveLen = 1;
  private curveDs = 1;

  constructor() {
    // ================= Tail curve: a graceful sweep down and behind ================
    // Cubic Bézier, then resampled to uniform arc length with parallel-transport
    // frames (no twist pops). The comet's silhouette cycles S-curve → C-curve →
    // diagonal as it sways past the orbiting camera.
    {
      const b0 = new THREE.Vector3(0, 0, 0);
      const b1 = new THREE.Vector3(6, -40, -4);
      const b2 = new THREE.Vector3(30, -78, 10);
      const b3 = new THREE.Vector3(78, -106, 26);
      const R = CrystalAxis.CURVE_RES;
      // Dense pre-sample for arc-length mapping
      const PRE = 1024;
      const pre: THREE.Vector3[] = [];
      const cum = new Float32Array(PRE);
      let acc = 0;
      for (let i = 0; i < PRE; i++) {
        const t = i / (PRE - 1);
        const it = 1 - t;
        const p = new THREE.Vector3()
          .addScaledVector(b0, it * it * it)
          .addScaledVector(b1, 3 * it * it * t)
          .addScaledVector(b2, 3 * it * t * t)
          .addScaledVector(b3, t * t * t);
        if (i > 0) acc += p.distanceTo(pre[i - 1]);
        pre.push(p);
        cum[i] = acc;
      }
      this.curveLen = acc;
      this.curveDs = this.curveLen / (R - 1);
      this.curvePos = new Float32Array(R * 3);
      this.curveT = new Float32Array(R * 3);
      this.curveN = new Float32Array(R * 3);
      this.curveB = new Float32Array(R * 3);
      // Uniform-s resample
      let j = 0;
      for (let i = 0; i < R; i++) {
        const s = i * this.curveDs;
        while (j < PRE - 2 && cum[j + 1] < s) j++;
        const span = Math.max(cum[j + 1] - cum[j], 1e-6);
        const f = THREE.MathUtils.clamp((s - cum[j]) / span, 0, 1);
        const p = new THREE.Vector3().lerpVectors(pre[j], pre[j + 1], f);
        this.curvePos.set([p.x, p.y, p.z], i * 3);
      }
      // Tangents (central differences) + parallel-transport normal/binormal
      const t0 = new THREE.Vector3();
      const n0 = new THREE.Vector3();
      const tmp = new THREE.Vector3();
      for (let i = 0; i < R; i++) {
        const ia = Math.max(i - 1, 0) * 3;
        const ib = Math.min(i + 1, R - 1) * 3;
        t0.set(
          this.curvePos[ib] - this.curvePos[ia],
          this.curvePos[ib + 1] - this.curvePos[ia + 1],
          this.curvePos[ib + 2] - this.curvePos[ia + 2],
        );
        if (t0.lengthSq() < 1e-10) t0.set(0, -1, 0);
        t0.normalize();
        this.curveT.set([t0.x, t0.y, t0.z], i * 3);
        if (i === 0) {
          // Initial normal: anything perpendicular to T (guard near-vertical T)
          tmp.set(1, 0, 0);
          if (Math.abs(t0.dot(tmp)) > 0.9) tmp.set(0, 0, 1);
          n0.crossVectors(t0, tmp).normalize();
        } else {
          // Transport previous normal: remove new-tangent component, renormalize
          n0.addScaledVector(t0, -n0.dot(t0));
          if (n0.lengthSq() < 1e-10) n0.set(1, 0, 0);
          n0.normalize();
        }
        this.curveN.set([n0.x, n0.y, n0.z], i * 3);
        tmp.crossVectors(t0, n0).normalize();
        this.curveB.set([tmp.x, tmp.y, tmp.z], i * 3);
      }
    }

    // ================= Tail stream (one shard per slot) ============================
    const VPS = CrystalAxis.VERTS_PER_SHARD;
    const maxSeg = this.maxSegments;
    const totalVerts = maxSeg * VPS;

    this.segmentSlots = new Array(maxSeg).fill(-1);
    this.segmentMissed = new Uint8Array(maxSeg);
    this.segmentLeaders = new Int32Array(maxSeg).fill(-1);
    this.segmentBirth = new Float64Array(maxSeg).fill(-1);
    this.segmentBirthTime = new Float32Array(maxSeg);
    this.flashes = new Float32Array(maxSeg);
    this.shardJitterTheta = new Float32Array(maxSeg);
    this.shardJitterMag = new Float32Array(maxSeg);
    this.shardSeed = new Float32Array(maxSeg);
    this.shardLocalPos = new Float32Array(totalVerts * 3);
    this.shardLocalNrm = new Float32Array(totalVerts * 3);

    this.tailGeo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(new Float32Array(totalVerts * 3), 3);
    this.nrmAttr = new THREE.BufferAttribute(new Float32Array(totalVerts * 3), 3);
    this.glowAttr = new THREE.BufferAttribute(new Float32Array(totalVerts), 1);
    this.ageAttr = new THREE.BufferAttribute(new Float32Array(totalVerts), 1);
    this.sAttr = new THREE.BufferAttribute(new Float32Array(totalVerts), 1);
    this.seedAttr = new THREE.BufferAttribute(new Float32Array(totalVerts), 1);
    this.missedAttr = new THREE.BufferAttribute(new Float32Array(totalVerts), 1);
    const uvAttr = new THREE.BufferAttribute(new Float32Array(totalVerts * 2), 2);
    for (const a of [this.posAttr, this.nrmAttr, this.glowAttr, this.ageAttr, this.sAttr]) {
      a.setUsage(THREE.DynamicDrawUsage);
    }
    this.tailGeo.setAttribute('position', this.posAttr);
    this.tailGeo.setAttribute('normal', this.nrmAttr);
    this.tailGeo.setAttribute('uv', uvAttr);
    this.tailGeo.setAttribute('aGlow', this.glowAttr);
    this.tailGeo.setAttribute('aAge', this.ageAttr);
    this.tailGeo.setAttribute('aS', this.sAttr);
    this.tailGeo.setAttribute('aSeed', this.seedAttr);
    this.tailGeo.setAttribute('aMissed', this.missedAttr);
    this.tailGeo.setDrawRange(0, 0); // non-indexed: counts VERTICES

    this.tailMat = new THREE.ShaderMaterial({
      vertexShader: shardVertexShader,
      fragmentShader: shardFragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uBreath: { value: 0.5 },
        uTipPulse: { value: 0 },
        uFadeS: { value: CONFIG.COMET_FADE_S },
        uYoungColor: { value: COLORS.CRYSTAL_YOUNG.clone() },
        uSettingColor: { value: COLORS.CRYSTAL_SETTING.clone() },
        uFinalColor: { value: COLORS.CRYSTAL_OLD.clone() },
        uCoreColor: { value: COLORS.CRYSTAL_CORE.clone() },
      },
      transparent: true,
      depthWrite: true,
      side: THREE.FrontSide,
    });

    this.mesh = new THREE.Mesh(this.tailGeo, this.tailMat);
    this.mesh.name = 'comet-tail';
    this.mesh.frustumCulled = false;
    this.mesh.position.set(0, CONFIG.COMET_NUCLEUS_Y, 0); // nucleus = local origin

    // ================= Nucleus: heart gem + crystal points =========================
    const nucleusGeo = this.buildNucleusGeometry();
    this.nucleusMat = new THREE.ShaderMaterial({
      vertexShader: nucleusVertexShader,
      fragmentShader: nucleusFragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uBreath: { value: 0.5 },
        uTipPulse: { value: 0 },
        uNucleusRadius: { value: CONFIG.NUCLEUS_GEM_RADIUS * 1.8 },
        uYoungColor: { value: COLORS.CRYSTAL_YOUNG.clone() },
        uSettingColor: { value: COLORS.CRYSTAL_SETTING.clone() },
        uCoreColor: { value: COLORS.CRYSTAL_CORE.clone() },
        uInclusionColor: { value: COLORS.CRYSTAL_AMBER.clone() },
        uWarmColor: { value: COLORS.TIP_LIGHT.clone() },
      },
      transparent: true,
      depthWrite: true,
      side: THREE.FrontSide,
    });
    this.nucleus = new THREE.Mesh(nucleusGeo, this.nucleusMat);
    this.nucleus.name = 'comet-nucleus';
    this.nucleus.frustumCulled = false;
    this.mesh.add(this.nucleus);
    // Tumble about the tail-start tangent so the cluster's points (built clear of
    // the tail cone) never sweep through the stream.
    this.tumbleAxis.set(this.curveT[0], this.curveT[1], this.curveT[2]).normalize();

    // ================= Spine: soft glow along the living tail ======================
    const spineGeo = this.buildSpineGeometry();
    this.spineMat = new THREE.ShaderMaterial({
      vertexShader: spineVertexShader,
      fragmentShader: spineFragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uBreath: { value: 0.5 },
        uTipPulse: { value: 0 },
        uStrikeT: { value: 99 },
        uWaveSpeed: { value: CONFIG.COMET_WAVE_SPEED },
        uHistoryS: { value: 0 },
        uSettleS: { value: CONFIG.COMET_TAIL_START + CONFIG.FINALITY_DEPTH * CONFIG.COMET_TAIL_SPACING },
        uYoungColor: { value: COLORS.CRYSTAL_YOUNG.clone() },
        uSettingColor: { value: COLORS.CRYSTAL_SETTING.clone() },
        uCoreColor: { value: COLORS.CRYSTAL_CORE.clone() },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.FrontSide,
    });
    this.spine = new THREE.Mesh(spineGeo, this.spineMat);
    this.spine.name = 'comet-spine';
    this.spine.frustumCulled = false;
    this.mesh.add(this.spine);

    // ================= Light + coma ================================================
    this.tipLight = new THREE.PointLight(
      COLORS.TIP_LIGHT.getHex(),
      CONFIG.TIP_LIGHT_BASE,
      CONFIG.TIP_LIGHT_DISTANCE,
      2,
    );
    this.tipLight.position.set(0, 0, 0); // local origin = nucleus center
    this.mesh.add(this.tipLight);

    const comaGeo = new THREE.BufferGeometry();
    comaGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0]), 3));
    this.comaMat = new THREE.ShaderMaterial({
      vertexShader: flareVertexShader,
      fragmentShader: flareFragmentShader,
      uniforms: {
        uSize: { value: 38 },
        uIntensity: { value: 0 },
        uColor: { value: COLORS.TIP_LIGHT.clone() },
        uIceColor: { value: COLORS.CRYSTAL_CORE.clone() },
        uTime: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.coma = new THREE.Points(comaGeo, this.comaMat);
    this.coma.name = 'comet-coma';
    this.coma.frustumCulled = false;
    this.mesh.add(this.coma);
  }

  // --- Deterministic per-shard RNG (stable across ring reuse) ---------------------
  private static mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** Curve frame at arc-length s (local space). Extrapolates beyond both ends. */
  private frameAt(
    s: number,
    outP: THREE.Vector3, outT: THREE.Vector3, outN: THREE.Vector3, outB: THREE.Vector3,
  ): void {
    const R = CrystalAxis.CURVE_RES;
    const fIdx = THREE.MathUtils.clamp(s / this.curveDs, 0, R - 1.001);
    const i0 = Math.floor(fIdx);
    const f = fIdx - i0;
    const a = i0 * 3;
    const b = (i0 + 1) * 3;
    const lerp3 = (arr: Float32Array, out: THREE.Vector3) => {
      out.set(
        arr[a] + (arr[b] - arr[a]) * f,
        arr[a + 1] + (arr[b + 1] - arr[a + 1]) * f,
        arr[a + 2] + (arr[b + 2] - arr[a + 2]) * f,
      );
    };
    lerp3(this.curvePos, outP);
    lerp3(this.curveT, outT);
    lerp3(this.curveN, outN);
    lerp3(this.curveB, outB);
    outT.normalize();
    outN.normalize();
    outB.normalize();
    // Linear extrapolation off either end of the table
    if (s < 0) outP.addScaledVector(outT, s);
    else if (s > this.curveLen) outP.addScaledVector(outT, s - this.curveLen);
  }

  /**
   * Build one shard's local geometry (an irregular elongated hexagonal bipyramid —
   * an ice splinter) with tilt/roll baked in, into the ring slot's template arrays.
   * Also writes the slot's static attributes (uv, seed, missed).
   */
  private reseedShard(ring: number, birth: number, missed: boolean): void {
    const sides = CONFIG.SHARD_SIDES;
    const rng = CrystalAxis.mulberry32(birth * 2654435761 + 1013904223);
    const seed = rng();
    this.shardSeed[ring] = seed;
    // Golden-angle placement around the spine: consecutive shards rotate by ~137.5°,
    // so the young scatter resolves into a helical braid as it settles — ordered,
    // never mechanical. Missed slots get a random kick OFF the braid line instead:
    // a permanent structural flaw you can see in the lattice.
    this.shardJitterTheta[ring] = missed
      ? rng() * Math.PI * 2
      : birth * 2.39996 + (rng() - 0.5) * 0.9;
    this.shardJitterMag[ring] = (0.5 + 1.3 * rng()) * (missed ? 1.6 : 1.0);

    const len = 2.6 + 1.8 * rng();
    const wid = (0.65 + 0.6 * rng()) * (missed ? 0.62 : 1.0);
    const waistY = (rng() - 0.5) * 0.3 * len;
    const topY = len * 0.5;
    const botY = -len * 0.5;
    const apexTopX = (rng() - 0.5) * 0.5 * wid;
    const apexTopZ = (rng() - 0.5) * 0.5 * wid;

    // Waist ring corners with natural jitter
    const cx: number[] = [], cz: number[] = [], cy: number[] = [];
    for (let k = 0; k < sides; k++) {
      const ang = (k / sides) * Math.PI * 2 + (rng() - 0.5) * (Math.PI / sides) * 0.9;
      const r = wid * (0.75 + 0.5 * rng());
      cx.push(Math.cos(ang) * r);
      cz.push(Math.sin(ang) * r);
      cy.push(waistY + (rng() - 0.5) * 0.22 * len);
    }

    // Baked orientation: roll about the long axis + a small off-tangent tilt
    // (kept gentle so the stream stays a braid through the curve's bend)
    const roll = rng() * Math.PI * 2;
    const tiltX = (rng() - 0.5) * 0.22;
    const tiltZ = (rng() - 0.5) * 0.22;
    const q = new THREE.Quaternion()
      .setFromEuler(new THREE.Euler(tiltX, roll, tiltZ, 'YXZ'));
    const rot = new THREE.Matrix4().makeRotationFromQuaternion(q);

    const base = ring * CrystalAxis.VERTS_PER_SHARD;
    const pos = this.shardLocalPos;
    const nrm = this.shardLocalNrm;
    const uvAttr = this.tailGeo.getAttribute('uv') as THREE.BufferAttribute;
    const vA = new THREE.Vector3(), vB = new THREE.Vector3(), vC = new THREE.Vector3();
    const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), n = new THREE.Vector3();
    const centroid = new THREE.Vector3();
    let vi = base;

    const emitTri = (
      ax: number, ay: number, az: number, ua: number, va: number,
      bx: number, by: number, bz: number, ub: number, vb: number,
      cxx: number, cyy: number, czz: number, uc: number, vc: number,
    ) => {
      vA.set(ax, ay, az); vB.set(bx, by, bz); vC.set(cxx, cyy, czz);
      // Outward winding for a convex solid around the origin
      centroid.copy(vA).add(vB).add(vC).multiplyScalar(1 / 3);
      e1.subVectors(vB, vA);
      e2.subVectors(vC, vA);
      n.crossVectors(e1, e2);
      if (n.lengthSq() < 1e-10) n.set(0, 1, 0);
      n.normalize();
      if (n.dot(centroid) < 0) {
        // flip winding (swap B and C)
        const t = vB.clone(); vB.copy(vC); vC.copy(t);
        n.negate();
        const tu = ub, tv = vb;
        // eslint-disable-next-line no-param-reassign
        ub = uc; vb = vc; uc = tu; vc = tv;
      }
      for (const [v, uu, vv] of [[vA, ua, va], [vB, ub, vb], [vC, uc, vc]] as const) {
        const p = (v as THREE.Vector3).clone().applyMatrix4(rot);
        const nn = n.clone().transformDirection(rot);
        pos[vi * 3] = p.x; pos[vi * 3 + 1] = p.y; pos[vi * 3 + 2] = p.z;
        nrm[vi * 3] = nn.x; nrm[vi * 3 + 1] = nn.y; nrm[vi * 3 + 2] = nn.z;
        uvAttr.setXY(vi, uu as number, vv as number);
        vi++;
      }
    };

    for (let k = 0; k < sides; k++) {
      const k2 = (k + 1) % sides;
      const u0 = k / sides, u1 = (k + 1) / sides;
      // Upper face: waistK → waistK+1 → top apex
      emitTri(
        cx[k], cy[k], cz[k], u0, 0.45,
        cx[k2], cy[k2], cz[k2], u1, 0.45,
        apexTopX, topY, apexTopZ, (u0 + u1) * 0.5, 1.0,
      );
      // Lower face: waistK+1 → waistK → bottom apex
      emitTri(
        cx[k2], cy[k2], cz[k2], u1, 0.45,
        cx[k], cy[k], cz[k], u0, 0.45,
        -apexTopX * 0.6, botY, -apexTopZ * 0.6, (u0 + u1) * 0.5, 0.0,
      );
    }

    // Static per-vertex attributes for this slot
    for (let i = 0; i < CrystalAxis.VERTS_PER_SHARD; i++) {
      this.seedAttr.setX(base + i, seed);
      this.missedAttr.setX(base + i, missed ? 1 : 0);
    }
    this.seedAttr.needsUpdate = true;
    this.missedAttr.needsUpdate = true;
    uvAttr.needsUpdate = true;
  }

  /** Central heart gem (displaced icosahedron) + crystal points, merged. */
  private buildNucleusGeometry(): THREE.BufferGeometry {
    const rng = CrystalAxis.mulberry32(0xc0ffee);
    const R = CONFIG.NUCLEUS_GEM_RADIUS;

    // Heart gem: flat-faceted displaced icosahedron. Displacement is hashed from
    // the (rounded) vertex position so shared corners stay welded.
    // (IcosahedronGeometry is already non-indexed — duplicated verts per face.)
    const gem = new THREE.IcosahedronGeometry(R, 1);
    {
      const p = gem.getAttribute('position') as THREE.BufferAttribute;
      const v = new THREE.Vector3();
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i);
        const key = Math.abs(Math.sin(
          Math.round(v.x * 7.13) * 12.9898 +
          Math.round(v.y * 7.13) * 78.233 +
          Math.round(v.z * 7.13) * 37.719,
        ) * 43758.5453);
        const disp = 1 + ((key % 1) - 0.5) * 0.34;
        v.multiplyScalar(disp);
        p.setXYZ(i, v.x, v.y, v.z);
      }
      gem.computeVertexNormals(); // non-indexed → true flat facet normals
    }

    // Crystal points: elongated bipyramids jutting from the heart. Directions are
    // kept out of a cone around the tail-start tangent so the stream stays clear,
    // and the longest point reaches "forward" (away from the tail) — the comet has
    // a direction of travel.
    const tailDir = new THREE.Vector3(6, -40, -4).normalize();
    const positions: number[] = [];
    const normals: number[] = [];
    const pushGeom = (g: THREE.BufferGeometry, m: THREE.Matrix4) => {
      const p = g.getAttribute('position') as THREE.BufferAttribute;
      const nA = g.getAttribute('normal') as THREE.BufferAttribute;
      const v = new THREE.Vector3();
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i).applyMatrix4(m);
        positions.push(v.x, v.y, v.z);
        v.fromBufferAttribute(nA, i).transformDirection(m);
        normals.push(v.x, v.y, v.z);
      }
    };
    pushGeom(gem, new THREE.Matrix4());

    const up = new THREE.Vector3(0, 1, 0);
    const q = new THREE.Quaternion();
    for (let i = 0; i < CONFIG.NUCLEUS_POINT_COUNT; i++) {
      // Direction: first point is the long "prow" away from the tail; the rest are
      // seeded, re-rolled out of the tail cone.
      let dir = new THREE.Vector3();
      if (i === 0) {
        dir.copy(tailDir).negate().add(new THREE.Vector3(0.15, 0.1, 0.2)).normalize();
      } else {
        do {
          dir.set(rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1);
        } while (dir.lengthSq() < 0.05 || dir.clone().normalize().dot(tailDir) > 0.72);
        dir.normalize();
      }
      const len = i === 0 ? R * 2.3 : R * (1.1 + 1.1 * rng());
      const wid = R * (0.22 + 0.14 * rng());

      // A point is a stretched octahedron-ish bipyramid (cheap cone pair)
      const pt = new THREE.CylinderGeometry(0, wid, len * 0.62, 5, 1, false).toNonIndexed();
      pt.translate(0, len * 0.31, 0);
      const ptBase = new THREE.CylinderGeometry(wid, 0, len * 0.38, 5, 1, false).toNonIndexed();
      ptBase.translate(0, -len * 0.19, 0);
      pt.computeVertexNormals();
      ptBase.computeVertexNormals();

      q.setFromUnitVectors(up, dir);
      const m = new THREE.Matrix4()
        .makeRotationFromQuaternion(q)
        .setPosition(dir.clone().multiplyScalar(R * 0.45));
      // Roll the point about its own axis for facet variety
      const roll = new THREE.Matrix4().makeRotationAxis(dir, rng() * Math.PI * 2);
      m.premultiply(roll);
      pushGeom(pt, m);
      pushGeom(ptBase, m);
      pt.dispose();
      ptBase.dispose();
    }
    gem.dispose();

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(normals), 3));
    return geo;
  }

  /** Soft glow tube along the tail curve (static; shader fades it with history). */
  private buildSpineGeometry(): THREE.BufferGeometry {
    const RINGS = 72;
    const SIDES = 10;
    const s0 = 6;
    const s1 = CONFIG.COMET_FADE_S + 6;
    const p = new THREE.Vector3(), t = new THREE.Vector3();
    const n = new THREE.Vector3(), b = new THREE.Vector3();
    const positions = new Float32Array(RINGS * SIDES * 3);
    const normals = new Float32Array(RINGS * SIDES * 3);
    const sArr = new Float32Array(RINGS * SIDES);
    const indices: number[] = [];
    for (let r = 0; r < RINGS; r++) {
      const f = r / (RINGS - 1);
      const s = s0 + (s1 - s0) * f;
      // Wide where it emerges from the cluster (no thin "neck"), tapering away.
      const radius = THREE.MathUtils.lerp(4.4, 1.0, Math.pow(f, 0.7));
      this.frameAt(s, p, t, n, b);
      for (let k = 0; k < SIDES; k++) {
        const a = (k / SIDES) * Math.PI * 2;
        const dir = new THREE.Vector3()
          .addScaledVector(n, Math.cos(a))
          .addScaledVector(b, Math.sin(a));
        const idx = r * SIDES + k;
        positions[idx * 3] = p.x + dir.x * radius;
        positions[idx * 3 + 1] = p.y + dir.y * radius;
        positions[idx * 3 + 2] = p.z + dir.z * radius;
        normals[idx * 3] = dir.x;
        normals[idx * 3 + 1] = dir.y;
        normals[idx * 3 + 2] = dir.z;
        sArr[idx] = s;
        if (r < RINGS - 1) {
          const k2 = (k + 1) % SIDES;
          const a0 = r * SIDES + k, a1 = r * SIDES + k2;
          const b0 = (r + 1) * SIDES + k, b1 = (r + 1) * SIDES + k2;
          indices.push(a0, b0, a1, a1, b0, b1);
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geo.setAttribute('aS', new THREE.BufferAttribute(sArr, 1));
    geo.setIndex(indices);
    return geo;
  }

  /**
   * One call per REAL slot (the data heartbeat): the stream glides one spacing and
   * a new shard condenses behind the nucleus. `slot` and `leaderIndex` are optional
   * additive metadata for the hover feature (orchestrator hook requested).
   */
  addSegment(missed: boolean, slot?: number, leaderIndex?: number): void {
    const ring = this.headProgress % this.maxSegments;
    this.reseedShard(ring, this.headProgress, missed);
    this.segmentSlots[ring] = slot ?? -1;
    this.segmentMissed[ring] = missed ? 1 : 0;
    this.segmentLeaders[ring] = leaderIndex ?? -1;
    this.segmentBirth[ring] = this.headProgress;
    this.segmentBirthTime[ring] = this.timeAcc;
    this.flashes[ring] = 0;
    this.headProgress++;

    const visible = Math.min(this.headProgress, this.maxSegments);
    this.tailGeo.setDrawRange(0, visible * CrystalAxis.VERTS_PER_SHARD);
  }

  /**
   * The accretion strike: the leader's packet lands (orchestrator calls this on
   * arrival). The nucleus blooms, the newest produced shard ignites, and a pulse
   * cascades down the tail. Missed slots never strike (honesty).
   */
  strike(): void {
    this.tipPulse = 1.0;
    this.strikeT = 0;
    // Ignite the newest PRODUCED segment — catch-up bursts can land an in-flight
    // packet right after a missed slot was added; never let a cinder flash.
    for (let back = 0; back < 6; back++) {
      const b = this.headProgress - 1 - back;
      if (b < 0) break;
      const ring = b % this.maxSegments;
      if (this.segmentBirth[ring] !== b) break; // ring slot already recycled
      if (!this.segmentMissed[ring]) {
        this.flashes[ring] = 1.0;
        break;
      }
    }
  }

  update(dt: number): void {
    this.timeAcc += dt;
    this.strikeT += dt;

    // The heartbeat: eased glide toward the head — one spacing per slot, felt.
    this.scrollPos += (this.headProgress - this.scrollPos) * Math.min(1, CONFIG.COMET_GLIDE_RATE * dt);

    // Suspended-mobile sway: the whole comet slowly turns and breathes its pitch,
    // so the tail's silhouette cycles even for a static camera. The nucleus sits at
    // the local origin, so the fixed growth point never moves.
    const t = this.timeAcc;
    this.mesh.rotation.y = t * CONFIG.COMET_SWAY_YAW;
    this.mesh.rotation.x = Math.sin(t * 0.10) * 0.028;
    this.mesh.rotation.z = Math.cos(t * 0.083) * 0.022;
    // Nucleus tumble about the tail axis — facet glints crawl at idle.
    this.nucleus.rotateOnAxis(this.tumbleAxis, dt * CONFIG.COMET_TUMBLE_SPEED);

    // Accretion pulse decay
    this.tipPulse = this.tipPulse > 0.001 ? this.tipPulse * Math.exp(-dt * 3.2) : 0;

    // Idle dual-frequency breathing (brightness drive shared by all comet materials)
    const breath = 0.6 * Math.sin(t * 0.7) + 0.4 * Math.sin(t * 1.13 + 1.7);
    const breath01 = breath * 0.5 + 0.5;

    // Shared uniforms
    this.tailMat.uniforms.uTime.value = t;
    this.tailMat.uniforms.uBreath.value = breath01;
    this.tailMat.uniforms.uTipPulse.value = this.tipPulse;
    this.nucleusMat.uniforms.uTime.value = t;
    this.nucleusMat.uniforms.uBreath.value = breath01;
    this.nucleusMat.uniforms.uTipPulse.value = this.tipPulse;
    this.spineMat.uniforms.uTime.value = t;
    this.spineMat.uniforms.uBreath.value = breath01;
    this.spineMat.uniforms.uTipPulse.value = this.tipPulse;
    this.spineMat.uniforms.uStrikeT.value = this.strikeT;
    this.spineMat.uniforms.uHistoryS.value =
      CONFIG.COMET_TAIL_START + Math.min(this.scrollPos, this.maxSegments) * CONFIG.COMET_TAIL_SPACING;
    this.comaMat.uniforms.uTime.value = t;

    // Light + coma + cloud drive — same external semantics as the column era.
    this.tipLight.intensity =
      CONFIG.TIP_LIGHT_BASE * (0.85 + 0.15 * breath01) + this.tipPulse * CONFIG.TIP_LIGHT_PULSE;
    this.comaMat.uniforms.uIntensity.value = 0.12 + 0.05 * breath01 + this.tipPulse * 0.85;
    this.tipGlowIntensity = CONFIG.TIP_LIGHT_BASE * (0.6 + 0.2 * breath01) + this.tipPulse;

    this.updateShards(dt);
  }

  /**
   * CPU shard pass: position every live shard along the curve (glide, braid offset,
   * convergence with age, condensation scale-in, young tremble) and refresh the
   * dynamic attributes (age, arc-length, ignition/cascade glow). CPU-side so the
   * rendered triangles are exactly what a raycaster sees (hover feature).
   */
  private static _p = new THREE.Vector3();
  private static _t = new THREE.Vector3();
  private static _n = new THREE.Vector3();
  private static _b = new THREE.Vector3();
  private updateShards(dt: number): void {
    const VPS = CrystalAxis.VERTS_PER_SHARD;
    const visible = Math.min(this.headProgress, this.maxSegments);
    if (visible === 0) return;

    const pos = this.posAttr.array as Float32Array;
    const nrm = this.nrmAttr.array as Float32Array;
    const glow = this.glowAttr.array as Float32Array;
    const age = this.ageAttr.array as Float32Array;
    const sArr = this.sAttr.array as Float32Array;
    const lp = this.shardLocalPos;
    const ln = this.shardLocalNrm;
    const P = CrystalAxis._p, T = CrystalAxis._t, N = CrystalAxis._n, B = CrystalAxis._b;

    const spacing = CONFIG.COMET_TAIL_SPACING;
    const tailStart = CONFIG.COMET_TAIL_START;
    const flashDecay = Math.exp(-dt * 3.0);
    const waveS = this.strikeT * CONFIG.COMET_WAVE_SPEED;
    const waveAmp = Math.exp(-this.strikeT * 2.1);
    const tNow = this.timeAcc;

    for (let ring = 0; ring < visible; ring++) {
      const birth = this.segmentBirth[ring];
      if (birth < 0) continue;
      const sBase = tailStart + (this.scrollPos - 1 - birth) * spacing;
      const slotsBehind = this.headProgress - 1 - birth;
      const age01 = Math.min(Math.max(slotsBehind / CONFIG.FINALITY_DEPTH, 0), 1);

      this.frameAt(sBase, P, T, N, B);

      // Braid offset: scattered while young, converging into the braid with
      // finality. Missed cinders keep an enlarged offset — permanent flaws.
      const settle = age01 * age01 * (3 - 2 * age01); // smoothstep
      const mag = this.shardJitterMag[ring] * (1.6 - 1.3 * settle);
      const th = this.shardJitterTheta[ring];
      let ox = (N.x * Math.cos(th) + B.x * Math.sin(th)) * mag;
      let oy = (N.y * Math.cos(th) + B.y * Math.sin(th)) * mag;
      let oz = (N.z * Math.cos(th) + B.z * Math.sin(th)) * mag;

      // Young shards tremble faintly — still condensing, not yet settled.
      const tremble = Math.max(0, 1 - age01 * 3.3);
      if (tremble > 0.01) {
        const seed = this.shardSeed[ring] * 37.0;
        ox += Math.sin(tNow * 2.1 + seed) * 0.10 * tremble;
        oy += Math.sin(tNow * 2.7 + seed * 1.7) * 0.08 * tremble;
        oz += Math.cos(tNow * 2.4 + seed * 2.3) * 0.10 * tremble;
      }

      // Condensation scale-in over the first half second of the shard's life
      const lived = tNow - this.segmentBirthTime[ring];
      let scale = lived >= 0.5 ? 1 : (() => { const x = Math.max(lived, 0) / 0.5; return x * x * (3 - 2 * x); })();
      if (this.segmentMissed[ring]) scale *= 0.78;

      // Per-segment glow: ignition flash (decaying) + the cascade wave passing
      this.flashes[ring] = this.flashes[ring] > 0.001 ? this.flashes[ring] * flashDecay : 0;
      let g = this.flashes[ring];
      if (waveAmp > 0.01) {
        const d = sBase - waveS;
        g += waveAmp * Math.exp(-(d * d) / 42.0) * (this.segmentMissed[ring] ? 0 : 1);
      }
      if (g > 1.4) g = 1.4;

      // Rotation basis: local X→N, Y→T (long axis along the stream), Z→B
      const base = ring * VPS;
      for (let i = 0; i < VPS; i++) {
        const li = (base + i) * 3;
        const lx = lp[li] * scale, ly = lp[li + 1] * scale, lz = lp[li + 2] * scale;
        pos[li] = P.x + ox + N.x * lx + T.x * ly + B.x * lz;
        pos[li + 1] = P.y + oy + N.y * lx + T.y * ly + B.y * lz;
        pos[li + 2] = P.z + oz + N.z * lx + T.z * ly + B.z * lz;
        const nx = ln[li], ny = ln[li + 1], nz = ln[li + 2];
        nrm[li] = N.x * nx + T.x * ny + B.x * nz;
        nrm[li + 1] = N.y * nx + T.y * ny + B.y * nz;
        nrm[li + 2] = N.z * nx + T.z * ny + B.z * nz;
        glow[base + i] = g;
        age[base + i] = age01;
        sArr[base + i] = sBase;
      }
    }

    this.posAttr.needsUpdate = true;
    this.nrmAttr.needsUpdate = true;
    this.glowAttr.needsUpdate = true;
    this.ageAttr.needsUpdate = true;
    this.sAttr.needsUpdate = true;
  }

  /** The nucleus's fixed world Y — the growth point (and the camera/beam anchor). */
  getGrowthPointY(): number {
    return CONFIG.COMET_NUCLEUS_Y;
  }

  /**
   * Hover support: resolve a raycast hit on `mesh` (intersection.faceIndex) to its
   * segment metadata. Returns null for never-written or recycled ring slots.
   */
  getSegmentInfoFromFaceIndex(faceIndex: number): {
    ringIndex: number;
    slot: number;
    missed: boolean;
    leaderIndex: number;
    slotsBehindHead: number;
  } | null {
    const ring = Math.floor(faceIndex / CrystalAxis.TRIS_PER_SHARD);
    if (ring < 0 || ring >= this.maxSegments) return null;
    const birth = this.segmentBirth[ring];
    if (birth < 0) return null;
    return {
      ringIndex: ring,
      slot: this.segmentSlots[ring],
      missed: this.segmentMissed[ring] === 1,
      leaderIndex: this.segmentLeaders[ring],
      slotsBehindHead: this.headProgress - 1 - birth,
    };
  }

  dispose(): void {
    this.tailGeo.dispose();
    this.tailMat.dispose();
    this.nucleus.geometry.dispose();
    this.nucleusMat.dispose();
    this.spine.geometry.dispose();
    this.spineMat.dispose();
    this.coma.geometry.dispose();
    this.comaMat.dispose();
  }
}

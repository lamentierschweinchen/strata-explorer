import * as THREE from 'three';
import {
  applyGemPatches, applySolidPatches, applyStemCorePatches, applyStemPatches,
  type ClusterUniforms,
} from '../shaders/crystal';
import { flareVertexShader, flareFragmentShader } from '../shaders/flare';
import { CONFIG } from '../utils/config';
import { COLORS } from '../utils/colors';

/**
 * THE CRYSTALLINE CLUSTER — Solana's ledger as a growing mineral aggregate
 * suspended in space (REFERENCES.md is the canon; judge against it).
 *
 * SPINE   — a fixed curved path sweeping down and behind the growth head. The
 *           whole record glides one spacing along it per slot (the 400 ms
 *           heartbeat, eased — felt as growth, not a ticker).
 * SPRAYS  — each leader (4 slots) raises one radiating spray of terminated
 *           prisms at its own azimuth, in its own Solana-hue family (purple /
 *           magenta / green — saturated, never pastel). Each produced slot
 *           nucleates ONE crystal of that spray (the first of the four is the
 *           leader's dominant blade) plus a scatter of druzy micro-crystals.
 *           Crystals are real MeshPhysicalMaterial bodies: environment-lit,
 *           clearcoated, iridescent, REFRACTING the live scene (full-scene
 *           grab pass — stars and the amber validator cloud bend through the
 *           young stones) with per-channel dispersion.
 * MATRIX  — finality. Aging crystals converge to deep violet, cross the
 *           burning amber EMBER BAND at rooting depth (~30 slots), and settle
 *           into dark rough matrix fused to the botryoidal stem — the geode
 *           shell the cluster grows from — finally dissolving into space.
 * MISSED  — a vacancy: no crystal, only a sparse pocket of lightless cinder
 *           micros. Never celebrated.
 *
 * PUBLIC API (consumed by the orchestrator — names kept from the column era,
 * meaning shifted, documented here):
 *   mesh              — THREE.Group root of the whole cluster (head at local
 *                       origin = world (0, CLUSTER_HEAD_Y, 0)). name: 'crystal-cluster'.
 *   tipLight          — PointLight at the growth head (physical-units intensity).
 *   addSegment(missed, slot?, leaderIndex?) — one call per real slot. Optional
 *                       metadata args are additive (orchestrator hook requested).
 *   strike()          — the nucleation moment (leader packet arrival).
 *   update(dt)        — per-frame animation; instance transforms are CPU-side so
 *                       raycasts against rendered geometry are exact.
 *   getGrowthPointY() — the head's fixed world Y (CONFIG.CLUSTER_HEAD_Y).
 *   tipGlowIntensity  — cloud-illumination drive (kept on the legacy 0..~3 scale).
 *
 * RAYCAST → CRYSTAL MAPPING (shared by BOTH planned consumers — the interactive
 * mouse hover AND the mouse-less auto-labels surface the same per-crystal info):
 *   • Hover: raycast against `raycastTargets` (the three gem InstancedMesh
 *     habits, named 'cluster-gems-0/1/2'; every ring renders its slot's clump
 *     across all three — main blade + two flankers — so a hit on ANY of them
 *     resolves the same slot). `intersection.instanceId` IS the ring index:
 *       describeCrystal(intersection.instanceId)
 *   • Auto-labels: pick rings by recency/zone (e.g. newest produced, the ember
 *     crossing) and call describeCrystal(ringIndex) directly — `anchor` is the
 *     crystal's live world-space tip (project it for a DOM label; for a missed
 *     slot's vacancy it falls back to the spine point).
 *   getSegmentInfo(ringIndex) remains as the raw metadata subset.
 *
 * PRESENTATION-MODE FRAMING (scripted shots, mouse-less): getFramingAnchors()
 * returns live world-space anchor points (head / bright centroid / ember band /
 * tail fade) — pair them with the parameterized camera constants in CONFIG
 * (ORBIT_RADIUS, CAMERA_TARGET_Y, ORBIT_HEIGHT_Y, ORBIT_HEIGHT_DRIFT, CAMERA_FOV);
 * no single-orbit assumption is baked anywhere in this module.
 */
export class CrystalAxis {
  /** Group root of the cluster (gems, druzy, stem, lights, coma are children). */
  readonly mesh: THREE.Group;
  /** Real point light at the growth head — blooms each nucleation. */
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

  // --- Internals -------------------------------------------------------------------
  private readonly maxSegments = CONFIG.MAX_SEGMENTS;
  private readonly druzyPerSlot = CONFIG.CLUSTER_DRUZY_PER_SLOT;

  private gemMeshes: THREE.InstancedMesh[] = [];
  private druzyMesh: THREE.InstancedMesh;
  private stem: THREE.Mesh;
  /** Inner cavity wall — same sweep at ~0.78 radius, inverted normals: any opening
   *  in the outer skin shows dark stone interior (shell THICKNESS), never space. */
  private stemCore: THREE.Mesh;
  private coma: THREE.Points;
  private comaMat: THREE.ShaderMaterial;
  private emberLight: THREE.PointLight;

  private gemMat: THREE.MeshPhysicalMaterial;
  private druzyMat: THREE.MeshPhysicalMaterial;
  private stemMat: THREE.MeshStandardMaterial;
  private stemCoreMat: THREE.MeshStandardMaterial;

  /** Shared uniform record merged into every patched material (live updates). */
  private u: ClusterUniforms;

  // Full-scene grab for the gem refraction (Reflector pattern — the stock
  // transmission pass only renders opaque objects; our sky is transparent points).
  private grabRT: THREE.WebGLRenderTarget | null = null;
  private grabbing = false;
  private grabSize = new THREE.Vector2();
  private envRT: THREE.WebGLRenderTarget | null = null;

  private headProgress = 0;   // segments added (absolute)
  private scrollPos = 0;      // eased follower of headProgress — the felt heartbeat
  private timeAcc = 0;
  private strikeT = 99;       // seconds since last nucleation (starts "long ago")
  private tipPulse = 0;
  private lastProducedBirth = -1e9;
  // Camera distance to the head, captured by the grab pass each frame: the head
  // light is exposure-compensated so the growth front neither floods at ZOOM_MIN
  // nor dies at the idle orbit (1/d² is unforgiving across a 4× distance range).
  private camDistToHead: number = CONFIG.ORBIT_RADIUS;

  // Per-segment state (ring buffers)
  private segmentBirth: Float64Array;     // absolute index at write time (-1 empty)
  private segmentBirthTime: Float32Array; // for the nucleation scale-in
  private segmentVariant: Uint8Array;     // gem habit per segment (leader-stable)
  private segmentHue: Float32Array;       // family hue per segment (describeCrystal)
  private gemTheta: Float32Array;         // azimuth around the spine
  private gemTilt: Float32Array;          // head-ward lean
  private gemRoll: Float32Array;
  private gemLen: Float32Array;
  private gemWidX: Float32Array;
  private gemWidZ: Float32Array;
  // Flanking prisms (2 per slot, on the two unused habit meshes at the same ring):
  // the slot's deposit becomes an interlocking clump instead of a lone blade.
  private gemFTheta: Float32Array;        // maxSegments × 2
  private gemFLen: Float32Array;
  private gemFWid: Float32Array;
  // Druzy micro statics (maxSegments × druzyPerSlot)
  private dTheta: Float32Array;
  private dSOff: Float32Array;
  private dScale: Float32Array;
  private dTilt: Float32Array;

  // Per-variant instanced attributes (kept for partial re-seeding on ring reuse)
  private gemBirthAttr: THREE.InstancedBufferAttribute[] = [];
  private gemHueAttr: THREE.InstancedBufferAttribute[] = [];
  private gemSeedAttr: THREE.InstancedBufferAttribute[] = [];
  private gemMissedAttr: THREE.InstancedBufferAttribute[] = [];
  private dBirthAttr: THREE.InstancedBufferAttribute;
  private dHueAttr: THREE.InstancedBufferAttribute;
  private dSeedAttr: THREE.InstancedBufferAttribute;
  private dMissedAttr: THREE.InstancedBufferAttribute;

  // Spine lookup tables (uniform arc-length; local space, head at origin)
  private static readonly CURVE_RES = 512;
  private curvePos: Float32Array;
  private curveT: Float32Array;
  private curveN: Float32Array;
  private curveB: Float32Array;
  private curveLen = 1;
  private curveDs = 1;

  constructor() {
    this.mesh = new THREE.Group();
    this.mesh.name = 'crystal-cluster';
    this.mesh.position.set(0, CONFIG.CLUSTER_HEAD_Y, 0); // head = local origin

    // ================= Spine: a compact 3D LOOP ==================================
    // Not a thread and not a planar hook (which reads as a teardrop edge-on) but a
    // ~57-unit loop that wraps in all three axes (cubic Bézier → uniform arc-length
    // resample → parallel-transport frames; no twist pops). Head at top; the arc
    // dives to a belly and curls BACK UP-AND-ACROSS so the matrix end tucks into the
    // upper body instead of bottoming out as a tail. The crystal cloud it carries is
    // near-equiaxed (~36×39×36) — a rounded boulder/geode from EVERY side, no taper.
    {
      const b0 = new THREE.Vector3(0, 0, 0);
      const b1 = new THREE.Vector3(19, -11, 19);
      const b2 = new THREE.Vector3(-10, -25, 25);
      const b3 = new THREE.Vector3(-19, -15, -3);
      const R = CrystalAxis.CURVE_RES;
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
      let j = 0;
      for (let i = 0; i < R; i++) {
        const s = i * this.curveDs;
        while (j < PRE - 2 && cum[j + 1] < s) j++;
        const span = Math.max(cum[j + 1] - cum[j], 1e-6);
        const f = THREE.MathUtils.clamp((s - cum[j]) / span, 0, 1);
        const p = new THREE.Vector3().lerpVectors(pre[j], pre[j + 1], f);
        this.curvePos.set([p.x, p.y, p.z], i * 3);
      }
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
          tmp.set(1, 0, 0);
          if (Math.abs(t0.dot(tmp)) > 0.9) tmp.set(0, 0, 1);
          n0.crossVectors(t0, tmp).normalize();
        } else {
          n0.addScaledVector(t0, -n0.dot(t0));
          if (n0.lengthSq() < 1e-10) n0.set(1, 0, 0);
          n0.normalize();
        }
        this.curveN.set([n0.x, n0.y, n0.z], i * 3);
        tmp.crossVectors(t0, n0).normalize();
        this.curveB.set([tmp.x, tmp.y, tmp.z], i * 3);
      }
    }

    // ================= Shared uniforms ==============================================
    const emberS = CONFIG.CLUSTER_START_S + CONFIG.FINALITY_DEPTH * CONFIG.CLUSTER_SPACING;
    this.u = {
      uTime: { value: 0 },
      uBreath: { value: 0.5 },
      uScroll: { value: 0 },
      uSpacing: { value: CONFIG.CLUSTER_SPACING },
      uStartS: { value: CONFIG.CLUSTER_START_S },
      uFinality: { value: CONFIG.FINALITY_DEPTH },
      uFadeS: { value: CONFIG.CLUSTER_FADE_S },
      uEmberS: { value: emberS },
      uEmberW: { value: CONFIG.CLUSTER_EMBER_WIDTH },
      uFlashE: { value: 0 },
      uStruckBirth: { value: -1e9 },
      uStrikeT: { value: 99 },
      uWaveSpeed: { value: CONFIG.CLUSTER_WAVE_SPEED },
      uFamPurple: { value: COLORS.CRYSTAL_PURPLE.clone() },
      uFamMagenta: { value: COLORS.CRYSTAL_MAGENTA.clone() },
      uFamGreen: { value: COLORS.CRYSTAL_GREEN.clone() },
      uMatrixCol: { value: COLORS.CRYSTAL_OLD.clone() },
      uEmberCol: { value: COLORS.CRYSTAL_AMBER.clone() },
      uCoreCol: { value: COLORS.CRYSTAL_CORE.clone() },
      uGemRough: { value: 0.07 },
      uMatrixRough: { value: 0.58 },
      // Matrix-shell-only (stem): dark cool host-rock palette + reduced ember response.
      // Kept separate from uMatrixCol (which the gems/druzy use for their deep-matrix
      // color) so this pass cannot touch the jewels.
      uStemCol: { value: COLORS.MATRIX_ROCK.clone() },
      uStemLip: { value: COLORS.MATRIX_ROCK_LIP.clone() },
      uStemEmber: { value: CONFIG.CLUSTER_MATRIX_EMBER },
      uGrabTex: { value: null },
      uGrabSize: { value: new THREE.Vector2(2, 2) },
      uCluIor: { value: CONFIG.CLUSTER_GEM_IOR },
      uCluThickness: { value: CONFIG.CLUSTER_GEM_THICKNESS },
      uCluDispersion: { value: CONFIG.CLUSTER_GEM_DISPERSION },
      uCluAttDist: { value: CONFIG.CLUSTER_ATT_DISTANCE },
    };

    // ================= Materials ====================================================
    // Real physical surfaces — the difference between "beautiful artifact" and
    // "game item". Data behavior is injected, never hand-rolled lighting.
    this.gemMat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      metalness: 0.0,
      roughness: 0.07,
      clearcoat: 0.55,
      clearcoatRoughness: 0.22,
      iridescence: 0.30,
      iridescenceIOR: 1.32,
      ior: CONFIG.CLUSTER_GEM_IOR,
      envMapIntensity: 1.1,
      // transmission stays 0 deliberately: the mesh keeps opaque-pass depth and we
      // run our own full-scene volume refraction (see shaders/crystal.ts).
    });
    this.gemMat.onBeforeCompile = (shader) => applyGemPatches(shader, this.u);
    this.gemMat.customProgramCacheKey = () => 'cluster-gem-v1';

    this.druzyMat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      metalness: 0.0,
      roughness: 0.13,
      clearcoat: 0.35,
      clearcoatRoughness: 0.25,
      iridescence: 0.5,            // the aura-quartz sheen lives on the micro-glitter
      iridescenceIOR: 1.35,
      envMapIntensity: 1.8,
    });
    this.druzyMat.onBeforeCompile = (shader) => applySolidPatches(shader, this.u);
    this.druzyMat.customProgramCacheKey = () => 'cluster-druzy-v1';

    this.stemMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      metalness: 0.0,        // pure dielectric — no metallic sheen on rough stone
      roughness: 0.9,        // matte base (the shader refines roughness per-fragment)
      envMapIntensity: 0.08, // the shared env is warm; the shader also crushes its grazing fresnel (the tan rim)
    });
    this.stemMat.onBeforeCompile = (shader) => applyStemPatches(shader, this.u);
    this.stemMat.customProgramCacheKey = () => 'cluster-stem-v2';

    // Inner cavity wall: near-black ultra-matte stone. Deliberately NO envMap (the
    // shared env is warm) — only the interior point lights may kiss it faintly.
    this.stemCoreMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(0.012, 0.013, 0.022),
      metalness: 0.0,
      roughness: 1.0,
      envMapIntensity: 0.0,
    });
    this.stemCoreMat.onBeforeCompile = (shader) => applyStemCorePatches(shader, this.u);
    this.stemCoreMat.customProgramCacheKey = () => 'cluster-stem-core-v1';

    // ================= State arrays =================================================
    const maxSeg = this.maxSegments;
    const K = this.druzyPerSlot;
    this.segmentSlots = new Array(maxSeg).fill(-1);
    this.segmentMissed = new Uint8Array(maxSeg);
    this.segmentLeaders = new Int32Array(maxSeg).fill(-1);
    this.segmentBirth = new Float64Array(maxSeg).fill(-1);
    this.segmentBirthTime = new Float32Array(maxSeg);
    this.segmentVariant = new Uint8Array(maxSeg);
    this.segmentHue = new Float32Array(maxSeg);
    this.gemTheta = new Float32Array(maxSeg);
    this.gemTilt = new Float32Array(maxSeg);
    this.gemRoll = new Float32Array(maxSeg);
    this.gemLen = new Float32Array(maxSeg);
    this.gemWidX = new Float32Array(maxSeg);
    this.gemWidZ = new Float32Array(maxSeg);
    this.gemFTheta = new Float32Array(maxSeg * 2);
    this.gemFLen = new Float32Array(maxSeg * 2);
    this.gemFWid = new Float32Array(maxSeg * 2);
    this.dTheta = new Float32Array(maxSeg * K);
    this.dSOff = new Float32Array(maxSeg * K);
    this.dScale = new Float32Array(maxSeg * K);
    this.dTilt = new Float32Array(maxSeg * K);

    // ================= Gem variant meshes ===========================================
    // Three crystal habits — families of terminated prisms, never one clean gem.
    // A static, generous bounding sphere over the whole reef gates raycasts:
    // InstancedMesh.computeBoundingSphere() would cache the construction-time
    // (all-zero) sphere and never see the per-frame instance motion.
    const reefSphere = (() => {
      const c = new THREE.Vector3(), t = new THREE.Vector3();
      const n = new THREE.Vector3(), b = new THREE.Vector3();
      this.frameAt(CONFIG.CLUSTER_FADE_S * 0.5, c, t, n, b);
      return new THREE.Sphere(c.clone(), CONFIG.CLUSTER_FADE_S * 0.62 + 26);
    })();
    const habits: Array<'stout' | 'blade' | 'twin'> = ['stout', 'blade', 'twin'];
    for (let v = 0; v < 3; v++) {
      const geo = CrystalAxis.buildCrystalGeometry(habits[v], 0xc1 + v * 37);
      const birth = new THREE.InstancedBufferAttribute(new Float32Array(maxSeg).fill(-1e9), 1);
      const hue = new THREE.InstancedBufferAttribute(new Float32Array(maxSeg), 1);
      const seed = new THREE.InstancedBufferAttribute(new Float32Array(maxSeg), 1);
      const missed = new THREE.InstancedBufferAttribute(new Float32Array(maxSeg), 1);
      geo.setAttribute('aBirth', birth);
      geo.setAttribute('aHue', hue);
      geo.setAttribute('aSeed', seed);
      geo.setAttribute('aMissed', missed);
      this.gemBirthAttr.push(birth);
      this.gemHueAttr.push(hue);
      this.gemSeedAttr.push(seed);
      this.gemMissedAttr.push(missed);

      const im = new THREE.InstancedMesh(geo, this.gemMat, maxSeg);
      im.name = `cluster-gems-${v}`;
      im.frustumCulled = false;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for (let i = 0; i < maxSeg; i++) im.setMatrixAt(i, CrystalAxis._zeroM);
      im.instanceMatrix.needsUpdate = true;
      im.boundingSphere = reefSphere.clone(); // static gate for raycasts (hover)
      this.gemMeshes.push(im);
      this.mesh.add(im);
    }

    // The grab + environment hook rides the first gem mesh (renders once per frame).
    this.gemMeshes[0].onBeforeRender = (renderer, scene, camera) => {
      this.runGrabPass(renderer, scene as THREE.Scene, camera);
    };

    // ================= Druzy micro-crystal mesh =====================================
    {
      const geo = CrystalAxis.buildDruzyGeometry(0x5eed);
      const n = maxSeg * K;
      this.dBirthAttr = new THREE.InstancedBufferAttribute(new Float32Array(n).fill(-1e9), 1);
      this.dHueAttr = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
      this.dSeedAttr = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
      this.dMissedAttr = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
      geo.setAttribute('aBirth', this.dBirthAttr);
      geo.setAttribute('aHue', this.dHueAttr);
      geo.setAttribute('aSeed', this.dSeedAttr);
      geo.setAttribute('aMissed', this.dMissedAttr);

      this.druzyMesh = new THREE.InstancedMesh(geo, this.druzyMat, n);
      this.druzyMesh.name = 'cluster-druzy';
      this.druzyMesh.frustumCulled = false;
      this.druzyMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for (let i = 0; i < n; i++) this.druzyMesh.setMatrixAt(i, CrystalAxis._zeroM);
      this.druzyMesh.instanceMatrix.needsUpdate = true;
      this.druzyMesh.raycast = () => { /* data hover targets the gems only */ };
      this.mesh.add(this.druzyMesh);
    }

    // ================= Matrix stem ==================================================
    this.stem = new THREE.Mesh(this.buildStemGeometry(0xa11a), this.stemMat);
    this.stem.name = 'cluster-stem';
    this.stem.frustumCulled = false;
    this.stem.raycast = () => { /* not a data surface */ };
    this.mesh.add(this.stem);

    // Inner cavity wall (see field doc): the shell's apparent THICKNESS. Same sweep
    // and bump field at 0.78 radius, winding inverted so its faces look inward —
    // through any opening the eye lands on dark rock, never on stars.
    this.stemCore = new THREE.Mesh(this.buildStemGeometry(0xa11a, 0.78, true), this.stemCoreMat);
    this.stemCore.name = 'cluster-stem-core';
    this.stemCore.frustumCulled = false;
    this.stemCore.raycast = () => { /* not a data surface */ };
    this.mesh.add(this.stemCore);

    // ================= Lights =======================================================
    this.tipLight = new THREE.PointLight(
      COLORS.TIP_LIGHT.getHex(),
      CONFIG.CLUSTER_LIGHT_INTENSITY,
      CONFIG.TIP_LIGHT_DISTANCE,
      2,
    );
    this.tipLight.position.set(0, 0, 0);
    this.mesh.add(this.tipLight);

    this.emberLight = new THREE.PointLight(
      COLORS.CRYSTAL_AMBER.getHex(),
      CONFIG.CLUSTER_EMBER_INTENSITY,
      70,
      2,
    );
    {
      const p = new THREE.Vector3(), t = new THREE.Vector3();
      const n = new THREE.Vector3(), b = new THREE.Vector3();
      this.frameAt(emberS, p, t, n, b);
      this.emberLight.position.copy(p);
    }
    this.mesh.add(this.emberLight);

    // ================= Coma — the nucleation halo at the head ======================
    const comaGeo = new THREE.BufferGeometry();
    comaGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0]), 3));
    this.comaMat = new THREE.ShaderMaterial({
      vertexShader: flareVertexShader,
      fragmentShader: flareFragmentShader,
      uniforms: {
        uSize: { value: 13 },
        uIntensity: { value: 0 },
        uColor: { value: COLORS.CRYSTAL_AMBER.clone() },
        uIceColor: { value: COLORS.CRYSTAL_YOUNG.clone() },
        uTime: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.coma = new THREE.Points(comaGeo, this.comaMat);
    this.coma.name = 'cluster-coma';
    this.coma.frustumCulled = false;
    this.mesh.add(this.coma);
  }

  private static _zeroM = new THREE.Matrix4().makeScale(0, 0, 0);

  /** Gem meshes for the hover feature — intersection.instanceId is the ring index. */
  get raycastTargets(): THREE.Object3D[] {
    return this.gemMeshes;
  }

  // --- Deterministic per-slot RNG (stable across ring reuse) ----------------------
  private static mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** Tiny CPU value-noise (geometry baking only). */
  private static vnoise3(x: number, y: number, z: number): number {
    const h = (xi: number, yi: number, zi: number) => {
      let n = xi * 374761393 + yi * 668265263 + zi * 2147483647;
      n = (n ^ (n >>> 13)) * 1274126177;
      return (((n ^ (n >>> 16)) >>> 0) % 100000) / 100000;
    };
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const xf = x - xi, yf = y - yi, zf = z - zi;
    const sx = xf * xf * (3 - 2 * xf), sy = yf * yf * (3 - 2 * yf), sz = zf * zf * (3 - 2 * zf);
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
    return lerp(
      lerp(lerp(h(xi, yi, zi), h(xi + 1, yi, zi), sx), lerp(h(xi, yi + 1, zi), h(xi + 1, yi + 1, zi), sx), sy),
      lerp(lerp(h(xi, yi, zi + 1), h(xi + 1, yi, zi + 1), sx), lerp(h(xi, yi + 1, zi + 1), h(xi + 1, yi + 1, zi + 1), sx), sy),
      sz,
    );
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
    if (s < 0) outP.addScaledVector(outT, s);
    else if (s > this.curveLen) outP.addScaledVector(outT, s - this.curveLen);
  }

  /**
   * Matrix shell radius at arc-length s. Fat from just below the head (NO thin
   * neck — the old stalk read), swelling into a rounded botryoidal body, then
   * rounding off toward the fade: the chunky core the jeweled crust grows on.
   */
  private static stemRadius(s: number): number {
    const grow = THREE.MathUtils.smoothstep(s, 1, 16);   // bulk on immediately
    const swell = THREE.MathUtils.smoothstep(s, 10, 34);  // round the body out
    const taper = 1 - 0.42 * THREE.MathUtils.smoothstep(s, 32, CONFIG.CLUSTER_FADE_S);
    // Fat solid core so the loop's interior reads as rock, not a see-through pocket.
    // Modestly fatter than round 1 (esp. the tail taper 0.5→0.58 of full girth):
    // the lobes read inflated by mass, not a sagging skin. Same spine, same anchors.
    return (4.0 + 6.2 * grow + 2.8 * swell) * taper;
  }

  // ================= Geometry builders ==============================================

  /**
   * One terminated crystal habit, unit length along +Y (root at y=0, tip at y≈1),
   * flat-faceted (non-indexed). Three habits: 'stout' prism, thin 'blade', 'twin'
   * (interpenetrating pair) — the reference collage's family vocabulary.
   */
  private static buildCrystalGeometry(habit: 'stout' | 'blade' | 'twin', seedNum: number): THREE.BufferGeometry {
    const rng = CrystalAxis.mulberry32(seedNum);
    const positions: number[] = [];

    const pushPrism = (
      cx: number, cz: number, baseY: number, tipY: number,
      width: number, zFlat: number, sides: number, twist: number,
    ) => {
      // Waist rings: lower (near base) and upper (where the termination starts)
      const lowY = baseY + (tipY - baseY) * 0.10;
      const upY = baseY + (tipY - baseY) * (habit === 'blade' ? 0.70 : 0.58);
      const lo: number[][] = [];
      const up: number[][] = [];
      for (let k = 0; k < sides; k++) {
        const ang = (k / sides) * Math.PI * 2 + (rng() - 0.5) * (Math.PI / sides) * 0.8 + twist;
        const rl = width * (0.78 + 0.42 * rng());
        const ru = width * (0.84 + 0.42 * rng());
        lo.push([cx + Math.cos(ang) * rl, lowY + (rng() - 0.5) * 0.05, cz + Math.sin(ang) * rl * zFlat]);
        up.push([cx + Math.cos(ang + 0.06) * ru, upY + (rng() - 0.5) * 0.06, cz + Math.sin(ang + 0.06) * ru * zFlat]);
      }
      const tipX = cx + (rng() - 0.5) * width * 0.7;
      const tipZ = cz + (rng() - 0.5) * width * 0.7 * zFlat;
      const rootX = cx + (rng() - 0.5) * width * 0.4;
      const rootZ = cz + (rng() - 0.5) * width * 0.4 * zFlat;
      const tri = (A: number[], B: number[], C: number[]) => positions.push(...A, ...B, ...C);
      for (let k = 0; k < sides; k++) {
        const k2 = (k + 1) % sides;
        // prism wall (two triangles)
        tri(lo[k], lo[k2], up[k2]);
        tri(lo[k], up[k2], up[k]);
        // termination face to the tip
        tri(up[k], up[k2], [tipX, tipY, tipZ]);
        // root cap down to a buried apex
        tri(lo[k2], lo[k], [rootX, baseY - 0.08, rootZ]);
      }
    };

    if (habit === 'stout') {
      pushPrism(0, 0, 0, 1.0, 0.30, 1.0, 6, 0);
    } else if (habit === 'blade') {
      pushPrism(0, 0, 0, 1.0, 0.30, 0.40, 5, 0);
    } else {
      pushPrism(0, 0, 0, 1.0, 0.26, 0.9, 6, 0);
      pushPrism(0.16, -0.10, 0.04, 0.62, 0.17, 0.85, 5, 0.7); // the smaller twin
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    geo.computeVertexNormals(); // non-indexed → true flat facets
    geo.computeBoundingSphere();
    return geo;
  }

  /** A tiny irregular bipyramid — one druzy glitter grain. */
  private static buildDruzyGeometry(seedNum: number): THREE.BufferGeometry {
    const rng = CrystalAxis.mulberry32(seedNum);
    const positions: number[] = [];
    const sides = 5;
    const ring: number[][] = [];
    for (let k = 0; k < sides; k++) {
      const ang = (k / sides) * Math.PI * 2 + (rng() - 0.5) * 0.5;
      const r = 0.30 * (0.7 + 0.6 * rng());
      ring.push([Math.cos(ang) * r, 0.42 + (rng() - 0.5) * 0.12, Math.sin(ang) * r]);
    }
    const tip = [(rng() - 0.5) * 0.16, 1.0, (rng() - 0.5) * 0.16];
    const root = [(rng() - 0.5) * 0.1, -0.05, (rng() - 0.5) * 0.1];
    for (let k = 0; k < sides; k++) {
      const k2 = (k + 1) % sides;
      positions.push(...ring[k], ...ring[k2], ...tip);
      positions.push(...ring[k2], ...ring[k], ...root);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    return geo;
  }

  /**
   * The botryoidal matrix stem along the spine: lumpy, rounded (smooth normals),
   * crevice-darkened, with aS / aCrev baked for the shader's zoning + ember band.
   * `radiusScale` + `invert` build the inner cavity wall: the same sweep and the
   * same bump field at a smaller radius, winding flipped so computed normals face
   * INWARD — the visible interior wherever the outer skin opens or dissolves.
   */
  private buildStemGeometry(seedNum: number, radiusScale = 1, invert = false): THREE.BufferGeometry {
    void seedNum;
    const SEGS = 20; // rounder cross-section — fewer flat low-poly facets on the silhouette
    const s0 = 0.6;
    const s1 = CONFIG.CLUSTER_FADE_S + 6;
    const RINGS = 96;
    const p = new THREE.Vector3(), t = new THREE.Vector3();
    const n = new THREE.Vector3(), b = new THREE.Vector3();

    const positions = new Float32Array(RINGS * SEGS * 3);
    const aS = new Float32Array(RINGS * SEGS);
    const aCrev = new Float32Array(RINGS * SEGS);
    const indices: number[] = [];

    for (let i = 0; i < RINGS; i++) {
      const f = i / (RINGS - 1);
      const s = s0 + (s1 - s0) * f;
      this.frameAt(s, p, t, n, b);
      // pinch both ends so the tube reads as a grown mass, not a pipe
      const endPinch =
        THREE.MathUtils.smoothstep(f, 0, 0.035) * (1 - 0.85 * THREE.MathUtils.smoothstep(f, 0.96, 1));
      const r0 = CrystalAxis.stemRadius(s) * radiusScale * Math.max(endPinch, 0.06);
      for (let k = 0; k < SEGS; k++) {
        const ang = (k / SEGS) * Math.PI * 2;
        const ca = Math.cos(ang), sa = Math.sin(ang);
        // Botryoidal lumps: seamless noise on the (cos, sin, s) domain — deep and
        // multi-octave so the matrix reads as rough rock, not a smooth glowing skin.
        // Concavities are floored at -0.30 (lumps stay proud to +~0.47): rounded
        // masses with shallow valleys — never the deep dents of a deflating skin.
        const n1 = CrystalAxis.vnoise3(ca * 1.6 + 7.3, sa * 1.6 + 2.1, s * 0.33);
        const n2 = CrystalAxis.vnoise3(ca * 3.4 + 1.7, sa * 3.4 + 9.2, s * 0.85);
        const n3 = CrystalAxis.vnoise3(ca * 6.1 + 4.4, sa * 6.1 + 5.5, s * 1.7);
        const bump = Math.max(
          (n1 - 0.5) * 0.50 + (n2 - 0.5) * 0.30 + (n3 - 0.5) * 0.14, -0.30);
        const r = r0 * (1 + bump);
        const idx = i * SEGS + k;
        positions[idx * 3] = p.x + (n.x * ca + b.x * sa) * r;
        positions[idx * 3 + 1] = p.y + (n.y * ca + b.y * sa) * r;
        positions[idx * 3 + 2] = p.z + (n.z * ca + b.z * sa) * r;
        aS[idx] = s;
        aCrev[idx] = THREE.MathUtils.clamp(1 - THREE.MathUtils.smoothstep(bump, -0.12, 0.22), 0, 1);
        if (i < RINGS - 1) {
          const a0 = idx;
          const a1 = i * SEGS + ((k + 1) % SEGS);
          const b0 = (i + 1) * SEGS + k;
          const b1 = (i + 1) * SEGS + ((k + 1) % SEGS);
          if (invert) indices.push(a0, a1, b0, a1, b1, b0);
          else indices.push(a0, b0, a1, a1, b0, b1);
        }
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aS', new THREE.BufferAttribute(aS, 1));
    geo.setAttribute('aCrev', new THREE.BufferAttribute(aCrev, 1));
    geo.setIndex(indices);
    geo.computeVertexNormals(); // smooth — botryoidal masses are rounded
    geo.computeBoundingSphere();
    return geo;
  }

  // ================= Environment + grab pass ========================================

  /**
   * Palette-matched environment for the physical materials: deep indigo space, a
   * violet horizon haze, one warm amber field (the validator-cloud latitude) and
   * three bright softbox cards for crisp facet speculars. PMREM'd once, assigned
   * to the cluster materials only (scene.environment stays untouched — Wiring's).
   */
  private buildEnvironment(renderer: THREE.WebGLRenderer): void {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();

    const domeMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          float el = d.y;
          float az = atan(d.z, d.x);
          // deep indigo nadir → near-black zenith
          vec3 col = mix(vec3(0.030, 0.020, 0.070), vec3(0.006, 0.008, 0.030), smoothstep(-1.0, 1.0, el));
          // violet horizon haze
          col += vec3(0.10, 0.05, 0.22) * exp(-pow(el + 0.04, 2.0) / 0.050);
          // the warm amber field (validator-cloud latitude), strongest on one side
          col += vec3(0.55, 0.33, 0.12) * exp(-pow(el + 0.17, 2.0) / 0.028) * (0.55 + 0.45 * cos(az - 0.7));
          // a faint green glint region opposite it (the brand's second pole)
          col += vec3(0.04, 0.30, 0.18) * exp(-pow(el - 0.32, 2.0) / 0.030) * (0.5 + 0.5 * cos(az + 2.4));
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(40, 48, 24), domeMat);
    envScene.add(dome);

    // Softbox cards — compact bright sources so glassy facets get real glints.
    const card = (color: THREE.ColorRepresentation, intensity: number, pos: THREE.Vector3, size: number) => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(size, size * 0.62),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide }),
      );
      m.position.copy(pos);
      m.lookAt(0, 0, 0);
      envScene.add(m);
    };
    card(0xffd9a0, 6.5, new THREE.Vector3(18, -7, 10), 7);   // warm amber key
    card(0xb9a4ff, 5.0, new THREE.Vector3(-16, 12, -8), 6);  // violet rim
    card(0xbfffe2, 4.0, new THREE.Vector3(4, 16, 14), 4);    // cool green-white kicker

    this.envRT = pmrem.fromScene(envScene, 0.04);
    pmrem.dispose();
    dome.geometry.dispose();
    domeMat.dispose();
    envScene.traverse((o) => {
      if (o instanceof THREE.Mesh && o !== dome) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });

    for (const m of [this.gemMat, this.druzyMat, this.stemMat]) {
      m.envMap = this.envRT.texture;
      m.needsUpdate = true;
    }
  }

  /**
   * Full-scene grab for the gem refraction (Reflector pattern — sanctioned nested
   * render). Runs once per composer frame, from the first gem mesh's onBeforeRender.
   * The gems and the coma hide during the grab (refracting your own halo reads as
   * milk); everything else — stars, validator cloud, beams, matrix — bends through.
   */
  private runGrabPass(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): void {
    if (this.grabbing) return;
    if (scene.overrideMaterial) return; // depth/DoF prepass — not a beauty frame
    if (!this.envRT) this.buildEnvironment(renderer);
    this.camDistToHead = camera.getWorldPosition(CrystalAxis._pos).distanceTo(this.mesh.position);
    this.grabbing = true;

    renderer.getDrawingBufferSize(this.grabSize);
    const gw = Math.max(2, Math.floor(this.grabSize.x / 2));
    const gh = Math.max(2, Math.floor(this.grabSize.y / 2));
    if (!this.grabRT || this.grabRT.width !== gw || this.grabRT.height !== gh) {
      this.grabRT?.dispose();
      this.grabRT = new THREE.WebGLRenderTarget(gw, gh, {
        generateMipmaps: true,
        minFilter: THREE.LinearMipmapLinearFilter,
        magFilter: THREE.LinearFilter,
        type: THREE.HalfFloatType,
        depthBuffer: true,
      });
    }

    const prevRT = renderer.getRenderTarget();
    const prevXr = renderer.xr.enabled;
    const prevShadow = renderer.shadowMap.autoUpdate;
    const prevAutoClear = renderer.autoClear;
    const prevTone = renderer.toneMapping;
    renderer.xr.enabled = false;
    renderer.shadowMap.autoUpdate = false;
    renderer.autoClear = true;
    renderer.toneMapping = THREE.NoToneMapping; // grade once, in the main pass

    for (const g of this.gemMeshes) g.visible = false;
    const comaWasVisible = this.coma.visible;
    this.coma.visible = false;

    renderer.setRenderTarget(this.grabRT);
    renderer.render(scene, camera);

    for (const g of this.gemMeshes) g.visible = true;
    this.coma.visible = comaWasVisible;

    renderer.xr.enabled = prevXr;
    renderer.shadowMap.autoUpdate = prevShadow;
    renderer.autoClear = prevAutoClear;
    renderer.toneMapping = prevTone;
    renderer.setRenderTarget(prevRT);

    this.u.uGrabTex.value = this.grabRT.texture;
    (this.u.uGrabSize.value as THREE.Vector2).set(gw, gh);
    this.grabbing = false;
  }

  // ================= Data events ====================================================

  /**
   * One call per REAL slot (the data heartbeat): the reef glides one spacing and a
   * new crystal nucleates at the head — one of its leader's four-blade spray, in
   * the leader's hue family. `slot` and `leaderIndex` are optional additive
   * metadata (orchestrator hook requested); without them the leader grouping is
   * inferred from the 4-slot cadence.
   */
  addSegment(missed: boolean, slot?: number, leaderIndex?: number): void {
    const K = this.druzyPerSlot;
    const birth = this.headProgress;
    const ring = birth % this.maxSegments;
    const rng = CrystalAxis.mulberry32(birth * 2654435761 + 1013904223);

    // Leader-stable family values (azimuth, hue, habit) — the spray identity.
    const slotForPhase = slot ?? birth;
    const leaderOrdinal = Math.floor(slotForPhase / CONFIG.LEADER_SLOTS);
    const slotInLeader = ((slotForPhase % CONFIG.LEADER_SLOTS) + CONFIG.LEADER_SLOTS) % CONFIG.LEADER_SLOTS;
    const lrng = CrystalAxis.mulberry32(leaderOrdinal * 747796405 + 2891336453);
    const azimuth = leaderOrdinal * 2.39996 + (lrng() - 0.5) * 0.5;
    const famPick = lrng();
    let hue: number; // family anchor on the Solana axis: 0 green · 0.5 magenta · 1 purple
    if (famPick < 0.45) hue = 0.80 + 0.18 * lrng();
    else if (famPick < 0.75) hue = 0.44 + 0.14 * lrng();
    else hue = 0.04 + 0.16 * lrng();
    const variant = Math.floor(lrng() * 3) % 3;

    // Per-crystal habit within the spray; the leader's first slot is its dominant blade.
    const dominant = slotInLeader === 0;
    this.segmentVariant[ring] = variant;
    this.segmentHue[ring] = hue;
    // Fan the leader's four slots across a WIDE arc (not a tight stripe) so
    // neighbouring leaders' deposits overlap and fill the cross-section — packed
    // crystal, not see-through golden-angle stripes.
    this.gemTheta[ring] = azimuth + (slotInLeader - 1.5) * 0.8 + (rng() - 0.5) * 0.42;
    this.gemTilt[ring] = 0.18 + 0.62 * rng();
    this.gemRoll[ring] = rng() * Math.PI * 2;
    // Chunky terminated prisms, bigger + wider so they interlock and overlap into a
    // mass rather than sprinkle; the leader's first slot stays the dominant blade.
    this.gemLen[ring] = (8.5 + 4.5 * rng()) * (dominant ? 1.45 : 1.0);
    this.gemWidX[ring] = (3.1 + 1.8 * rng()) * (dominant ? 1.3 : 1.0);
    this.gemWidZ[ring] = (3.1 + 1.8 * rng()) * (dominant ? 1.3 : 1.0);
    // Two flanking prisms splay WIDE around the main blade — they tile the azimuthal
    // gaps so the crust reads continuous. Same slot, same family; on the two habit
    // meshes the main crystal doesn't use.
    for (let f = 0; f < 2; f++) {
      const i = ring * 2 + f;
      this.gemFTheta[i] = this.gemTheta[ring] + (f === 0 ? -1 : 1) * (0.7 + 0.7 * rng());
      this.gemFLen[i] = this.gemLen[ring] * (0.6 + 0.34 * rng());
      this.gemFWid[i] = (this.gemWidX[ring] + this.gemWidZ[ring]) * 0.5 * (0.68 + 0.3 * rng());
    }

    // Metadata (ring-buffered; hover feature)
    this.segmentSlots[ring] = slot ?? -1;
    this.segmentMissed[ring] = missed ? 1 : 0;
    this.segmentLeaders[ring] = leaderIndex ?? -1;
    this.segmentBirth[ring] = birth;
    this.segmentBirthTime[ring] = this.timeAcc;

    // Per-instance attributes on ALL THREE habit meshes (main + two flankers share
    // the ring index; each gets its own hue jitter/seed within the family).
    for (let g = 0; g < 3; g++) {
      this.gemBirthAttr[g].setX(ring, birth);
      this.gemHueAttr[g].setX(ring, THREE.MathUtils.clamp(hue + (rng() - 0.5) * 0.10, 0, 1));
      this.gemSeedAttr[g].setX(ring, rng());
      this.gemMissedAttr[g].setX(ring, missed ? 1 : 0);
      this.gemBirthAttr[g].needsUpdate = true;
      this.gemHueAttr[g].needsUpdate = true;
      this.gemSeedAttr[g].needsUpdate = true;
      this.gemMissedAttr[g].needsUpdate = true;
    }

    // Druzy deposit: a scatter of micro-crystals around the slot's azimuth sector.
    // A missed slot leaves a sparse pocket of dark cinders — the vacancy.
    for (let k = 0; k < K; k++) {
      const i = ring * K + k;
      this.dTheta[i] = azimuth + (rng() - 0.5) * 3.4; // wide — a glitter field wrapping the whole cross-section
      this.dSOff[i] = (rng() - 0.5) * 3.6; // absolute spread — independent of slot spacing
      this.dTilt[i] = 0.15 + 0.5 * rng();
      let sc = 1.8 + 2.6 * rng();
      if (missed) sc *= k % 2 === 0 ? 0.6 : 0; // sparse, stunted
      this.dScale[i] = sc;
      this.dBirthAttr.setX(i, birth);
      this.dHueAttr.setX(i, THREE.MathUtils.clamp(hue + (rng() - 0.5) * 0.16, 0, 1));
      this.dSeedAttr.setX(i, rng());
      this.dMissedAttr.setX(i, missed ? 1 : 0);
    }
    this.dBirthAttr.needsUpdate = true;
    this.dHueAttr.needsUpdate = true;
    this.dSeedAttr.needsUpdate = true;
    this.dMissedAttr.needsUpdate = true;

    if (!missed) this.lastProducedBirth = birth;
    this.headProgress++;
  }

  /**
   * The nucleation strike: the leader's packet lands (orchestrator calls this on
   * arrival). The head light blooms, the newest produced crystal flashes into
   * being, and a pulse of light races down the reef. Missed slots never strike.
   */
  strike(): void {
    this.tipPulse = 1.0;
    this.strikeT = 0;
    this.u.uFlashE.value = 1.0;
    this.u.uStruckBirth.value = this.lastProducedBirth;
  }

  // ================= Per-frame =====================================================

  private static _p = new THREE.Vector3();
  private static _t = new THREE.Vector3();
  private static _n = new THREE.Vector3();
  private static _b = new THREE.Vector3();
  private static _dir = new THREE.Vector3();
  private static _pos = new THREE.Vector3();
  private static _scl = new THREE.Vector3();
  private static _q = new THREE.Quaternion();
  private static _qRoll = new THREE.Quaternion();
  private static _m = new THREE.Matrix4();
  private static _up = new THREE.Vector3(0, 1, 0);

  update(dt: number): void {
    this.timeAcc += dt;
    this.strikeT += dt;

    // The heartbeat: eased glide toward the head — one spacing per slot, felt.
    this.scrollPos += (this.headProgress - this.scrollPos) * Math.min(1, CONFIG.CLUSTER_GLIDE_RATE * dt);
    // Backlog jump-cut: if the tab was hidden, slots kept arriving while the glide
    // stood still — snap to within a few slots so the reef never rushes past or
    // strands newborn crystals off the head (then glide the last stretch normally).
    if (this.headProgress - this.scrollPos > 8) this.scrollPos = this.headProgress - 8;

    // Suspended-mobile sway: the whole cluster slowly turns, so the reef's
    // silhouette cycles even for a static camera. Head stays at the local origin.
    const t = this.timeAcc;
    this.mesh.rotation.y = t * CONFIG.CLUSTER_SWAY_YAW;
    this.mesh.rotation.x = Math.sin(t * 0.10) * 0.026;
    this.mesh.rotation.z = Math.cos(t * 0.083) * 0.020;

    // Pulse decays
    this.tipPulse = this.tipPulse > 0.001 ? this.tipPulse * Math.exp(-dt * 3.2) : 0;
    const fe = this.u.uFlashE.value as number;
    this.u.uFlashE.value = fe > 0.001 ? fe * Math.exp(-dt * 3.4) : 0;

    // Idle dual-frequency breathing shared by all cluster materials
    const breath = 0.6 * Math.sin(t * 0.7) + 0.4 * Math.sin(t * 1.13 + 1.7);
    const breath01 = breath * 0.5 + 0.5;

    this.u.uTime.value = t;
    this.u.uBreath.value = breath01;
    this.u.uScroll.value = this.scrollPos;
    this.u.uStrikeT.value = this.strikeT;

    // Lights: physical falloff (decay 2) — candela-scale intensities. The pulse
    // multiplier stays gentle: newborn crystals sit 1-3u from this light and must
    // never blow to ACES white (the facets carry the moment, not a blob). The
    // head light is exposure-compensated by camera distance (captured in the grab
    // pass) so close zooms don't flood and the idle orbit doesn't starve.
    const camK = THREE.MathUtils.clamp(this.camDistToHead / CONFIG.ORBIT_RADIUS, 0.28, 1.0);
    const exposure = camK * camK;
    this.tipLight.intensity =
      (CONFIG.CLUSTER_LIGHT_INTENSITY * (0.8 + 0.2 * breath01) +
        this.tipPulse * CONFIG.CLUSTER_LIGHT_INTENSITY * 1.1) * exposure;
    const emberFlicker = 0.85 + 0.10 * breath01 + 0.05 * Math.sin(t * 2.3);
    this.emberLight.intensity = CONFIG.CLUSTER_EMBER_INTENSITY * emberFlicker * (0.45 + 0.55 * exposure);

    // Coma + cloud drive — same external semantics as the column/comet eras.
    // The halo sprite scales with the same exposure (it sits AT the light).
    this.comaMat.uniforms.uTime.value = t;
    this.comaMat.uniforms.uIntensity.value =
      (0.06 + 0.03 * breath01 + this.tipPulse * 0.55) * (0.30 + 0.70 * exposure);
    this.tipGlowIntensity = CONFIG.TIP_LIGHT_BASE * (0.6 + 0.2 * breath01) + this.tipPulse;

    this.updateInstances();
  }

  /**
   * CPU instance pass: place every live crystal + druzy grain along the spine
   * (glide, leader-spray azimuth, head-ward lean, nucleation scale-in). CPU-side
   * so rendered transforms are exactly what the raycaster sees (hover feature).
   */
  private updateInstances(): void {
    const K = this.druzyPerSlot;
    const P = CrystalAxis._p, T = CrystalAxis._t, N = CrystalAxis._n, B = CrystalAxis._b;
    const dir = CrystalAxis._dir, pos = CrystalAxis._pos, scl = CrystalAxis._scl;
    const q = CrystalAxis._q, qR = CrystalAxis._qRoll, m = CrystalAxis._m;
    const up = CrystalAxis._up;
    const spacing = CONFIG.CLUSTER_SPACING;
    const startS = CONFIG.CLUSTER_START_S;
    const cutS = CONFIG.CLUSTER_FADE_S + 6;
    const visible = Math.min(this.headProgress, this.maxSegments);

    for (let ring = 0; ring < visible; ring++) {
      const birth = this.segmentBirth[ring];
      if (birth < 0) continue;
      // Newborns wait in the head pocket until the glide reaches them (never
      // extrapolate off the spine's start during catch-up bursts).
      const sBase = Math.max(
        startS - 1.1,
        startS + (this.scrollPos - 1 - birth) * spacing,
      );
      const v = this.segmentVariant[ring];
      const missed = this.segmentMissed[ring] === 1;

      if (sBase > cutS) {
        // Fully dissolved into space — free the instances.
        for (let g = 0; g < 3; g++) this.gemMeshes[g].setMatrixAt(ring, CrystalAxis._zeroM);
        for (let k = 0; k < K; k++) this.druzyMesh.setMatrixAt(ring * K + k, CrystalAxis._zeroM);
        continue;
      }

      this.frameAt(sBase, P, T, N, B);
      const stemR = CrystalAxis.stemRadius(sBase);

      // Nucleation scale-in with a gentle overshoot — condensation, not a pop.
      const lived = this.timeAcc - this.segmentBirthTime[ring];
      let grow = 1;
      if (lived < 0.6) {
        const x = Math.max(lived, 0) / 0.6;
        grow = x * x * (3 - 2 * x) * (1 + 0.16 * Math.sin(Math.PI * x));
      }

      // Rooting retraction: crystals settle slightly shorter as they root so the old
      // end rounds toward the matrix shell — but GENTLY (the colour ramp already
      // carries the gem→matrix reveal; shrinking them hard left the tail hollow).
      const ageT = THREE.MathUtils.clamp(
        (this.scrollPos - 1 - birth) / CONFIG.FINALITY_DEPTH, 0, 1.6);
      const rootK = THREE.MathUtils.smoothstep(ageT, 0.55, 1.15);
      const lenTaper = 1 - 0.28 * rootK;
      const widTaper = 1 - 0.10 * rootK;

      // --- The slot's crystal clump: main blade + two flankers (none for a
      // missed slot — the vacancy) ---
      let fi = 0;
      for (let g = 0; g < 3; g++) {
        if (missed) {
          this.gemMeshes[g].setMatrixAt(ring, CrystalAxis._zeroM);
          continue;
        }
        let th: number, tilt: number, roll: number, lx: number, ly: number, lz: number;
        if (g === v) {
          th = this.gemTheta[ring];
          tilt = this.gemTilt[ring];
          roll = this.gemRoll[ring];
          lx = this.gemWidX[ring]; ly = this.gemLen[ring]; lz = this.gemWidZ[ring];
        } else {
          const i = ring * 2 + fi;
          th = this.gemFTheta[i];
          tilt = this.gemTilt[ring] * (0.75 + 0.5 * fi);
          roll = this.gemRoll[ring] + 2.1 * (fi + 1);
          lx = this.gemFWid[i]; ly = this.gemFLen[i]; lz = this.gemFWid[i];
          fi++;
        }
        const ct = Math.cos(th), st = Math.sin(th);
        dir.set(
          N.x * ct + B.x * st - T.x * tilt,
          N.y * ct + B.y * st - T.y * tilt,
          N.z * ct + B.z * st - T.z * tilt,
        );
        const dl = dir.length();
        if (dl > 1e-5) dir.multiplyScalar(1 / dl); else dir.set(0, 1, 0);
        // Stagger the root depth per crystal so the deposit packs a THICK shell —
        // some buried in the matrix, some proud — instead of a thin, see-through
        // single-radius sleeve (a stable hash off the crystal's own azimuth).
        const rh = Math.sin(th * 12.9898 + ring * 0.137) * 43758.5453;
        const radF = 0.16 + 0.6 * (rh - Math.floor(rh));
        pos.set(
          P.x + dir.x * stemR * radF,
          P.y + dir.y * stemR * radF,
          P.z + dir.z * stemR * radF,
        );
        q.setFromUnitVectors(up, dir);
        qR.setFromAxisAngle(up, roll);
        q.multiply(qR);
        scl.set(lx * grow * widTaper, ly * grow * lenTaper, lz * grow * widTaper);
        m.compose(pos, q, scl);
        this.gemMeshes[g].setMatrixAt(ring, m);
      }

      // --- The slot's druzy deposit ---
      for (let k = 0; k < K; k++) {
        const i = ring * K + k;
        const sc = this.dScale[i];
        if (sc <= 0) {
          this.druzyMesh.setMatrixAt(i, CrystalAxis._zeroM);
          continue;
        }
        const th = this.dTheta[i];
        const ct = Math.cos(th), st = Math.sin(th);
        dir.set(
          N.x * ct + B.x * st - T.x * this.dTilt[i],
          N.y * ct + B.y * st - T.y * this.dTilt[i],
          N.z * ct + B.z * st - T.z * this.dTilt[i],
        );
        const dl = dir.length();
        if (dl > 1e-5) dir.multiplyScalar(1 / dl); else dir.set(0, 1, 0);
        const so = this.dSOff[i];
        pos.set(
          P.x + T.x * so + dir.x * stemR * 0.42,
          P.y + T.y * so + dir.y * stemR * 0.42,
          P.z + T.z * so + dir.z * stemR * 0.42,
        );
        q.setFromUnitVectors(up, dir);
        const s = sc * grow;
        scl.set(s, s, s);
        m.compose(pos, q, scl);
        this.druzyMesh.setMatrixAt(i, m);
      }
    }

    for (const g of this.gemMeshes) g.instanceMatrix.needsUpdate = true;
    this.druzyMesh.instanceMatrix.needsUpdate = true;
  }

  /** The head's fixed world Y — the growth point (and the camera/beam anchor). */
  getGrowthPointY(): number {
    return CONFIG.CLUSTER_HEAD_Y;
  }

  /**
   * Hover support: resolve a raycast hit on any 'cluster-gems-*' mesh to its
   * segment metadata — `intersection.instanceId` IS the ring index. Returns null
   * for never-written or recycled rings.
   */
  getSegmentInfo(ringIndex: number): {
    ringIndex: number;
    slot: number;
    missed: boolean;
    leaderIndex: number;
    slotsBehindHead: number;
  } | null {
    if (ringIndex < 0 || ringIndex >= this.maxSegments) return null;
    const birth = this.segmentBirth[ringIndex];
    if (birth < 0) return null;
    return {
      ringIndex,
      slot: this.segmentSlots[ringIndex],
      missed: this.segmentMissed[ringIndex] === 1,
      leaderIndex: this.segmentLeaders[ringIndex],
      slotsBehindHead: this.headProgress - 1 - birth,
    };
  }

  /**
   * Full per-crystal description for the hover tooltip AND the mouse-less
   * auto-labels (both consume exactly this shape). `anchor` is the live world
   * position of the crystal's tip (the label/tooltip anchor); for a missed
   * slot's vacancy it is the spine point where the crystal would have grown.
   * Uses the previous frame's group transform (fine for label anchoring).
   */
  describeCrystal(ringIndex: number): {
    ringIndex: number;
    slot: number;
    missed: boolean;
    leaderIndex: number;
    slotsBehindHead: number;
    age01: number;
    finalized: boolean;
    zone: 'nucleating' | 'young' | 'setting' | 'ember' | 'matrix';
    familyHue: number; // 0 green → 0.5 magenta → 1 purple (Solana axis)
    anchor: THREE.Vector3;
  } | null {
    const info = this.getSegmentInfo(ringIndex);
    if (!info) return null;
    const age01 = THREE.MathUtils.clamp(info.slotsBehindHead / CONFIG.FINALITY_DEPTH, 0, 1);
    const zone =
      age01 < 0.06 ? 'nucleating' :
      age01 < 0.35 ? 'young' :
      age01 < 0.78 ? 'setting' :
      age01 < 1.0 ? 'ember' : 'matrix';

    const anchor = new THREE.Vector3();
    if (info.missed) {
      // The vacancy: anchor on the spine where the crystal would have grown.
      const sBase = Math.max(
        CONFIG.CLUSTER_START_S - 1.1,
        CONFIG.CLUSTER_START_S + (this.scrollPos - 1 - this.segmentBirth[ringIndex]) * CONFIG.CLUSTER_SPACING,
      );
      const t = new THREE.Vector3(), n = new THREE.Vector3(), b = new THREE.Vector3();
      this.frameAt(sBase, anchor, t, n, b);
    } else {
      // The main blade's tip: local (0,1,0) through its instance matrix.
      const im = this.gemMeshes[this.segmentVariant[ringIndex]];
      im.getMatrixAt(ringIndex, CrystalAxis._m);
      anchor.set(0, 1, 0).applyMatrix4(CrystalAxis._m);
    }
    this.mesh.localToWorld(anchor);

    return {
      ...info,
      age01,
      finalized: age01 >= 1,
      zone,
      familyHue: this.segmentHue[ringIndex],
      anchor,
    };
  }

  /**
   * Live world-space anchors for scripted/presentation camera shots. Recomputed
   * on call (the group sways) — pair with the CONFIG camera parameters.
   */
  getFramingAnchors(): {
    head: THREE.Vector3;
    brightCentroid: THREE.Vector3;
    emberBand: THREE.Vector3;
    tailFade: THREE.Vector3;
  } {
    const emberS = this.u.uEmberS.value as number;
    const t = new THREE.Vector3(), n = new THREE.Vector3(), b = new THREE.Vector3();
    const at = (s: number) => {
      const p = new THREE.Vector3();
      this.frameAt(s, p, t, n, b);
      return this.mesh.localToWorld(p);
    };
    return {
      head: this.mesh.localToWorld(new THREE.Vector3(0, 0, 0)),
      brightCentroid: at(emberS * 0.55),
      emberBand: at(emberS),
      tailFade: at(CONFIG.CLUSTER_FADE_S),
    };
  }

  dispose(): void {
    for (const g of this.gemMeshes) g.geometry.dispose();
    this.gemMat.dispose();
    this.druzyMesh.geometry.dispose();
    this.druzyMat.dispose();
    this.stem.geometry.dispose();
    this.stemMat.dispose();
    this.stemCore.geometry.dispose();
    this.stemCoreMat.dispose();
    this.coma.geometry.dispose();
    this.comaMat.dispose();
    this.grabRT?.dispose();
    this.envRT?.dispose();
  }
}

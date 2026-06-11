import * as THREE from 'three';
import { beamVertexShader, beamFragmentShader } from '../shaders/beam';
import { COLORS } from '../utils/colors';

/**
 * The leader thread — a faint filament of light arcing from the current slot
 * leader (a real validator in the cloud) to the comet nucleus. Slow golden motes
 * drift along it toward the nucleus (matter being gathered); each produced slot a
 * soft warm droplet (the deposition packet) glides down the strand and is absorbed
 * — the orchestrator consumes its arrival to trigger the accretion strike. Upcoming
 * leaders are ghost hairlines: present, silent.
 *
 * Public API unchanged from the beam era: mesh, upcoming, setLeader, setUpcoming,
 * firePulse, consumeArrival, update. The visual is a curved camera-facing ribbon
 * (quadratic Bézier, rebuilt per frame) instead of a straight dashed quad.
 */
export class LeaderBeam {
  readonly mesh: THREE.Mesh;       // main leader thread (curved ribbon)
  readonly upcoming: THREE.Mesh;   // up to 4 upcoming leader hairlines

  private static readonly SEGS = 24; // ribbon segments along the curve

  private beamGeo: THREE.BufferGeometry;
  private beamMat: THREE.ShaderMaterial;
  private upcomingGeo: THREE.BufferGeometry;
  private upcomingMat: THREE.ShaderMaterial;

  private beamPositions: Float32Array;
  private upcomingPositions: Float32Array;

  // Current state
  private leaderPos = new THREE.Vector3();
  private growthY = 0;
  private targetOpacity = 0;
  private currentOpacity = 0;
  private threadWidth = 2.2;

  // Deposition packet: travels leader→nucleus over pulseDur, then flags arrival
  // exactly once (the orchestrator consumes it to trigger the accretion strike).
  private pulseT = -1;
  private pulseDur = 0.32;
  private arrived = false;

  private upcomingLeaderPositions: THREE.Vector3[] = [];

  // Temp vectors (avoid per-frame allocation). `nucleusTmp` is reserved for the
  // thread endpoint across the whole update — computeQuad must never write it.
  private tmpA = new THREE.Vector3();
  private tmpB = new THREE.Vector3();
  private tmpC = new THREE.Vector3();
  private tmpPerp = new THREE.Vector3();
  private nucleusTmp = new THREE.Vector3();
  private ctrl = new THREE.Vector3();

  constructor() {
    // --- Main thread: a ribbon of SEGS segments, billboarded per ring each frame ---
    const rings = LeaderBeam.SEGS + 1;
    this.beamPositions = new Float32Array(rings * 2 * 3);
    const beamUvs = new Float32Array(rings * 2 * 2);
    const beamIndices: number[] = [];
    for (let i = 0; i < rings; i++) {
      const u = i / LeaderBeam.SEGS;
      beamUvs[(i * 2) * 2] = u;
      beamUvs[(i * 2) * 2 + 1] = 0;
      beamUvs[(i * 2 + 1) * 2] = u;
      beamUvs[(i * 2 + 1) * 2 + 1] = 1;
      if (i < LeaderBeam.SEGS) {
        const a = i * 2;
        beamIndices.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
      }
    }

    this.beamGeo = new THREE.BufferGeometry();
    this.beamGeo.setAttribute('position', new THREE.BufferAttribute(this.beamPositions, 3));
    this.beamGeo.setAttribute('aUv', new THREE.BufferAttribute(beamUvs, 2));
    this.beamGeo.setIndex(beamIndices);

    this.beamMat = new THREE.ShaderMaterial({
      vertexShader: beamVertexShader,
      fragmentShader: beamFragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uOpacity: { value: 0 },
        uColor: { value: COLORS.THREAD_GOLD.clone() },
        uIceColor: { value: COLORS.CRYSTAL_CORE.clone() },
        uMotes: { value: 1.0 },
        uPulseT: { value: -1 },
        uSeed: { value: 0.31 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });

    this.mesh = new THREE.Mesh(this.beamGeo, this.beamMat);
    this.mesh.name = 'leader-thread';
    this.mesh.frustumCulled = false;

    // --- Upcoming leader hairlines (4 straight quads, ghost-faint) ---
    this.upcomingPositions = new Float32Array(16 * 3);
    const upcomingUvs = new Float32Array(16 * 2);
    for (let q = 0; q < 4; q++) {
      const base = q * 4 * 2;
      upcomingUvs.set([0, 0, 0, 1, 1, 0, 1, 1], base);
    }
    const upcomingIndices: number[] = [];
    for (let q = 0; q < 4; q++) {
      const b = q * 4;
      upcomingIndices.push(b, b + 1, b + 2, b + 2, b + 1, b + 3);
    }

    this.upcomingGeo = new THREE.BufferGeometry();
    this.upcomingGeo.setAttribute('position', new THREE.BufferAttribute(this.upcomingPositions, 3));
    this.upcomingGeo.setAttribute('aUv', new THREE.BufferAttribute(upcomingUvs, 2));
    this.upcomingGeo.setIndex(upcomingIndices);

    this.upcomingMat = new THREE.ShaderMaterial({
      vertexShader: beamVertexShader,
      fragmentShader: beamFragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uOpacity: { value: 0.55 }, // × the in-shader filament floor ⇒ ghost lines
        uColor: { value: COLORS.THREAD_GOLD.clone() },
        uIceColor: { value: COLORS.CRYSTAL_CORE.clone() },
        uMotes: { value: 0.0 },  // silent: no motes, no flow — just presence
        uPulseT: { value: -1 },  // upcoming lines never carry the packet
        uSeed: { value: 0.77 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });

    this.upcoming = new THREE.Mesh(this.upcomingGeo, this.upcomingMat);
    this.upcoming.name = 'leader-thread-upcoming';
    this.upcoming.frustumCulled = false;
  }

  /** Set the current leader position. Called on slot change. */
  setLeader(leaderPos: THREE.Vector3, growthY: number): void {
    this.leaderPos.copy(leaderPos);
    this.growthY = growthY;
    this.targetOpacity = 1.0;
    this.currentOpacity = 0;
  }

  /** Set upcoming leader positions. Called on slot change. */
  setUpcoming(positions: THREE.Vector3[], growthY: number): void {
    this.upcomingLeaderPositions = positions;
    this.growthY = growthY;
  }

  /** Launch the deposition droplet from the leader toward the nucleus. */
  firePulse(durationSec = 0.32): void {
    // Slot bursts (catch-up replays) can launch faster than droplets land; let the
    // in-flight one strike NOW so no produced slot ever loses its accretion moment.
    if (this.pulseT >= 0) this.arrived = true;
    this.pulseDur = Math.max(durationSec, 0.05);
    this.pulseT = 0;
  }

  /** True exactly once when the droplet reaches the nucleus (the strike moment). */
  consumeArrival(): boolean {
    const a = this.arrived;
    this.arrived = false;
    return a;
  }

  /** Update thread geometry every frame. Camera needed for ribbon billboarding. */
  update(dt: number, growthY: number, camera: THREE.Camera): void {
    this.growthY = growthY;
    this.beamMat.uniforms.uTime.value += dt;
    this.upcomingMat.uniforms.uTime.value += dt;

    // Fade opacity
    const fadeSpeed = this.targetOpacity > this.currentOpacity ? 5.0 : 3.3;
    this.currentOpacity += (this.targetOpacity - this.currentOpacity) * Math.min(fadeSpeed * dt, 1);
    this.beamMat.uniforms.uOpacity.value = this.currentOpacity;

    // Advance the droplet; flag arrival once when it reaches the nucleus.
    if (this.pulseT >= 0) {
      this.pulseT += dt / this.pulseDur;
      if (this.pulseT >= 1) {
        this.pulseT = -1;
        this.arrived = true;
      }
    }
    this.beamMat.uniforms.uPulseT.value = this.pulseT;

    const nucleus = this.nucleusTmp.set(0, this.growthY, 0);

    // --- Main thread: quadratic Bézier leader→nucleus, arcing gently up and
    // outward — a hung strand of light, not a gun line. Rebuilt every frame.
    {
      const P0 = this.leaderPos;
      const P2 = nucleus;
      const mid = this.tmpA.addVectors(P0, P2).multiplyScalar(0.5);
      const chord = this.tmpB.subVectors(P2, P0);
      const chordLen = Math.max(chord.length(), 0.001);
      // Outward = radial in XZ from the scene axis at the midpoint (NaN-guarded:
      // if the midpoint sits on the axis, bow purely upward instead).
      const radial = this.tmpC.set(mid.x, 0, mid.z);
      const rLen = radial.length();
      if (rLen > 1e-3) radial.multiplyScalar(1 / rLen);
      else radial.set(0, 0, 0);
      this.ctrl.copy(mid).addScaledVector(radial, chordLen * 0.07);
      this.ctrl.y += chordLen * 0.10;

      const rings = LeaderBeam.SEGS + 1;
      for (let i = 0; i < rings; i++) {
        const u = i / LeaderBeam.SEGS;
        const iu = 1 - u;
        // B(u) and B'(u) of the quadratic Bézier
        const bx = iu * iu * P0.x + 2 * iu * u * this.ctrl.x + u * u * P2.x;
        const by = iu * iu * P0.y + 2 * iu * u * this.ctrl.y + u * u * P2.y;
        const bz = iu * iu * P0.z + 2 * iu * u * this.ctrl.z + u * u * P2.z;
        let tx = 2 * iu * (this.ctrl.x - P0.x) + 2 * u * (P2.x - this.ctrl.x);
        let ty = 2 * iu * (this.ctrl.y - P0.y) + 2 * u * (P2.y - this.ctrl.y);
        let tz = 2 * iu * (this.ctrl.z - P0.z) + 2 * u * (P2.z - this.ctrl.z);

        // Camera-facing perpendicular for this ring (guard the parallel case —
        // looking straight down the thread must not produce NaN verts).
        const cx = camera.position.x - bx;
        const cy = camera.position.y - by;
        const cz = camera.position.z - bz;
        let px = ty * cz - tz * cy;
        let py = tz * cx - tx * cz;
        let pz = tx * cy - ty * cx;
        const pLen = Math.sqrt(px * px + py * py + pz * pz);
        if (pLen > 1e-4) {
          const inv = 1 / pLen;
          px *= inv; py *= inv; pz *= inv;
        } else {
          px = 0; py = 1; pz = 0;
        }
        // Slight mid-strand swell; tapers toward both endpoints.
        const w = this.threadWidth * (0.55 + 0.55 * Math.sin(Math.PI * u)) * 0.5;
        const o = i * 6;
        this.beamPositions[o] = bx - px * w;
        this.beamPositions[o + 1] = by - py * w;
        this.beamPositions[o + 2] = bz - pz * w;
        this.beamPositions[o + 3] = bx + px * w;
        this.beamPositions[o + 4] = by + py * w;
        this.beamPositions[o + 5] = bz + pz * w;
      }
      (this.beamGeo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    }

    // --- Upcoming ghost hairlines (straight, billboarded quads) ---
    const upcomingWidth = 1.0;
    for (let q = 0; q < 4; q++) {
      if (q < this.upcomingLeaderPositions.length) {
        this.computeQuad(
          this.upcomingLeaderPositions[q], nucleus,
          upcomingWidth, camera, this.upcomingPositions, q * 4 * 3,
        );
      } else {
        for (let v = 0; v < 4 * 3; v++) {
          this.upcomingPositions[q * 4 * 3 + v] = 0;
        }
      }
    }
    (this.upcomingGeo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }

  /** Compute 4 billboard vertices for a straight line between two points. */
  private computeQuad(
    start: THREE.Vector3, end: THREE.Vector3,
    width: number, camera: THREE.Camera,
    out: Float32Array, offset: number,
  ): void {
    const dir = this.tmpA.subVectors(end, start);
    if (dir.lengthSq() < 1e-8) dir.set(0, 1, 0);
    dir.normalize();
    const mid = this.tmpB.addVectors(start, end).multiplyScalar(0.5);
    const camDir = this.tmpC.subVectors(camera.position, mid);
    if (camDir.lengthSq() < 1e-8) camDir.set(0, 0, 1);
    camDir.normalize();

    const perp = this.tmpPerp.crossVectors(dir, camDir);
    if (perp.lengthSq() < 1e-8) perp.set(0, 1, 0); // looking down the line — degenerate
    perp.normalize().multiplyScalar(width * 0.5);

    out[offset] = start.x - perp.x;
    out[offset + 1] = start.y - perp.y;
    out[offset + 2] = start.z - perp.z;
    out[offset + 3] = start.x + perp.x;
    out[offset + 4] = start.y + perp.y;
    out[offset + 5] = start.z + perp.z;
    out[offset + 6] = end.x - perp.x;
    out[offset + 7] = end.y - perp.y;
    out[offset + 8] = end.z - perp.z;
    out[offset + 9] = end.x + perp.x;
    out[offset + 10] = end.y + perp.y;
    out[offset + 11] = end.z + perp.z;
  }

  dispose(): void {
    this.beamGeo.dispose();
    this.beamMat.dispose();
    this.upcomingGeo.dispose();
    this.upcomingMat.dispose();
  }
}

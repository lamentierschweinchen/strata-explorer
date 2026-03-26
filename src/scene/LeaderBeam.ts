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
  private upcomingPositions: Float32Array;

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
  private tmpPerp = new THREE.Vector3();

  constructor() {
    // --- Main beam quad (4 verts, 2 triangles) ---
    this.beamPositions = new Float32Array(4 * 3);
    const beamUvs = new Float32Array([0, 0, 0, 1, 1, 0, 1, 1]);

    this.beamGeo = new THREE.BufferGeometry();
    this.beamGeo.setAttribute('position', new THREE.BufferAttribute(this.beamPositions, 3));
    this.beamGeo.setAttribute('aUv', new THREE.BufferAttribute(beamUvs, 2));
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
        uOpacity: { value: 0.2 },
        uColor: { value: new THREE.Color(1.0, 0.78, 0.31) },
        uDashEnabled: { value: 0.0 },
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
    this.currentOpacity = 0;
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
    const fadeSpeed = this.targetOpacity > this.currentOpacity ? 5.0 : 3.3;
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
    this.tmpDir.subVectors(end, start).normalize();

    const mid = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
    const camDir = new THREE.Vector3().subVectors(camera.position, mid).normalize();

    this.tmpPerp.crossVectors(this.tmpDir, camDir).normalize().multiplyScalar(width * 0.5);

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

  dispose(): void {
    this.beamGeo.dispose();
    this.beamMat.dispose();
    this.upcomingGeo.dispose();
    this.upcomingMat.dispose();
  }
}

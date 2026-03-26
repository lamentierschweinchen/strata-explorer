import * as THREE from 'three';
import { waveVertexShader, waveFragmentShader } from '../shaders/wave';
import { CONFIG } from '../utils/config';
import { COLORS } from '../utils/colors';

interface WaveSlot {
  origin: THREE.Vector3;
  birthTime: number;
  active: boolean;
}

/**
 * Seismic wave manager — expanding ring waves from crystal axis
 * when blocks are produced. Uses a flat disc with shader-drawn rings.
 */
export class SeismicWave {
  readonly mesh: THREE.Mesh;
  private material: THREE.ShaderMaterial;

  private waves: WaveSlot[] = [];
  private elapsedTime = 0;

  // Cached arrays for uniforms
  private origins: THREE.Vector3[] = [];
  private times: number[] = [];

  constructor() {
    // Initialize wave slots
    for (let i = 0; i < CONFIG.MAX_WAVES; i++) {
      this.waves.push({
        origin: new THREE.Vector3(),
        birthTime: -999,
        active: false,
      });
      this.origins.push(new THREE.Vector3());
      this.times.push(0);
    }

    // Flat disc large enough to cover the validator cloud
    const discGeo = new THREE.PlaneGeometry(CONFIG.CLOUD_OUTER_RADIUS * 3, CONFIG.CLOUD_OUTER_RADIUS * 3);
    discGeo.rotateX(-Math.PI / 2); // Make horizontal

    this.material = new THREE.ShaderMaterial({
      vertexShader: waveVertexShader,
      fragmentShader: waveFragmentShader,
      uniforms: {
        uWaveOrigins: { value: this.origins },
        uWaveTimes: { value: this.times },
        uWaveCount: { value: 0 },
        uWaveSpeed: { value: CONFIG.WAVE_SPEED },
        uWaveLifetime: { value: CONFIG.WAVE_LIFETIME },
        uWaveRingWidth: { value: CONFIG.WAVE_RING_WIDTH },
        uWaveColor: { value: COLORS.WAVE_COLOR },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });

    this.mesh = new THREE.Mesh(discGeo, this.material);
    this.mesh.frustumCulled = false;
  }

  /** Spawn a new seismic wave at the given origin (crystal axis) */
  spawn(y: number = 0): void {
    // Find the oldest or first inactive slot
    let oldest = 0;
    let oldestTime = Infinity;
    for (let i = 0; i < this.waves.length; i++) {
      if (!this.waves[i].active) { oldest = i; break; }
      const age = this.elapsedTime - this.waves[i].birthTime;
      if (age > oldestTime) continue;
      oldestTime = age;
      // Actually want the oldest active wave to recycle
      if (age >= oldestTime) { oldest = i; oldestTime = age; }
    }
    // Correct: find truly oldest
    let maxAge = -1;
    for (let i = 0; i < this.waves.length; i++) {
      if (!this.waves[i].active) { oldest = i; maxAge = Infinity; break; }
      const age = this.elapsedTime - this.waves[i].birthTime;
      if (age > maxAge) { maxAge = age; oldest = i; }
    }

    this.waves[oldest].origin.set(0, y, 0);
    this.waves[oldest].birthTime = this.elapsedTime;
    this.waves[oldest].active = true;
  }

  update(dt: number): void {
    this.elapsedTime += dt;

    let activeCount = 0;
    for (let i = 0; i < this.waves.length; i++) {
      if (!this.waves[i].active) continue;

      const age = this.elapsedTime - this.waves[i].birthTime;
      if (age > CONFIG.WAVE_LIFETIME) {
        this.waves[i].active = false;
        continue;
      }

      this.origins[activeCount].copy(this.waves[i].origin);
      this.times[activeCount] = age;
      activeCount++;
    }

    this.material.uniforms.uWaveCount.value = activeCount;
    // Position the disc at Y=0 (waves expand horizontally)
  }

  /** Get wave data for the validator cloud shader */
  getActiveWaves(): { origins: THREE.Vector3[]; times: number[]; count: number } {
    const origins: THREE.Vector3[] = [];
    const times: number[] = [];
    let count = 0;

    for (let i = 0; i < this.waves.length; i++) {
      if (!this.waves[i].active) continue;
      const age = this.elapsedTime - this.waves[i].birthTime;
      if (age <= CONFIG.WAVE_LIFETIME) {
        origins.push(this.waves[i].origin.clone());
        times.push(age);
        count++;
      }
    }

    // Pad to 4
    while (origins.length < 4) {
      origins.push(new THREE.Vector3());
      times.push(0);
    }

    return { origins, times, count };
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}

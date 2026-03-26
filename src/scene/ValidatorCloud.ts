import * as THREE from 'three';
import { mineralVertexShader, mineralFragmentShader } from '../shaders/mineral';
import { getCommissionColor } from '../utils/colors';
import { CONFIG } from '../utils/config';
import type { ValidatorInfo } from '../data/DataSource';

/**
 * Renders all validators as glowing mineral deposit points in a cylindrical cloud.
 * Each validator is a point with size (stake), color (commission), brightness (vote recency).
 */
export class ValidatorCloud {
  readonly points: THREE.Points;
  private geometry: THREE.BufferGeometry;
  private material: THREE.ShaderMaterial;

  private positions: Float32Array;
  private colors: Float32Array;
  private sizes: Float32Array;
  private brightnesses: Float32Array;
  private phases: Float32Array;
  private leaderPulses: Float32Array;
  private votePulses: Float32Array;
  private upcomingLeader: Float32Array;

  private pubkeyToIndex: Map<string, number> = new Map();
  private count: number;

  constructor(validators: ValidatorInfo[]) {
    this.count = validators.length;

    this.positions = new Float32Array(this.count * 3);
    this.colors = new Float32Array(this.count * 3);
    this.sizes = new Float32Array(this.count);
    this.brightnesses = new Float32Array(this.count);
    this.phases = new Float32Array(this.count);
    this.leaderPulses = new Float32Array(this.count);
    this.votePulses = new Float32Array(this.count);
    this.upcomingLeader = new Float32Array(this.count);

    this.populateAttributes(validators);

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('aColor', new THREE.BufferAttribute(this.colors, 3));
    this.geometry.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1));
    this.geometry.setAttribute('aBrightness', new THREE.BufferAttribute(this.brightnesses, 1));
    this.geometry.setAttribute('aPhase', new THREE.BufferAttribute(this.phases, 1));
    this.geometry.setAttribute('aLeaderPulse', new THREE.BufferAttribute(this.leaderPulses, 1));
    this.geometry.setAttribute('aVotePulse', new THREE.BufferAttribute(this.votePulses, 1));
    this.geometry.setAttribute('aUpcomingLeader', new THREE.BufferAttribute(this.upcomingLeader, 1));

    this.material = new THREE.ShaderMaterial({
      vertexShader: mineralVertexShader,
      fragmentShader: mineralFragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uSizeMultiplier: { value: 1.0 },
        uBreathOffset: { value: 0 },
        uWaveOrigins: { value: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] },
        uWaveTimes: { value: [0, 0, 0, 0] },
        uWaveCount: { value: 0 },
        uWaveSpeed: { value: CONFIG.WAVE_SPEED },
        uWaveLifetime: { value: CONFIG.WAVE_LIFETIME },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
  }

  private populateAttributes(validators: ValidatorInfo[]): void {
    for (let i = 0; i < validators.length; i++) {
      const v = validators[i];
      const i3 = i * 3;

      // Position from mock data
      this.positions[i3] = v.position.x;
      this.positions[i3 + 1] = v.position.y;
      this.positions[i3 + 2] = v.position.z;

      // Color from commission
      const color = getCommissionColor(v.commission);
      this.colors[i3] = color.r;
      this.colors[i3 + 1] = color.g;
      this.colors[i3 + 2] = color.b;

      // Size from stake (log scale, clamped)
      const logStake = Math.log10(Math.max(v.stake, 1));
      this.sizes[i] = 2.0 + (logStake - 4) * 2.0; // 10K SOL → ~2, 10M SOL → ~10

      // Brightness starts at moderate
      this.brightnesses[i] = 0.6 + Math.random() * 0.3;

      // Random phase for shimmer
      this.phases[i] = Math.random();

      // No pulses initially
      this.leaderPulses[i] = 0;
      this.votePulses[i] = 0;
      this.upcomingLeader[i] = 0;

      this.pubkeyToIndex.set(v.pubkey, i);
    }
  }

  /** Set the current leader — triggers spotlight pulse */
  setLeader(pubkey: string): void {
    // Clear previous leader
    for (let i = 0; i < this.count; i++) {
      if (this.leaderPulses[i] > 0) this.leaderPulses[i] = 0;
    }
    const idx = this.pubkeyToIndex.get(pubkey);
    if (idx !== undefined) {
      this.leaderPulses[idx] = 1.0;
    }
    (this.geometry.getAttribute('aLeaderPulse') as THREE.BufferAttribute).needsUpdate = true;
  }

  /** Set upcoming leaders with decreasing glow */
  setUpcomingLeaders(pubkeys: string[]): void {
    this.upcomingLeader.fill(0);
    for (let i = 0; i < pubkeys.length; i++) {
      const idx = this.pubkeyToIndex.get(pubkeys[i]);
      if (idx !== undefined) {
        this.upcomingLeader[idx] = 0.6 - i * 0.1; // 0.6, 0.5, 0.4, 0.3
      }
    }
    (this.geometry.getAttribute('aUpcomingLeader') as THREE.BufferAttribute).needsUpdate = true;
  }

  /** Pulse validators that voted in this slot */
  setVotePulse(validators: ValidatorInfo[]): void {
    for (const v of validators) {
      const idx = this.pubkeyToIndex.get(v.pubkey);
      if (idx !== undefined) {
        this.votePulses[idx] = 1.0;
        this.brightnesses[idx] = 0.9; // refresh brightness on vote
      }
    }
    (this.geometry.getAttribute('aVotePulse') as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute('aBrightness') as THREE.BufferAttribute).needsUpdate = true;
  }

  /** Get world position of a validator by index */
  getPosition(index: number): THREE.Vector3 {
    const i3 = index * 3;
    return new THREE.Vector3(
      this.positions[i3],
      this.positions[i3 + 1],
      this.positions[i3 + 2],
    );
  }

  /** Get world position of a validator by pubkey */
  getPositionByPubkey(pubkey: string): THREE.Vector3 | null {
    const idx = this.pubkeyToIndex.get(pubkey);
    if (idx === undefined) return null;
    return this.getPosition(idx);
  }

  update(dt: number): void {
    this.material.uniforms.uTime.value += dt;

    // Breathing oscillation
    const time = this.material.uniforms.uTime.value;
    this.material.uniforms.uBreathOffset.value =
      Math.sin(time * (2 * Math.PI / CONFIG.BREATH_PERIOD)) * CONFIG.BREATH_AMPLITUDE;

    // Decay vote pulses
    let voteDirty = false;
    for (let i = 0; i < this.count; i++) {
      if (this.votePulses[i] > 0.001) {
        this.votePulses[i] *= Math.exp(-dt * 8.0); // ~300ms decay
        if (this.votePulses[i] < 0.001) this.votePulses[i] = 0;
        voteDirty = true;
      }
    }
    if (voteDirty) {
      (this.geometry.getAttribute('aVotePulse') as THREE.BufferAttribute).needsUpdate = true;
    }

    // Decay leader pulse slowly (leader stays bright during their 4-slot tenure)
    let leaderDirty = false;
    for (let i = 0; i < this.count; i++) {
      if (this.leaderPulses[i] > 0.001) {
        this.leaderPulses[i] *= Math.exp(-dt * 1.5); // slow decay — leader stays visible
        if (this.leaderPulses[i] < 0.001) this.leaderPulses[i] = 0;
        leaderDirty = true;
      }
    }
    if (leaderDirty) {
      (this.geometry.getAttribute('aLeaderPulse') as THREE.BufferAttribute).needsUpdate = true;
    }
  }

  /** Update wave uniforms from SeismicWave manager */
  setWaveUniforms(origins: THREE.Vector3[], times: number[], count: number): void {
    const uOrigins = this.material.uniforms.uWaveOrigins.value as THREE.Vector3[];
    const uTimes = this.material.uniforms.uWaveTimes.value as number[];
    for (let i = 0; i < 4; i++) {
      if (i < count) {
        uOrigins[i].copy(origins[i]);
        uTimes[i] = times[i];
      } else {
        uTimes[i] = 0;
      }
    }
    this.material.uniforms.uWaveCount.value = count;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}

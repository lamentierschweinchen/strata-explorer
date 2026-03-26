import * as THREE from 'three';
import { particleVertexShader, particleFragmentShader } from '../shaders/particle';
import { CONFIG } from '../utils/config';
import { getTxColor } from '../utils/colors';
import type { TransactionInfo } from '../data/DataSource';

interface TxParticle {
  startPos: THREE.Vector3;
  endPos: THREE.Vector3;
  age: number;
  lifetime: number;
  brightness: number;
  color: THREE.Color;
  size: number;
  active: boolean;
}

/**
 * Object pool for transaction particles. Particles spawn at the outer
 * edge of the validator cloud and drift inward toward the current leader.
 * On arrival, they flash and deactivate.
 */
export class TransactionPool {
  readonly points: THREE.Points;
  private geometry: THREE.BufferGeometry;
  private material: THREE.ShaderMaterial;

  private particles: TxParticle[] = [];
  private positions: Float32Array;
  private colors: Float32Array;
  private sizes: Float32Array;
  private brightnesses: Float32Array;
  private lives: Float32Array;

  private activeCount = 0;
  private tmpVec = new THREE.Vector3();
  private rng: () => number;

  constructor() {
    const max = CONFIG.MAX_PARTICLES;
    this.positions = new Float32Array(max * 3);
    this.colors = new Float32Array(max * 3);
    this.sizes = new Float32Array(max);
    this.brightnesses = new Float32Array(max);
    this.lives = new Float32Array(max);

    // Simple RNG for spawn positions
    let seed = 12345;
    this.rng = () => {
      seed = (seed * 16807 + 0) % 2147483647;
      return seed / 2147483647;
    };

    // Pre-allocate particle slots
    for (let i = 0; i < max; i++) {
      this.particles.push({
        startPos: new THREE.Vector3(),
        endPos: new THREE.Vector3(),
        age: 0,
        lifetime: CONFIG.PARTICLE_LIFETIME,
        brightness: 0,
        color: new THREE.Color(),
        size: 0,
        active: false,
      });
    }

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('aColor', new THREE.BufferAttribute(this.colors, 3));
    this.geometry.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1));
    this.geometry.setAttribute('aBrightness', new THREE.BufferAttribute(this.brightnesses, 1));
    this.geometry.setAttribute('aLife', new THREE.BufferAttribute(this.lives, 1));
    this.geometry.setDrawRange(0, CONFIG.MAX_PARTICLES);

    this.material = new THREE.ShaderMaterial({
      vertexShader: particleVertexShader,
      fragmentShader: particleFragmentShader,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
  }

  /**
   * Spawn a transaction particle from a random point on the outer cylinder
   * toward the current leader's position.
   */
  spawn(tx: TransactionInfo, leaderPos: THREE.Vector3): void {
    const slot = this.findSlot();
    const p = this.particles[slot];

    // Random point on outer cylinder surface
    const theta = this.rng() * Math.PI * 2;
    const y = (this.rng() - 0.5) * CONFIG.CLOUD_HEIGHT * 0.6;
    const r = CONFIG.PARTICLE_SPAWN_RADIUS;
    p.startPos.set(
      Math.cos(theta) * r,
      y,
      Math.sin(theta) * r,
    );
    p.endPos.copy(leaderPos);

    p.age = 0;
    p.lifetime = CONFIG.PARTICLE_LIFETIME;
    p.active = true;

    // Color by type
    p.color.copy(getTxColor(tx.type));

    // Size and brightness from value (log scale)
    const logValue = Math.log10(Math.max(tx.value, 0.001));
    const valueFactor = Math.min(Math.max((logValue + 3) / 6, 0), 1); // -3 to 3 → 0 to 1
    p.size = 2.5 + valueFactor * 4.0;
    p.brightness = 0.6 + valueFactor * 0.4;
  }

  private findSlot(): number {
    // Find inactive
    for (let i = 0; i < CONFIG.MAX_PARTICLES; i++) {
      if (!this.particles[i].active) return i;
    }
    // Recycle oldest (closest to death)
    let oldest = 0;
    let leastLife = Infinity;
    for (let i = 0; i < CONFIG.MAX_PARTICLES; i++) {
      const remaining = this.particles[i].lifetime - this.particles[i].age;
      if (remaining < leastLife) {
        leastLife = remaining;
        oldest = i;
      }
    }
    return oldest;
  }

  update(dt: number): void {
    this.activeCount = 0;

    for (let i = 0; i < CONFIG.MAX_PARTICLES; i++) {
      const p = this.particles[i];
      const i3 = i * 3;

      if (!p.active) {
        this.sizes[i] = 0;
        continue;
      }

      p.age += dt;

      if (p.age >= p.lifetime) {
        // Incorporation flash — one frame of bright burst
        this.positions[i3] = p.endPos.x;
        this.positions[i3 + 1] = p.endPos.y;
        this.positions[i3 + 2] = p.endPos.z;
        this.sizes[i] = p.size * 1.5;
        this.brightnesses[i] = 2.0;
        this.lives[i] = 0.1;
        this.colors[i3] = 1.0;
        this.colors[i3 + 1] = 0.98;
        this.colors[i3 + 2] = 0.95;

        p.active = false;
        continue;
      }

      this.activeCount++;
      const t = p.age / p.lifetime;
      const life = 1.0 - t;

      // Linear interpolation toward leader
      this.tmpVec.lerpVectors(p.startPos, p.endPos, t);
      this.positions[i3] = this.tmpVec.x;
      this.positions[i3 + 1] = this.tmpVec.y;
      this.positions[i3 + 2] = this.tmpVec.z;

      this.colors[i3] = p.color.r;
      this.colors[i3 + 1] = p.color.g;
      this.colors[i3 + 2] = p.color.b;

      this.sizes[i] = p.size;
      this.brightnesses[i] = p.brightness;
      this.lives[i] = life;
    }

    // Update GPU buffers
    (this.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute('aColor') as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute('aSize') as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute('aBrightness') as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute('aLife') as THREE.BufferAttribute).needsUpdate = true;
  }

  getActiveCount(): number {
    return this.activeCount;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}

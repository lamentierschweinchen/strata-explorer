import * as THREE from 'three';
import { dustVertexShader, dustFragmentShader } from '../shaders/dust';
import { CONFIG } from '../utils/config';

/**
 * Minimal dark void background with ambient dust particles.
 */
export class Background {
  readonly points: THREE.Points;
  private geometry: THREE.BufferGeometry;
  private material: THREE.ShaderMaterial;
  private velocities: Float32Array;
  private positions: Float32Array;

  constructor() {
    const count = CONFIG.DUST_COUNT;
    const spread = CONFIG.DUST_SPREAD;

    this.positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const brightnesses = new Float32Array(count);
    this.velocities = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      this.positions[i3] = (Math.random() - 0.5) * spread;
      this.positions[i3 + 1] = (Math.random() - 0.5) * spread;
      this.positions[i3 + 2] = (Math.random() - 0.5) * spread;

      sizes[i] = 0.5 + Math.random() * 1.5;
      brightnesses[i] = 0.1 + Math.random() * 0.2;

      // Very slow random drift
      this.velocities[i3] = (Math.random() - 0.5) * 0.3;
      this.velocities[i3 + 1] = (Math.random() - 0.5) * 0.15;
      this.velocities[i3 + 2] = (Math.random() - 0.5) * 0.3;
    }

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    this.geometry.setAttribute('aBrightness', new THREE.BufferAttribute(brightnesses, 1));

    this.material = new THREE.ShaderMaterial({
      vertexShader: dustVertexShader,
      fragmentShader: dustFragmentShader,
      uniforms: {
        uTime: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
  }

  update(dt: number): void {
    this.material.uniforms.uTime.value += dt;
    const spread = CONFIG.DUST_SPREAD;
    const half = spread / 2;

    for (let i = 0; i < CONFIG.DUST_COUNT; i++) {
      const i3 = i * 3;
      this.positions[i3] += this.velocities[i3] * dt;
      this.positions[i3 + 1] += this.velocities[i3 + 1] * dt;
      this.positions[i3 + 2] += this.velocities[i3 + 2] * dt;

      // Wrap around
      for (let j = 0; j < 3; j++) {
        if (this.positions[i3 + j] > half) this.positions[i3 + j] -= spread;
        if (this.positions[i3 + j] < -half) this.positions[i3 + j] += spread;
      }
    }

    (this.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}

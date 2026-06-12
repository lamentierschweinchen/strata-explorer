import * as THREE from 'three';
import { bgStarVertexShader, bgStarFragmentShader } from '../shaders/bgStar';
import { randomStarColor, powerLawSize } from '../utils/colors';
import { CONFIG } from '../utils/config';

/**
 * Far depth backdrop: tens of thousands of distant stars on a large spherical shell.
 * Static geometry — only the uTime uniform updates for twinkle, so it's one cheap
 * draw call. Fibonacci-spiral distribution gives an even, seamless sky.
 */
export class Starfield {
  readonly points: THREE.Points;
  private material: THREE.ShaderMaterial;

  constructor(countOverride?: number) {
    // Optional cap (the ?stars=N venue valve) — additive; default stays CONFIG.
    const count =
      countOverride !== undefined && countOverride >= 1000 && countOverride <= CONFIG.STAR_COUNT
        ? Math.floor(countOverride)
        : CONFIG.STAR_COUNT;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const brightnesses = new Float32Array(count);
    const phases = new Float32Array(count);

    const goldenAngle = Math.PI * (3 - Math.sqrt(5));
    const inner = CONFIG.STAR_SHELL_INNER;
    const outer = CONFIG.STAR_SHELL_OUTER;

    for (let i = 0; i < count; i++) {
      const i3 = i * 3;

      // Fibonacci sphere → even angular distribution
      const y = 1 - (2 * (i + 0.5)) / count; // -1..1
      const radiusAtY = Math.sqrt(Math.max(0, 1 - y * y));
      const theta = goldenAngle * i;

      // Random depth within the shell so it has thickness
      const r = inner + Math.random() * (outer - inner);

      positions[i3] = radiusAtY * Math.cos(theta) * r;
      positions[i3 + 1] = y * r;
      positions[i3 + 2] = radiusAtY * Math.sin(theta) * r;

      const color = randomStarColor();
      colors[i3] = color.r;
      colors[i3 + 1] = color.g;
      colors[i3 + 2] = color.b;

      // Power-law size: many tiny, a few bright
      sizes[i] = powerLawSize(1.0, 2.0);

      // Brightness loosely tracks size; keep the shell dim so it reads as depth, not noise
      const sizeNorm = sizes[i] / 5.0;
      brightnesses[i] = 0.28 + sizeNorm * 0.45 + Math.random() * 0.2;

      phases[i] = Math.random();
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('aBrightness', new THREE.BufferAttribute(brightnesses, 1));
    geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));

    this.material = new THREE.ShaderMaterial({
      vertexShader: bgStarVertexShader,
      fragmentShader: bgStarFragmentShader,
      uniforms: {
        uTime: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.points = new THREE.Points(geometry, this.material);
    this.points.frustumCulled = false;
  }

  update(dt: number): void {
    this.material.uniforms.uTime.value += dt;
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.material.dispose();
  }
}

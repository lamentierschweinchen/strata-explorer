import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CONFIG } from '../utils/config';

/**
 * Camera controller with auto-orbit and user override.
 * Orbits the crystal formation slowly, stops on interaction,
 * resumes after 15s of inactivity.
 */
export class CameraController {
  readonly camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private autoOrbit = true;
  private orbitAngle = Math.PI / 4; // Start at 45°
  private inactivityTimer: number | null = null;

  constructor(camera: THREE.PerspectiveCamera, domElement: HTMLCanvasElement) {
    this.camera = camera;

    // Initial position: slightly angled side view, crystal growth point centered
    const r = CONFIG.ORBIT_RADIUS;
    camera.position.set(r * 0.8, 50, r * 0.5);
    camera.lookAt(0, 15, 0);

    this.controls = new OrbitControls(camera, domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.minDistance = CONFIG.ZOOM_MIN;
    this.controls.maxDistance = CONFIG.ZOOM_MAX;
    this.controls.target.set(0, 15, 0); // Look at crystal mid-point
    this.controls.enablePan = false;

    // Stop auto-orbit on user interaction
    this.controls.addEventListener('start', () => {
      this.autoOrbit = false;
      this.resetInactivityTimer();
    });
  }

  private resetInactivityTimer(): void {
    if (this.inactivityTimer !== null) {
      clearTimeout(this.inactivityTimer);
    }
    this.inactivityTimer = window.setTimeout(() => {
      this.autoOrbit = true;
      this.orbitAngle = Math.atan2(this.camera.position.z, this.camera.position.x);
    }, CONFIG.AUTO_ORBIT_DELAY * 1000);
  }

  update(dt: number): void {
    if (this.autoOrbit) {
      this.orbitAngle += CONFIG.AUTO_ORBIT_SPEED * dt;
      const r = CONFIG.ORBIT_RADIUS;
      this.camera.position.x = Math.cos(this.orbitAngle) * r;
      this.camera.position.z = Math.sin(this.orbitAngle) * r;
      // Gentle vertical oscillation
      this.camera.position.y = 45 + Math.sin(this.orbitAngle * 0.3) * 15;
    }

    this.controls.update();
  }

  dispose(): void {
    this.controls.dispose();
    if (this.inactivityTimer !== null) {
      clearTimeout(this.inactivityTimer);
    }
  }
}

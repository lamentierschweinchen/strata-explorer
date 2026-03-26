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

  // Zoom animation state
  private zooming = false;
  private zoomElapsed = 0;
  private zoomDuration = 1.2;
  private zoomStartPos = new THREE.Vector3();
  private zoomEndPos = new THREE.Vector3();
  private zoomStartTarget = new THREE.Vector3();
  private zoomEndTarget = new THREE.Vector3();

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

    // Allow user to interrupt zoom animation
    const interruptZoom = () => {
      if (this.zooming) {
        this.zooming = false;
        this.controls.enabled = true;
        this.resetInactivityTimer();
      }
    };
    domElement.addEventListener('mousedown', interruptZoom);
    domElement.addEventListener('touchstart', interruptZoom, { passive: true });
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

  /** Smoothly zoom camera to focus on a validator position */
  zoomToValidator(validatorPos: THREE.Vector3): void {
    this.autoOrbit = false;
    this.zooming = true;
    this.zoomElapsed = 0;

    this.controls.enabled = false;

    this.zoomStartPos.copy(this.camera.position);
    this.zoomStartTarget.copy(this.controls.target);
    this.zoomEndTarget.copy(validatorPos);

    // End camera position: offset ~30 units from validator toward current camera azimuth
    const dir = new THREE.Vector3()
      .subVectors(this.camera.position, validatorPos)
      .normalize()
      .multiplyScalar(30);
    this.zoomEndPos.copy(validatorPos).add(dir);
  }

  update(dt: number): void {
    if (this.zooming) {
      this.zoomElapsed += dt;
      const t = Math.min(this.zoomElapsed / this.zoomDuration, 1.0);
      const ease = 1 - Math.pow(1 - t, 3); // ease-out cubic

      this.camera.position.lerpVectors(this.zoomStartPos, this.zoomEndPos, ease);
      this.controls.target.lerpVectors(this.zoomStartTarget, this.zoomEndTarget, ease);

      if (t >= 1.0) {
        this.zooming = false;
        this.controls.enabled = true;
        this.resetInactivityTimer();
      }

      this.controls.update();
      return;
    }

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

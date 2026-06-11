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

  // Zoom animation state (shared by the validator zoom-in and the ESC return flight)
  private zooming = false;
  private returningToOrbit = false; // true while flying back to the idle orbit (ESC)
  private zoomElapsed = 0;
  private zoomDuration = 1.2;
  private zoomStartPos = new THREE.Vector3();
  private zoomEndPos = new THREE.Vector3();
  private zoomStartTarget = new THREE.Vector3();
  private zoomEndTarget = new THREE.Vector3();

  // Idle framing target — eased toward the cluster's live bright centroid each frame
  // (fed by the orchestrator via setFramingTarget). Replaces the old hardcoded look-at
  // so the dense, ember-lit mass sits centered instead of the empty air above it.
  private framingTarget = new THREE.Vector3(0, CONFIG.CAMERA_TARGET_Y, 0);

  constructor(camera: THREE.PerspectiveCamera, domElement: HTMLCanvasElement) {
    this.camera = camera;

    // Initial position: slightly angled side view, crystal growth point centered
    const r = CONFIG.ORBIT_RADIUS;
    camera.position.set(r * 0.8, CONFIG.ORBIT_HEIGHT_Y, r * 0.5);
    camera.lookAt(0, CONFIG.CAMERA_TARGET_Y, 0);

    this.controls = new OrbitControls(camera, domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.minDistance = CONFIG.ZOOM_MIN;
    this.controls.maxDistance = CONFIG.ZOOM_MAX;
    this.controls.target.set(0, CONFIG.CAMERA_TARGET_Y, 0); // initial; eased onto the live centroid in update()
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
        this.returningToOrbit = false;
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

  /** The camera's current look-at — the subject of every mode (idle centroid, a zoomed
   *  validator, a presentation anchor). The DoF focal plane tracks this. Read-only use. */
  get lookTarget(): THREE.Vector3 {
    return this.controls.target;
  }

  /**
   * ESC hatch: fly smoothly back to the default idle orbit from wherever the user got
   * stuck (typically zoomed onto a validator). Re-enters the orbit at the camera's
   * CURRENT azimuth around the framing target and pre-seeds orbitAngle to match, so the
   * loop resumes from exactly where the flight lands — a seamless glide, never a snap.
   * No-op while the presentation director owns the camera.
   */
  returnToOrbit(): void {
    if (this.scripted) return;
    this.zooming = true;
    this.returningToOrbit = true;
    this.zoomElapsed = 0;
    this.zoomDuration = 1.6; // a touch slower than the zoom-in — a calm release
    this.controls.enabled = false;

    this.zoomStartPos.copy(this.camera.position);
    this.zoomStartTarget.copy(this.controls.target);

    const az = Math.atan2(
      this.camera.position.z - this.framingTarget.z,
      this.camera.position.x - this.framingTarget.x,
    );
    this.orbitAngle = az;
    this.zoomEndTarget.copy(this.framingTarget);
    this.zoomEndPos.set(
      this.framingTarget.x + Math.cos(az) * CONFIG.ORBIT_RADIUS,
      CONFIG.ORBIT_HEIGHT_Y + Math.sin(az * 0.3) * CONFIG.ORBIT_HEIGHT_DRIFT,
      this.framingTarget.z + Math.sin(az) * CONFIG.ORBIT_RADIUS,
    );
  }

  /** Smoothly zoom camera to focus on a validator position */
  zoomToValidator(validatorPos: THREE.Vector3): void {
    this.autoOrbit = false;
    this.zooming = true;
    this.returningToOrbit = false;
    this.zoomElapsed = 0;
    this.zoomDuration = 1.2;

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

  /**
   * Orchestrator feeds the cluster's live bright centroid each frame; the idle orbit
   * eases its look-at onto it so the ember-lit mass stays framed as the reef grows and
   * sways. Ignored while the user is driving (autoOrbit off) so it never fights them.
   */
  setFramingTarget(p: THREE.Vector3): void {
    this.framingTarget.copy(p);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // SCRIPTED CAMERA — presentation mode (ADDITIVE). When engaged, the new branch
  // at the top of update() takes precedence over the mouse / zoom / auto-orbit
  // logic and the PresentationDirector commands the camera through flyTo() moves.
  // None of this runs unless enterScriptedMode() has been called, so interactive
  // behaviour is byte-for-byte unchanged when presentation mode is off.
  // ───────────────────────────────────────────────────────────────────────────
  private scripted = false;
  private flying = false;
  private flyElapsed = 0;
  private flyDuration = 1;
  private flyStartEye = new THREE.Vector3();
  private flyEndEye = new THREE.Vector3();
  private flyStartLook = new THREE.Vector3();
  private flyEndLook = new THREE.Vector3();
  // Live look-at the director feeds each frame; the held shot eases its look-at
  // onto it so the slowly-swaying cluster stays centered (null = not tracking).
  private scriptedLook: THREE.Vector3 | null = null;

  /** True while the director is driving (mouse + auto-orbit suspended). */
  get isScripted(): boolean {
    return this.scripted;
  }

  /**
   * Enter scripted (presentation) mode: suspend the OrbitControls, the idle
   * auto-orbit and the click-zoom so the PresentationDirector has sole command of
   * the camera. The held pose is seeded from wherever the camera currently is, so
   * the first flyTo() eases out of the live position instead of snapping.
   * Idempotent.
   */
  enterScriptedMode(): void {
    this.scripted = true;
    this.flying = false;
    this.zooming = false;
    this.autoOrbit = false;
    this.controls.enabled = false;
    if (this.inactivityTimer !== null) {
      clearTimeout(this.inactivityTimer);
      this.inactivityTimer = null;
    }
    this.flyStartEye.copy(this.camera.position);
    this.flyEndEye.copy(this.camera.position);
    this.flyStartLook.copy(this.controls.target);
    this.flyEndLook.copy(this.controls.target);
  }

  /**
   * Leave scripted mode and restore interactive control: re-enable the
   * OrbitControls and hand back to the idle auto-orbit from the current pose.
   */
  exitScriptedMode(): void {
    this.scripted = false;
    this.flying = false;
    this.zooming = false;
    this.scriptedLook = null;
    this.controls.enabled = true;
    this.autoOrbit = true;
    this.orbitAngle = Math.atan2(this.camera.position.z, this.camera.position.x);
    this.resetInactivityTimer();
  }

  /**
   * Begin a slow, eased move of the eye and look-at to a new composition. Eye and
   * look-at are interpolated INDEPENDENTLY with a smootherstep ease (zero velocity
   * at both ends — a patient settle, never a snap). Captures the current pose as
   * the start, so chained shots flow into one another. Only has visible effect in
   * scripted mode; the director always enters scripted mode first.
   *
   * @param eye       destination camera position (world space)
   * @param lookAt    destination look-at point (world space)
   * @param durationS move duration in seconds (clamped to > 0)
   */
  flyTo(eye: THREE.Vector3, lookAt: THREE.Vector3, durationS: number): void {
    this.flyStartEye.copy(this.camera.position);
    this.flyStartLook.copy(this.controls.target);
    this.flyEndEye.copy(eye);
    this.flyEndLook.copy(lookAt);
    this.flyDuration = Math.max(durationS, 1e-3);
    this.flyElapsed = 0;
    this.flying = true;
  }

  /**
   * Live look-at glue for the settle/hold AFTER a flyTo completes: the director
   * feeds the continuously-recomputed anchor each frame and the look-at gently
   * eases to follow the swaying cluster, so a held shot stays centered. Ignored
   * while a flyTo is in flight (the move owns the look-at then).
   */
  trackLookAt(p: THREE.Vector3): void {
    if (!this.scriptedLook) this.scriptedLook = new THREE.Vector3();
    this.scriptedLook.copy(p);
  }

  update(dt: number): void {
    // Scripted (presentation) mode — ADDITIVE branch, takes precedence over all
    // interactive logic below. Inert unless enterScriptedMode() has run.
    if (this.scripted) {
      if (this.flying) {
        this.flyElapsed += dt;
        const t = this.flyDuration > 0 ? Math.min(this.flyElapsed / this.flyDuration, 1) : 1;
        const e = t * t * t * (t * (t * 6 - 15) + 10); // smootherstep — zero-velocity ends
        this.camera.position.lerpVectors(this.flyStartEye, this.flyEndEye, e);
        this.controls.target.lerpVectors(this.flyStartLook, this.flyEndLook, e);
        if (t >= 1) this.flying = false;
      } else if (this.scriptedLook) {
        // Settle/hold: ease the look-at onto the live (swaying) anchor; eye holds.
        this.controls.target.lerp(this.scriptedLook, Math.min(dt * 1.5, 1));
      }
      this.controls.update(); // re-applies lookAt(target); damping deltas are ~0
      return;
    }

    if (this.zooming) {
      this.zoomElapsed += dt;
      const t = Math.min(this.zoomElapsed / this.zoomDuration, 1.0);
      const ease = 1 - Math.pow(1 - t, 3); // ease-out cubic

      this.camera.position.lerpVectors(this.zoomStartPos, this.zoomEndPos, ease);
      this.controls.target.lerpVectors(this.zoomStartTarget, this.zoomEndTarget, ease);

      if (t >= 1.0) {
        this.zooming = false;
        this.controls.enabled = true;
        if (this.returningToOrbit) {
          // The ESC flight lands ON the orbit ring at the pre-seeded angle: hand
          // straight to the idle loop (no 15s wait), continuing without a seam.
          this.returningToOrbit = false;
          this.autoOrbit = true;
          if (this.inactivityTimer !== null) {
            clearTimeout(this.inactivityTimer);
            this.inactivityTimer = null;
          }
        } else {
          this.resetInactivityTimer();
        }
      }

      this.controls.update();
      return;
    }

    if (this.autoOrbit) {
      this.orbitAngle += CONFIG.AUTO_ORBIT_SPEED * dt;
      const r = CONFIG.ORBIT_RADIUS;
      // Ease the look-at onto the live cluster centroid, and orbit AROUND it (xz), so the
      // dense ember mass stays centered instead of falling to the bottom edge.
      this.controls.target.lerp(this.framingTarget, Math.min(dt * 1.2, 1));
      this.camera.position.x = this.controls.target.x + Math.cos(this.orbitAngle) * r;
      this.camera.position.z = this.controls.target.z + Math.sin(this.orbitAngle) * r;
      this.camera.position.y = CONFIG.ORBIT_HEIGHT_Y + Math.sin(this.orbitAngle * 0.3) * CONFIG.ORBIT_HEIGHT_DRIFT;
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

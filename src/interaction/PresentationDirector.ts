import * as THREE from 'three';
import { CONFIG } from '../utils/config';
import type { CameraController } from './CameraController';
import type { CrystalAxis } from '../scene/CrystalAxis';

/**
 * THE PRESENTATION DIRECTOR — the mouse-less, self-running cinema mode that
 * premieres on the unattended gallery screen.
 *
 * When active it suspends all interaction and flies the camera through an ENDLESS
 * cinematic shot list, looking only at the LIVE world-space anchors the crystal
 * exposes (head / bright core / ember band / tail) and narrating the piece through
 * the RingInfoLayer. The camera is a slow, patient hand: every move is a long
 * smootherstep ease (handled by CameraController.flyTo) and every hold lets the
 * cluster sway gently within a locked frame, the look-at glued to the live anchor.
 *
 * MUSICAL TIMING (real, measured): one slot = 4 × 396 ms is wrong — one slot is
 * 396 ms; FOUR slots (one leader) make a 1.585 s "bar". Every move and hold below
 * is quantized to whole bars, so the camera breathes with the network's heartbeat
 * (≈151 BPM) instead of an arbitrary clock. Finality (~12 s) is ~7.5 bars.
 *
 * The class owns its timeline (it does not poll the camera); it advances one shot
 * at a time, issuing a single flyTo per shot and feeding the live look-at every
 * frame. The eye is COMPOSED here as an orbiting offset around the shot's anchor;
 * a slowly precessing azimuth (`orbitPhase`) walks the whole piece around the reef
 * over several minutes so no two cycles frame it from quite the same side.
 */

/**
 * Structural view of the RingInfoLayer built in a parallel lane (its file may not
 * exist yet). Typed here — NOT imported — so this module builds clean today; a
 * real RingInfoLayer instance satisfies it structurally when the orchestrator
 * wires it in. Matches the FROZEN interface exactly.
 */
export interface RingInfoLayerLike {
  showRing(ringIndex: number): void;
  setCaption(text: string | null): void;
  hide(): void;
}

/** One slot = 396 ms; one leader = 4 slots = one bar. Quantize everything to it. */
const BAR_S = 1.585;

/** Which live anchor a shot frames (keys of CrystalAxis.getFramingAnchors()). */
type AnchorKey = 'head' | 'brightCentroid' | 'emberBand' | 'tailFade';

interface Shot {
  readonly name: string;
  /** Live anchor this shot looks at (and orbits its eye around). */
  readonly look: AnchorKey;
  /** Horizontal distance from the anchor to the eye (world units). */
  readonly radius: number;
  /** Vertical eye offset above the anchor (world units; may be negative). */
  readonly height: number;
  /** Azimuth offset (rad) added to the precessing orbitPhase for this shot. */
  readonly azOffset: number;
  /** How far orbitPhase precesses on ENTERING this shot (rad) — the slow walk. */
  readonly azAdvance: number;
  /** Eased move length, in bars. */
  readonly moveBars: number;
  /** Locked-off hold after the move, in bars. */
  readonly holdBars: number;
  /** Narration lines; one is chosen per cycle so repeats vary. */
  readonly captions: readonly string[];
  /** Spotlight a recent "young" layer on the RingInfoLayer during this shot. */
  readonly showRecentRing?: boolean;
}

/**
 * THE SHOT LIST (≈38 bars ≈ 60 s per cycle, then loops with a precessed azimuth).
 * A continuous look-at path down the body — core → head → ember → tail → wide —
 * so each transition sweeps the gaze along the crystal, never cutting. Eye radii
 * stay within [ZOOM_MIN, ZOOM_MAX] so OrbitControls never clamps a move; azimuth
 * steps between consecutive shots stay small (≤ ~0.7 rad) so nothing whips.
 */
const SHOTS: readonly Shot[] = [
  {
    name: 'push-core', look: 'brightCentroid',
    radius: 96, height: 16, azOffset: 0.0, azAdvance: 0.0,
    moveBars: 5, holdBars: 2,
    captions: ['Every fraction of a second, the network agrees, and the crystal grows.'],
  },
  {
    name: 'rise-head', look: 'head',
    radius: 78, height: 30, azOffset: 0.18, azAdvance: 0.16,
    moveBars: 3, holdBars: 2,
    captions: [
      'The newest layers glow.',
      'This is the growth front — the very newest block.',
    ],
    showRecentRing: true,
  },
  {
    name: 'drift-ember', look: 'emberBand',
    radius: 104, height: -2, azOffset: -0.12, azAdvance: 0.18,
    moveBars: 4, holdBars: 2,
    captions: [
      'At the burning band, each layer becomes final.',
      'Around twelve seconds in, the network locks the past in place.',
    ],
  },
  {
    name: 'settle-tail', look: 'tailFade',
    radius: 124, height: -16, azOffset: 0.10, azAdvance: 0.16,
    moveBars: 4, holdBars: 2,
    captions: ['The oldest harden into rock, and can never change again.'],
  },
  {
    name: 'pull-wide', look: 'brightCentroid',
    radius: 188, height: 64, azOffset: 0.0, azAdvance: 0.30,
    moveBars: 5, holdBars: 3,
    captions: [
      'Each point of light is a real validator.',
      'Thousands of machines, holding one shared truth.',
    ],
  },
  {
    name: 'orbit-wide', look: 'brightCentroid',
    radius: 182, height: 40, azOffset: 0.52, azAdvance: 0.20,
    moveBars: 4, holdBars: 2,
    captions: ['Nothing here is invented. It is all happening, right now.'],
  },
];

export class PresentationDirector {
  private readonly camera: THREE.Camera;
  private readonly cameraController: CameraController;
  private readonly crystalAxis: CrystalAxis;
  private readonly ringInfoLayer: RingInfoLayerLike;

  private _active = false;
  private shotIndex = -1;          // -1 → first advanceShot() issues shot 0
  private cycle = 0;               // full loops completed (drives caption rotation)
  private orbitPhase = 0;          // slowly precessing base azimuth (rad)
  private shotElapsed = 0;         // seconds into the current shot
  private shotDurationS = 0;       // (move + hold) bars × BAR_S

  // Scratch reused across frames to avoid per-frame allocation churn.
  private readonly _eye = new THREE.Vector3();

  constructor(opts: {
    camera: THREE.Camera;
    cameraController: CameraController;
    crystalAxis: CrystalAxis;
    ringInfoLayer: RingInfoLayerLike;
  }) {
    this.camera = opts.camera;
    this.cameraController = opts.cameraController;
    this.crystalAxis = opts.crystalAxis;
    this.ringInfoLayer = opts.ringInfoLayer;

    // Self-sufficient gallery entry: ?present launches presentation mode on load,
    // so the kiosk needs no extra wiring beyond constructing + update()-ing this.
    if (typeof window !== 'undefined' &&
        new URLSearchParams(window.location.search).has('present')) {
      this.start();
    }
  }

  get active(): boolean {
    return this._active;
  }

  /** Enter presentation mode: suspend interaction and begin the endless shot list. */
  start(): void {
    if (this._active) return;
    this._active = true;
    this.cameraController.enterScriptedMode();

    // Seed the precessing azimuth from the camera's CURRENT angle around the core,
    // so the opening shot eases out of the live pose rather than whipping to a side.
    const a = this.crystalAxis.getFramingAnchors();
    this.orbitPhase = Math.atan2(
      this.camera.position.z - a.brightCentroid.z,
      this.camera.position.x - a.brightCentroid.x,
    );

    this.shotIndex = -1;
    this.cycle = 0;
    this.advanceShot();
  }

  /** Leave presentation mode: clear narration and restore interactive control. */
  stop(): void {
    if (!this._active) return;
    this._active = false;
    this.ringInfoLayer.hide();
    this.cameraController.exitScriptedMode();
  }

  /** Advance the active shot. Call once per frame, BEFORE cameraController.update(dt). */
  update(dt: number): void {
    if (!this._active) return;

    // Glue the held look-at to the live (swaying) anchor every frame; the
    // CameraController only consumes this once the move has settled.
    const anchors = this.crystalAxis.getFramingAnchors();
    this.cameraController.trackLookAt(anchors[SHOTS[this.shotIndex].look]);

    this.shotElapsed += dt;
    if (this.shotElapsed >= this.shotDurationS) this.advanceShot();
  }

  /** Step to the next shot: compose its eye from the live anchor and issue the move. */
  private advanceShot(): void {
    const next = (this.shotIndex + 1) % SHOTS.length;
    if (next === 0 && this.shotIndex !== -1) this.cycle++;
    this.shotIndex = next;
    const shot = SHOTS[next];

    this.orbitPhase += shot.azAdvance;
    const look = this.crystalAxis.getFramingAnchors()[shot.look].clone();
    const az = this.orbitPhase + shot.azOffset;
    this._eye.set(
      look.x + Math.cos(az) * shot.radius,
      look.y + shot.height,
      look.z + Math.sin(az) * shot.radius,
    );

    this.cameraController.flyTo(this._eye, look, shot.moveBars * BAR_S);
    this.shotDurationS = (shot.moveBars + shot.holdBars) * BAR_S;
    this.shotElapsed = 0;

    // Narration — one caption per cycle so repeats don't feel canned.
    this.ringInfoLayer.setCaption(shot.captions[this.cycle % shot.captions.length]);
    if (shot.showRecentRing) {
      const ring = this.pickRecentYoungRing();
      if (ring >= 0) this.ringInfoLayer.showRing(ring);
    }
  }

  /**
   * Find a freshly-formed, glowing layer to spotlight: the youngest non-missed
   * ring still in the 'young' zone (a few slots behind the head). Returns -1 early
   * on (before enough crystal exists), in which case the shot simply omits showRing.
   */
  private pickRecentYoungRing(): number {
    let best = -1;
    let bestBehind = Infinity;
    for (let r = 0; r < CONFIG.MAX_SEGMENTS; r++) {
      const d = this.crystalAxis.describeCrystal(r);
      if (!d || d.missed) continue;
      if (d.zone === 'young' && d.slotsBehindHead >= 0 && d.slotsBehindHead < bestBehind) {
        best = r;
        bestBehind = d.slotsBehindHead;
      }
    }
    return best;
  }
}

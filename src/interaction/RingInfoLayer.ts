import * as THREE from 'three';
import type { CrystalAxis } from '../scene/CrystalAxis';

/**
 * THE TREE-RING INFO LAYER — read a crystal like the rings of a tree.
 *
 * A standalone DOM overlay that turns one crystal of the cluster into a small,
 * plain-spoken card: the real moment the network agreed on, who laid it, and how
 * far it has crystallized toward "finalized forever." No jargon, no invented
 * numbers — only the facts CrystalAxis already carries (the audience is the
 * parents of blockchainers, not engineers).
 *
 * SEAM (consume-only; CrystalAxis is never modified):
 *   • crystalAxis.raycastTargets       — the gem InstancedMeshes to raycast.
 *   • crystalAxis.describeCrystal(id)   — facts for ring `id` (= intersection
 *                                         .instanceId), with a LIVE world-space
 *                                         `anchor` at the crystal's tip.
 *
 * WORLD → SCREEN: copy the anchor into a scratch Vector3 and `.project(camera)`
 * (mirrors InfoOverlay) → NDC in [-1,1]; convert to client pixels via the
 * renderer canvas rect (rect.left/top included, so it is correct even when the
 * canvas is not at the viewport origin); `z > 1` means behind the camera → hide.
 * The card is `position: fixed`, so client pixels ARE its coordinates — no
 * dependence on where `container` sits in the layout — and it is clamped to the
 * viewport so it can never be cut off. `update(dt)` re-projects every frame
 * because the suspended cluster slowly sways; the card stays glued to its tip.
 *
 * HOVER lives inside this class and is active ONLY in 'interactive' mode: a
 * mousemove listener on the canvas records the pointer; `update()` raycasts at
 * ~30 fps but only when the pointer actually moved, and on a hit shows that
 * ring, on a miss hides. 'presentation' mode silences hover — labels are then
 * driven externally via showRing()/setCaption().
 */

/** The non-null shape of describeCrystal() — kept in lock-step with CrystalAxis. */
type CrystalFacts = NonNullable<ReturnType<CrystalAxis['describeCrystal']>>;

// Raycast cadence: only ever ~30 fps, and only when the pointer moved.
const RAY_INTERVAL = 1 / 30;
// Keep this many pixels between the card and any viewport edge when clamping.
const VIEWPORT_MARGIN = 10;

// Glass language, lifted from InfoOverlay/HUD so the card belongs to the piece.
const CARD_BG = 'rgba(8,8,20,0.62)';
const CARD_BLUR = 'blur(9px)';
const MONO = "'ABC Diatype Semi-Mono', 'SF Mono', monospace";
// The caption is narration, not data — it speaks in the humanist brand face.
const PROSE = "'ABC Diatype', system-ui, sans-serif";

export class RingInfoLayer {
  private readonly camera: THREE.Camera;
  private readonly crystalAxis: CrystalAxis;
  private readonly container: HTMLElement;
  private readonly renderer: THREE.WebGLRenderer;

  // --- DOM (appended to `container`; never touches the existing overlays) ---
  private readonly card: HTMLDivElement;
  private readonly dot: HTMLDivElement;
  private readonly titleEl: HTMLDivElement;
  private readonly bodyEl: HTMLDivElement;
  private readonly footEl: HTMLDivElement;
  private readonly caption: HTMLDivElement;

  // --- State ---
  private mode: 'interactive' | 'presentation' = 'interactive';
  private currentRing: number | null = null;
  private shown = false;
  private renderedKey = '';      // diff guard — only rewrite the DOM when facts change
  private cardW = 0;
  private cardH = 0;

  // --- Hover plumbing (interactive mode only) ---
  private rayTimer = 0;
  private pointerMoved = false;
  private pointerX = 0;
  private pointerY = 0;
  private readonly raycaster = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private readonly scratch = new THREE.Vector3();
  private readonly onMouseMove: (e: MouseEvent) => void;
  private readonly onMouseLeave: () => void;

  // Solana brand axis for the hue-tinted border: 0 green #14F195, 0.5 magenta
  // (CrystalAxis' CRYSTAL_MAGENTA), 1 purple #9945FF.
  private static readonly GREEN: readonly [number, number, number] = [20, 241, 149];
  private static readonly MAGENTA: readonly [number, number, number] = [235, 51, 204];
  private static readonly PURPLE: readonly [number, number, number] = [153, 69, 255];

  constructor(opts: {
    camera: THREE.Camera;
    crystalAxis: CrystalAxis;
    container: HTMLElement;
    renderer: THREE.WebGLRenderer;
  }) {
    this.camera = opts.camera;
    this.crystalAxis = opts.crystalAxis;
    this.container = opts.container;
    this.renderer = opts.renderer;

    // ---- Card ----
    this.card = document.createElement('div');
    Object.assign(this.card.style, {
      position: 'fixed',
      left: '0',
      top: '0',
      minWidth: '132px',
      maxWidth: '230px',
      padding: '11px 13px 12px',
      background: CARD_BG,
      backdropFilter: CARD_BLUR,
      WebkitBackdropFilter: CARD_BLUR,
      border: '1px solid rgba(255,255,255,0.18)',
      borderRadius: '11px',
      boxShadow: '0 6px 26px rgba(0,0,0,0.5)',
      fontFamily: MONO,
      opacity: '0',
      transition: 'opacity 0.18s ease',
      pointerEvents: 'none',
      userSelect: 'none',
      zIndex: '16',
    });

    // Header row: hue dot + the moment's title.
    const header = document.createElement('div');
    Object.assign(header.style, {
      display: 'flex',
      alignItems: 'center',
      gap: '7px',
    });

    this.dot = document.createElement('div');
    Object.assign(this.dot.style, {
      width: '6px',
      height: '6px',
      borderRadius: '50%',
      flexShrink: '0',
      background: 'rgba(255,255,255,0.6)',
      boxSizing: 'border-box',
    });
    header.appendChild(this.dot);

    this.titleEl = document.createElement('div');
    Object.assign(this.titleEl.style, {
      fontSize: '13px',
      letterSpacing: '0.4px',
      fontWeight: '400',
      color: 'rgba(255,255,255,0.9)',
      whiteSpace: 'nowrap',
    });
    header.appendChild(this.titleEl);
    this.card.appendChild(header);

    // The heart of the card: the plain-language status (or the flaw line).
    this.bodyEl = document.createElement('div');
    Object.assign(this.bodyEl.style, {
      marginTop: '6px',
      fontSize: '11px',
      lineHeight: '1.45',
      color: 'rgba(255,255,255,0.74)',
    });
    this.card.appendChild(this.bodyEl);

    // Provenance footnote — quiet, HUD-label idiom (uppercase, letter-spaced).
    this.footEl = document.createElement('div');
    Object.assign(this.footEl.style, {
      marginTop: '7px',
      fontSize: '9px',
      letterSpacing: '1px',
      textTransform: 'uppercase',
      color: 'rgba(255,255,255,0.4)',
      whiteSpace: 'nowrap',
    });
    this.card.appendChild(this.footEl);
    this.container.appendChild(this.card);

    // ---- Caption (free narration line, bottom-center; presentation mode) ----
    this.caption = document.createElement('div');
    Object.assign(this.caption.style, {
      position: 'fixed',
      left: '50%',
      bottom: '86px',
      transform: 'translateX(-50%)',
      maxWidth: 'min(86vw, 540px)',
      textAlign: 'center',
      fontFamily: PROSE,
      fontSize: '13px',
      lineHeight: '1.5',
      letterSpacing: '0.4px',
      color: 'rgba(255,255,255,0.82)',
      textShadow: '0 2px 14px rgba(0,0,0,0.7)',
      textWrap: 'balance', // balance lines so no lone orphan word drops to its own line
      opacity: '0',
      transition: 'opacity 0.4s ease',
      pointerEvents: 'none',
      zIndex: '16',
    });
    this.container.appendChild(this.caption);

    // ---- Hover listeners (gated by mode inside the handlers) ----
    this.onMouseMove = (e: MouseEvent) => {
      if (this.mode !== 'interactive') return;
      this.pointerX = e.clientX;
      this.pointerY = e.clientY;
      this.pointerMoved = true;
    };
    this.onMouseLeave = () => {
      if (this.mode !== 'interactive') return;
      this.pointerMoved = false;
      this.hide();
    };
    const canvas = this.renderer.domElement;
    canvas.addEventListener('mousemove', this.onMouseMove);
    canvas.addEventListener('mouseleave', this.onMouseLeave);
  }

  // ---- Public API (FROZEN) -------------------------------------------------

  /** Render describeCrystal(ringIndex)'s facts, anchored at its projected tip. */
  showRing(ringIndex: number): void {
    const d = this.crystalAxis.describeCrystal(ringIndex);
    if (!d) {
      this.hide();
      return;
    }
    this.currentRing = ringIndex;
    this.renderContent(d);
    this.positionCard(d.anchor); // place BEFORE fading in — no jump from (0,0)
    if (!this.shown) {
      this.shown = true;
      this.card.style.opacity = '1';
    }
  }

  /** A free narration line, bottom-center (used by presentation mode). */
  setCaption(text: string | null): void {
    if (text && text.length > 0) {
      this.caption.textContent = text;
      this.caption.style.opacity = '1';
    } else {
      this.caption.style.opacity = '0';
    }
  }

  /** Fade the card out and forget the current ring. */
  hide(): void {
    if (!this.shown && this.currentRing === null) return; // already hidden
    this.shown = false;
    this.currentRing = null;
    this.renderedKey = ''; // next show re-renders from scratch
    this.card.style.opacity = '0';
  }

  /** 'interactive' enables mouse hover; 'presentation' silences it. */
  setMode(mode: 'interactive' | 'presentation'): void {
    this.mode = mode;
    if (mode === 'presentation') this.pointerMoved = false;
  }

  /** Per-frame: drive hover (interactive) and re-project the shown card's tip. */
  update(dt: number): void {
    if (this.mode === 'interactive') this.tickHover(dt);

    if (this.currentRing === null || !this.shown) return;
    const d = this.crystalAxis.describeCrystal(this.currentRing);
    if (!d) {
      // The ring was recycled out from under us (ring-buffer reuse) → drop it.
      this.hide();
      return;
    }
    this.renderContent(d); // diffs internally; keeps zone/finalized live as it ages
    this.positionCard(d.anchor);
  }

  /** Detach listeners and remove the DOM. No Three.js resources are owned. */
  dispose(): void {
    const canvas = this.renderer.domElement;
    canvas.removeEventListener('mousemove', this.onMouseMove);
    canvas.removeEventListener('mouseleave', this.onMouseLeave);
    if (this.card.parentNode) this.card.parentNode.removeChild(this.card);
    if (this.caption.parentNode) this.caption.parentNode.removeChild(this.caption);
    this.currentRing = null;
    this.shown = false;
  }

  // ---- Internals -----------------------------------------------------------

  /** Throttled hover raycast: at most ~30 fps, and only when the pointer moved. */
  private tickHover(dt: number): void {
    this.rayTimer += dt;
    if (!this.pointerMoved || this.rayTimer < RAY_INTERVAL) return;
    this.rayTimer = 0;
    this.pointerMoved = false;

    const rect = this.renderer.domElement.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    this.ndc.x = ((this.pointerX - rect.left) / rect.width) * 2 - 1;
    this.ndc.y = -((this.pointerY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.ndc, this.camera);
    const hits = this.raycaster.intersectObjects(this.crystalAxis.raycastTargets, false);
    let id: number | undefined;
    for (const h of hits) {
      if (h.instanceId != null) {
        id = h.instanceId; // nearest gem instance — its instanceId IS the ring index
        break;
      }
    }
    if (id != null) this.showRing(id);
    else this.hide();
  }

  /** Translate the facts into the gallery's warm, plain voice (diffed before DOM). */
  private renderContent(d: CrystalFacts): void {
    const key = `${d.ringIndex}|${d.slot}|${d.missed ? 1 : 0}|${d.leaderIndex}|${d.zone}|${d.finalized ? 1 : 0}`;
    if (key === this.renderedKey) return;
    this.renderedKey = key;

    // A missed slot is a FLAW — lightless cinder, never celebrated: drop the hue,
    // hollow the dot, mute the type. A produced slot wears its family colour.
    if (d.missed) {
      this.card.style.borderColor = 'rgba(255,255,255,0.16)';
      this.card.style.boxShadow = '0 6px 26px rgba(0,0,0,0.5)';
      this.dot.style.background = 'transparent';
      this.dot.style.border = '1px solid rgba(255,255,255,0.35)';
      this.dot.style.boxShadow = 'none';
    } else {
      const c = RingInfoLayer.hueColor(d.familyHue);
      const rgb = `${c.r},${c.g},${c.b}`;
      this.card.style.borderColor = `rgba(${rgb},0.5)`;
      this.card.style.boxShadow = `0 6px 26px rgba(0,0,0,0.5), 0 0 18px rgba(${rgb},0.16)`;
      this.dot.style.background = `rgb(${rgb})`;
      this.dot.style.border = 'none';
      this.dot.style.boxShadow = `0 0 8px rgba(${rgb},0.85)`;
    }

    // Line 1 — the moment's identity (no fabricated number if the slot is unknown).
    this.titleEl.textContent = d.slot >= 0 ? `Moment #${d.slot.toLocaleString()}` : 'A moment in the chain';
    this.titleEl.style.color = d.missed ? 'rgba(255,255,255,0.72)' : 'rgba(255,255,255,0.9)';

    // Line 2 — the plain-language state, or the flaw.
    this.bodyEl.textContent = d.missed
      ? 'A skipped beat — the network missed this moment'
      : RingInfoLayer.zoneLine(d);
    this.bodyEl.style.color = d.missed ? 'rgba(228,228,240,0.6)' : 'rgba(255,255,255,0.74)';

    // Line 3 — who laid it (only for a produced slot with a known leader).
    if (!d.missed && d.leaderIndex >= 0) {
      this.footEl.textContent = `Laid by validator #${d.leaderIndex.toLocaleString()}`;
      this.footEl.style.display = 'block';
    } else {
      this.footEl.style.display = 'none';
    }

    // Cache the measured size for clamping (cheap: only when the facts change).
    this.cardW = this.card.offsetWidth;
    this.cardH = this.card.offsetHeight;
  }

  /** Map the crystal's zone to one human line. */
  private static zoneLine(d: CrystalFacts): string {
    if (d.finalized || d.zone === 'matrix') return 'Finalized forever — can never change again';
    switch (d.zone) {
      case 'nucleating':
      case 'young':
        return 'Forming now';
      case 'setting':
        return 'Crystallizing';
      case 'ember':
        return 'Finalizing';
      default:
        return 'Forming now';
    }
  }

  /** Project the live world-space tip to client pixels, offset, and clamp to view. */
  private positionCard(world: THREE.Vector3): void {
    this.scratch.copy(world).project(this.camera);
    if (this.scratch.z > 1) {
      // Behind the camera — keep it shown (state intact) but invisible.
      this.card.style.opacity = '0';
      return;
    }
    if (this.shown) this.card.style.opacity = '1';

    const rect = this.renderer.domElement.getBoundingClientRect();
    const px = rect.left + (this.scratch.x * 0.5 + 0.5) * rect.width;
    const py = rect.top + (-this.scratch.y * 0.5 + 0.5) * rect.height;

    const cw = this.cardW || 180;
    const ch = this.cardH || 64;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Float up-and-right of the tip; if that clips the top edge, drop below it.
    let left = px + 16;
    let top = py - ch - 12;
    if (top < VIEWPORT_MARGIN) top = py + 16;

    left = Math.max(VIEWPORT_MARGIN, Math.min(left, vw - cw - VIEWPORT_MARGIN));
    top = Math.max(VIEWPORT_MARGIN, Math.min(top, vh - ch - VIEWPORT_MARGIN));

    this.card.style.left = `${left}px`;
    this.card.style.top = `${top}px`;
  }

  /** familyHue (0..1) → RGB along the Solana axis (green → magenta → purple). */
  private static hueColor(hue: number): { r: number; g: number; b: number } {
    const h = Math.max(0, Math.min(1, hue));
    let a: readonly [number, number, number];
    let b: readonly [number, number, number];
    let t: number;
    if (h < 0.5) {
      a = RingInfoLayer.GREEN;
      b = RingInfoLayer.MAGENTA;
      t = h / 0.5;
    } else {
      a = RingInfoLayer.MAGENTA;
      b = RingInfoLayer.PURPLE;
      t = (h - 0.5) / 0.5;
    }
    return {
      r: Math.round(a[0] + (b[0] - a[0]) * t),
      g: Math.round(a[1] + (b[1] - a[1]) * t),
      b: Math.round(a[2] + (b[2] - a[2]) * t),
    };
  }
}

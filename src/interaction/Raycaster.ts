import * as THREE from 'three';

export class Raycaster {
  private camera: THREE.Camera;
  private domElement: HTMLElement;
  private points: THREE.Points;
  private raycaster: THREE.Raycaster;
  private mouse: THREE.Vector2;
  private mouseClient: { x: number; y: number } | null = null;
  private hoveredIndex: number | null = null;

  // Touch tracking
  private touchStart: { x: number; y: number } | null = null;

  // Public callbacks
  onHover: ((index: number) => void) | null = null;
  onHoverEnd: (() => void) | null = null;
  onClick: ((index: number) => void) | null = null;

  // Bound handlers for cleanup
  private boundMouseMove: (e: MouseEvent) => void;
  private boundMouseClick: (e: MouseEvent) => void;
  private boundMouseLeave: () => void;
  private boundTouchStart: (e: TouchEvent) => void;
  private boundTouchEnd: (e: TouchEvent) => void;

  constructor(camera: THREE.Camera, domElement: HTMLElement, points: THREE.Points) {
    this.camera = camera;
    this.domElement = domElement;
    this.points = points;

    this.raycaster = new THREE.Raycaster();
    this.raycaster.params.Points!.threshold = 2.0;

    this.mouse = new THREE.Vector2(-9999, -9999);

    points.geometry.computeBoundingSphere();

    // Bind handlers
    this.boundMouseMove = this.handleMouseMove.bind(this);
    this.boundMouseClick = this.handleMouseClick.bind(this);
    this.boundMouseLeave = this.handleMouseLeave.bind(this);
    this.boundTouchStart = this.handleTouchStart.bind(this);
    this.boundTouchEnd = this.handleTouchEnd.bind(this);

    // Desktop events
    domElement.addEventListener('mousemove', this.boundMouseMove);
    domElement.addEventListener('click', this.boundMouseClick);
    domElement.addEventListener('mouseleave', this.boundMouseLeave);

    // Mobile events
    domElement.addEventListener('touchstart', this.boundTouchStart, { passive: true });
    domElement.addEventListener('touchend', this.boundTouchEnd, { passive: false });
  }

  private handleMouseMove(e: MouseEvent): void {
    const rect = this.domElement.getBoundingClientRect();
    this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.mouseClient = { x: e.clientX, y: e.clientY };
  }

  private handleMouseClick(_e: MouseEvent): void {
    if (this.hoveredIndex !== null && this.onClick) {
      this.onClick(this.hoveredIndex);
    }
  }

  private handleMouseLeave(): void {
    this.mouse.set(-9999, -9999);
    this.mouseClient = null;
    if (this.hoveredIndex !== null) {
      this.hoveredIndex = null;
      if (this.onHoverEnd) this.onHoverEnd();
      this.domElement.style.cursor = '';
    }
  }

  private handleTouchStart(e: TouchEvent): void {
    if (e.touches.length === 1) {
      const t = e.touches[0];
      this.touchStart = { x: t.clientX, y: t.clientY };
    }
  }

  private handleTouchEnd(e: TouchEvent): void {
    if (!this.touchStart || e.changedTouches.length === 0) {
      this.touchStart = null;
      return;
    }

    const t = e.changedTouches[0];
    const dx = t.clientX - this.touchStart.x;
    const dy = t.clientY - this.touchStart.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < 20) {
      // Tap detected — immediate raycast at touch position
      const rect = this.domElement.getBoundingClientRect();
      const tapMouse = new THREE.Vector2(
        ((t.clientX - rect.left) / rect.width) * 2 - 1,
        -((t.clientY - rect.top) / rect.height) * 2 + 1
      );

      this.raycaster.setFromCamera(tapMouse, this.camera);
      const intersects = this.raycaster.intersectObject(this.points);

      if (intersects.length > 0 && intersects[0].index !== undefined) {
        if (this.onClick) this.onClick(intersects[0].index);
      }
    }

    this.touchStart = null;
  }

  update(camera: THREE.Camera): void {
    this.camera = camera;

    this.raycaster.setFromCamera(this.mouse, this.camera);
    const intersects = this.raycaster.intersectObject(this.points);

    if (intersects.length > 0 && intersects[0].index !== undefined) {
      const index = intersects[0].index;

      if (this.hoveredIndex !== index) {
        if (this.hoveredIndex !== null && this.onHoverEnd) {
          this.onHoverEnd();
        }
        this.hoveredIndex = index;
        if (this.onHover) this.onHover(index);
        this.domElement.style.cursor = 'pointer';
      }
    } else {
      if (this.hoveredIndex !== null) {
        this.hoveredIndex = null;
        if (this.onHoverEnd) this.onHoverEnd();
        this.domElement.style.cursor = '';
      }
    }
  }

  getMouseClient(): { x: number; y: number } | null {
    return this.mouseClient;
  }

  dispose(): void {
    this.domElement.removeEventListener('mousemove', this.boundMouseMove);
    this.domElement.removeEventListener('click', this.boundMouseClick);
    this.domElement.removeEventListener('mouseleave', this.boundMouseLeave);
    this.domElement.removeEventListener('touchstart', this.boundTouchStart);
    this.domElement.removeEventListener('touchend', this.boundTouchEnd);
    this.domElement.style.cursor = '';
  }
}

import * as THREE from 'three';
import type { SolanaDataSource } from '../data/DataSource';
import { CONFIG } from '../utils/config';
import { COLORS } from '../utils/colors';

export class Strata {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private container: HTMLElement;
  private dataSource: SolanaDataSource;

  static async create(container: HTMLElement, dataSource: SolanaDataSource): Promise<Strata> {
    await dataSource.initialize();
    return new Strata(container, dataSource);
  }

  private constructor(container: HTMLElement, dataSource: SolanaDataSource) {
    this.container = container;
    this.dataSource = dataSource;

    // Renderer
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    container.appendChild(this.renderer.domElement);

    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = COLORS.BG_CLEAR.clone();

    // Camera
    this.camera = new THREE.PerspectiveCamera(
      CONFIG.CAMERA_FOV,
      container.clientWidth / container.clientHeight,
      CONFIG.CAMERA_NEAR,
      CONFIG.CAMERA_FAR,
    );
    this.camera.position.set(CONFIG.ORBIT_RADIUS * 0.7, 30, CONFIG.ORBIT_RADIUS * 0.7);
    this.camera.lookAt(0, 10, 0);

    // Start data source
    this.dataSource.start({
      onSlot: (_slot, _leader, _missed) => {
        // Will wire up visual systems here
      },
      onValidatorsUpdated: (_validators) => {
        // Will wire up visual systems here
      },
      onTransactions: (_txs) => {
        // Will wire up visual systems here
      },
      onRootAdvance: (_rootSlot) => {
        // Will wire up visual systems here
      },
    });
  }

  update(_dt: number): void {
    // Will update visual subsystems here
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  resize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  dispose(): void {
    this.dataSource.stop();
    this.renderer.dispose();
    this.container.removeChild(this.renderer.domElement);
  }
}

import * as THREE from 'three';
import type { SolanaDataSource } from '../data/DataSource';
import { CONFIG } from '../utils/config';
import { COLORS } from '../utils/colors';
import { ValidatorCloud } from './ValidatorCloud';
import { CrystalAxis } from './CrystalAxis';
import { SeismicWave } from './SeismicWave';
import { Background } from './Background';
import { PostProcessing } from './PostProcessing';
import { TransactionPool } from '../particles/TransactionPool';
import { CameraController } from '../interaction/CameraController';
import { HUD } from '../interaction/HUD';
import { AudioController } from '../interaction/AudioController';

export class Strata {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private container: HTMLElement;
  private dataSource: SolanaDataSource;

  // Visual subsystems
  private validatorCloud: ValidatorCloud;
  private crystalAxis: CrystalAxis;
  private seismicWave: SeismicWave;
  private transactionPool: TransactionPool;
  private background: Background;
  private postProcessing: PostProcessing;

  // Interaction
  private cameraController: CameraController;
  private hud: HUD;
  private audioController: AudioController;

  // TPS tracking
  private txCountThisSecond = 0;
  private tpsTimer = 0;
  private currentTps = 0;

  static async create(container: HTMLElement, dataSource: SolanaDataSource): Promise<Strata> {
    await dataSource.initialize();
    return new Strata(container, dataSource);
  }

  private constructor(container: HTMLElement, dataSource: SolanaDataSource) {
    this.container = container;
    this.dataSource = dataSource;

    const width = container.clientWidth;
    const height = container.clientHeight;

    // Renderer
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setSize(width, height);
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
      width / height,
      CONFIG.CAMERA_NEAR,
      CONFIG.CAMERA_FAR,
    );

    // Camera Controller
    this.cameraController = new CameraController(this.camera, this.renderer.domElement);

    // Background
    this.background = new Background();
    this.scene.add(this.background.points);

    // Crystal Axis
    this.crystalAxis = new CrystalAxis();
    this.scene.add(this.crystalAxis.mesh);

    // Validator Cloud
    const validators = dataSource.getValidators();
    this.validatorCloud = new ValidatorCloud(validators);
    this.scene.add(this.validatorCloud.points);

    // Seismic Waves
    this.seismicWave = new SeismicWave();
    this.scene.add(this.seismicWave.mesh);

    // Transaction Particles
    this.transactionPool = new TransactionPool();
    this.scene.add(this.transactionPool.points);

    // Post-processing
    this.postProcessing = new PostProcessing(this.renderer, this.scene, this.camera, width, height);

    // HUD
    this.hud = new HUD();
    this.hud.updateValidatorCount(validators.length);

    // Audio
    this.audioController = new AudioController();

    // Start data source and wire callbacks
    this.dataSource.start({
      onSlot: (slot, leader, missed) => {
        // Crystal grows
        this.crystalAxis.addSegment(missed);

        // Seismic wave (only on non-missed slots)
        if (!missed) {
          this.seismicWave.spawn(this.crystalAxis.getGrowthPointY());
        }

        // Leader spotlight
        this.validatorCloud.setLeader(leader);
        const upcoming = this.dataSource.getUpcomingLeaders(4);
        this.validatorCloud.setUpcomingLeaders(upcoming);

        // Vote pulse
        const allValidators = this.dataSource.getValidators();
        const currentSlot = this.dataSource.getCurrentSlot();
        const votedValidators = allValidators.filter(v => v.lastVote >= currentSlot - 1);
        this.validatorCloud.setVotePulse(votedValidators);

        // HUD
        this.hud.updateSlot(slot);
        const epochInfo = this.dataSource.getEpochInfo();
        this.hud.updateEpoch(epochInfo.epoch);
      },

      onValidatorsUpdated: (_validators) => {
        // Phase 3: refresh validator data
      },

      onTransactions: (txs) => {
        const leaderIdx = this.dataSource.getCurrentLeaderIndex();
        const leaderPos = this.validatorCloud.getPosition(leaderIdx);

        for (const tx of txs) {
          this.transactionPool.spawn(tx, leaderPos);
        }

        this.txCountThisSecond += txs.length;
      },

      onRootAdvance: (_rootSlot) => {
        // Finality is handled by CrystalAxis age computation
      },
    });
  }

  update(dt: number): void {
    // TPS tracking
    this.tpsTimer += dt;
    if (this.tpsTimer >= 1.0) {
      this.currentTps = this.txCountThisSecond / this.tpsTimer;
      this.hud.updateTps(this.currentTps);
      this.txCountThisSecond = 0;
      this.tpsTimer = 0;
    }

    // Update all visual subsystems
    this.cameraController.update(dt);
    this.crystalAxis.update(dt);
    this.validatorCloud.update(dt);
    this.seismicWave.update(dt);
    this.transactionPool.update(dt);
    this.background.update(dt);
    this.postProcessing.update(dt);
    this.hud.update(dt);

    // Pass seismic wave data to validator cloud
    const waveData = this.seismicWave.getActiveWaves();
    this.validatorCloud.setWaveUniforms(waveData.origins, waveData.times, waveData.count);
  }

  render(): void {
    this.postProcessing.render();
  }

  resize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.postProcessing.resize(w, h);
  }

  dispose(): void {
    this.dataSource.stop();
    this.validatorCloud.dispose();
    this.crystalAxis.dispose();
    this.seismicWave.dispose();
    this.transactionPool.dispose();
    this.background.dispose();
    this.postProcessing.dispose();
    this.cameraController.dispose();
    this.hud.dispose();
    this.audioController.dispose();
    this.renderer.dispose();
    this.container.removeChild(this.renderer.domElement);
  }
}

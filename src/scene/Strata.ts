import * as THREE from 'three';
import type { SolanaDataSource } from '../data/DataSource';
import { CONFIG } from '../utils/config';
import { COLORS } from '../utils/colors';
import { ValidatorCloud } from './ValidatorCloud';
import { CrystalAxis } from './CrystalAxis';
import { SeismicWave } from './SeismicWave';
import { LeaderBeam } from './LeaderBeam';
import { Background } from './Background';
import { PostProcessing } from './PostProcessing';
import { TransactionPool } from '../particles/TransactionPool';
import { CameraController } from '../interaction/CameraController';
import { HUD } from '../interaction/HUD';
import { AudioController } from '../interaction/AudioController';
import { Raycaster } from '../interaction/Raycaster';
import { Tooltip } from '../interaction/Tooltip';
import { InfoOverlay } from '../interaction/InfoOverlay';
import { Legend } from '../interaction/Legend';

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
  private leaderBeam: LeaderBeam;
  private transactionPool: TransactionPool;
  private background: Background;
  private postProcessing: PostProcessing;

  // Interaction
  private cameraController: CameraController;
  private hud: HUD;
  private audioController: AudioController;
  private raycaster: Raycaster;
  private tooltip: Tooltip;
  private infoOverlay: InfoOverlay;
  private legend: Legend;

  // TPS tracking
  private txCountThisSecond = 0;
  private tpsTimer = 0;
  private currentTps = 0;
  private lastFilter = 'all';

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

    // Leader Beam
    this.leaderBeam = new LeaderBeam();
    this.scene.add(this.leaderBeam.mesh);
    this.scene.add(this.leaderBeam.upcoming);

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

    // Raycaster + Tooltip
    this.tooltip = new Tooltip();
    this.raycaster = new Raycaster(this.camera, this.renderer.domElement, this.validatorCloud.points);

    this.raycaster.onHover = (index: number) => {
      const v = this.dataSource.getValidator(index);
      const mouseClient = this.raycaster.getMouseClient();
      if (v && mouseClient) {
        this.tooltip.setContext(this.dataSource.getCurrentSlot(), this.dataSource.getCurrentLeader());
        this.tooltip.show(v, mouseClient.x, mouseClient.y);
      }
    };
    this.raycaster.onHoverEnd = () => {
      this.tooltip.hide();
    };
    this.raycaster.onClick = (index: number) => {
      const pos = this.validatorCloud.getPosition(index);
      this.cameraController.zoomToValidator(pos);
    };

    // Info Overlay + Legend
    this.infoOverlay = new InfoOverlay();
    this.legend = new Legend();

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

        // Leader beam
        const leaderIdx = this.dataSource.getCurrentLeaderIndex();
        const leaderPos = this.validatorCloud.getPosition(leaderIdx);
        this.leaderBeam.setLeader(leaderPos, this.crystalAxis.getGrowthPointY());

        // Upcoming leader beams
        const upcomingIndices = this.dataSource.getUpcomingLeaderIndices(4);
        const upcomingPositions = upcomingIndices.map(i => this.validatorCloud.getPosition(i));
        this.leaderBeam.setUpcoming(upcomingPositions, this.crystalAxis.getGrowthPointY());

        // Info overlay — leader label
        const leaderInfo = this.dataSource.getValidator(leaderIdx);
        const leaderName = leaderInfo?.name ?? `Validator #${leaderIdx}`;
        this.infoOverlay.setLeader(leaderName, leaderPos);

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
        const crystalTarget = new THREE.Vector3(0, this.crystalAxis.getGrowthPointY(), 0);

        for (const tx of txs) {
          this.transactionPool.spawn(tx, leaderPos, crystalTarget);
        }

        this.txCountThisSecond += txs.length;
        this.infoOverlay.pushTransactions(txs);
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
    this.raycaster.update(this.camera);
    this.crystalAxis.update(dt);
    this.validatorCloud.update(dt);
    this.seismicWave.update(dt);
    this.leaderBeam.update(dt, this.crystalAxis.getGrowthPointY(), this.camera);
    this.transactionPool.update(dt);
    this.background.update(dt);
    this.postProcessing.update(dt);
    this.hud.update(dt);
    this.infoOverlay.update(dt, this.camera, this.renderer.domElement);

    // Filter sync — apply particle dimming when filter changes
    const filter = this.infoOverlay.getActiveFilter();
    if (filter !== this.lastFilter) {
      this.transactionPool.applyFilter(filter);
      this.lastFilter = filter;
    }

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
    this.leaderBeam.dispose();
    this.transactionPool.dispose();
    this.background.dispose();
    this.postProcessing.dispose();
    this.cameraController.dispose();
    this.raycaster.dispose();
    this.tooltip.dispose();
    this.infoOverlay.dispose();
    this.legend.dispose();
    this.hud.dispose();
    this.audioController.dispose();
    this.renderer.dispose();
    this.container.removeChild(this.renderer.domElement);
  }
}

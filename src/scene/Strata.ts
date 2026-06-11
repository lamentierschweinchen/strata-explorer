import * as THREE from 'three';
import type { SolanaDataSource } from '../data/DataSource';
import { CONFIG } from '../utils/config';
import { COLORS } from '../utils/colors';
import { ValidatorCloud } from './ValidatorCloud';
import { CrystalAxis } from './CrystalAxis';
import { SeismicWave } from './SeismicWave';
import { LeaderBeam } from './LeaderBeam';
import { Background } from './Background';
import { Starfield } from './Starfield'; // DESIGN LANE: new far star-shell backdrop
import { PostProcessing } from './PostProcessing';
import { TransactionPool } from '../particles/TransactionPool';
import { CameraController } from '../interaction/CameraController';
import { HUD } from '../interaction/HUD';
import { AudioController } from '../interaction/AudioController';
import { Raycaster } from '../interaction/Raycaster';
import { Tooltip } from '../interaction/Tooltip';
import { InfoOverlay } from '../interaction/InfoOverlay';
import { Legend } from '../interaction/Legend';
import { SimulationEngine } from '../data/SimulationEngine';

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
  private starfield: Starfield; // DESIGN LANE
  private postProcessing: PostProcessing;
  private engine: SimulationEngine; // DATA LANE: pacing (drain queue) + synthetic density fill

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

  // Epoch watch — a rollover (~every 2 days) triggers the ceremony
  private lastEpoch = -1;

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

    // DESIGN LANE: far twinkling star-shell — added first so it sits behind everything.
    this.starfield = new Starfield();
    this.scene.add(this.starfield.points);

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

    // Pacing layer (Data lane's SimulationEngine): real txns are buffered and released evenly,
    // and visual-only synthetic particles are spawned proportional to real TPS — the latter go
    // to the particle pool ONLY, never the feed. See src/data/INTEGRATION.md.
    this.engine = new SimulationEngine({ getTps: () => this.dataSource.getTps?.() ?? 0 });
    this.engine.onSyntheticParticles = (txs) => {
      const leaderPos = this.validatorCloud.getPosition(this.dataSource.getCurrentLeaderIndex());
      const target = new THREE.Vector3(0, this.crystalAxis.getGrowthPointY(), 0);
      for (const tx of txs) this.transactionPool.spawn(tx, leaderPos, target);
    };

    // Start the data source THROUGH the engine: intercept() routes onTransactions → engine.enqueue
    // (paced) and defaults engine.onRealTransactions to the real handler below (feed + particle).
    this.dataSource.start(this.engine.intercept({
      onSlot: (slot, leader, missed) => {
        // Crystal grows (the seismic wave + tip bloom now fire on packet ARRIVAL, below)
        this.crystalAxis.addSegment(missed);

        // Leader spotlight
        this.validatorCloud.setLeader(leader);
        const upcoming = this.dataSource.getUpcomingLeaders(4);
        this.validatorCloud.setUpcomingLeaders(upcoming);

        // Leader beam + deposition strike: each produced slot, the leader fires a packet
        // of light along its beam toward the apex (missed slots send nothing — honesty).
        const leaderIdx = this.dataSource.getCurrentLeaderIndex();
        const leaderPos = this.validatorCloud.getPosition(leaderIdx);
        this.leaderBeam.setLeader(leaderPos, this.crystalAxis.getGrowthPointY());
        if (!missed) this.leaderBeam.firePulse();

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

        // Epoch rollover — a real, rare event: the leader schedule turns over.
        if (this.lastEpoch >= 0 && epochInfo.epoch > this.lastEpoch) this.epochCeremony();
        this.lastEpoch = epochInfo.epoch;
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
    }));
  }

  /**
   * Epoch-rollover ceremony (~every 2 days, real event): three grand golden waves roll
   * across the field (lighting the validator cloud as they pass), the bloom swells and
   * exhales, and the HUD epoch number ignites. Built entirely outside the crystal/beam
   * modules so it composes with any centerpiece design.
   */
  private epochCeremony(): void {
    this.seismicWave.spawnGrand(this.crystalAxis.getGrowthPointY());
    this.postProcessing.pulseBloom(CONFIG.EPOCH_BLOOM_BOOST);
    this.hud.epochCeremony();
  }

  /** Preview/rehearsal hook (?ceremony URL param): same choreography, on demand. */
  triggerEpochCeremony(): void {
    this.epochCeremony();
  }

  update(dt: number): void {
    // Pump the pacing layer first so paced real txns + synthetic particles emit this frame.
    this.engine.update(dt);

    // TPS tracking
    this.tpsTimer += dt;
    if (this.tpsTimer >= 1.0) {
      const spawnTps = this.txCountThisSecond / this.tpsTimer;
      // Prefer the data source's real network TPS; fall back to the particle spawn rate.
      this.hud.updateTps(this.dataSource.getTps?.() ?? spawnTps);
      this.txCountThisSecond = 0;
      this.tpsTimer = 0;
    }

    // Update all visual subsystems
    // Keep the idle camera framed on the cluster's live ember-lit centroid.
    this.cameraController.setFramingTarget(this.crystalAxis.getFramingAnchors().brightCentroid);
    this.cameraController.update(dt);
    this.raycaster.update(this.camera);
    this.crystalAxis.update(dt);
    // DESIGN LANE: feed the growth-tip light into the validator cloud so the tip's pulse
    // visibly illuminates nearby validators (custom additive shader → driven by uniform).
    // Must run after crystalAxis.update() has refreshed the tip glow this frame.
    this.validatorCloud.setTipGlow(this.crystalAxis.getGrowthPointY(), this.crystalAxis.tipGlowIntensity);
    this.validatorCloud.update(dt);
    this.seismicWave.update(dt);
    this.leaderBeam.update(dt, this.crystalAxis.getGrowthPointY(), this.camera);
    // Deposition strike: when the packet lands on the apex the crystal blooms and the
    // seismic wave ripples outward — the world reacts to the impact, not the schedule.
    if (this.leaderBeam.consumeArrival()) {
      this.crystalAxis.strike();
      this.seismicWave.spawn(this.crystalAxis.getGrowthPointY());
    }
    this.transactionPool.update(dt);
    this.background.update(dt);
    this.starfield.update(dt); // DESIGN LANE: twinkle the far star-shell
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
    this.starfield.dispose(); // DESIGN LANE
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

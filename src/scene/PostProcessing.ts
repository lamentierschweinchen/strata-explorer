import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { CONFIG } from '../utils/config';
import {
  colorGradeVertexShader, colorGradeFragmentShader,
  vignetteVertexShader, vignetteFragmentShader,
  filmGrainVertexShader, filmGrainFragmentShader,
  chromaticAberrationVertexShader, chromaticAberrationFragmentShader,
} from '../shaders/postprocessing';

/**
 * Post-processing pipeline: DoF (bokeh) → bloom → color grading → vignette →
 * film grain → chromatic aberration. The DoF sits before bloom (defocused
 * highlights soften INTO bokeh instead of blooming); the established
 * bloom → grade → vignette → grain → CA order is preserved.
 */
export class PostProcessing {
  readonly composer: EffectComposer;
  private filmGrainPass: ShaderPass;
  private caPass: ShaderPass;
  private bloomPass: UnrealBloomPass;
  private bokehPass: BokehPass;
  private camera: THREE.Camera;
  private focusTarget = new THREE.Vector3(0, CONFIG.CLUSTER_HEAD_Y, 0);
  private bloomBoost = 0; // ceremony swell above the base strength, decays in update()

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    width: number,
    height: number,
  ) {
    this.camera = camera;
    this.composer = new EffectComposer(renderer);

    // Render pass
    const renderPass = new RenderPass(scene, camera);
    this.composer.addPass(renderPass);

    // Depth of field — the photographic look of the reference geode shot: the
    // cluster in focus, the world soft. Focus tracks the growth head each frame.
    this.bokehPass = new BokehPass(scene, camera, {
      focus: CONFIG.ORBIT_RADIUS,
      aperture: CONFIG.DOF_APERTURE,
      maxblur: CONFIG.DOF_MAXBLUR,
    });
    this.composer.addPass(this.bokehPass);

    // Bloom
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(width, height),
      CONFIG.BLOOM_STRENGTH,
      CONFIG.BLOOM_RADIUS,
      CONFIG.BLOOM_THRESHOLD,
    );
    this.composer.addPass(this.bloomPass);

    // Color grading
    const colorGradePass = new ShaderPass({
      uniforms: {
        tDiffuse: { value: null },
        uIntensity: { value: 0.72 }, // split-tone strength (cool shadows / warm highlights)
        uExposure: { value: 1.05 },
        uContrast: { value: 1.06 },
        uSaturation: { value: 1.12 },
      },
      vertexShader: colorGradeVertexShader,
      fragmentShader: colorGradeFragmentShader,
    });
    this.composer.addPass(colorGradePass);

    // Vignette
    const vignettePass = new ShaderPass({
      uniforms: {
        tDiffuse: { value: null },
        uIntensity: { value: 0.45 },
        uSoftness: { value: 0.28 },
      },
      vertexShader: vignetteVertexShader,
      fragmentShader: vignetteFragmentShader,
    });
    this.composer.addPass(vignettePass);

    // Film grain (midtone-masked — shadows & highlights stay clean)
    this.filmGrainPass = new ShaderPass({
      uniforms: {
        tDiffuse: { value: null },
        uTime: { value: 0 },
        uIntensity: { value: 0.35 },
      },
      vertexShader: filmGrainVertexShader,
      fragmentShader: filmGrainFragmentShader,
    });
    this.composer.addPass(this.filmGrainPass);

    // Chromatic aberration (edge-only, radial — offset scales with dist² so the
    // image centre stays pristine and only the corners fringe)
    this.caPass = new ShaderPass({
      uniforms: {
        tDiffuse: { value: null },
        uIntensity: { value: 1.4 },
        uResolution: { value: new THREE.Vector2(width, height) },
      },
      vertexShader: chromaticAberrationVertexShader,
      fragmentShader: chromaticAberrationFragmentShader,
    });
    this.composer.addPass(this.caPass);
  }

  /** Ceremony swell: briefly lift bloom strength; it breathes back down over ~4s. */
  pulseBloom(amount: number): void {
    this.bloomBoost = Math.max(this.bloomBoost, amount);
  }

  update(dt: number): void {
    this.filmGrainPass.uniforms.uTime.value += dt;

    if (this.bloomBoost > 0.001) {
      this.bloomBoost *= Math.exp(-dt * 0.9);
      if (this.bloomBoost < 0.001) this.bloomBoost = 0;
    }
    this.bloomPass.strength = CONFIG.BLOOM_STRENGTH + this.bloomBoost;

    // Keep the focal plane on the cluster head as the camera orbits/zooms.
    const focusDist = this.camera.getWorldPosition(PostProcessing._camPos)
      .distanceTo(this.focusTarget);
    (this.bokehPass.uniforms as Record<string, THREE.IUniform>).focus.value = focusDist;
  }

  private static _camPos = new THREE.Vector3();

  render(): void {
    this.composer.render();
  }

  resize(width: number, height: number): void {
    this.composer.setSize(width, height);
    this.caPass.uniforms.uResolution.value.set(width, height);
  }

  dispose(): void {
    this.composer.dispose();
  }
}

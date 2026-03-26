import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { CONFIG } from '../utils/config';
import {
  colorGradeVertexShader, colorGradeFragmentShader,
  vignetteVertexShader, vignetteFragmentShader,
  filmGrainVertexShader, filmGrainFragmentShader,
  chromaticAberrationVertexShader, chromaticAberrationFragmentShader,
} from '../shaders/postprocessing';

/**
 * Post-processing pipeline: bloom → color grading → vignette → film grain → chromatic aberration
 */
export class PostProcessing {
  readonly composer: EffectComposer;
  private filmGrainPass: ShaderPass;
  private caPass: ShaderPass;

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    width: number,
    height: number,
  ) {
    this.composer = new EffectComposer(renderer);

    // Render pass
    const renderPass = new RenderPass(scene, camera);
    this.composer.addPass(renderPass);

    // Bloom
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(width, height),
      CONFIG.BLOOM_STRENGTH,
      CONFIG.BLOOM_RADIUS,
      CONFIG.BLOOM_THRESHOLD,
    );
    this.composer.addPass(bloomPass);

    // Color grading
    const colorGradePass = new ShaderPass({
      uniforms: {
        tDiffuse: { value: null },
        uIntensity: { value: 0.6 },
        uExposure: { value: 1.05 },
        uContrast: { value: 1.05 },
        uSaturation: { value: 1.1 },
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

    // Film grain
    this.filmGrainPass = new ShaderPass({
      uniforms: {
        tDiffuse: { value: null },
        uTime: { value: 0 },
        uIntensity: { value: 0.25 },
      },
      vertexShader: filmGrainVertexShader,
      fragmentShader: filmGrainFragmentShader,
    });
    this.composer.addPass(this.filmGrainPass);

    // Chromatic aberration
    this.caPass = new ShaderPass({
      uniforms: {
        tDiffuse: { value: null },
        uIntensity: { value: 0.8 },
        uResolution: { value: new THREE.Vector2(width, height) },
      },
      vertexShader: chromaticAberrationVertexShader,
      fragmentShader: chromaticAberrationFragmentShader,
    });
    this.composer.addPass(this.caPass);
  }

  update(dt: number): void {
    this.filmGrainPass.uniforms.uTime.value += dt;
  }

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

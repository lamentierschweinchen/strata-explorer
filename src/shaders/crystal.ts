// Crystalline-cluster shader patches.
//
// The cluster's bodies are real THREE.MeshPhysicalMaterial / MeshStandardMaterial
// surfaces — environment-lit, clearcoated, iridescent — NOT hand-rolled unlit
// shaders (the four rejected centerpieces all were). Everything data-driven is
// injected into the stock shaders via material.onBeforeCompile:
//
//   GEM    — per-instance age (slots behind head) drives the gem → matrix finality
//            transition: saturated Solana-family color, inner light, roughness and
//            REFRACTION all decay as a crystal roots. Refraction is a custom
//            volume-refraction port of three's transmission chunk that samples a
//            full-scene grab texture (CrystalAxis renders it per frame), because
//            the stock transmission pass renders ONLY opaque objects — the
//            starfield / validator cloud / beams are additive-transparent and
//            would never bend through the stones. material.transmission stays 0
//            so the renderer keeps the mesh in the opaque pass (correct depth,
//            no wasted built-in transmission render).
//   SOLID  — druzy micro-crystals: same aging ramps, no refraction. Glitter as
//            TEXTURE: thousands of real flat facets catching the environment.
//   STEM   — the botryoidal matrix mass the cluster grows from: dark, rough,
//            crevice-shaded, with the amber EMBER BAND burning at finality depth
//            and a druzy speckle zone near the head.
//
// Hard-won craft rules (see git log):
//  • GLSL compiles at runtime — verify in a real browser, console clean.
//  • NaN discipline: guard EVERY normalize()/divide that can degenerate —
//    including refract() at TIR and zero-scaled instances.
//  • Exposure discipline: bloom threshold is 0.72 — broad zones stay below it;
//    pixel-scale glints and the momentary nucleation flash may cross.
//  • Texture bar: must hold up zoomed-in (striations, noise roughness, facets).

import type * as THREE from 'three';

// ---------------------------------------------------------------------------------
// Shared uniform record — CrystalAxis owns one instance and merges it into every
// patched shader, so per-frame updates reach all cluster materials at once.
// ---------------------------------------------------------------------------------
export interface ClusterUniforms {
  [key: string]: THREE.IUniform;
}

// ---------------------------------------------------------------------------------
// GLSL helpers (cluster-prefixed to avoid colliding with three's chunk symbols)
// ---------------------------------------------------------------------------------
const GLSL_HELPERS = /* glsl */ `
  float chash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  float chash13(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
  }
  float cnoise3(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float n000 = chash13(i);
    float n100 = chash13(i + vec3(1.0, 0.0, 0.0));
    float n010 = chash13(i + vec3(0.0, 1.0, 0.0));
    float n110 = chash13(i + vec3(1.0, 1.0, 0.0));
    float n001 = chash13(i + vec3(0.0, 0.0, 1.0));
    float n101 = chash13(i + vec3(1.0, 0.0, 1.0));
    float n011 = chash13(i + vec3(0.0, 1.0, 1.0));
    float n111 = chash13(i + vec3(1.0, 1.0, 1.0));
    return mix(
      mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
      mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y),
      f.z);
  }
  float cfbm3(vec3 p) {
    float v = 0.0;
    v += 0.5 * cnoise3(p);
    v += 0.25 * cnoise3(p * 2.03 + 5.1);
    v += 0.125 * cnoise3(p * 4.01 + 9.7);
    return v;
  }
  // Solana jewel axis: green (0) → magenta (0.5) → purple (1). Saturated, never pastel.
  vec3 clusterFamilyColor(float h) {
    vec3 a = mix(uFamGreen, uFamMagenta, smoothstep(0.0, 0.5, h));
    return mix(a, uFamPurple, smoothstep(0.5, 1.0, h));
  }
`;

// ---------------------------------------------------------------------------------
// Vertex-stage injection (gem + druzy: instanced; stem has its own)
// ---------------------------------------------------------------------------------
const INSTANCED_VERTEX_DECLS = /* glsl */ `
  attribute float aBirth;
  attribute float aHue;
  attribute float aSeed;
  attribute float aMissed;
  uniform float uScroll;
  uniform float uSpacing;
  uniform float uStartS;
  uniform float uFinality;
  uniform float uFlashE;
  uniform float uStruckBirth;
  varying vec3 vCluLocal;
  varying vec3 vCluWorldPos;
  varying vec3 vCluYAxisView;
  varying float vCluScale;
  varying float vCluAge;
  varying float vCluS;
  varying float vCluHue;
  varying float vCluSeed;
  varying float vCluMissed;
  varying float vCluFlash;
`;

const INSTANCED_VERTEX_MAIN = /* glsl */ `
  vCluLocal = position;
  vCluHue = aHue;
  vCluSeed = aSeed;
  vCluMissed = aMissed;
  float cluBehind = uScroll - 1.0 - aBirth;
  vCluAge = cluBehind / uFinality;            // intentionally unclamped: >1 = deep matrix
  vCluS = uStartS + cluBehind * uSpacing;
  vCluFlash = uFlashE * step(abs(aBirth - uStruckBirth), 0.5);
  #ifdef USE_INSTANCING
    mat4 cluModel = modelMatrix * instanceMatrix;
  #else
    mat4 cluModel = modelMatrix;
  #endif
  vCluWorldPos = (cluModel * vec4(position, 1.0)).xyz;
  vec3 cluAxis = cluModel[1].xyz;
  float cluAxisLen = length(cluAxis);
  vCluScale = cluAxisLen;
  // Zero-scaled (unused ring) instances rasterize nothing, but keep the math finite.
  cluAxis = cluAxisLen > 1e-5 ? cluAxis / cluAxisLen : vec3(0.0, 1.0, 0.0);
  vCluYAxisView = (viewMatrix * vec4(cluAxis, 0.0)).xyz;
`;

// ---------------------------------------------------------------------------------
// Fragment-stage shared decls (gem + druzy)
// ---------------------------------------------------------------------------------
const INSTANCED_FRAGMENT_DECLS = /* glsl */ `
  uniform float uTime;
  uniform float uBreath;
  uniform float uFadeS;
  uniform float uEmberS;
  uniform float uEmberW;
  uniform float uStrikeT;
  uniform float uWaveSpeed;
  uniform vec3 uFamPurple;
  uniform vec3 uFamMagenta;
  uniform vec3 uFamGreen;
  uniform vec3 uMatrixCol;
  uniform vec3 uEmberCol;
  uniform vec3 uCoreCol;
  uniform float uGemRough;
  uniform float uMatrixRough;
  varying vec3 vCluLocal;
  varying vec3 vCluWorldPos;
  varying vec3 vCluYAxisView;
  varying float vCluScale;
  varying float vCluAge;
  varying float vCluS;
  varying float vCluHue;
  varying float vCluSeed;
  varying float vCluMissed;
  varying float vCluFlash;
`;

// Stochastic dissolve into space at the far end of the record (opaque pass —
// no blend-sorting woes; the film-grain pass and DoF absorb the dither).
const FADE_DITHER = /* glsl */ `
  float cluFade = 1.0 - smoothstep(uFadeS - 12.0, uFadeS, vCluS);
  if (cluFade < 0.999 &&
      chash12(gl_FragCoord.xy + vec2(vCluSeed * 191.7, vCluSeed * 313.1)) > cluFade) discard;
`;

// Shared zone factors — emitted right after color_fragment so later patches reuse them.
const ZONE_FACTORS = /* glsl */ `
  float cluAge01 = clamp(vCluAge, 0.0, 1.0);
  float cluYoung = 1.0 - smoothstep(0.0, 0.35, cluAge01);
  float cluMatrixF = smoothstep(0.70, 0.98, cluAge01);
  vec3 cluGem = clusterFamilyColor(vCluHue) * (0.88 + 0.24 * fract(vCluSeed * 7.31));
  float cluEmber = exp(-pow(vCluS - uEmberS, 2.0) / max(uEmberW * uEmberW, 1.0));
  float cluWS = uStrikeT * uWaveSpeed;
  float cluWave = exp(-pow(vCluS - cluWS, 2.0) / 48.0) * exp(-uStrikeT * 2.0);
`;

// ---------------------------------------------------------------------------------
// Custom volume refraction — a port of three r183's transmission chunk that samples
// the cluster's own full-scene grab texture (uGrabTex) instead of the renderer's
// opaque-only transmission buffer. Per-channel dispersion always on. All names
// cluster-prefixed; stock chunk compiles empty (material.transmission == 0).
// ---------------------------------------------------------------------------------
const GEM_REFRACTION_PARS = /* glsl */ `
  uniform sampler2D uGrabTex;
  uniform vec2 uGrabSize;
  uniform float uCluIor;
  uniform float uCluThickness;
  uniform float uCluDispersion;
  uniform float uCluAttDist;
  uniform mat4 projectionMatrix;

  float cluW0(float a) { return (1.0 / 6.0) * (a * (a * (-a + 3.0) - 3.0) + 1.0); }
  float cluW1(float a) { return (1.0 / 6.0) * (a * a * (3.0 * a - 6.0) + 4.0); }
  float cluW2(float a) { return (1.0 / 6.0) * (a * (a * (-3.0 * a + 3.0) + 3.0) + 1.0); }
  float cluW3(float a) { return (1.0 / 6.0) * (a * a * a); }
  float cluG0(float a) { return cluW0(a) + cluW1(a); }
  float cluG1(float a) { return cluW2(a) + cluW3(a); }
  float cluH0(float a) { return -1.0 + cluW1(a) / (cluW0(a) + cluW1(a)); }
  float cluH1(float a) { return 1.0 + cluW3(a) / (cluW2(a) + cluW3(a)); }

  vec4 cluBicubic(sampler2D tex, vec2 uv, vec4 texelSize, float lod) {
    uv = uv * texelSize.zw + 0.5;
    vec2 iuv = floor(uv);
    vec2 fuv = fract(uv);
    float g0x = cluG0(fuv.x);
    float g1x = cluG1(fuv.x);
    float h0x = cluH0(fuv.x);
    float h1x = cluH1(fuv.x);
    float h0y = cluH0(fuv.y);
    float h1y = cluH1(fuv.y);
    vec2 p0 = (vec2(iuv.x + h0x, iuv.y + h0y) - 0.5) * texelSize.xy;
    vec2 p1 = (vec2(iuv.x + h1x, iuv.y + h0y) - 0.5) * texelSize.xy;
    vec2 p2 = (vec2(iuv.x + h0x, iuv.y + h1y) - 0.5) * texelSize.xy;
    vec2 p3 = (vec2(iuv.x + h1x, iuv.y + h1y) - 0.5) * texelSize.xy;
    return cluG0(fuv.y) * (g0x * textureLod(tex, p0, lod) + g1x * textureLod(tex, p1, lod)) +
           cluG1(fuv.y) * (g0x * textureLod(tex, p2, lod) + g1x * textureLod(tex, p3, lod));
  }

  vec4 cluTextureBicubic(sampler2D sampler, vec2 uv, float lod) {
    vec2 fLodSize = vec2(textureSize(sampler, int(lod)));
    vec2 cLodSize = vec2(textureSize(sampler, int(lod + 1.0)));
    vec2 fLodSizeInv = 1.0 / max(fLodSize, vec2(1.0));
    vec2 cLodSizeInv = 1.0 / max(cLodSize, vec2(1.0));
    vec4 fSample = cluBicubic(sampler, uv, vec4(fLodSizeInv, fLodSize), floor(lod));
    vec4 cSample = cluBicubic(sampler, uv, vec4(cLodSizeInv, cLodSize), ceil(lod));
    return mix(fSample, cSample, fract(lod));
  }

  vec3 cluVolumeRay(const in vec3 n, const in vec3 v, const in float thickness, const in float ior) {
    vec3 refractionVector = refract(-v, normalize(n), 1.0 / ior);
    // TIR guard: refract() returns vec3(0) past the critical angle — normalize(0) is NaN
    // (the bloom dark-blob scar). Fall back to the reflected ray.
    float rl = length(refractionVector);
    if (rl < 1e-5) return reflect(-v, normalize(n)) * thickness;
    return (refractionVector / rl) * thickness;
  }

  float cluIorRoughness(const in float roughness, const in float ior) {
    return roughness * clamp(ior * 2.0 - 2.0, 0.0, 1.0);
  }

  vec4 cluGrabSample(const in vec2 fragCoord, const in float roughness, const in float ior) {
    float lod = log2(uGrabSize.x) * cluIorRoughness(roughness, ior);
    return cluTextureBicubic(uGrabTex, fragCoord.xy, lod);
  }

  vec3 cluVolumeAttenuation(const in float transmissionDistance, const in vec3 attenuationColor, const in float attenuationDistance) {
    vec3 attenuationCoefficient = -log(clamp(attenuationColor, vec3(0.02), vec3(0.99))) / max(attenuationDistance, 0.05);
    return exp(-attenuationCoefficient * transmissionDistance); // Beer's law
  }

  vec4 cluIBLVolumeRefraction(const in vec3 n, const in vec3 v, const in float roughness, const in vec3 diffuseColor,
    const in vec3 specularColor, const in float specularF90, const in vec3 position,
    const in mat4 viewMat, const in mat4 projMat, const in float dispersion, const in float ior, const in float thickness,
    const in vec3 attenuationColor, const in float attenuationDistance) {

    vec4 transmittedLight;
    vec3 transmittance;

    // Per-channel ior spread — real chromatic fire, always on for the gems.
    float halfSpread = (ior - 1.0) * 0.025 * dispersion;
    vec3 iors = vec3(ior - halfSpread, ior, ior + halfSpread);

    for (int i = 0; i < 3; i++) {
      vec3 transmissionRay = cluVolumeRay(n, v, thickness, iors[i]);
      vec3 refractedRayExit = position + transmissionRay;

      vec4 ndcPos = projMat * viewMat * vec4(refractedRayExit, 1.0);
      vec2 refractionCoords = ndcPos.xy / max(ndcPos.w, 1e-4);
      refractionCoords += 1.0;
      refractionCoords /= 2.0;

      vec4 transmissionSample = cluGrabSample(refractionCoords, roughness, iors[i]);
      transmittedLight[i] = transmissionSample[i];
      transmittedLight.a += transmissionSample.a;

      transmittance[i] = diffuseColor[i] * cluVolumeAttenuation(length(transmissionRay), attenuationColor, attenuationDistance)[i];
    }
    transmittedLight.a /= 3.0;

    vec3 attenuatedColor = transmittance * transmittedLight.rgb;
    vec3 F = EnvironmentBRDF(n, v, specularColor, specularF90, roughness);
    float transmittanceFactor = (transmittance.r + transmittance.g + transmittance.b) / 3.0;
    return vec4((1.0 - F) * attenuatedColor, 1.0 - (1.0 - transmittedLight.a) * transmittanceFactor);
  }
`;

const GEM_REFRACTION_MAIN = /* glsl */ `
  {
    // Per-instance, age-driven refraction: young gems bend the live scene through
    // their bodies (an accent over the lit, glowing stone — never a replacement:
    // space is mostly dark, and a window onto darkness reads as dead glass);
    // rooting crystals close down into opaque matrix.
    float cluTrans = (1.0 - smoothstep(0.55, 0.92, cluAge01)) * 0.62;
    if (cluTrans > 0.003) {
      vec3 cluV = normalize(cameraPosition - vCluWorldPos);
      vec3 cluN = inverseTransformDirection(normal, viewMatrix);
      // Color from WITHIN: attenuation tinted by the crystal's own family hue.
      vec3 cluAttC = clamp(mix(cluGem, vec3(1.0), 0.22), vec3(0.03), vec3(0.99));
      vec4 cluTransmitted = cluIBLVolumeRefraction(
        cluN, cluV, material.roughness, material.diffuseContribution,
        material.specularColorBlended, material.specularF90,
        vCluWorldPos, viewMatrix, projectionMatrix,
        uCluDispersion, uCluIor, uCluThickness * max(vCluScale, 0.05),
        cluAttC, uCluAttDist * max(vCluScale * 0.5, 0.2));
      totalDiffuse = mix(totalDiffuse, cluTransmitted.rgb, cluTrans);
    }
  }
`;

// ---------------------------------------------------------------------------------
// Patch application helpers
// ---------------------------------------------------------------------------------
type PatchedShader = {
  uniforms: { [uniform: string]: THREE.IUniform };
  vertexShader: string;
  fragmentShader: string;
};

function injectInstancedVertex(shader: PatchedShader): void {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\n' + INSTANCED_VERTEX_DECLS)
    .replace('#include <project_vertex>', '#include <project_vertex>\n' + INSTANCED_VERTEX_MAIN);
}

/**
 * GEM — full surgery: aging ramps + striated normals + inner light + custom
 * full-scene volume refraction with dispersion.
 */
export function applyGemPatches(shader: PatchedShader, uniforms: ClusterUniforms): void {
  Object.assign(shader.uniforms, uniforms);
  injectInstancedVertex(shader);

  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>',
      '#include <common>\n' + INSTANCED_FRAGMENT_DECLS + GLSL_HELPERS)
    .replace('#include <transmission_pars_fragment>',
      '#include <transmission_pars_fragment>\n' + GEM_REFRACTION_PARS)
    .replace('#include <clipping_planes_fragment>',
      '#include <clipping_planes_fragment>\n' + FADE_DITHER)
    .replace('#include <color_fragment>',
      '#include <color_fragment>\n' + ZONE_FACTORS + /* glsl */ `
      // Saturated jewel body converging through deep violet into dark matrix.
      vec3 cluMid = mix(cluGem, uFamPurple * 0.40, 0.55);
      vec3 cluCol = mix(cluGem, cluMid, smoothstep(0.12, 0.62, cluAge01));
      cluCol = mix(cluCol, uMatrixCol, cluMatrixF);
      cluCol /= (1.0 + max(vCluAge - 1.0, 0.0) * 0.45); // deep history keeps settling
      diffuseColor.rgb = cluCol;
    `)
    .replace('#include <roughnessmap_fragment>',
      '#include <roughnessmap_fragment>\n' + /* glsl */ `
      float cluRghStriae = sin(vCluLocal.y * 34.0 + vCluSeed * 47.0 + cnoise3(vCluLocal * 2.6) * 3.0);
      roughnessFactor = mix(uGemRough, uMatrixRough, cluMatrixF)
        + (cnoise3(vCluLocal * 9.0 + vCluSeed * 13.0) - 0.5) * 0.08
        + cluRghStriae * 0.015;
      roughnessFactor = clamp(roughnessFactor, 0.03, 0.92);
    `)
    .replace('#include <normal_fragment_maps>',
      '#include <normal_fragment_maps>\n' + /* glsl */ `
      {
        // Growth striations along the prism axis + faint facet grain — enough to make
        // light waver like real stone, never enough to read as dirt.
        float cluStr = sin(vCluLocal.y * 26.0 + vCluSeed * 31.0 + cfbm3(vCluLocal * 1.8) * 4.0);
        vec3 cluJ = vec3(
          cnoise3(vCluLocal * 7.0 + vCluSeed * 17.0),
          cnoise3(vCluLocal * 7.0 + vCluSeed * 17.0 + 7.7),
          cnoise3(vCluLocal * 7.0 + vCluSeed * 17.0 + 13.3)) - 0.5;
        float cluNAmt = mix(0.035, 0.085, smoothstep(0.70, 0.98, clamp(vCluAge, 0.0, 1.0)));
        vec3 cluYV = vCluYAxisView;
        float cluYL = length(cluYV);
        cluYV = cluYL > 1e-4 ? cluYV / cluYL : vec3(0.0, 1.0, 0.0);
        normal = normalize(normal + cluYV * cluStr * cluNAmt + cluJ * cluNAmt * 0.8);
      }
    `)
    .replace('#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\n' + /* glsl */ `
      {
        // Inner light: the stone holds the chain's light (reference 3 — the glow
        // comes from INSIDE the object outward). Young growth burns saturated and
        // breathing, textured by interior veils so it reads as material, never a
        // flat wash; the mid violet zone keeps a quarter of it; the nucleation
        // flash ignites the newest crystal; the strike wave races down the reef;
        // the ember band burns amber as crystals root — then darkness.
        float cluVeil = 0.50 + 0.50 * cfbm3(vCluLocal * 1.5 + vCluSeed * 9.0 + vec3(0.0, uTime * 0.03, 0.0));
        float cluLitZone = cluYoung + 0.48 * (1.0 - cluYoung) * (1.0 - cluMatrixF);
        vec3 cluGlowCol = mix(cluGem, uCoreCol, 0.30);
        totalEmissiveRadiance += cluGlowCol * cluLitZone * cluVeil * (0.22 + 0.10 * uBreath);
        totalEmissiveRadiance += mix(uCoreCol, cluGem, 0.4) * vCluFlash * 0.50;
        totalEmissiveRadiance += cluGlowCol * cluWave * (0.22 * (1.0 - cluMatrixF * 0.8));
        float cluDepthIn = 0.55 + 0.45 * cfbm3(vCluLocal * 0.9 + vCluSeed * 11.0);
        totalEmissiveRadiance += uEmberCol * cluEmber * cluDepthIn
          * (0.26 + 0.10 * uBreath) * (1.0 - cluMatrixF * 0.55);
        // Luma soft-compression: stacked terms (glow+flash+wave at the head) roll
        // off instead of blowing to white — hue survives at the brightest point.
        float cluELuma = dot(totalEmissiveRadiance, vec3(0.2126, 0.7152, 0.0722));
        totalEmissiveRadiance /= (1.0 + cluELuma * 0.55);
        totalEmissiveRadiance *= cluFade;
      }
    `)
    .replace('#include <transmission_fragment>',
      '#include <transmission_fragment>\n' + GEM_REFRACTION_MAIN);
}

/**
 * SOLID — druzy micro-crystals: aging ramps + hot young sparkle, no refraction.
 * Missed slots keep their micros dark and cracked-looking from birth (the vacancy).
 */
export function applySolidPatches(shader: PatchedShader, uniforms: ClusterUniforms): void {
  Object.assign(shader.uniforms, uniforms);
  injectInstancedVertex(shader);

  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>',
      '#include <common>\n' + INSTANCED_FRAGMENT_DECLS + GLSL_HELPERS)
    .replace('#include <clipping_planes_fragment>',
      '#include <clipping_planes_fragment>\n' + FADE_DITHER)
    .replace('#include <color_fragment>',
      '#include <color_fragment>\n' + ZONE_FACTORS + /* glsl */ `
      vec3 cluTip = mix(cluGem, uCoreCol, 0.22 * cluYoung); // bright young points
      vec3 cluCol = mix(cluTip, mix(cluGem, uFamPurple * 0.38, 0.6), smoothstep(0.10, 0.62, cluAge01));
      cluCol = mix(cluCol, uMatrixCol, cluMatrixF);
      cluCol /= (1.0 + max(vCluAge - 1.0, 0.0) * 0.45);
      // The vacancy: a missed slot's micros are lightless cinders, permanently.
      cluCol = mix(cluCol, uMatrixCol * 0.55, vCluMissed);
      diffuseColor.rgb = cluCol;
    `)
    .replace('#include <roughnessmap_fragment>',
      '#include <roughnessmap_fragment>\n' + /* glsl */ `
      roughnessFactor = mix(uGemRough + 0.05, uMatrixRough, cluMatrixF)
        + (chash13(vCluLocal * 5.0 + vCluSeed * 29.0) - 0.5) * 0.10;
      roughnessFactor = clamp(roughnessFactor + vCluMissed * 0.25, 0.05, 0.95);
    `)
    .replace('#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\n' + /* glsl */ `
      {
        float cluLive = 1.0 - vCluMissed; // cinders never emit
        vec3 cluGlowCol = mix(cluGem, uCoreCol, 0.45);
        float cluDruzyZone = cluYoung + 0.40 * (1.0 - cluYoung) * (1.0 - cluMatrixF);
        totalEmissiveRadiance += cluGlowCol * cluDruzyZone * (0.26 + 0.12 * uBreath) * cluLive;
        totalEmissiveRadiance += mix(uCoreCol, cluGem, 0.35) * vCluFlash * 0.70 * cluLive;
        totalEmissiveRadiance += cluGlowCol * cluWave * 0.25 * cluLive * (1.0 - cluMatrixF * 0.8);
        totalEmissiveRadiance += uEmberCol * cluEmber * (0.22 + 0.10 * uBreath)
          * (1.0 - cluMatrixF * 0.5) * cluLive;
        // Settled druzy keeps a rare, faint twinkle — the geode shell still glitters.
        float cluTwk = step(0.992, chash13(vec3(vCluSeed * 97.0, floor(uTime * 2.0 + vCluSeed * 31.0), 7.0)));
        totalEmissiveRadiance += uCoreCol * cluTwk * cluMatrixF * 0.09 * cluLive;
        // Same soft-compression as the gems — the head must never flood.
        float cluELuma = dot(totalEmissiveRadiance, vec3(0.2126, 0.7152, 0.0722));
        totalEmissiveRadiance /= (1.0 + cluELuma * 0.55);
        totalEmissiveRadiance *= cluFade;
      }
    `);
}

// ---------------------------------------------------------------------------------
// STEM — the botryoidal matrix mass (non-instanced; aS/aCrev baked attributes)
// ---------------------------------------------------------------------------------
const STEM_VERTEX_DECLS = /* glsl */ `
  attribute float aS;
  attribute float aCrev;
  varying vec3 vCluLocal;
  varying float vCluS;
  varying float vCluCrev;
`;

const STEM_VERTEX_MAIN = /* glsl */ `
  vCluLocal = position;
  vCluS = aS;
  vCluCrev = aCrev;
`;

const STEM_FRAGMENT_DECLS = /* glsl */ `
  uniform float uTime;
  uniform float uBreath;
  uniform float uFadeS;
  uniform float uEmberS;
  uniform float uEmberW;
  uniform float uStrikeT;
  uniform float uWaveSpeed;
  uniform vec3 uFamPurple;
  uniform vec3 uFamMagenta;
  uniform vec3 uFamGreen;
  uniform vec3 uMatrixCol;
  uniform vec3 uEmberCol;
  uniform vec3 uCoreCol;
  uniform vec3 uStemCol;
  uniform vec3 uStemLip;
  uniform float uStemEmber;
  varying vec3 vCluLocal;
  varying float vCluS;
  varying float vCluCrev;
`;

export function applyStemPatches(shader: PatchedShader, uniforms: ClusterUniforms): void {
  Object.assign(shader.uniforms, uniforms);

  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\n' + STEM_VERTEX_DECLS)
    .replace('#include <project_vertex>', '#include <project_vertex>\n' + STEM_VERTEX_MAIN);

  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>',
      '#include <common>\n' + STEM_FRAGMENT_DECLS + GLSL_HELPERS)
    .replace('#include <clipping_planes_fragment>',
      '#include <clipping_planes_fragment>\n' + /* glsl */ `
      float cluFade = 1.0 - smoothstep(uFadeS - 12.0, uFadeS, vCluS);
      if (cluFade < 0.999 && chash12(gl_FragCoord.xy + vec2(31.7, 11.3)) > cluFade) discard;
    `)
    .replace('#include <color_fragment>',
      '#include <color_fragment>\n' + /* glsl */ `
      // Dark, desaturated host-rock that RECEDES — graphite-indigo stone, never a warm
      // tan. Cool everywhere; the inner lip near the growth front lifts only a touch
      // (still desaturated), never a saturated violet that would compete with the jewel.
      float cluHead = 1.0 - smoothstep(2.0, 40.0, vCluS);
      // Multi-octave mineral mottling so the body reads granular, not flat cardboard.
      float cluMott = cfbm3(vCluLocal * 0.9) * 0.6 + cnoise3(vCluLocal * 3.7 + 11.0) * 0.4;
      vec3 cluShell = mix(uStemCol, uStemLip, cluHead * (0.45 + 0.55 * cluMott));
      // Crevices sink to deep stone shadow (baked occlusion in the botryoidal folds).
      cluShell *= 0.42 + 0.58 * (1.0 - vCluCrev);
      // Granular brightness grain (fine graphite fleck), subtle and cool.
      cluShell *= 0.80 + 0.40 * cluMott;
      diffuseColor.rgb = cluShell;
    `)
    .replace('#include <roughnessmap_fragment>',
      '#include <roughnessmap_fragment>\n' + /* glsl */ `
      // Matte stone: high floor, broad variation + a fine grain so speculars stay
      // dull and scattered (no cardboard sheen). Crevices read roughest.
      roughnessFactor = 0.74 + 0.14 * cnoise3(vCluLocal * 2.2) + 0.10 * vCluCrev
        + 0.08 * cnoise3(vCluLocal * 11.0 + 3.3);
      roughnessFactor = clamp(roughnessFactor, 0.55, 0.98);
    `)
    .replace('#include <normal_fragment_maps>',
      '#include <normal_fragment_maps>\n' + /* glsl */ `
      {
        // Multi-octave granular relief so the shell reads as real STONE, not folded
        // low-poly facets: coarse undulation + medium grit + fine micro-pitting. Each
        // is cheap value-noise; the summed offset magnitude is < 1, so the base unit
        // normal can never be cancelled — normalize() stays finite (no bloom dark-disc).
        vec3 nlp = vCluLocal;
        vec3 g1 = vec3(cnoise3(nlp * 3.1),        cnoise3(nlp * 3.1 + 7.7),  cnoise3(nlp * 3.1 + 13.3)) - 0.5;
        vec3 g2 = vec3(cnoise3(nlp * 9.3 + 2.0),  cnoise3(nlp * 9.3 + 5.0),  cnoise3(nlp * 9.3 + 8.0)) - 0.5;
        vec3 g3 = vec3(cnoise3(nlp * 18.0 + 1.0), cnoise3(nlp * 18.0 + 4.0), cnoise3(nlp * 18.0 + 9.0)) - 0.5;
        normal = normalize(normal + g1 * 0.17 + g2 * 0.12 + g3 * 0.07);
      }
    `)
    .replace('#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\n' + /* glsl */ `
      {
        // Cool indigo floor: the scene's ONLY lights are warm (the tip + ember point
        // lights either back-face the outer shell or wash it amber), so without a cool
        // self-bias the rock tans. This dim charcoal-indigo lift keeps the body reading
        // as cool stone; the warm lights then merely KISS its ridges. Far below the 0.72
        // bloom threshold — it grounds the rock, never glows.
        totalEmissiveRadiance += uStemCol * vec3(0.55, 0.65, 1.0) * 0.5;
        // The ember band: finality glowing THROUGH the shell — now a faint crevice KISS,
        // not a wash (uStemEmber far below the former 0.30). Strongest in the folds where the
        // backlight would leak, veined so it reads as material.
        float cluEmber = exp(-pow(vCluS - uEmberS, 2.0) / max(uEmberW * uEmberW, 1.0));
        float cluVein = 0.40 + 0.60 * cfbm3(vCluLocal * 0.55 + vec3(0.0, uTime * 0.015, 0.0));
        totalEmissiveRadiance += uEmberCol * cluEmber * cluVein * (0.55 + 0.45 * vCluCrev)
          * uStemEmber * (0.85 + 0.15 * uBreath);
        // Strike wave: a faint pulse of life racing down the shell.
        float cluWS = uStrikeT * uWaveSpeed;
        float cluWave = exp(-pow(vCluS - cluWS, 2.0) / 60.0) * exp(-uStrikeT * 2.1);
        totalEmissiveRadiance += uFamPurple * cluWave * 0.07;
        // Inner-lip druzy crust: fine, sparse micro-sparkle near the growth front (the
        // reference geodes' glittering rim) — kept DARK and cool, a hint, not a field.
        float cluHeadZ = 1.0 - smoothstep(2.0, 22.0, vCluS);
        vec3 cluCell = floor(vCluLocal * 15.0);
        float cluSel = step(0.90, chash13(cluCell + 5.0));
        float cluTw = 0.5 + 0.5 * sin(uTime * 1.3 + chash13(cluCell) * 31.4);
        totalEmissiveRadiance += mix(uFamPurple, uFamMagenta, chash13(cluCell + 9.0))
          * cluSel * cluHeadZ * cluTw * 0.11;
        totalEmissiveRadiance *= cluFade;
      }
    `);
}

// Post-processing shaders — color grading, vignette, film grain, chromatic aberration.
// Tuned for warm amber/teal crystal palette.

// ----- Color Grading (warm crystal palette) -----

export const colorGradeVertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const colorGradeFragmentShader = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform float uIntensity;
  uniform float uExposure;
  uniform float uContrast;
  uniform float uSaturation;

  varying vec2 vUv;

  vec3 liftGammaGain(vec3 color, vec3 lift, vec3 gamma, vec3 gain) {
    vec3 lerpV = clamp(pow(color, 1.0 / gamma), 0.0, 1.0);
    return gain * lerpV + lift * (1.0 - lerpV);
  }

  void main() {
    vec4 tex = texture2D(tDiffuse, vUv);
    vec3 color = tex.rgb;

    color *= uExposure;
    color = (color - 0.5) * uContrast + 0.5;

    // Crystal palette: warm amber highlights, cool blue shadows
    vec3 lift = vec3(0.005, -0.005, 0.02);
    vec3 gamma = vec3(1.01, 1.0, 0.96);
    vec3 gain = vec3(1.03, 0.99, 1.01);

    vec3 graded = liftGammaGain(clamp(color, 0.0, 1.0), lift, gamma, gain);

    float luma = dot(graded, vec3(0.2126, 0.7152, 0.0722));
    graded = mix(vec3(luma), graded, uSaturation);

    // Subtle cool tint in shadows (crystal cavern feel)
    float shadowMask = 1.0 - smoothstep(0.0, 0.3, luma);
    graded += vec3(0.01, 0.005, 0.025) * shadowMask;

    // Warm highlight lift (amber crystal glow)
    float highlightMask = smoothstep(0.6, 1.0, luma);
    graded += vec3(0.025, 0.015, 0.0) * highlightMask;

    vec3 finalColor = mix(color, graded, uIntensity);
    gl_FragColor = vec4(clamp(finalColor, 0.0, 1.0), tex.a);
  }
`;

// ----- Vignette -----

export const vignetteVertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const vignetteFragmentShader = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform float uIntensity;
  uniform float uSoftness;

  varying vec2 vUv;

  void main() {
    vec4 tex = texture2D(tDiffuse, vUv);
    vec3 color = tex.rgb;

    vec2 center = vUv - 0.5;
    float dist = length(center);

    float vignette = 1.0 - smoothstep(uSoftness, uSoftness + 0.4, dist) * uIntensity;

    vec3 vignetteColor = color * vignette;
    // Deep blue-purple tint in dark edges (cavern feel)
    vignetteColor += vec3(0.002, 0.0, 0.01) * (1.0 - vignette);

    gl_FragColor = vec4(vignetteColor, tex.a);
  }
`;

// ----- Film Grain -----

export const filmGrainVertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const filmGrainFragmentShader = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform float uTime;
  uniform float uIntensity;

  varying vec2 vUv;

  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  void main() {
    vec4 tex = texture2D(tDiffuse, vUv);
    vec3 color = tex.rgb;

    float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
    float grainMask = smoothstep(0.0, 0.15, luma) * smoothstep(1.0, 0.7, luma);

    vec2 seed = vUv * vec2(1920.0, 1080.0) + vec2(uTime * 137.0, uTime * 311.0);
    float g = hash12(seed);
    float g2 = hash12(seed + 42.0);
    float grain = (g + g2 - 1.0) * uIntensity * grainMask * 0.08;

    color += vec3(grain);
    gl_FragColor = vec4(clamp(color, 0.0, 1.0), tex.a);
  }
`;

// ----- Chromatic Aberration -----

export const chromaticAberrationVertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const chromaticAberrationFragmentShader = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform float uIntensity;
  uniform vec2 uResolution;

  varying vec2 vUv;

  void main() {
    vec2 center = vUv - 0.5;
    float dist = length(center);
    vec2 dir = normalize(center + 0.0001);

    float offset = uIntensity * dist * dist / uResolution.x;

    float r = texture2D(tDiffuse, vUv + dir * offset).r;
    float g = texture2D(tDiffuse, vUv).g;
    float b = texture2D(tDiffuse, vUv - dir * offset * 0.8).b;

    gl_FragColor = vec4(r, g, b, 1.0);
  }
`;

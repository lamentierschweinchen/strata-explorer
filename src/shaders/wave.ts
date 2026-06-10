// Seismic wave shaders — expanding Gaussian rings on a flat disc

export const waveVertexShader = /* glsl */ `
  varying vec3 vWorldPos;

  void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

export const waveFragmentShader = /* glsl */ `
  varying vec3 vWorldPos;

  uniform vec3 uWaveOrigins[4];
  uniform float uWaveTimes[4];
  uniform float uWaveGrand[4];
  uniform float uWaveLives[4];
  uniform int uWaveCount;
  uniform float uWaveSpeed;
  uniform float uWaveRingWidth;
  uniform vec3 uWaveColor;

  void main() {
    float normalI = 0.0;
    float grandI = 0.0; // epoch-ceremony waves accumulate separately (golden)

    for (int i = 0; i < 4; i++) {
      if (i >= uWaveCount) break;

      float grand = uWaveGrand[i];
      float dist = length(vWorldPos.xz - uWaveOrigins[i].xz);
      // Ceremony waves roll out a little slower and far wider
      float waveRadius = uWaveTimes[i] * uWaveSpeed * mix(1.0, 0.8, grand);
      float ringWidth = uWaveRingWidth * mix(1.0, 3.4, grand);

      // Gaussian ring
      float ring = exp(-pow(dist - waveRadius, 2.0) / (ringWidth * ringWidth));

      // Fade over each wave's own lifetime
      float fade = 1.0 - smoothstep(0.0, max(uWaveLives[i], 0.001), uWaveTimes[i]);

      float contrib = ring * fade * mix(0.15, 0.38, grand);
      normalI += contrib * (1.0 - grand);
      grandI += contrib * grand;
    }

    float totalIntensity = normalI + grandI;
    if (totalIntensity < 0.001) discard;

    // Ceremony gold vs the everyday warm ring color
    vec3 color = uWaveColor * normalI + vec3(1.0, 0.83, 0.42) * grandI;
    gl_FragColor = vec4(color, totalIntensity);
  }
`;

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
  uniform int uWaveCount;
  uniform float uWaveSpeed;
  uniform float uWaveLifetime;
  uniform float uWaveRingWidth;
  uniform vec3 uWaveColor;

  void main() {
    float totalIntensity = 0.0;

    for (int i = 0; i < 4; i++) {
      if (i >= uWaveCount) break;

      float dist = length(vWorldPos.xz - uWaveOrigins[i].xz);
      float waveRadius = uWaveTimes[i] * uWaveSpeed;
      float ringWidth = uWaveRingWidth;

      // Gaussian ring
      float ring = exp(-pow(dist - waveRadius, 2.0) / (ringWidth * ringWidth));

      // Fade with age
      float fade = 1.0 - smoothstep(0.0, uWaveLifetime, uWaveTimes[i]);

      totalIntensity += ring * fade * 0.15;
    }

    if (totalIntensity < 0.001) discard;

    vec3 color = uWaveColor * totalIntensity;
    gl_FragColor = vec4(color, totalIntensity);
  }
`;

// Validator mineral deposit shaders — glowing point sprites with
// multi-frequency shimmer, leader spotlight ring, vote pulse,
// seismic wave brightness interaction, and diffraction spikes.

export const mineralVertexShader = /* glsl */ `
  attribute float aSize;
  attribute float aBrightness;
  attribute vec3 aColor;
  attribute float aPhase;
  attribute float aLeaderPulse;
  attribute float aVotePulse;
  attribute float aUpcomingLeader;

  varying vec3 vColor;
  varying float vBrightness;
  varying float vSize;
  varying float vLeaderPulse;

  uniform float uTime;
  uniform float uSizeMultiplier;
  uniform float uBreathOffset;

  // Seismic wave uniforms
  uniform vec3 uWaveOrigins[4];
  uniform float uWaveTimes[4];
  uniform int uWaveCount;
  uniform float uWaveSpeed;
  uniform float uWaveLifetime;

  void main() {
    vColor = aColor;
    vLeaderPulse = aLeaderPulse;

    // Multi-frequency shimmer for organic mineral feel
    float shimmer1 = sin(uTime * 1.2 + aPhase * 6.2831);
    float shimmer2 = sin(uTime * 2.7 + aPhase * 3.1415 + 1.3);
    float shimmer3 = sin(uTime * 0.4 + aPhase * 9.42);
    float shimmer = 0.78 + 0.12 * shimmer1 + 0.06 * shimmer2 + 0.04 * shimmer3;

    // Seismic wave brightness bump
    float waveBump = 0.0;
    for (int i = 0; i < 4; i++) {
      if (i >= uWaveCount) break;
      float dist = length(position.xz - uWaveOrigins[i].xz);
      float waveRadius = uWaveTimes[i] * uWaveSpeed;
      float proximity = exp(-pow(dist - waveRadius, 2.0) / 16.0);
      float fade = 1.0 - smoothstep(0.0, uWaveLifetime, uWaveTimes[i]);
      waveBump += proximity * fade * 0.25;
    }

    // Combine brightness sources
    vBrightness = aBrightness * shimmer
                + aLeaderPulse * 0.8
                + aVotePulse * 0.3
                + aUpcomingLeader * 0.4
                + waveBump;

    // Apply breathing offset to Y position
    vec3 breathedPos = position;
    breathedPos.y += uBreathOffset;

    vec4 mvPosition = modelViewMatrix * vec4(breathedPos, 1.0);

    // Perspective size attenuation
    float perspectiveScale = 300.0 / (-mvPosition.z);
    float finalSize = aSize * uSizeMultiplier * perspectiveScale;

    // Leader pulse increases size
    finalSize *= (1.0 + aLeaderPulse * 2.0);
    // Upcoming leader slight size boost
    finalSize *= (1.0 + aUpcomingLeader * 0.5);

    vSize = finalSize;
    gl_PointSize = clamp(finalSize, 0.5, 80.0);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

export const mineralFragmentShader = /* glsl */ `
  varying vec3 vColor;
  varying float vBrightness;
  varying float vSize;
  varying float vLeaderPulse;

  uniform float uTime;

  void main() {
    vec2 center = gl_PointCoord - 0.5;
    float dist = length(center);

    if (dist > 0.5) discard;

    // -- Multi-layer glow for mineral deposits --

    // Tight hot core
    float coreRadius = 0.05;
    float core = exp(-dist * dist / (coreRadius * coreRadius * 2.0));

    // Inner glow
    float innerGlowR = 0.12;
    float innerGlow = exp(-dist * dist / (innerGlowR * innerGlowR * 2.0));

    // Outer soft halo
    float haloR = 0.35;
    float halo = exp(-dist * dist / (haloR * haloR * 0.3));

    // Diffraction spikes for bright/large minerals
    float spike = 0.0;
    if (vSize > 4.0 && vBrightness > 0.6) {
      float spikeStrength = smoothstep(4.0, 12.0, vSize) * 0.3;
      float ax = abs(center.x);
      float ay = abs(center.y);
      float spike1 = exp(-ay * ay * 800.0) * exp(-ax * 3.0);
      float spike2 = exp(-ax * ax * 800.0) * exp(-ay * 3.0);
      vec2 rot45 = vec2(center.x + center.y, center.x - center.y) * 0.7071;
      float spike3 = exp(-rot45.y * rot45.y * 1200.0) * exp(-abs(rot45.x) * 4.0) * 0.4;
      float spike4 = exp(-rot45.x * rot45.x * 1200.0) * exp(-abs(rot45.y) * 4.0) * 0.4;
      spike = (spike1 + spike2 + spike3 + spike4) * spikeStrength;
    }

    // Leader pulse ring effect
    float ring = 0.0;
    if (vLeaderPulse > 0.01) {
      float ringDist = abs(dist - 0.3);
      ring = exp(-ringDist * ringDist * 200.0) * vLeaderPulse;
    }

    // Combine layers
    float alpha = core + innerGlow * 0.5 + halo * 0.2 + spike + ring;

    // Color: hot white core fading to the mineral's color
    vec3 hotWhite = vec3(1.0, 0.97, 0.9);
    vec3 coreColor = mix(vColor, hotWhite, 0.85);
    vec3 innerColor = mix(vColor, hotWhite, 0.4);
    vec3 haloColor = vColor * 0.8;
    vec3 spikeColor = mix(vColor, hotWhite, 0.6);
    vec3 ringColor = vec3(1.0, 0.95, 0.85);

    vec3 finalColor = coreColor * core
                    + innerColor * innerGlow * 0.5
                    + haloColor * halo * 0.2
                    + spikeColor * spike
                    + ringColor * ring * 2.0;

    finalColor /= max(alpha, 0.001);
    finalColor *= vBrightness;

    gl_FragColor = vec4(finalColor, alpha * clamp(vBrightness, 0.0, 1.0));
  }
`;

// Growth-tip flare — a single billboard point sprite that bursts on every new slot
// at the crystal's growing tip: a hot-white core, a warm halo, and four anamorphic
// diffraction spikes that bloom and decay. Cheap (one point) and entirely additive.

export const flareVertexShader = /* glsl */ `
  uniform float uSize;          // base sprite size in world units (pulses per slot)
  uniform float uIntensity;     // 0..N flare energy (pulses per slot, decays)

  varying float vIntensity;

  void main() {
    vIntensity = uIntensity;

    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    float perspectiveScale = 300.0 / max(-mvPosition.z, 0.001);
    // Size swells with intensity so a fresh slot reads as a real burst.
    float finalSize = uSize * (0.6 + uIntensity * 0.9) * perspectiveScale;

    gl_PointSize = clamp(finalSize, 1.0, 340.0);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

export const flareFragmentShader = /* glsl */ `
  uniform vec3 uColor;          // warm tip color
  uniform float uTime;

  varying float vIntensity;

  void main() {
    vec2 center = gl_PointCoord - 0.5;
    float dist = length(center);
    if (dist > 0.5) discard;

    // Hot core + soft warm halo
    float core = exp(-dist * dist / 0.0016);
    float glow = exp(-dist * dist / 0.02);
    float halo = exp(-dist * dist / 0.12);

    // Four-point anamorphic diffraction spikes (axis-aligned + 45°), slowly rotating.
    float ax = abs(center.x);
    float ay = abs(center.y);
    float spikeH = exp(-ay * ay * 900.0) * exp(-ax * 2.2);
    float spikeV = exp(-ax * ax * 900.0) * exp(-ay * 2.2);
    vec2 r45 = vec2(center.x + center.y, center.x - center.y) * 0.70711;
    float spikeD1 = exp(-r45.y * r45.y * 1400.0) * exp(-abs(r45.x) * 3.0) * 0.45;
    float spikeD2 = exp(-r45.x * r45.x * 1400.0) * exp(-abs(r45.y) * 3.0) * 0.45;
    float spikes = (spikeH + spikeV + spikeD1 + spikeD2);

    float alpha = core + glow * 0.5 + halo * 0.18 + spikes * 0.7;

    vec3 hotWhite = vec3(1.0, 0.98, 0.94);
    vec3 col = mix(uColor, hotWhite, core * 0.85 + spikes * 0.3);
    col = col * (core + glow * 0.5 + spikes * 0.7) + uColor * halo * 0.18;

    col /= max(alpha, 0.001);
    col *= vIntensity;

    gl_FragColor = vec4(col, clamp(alpha * vIntensity, 0.0, 1.0));
  }
`;

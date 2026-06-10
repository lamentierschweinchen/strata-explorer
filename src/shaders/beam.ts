// Leader beam shaders — billboard quad with animated dash pattern and glow

export const beamVertexShader = /* glsl */ `
  attribute vec2 aUv;

  varying vec2 vUv;

  void main() {
    vUv = aUv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const beamFragmentShader = /* glsl */ `
  varying vec2 vUv;

  uniform float uTime;
  uniform float uOpacity;
  uniform vec3 uColor;
  uniform float uDashEnabled;
  uniform float uPulseT; // 0..1 = deposition packet position along the beam (leader→crystal); <0 = none

  void main() {
    // Gaussian glow falloff across beam width (V axis: 0=edge, 0.5=center, 1=edge)
    float centerDist = abs(vUv.y - 0.5) * 2.0;
    float glow = exp(-centerDist * centerDist * 4.0);

    // Animated dash pattern along beam length (U axis)
    float dash = 1.0;
    if (uDashEnabled > 0.5) {
      float pattern = fract(vUv.x * 8.0 - uTime * 2.0);
      dash = smoothstep(0.3, 0.4, pattern) * (1.0 - smoothstep(0.6, 0.7, pattern));
      dash = mix(0.3, 0.85, dash); // gentle pulse along the thread, not tracer fire
    }

    // Deposition strike packet — a hot pulse of light racing toward the crystal,
    // with a short luminous tail trailing behind it.
    float packet = 0.0;
    if (uPulseT >= 0.0) {
      float d = vUv.x - uPulseT;
      packet = exp(-d * d * 260.0);
      packet += exp(-pow(max(uPulseT - vUv.x, 0.0), 2.0) * 60.0) * 0.4 * step(vUv.x, uPulseT);
    }

    float alpha = glow * (dash + packet * 1.1) * uOpacity;
    if (alpha < 0.001) discard;

    // Core is brighter white, edges take beam color; the packet glows warm, not laser-hot
    vec3 coreColor = mix(uColor, vec3(1.0, 0.98, 0.95), glow * 0.4);
    coreColor = mix(coreColor, vec3(1.0, 0.97, 0.9), clamp(packet, 0.0, 1.0) * 0.6);

    gl_FragColor = vec4(coreColor * alpha, alpha);
  }
`;

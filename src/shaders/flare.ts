// Coma — the comet's halo: a single billboard sprite wrapping the nucleus in a
// soft, breathing envelope of light. At idle it is a quiet coma (core + two halos
// + drifting frost-twinkle). On each accretion strike it swells and a six-point
// diffraction star blinks through — the camera-glint of a block crystallizing —
// then settles. Exports keep their historical names (flare*) — only CrystalAxis
// imports them.

export const flareVertexShader = /* glsl */ `
  uniform float uSize;       // base sprite size in world units
  uniform float uIntensity;  // accretion energy 0..1 (decays); idle floor added in JS

  varying float vIntensity;

  void main() {
    vIntensity = uIntensity;

    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    float perspectiveScale = 300.0 / max(-mvPosition.z, 0.001);
    // The coma swells gently with accretion — a breath, not a burst.
    float finalSize = uSize * (0.85 + uIntensity * 0.85) * perspectiveScale;

    // Cap the sprite so a close camera isn't swallowed by the halo.
    gl_PointSize = clamp(finalSize, 1.0, 300.0);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

export const flareFragmentShader = /* glsl */ `
  uniform vec3 uColor;   // warm accretion tint (validator gold family)
  uniform vec3 uIceColor; // the coma's resting icy hue
  uniform float uTime;

  varying float vIntensity;

  void main() {
    vec2 center = gl_PointCoord - 0.5;
    float dist = length(center);
    if (dist > 0.5) discard;

    // Quiet idle coma: small core, mid halo, wide faint envelope.
    float core = exp(-dist * dist / 0.0030);
    float mid  = exp(-dist * dist / 0.030);
    float halo = exp(-dist * dist / 0.140);

    // Frost twinkle: slow angular shimmer drifting through the halo (alive at idle).
    float ang = atan(center.y, center.x);
    float tw = 0.5 + 0.5 * sin(ang * 7.0 + uTime * 0.7) * sin(ang * 3.0 - uTime * 0.43);
    float twinkle = 1.0 + 0.16 * (tw - 0.5) * 2.0;

    // Strike energy above the idle floor → the diffraction star only exists in the
    // accretion moment (no resting "muzzle flash"). Six points, slowly rotating.
    float strike = smoothstep(0.16, 0.55, vIntensity);
    float rot = uTime * 0.05;
    vec2 c = vec2(cos(rot) * center.x - sin(rot) * center.y,
                  sin(rot) * center.x + cos(rot) * center.y);
    float a6 = atan(c.y, c.x);
    float petals = pow(abs(cos(a6 * 3.0)), 28.0);
    float spikes = petals * exp(-dist * 3.2) * strike;

    float alpha = core * 0.55 + mid * 0.38 * twinkle + halo * 0.18 * twinkle + spikes * 0.8;

    vec3 hotWhite = vec3(1.0, 0.98, 0.94);
    // Accretion warms the light toward gold; idle rests icy.
    vec3 tint = mix(uIceColor, uColor, strike * 0.65);
    vec3 col = mix(tint, hotWhite, core * 0.8 + spikes * 0.35);
    col = col * (core + mid * 0.45 + spikes * 0.8) + tint * halo * 0.16 * twinkle;

    col /= max(alpha, 0.02); // bounded un-premultiply — keeps rim rgb finite for bloom
    col *= vIntensity;

    gl_FragColor = vec4(col, clamp(alpha * vIntensity, 0.0, 1.0));
  }
`;

// Epoch progress arc shaders — a thin luminous ring around the base of the crystal
// that fills as the current Solana epoch progresses (~2 days). NOT a gauge: a slow
// halo with a soft comet head creeping around it across the epoch. Drawn on a flat
// annulus in the local XZ plane; the orchestrator positions it near the geode base.
//
// Attributes (per vertex, set by EpochArc):
//   aAngle  ∈ [0,1]  — position around the ring (0 = epoch genesis / +X seam, wraps CCW)
//   aRadial ∈ [0,1]  — across the band width (0 = inner edge, 0.5 = centre line, 1 = outer)
//
// Additive blending (SrcAlpha,One), like the seismic-wave / leader-thread glows: the
// fragment emits premultiplied radiance and outputs alpha = 1. Intensities are tuned to
// the project's bloom budget (BLOOM_THRESHOLD 0.72): the broad fill body sits ~0.3 (well
// under, like the waves) and only the comet head spikes ~1.3 (like the beam packets) so
// just the leading edge crosses bloom — the ring never floods to white.
//
// ROBUSTNESS: no normalize()/sqrt of a possibly-negative value anywhere. The only division
// is `aAngle / max(uProgress, 1e-3)`, explicitly guarded — a degenerate value here would
// otherwise smear into a dark disc through the bloom mip chain (a known failure mode here).

export const epochArcVertexShader = /* glsl */ `
  attribute float aAngle;
  attribute float aRadial;

  varying float vAngle;
  varying float vRadial;

  void main() {
    vAngle = aAngle;
    vRadial = aRadial;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const epochArcFragmentShader = /* glsl */ `
  precision highp float;

  varying float vAngle;
  varying float vRadial;

  uniform float uProgress;    // eased epoch position 0..1 (drives the fill + head)
  uniform float uTime;        // seconds, for shimmer / breath / head pulse
  uniform float uOpacity;     // master fade-in 0..1 (0 until first real progress)
  uniform vec3  uTrackColor;  // faint dark track on the unfilled arc
  uniform vec3  uStartColor;  // genesis hue of the fill gradient (settled violet)
  uniform vec3  uHeadColor;   // leading hue of the fill gradient (live green)
  uniform float uHeadSharp;   // gaussian exponent of the comet head (radius-normalised)
  uniform float uTrailRate;   // comet-tail decay per unit angle behind the head
  uniform float uFlowCycles;  // shimmer wavelength as cycles around the ring
  uniform float uEpochSeed;   // 0..1 subtle per-epoch variation (phase offset)

  void main() {
    float p = clamp(uProgress, 0.0, 1.0);
    float a = vAngle;

    // --- radial profile: a soft-edged glowing line centred in the band ---
    // r: 0 at the centre line, 1 at either band edge. Gaussian → near-zero at the
    // edges so the line never hard-clips against the geometry boundary.
    float r = abs(vRadial - 0.5) * 2.0;
    float line = exp(-r * r * 5.5);

    // --- filled vs unfilled (soft edge at the head, not a hard pixel step) ---
    float headEdge = 0.004;
    float filled = 1.0 - smoothstep(p - headEdge, p + headEdge, a); // 1 where a < p

    // --- position along the lit arc: 0 at genesis, 1 at the head (p→0 guarded) ---
    float along = clamp(a / max(p, 1e-3), 0.0, 1.0);
    vec3 fillCol = mix(uStartColor, uHeadColor, along);

    // --- subtle aurora drift along the lit arc + a slow global breath ---
    float phase = uEpochSeed * 6.2831853;
    float flow = sin(a * uFlowCycles * 6.2831853 - uTime * 1.1 + phase
                     + sin(a * uFlowCycles * 0.37 * 6.2831853 - uTime * 0.43) * 1.3);
    float shimmer = 0.92 + 0.08 * flow;
    float breath = 0.94 + 0.06 * sin(uTime * 0.9 + phase);

    // --- broad fill body: kept under the bloom threshold across the whole arc ---
    float body = 0.28 * shimmer * breath;

    // --- comet tail: brightness ramps up toward the head, fading back to the body ---
    float behind = max(p - a, 0.0);
    float tail = exp(-behind * uTrailRate) * 0.45;

    // --- comet HEAD: a bright gaussian spike at the leading edge (crosses bloom) ---
    float dHead = a - p;
    float headG = exp(-dHead * dHead * uHeadSharp);
    float headPulse = 0.85 + 0.15 * sin(uTime * 2.0 + phase);
    float head = headG * 1.3 * headPulse;

    // faint glow creeping a touch into the dark track just ahead of the head
    float ahead = max(dHead, 0.0);
    float aheadGlow = exp(-ahead * ahead * uHeadSharp * 0.12) * 0.20;

    // --- assemble (premultiplied additive radiance; head core whitens) ---
    vec3 litCol = fillCol + vec3(1.0, 1.0, 0.96) * head * 0.45;
    float litBright = (body + tail) * filled + head;
    float aheadBright = aheadGlow * (1.0 - filled);
    float trackBright = 0.05 * (1.0 - filled);

    vec3 emit = litCol * litBright
              + uHeadColor * aheadBright
              + uTrackColor * trackBright;

    emit *= line * uOpacity;

    // discard near-black fragments (the bulk of the unfilled track between head glows)
    float lum = max(emit.r, max(emit.g, emit.b));
    if (lum < 0.0015) discard;

    gl_FragColor = vec4(emit, 1.0);
  }
`;

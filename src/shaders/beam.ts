// Leader thread shaders — a faint luminous filament arcing from the slot leader to
// the comet nucleus. No dashes, no tracer fire: a barely-there strand of light with
// slow golden motes drifting along it (matter being gathered), and — once per
// produced slot — a soft warm droplet (the deposition packet) that glides down the
// thread and is absorbed by the nucleus. U axis: 0 = leader, 1 = nucleus.

export const beamVertexShader = /* glsl */ `
  attribute vec2 aUv;

  varying vec2 vUv;

  void main() {
    vUv = aUv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const beamFragmentShader = /* glsl */ `
  precision highp float;

  varying vec2 vUv;

  uniform float uTime;
  uniform float uOpacity;
  uniform vec3 uColor;    // validator gold
  uniform vec3 uIceColor; // nucleus ice — the filament cools as it approaches
  uniform float uMotes;   // 1 = living thread (motes + flow); 0 = silent ghost line
  uniform float uPulseT;  // 0..1 deposition droplet position along the thread; <0 = none
  uniform float uSeed;    // de-syncs mote phases between threads

  float hash11(float p) {
    p = fract(p * 0.1031);
    p *= p + 33.33;
    return fract(p * (p + p));
  }

  void main() {
    float u = vUv.x;
    // Gaussian falloff across the thread width (V: 0=edge, 0.5=center, 1=edge).
    float centerDist = abs(vUv.y - 0.5) * 2.0;
    float glow = exp(-centerDist * centerDist * 5.0);

    // End fades: condense out of the leader's halo, dissolve into the coma.
    float ends = smoothstep(0.0, 0.06, u) * (1.0 - smoothstep(0.96, 0.995, u));

    // Base filament: faint, with a slow aurora-like luminescence drifting nucleus-ward.
    float flow = 0.5 + 0.5 * sin(u * 18.0 - uTime * 1.9 + sin(u * 7.0 - uTime * 0.7) * 1.5);
    float filament = (0.16 + 0.20 * flow * uMotes) * ends;

    // Drifting condensation motes — a few soft beads of light gathered in by the
    // nucleus. Slow (8–12s per crossing), staggered, gently brightening as they near.
    float motes = 0.0;
    if (uMotes > 0.5) {
      for (int j = 0; j < 4; j++) {
        float fj = float(j);
        float spd = 0.085 + 0.045 * hash11(fj * 3.7 + uSeed);
        float ph  = hash11(fj * 9.1 + uSeed * 1.7);
        float pos = fract(uTime * spd + ph);
        float d = u - pos;
        float bead = exp(-d * d * 2600.0) * (0.5 + 0.5 * hash11(fj * 5.3 + uSeed));
        motes += bead * (0.35 + 0.65 * pos); // brighter as it approaches the nucleus
      }
      motes *= ends;
    }

    // Deposition droplet: a soft warm head with a tapering luminous wake behind it.
    // Wide gaussians — a drop of light sliding down a strand, not a projectile.
    float packet = 0.0;
    if (uPulseT >= 0.0) {
      float d = u - uPulseT;
      packet = exp(-d * d * 420.0) * 1.15;                       // the drop
      float behind = max(uPulseT - u, 0.0);
      packet += exp(-behind * behind * 28.0) * 0.35 * step(u, uPulseT); // its wake
      packet *= smoothstep(0.0, 0.05, u); // born out of the leader's glow
    }

    float alpha = glow * (filament + motes * 0.9 + packet) * uOpacity;
    if (alpha < 0.002) discard;

    // The filament cools gold → ice as it nears the nucleus; motes and the droplet
    // stay warm — gold being carried in and absorbed.
    vec3 strand = mix(uColor, uIceColor, smoothstep(0.45, 1.0, u) * 0.35);
    vec3 col = mix(strand, vec3(1.0, 0.97, 0.92), glow * 0.25);
    col = mix(col, vec3(1.0, 0.93, 0.78), clamp(motes + packet, 0.0, 1.0) * 0.7);

    gl_FragColor = vec4(col * alpha, alpha);
  }
`;

// Crystalline-comet shaders — three cooperating materials:
//
//   SHARD   — the tail stream: one small faceted bipyramid crystal per slot, strung
//             along a curved path behind the nucleus. Young shards are icy, glowing
//             and loosely scattered; with age (finality) they darken, align and fuse
//             into a tight indigo braid that dissolves into space.
//   NUCLEUS — the growth front: a tumbling crystal cluster suspended at the comet's
//             head, lit from a hot heart. Carries the full "living amethyst" interior
//             craft (inclusions, veils, amber veins, glitter) from the quartz era.
//   SPINE   — a faint volumetric glow tube along the tail curve (the comet's ion
//             tail): connective light that fades as the record settles.
//
// Geometry positioning is done on the CPU (CrystalAxis transforms shard vertices
// every frame) so raycasts against the rendered mesh are exact — the vertex stages
// here are pass-through + varyings only. All displacement lives in TypeScript.
//
// Hard-won craft rules (see git log of this file):
//  • GLSL compiles at runtime — verify in a real browser, console clean.
//  • NaN discipline: guard every normalize()/divide that can degenerate. One NaN
//    pixel enters the bloom mip chain and smears into a dark blob (shipped once).
//  • Exposure discipline: bloom threshold is 0.72 — broad zones must stay below it
//    (luma soft-compression at the end of every fragment); pixel-scale glints SHOULD
//    cross it. Flooding a zone white also shipped once. Never again.
//  • Texture bar: surfaces must hold up zoomed-in (striations, grain, glitter,
//    interior parallax veils).

// ---------------------------------------------------------------------------------
// Shared GLSL helpers (hash / value noise / fbm / safe normalize / luma compression)
// ---------------------------------------------------------------------------------
const GLSL_COMMON = /* glsl */ `
  float hash13(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
  }
  float noise3(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float n000 = hash13(i);
    float n100 = hash13(i + vec3(1.0, 0.0, 0.0));
    float n010 = hash13(i + vec3(0.0, 1.0, 0.0));
    float n110 = hash13(i + vec3(1.0, 1.0, 0.0));
    float n001 = hash13(i + vec3(0.0, 0.0, 1.0));
    float n101 = hash13(i + vec3(1.0, 0.0, 1.0));
    float n011 = hash13(i + vec3(0.0, 1.0, 1.0));
    float n111 = hash13(i + vec3(1.0, 1.0, 1.0));
    return mix(
      mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
      mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y),
      f.z);
  }
  float fbm3(vec3 p) {
    float v = 0.0;
    v += 0.5 * noise3(p);
    v += 0.25 * noise3(p * 2.03 + 5.1);
    v += 0.125 * noise3(p * 4.01 + 9.7);
    return v;
  }
  // NaN-safe normalize: degenerate vectors return a stable up instead of NaN.
  vec3 safeN(vec3 v) {
    float l = length(v);
    return l > 1e-4 ? v / l : vec3(0.0, 1.0, 0.0);
  }
  // Soft highlight compression — broad areas roll off below the bloom threshold;
  // pixel-scale glints (added AFTER compression where noted) stay free to bloom.
  vec3 compress(vec3 c, float k) {
    float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
    return c / (1.0 + luma * k);
  }
`;

// ---------------------------------------------------------------------------------
// SHARD — one crystal splinter per slot, CPU-positioned along the tail curve
// ---------------------------------------------------------------------------------
export const shardVertexShader = /* glsl */ `
  attribute float aGlow;   // strike ignition + cascade pulse (CPU-driven, decaying)
  attribute float aMissed; // 1 = this slot was skipped → dark cinder, never ignites
  attribute float aSeed;   // per-shard deterministic seed (re-rolled on ring reuse)
  attribute float aAge;    // 0 at the head → 1 at finality depth (clamped)
  attribute float aS;      // arc-length behind the nucleus (deep-tail dissolve)

  varying vec3 vWorldNormal;
  varying vec3 vWorldPos;
  varying vec3 vLocalPos;  // mesh-local: nucleus sits at the origin
  varying vec2 vUv;        // x: around shard girth, y: along shard length
  varying float vGlow;
  varying float vMissed;
  varying float vSeed;
  varying float vAge;
  varying float vS;

  void main() {
    vGlow = aGlow;
    vMissed = aMissed;
    vSeed = aSeed;
    vAge = aAge;
    vS = aS;
    vUv = uv;
    vLocalPos = position;

    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    // Comet transform is rotation+translation only, so mat3 is safe for normals.
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

export const shardFragmentShader = /* glsl */ `
  precision highp float;

  varying vec3 vWorldNormal;
  varying vec3 vWorldPos;
  varying vec3 vLocalPos;
  varying vec2 vUv;
  varying float vGlow;
  varying float vMissed;
  varying float vSeed;
  varying float vAge;
  varying float vS;

  uniform float uTime;
  uniform float uBreath;    // 0..1 idle breathing drive
  uniform float uTipPulse;  // accretion bloom at the nucleus (decaying per strike)
  uniform float uFadeS;     // arc-length where the settled tail dissolves
  uniform vec3 uYoungColor;
  uniform vec3 uSettingColor;
  uniform vec3 uFinalColor;
  uniform vec3 uCoreColor;

  ${'__COMMON__'}

  void main() {
    vec3 V = safeN(cameraPosition - vWorldPos);
    vec3 N = safeN(vWorldNormal);

    // Micro-relief: growth striations across the splinter + mineral grain. High
    // frequency (shards are ~2 units long) so they hold up at close zoom.
    float striae = sin(vUv.y * 24.0 + vSeed * 31.0 + noise3(vLocalPos * 2.1) * 2.5);
    vec3 grain = vec3(
      noise3(vLocalPos * 5.2 + vSeed * 13.0),
      noise3(vLocalPos * 5.2 + vSeed * 13.0 + 7.9),
      noise3(vLocalPos * 5.2 + vSeed * 13.0 + 13.4)) - 0.5;
    N = safeN(N + vec3(0.0, striae * 0.04, 0.0) + grain * 0.10);

    float NdotV = dot(N, V);
    float fres = 1.0 - abs(NdotV);

    // Deep-tail dissolve: the settled braid thins into space, a finite object.
    float deepFade = 1.0 - smoothstep(uFadeS - 22.0, uFadeS, vS);

    // --- Missed slot: a cold cinder — fractured, lightless, permanent (honesty) ---
    if (vMissed > 0.5) {
      float crack = step(0.52, fbm3(vLocalPos * 3.4 + vSeed * 9.0));
      float rim = pow(fres, 3.5);
      vec3 c = vec3(0.020, 0.014, 0.034) * (0.6 + 0.4 * crack)
             + vec3(0.09, 0.05, 0.15) * rim;
      gl_FragColor = vec4(c, (0.50 + rim * 0.25) * deepFade);
      return;
    }

    // --- Finality zones along the tail ---
    float youngF = 1.0 - smoothstep(0.0, 0.30, vAge);
    float setF   = smoothstep(0.08, 0.40, vAge) * (1.0 - smoothstep(0.52, 0.86, vAge));
    float finalF = smoothstep(0.60, 1.0, vAge);
    float breath = 0.86 + 0.28 * uBreath;

    // --- Interior seen through the facets: refracted-ray parallax inclusions.
    // Young shards carry drifting icy sediment; settled ones freeze still and dim.
    vec3 Rr = refract(-V, N, 0.66);
    vec3 drift = vec3(0.0, -uTime * 0.02, 0.0) * (youngF + setF * 0.4);
    float incl = fbm3(vLocalPos * 0.9 + vSeed * 23.0 + drift + Rr * 1.6)
               + fbm3(vLocalPos * 2.3 + vSeed * 23.0 + drift * 1.5 + Rr * 3.4) * 0.5;
    incl /= 1.5;
    float inclMask = smoothstep(0.40, 0.78, incl);
    vec3 inclusionCol = mix(vec3(0.16, 0.13, 0.24), vec3(0.45, 0.72, 1.0),
                            clamp(youngF + setF * 0.35, 0.0, 1.0)) * inclMask;

    // --- Base mineral color by age, with per-shard value variation (the variation
    // quiets as shards settle, so the far braid reads as one solid strand) ---
    vec3 baseColor = uYoungColor * youngF + uSettingColor * setF + uFinalColor * finalF;
    baseColor *= mix(0.82 + 0.36 * fract(vSeed * 7.31), 1.0, finalF * 0.6);
    baseColor *= 0.93 + 0.07 * striae;
    // Color-zoning depth: face-on views look deepest into the body → saturate.
    baseColor = mix(baseColor, baseColor * baseColor * 2.2, (1.0 - fres) * 0.45);
    baseColor += inclusionCol * (0.20 + 0.40 * youngF);

    // --- Fixed world lights → glints sweep the facets as the comet sways/camera orbits
    vec3 L1 = normalize(vec3(0.45, 0.85, 0.30));
    vec3 L2 = normalize(vec3(-0.65, 0.20, -0.55));
    float shin = mix(170.0, 36.0, vAge);
    vec3 H1 = L1 + V; H1 /= max(length(H1), 0.02); // NaN guard (camera opposite light)
    vec3 H2 = L2 + V; H2 /= max(length(H2), 0.02);
    float s1 = pow(max(dot(N, H1), 0.0), shin);
    float s2 = pow(max(dot(N, H2), 0.0), shin * 0.5);
    float spec = (s1 + s2 * 0.45) * (0.45 + 0.95 * youngF + 0.30 * setF);
    float diff = max(dot(N, L1), 0.0) * 0.55 + max(dot(N, L2), 0.0) * 0.25 + 0.2;

    // Faked sky reflection — a moving polished sheen, cool above / dark below.
    vec3 Rref = reflect(-V, N);
    float sky = smoothstep(-0.35, 0.85, Rref.y);
    vec3 envCol = mix(vec3(0.04, 0.05, 0.10), vec3(0.55, 0.72, 1.05), sky);
    float reflAmt = (0.10 + 0.55 * pow(fres, 2.0)) * (0.30 + 0.60 * youngF + 0.25 * setF);

    // Glitter — cell-hashed micro-facets, pixel-scale, free to cross the bloom bar.
    vec3 gCell = floor(vLocalPos * 5.5 + vSeed * 31.0);
    float gSel = step(0.66, hash13(gCell + 5.0));
    vec3 gV = vec3(hash13(gCell + 11.1), hash13(gCell + 27.7), hash13(gCell + 43.3)) * 2.0 - 1.0;
    vec3 gN = gV / max(length(gV), 0.05); // NaN-safe
    float glitter = pow(max(dot(reflect(-V, N), gN), 0.0), 40.0) * gSel;

    // --- Inner light from the nucleus: young shards glow from within, surging on
    // each accretion strike. Distance measured in mesh-local space (nucleus = origin).
    float nd = length(vLocalPos);
    float veil = fbm3(vLocalPos * 0.8 + vSeed * 5.0 + Rr * 1.2);
    float sss = exp(-max(nd - 10.0, 0.0) / 34.0)
              * (0.45 + 0.55 * veil)
              * (0.55 + 0.30 * uBreath + 1.30 * uTipPulse);
    vec3 sssCol = mix(uYoungColor, uCoreColor, 0.40) * sss;

    // --- Accretion cascade: the strike pulse sweeps down the stream (CPU wave in
    // aGlow) and each fresh shard ignites once when its block lands.
    vec3 glowCol = mix(uCoreColor, uYoungColor, 0.45) * vGlow;

    // Chromatic dispersion + slow prismatic shimmer on living shards.
    vec3 disp = vec3(pow(fres, 2.4), pow(fres, 3.1), pow(fres, 4.2))
              * vec3(1.0, 0.85, 1.15) * (0.45 * youngF + 0.20 * setF);
    float pAng = vSeed * 6.2831 + fres * 2.5 + uTime * 0.18;
    vec3 prism = (0.5 + 0.5 * cos(6.2831 * (pAng + vec3(0.0, 0.33, 0.67))))
               * pow(fres, 2.0) * (youngF * 0.40 + setF * 0.22) * 0.5;

    // Rim keeps silhouettes alive — icy on the young, faint indigo on the settled.
    float rim = pow(fres, 2.2) * (youngF * 0.85 + setF * 0.45) + pow(fres, 3.5) * finalF * 0.8;
    vec3 rimCol = mix(mix(uYoungColor, vec3(0.55, 0.72, 1.0), 0.5),
                      vec3(0.30, 0.34, 0.58), finalF);

    // Condensing front: the newest shard still forming — shimmer that cools off.
    float forming = smoothstep(0.05, 0.0, vAge);
    float formShimmer = noise3(vLocalPos * 2.4 + uTime * vec3(0.4, 0.9, 0.4));
    vec3 formCol = mix(uCoreColor, uYoungColor, 0.4) * forming
                 * (0.15 + 0.40 * formShimmer) * (1.0 + 1.2 * uTipPulse);

    // --- Assemble ---
    float emissive = youngF * 0.55 + setF * 0.18 + finalF * 0.04;
    vec3 col = baseColor * (diff * 0.5 + emissive) * breath;
    col += envCol * reflAmt;
    col += mix(vec3(0.8, 0.9, 1.05), uCoreColor, 0.4) * spec * (0.55 + 0.85 * youngF);
    col += rimCol * rim * 0.55 * breath;
    col += sssCol * (0.45 + 0.55 * clamp(youngF + setF, 0.0, 1.0));
    col += glowCol * 0.85;
    col += disp * 0.5 + prism;
    col += formCol;

    // Broad-area exposure discipline, THEN the pixel-scale sparkle on top.
    col = compress(col, 0.30);
    col += vec3(0.9, 0.95, 1.1) * glitter * (0.30 + 0.60 * (youngF + setF * 0.5));

    float alpha = (youngF * 0.62 + setF * 0.80 + finalF * 0.94)
                + spec * 0.6 + rim * 0.30 + glitter * 0.25
                + sss * 0.18 + vGlow * 0.30 + forming * 0.12;
    alpha *= deepFade;
    col *= (0.35 + 0.65 * deepFade);

    gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
  }
`.replace('__COMMON__', GLSL_COMMON);

// ---------------------------------------------------------------------------------
// NUCLEUS — the tumbling crystal cluster at the head: the chain's present moment
// ---------------------------------------------------------------------------------
export const nucleusVertexShader = /* glsl */ `
  varying vec3 vWorldNormal;
  varying vec3 vWorldPos;
  varying vec3 vLocalPos;    // cluster-local (tumble NOT applied — stable interior)
  varying vec3 vLocalNormal;

  void main() {
    vLocalPos = position;
    vLocalNormal = normal;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

export const nucleusFragmentShader = /* glsl */ `
  precision highp float;

  varying vec3 vWorldNormal;
  varying vec3 vWorldPos;
  varying vec3 vLocalPos;
  varying vec3 vLocalNormal;

  uniform float uTime;
  uniform float uBreath;
  uniform float uTipPulse;       // accretion: heart flare + warm tint + shimmer surge
  uniform float uNucleusRadius;  // cluster envelope radius (heart-glow falloff)
  uniform vec3 uYoungColor;
  uniform vec3 uSettingColor;
  uniform vec3 uCoreColor;
  uniform vec3 uInclusionColor;  // amber veins (validator gold embedded in the ice)
  uniform vec3 uWarmColor;       // accretion warmth the bloom cools FROM

  ${'__COMMON__'}

  void main() {
    vec3 V = safeN(cameraPosition - vWorldPos);
    vec3 N = safeN(vWorldNormal);

    // Micro-relief: striations along each crystal point + mineral grain.
    float striae = sin(vLocalPos.y * 3.2 + vLocalPos.x * 1.7 + noise3(vLocalPos * 0.8) * 4.0);
    vec3 grain = vec3(
      noise3(vLocalPos * 2.6 + 3.1),
      noise3(vLocalPos * 2.6 + 7.9),
      noise3(vLocalPos * 2.6 + 13.4)) - 0.5;
    N = safeN(N + vec3(0.0, striae * 0.035, 0.0) + grain * 0.09);

    float NdotV = dot(N, V);
    float fres = 1.0 - abs(NdotV);

    vec3 radial = safeN(vLocalPos);
    float rFrac = length(vLocalPos) / max(uNucleusRadius, 0.001);
    // Crevices between cluster members face sideways from the radial direction —
    // deepen them toward violet so the cluster reads as a grown aggregate.
    float crevice = 1.0 - clamp(dot(safeN(vLocalNormal), radial), 0.0, 1.0);

    // --- Interior: refracted parallax veils, drifting upward (alive), with sharp
    // ridged wisps and amber veins — the "living amethyst" inheritance.
    vec3 Rr = refract(-V, N, 0.66);
    vec3 drift = vec3(0.0, -uTime * 0.015, 0.0);
    float veil = fbm3(vLocalPos * 0.16 + drift + Rr * 1.6);
    float incl = fbm3(vLocalPos * 0.22 + drift + Rr * 2.2)
               + fbm3(vLocalPos * 0.62 + drift * 1.5 + Rr * 4.6) * 0.55;
    incl /= 1.55;
    float inclMask = smoothstep(0.36, 0.76, incl);
    float wisp = 1.0 - abs(2.0 * fbm3(vLocalPos * 0.85 + drift * 1.6 + Rr * 3.0) - 1.0);
    wisp = pow(wisp, 4.0);
    float amberVein = pow(1.0 - abs(2.0 * fbm3(vLocalPos * 0.30 + vec3(9.2) + drift * 0.7 + Rr * 1.8) - 1.0), 6.0);
    float amberMask = smoothstep(0.55, 0.85, fbm3(vLocalPos * 0.13 + vec3(3.7) + Rr * 2.0));

    // --- The heart: a hot core deep inside, breathing, FLARING on each accretion.
    // Strongest where the view ray passes nearest the center (gem faces, not tips).
    float heart = exp(-rFrac * 2.5) * (0.55 + 0.45 * veil);
    float heartDrive = 0.45 + 0.22 * uBreath + 1.6 * uTipPulse;

    // --- Base body: icy young crystal, violet in the crevices ---
    vec3 baseColor = mix(uYoungColor, uSettingColor, clamp(crevice * 1.3, 0.0, 1.0) * 0.55);
    baseColor *= 0.9 + 0.1 * striae;
    baseColor = mix(baseColor, baseColor * baseColor * 2.3, (1.0 - fres) * 0.5);
    baseColor += mix(vec3(0.16, 0.13, 0.24), vec3(0.45, 0.72, 1.0), 0.8) * inclMask * 0.35;

    // --- Lighting: fixed key/rim; the tumble makes glints crawl at idle ---
    vec3 L1 = normalize(vec3(0.45, 0.85, 0.30));
    vec3 L2 = normalize(vec3(-0.65, 0.20, -0.55));
    vec3 H1 = L1 + V; H1 /= max(length(H1), 0.02);
    vec3 H2 = L2 + V; H2 /= max(length(H2), 0.02);
    float spec = pow(max(dot(N, H1), 0.0), 180.0) + pow(max(dot(N, H2), 0.0), 90.0) * 0.45;
    float diff = max(dot(N, L1), 0.0) * 0.55 + max(dot(N, L2), 0.0) * 0.25 + 0.22;

    vec3 Rref = reflect(-V, N);
    float sky = smoothstep(-0.35, 0.85, Rref.y);
    vec3 envCol = mix(vec3(0.04, 0.05, 0.10), vec3(0.55, 0.72, 1.05), sky);
    float reflAmt = 0.07 + 0.34 * pow(fres, 2.0);

    // Glitter — accretion makes the surface shimmer crawl (cells re-hash with the
    // pulse phase, gated so idle cells stay still: frost settling, not noise).
    vec3 gCell = floor(vLocalPos * 2.4 + floor(uTipPulse * 5.0));
    float gSel = step(0.60, hash13(gCell + 5.0));
    vec3 gV = vec3(hash13(gCell + 11.1), hash13(gCell + 27.7), hash13(gCell + 43.3)) * 2.0 - 1.0;
    vec3 gN = gV / max(length(gV), 0.05);
    float glitter = pow(max(dot(reflect(-V, N), gN), 0.0), 36.0) * gSel * (1.0 + 1.6 * uTipPulse);

    // Dispersion + prismatic shimmer at grazing edges — gem fire (kept lean: broad
    // rim sums must NOT cross the bloom bar; the cluster is silhouette-heavy).
    vec3 disp = vec3(pow(fres, 2.4), pow(fres, 3.1), pow(fres, 4.2)) * vec3(1.0, 0.85, 1.15) * 0.30;
    float pAng = atan(vLocalNormal.z, vLocalNormal.x) * 0.5 + fres * 2.5 + uTime * 0.20;
    vec3 prism = (0.5 + 0.5 * cos(6.2831 * (pAng + vec3(0.0, 0.33, 0.67)))) * pow(fres, 2.0) * 0.22;

    float rim = pow(fres, 2.2);

    // --- Assemble: cool body + hot heart + golden veins + sparkle ---
    float breath = 0.86 + 0.28 * uBreath;
    vec3 col = baseColor * (diff * 0.45 + 0.16) * breath;
    col += envCol * reflAmt;
    col += mix(vec3(0.8, 0.9, 1.05), uCoreColor, 0.5) * spec * 0.75;
    col += mix(uYoungColor, vec3(0.55, 0.72, 1.0), 0.5) * rim * 0.30 * breath;
    col += uCoreColor * heart * heartDrive * 0.60;
    col += uInclusionColor * (amberMask * 0.35 + amberVein * 0.65) * (0.5 + 0.5 * veil) * (1.0 - heart * 0.5);
    col += mix(uYoungColor, uCoreColor, 0.5) * wisp * (0.16 + 0.26 * heartDrive * heart);
    col += disp + prism;

    // Accretion warmth: the landing block's validator-gold soaks the cluster for a
    // breath, then cools back to ice — absorbed, not reflected.
    col = mix(col, col * uWarmColor * 1.35, clamp(uTipPulse, 0.0, 1.0) * 0.30);

    col = compress(col, 0.45);
    col += vec3(0.9, 0.95, 1.1) * glitter * 0.55; // sparkle rides above the rolloff

    float alpha = 0.88 + rim * 0.10 + spec * 0.4 + heart * 0.10;
    gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
  }
`.replace('__COMMON__', GLSL_COMMON);

// ---------------------------------------------------------------------------------
// SPINE — soft glow tube along the tail curve (the ion tail / connective light)
// ---------------------------------------------------------------------------------
export const spineVertexShader = /* glsl */ `
  attribute float aS; // arc-length behind the nucleus, static per ring

  varying vec3 vWorldNormal;
  varying vec3 vWorldPos;
  varying float vS;

  void main() {
    vS = aS;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

export const spineFragmentShader = /* glsl */ `
  precision highp float;

  varying vec3 vWorldNormal;
  varying vec3 vWorldPos;
  varying float vS;

  uniform float uTime;
  uniform float uBreath;
  uniform float uTipPulse;
  uniform float uStrikeT;    // seconds since the last accretion strike
  uniform float uWaveSpeed;  // cascade speed down the tail (units/s)
  uniform float uHistoryS;   // arc-length of existing history (no glow past the record)
  uniform float uSettleS;    // arc-length over which the glow cools out (finality)
  uniform vec3 uYoungColor;
  uniform vec3 uSettingColor;
  uniform vec3 uCoreColor;

  ${'__COMMON__'}

  void main() {
    vec3 V = safeN(cameraPosition - vWorldPos);
    vec3 N = safeN(vWorldNormal);
    // Inverse fresnel: bright looking through the tube's middle, soft at the limb —
    // a cheap volumetric glow that works from every orbit angle (no billboarding,
    // which matters because this update path has no camera reference).
    float body = pow(abs(dot(N, V)), 1.6);

    float settle = clamp(vS / max(uSettleS, 0.001), 0.0, 1.0);
    // Color settles faster than the light dies, so the violet mid-zone reads.
    float settleC = clamp(vS / max(uSettleS * 0.62, 0.001), 0.0, 1.0);
    float glow = exp(-vS / 42.0) * 0.75 + (1.0 - settle) * 0.25;

    // Flowing luminescence bleeding away from the nucleus — slow, aurora-like.
    // (Low contrast: in a freeze-frame the bands must not read as machined ribs.)
    float flow = fbm3(vec3(vS * 0.22 - uTime * 1.1, uTime * 0.07, 0.0));
    flow = 0.72 + 0.28 * flow;

    // Accretion cascade: a soft front of light racing down the tail each strike.
    float ws = uStrikeT * uWaveSpeed;
    float wave = exp(-pow(vS - ws, 2.0) / 55.0) * exp(-uStrikeT * 1.9);

    // The glow only exists where history exists, and breathes with the comet.
    float history = 1.0 - smoothstep(uHistoryS - 8.0, uHistoryS, vS);
    float breath = 0.80 + 0.20 * uBreath;
    float nearBoost = 1.0 + uTipPulse * 1.3 * exp(-vS / 18.0);

    // Additive blending multiplies col by alpha — keep col at full strength and
    // let alpha carry the fades, or the glow double-attenuates to nothing.
    vec3 col = mix(uYoungColor, uSettingColor, settleC) * 0.85;
    col += uCoreColor * wave * 0.65;
    col = compress(col, 0.25);

    float alpha = body * glow * flow * history * breath * nearBoost * 0.55
                + wave * body * history * 0.25;

    gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.75));
  }
`.replace('__COMMON__', GLSL_COMMON);

// Crystalline-comet shaders — three cooperating materials:
//
//   SHARD   — the tail stream data: one slim crystal needle per slot, embedded as
//             glints inside the tail's light. Young = icy, luminous, scattered;
//             settled = dark, aligned, fused into the braid.
//   NUCLEUS — the growth front: a single elongated, many-faceted gem that REFRACTS
//             the live scene behind it (screen-space grab pass + chromatic
//             dispersion). Transparent like cut stone, not painted like a rock.
//   RIBBON  — the tail's body: layered camera-facing volumes of flowing light
//             along the tail curve (replaces the old thin spine tube). Carries the
//             photographic comet-tail read; the shards carry the data.
//
// Shard/ribbon positioning that affects raycasts stays CPU-side (see CrystalAxis);
// ribbons billboard in the vertex stage (cosmetic only, never raycast).
//
// Hard-won craft rules (see git log):
//  • GLSL compiles at runtime — verify in a real browser, console clean.
//  • NaN discipline: guard EVERY normalize()/divide that can degenerate — including
//    refract() at total internal reflection (returns vec3(0)).
//  • Exposure discipline: bloom threshold is 0.72 — broad zones stay below it
//    (luma soft-compression); pixel-scale glints and facet-edge wires may cross.
//  • Texture bar: must hold up zoomed-in (striations, interior veils, dispersion).

// ---------------------------------------------------------------------------------
// Shared GLSL helpers
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
  vec3 safeN(vec3 v) {
    float l = length(v);
    return l > 1e-4 ? v / l : vec3(0.0, 1.0, 0.0);
  }
  vec3 compress(vec3 c, float k) {
    float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
    return c / (1.0 + luma * k);
  }
`;

// ---------------------------------------------------------------------------------
// SHARD — one crystal needle per slot, CPU-positioned along the tail curve
// ---------------------------------------------------------------------------------
export const shardVertexShader = /* glsl */ `
  attribute float aGlow;
  attribute float aMissed;
  attribute float aSeed;
  attribute float aAge;
  attribute float aS;

  varying vec3 vWorldNormal;
  varying vec3 vWorldPos;
  varying vec3 vLocalPos;
  varying vec2 vUv;
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
  uniform float uBreath;
  uniform float uTipPulse;
  uniform float uFadeS;
  uniform vec3 uYoungColor;
  uniform vec3 uSettingColor;
  uniform vec3 uFinalColor;
  uniform vec3 uCoreColor;

  ${'__COMMON__'}

  void main() {
    vec3 V = safeN(cameraPosition - vWorldPos);
    vec3 N = safeN(vWorldNormal);

    // Fine growth striations along the needle; grain kept whisper-quiet — noisy
    // normals read as dirt, clean facets read as ice.
    float striae = sin(vUv.y * 30.0 + vSeed * 31.0 + noise3(vLocalPos * 2.1) * 2.0);
    N = safeN(N + vec3(0.0, striae * 0.03, 0.0));

    float NdotV = dot(N, V);
    float fres = 1.0 - abs(NdotV);

    float deepFade = 1.0 - smoothstep(uFadeS - 22.0, uFadeS, vS);

    // --- Missed slot: a cold cinder — fractured, lightless, permanent ---
    if (vMissed > 0.5) {
      float crack = step(0.52, fbm3(vLocalPos * 3.4 + vSeed * 9.0));
      float rim = pow(fres, 3.5);
      vec3 c = vec3(0.020, 0.014, 0.034) * (0.6 + 0.4 * crack)
             + vec3(0.09, 0.05, 0.15) * rim;
      gl_FragColor = vec4(c, (0.50 + rim * 0.25) * deepFade);
      return;
    }

    float youngF = 1.0 - smoothstep(0.0, 0.30, vAge);
    float setF   = smoothstep(0.08, 0.40, vAge) * (1.0 - smoothstep(0.52, 0.86, vAge));
    float finalF = smoothstep(0.60, 1.0, vAge);
    float breath = 0.86 + 0.28 * uBreath;

    // Interior parallax inclusions through the facets (still drifting while young)
    vec3 Rr = refract(-V, N, 0.66);
    if (dot(Rr, Rr) < 1e-6) Rr = reflect(-V, N); // TIR guard
    vec3 drift = vec3(0.0, -uTime * 0.02, 0.0) * (youngF + setF * 0.4);
    float incl = fbm3(vLocalPos * 0.9 + vSeed * 23.0 + drift + Rr * 1.6)
               + fbm3(vLocalPos * 2.3 + vSeed * 23.0 + drift * 1.5 + Rr * 3.4) * 0.5;
    incl /= 1.5;
    float inclMask = smoothstep(0.40, 0.78, incl);
    vec3 inclusionCol = mix(vec3(0.16, 0.13, 0.24), vec3(0.45, 0.72, 1.0),
                            clamp(youngF + setF * 0.35, 0.0, 1.0)) * inclMask;

    vec3 baseColor = uYoungColor * youngF + uSettingColor * setF + uFinalColor * finalF;
    baseColor *= mix(0.82 + 0.36 * fract(vSeed * 7.31), 1.0, finalF * 0.6);
    baseColor *= 0.95 + 0.05 * striae;
    baseColor = mix(baseColor, baseColor * baseColor * 2.2, (1.0 - fres) * 0.45);
    baseColor += inclusionCol * (0.20 + 0.40 * youngF);

    vec3 L1 = normalize(vec3(0.45, 0.85, 0.30));
    vec3 L2 = normalize(vec3(-0.65, 0.20, -0.55));
    float shin = mix(190.0, 40.0, vAge);
    vec3 H1 = L1 + V; H1 /= max(length(H1), 0.02);
    vec3 H2 = L2 + V; H2 /= max(length(H2), 0.02);
    float s1 = pow(max(dot(N, H1), 0.0), shin);
    float s2 = pow(max(dot(N, H2), 0.0), shin * 0.5);
    float spec = (s1 + s2 * 0.45) * (0.45 + 0.95 * youngF + 0.30 * setF);
    float diff = max(dot(N, L1), 0.0) * 0.55 + max(dot(N, L2), 0.0) * 0.25 + 0.2;

    vec3 Rref = reflect(-V, N);
    float sky = smoothstep(-0.35, 0.85, Rref.y);
    vec3 envCol = mix(vec3(0.04, 0.05, 0.10), vec3(0.55, 0.72, 1.05), sky);
    float reflAmt = (0.10 + 0.55 * pow(fres, 2.0)) * (0.30 + 0.60 * youngF + 0.25 * setF);

    // Pixel-scale glitter — the crystalline identity at every distance.
    vec3 gCell = floor(vLocalPos * 5.5 + vSeed * 31.0);
    float gSel = step(0.60, hash13(gCell + 5.0));
    vec3 gV = vec3(hash13(gCell + 11.1), hash13(gCell + 27.7), hash13(gCell + 43.3)) * 2.0 - 1.0;
    vec3 gN = gV / max(length(gV), 0.05);
    float glitter = pow(max(dot(reflect(-V, N), gN), 0.0), 44.0) * gSel;

    // Inner light from the nucleus; surges with each accretion.
    float nd = length(vLocalPos);
    float veil = fbm3(vLocalPos * 0.8 + vSeed * 5.0 + Rr * 1.2);
    float sss = exp(-max(nd - 10.0, 0.0) / 34.0)
              * (0.45 + 0.55 * veil)
              * (0.55 + 0.30 * uBreath + 1.30 * uTipPulse);
    vec3 sssCol = mix(uYoungColor, uCoreColor, 0.40) * sss;

    vec3 glowCol = mix(uCoreColor, uYoungColor, 0.45) * vGlow;

    vec3 disp = vec3(pow(fres, 2.4), pow(fres, 3.1), pow(fres, 4.2))
              * vec3(1.0, 0.85, 1.15) * (0.45 * youngF + 0.20 * setF);

    float rim = pow(fres, 2.2) * (youngF * 0.85 + setF * 0.45) + pow(fres, 3.5) * finalF * 0.8;
    vec3 rimCol = mix(mix(uYoungColor, vec3(0.55, 0.72, 1.0), 0.5),
                      vec3(0.30, 0.34, 0.58), finalF);

    float forming = smoothstep(0.05, 0.0, vAge);
    float formShimmer = noise3(vLocalPos * 2.4 + uTime * vec3(0.4, 0.9, 0.4));
    vec3 formCol = mix(uCoreColor, uYoungColor, 0.4) * forming
                 * (0.15 + 0.40 * formShimmer) * (1.0 + 1.2 * uTipPulse);

    float emissive = youngF * 0.55 + setF * 0.18 + finalF * 0.04;
    vec3 col = baseColor * (diff * 0.5 + emissive) * breath;
    col += envCol * reflAmt;
    col += mix(vec3(0.8, 0.9, 1.05), uCoreColor, 0.4) * spec * (0.55 + 0.85 * youngF);
    col += rimCol * rim * 0.55 * breath;
    col += sssCol * (0.45 + 0.55 * clamp(youngF + setF, 0.0, 1.0));
    col += glowCol * 0.85;
    col += disp * 0.5;
    col += formCol;

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
// NUCLEUS — a refractive cut gem: the scene bends through it (grab-pass texture)
// ---------------------------------------------------------------------------------
export const nucleusVertexShader = /* glsl */ `
  varying vec3 vWorldNormal;
  varying vec3 vWorldPos;
  varying vec3 vLocalPos;
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
  uniform float uTipPulse;
  uniform float uNucleusRadius;
  uniform sampler2D uGrabTex;   // the live scene WITHOUT the gem (half-res)
  uniform vec2 uGrabRes;        // full drawing-buffer size (for gl_FragCoord → UV)
  uniform float uRefractK;      // screen-space refraction strength
  uniform vec3 uYoungColor;
  uniform vec3 uSettingColor;
  uniform vec3 uCoreColor;
  uniform vec3 uInclusionColor;
  uniform vec3 uWarmColor;

  ${'__COMMON__'}

  void main() {
    vec3 V = safeN(cameraPosition - vWorldPos);
    vec3 N = safeN(vWorldNormal);

    // Whisper-quiet growth striations: enough to make the refraction waver like
    // real ice, never enough to read as surface dirt.
    float striae = sin(vLocalPos.y * 2.6 + noise3(vLocalPos * 0.7) * 3.0);
    N = safeN(N + vec3(0.0, striae * 0.018, 0.0) );

    float NdotV = dot(N, V);
    float fres = 1.0 - abs(NdotV);
    float rFrac = length(vLocalPos) / max(uNucleusRadius, 0.001);

    // ---------- TRANSMISSION: the world, bent through the stone ----------
    // Refract per-channel (chromatic dispersion), project into screen space and
    // sample the grab texture. TIR-guarded; offsets scale with apparent size so
    // the bend is stable across zoom.
    vec2 baseUV = gl_FragCoord.xy / uGrabRes;
    float viewDist = max(distance(cameraPosition, vWorldPos), 1.0);
    float offScale = uRefractK * uNucleusRadius / viewDist;

    vec3 Rr = refract(-V, N, 0.66);
    if (dot(Rr, Rr) < 1e-6) Rr = reflect(-V, N);
    vec3 Rg = refract(-V, N, 0.655);
    if (dot(Rg, Rg) < 1e-6) Rg = Rr;
    vec3 Rb = refract(-V, N, 0.645);
    if (dot(Rb, Rb) < 1e-6) Rb = Rr;

    vec2 oR = (mat3(viewMatrix) * Rr).xy * offScale;
    vec2 oG = (mat3(viewMatrix) * Rg).xy * offScale;
    vec2 oB = (mat3(viewMatrix) * Rb).xy * offScale;
    vec3 grab;
    grab.r = texture2D(uGrabTex, baseUV + oR).r;
    grab.g = texture2D(uGrabTex, baseUV + oG).g;
    grab.b = texture2D(uGrabTex, baseUV + oB).b;

    // Per-facet value variation — every cut face catches the world differently.
    // Hashed from the FLAT local normal, so it is stable per facet and snaps at
    // the edges (the jewel signature; smooth shading would kill it).
    float facetKey = hash13(floor(safeN(vLocalNormal) * 6.5) + 3.0);
    float facetTint = 0.80 + 0.40 * facetKey;

    // Absorption: looking deeper through the body tints toward glacial blue.
    float depthLook = (1.0 - fres) * (0.45 + 0.55 * (1.0 - rFrac));
    vec3 absorb = mix(vec3(1.0), vec3(0.66, 0.82, 1.12), clamp(depthLook, 0.0, 1.0));
    float transmission = (1.0 - fres * 0.75);
    vec3 col = grab * absorb * transmission * 1.15 * facetTint;

    // ---------- INTERIOR: the stone is itself a light source ----------
    vec3 driftv = vec3(0.0, -uTime * 0.012, 0.0);
    float veil = fbm3(vLocalPos * 0.16 + driftv + Rr * 1.6);
    float wisp = 1.0 - abs(2.0 * fbm3(vLocalPos * 0.55 + driftv * 1.6 + Rr * 2.6) - 1.0);
    wisp = pow(wisp, 5.0);
    float amberVein = pow(1.0 - abs(2.0 * fbm3(vLocalPos * 0.22 + vec3(9.2) + driftv * 0.7 + Rr * 1.8) - 1.0), 7.0);

    // Cool body luminescence textured by the veils — transmission of empty space
    // must never read as mud; the gem holds the chain's light.
    col += mix(uSettingColor, uYoungColor, 0.65) * (0.045 + 0.075 * veil)
         * (0.55 + 0.45 * (1.0 - fres)) * facetTint;

    // The heart: a hot core deep inside, breathing, flaring on each accretion.
    float heart = exp(-rFrac * 2.2) * (0.55 + 0.45 * veil);
    float heartDrive = 0.55 + 0.22 * uBreath + 1.7 * uTipPulse;
    col += uCoreColor * heart * heartDrive * 0.70;
    // Gold lives near the heart only — kept faint so the body never turns muddy.
    col += uInclusionColor * amberVein * (0.05 + 0.05 * veil) * (0.25 + 0.75 * heart);
    col += mix(uYoungColor, uCoreColor, 0.5) * wisp * (0.10 + 0.30 * heart * heartDrive);

    // ---------- SURFACE: reflection, facet wires, sparkle ----------
    vec3 L1 = normalize(vec3(0.45, 0.85, 0.30));
    vec3 L2 = normalize(vec3(-0.65, 0.20, -0.55));
    vec3 H1 = L1 + V; H1 /= max(length(H1), 0.02);
    vec3 H2 = L2 + V; H2 /= max(length(H2), 0.02);
    float spec = pow(max(dot(N, H1), 0.0), 240.0) + pow(max(dot(N, H2), 0.0), 120.0) * 0.4;

    vec3 Rref = reflect(-V, N);
    float sky = smoothstep(-0.35, 0.85, Rref.y);
    vec3 envCol = mix(vec3(0.03, 0.04, 0.08), vec3(0.50, 0.68, 1.02), sky);
    col += envCol * (0.05 + 0.45 * pow(fres, 2.5));

    // Facet-edge wires: the signature of a cut stone. Flat-shaded normals jump at
    // facet boundaries → fwidth spikes exactly one pixel wide there.
    float ew = clamp(length(fwidth(normalize(vLocalNormal))) * 2.2, 0.0, 1.0);
    ew = smoothstep(0.18, 0.9, ew);

    // Accretion warmth — absorbed gold, cooling back to ice.
    col = mix(col, col * uWarmColor * 1.30, clamp(uTipPulse, 0.0, 1.0) * 0.28);

    col = compress(col, 0.40);

    // Above the rolloff: glints that are allowed to bloom (pixel-scale only).
    col += mix(vec3(0.85, 0.92, 1.1), uCoreColor, 0.5) * spec * 0.9;
    col += vec3(0.85, 0.92, 1.10) * ew * (0.10 + 0.55 * fres + 0.35 * uTipPulse);

    gl_FragColor = vec4(col, 0.985);
  }
`.replace('__COMMON__', GLSL_COMMON);

// ---------------------------------------------------------------------------------
// RIBBON — layered camera-facing volumes of light along the tail curve
// ---------------------------------------------------------------------------------
export const ribbonVertexShader = /* glsl */ `
  attribute vec3 aTan;   // curve tangent at this ring (mesh-local)
  attribute float aS;    // arc-length behind the nucleus
  attribute float aSide; // -1 | +1 across the ribbon

  varying float vS;
  varying float vSide;
  varying vec3 vWorldPos;

  uniform float uWidth;      // base half-width at the head
  uniform float uFadeS;

  void main() {
    vS = aS;
    vSide = aSide;

    vec4 wp = modelMatrix * vec4(position, 1.0);
    vec3 tw = normalize(mat3(modelMatrix) * aTan);
    vec3 viewDir = wp.xyz - cameraPosition;
    vec3 perp = cross(tw, viewDir);
    float pl = length(perp);
    perp = pl > 1e-4 ? perp / pl : vec3(0.0, 1.0, 0.0); // looking down the tail

    // Width: emerges from inside the gem, swells just behind it, tapers long.
    float head = smoothstep(0.0, 14.0, aS);
    float w = uWidth * head * (0.34 + 0.66 * exp(-aS / 70.0));
    wp.xyz += perp * w * aSide;

    vWorldPos = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

export const ribbonFragmentShader = /* glsl */ `
  precision highp float;

  varying float vS;
  varying float vSide;
  varying vec3 vWorldPos;

  uniform float uTime;
  uniform float uBreath;
  uniform float uTipPulse;
  uniform float uStrikeT;
  uniform float uWaveSpeed;
  uniform float uHistoryS;
  uniform float uSettleS;
  uniform float uIntensity;  // per-layer brightness
  uniform float uSeed;       // de-syncs layer noise
  uniform float uFlow;       // filament drift speed
  uniform vec3 uYoungColor;
  uniform vec3 uSettingColor;
  uniform vec3 uCoreColor;

  ${'__COMMON__'}

  void main() {
    // Soft volume profile across the ribbon.
    float across = 1.0 - vSide * vSide;
    across = pow(max(across, 0.0), 1.9);

    float settle = clamp(vS / max(uSettleS, 0.001), 0.0, 1.0);
    float settleC = clamp(vS / max(uSettleS * 0.62, 0.001), 0.0, 1.0);

    // Luminosity dies as the record settles; a faint ember floor lingers mid-tail.
    float glow = exp(-vS / 38.0) * 0.80 + (1.0 - settle) * 0.20;

    // Filamentary structure flowing away from the head — the streamers that make a
    // comet tail read photographic instead of airbrushed.
    float fil = fbm3(vec3(vS * 0.30 - uTime * uFlow, vSide * 1.9 + uSeed * 7.0, uSeed));
    fil = 1.0 - abs(2.0 * fil - 1.0);
    fil = pow(fil, 2.6);
    float texAmt = 0.45 + 0.55 * fil;

    // Accretion cascade racing down the tail.
    float ws = uStrikeT * uWaveSpeed;
    float wave = exp(-pow(vS - ws, 2.0) / 55.0) * exp(-uStrikeT * 1.9);

    float history = 1.0 - smoothstep(uHistoryS - 8.0, uHistoryS, vS);
    float breath = 0.84 + 0.16 * uBreath;
    float nearBoost = 1.0 + uTipPulse * 1.2 * exp(-vS / 18.0);

    vec3 col = mix(uYoungColor, uSettingColor, settleC) * 0.9;
    col += uCoreColor * wave * 0.6;
    col = compress(col, 0.25);

    float alpha = across * glow * texAmt * history * breath * nearBoost * uIntensity
                + wave * across * history * uIntensity * 0.30;

    gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.8));
  }
`.replace('__COMMON__', GLSL_COMMON);

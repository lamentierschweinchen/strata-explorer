// Crystal axis shaders — a FACETED QUARTZ prism (not a tube).
//
// The geometry is an irregular hexagonal column of flat, hard-edged facets that
// tapers to a terminating point at the growing tip. The vertex stage applies that
// taper (and analytically re-tilts the flat facet normals so the point shades
// correctly). The fragment stage does the gem craft: fixed world-space key/rim
// lights whose specular glints SWEEP across facets as the camera orbits, a faked
// cool-sky environment reflection, chromatic dispersion at grazing edges, internal
// strata banding + parallax inclusions seen "through" the translucent facets, and a
// finality gradient (glowing icy tip → settling violet → opaque dark bedrock).
//
// Glow / Fresnel / hot-white-core techniques adapted from the sibling Galaxy of
// Nodes star + metachain shaders, reworked for a solid faceted mineral.

export const crystalVertexShader = /* glsl */ `
  attribute float aFlash;
  attribute float aMissed;
  attribute float aSeed;

  varying vec3 vWorldNormal;
  varying vec3 vWorldPos;
  varying float vAge;
  varying float vFlash;
  varying float vMissed;
  varying float vWorldY;
  varying float vSeed;
  varying float vFacetId;

  uniform float uScrollOffset;
  uniform float uGrowthPointY;
  uniform float uFinalityHeight;
  uniform float uTipTaperHeight; // world height over which the tip tapers to a point
  uniform float uTipMinScale;    // radius scale at the very tip
  uniform vec2 uApexOffset;      // XZ offset of the terminating apex (asymmetric, like real quartz)

  void main() {
    vFlash = aFlash;
    vMissed = aMissed;
    vSeed = aSeed;

    // Scroll the static ring-buffer geometry down through the world.
    vec3 pos = position;
    float worldY = pos.y + uScrollOffset;
    vWorldY = worldY;

    // Smooth, continuous finality age from height: 0 at the growing tip, 1 at the
    // finality depth below it (older → 1).
    float distFromTop = uGrowthPointY - worldY;
    vAge = clamp(distFromTop / uFinalityHeight, 0.0, 1.0);

    // --- Terminating-point taper (uneven, like a natural quartz termination) ------
    // Each CORNER gets its own taper height, hashed from its angular position. Both
    // facets meeting at a corner share its exact xz, so the hash matches and the mesh
    // stays watertight — but adjacent corners converge at different rates, which turns
    // the perfect "rocket nose" into an irregular rhombohedral-looking termination.
    float cAng = atan(position.z, position.x);
    float cj = fract(sin(cAng * 37.719) * 43758.5453);
    float taperH = uTipTaperHeight * (0.72 + 0.62 * cj);
    float tt = clamp(distFromTop / taperH, 0.0, 1.0);
    float taperUp = smoothstep(0.0, 1.0, tt);
    float radiusScale = mix(uTipMinScale, 1.0, taperUp) * (1.0 - 0.05 * vAge);

    // Analytic slope d(radius)/d(worldY) of the tip ramp, used to re-tilt the flat
    // facet normal so the terminating faces (which slope inward/up) shade correctly.
    float baseR = length(position.xz);
    float dTaper = (1.0 - uTipMinScale) * 6.0 * tt * (1.0 - tt) / max(taperH, 0.001);
    float slope = -baseR * dTaper; // radius shrinks as worldY rises near the tip

    // Taper pulls corners toward an OFF-CENTER apex, so the point sits asymmetric.
    pos.xz = pos.xz * radiusScale + uApexOffset * (1.0 - radiusScale);
    pos.y = worldY;

    // Flat facet normal (horizontal, from the attribute) tilted by the taper slope.
    vec3 nObj = normalize(vec3(normal.x, -slope, normal.z));

    vec4 worldPos = modelMatrix * vec4(pos, 1.0);
    vWorldPos = worldPos.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * nObj);
    vFacetId = atan(normal.z, normal.x); // stable per-facet id for shimmer variation

    vec4 mvPosition = viewMatrix * worldPos;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

export const crystalFragmentShader = /* glsl */ `
  precision highp float;

  varying vec3 vWorldNormal;
  varying vec3 vWorldPos;
  varying float vAge;
  varying float vFlash;
  varying float vMissed;
  varying float vWorldY;
  varying float vSeed;
  varying float vFacetId;

  uniform float uTime;
  uniform float uBreath;         // 0..1 idle dual-frequency breathing drive
  uniform float uTipPulse;       // 0..1 per-slot pulse — drives the body-wide inner light surge
  uniform float uStrikeT;        // seconds since the last deposition strike (large = none)
  uniform float uSegmentHeight;  // world height of one strata layer
  uniform float uFinalityHeight;
  uniform float uTipTaperHeight; // taper-zone height (phantom ghost-termination spacing)
  uniform float uGrowthPointY;
  uniform vec2 uApexOffset;      // where the apex actually sits (SSS light origin)
  uniform float uBodyRadius;     // nominal body radius (phantom radial profile)
  uniform vec3 uYoungColor;
  uniform vec3 uSettingColor;
  uniform vec3 uFinalColor;
  uniform vec3 uCoreColor;
  uniform vec3 uInclusionColor;  // amber veils inside the violet body

  // --- 3D value noise for internal inclusions (phantom quartz veils) ---
  float hash13(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
  }
  float noise3(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float n000 = hash13(i + vec3(0.0, 0.0, 0.0));
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

  void main() {
    vec3 N = normalize(vWorldNormal);
    vec3 V = normalize(cameraPosition - vWorldPos);

    // --- Surface micro-relief: quartz growth striations (fine horizontal ridges across
    // the prism faces) + granular unevenness. Perturbing the normal makes ALL downstream
    // lighting (diffuse, spec, fresnel, reflection, dispersion) break up across the
    // faces — texture the light responds to, not paint.
    float striae = sin(vWorldY * 9.0 + vSeed * 17.0 + noise3(vWorldPos * 0.5) * 3.0);
    vec3 grain = vec3(
      noise3(vWorldPos * 1.9 + 3.1),
      noise3(vWorldPos * 1.9 + 7.9),
      noise3(vWorldPos * 1.9 + 13.4)) - 0.5;
    N = normalize(N + vec3(0.0, striae * 0.05, 0.0) + grain * 0.11);

    float NdotV = dot(N, V);
    float fres = 1.0 - abs(NdotV);

    // --- Missed slot: a dark fractured gap, no flare (visual honesty) ---
    if (vMissed > 0.5) {
      float rim = pow(fres, 4.0);
      vec3 c = vec3(0.035, 0.025, 0.06) + vec3(0.10, 0.06, 0.16) * rim;
      gl_FragColor = vec4(c, 0.16 + rim * 0.30);
      return;
    }

    // --- Finality zones: young (tip) → setting (mid) → finalized (bedrock) ---
    float youngF = 1.0 - smoothstep(0.0, 0.34, vAge);
    float setF   = smoothstep(0.10, 0.42, vAge) * (1.0 - smoothstep(0.55, 0.88, vAge));
    float finalF = smoothstep(0.62, 1.0, vAge);

    float breath = 0.84 + 0.32 * uBreath;
    float distFromTop = uGrowthPointY - vWorldY;

    // --- Internal structure seen THROUGH the facets (so it's not a hollow shell) ---
    // Sample inclusion noise along the refracted view ray for a parallax "depth" feel.
    // The fields drift slowly UPWARD — the growth direction — so the interior is alive.
    vec3 Rr = refract(-V, N, 0.66); // IOR ~1.5 (quartz)
    vec3 drift = vec3(0.0, -uTime * 0.012, 0.0);
    float incl = fbm3(vWorldPos * 0.10 + drift + Rr * 2.0)
               + fbm3(vWorldPos * 0.32 + drift * 1.5 + Rr * 5.0) * 0.55
               + fbm3(vWorldPos * 0.10 + drift + Rr * 6.0) * 0.6;
    incl /= 2.15;
    float inclMask = smoothstep(0.35, 0.78, incl);
    vec3 inclYoung = vec3(0.45, 0.72, 1.0);
    vec3 inclOld   = vec3(0.20, 0.16, 0.28);
    vec3 inclusionCol = mix(inclOld, inclYoung, clamp(youngF + setF * 0.4, 0.0, 1.0)) * inclMask;

    // Milky vertical veils (anisotropic: stretched along the growth axis), used to
    // texture the inner light so it reads as mineral, not fog.
    float veil = fbm3(vec3(vWorldPos.x * 0.14, vWorldPos.y * 0.05, vWorldPos.z * 0.14) + drift + Rr * 1.6);

    // Ridged wisps — sharp internal filaments (the "lightning" veils real quartz carries),
    // far crisper than the soft fbm haze.
    float wisp = 1.0 - abs(2.0 * fbm3(vWorldPos * 0.5 + drift * 1.6 + Rr * 3.5) - 1.0);
    wisp = pow(wisp, 4.0);

    // Glitter — cell-hashed micro-facets that flash in and out as the view moves
    // (the pixel-scale sparkle that says "crystalline" at any distance).
    vec3 gCell = floor(vWorldPos * 2.4);
    float gSel = step(0.62, hash13(gCell + 5.0));
    // NaN-safe normalize: a near-zero hash vector would NaN (and NaN×0 is still NaN in
    // GLSL — one such pixel entering the bloom mip chain smears into a dark blob).
    vec3 gV = vec3(hash13(gCell + 11.1), hash13(gCell + 27.7), hash13(gCell + 43.3)) * 2.0 - 1.0;
    vec3 gN = gV / max(length(gV), 0.05);
    float glitter = pow(max(dot(reflect(-V, N), gN), 0.0), 36.0) * gSel;

    // --- Fake subsurface scattering: the tip light diffuses DOWN through the body.
    // Two falloffs (a hot near-tip core + a long soft tail), textured by the veils,
    // breathing at idle and SURGING body-wide on each slot (uTipPulse) — the heartbeat
    // visibly travels through the whole gem, not just the newest segment.
    vec3 tipPos = vec3(uApexOffset.x, uGrowthPointY, uApexOffset.y);
    float tipDist = distance(vWorldPos, tipPos);
    float sss = (exp(-tipDist / 20.0) * 0.50 + exp(-tipDist / 70.0) * 0.22)
              * (0.45 + 0.55 * veil)
              * (0.62 + 0.28 * uBreath + 0.9 * uTipPulse);
    // The inner light is icy-white at the tip but turns AMETHYST as it descends, so the
    // violet zone reads as a violet glow instead of being washed white.
    vec3 sssCol = mix(uSettingColor * 1.15, mix(uYoungColor, uCoreColor, 0.35),
                      clamp(youngF * 1.2, 0.0, 1.0)) * sss;

    // --- Amber veil inclusions: golden mineral threads inside the violet body (the
    // validator-cloud gold, embedded in the gem). Strongest in the setting zone.
    float amberField = fbm3(vWorldPos * 0.07 + vec3(3.7) + drift * 0.5 + Rr * 2.4);
    float amberMask = smoothstep(0.55, 0.85, amberField);
    // Thread-like golden VEINS (ridged noise) on top of the soft amber wash — defined
    // mineral seams rather than haze.
    float amberVein = pow(1.0 - abs(2.0 * fbm3(vWorldPos * 0.16 + vec3(9.2) + drift * 0.7 + Rr * 2.0) - 1.0), 6.0);
    vec3 amberCol = uInclusionColor * (amberMask * 0.6 + amberVein * 0.9)
                  * (setF * 0.85 + finalF * 0.18) * (0.5 + 0.5 * veil);

    // --- Phantom growth layers: ghost outlines of EARLIER terminations preserved
    // inside the crystal (real phantom-quartz feature — and literally the strata story:
    // past states of the chain, visible in the body). Two ghosts at different depths.
    float radFrac = length(vWorldPos.xz - uApexOffset) / max(uBodyRadius, 0.001);
    float ghost1 = smoothstep(0.0, 1.0, clamp((distFromTop - uTipTaperHeight * 0.45) / uTipTaperHeight, 0.0, 1.0));
    float ghost2 = smoothstep(0.0, 1.0, clamp((distFromTop - uTipTaperHeight * 0.95) / uTipTaperHeight, 0.0, 1.0));
    float phantom = smoothstep(0.10, 0.02, abs(radFrac - ghost1)) * 0.55
                  + smoothstep(0.10, 0.02, abs(radFrac - ghost2)) * 0.30;
    phantom *= (youngF * 0.7 + setF * 0.5) * (0.4 + 0.6 * veil);
    vec3 phantomCol = mix(uYoungColor, uInclusionColor, 0.35) * phantom;

    // Strata banding — each segment is one layer; thin dark seam at each boundary,
    // plus a per-segment value shift (seeded) so the layers read as sediment.
    float layer = vWorldY / max(uSegmentHeight, 0.001);
    float seam = smoothstep(0.0, 0.16, abs(sin(layer * 3.14159)));
    float strata = 0.6 + 0.4 * sin(layer * 6.2831 + vSeed * 6.2831);

    // --- Base mineral color by finality ---
    vec3 baseColor = uYoungColor * youngF + uSettingColor * setF + uFinalColor * finalF;
    baseColor *= (0.75 + 0.25 * strata);
    baseColor = mix(baseColor, baseColor * 0.5, (1.0 - seam) * (0.4 + 0.6 * finalF));
    baseColor *= (0.93 + 0.07 * striae); // fine growth-line banding across the faces
    // Color zoning depth: looking face-on = looking deepest into the body, so the hue
    // saturates there (self-multiply deepens without brightening) — gem, not paint.
    baseColor = mix(baseColor, baseColor * baseColor * 2.4, (1.0 - fres) * 0.5);
    baseColor += inclusionCol * (0.25 + 0.45 * youngF);
    // Hot-white core where we look straight into a young facet.
    float coreLook = pow(max(NdotV, 0.0), 1.5);
    baseColor = mix(baseColor, uCoreColor, coreLook * youngF * 0.25);

    // --- Lighting: lights are FIXED in world space, so specular glints sweep across
    // the flat facets as the camera orbits (the signature faceted-gem sparkle). ---
    vec3 L1 = normalize(vec3(0.45, 0.85, 0.30));   // key (upper)
    vec3 L2 = normalize(vec3(-0.65, 0.20, -0.55)); // cool rim/fill (opposite)
    float shin = mix(160.0, 34.0, vAge);           // young = sharp sparkle, old = soft
    // NaN-safe half-vectors: when the orbiting camera faces exactly opposite a light,
    // L+V ≈ 0 and normalize() NaNs — the NaN hits the bloom blur and smears into a
    // dark disc around the apex (the intermittent "dark circle" artifact).
    vec3 H1 = L1 + V; H1 /= max(length(H1), 0.02);
    vec3 H2 = L2 + V; H2 /= max(length(H2), 0.02);
    float s1 = pow(max(dot(N, H1), 0.0), shin);
    float s2 = pow(max(dot(N, H2), 0.0), shin * 0.5);
    float spec = (s1 + s2 * 0.45) * (0.5 + 0.9 * youngF + 0.3 * setF);
    float diff = max(dot(N, L1), 0.0) * 0.6 + max(dot(N, L2), 0.0) * 0.25 + 0.2;

    // --- Faked environment reflection: cool sky above, dark ground below. The
    // reflected ray turns with the orbit, so facets carry a moving polished sheen. ---
    vec3 Rref = reflect(-V, N);
    float sky = smoothstep(-0.35, 0.85, Rref.y);
    vec3 envCol = mix(vec3(0.04, 0.05, 0.10), vec3(0.55, 0.72, 1.05), sky);
    float reflAmt = (0.12 + 0.6 * pow(fres, 2.0)) * (0.35 + 0.65 * youngF + 0.25 * setF);

    // --- Chromatic dispersion at grazing edges (R bends less than B → colored rim) ---
    vec3 disp = vec3(pow(fres, 2.4), pow(fres, 3.1), pow(fres, 4.2))
              * vec3(1.0, 0.85, 1.15) * (0.5 + 0.8 * youngF + 0.3 * setF);
    // Slow prismatic shimmer keyed to facet + height + time (always-on life).
    float pAng = vFacetId * 0.5 + fres * 2.5 + uTime * 0.20 + vWorldY * 0.05;
    vec3 prism = (0.5 + 0.5 * cos(6.2831 * (pAng + vec3(0.0, 0.33, 0.67))))
               * pow(fres, 2.0) * (youngF * 0.5 + setF * 0.3) * 0.5;

    // --- Fresnel rim — keeps both the glowing tip and the dark bedrock silhouette lit ---
    float rim = pow(fres, 2.2) * (youngF + setF * 0.5) * 0.9 + pow(fres, 3.5) * finalF;

    // --- Per-slot flash burst (a fresh produced slot) ---
    vec3 flashCol = vec3(0.0);
    float flashA = 0.0;
    if (vFlash > 0.01) {
      flashCol = mix(uYoungColor, uCoreColor, 0.6) * vFlash * 0.9;
      flashA = vFlash * 0.30;
    }

    // --- Assemble ---
    float emissive = youngF * 0.26 + setF * 0.16 + finalF * 0.05;
    float pulse = 1.0 + sin(uTime * 3.0 + vWorldY * 0.5) * 0.04 * youngF;

    // --- Crystallizing front: the newest material is still "forming" — a bright,
    // shimmering band right at the growth edge that visibly cools into solid crystal.
    float front = smoothstep(0.085, 0.0, vAge);
    float frontShimmer = noise3(vWorldPos * vec3(0.9, 1.7, 0.9) + uTime * vec3(0.25, 0.6, 0.25));
    vec3 frontCol = mix(uCoreColor, uYoungColor, 0.4) * front
                  * (0.18 + 0.38 * frontShimmer) * (1.0 + 1.0 * uTipPulse);

    vec3 col = baseColor * (diff * 0.5 + emissive) * breath * pulse;
    col += envCol * reflAmt;                                   // sweeping reflective sheen
    col += mix(vec3(0.8, 0.9, 1.05), uCoreColor, 0.4) * spec * (0.6 + 0.9 * youngF); // glints
    vec3 rimCol = mix(mix(uYoungColor, vec3(0.55, 0.72, 1.0), 0.5),
                      vec3(0.42, 0.50, 0.78), finalF * 0.6);
    col += rimCol * rim * 0.6 * breath;
    col += sssCol * (0.25 + 0.40 * clamp(youngF + setF, 0.0, 1.0)); // inner light, strongest in living zones
    col += amberCol;                                  // golden veins in the violet body
    col += phantomCol;                                // ghost terminations of past growth
    col += mix(uYoungColor, uCoreColor, 0.5) * wisp
         * (0.12 + 0.45 * youngF + 0.22 * setF) * (0.5 + 0.5 * veil); // lightning filaments
    col += vec3(0.9, 0.95, 1.1) * glitter * (0.30 + 0.60 * (youngF + setF * 0.5)); // sparkle
    col += frontCol;                                  // the forming edge

    // Caustic strike ring — when the deposition packet lands, a ring of light runs DOWN
    // the body from the apex: the block being absorbed into the record.
    float ringY = uGrowthPointY - uStrikeT * 42.0;
    float strikeRing = exp(-pow(vWorldY - ringY, 2.0) / 9.0) * exp(-uStrikeT * 2.4);
    col += mix(uCoreColor, uYoungColor, 0.45) * strikeRing * 0.8 * (0.55 + 0.45 * veil);
    col += disp * 0.5;
    col += prism;
    col += flashCol;

    // --- Alpha: young translucent & glowing, finalized opaque bedrock. Glints/rim
    // add alpha so highlights stay crisp even on the translucent tip. ---
    float baseAlpha = youngF * 0.50 + setF * 0.78 + finalF * 0.96;
    float alpha = baseAlpha * pulse + spec * 0.7 + rim * 0.3 + flashA + reflAmt * 0.15
                + sss * 0.10 + front * 0.14 + phantom * 0.10 + glitter * 0.25 + wisp * 0.05
                + strikeRing * 0.22;

    // Soft highlight compression — no view angle may flood a whole zone to white; the
    // pixel-scale glints stay far above the bloom threshold, broad areas roll off.
    float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col /= (1.0 + luma * 0.30);

    // Deep tail dissolve → a finite, elegant spire instead of an endless dark bar.
    float deepFade = 1.0 - smoothstep(uFinalityHeight * 1.4, uFinalityHeight * 2.6, distFromTop);
    alpha *= deepFade;
    col *= (0.4 + 0.6 * deepFade);

    gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
  }
`;

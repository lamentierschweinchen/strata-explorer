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

    // --- Terminating-point taper -------------------------------------------------
    // Radius ramps from a near-point at the tip up to full body over the tip zone,
    // then narrows very slightly toward the deep base (embedding into bedrock).
    float tt = clamp(distFromTop / uTipTaperHeight, 0.0, 1.0);
    float taperUp = smoothstep(0.0, 1.0, tt);
    float radiusScale = mix(uTipMinScale, 1.0, taperUp) * (1.0 - 0.05 * vAge);

    // Analytic slope d(radius)/d(worldY) of the tip ramp, used to re-tilt the flat
    // facet normal so the terminating faces (which slope inward/up) shade correctly.
    float baseR = length(position.xz);
    float dTaper = (1.0 - uTipMinScale) * 6.0 * tt * (1.0 - tt) / max(uTipTaperHeight, 0.001);
    float slope = -baseR * dTaper; // radius shrinks as worldY rises near the tip

    pos.xz *= radiusScale;
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
  uniform float uSegmentHeight;  // world height of one strata layer
  uniform float uFinalityHeight;
  uniform float uGrowthPointY;
  uniform vec3 uYoungColor;
  uniform vec3 uSettingColor;
  uniform vec3 uFinalColor;
  uniform vec3 uCoreColor;

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
    vec3 Rr = refract(-V, N, 0.66); // IOR ~1.5 (quartz)
    float incl = fbm3(vWorldPos * 0.10 + Rr * 2.0)
               + fbm3(vWorldPos * 0.10 + Rr * 6.0) * 0.6;
    incl /= 1.6;
    float inclMask = smoothstep(0.35, 0.78, incl);
    vec3 inclYoung = vec3(0.45, 0.72, 1.0);
    vec3 inclOld   = vec3(0.20, 0.16, 0.28);
    vec3 inclusionCol = mix(inclOld, inclYoung, clamp(youngF + setF * 0.4, 0.0, 1.0)) * inclMask;

    // Strata banding — each segment is one layer; thin dark seam at each boundary,
    // plus a per-segment value shift (seeded) so the layers read as sediment.
    float layer = vWorldY / max(uSegmentHeight, 0.001);
    float seam = smoothstep(0.0, 0.16, abs(sin(layer * 3.14159)));
    float strata = 0.6 + 0.4 * sin(layer * 6.2831 + vSeed * 6.2831);

    // --- Base mineral color by finality ---
    vec3 baseColor = uYoungColor * youngF + uSettingColor * setF + uFinalColor * finalF;
    baseColor *= (0.75 + 0.25 * strata);
    baseColor = mix(baseColor, baseColor * 0.5, (1.0 - seam) * (0.4 + 0.6 * finalF));
    baseColor += inclusionCol * (0.25 + 0.45 * youngF);
    // Hot-white core where we look straight into a young facet.
    float coreLook = pow(max(NdotV, 0.0), 1.5);
    baseColor = mix(baseColor, uCoreColor, coreLook * youngF * 0.25);

    // --- Lighting: lights are FIXED in world space, so specular glints sweep across
    // the flat facets as the camera orbits (the signature faceted-gem sparkle). ---
    vec3 L1 = normalize(vec3(0.45, 0.85, 0.30));   // key (upper)
    vec3 L2 = normalize(vec3(-0.65, 0.20, -0.55)); // cool rim/fill (opposite)
    float shin = mix(160.0, 34.0, vAge);           // young = sharp sparkle, old = soft
    float s1 = pow(max(dot(N, normalize(L1 + V)), 0.0), shin);
    float s2 = pow(max(dot(N, normalize(L2 + V)), 0.0), shin * 0.5);
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
    float emissive = youngF * 0.34 + setF * 0.16 + finalF * 0.05;
    float pulse = 1.0 + sin(uTime * 3.0 + vWorldY * 0.5) * 0.04 * youngF;

    vec3 col = baseColor * (diff * 0.5 + emissive) * breath * pulse;
    col += envCol * reflAmt;                                   // sweeping reflective sheen
    col += mix(vec3(0.8, 0.9, 1.05), uCoreColor, 0.4) * spec * (0.6 + 0.9 * youngF); // glints
    vec3 rimCol = mix(mix(uYoungColor, vec3(0.55, 0.72, 1.0), 0.5),
                      vec3(0.42, 0.50, 0.78), finalF * 0.6);
    col += rimCol * rim * 0.6 * breath;
    col += disp * 0.5;
    col += prism;
    col += flashCol;

    // --- Alpha: young translucent & glowing, finalized opaque bedrock. Glints/rim
    // add alpha so highlights stay crisp even on the translucent tip. ---
    float baseAlpha = youngF * 0.40 + setF * 0.70 + finalF * 0.96;
    float alpha = baseAlpha * pulse + spec * 0.7 + rim * 0.3 + flashA + reflAmt * 0.15;

    // Deep tail dissolve → a finite, elegant spire instead of an endless dark bar.
    float deepFade = 1.0 - smoothstep(uFinalityHeight * 1.4, uFinalityHeight * 2.6, distFromTop);
    alpha *= deepFade;
    col *= (0.4 + 0.6 * deepFade);

    gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
  }
`;

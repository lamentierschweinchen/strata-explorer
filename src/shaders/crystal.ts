// Crystal axis shaders — translucent growing cylinder with finality gradient,
// Fresnel rim glow, FBM surface noise, prismatic edge refraction, and flash burst.

export const crystalVertexShader = /* glsl */ `
  attribute float aSegmentAge;
  attribute float aFlash;
  attribute float aMissed;

  varying vec3 vNormal;
  varying vec3 vViewPosition;
  varying vec2 vUv;
  varying float vAge;
  varying float vFlash;
  varying float vMissed;
  varying float vWorldY;

  uniform float uScrollOffset;
  uniform float uTime;
  uniform float uGrowthPointY;
  uniform float uFinalityHeight;

  void main() {
    vNormal = normalize(normalMatrix * normal);
    vUv = uv;
    vFlash = aFlash;
    vMissed = aMissed;

    // Apply scroll offset to Y
    vec3 scrolledPos = position;
    scrolledPos.y += uScrollOffset;
    vWorldY = scrolledPos.y;

    // Compute smooth continuous age from Y position
    // Growth point is at top (age=0), finality depth below is age=1
    float distFromTop = uGrowthPointY - scrolledPos.y;
    vAge = clamp(distFromTop / uFinalityHeight, 0.0, 1.0);

    vec4 mvPosition = modelViewMatrix * vec4(scrolledPos, 1.0);
    vViewPosition = -mvPosition.xyz;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

export const crystalFragmentShader = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vViewPosition;
  varying vec2 vUv;
  varying float vAge;
  varying float vFlash;
  varying float vMissed;
  varying float vWorldY;

  uniform float uTime;

  // Simple 2D hash for noise
  float hash(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  // Value noise
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  // 3-octave FBM
  float fbm(vec2 p) {
    float v = 0.0;
    v += noise(p) * 0.5;
    v += noise(p * 2.1 + 0.5) * 0.25;
    v += noise(p * 4.3 + 1.7) * 0.125;
    return v;
  }

  void main() {
    vec3 viewDir = normalize(vViewPosition);
    float NdotV = dot(viewDir, vNormal);
    float fresnel = 1.0 - abs(NdotV);

    // Missed slot → dark gap
    if (vMissed > 0.5) {
      float dimAlpha = 0.05;
      gl_FragColor = vec4(vec3(0.05, 0.03, 0.08), dimAlpha);
      return;
    }

    // Age-driven properties
    // age 0.0 = just born (top), age 1.0 = finalized (bottom)
    float youngFactor = 1.0 - smoothstep(0.0, 0.3, vAge);     // 1.0 at top, 0.0 after 30%
    float settingFactor = smoothstep(0.2, 0.5, vAge) * (1.0 - smoothstep(0.5, 0.8, vAge)); // mid
    float finalizedFactor = smoothstep(0.6, 1.0, vAge);        // 1.0 at bottom

    // Surface noise — stronger on young segments, fading on old
    float noiseScale = 4.0 + youngFactor * 2.0;
    vec2 noiseCoord = vUv * noiseScale + vec2(uTime * 0.08, uTime * 0.05);
    float surfaceNoise = fbm(noiseCoord) * (0.3 - finalizedFactor * 0.25);

    // Core brightness: young = bright, finalized = dim
    float coreBrightness = pow(max(NdotV, 0.0), 0.8);
    float emissive = youngFactor * 0.35 + settingFactor * 0.2 + finalizedFactor * 0.04;

    // Colors — crystalline palette, not sterile white
    vec3 youngColor = vec3(0.45, 0.65, 0.95);    // vivid icy blue
    vec3 settingColor = vec3(0.35, 0.38, 0.6);   // muted blue-violet
    vec3 finalizedColor = vec3(0.08, 0.06, 0.14); // deep dark bedrock
    vec3 coreWhite = vec3(0.85, 0.9, 1.0);        // cool white, not warm

    vec3 baseColor = youngColor * youngFactor
                   + settingColor * settingFactor
                   + finalizedColor * finalizedFactor;

    // Light core tint — only a hint of white, keep crystal color
    baseColor = mix(baseColor, coreWhite, coreBrightness * youngFactor * 0.2);

    // FBM noise adds visible veins/inclusions
    float noiseHighlight = surfaceNoise * 0.4;
    vec3 veinColor = vec3(0.6, 0.75, 1.0);
    baseColor += veinColor * noiseHighlight * youngFactor;
    baseColor += vec3(0.15, 0.12, 0.2) * noiseHighlight * finalizedFactor;

    // Fresnel rim glow — colored, not just white
    float rimPower = 2.0 + finalizedFactor * 2.5;
    float rimGlow = pow(fresnel, rimPower) * (0.9 - finalizedFactor * 0.7);

    // Prismatic edge refraction — visible across more of the crystal
    vec3 prismatic = vec3(0.0);
    float prismFactor = youngFactor + settingFactor * 0.4;
    if (prismFactor > 0.05) {
      float prismAngle = fresnel * 3.0 + vUv.y * 2.0 + uTime * 0.15;
      vec3 rainbow = 0.5 + 0.5 * cos(6.2831 * (prismAngle + vec3(0.0, 0.33, 0.67)));
      prismatic = rainbow * pow(fresnel, 2.5) * prismFactor * 0.35;
    }

    // Flash burst on new segment — subtle warm glow, not blinding white
    vec3 flashColor = vec3(0.0);
    float flashAlpha = 0.0;
    if (vFlash > 0.01) {
      vec3 flashTint = mix(youngColor, coreWhite, 0.5);
      flashColor = flashTint * vFlash * 0.5;
      flashAlpha = vFlash * 0.2;
    }

    // Internal energy flow — slow moving light bands using world position
    float energyFlow = sin(vWorldY * 0.8 - uTime * 1.5) * 0.5 + 0.5;
    energyFlow *= energyFlow; // sharpen
    float flowIntensity = energyFlow * youngFactor * 0.15;

    // Subtle inner pulse on young segments
    float pulse = 1.0 + sin(uTime * 3.0 + vUv.y * 8.0) * 0.04 * youngFactor;

    // Alpha: young = translucent, finalized = opaque
    float baseAlpha = youngFactor * 0.4 + settingFactor * 0.65 + finalizedFactor * 0.92;
    float alpha = (coreBrightness * 0.4 + rimGlow * 0.25 + baseAlpha * 0.5) * pulse + flashAlpha;

    // Final color
    vec3 finalColor = baseColor * (coreBrightness * 0.5 + emissive) * pulse;
    // Rim glow uses the crystal's own color, not white
    vec3 rimColor = mix(youngColor, vec3(0.5, 0.7, 1.0), 0.5);
    finalColor += rimColor * rimGlow * 0.35;
    finalColor += prismatic;
    finalColor += flashColor;
    finalColor += youngColor * flowIntensity;

    gl_FragColor = vec4(finalColor, clamp(alpha, 0.0, 1.0));
  }
`;

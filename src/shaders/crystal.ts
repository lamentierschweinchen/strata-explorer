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

  uniform float uScrollOffset;
  uniform float uTime;

  void main() {
    vNormal = normalize(normalMatrix * normal);
    vUv = uv;
    vAge = aSegmentAge;
    vFlash = aFlash;
    vMissed = aMissed;

    // Apply scroll offset to Y
    vec3 scrolledPos = position;
    scrolledPos.y += uScrollOffset;

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
    float coreBrightness = pow(max(NdotV, 0.0), 0.6);
    float emissive = youngFactor * 0.8 + settingFactor * 0.3 + finalizedFactor * 0.05;

    // Colors
    vec3 youngColor = vec3(0.7, 0.85, 1.0);    // soft blue glow
    vec3 settingColor = vec3(0.5, 0.55, 0.7);   // dimming blue-grey
    vec3 finalizedColor = vec3(0.12, 0.1, 0.18); // dark bedrock
    vec3 coreWhite = vec3(1.0, 0.98, 0.95);

    vec3 baseColor = youngColor * youngFactor
                   + settingColor * settingFactor
                   + finalizedColor * finalizedFactor;

    // Mix toward white at core
    baseColor = mix(baseColor, coreWhite, coreBrightness * youngFactor * 0.5);
    baseColor += surfaceNoise * 0.15;

    // Fresnel rim glow — stronger on young segments
    float rimPower = 2.5 + finalizedFactor * 2.0; // sharper rim on old segments
    float rimGlow = pow(fresnel, rimPower) * (0.8 - finalizedFactor * 0.6);

    // Prismatic edge refraction on young segments
    vec3 prismatic = vec3(0.0);
    if (youngFactor > 0.1) {
      vec3 rainbow = 0.5 + 0.5 * cos(6.2831 * (fresnel * 2.0 + vec3(0.0, 0.33, 0.67)));
      prismatic = rainbow * pow(fresnel, 3.0) * youngFactor * 0.3;
    }

    // Flash burst on new segment
    vec3 flashColor = vec3(0.0);
    float flashAlpha = 0.0;
    if (vFlash > 0.01) {
      flashColor = coreWhite * vFlash * 2.0;
      flashAlpha = vFlash * 0.5;
    }

    // Subtle inner pulse on young segments
    float pulse = 1.0 + sin(uTime * 4.0 + vUv.y * 10.0) * 0.05 * youngFactor;

    // Alpha: young = translucent, finalized = opaque
    float baseAlpha = youngFactor * 0.35 + settingFactor * 0.6 + finalizedFactor * 0.9;
    float alpha = (coreBrightness * 0.5 + rimGlow * 0.3 + baseAlpha * 0.5) * pulse + flashAlpha;

    // Final color
    vec3 finalColor = baseColor * (coreBrightness * 0.6 + emissive) * pulse;
    finalColor += youngColor * rimGlow * 0.4;
    finalColor += prismatic;
    finalColor += flashColor;

    gl_FragColor = vec4(finalColor, clamp(alpha, 0.0, 1.0));
  }
`;

// Transaction particle shaders — soft glowing point sprites
// Color-coded by type, brightness by value, size decreases with age

export const particleVertexShader = /* glsl */ `
  attribute float aSize;
  attribute float aBrightness;
  attribute vec3 aColor;
  attribute float aLife; // 1.0 = fresh, 0.0 = dead

  varying vec3 vColor;
  varying float vBrightness;
  varying float vLife;

  void main() {
    vColor = aColor;
    vLife = aLife;

    // Brightness fades with life, but stays strong for most of the journey
    vBrightness = aBrightness * smoothstep(0.0, 0.15, aLife);

    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    float perspectiveScale = 300.0 / (-mvPosition.z);

    // Size decreases slightly as particle ages
    float lifeSizeFactor = 0.6 + 0.4 * aLife;
    float finalSize = aSize * perspectiveScale * lifeSizeFactor;

    gl_PointSize = clamp(finalSize, 0.5, 40.0);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

export const particleFragmentShader = /* glsl */ `
  varying vec3 vColor;
  varying float vBrightness;
  varying float vLife;

  void main() {
    vec2 center = gl_PointCoord - 0.5;
    float dist = length(center);

    if (dist > 0.5) discard;

    // Soft glow: tight core + wider halo
    float core = exp(-dist * dist / 0.008);
    float glow = exp(-dist * dist / 0.04);

    float alpha = core + glow * 0.4;

    // Color: white-hot core fading to particle color
    vec3 hotWhite = vec3(1.0, 0.98, 0.95);
    vec3 coreColor = mix(vColor, hotWhite, 0.7);
    vec3 glowColor = vColor;

    vec3 finalColor = coreColor * core + glowColor * glow * 0.4;
    finalColor /= max(alpha, 0.001);
    finalColor *= vBrightness;

    gl_FragColor = vec4(finalColor, alpha * vBrightness);
  }
`;

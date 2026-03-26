// Background dust particle shaders — tiny dim drifting points

export const dustVertexShader = /* glsl */ `
  attribute float aSize;
  attribute float aBrightness;

  varying float vBrightness;

  uniform float uTime;

  void main() {
    vBrightness = aBrightness;

    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    float perspectiveScale = 200.0 / (-mvPosition.z);
    gl_PointSize = clamp(aSize * perspectiveScale, 0.3, 4.0);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

export const dustFragmentShader = /* glsl */ `
  varying float vBrightness;

  void main() {
    vec2 center = gl_PointCoord - 0.5;
    float dist = length(center);
    if (dist > 0.5) discard;

    float alpha = exp(-dist * dist / 0.06) * vBrightness;
    vec3 color = vec3(0.4, 0.35, 0.5) * vBrightness;

    gl_FragColor = vec4(color, alpha);
  }
`;

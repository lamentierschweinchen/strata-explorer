export const CONFIG = {
  // Validator cloud
  VALIDATOR_COUNT: 3248,
  CLOUD_INNER_RADIUS: 80,
  CLOUD_OUTER_RADIUS: 150,
  CLOUD_HEIGHT: 100, // ±50

  // Crystal axis — a faceted quartz prism that grows upward and crystallizes downward
  MAX_SEGMENTS: 200,
  SEGMENT_HEIGHT: 1.5,
  CRYSTAL_RADIUS: 24, // body radius — bumped from 16 so it commands the frame at orbit ~180
  CRYSTAL_FACETS: 6, // hexagonal quartz cross-section (flat, hard-edged vertical facets)
  CRYSTAL_IRREGULARITY: 0.22, // ±jitter on facet angle/radius → natural growth, not machined
  CRYSTAL_TIP_TAPER: 12, // segments over which the growing tip tapers to a faceted point
  CRYSTAL_TIP_MIN_SCALE: 0.05, // radius scale at the very tip (≈ terminating point)
  CRYSTAL_APEX_OFFSET: [5.0, -3.5] as [number, number], // XZ apex offset — natural quartz terminations are off-center
  FINALITY_DEPTH: 30, // segments behind current that are "crystallizing"

  // Timing
  SLOT_INTERVAL: 400, // ms
  LEADER_SLOTS: 4, // consecutive slots per leader

  // Seismic waves
  MAX_WAVES: 4,
  WAVE_SPEED: 120, // units per second
  WAVE_LIFETIME: 1.5, // seconds
  WAVE_RING_WIDTH: 4.0,

  // Transaction particles
  MAX_PARTICLES: 800,
  PARTICLE_SPAWN_RADIUS: 160,
  PARTICLE_LIFETIME: 1.2, // seconds

  // Camera
  CAMERA_FOV: 60,
  CAMERA_NEAR: 0.1,
  CAMERA_FAR: 2000, // raised from 1000 so the far star-shell renders even when zoomed out
  ORBIT_RADIUS: 180,
  ZOOM_MIN: 30,
  ZOOM_MAX: 400,
  AUTO_ORBIT_DELAY: 15, // seconds of inactivity
  AUTO_ORBIT_SPEED: 0.03, // radians per second

  // Background dust (near drifting motes)
  DUST_COUNT: 700,
  DUST_SPREAD: 300,

  // Far star-shell backdrop (depth) — tens of thousands of distant twinkling points
  STAR_COUNT: 30000,
  STAR_SHELL_INNER: 480,
  STAR_SHELL_OUTER: 820,

  // Post-processing — bloom tuned so genuine highlights bloom but the bright faceted crystal
  // body does NOT flood to white. The raised threshold lets the facets, dispersion, strata and
  // finality color read; only specular glints / the tip flash / star cores cross it and bloom.
  BLOOM_STRENGTH: 0.6,
  BLOOM_RADIUS: 0.45,
  BLOOM_THRESHOLD: 0.72,

  // Validator-cloud breathing (per-particle, phase-offset in shader)
  BREATH_PERIOD: 8, // seconds (base period; each mineral is phase-offset)
  BREATH_AMPLITUDE: 1.5, // units

  // Crystal growth-tip light + flare (the per-slot hero pulse)
  TIP_LIGHT_DISTANCE: 240, // PointLight reach
  TIP_LIGHT_BASE: 0.55, // idle intensity
  TIP_LIGHT_PULSE: 2.4, // added intensity on a fresh slot, decays
  TIP_GLOW_SIGMA: 72, // radius (units) of the cloud illumination falloff from the tip
  CRYSTAL_BREATH_SCALE: 0.018, // ±1.8% idle radius breathing

  // Background color
  BG_COLOR: 0x05040a,
} as const;

export const CONFIG = {
  // Validator cloud
  VALIDATOR_COUNT: 3248,
  CLOUD_INNER_RADIUS: 80,
  CLOUD_OUTER_RADIUS: 150,
  CLOUD_HEIGHT: 100, // ±50

  // Crystal axis
  MAX_SEGMENTS: 200,
  SEGMENT_HEIGHT: 0.8,
  CRYSTAL_RADIUS: 6,
  CRYSTAL_SUBDIVISIONS: 32,
  FINALITY_DEPTH: 30, // segments behind current that are "crystallizing"

  // Timing
  SLOT_INTERVAL: 400, // ms
  LEADER_SLOTS: 4, // consecutive slots per leader

  // Seismic waves
  MAX_WAVES: 4,
  WAVE_SPEED: 200, // units per second
  WAVE_LIFETIME: 0.8, // seconds
  WAVE_RING_WIDTH: 4.0,

  // Transaction particles
  MAX_PARTICLES: 800,
  PARTICLE_SPAWN_RADIUS: 160,
  PARTICLE_LIFETIME: 1.2, // seconds

  // Camera
  CAMERA_FOV: 60,
  CAMERA_NEAR: 0.1,
  CAMERA_FAR: 1000,
  ORBIT_RADIUS: 180,
  ZOOM_MIN: 30,
  ZOOM_MAX: 400,
  AUTO_ORBIT_DELAY: 15, // seconds of inactivity
  AUTO_ORBIT_SPEED: 0.03, // radians per second

  // Background
  DUST_COUNT: 500,
  DUST_SPREAD: 300,

  // Post-processing
  BLOOM_STRENGTH: 0.8,
  BLOOM_RADIUS: 0.4,
  BLOOM_THRESHOLD: 0.3,

  // Breathing
  BREATH_PERIOD: 8, // seconds
  BREATH_AMPLITUDE: 1.5, // units

  // Background color
  BG_COLOR: 0x05040a,
} as const;

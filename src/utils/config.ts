export const CONFIG = {
  // Validator cloud
  VALIDATOR_COUNT: 3248,
  CLOUD_INNER_RADIUS: 80,
  CLOUD_OUTER_RADIUS: 150,
  CLOUD_HEIGHT: 100, // ±50

  // Crystalline comet — a tumbling crystal-cluster NUCLEUS (the growth front, where
  // new slots condense) trailing a curved stream of shards (the ledger: one shard per
  // slot, gliding away from the nucleus and settling into dark finality). This block
  // replaces the old quartz-column constants.
  MAX_SEGMENTS: 200,
  FINALITY_DEPTH: 30, // slots behind the head that are "crystallizing" (≈ Solana rooting depth)
  COMET_NUCLEUS_Y: 24, // world Y where the nucleus is suspended (the fixed growth point)
  COMET_TAIL_SPACING: 1.4, // arc-length the stream glides per slot — the living zone must CLEAR the coma
  COMET_TAIL_START: 10, // arc-length behind nucleus center where the shard stream begins
  COMET_FADE_S: 116, // arc-length where the settled tail dissolves into space (~74 slots of history)
  COMET_GLIDE_RATE: 9, // easing rate (1/s) of the per-slot tail step — felt as a glide, not a snap
  COMET_WAVE_SPEED: 30, // accretion pulse speed cascading down the tail (units/s)
  COMET_SWAY_YAW: 0.021, // rad/s — the whole comet slowly turns like a hanging mobile
  COMET_TUMBLE_SPEED: 0.07, // rad/s — nucleus self-rotation (facet glints sweep at idle)
  NUCLEUS_GEM_RADIUS: 9.5, // central heart-gem radius (cluster points reach ~2.2×)
  NUCLEUS_POINT_COUNT: 7, // crystal points jutting from the heart gem — few, long, varied
  SHARD_SIDES: 6, // hexagonal cross-section of each tail shard (bipyramid)

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

  // Nucleus light + coma (the per-slot accretion bloom; names kept from the tip era)
  TIP_LIGHT_DISTANCE: 240, // PointLight reach
  TIP_LIGHT_BASE: 0.55, // idle intensity
  TIP_LIGHT_PULSE: 2.4, // added intensity on each accretion strike, decays
  TIP_GLOW_SIGMA: 72, // radius (units) of the cloud illumination falloff from the nucleus

  // Epoch-rollover ceremony (a real, rare event — every ~2 days the leader schedule
  // turns over): grand golden waves + a bloom swell + the HUD epoch glowing.
  EPOCH_WAVE_COUNT: 3,
  EPOCH_WAVE_STAGGER: 0.8, // seconds between ceremony waves
  EPOCH_WAVE_LIFETIME: 4.0, // each grand wave rolls much longer than a slot wave
  EPOCH_BLOOM_BOOST: 0.16, // added bloom strength at ceremony peak, decays over ~4s

  // Background color
  BG_COLOR: 0x05040a,
} as const;

export const CONFIG = {
  // Validator cloud
  VALIDATOR_COUNT: 3248,
  CLOUD_INNER_RADIUS: 80,
  CLOUD_OUTER_RADIUS: 150,
  CLOUD_HEIGHT: 100, // ±50

  // Crystalline cluster — a growing AGGREGATE suspended in space (see REFERENCES.md):
  // each leader (4 slots) raises one radiating spray of terminated prisms in its own
  // Solana-hue family; each slot nucleates one crystal + a scatter of druzy micro-
  // crystals at the head of a curved spine. Young growth is saturated transmissive
  // gem; at finality it crosses a burning amber ember band and settles into the dark
  // botryoidal matrix stem — the geode shell the cluster grows from, trailing through
  // space. This block replaces the comet constants (same spine/heartbeat machinery).
  MAX_SEGMENTS: 200,
  FINALITY_DEPTH: 30, // slots behind the head that are "crystallizing" (≈ Solana rooting depth)
  CLUSTER_HEAD_Y: 32, // world Y of the growth front; the compact mass hangs ~16u below it (camera eases onto getFramingAnchors().brightCentroid, which tracks the dense centre)
  CLUSTER_SPACING: 0.72, // arc-length the reef glides per slot — tight so the whole record packs into the short curl with heavy overlap (a mass, not beads on a string)
  CLUSTER_START_S: 1.6, // arc-length behind the head where the newest crystal roots
  CLUSTER_FADE_S: 46, // arc-length where the settled matrix dissolves into space — short: the record is a rounded boulder, not a long descending thread
  CLUSTER_GLIDE_RATE: 9, // easing rate (1/s) of the per-slot step — felt as a glide, not a snap
  CLUSTER_WAVE_SPEED: 30, // nucleation pulse speed cascading down the reef (units/s)
  CLUSTER_SWAY_YAW: 0.019, // rad/s — the whole cluster slowly turns like a hanging mobile
  CLUSTER_DRUZY_PER_SLOT: 24, // micro-crystals deposited around each slot's crystal — a packed druzy field filling the inter-crystal gaps so the crust reads continuous
  CLUSTER_GEM_IOR: 1.78, // refraction strength of young gem material
  CLUSTER_GEM_DISPERSION: 7.0, // chromatic fire (per-channel ior spread in the refraction)
  CLUSTER_GEM_THICKNESS: 3.2, // volume thickness (local units, × instance scale)
  CLUSTER_ATT_DISTANCE: 7.5, // attenuation distance — color-from-within depth
  CLUSTER_LIGHT_INTENSITY: 95, // physical candela of the head PointLight (decay 2 — newborns sit 1-3u away; keep them out of ACES white)
  CLUSTER_EMBER_INTENSITY: 160, // candela of the amber finality-band light (sits INSIDE the shell — it backlights the matrix through its crevices)
  CLUSTER_EMBER_WIDTH: 5.0, // arc-length sigma of the ember band — a TIGHT girdle (re-fit to the short ~44u visible arc) so amber doesn't wash the whole body; jewel above it, dark matrix below

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

  // Camera — the idle frame is SHOT ONE of a future mouse-less presentation mode:
  // keep every framing quantity parameterized here (no hardcoded orbits). The
  // CameraController currently consumes ORBIT_RADIUS/ZOOM_*/AUTO_ORBIT_*; it still
  // hardcodes its target (0,15,0) and orbit height 45±15 — CAMERA_TARGET_Y /
  // ORBIT_HEIGHT_Y / ORBIT_HEIGHT_DRIFT below are the intended sources of truth
  // (wiring hook requested). CrystalAxis.getFramingAnchors() exposes live world
  // anchors (head / ember band / bright centroid / tail fade) for scripted shots.
  CAMERA_FOV: 52, // longer lens — compressed, specimen-photo perspective
  CAMERA_NEAR: 0.1,
  CAMERA_FAR: 2000, // raised from 1000 so the far star-shell renders even when zoomed out
  ORBIT_RADIUS: 118, // idle orbit distance — holds the reef large in frame
  CAMERA_TARGET_Y: 15, // idle look-at height (matches controller's current hardcoded target)
  ORBIT_HEIGHT_Y: 45, // idle orbit height (matches controller's current hardcoded value)
  ORBIT_HEIGHT_DRIFT: 15, // idle vertical oscillation amplitude
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

  // Depth of field (BokehPass) — the reference geode's photographic shallow focus.
  // blur = clamp(|focusDist - fragDist| × aperture, 0, maxblur); gentle by design.
  // (Points don't write depth, so the validator cloud inherits background depth and
  // sits at maxblur — keep maxblur soft so the cloud stays readable.)
  DOF_APERTURE: 0.00008,
  DOF_MAXBLUR: 0.005,

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

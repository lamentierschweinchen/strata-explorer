# THE GRAND LEGEND

*Every light and every sound in STRATA, explained twice: first in plain words, then the
machinery beneath. Not wired into the experience; this is the canonical reference for
plaques, docents, articles, FAQs, and the curious. House voice: plain, warm, no jargon in
the plain halves, no em dashes.*

**The one rule of the piece:** if you can see it or hear it, it happened. Every light maps
to a real machine, every motion to a real event, every note to a real transaction. The few
purely atmospheric elements (the stars, the dust) carry no data and are listed as such.

**The two clocks:** the fast one is the slot, one beat every ~0.4 seconds, the network
agreeing on what just happened. The slow one is the epoch, about two days, the network's
calendar page. Everything in the piece hangs on one of these two clocks.

---

## I · THE VISUALS

### The crystal
**Plain:** the growing jewel at the center is the blockchain itself. Each crystal is one
block. New ones glow as they form; older ones sink toward the rock and harden. Nothing is
ever removed and nothing ever changes once it has set.
**Beneath:** every produced slot calls `addSegment(missed, slot, leaderIndex)` and grows one
gem instance, tagged with its real slot number and leader. Crystals are physically based
glass (transmission, refraction, dispersion); the starfield genuinely bends through them.
The visible record holds the last 200 slots in a ring buffer; the piece is a living window,
not an archive.

### The rock
**Plain:** the dark stone the crystals grow from is the settled past. Crystal becomes rock
the way memory becomes history.
**Beneath:** the host shell and every crystal rooted in it sample one shared noise field, so
bases sit exactly on the rock surface and grow outward along its local normal: one mineral
specimen, not two objects. An inner cavity wall gives the shell real thickness. The rock is
deliberately cool and dark; the lighting response is re-tinted toward graphite so the warm
lights inside never wash it tan.

### The flaws
**Plain:** sometimes a beat is missing: a small dark pocket of cinders where a crystal
should be. The network skipped that moment, so the crystal records the gap.
**Beneath:** a slot whose leader produces no block is a real Solana event (skip rate is
typically well under 1%). A missed slot grows no gem; it deposits sparse stunted druzy
instead, and its hover card reads "A skipped beat."

### The zones (young to finalized)
**Plain:** a crystal's place tells its age. At the bright head it is forming now. A little
further along it is crystallizing. Past the burning amber band it is finalized: forever.
**Beneath:** Solana finality (rooting) trails the tip by ~31 slots, about 12 seconds. The
amber ember band sits at exactly that depth along the spine; the shader ages each crystal
from saturated gem to dark matrix as it crosses. The ring cards collapse this into three
honest words: Forming now, Crystallizing, Finalized forever.

### The validators
**Plain:** every point of light is a real computer, somewhere on Earth, helping keep the
network honest. The more it has committed, the larger it burns.
**Beneath:** the full vote-account set from mainnet (typically 700 to 1,000 machines),
positions stable per identity (seeded from the pubkey), size mapped to stake, warm hue
family with a small per-validator jitter. The cloud breathes; validators that voted in the
last slots shimmer. Data refreshes every 10 seconds via `getVoteAccounts`.

### The flare and the thread
**Plain:** every fraction of a second one validator is chosen to write the next block. It
flares, and a thread of light carries its block to the crystal. When the packet lands, the
crystal takes the moment in.
**Beneath:** the real leader schedule (`getLeaderSchedule`) joined to the validator set; one
leader holds four consecutive slots. Each produced slot fires a light packet down the beam;
its arrival (not a timer) triggers the nucleation strike, the tip bloom, and the ripple.

### The drifting color
**Plain:** the colored motes are transactions, this second. Gold is money moving. Cyan is a
trade. Purple is an NFT. Green is someone staking.
**Beneath:** typed transactions stream from program-filtered subscriptions (Raydium, Magic
Eden, the Stake program); the global gold lane is a light poll of the System program's
recent signatures, a representative sample of the whole network. A pacing layer releases
them evenly so the flow breathes. Ambient density particles are added to match real TPS in
aggregate; they are visual texture only and are barred, twice, from the feed and the sound.

### The ripples
**Plain:** each ripple is a new block reaching every validator in the network.
**Beneath:** the wave spawns on packet arrival and rolls through the validator cloud,
lighting machines as it passes: block propagation made visible.

### The epoch ring
**Plain:** the luminous ring under the crystal is the slow clock. It fills over about two
days; the bright head is now. When it closes its loop, an era ends.
**Beneath:** progress is `slotIndex / slotsInEpoch` from `getEpochInfo`, eased; the comet
head is the only part bright enough to bloom. An epoch is 432,000 slots: the validator
schedule's term.

### The ceremony
**Plain:** when an epoch ends, the piece celebrates: three grand golden waves, a swell of
light, the epoch number igniting. It happens about every two days, and only when it really
happens.
**Beneath:** fires on a real rollover from the chain (rehearsable via `?ceremony`); it also
triggers the musical sunrise (below). The two-day cadence means most gallery days see the
ring mid-fill, which is the point: deep time, mostly unfinished.

### The sky
**Plain:** the stars and the faint dust are the room the network lives in. They mean
nothing. Everything else means something.
**Beneath:** a 30,000-point far shell and 700 near motes, explicitly non-data set dressing,
declared so the honesty rule stays clean.

### The numbers
**Plain:** the corners are real and live: the slot counting upward, the epoch, how many
validators are on, and the lifetime count of everything the network has ever processed,
in the hundreds of billions. The bar at the bottom is this second's activity.
**Beneath:** slot/epoch from the heartbeat; validators from the vote set; TRANSACTIONS from
`getTransactionCount` polled every 10 seconds (the ledger's lifetime total); the bottom bar
is real TPS from performance samples.

### The feed, the cards, the buttons
**Plain:** the "i" reveals the live transaction feed; every row links to the real
transaction on a public explorer. Hovering a crystal reads it like a tree ring: which
moment, who wrote it, how settled. Hovering a light shows the validator's name and what it
has committed. The bottom buttons: a legend, a share, a speaker, a mixer.
**Beneath:** feed rows carry real signatures (synthetic density can never enter); ring
cards read per-slot metadata recorded at growth time; validator cards compute "last agreed"
from vote distance. The default view hides the feed so the artwork leads.

### The cinema
**Plain:** on the gallery screen the piece runs itself: a slow camera that knows where to
look, with captions that name what you are seeing.
**Beneath:** presentation mode (`?present`, or the `p` key; ESC exits) flies a six-shot
cycle over live anchors on the crystal (head, bright core, ember band, tail), every move
and hold quantized to the leader bar (1.585 s) so even the camera breathes in time.
Interactive chrome fades; the four corner numbers stay, because the plaque points at them.

---

## II · THE MUSIC

*One event bus, two senses: the sound engine subscribes to the same events that grow the
crystal. When a block lands you see it and hear it in the same instant.*

### The grid and the key
**Plain:** the piece is in E, and nobody chose E. One block every 396 milliseconds is a
rhythm; rhythms, sped up, become pitches; this one, raised five octaves, is an E. The
blockchain hums it. The instruments are tuned to the chain.
**Beneath:** 1 / 0.3962 s = 2.524 Hz; five octaves up is 80.8 Hz, within a quarter tone of
E2 (82.4 Hz). At the 400 ms spec the chain would sit between D# and E; the live network
runs slightly hot, which commits it to E. The transport runs at 151 BPM (the measured slot
rate), one slot per beat, one leader per 4/4 bar; a config flag can detune 34 cents to the
chain's exact pitch.

### The kick and the exhale
**Plain:** the heartbeat you hear is the heartbeat you see: one soft kick per block, about
two and a half per second. The off-beat tick after it is the same block's exhale, and it
fades in as the network gets busy.
**Beneath:** both voices fire from the single `onSlot` event, quantized to the grid. The
hat's presence follows TPS energy.

### The melody
**Plain:** the tune is written by the transactions themselves, one note each: transfers
step upward, trades step down, NFTs leap, and staking pulls the line home like a bassline.
Bigger transactions play louder.
**Beneath:** each real transaction (the same paced stream the particles use) becomes one
note in the key, direction by type, velocity from a log-compressed magnitude. Synthetic
density never sounds: the melody is real events only, sampled when they crowd.

### The chords, the spotlight, the giants
**Plain:** every four beats a new validator leads, and the harmony changes with it. The
sound sits where the leader stands: when the flare is to the left of the crystal, so is the
chord. And when one of the giants leads, the ground sits an octave deeper for its bar.
**Beneath:** `onLeaderChange` moves the progression; melody voices pan toward the leader's
x position in the cloud (the same point the visual beam targets), gliding each bar; a
leader staking at whale scale (≥ 15M SOL) adds a sub-octave root for its bar.

### The swell
**Plain:** every twelve seconds or so the chain locks its recent past forever, and the
music resolves with it: a slow exhale on the home chord.
**Beneath:** finality on the live chain is a continuous march (the root advances almost
every slot), so the swell samples it at the felt cadence, at most one resolution per ~10
seconds: the same sampling honesty as the melody.

### The air
**Plain:** the bright hiss riding over everything is the network's activity as texture:
busier chain, brighter air.
**Beneath:** real TPS modulates a filtered noise bed continuously. Density is the one thing
allowed to be continuous rather than per-event, and it is texture only, never a note.

### The stumble, the surge, the gong
**Plain:** rare things sound rare. If the network trips and misses several beats in a row,
the floor drops out for a bar. If activity spikes hard, the music surges with it. And a
whale, one enormous transaction, lands as a single deep gong with the room ringing.
**Beneath:** three detectors on real behavior: a missed-slot window (the stumble), TPS
crossing a multiple of its own trailing average (the surge), a single transaction above a
magnitude threshold (the gong, on the key root, with a cooldown so it stays rare).

### The sections
**Plain:** every half minute or so the music re-reads the network and decides how to play
it: building when the chain heats up, stripping back to dub when it cools, and now and
then pulling the kick away just to drop it again.
**Beneath:** the arranger turns sections on an 8-bar phrase clock (the clock is musical
convention; the choice is the chain's), steering GROOVE / DUB / LIFT / BREAK from per-section
stats: slots, misses, TPS trend, whales.

### The sunrise and the seasons
**Plain:** when an epoch ends, the music builds, daylight opens in the harmony, and the
whole piece steps into a new key, a fifth higher. Twelve epochs, about twenty-four days,
tours all twelve keys and comes home. The blockchain has seasons.
**Beneath:** the rollover event (the same one that fires the golden waves) triggers the
sunrise macro: filter opens, riser climbs, the scale lifts to major at the peak, then the
blinds close into the new key, stepped a perfect fifth from wherever the music currently
stands, so a hand-chosen key re-anchors the calendar.

### The millionth layer
**Plain:** once every few days the slot counter crosses another million, and a single grand
bell marks it, at the same instant the number rolls over on screen.
**Beneath:** era-anchored at first sight so it can never fire at boot; the bell is the deep
gong under a bright tonic swell, about every 4.6 days at current slot times.

### The mix and the booth
**Plain:** what you hear by default is the artist's mix. The mixer button opens the booth:
fourteen channels of live network, yours to ride. Mix links are shareable.
**Beneath:** the signed default (`defaultMix.ts`) is applied the moment the audio graph is
born, on every entry: the speaker, the mixer button, the booth, the standalone studio at
/studio (which drives the engine with the live chain through the same pacing layer). The
shipped sound is a preset, not a recording; nothing is looped, so nothing can repeat.

---

## III · THE MACHINERY, BRIEFLY

**Data:** Solana mainnet via WebSocket and RPC: slot heartbeat (subscription with HTTP
fallback), finality root, the vote-account set, the leader schedule, epoch info, lifetime
transaction count, performance samples, program-filtered transaction streams, and a System
program signature sample for the global lane. A pacing engine smooths bursts; every buffer
is capped; on total network failure the piece degrades to a synthetic "recent memory" and
says so on the loading line.

**Rendering:** Three.js, physically based transmission glass for the gems, one shared noise
field for rock and roots, instanced geometry throughout, bloom held to a strict threshold
so only true highlights glow, depth of field that focuses on whatever the camera is looking
at. Two URL valves (`?dpr`, `?stars`) cap cost on weak machines.

**Sound:** Tone.js on a 151 BPM transport derived from the measured slot time; every voice
is fired by a chain event through one shared tap; quantization nudges events onto the grid
(the chain is already nearly on it); a watchdog resumes the audio context if the OS ever
suspends it during a long installation.

**Modes:** interactive (mouse, hover, the booth) and presentation (`?present` / `p`;
ESC always brings you home). The same piece, the same data, the same honesty rule.

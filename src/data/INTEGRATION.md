# Data lane → Wiring integration

This documents the **Data lane** deliverables for the WIRING lane to wire into the render loop
and scene. Data owns `src/data/*` and may extend `src/data/DataSource.ts` additively only.
Nothing here edits `src/scene/`, `src/main.ts`, or `src/interaction/` — that's Wiring's job.

TL;DR for Wiring: construct a `SimulationEngine`, point its two sink callbacks at the scene
(one → feed + particle, one → particle ONLY), hand `engine.intercept(sceneCallbacks)` to
`dataSource.start(...)`, and call `engine.update(dt)` once per frame.

---

## 1. What changed in the data layer

### `DataSource.ts` — additive `TransactionInfo` enrichment (all optional)

```ts
interface TransactionInfo {
  signature: string;
  type: 'transfer' | 'defi' | 'nft' | 'stake';
  value: number;          // visual sizing only — NEVER displayed as an amount
  detail?: string;        // feed display override (live = truncated real signature)
  protocol?: string;      // NEW — real protocol name: "Raydium" | "Magic Eden" | "Stake Program"
  slot?: number;          // NEW — real landing slot (logsNotification context.slot)
  synthetic?: boolean;    // NEW — visual-only filler particle; MUST NOT enter the feed
}
```

- **`protocol`** and **`slot`** are **real on-chain facts** — safe to display. `protocol` is
  derived from which watched program's `logsSubscribe` stream fired; `slot` is the RPC-reported
  landing slot. Use them for richer feed rows and explorer deep-links, e.g.
  `Raydium · slot 281,234,567` linking to `https://solscan.io/tx/<signature>`.
- **`value`** is now derived (live) from **real log volume** (≈ tx complexity), so particle size
  reflects genuine on-chain weight. It is still **not an amount** and must not be shown as one.
  No `$`/SOL/USDC amounts are produced anywhere in the data layer (visual honesty).
- **`synthetic`** marks density-fill particles (see below). Real transactions never set it.

`SolanaCallbacks` and the rest of the `SolanaDataSource` contract are **unchanged** — the engine
is wired on top, not into, the data-source contract.

### `LiveData.ts`

- **Global transfer lane:** a ~1.5 s poll of `getSignaturesForAddress(System, { limit: 25 })`
  samples the whole network (nearly every tx touches the System program — measured light at
  ~5.4 KB / 140 ms). Successful sigs (`err === null`; roughly half are failed bot-spam and are
  dropped) become real `type: 'transfer'` rows: real signature in `detail`, real `slot`, a small
  visual-only `value`, no `protocol`. It runs over HTTP **independently of the WebSocket**, so the
  feed keeps flowing even if the precise streams pause. The existing per-program `logsSubscribe`
  streams stay as precise typed accents (defi/nft/stake).
- **Cross-source dedup:** signatures are deduped across both sources via a rotating, bounded set.
  A tx already seen on a precise `logsSubscribe` stream is never re-shown as a generic transfer —
  the precise program type wins (a Raydium swap that also touches System stays `defi`, not gold).
- **Diversity selection:** real txns are bucketed per type (transfer + the three program types)
  and flushed **round-robin** (every 250 ms) so the feed alternates types instead of showing a run
  of 8 transfers. Ordering is preserved through the engine queue.
- **Enrichment:** each real tx now carries `protocol`, `slot`, and a real-log-volume `value`.
- **Resilience:** `rpc()` retries network errors / HTTP 429 / 5xx with exponential backoff
  (honoring `Retry-After`); the WebSocket reconnects with exponential backoff before settling
  into HTTP slot-polling. No behavior change to the public interface.

### `MockData.ts`

- Emits `protocol` + `slot` too, so you can develop the feed UI against `?mock` and see the same
  enrichment shape. (Mock is explicitly synthetic; honesty applies to live.)

---

## 2. `SimulationEngine` — public API

`src/data/SimulationEngine.ts`. A source-agnostic pacing layer between data arrival and visual
spawning. Two jobs, both driven by `update(dt)`:

1. **Drain queue** — buffers bursty real txns and releases them evenly so the scene doesn't
   strobe; a genuinely empty queue emits nothing (no fabrication).
2. **Synthetic density fill** — spawns extra **visual-only** particles proportional to real TPS
   so the field feels as busy as the ~930 TPS headline. These never reach the feed.

```ts
import { SimulationEngine } from './data/SimulationEngine';

const engine = new SimulationEngine({
  getTps: () => dataSource.getTps?.() ?? 0,   // drives synthetic fill; 0 ⇒ no fill (e.g. mock)
  // optional tunables (defaults shown):
  // drainHorizonSec: 1.0, minDrainRate: 2, maxDrainRate: 40, maxQueue: 240,
  // densityFactor: 0.3, maxSyntheticRate: 360, maxSyntheticPerFrame: 64,
});
```

### Sinks (you set these)

| Property | Called with | Wire it to |
|---|---|---|
| `engine.onRealTransactions` | paced **real** txns (≤ once/frame) | particle spawn **+ feed** (the current `onTransactions` body) |
| `engine.onSyntheticParticles` | **visual-only** txns, `synthetic: true` (≤ once/frame) | particle spawn **ONLY** — never `infoOverlay.pushTransactions` |

> ⚠️ **Honesty contract:** `onSyntheticParticles` items carry no real signature and **must not**
> enter the human-readable feed. Only `onRealTransactions` items are displayable. The
> `synthetic: true` flag is a second line of defense if a future code path ever forwards them.

### Methods

- `enqueue(txs: TransactionInfo[])` — push real txns into the pacing buffer (the data source's
  `onTransactions`). Usually you don't call this directly — `intercept()` does.
- `update(dt: number)` — call **once per frame** from the render loop.
- `intercept(scene: SolanaCallbacks): SolanaCallbacks` — convenience wrapper. Returns callbacks
  to hand to `dataSource.start(...)`: it routes `onTransactions → enqueue` and passes
  `onSlot` / `onValidatorsUpdated` / `onRootAdvance` straight through. Also defaults
  `onRealTransactions` to `scene.onTransactions` if you haven't set it.
- `reset()` — clear buffers (call when swapping data sources, e.g. live → mock fallback).
- `pendingReal` (getter) and `getDebugState()` — introspection for `window.__strata`.

---

## 3. Wiring recipe (recommended)

The data source is currently started inside `Strata`'s constructor with closures over scene
internals (`transactionPool`, `infoOverlay`, …). Since Wiring owns final `Strata.ts`, the
cleanest integration is to let **`Strata` own the engine** (it already has the particle pool and
feed). `main.ts` needs no changes — its loop already calls `strata.update(dt)`.

Inside `Strata`:

```ts
// 1. construct
this.engine = new SimulationEngine({ getTps: () => this.dataSource.getTps?.() ?? 0 });

// 2. synthetic = particle-only (NO feed, NO TPS count)
this.engine.onSyntheticParticles = (txs) => {
  const leaderPos = this.validatorCloud.getPosition(this.dataSource.getCurrentLeaderIndex());
  const target = new THREE.Vector3(0, this.crystalAxis.getGrowthPointY(), 0);
  for (const tx of txs) this.transactionPool.spawn(tx, leaderPos, target);
};

// 3. start the data source THROUGH the engine. The sceneCallbacks.onTransactions below is your
//    EXISTING real-tx handler (spawn particle + this.infoOverlay.pushTransactions + TPS count).
//    intercept() auto-wires engine.onRealTransactions = sceneCallbacks.onTransactions.
this.dataSource.start(this.engine.intercept({
  onSlot: (slot, leader, missed) => { /* …unchanged… */ },
  onValidatorsUpdated: (v) => { /* …unchanged… */ },
  onTransactions: (txs) => {            // real, paced → feed + particle (current behavior)
    const leaderPos = this.validatorCloud.getPosition(this.dataSource.getCurrentLeaderIndex());
    const target = new THREE.Vector3(0, this.crystalAxis.getGrowthPointY(), 0);
    for (const tx of txs) this.transactionPool.spawn(tx, leaderPos, target);
    this.txCountThisSecond += txs.length;
    this.infoOverlay.pushTransactions(txs);
  },
  onRootAdvance: (root) => { /* …unchanged… */ },
}));

// 4. pump the engine once per frame — put this at the TOP of Strata.update(dt)
update(dt: number): void {
  this.engine.update(dt);
  // …existing subsystem updates…
}
```

That's the whole integration: real txns now flow `data → engine.enqueue → (paced) →
onTransactions → feed + particle`, and synthetic density flows `engine.update → onSyntheticParticles
→ particle only`.

### Notes

- **Order within the frame:** call `engine.update(dt)` before the particle pool's update so
  spawns are processed the same frame (one-frame latency is harmless if not).
- **Mock mode:** mock has no `getTps()`, so `densityFactor` × 0 ⇒ **no synthetic fill** — mock's
  own generator already fills the scene. The drain queue still gently smooths mock's bursty
  ticks, which is fine. You may also bypass the engine entirely for mock; both work.
- **Live → mock fallback** (`main.ts`): a fresh `Strata` is created, so you get a fresh engine.
  If you ever reuse an engine across sources, call `engine.reset()` first.
- **Feed TPS vs real TPS:** synthetic particles are deliberately **not** counted in
  `txCountThisSecond`, so they don't inflate the HUD. The HUD already prefers
  `dataSource.getTps()` (real) over the spawn-rate fallback.

---

## 4. Tunables (defaults in `SimulationEngine.ts`)

| Option | Default | Meaning |
|---|---|---|
| `drainHorizonSec` | `1.0` | real-tx backlog is spread over ~this many seconds |
| `minDrainRate` | `2` | floor so a tiny queue still trickles out |
| `maxDrainRate` | `40` | ceiling (> LiveData's 30/s intake cap → queue can catch up) |
| `maxQueue` | `240` | hard backlog cap; oldest dropped past this (warns) |
| `densityFactor` | `0.3` | synthetic particles/sec ≈ `TPS × this` |
| `maxSyntheticRate` | `360` | ceiling on synthetic spawn rate (guards the 800-particle pool) |
| `maxSyntheticPerFrame` | `64` | per-frame synthetic cap (guards against large `dt` spikes) |

At ~930 TPS the defaults yield ≈ 279 synthetic particles/sec (≈ 335 concurrent over the 1.2 s
lifetime) plus ≤ 30 real/sec — comfortably under `CONFIG.MAX_PARTICLES` (800).

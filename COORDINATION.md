# The Strata — Lane Coordination

This work is split into parallel **lanes**, each run as its own session + git worktree.
A **coordinator** (separate session) owns integration. If you are a lane agent, read this
first, then your task brief. **Do not merge to `main` yourself** — the coordinator does.

## Lanes

| Lane | Branch | Owns (edit only these) | Scope |
|---|---|---|---|
| **Data** | `lane/data` | `src/data/*` | Pacing engine (drain queue + synthetic density fill), tx parsing/diversity/enrichment, RPC resilience |
| **Design** | `lane/design` | `src/scene/*`, `src/shaders/*`, `src/interaction/Legend.ts`, `src/interaction/HUD.ts`, `src/utils/colors.ts`, `src/utils/config.ts` | Core flare + light, post-processing grade, starfield backdrop, point-sprite craft, anti-static motion, legend, HUD cosmetics |
| **Wiring** | `lane/wiring` | `src/interaction/InfoOverlay.ts`, `src/main.ts`, `index.html`, `src/utils/format.ts`, + final `src/scene/Strata.ts` integration | Feed explorer links + real metadata, shared formatter, OG/meta + loading copy, integrate Data + Design |
| **Copy** | — (coordinator + owner) | — | Legend text, loading strings, tooltips, OG description, metaphor header |

## Shared / contract files

- **`src/data/DataSource.ts`** — owned by **Data**. Extend **additively only** (new optional
  fields/methods) so the scene keeps compiling. Document additions in `src/data/INTEGRATION.md`.
- **`src/scene/Strata.ts`** (orchestrator) — final ownership **Wiring**. Design *may* make
  surgical, clearly-commented edits to verify its visuals, but must list them in its summary;
  the coordinator reconciles this file across lanes.
- The scene consumes data via `SolanaDataSource` + `SolanaCallbacks` (onSlot / onTransactions /
  onValidatorsUpdated / onRootAdvance). Preserve this contract.

## Integration sequence (coordinator-run)

1. **Data** + **Design** run in parallel (mostly disjoint files).
2. Coordinator merges `lane/data` → `main`, then `lane/design` → `main`, reconciling `Strata.ts`.
3. **Wiring** does its independent items (feed links, formatter, meta, loading) anytime; then
   rebases on the integrated `main` and wires in the SimulationEngine + new scene hooks.
4. Coordinator merges `lane/wiring` → `main` and deploys (`vercel --prod`).

## Gates (every lane, before "done")

- `npm run build` passes (`tsc` strict + vite). No new heavy runtime deps (only `three`) without coordinator sign-off.
- 60fps target; desktop-first, but don't break mobile.
- **Visual honesty:** every *displayed* fact maps to real data. Never fabricate values/amounts.
  Synthetic visual-density particles are fine but must never enter the human-readable feed.

## Notes

- Live data is real Solana mainnet via Helius (WS `slotSubscribe`/`rootSubscribe` + `logsSubscribe`
  on Raydium/Magic Eden/Stake; HTTP `getVoteAccounts`/`getLeaderSchedule`/`getEpochInfo`/
  `getRecentPerformanceSamples`). `.env.local` (gitignored) holds dev creds.
- **Preview caveat:** the automated browser preview backgrounds the tab and pauses
  `requestAnimationFrame`, so the render loop / feed drip / TPS freeze in headless capture.
  Verify rAF-gated behavior in a real foreground browser (`npm run dev`), not screenshots.
  A dev-only `window.__strata` handle exists in DEV builds for runtime introspection.
- Reference implementation (more polished sibling): **Galaxy of Nodes** at
  `/Users/ls/Documents/Beautiful Blockchains/Galaxy Explorer` — study its techniques.

## Parallel-run rules v2 (collision prevention)

Run 1 had lanes editing each other's files (the orchestrator and the data interface, mainly).
Root cause: shared seam files with multiple writers, contracts defined while lanes ran, an
integrator running in parallel, and weak isolation. Rules for any future parallel run:

1. **Real isolation.** Each lane runs in its own git worktree on its own branch and never
   touches the shared/main checkout. No lane syncs to main. The coordinator merges, one branch
   at a time, resolving conflicts at merge time, never live.
2. **Freeze the seams first.** Before any lane launches, the coordinator writes and commits the
   shared contracts to main: data interfaces (`DataSource.ts`), module APIs (`SimulationEngine`),
   and orchestrator extension hooks. Lanes treat these files as READ-ONLY.
3. **One writer per file.** Strict, disjoint path ownership, zero shared paths. The "may make
   surgical edits to verify" hatch is removed; it is what caused the orchestrator collisions. A
   lane that thinks it needs another lane's path STOPS and asks the coordinator.
4. **The orchestrator belongs to no lane.** `Strata.ts` is frozen with registration hooks. Lanes
   export self-contained modules (object + `update(dt)` + optional event handlers) against the
   fixed hook; the coordinator wires them at integration. Lanes never open `Strata.ts`.
5. **Integration is sequential, not a lane.** Only independent producers run in parallel (e.g.
   data, design). Combining them is a coordinator step AFTER they land, never a concurrent
   "wiring" lane reaching into files the others are still changing.
6. **The path manifest is law.** The ownership table above is the contract. A lane editing
   outside its paths is a bug; keep paths non-overlapping by construction.

## Status (coordinator updates)

- [ ] Data — `lane/data`
- [ ] Design — `lane/design`
- [ ] Wiring (independent items) — `lane/wiring`
- [ ] Integration + deploy

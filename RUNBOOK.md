# The Strata — Install Runbook (Solana Summit, Sat)

Operational guide for running the piece unattended on a single gallery screen, ~10:00–20:00 CET.

## The link

- **Production:** https://strata-explorer.vercel.app
- It's a static site on Vercel + live Solana data via Helius. Just open it in a browser.
- A page **refresh always recovers a clean state** — first thing to try if anything looks off.

## Display setup

1. **Browser:** Chrome or Edge, latest. Confirm **hardware acceleration is ON**
   (`chrome://gpu` → "Graphics Feature Status" all green). The centerpiece uses
   transmission/PBR glass — it is GPU-bound; a weak/integrated GPU will drop frames.
2. **Fullscreen:** load the URL, then `F11` (Win) / `⌃⌘F` (Mac). No browser chrome.
3. **Hide the cursor** (no mouse at the install): easiest is to physically move the mouse
   to a screen corner — the piece needs no interaction and auto-orbits on its own after
   15s. (A kiosk/`cursor:none` option can be added if wanted; ask the coordinator.)
4. **Sleep/screensaver OFF** on the machine. Disable OS auto-updates/notifications for the
   day. Plug in power (don't run on battery — GPU throttles).
5. **Test on the venue machine in advance** — GPU and pixel ratio differ from a dev Mac.
   If fps is low, the coordinator can lower `devicePixelRatio`, the starfield count, or the
   transmission resolution.

## What it does on its own (unattended-safe)

- **Auto-orbits** the centerpiece continuously; the camera frames the crystal's bright mass.
- **Live data, self-healing:** if Helius hiccups, the WebSocket reconnects with backoff; if
  that fails it falls back to HTTP slot-polling; if the network is fully unreachable it shows
  a "recent memory" (demo) of the network instead of going blank. **The screen never dies.**
- **Verified leak-free** over long runs (GPU memory, scene, and DOM all stay bounded), so a
  10-hour session is fine without restarts.

## Epoch ceremony (the rare big moment)

- A real epoch rollover (~every 2 days) triggers a golden ceremony: grand waves, a bloom
  swell, the epoch number igniting.
- **Timing (measured 2026-06-10):** a real rollover lands **~Fri ~11:12 CET** (a free
  rehearsal — have the team watch the live site) and **~Sun ~10:46 CET**. **None during the
  Saturday 10:00–20:00 window.** Re-check Friday for a sharper estimate.
- **Rehearse on demand:** `https://strata-explorer.vercel.app/?ceremony` fires the full
  ceremony once, ~5s after load. Good for showing the team or testing the venue screen.

## If something goes wrong

| Symptom | Fix |
|---|---|
| Frozen / weird state | Refresh the page (recovers clean). |
| Black screen, no crystal | Check GPU accel is on; refresh; check the machine isn't asleep. |
| Numbers stopped climbing | Network blip — it auto-recovers within seconds; if not, refresh. |
| Choppy / low fps | Not on battery? Close other apps/tabs. Coordinator can drop pixel ratio / star count. |
| Cursor visible | Park the mouse in a corner. |

## Helius / cost

- Single screen = trivial usage; no traffic concern. The read-only Helius key is baked into
  the client. If it's ever abused or rate-limited, it is rotatable in the Helius dashboard
  (then redeploy) — but for one gallery screen this won't come up.

## Still in flight (as of this writing)

- **Centerpiece form** — the crystal is being refined toward a denser, more beautiful mass;
  production updates only when the owner approves. The current production build is a complete,
  safe premiere on its own.
- **Presentation mode** (auto-narration labels + scripted camera, fully mouse-less) — planned
  as the finale; the camera anchors and label content are already built toward it.

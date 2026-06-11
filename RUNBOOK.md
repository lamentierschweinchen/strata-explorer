# The Strata — Install Runbook (Solana Summit, Sat)

Operational guide for running the piece unattended on a single gallery screen, ~10:00–20:00 CET.

## The links (pick by context)

- **Gallery / kiosk (mouse-less):** https://strata-explorer.vercel.app/?present
  Presentation mode: the camera flies a slow narrated cinematic loop on its own, with
  captions naming what's on screen. THIS is the install URL.
- **Interactive (a browser someone explores):** https://strata-explorer.vercel.app
  Mouse orbit, hover any crystal for its real slot's info, click a validator to fly in.
- It's a static site on Vercel + live Solana data via Helius. Just open it in a browser.
- A page **refresh always recovers a clean state** — first thing to try if anything looks off.
  (?present survives refresh — keep the param in the address bar.)

## Sound (the two venue contexts)

- **Shared multi-artwork screen:** leave it SILENT — do nothing; sound is off by default.
- **The dedicated room (the one-hour show):** click the **speaker icon, bottom-right, once**
  at install. That single click starts the chain's own music — kick on every block, chords on
  leader changes, swells at finality — live and in sync with the visuals (the same events
  drive both). Click again to mute. Set the MACHINE volume before the audience arrives.
- Browsers refuse audio without a click, so the one tap at install is required — there is no
  autoplay. After a page refresh, tap it again.

## Keys (no mouse needed, but good to know)

- **p** — toggle presentation mode on/off (if you opened the plain URL by mistake).
- **ESC** — exit presentation mode; or, in interactive mode, fly home to the default orbit
  (e.g. if someone clicked into a validator and walked away).

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
- **Timing (re-measured Thu night, 397.7ms/slot):** epoch 985→986 lands **Friday
  ~11:13 CEST (band 11:07–11:20)** — a free rehearsal; have the team watch the live site.
  Next is **Sunday ~10:45**, so **none during the Saturday 10:00–20:00 window**. During the
  show, the luminous ring at the crystal's base (the epoch clock) visibly advances from
  roughly 48% to 69% — that ring closing IS the countdown to a ceremony.
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

## Day-of checklist (5 minutes, in order)

1. Power + network on the machine; sleep/screensaver/notifications OFF; not on battery.
2. Chrome/Edge → `chrome://gpu` → hardware acceleration green.
3. Open **https://strata-explorer.vercel.app/?present**
4. Confirm: the slot number is climbing and the camera starts its slow narrated moves.
5. Fullscreen (`F11` / `⌃⌘F`), park the mouse in a corner.
6. **Room-hour only:** click the speaker icon once (bottom-right) → confirm sound,
   set machine volume taste-level, done.
7. Walk away. It runs itself; a refresh fixes anything.

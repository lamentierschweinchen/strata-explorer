/**
 * Audio toggle — the speaker button (bottom-right) that turns on THE CHAIN'S OWN MUSIC:
 * the Tone.js AudioEngine driven by the same live events that grow the crystal, at the
 * default studio settings. The click IS the user gesture browsers require to start audio.
 *
 * The heavy engine (the tone chunk) is NOT loaded until the first enable: main.ts attaches
 * `onFirstEnable` (dynamic import + wire the event tap + engine.start()) and `onMuteToggle`
 * (engine.setMuted — the transport keeps running, so re-unmuting stays on the chain's beat).
 */
export class AudioController {
  private button: HTMLButtonElement;
  private state: 'muted' | 'loading' | 'on' = 'muted';
  private enabled = false; // first-enable (engine import + start) completed

  /** First unmute: load + wire + start the engine (set by main.ts). May reject. */
  onFirstEnable?: () => Promise<void>;
  /** Subsequent toggles: mute/unmute the running engine (set by main.ts). */
  onMuteToggle?: (muted: boolean) => void;
  /** Mixer button: open the DJ booth over the piece (set by main.ts). */
  onOpenStudio?: () => Promise<void>;

  private mixerBtn: HTMLButtonElement;

  constructor() {
    this.button = document.createElement('button');
    this.button.style.cssText = `
      position: absolute; bottom: 28px; right: 28px;
      width: 36px; height: 36px;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 50%;
      cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      transition: background 0.2s;
      z-index: 20;
    `;
    this.button.addEventListener('mouseenter', () => {
      this.button.style.background = 'rgba(255, 255, 255, 0.1)';
    });
    this.button.addEventListener('mouseleave', () => {
      this.button.style.background = 'rgba(255, 255, 255, 0.05)';
    });
    this.button.addEventListener('click', () => void this.toggle());
    this.updateIcon();
    document.body.appendChild(this.button);

    // The mixer — a quiet sibling to the speaker: live-mix the chain in the DJ booth.
    this.mixerBtn = document.createElement('button');
    this.mixerBtn.title = 'Live-mix the chain (DJ booth)';
    this.mixerBtn.style.cssText = `
      position: absolute; bottom: 28px; right: 74px;
      width: 36px; height: 36px;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 50%;
      cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      transition: background 0.2s, opacity 1.2s ease;
      z-index: 20;
    `;
    this.mixerBtn.innerHTML = `
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.45)" stroke-width="2" stroke-linecap="round">
        <line x1="5" y1="4" x2="5" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/><line x1="19" y1="4" x2="19" y2="20"/>
        <circle cx="5" cy="9" r="2.1" fill="#0a0a14"/><circle cx="12" cy="15" r="2.1" fill="#0a0a14"/><circle cx="19" cy="7" r="2.1" fill="#0a0a14"/>
      </svg>`;
    this.mixerBtn.addEventListener('mouseenter', () => {
      this.mixerBtn.style.background = 'rgba(255, 255, 255, 0.1)';
    });
    this.mixerBtn.addEventListener('mouseleave', () => {
      this.mixerBtn.style.background = 'rgba(255, 255, 255, 0.05)';
    });
    this.mixerBtn.addEventListener('click', () => void this.onOpenStudio?.());
    document.body.appendChild(this.mixerBtn);
  }

  /** Presentation fade: the mixer is interactive chrome and bows out; the speaker stays
   *  (the gallery room needs its one tap). */
  setPresentation(presenting: boolean): void {
    this.mixerBtn.style.opacity = presenting ? '0' : '';
    this.mixerBtn.style.pointerEvents = presenting ? 'none' : '';
  }

  private async toggle(): Promise<void> {
    if (this.state === 'loading') return; // ignore re-clicks mid-start

    if (this.state === 'on') {
      this.state = 'muted';
      this.updateIcon();
      this.onMuteToggle?.(true);
      return;
    }

    // muted → on
    if (this.enabled) {
      this.state = 'on';
      this.updateIcon();
      this.onMuteToggle?.(false);
      return;
    }

    // First enable: the click is the gesture — load + start the engine inside it.
    // A machine with a broken/absent audio device can leave AudioContext.resume()
    // pending FOREVER (no rejection) — race a timeout so the button recovers
    // instead of spinning all day on a gallery kiosk.
    if (!this.onFirstEnable) return; // not wired (shouldn't happen)
    this.state = 'loading';
    this.updateIcon();
    try {
      await Promise.race([
        this.onFirstEnable(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('audio start timed out (10s) — no audio device?')), 10_000),
        ),
      ]);
      this.enabled = true;
      this.state = 'on';
    } catch (e) {
      console.warn('[audio] enable failed', e);
      this.state = 'muted';
      // If a slow start eventually resolves after the timeout, force it muted so
      // sound never appears while the button shows the muted state.
      this.onMuteToggle?.(true);
    }
    this.updateIcon();
  }

  private updateIcon(): void {
    if (this.state === 'loading') {
      this.button.title = 'Starting the sound…';
      this.button.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.6)" stroke-width="2" stroke-linecap="round">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
          <circle cx="19" cy="12" r="1.4" fill="rgba(255,255,255,0.6)" stroke="none">
            <animate attributeName="opacity" values="0.2;1;0.2" dur="1s" repeatCount="indefinite"/>
          </circle>
        </svg>`;
      return;
    }
    if (this.state === 'muted') {
      this.button.title = 'Sound on: the network playing itself, live';
      this.button.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.4)" stroke-width="2" stroke-linecap="round">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
          <line x1="23" y1="9" x2="17" y2="15"/>
          <line x1="17" y1="9" x2="23" y2="15"/>
        </svg>`;
    } else {
      this.button.title = 'Mute';
      this.button.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.6)" stroke-width="2" stroke-linecap="round">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
          <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
          <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
        </svg>`;
    }
  }

  dispose(): void {
    this.button.remove();
    this.mixerBtn.remove();
  }
}

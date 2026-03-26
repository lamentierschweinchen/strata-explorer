/**
 * Audio controller — mute/unmute toggle button.
 * Placeholder: no audio file loaded in Phase 1+2.
 */
export class AudioController {
  private button: HTMLButtonElement;
  private muted = true;

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
    this.button.addEventListener('click', () => this.toggle());
    this.updateIcon();
    document.body.appendChild(this.button);
  }

  private toggle(): void {
    this.muted = !this.muted;
    this.updateIcon();
    // Audio playback will be wired in Phase 5
  }

  private updateIcon(): void {
    // SVG speaker icon
    if (this.muted) {
      this.button.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.4)" stroke-width="2" stroke-linecap="round">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
          <line x1="23" y1="9" x2="17" y2="15"/>
          <line x1="17" y1="9" x2="23" y2="15"/>
        </svg>`;
    } else {
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
  }
}

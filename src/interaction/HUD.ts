/**
 * Minimal HUD overlay — slot/epoch, validator count, TPS.
 * HTML elements positioned absolutely within #hud container.
 */
export class HUD {
  private container: HTMLElement;
  private slotEl: HTMLElement;
  private epochEl: HTMLElement;
  private validatorEl: HTMLElement;
  private tpsEl: HTMLElement;
  private tpsBar: HTMLElement;
  private tpsBarFill: HTMLElement;
  private activityLabel: HTMLElement;

  private currentTps = 0;
  private targetTps = 0;
  private maxTps = 100;

  constructor() {
    this.container = document.getElementById('hud')!;

    // Top-left: slot + epoch
    const topLeft = this.createCorner('hud-top-left', 'top: 28px; left: 28px;');
    this.slotEl = this.createLabel(topLeft, 'SLOT', '—');
    this.epochEl = this.createLabel(topLeft, 'EPOCH', '—');

    // Top-right: validators + TPS
    const topRight = this.createCorner('hud-top-right', 'top: 28px; right: 28px; text-align: right;');
    this.validatorEl = this.createLabel(topRight, 'VALIDATORS', '—');
    this.tpsEl = this.createLabel(topRight, 'TPS', '—');

    // Bottom-center: TPS bar
    const bottomCenter = document.createElement('div');
    bottomCenter.className = 'hud-bottom-center';
    bottomCenter.style.cssText = `
      position: absolute; bottom: 28px; left: 50%; transform: translateX(-50%);
      display: flex; flex-direction: column; align-items: center; gap: 4px;
    `;
    this.container.appendChild(bottomCenter);

    this.activityLabel = document.createElement('div');
    this.activityLabel.style.cssText = `
      font-family: 'ABC Diatype Semi-Mono', 'SF Mono', monospace;
      font-size: 9px; letter-spacing: 2px; color: rgba(255,255,255,0.34);
      text-transform: uppercase;
    `;
    // Idle-state label — words, never a bare "0". update() swaps in the live TPS reading
    // once the network is active, and reverts to this wording when it goes quiet.
    this.activityLabel.textContent = 'NETWORK ACTIVITY';
    bottomCenter.appendChild(this.activityLabel);

    this.tpsBar = document.createElement('div');
    this.tpsBar.className = 'tps-bar-container';
    this.tpsBar.style.cssText = `
      width: 180px; height: 3px; background: rgba(255,255,255,0.08);
      border-radius: 2px; overflow: hidden;
    `;
    bottomCenter.appendChild(this.tpsBar);

    // Fill is full-width with an amber→blue accent gradient; we reveal it left→right via
    // clip-path so the gradient always maps to the full bar (works at any bar width / mobile).
    this.tpsBarFill = document.createElement('div');
    this.tpsBarFill.style.cssText = `
      width: 100%; height: 100%;
      background: linear-gradient(90deg, #e8b84a 0%, #e0a23f 28%, #7a96cf 72%, #4f86d6 100%);
      border-radius: 2px;
      clip-path: inset(0 100% 0 0);
      transition: clip-path 0.3s ease;
    `;
    this.tpsBar.appendChild(this.tpsBarFill);
  }

  private createCorner(className: string, style: string): HTMLElement {
    const el = document.createElement('div');
    el.className = className;
    el.style.cssText = `position: absolute; ${style} pointer-events: none;`;
    this.container.appendChild(el);
    return el;
  }

  private createLabel(parent: HTMLElement, label: string, initialValue: string): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'margin-bottom: 8px;';

    const labelEl = document.createElement('div');
    labelEl.className = 'hud-text';
    labelEl.style.cssText = `
      font-family: 'ABC Diatype Semi-Mono', 'SF Mono', monospace;
      font-size: 9px; letter-spacing: 2px; color: rgba(255,255,255,0.3);
      text-transform: uppercase; margin-bottom: 2px;
    `;
    labelEl.textContent = label;
    wrapper.appendChild(labelEl);

    const valueEl = document.createElement('div');
    valueEl.className = 'hud-value';
    valueEl.style.cssText = `
      font-family: 'ABC Diatype Semi-Mono', 'SF Mono', monospace;
      font-size: 14px; color: rgba(255,255,255,0.7);
      font-weight: 300; letter-spacing: 1px;
    `;
    valueEl.textContent = initialValue;
    wrapper.appendChild(valueEl);

    parent.appendChild(wrapper);
    return valueEl;
  }

  updateSlot(slot: number): void {
    this.slotEl.textContent = slot.toLocaleString();
  }

  updateEpoch(epoch: number): void {
    this.epochEl.textContent = epoch.toLocaleString();
  }

  /** Epoch rollover: the epoch number ignites gold, then breathes back to normal. */
  epochCeremony(): void {
    this.epochEl.style.transition = 'none';
    this.epochEl.style.color = '#ffd27a';
    this.epochEl.style.textShadow = '0 0 14px rgba(255, 200, 110, 0.85)';
    window.setTimeout(() => {
      this.epochEl.style.transition = 'color 3s ease, text-shadow 3s ease';
      this.epochEl.style.color = 'rgba(255,255,255,0.7)';
      this.epochEl.style.textShadow = 'none';
    }, 1200);
  }

  updateValidatorCount(count: number): void {
    this.validatorEl.textContent = count.toLocaleString();
  }

  updateTps(tps: number): void {
    this.targetTps = tps;
    this.maxTps = Math.max(this.maxTps, tps); // grow the activity-bar ceiling to the observed peak
    // Idle/no-data → em-dash rather than a bare "0" (real mainnet never sits at 0 TPS).
    this.tpsEl.textContent = tps >= 1 ? this.formatNumber(tps) : '—';
  }

  update(dt: number): void {
    // Smooth TPS bar animation — reveal the amber→blue gradient via clip-path
    this.currentTps += (this.targetTps - this.currentTps) * Math.min(dt * 5, 1);
    const fillPct = Math.min(this.currentTps / this.maxTps * 100, 100);
    this.tpsBarFill.style.clipPath = `inset(0 ${100 - fillPct}% 0 0)`;

    // Bottom caption doubles as a readout: live TPS when active, the words "Network
    // Activity" when the network is quiet (so the idle state never reads as "0").
    this.activityLabel.textContent =
      this.targetTps >= 1 ? `${this.formatNumber(this.targetTps)} TPS` : 'NETWORK ACTIVITY';
  }

  private formatNumber(n: number): string {
    if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1) + 'B';
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
    return Math.round(n).toString();
  }

  dispose(): void {
    // Elements are in #hud which persists — nothing to clean up
  }
}

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

    const tpsLabel = document.createElement('div');
    tpsLabel.style.cssText = `
      font-family: 'SF Mono', 'Fira Code', monospace;
      font-size: 9px; letter-spacing: 2px; color: rgba(255,255,255,0.3);
      text-transform: uppercase;
    `;
    tpsLabel.textContent = 'NETWORK ACTIVITY';
    bottomCenter.appendChild(tpsLabel);

    this.tpsBar = document.createElement('div');
    this.tpsBar.className = 'tps-bar-container';
    this.tpsBar.style.cssText = `
      width: 180px; height: 3px; background: rgba(255,255,255,0.08);
      border-radius: 2px; overflow: hidden;
    `;
    bottomCenter.appendChild(this.tpsBar);

    this.tpsBarFill = document.createElement('div');
    this.tpsBarFill.style.cssText = `
      width: 0%; height: 100%; background: rgba(232, 184, 74, 0.6);
      border-radius: 2px; transition: width 0.3s ease;
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
      font-family: 'SF Mono', 'Fira Code', monospace;
      font-size: 9px; letter-spacing: 2px; color: rgba(255,255,255,0.3);
      text-transform: uppercase; margin-bottom: 2px;
    `;
    labelEl.textContent = label;
    wrapper.appendChild(labelEl);

    const valueEl = document.createElement('div');
    valueEl.className = 'hud-value';
    valueEl.style.cssText = `
      font-family: 'SF Mono', 'Fira Code', monospace;
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

  updateValidatorCount(count: number): void {
    this.validatorEl.textContent = count.toLocaleString();
  }

  updateTps(tps: number): void {
    this.targetTps = tps;
    this.tpsEl.textContent = this.formatNumber(tps);
  }

  update(dt: number): void {
    // Smooth TPS bar animation
    this.currentTps += (this.targetTps - this.currentTps) * Math.min(dt * 5, 1);
    const fillPct = Math.min(this.currentTps / this.maxTps * 100, 100);
    this.tpsBarFill.style.width = `${fillPct}%`;
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

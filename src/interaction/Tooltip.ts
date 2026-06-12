import type { ValidatorInfo } from '../data/DataSource';

export class Tooltip {
  private el: HTMLDivElement;
  private currentSlot: number = 0;
  private leaderPubkey: string | null = null;

  constructor() {
    this.el = document.createElement('div');
    this.el.style.cssText = `
      position: absolute;
      background: rgba(5, 5, 16, 0.85);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      border-radius: 6px;
      font-family: 'ABC Diatype Semi-Mono', 'SF Mono', monospace;
      font-size: 11px;
      color: #c8cad0;
      max-width: 280px;
      padding: 10px 12px;
      pointer-events: none;
      z-index: 20;
      opacity: 0;
      transition: opacity 0.15s ease;
      border: 1px solid rgba(255, 255, 255, 0.06);
    `;

    const hud = document.getElementById('hud');
    if (hud) {
      hud.appendChild(this.el);
    } else {
      document.body.appendChild(this.el);
    }
  }

  setContext(currentSlot: number, leaderPubkey: string | null): void {
    this.currentSlot = currentSlot;
    this.leaderPubkey = leaderPubkey;
  }

  show(validator: ValidatorInfo, screenX: number, screenY: number): void {
    const isLeader = this.leaderPubkey !== null && validator.pubkey === this.leaderPubkey;
    const isActive = validator.lastVote >= this.currentSlot - 5;

    // Human card (canonical: COPY.md) — no STAKE/COMMISSION/EPOCH CREDITS jargon:
    // what it committed, when it last agreed, whether it's here.
    const stakeFormatted = this.formatStake(validator.stake);
    const agreedSecs = Math.max(0, this.currentSlot - validator.lastVote) * 0.4;
    const lastAgreed = agreedSecs < 2 ? 'just now' : `${Math.round(agreedSecs)}s ago`;

    const leaderBadge = isLeader
      ? `<div style="color: #d4a017; font-size: 10px; font-weight: 600; margin: 4px 0 2px 0;">★ WRITING THIS BLOCK</div>`
      : '';

    const statusColor = isActive ? '#4ade80' : '#ef4444';
    const statusText = isActive ? 'Active' : 'Offline';

    this.el.innerHTML = `
      <div style="font-size: 13px; font-weight: 700; color: #e8eaed; margin-bottom: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
        ${this.escapeHtml(validator.name)}
      </div>
      ${leaderBadge}
      <div style="display: grid; grid-template-columns: auto 1fr; gap: 3px 10px; margin-top: 6px;">
        <span style="color: #6b7080;">Committed</span>
        <span style="text-align: right;">${stakeFormatted} SOL</span>
        <span style="color: #6b7080;">Last agreed</span>
        <span style="text-align: right;">${lastAgreed}</span>
        <span style="color: #6b7080;">Status</span>
        <span style="text-align: right; color: ${statusColor}; font-weight: 600;">${statusText}</span>
      </div>
      <div style="margin-top: 8px; padding-top: 6px; border-top: 1px solid rgba(255,255,255,0.06); color: #4a4d56; font-size: 10px;">
        Click to approach
      </div>
    `;

    // Position with 16px offset, flip if overflow
    const offsetX = 16;
    const offsetY = 16;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Measure element
    this.el.style.opacity = '0';
    this.el.style.display = 'block';
    const rect = this.el.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;

    let x = screenX + offsetX;
    let y = screenY + offsetY;

    if (x + w > vw) {
      x = screenX - offsetX - w;
    }
    if (y + h > vh) {
      y = screenY - offsetY - h;
    }

    // Clamp to viewport
    x = Math.max(4, Math.min(x, vw - w - 4));
    y = Math.max(4, Math.min(y, vh - h - 4));

    this.el.style.left = `${x}px`;
    this.el.style.top = `${y}px`;
    this.el.style.opacity = '1';
  }

  hide(): void {
    this.el.style.opacity = '0';
  }

  dispose(): void {
    this.el.remove();
  }

  private formatStake(lamports: number): string {
    const sol = lamports;
    if (sol >= 1_000_000) {
      return (sol / 1_000_000).toFixed(1) + 'M';
    }
    if (sol >= 1_000) {
      return (sol / 1_000).toFixed(1) + 'K';
    }
    return sol.toFixed(0);
  }

  private formatNumber(n: number): string {
    return n.toLocaleString();
  }

  private escapeHtml(str: string): string {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
}

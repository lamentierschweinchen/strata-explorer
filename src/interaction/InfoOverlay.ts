import * as THREE from 'three';
import { TransactionInfo } from '../data/DataSource';
import { TX_TYPE_DISPLAY, TX_TYPE_HEX } from '../utils/colors';
import { shortenSignature } from '../utils/format';

/** Public Solana explorer — each feed row deep-links to its real signature here. */
const SOLSCAN_TX = 'https://solscan.io/tx/';

/**
 * Visual-only fields the Data lane may set on a transaction that must never reach the
 * human-readable feed. Read defensively (additive optional fields, per COORDINATION.md);
 * `TransactionInfo` itself stays frozen.
 */
interface TxEnrichment {
  /** Density-fill particle that matches real TPS in aggregate — never an individual feed row. */
  synthetic?: boolean;
}

/**
 * The secondary column for a feed row: the transaction's real, truncated signature — the same
 * hash the row deep-links to on Solscan. Hash-forward by product direction: the feed is global,
 * so it shows *what* (the verifiable hash), never *where* (no protocol, no landing slot). Honest
 * by construction: the signature is the row's real on-chain identity, never a fabricated value.
 */
function feedSecondary(tx: TransactionInfo): string {
  return shortenSignature(tx.signature) || (tx.detail ?? '');
}

const GLASS_BG = 'rgba(5,5,16,0.5)';
const GLASS_BORDER = 'rgba(255,255,255,0.2)';
const GLASS_BLUR = 'blur(8px)';
// The feed panel reads quieter than the toggle button: a more transparent glass + hairline
// border so it recedes into the scene (Galaxy of Nodes' restraint) instead of boxing the feed in.
const PANEL_BG = 'rgba(5,5,16,0.4)';
const PANEL_BORDER = 'rgba(255,255,255,0.08)';
const MAX_VISIBLE = 10;
const MAX_QUEUE = 50;
// Batch refresh (Galaxy of Nodes pattern): every cycle the list is rebuilt as one sample
// of the latest transactions, rows cascading in with a small stagger — instead of rows
// dripping in one at a time and the panel resizing with every arrival.
const REFRESH_MS = 1500;
const ROW_STAGGER_MS = 50;
const ROW_HEIGHT = 22; // fixed row slot height; the panel NEVER changes size

const TX_TYPES = ['all', 'transfer', 'defi', 'nft', 'stake'] as const;

export class InfoOverlay {
  private hud: HTMLElement;

  // Toggle button (mobile only — desktop keeps the feed always visible)
  private toggleBtn: HTMLDivElement | null = null;

  // Leader label
  private leaderLabel: HTMLDivElement;
  private leaderWorldPos = new THREE.Vector3();
  private leaderName = '';

  // Feed panel
  private feedPanel: HTMLDivElement;
  private feedHeader: HTMLDivElement;
  private filterBar: HTMLDivElement;
  private feedList: HTMLDivElement;
  private activeFilter: string = 'all';
  private filterPills: Map<string, HTMLDivElement> = new Map();

  // Rolling buffer of recent transactions; the refresh cycle samples its newest entries.
  private txQueue: TransactionInfo[] = [];
  private refreshTimer = 0;

  // Visibility
  private visible = true;

  // Bound handlers for cleanup
  private boundToggle: (() => void) | null = null;

  constructor() {
    this.hud = document.getElementById('hud')!;

    // On phones the feed defaults hidden and the "i" button reveals it (Galaxy pattern). On
    // desktop / the gallery screen the feed is always visible, so the toggle is superfluous —
    // and a lone "i" at top-center controlling a panel on the far right edge just reads as a
    // dead control. So the button exists on mobile only.
    const mobile = window.innerWidth <= 768;

    // --- Toggle button (mobile only) ---
    if (mobile) {
      this.toggleBtn = document.createElement('div');
      Object.assign(this.toggleBtn.style, {
        position: 'absolute',
        top: '12px',
        left: '50%',
        transform: 'translateX(-50%)',
        width: '32px',
        height: '32px',
        borderRadius: '50%',
        background: GLASS_BG,
        backdropFilter: GLASS_BLUR,
        WebkitBackdropFilter: GLASS_BLUR,
        border: `1px solid ${GLASS_BORDER}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        zIndex: '15',
        fontFamily: 'serif',
        fontStyle: 'italic',
        fontSize: '16px',
        color: 'rgba(255,255,255,0.7)',
        userSelect: 'none',
      });
      this.toggleBtn.textContent = 'i';
      this.toggleBtn.title = 'Show live transactions';
      this.hud.appendChild(this.toggleBtn);

      const bound = () => this.toggle();
      this.boundToggle = bound;
      this.toggleBtn.addEventListener('click', bound);
    }

    // --- Leader label ---
    this.leaderLabel = document.createElement('div');
    Object.assign(this.leaderLabel.style, {
      position: 'absolute',
      fontFamily: 'monospace',
      fontSize: '10px',
      color: '#ffc850',
      textTransform: 'uppercase',
      letterSpacing: '1px',
      pointerEvents: 'none',
      whiteSpace: 'nowrap',
      opacity: '0',
      transition: 'opacity 0.3s',
    });
    this.hud.appendChild(this.leaderLabel);

    // --- Feed panel ---
    // On phones an always-on panel crowds the piece, so (like Galaxy of Nodes) the feed
    // defaults HIDDEN on narrow screens (revealed by the "i" button); desktop / the gallery
    // screen keeps it visible. Sized smaller on mobile when revealed.
    this.feedPanel = document.createElement('div');
    Object.assign(this.feedPanel.style, {
      position: 'absolute',
      // Vertically centered on the right edge — clears the top-right HUD (validators/TPS) the feed
      // used to crowd, and mirrors Galaxy of Nodes' placement. Reads integrated, not cornered.
      top: '50%',
      right: mobile ? '12px' : '24px',
      transform: 'translateY(-50%)',
      width: mobile ? 'min(62vw, 220px)' : '240px',
      background: PANEL_BG,
      backdropFilter: GLASS_BLUR,
      WebkitBackdropFilter: GLASS_BLUR,
      border: `1px solid ${PANEL_BORDER}`,
      borderRadius: '10px',
      padding: '12px 14px',
      pointerEvents: 'auto',
    });
    this.hud.appendChild(this.feedPanel);

    // Mobile: start hidden — the "i" button reveals it on demand (clean default view).
    if (mobile) {
      this.visible = false;
      this.feedPanel.style.display = 'none';
    }

    // Feed header
    this.feedHeader = document.createElement('div');
    Object.assign(this.feedHeader.style, {
      fontFamily: 'monospace',
      fontSize: '9px',
      textTransform: 'uppercase',
      letterSpacing: '1.5px',
      color: 'rgba(255,255,255,0.5)',
      marginBottom: '8px',
    });
    this.feedHeader.textContent = 'Live transactions';
    this.feedPanel.appendChild(this.feedHeader);

    // Filter bar
    this.filterBar = document.createElement('div');
    Object.assign(this.filterBar.style, {
      display: 'flex',
      gap: '4px',
      flexWrap: 'wrap',
      marginBottom: '8px',
    });
    this.feedPanel.appendChild(this.filterBar);

    for (const type of TX_TYPES) {
      const pill = document.createElement('div');
      const hexColor = type === 'all' ? '#ffffff' : TX_TYPE_HEX[type] || '#ffffff';
      Object.assign(pill.style, {
        fontFamily: 'monospace',
        fontSize: '8px',
        textTransform: 'uppercase',
        letterSpacing: '0.5px',
        padding: '2px 6px',
        borderRadius: '8px',
        cursor: 'pointer',
        userSelect: 'none',
        border: `1px solid ${hexColor}40`,
        color: hexColor,
        background: type === this.activeFilter ? `${hexColor}25` : 'transparent',
        transition: 'background 0.2s, opacity 0.2s',
      });
      pill.textContent = type === 'all' ? 'ALL' : type.toUpperCase();
      pill.addEventListener('click', () => this.setFilter(type));
      this.filterBar.appendChild(pill);
      this.filterPills.set(type, pill);
    }

    // Feed list
    this.feedList = document.createElement('div');
    Object.assign(this.feedList.style, {
      display: 'flex',
      flexDirection: 'column',
      gap: '2px',
      // FIXED height (not max-height): the panel reserves all ten row slots up front,
      // so it never grows/shrinks — and never re-centers — as transactions arrive.
      height: `${MAX_VISIBLE * ROW_HEIGHT}px`,
      overflow: 'hidden',
    });
    this.feedPanel.appendChild(this.feedList);
  }

  private toggle(): void {
    this.visible = !this.visible;
    this.feedPanel.style.display = this.visible ? 'block' : 'none';
    this.leaderLabel.style.opacity = this.visible && this.leaderName ? '1' : '0';
  }

  private setFilter(type: string): void {
    this.activeFilter = type;
    for (const [key, pill] of this.filterPills) {
      const hexColor = key === 'all' ? '#ffffff' : TX_TYPE_HEX[key] || '#ffffff';
      pill.style.background = key === type ? `${hexColor}25` : 'transparent';
    }
    this.refresh(); // pills respond immediately, not on the next cycle
  }

  private createRow(tx: TransactionInfo, staggerIndex: number): HTMLElement {
    const hexColor = TX_TYPE_HEX[tx.type] || '#ffffff';
    const sig = tx.signature ?? '';
    const linkable = sig.length >= 32; // a real base58 signature → deep-link to the explorer

    // Whole row is the explorer link when we have a real signature.
    const row = document.createElement(linkable ? 'a' : 'div');
    if (linkable) {
      const a = row as HTMLAnchorElement;
      a.href = `${SOLSCAN_TX}${sig}`;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.title = 'View transaction on Solscan ↗';
    }
    Object.assign(row.style, {
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      fontFamily: 'monospace',
      fontSize: '9px',
      color: 'rgba(255,255,255,0.7)',
      height: `${ROW_HEIGHT - 2}px`, // fixed slot height (2px = list gap)
      boxSizing: 'border-box',
      padding: '2px 4px',
      margin: '0 -4px', // let the hover highlight reach the panel edges without shifting layout
      borderRadius: '4px',
      textDecoration: 'none',
      opacity: '0',
      // Staggered cascade per refresh batch (txFadeIn keyframe lives in index.html)
      animation: `txFadeIn 0.3s ease ${staggerIndex * ROW_STAGGER_MS}ms forwards`,
      transition: 'background 0.15s',
      pointerEvents: linkable ? 'auto' : 'none',
      cursor: linkable ? 'pointer' : 'default',
    });

    // Colored dot
    const dot = document.createElement('span');
    Object.assign(dot.style, {
      width: '5px',
      height: '5px',
      borderRadius: '50%',
      background: hexColor,
      flexShrink: '0',
    });
    row.appendChild(dot);

    // Type name (humanized via TX_TYPE_DISPLAY)
    const typeName = document.createElement('span');
    typeName.style.color = hexColor;
    typeName.textContent = TX_TYPE_DISPLAY[tx.type] || tx.type;
    row.appendChild(typeName);

    // The row's real, truncated signature — the hash this row deep-links to (see feedSecondary).
    const meta = document.createElement('span');
    Object.assign(meta.style, {
      marginLeft: 'auto',
      color: 'rgba(255,255,255,0.4)',
      whiteSpace: 'nowrap',
    });
    meta.textContent = feedSecondary(tx);
    row.appendChild(meta);

    // External-link affordance + hover feedback (only when the row links out).
    if (linkable) {
      const arrow = document.createElement('span');
      Object.assign(arrow.style, {
        color: 'rgba(255,255,255,0.25)',
        flexShrink: '0',
        transition: 'color 0.15s',
      });
      arrow.textContent = '↗';
      row.appendChild(arrow);

      row.addEventListener('mouseenter', () => {
        row.style.background = `${hexColor}1a`;
        arrow.style.color = hexColor;
        meta.style.color = 'rgba(255,255,255,0.7)';
      });
      row.addEventListener('mouseleave', () => {
        row.style.background = 'transparent';
        arrow.style.color = 'rgba(255,255,255,0.25)';
        meta.style.color = 'rgba(255,255,255,0.4)';
      });
    }

    return row;
  }

  /**
   * Rebuild the list as one batch: the newest ≤10 filter-matching transactions, newest
   * on top, cascading in together (Galaxy of Nodes pattern). The list height is fixed,
   * so a refresh never changes the panel's size or position.
   */
  private refresh(): void {
    const matching =
      this.activeFilter === 'all'
        ? this.txQueue
        : this.txQueue.filter((tx) => tx.type === this.activeFilter);
    const latest = matching.slice(-MAX_VISIBLE).reverse(); // newest first

    this.feedList.innerHTML = '';
    for (let i = 0; i < latest.length; i++) {
      this.feedList.appendChild(this.createRow(latest[i], i));
    }
  }

  // --- Public API ---

  setLeader(name: string, worldPos: THREE.Vector3): void {
    this.leaderName = name;
    this.leaderWorldPos.copy(worldPos);
    this.leaderLabel.textContent = name ? `Leader: ${name}` : '';
    this.leaderLabel.style.opacity = this.visible && name ? '1' : '0';
  }

  pushTransactions(txs: TransactionInfo[]): void {
    for (const tx of txs) {
      // Honesty guard: visual-only synthetic density particles must never enter the feed,
      // even if a future caller forwards them (the data engine already routes them elsewhere).
      if ((tx as TransactionInfo & TxEnrichment).synthetic) continue;
      this.txQueue.push(tx);
    }
    // Rolling buffer: keep the NEWEST entries (drop oldest), so each refresh samples
    // the most recent network activity.
    if (this.txQueue.length > MAX_QUEUE) {
      this.txQueue.splice(0, this.txQueue.length - MAX_QUEUE);
    }
  }

  getActiveFilter(): string {
    return this.activeFilter;
  }

  update(dt: number, camera: THREE.PerspectiveCamera, rendererDom: HTMLElement): void {
    // Batch refresh cycle (skipped while the overlay is hidden — no offscreen DOM churn)
    this.refreshTimer += dt * 1000;
    if (this.refreshTimer >= REFRESH_MS) {
      this.refreshTimer = 0;
      if (this.visible) this.refresh();
    }

    // Project leader label to 2D
    if (this.leaderName && this.visible) {
      const pos = this.leaderWorldPos.clone();
      pos.project(camera);

      const rect = rendererDom.getBoundingClientRect();
      const x = (pos.x * 0.5 + 0.5) * rect.width;
      const y = (-pos.y * 0.5 + 0.5) * rect.height;

      // Hide if behind camera
      if (pos.z > 1) {
        this.leaderLabel.style.opacity = '0';
      } else {
        this.leaderLabel.style.left = `${x}px`;
        this.leaderLabel.style.top = `${y - 24}px`;
        this.leaderLabel.style.opacity = '1';
      }
    }
  }

  dispose(): void {
    if (this.toggleBtn && this.boundToggle) {
      this.toggleBtn.removeEventListener('click', this.boundToggle);
    }

    for (const [, pill] of this.filterPills) {
      pill.replaceWith(pill.cloneNode(true));
    }

    if (this.toggleBtn?.parentNode) this.toggleBtn.parentNode.removeChild(this.toggleBtn);
    if (this.leaderLabel.parentNode) this.leaderLabel.parentNode.removeChild(this.leaderLabel);
    if (this.feedPanel.parentNode) this.feedPanel.parentNode.removeChild(this.feedPanel);

    this.filterPills.clear();
    this.txQueue = [];
  }
}

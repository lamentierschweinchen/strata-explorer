import * as THREE from 'three';
import { TransactionInfo } from '../data/DataSource';
import { TX_TYPE_DISPLAY, TX_TYPE_HEX } from '../utils/colors';
import { shortenAddress, shortenSignature, formatCount } from '../utils/format';

interface QueuedTx {
  tx: TransactionInfo;
  el: HTMLElement;
}

/** Public Solana explorer — each feed row deep-links to its real signature here. */
const SOLSCAN_TX = 'https://solscan.io/tx/';

/**
 * Forward-compatible view of secondary metadata the Data lane may enrich onto
 * `TransactionInfo` (additive optional fields, per COORDINATION.md). Read defensively so the
 * feed lights up automatically once Data populates them — and never shows a fabricated value.
 * Field names are reconciled against `src/data/INTEGRATION.md` during Task 4 integration.
 */
interface TxEnrichment {
  /** Source program/protocol — a program id (humanized below) or an already-friendly name. */
  program?: string;
  /** Landing slot. */
  slot?: number;
}

/**
 * Known Solana program ids → human labels. The Data lane streams transactions per program
 * (Phase B: Raydium / Magic Eden / Stake), so an enriched tx may carry its source program.
 * An unknown id is shortened; an already-friendly name passes through. Reference data only.
 */
const KNOWN_PROGRAMS: Record<string, string> = {
  '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8': 'Raydium',
  M2mx93ekt1fmXSVkTrUL9xVFHkmME8HTUi5Cyc5aF7K: 'Magic Eden',
  Stake11111111111111111111111111111111111111: 'Stake Program',
  '11111111111111111111111111111111': 'System Program',
  TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA: 'Token Program',
  JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4: 'Jupiter',
};

function humanizeProgram(program: string): string {
  if (KNOWN_PROGRAMS[program]) return KNOWN_PROGRAMS[program];
  // Already a friendly label (has whitespace, or shorter than a base58 program id)? Keep it.
  if (/\s/.test(program) || program.length < 32) return program;
  return shortenAddress(program);
}

/**
 * Real secondary metadata for a feed row — never fabricated:
 *   program/protocol (humanized) → landing slot → the real, truncated signature.
 * The signature fallback is what live already surfaces via `tx.detail`.
 */
function feedSecondary(tx: TransactionInfo): string {
  const enriched = tx as TransactionInfo & TxEnrichment;
  if (typeof enriched.program === 'string' && enriched.program) {
    return humanizeProgram(enriched.program);
  }
  if (typeof enriched.slot === 'number' && Number.isFinite(enriched.slot)) {
    return `slot ${formatCount(enriched.slot)}`;
  }
  return tx.detail ?? shortenSignature(tx.signature);
}

const GLASS_BG = 'rgba(5,5,16,0.5)';
const GLASS_BORDER = 'rgba(255,255,255,0.2)';
const GLASS_BLUR = 'blur(8px)';
const MAX_VISIBLE = 10;
const MAX_QUEUE = 50;
const DRIP_INTERVAL = 800;
const FADE_MS = 300;

const TX_TYPES = ['all', 'transfer', 'defi', 'nft', 'stake'] as const;

export class InfoOverlay {
  private hud: HTMLElement;

  // Toggle button
  private toggleBtn: HTMLDivElement;

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

  // Transaction queue
  private txQueue: TransactionInfo[] = [];
  private visibleRows: QueuedTx[] = [];
  private dripTimer = 0;

  // Visibility
  private visible = true;

  // Bound handlers for cleanup
  private boundToggle: () => void;

  constructor() {
    this.hud = document.getElementById('hud')!;

    // --- Toggle button ---
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
    this.hud.appendChild(this.toggleBtn);

    this.boundToggle = () => this.toggle();
    this.toggleBtn.addEventListener('click', this.boundToggle);

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
    this.feedPanel = document.createElement('div');
    Object.assign(this.feedPanel.style, {
      position: 'absolute',
      top: '56px',
      right: '12px',
      width: '220px',
      background: GLASS_BG,
      backdropFilter: GLASS_BLUR,
      WebkitBackdropFilter: GLASS_BLUR,
      border: `1px solid ${GLASS_BORDER}`,
      borderRadius: '6px',
      padding: '10px',
      pointerEvents: 'auto',
    });
    this.hud.appendChild(this.feedPanel);

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
    this.feedHeader.textContent = 'Transaction Feed';
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
      maxHeight: `${MAX_VISIBLE * 22}px`,
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
  }

  private createRow(tx: TransactionInfo): HTMLElement {
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
      padding: '2px 4px',
      margin: '0 -4px', // let the hover highlight reach the panel edges without shifting layout
      borderRadius: '4px',
      textDecoration: 'none',
      opacity: '0',
      transition: `opacity ${FADE_MS}ms, background 0.15s`,
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

    // Real secondary metadata — program/protocol or slot when enriched, else the real signature.
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

    // Fade in
    requestAnimationFrame(() => {
      row.style.opacity = '1';
    });

    return row;
  }

  private drip(): void {
    if (this.txQueue.length === 0) return;

    const tx = this.txQueue.shift()!;

    // Filter check
    if (this.activeFilter !== 'all' && tx.type !== this.activeFilter) {
      return;
    }

    const el = this.createRow(tx);
    this.feedList.prepend(el);
    this.visibleRows.unshift({ tx, el });

    // Remove excess
    while (this.visibleRows.length > MAX_VISIBLE) {
      const old = this.visibleRows.pop()!;
      old.el.style.opacity = '0';
      setTimeout(() => {
        if (old.el.parentNode) {
          old.el.parentNode.removeChild(old.el);
        }
      }, FADE_MS);
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
      if (this.txQueue.length < MAX_QUEUE) {
        this.txQueue.push(tx);
      }
    }
  }

  getActiveFilter(): string {
    return this.activeFilter;
  }

  update(dt: number, camera: THREE.PerspectiveCamera, rendererDom: HTMLElement): void {
    // Drip feed timer
    this.dripTimer += dt * 1000;
    while (this.dripTimer >= DRIP_INTERVAL) {
      this.dripTimer -= DRIP_INTERVAL;
      this.drip();
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
    this.toggleBtn.removeEventListener('click', this.boundToggle);

    for (const [, pill] of this.filterPills) {
      pill.replaceWith(pill.cloneNode(true));
    }

    if (this.toggleBtn.parentNode) this.toggleBtn.parentNode.removeChild(this.toggleBtn);
    if (this.leaderLabel.parentNode) this.leaderLabel.parentNode.removeChild(this.leaderLabel);
    if (this.feedPanel.parentNode) this.feedPanel.parentNode.removeChild(this.feedPanel);

    this.filterPills.clear();
    this.visibleRows = [];
    this.txQueue = [];
  }
}

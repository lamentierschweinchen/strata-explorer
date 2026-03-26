const GLASS_BG = 'rgba(5,5,16,0.5)';
const GLASS_BORDER = 'rgba(255,255,255,0.2)';
const GLASS_BLUR = 'blur(8px)';

interface LegendItem {
  symbol: string;
  symbolColor: string;
  symbolGradient?: string;
  label: string;
  description: string;
}

const LEGEND_ITEMS: LegendItem[] = [
  {
    symbol: '\u25C6',
    symbolColor: '#5588ff',
    symbolGradient: 'linear-gradient(180deg, #aaccff, #1a1530)',
    label: 'Crystal Axis',
    description: "Solana\u2019s block history. Bright top = recent slots. Dark base = finalized.",
  },
  {
    symbol: '\u25CF',
    symbolColor: '#ffc850',
    label: 'Validators',
    description: 'Mineral deposits. Brighter = more stake. Size = network influence.',
  },
  {
    symbol: '\u2501',
    symbolColor: '#ffc850',
    label: 'Leader Spotlight',
    description: "The golden beam shows who\u2019s producing the current block.",
  },
  {
    symbol: '\u25CC',
    symbolColor: '#cdb87a',
    label: 'Seismic Waves',
    description: 'Ripples when a new slot is confirmed by the network.',
  },
  {
    symbol: '\u25CF\u25CF\u25CF',
    symbolColor: '#ffd700',
    label: 'Transactions',
    description: 'Particles flowing into the crystal. Gold = transfers, Cyan = DeFi, Purple = NFT, Green = staking.',
  },
  {
    symbol: '\u25AC',
    symbolColor: '#1a1520',
    label: 'Missed Slots',
    description: 'Dark gaps in the crystal where a leader failed to produce a block.',
  },
];

// Multi-color dots for the Transactions item
const TX_DOT_COLORS = ['#ffd700', '#00e5ff', '#aa66ff', '#4cd964'];

export class Legend {
  private hud: HTMLElement;
  private button: HTMLDivElement;
  private panel: HTMLDivElement;
  private visible = false;

  private boundToggle: () => void;

  constructor() {
    this.hud = document.getElementById('hud')!;

    // --- Button ---
    this.button = document.createElement('div');
    Object.assign(this.button.style, {
      position: 'absolute',
      bottom: '16px',
      left: '16px',
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
      fontFamily: 'monospace',
      fontSize: '14px',
      color: 'rgba(255,255,255,0.7)',
      userSelect: 'none',
    });
    this.button.textContent = '?';
    this.hud.appendChild(this.button);

    this.boundToggle = () => this.toggle();
    this.button.addEventListener('click', this.boundToggle);

    // --- Panel ---
    this.panel = document.createElement('div');
    Object.assign(this.panel.style, {
      position: 'absolute',
      bottom: '56px',
      left: '16px',
      width: '280px',
      background: GLASS_BG,
      backdropFilter: GLASS_BLUR,
      WebkitBackdropFilter: GLASS_BLUR,
      border: `1px solid ${GLASS_BORDER}`,
      borderRadius: '6px',
      padding: '12px',
      opacity: '0',
      pointerEvents: 'none',
      transition: 'opacity 0.3s',
      zIndex: '14',
    });
    this.hud.appendChild(this.panel);

    this.buildContent();
  }

  private buildContent(): void {
    for (let i = 0; i < LEGEND_ITEMS.length; i++) {
      const item = LEGEND_ITEMS[i];
      const row = document.createElement('div');
      Object.assign(row.style, {
        display: 'flex',
        alignItems: 'flex-start',
        gap: '10px',
        padding: '8px 0',
        borderBottom: i < LEGEND_ITEMS.length - 1 ? '1px solid rgba(255,255,255,0.06)' : 'none',
      });

      // Symbol
      const symbolEl = document.createElement('span');
      Object.assign(symbolEl.style, {
        fontSize: '14px',
        lineHeight: '1',
        flexShrink: '0',
        width: '22px',
        textAlign: 'center',
        marginTop: '1px',
      });

      // Special handling for transactions item (multi-colored dots)
      if (i === 4) {
        symbolEl.innerHTML = '';
        for (let c = 0; c < TX_DOT_COLORS.length; c++) {
          const dot = document.createElement('span');
          dot.textContent = '\u25CF';
          dot.style.color = TX_DOT_COLORS[c];
          dot.style.fontSize = '8px';
          if (c > 0) dot.style.marginLeft = '-1px';
          symbolEl.appendChild(dot);
        }
      } else if (item.symbolGradient) {
        symbolEl.textContent = item.symbol;
        symbolEl.style.background = item.symbolGradient;
        symbolEl.style.WebkitBackgroundClip = 'text';
        symbolEl.style.webkitTextFillColor = 'transparent';
        (symbolEl.style as any).backgroundClip = 'text';
      } else {
        symbolEl.textContent = item.symbol;
        symbolEl.style.color = item.symbolColor;
      }

      row.appendChild(symbolEl);

      // Text container
      const textContainer = document.createElement('div');
      textContainer.style.flex = '1';

      const labelEl = document.createElement('div');
      Object.assign(labelEl.style, {
        fontFamily: 'monospace',
        fontSize: '10px',
        fontWeight: 'bold',
        color: 'rgba(255,255,255,0.85)',
        marginBottom: '2px',
      });
      labelEl.textContent = item.label;
      textContainer.appendChild(labelEl);

      const descEl = document.createElement('div');
      Object.assign(descEl.style, {
        fontFamily: 'monospace',
        fontSize: '9px',
        color: 'rgba(255,255,255,0.35)',
        lineHeight: '1.4',
      });
      descEl.textContent = item.description;
      textContainer.appendChild(descEl);

      row.appendChild(textContainer);
      this.panel.appendChild(row);
    }
  }

  private toggle(): void {
    this.visible = !this.visible;
    this.panel.style.opacity = this.visible ? '1' : '0';
    this.panel.style.pointerEvents = this.visible ? 'auto' : 'none';
  }

  dispose(): void {
    this.button.removeEventListener('click', this.boundToggle);

    if (this.button.parentNode) this.button.parentNode.removeChild(this.button);
    if (this.panel.parentNode) this.panel.parentNode.removeChild(this.panel);
  }
}

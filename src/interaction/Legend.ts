// Legend — a persistent peek-button (a small crystal mini-icon) anchored bottom-left.
// Desktop: hover the button to peek the panel; it closes when the pointer leaves.
// Mobile: tap to pin it open; tap outside (or the button again) to close.
// The panel leads with a one-line metaphor, then explains what the motion, brightness
// and size of each element MEAN, not just what color maps to what.
//
// Copy is sourced from the coordinator's canonical COPY.md ("What You're Looking At").
// Voice: metaphor first, meaning second, pinned to something real. No em dashes.

const GLASS_BG = 'rgba(5,5,16,0.6)';
const GLASS_BG_HOVER = 'rgba(5,5,16,0.85)';
const GLASS_BORDER = 'rgba(255,255,255,0.15)';
const GLASS_BORDER_HOVER = 'rgba(255,255,255,0.4)';
const GLASS_BLUR = 'blur(10px)';
const MONO = "'ABC Diatype Semi-Mono', 'SF Mono', monospace";
// Prose (the metaphor line, row meanings) speaks in the humanist brand face;
// labels and anything number-shaped stay semi-mono.
const PROSE = "'ABC Diatype', system-ui, sans-serif";

// One-line metaphor header (canonical hero line from COPY.md).
const METAPHOR = 'The Solana blockchain as a living crystal, growing with each heartbeat of the network.';

interface LegendRow {
  /** Raw HTML for the leading symbol (allows gradients / multi-color dots). */
  symbol: string;
  label: string;
  /** What this element's appearance / motion MEANS. */
  meaning: string;
}

// Transaction-type dot colors (kept in sync with utils/colors TX_TYPE_HEX).
const TX_COLORS = ['#ffd700', '#00e5ff', '#aa66ff', '#4cd964'];

// Small inline crystal-cluster glyph used in the panel's first row (mirrors the button
// icon): three angular shards of different heights leaning together, like the geode crest.
const CRYSTAL_GLYPH = `
  <svg width="13" height="15" viewBox="0 0 18 18" fill="none" style="display:block;margin:1px auto 0;">
    <g stroke="rgba(5,5,16,0.9)" stroke-width="0.6" stroke-linejoin="round">
      <polygon points="3.9,6.8 6.2,9 7.3,16 3.9,16 2.5,9.8" fill="url(#stxLegendGrad)"/>
      <polygon points="14.6,8.4 15.8,11.5 14.3,16 11,16 12.7,10.4" fill="url(#stxLegendGrad)"/>
      <polygon points="9.6,2 11.8,5.9 11,16 6.8,16 7.3,6.5" fill="url(#stxLegendGrad)"/>
    </g>
    <polygon points="9.6,2 7.3,6.5 6.8,16 9.3,16" fill="#ffffff" opacity="0.14"/>
    <polygon points="14.6,8.4 12.7,10.4 11,16 12.7,16" fill="#000000" opacity="0.18"/>
    <polygon points="3.9,6.8 2.5,9.8 3.9,16 5.3,16" fill="#000000" opacity="0.12"/>
  </svg>`;

// Small left-light / right-dark gradient swatch for the "Light and dark" row.
const LIGHTDARK_SWATCH =
  '<span style="display:inline-block;width:13px;height:6px;border-radius:2px;vertical-align:middle;' +
  'background:linear-gradient(90deg,#cfe4ff,#5a7fd0,#1a1730);"></span>';

const ROWS: LegendRow[] = [
  {
    symbol: CRYSTAL_GLYPH,
    label: 'The crystal',
    meaning:
      "The crystal at the center is the network's timeline. It grows a new layer every time Solana agrees on what just happened. It never branches, and it never rewrites itself.",
  },
  {
    symbol: LIGHTDARK_SWATCH,
    label: 'Light and dark',
    meaning:
      'The newest layers glow. The oldest harden into dark rock. Once a layer settles it can never change again. It becomes part of the record, forever.',
  },
  {
    symbol: '<span style="color:#ffc850;font-size:13px;">&#9679;</span>',
    label: 'The validators',
    meaning:
      'Each point is a real validator, a computer somewhere in the world helping keep the network honest. The more it has staked, the larger it burns.',
  },
  {
    symbol: '<span style="color:#fff0cc;font-size:12px;">&#10022;</span>',
    label: 'The flare',
    meaning:
      'Every fraction of a second, one validator is chosen to lay the next layer. It flares, and light reaches in toward the crystal.',
  },
  {
    symbol: TX_COLORS.map(
      (c, i) =>
        `<span style="color:${c};font-size:7px;${i > 0 ? 'margin-left:-1px;' : ''}">&#9679;</span>`,
    ).join(''),
    label: 'Live activity',
    meaning:
      'The transactions moving through the network this second. Gold is money moving. Cyan is a trade. Purple is an NFT. Green is someone staking.',
  },
  {
    symbol: '<span style="color:#cdb87a;font-size:13px;">&#9676;</span>',
    label: 'The ripples',
    meaning: 'When a ripple rolls outward, a new block has just spread across the whole network at once.',
  },
];

export class Legend {
  private hud: HTMLElement;
  private wrapper: HTMLDivElement;
  private button: HTMLButtonElement;
  private panel: HTMLDivElement;

  private open = false;
  private pinned = false; // tapped-open (mobile / click)
  private isMobile = false;

  private onDocClick: (e: MouseEvent) => void;
  private onResize: () => void;

  constructor() {
    this.hud = document.getElementById('hud')!;
    this.isMobile = window.innerWidth <= 480;

    // --- Wrapper (the only pointer-interactive region) ---
    this.wrapper = document.createElement('div');
    Object.assign(this.wrapper.style, {
      position: 'absolute',
      bottom: this.isMobile ? '16px' : '24px',
      left: this.isMobile ? '16px' : '28px',
      zIndex: '20',
      pointerEvents: 'auto',
    });

    // --- Peek button: a small crystal mini-icon ---
    this.button = document.createElement('button');
    this.button.setAttribute('aria-label', 'What am I looking at?');
    this.button.setAttribute('title', 'Legend');
    this.applyButtonStyle(false);
    this.button.innerHTML = this.crystalIcon();
    this.wrapper.appendChild(this.button);

    // --- Panel (hidden until peeked/pinned) ---
    this.panel = document.createElement('div');
    this.applyPanelStyle();
    this.panel.innerHTML = this.panelHtml();
    this.wrapper.appendChild(this.panel);

    // Desktop hover-to-peek
    this.button.addEventListener('mouseenter', () => {
      this.applyButtonStyle(true);
      if (!this.open) this.show();
    });
    this.wrapper.addEventListener('mouseleave', () => {
      if (!this.pinned) this.hide();
    });
    // Tap / click toggles a pinned-open state (primary path on mobile)
    this.button.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.pinned) {
        this.pinned = false;
        this.hide();
      } else {
        this.pinned = true;
        this.show();
      }
    });
    // a11y focus ring
    this.button.addEventListener('focus', () => {
      this.button.style.outline = '1px solid rgba(255,255,255,0.5)';
      this.button.style.outlineOffset = '2px';
    });
    this.button.addEventListener('blur', () => {
      this.button.style.outline = 'none';
    });

    // Outside tap closes (mobile)
    this.onDocClick = (e: MouseEvent) => {
      if (this.pinned && !this.wrapper.contains(e.target as Node)) {
        this.pinned = false;
        this.hide();
      }
    };
    document.addEventListener('click', this.onDocClick);

    // Re-apply responsive sizing on viewport change
    this.onResize = () => {
      const mobile = window.innerWidth <= 480;
      if (mobile !== this.isMobile) {
        this.isMobile = mobile;
        this.wrapper.style.bottom = mobile ? '16px' : '24px';
        this.wrapper.style.left = mobile ? '16px' : '28px';
        this.applyButtonStyle(this.open);
        this.applyPanelStyle();
      }
    };
    window.addEventListener('resize', this.onResize);

    this.hud.appendChild(this.wrapper);
  }

  private applyButtonStyle(hover: boolean): void {
    const size = this.isMobile ? '32px' : '36px';
    Object.assign(this.button.style, {
      width: size,
      height: size,
      padding: '0',
      border: `1px solid ${hover ? GLASS_BORDER_HOVER : GLASS_BORDER}`,
      borderRadius: '50%',
      background: hover ? GLASS_BG_HOVER : GLASS_BG,
      backdropFilter: GLASS_BLUR,
      WebkitBackdropFilter: GLASS_BLUR,
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      transition: 'border-color 0.2s ease, background 0.2s ease',
    });
  }

  private applyPanelStyle(): void {
    Object.assign(this.panel.style, {
      position: 'absolute',
      bottom: this.isMobile ? '40px' : '44px',
      left: '0',
      width: this.isMobile ? '210px' : '256px',
      padding: this.isMobile ? '11px 12px' : '14px 16px',
      background: 'rgba(5,5,16,0.9)',
      border: '1px solid rgba(255,255,255,0.08)',
      borderRadius: '8px',
      backdropFilter: 'blur(12px)',
      WebkitBackdropFilter: 'blur(12px)',
      fontFamily: MONO,
      lineHeight: '1.5',
      opacity: this.open ? '1' : '0',
      transform: this.open ? 'translateY(0)' : 'translateY(6px)',
      transition: 'opacity 0.25s ease, transform 0.25s ease',
      pointerEvents: this.open ? 'auto' : 'none',
    });
  }

  /**
   * The crystal-cluster mini-icon used on the button: three angular shards of different
   * heights leaning together (the geode crest), hued along the Solana gradient axis
   * purple #9945FF → magenta → green #14F195. Same mark as /favicon.svg.
   */
  private crystalIcon(): string {
    const s = this.isMobile ? 15 : 17;
    return `
      <svg width="${s}" height="${s}" viewBox="0 0 18 18" fill="none">
        <defs>
          <linearGradient id="stxBtnGrad" x1="2.8" y1="16.3" x2="15.2" y2="1.7" gradientUnits="userSpaceOnUse">
            <stop offset="0" stop-color="#9945FF"/>
            <stop offset="0.48" stop-color="#EB33CC"/>
            <stop offset="0.7" stop-color="#14F195"/>
          </linearGradient>
        </defs>
        <g stroke="rgba(5,5,16,0.9)" stroke-width="0.6" stroke-linejoin="round">
          <polygon points="3.9,6.8 6.2,9 7.3,16 3.9,16 2.5,9.8" fill="url(#stxBtnGrad)"/>
          <polygon points="14.6,8.4 15.8,11.5 14.3,16 11,16 12.7,10.4" fill="url(#stxBtnGrad)"/>
          <polygon points="9.6,2 11.8,5.9 11,16 6.8,16 7.3,6.5" fill="url(#stxBtnGrad)"/>
        </g>
        <polygon points="9.6,2 7.3,6.5 6.8,16 9.3,16" fill="#ffffff" opacity="0.14"/>
        <polygon points="14.6,8.4 12.7,10.4 11,16 12.7,16" fill="#000000" opacity="0.18"/>
        <polygon points="3.9,6.8 2.5,9.8 3.9,16 5.3,16" fill="#000000" opacity="0.12"/>
      </svg>`;
  }

  private panelHtml(): string {
    const rows = ROWS.map((r) => `
      <div style="display:flex;align-items:flex-start;gap:9px;padding:7px 0;border-top:1px solid rgba(255,255,255,0.05);">
        <span style="flex-shrink:0;width:16px;text-align:center;margin-top:1px;line-height:1;">${r.symbol}</span>
        <div style="flex:1;">
          <div style="font-size:10px;font-weight:600;color:rgba(255,255,255,0.82);margin-bottom:2px;">${r.label}</div>
          <div style="font-family:${PROSE};font-size:9px;color:rgba(255,255,255,0.4);line-height:1.45;">${r.meaning}</div>
        </div>
      </div>`).join('');

    // Hidden <defs> so the inline crystal glyph in the first row can reference a gradient.
    const defs = `
      <svg width="0" height="0" style="position:absolute;" aria-hidden="true">
        <defs>
          <linearGradient id="stxLegendGrad" x1="2.8" y1="16.3" x2="15.2" y2="1.7" gradientUnits="userSpaceOnUse">
            <stop offset="0" stop-color="#9945FF"/>
            <stop offset="0.48" stop-color="#EB33CC"/>
            <stop offset="0.7" stop-color="#14F195"/>
          </linearGradient>
        </defs>
      </svg>`;

    return `${defs}
      <div style="font-family:${PROSE};font-size:10px;letter-spacing:0.3px;color:rgba(255,255,255,0.55);padding-bottom:9px;">
        ${METAPHOR}
      </div>
      ${rows}`;
  }

  /** Presentation (gallery cinema) fade: the peek button implies a mouse — it bows out. */
  setPresentation(presenting: boolean): void {
    this.wrapper.style.transition = 'opacity 1.2s ease';
    this.wrapper.style.opacity = presenting ? '0' : '';
    this.wrapper.style.pointerEvents = presenting ? 'none' : 'auto';
    if (presenting && (this.open || this.pinned)) {
      this.pinned = false;
      this.hide();
    }
  }

  private show(): void {
    this.open = true;
    this.panel.style.opacity = '1';
    this.panel.style.transform = 'translateY(0)';
    this.panel.style.pointerEvents = 'auto';
    this.applyButtonStyle(true);
  }

  private hide(): void {
    this.open = false;
    this.panel.style.opacity = '0';
    this.panel.style.transform = 'translateY(6px)';
    this.panel.style.pointerEvents = 'none';
    this.applyButtonStyle(false);
  }

  dispose(): void {
    document.removeEventListener('click', this.onDocClick);
    window.removeEventListener('resize', this.onResize);
    if (this.wrapper.parentNode) this.wrapper.parentNode.removeChild(this.wrapper);
  }
}

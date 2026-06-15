/**
 * The permanent-mint flow UI (Phase 2 + 3). Lazy-loaded by MintPanel — importing THIS module is the
 * code-split boundary that pulls in umi / mpl-core / wallet-adapter / irys. The art bundle never
 * sees any of it.
 *
 * Flow: choose cluster (DEVNET default; MAINNET gated behind an opt-in flag + a typed confirm) →
 * connect wallet → upload to Arweave (Irys) → mint a Core NFT → show the explorer link.
 */
import type { AudioEngine } from '../audio/AudioEngine';
import type { Moment, MintResult } from './types';
import { MAINNET_ALLOWED, type MintCluster } from './config';
import { connectWallet, listWallets, type ConnectedWallet } from './wallet';
import { uploadMoment } from './storage';
import { mintMoment } from './mint';

export interface MintFlowOptions {
  slot: HTMLElement;
  moment: Moment;
  engine: AudioEngine;
}

export function mountMintFlow(opts: MintFlowOptions): void {
  new MintFlow(opts.slot, opts.moment);
}

class MintFlow {
  private readonly root: HTMLElement;
  private cluster: MintCluster = 'devnet';
  private wallet: ConnectedWallet | null = null;
  private busy = false;
  private mainnetConfirmed = false;

  // refs
  private body!: HTMLElement;
  private logEl!: HTMLElement;

  constructor(host: HTMLElement, private readonly moment: Moment) {
    this.root = document.createElement('div');
    this.root.className = 'stx-flow';
    this.root.innerHTML = FLOW_STYLE;
    host.appendChild(this.root);

    const wrap = document.createElement('div');
    wrap.className = 'stx-flowwrap';
    this.root.appendChild(wrap);
    wrap.innerHTML = `
      <div class="stx-flowhead">PERMANENT MINT</div>
      <div class="stx-clusters">
        <button class="stx-cl on" data-cl="devnet">DEVNET</button>
        <button class="stx-cl ${MAINNET_ALLOWED ? '' : 'locked'}" data-cl="mainnet-beta">MAINNET${MAINNET_ALLOWED ? '' : ' 🔒'}</button>
      </div>
      <div class="stx-flowbody"></div>
      <pre class="stx-log"></pre>`;
    this.body = wrap.querySelector('.stx-flowbody')!;
    this.logEl = wrap.querySelector('.stx-log')!;

    wrap.querySelectorAll<HTMLButtonElement>('.stx-cl').forEach((b) =>
      b.addEventListener('click', () => this.selectCluster(b.dataset.cl as MintCluster, b)),
    );
    this.renderBody();
  }

  private selectCluster(cl: MintCluster, btn: HTMLElement): void {
    if (this.busy) return;
    if (cl === 'mainnet-beta' && !MAINNET_ALLOWED) {
      this.write('⛔ Mainnet is disabled. Set VITE_MINT_ALLOW_MAINNET=true to enable it.');
      return;
    }
    if (cl === this.cluster) return;
    // Switching cluster drops any existing connection (different RPC).
    this.cluster = cl;
    this.mainnetConfirmed = false;
    void this.wallet?.disconnect();
    this.wallet = null;
    this.root.querySelectorAll('.stx-cl').forEach((b) => b.classList.remove('on'));
    btn.classList.add('on');
    this.renderBody();
  }

  private renderBody(): void {
    this.body.innerHTML = '';
    if (this.cluster === 'mainnet-beta' && !this.mainnetConfirmed) {
      this.renderMainnetGate();
      return;
    }
    if (!this.wallet) {
      this.renderConnect();
      return;
    }
    this.renderMint();
  }

  private renderMainnetGate(): void {
    const box = el('div', 'stx-gate');
    box.innerHTML = `
      <div class="stx-gatewarn">⚠ MAINNET — this spends REAL SOL and creates a permanent, public NFT.</div>
      <div class="stx-gatesub">Type <b>MAINNET</b> to confirm you intend to mint on mainnet-beta.</div>`;
    const input = document.createElement('input');
    input.className = 'stx-gateinput';
    input.placeholder = 'type MAINNET';
    const go = button('Confirm mainnet', 'ghost', () => {
      if (input.value.trim().toUpperCase() === 'MAINNET') {
        this.mainnetConfirmed = true;
        this.write('✓ Mainnet confirmed. Connect a wallet you control.');
        this.renderBody();
      } else {
        this.write('Type MAINNET exactly to confirm.');
      }
    });
    box.appendChild(input);
    box.appendChild(go);
    this.body.appendChild(box);
  }

  private renderConnect(): void {
    const row = el('div', 'stx-wallets');
    const note = el('div', 'stx-flownote');
    note.textContent = `Connect a wallet to store on Arweave and mint on ${this.label()}.`;
    this.body.appendChild(note);
    this.body.appendChild(row);
    row.textContent = 'Detecting wallets…';
    void listWallets().then((opts) => {
      row.innerHTML = '';
      const installed = opts.filter((o) => o.installed);
      const show = installed.length ? installed : opts;
      if (!installed.length) {
        const hint = el('div', 'stx-flownote');
        hint.textContent = 'No wallet detected. Install Phantom, Solflare, or Backpack, then reload.';
        this.body.appendChild(hint);
      }
      show.forEach((o) => {
        row.appendChild(
          button(`${o.installed ? '● ' : ''}${o.name}`, 'wallet', () => void this.doConnect(o.name)),
        );
      });
    });
  }

  private renderMint(): void {
    const w = this.wallet!;
    const info = el('div', 'stx-connected');
    info.innerHTML = `<span>● ${escapeHtml(w.name)}</span><span class="stx-addr">${short(w.address)}</span>`;
    this.body.appendChild(info);

    const mintBtn = button(`Store on Arweave & mint on ${this.label()}`, 'primary', () => void this.doMint());
    this.body.appendChild(mintBtn);
    const dc = button('Disconnect', 'link', () => {
      void w.disconnect();
      this.wallet = null;
      this.renderBody();
    });
    this.body.appendChild(dc);
  }

  private async doConnect(name: string): Promise<void> {
    if (this.busy) return;
    this.setBusy(true);
    this.write(`Connecting ${name}…`);
    try {
      this.wallet = await connectWallet(this.cluster, name);
      this.write(`✓ Connected ${this.wallet.name} · ${short(this.wallet.address)}`);
      this.renderBody();
    } catch (e) {
      this.write(`✗ ${errMsg(e)}`);
    } finally {
      this.setBusy(false);
    }
  }

  private async doMint(): Promise<void> {
    if (this.busy || !this.wallet) return;
    this.setBusy(true);
    try {
      this.write(`Uploading to Arweave (${this.label()})…`);
      const uris = await uploadMoment(this.moment, this.wallet.umi, {
        onProgress: (m) => this.write(`  ${m}`),
      });
      this.write(`✓ image:    ${uris.imageUri}`);
      this.write(`✓ audio:    ${uris.animationUri}`);
      this.write(`✓ metadata: ${uris.metadataUri}`);
      this.write('Minting Metaplex Core NFT…');
      const res: MintResult = await mintMoment(this.moment, uris, this.wallet.umi, this.cluster);
      this.write('✓ MINTED');
      this.renderResult(res);
    } catch (e) {
      this.write(`✗ ${errMsg(e)}`);
    } finally {
      this.setBusy(false);
    }
  }

  private renderResult(res: MintResult): void {
    this.body.innerHTML = '';
    const done = el('div', 'stx-done');
    done.innerHTML = `
      <div class="stx-doneh">✓ Minted on ${res.cluster}</div>
      <div class="stx-donerow"><span>asset</span><span class="stx-addr">${short(res.asset)}</span></div>
      <a class="stx-btn primary" href="${res.explorerUrl}" target="_blank" rel="noopener">View NFT on explorer ↗</a>
      <a class="stx-btn link" href="${res.txUrl}" target="_blank" rel="noopener">View mint transaction ↗</a>
      <a class="stx-btn link" href="${res.uris.metadataUri}" target="_blank" rel="noopener">View metadata JSON ↗</a>`;
    this.body.appendChild(done);
  }

  /* helpers */
  private label(): string {
    return this.cluster === 'mainnet-beta' ? 'mainnet' : 'devnet';
  }
  private setBusy(b: boolean): void {
    this.busy = b;
    this.root.querySelectorAll('button').forEach((btn) => (btn.disabled = b));
  }
  private write(msg: string): void {
    this.logEl.textContent += (this.logEl.textContent ? '\n' : '') + msg;
    this.logEl.scrollTop = this.logEl.scrollHeight;
  }
}

/* ── tiny DOM helpers ──────────────────────────────────────────────────────────────────────── */

function el(tag: string, cls: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  return e;
}
function button(label: string, variant: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = `stx-btn ${variant}`;
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}
function short(addr: string): string {
  return addr.length > 12 ? `${addr.slice(0, 4)}…${addr.slice(-4)}` : addr;
}
function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  );
}

const FLOW_STYLE = `<style>
.stx-flow { margin-top: 14px; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 14px; }
.stx-flowhead { font-size: 11px; letter-spacing: 2px; color: rgba(255,255,255,0.55); margin-bottom: 10px; }
.stx-clusters { display: flex; gap: 6px; margin-bottom: 12px; }
.stx-cl { background: none; border: 1px solid rgba(255,255,255,0.14); color: rgba(255,255,255,0.6);
  border-radius: 7px; padding: 6px 14px; font-family: inherit; font-size: 11px; letter-spacing: 1px; cursor: pointer; }
.stx-cl.on { color: #fff; border-color: rgba(20,241,149,0.6); background: rgba(20,241,149,0.1); }
.stx-cl.locked { opacity: .5; cursor: not-allowed; }
.stx-flowbody { display: flex; flex-direction: column; gap: 8px; }
.stx-flownote { font-size: 11px; color: rgba(255,255,255,0.45); line-height: 1.5; }
.stx-wallets { display: flex; gap: 6px; flex-wrap: wrap; }
.stx-connected { display: flex; justify-content: space-between; font-size: 11px; color: rgba(255,255,255,0.7);
  border: 1px solid rgba(255,255,255,0.12); border-radius: 8px; padding: 8px 12px; }
.stx-addr { font-family: inherit; color: rgba(255,255,255,0.5); }
.stx-gate { display: flex; flex-direction: column; gap: 8px; }
.stx-gatewarn { font-size: 11px; color: #ff8a8a; line-height: 1.5; }
.stx-gatesub { font-size: 11px; color: rgba(255,255,255,0.5); }
.stx-gateinput { background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.2); color: #fff;
  border-radius: 7px; padding: 8px 10px; font-family: inherit; font-size: 12px; letter-spacing: 2px; }
.stx-flow .stx-btn { font-family: inherit; font-size: 12px; letter-spacing: 1px; border-radius: 9px; padding: 10px 14px;
  cursor: pointer; border: 1px solid rgba(255,255,255,0.18); background: rgba(255,255,255,0.04); color: #fff; text-align: center; text-decoration: none; }
.stx-flow .stx-btn:hover { border-color: rgba(255,255,255,0.45); }
.stx-flow .stx-btn.primary { border-color: rgba(20,241,149,0.5); background: rgba(20,241,149,0.1); color: #b9ffe4; }
.stx-flow .stx-btn.wallet { background: rgba(153,69,255,0.1); border-color: rgba(153,69,255,0.4); }
.stx-flow .stx-btn.link { background: none; border-color: transparent; color: #3bd9ff; padding: 6px 4px; text-align: left; }
.stx-flow .stx-btn:disabled { opacity: .5; cursor: default; }
.stx-done { display: flex; flex-direction: column; gap: 8px; }
.stx-doneh { font-size: 13px; color: #14f195; letter-spacing: 1px; }
.stx-donerow { display: flex; justify-content: space-between; font-size: 11px; color: rgba(255,255,255,0.6); }
.stx-log { font-family: inherit; font-size: 10px; color: rgba(255,255,255,0.45); background: rgba(0,0,0,0.35);
  border-radius: 8px; padding: 8px 10px; margin-top: 12px; max-height: 130px; overflow: auto; white-space: pre-wrap; word-break: break-all; }
.stx-log:empty { display: none; }
</style>`;

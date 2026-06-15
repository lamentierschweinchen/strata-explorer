/**
 * Data sources for the OWNED test entry (mint.html) ONLY — never imported by the art.
 *
 * These exist so the standalone test page can exercise the real capture pipeline without importing
 * the art's `LiveData`/`MockData` (which are statically bundled into the main chunk — importing them
 * here would re-chunk and perturb the art). They share no code with the gallery build.
 *
 *  • RpcLiveSource — a minimal, REAL mainnet reader over plain HTTP JSON-RPC (no WS). It genuinely
 *    reads live slots/epoch/TPS, so `detectLive()` (which keys off the live-only `getTps()`)
 *    correctly marks its captures LIVE and verifiable. Honest.
 *  • DemoSource — synthetic, advancing slots, NO `getTps()` → captures are marked DEMO. Honest.
 */
import type { SolanaCallbacks, SolanaDataSource, EpochInfo, ValidatorInfo } from '../data/DataSource';

interface PerfSample {
  numTransactions: number;
  numSlots: number;
  samplePeriodSecs: number;
  numNonVoteTransactions?: number;
}

/** A real, minimal mainnet reader (HTTP polling) for the test page. */
export class RpcLiveSource implements SolanaDataSource {
  private slot = 0;
  private root = 0;
  private epoch: EpochInfo = { epoch: 0, slotIndex: 0, slotsInEpoch: 432000 };
  private tps = 0;
  private totalTx = 0;
  private timers: number[] = [];

  constructor(private readonly rpcUrl: string) {}

  private async rpc<T>(method: string, params: unknown[] = []): Promise<T> {
    const res = await fetch(this.rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    const json = (await res.json()) as { result?: T; error?: { message: string } };
    if (json.error) throw new Error(`${method}: ${json.error.message}`);
    return json.result as T;
  }

  async initialize(): Promise<void> {
    const e = await this.rpc<{
      epoch: number;
      slotIndex: number;
      slotsInEpoch: number;
      absoluteSlot: number;
      transactionCount?: number;
    }>('getEpochInfo');
    this.epoch = { epoch: e.epoch, slotIndex: e.slotIndex, slotsInEpoch: e.slotsInEpoch };
    this.slot = e.absoluteSlot;
    this.root = e.absoluteSlot - 32;
    this.totalTx = e.transactionCount ?? 0;
  }

  start(_callbacks: SolanaCallbacks): void {
    const poll = (fn: () => Promise<void>, ms: number): void => {
      const id = window.setInterval(() => void fn().catch(() => {}), ms);
      this.timers.push(id);
    };
    poll(async () => {
      this.slot = await this.rpc<number>('getSlot', [{ commitment: 'confirmed' }]);
    }, 800);
    poll(async () => {
      this.root = await this.rpc<number>('getSlot', [{ commitment: 'finalized' }]);
    }, 4000);
    poll(async () => {
      const e = await this.rpc<{ epoch: number; slotIndex: number; slotsInEpoch: number; transactionCount?: number }>(
        'getEpochInfo',
      );
      this.epoch = { epoch: e.epoch, slotIndex: e.slotIndex, slotsInEpoch: e.slotsInEpoch };
      if (e.transactionCount) this.totalTx = e.transactionCount;
    }, 12000);
    poll(async () => {
      const s = await this.rpc<PerfSample[]>('getRecentPerformanceSamples', [1]);
      const sample = s[0];
      if (sample) {
        const nonVote = sample.numNonVoteTransactions ?? sample.numTransactions;
        this.tps = Math.round(nonVote / Math.max(1, sample.samplePeriodSecs));
      }
    }, 20000);
  }

  stop(): void {
    for (const id of this.timers) clearInterval(id);
    this.timers = [];
  }

  getValidators(): ValidatorInfo[] {
    return [];
  }
  getValidator(): ValidatorInfo | null {
    return null;
  }
  getCurrentSlot(): number {
    return this.slot;
  }
  getCurrentLeader(): string | null {
    return null;
  }
  getCurrentLeaderIndex(): number {
    return 0;
  }
  getUpcomingLeaders(): string[] {
    return [];
  }
  getUpcomingLeaderIndices(): number[] {
    return [];
  }
  getRootSlot(): number {
    return this.root;
  }
  getEpochInfo(): EpochInfo {
    return this.epoch;
  }
  /** Live-only: presence of this method is how detectLive() recognizes a real chain source. */
  getTps(): number {
    return this.tps;
  }
  getTotalTransactions(): number {
    return this.totalTx;
  }
}

/** Synthetic source for offline UI testing. No getTps() → captures are honestly marked DEMO. */
export class DemoSource implements SolanaDataSource {
  private slot = 312_000_000;
  private startMs = 0;
  private timer = 0;

  async initialize(): Promise<void> {
    this.startMs = performance.now();
  }
  start(_callbacks: SolanaCallbacks): void {
    // ~2.5 slots/sec, like the real cadence.
    this.timer = window.setInterval(() => (this.slot += 1), 396);
  }
  stop(): void {
    clearInterval(this.timer);
  }
  getValidators(): ValidatorInfo[] {
    return [];
  }
  getValidator(): ValidatorInfo | null {
    return null;
  }
  getCurrentSlot(): number {
    return this.slot;
  }
  getCurrentLeader(): string | null {
    return null;
  }
  getCurrentLeaderIndex(): number {
    return 0;
  }
  getUpcomingLeaders(): string[] {
    return [];
  }
  getUpcomingLeaderIndices(): number[] {
    return [];
  }
  getRootSlot(): number {
    return this.slot - 32;
  }
  getEpochInfo(): EpochInfo {
    const slotsInEpoch = 432000;
    return { epoch: 742, slotIndex: this.slot % slotsInEpoch, slotsInEpoch };
  }
  getTotalTransactions(): number {
    return 380_000_000_000;
  }
}

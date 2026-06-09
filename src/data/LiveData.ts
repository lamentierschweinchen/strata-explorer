import type {
  SolanaDataSource,
  SolanaCallbacks,
  ValidatorInfo,
  EpochInfo,
  TransactionInfo,
} from './DataSource';
import { CONFIG } from '../utils/config';
import { seededRandom, logNormal, randomBase58, cylindricalPosition } from '../utils/math';

// --- Endpoints (env-driven, public-mainnet fallback) ---
// Default is a no-key, browser-CORS-friendly public endpoint. (api.mainnet-beta.solana.com
// returns 403 to browser origins.) Rate-limited under load — set VITE_SOLANA_RPC_HTTP to a
// Helius/Alchemy URL for any real deployment.
const RPC_HTTP =
  import.meta.env.VITE_SOLANA_RPC_HTTP ?? 'https://solana-rpc.publicnode.com';
const RPC_WS =
  import.meta.env.VITE_SOLANA_RPC_WS ?? RPC_HTTP.replace(/^http/i, 'ws');

// --- Tunables ---
const VOTE_REFRESH_MS = 10_000; // getVoteAccounts poll cadence
const PERF_REFRESH_MS = 60_000; // getRecentPerformanceSamples poll cadence
const PARTICIPATION_RATE = 0.97; // real Solana vote participation ≈ 95–99%
const MAX_CATCHUP_SLOTS = 8; // cap slot replay when HTTP-polling
const TX_VISUAL_DIVISOR = 30; // scales real non-vote TPS → on-screen particle budget

// --- Minimal JSON-RPC over HTTP ---
let rpcId = 1;
async function rpc<T>(method: string, params: unknown[] = []): Promise<T> {
  const res = await fetch(RPC_HTTP, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: rpcId++, method, params }),
  });
  if (!res.ok) throw new Error(`${method}: HTTP ${res.status}`);
  const json = await res.json();
  if (json.error) {
    throw new Error(`${method}: ${json.error.message ?? JSON.stringify(json.error)}`);
  }
  return json.result as T;
}

/** Stable 32-bit seed from a pubkey (FNV-1a) so each validator keeps the same position. */
function seedFromPubkey(pubkey: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < pubkey.length; i++) {
    h ^= pubkey.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** "7xKq…3mNp" — fallback name (RPC exposes no human-readable validator names). */
function shortName(pubkey: string): string {
  return pubkey.length > 9 ? `${pubkey.slice(0, 4)}…${pubkey.slice(-4)}` : pubkey;
}

interface VoteAccount {
  votePubkey: string;
  nodePubkey: string;
  activatedStake: number; // lamports
  commission: number; // 0–100
  lastVote: number;
  rootSlot: number;
  epochCredits: Array<[number, number, number]>; // [epoch, credits, prevCredits]
}
interface VoteAccountsResult {
  current: VoteAccount[];
  delinquent: VoteAccount[];
}
interface EpochInfoResult {
  epoch: number;
  slotIndex: number;
  slotsInEpoch: number;
  absoluteSlot: number;
}
interface PerfSample {
  numTransactions: number;
  numNonVoteTransactions?: number;
  numSlots: number;
  samplePeriodSecs: number;
}

/**
 * Live Solana data source. Real chain state via JSON-RPC + WebSocket:
 *   • slot heartbeat .... slotSubscribe (WS) → HTTP getSlot polling fallback
 *   • finality (root) ... rootSubscribe (WS)
 *   • validators ........ getVoteAccounts (stake, commission, votes, delinquency)
 *   • leader rotation ... getLeaderSchedule (joined to validators by identity pubkey)
 *   • epoch ............. getEpochInfo
 *
 * Implements the same interface as MockSolanaData, so main.ts swaps it in directly.
 *
 * PHASE B will replace the transaction subsystem: today the feed/particles are
 * SYNTHETIC, with their volume scaled to the network's real non-vote TPS
 * (getRecentPerformanceSamples) so density tracks real activity. The per-slot vote
 * shimmer is simulated at the real participation rate — delinquent validators stay dark.
 */
export class LiveSolanaData implements SolanaDataSource {
  private validators: ValidatorInfo[] = [];
  private identityToIndex = new Map<string, number>();
  private delinquent = new Set<number>();

  private currentSlot = 0;
  private rootSlot = 0;
  private epoch = 0;
  private slotsInEpoch = 432_000;
  private epochStartSlot = 0;

  private leaderSchedule = new Int32Array(0); // epoch-relative slot index → validator index (-1 = unknown)
  private lastLeaderIndex = 0;

  private callbacks: SolanaCallbacks | null = null;
  private ws: WebSocket | null = null;
  private timers: number[] = [];
  private slotPollTimer: number | null = null;
  private stopped = false;
  private rolling = false;

  private rng = seededRandom(0xc0ffee);
  private targetTps = 900; // refined from getRecentPerformanceSamples

  async initialize(): Promise<void> {
    const e = await rpc<EpochInfoResult>('getEpochInfo');
    this.epoch = e.epoch;
    this.slotsInEpoch = e.slotsInEpoch;
    this.currentSlot = e.absoluteSlot;
    this.rootSlot = e.absoluteSlot;
    this.epochStartSlot = e.absoluteSlot - e.slotIndex;

    await this.loadValidators();
    await this.loadLeaderSchedule();
    await this.refreshTps().catch(() => {});
  }

  /** Build the validator set once (the cloud is constructed from this — indices are fixed after). */
  private async loadValidators(): Promise<void> {
    const r = await rpc<VoteAccountsResult>('getVoteAccounts');
    const rows: Array<{ v: VoteAccount; delinquent: boolean }> = [
      ...r.current.map((v) => ({ v, delinquent: false })),
      ...r.delinquent.map((v) => ({ v, delinquent: true })),
    ];
    rows.sort((a, b) => b.v.activatedStake - a.v.activatedStake);

    const validators: ValidatorInfo[] = [];
    const identityToIndex = new Map<string, number>();
    const delinquent = new Set<number>();

    for (const { v, delinquent: isDel } of rows) {
      if (identityToIndex.has(v.nodePubkey)) continue; // dedupe shared identities
      const position = cylindricalPosition(
        seededRandom(seedFromPubkey(v.nodePubkey)),
        CONFIG.CLOUD_INNER_RADIUS,
        CONFIG.CLOUD_OUTER_RADIUS,
        CONFIG.CLOUD_HEIGHT,
      );
      const index = validators.length;
      validators.push({
        pubkey: v.nodePubkey, // identity pubkey — matches the leader schedule
        name: shortName(v.nodePubkey),
        stake: Math.round(v.activatedStake / 1e9), // lamports → SOL
        commission: v.commission,
        lastVote: v.lastVote,
        epochCredits: v.epochCredits.length ? v.epochCredits[v.epochCredits.length - 1][1] : 0,
        position,
        index,
      });
      identityToIndex.set(v.nodePubkey, index);
      if (isDel) delinquent.add(index);
    }

    this.validators = validators;
    this.identityToIndex = identityToIndex;
    this.delinquent = delinquent;
  }

  /** Refresh mutable fields in place (keeps indices/positions stable for the fixed cloud). */
  private async refreshValidators(): Promise<void> {
    const r = await rpc<VoteAccountsResult>('getVoteAccounts');
    const seen = new Set<number>();
    const apply = (v: VoteAccount, isDel: boolean): void => {
      const idx = this.identityToIndex.get(v.nodePubkey);
      if (idx === undefined) return; // appeared after init; cloud is fixed, ignore
      const val = this.validators[idx];
      val.stake = Math.round(v.activatedStake / 1e9);
      val.commission = v.commission;
      if (v.lastVote > val.lastVote) val.lastVote = v.lastVote;
      if (v.epochCredits.length) val.epochCredits = v.epochCredits[v.epochCredits.length - 1][1];
      if (isDel) this.delinquent.add(idx);
      else this.delinquent.delete(idx);
      seen.add(idx);
    };
    r.current.forEach((v) => apply(v, false));
    r.delinquent.forEach((v) => apply(v, true));
    for (let i = 0; i < this.validators.length; i++) {
      if (!seen.has(i)) this.delinquent.add(i); // dropped from vote accounts → treat as delinquent
    }
  }

  private async loadLeaderSchedule(): Promise<void> {
    const sched = await rpc<Record<string, number[]> | null>('getLeaderSchedule', [null]);
    const arr = new Int32Array(this.slotsInEpoch).fill(-1);
    if (sched) {
      for (const [identity, slots] of Object.entries(sched)) {
        const idx = this.identityToIndex.get(identity);
        if (idx === undefined) continue;
        for (const s of slots) {
          if (s >= 0 && s < arr.length) arr[s] = idx;
        }
      }
    }
    this.leaderSchedule = arr;
  }

  private async refreshTps(): Promise<void> {
    const samples = await rpc<PerfSample[]>('getRecentPerformanceSamples', [1]);
    const s = samples[0];
    if (s && s.samplePeriodSecs > 0) {
      const nonVote = s.numNonVoteTransactions ?? Math.round(s.numTransactions * 0.35);
      this.targetTps = Math.max(1, nonVote / s.samplePeriodSecs);
    }
  }

  start(callbacks: SolanaCallbacks): void {
    this.callbacks = callbacks;
    this.stopped = false;
    callbacks.onValidatorsUpdated(this.validators);

    this.connectWs();

    this.timers.push(
      window.setInterval(() => {
        this.refreshValidators()
          .then(() => this.callbacks?.onValidatorsUpdated(this.validators))
          .catch((err) => console.warn('[live] vote-account refresh failed:', err));
      }, VOTE_REFRESH_MS),
    );
    this.timers.push(
      window.setInterval(() => {
        this.refreshTps().catch(() => {});
      }, PERF_REFRESH_MS),
    );
  }

  stop(): void {
    this.stopped = true;
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onmessage = null;
      try {
        this.ws.close();
      } catch {
        /* ignore */
      }
      this.ws = null;
    }
    if (this.slotPollTimer !== null) {
      clearInterval(this.slotPollTimer);
      this.slotPollTimer = null;
    }
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    this.callbacks = null;
  }

  private connectWs(): void {
    let ws: WebSocket;
    try {
      ws = new WebSocket(RPC_WS);
    } catch (err) {
      console.warn('[live] WebSocket unavailable; using HTTP slot polling.', err);
      this.startSlotPolling();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      ws.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'slotSubscribe', params: [] }));
      ws.send(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'rootSubscribe', params: [] }));
    };
    ws.onmessage = (ev: MessageEvent) => {
      let msg: any;
      try {
        msg = JSON.parse(ev.data as string);
      } catch {
        return;
      }
      if (msg.method === 'slotNotification') {
        const slot = msg.params?.result?.slot;
        if (typeof slot === 'number') this.onNewSlot(slot);
      } else if (msg.method === 'rootNotification') {
        const root = msg.params?.result;
        if (typeof root === 'number') {
          this.rootSlot = root;
          this.callbacks?.onRootAdvance(root);
        }
      }
    };
    ws.onclose = () => {
      this.ws = null;
      if (!this.stopped && this.slotPollTimer === null) {
        console.warn('[live] WebSocket closed; falling back to HTTP slot polling.');
        this.startSlotPolling();
      }
    };
    ws.onerror = () => {
      /* onclose handles the fallback */
    };
  }

  private startSlotPolling(): void {
    if (this.slotPollTimer !== null) return;
    let last = this.currentSlot;
    this.slotPollTimer = window.setInterval(() => {
      rpc<number>('getSlot')
        .then((slot) => {
          if (slot <= last) return;
          const from = Math.max(last + 1, slot - MAX_CATCHUP_SLOTS);
          for (let s = from; s <= slot; s++) this.onNewSlot(s);
          last = slot;
        })
        .catch((err) => console.warn('[live] getSlot poll failed:', err));
    }, CONFIG.SLOT_INTERVAL);
  }

  private onNewSlot(slot: number): void {
    this.currentSlot = slot;
    const slotInEpoch = slot - this.epochStartSlot;
    if (slotInEpoch < 0 || slotInEpoch >= this.slotsInEpoch) this.handleEpochRollover();

    // Per-slot vote shimmer at the real participation rate (delinquents stay dark).
    // Strata derives the vote pulse from validators whose lastVote ≈ currentSlot.
    for (let i = 0; i < this.validators.length; i++) {
      if (this.delinquent.has(i)) continue;
      if (this.rng() < PARTICIPATION_RATE) this.validators[i].lastVote = slot;
    }

    const leaderIdx = this.leaderIndexForSlot(slot);
    if (leaderIdx >= 0) this.lastLeaderIndex = leaderIdx;
    const idx = leaderIdx >= 0 ? leaderIdx : this.lastLeaderIndex;
    const leader = this.validators[idx]?.pubkey ?? '';

    this.callbacks?.onSlot(slot, leader, false);
    this.emitTransactions();
  }

  private handleEpochRollover(): void {
    if (this.rolling) return;
    this.rolling = true;
    rpc<EpochInfoResult>('getEpochInfo')
      .then((e) => {
        this.epoch = e.epoch;
        this.slotsInEpoch = e.slotsInEpoch;
        this.epochStartSlot = e.absoluteSlot - e.slotIndex;
        return this.loadLeaderSchedule();
      })
      .catch((err) => console.warn('[live] epoch rollover refresh failed:', err))
      .finally(() => {
        this.rolling = false;
      });
  }

  private emitTransactions(): void {
    // SYNTHETIC (Phase B replaces with a real, classified stream). Count scaled to real TPS.
    const perSlot = this.targetTps * (CONFIG.SLOT_INTERVAL / 1000);
    const count = Math.min(40, Math.max(1, Math.round(perSlot / TX_VISUAL_DIVISOR)));
    const txs: TransactionInfo[] = [];
    for (let i = 0; i < count; i++) {
      const roll = this.rng();
      const type: TransactionInfo['type'] =
        roll < 0.4 ? 'transfer' : roll < 0.7 ? 'defi' : roll < 0.9 ? 'nft' : 'stake';
      txs.push({ signature: randomBase58(this.rng, 44), type, value: logNormal(this.rng, 0, 2) });
    }
    this.callbacks?.onTransactions(txs);
  }

  private leaderIndexForSlot(slot: number): number {
    const i = slot - this.epochStartSlot;
    if (i < 0 || i >= this.leaderSchedule.length) return -1;
    return this.leaderSchedule[i];
  }

  getValidators(): ValidatorInfo[] {
    return this.validators;
  }

  getValidator(index: number): ValidatorInfo | null {
    return this.validators[index] ?? null;
  }

  getCurrentSlot(): number {
    return this.currentSlot;
  }

  getCurrentLeader(): string | null {
    const v = this.validators[this.getCurrentLeaderIndex()];
    return v ? v.pubkey : null;
  }

  getCurrentLeaderIndex(): number {
    const idx = this.leaderIndexForSlot(this.currentSlot);
    return idx >= 0 ? idx : this.lastLeaderIndex;
  }

  getUpcomingLeaders(count: number): string[] {
    return this.getUpcomingLeaderIndices(count).map((i) => this.validators[i]?.pubkey ?? '');
  }

  getUpcomingLeaderIndices(count: number): number[] {
    const indices: number[] = [];
    const maxLook = count * CONFIG.LEADER_SLOTS * 3;
    for (let i = 1; i <= maxLook && indices.length < count; i++) {
      const idx = this.leaderIndexForSlot(this.currentSlot + i);
      if (idx < 0) continue;
      if (indices.length === 0 || indices[indices.length - 1] !== idx) indices.push(idx);
    }
    return indices;
  }

  getRootSlot(): number {
    return this.rootSlot;
  }

  getEpochInfo(): EpochInfo {
    return {
      epoch: this.epoch,
      slotIndex: Math.max(0, this.currentSlot - this.epochStartSlot),
      slotsInEpoch: this.slotsInEpoch,
    };
  }
}

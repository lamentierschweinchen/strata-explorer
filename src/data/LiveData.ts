import type {
  SolanaDataSource,
  SolanaCallbacks,
  ValidatorInfo,
  EpochInfo,
  TransactionInfo,
} from './DataSource';
import { CONFIG } from '../utils/config';
import { seededRandom, cylindricalPosition } from '../utils/math';

// Default is a no-key, browser-CORS-friendly public endpoint. (api.mainnet-beta.solana.com
// returns 403 to browser origins.) Rate-limited under load — set VITE_SOLANA_RPC_HTTP to a
// Helius/Alchemy URL for any real deployment. Note: the transaction feed (logsSubscribe) needs
// a working WebSocket, which the public node may not provide; a Helius key is recommended.
const RPC_HTTP =
  import.meta.env.VITE_SOLANA_RPC_HTTP ?? 'https://solana-rpc.publicnode.com';
const RPC_WS =
  import.meta.env.VITE_SOLANA_RPC_WS ?? RPC_HTTP.replace(/^http/i, 'ws');

// --- Tunables ---
const VOTE_REFRESH_MS = 10_000; // getVoteAccounts poll cadence
const PERF_REFRESH_MS = 60_000; // getRecentPerformanceSamples poll cadence
const PARTICIPATION_RATE = 0.97; // real Solana vote participation ≈ 95–99%
const MAX_CATCHUP_SLOTS = 8; // cap slot replay when HTTP-polling
const TX_INTAKE_CAP_PER_SEC = 30; // cap real-tx particles/sec against bursts
const TX_FLUSH_MS = 250; // round-robin flush cadence for the diversity selector
const TX_BUCKET_CAP = 24; // per-type buffer cap (drops oldest beyond this)

// RPC resilience: retry network errors / HTTP 429 / 5xx with exponential backoff.
const RPC_MAX_RETRIES = 4;
const RPC_BASE_BACKOFF_MS = 400;
const RPC_MAX_BACKOFF_MS = 8_000;

// WebSocket reconnect: exponential backoff before settling into HTTP slot-polling only.
const WS_MAX_RECONNECT = 6;
const WS_BASE_BACKOFF_MS = 1_000;
const WS_MAX_BACKOFF_MS = 30_000;

/**
 * Transaction feed sources (Phase B): one logsSubscribe per program, classified by which
 * stream fires. Chosen for clean category mapping + bounded bandwidth — measured live, the
 * System/Token programs flood at ~1 MB/s (they touch nearly every tx), so plain transfers
 * are intentionally not streamed. Extend here (e.g. Jupiter for more DeFi) if bandwidth allows.
 */
interface TxProgram {
  category: TransactionInfo['type'];
  /** Human protocol name — a real on-chain fact (the tx touched this program). Feed-safe. */
  protocol: string;
  program: string;
}
const TX_PROGRAMS: ReadonlyArray<TxProgram> = [
  { category: 'defi', protocol: 'Raydium', program: '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8' }, // Raydium AMM v4
  { category: 'nft', protocol: 'Magic Eden', program: 'M2mx93ekt1fmXSVkTrUL9xVFHkmME8HTUi5Cyc5aF7K' }, // Magic Eden v2
  { category: 'stake', protocol: 'Stake Program', program: 'Stake11111111111111111111111111111111111111' }, // Stake program
];

// --- Minimal JSON-RPC over HTTP, with retry/backoff + HTTP 429 handling ---
let rpcId = 1;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Exponential backoff with a cap. attempt 0 → BASE, 1 → 2·BASE, … */
function backoffMs(attempt: number): number {
  return Math.min(RPC_BASE_BACKOFF_MS * 2 ** attempt, RPC_MAX_BACKOFF_MS);
}

/**
 * JSON-RPC call that retries transient failures (network errors, HTTP 429, HTTP 5xx) with
 * exponential backoff. A 429 honors `Retry-After` when present. Deterministic failures (other
 * 4xx, RPC-level `error`) throw immediately so callers' fallbacks (mock, slot-polling) fire
 * without wasting retries.
 */
async function rpc<T>(method: string, params: unknown[] = []): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= RPC_MAX_RETRIES; attempt++) {
    let res: Response;
    try {
      res = await fetch(RPC_HTTP, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: rpcId++, method, params }),
      });
    } catch (err) {
      lastErr = err; // network/CORS/DNS — transient, retry
      if (attempt < RPC_MAX_RETRIES) {
        await sleep(backoffMs(attempt));
        continue;
      }
      break;
    }

    if (res.status === 429 || res.status >= 500) {
      lastErr = new Error(`${method}: HTTP ${res.status}`);
      if (attempt < RPC_MAX_RETRIES) {
        const retryAfter = Number(res.headers.get('retry-after'));
        const wait =
          Number.isFinite(retryAfter) && retryAfter > 0
            ? Math.min(retryAfter * 1000, RPC_MAX_BACKOFF_MS)
            : backoffMs(attempt);
        await sleep(wait);
        continue;
      }
      break;
    }
    if (!res.ok) throw new Error(`${method}: HTTP ${res.status}`); // other 4xx — don't retry

    const json = await res.json();
    if (json.error) {
      throw new Error(`${method}: ${json.error.message ?? JSON.stringify(json.error)}`);
    }
    return json.result as T;
  }
  throw lastErr ?? new Error(`${method}: request failed`);
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

/** "7xKq…3mNp" — used for validator name fallback and real tx signatures in the feed. */
function shorten(s: string): string {
  return s.length > 9 ? `${s.slice(0, 4)}…${s.slice(-4)}` : s;
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
 *   • transactions ...... logsSubscribe per program (Phase B), classified by source program
 *   • TPS ............... getRecentPerformanceSamples (real non-vote throughput)
 *
 * Implements the same interface as MockSolanaData, so main.ts swaps it in directly.
 * The transaction feed shows real signatures classified by program; the per-slot vote
 * shimmer is simulated at the real participation rate (delinquent validators stay dark).
 * The transaction feed requires the WebSocket — if it drops (→ HTTP slot polling), chain
 * state continues but the feed pauses.
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

  // Transaction feed (logsSubscribe) state
  private reqIdToProgram = new Map<number, TxProgram>();
  private subIdToProgram = new Map<number, TxProgram>();
  private txWindowStart = 0;
  private txThisWindow = 0;

  // Diversity selector: per-type buckets flushed round-robin so the feed alternates types
  // instead of showing a run of the same program.
  private txBuckets = new Map<TransactionInfo['type'], TransactionInfo[]>();
  private txFlushTimer: number | null = null;
  private flushRotation = 0;

  // WebSocket reconnect (exponential backoff) before falling back to slot-polling only.
  private wsReconnectAttempts = 0;
  private wsReconnectTimer: number | null = null;

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
        name: shorten(v.nodePubkey),
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

    this.txFlushTimer = window.setInterval(() => this.flushTxBuckets(), TX_FLUSH_MS);

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
    if (this.wsReconnectTimer !== null) {
      clearTimeout(this.wsReconnectTimer);
      this.wsReconnectTimer = null;
    }
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
    if (this.txFlushTimer !== null) {
      clearInterval(this.txFlushTimer);
      this.txFlushTimer = null;
    }
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    this.reqIdToProgram.clear();
    this.subIdToProgram.clear();
    this.txBuckets.clear();
    this.callbacks = null;
  }

  private connectWs(): void {
    let ws: WebSocket;
    try {
      ws = new WebSocket(RPC_WS);
    } catch (err) {
      console.warn('[live] WebSocket unavailable; using HTTP slot polling (no tx feed).', err);
      this.startSlotPolling();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      ws.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'slotSubscribe', params: [] }));
      ws.send(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'rootSubscribe', params: [] }));
      // Transaction feed: one logsSubscribe per program, ids 100+.
      let reqId = 100;
      for (const meta of TX_PROGRAMS) {
        const id = reqId++;
        this.reqIdToProgram.set(id, meta);
        ws.send(
          JSON.stringify({
            jsonrpc: '2.0',
            id,
            method: 'logsSubscribe',
            params: [{ mentions: [meta.program] }, { commitment: 'processed' }],
          }),
        );
      }
    };
    ws.onmessage = (ev: MessageEvent) => {
      let msg: any;
      try {
        msg = JSON.parse(ev.data as string);
      } catch {
        return;
      }
      // logsSubscribe confirmation → map subscription id to its program meta
      if (typeof msg.id === 'number' && this.reqIdToProgram.has(msg.id) && typeof msg.result === 'number') {
        this.subIdToProgram.set(msg.result, this.reqIdToProgram.get(msg.id)!);
        return;
      }
      if (msg.method === 'slotNotification') {
        this.onWsHealthy(); // WS is delivering → reset backoff, retire the polling fallback
        const slot = msg.params?.result?.slot;
        if (typeof slot === 'number') this.onNewSlot(slot);
      } else if (msg.method === 'rootNotification') {
        const root = msg.params?.result;
        if (typeof root === 'number') {
          this.rootSlot = root;
          this.callbacks?.onRootAdvance(root);
        }
      } else if (msg.method === 'logsNotification') {
        const meta = this.subIdToProgram.get(msg.params?.subscription);
        const result = msg.params?.result;
        const value = result?.value;
        if (meta && value && value.err === null && typeof value.signature === 'string') {
          const slot = typeof result?.context?.slot === 'number' ? result.context.slot : undefined;
          const logCount = Array.isArray(value.logs) ? value.logs.length : 0;
          this.onRealTransaction(meta, value.signature, slot, logCount);
        }
      }
    };
    ws.onclose = () => {
      this.ws = null;
      this.subIdToProgram.clear();
      if (this.stopped) return;
      // Keep chain state flowing immediately, then try to restore the WS (and the tx feed).
      this.startSlotPolling();
      this.scheduleWsReconnect();
    };
    ws.onerror = () => {
      /* onclose handles the fallback + reconnect */
    };
  }

  /** WS is actively delivering notifications: reset backoff and retire the polling fallback. */
  private onWsHealthy(): void {
    this.wsReconnectAttempts = 0;
    if (this.slotPollTimer !== null) {
      clearInterval(this.slotPollTimer);
      this.slotPollTimer = null;
    }
  }

  /** Reconnect the WebSocket with exponential backoff; give up to slot-polling after the cap. */
  private scheduleWsReconnect(): void {
    if (this.stopped || this.wsReconnectTimer !== null) return;
    if (this.wsReconnectAttempts >= WS_MAX_RECONNECT) {
      console.warn('[live] WebSocket reconnect attempts exhausted; staying on HTTP slot polling (tx feed paused).');
      return;
    }
    const delay = Math.min(WS_BASE_BACKOFF_MS * 2 ** this.wsReconnectAttempts, WS_MAX_BACKOFF_MS);
    this.wsReconnectAttempts++;
    console.warn(
      `[live] WebSocket closed; reconnecting in ${delay}ms (attempt ${this.wsReconnectAttempts}/${WS_MAX_RECONNECT}).`,
    );
    this.wsReconnectTimer = window.setTimeout(() => {
      this.wsReconnectTimer = null;
      if (!this.stopped) this.connectWs();
    }, delay);
  }

  /**
   * Real, successful transaction from a watched program. Rate-capped, enriched with real
   * metadata (protocol name + landing slot), then bucketed for the diversity selector — it is
   * NOT emitted immediately, so flushTxBuckets() can interleave types. `value` is a real coarse
   * magnitude (log volume ≈ tx complexity) and drives particle size only; it is never displayed.
   */
  private onRealTransaction(
    meta: TxProgram,
    signature: string,
    slot: number | undefined,
    logCount: number,
  ): void {
    const now = performance.now();
    if (now - this.txWindowStart > 1000) {
      this.txWindowStart = now;
      this.txThisWindow = 0;
    }
    if (this.txThisWindow >= TX_INTAKE_CAP_PER_SEC) return;
    this.txThisWindow++;

    const tx: TransactionInfo = {
      signature,
      type: meta.category,
      value: Math.max(1, logCount), // real on-chain log volume → particle size only
      detail: shorten(signature), // real signature shown in the feed
      protocol: meta.protocol, // real: the tx touched this program
    };
    if (slot !== undefined) tx.slot = slot; // real landing slot

    let bucket = this.txBuckets.get(meta.category);
    if (!bucket) {
      bucket = [];
      this.txBuckets.set(meta.category, bucket);
    }
    bucket.push(tx);
    if (bucket.length > TX_BUCKET_CAP) bucket.splice(0, bucket.length - TX_BUCKET_CAP);
  }

  /** Drain the per-type buckets in round-robin order so the feed alternates transaction types. */
  private flushTxBuckets(): void {
    if (this.txBuckets.size === 0) return;
    const order = TX_PROGRAMS.map((p) => p.category);
    const out: TransactionInfo[] = [];
    let drained = true;
    while (drained) {
      drained = false;
      for (let k = 0; k < order.length; k++) {
        const cat = order[(k + this.flushRotation) % order.length];
        const bucket = this.txBuckets.get(cat);
        if (bucket && bucket.length > 0) {
          out.push(bucket.shift()!);
          drained = true;
        }
      }
    }
    this.flushRotation = (this.flushRotation + 1) % order.length;
    if (out.length > 0) this.callbacks?.onTransactions(out);
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

  getTps(): number {
    return Math.round(this.targetTps);
  }
}

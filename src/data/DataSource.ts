export interface SolanaDataSource {
  initialize(): Promise<void>;
  start(callbacks: SolanaCallbacks): void;
  stop(): void;
  getValidators(): ValidatorInfo[];
  getValidator(index: number): ValidatorInfo | null;
  getCurrentSlot(): number;
  getCurrentLeader(): string | null;
  getCurrentLeaderIndex(): number;
  getUpcomingLeaders(count: number): string[];
  getUpcomingLeaderIndices(count: number): number[];
  getRootSlot(): number;
  getEpochInfo(): EpochInfo;
  /** Real network TPS for the HUD headline (optional; HUD falls back to particle spawn rate). */
  getTps?(): number;
  /** Lifetime transaction count of the chain (optional) — the HUD's big TRANSACTIONS stat. */
  getTotalTransactions?(): number;
}

export interface SolanaCallbacks {
  onSlot: (slot: number, leader: string, missed: boolean) => void;
  onValidatorsUpdated: (validators: ValidatorInfo[]) => void;
  onTransactions: (txs: TransactionInfo[]) => void;
  onRootAdvance: (rootSlot: number) => void;
}

export interface ValidatorInfo {
  pubkey: string;
  name: string;
  stake: number;
  commission: number;
  lastVote: number;
  epochCredits: number;
  position: { x: number; y: number; z: number };
  index: number;
}

export interface TransactionInfo {
  signature: string;
  type: 'transfer' | 'defi' | 'nft' | 'stake';
  /**
   * Coarse magnitude used ONLY for visual particle sizing/brightness (never displayed as an
   * amount). Live mode derives this from real on-chain log volume (tx complexity); mock mode
   * samples a log-normal. See TransactionPool.spawn for the size curve.
   */
  value: number;
  /** Optional feed display override (live uses the real, truncated signature). */
  detail?: string;

  // --- Additive enrichment (Data lane). All optional so existing consumers keep compiling. ---

  /**
   * Real protocol/program name the transaction touched, e.g. "Raydium", "Magic Eden",
   * "Stake Program". Derived from which watched program's logsSubscribe stream fired — it is a
   * genuine on-chain fact, not a guess. Safe to display in the feed. Undefined in mock-derived
   * synthetic edge cases.
   */
  protocol?: string;

  /**
   * Real landing slot reported by the RPC (logsNotification context.slot). Genuine on-chain
   * fact; safe to display (e.g. an explorer deep-link or "slot 281,234,567").
   */
  slot?: number;

  /**
   * Marks a VISUAL-ONLY synthetic density particle emitted by SimulationEngine to match real
   * network TPS. These carry no real signature and MUST NEVER enter the human-readable feed.
   * Real transactions leave this undefined. Defense-in-depth: feed code may also skip any tx
   * where this is true. See src/data/INTEGRATION.md.
   */
  synthetic?: boolean;
}

export interface EpochInfo {
  epoch: number;
  slotIndex: number;
  slotsInEpoch: number;
}

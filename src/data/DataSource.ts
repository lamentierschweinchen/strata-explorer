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
  type: 'transfer' | 'program' | 'token' | 'defi';
  value: number;
}

export interface EpochInfo {
  epoch: number;
  slotIndex: number;
  slotsInEpoch: number;
}

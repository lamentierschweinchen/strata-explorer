import type { SolanaDataSource, SolanaCallbacks, ValidatorInfo, TransactionInfo, EpochInfo } from './DataSource';
import { CONFIG } from '../utils/config';
import { seededRandom, logNormal, randomBase58, cylindricalPosition } from '../utils/math';

const VALIDATOR_NAMES = [
  'Chorus One', 'Everstake', 'Figment', 'Marinade', 'Jito', 'Helius',
  'Coinbase Cloud', 'Laine', 'Triton', 'Solana Compass', 'Stakewiz',
  'mrgn', 'Overclock', 'Zantetsu', 'Shinobi Systems', 'Cogent Crypto',
  'Staking Facilities', 'P2P Validator', 'Blockdaemon', 'InfStones',
  'HashQuark', 'Certus One', 'Forbole', 'StakeHaus', 'DeFi Dojo',
  'Sol Patrol', 'Node Monster', 'Crypto Crew', 'Solana Beach', 'SolFlare',
  'Phantom Stake', 'Jupiter Stake', 'Drift Validators', 'Orca Pool',
  'Raydium Node', 'Tensor Stake', 'Magic Eden Val', 'Metaplex Node',
  'Wormhole Guard', 'Pyth Network', 'Switchboard', 'Genesys Go',
  'Shadow Drive', 'Render Network', 'Helium IOT', 'Hivemapper Node',
];

export class MockSolanaData implements SolanaDataSource {
  private validators: ValidatorInfo[] = [];
  private currentSlot = 280_000_000;
  private rootSlot = 280_000_000 - 30;
  private epoch = 650;
  private slotsInEpoch = 432_000;
  private leaderSchedule: number[] = [];
  private callbacks: SolanaCallbacks | null = null;
  private intervalId: number | null = null;
  private rng: () => number;
  private burstUntil = 0;

  constructor() {
    this.rng = seededRandom(42);
  }

  async initialize(): Promise<void> {
    this.generateValidators();
    this.generateLeaderSchedule();
  }

  start(callbacks: SolanaCallbacks): void {
    this.callbacks = callbacks;
    callbacks.onValidatorsUpdated(this.validators);

    this.intervalId = window.setInterval(() => {
      this.tick();
    }, CONFIG.SLOT_INTERVAL);
  }

  stop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.callbacks = null;
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
    const idx = this.getCurrentLeaderIndex();
    return idx >= 0 ? this.validators[idx].pubkey : null;
  }

  getCurrentLeaderIndex(): number {
    const scheduleIdx = this.currentSlot % this.leaderSchedule.length;
    return this.leaderSchedule[scheduleIdx];
  }

  getUpcomingLeaders(count: number): string[] {
    return this.getUpcomingLeaderIndices(count).map(i => this.validators[i].pubkey);
  }

  getUpcomingLeaderIndices(count: number): number[] {
    const indices: number[] = [];
    for (let i = 1; i <= count * 4; i++) {
      const scheduleIdx = (this.currentSlot + i) % this.leaderSchedule.length;
      const valIdx = this.leaderSchedule[scheduleIdx];
      if (indices.length === 0 || indices[indices.length - 1] !== valIdx) {
        indices.push(valIdx);
      }
      if (indices.length >= count) break;
    }
    return indices;
  }

  getRootSlot(): number {
    return this.rootSlot;
  }

  getEpochInfo(): EpochInfo {
    return {
      epoch: this.epoch,
      slotIndex: this.currentSlot % this.slotsInEpoch,
      slotsInEpoch: this.slotsInEpoch,
    };
  }

  private generateValidators(): void {
    for (let i = 0; i < CONFIG.VALIDATOR_COUNT; i++) {
      const stake = logNormal(this.rng, 13.3, 1.2); // median ~620K SOL
      const commission = Math.min(10, Math.max(0, Math.round(this.rng() * 4 + 4))); // 4-8%, clustered around 5-7
      if (this.rng() < 0.15) {
        // 15% chance of low commission (0-2%)
      }
      const pos = cylindricalPosition(
        this.rng,
        CONFIG.CLOUD_INNER_RADIUS,
        CONFIG.CLOUD_OUTER_RADIUS,
        CONFIG.CLOUD_HEIGHT,
      );

      this.validators.push({
        pubkey: randomBase58(this.rng, 44),
        name: VALIDATOR_NAMES[i % VALIDATOR_NAMES.length] + (i >= VALIDATOR_NAMES.length ? ` #${Math.floor(i / VALIDATOR_NAMES.length) + 1}` : ''),
        stake: Math.round(stake),
        commission: this.rng() < 0.15 ? Math.round(this.rng() * 2) : commission,
        lastVote: this.currentSlot - Math.floor(this.rng() * 5),
        epochCredits: Math.round(300_000 + this.rng() * 100_000),
        position: pos,
        index: i,
      });
    }
  }

  private generateLeaderSchedule(): void {
    // Stake-weighted selection, each leader gets 4 consecutive slots
    const totalStake = this.validators.reduce((sum, v) => sum + v.stake, 0);
    const scheduleLength = 4 * 1000; // 1000 leaders per schedule

    this.leaderSchedule = [];
    for (let i = 0; i < scheduleLength / 4; i++) {
      let pick = this.rng() * totalStake;
      let chosen = 0;
      for (let v = 0; v < this.validators.length; v++) {
        pick -= this.validators[v].stake;
        if (pick <= 0) { chosen = v; break; }
      }
      // 4 consecutive slots per leader
      for (let s = 0; s < 4; s++) {
        this.leaderSchedule.push(chosen);
      }
    }
  }

  private tick(): void {
    this.currentSlot++;
    const slotInSchedule = this.currentSlot % this.leaderSchedule.length;
    const leaderIdx = this.leaderSchedule[slotInSchedule];
    const leader = this.validators[leaderIdx].pubkey;

    // 5% missed slot rate
    const missed = this.rng() < 0.05;

    // Advance finality (root follows ~30 slots behind)
    if (this.currentSlot - this.rootSlot > 32) {
      this.rootSlot += 1 + Math.floor(this.rng() * 2);
      this.callbacks?.onRootAdvance(this.rootSlot);
    }

    // Fire slot callback
    this.callbacks?.onSlot(this.currentSlot, leader, missed);

    if (!missed) {
      // Update validator votes (~95-98% participation)
      for (const v of this.validators) {
        if (this.rng() < 0.97) {
          v.lastVote = this.currentSlot;
        }
      }

      // Generate transactions
      const now = performance.now();
      if (now > this.burstUntil) {
        // Check for burst (every ~30s)
        if (this.rng() < 0.013) { // ~0.013 chance per 400ms ≈ once per 30s
          this.burstUntil = now + 5000; // 5s burst
        }
      }

      const isBurst = now < this.burstUntil;
      const txCount = Math.floor(5 + this.rng() * 15) * (isBurst ? 2 : 1);

      const transactions: TransactionInfo[] = [];
      for (let i = 0; i < txCount; i++) {
        const roll = this.rng();
        let type: TransactionInfo['type'];
        if (roll < 0.4) type = 'transfer';
        else if (roll < 0.7) type = 'program';
        else if (roll < 0.9) type = 'token';
        else type = 'defi';

        transactions.push({
          signature: randomBase58(this.rng, 88),
          type,
          value: logNormal(this.rng, 0, 2), // most small, occasional large
        });
      }

      this.callbacks?.onTransactions(transactions);
    }
  }
}

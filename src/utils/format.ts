/**
 * Shared display-only number/string formatters for The Strata UI.
 *
 * Adapted from the project's Solana number-formatting conventions (see HUD/Tooltip)
 * and the number-formatting spec. Display-only — internal math keeps raw precision.
 *
 * Honesty guarantees (every formatter upholds these):
 *   • null / undefined / NaN / ±Infinity  → "--"  (never "NaN"/"undefined"/crash)
 *   • never scientific notation
 *   • never signed zero ("-0.00")
 *
 * Pure, dependency-free. Safe to adopt in any lane.
 */

/** Rendered for missing / invalid / non-finite values. */
export const PLACEHOLDER = '--';

/** Ellipsis used for all address/signature truncation (matches LiveData's `shorten`). */
const ELLIPSIS = '…'; // …

const SUBSCRIPT_DIGITS = ['₀', '₁', '₂', '₃', '₄', '₅', '₆', '₇', '₈', '₉'];

function isInvalid(n: number | null | undefined): n is null | undefined {
  return n == null || !Number.isFinite(n);
}

/** Collapse -0 (and sub-epsilon magnitudes) to +0 so we never emit a signed zero. */
function normalizeZero(n: number): number {
  return Object.is(n, -0) || Math.abs(n) < 1e-12 ? 0 : n;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/** `"1.50" → "1.5"`, `"1.00" → "1"`. Leaves the integer part untouched. */
function trimTrailingZeros(s: string): string {
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
}

/** Count zeros immediately after the decimal point, before the first significant digit. */
function leadingZeros(abs: number): number {
  if (abs >= 1) return 0;
  const decimals = abs.toFixed(20).split('.')[1] ?? '';
  const match = decimals.match(/^0+/);
  return match ? match[0].length : 0;
}

/** `0.00005835 → "0.0₄58"` (sig=2) / `"0.0₄5835"` (sig=4). For micro token amounts/prices. */
function withSubscript(abs: number, sig: number): string {
  const lz = leadingZeros(abs);
  const total = lz + sig;
  const fixed = abs.toFixed(total);
  const decimals = fixed.split('.')[1] ?? '';
  const sigStr = decimals.slice(lz, lz + sig).replace(/0+$/, '') || '0';
  const sub = String(lz)
    .split('')
    .map((d) => SUBSCRIPT_DIGITS[Number(d)])
    .join('');
  return `0.0${sub}${sigStr}`;
}

const UNITS: ReadonlyArray<readonly [number, string]> = [
  [1e12, 'T'],
  [1e9, 'B'],
  [1e6, 'M'],
  [1e3, 'K'],
];

/**
 * Compact magnitude: `1234 → "1.2K"`, `1_500_000 → "1.5M"`, `2.4e9 → "2.4B"`.
 * Below 1,000 the value passes through (trimmed to `decimals`). Trims a trailing `.0`.
 */
export function formatCompact(value: number | null | undefined, decimals = 1): string {
  if (isInvalid(value)) return PLACEHOLDER;
  const v = normalizeZero(value);
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';

  if (abs < 1000) {
    return sign + trimTrailingZeros(abs.toFixed(Number.isInteger(abs) ? 0 : decimals));
  }
  for (const [threshold, suffix] of UNITS) {
    if (abs >= threshold) {
      return sign + trimTrailingZeros((abs / threshold).toFixed(decimals)) + suffix;
    }
  }
  // Unreachable (abs >= 1000 always matches a unit), but keeps the return total.
  return sign + String(Math.round(abs));
}

/** Large integer with thousands separators: `280000000 → "280,000,000"`. Matches the HUD. */
export function formatCount(value: number | null | undefined): string {
  if (isInvalid(value)) return PLACEHOLDER;
  return Math.round(normalizeZero(value)).toLocaleString('en-US');
}

/**
 * Token quantity. Compact by default (abbreviates ≥ 1K, micro values use zero-subscript).
 * `priceUsd` enables dynamic decimals (hidden USD value from rounding stays under threshold);
 * without it, falls back to sensible decimals (flagged approximate).
 */
export function formatTokenAmount(
  value: number | null | undefined,
  opts: { priceUsd?: number; compact?: boolean } = {},
): string {
  if (isInvalid(value)) return PLACEHOLDER;
  const { priceUsd, compact = true } = opts;
  const v = normalizeZero(value);
  if (v === 0) return '0';

  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';

  if (compact && abs >= 1000) return sign + formatCompact(abs);

  if (leadingZeros(abs) >= 3) return sign + withSubscript(abs, compact ? 2 : 4);

  let decimals: number;
  if (priceUsd && priceUsd > 0) {
    const threshold = compact ? 0.01 : 0.0001;
    decimals = clamp(Math.ceil(-Math.log10(threshold / priceUsd)), 0, compact ? 6 : 12);
  } else {
    decimals = abs < 1 ? 6 : 4;
  }

  const rounded = Number(abs.toFixed(decimals));
  if (rounded === 0) return compact ? '<0.001' : `<${(1 / 10 ** decimals).toFixed(decimals)}`;
  return sign + trimTrailingZeros(abs.toFixed(decimals));
}

/** Token amount with a ` SOL` suffix. */
export function formatSol(value: number | null | undefined, opts?: { compact?: boolean }): string {
  const amount = formatTokenAmount(value, opts);
  return amount === PLACEHOLDER ? PLACEHOLDER : `${amount} SOL`;
}

/**
 * Percentage. `12.345 → "12.35%"`, `123.4 → "123.4%"`, `10250.4 → "10,250%"`, `0.004 → "<0.01%"`.
 * `sign: 'always'` prefixes a `+` on positives (for deltas/PnL).
 */
export function formatPercent(
  value: number | null | undefined,
  opts: { sign?: 'auto' | 'always' } = {},
): string {
  if (isInvalid(value)) return PLACEHOLDER;
  const v = normalizeZero(value);
  if (v === 0) return '0.00%';

  const abs = Math.abs(v);
  const neg = v < 0;
  const decimals = abs >= 1000 ? 0 : abs >= 100 ? 1 : 2;

  if (Number(abs.toFixed(decimals)) === 0) {
    return `${neg ? '-' : opts.sign === 'always' ? '+' : ''}<0.01%`;
  }

  const core = decimals === 0 ? Math.round(abs).toLocaleString('en-US') : abs.toFixed(decimals);
  const prefix = neg ? '-' : opts.sign === 'always' ? '+' : '';
  return `${prefix}${core}%`;
}

/**
 * Shorten a base58 address / signature: `"7xKq…3mNp"`. Returns "" for empty input and
 * leaves already-short strings untouched.
 */
export function shortenAddress(addr: string | null | undefined, lead = 4, tail = 4): string {
  if (!addr) return '';
  return addr.length <= lead + tail + 1 ? addr : `${addr.slice(0, lead)}${ELLIPSIS}${addr.slice(-tail)}`;
}

/** Shorten a transaction signature (4+4). Alias of {@link shortenAddress}. */
export function shortenSignature(sig: string | null | undefined): string {
  return shortenAddress(sig, 4, 4);
}

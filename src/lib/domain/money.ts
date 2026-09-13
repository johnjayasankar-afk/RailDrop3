/**
 * Money is always integer cents. No floats anywhere in pricing arithmetic.
 */

export type Cents = number;

export class MoneyError extends Error {}

export function assertCents(value: number, label = 'amount'): Cents {
  if (!Number.isFinite(value)) throw new MoneyError(`${label} must be finite, got ${value}`);
  if (!Number.isInteger(value))
    throw new MoneyError(`${label} must be integer cents, got ${value}`);
  if (value < 0) throw new MoneyError(`${label} must not be negative, got ${value}`);
  return value;
}

/**
 * Parse a user-entered dollar string/number into integer cents.
 * Accepts "128", "128.5", "128.50", "$1,284.00". Rejects anything else.
 */
export function dollarsToCents(input: string | number): Cents {
  const raw = typeof input === 'number' ? String(input) : input.trim();
  // Strip currency symbol and whitespace, but validate comma placement rather
  // than blindly deleting commas - '1,2,3' and '12,' are typos, not amounts.
  const stripped = raw.replace(/[$\s]/g, '');
  const grouped = /^\d{1,3}(,\d{3})+(\.\d{1,2})?$/;
  const plain = /^\d+(\.\d{1,2})?$/;
  if (!grouped.test(stripped) && !plain.test(stripped)) {
    throw new MoneyError(`Not a valid dollar amount: ${JSON.stringify(input)}`);
  }
  const cleaned = stripped.replace(/,/g, '');
  const [whole = '0', frac = ''] = cleaned.split('.');
  const cents = frac.padEnd(2, '0');
  return assertCents(Number(whole) * 100 + Number(cents));
}

/** Multiply cents by a whole number of passengers. Never introduces a fractional cent. */
export function multiplyCents(amount: Cents, factor: number): Cents {
  assertCents(amount);
  if (!Number.isInteger(factor) || factor < 1) {
    throw new MoneyError(`factor must be a positive integer, got ${factor}`);
  }
  return amount * factor;
}

export function formatCents(amount: Cents, opts: { showCents?: boolean } = {}): string {
  assertCents(amount);
  const showCents = opts.showCents ?? amount % 100 !== 0;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: showCents ? 2 : 0,
    maximumFractionDigits: showCents ? 2 : 0,
  }).format(amount / 100);
}

/** Compact form used in dense UI (cards, email subject): $74, $1,284 */
export function formatCentsCompact(amount: Cents): string {
  return formatCents(amount, { showCents: false });
}

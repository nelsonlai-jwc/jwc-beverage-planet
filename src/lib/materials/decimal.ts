// Fixed-point helpers for live cost previews. Money is never added up in
// binary floating point (design plan ch. 7.3); the database does the real
// calculation, these only mirror its division for the form summary.

const DECIMAL = /^\d+(\.\d+)?$/;

type Scaled = { value: bigint; scale: number };

function parse(input: string): Scaled | null {
  const text = input.trim();
  if (!DECIMAL.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  return { value: BigInt(whole + fraction), scale: fraction.length };
}

/** True for a non-negative decimal such as "6.35". */
export function isDecimal(input: string): boolean {
  return parse(input) !== null;
}

/** True for a decimal greater than zero. */
export function isPositiveDecimal(input: string): boolean {
  const parsed = parse(input);
  return parsed !== null && parsed.value > BigInt(0);
}

/**
 * price ÷ quantity, rounded half up to `digits` decimals, as a string.
 * Returns null when either value is missing or invalid, and "DIV_ZERO" when
 * the quantity is zero, so the caller never shows Infinity or RM0.00.
 */
export function divide(price: string, quantity: string, digits = 6): string | null {
  const p = parse(price);
  const q = parse(quantity);
  if (!p || !q) return null;
  if (q.value === BigInt(0)) return "DIV_ZERO";
  // (p / 10^ps) / (q / 10^qs) * 10^(digits + 1), then round on the last digit.
  const numerator = p.value * BigInt(10) ** BigInt(q.scale + digits + 1);
  const denominator = q.value * BigInt(10) ** BigInt(p.scale);
  const raw = numerator / denominator;
  const rounded = (raw + BigInt(5)) / BigInt(10);
  const text = rounded.toString().padStart(digits + 1, "0");
  return `${text.slice(0, -digits)}.${text.slice(-digits)}`;
}

/** Unit cost for display: up to 6 decimals, at least 2, e.g. 0.00635. */
export function formatUnitCost(value: string | number): string {
  const text = typeof value === "number" ? value.toFixed(6) : value;
  const [whole, fraction = ""] = text.split(".");
  const trimmed = fraction.replace(/0+$/, "").padEnd(2, "0");
  return `${whole}.${trimmed}`;
}

/** Money for display, 2 decimals. */
export function formatMoney(value: number): string {
  return value.toFixed(2);
}

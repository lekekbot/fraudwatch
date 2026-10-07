export const SOL_DECIMALS = 9;

/** Format an integer base-unit string (lamports, raw token amount) as a decimal, trimming trailing zeros. */
export function formatBaseUnits(amount: string, decimals: number): string {
  const negative = amount.startsWith("-");
  const digits = (negative ? amount.slice(1) : amount).replace(/^0+/, "") || "0";
  const padded = digits.padStart(decimals + 1, "0");
  const whole = padded.slice(0, padded.length - decimals);
  const fraction = padded.slice(padded.length - decimals).replace(/0+$/, "");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const value = fraction ? `${grouped}.${fraction}` : grouped;
  return negative && value !== "0" ? `-${value}` : value;
}

export function formatLamports(lamports: string): string {
  return `${formatBaseUnits(lamports, SOL_DECIMALS)} SOL`;
}

/**
 * A decimal string typed by a user ("1.5") as base units for `decimals`
 * ("1500000" at 6). Null when it isn't a plain non-negative number or has more
 * fraction digits than the asset allows.
 */
export function parseUnits(text: string, decimals: number): string | null {
  const match = /^(\d*)(?:\.(\d*))?$/.exec(text.trim());
  if (!match || (match[1] === "" && (match[2] ?? "") === "")) return null;
  const [, whole, fraction = ""] = match;
  if (fraction.length > decimals) return null;
  return BigInt(`${whole || "0"}${fraction.padEnd(decimals, "0")}`).toString();
}

export const abs = (v: bigint) => (v < 0n ? -v : v);

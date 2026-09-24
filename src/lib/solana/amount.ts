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

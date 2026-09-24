import { isValidSolanaAddress } from "@/lib/solana/address";
import { type CaseRange, isValidRange, rangeFromUnix, rangeToUnix } from "@/lib/case/range";

/**
 * Simple startup URL: /map?wallet=<address>&from=<unix>&to=<unix>
 *
 * Only these three keys are ever read or written. Labels, RPC settings, and
 * fetched data must never be encoded in query parameters.
 */
export const MAP_PARAM_KEYS = ["wallet", "from", "to"] as const;

export type MapParams = { wallet: string; range: CaseRange };

export type MapParamsResult =
  | { ok: true; value: MapParams }
  | { ok: false; error: string; partial: { wallet?: string; range?: CaseRange } };

function parseUnix(value: string | null): number | null {
  if (value === null || !/^\d{1,12}$/.test(value)) return null;
  return Number(value);
}

export function parseMapParams(params: URLSearchParams): MapParamsResult {
  const walletRaw = params.get("wallet")?.trim() ?? "";
  const from = parseUnix(params.get("from"));
  const to = parseUnix(params.get("to"));

  const wallet = isValidSolanaAddress(walletRaw) ? walletRaw : undefined;
  const range = from !== null && to !== null ? rangeFromUnix(from, to) : undefined;

  if (!walletRaw) return { ok: false, error: "Missing wallet parameter.", partial: { range } };
  if (!wallet) return { ok: false, error: "The wallet parameter is not a valid Solana address.", partial: { range } };
  if (from === null || to === null) return { ok: false, error: "from and to must be unix timestamps in seconds.", partial: { wallet } };
  if (!range || !isValidRange(range)) return { ok: false, error: "from must be earlier than to.", partial: { wallet } };
  return { ok: true, value: { wallet, range } };
}

export function buildMapSearch(value: MapParams): string {
  const { from, to } = rangeToUnix(value.range);
  return new URLSearchParams({ wallet: value.wallet, from: String(from), to: String(to) }).toString();
}

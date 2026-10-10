import type { AssetMetadata } from "@/lib/assets/assets";
import { NATIVE_SOL } from "@/lib/assets/assets";
import { formatBaseUnits } from "@/lib/solana/amount";
import { shortenAddress } from "@/lib/solana/address";
import type { WalletState } from "@/lib/state/reconstruct";

export type Assets = Map<string, AssetMetadata>;

export function assetLabel(assetId: string, assets: Assets): string {
  const meta = assets.get(assetId);
  return meta?.symbol || meta?.name || shortenAddress(assetId, 4);
}

const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";

/** Stored metadata wins; the registry CDN covers common SPL tokens without another API request. */
export function assetLogo(assetId: string, assets: Assets): string | undefined {
  const stored = assets.get(assetId)?.logo;
  if (stored?.startsWith("https://")) return stored;
  if (assetId === NATIVE_SOL) return "https://assets-cdn.trustwallet.com/blockchains/solana/info/logo.png";
  if (assetId === BONK) return "https://coin-images.coingecko.com/coins/images/28600/large/bonk.jpg";
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(assetId)
    ? `https://assets-cdn.trustwallet.com/blockchains/solana/assets/${assetId}/logo.png`
    : undefined;
}

/** Base-unit amount as a decimal, using the decimals the transactions reported. */
export function formatAssetAmount(value: string, assetId: string, state: WalletState, assets: Assets, signed = false): string {
  const decimals = state.decimals[assetId] ?? assets.get(assetId)?.decimals ?? 0;
  const text = formatBaseUnits(value, decimals);
  return signed && !value.startsWith("-") && value !== "0" ? `+${text}` : text;
}

const COMPACT = new Intl.NumberFormat("en", { notation: "compact", maximumSignificantDigits: 3 });

/**
 * A formatted amount ("1,234,567.89") shortened to "1.23M" for canvas cards.
 * Below 1,000 it's left exact, so small and dust amounts never round away.
 * Only for glanceable labels: inspectors, tables and copies stay exact.
 */
export function compactAmount(text: string): string {
  const negative = text.startsWith("-");
  const value = Number(text.replace(/[-+,]/g, ""));
  if (!Number.isFinite(value) || value < 1000) return text;
  return `${negative ? "-" : text.startsWith("+") ? "+" : ""}${COMPACT.format(value)}`;
}

/** Text colour for a signed change: red out, green in, muted for none. */
export const deltaClass = (delta: string) => (delta.startsWith("-") ? "text-destructive" : delta !== "0" ? "text-emerald-500" : "text-muted-foreground");

export function formatUtc(timestamp: string | number | null): string {
  if (timestamp === null) return "—";
  return new Date(timestamp).toISOString().slice(0, 19).replace("T", " ");
}

/** "YYYY-MM-DD HH:MM", for times where seconds are noise. */
export function formatUtcMinute(timestamp: string | number): string {
  return new Date(timestamp).toISOString().slice(0, 16).replace("T", " ");
}

/** One NFT's name, or "3 NFTs" for a bundle. */
export function nftLabel(mints: readonly string[], assets: Assets): string {
  return mints.length === 1 ? assetLabel(mints[0], assets) : `${mints.length} NFTs`;
}

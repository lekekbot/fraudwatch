import type { AssetMetadata } from "@/lib/assets/assets";
import { formatBaseUnits } from "@/lib/solana/amount";
import { shortenAddress } from "@/lib/solana/address";
import type { WalletState } from "@/lib/state/reconstruct";

export type Assets = Map<string, AssetMetadata>;

export function assetLabel(assetId: string, assets: Assets): string {
  const meta = assets.get(assetId);
  return meta?.symbol || meta?.name || shortenAddress(assetId, 4);
}

/** Base-unit amount as a decimal, using the decimals the transactions reported. */
export function formatAssetAmount(value: string, assetId: string, state: WalletState, assets: Assets, signed = false): string {
  const decimals = state.decimals[assetId] ?? assets.get(assetId)?.decimals ?? 0;
  const text = formatBaseUnits(value, decimals);
  return signed && !value.startsWith("-") && value !== "0" ? `+${text}` : text;
}

export function formatUtc(timestamp: string | number | null): string {
  if (timestamp === null) return "—";
  return new Date(timestamp).toISOString().slice(0, 19).replace("T", " ");
}

/** One NFT's name, or "3 NFTs" for a bundle. */
export function nftLabel(mints: readonly string[], assets: Assets): string {
  return mints.length === 1 ? assetLabel(mints[0], assets) : `${mints.length} NFTs`;
}

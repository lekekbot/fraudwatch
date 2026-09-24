import { isAddress } from "@solana/kit";

export function isValidSolanaAddress(value: string): boolean {
  return isAddress(value.trim());
}

export function shortenAddress(address: string, chars = 4): string {
  if (address.length <= chars * 2 + 1) return address;
  return `${address.slice(0, chars)}…${address.slice(-chars)}`;
}

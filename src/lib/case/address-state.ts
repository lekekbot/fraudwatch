import type { ProtocolRegistry } from "@/lib/protocols/registry";
import type { FraudWatchCase } from "./model";

/** How a case treats an address; see TERMINOLOGY.md. Only PRIMARY and MAPPED get history loaded. */
export type AddressState = "PRIMARY" | "MAPPED" | "OBSERVED" | "INFRASTRUCTURE";

/**
 * `programs` holds every program ID the loaded transactions invoked: a program
 * is infrastructure even when the registry doesn't know it. Registry wallets
 * stay observable and mappable.
 */
export function addressState(
  address: string,
  c: Pick<FraudWatchCase, "primaryWallet" | "mappedWallets">,
  reg: ProtocolRegistry,
  programs: ReadonlySet<string> = new Set(),
): AddressState {
  if (address === c.primaryWallet) return "PRIMARY";
  if (c.mappedWallets.some((w) => w.address === address)) return "MAPPED";
  const entry = reg.lookup(address);
  if ((entry && entry.role !== "wallet") || programs.has(address)) return "INFRASTRUCTURE";
  return "OBSERVED";
}

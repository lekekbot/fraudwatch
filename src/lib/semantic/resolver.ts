import {
  enrichTransaction,
  type ProtocolRegistry,
  protocolsUsed,
  type RegistryEntry,
  registry,
} from "@/lib/protocols/registry";
import type { CanonicalTransaction } from "@/lib/solana/canonical";
import type { Infrastructure, InfrastructureRole, ProtocolRef } from "./events";

/** Everything known about the addresses in one transaction, resolved once for every interpreter. */
export type ProtocolResolution = {
  registryVersion: number;
  /** Verified registry matches among programs invoked, accounts touched and token owners. */
  matches: RegistryEntry[];
  /** Verified non-core protocols and services taking part, first seen first. */
  protocols: ProtocolRef[];
  /** Programs, token accounts and verified pools, vaults, authorities and fee accounts. */
  infrastructure: Infrastructure[];
  /** The verified entry for an address, the only lookup that may shape an interpretation. */
  verified: (address: string) => RegistryEntry | undefined;
};

function infrastructureRole(entry: RegistryEntry): InfrastructureRole | null {
  switch (entry.role) {
    case "program":
      return entry.category === "nft_marketplace" ? "MARKETPLACE" : entry.category === "dex_aggregator" ? "ROUTER" : entry.category === "bridge" ? "BRIDGE" : "PROGRAM";
    case "pool":
    case "market":
      return "POOL";
    case "vault":
      return "VAULT";
    case "authority":
      return "PDA";
    case "fee_account":
      return "FEE_ACCOUNT";
    // Wallets (exchange hot wallets) are services someone deals with: they're participants.
    default:
      return null;
  }
}

export function resolveProtocols(
  tx: CanonicalTransaction,
  options: { registry?: ProtocolRegistry } = {},
): ProtocolResolution {
  const reg = options.registry ?? registry;
  const enrichment = enrichTransaction(tx, reg);
  const known = new Map(enrichment.matches.map((m) => [m.address, m]));

  const infrastructure = new Map<string, Infrastructure>();
  for (const ix of [...tx.instructions, ...tx.innerInstructions]) {
    if (infrastructure.has(ix.programId)) continue;
    const entry = known.get(ix.programId);
    infrastructure.set(ix.programId, { address: ix.programId, role: (entry && infrastructureRole(entry)) ?? "PROGRAM", label: entry?.label ?? ix.program });
  }
  for (const m of enrichment.matches) {
    const role = infrastructureRole(m);
    if (role && !infrastructure.has(m.address)) infrastructure.set(m.address, { address: m.address, role, label: m.label });
  }
  for (const t of tx.tokenChanges) {
    if (!infrastructure.has(t.account)) infrastructure.set(t.account, { address: t.account, role: "TOKEN_ACCOUNT", label: null });
  }

  return {
    registryVersion: enrichment.protocolRegistryVersion,
    matches: enrichment.matches,
    protocols: protocolsUsed(enrichment),
    infrastructure: [...infrastructure.values()],
    verified: (address) => known.get(address) ?? reg.lookup(address),
  };
}

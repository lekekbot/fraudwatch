import { communityLabel } from "@/lib/labels/community";
import type { AddressLabel } from "@/lib/labels/labels";
import {
  type AddressRole,
  enrichTransaction,
  type ProtocolCategory,
  type ProtocolRegistry,
  protocolsUsed,
  type RegistryEntry,
  registry,
} from "@/lib/protocols/registry";
import type { CanonicalTransaction } from "@/lib/solana/canonical";
import type { Infrastructure, InfrastructureRole, ProtocolRef } from "./events";

/**
 * Who says what an address is. Only the registry is verified; community
 * names and the user's own labels are shown with their source and never
 * decide what a transaction did.
 */
export type Attribution =
  | { source: "registry"; verified: true; name: string; protocolId: string; category: ProtocolCategory; role: AddressRole }
  | { source: "community"; verified: false; name: string }
  | { source: "user"; verified: false; name: string };

/** Everything known about the addresses in one transaction, resolved once for every interpreter. */
export type ProtocolResolution = {
  registryVersion: number;
  /** Verified registry matches among programs invoked, accounts touched and token owners. */
  matches: RegistryEntry[];
  /** Verified non-core protocols and services taking part, first seen first. */
  protocols: ProtocolRef[];
  /** Programs invoked that the registry doesn't list. */
  unknownPrograms: string[];
  /** Programs, token accounts and verified pools, vaults and authorities. */
  infrastructure: Infrastructure[];
  /** The verified entry for an address, the only lookup that may shape an interpretation. */
  verified: (address: string) => RegistryEntry | undefined;
  /** Every attribution for an address, verified first. */
  attributions: (address: string) => Attribution[];
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
    // Fee accounts and wallets (exchange hot wallets) receive value: they're participants.
    default:
      return null;
  }
}

export function resolveProtocols(
  tx: CanonicalTransaction,
  options: { registry?: ProtocolRegistry; labels?: ReadonlyMap<string, AddressLabel> } = {},
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
    unknownPrograms: enrichment.unknownPrograms,
    infrastructure: [...infrastructure.values()],
    verified: (address) => known.get(address) ?? reg.lookup(address),
    attributions: (address) => {
      const out: Attribution[] = [];
      const entry = known.get(address) ?? reg.lookup(address);
      if (entry) out.push({ source: "registry", verified: true, name: entry.label, protocolId: entry.protocolId, category: entry.category, role: entry.role });
      const community = communityLabel(address);
      if (community) out.push({ source: "community", verified: false, name: community });
      const user = options.labels?.get(address)?.name;
      if (user) out.push({ source: "user", verified: false, name: user });
      return out;
    },
  };
}

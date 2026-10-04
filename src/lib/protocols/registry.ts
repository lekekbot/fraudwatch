import registryJson from "../../../protocols/solana.json";
import centralizedVaultsJson from "../../../protocols/centralized-vaults.json";
import { isValidSolanaAddress } from "@/lib/solana/address";
import type { CanonicalTransaction } from "@/lib/solana/canonical";

/**
 * Address → protocol or service lookup from `protocols/solana.json`. Lookup only: what a
 * transaction *did* is worked out in code (`summarize.ts`), never in JSON.
 * An address that isn't listed stays unknown; nothing is guessed.
 */

export const CATEGORIES = [
  "core",
  "dex",
  "dex_aggregator",
  "lending",
  "liquid_staking",
  "perps",
  "nft",
  "nft_marketplace",
  "name_service",
  "exchange",
  "bridge",
  "launchpad",
] as const;
export const ROLES = ["program", "pool", "vault", "authority", "fee_account", "market", "wallet"] as const;

export type ProtocolCategory = (typeof CATEGORIES)[number];
export type AddressRole = (typeof ROLES)[number];

export type RegistryEntry = {
  address: string;
  protocolId: string;
  protocolName: string;
  category: ProtocolCategory;
  role: AddressRole;
  label: string;
};

export type ProtocolRegistry = {
  version: number;
  lookup: (address: string) => RegistryEntry | undefined;
  /** Protocols and services by id: name and category. */
  protocols: ReadonlyMap<string, { name: string; category: ProtocolCategory }>;
  size: number;
};

export class RegistryError extends Error {}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Validates registry JSON against the rules in `protocols/schema.json` and indexes it by address. */
export function parseRegistry(json: unknown): ProtocolRegistry {
  const fail = (path: string, problem: string): never => {
    throw new RegistryError(`Protocol registry: ${path} ${problem}`);
  };
  if (!isObject(json)) fail("root", "must be an object");
  const root = json as Record<string, unknown>;
  const version = root.version;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) fail("version", "must be a positive integer");
  if (!isObject(root.protocols)) fail("protocols", "must be an object");

  const byAddress = new Map<string, RegistryEntry>();
  const protocols = new Map<string, { name: string; category: ProtocolCategory }>();
  for (const [protocolId, p] of Object.entries(root.protocols as Record<string, unknown>)) {
    const at = `protocols.${protocolId}`;
    if (!/^[a-z0-9_]+$/.test(protocolId)) fail(at, "id must be lowercase letters, digits or _");
    if (!isObject(p)) fail(at, "must be an object");
    const { name, category, addresses } = p as Record<string, unknown>;
    if (typeof name !== "string" || !name) fail(`${at}.name`, "must be a non-empty string");
    if (!CATEGORIES.includes(category as ProtocolCategory)) fail(`${at}.category`, `must be one of ${CATEGORIES.join(", ")}`);
    if (!isObject(addresses) || Object.keys(addresses).length === 0) fail(`${at}.addresses`, "must list at least one address");
    protocols.set(protocolId, { name: name as string, category: category as ProtocolCategory });

    for (const [address, a] of Object.entries(addresses as Record<string, unknown>)) {
      const where = `${at}.addresses.${address}`;
      if (!isValidSolanaAddress(address)) fail(where, "is not a valid Solana address");
      if (!isObject(a)) fail(where, "must be an object");
      const { role, label } = a as Record<string, unknown>;
      if (!ROLES.includes(role as AddressRole)) fail(`${where}.role`, `must be one of ${ROLES.join(", ")}`);
      if (typeof label !== "string" || !label) fail(`${where}.label`, "must be a non-empty string");
      const existing = byAddress.get(address);
      if (existing) fail(where, `is already listed under ${existing.protocolId}`);
      byAddress.set(address, {
        address,
        protocolId,
        protocolName: name as string,
        category: category as ProtocolCategory,
        role: role as AddressRole,
        label: label as string,
      });
    }
  }
  return { version: version as number, lookup: (address) => byAddress.get(address), protocols, size: byAddress.size };
}

/** The bundled registry. Centralized wallets stay in their own maintainable source file. */
export const registry: ProtocolRegistry = parseRegistry({
  ...registryJson,
  protocols: { ...registryJson.protocols, ...centralizedVaultsJson.protocols },
});

export type TxEnrichment = {
  /** Registry the matches were read against; a newer registry may know more. */
  protocolRegistryVersion: number;
  /** Registry matches among the programs invoked and accounts touched, each address once. */
  matches: RegistryEntry[];
  /** Programs the transaction invoked that the registry doesn't list. */
  unknownPrograms: string[];
};

export function enrichTransaction(tx: CanonicalTransaction, reg: ProtocolRegistry = registry): TxEnrichment {
  const programs = [...new Set([...tx.instructions, ...tx.innerInstructions].map((ix) => ix.programId))];
  const matches = new Map<string, RegistryEntry>();
  const unknownPrograms: string[] = [];
  for (const programId of programs) {
    const entry = reg.lookup(programId);
    if (entry) matches.set(programId, entry);
    else unknownPrograms.push(programId);
  }
  // Pools, vaults and other protocol accounts show up as plain accounts.
  for (const { address } of tx.accounts) {
    const entry = reg.lookup(address);
    if (entry && !matches.has(address)) matches.set(address, entry);
  }
  // SPL transfers expose the custodial wallet as the token account owner.
  for (const { owner } of tx.tokenChanges) {
    if (!owner) continue;
    const entry = reg.lookup(owner);
    if (entry && !matches.has(owner)) matches.set(owner, entry);
  }
  return { protocolRegistryVersion: reg.version, matches: [...matches.values()], unknownPrograms };
}

/** Distinct non-core protocols and services a transaction used, in first-seen order. */
export function protocolsUsed(enrichment: TxEnrichment): { id: string; name: string; category: ProtocolCategory }[] {
  const seen = new Map<string, { id: string; name: string; category: ProtocolCategory }>();
  for (const m of enrichment.matches) {
    if (m.category !== "core" && !seen.has(m.protocolId)) seen.set(m.protocolId, { id: m.protocolId, name: m.protocolName, category: m.category });
  }
  return [...seen.values()];
}

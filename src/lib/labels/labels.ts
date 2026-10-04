import { communityLabel } from "./community";
import { distinguishingShort, type LookalikeVerdict } from "./lookalikes";
import type { ProtocolRegistry, RegistryEntry } from "@/lib/protocols/registry";
import { shortenAddress } from "@/lib/solana/address";

/** A user's own name, note and tags for an address, scoped to one case. */
export type AddressLabel = {
  address: string;
  caseId: string;
  name: string;
  note?: string;
  tags: string[];
};

export const MAX_LABEL_NAME = 80;
export const MAX_LABEL_NOTE = 2000;
export const MAX_TAG = 40;

/** Trims and bounds the fields; tags are de-duplicated case-insensitively, keeping first spelling. */
export function normalizeLabel(label: AddressLabel): AddressLabel {
  const name = label.name.trim().slice(0, MAX_LABEL_NAME);
  const note = label.note?.trim().slice(0, MAX_LABEL_NOTE);
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const raw of label.tags) {
    const tag = raw.trim().slice(0, MAX_TAG);
    if (!tag || seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    tags.push(tag);
  }
  return { address: label.address, caseId: label.caseId, name, ...(note ? { note } : {}), tags };
}

export const isEmptyLabel = (label: AddressLabel) => !label.name && !label.note && label.tags.length === 0;

/**
 * Display text for an address, most trusted source first: the user's own
 * label, the verified registry, the community list (unverified), then the
 * wallet's own .sol name (claimed by its owner), else the shortened address.
 * A user label wins visually without changing the registry's metadata.
 */
export function displayName(
  address: string,
  label: AddressLabel | undefined,
  entry: RegistryEntry | undefined,
  chars = 4,
  other: { community?: string; sns?: string } = {},
): { text: string; source: NameSource } {
  if (label?.name) return { text: label.name, source: "label" };
  if (entry) return { text: entry.label, source: "registry" };
  if (other.community) return { text: other.community, source: "community" };
  if (other.sns) return { text: other.sns, source: "sns" };
  return { text: shortenAddress(address, chars), source: "address" };
}

/** Where a displayed name came from. */
export type NameSource = "label" | "registry" | "community" | "sns" | "address";

/** Name lookups for one case, combining its labels with the registry. */
export type Names = {
  /** Always returns something to show: label, registry label, or shortened address. */
  of: (address: string, chars?: number) => string;
  /** A real name (label, registry, community list or .sol name) if there is one. */
  known: (address: string) => string | undefined;
  /** Where the displayed name comes from, for attribution. */
  source: (address: string) => NameSource;
  label: (address: string) => AddressLabel | undefined;
  /** Other addresses in the case whose short form matches this one's: possible address poisoning. */
  lookalikes: (address: string) => readonly string[];
  /** For a look-alike: whether it's likely the dusting decoy, the real account, or unclear. */
  verdict: (address: string) => LookalikeVerdict | undefined;
};

/**
 * `lookalikes` maps addresses to others in the case with the same short
 * form; those are shortened just far enough to tell apart wherever a bare
 * address is shown.
 */
export function createNames(
  labels: ReadonlyMap<string, AddressLabel>,
  reg: ProtocolRegistry,
  lookalikes: ReadonlyMap<string, readonly string[]> = new Map(),
  verdicts: ReadonlyMap<string, LookalikeVerdict> = new Map(),
  /** Primary .sol names looked up on-chain. */
  sns: ReadonlyMap<string, string> = new Map(),
): Names {
  const resolve = (address: string, chars?: number) => {
    const name = displayName(address, labels.get(address), reg.lookup(address), chars, { community: communityLabel(address), sns: sns.get(address) });
    const twins = lookalikes.get(address);
    return name.source === "address" && twins ? { ...name, text: distinguishingShort(address, twins, chars) } : name;
  };
  return {
    of: (address, chars) => resolve(address, chars).text,
    known: (address) => {
      const name = resolve(address);
      return name.source === "address" ? undefined : name.text;
    },
    label: (address) => labels.get(address),
    source: (address) => resolve(address).source,
    lookalikes: (address) => lookalikes.get(address) ?? [],
    verdict: (address) => verdicts.get(address),
  };
}

import { NATIVE_SOL } from "@/lib/assets/assets";

/**
 * Address poisoning relies on look-alikes: a decoy whose first and last
 * characters match, or nearly match, an address the victim really uses, so
 * the shortened form shown everywhere reads the same. These helpers find such
 * pairs and say how to tell them apart.
 */

/** Fewest matching characters at each end, and across both ends, for two addresses to count as look-alikes. */
export const LOOKALIKE_ENDS = { each: 2, total: 6 } as const;

/**
 * Whether two different addresses read alike at a glance: they share at least
 * `each` leading and trailing characters and `total` across both ends, e.g.
 * 4+4 (identical when shortened) or 3+4 (`2hGZ…E1An` beside `2hGU…E1An`).
 * Six matching base58 characters happen by chance about once in 38 billion pairs.
 */
export function readsAlike(a: string, b: string, ends: { each: number; total: number } = LOOKALIKE_ENDS): boolean {
  if (a === b) return false;
  const prefix = commonPrefix(a, b);
  const suffix = commonSuffix(a, b);
  return prefix >= ends.each && suffix >= ends.each && prefix + suffix >= ends.total;
}

/**
 * Every address that reads alike (see `readsAlike`) with another, mapped to
 * those others. Addresses are bucketed by their two first and last characters,
 * which any look-alike pair shares, so only plausible pairs are compared.
 */
export function lookalikeGroups(addresses: Iterable<string>, ends: { each: number; total: number } = LOOKALIKE_ENDS): Map<string, string[]> {
  const buckets = new Map<string, string[]>();
  for (const address of new Set(addresses)) {
    if (address.length <= ends.total) continue;
    const key = `${address.slice(0, ends.each)}|${address.slice(-ends.each)}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(address);
    else buckets.set(key, [address]);
  }
  const out = new Map<string, string[]>();
  for (const bucket of buckets.values()) {
    for (let i = 0; i < bucket.length; i++) {
      for (let j = i + 1; j < bucket.length; j++) {
        if (!readsAlike(bucket[i], bucket[j], ends)) continue;
        out.set(bucket[i], [...(out.get(bucket[i]) ?? []), bucket[j]]);
        out.set(bucket[j], [...(out.get(bucket[j]) ?? []), bucket[i]]);
      }
    }
  }
  return out;
}

const commonPrefix = (a: string, b: string) => {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
};
const commonSuffix = (a: string, b: string) => {
  let i = 0;
  while (i < a.length && i < b.length && a[a.length - 1 - i] === b[b.length - 1 - i]) i++;
  return i;
};

/**
 * How many leading and trailing characters to show so `address` reads
 * differently from each of its `twins`: the short form, grown at whichever
 * end needs fewer extra characters.
 */
export function distinguishingParts(address: string, twins: readonly string[], chars = 4): { head: number; tail: number } {
  const prefix = Math.max(0, ...twins.map((t) => commonPrefix(address, t)));
  const suffix = Math.max(0, ...twins.map((t) => commonSuffix(address, t)));
  const growHead = Math.max(chars, prefix + 1);
  const growTail = Math.max(chars, suffix + 1);
  return growHead - chars <= growTail - chars ? { head: growHead, tail: chars } : { head: chars, tail: growTail };
}

/** The short form that tells `address` apart from its `twins`, e.g. `7VyCU…9W5P` beside `7VyCt…9W5P`. */
export function distinguishingShort(address: string, twins: readonly string[], chars = 4): string {
  const { head, tail } = distinguishingParts(address, twins, chars);
  if (head + tail + 1 >= address.length) return address;
  return `${address.slice(0, head)}…${address.slice(-tail)}`;
}

/** What a look-alike most likely is: the dusting decoy, the account it imitates, or not clear from the data. */
export type LookalikeVerdict = "decoy" | "real" | "unclear";

/** Below this, a movement is dust: 0.01 SOL, or one whole unit of a token. */
const DUST_SOL_LAMPORTS = BigInt(10_000_000);

/** Whether moving `amount` base units of `assetId` (with `decimals`) is dust: the small amounts poisoners send. */
export function isDust(assetId: string, amount: bigint, decimals: number): boolean {
  const size = amount < BigInt(0) ? -amount : amount;
  if (assetId === NATIVE_SOL) return size < DUST_SOL_LAMPORTS;
  return size < BigInt(10) ** BigInt(decimals);
}

/**
 * Tells decoys from the accounts they imitate. A decoy only ever moves dust;
 * the real account moves real amounts. In a look-alike set, an address whose
 * every movement is dust is the decoy when another member moved real value,
 * and that member is the real one. Anything else is unclear.
 * `dustOnly` is null for an address with no movements in the case.
 */
export function judgeLookalikes(groups: ReadonlyMap<string, readonly string[]>, dustOnly: (address: string) => boolean | null): Map<string, LookalikeVerdict> {
  const out = new Map<string, LookalikeVerdict>();
  for (const [address, twins] of groups) {
    const self = dustOnly(address);
    const others = twins.map(dustOnly);
    if (self === true && others.some((d) => d === false)) out.set(address, "decoy");
    else if (self === false && others.some((d) => d === true)) out.set(address, "real");
    else out.set(address, "unclear");
  }
  return out;
}

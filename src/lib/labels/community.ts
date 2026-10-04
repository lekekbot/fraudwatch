import communityJson from "../../../protocols/community-labels.json";

/**
 * Third-party display names (generated from protocols/sources; see its README).
 * Unverified: shown attributed, and never used to decide what a transaction did.
 */
const LABELS: Readonly<Record<string, string>> = communityJson.labels;

/** Where these names come from, for attribution. */
export const COMMUNITY_SOURCE = communityJson.source;

export function communityLabel(address: string): string | undefined {
  return Object.hasOwn(LABELS, address) ? LABELS[address] : undefined;
}

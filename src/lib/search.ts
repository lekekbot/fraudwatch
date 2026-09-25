/**
 * Case search: wallets, labelled and observed addresses, tags, transaction
 * signatures, tokens and protocols. Pure, so the ranking is testable; the
 * workspace builds the items and decides what "go to" means for each kind.
 */

export type SearchKind = "wallet" | "address" | "transaction" | "asset" | "protocol" | "tag";

export type SearchItem = {
  kind: SearchKind;
  /** Address, signature, mint, protocol id or tag. */
  id: string;
  label: string;
  detail?: string;
  /** Other text that should match (names, symbols, tags, notes). */
  keywords: readonly string[];
};

const KIND_ORDER: SearchKind[] = ["wallet", "address", "tag", "asset", "protocol", "transaction"];

/**
 * Items matching every word of `query`, best first: an exact id or label,
 * then prefixes, then substrings; ties by kind (wallets first) and label.
 * Signatures and addresses match by prefix only, so pasting part of one works
 * without every long id matching short queries.
 */
export function searchItems(items: readonly SearchItem[], query: string, limit = 12): SearchItem[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const scored: { item: SearchItem; score: number }[] = [];
  for (const item of items) {
    const id = item.id.toLowerCase();
    const texts = [item.label, ...item.keywords].map((t) => t.toLowerCase());
    let score = 0;
    let all = true;
    for (const w of words) {
      let best = 0;
      if (id === w) best = 100;
      else if (id.startsWith(w) && w.length >= 3) best = 60;
      for (const t of texts) {
        if (t === w) best = Math.max(best, 90);
        else if (t.startsWith(w)) best = Math.max(best, 50);
        else if (t.split(/[\s·/-]+/).some((part) => part.startsWith(w))) best = Math.max(best, 40);
        else if (t.includes(w) && w.length >= 2) best = Math.max(best, 20);
      }
      if (best === 0) {
        all = false;
        break;
      }
      score += best;
    }
    if (all) scored.push({ item, score });
  }
  return scored
    .sort(
      (a, b) =>
        b.score - a.score ||
        KIND_ORDER.indexOf(a.item.kind) - KIND_ORDER.indexOf(b.item.kind) ||
        a.item.label.localeCompare(b.item.label),
    )
    .slice(0, limit)
    .map((s) => s.item);
}

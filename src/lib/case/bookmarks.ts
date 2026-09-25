import type { Bookmark, FraudWatchCase } from "./model";

const same = (b: Bookmark, kind: Bookmark["kind"], target: string) => b.kind === kind && b.target === target;

export function isBookmarked(c: Pick<FraudWatchCase, "bookmarks">, kind: Bookmark["kind"], target: string): boolean {
  return (c.bookmarks ?? []).some((b) => same(b, kind, target));
}

/** Adds a bookmark, or removes it if the same target is already bookmarked. */
export function toggleBookmark(
  c: FraudWatchCase,
  input: { kind: Bookmark["kind"]; target: string; wallet?: string; note?: string },
  deps: { now?: Date; id?: string } = {},
): FraudWatchCase {
  const now = (deps.now ?? new Date()).toISOString();
  const existing = c.bookmarks ?? [];
  if (existing.some((b) => same(b, input.kind, input.target))) {
    return { ...c, bookmarks: existing.filter((b) => !same(b, input.kind, input.target)), updatedAt: now };
  }
  const bookmark: Bookmark = {
    id: deps.id ?? crypto.randomUUID(),
    kind: input.kind,
    target: input.target,
    ...(input.wallet ? { wallet: input.wallet } : {}),
    ...(input.note?.trim() ? { note: input.note.trim() } : {}),
    createdAt: now,
  };
  return { ...c, bookmarks: [...existing, bookmark], updatedAt: now };
}

export function removeBookmark(c: FraudWatchCase, id: string, now = new Date()): FraudWatchCase {
  return { ...c, bookmarks: (c.bookmarks ?? []).filter((b) => b.id !== id), updatedAt: now.toISOString() };
}

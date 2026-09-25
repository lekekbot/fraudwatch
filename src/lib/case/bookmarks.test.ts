import { describe, expect, it } from "vitest";
import { isBookmarked, removeBookmark, toggleBookmark } from "./bookmarks";
import { createCase } from "./model";

const A = "dLm61Lvpigiaig9ZHcdh6iE7mFp7WmfqzkFMrDdf5Vo";
const base = () => createCase({ name: "c", primaryWallet: A, range: { start: "2026-06-01T00:00:00.000Z", end: "2026-09-01T00:00:00.000Z" } });
const NOW = new Date("2026-09-25T00:00:00.000Z");

describe("bookmarks", () => {
  it("adds wallet, transaction and date bookmarks, keeping the lane for a transaction", () => {
    let c = toggleBookmark(base(), { kind: "wallet", target: A }, { now: NOW, id: "b1" });
    c = toggleBookmark(c, { kind: "transaction", target: "sig", wallet: A, note: "  drain  " }, { now: NOW, id: "b2" });
    c = toggleBookmark(c, { kind: "date", target: "2026-07-01T12:00:00.000Z" }, { now: NOW, id: "b3" });
    expect(c.bookmarks).toEqual([
      { id: "b1", kind: "wallet", target: A, createdAt: NOW.toISOString() },
      { id: "b2", kind: "transaction", target: "sig", wallet: A, note: "drain", createdAt: NOW.toISOString() },
      { id: "b3", kind: "date", target: "2026-07-01T12:00:00.000Z", createdAt: NOW.toISOString() },
    ]);
    expect(isBookmarked(c, "transaction", "sig")).toBe(true);
    expect(isBookmarked(c, "wallet", "sig")).toBe(false);
  });

  it("toggles off an existing bookmark and removes by id", () => {
    const on = toggleBookmark(base(), { kind: "transaction", target: "sig" }, { id: "b1" });
    expect(toggleBookmark(on, { kind: "transaction", target: "sig" }).bookmarks).toEqual([]);
    expect(removeBookmark(on, "b1").bookmarks).toEqual([]);
    expect(isBookmarked(base(), "wallet", A)).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { type SearchItem, searchItems } from "./search";

const items: SearchItem[] = [
  { kind: "wallet", id: "dLm61Lvpigiaig9ZHcdh6iE7mFp7WmfqzkFMrDdf5Vo", label: "Victim wallet", keywords: ["victim"] },
  { kind: "address", id: "96YBzFHBc8TdwdWGqJ3qw9yAGoKsR5iFE96phN9jWtVz", label: "Keeper bot A", keywords: ["bot"] },
  { kind: "tag", id: "bot", label: "bot", keywords: [] },
  { kind: "transaction", id: "4BWGXrokY5FARySWXty8C8nQqr", label: "4BWG…8nQqr", detail: "NFT BUY", keywords: [] },
  { kind: "asset", id: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", label: "USDC", detail: "USD Coin", keywords: ["USD Coin"] },
  { kind: "protocol", id: "jupiter", label: "Jupiter", keywords: ["dex aggregator"] },
];
const find = (q: string) => searchItems(items, q).map((i) => i.id);

describe("searchItems", () => {
  it("finds by label, keyword, tag, symbol and protocol name", () => {
    expect(find("keeper")).toEqual(["96YBzFHBc8TdwdWGqJ3qw9yAGoKsR5iFE96phN9jWtVz"]);
    expect(find("usdc")).toEqual(["EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"]);
    expect(find("coin")).toEqual(["EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"]);
    expect(find("jup")).toEqual(["jupiter"]);
  });

  it("finds addresses and signatures by pasted prefix", () => {
    expect(find("dLm61L")).toEqual(["dLm61Lvpigiaig9ZHcdh6iE7mFp7WmfqzkFMrDdf5Vo"]);
    expect(find("4BWGXrok")).toEqual(["4BWGXrokY5FARySWXty8C8nQqr"]);
  });

  it("ranks an exact match first, then by kind", () => {
    // "bot" is the tag's exact label and a keyword of the address.
    expect(find("bot")).toEqual(["bot", "96YBzFHBc8TdwdWGqJ3qw9yAGoKsR5iFE96phN9jWtVz"]);
  });

  it("requires every word and ignores empty queries", () => {
    expect(find("keeper bot")).toEqual(["96YBzFHBc8TdwdWGqJ3qw9yAGoKsR5iFE96phN9jWtVz"]);
    expect(find("keeper usdc")).toEqual([]);
    expect(find("   ")).toEqual([]);
  });

  it("doesn't match long ids on short fragments in the middle", () => {
    expect(find("qw")).toEqual([]);
  });
});

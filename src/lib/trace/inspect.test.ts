import { describe, expect, it } from "vitest";
import { boundaryExplanation, otherLegs, replacementCandidates } from "./inspect";
import type { BoundaryKind } from "./model";
import { buildMovementIndex } from "./movements";
import { event, stepOf } from "./testing";

// F3-like: one signature paying a seller, with a royalty and a marketplace fee.
const sale = event("sale", [
  { assetId: "USDC", from: "Buyer", to: "Seller", amount: "1000" },
  { assetId: "USDC", from: "Buyer", to: "Creator", amount: "60", role: "royalty" },
  { assetId: "USDC", from: "Buyer", to: "Market", amount: "20", role: "marketplace_fee" },
]);
const index = buildMovementIndex([sale, event("other", [{ assetId: "USDC", from: "Buyer", to: "X", amount: "5" }])], () => 0);

describe("trace inspector helpers", () => {
  it("lists a transaction's other legs, supporting ones included and in-trace ones marked", () => {
    const pay = stepOf(sale, 0), fee = stepOf(sale, 2);
    const legs = otherLegs(index, "sale", pay.kind === "movement" ? pay.ref.key : "", new Set([fee.kind === "movement" ? fee.ref.key : ""]));
    expect(legs.map((l) => [l.ref.to, l.weight, l.inTrace])).toEqual([["Creator", "supporting", false], ["Market", "supporting", true]]);
  });

  it("explains every boundary kind", () => {
    const kinds: BoundaryKind[] = ["history_not_loaded", "partial_history", "outside_range", "custodial", "ambiguous", "failed", "left_supply", "entered_supply", "bridged_out", "bridged_in", "protocol_position", "end_of_history"];
    for (const kind of kinds) expect(boundaryExplanation(kind).meaning.length).toBeGreaterThan(10);
    expect(boundaryExplanation("history_not_loaded").fix).toBe("map_wallet");
    expect(boundaryExplanation("custodial").fix).toBe("start_from_withdrawal");
  });

  it("offers replacements for a changed amount from the same signature only", () => {
    const stale = stepOf(event("sale", [{ assetId: "USDC", from: "Buyer", to: "Seller", amount: "999" }]));
    if (stale.kind !== "movement") throw new Error();
    const options = replacementCandidates(index, stale);
    expect(options.every((r) => r.signature === "sale")).toBe(true);
    expect(options[0]).toMatchObject({ to: "Seller", amount: "1000" });
    expect(options).toHaveLength(3);
  });
});

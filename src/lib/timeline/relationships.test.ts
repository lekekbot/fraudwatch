import { describe, expect, it } from "vitest";
import type { EffectSummary } from "@/lib/state/summarize";
import { binEvents, buildRelationships } from "./relationships";

/** A summary with only counterparties: each one's own delta. */
const summary = (...counterparties: [string, string][]): EffectSummary => ({
  kind: "SEND",
  inflows: [],
  outflows: [],
  counterparties: counterparties.map(([address, delta]) => ({ address, assetId: "SOL", delta })),
  action: null,
  actor: null,
});

describe("buildRelationships", () => {
  it("pairs a wallet with each counterparty, sent when the counterparty gained, busiest first", () => {
    const rels = buildRelationships([
      { wallet: "A", signatures: ["s1", "s2", "s3"], times: [30, 10, 20], summaries: [summary(["X", "5"]), summary(["Y", "-2"]), summary(["X", "-1"])] },
    ]);
    expect(rels.map((r) => [r.a, r.b, r.events.length, r.sent, r.received])).toEqual([
      ["A", "X", 2, 1, 1],
      ["A", "Y", 1, 0, 1],
    ]);
    expect(rels[0].events.map((e) => e.signature)).toEqual(["s3", "s1"]);
  });

  it("counts a transaction between two mapped wallets once, from the earlier lane", () => {
    const rels = buildRelationships([
      { wallet: "A", signatures: ["t"], times: [1], summaries: [summary(["B", "7"])] },
      { wallet: "B", signatures: ["t"], times: [1], summaries: [summary(["A", "-7"])] },
    ]);
    expect(rels).toEqual([{ a: "A", b: "B", events: [{ signature: "t", time: 1, sent: true, received: false }], sent: 1, received: 0 }]);
  });

  it("ignores counterparties whose balance didn't move", () => {
    expect(buildRelationships([{ wallet: "A", signatures: ["s"], times: [1], summaries: [summary(["X", "0"])] }])).toEqual([]);
  });
});

describe("binEvents", () => {
  it("groups events into screen slices with sent and received counts", () => {
    const events = [
      { signature: "a", time: 0, sent: true, received: false },
      { signature: "b", time: 5, sent: false, received: true },
      { signature: "c", time: 20, sent: true, received: true },
    ];
    const bins = binEvents(events, (t) => t, 0, 10);
    expect(bins.map((b) => [b.index, b.sent, b.received, b.first.signature])).toEqual([
      [0, 1, 1, "a"],
      [2, 1, 1, "c"],
    ]);
  });
});

import { describe, expect, it } from "vitest";
import { collectCounterparties } from "./counterparties";
import type { EffectSummary } from "./summarize";

const s = (counterparties: string[], actor: string | null = null): EffectSummary => ({
  kind: "PROGRAM",
  outflows: [],
  inflows: [],
  counterparties: counterparties.map((address) => ({ address, assetId: "SOL", delta: "1" })),
  action: null,
  actor,
});

describe("collectCounterparties", () => {
  it("counts each address once per transaction, includes senders, and excludes the wallet", () => {
    const rows = collectCounterparties("W", [s(["A", "A", "B"]), s([], "BOT"), s(["A"], "BOT"), s(["W"], "W")]);
    expect(rows).toEqual([
      { address: "A", count: 2 },
      { address: "BOT", count: 2 },
      { address: "B", count: 1 },
    ]);
  });
});

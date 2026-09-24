import { describe, expect, it } from "vitest";
import type { WalletTransactionEffect } from "@/lib/state/reconstruct";
import type { EffectSummary } from "@/lib/state/summarize";
import { buildWalletGraph } from "./build";

const JUPITER = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
const SYSTEM = "11111111111111111111111111111111";

const effect = (signature: string, minute: number): WalletTransactionEffect => ({
  wallet: "W",
  signature,
  slot: minute,
  timestamp: new Date(Date.UTC(2026, 0, 1, 0, minute)).toISOString(),
  success: true,
  assetChanges: [],
  feeLamports: "0",
});

const summary = (partial: Partial<EffectSummary>): EffectSummary => ({
  kind: "RECEIVE",
  outflows: [],
  inflows: [],
  counterparties: [],
  action: null,
  actor: null,
  ...partial,
});

describe("buildWalletGraph", () => {
  it("aggregates flows per direction and sums amounts per asset", () => {
    const g = buildWalletGraph(
      "W",
      [effect("a", 1), effect("b", 2), effect("c", 3)],
      [
        summary({ counterparties: [{ address: "A", assetId: "USDC", delta: "-100" }] }),
        summary({ counterparties: [{ address: "A", assetId: "USDC", delta: "-50" }, { address: "A", assetId: "SOL", delta: "-1" }] }),
        summary({ kind: "SEND", counterparties: [{ address: "A", assetId: "USDC", delta: "30" }] }),
      ],
    );
    const inbound = g.edges.find((e) => e.id === "flow:A>W")!;
    expect(inbound.signatures).toEqual(["a", "b"]);
    expect(inbound.totals).toEqual([
      { assetId: "USDC", amount: "150" },
      { assetId: "SOL", amount: "1" },
    ]);
    expect(inbound.first).toBe(Date.UTC(2026, 0, 1, 0, 1));
    expect(inbound.last).toBe(Date.UTC(2026, 0, 1, 0, 2));
    expect(g.edges.find((e) => e.id === "flow:W>A")?.totals).toEqual([{ assetId: "USDC", amount: "30" }]);
    expect(g.nodes).toEqual([
      { id: "W", kind: "wallet", txCount: 3 },
      { id: "A", kind: "counterparty", txCount: 3 },
    ]);
  });

  it("adds sender and non-core program edges, skipping core programs and account setup", () => {
    const g = buildWalletGraph(
      "W",
      [effect("a", 1), effect("b", 2), effect("c", 3)],
      [
        summary({ kind: "PROGRAM", actor: "BOT", action: { programId: JUPITER, program: null, instruction: null } }),
        summary({ kind: "PROGRAM", action: { programId: SYSTEM, program: "system", instruction: "transfer" } }),
        summary({ kind: "ACCOUNT", action: { programId: "SomeSetupProgram", program: null, instruction: null } }),
      ],
    );
    expect(g.edges.map((e) => e.id).sort()).toEqual([`program:W>${JUPITER}`, "sent_by:BOT>W"]);
    expect(g.nodes.find((n) => n.id === JUPITER)?.kind).toBe("program");
  });

  it("keeps the busiest nodes and reports how many were left out", () => {
    const effects = ["a", "b", "c", "d"].map((s, i) => effect(s, i));
    const summaries = [
      summary({ counterparties: [{ address: "BUSY", assetId: "SOL", delta: "-1" }] }),
      summary({ counterparties: [{ address: "BUSY", assetId: "SOL", delta: "-1" }] }),
      summary({ counterparties: [{ address: "RARE1", assetId: "SOL", delta: "-1" }] }),
      summary({ counterparties: [{ address: "RARE2", assetId: "SOL", delta: "-1" }] }),
    ];
    const g = buildWalletGraph("W", effects, summaries, 2);
    expect(g.nodes.map((n) => n.id)).toEqual(["W", "BUSY"]);
    expect(g.omittedNodes).toBe(2);
    expect(g.edges.every((e) => e.source !== "RARE1" && e.target !== "RARE1")).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import type { WalletTransactionEffect } from "@/lib/state/reconstruct";
import type { EffectSummary } from "@/lib/state/summarize";
import { buildInteractionGraph, edgeFlow, OMITTED_NODE_ID, pairId } from "./build";

const A = "A-wallet";
const B = "B-counterparty";
const C = "C-counterparty";
const JUPITER = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
const SYSTEM = "11111111111111111111111111111111";

const effect = (wallet: string, signature: string, day: number): WalletTransactionEffect => ({
  wallet,
  signature,
  slot: day,
  timestamp: new Date(Date.UTC(2026, 6, day, 12)).toISOString(),
  success: true,
  assetChanges: [],
  feeLamports: "0",
});

const summary = (partial: Partial<EffectSummary>): EffectSummary => ({
  kind: "SEND",
  outflows: [],
  inflows: [],
  counterparties: [],
  action: null,
  actor: null,
  ...partial,
});

/** A's side: B gains what A sends (positive delta), loses what A receives (negative). */
const cp = (address: string, assetId: string, delta: string) => ({ address, assetId, delta });

describe("buildInteractionGraph", () => {
  it("draws ONE line for several A → B transactions plus a B → A one, keeping every transaction and its direction", () => {
    const g = buildInteractionGraph([
      {
        wallet: A,
        // Out of order on purpose: the detail list must come out chronological.
        effects: [effect(A, "a2", 3), effect(A, "a1", 1), effect(A, "back", 9), effect(A, "a3", 5)],
        summaries: [
          summary({ counterparties: [cp(B, "USDC", "250")] }),
          summary({ counterparties: [cp(B, "SOL", "1000")] }),
          summary({ kind: "RECEIVE", counterparties: [cp(B, "USDC", "-40")] }),
          summary({ counterparties: [cp(B, "USDC", "75")] }),
        ],
      },
    ]);
    const lines = g.edges.filter((e) => e.kind === "interaction");
    expect(lines).toHaveLength(1);
    expect(lines[0].id).toBe(pairId(A, B));
    expect(lines[0].interactions.map((it) => [it.signature, it.movements])).toEqual([
      ["a1", [{ from: A, to: B, assetId: "SOL", amount: "1000" }]],
      ["a2", [{ from: A, to: B, assetId: "USDC", amount: "250" }]],
      ["a3", [{ from: A, to: B, assetId: "USDC", amount: "75" }]],
      ["back", [{ from: B, to: A, assetId: "USDC", amount: "40" }]],
    ]);
    expect(edgeFlow(lines[0])).toEqual({ from: A, to: B, forward: 3, reverse: 1, bidirectional: true });
    expect(lines[0].summary).toMatchObject({
      totalInteractions: 4,
      aToB: 3,
      bToA: 1,
      activeDays: 4,
      activityPattern: "Long-running",
      assets: [
        // 250 + 75 out, 40 back; the totals run each way between the pair.
        { assetId: "USDC", txCount: 3, aToB: "325", bToA: "40" },
        { assetId: "SOL", txCount: 1, aToB: "1000", bToA: "0" },
      ],
    });
    expect(g.counts).toMatchObject({ connections: 1, transactions: 4 });
  });

  it("keeps one line and no duplicate movements when both ends are mapped and see the same transaction", () => {
    const g = buildInteractionGraph([
      { wallet: A, effects: [effect(A, "t", 1)], summaries: [summary({ counterparties: [cp(B, "USDC", "10")] })] },
      { wallet: B, effects: [effect(B, "t", 1)], summaries: [summary({ kind: "RECEIVE", counterparties: [cp(A, "USDC", "-10")] })] },
    ]);
    expect(g.edges).toHaveLength(1);
    expect(g.edges[0].interactions).toHaveLength(1);
    expect(g.edges[0].interactions[0].movements).toEqual([{ from: A, to: B, assetId: "USDC", amount: "10" }]);
    expect(g.nodes.filter((n) => n.kind === "wallet").map((n) => n.id).sort()).toEqual([A, B]);
  });

  it("never connects two wallets because they called the same program; program links are separate and hidden by default", () => {
    const sides = [
      { wallet: A, effects: [effect(A, "p1", 1)], summaries: [summary({ kind: "PROGRAM", action: { programId: JUPITER, program: null, instruction: null } })] },
      { wallet: B, effects: [effect(B, "p1", 1)], summaries: [summary({ kind: "PROGRAM", action: { programId: JUPITER, program: null, instruction: null } })] },
    ];
    const hiddenPrograms = buildInteractionGraph(sides);
    expect(hiddenPrograms.edges).toEqual([]);
    expect(hiddenPrograms.counts).toMatchObject({ connections: 0, programConnections: 2 });

    const shown = buildInteractionGraph(sides, { showPrograms: true });
    expect(shown.edges.map((e) => e.id).sort()).toEqual([`program:${pairId(A, JUPITER)}`, `program:${pairId(B, JUPITER)}`]);
    expect(shown.edges.some((e) => e.id === pairId(A, B))).toBe(false);
    expect(shown.nodes.find((n) => n.id === JUPITER)?.kind).toBe("program");
  });

  it("skips core programs and account setup as program links", () => {
    const g = buildInteractionGraph(
      [
        {
          wallet: A,
          effects: [effect(A, "s", 1), effect(A, "t", 2)],
          summaries: [
            summary({ kind: "PROGRAM", action: { programId: SYSTEM, program: "system", instruction: "transfer" } }),
            summary({ kind: "ACCOUNT", action: { programId: "Setup111", program: null, instruction: null } }),
          ],
        },
      ],
      { showPrograms: true },
    );
    expect(g.edges).toEqual([]);
  });

  it("drops movements of hidden assets, removing a connection when nothing is left", () => {
    const sides = [
      {
        wallet: A,
        effects: [effect(A, "spam", 1), effect(A, "mixed", 2)],
        summaries: [
          summary({ kind: "RECEIVE", counterparties: [cp(B, "SPAM", "-1")] }),
          summary({ kind: "SWAP", counterparties: [cp(C, "SPAM", "5"), cp(C, "USDC", "-3")] }),
        ],
      },
    ];
    const g = buildInteractionGraph(sides, { hiddenAssets: new Set(["SPAM"]) });
    expect(g.edges.map((e) => e.id)).toEqual([pairId(A, C)]);
    expect(g.edges[0].interactions[0].movements).toEqual([{ from: C, to: A, assetId: "USDC", amount: "3" }]);
  });

  it("connects an NFT's other side when it isn't a balance counterparty (e.g. compressed NFTs)", () => {
    const g = buildInteractionGraph([
      {
        wallet: A,
        effects: [effect(A, "cnft", 1)],
        summaries: [summary({ kind: "NFT_TRANSFER", nft: { received: ["asset1"], sent: [], payment: null, party: B, others: [], marketplace: null } })],
      },
    ]);
    expect(g.edges[0].interactions[0].movements).toEqual([{ from: B, to: A, assetId: "asset1", amount: "1" }]);
    expect(edgeFlow(g.edges[0])).toEqual({ from: B, to: A, forward: 1, reverse: 0, bidirectional: false });
  });

  it("keeps every mapped wallet and the busiest others under the node cap", () => {
    const sides = [
      {
        wallet: A,
        effects: ["a", "b", "c"].map((s, i) => effect(A, s, i + 1)),
        summaries: [summary({ counterparties: [cp(B, "SOL", "1")] }), summary({ counterparties: [cp(B, "SOL", "1")] }), summary({ counterparties: [cp(C, "SOL", "1")] })],
      },
    ];
    const g = buildInteractionGraph(sides, { maxNodes: 2 });
    expect(g.nodes.map((n) => n.id)).toEqual([A, B, OMITTED_NODE_ID]);
    expect(g.omittedNodes).toBe(1);
    expect(g.edges.map((e) => e.id)).toEqual([pairId(A, B)]);
  });

  it("keeps recent and directional relationships in the significant projection and exposes omitted addresses", () => {
    const D = "D-counterparty";
    const sides = [
      {
        wallet: A,
        effects: [effect(A, "busy-1", 1), effect(A, "busy-2", 2), effect(A, "recent", 9), effect(A, "incoming", 3)],
        summaries: [
          summary({ counterparties: [cp(B, "SOL", "1")] }),
          summary({ counterparties: [cp(B, "SOL", "1")] }),
          summary({ counterparties: [cp(C, "SOL", "1")] }),
          summary({ kind: "RECEIVE", counterparties: [cp(D, "SOL", "-1")] }),
        ],
      },
    ];
    const g = buildInteractionGraph(sides, { maxNodes: 3 });
    expect(g.nodes.map((n) => n.id)).toEqual([A, B, D, OMITTED_NODE_ID]);
    expect(g.nodes.at(-1)).toMatchObject({ kind: "aggregate", txCount: 1 });
  });
});

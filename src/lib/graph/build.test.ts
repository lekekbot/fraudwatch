import { describe, expect, it } from "vitest";
import type { RawParsedTransaction } from "@/lib/rpc/generic-adapter";
import { interpretTransaction } from "@/lib/semantic/interpret";
import { FEE, makeTx, read, SOL, token } from "@/lib/semantic/testing";
import { type CanonicalTransaction, canonicalize } from "@/lib/solana/canonical";
import { reconstructWalletState } from "@/lib/state/reconstruct";
import { type NftCatalog, NO_NFTS, summarizeEffect } from "@/lib/state/summarize";
import { buildInteractionGraph, type WalletSide } from "./build";

/** One mapped wallet's side of some transactions, with or without their semantic events. */
function side(wallet: string, txs: CanonicalTransaction[], nfts: NftCatalog = NO_NFTS, withEvents = true): WalletSide {
  const state = reconstructWalletState(wallet, txs, { historyComplete: true });
  const bySig = new Map(txs.map((t) => [t.signature, t]));
  return {
    wallet,
    effects: state.effects,
    summaries: state.effects.map((e) => summarizeEffect(e, bySig.get(e.signature), nfts)),
    ...(withEvents ? { events: state.effects.map((e) => interpretTransaction(bySig.get(e.signature)!, { nfts })[0]) } : {}),
  };
}

let n = 0;
const transfer = (from: string, to: string, lamports: number, slot = n) =>
  ({ ...makeTx({ signature: `t${n++}`, native: { [from]: [1000 * SOL, 1000 * SOL - lamports - FEE], [to]: [SOL, SOL + lamports] } }), slot, timestamp: new Date(Date.UTC(2026, 0, 1 + slot)).toISOString() });

describe("graph relationships from semantic events", () => {
  it("draws no wallet connections for a multi-pool swap's routing", () => {
    const tx = canonicalize(read<RawParsedTransaction>("defi/jupiter-multi-hop.json"));
    const trader = "CKuBTzPwzrCisqQMQfAjNn6jKcfny8ny4rJVN3cxLjcf";
    expect(buildInteractionGraph([side(trader, [tx])]).edges.filter((e) => e.kind === "interaction")).toEqual([]);
    // Read from the wallet's own counterparties instead, the route's pools became wallets on the map.
    expect(buildInteractionGraph([side(trader, [tx], NO_NFTS, false)]).edges.filter((e) => e.kind === "interaction").length).toBeGreaterThan(0);
  });

  it("keeps an NFT purchase as one buyer–seller line, with fee legs inside it and no fee-account node", () => {
    const sale = read<{ buyer: string; seller: string; mint: string; response: RawParsedTransaction }>("magic-eden-sale/transaction.json");
    const nfts: NftCatalog = { isNft: (m) => m === sale.mint, royaltyRecipients: () => [] };
    const graph = buildInteractionGraph([side(sale.buyer, [canonicalize(sale.response)], nfts)]);
    const lines = graph.edges.filter((e) => e.kind === "interaction");
    expect(lines.map((e) => [e.a, e.b].sort())).toEqual([[sale.buyer, sale.seller].sort()]);
    const [it] = lines[0].interactions;
    expect(it.category).toBe("NFT_TRADE");
    expect(it.movements.map((m) => m.assetId).sort()).toEqual([sale.mint, "SOL"].sort());
    expect(it.nftRelated?.map((m) => m.role)).toContain("marketplace_fee");
    expect(graph.nodes.map((node) => node.id)).not.toContain("rFqFJ9g7TGBD8Ed7TPDnvGKZ5pWLPDyxLcvcH2eRCtt");
  });

  it("summarises a relationship by direction and by semantic event, with the timeline's event ids", () => {
    const txs = [transfer("A", "B", 5 * SOL), transfer("A", "B", 3 * SOL), transfer("B", "A", 2 * SOL)];
    const graph = buildInteractionGraph([side("A", txs)]);
    const [edge] = graph.edges;
    const aIsA = edge.a === "A";
    expect([aIsA ? edge.summary.aToB : edge.summary.bToA, aIsA ? edge.summary.bToA : edge.summary.aToB]).toEqual([2, 1]);
    expect(edge.summary.eventCategories).toEqual([{ category: "TRANSFER", count: 3 }]);
    expect(edge.summary.activeDays).toBe(3);
    expect(edge.interactions.map((it) => it.eventId)).toEqual(txs.map((t) => `solana:${t.signature}:event:0`));
  });

  it("ranks by value moved as well as by events, and says why each address is shown", () => {
    // Many small transfers with Busy, one large one with Whale; room for one counterparty.
    const txs = [...Array.from({ length: 6 }, () => transfer("A", "Busy", SOL / 10)), transfer("A", "Whale", 500 * SOL)];
    const byValue = buildInteractionGraph([side("A", txs)], { maxNodes: 2, ranking: "value" });
    // Busy is still there, collapsed into the unknown-wallets cluster.
    expect(byValue.nodes.filter((node) => node.kind !== "aggregate").map((node) => node.id).sort()).toEqual(["A", "Whale"]);
    const significant = buildInteractionGraph([side("A", txs)], { maxNodes: 3, observed: new Map([["Whale", 2]]) });
    const whale = significant.nodes.find((node) => node.id === "Whale");
    expect(whale?.reasons).toEqual(expect.arrayContaining(["Among the 5 that moved the most value", "In 2 behaviour observations"]));
    expect(significant.nodes.find((node) => node.id === "Busy")?.reasons).toContain("Among the 10 with the most events");
  });
});

describe("low-value connections", () => {
  const dust = 1000; // lamports: well under the dust threshold
  const txs = () => [transfer("A", "D", dust), transfer("A", "D", dust), transfer("A", "D", dust), transfer("A", "R", 5 * SOL), transfer("A", "M", dust), transfer("M", "A", 5 * SOL)];

  it("draws everything as before by default", () => {
    const graph = buildInteractionGraph([side("A", txs())]);
    expect(graph.edges.some((e) => e.lowValue)).toBe(false);
    expect(graph.counts.lowValueHidden).toBe(0);
  });

  it("flags dust-only connections to fade, keeping connections where real value also moved", () => {
    const graph = buildInteractionGraph([side("A", txs())], { lowValue: "faded" });
    const flagged = graph.edges.filter((e) => e.lowValue).map((e) => [e.a, e.b].sort().join("-"));
    expect(flagged).toEqual(["A-D"]);
  });

  it("leaves dust-only connections off before ranking, so they never take a real address's place, and counts them", () => {
    // Room for one counterparty: D has the most events, but only dust.
    expect(buildInteractionGraph([side("A", txs())], { maxNodes: 2, ranking: "interactions" }).nodes.map((n) => n.id)).toContain("D");
    const graph = buildInteractionGraph([side("A", txs())], { maxNodes: 2, ranking: "interactions", lowValue: "hidden" });
    expect(graph.nodes.map((n) => n.id)).not.toContain("D");
    expect(graph.counts.lowValueHidden).toBe(1);
    expect(graph.nodes.some((n) => n.id === "A" && n.kind === "wallet")).toBe(true);
  });

  it("never calls a token dust when its decimals aren't known", () => {
    const tx = makeTx({ signature: "tok", native: { A: [SOL, SOL - FEE] }, tokens: [token("a1", "A", "MINT", 10, 9), token("b1", "B", "MINT", 0, 1)] });
    expect(buildInteractionGraph([side("A", [tx])], { lowValue: "hidden" }).counts.lowValueHidden).toBe(0);
    expect(buildInteractionGraph([side("A", [tx])], { lowValue: "hidden", decimalsOf: () => 6 }).counts.lowValueHidden).toBe(1);
  });
});

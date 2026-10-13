import { describe, expect, it } from "vitest";
import { observeWallet } from "@/lib/behavior/observations";
import { buildInteractionGraph } from "@/lib/graph/build";
import type { RawParsedTransaction } from "@/lib/rpc/generic-adapter";
import { canonicalize } from "@/lib/solana/canonical";
import { reconstructWalletState } from "@/lib/state/reconstruct";
import { type NftCatalog, summarizeEffect } from "@/lib/state/summarize";
import { mergeLaneEvents } from "@/lib/timeline/lanes";
import { interpretTransaction } from "./interpret";
import { projectEvent } from "./projection";
import { FEE, makeTx, only, read, reconciles, SOL } from "./testing";

/**
 * Pinned readings for every recorded mainnet fixture. A change here means an
 * interpreter, the registry or the NFT parser now reads real transactions
 * differently: update the row only when the new reading is the intended one.
 */
const RECORDED: [file: string, category: string, action: string, interpreter: string, confidence: string][] = [
  ["basic/sol-transfer.json", "TRANSFER", "SEND", "generic-transfer", "HIGH"],
  ["basic/spl-transfer.json", "TRANSFER", "SEND", "generic-transfer", "HIGH"],
  ["basic/failed.json", "FAILED", "FAILED", "failed", "HIGH"],
  ["defi/jupiter-multi-hop.json", "SWAP", "SWAP", "jupiter-swap", "HIGH"],
  ["defi/jupiter-route-relayed.json", "SWAP", "SWAP", "jupiter-swap", "HIGH"],
  ["defi/okx-swap.json", "SWAP", "SWAP", "known-dex-swap", "MEDIUM"],
  ["defi/marinade-deposit.json", "STAKE", "LIQUID_STAKE", "marinade-liquid-stake", "HIGH"],
  ["defi/marinade-liquid-unstake.json", "UNSTAKE", "LIQUID_UNSTAKE", "marinade-liquid-stake", "HIGH"],
  ["defi/kamino-deposit.json", "LENDING", "DEPOSIT", "kamino-lending", "HIGH"],
  ["defi/kamino-repay.json", "LENDING", "REPAY", "kamino-lending", "HIGH"],
  ["defi/kamino-deposit-and-borrow.json", "LENDING", "BORROW+DEPOSIT", "kamino-lending", "MEDIUM"],
  ["defi/kamino-via-other-program.json", "PROGRAM_INTERACTION", "CALL", "generic-program", "LOW"],
  ["defi/cctp-v1-burn.json", "BRIDGE", "BRIDGE_OUT", "cctp-bridge", "HIGH"],
  ["defi/cctp-v2-burn.json", "BRIDGE", "BRIDGE_OUT", "cctp-bridge", "HIGH"],
  ["defi/cctp-v2-burn-with-hook.json", "BRIDGE", "BRIDGE_OUT", "cctp-bridge", "HIGH"],
  ["defi/cctp-v2-receive.json", "BRIDGE", "BRIDGE_IN", "cctp-bridge", "HIGH"],
  ["defi/native-stake-sale.json", "UNSTAKE", "STAKE_SALE", "native-stake", "MEDIUM"],
  ["defi/sanctum-unstake.json", "UNSTAKE", "INSTANT_UNSTAKE", "sanctum-unstake", "HIGH"],
  ["defi/spl-stake-pool-deposit-sol.json", "STAKE", "LIQUID_STAKE", "spl-stake-pool", "HIGH"],
  ["defi/sanctum-router-deposit.json", "STAKE", "LIQUID_STAKE", "spl-stake-pool", "HIGH"],
  ["defi/marginfi-borrow.json", "LENDING", "BORROW", "marginfi-lending", "HIGH"],
  ["defi/drift-withdraw-sol.json", "LENDING", "WITHDRAW", "drift-withdraw", "HIGH"],
  ["defi/pump-fun-sell.json", "SWAP", "SWAP", "known-dex-swap", "MEDIUM"],
  ["defi/relay-swap-deposit-token.json", "BRIDGE", "BRIDGE_OUT", "relay-bridge", "HIGH"],
  ["cnft/mint-v2.json", "NFT_MINT", "MINT", "generic-nft", "MEDIUM"],
  ["cnft/transfer.json", "NFT_TRANSFER", "SEND", "generic-nft", "MEDIUM"],
  ["magic-eden-core/transaction.json", "NFT_TRADE", "SELL", "metaplex-core", "HIGH"],
];

const sale = read<{ buyer: string; seller: string; mint: string; response: RawParsedTransaction }>("magic-eden-sale/transaction.json");
const saleNfts: NftCatalog = { isNft: (m) => m === sale.mint, royaltyRecipients: () => [] };
const tensor = read<{ buyer: string; seller: string; mint: string; response: RawParsedTransaction }>("nft-sale/transaction.json");

describe("recorded mainnet regressions", () => {
  it.each(RECORDED)("%s reads as %s · %s (%s, %s)", (file, category, action, interpreter, confidence) => {
    const tx = canonicalize(read<RawParsedTransaction>(file));
    const e = only(interpretTransaction(tx));
    expect([e.category, e.action, e.interpreter.id, e.confidence]).toEqual([category, action, interpreter, confidence]);
    expect(e.trace.at(-1)).toMatchObject({ id: interpreter, outcome: "matched" });
    if (e.flows.every((f) => f.source === "balance")) reconciles(e, tx);
  });

  it("Magic Eden and Tensor purchases read as NFT purchases", () => {
    const me = only(interpretTransaction(canonicalize(sale.response), { nfts: saleNfts }));
    const t = only(interpretTransaction(canonicalize(tensor.response), { nfts: { isNft: (m) => m === tensor.mint, royaltyRecipients: () => [] } }));
    expect([me.category, me.action, me.protocol?.id, t.category, t.action, t.protocol?.id]).toEqual(["NFT_TRADE", "BUY", "magic_eden", "NFT_TRADE", "BUY", "tensor"]);
  });
});

describe("deterministic edge cases", () => {
  it("reads a call to a program nobody knows as a program interaction, and nothing at all as unknown", () => {
    const call = only(interpretTransaction(makeTx({ native: { A: [SOL, SOL - FEE] }, instructions: [{ programId: "Unknown1111", program: null, type: null, info: null, accounts: [], data: null, outerIndex: null, stackHeight: null }] })));
    expect([call.category, call.confidence]).toEqual(["PROGRAM_INTERACTION", "LOW"]);
    expect(only(interpretTransaction(makeTx({ native: { A: [SOL, SOL - FEE] } }))).category).toBe("UNKNOWN");
  });

  it("finds a fund split and a consolidation across synthetic transfers", () => {
    const t = (from: string, to: string, sol: number, i: number) => ({ event: only(interpretTransaction(makeTx({ signature: `r${from}${to}${i}`, native: { [from]: [1000 * SOL, 1000 * SOL - sol * SOL - FEE], [to]: [SOL, SOL + sol * SOL] } }))), time: i * 60_000 });
    const split = observeWallet("W", [t("S", "W", 90, 0), t("W", "B", 30, 1), t("W", "C", 30, 2), t("W", "D", 30, 3)]);
    const consolidation = observeWallet("W", [t("B", "W", 5, 0), t("C", "W", 5, 1), t("D", "W", 5, 2)]);
    expect(split.map((o) => o.type)).toContain("FUND_SPLIT");
    expect(consolidation.map((o) => o.type)).toContain("CONSOLIDATION");
  });
});

describe("a transaction shared by two mapped wallets", () => {
  const tx = canonicalize(sale.response);
  const [event] = interpretTransaction(tx, { nfts: saleNfts });
  const sideOf = (wallet: string) => {
    const state = reconstructWalletState(wallet, [tx], { historyComplete: true });
    return { wallet, effects: state.effects, summaries: state.effects.map((e) => summarizeEffect(e, tx, saleNfts)), events: [event] };
  };

  it("is one event, seen from each side", () => {
    const [buyer, seller] = [projectEvent(event, sale.buyer)!, projectEvent(event, sale.seller)!];
    expect([buyer.eventId, buyer.action, seller.action]).toEqual([seller.eventId, "BUY", "SELL"]);
  });

  it("is one timeline item with an entry on each lane", () => {
    const merged = mergeLaneEvents([[{ signature: tx.signature, time: 1 }], [{ signature: tx.signature, time: 1 }]]);
    expect(merged).toHaveLength(1);
    expect(merged[0].entries.map((e) => e.lane)).toEqual([0, 1]);
  });

  it("is one graph connection between the two, counted once", () => {
    const graph = buildInteractionGraph([sideOf(sale.buyer), sideOf(sale.seller)]);
    const lines = graph.edges.filter((e) => e.kind === "interaction");
    expect(lines).toHaveLength(1);
    expect(lines[0].interactions).toHaveLength(1);
    expect(lines[0].interactions[0].eventId).toBe(event.id);
    // Seen from both mapped sides, the payment and the NFT are each recorded once.
    expect(lines[0].interactions[0].movements.map((m) => m.assetId).sort()).toEqual([sale.mint, "SOL"].sort());
  });
});

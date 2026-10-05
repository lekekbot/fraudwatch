import { describe, expect, it } from "vitest";
import type { RawParsedTransaction } from "@/lib/rpc/generic-adapter";
import { canonicalize } from "@/lib/solana/canonical";
import { type ExplainOptions, explainEvent, type Statement } from "./explain";
import { interpretTransaction } from "./interpret";
import { FEE, ix, makeTx, only, read, SOL, token, USDC } from "./testing";

const o: ExplainOptions = { name: (a) => a.slice(0, 4), amount: (amount, assetId) => `${amount} ${assetId.slice(0, 4)}`, asset: (a) => a.slice(0, 4) };
const by = (statements: Statement[], category: Statement["category"]) => statements.filter((s) => s.category === category).map((s) => `${s.status === "met" ? "✓" : "?"} ${s.text}`);

describe("explaining an event", () => {
  it("lays out a Magic Eden purchase: verified marketplace and fee account, the parser's roles, and the gaps", () => {
    const sale = read<{ mint: string; response: RawParsedTransaction }>("magic-eden-sale/transaction.json");
    const e = only(interpretTransaction(canonicalize(sale.response), { nfts: { isNft: (m) => m === sale.mint, royaltyRecipients: () => [] } }));
    const s = explainEvent(e, o);
    expect(by(s, "derived")).toEqual([
      "✓ Read as NFT_TRADE · BUY by the marketplace-nft-trade interpreter (v1).",
      "? No instruction was decoded: the reading rests on balance changes.",
      "✓ The NFT parser names EQKU as buyer and 6awn as seller.",
    ]);
    expect(by(s, "verified")).toEqual([
      "✓ Magic Eden is a protocol the registry verifies (nft marketplace).",
      "✓ Marketplace fee of 4000000000 SOL went to rFqF, a registry fee account.",
    ]);
    expect(by(s, "fact")).toEqual(expect.arrayContaining(["✓ The transaction succeeded.", "✓ On-chain metadata says 5Pur is an NFT.", "✓ Balance change: EQKU → 6awn: 178244273440 SOL."]));
    expect(by(s, "heuristic")).toEqual(expect.arrayContaining(["? 4 payments to recipients FraudWatch can't identify (often marketplace fees)."]));
  });

  it("says a decoded Jupiter route is backed by its instruction, with the route kept as evidence", () => {
    const e = only(interpretTransaction(canonicalize(read<RawParsedTransaction>("defi/jupiter-multi-hop.json"))));
    const s = explainEvent(e, o);
    expect(by(s, "derived")).toContain("✓ A known program's instruction was decoded and matches the balance changes.");
    expect(by(s, "verified")).toEqual(["✓ Jupiter is a protocol the registry verifies (dex aggregator)."]);
    expect(by(s, "heuristic").some((t) => t.includes("routing or settlement movement"))).toBe(true);
  });

  it("marks a swap through an unknown program as a pattern with no protocol and no decoded instruction", () => {
    const tx = makeTx({ native: { A: [10 * SOL, 9 * SOL - FEE], P: [SOL, 2 * SOL] }, tokens: [token("p", "P", USDC, 1000, 800), token("a", "A", USDC, 0, 200)], instructions: [ix("Unknown1111", null)] });
    const s = explainEvent(only(interpretTransaction(tx)), o);
    expect(s.filter((x) => x.status === "missing").map((x) => x.text)).toEqual([
      "No instruction was decoded: the reading rests on balance changes.",
      "No protocol the registry verifies performed this action.",
    ]);
    expect(by(s, "heuristic")).toContain("✓ The wallet gave up one asset and received another; no swap instruction was decoded.");
  });

  it("keeps user and community labels in their own categories, never as evidence", () => {
    const tx = makeTx({ native: { A: [10 * SOL, 9 * SOL - FEE], B: [SOL, 2 * SOL] }, instructions: [ix("11111111111111111111111111111111", "transfer")] });
    const labelOf = (a: string) => (a === "A" ? ({ source: "user", text: "Suspect" } as const) : a === "B" ? ({ source: "community", text: "Exchange 9" } as const) : undefined);
    const s = explainEvent(only(interpretTransaction(tx)), { ...o, labelOf });
    expect(by(s, "user_label")).toEqual(['✓ You labelled A "Suspect". Not used to interpret.']);
    expect(by(s, "community_label")).toEqual(['✓ Community labels call B…B "Exchange 9" (unverified). Not used to interpret.']);
    expect(by(s, "verified")).toEqual([]);
  });

  it("explains a failed transaction as a fact, and lists the behaviour observations an event is part of", () => {
    const failed = explainEvent(only(interpretTransaction(makeTx({ native: { A: [SOL, SOL - FEE] }, success: false }))), { ...o, observations: ["◆ Fund split: 100 SOL → 3 destinations"] });
    expect(by(failed, "fact")[0]).toBe("✓ The transaction failed; only the network fee was charged.");
    expect(by(failed, "heuristic")).toContain("✓ Part of a behaviour observation: ◆ Fund split: 100 SOL → 3 destinations.");
  });
});

import { describe, expect, it } from "vitest";
import type { RawParsedTransaction } from "@/lib/rpc/generic-adapter";
import { canonicalize } from "@/lib/solana/canonical";
import { loadFixture } from "@/test/fixture-rpc";
import { reconstructWalletState } from "./reconstruct";
import { summarizeEffect } from "./summarize";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

function summaries(fixtureId: string, walletIndex: number) {
  const fixture = loadFixture(fixtureId);
  const wallet = fixture.manifest.wallets[walletIndex].address;
  const wanted = new Set(fixture.manifest.expected.signaturesByWallet[wallet]);
  const txs = fixture.rpc
    .filter((c) => c.request.method === "getTransaction" && wanted.has(c.request.params[0] as string))
    .map((c) => canonicalize((c.response as { result: RawParsedTransaction }).result));
  const byId = new Map(txs.map((t) => [t.signature, t]));
  const state = reconstructWalletState(wallet, txs, { historyComplete: true });
  return { fixture, wallet, rows: state.effects.map((e) => ({ e, s: summarizeEffect(e, byId.get(e.signature)) })) };
}

describe("summarizeEffect", () => {
  it("reads A → B → C from the intermediary's side: receive, dust, send to C", () => {
    const { fixture, rows } = summaries("a-to-b-to-c", 1);
    const [a, , c] = fixture.manifest.wallets.map((w) => w.address);
    expect(rows.map((r) => r.s.kind)).toEqual(["RECEIVE", "RECEIVE", "SEND"]);
    expect(rows[0].s.inflows).toEqual([{ assetId: USDC, delta: "200000000" }]);
    expect(rows[0].s.counterparties[0]).toMatchObject({ address: a, assetId: USDC, delta: "-200000000" });
    // The forward's biggest counterparty is C; the relayer's 0.18 USDC fee comes second.
    expect(rows[2].s.counterparties.map((cp) => cp.address)[0]).toBe(c);
  });

  it("doesn't count the fee as a SOL transfer", () => {
    const { rows } = summaries("a-to-b-to-c", 0);
    const send = rows.find((r) => r.e.signature.startsWith("4C2F"))!;
    expect(send.s.kind).toBe("SEND");
    expect(send.s.outflows.map((o) => o.assetId)).toContain(USDC);
  });

  it("recognises a swap as one asset out and another in", () => {
    const { rows } = summaries("swap", 0);
    expect(rows.some((r) => r.s.kind === "SWAP")).toBe(true);
    const swap = rows.find((r) => r.s.kind === "SWAP")!;
    expect(new Set([...swap.s.outflows, ...swap.s.inflows].map((c) => c.assetId)).size).toBeGreaterThanOrEqual(2);
  });
});

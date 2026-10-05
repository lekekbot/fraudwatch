import { describe, expect, it } from "vitest";
import { NATIVE_SOL } from "@/lib/assets/assets";
import { registry } from "@/lib/protocols/registry";
import type { RawParsedTransaction } from "@/lib/rpc/generic-adapter";
import type { SemanticEvent } from "@/lib/semantic/events";
import { interpretTransaction } from "@/lib/semantic/interpret";
import { FEE, makeTx, read, SOL, token } from "@/lib/semantic/testing";
import { canonicalize } from "@/lib/solana/canonical";
import { type BehaviorType, observeWallet } from "./observations";

const W = "Wallet1111111111111111111111111111111111111";
const T0 = Date.parse("2026-04-01T12:00:00Z");
const at = (seconds: number) => T0 + seconds * 1000;
let n = 0;

/** A plain SOL transfer as a semantic event, signed by the sender. */
function transfer(from: string, to: string, lamports: number): SemanticEvent {
  const tx = makeTx({ signature: `sig${n++}`, native: { [from]: [1000 * SOL, 1000 * SOL - lamports - FEE], [to]: [SOL, SOL + lamports] } });
  return interpretTransaction(tx)[0];
}
const types = (obs: { type: BehaviorType }[]) => obs.map((o) => o.type);
const only = (obs: ReturnType<typeof observeWallet>, type: BehaviorType) => obs.filter((o) => o.type === type);

describe("rapid forwarding", () => {
  it("reads 100 SOL in and 95 out within 74 seconds as forwarding, with its evidence", () => {
    const incoming = transfer("Source", W, 100 * SOL);
    const out1 = transfer(W, "Next1", 60 * SOL);
    const out2 = transfer(W, "Next2", 35 * SOL);
    const [obs] = only(observeWallet(W, [{ event: incoming, time: at(0) }, { event: out1, time: at(30) }, { event: out2, time: at(74) }]), "RAPID_FORWARDING");
    expect(obs.events.map((e) => [e.role, e.eventId])).toEqual([
      ["source", incoming.id],
      ["destination", out1.id],
      ["destination", out2.id],
    ]);
    expect(obs.values).toEqual({ windowSeconds: 74, incomingAmount: String(100 * SOL), outgoingAmount: String(95 * SOL), coveragePercent: 95 });
    expect(obs.thresholds).toEqual({ windowSeconds: 600, minCoverage: 0.8, maxOutgoingRatio: 1.25 });
    expect([obs.start, obs.end, obs.assetId]).toEqual([at(0), at(74), NATIVE_SOL]);
  });

  it("holds at the window and coverage boundaries, and not past them", () => {
    const run = (seconds: number, sent: number) =>
      only(observeWallet(W, [{ event: transfer("Source", W, 100 * SOL), time: at(0) }, { event: transfer(W, "Next", sent * SOL), time: at(seconds) }]), "RAPID_FORWARDING").length;
    expect([run(600, 80), run(601, 80), run(60, 79)]).toEqual([1, 0, 0]);
  });

  it("doesn't read a small receipt and a large send from the wallet's own balance as forwarding", () => {
    // Seen on a real case: 0.01 SOL in, then 30,000 SOL out minutes later.
    const seq = [{ event: transfer("Source", W, SOL / 100), time: at(0) }, { event: transfer(W, "Next", 30_000 * SOL), time: at(480) }];
    expect(only(observeWallet(W, seq), "RAPID_FORWARDING")).toEqual([]);
    const within = [{ event: transfer("Source", W, 100 * SOL), time: at(0) }, { event: transfer(W, "Next", 125 * SOL), time: at(60) }];
    expect(only(observeWallet(W, within), "RAPID_FORWARDING")).toHaveLength(1);
  });

  it("doesn't count sending it back to the sender as forwarding", () => {
    const obs = observeWallet(W, [{ event: transfer("Source", W, 100 * SOL), time: at(0) }, { event: transfer(W, "Source", 100 * SOL), time: at(10) }]);
    expect(types(obs)).not.toContain("RAPID_FORWARDING");
    expect(types(obs)).toContain("CIRCULAR_MOVEMENT");
  });
});

describe("fund split and consolidation", () => {
  it("reads 100 SOL split three ways as a fund split, naming the receipt it came from", () => {
    const source = transfer("Source", W, 100 * SOL);
    const seq = [source, transfer(W, "B", 33 * SOL), transfer(W, "C", 33 * SOL), transfer(W, "D", 34 * SOL)].map((event, i) => ({ event, time: at(i * 20) }));
    const [obs] = only(observeWallet(W, seq), "FUND_SPLIT");
    expect(obs.values).toEqual({ windowSeconds: 40, branches: 3, totalAmount: String(100 * SOL), sourceAmount: String(100 * SOL) });
    expect(obs.events[0]).toMatchObject({ role: "source", eventId: source.id });
    expect(obs.events.slice(1).map((e) => e.counterparty)).toEqual(["B", "C", "D"]);
  });

  it("doesn't name a dust receipt as the source of a large split", () => {
    // Seen on a real case: 0.01 USDC in, then 11.6M USDC split three ways.
    const seq = [transfer("Tester", W, SOL / 50), transfer(W, "B", 300 * SOL), transfer(W, "C", 300 * SOL), transfer(W, "D", 300 * SOL)].map((event, i) => ({ event, time: at(i * 20) }));
    const [obs] = only(observeWallet(W, seq), "FUND_SPLIT");
    expect(obs.events.every((e) => e.role === "destination")).toBe(true);
    expect(obs.values.sourceAmount).toBeUndefined();
  });

  it("needs three different recipients: two isn't a split", () => {
    const seq = [transfer(W, "B", 10 * SOL), transfer(W, "C", 10 * SOL), transfer(W, "B", 10 * SOL)].map((event, i) => ({ event, time: at(i) }));
    expect(only(observeWallet(W, seq), "FUND_SPLIT")).toEqual([]);
  });

  it("reads three senders into one wallet within the window as consolidation", () => {
    const seq = [transfer("B", W, 5 * SOL), transfer("C", W, 5 * SOL), transfer("E", W, 5 * SOL)].map((event, i) => ({ event, time: at(i * 1200) }));
    const [obs] = only(observeWallet(W, seq), "CONSOLIDATION");
    expect(obs.values).toEqual({ windowSeconds: 2400, sources: 3, totalAmount: String(15 * SOL) });
    expect(only(observeWallet(W, seq.map((s, i) => ({ ...s, time: at(i * 1801) }))), "CONSOLIDATION")).toEqual([]);
  });
});

describe("circular movement", () => {
  it("reads 10 SOL sent and 6 returned within a week as circular", () => {
    const sent = transfer(W, "Peer", 10 * SOL);
    const back = transfer("Peer", W, 6 * SOL);
    const [obs] = only(observeWallet(W, [{ event: sent, time: at(0) }, { event: back, time: at(86_400) }]), "CIRCULAR_MOVEMENT");
    expect(obs.values).toMatchObject({ counterparty: "Peer", firstDirection: "out", returnPercent: 60, windowSeconds: 86_400 });
    expect(obs.events.map((e) => e.eventId)).toEqual([sent.id, back.id]);
  });

  it("doesn't count a return under half, or one after the window", () => {
    const run = (returned: number, seconds: number) =>
      only(observeWallet(W, [{ event: transfer(W, "Peer", 10 * SOL), time: at(0) }, { event: transfer("Peer", W, returned * SOL), time: at(seconds) }]), "CIRCULAR_MOVEMENT").length;
    expect([run(5, 60), run(4, 60), run(10, 7 * 86_400 + 1)]).toEqual([1, 0, 0]);
  });
});

describe("repeated counterparty", () => {
  it("needs five transfers with the same wallet", () => {
    const seq = (count: number) => Array.from({ length: count }, (_, i) => ({ event: i % 2 ? transfer("Friend", W, SOL) : transfer(W, "Friend", SOL), time: at(i * 86_400) }));
    const [obs] = only(observeWallet(W, seq(5)), "REPEATED_COUNTERPARTY");
    expect(obs.values).toMatchObject({ counterparty: "Friend", interactions: 5, sent: 3, received: 2 });
    expect(only(observeWallet(W, seq(4)), "REPEATED_COUNTERPARTY")).toEqual([]);
  });
});

describe("milestones", () => {
  it("surfaces a bridge out as a milestone, with its identifiers", () => {
    const event = interpretTransaction(canonicalize(read<RawParsedTransaction>("defi/cctp-v1-burn.json")))[0];
    const wallet = event.participants[0].address;
    const [obs] = observeWallet(wallet, [{ event, time: at(0) }]);
    expect(obs.type).toBe("BRIDGE_MILESTONE");
    expect(obs.values).toMatchObject({ direction: "out", chain: "ethereum", bridgedAmount: "1005000000", "identifier.nonce": "748815" });
  });

  it("calls a transfer an exchange deposit only for a verified exchange address", () => {
    const COINBASE = "H8sMJSCQxfKiFTCfDR3DUMLPwcRbM61LGFJ8N4dK3WjS";
    const exchangeOf = (address: string) => {
      const entry = registry.lookup(address);
      return entry?.category === "exchange" ? entry.protocolName : undefined;
    };
    const [obs] = only(observeWallet(W, [{ event: transfer(W, COINBASE, 5 * SOL), time: at(0) }], { exchangeOf }), "EXCHANGE_DEPOSIT");
    expect(obs.values).toEqual({ exchange: "Coinbase", deposits: 1, depositAddresses: 1, depositAddress: COINBASE, depositedAmount: String(5 * SOL) });
    // A run of deposits, each within a day of the last, is one observation; a gap starts another.
    const run = [0, 3600, 7200, 7200 + 86_401].map((s) => ({ event: transfer(W, COINBASE, SOL), time: at(s) }));
    const runs = only(observeWallet(W, run, { exchangeOf }), "EXCHANGE_DEPOSIT");
    expect(runs.map((o) => o.values.deposits)).toEqual([3, 1]);
    expect(runs[0].values).toMatchObject({ depositedAmount: String(3 * SOL), spanSeconds: 7200 });
    // A community label is not verification.
    expect(only(observeWallet(W, [{ event: transfer(W, "12CUDzb3oe8RBQ4tYGqsuPsCbsVE4KWfktXRihXf8Ggq", 5 * SOL), time: at(0) }], { exchangeOf }), "EXCHANGE_DEPOSIT")).toEqual([]);
  });
});

describe("false-positive controls", () => {
  it("ignores routing inside a swap: one multi-pool Jupiter route is no fan-out or fan-in", () => {
    const event = interpretTransaction(canonicalize(read<RawParsedTransaction>("defi/jupiter-multi-hop.json")))[0];
    expect(observeWallet(event.participants[0].address, [{ event, time: at(0) }])).toEqual([]);
  });

  it("ignores marketplace settlement: an NFT sale's fee, royalty and escrow legs are no split", () => {
    const sale = read<{ buyer: string; mint: string; response: RawParsedTransaction }>("magic-eden-sale/transaction.json");
    const event = interpretTransaction(canonicalize(sale.response), { nfts: { isNft: (m) => m === sale.mint, royaltyRecipients: () => [] } })[0];
    expect(observeWallet(sale.buyer, [{ event, time: at(0) }])).toEqual([]);
  });

  it("ignores fees, rent and dust", () => {
    const rent = 2_039_280;
    const seq = [transfer("Source", W, rent), transfer(W, "B", rent), transfer(W, "C", rent), transfer(W, "D", rent)].map((event, i) => ({ event, time: at(i) }));
    expect(observeWallet(W, seq)).toEqual([]);
  });

  it("treats wrapped SOL as SOL, and a token below its dust floor as nothing", () => {
    const wsol = (to: string, amount: number) =>
      interpretTransaction(makeTx({ signature: `sig${n++}`, native: { [W]: [SOL, SOL - FEE] }, tokens: [token(`a${n}`, W, "So11111111111111111111111111111111111111112", 100 * SOL, 100 * SOL - amount), token(`b${n}`, to, "So11111111111111111111111111111111111111112", 0, amount)] }))[0];
    const seq = [{ event: transfer("Source", W, 10 * SOL), time: at(0) }, { event: wsol("Next", 9 * SOL), time: at(5) }];
    expect(only(observeWallet(W, seq, { decimalsOf: () => 9 }), "RAPID_FORWARDING")).toHaveLength(1);
    const dust = [transfer("Source", W, 10 * SOL), wsol("B", 1), wsol("C", 1), wsol("D", 1)].map((event, i) => ({ event, time: at(i) }));
    expect(only(observeWallet(W, dust, { decimalsOf: () => 9 }), "FUND_SPLIT")).toEqual([]);
  });

  it("gives the same observations, with the same ids, every time", () => {
    const seq = [transfer("Source", W, 100 * SOL), transfer(W, "B", 50 * SOL), transfer(W, "C", 25 * SOL), transfer(W, "D", 25 * SOL)].map((event, i) => ({ event, time: at(i) }));
    expect(observeWallet(W, seq)).toEqual(observeWallet(W, [...seq].reverse()));
  });
});

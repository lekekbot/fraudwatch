import { describe, expect, it } from "vitest";
import { decodeMetaplexMetadata } from "@/lib/assets/assets";
import type { RawParsedTransaction } from "@/lib/rpc/generic-adapter";
import { interpretTransaction } from "@/lib/semantic/interpret";
import { only, read, reconciles } from "@/lib/semantic/testing";
import { canonicalize } from "@/lib/solana/canonical";
import type { TraceScope } from "./model";
import { buildMovementIndex, type CandidateQuery, candidates, chronologicalOrder, type Classified, classifyEvent } from "./movements";
import { event, transfer } from "./testing";

const fixture = (file: string) => {
  const tx = canonicalize(read<RawParsedTransaction>(file));
  return { tx, event: only(interpretTransaction(tx)) };
};
const kinds = (cs: Classified[]) =>
  cs.map((c) =>
    c.kind === "movement" ? `movement:${c.weight}` : c.kind === "boundary" ? `boundary:${c.boundary}` : c.kind === "excluded" ? `excluded:${c.reason}` : `conversion:${c.spent.map((a) => a.assetId.slice(0, 4))}->${c.received.map((a) => a.assetId.slice(0, 4))}`,
  );

describe("classifyEvent on recorded transactions", () => {
  it("F1: a SOL transfer is one primary movement, and the network fee is never a movement", () => {
    const { tx, event: e } = fixture("basic/sol-transfer.json");
    const cs = classifyEvent(e);
    expect(kinds(cs)).toEqual(["movement:primary"]);
    const [m] = cs as Extract<Classified, { kind: "movement" }>[];
    expect([m.ref.from, m.ref.amount]).toEqual([tx.accounts[0].address, "15906991"]);
  });

  it("an SPL transfer is one primary movement between owners", () => {
    expect(kinds(classifyEvent(fixture("basic/spl-transfer.json").event))).toEqual(["movement:primary"]);
  });

  it("a failed transaction is a boundary on its fee payer and nothing else", () => {
    const { tx, event: e } = fixture("basic/failed.json");
    expect(classifyEvent(e)).toEqual([{ kind: "boundary", signature: tx.signature, address: tx.accounts[0].address, boundary: "failed" }]);
  });

  it("F3: an NFT purchase keeps payment and NFT primary, other recipients supporting, settlement out", () => {
    const sale = read<{ buyer: string; seller: string; mint: string; response: RawParsedTransaction }>("magic-eden-sale/transaction.json");
    const tx = canonicalize(sale.response);
    const e = only(interpretTransaction(tx, { nfts: { isNft: (m) => m === sale.mint, royaltyRecipients: () => [] } }));
    const cs = classifyEvent(e);
    const primary = cs.filter((c) => c.kind === "movement" && c.weight === "primary") as Extract<Classified, { kind: "movement" }>[];
    expect(primary.map((c) => [c.ref.role, c.ref.from, c.ref.to])).toEqual([
      ["payment", sale.buyer, sale.seller],
      ["nft", sale.seller, sale.buyer],
    ]);
    expect(kinds(cs).filter((k) => k === "movement:supporting")).toHaveLength(5);
    expect(kinds(cs).filter((k) => k === "excluded:settlement")).toHaveLength(3);
    // Every leg stays one signature group.
    const index = buildMovementIndex([e], () => 0);
    expect(index.bySignature.get(tx.signature)).toHaveLength(7);
    reconciles(e, tx);
  });

  it("F3: a Tensor purchase keeps the royalty as a supporting leg of the same transaction", () => {
    const sale = read<{ buyer: string; seller: string; mint: string; response: RawParsedTransaction }>("nft-sale/transaction.json");
    const metadata = read<{ data: string }>("nft-sale/metadata-account.json");
    const creators = decodeMetaplexMetadata(Uint8Array.from(atob(metadata.data), (c) => c.charCodeAt(0)))!.creators!.filter((c) => c.share > 0).map((c) => c.address);
    const tx = canonicalize(sale.response);
    const e = only(interpretTransaction(tx, { nfts: { isNft: (m) => m === sale.mint, royaltyRecipients: (m) => (m === sale.mint ? creators : []) } }));
    const legs = classifyEvent(e).filter((c) => c.kind === "movement") as Extract<Classified, { kind: "movement" }>[];
    expect(legs.filter((c) => c.weight === "primary").map((c) => c.ref.role)).toEqual(["payment", "nft"]);
    expect(legs.filter((c) => c.ref.role === "royalty").map((c) => [c.weight, c.ref.to])).toEqual([["supporting", creators[0]]]);
    expect(new Set(legs.map((c) => c.ref.signature))).toEqual(new Set([tx.signature]));
    reconciles(e, tx);
  });

  it("F4: a multi-hop swap is one conversion on the trader; no pool becomes a counterparty", () => {
    const { tx, event: e } = fixture("defi/jupiter-multi-hop.json");
    const cs = classifyEvent(e);
    expect(kinds(cs).filter((k) => !k.startsWith("excluded"))).toEqual(["conversion:Hg5J->EPjF"]);
    expect(cs.find((c) => c.kind === "conversion")).toMatchObject({ address: tx.accounts[0].address });
    expect(buildMovementIndex([e], () => 0).outgoing.size).toBe(0);
  });

  it("a liquid stake and a receipt-token deposit are conversions; a repay and a borrow are positions", () => {
    const of = (f: string) => kinds(classifyEvent(fixture(f).event)).filter((k) => !k.startsWith("excluded"));
    expect(of("defi/marinade-deposit.json")).toEqual(["conversion:SOL->mSoL"]);
    expect(of("defi/kamino-deposit.json")).toEqual(["conversion:SOL,EPjF->B8V6"]);
    expect(of("defi/kamino-repay.json")).toEqual(["boundary:protocol_position"]);
    expect(of("defi/marginfi-borrow.json")).toEqual(["boundary:protocol_position"]);
    expect(of("defi/sanctum-unstake.json")).toEqual(["boundary:protocol_position"]);
  });

  it("a bridge out stops the trace; a bridge in is an arrival from off-chain, not a swap", () => {
    const out = fixture("defi/cctp-v1-burn.json").event;
    expect(kinds(classifyEvent(out))).toEqual(["excluded:settlement", "boundary:bridged_out"]);
    expect(classifyEvent(out).find((c) => c.kind === "boundary")).toMatchObject({ ref: { assetId: out.bridge!.asset!.assetId } });
    expect(kinds(classifyEvent(fixture("defi/cctp-v2-receive.json").event)).sort()).toEqual(["boundary:bridged_in", "excluded:bridge_cost", "excluded:settlement", "excluded:settlement"]);
    expect(kinds(classifyEvent(fixture("defi/relay-deposit-native.json").event)).filter((k) => !k.startsWith("excluded"))).toEqual(["boundary:bridged_out"]);
  });

  it("a compressed NFT mint enters supply; a compressed NFT transfer is a primary movement", () => {
    expect(kinds(classifyEvent(fixture("cnft/mint-v2.json").event))).toEqual(["boundary:entered_supply", "excluded:settlement"]);
    expect(kinds(classifyEvent(fixture("cnft/transfer.json").event))).toEqual(["movement:primary"]);
  });
});

describe("classifyEvent on synthetic edge cases", () => {
  it("a burn leaves supply; an unpaired side is ambiguous; zero is excluded", () => {
    expect(kinds(classifyEvent(event("b", [{ assetId: "M", from: "A", to: null, amount: "5" }], { category: "BURN" })))).toEqual(["boundary:left_supply"]);
    expect(kinds(classifyEvent(event("a", [{ assetId: "SOL", from: "A", to: null, amount: "5" }])))).toEqual(["boundary:ambiguous"]);
    expect(kinds(classifyEvent(event("z", [{ assetId: "SOL", from: "A", to: "B", amount: "0" }])))).toEqual(["excluded:zero"]);
  });

  it("a one-sided spend outside position categories is ambiguous, not a position", () => {
    expect(kinds(classifyEvent(event("s", [{ assetId: "SOL", from: "A", to: null, amount: "5", role: "spent" }], { category: "SWAP" })))).toEqual(["boundary:ambiguous"]);
  });

  it("does not mistake an NFT transfer with an unknown sender for a mint", () => {
    expect(kinds(classifyEvent(event("n", [{ assetId: "NFT", from: null, to: "A", amount: "1", role: "nft" }], { category: "NFT_TRANSFER" })))).toEqual(["boundary:ambiguous"]);
  });
});

const scope = (o: Partial<TraceScope> = {}): TraceScope => ({ assets: null, start: null, end: null, minAmount: null, maxHops: 6, ...o });
const query = (o: Partial<CandidateQuery> & Pick<CandidateQuery, "node">): CandidateQuery => ({
  direction: "forward",
  scope: scope(),
  exclude: new Set(),
  includeSupporting: false,
  hiddenReason: () => null,
  loaded: { complete: true, start: "2025-01-01T00:00:00.000Z", end: "2027-01-01T00:00:00.000Z" },
  caseRange: { start: "2025-01-01T00:00:00.000Z", end: "2027-01-01T00:00:00.000Z" },
  ...o,
});

describe("movement index and candidates", () => {
  const events = [
    transfer("s3", "A", "C", 30, 3),
    transfer("s1", "A", "B", 10, 1),
    event("s2", [
      { assetId: "USDC", from: "A", to: "B", amount: "7" },
      { assetId: "SOL", from: "A", to: "F", amount: "1", role: "marketplace_fee" },
    ]),
    transfer("s4", "B", "A", 2, 4),
  ];
  const order = new Map([
    ["s1", 0],
    ["s2", 1],
    ["s3", 2],
    ["s4", 3],
  ]);
  const index = buildMovementIndex(events, (s) => order.get(s));
  const sigs = (q: CandidateQuery, limit = 50) => candidates(index, q, { limit }).items.map((c) => c.ref.signature);

  it("lists an address's movements in chronological order, either way", () => {
    expect(index.outgoing.get("A")!.map((m) => m.ref.signature)).toEqual(["s1", "s2", "s2", "s3"]);
    expect(index.incoming.get("A")!.map((m) => m.ref.signature)).toEqual(["s4"]);
  });

  it("goes forward from the arrival and backward from the departure", () => {
    expect(sigs(query({ node: "A" }))).toEqual(["s1", "s2", "s3"]);
    expect(sigs(query({ node: "A", after: 2 }))).toEqual(["s3"]);
    expect(sigs(query({ node: "A", direction: "backward", before: 2 }))).toEqual([]);
    expect(sigs(query({ node: "A", direction: "backward" }))).toEqual(["s4"]);
  });

  it("filters by scope, skips what's already added and hides supporting legs unless asked", () => {
    expect(sigs(query({ node: "A", scope: scope({ assets: ["USDC"] }) }))).toEqual(["s2"]);
    expect(sigs(query({ node: "A", scope: scope({ minAmount: { assetId: "SOL", amount: "20" } }) }))).toEqual(["s2", "s3"]);
    const s1 = index.bySignature.get("s1")![0].ref.key;
    expect(sigs(query({ node: "A", exclude: new Set([s1]) }))).toEqual(["s2", "s3"]);
    expect(candidates(index, query({ node: "A", includeSupporting: true }), { limit: 50 }).items.map((c) => [c.ref.signature, c.weight, c.groupSize])).toEqual([
      ["s1", "primary", 1],
      ["s2", "primary", 2],
      ["s2", "supporting", 2],
      ["s3", "primary", 1],
    ]);
  });

  it("filters by time but keeps movements with no block time", () => {
    const timed = [event("t1", [{ assetId: "SOL", from: "A", to: "B", amount: "1" }], { time: "2026-02-01T00:00:00.000Z" }), event("t2", [{ assetId: "SOL", from: "A", to: "C", amount: "1" }], { time: null })];
    const idx = buildMovementIndex(timed, () => 0);
    expect(candidates(idx, query({ node: "A", scope: scope({ start: "2026-03-01T00:00:00.000Z" }) }), { limit: 50 }).items.map((c) => c.ref.signature)).toEqual(["t2"]);
  });

  it("marks hidden movements instead of dropping them, and pages", () => {
    const page = candidates(index, query({ node: "A", hiddenReason: (s) => (s === "s3" ? "rule" : null) }), { limit: 2 });
    expect([page.items.map((c) => [c.ref.signature, c.hidden]), page.total, page.nextCursor]).toEqual([
      [
        ["s1", null],
        ["s2", null],
      ],
      3,
      2,
    ]);
    const rest = candidates(index, query({ node: "A", hiddenReason: (s) => (s === "s3" ? "rule" : null) }), { cursor: 2, limit: 2 });
    expect([rest.items.map((c) => [c.ref.signature, c.hidden]), rest.nextCursor]).toEqual([[["s3", "rule"]], null]);
  });

  it("F7: says how complete the node's history is", () => {
    const of = (o: Partial<CandidateQuery>) => candidates(index, query({ node: "A", ...o }), { limit: 1 }).completeness;
    expect(of({})).toBe("complete");
    expect(of({ loaded: null })).toBe("partial_history");
    expect(of({ loaded: { complete: false, start: "2025-01-01T00:00:00.000Z", end: "2027-01-01T00:00:00.000Z" } })).toBe("partial_history");
    // Mapped from its first interaction in 2026: the case's 2025 isn't loaded for it.
    expect(of({ loaded: { complete: true, start: "2026-01-01T00:00:00.000Z", end: "2027-01-01T00:00:00.000Z" } })).toBe("outside_range");
    expect(of({ loaded: { complete: true, start: "2026-01-01T00:00:00.000Z", end: "2027-01-01T00:00:00.000Z" }, scope: scope({ start: "2026-02-01T00:00:00.000Z" }) })).toBe("complete");
  });

  it("orders transactions by slot, position in slot, then signature", () => {
    const base = canonicalize(read<RawParsedTransaction>("basic/sol-transfer.json"));
    const at = (signature: string, slot: number, transactionIndex: number) => ({ ...base, signature, slot, transactionIndex });
    expect([...chronologicalOrder([at("c", 2, 0), at("b", 1, 5), at("a", 1, 5), at("d", 1, 0)])]).toEqual([
      ["d", 0],
      ["a", 1],
      ["b", 2],
      ["c", 3],
    ]);
  });
});

describe("index and candidate budgets", () => {
  it("indexes 10 wallets / 5,000 transactions and pages a 5,000-movement address quickly", () => {
    const events = Array.from({ length: 5000 }, (_, i) =>
      event(`s${i}`, [
        { assetId: "SOL", from: "HOT", to: `W${i % 10}`, amount: String(i + 1) },
        { assetId: "USDC", from: `W${i % 10}`, to: `X${i}`, amount: "5" },
        { assetId: "SOL", from: `W${i % 10}`, to: "POOL", amount: "1", role: "settlement" },
      ], { slot: i }),
    );
    let started = performance.now();
    const index = buildMovementIndex(events, (s) => Number(s.slice(1)));
    const indexMs = performance.now() - started;
    started = performance.now();
    const page = candidates(index, query({ node: "HOT", after: 2500 }), { limit: 50 });
    const pageMs = performance.now() - started;
    expect([page.total, page.items.length]).toEqual([2500, 50]);
    // Budgets on a developer machine: index < 150 ms, page < 5 ms (Sprint 03); asserted generously for slower CI.
    expect(indexMs).toBeLessThan(1500);
    expect(pageMs).toBeLessThan(50);
  });
});

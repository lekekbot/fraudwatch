import { describe, expect, it } from "vitest";
import { decodeMetaplexMetadata, NATIVE_SOL } from "@/lib/assets/assets";
import { buildInteractionGraph } from "@/lib/graph/build";
import type { RawParsedTransaction } from "@/lib/rpc/generic-adapter";
import { canonicalize } from "@/lib/solana/canonical";
import { TOKEN_PROGRAM } from "@/lib/solana/programs";
import { reconstructWalletState } from "@/lib/state/reconstruct";
import { type NftCatalog, summarizeEffect } from "@/lib/state/summarize";
import { interpretTransaction } from "./interpret";
import { projectEvent } from "./projection";
import { FEE, ix, makeTx, only, read, reconciles, roles, SOL, TENTH, token } from "./testing";

describe("a real Tensor purchase (escrowed listing)", () => {
  const fixture = read<{ signature: string; buyer: string; seller: string; mint: string; response: RawParsedTransaction }>("nft-sale/transaction.json");
  const metadata = read<{ data: string }>("nft-sale/metadata-account.json");
  const creators = decodeMetaplexMetadata(Uint8Array.from(atob(metadata.data), (c) => c.charCodeAt(0)))!.creators!.filter((c) => c.share > 0).map((c) => c.address);
  const nfts: NftCatalog = { isNft: (m) => m === fixture.mint, royaltyRecipients: (m) => (m === fixture.mint ? creators : []) };
  const tx = canonicalize(fixture.response);
  const ESCROW = "52mQscyM9XS4uzzkFuj9hQreLfnMaReW8BMUHMzAEAZa";
  const TENSOR = "TCMPhJdwDryooaGtiocG1u3xcYbRpiJzb283XfCZsDp";

  it("is one NFT purchase with buyer, seller, NFT, marketplace and price", () => {
    const e = only(interpretTransaction(tx, { nfts }));
    expect([e.category, e.action, e.interpreter.id, e.confidence]).toEqual(["NFT_TRADE", "BUY", "marketplace-nft-trade", "MEDIUM"]);
    expect(e.protocol).toEqual({ id: "tensor", name: "Tensor", category: "nft_marketplace" });
    expect(e.nft).toEqual({
      assets: [fixture.mint],
      buyer: fixture.buyer,
      seller: fixture.seller,
      // 3.99322428 SOL left the buyer; 0.000085 of it was the network fee.
      price: { assetId: NATIVE_SOL, amount: "3993139280" },
      bundle: false,
      compressed: false,
    });
  });

  it("keeps fees, royalty and rent as flows of that event, not as parties to it", () => {
    const e = only(interpretTransaction(tx, { nfts }));
    expect(roles(e)).toEqual([`${fixture.buyer}:BUYER`, `${fixture.seller}:SELLER`, `${creators[0]}:ROYALTY_RECIPIENT`].sort());
    expect(e.flows.filter((f) => f.from === fixture.buyer).map((f) => [f.role, f.amount])).toEqual([
      ["payment", "3735136480"],
      ["royalty", "186500000"],
      ["unidentified", "37300000"],
      ["unidentified", "37300000"],
      ["rent", "1447680"],
    ]);
    expect(e.flows).toContainEqual({ assetId: fixture.mint, amount: "1", from: fixture.seller, to: fixture.buyer, source: "balance", role: "nft" });
    expect(e.infrastructure).toContainEqual({ address: ESCROW, role: "ESCROW", label: null });
    expect(e.infrastructure).toContainEqual({ address: TENSOR, role: "MARKETPLACE", label: "Tensor Marketplace" });
    expect(e.warnings).toEqual([]);
    reconciles(e, tx);
  });

  it("projects the same event to the buyer as a purchase and to the seller as a sale", () => {
    const [e] = interpretTransaction(tx, { nfts });
    const buyer = projectEvent(e, fixture.buyer)!;
    const seller = projectEvent(e, fixture.seller)!;
    expect([buyer.action, seller.action]).toEqual(["BUY", "SELL"]);
    expect(buyer.eventId).toBe(seller.eventId);
    expect(buyer.signature).toBe(fixture.signature);
    expect(projectEvent(e, creators[0])!.action).toBe("ROYALTY");
    expect(projectEvent(e, "NotInThisTransaction1111111111111111111111")).toBeNull();
  });

  it("keeps the underlying evidence inspectable", () => {
    const e = only(interpretTransaction(tx, { nfts }));
    expect(e.evidence).toEqual(
      expect.arrayContaining([
        { kind: "TRANSACTION_STATUS", success: true },
        { kind: "OUTER_INSTRUCTION", index: 2 },
        { kind: "NFT_TRADE_PARSER" },
        { kind: "ASSET_METADATA", assetId: fixture.mint },
        { kind: "KNOWN_ADDRESS", address: TENSOR, protocolId: "tensor", registryVersion: expect.any(Number) },
        expect.objectContaining({ kind: "TOKEN_DELTA", mint: fixture.mint }),
        { kind: "BALANCE_DELTA", account: fixture.buyer },
      ]),
    );
  });

  it("leaves the existing per-wallet NFT reading as it was", () => {
    const summary = summarizeEffect(reconstructWalletState(fixture.buyer, [tx], { historyComplete: true }).effects[0], tx, nfts);
    expect(summary.kind).toBe("NFT_BUY");
    expect(summary.nft).toMatchObject({ payment: { assetId: NATIVE_SOL, delta: "-3993139280" }, party: fixture.seller, marketplace: TENSOR });
    expect(summary.nft!.others.map((o) => o.role)).toEqual(["royalty", "unidentified", "unidentified", "rent"]);
  });
});

describe("a real Magic Eden v2 sale (deposit, buy and execute in one transaction)", () => {
  const fixture = read<{ signature: string; buyer: string; seller: string; mint: string; response: RawParsedTransaction }>("magic-eden-sale/transaction.json");
  const metadata = read<{ data: string }>("magic-eden-sale/metadata-account.json");
  const creators = decodeMetaplexMetadata(Uint8Array.from(atob(metadata.data), (c) => c.charCodeAt(0)))!.creators!.filter((c) => c.share > 0).map((c) => c.address);
  const nfts: NftCatalog = { isNft: (m) => m === fixture.mint, royaltyRecipients: (m) => (m === fixture.mint ? creators : []) };
  const tx = canonicalize(fixture.response);
  const TREASURY = "rFqFJ9g7TGBD8Ed7TPDnvGKZ5pWLPDyxLcvcH2eRCtt";
  const AUTHORITY = "1BWutmTvYPwDtmw9abTkS4Ssr8no61spGAvW1X6NDix";

  it("is one purchase, not a payment, a fee, four creator payouts and an NFT move", () => {
    const events = interpretTransaction(tx, { nfts });
    expect(events).toHaveLength(1);
    const [e] = events;
    expect([e.category, e.action, e.interpreter.id]).toEqual(["NFT_TRADE", "BUY", "marketplace-nft-trade"]);
    expect(e.protocol?.id).toBe("magic_eden");
    expect(e.nft).toEqual({ assets: [fixture.mint], buyer: fixture.buyer, seller: fixture.seller, price: { assetId: NATIVE_SOL, amount: "200000027840" }, bundle: false, compressed: false });
    expect(roles(e)).toEqual([`${fixture.buyer}:BUYER`, `${fixture.seller}:SELLER`].sort());
    reconciles(e, tx);
  });

  it("attaches the treasury fee and creator payouts to the purchase", () => {
    const e = only(interpretTransaction(tx, { nfts }));
    expect(e.flows).toContainEqual({ assetId: NATIVE_SOL, amount: "178244273440", from: fixture.buyer, to: fixture.seller, source: "balance", role: "payment" });
    expect(e.flows).toContainEqual({ assetId: NATIVE_SOL, amount: "4000000000", from: fixture.buyer, to: TREASURY, source: "balance", role: "marketplace_fee" });
    // The creators were changed after this 2022 sale, so today's metadata can't call these payouts royalties.
    expect(e.flows.filter((f) => f.role === "unidentified").map((f) => f.amount)).toEqual(["5328000000", "5328000000", "3552000000", "3552000000"]);
    expect(e.flows).toContainEqual({ assetId: fixture.mint, amount: "1", from: fixture.seller, to: fixture.buyer, source: "balance", role: "nft" });
  });

  it("keeps the treasury and the escrow authority out of the parties", () => {
    const e = only(interpretTransaction(tx, { nfts }));
    expect(e.infrastructure).toEqual(
      expect.arrayContaining([
        { address: "M2mx93ekt1fmXSVkTrUL9xVFHkmME8HTUi5Cyc5aF7K", role: "MARKETPLACE", label: "Magic Eden v2" },
        { address: TREASURY, role: "FEE_ACCOUNT", label: "Magic Eden Treasury" },
        { address: AUTHORITY, role: "PDA", label: "Magic Eden v2 Escrow Authority" },
      ]),
    );
    expect(e.participants.some((p) => p.address === TREASURY || p.address === AUTHORITY)).toBe(false);
  });

  it("gives buyer and seller their own view of the same event", () => {
    const [e] = interpretTransaction(tx, { nfts });
    const [buyer, seller] = [projectEvent(e, fixture.buyer)!, projectEvent(e, fixture.seller)!];
    expect([buyer.action, seller.action, buyer.eventId === seller.eventId, seller.signature]).toEqual(["BUY", "SELL", true, fixture.signature]);
    expect(seller.incoming.map((f) => f.role)).toEqual(["payment", "settlement"]);
  });
});

describe("a real Magic Eden pool fill of a Metaplex Core asset", () => {
  it("reads the Core sale, its buyer and seller, and the escrow payment", () => {
    const tx = canonicalize(read("magic-eden-core/transaction.json"));
    const e = only(interpretTransaction(tx));
    expect([e.category, e.action, e.interpreter.id, e.confidence, e.protocol?.id]).toEqual(["NFT_TRADE", "SELL", "metaplex-core", "HIGH", "magic_eden"]);
    expect(e.nft).toMatchObject({ assets: ["7n8shwGeS1EaxDtxgrdawdxsP1g8KykguBJ7k4fz2HFL"], buyer: "EcvXEE4Z8PEexQWQ3Wq1owpd6pKXqSGGsNEs9m897wMW", seller: "BYTak8a2aQXF3DMThvEYB1GfFtQ4bKxAt41GDvNVxwZE", compressed: false });
    expect(e.flows).toContainEqual(expect.objectContaining({ assetId: e.nft!.assets[0], source: "core_nft", role: "nft", from: e.nft!.seller, to: e.nft!.buyer }));
    expect(e.flows).toContainEqual(expect.objectContaining({ assetId: NATIVE_SOL, amount: "27317757", role: "payment" }));
    expect(roles(e)).toContain(`${e.nft!.buyer}:BUYER`);
    expect(roles(e)).toContain(`${e.nft!.seller}:SELLER`);
    expect(e.infrastructure).toContainEqual(expect.objectContaining({ address: "FQV448rvMmAvMxTgKwzruU8ANq1uXGykQZdF3tssNbs7", role: "ESCROW" }));
    expect(projectEvent(e, e.nft!.buyer!)?.action).toBe("BUY");
    const state = reconstructWalletState(e.nft!.seller!, [tx], { historyComplete: true });
    const graph = buildInteractionGraph([{ wallet: e.nft!.seller!, effects: state.effects, summaries: state.effects.map((effect) => summarizeEffect(effect, tx)), events: [e] }]);
    expect(graph.edges.filter((edge) => edge.kind === "interaction").map((edge) => [edge.a, edge.b].sort())).toEqual([[e.nft!.buyer, e.nft!.seller].sort()]);
  });

  it("keeps a plain Core transfer's previous owner unknown when no sale instruction supports it", () => {
    const tx = canonicalize(read("magic-eden-core/transaction.json"));
    tx.instructions = tx.instructions.filter((ix) => ix.programId !== "mmm3XBJg5gk8XJxEKBvdgptZz6SgK4tXvn36sodowMc");
    const e = only(interpretTransaction(tx));
    expect([e.category, e.action, e.interpreter.id, e.confidence]).toEqual(["NFT_TRANSFER", "TRANSFER", "metaplex-core", "MEDIUM"]);
    expect(e.flows).toContainEqual(expect.objectContaining({ source: "core_nft", from: null, to: "EcvXEE4Z8PEexQWQ3Wq1owpd6pKXqSGGsNEs9m897wMW" }));
  });
});

describe("real compressed NFT activity", () => {
  it("reads a Bubblegum transfer as an NFT transfer without pretending it's an SPL holding", () => {
    const e = only(interpretTransaction(canonicalize(read("cnft/transfer.json"))));
    expect([e.category, e.action, e.confidence]).toEqual(["NFT_TRANSFER", "SEND", "MEDIUM"]);
    expect(e.nft).toMatchObject({ buyer: null, seller: null, price: null, compressed: true });
    expect(e.flows).toEqual([expect.objectContaining({ amount: "1", source: "compressed_nft", role: "nft" })]);
    expect(e.participants.map((p) => p.role)).toEqual(["SENDER", "RECEIVER"]);
  });

  it("reads a mint paid for by someone else from the recipient's side", () => {
    const e = only(interpretTransaction(canonicalize(read("cnft/mint-v2.json"))));
    expect([e.category, e.action]).toEqual(["NFT_MINT", "MINT"]);
    expect(e.flows[0]).toMatchObject({ from: null, to: "DzUgDNBF5F11ksWhtDhoxzy2CnW9G4STw7yHk54AyGrA", role: "nft", source: "compressed_nft" });
    expect(roles(e)).toEqual(["DzUgDNBF5F11ksWhtDhoxzy2CnW9G4STw7yHk54AyGrA:RECEIVER", "GHDHUm2YiiUoTBxt3P7ZBQaPfogNXAHpUxwoYZSUoscn:SIGNER"]);
  });
});

describe("NFT trades the parser already supports", () => {
  const catalog = (...mints: string[]): NftCatalog => ({ isNft: (m) => mints.includes(m), royaltyRecipients: () => [] });

  it("reads a sale signed by the seller (an accepted bid) as SELL, with the same roles", () => {
    const tx = makeTx({ native: { S: [SOL, 11 * SOL - FEE], B: [20 * SOL, 10 * SOL] }, tokens: [token("ataS", "S", "NFTA", 1, 0), token("ataB", "B", "NFTA", 0, 1)] });
    const e = only(interpretTransaction(tx, { nfts: catalog("NFTA") }));
    expect([e.category, e.action]).toEqual(["NFT_TRADE", "SELL"]);
    expect(e.nft).toMatchObject({ buyer: "B", seller: "S", price: { assetId: NATIVE_SOL, amount: String(10 * SOL) } });
    expect(projectEvent(e, "B")!.action).toBe("BUY");
  });

  it("reads an accepted bid paid from the bidder's escrow with the bidder as buyer", () => {
    // Magic Eden v2: the seller signs, the bid's escrow pays, the NFT goes to the bidder.
    const tx = makeTx({ native: { S: [SOL, 11 * SOL - FEE], Escrow: [10 * SOL, 0] }, tokens: [token("ataS", "S", "NFTA", 1, 0), token("ataB", "B", "NFTA", 0, 1)] });
    const e = only(interpretTransaction(tx, { nfts: catalog("NFTA") }));
    expect([e.category, e.action]).toEqual(["NFT_TRADE", "SELL"]);
    expect(e.nft).toMatchObject({ buyer: "B", seller: "S", price: { assetId: NATIVE_SOL, amount: String(10 * SOL) } });
    expect(roles(e)).toEqual(["B:BUYER", "S:SELLER"]);
    expect(e.infrastructure).toContainEqual({ address: "Escrow", role: "ESCROW", label: null });
    expect(e.flows).toContainEqual(expect.objectContaining({ assetId: "NFTA", from: "S", to: "B", role: "nft" }));
    expect(e.flows).toContainEqual(expect.objectContaining({ assetId: NATIVE_SOL, from: "Escrow", to: "S", role: "payment", amount: String(10 * SOL) }));
    expect(projectEvent(e, "B")!.action).toBe("BUY");
  });

  it("marks a purchase of several NFTs at once as a bundle", () => {
    const tx = makeTx({
      native: { B: [20 * SOL, 15 * SOL - FEE], S: [SOL, 6 * SOL] },
      tokens: [token("s1", "S", "N1", 1, 0), token("b1", "B", "N1", 0, 1), token("s2", "S", "N2", 1, 0), token("b2", "B", "N2", 0, 1)],
    });
    const e = only(interpretTransaction(tx, { nfts: catalog("N1", "N2") }));
    expect([e.category, e.action]).toEqual(["NFT_TRADE", "BUY"]);
    expect(e.nft).toMatchObject({ assets: ["N1", "N2"], bundle: true, price: { amount: String(5 * SOL) } });
  });

  it("reads a plain SPL NFT transfer", () => {
    const tx = makeTx({ native: { A: [SOL, SOL - FEE] }, tokens: [token("a", "A", "NFTA", 1, 0), token("b", "B", "NFTA", 0, 1)], instructions: [ix(TOKEN_PROGRAM, "transferChecked")] });
    const e = only(interpretTransaction(tx, { nfts: catalog("NFTA") }));
    expect([e.category, e.action, e.interpreter.id]).toEqual(["NFT_TRANSFER", "SEND", "generic-nft"]);
    expect(e.nft).toMatchObject({ buyer: null, seller: null, price: null });
    expect(roles(e)).toEqual(["A:SENDER", "B:RECEIVER"]);
  });

  it("keeps a marketplace fee account out of the parties", () => {
    const FEES = "2rbMgYvzAb3xDk6vXrzKkY3VwsmyDZsJTkvB3JJYsRzA";
    const tx = makeTx({ native: { B: [20 * SOL, 9 * SOL - FEE], S: [SOL, 11 * SOL], [FEES]: [SOL, SOL + 10 * TENTH] }, tokens: [token("s", "S", "NFTA", 1, 0), token("b", "B", "NFTA", 0, 1)] });
    const e = only(interpretTransaction(tx, { nfts: catalog("NFTA") }));
    expect(e.flows).toContainEqual(expect.objectContaining({ to: FEES, role: "marketplace_fee", amount: String(SOL) }));
    expect(e.participants.some((p) => p.address === FEES)).toBe(false);
  });
});

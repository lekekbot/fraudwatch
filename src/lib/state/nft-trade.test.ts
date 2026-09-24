import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { RawParsedTransaction } from "@/lib/rpc/generic-adapter";
import { canonicalize } from "@/lib/solana/canonical";
import { reconstructWalletState } from "./reconstruct";
import { decodeMetaplexMetadata } from "@/lib/assets/assets";
import { NO_NFTS, type NftCatalog, summarizeEffect } from "./summarize";

/** A real Tensor purchase of an SMB Gen3 NFT, recorded from mainnet (2026-08-29 14:30:55 UTC). */
const fixture = JSON.parse(readFileSync(join(process.cwd(), "fixtures/solana/nft-sale/transaction.json"), "utf8")) as {
  signature: string;
  buyer: string;
  seller: string;
  mint: string;
  mintAccount: { decimals: number; supply: string };
  response: RawParsedTransaction;
};
const TENSOR = "TCMPhJdwDryooaGtiocG1u3xcYbRpiJzb283XfCZsDp";
const tx = canonicalize(fixture.response);
const metadata = JSON.parse(readFileSync(join(process.cwd(), "fixtures/solana/nft-sale/metadata-account.json"), "utf8")) as { data: string };
const creators = decodeMetaplexMetadata(Uint8Array.from(atob(metadata.data), (c) => c.charCodeAt(0)))!.creators!;
const royaltyRecipients = creators.filter((c) => c.share > 0).map((c) => c.address);
const catalog: NftCatalog = {
  isNft: (mint) => mint === fixture.mint,
  royaltyRecipients: (mint) => (mint === fixture.mint ? royaltyRecipients : []),
};
const only = (mints: string[]): NftCatalog => ({ isNft: (m) => mints.includes(m), royaltyRecipients: () => [] });

function summaryFor(wallet: string, nfts = catalog) {
  const [effect] = reconstructWalletState(wallet, [tx], { historyComplete: true }).effects;
  return summarizeEffect(effect, tx, nfts);
}

describe("NFT trades on a real Tensor sale", () => {
  it("records a mint the chain reports as an NFT (0 decimals, supply 1)", () => {
    expect(fixture.mintAccount).toEqual({ decimals: 0, supply: "1" });
  });

  it("reads the buyer's side as NFT_BUY: price, seller, marketplace and other recipients", () => {
    const s = summaryFor(fixture.buyer);
    expect(s.kind).toBe("NFT_BUY");
    expect(s.nft).toMatchObject({
      received: [fixture.mint],
      sent: [],
      // 3.99322428 SOL left the wallet; 0.000085 of that was the network fee, not the price.
      payment: { assetId: "SOL", delta: "-3993139280" },
      party: fixture.seller,
      marketplace: TENSOR,
    });
    // Everyone else paid in SOL, excluding the seller and token-account rent, each with its likely role.
    expect(s.nft!.others.map((o) => [o.amount, o.role])).toEqual([
      ["186500000", "royalty"], // 5% to the creator in the NFT's metadata
      ["37300000", "unidentified"], // 1% each: marketplace fees the registry doesn't list
      ["37300000", "unidentified"],
      ["1447680", "rent"], // an account created by this transaction
    ]);
    expect(s.nft!.others[0].address).toBe(royaltyRecipients[0]);
    expect(s.nft!.others.every((o) => o.address !== fixture.seller && o.address !== fixture.buyer)).toBe(true);
  });

  it("reads the seller's side as NFT_SELL although the NFT sat in marketplace escrow, not the seller's wallet", () => {
    const s = summaryFor(fixture.seller);
    expect(s.inflows.map((c) => c.assetId)).toEqual(["SOL"]);
    expect(s.kind).toBe("NFT_SELL");
    expect(s.nft).toMatchObject({
      received: [],
      sent: [fixture.mint],
      payment: { assetId: "SOL", delta: "3735136480" },
      party: fixture.buyer,
      marketplace: TENSOR,
    });
  });

  it("falls back to plain send/receive when the mint isn't known to be an NFT", () => {
    expect(summaryFor(fixture.buyer, NO_NFTS).kind).toBe("SWAP");
    expect(summaryFor(fixture.seller, NO_NFTS).kind).toBe("RECEIVE");
  });
});

describe("NFT mints and transfers", () => {
  const W = "W";
  const NFT = "NftMint";
  const base = {
    signature: "s",
    slot: 1,
    transactionIndex: null,
    timestamp: null,
    success: true,
    feeLamports: "5000",
    accounts: [{ address: W, signer: true, writable: true, source: "transaction" as const }],
    innerInstructions: [],
    raw: null,
  };
  const effect = (assetChanges: { assetId: string; delta: string }[]) => ({
    wallet: W,
    signature: "s",
    slot: 1,
    timestamp: null,
    success: true,
    assetChanges,
    feeLamports: "5000",
  });

  it("reads a mint instruction for the NFT as NFT_MINT, with the price paid", () => {
    const mintTx = {
      ...base,
      nativeChanges: [
        { account: W, pre: "10000000000", post: "8999995000", delta: "-1000005000" },
        { account: "Creator", pre: "0", post: "1000000000", delta: "1000000000" },
      ],
      tokenChanges: [{ account: "ata", owner: W, mint: NFT, programId: null, decimals: 0, pre: "0", post: "1", delta: "1" }],
      instructions: [
        { programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", program: "spl-token", type: "mintTo", info: { mint: NFT }, accounts: [], data: null, outerIndex: null, stackHeight: null },
      ],
    };
    const s = summarizeEffect(effect([{ assetId: "SOL", delta: "-1000005000" }, { assetId: NFT, delta: "1" }]), mintTx, only([NFT]));
    expect(s.kind).toBe("NFT_MINT");
    expect(s.nft).toMatchObject({ payment: { assetId: "SOL", delta: "-1000000000" }, party: "Creator" });
  });

  it("reads an NFT moving with nothing in return as NFT_TRANSFER", () => {
    const giftTx = {
      ...base,
      nativeChanges: [{ account: W, pre: "10000", post: "5000", delta: "-5000" }],
      tokenChanges: [
        { account: "a1", owner: W, mint: NFT, programId: null, decimals: 0, pre: "1", post: "0", delta: "-1" },
        { account: "a2", owner: "Friend", mint: NFT, programId: null, decimals: 0, pre: "0", post: "1", delta: "1" },
      ],
      instructions: [],
    };
    const s = summarizeEffect(effect([{ assetId: "SOL", delta: "-5000" }, { assetId: NFT, delta: "-1" }]), giftTx, only([NFT]));
    expect(s.kind).toBe("NFT_TRANSFER");
    expect(s.nft).toMatchObject({ payment: null, party: "Friend" });
  });

  it("reads several NFTs bought together as one NFT_BUY bundle", () => {
    const bundleTx = {
      ...base,
      nativeChanges: [
        { account: W, pre: "10000000000", post: "7999995000", delta: "-2000005000" },
        { account: "Seller", pre: "1", post: "2000000001", delta: "2000000000" },
      ],
      tokenChanges: ["N1", "N2"].map((mint) => ({ account: `ata-${mint}`, owner: W, mint, programId: null, decimals: 0, pre: "0", post: "1", delta: "1" })),
      instructions: [],
    };
    const s = summarizeEffect(
      effect([{ assetId: "SOL", delta: "-2000005000" }, { assetId: "N1", delta: "1" }, { assetId: "N2", delta: "1" }]),
      bundleTx,
      only(["N1", "N2"]),
    );
    expect(s.kind).toBe("NFT_BUY");
    expect(s.nft).toMatchObject({ received: ["N1", "N2"], sent: [], party: "Seller", payment: { delta: "-2000000000" } });
  });

  it("reads an NFT traded for another NFT as NFT_SWAP", () => {
    const swapTx = {
      ...base,
      nativeChanges: [{ account: W, pre: "10000", post: "5000", delta: "-5000" }],
      tokenChanges: [
        { account: "a1", owner: W, mint: "Mine", programId: null, decimals: 0, pre: "1", post: "0", delta: "-1" },
        { account: "a2", owner: "Them", mint: "Mine", programId: null, decimals: 0, pre: "0", post: "1", delta: "1" },
        { account: "a3", owner: "Them", mint: "Theirs", programId: null, decimals: 0, pre: "1", post: "0", delta: "-1" },
        { account: "a4", owner: W, mint: "Theirs", programId: null, decimals: 0, pre: "0", post: "1", delta: "1" },
      ],
      instructions: [],
    };
    const s = summarizeEffect(
      effect([{ assetId: "SOL", delta: "-5000" }, { assetId: "Mine", delta: "-1" }, { assetId: "Theirs", delta: "1" }]),
      swapTx,
      only(["Mine", "Theirs"]),
    );
    expect(s.kind).toBe("NFT_SWAP");
    expect(s.nft).toMatchObject({ received: ["Theirs"], sent: ["Mine"], payment: null, party: "Them" });
  });
});

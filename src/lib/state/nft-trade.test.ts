import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { RawParsedTransaction } from "@/lib/rpc/generic-adapter";
import { canonicalize } from "@/lib/solana/canonical";
import { reconstructWalletState } from "./reconstruct";
import { summarizeEffect } from "./summarize";

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
const isNft = (mint: string) => mint === fixture.mint;

function summaryFor(wallet: string, nftCheck = isNft) {
  const [effect] = reconstructWalletState(wallet, [tx], { historyComplete: true }).effects;
  return summarizeEffect(effect, tx, nftCheck);
}

describe("NFT trades on a real Tensor sale", () => {
  it("records a mint the chain reports as an NFT (0 decimals, supply 1)", () => {
    expect(fixture.mintAccount).toEqual({ decimals: 0, supply: "1" });
  });

  it("reads the buyer's side as NFT_BUY: price, seller, marketplace and other recipients", () => {
    const s = summaryFor(fixture.buyer);
    expect(s.kind).toBe("NFT_BUY");
    expect(s.nft).toMatchObject({
      mint: fixture.mint,
      // 3.99322428 SOL left the wallet; 0.000085 of that was the network fee, not the price.
      payment: { assetId: "SOL", delta: "-3993139280" },
      party: fixture.seller,
      marketplace: TENSOR,
    });
    // Fees and royalties: everyone else paid in SOL, excluding the seller and token-account rent.
    expect(s.nft!.others[0].amount).toBe("186500000");
    expect(s.nft!.others.every((o) => o.address !== fixture.seller && o.address !== fixture.buyer)).toBe(true);
  });

  it("reads the seller's side as NFT_SELL although the NFT sat in marketplace escrow, not the seller's wallet", () => {
    const s = summaryFor(fixture.seller);
    expect(s.inflows.map((c) => c.assetId)).toEqual(["SOL"]);
    expect(s.kind).toBe("NFT_SELL");
    expect(s.nft).toMatchObject({
      mint: fixture.mint,
      payment: { assetId: "SOL", delta: "3735136480" },
      party: fixture.buyer,
      marketplace: TENSOR,
    });
  });

  it("falls back to plain send/receive when the mint isn't known to be an NFT", () => {
    expect(summaryFor(fixture.buyer, () => false).kind).toBe("SWAP");
    expect(summaryFor(fixture.seller, () => false).kind).toBe("RECEIVE");
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
    const s = summarizeEffect(effect([{ assetId: "SOL", delta: "-1000005000" }, { assetId: NFT, delta: "1" }]), mintTx, (m) => m === NFT);
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
    const s = summarizeEffect(effect([{ assetId: "SOL", delta: "-5000" }, { assetId: NFT, delta: "-1" }]), giftTx, (m) => m === NFT);
    expect(s.kind).toBe("NFT_TRANSFER");
    expect(s.nft).toMatchObject({ payment: null, party: "Friend" });
  });
});

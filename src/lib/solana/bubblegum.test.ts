import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { RawParsedTransaction } from "@/lib/rpc/generic-adapter";
import { cnftMoves } from "./bubblegum";
import { canonicalize } from "./canonical";

/** Real Bubblegum transactions recorded from mainnet: a v1-tree transfer and a v2-tree mint. */
const load = (name: string) =>
  canonicalize(JSON.parse(readFileSync(join(process.cwd(), "fixtures/solana/cnft", `${name}.json`), "utf8")) as RawParsedTransaction);

describe("cnftMoves", () => {
  it("reads a compressed NFT transfer: asset id, previous owner and new owner", () => {
    const [move, ...rest] = cnftMoves(load("transfer"));
    expect(rest).toEqual([]);
    expect(move.kind).toBe("transfer");
    expect(move.assetId.startsWith("4LC5QFbi")).toBe(true);
    expect(move.from?.startsWith("A4oYqy")).toBe(true);
    expect(move.to.startsWith("7n3rZH")).toBe(true);
  });

  it("reads a compressed NFT mint with the name from its metadata", () => {
    const [move] = cnftMoves(load("mint-v2"));
    expect(move).toMatchObject({ kind: "mint", from: null, name: "0a0vTmqClrIb" });
    expect(move.assetId.startsWith("GAK8Lmyh")).toBe(true);
    expect(move.to.startsWith("DzUgDN")).toBe(true);
  });

  it("finds nothing in a transaction without Bubblegum", () => {
    const tx = canonicalize(
      (JSON.parse(readFileSync(join(process.cwd(), "fixtures/solana/nft-sale/transaction.json"), "utf8")) as { response: RawParsedTransaction }).response,
    );
    expect(cnftMoves(tx)).toEqual([]);
  });
});

describe("compressed NFTs in wallet summaries", () => {
  it("reads the real cNFT transfer as NFT_TRANSFER for the receiver and the sender", async () => {
    const { summarizeEffect } = await import("@/lib/state/summarize");
    const { reconstructWalletState } = await import("@/lib/state/reconstruct");
    const tx = load("transfer");
    const [move] = cnftMoves(tx);
    for (const [wallet, party, side] of [
      [move.to, move.from, "received"],
      [move.from!, move.to, "sent"],
    ] as const) {
      const [effect] = reconstructWalletState(wallet, [tx], { historyComplete: true }).effects;
      const s = summarizeEffect(effect, tx);
      expect(s.kind, side).toBe("NFT_TRANSFER");
      expect(s.nft?.[side], side).toEqual([move.assetId]);
      expect(s.nft?.party, side).toBe(party);
    }
  });

  it("reads the real cNFT mint as NFT_MINT for its owner", async () => {
    const { summarizeEffect } = await import("@/lib/state/summarize");
    const { reconstructWalletState } = await import("@/lib/state/reconstruct");
    const tx = load("mint-v2");
    const [move] = cnftMoves(tx);
    const [effect] = reconstructWalletState(move.to, [tx], { historyComplete: true }).effects;
    expect(summarizeEffect(effect, tx)).toMatchObject({ kind: "NFT_MINT", nft: { received: [move.assetId] } });
  });
});

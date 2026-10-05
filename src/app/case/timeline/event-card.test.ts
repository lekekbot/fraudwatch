import { describe, expect, it } from "vitest";
import { type AssetMetadata, builtinAsset, NATIVE_SOL } from "@/lib/assets/assets";
import { createNames } from "@/lib/labels/labels";
import { registry } from "@/lib/protocols/registry";
import type { RawParsedTransaction } from "@/lib/rpc/generic-adapter";
import { interpretTransaction } from "@/lib/semantic/interpret";
import { read } from "@/lib/semantic/testing";
import { canonicalize } from "@/lib/solana/canonical";
import { reconstructWalletState } from "@/lib/state/reconstruct";
import { type NftCatalog, summarizeEffect } from "@/lib/state/summarize";
import { eventCard } from "./event-card";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const assets = new Map<string, AssetMetadata>([
  [NATIVE_SOL, builtinAsset(NATIVE_SOL)!],
  [USDC, { ...builtinAsset(USDC)!, id: USDC, symbol: "USDC", decimals: 6 }],
]);
const names = createNames(new Map(), registry);
const time = Date.parse("2022-04-19T14:36:02Z");

/** The card for `wallet`'s lane, built the way the timeline builds it. */
function card(raw: RawParsedTransaction, wallet: string, nfts?: NftCatalog) {
  const tx = canonicalize(raw);
  const [event] = interpretTransaction(tx, { nfts });
  const state = reconstructWalletState(wallet, [tx], { historyComplete: true });
  return eventCard(event, wallet, time, state, summarizeEffect(state.effects[0], tx, nfts), assets, names);
}

describe("timeline cards from semantic events", () => {
  const sale = read<{ buyer: string; seller: string; mint: string; response: RawParsedTransaction }>("magic-eden-sale/transaction.json");
  const nfts: NftCatalog = { isNft: (m) => m === sale.mint, royaltyRecipients: () => [] };

  it("shows a Magic Eden purchase as one purchase on the buyer's lane", () => {
    const c = card(sale.response, sale.buyer, nfts);
    expect([c.tone, c.label, c.flow]).toEqual(["nft", "NFT purchase", "out"]);
    expect(c.lines.slice(1)).toEqual(["NFT PURCHASE · 5Pur…QtPp", "200.00002784 SOL", "Magic Eden"]);
  });

  it("shows the same sale to the seller, paid in", () => {
    const c = card(sale.response, sale.seller, nfts);
    expect([c.label, c.flow, c.lines[1]]).toEqual(["NFT sale", "in", "NFT SALE · 5Pur…QtPp"]);
  });

  it("shows a Jupiter route as one swap: spent → received, via Jupiter", () => {
    const c = card(read("defi/jupiter-multi-hop.json"), "CKuBTzPwzrCisqQMQfAjNn6jKcfny8ny4rJVN3cxLjcf");
    expect([c.tone, c.label, c.flow]).toEqual(["swap", "Swap", "none"]);
    expect(c.lines[2]).toMatch(/→ 50\.290869 USDC$/);
    expect(c.lines[3]).toBe("Jupiter");
  });

  it("shows a CCTP burn as a bridge out, with where it went", () => {
    const c = card(read("defi/cctp-v1-burn.json"), "DC7QfCakeJWTL3MsNLjawnn2NmBq5ZqXUdXwfQG4EXm8");
    expect([c.tone, c.label]).toEqual(["bridge", "Bridge out"]);
    expect(c.lines.slice(1)).toEqual(["BRIDGE OUT", "1,005 USDC", "→ Ethereum · Circle CCTP"]);
  });

  it("shows a liquid stake rather than a send and a receive", () => {
    const c = card(read("defi/marinade-deposit.json"), "8R4crYWNvunksmeM1MprWXgooexQSYZhR1gNUjhePqDZ");
    expect([c.tone, c.label, c.lines[3]]).toEqual(["defi", "Liquid stake", "Marinade"]);
  });
});

# Sprint 07B — NFT Trades

**Status:** ✅ Complete (checked 2026-09-24)

- **What counts as an NFT is checked on-chain, per mint** (`fetchAssetMetadata`, `src/lib/assets/assets.ts`): the mint account must show **0 decimals and a supply of exactly 1**. That covers standard, programmable, edition and Token-2022 NFTs. Semi-fungible tokens (0 decimals, many copies) and fungible tokens are not NFTs.
  - Only candidates are checked: tokens that moved exactly one unit with 0 decimals in any loaded transaction (`nftCandidates`), including other parties' balances. A seller never holds an escrowed listing, but its sale still needs the check.
  - The result is cached with the rest of the asset metadata (`AssetMetadata.nft`). Records saved before 07B have no `nft` field and are refetched once.
- **Classification** (`summarizeEffect`, `src/lib/state/summarize.ts`, tested against a recorded mainnet sale): four new kinds, applied before swap/send/receive and only for mints confirmed as NFTs.
  - **NFT_BUY:** the NFT came in and value went out.
  - **NFT_SELL:** the NFT went out and value came in, *or* the wallet was paid by an address that received an NFT in the same transaction. The second case is the marketplace-escrow sale, where the NFT sat in the marketplace's listing account rather than the seller's wallet.
  - **NFT_MINT:** the NFT came in through a `mintTo` of that mint.
  - **NFT_TRANSFER:** the NFT moved with nothing in return.
- **Trade details** (`EffectSummary.nft`): mint, what this wallet paid or received (net of the network fee), the other party (seller for a buy, buyer for a sale), everyone else paid in the payment asset (marketplace fees, royalties, rent; token-account rent excluded), and the marketplace program when the registry knows one (Tensor, Magic Eden).
- **UI:**
  - Cards read "NFT BUY · SMB Gen3 #86 / 3.99313928 SOL / ← seller" in a purple kind colour. The price is the headline so a narrow card never cuts it off.
  - The details panel has an **NFT trade** section: NFT, paid/received, seller/buyer (clickable), marketplace and the other recipients with amounts. Fees and royalties are labelled "most likely", since only the amounts are certain.
  - Filters gain NFT buy / sale / mint / transfer.
  - Kind labels show with spaces ("NFT BUY").
- **Summaries are computed once** in the workspace with the NFT check and passed to the timeline, table, graph, filters and counterparties. The timeline no longer computes its own.
- **Browser-checked** on the real case:
  - The 29 Aug 14:30 Tensor transaction became **NFT BUY · SMB Gen3 #86** instead of a swap (Swap 4 → 3, NFT buy 1).
  - Paid 3.99313928 SOL, seller `8GsK…bj1n`, marketplace Tensor Marketplace.
  - Other recipients: 0.1865, 0.0373, 0.0373 and 0.00144768 SOL.
  - The same transaction from the seller's side reads **NFT SELL**, received 3.73513648 SOL, buyer `dLm6…f5Vo` (fixture test).

**Goal:** Show an NFT purchase or sale as what it is, not as a plain SOL transfer.

## Follow-ups (done 2026-09-24)

- **Compressed NFTs** (`src/lib/solana/bubblegum.ts`, tested against a recorded mainnet v1-tree transfer and v2-tree mint):
  - Bubblegum instructions are matched by their Anchor discriminators (transfer, transfer_v2, mint_v1, mint_to_collection_v1, mint_v2).
  - Each is paired with the leaf-schema event it logs through SPL Noop or MPL Noop, which gives the asset id and the new owner. The layout was checked by locating known owner addresses in the event bytes, and the asset id was checked to equal the PDA of ("asset", tree, nonce) on both transactions.
  - The previous owner is `accounts[1]` for a v1 transfer, and the signer among its accounts for v2.
  - cNFT moves feed the same classification, so compressed buys, sales, mints, transfers and escrow sales read like token NFTs.
  - Names come from the mint instruction's metadata when a loaded transaction minted it, otherwise from the RPC's DAS `getAsset` (Helius and others). Providers without DAS show the shortened asset id.
- **Royalty vs fee vs rent:** Metaplex metadata is now decoded through the creators list (`decodeMetaplexMetadata`: royalty basis points, creators with verified flag and share). Each other recipient gets a role:
  - **royalty:** a creator with a share in a traded NFT.
  - **rent:** an account created in this transaction.
  - **marketplace fee:** a registry `fee_account`.
  - **unidentified:** anyone else.
  - On the real Tensor sale: 0.1865 SOL = 5% royalty to the single creator with a 100% share (500 bps, matching exactly), 2 × 0.0373 SOL (1% each) unidentified, 0.00144768 SOL rent. Pre-follow-up NFT metadata is refetched once to read creators.
- **Bundles:** `NftTrade` now lists every NFT `received` and `sent`. Cards say "3 NFTs"; details list each.
- **NFT-for-NFT swaps:** new `NFT_SWAP` kind (NFTs both ways, optionally with value alongside); cards read "A → B".

## Still open

- **Tensor and Magic Eden fee accounts aren't in the registry,** so their fees show as "unidentified". Add their fee accounts (verified on-chain) with role `fee_account` to label them.
- **cNFTs don't appear in wallet state** (opening/closing balances) or the "Assets moved" filter, because they have no token balances. They show in the trade details and cards.
- **v2 cNFT transfers** infer the previous owner from the signer; a delegate-signed transfer would name the delegate.

## Acceptance criteria

- [x] Whether a token is an NFT is checked on-chain, not guessed from the transaction.
- [x] A marketplace purchase reads as NFT BUY with price, seller and marketplace.
- [x] The seller's side reads as NFT SELL, including escrowed listings.
- [x] Mints and plain NFT transfers are distinguished.
- [x] Tokens that aren't NFTs are unaffected.
- [x] Compressed NFTs, bundles and NFT-for-NFT swaps are recognised.
- [x] Royalties are identified from the NFT's on-chain creators.

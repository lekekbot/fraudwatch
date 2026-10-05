# FraudWatch — Chronology & Semantic Events Initiative

FraudWatch is a local-first Solana investigation workbench focused on chronological transaction reconstruction.

Core product principle:

> The Timeline answers **what happened and when**.  
> The Graph answers **who interacted**.  
> The semantic event engine explains **what the blockchain activity means**.  
> The Inspector explains **why FraudWatch believes that interpretation**.

Project rules that apply to every sprint:

- Preserve local-first architecture.
- RPC remains the source of truth.
- Do not introduce automatic fraud verdicts.
- Preserve uncertainty when evidence is incomplete.
- Keep infrastructure separate from meaningful wallet counterparties.
- Do not automatically expand observed wallets into full-history ingestion.
- Every interpretation must remain traceable to canonical transaction evidence.
- Existing application functionality should continue working unless a sprint explicitly replaces it.


# CHRONOLOGY C3 — NFT Trade Reconstruction Consolidation

## Objective

Use FraudWatch's existing NFT functionality as the first complete semantic-event implementation.

Supported NFT trades should stop appearing as fragmented independent actions when they are actually one trade.

Magic Eden is the main regression target.

---

## Important constraint

FraudWatch already contains substantial NFT interpretation logic.

Do **not** rewrite proven NFT parsing unnecessarily.

Reuse and migrate existing logic for:

```text
buyer
seller
payment asset
payment amount
marketplace
royalties
marketplace fees
rent
unidentified recipients
NFT identity
compressed NFT handling
```

into the semantic event architecture.

---

## Primary requirement

A supported NFT purchase should produce one primary semantic event:

```text
NFT PURCHASE

Buyer
Seller
NFT
Marketplace
Price
```

Example:

```text
Buyer A bought Mad Lads #1234
from Seller B
via Magic Eden
for 42 SOL
```

Supporting flows remain attached:

```text
A → B              seller proceeds
A → marketplace    marketplace fee
A → creator        royalty
B → A              NFT
```

Do not display these as four unrelated primary actions.

---

## Wallet projections

The same semantic event may be projected differently depending on the selected wallet.

Buyer view:

```text
Bought Mad Lads #1234
42 SOL
Magic Eden
```

Seller view:

```text
Sold Mad Lads #1234
42 SOL
Magic Eden
```

Both must reference the same semantic event ID and signature.

Do not create independent buyer/seller events.

---

## NFT event types

Differentiate when evidence supports it:

```text
NFT PURCHASE
NFT SALE
NFT TRANSFER
NFT MINT
NFT SWAP
NFT BUNDLE
```

The event taxonomy should remain consistent with C1.

---

## Fees, royalties, rent, escrow

Treat:

- marketplace fee;
- creator royalty;
- rent;
- escrow movement;
- token-account setup;

as supporting flows/evidence where appropriate.

They should not normally become independent primary wallet relationships.

---

## Infrastructure

Known marketplace programs, escrows, fee accounts, PDAs, and token accounts should be classified as infrastructure unless evidence shows they are meaningful user-controlled counterparties.

---

## Compressed NFTs

Preserve existing compressed-NFT limitations.

Do not pretend compressed NFTs are traditional SPL holdings.

Semantic events may still represent compressed NFT activity when the existing decoder provides enough evidence.

---

## Regression fixtures

Add or reuse real-world fixtures covering at least:

- standard NFT transfer;
- NFT purchase;
- NFT sale;
- marketplace fee;
- creator royalty;
- rent/account creation;
- bundle where already supported;
- compressed NFT activity if existing fixtures allow it.

Prioritize Magic Eden because it demonstrates the fragmentation problem clearly.

---

## Inspector compatibility

A selected NFT semantic event must still allow access to:

- signature;
- buyer;
- seller;
- payment;
- NFT;
- marketplace;
- royalties;
- fees;
- underlying instructions;
- balance changes;
- raw/canonical transaction provenance.

---

## Acceptance criteria

C3 is complete when:

- supported NFT marketplace transactions produce one coherent semantic event;
- buyer and seller projections reference the same event;
- fees and royalties remain attached to that event;
- infrastructure no longer creates misleading primary actions;
- underlying evidence remains inspectable;
- existing NFT behavior is preserved;
- Magic Eden fragmentation regression tests pass.

---

## End-of-sprint report

Report:

1. NFT parser code reused;
2. NFT code migrated;
3. event projection design;
4. infrastructure handling;
5. Magic Eden cases fixed;
6. tests/fixtures added;
7. remaining unsupported NFT cases.

Do not begin C4 automatically.

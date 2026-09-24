# Sprint 04 — Wallet Asset-State Reconstruction

**Status:** ✅ Complete (checked 2026-09-24)

- Reconstruction: `src/lib/state/reconstruct.ts` (`RECONSTRUCTION_VERSION = 1`).
  - Every balance is observed from transaction pre/post metadata, not simulated.
  - State is tracked per account (the wallet's lamports and each token account it owns) and summed per mint. A transaction that touches one of several USDC accounts still gives the right wallet total.
  - Order is slot → `transactionIndex` → signature. `transactionIndex` was added to canonical transactions, so `PARSER_VERSION` is now 2 and cached transactions are re-derived from raw.
- Fees: the effect records the fee only when this wallet was the fee payer, and the SOL delta already includes it.
- `STATE_MISMATCH`: an account's balance after one transaction differs from its balance before the next. It is listed with the asset, account, expected and observed amounts, and the two signatures.
- Confidence: `OPENING_STATE_PARTIAL` / `CLOSING_STATE_PARTIAL` when history is incomplete or any mismatch exists, with the reasons shown. Holdings that didn't move in the range aren't visible (boundary snapshots are Sprint 10), and the UI says so.
- Assets: `src/lib/assets/assets.ts`. Identity is the mint address, with the reserved id `SOL` for native lamports.
  - Built-ins: SOL, wSOL, USDC, USDT, USDG.
  - Other mints: Token-2022 `tokenMetadata` extension first, then Metaplex metadata. Results are cached in `token_metadata`, and misses are retried after 7 days.
- Persistence (schema v3):
  - `wallet_states` records reconstruction version, parser version, `sourceSignatures` and completeness, and is reused only on an exact match.
  - Reconstruction is registered in `DERIVED_CACHES`, so a version bump clears it.
  - Clear transaction cache also clears `wallet_states` and `token_metadata`.
- UI: a "Wallet state" section on the case page (`src/app/case/wallet-state-view.tsx`).
  - It shows opening and closing state with badges, a mismatch banner, and per-transaction before/change/after rows with the fee noted on SOL.
  - Zero-change rows are hidden.
  - With several mapped wallets there's a switcher.
- Tests:
  - A → B → C: B's USDC goes 0 → 200 → 200.001 (poisoning dust) → 0, with fees attributed correctly.
  - 1,000-transaction wallet: every balance chains, and closing equals opening plus all deltas. Dropping one transaction produces `STATE_MISMATCH`.
  - Multi-account sum; recorded USDG/USDC mint metadata (`fixtures/metadata/`); cache reuse and invalidation.
- Browser-checked with the `simple-transfers` fixture: USDG 0 → +2,000 → 2,000 → −2,000 → 0, both states Observed, and the state reloads from cache.

**Goal:** Calculate portfolio state before and after every mapped-wallet transaction.

## Core display

For each transaction:

```text
BEFORE
CHANGE
AFTER
```

## Wallet effect

```ts
type WalletTransactionEffect = {
  wallet: string;
  signature: string;

  assetChanges: Array<{
    assetId: string;
    before?: string;
    delta: string;
    after?: string;
  }>;

  feeLamports: string;
};
```

## State sequence

```text
OPENING
   ↓
BEFORE TX1
   ↓
AFTER TX1
   ↓
BEFORE TX2
   ↓
AFTER TX2
   ↓
...
   ↓
CLOSING
```

## Asset registry

Track assets using mint address as identity.

Metadata:

```text
mint
symbol
name
decimals
logo optional
```

Do not use token symbol as the primary key.

## Opening state

Attempt to establish opening state from available historical information.

If exact historical state cannot be reconstructed:

```text
OPENING_STATE_PARTIAL
```

must be visible.

## Fees

SOL fees must be reflected in state change.

## State mismatch

If reconstructed state contradicts a provider-observed balance:

```text
STATE_MISMATCH
asset
expected
observed
```

Never hide this.

## Persistence

Derived wallet states are cached in IndexedDB with:

```text
reconstruction_version
source_transaction_hashes
```

## Acceptance criteria

- [x] Every in-range transaction has wallet-specific deltas.
- [x] Before/change/after can be rendered.
- [x] Fees are included.
- [x] Asset identity uses mint address.
- [x] Opening/closing confidence is visible.
- [x] State mismatches are surfaced.

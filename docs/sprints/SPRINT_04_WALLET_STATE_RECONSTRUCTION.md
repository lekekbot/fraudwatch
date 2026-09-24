# Sprint 04 — Wallet Asset-State Reconstruction

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

- [ ] Every in-range transaction has wallet-specific deltas.
- [ ] Before/change/after can be rendered.
- [ ] Fees are included.
- [ ] Asset identity uses mint address.
- [ ] Opening/closing confidence is visible.
- [ ] State mismatches are surfaced.

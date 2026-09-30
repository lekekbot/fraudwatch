# Sprint 07 — Dynamic Secondary-Wallet Mapping

**Status:** ✅ Complete (checked 2026-09-24)

- **Map wallet:** the address inspector's button (observed addresses only) opens `MapWalletDialog` with three range choices.
  - From first interaction (default): the earliest loaded transaction involving the address in any role, via `firstInteraction`.
  - From case start.
  - Custom start: a UTC day.
  - Confirming saves the case and loads every mapped wallet. Already-covered wallets come from the cache, so in practice only the new one hits the RPC. The new wallet is selected.
- **Model** (`src/lib/case/wallet-range.ts`, tested): `mapWallet` appends `{ address, rangeMode, customStart, addedFromWallet }`.
  - It rejects duplicates and starts at or after the case end, and clamps starts before the case start.
  - `walletRange` gives each wallet its own range, ending at the case end.
  - `unmapWallet` removes a mapped wallet but never the primary.
- **Per-wallet ranges** run through `ingestWallets` (`ranges` option), `readCachedIngestion`, `useIngestion` and `useWalletStates`.
  - Wallet state cache keys use the wallet's own range.
  - A mapped wallet's timeline runs from its own start: OPEN sits at its first interaction.
- **Reuse:** transactions are still stored once by signature. A transaction already loaded for another wallet, or cached, is reused, and the wallet's stats now count it as reused rather than leaving it uncounted (regression test).
- **Intersections** (`src/lib/ingest/intersections.ts`, tested): `sharedTransactions` compares every pair of mapped wallets, not just the new wallet and its parent. Transaction details show a **Shared with** row linking the other mapped wallets.
- **Expansion summary:** the left panel shows "Mapping X" with transactions in range, already cached, fetched, shared counts per mapped wallet, and new observed addresses (`mappingSummary`), until dismissed.
- **Shallow by default:** addresses the new wallet reveals appear as OBSERVED counterparties. Nothing is mapped recursively.
- **Remove from map** (mapped wallets' inspector) drops the wallet from the case. Its label, tags, note and cached chain data stay, and transactions other wallets need are untouched because storage is per signature, not per wallet.
- **Stale results fixed:** `useIngestion` re-reads the cache on every config change (e.g. after an unmap) unless a load is running or has finished since. A generation counter stops a slow cached read from replacing a newer result.
- **Browser-checked** on the real case by mapping `8GsK…bj1n`:
  - The dialog defaulted to first interaction, 2026-08-29 14:30:55 UTC.
  - It loaded 5 transactions (4 fetched, 1 already loaded for the primary), 1 shared with the primary, and 4 new observed addresses.
  - Its timeline opened at its first interaction, with Shared with on the Tensor purchase that links the two wallets.
  - Removing it restored the one-wallet case with all 65 primary transactions, and that survived a reload.

**Follow-ups found during the check:**

- **Lookalike addresses.** The mapped wallet had two *different* counterparties that both display as `Hcmh…Px4x`, the address-poisoning pattern. Shortened addresses can't tell them apart. A lookalike warning (same prefix and suffix, different address) belongs with Sprint 09's search and filters or sooner.
- **Forked lanes** (the new wallet's line branching off at its first interaction) are the Sprint 08 multi-lane layout. Mapped wallets are still viewed one at a time here.
- **Busy wallets** are bounded by the existing ingestion safety limits (5,000 signatures or 25 pages per address) and marked "Partial history" when those are hit.

**Goal:** Promote observed addresses into fully mapped wallets on user request.

## User flow

```text
Observed B
   ↓
Map wallet
   ↓
choose mapping range
   ↓
load B history
   ↓
reconstruct B state
   ↓
find intersections
```

## Range choices

Default:

```text
From first relevant interaction
```

Options:

```text
From case start
From first interaction
Custom start
```

End defaults to case end.

## Intersection search

When B is mapped:

```text
compare B's loaded transaction signatures
against ALL currently mapped wallets
```

Show every shared transaction.

Do not only connect B to the wallet that introduced it.

## Reuse

If transaction already exists locally:

```text
reuse canonical transaction
```

Add B's effect/state.

## Newly observed addresses

B may reveal:

```text
C
D
E
```

They remain observed.

No recursive expansion.

## Expansion progress

Example:

```text
Mapping B

193 transactions in range
41 already cached
152 fetched

Shared with mapped wallets:
A: 4 transactions
C: 2 transactions

New observed addresses:
27
```

## Unmap behavior

Removing B from map:

- remove lane;
- keep label/tag;
- keep cached blockchain data unless user clears it;
- preserve transactions needed by other lanes.

## Acceptance criteria

- [x] User can map any observed wallet.
- [x] User controls its start range.
- [x] Shared transactions are reused.
- [x] Intersections with all mapped wallets are found.
- [x] Newly discovered wallets stay shallow.
- [x] Unmapping does not corrupt cached transactions.

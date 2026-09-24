# Sprint 03 — IndexedDB Cache and Local Persistence

**Status:** ✅ Complete (checked 2026-09-24)

- Schema v2 (`src/lib/db/db.ts`):
  - `transactions`: parsed transactions keyed `solana:<signature>`, tagged with `parserVersion`.
  - `raw_transactions`: the RPC's original responses.
  - `wallet_transactions`: index of wallet, signature and blockTime.
  - `coverage` and `ingestion_jobs`: which ranges each wallet has loaded, and each case's last load result.
  - `meta`: the version each derived cache was built with.
  - Upgrading from v1 keeps existing cases and RPC settings (tested). `wallet_states`, `token_metadata`, `protocol_cache` and `ui_state` are added by the sprints that fill them.
- Coverage ranges: `src/lib/cache/coverage.ts`.
  - Only complete ranges skip the RPC; gaps are what's left of the requested range.
  - History newer than 2 minutes before a load is never cached as complete, so recent activity gets refetched.
- Ingestion takes a cache (`src/lib/db/transaction-cache.ts`): it fetches only uncovered sub-ranges and never re-requests a cached transaction. A failed cache write, such as storage being full, becomes a warning instead of stopping the load.
- Derived-cache invalidation: `src/lib/db/derived.ts`.
  - When a registered cache's version changes, it is cleared.
  - Parsed transactions are then rebuilt from `raw_transactions` without refetching.
  - Sprints 04 and 06 register wallet-state and protocol caches there.
- UI:
  - The case page shows cached history on open, and its button becomes "Load missing history".
  - Each wallet shows how many transactions came from the cache and how many were fetched.
  - Delete case removes the case and its load record, but keeps shared chain data.
  - `/settings/storage` (linked in the header) shows cache size and can clear the transaction cache or all local data.
- Tests replay the fixtures against fake-indexeddb, covering:
  - a reopened case making zero RPC calls;
  - each shared transaction stored once;
  - extending the range fetching only the new part;
  - partial coverage not being trusted;
  - the finality margin;
  - storage-full warnings;
  - parser-version re-derivation without the network;
  - clearing data.

**Goal:** Avoid re-fetching the same blockchain history every time the browser reopens.

## Stores

Recommended IndexedDB stores:

```text
cases
rpc_settings
transactions
wallet_transactions
wallet_states
token_metadata
protocol_cache
ingestion_jobs
ui_state
```

## Transaction cache key

```text
solana:<signature>
```

## Wallet history key

Store a lightweight index:

```text
wallet address
signature
timestamp
```

Do not duplicate the full transaction object per wallet.

## Cache lookup

Before fetching:

```text
requested wallet + date range
        ↓
check cached coverage
        ↓
fetch only missing ranges
```

## Coverage record

```ts
type CachedCoverage = {
  wallet: string;
  ranges: Array<{
    start: string;
    end: string;
    complete: boolean;
  }>;
};
```

## Cache invalidation

Blockchain historical transactions are effectively immutable after sufficient confirmation, so old transaction data can be retained.

Invalidate:

- parsed/enriched views when parser version changes;
- protocol annotations when registry version changes;
- wallet-state projections when reconstruction version changes.

## Storage controls

Settings:

```text
View cache size
Clear transaction cache
Clear case
Clear all local data
```

## Quota handling

Detect storage quota errors and surface them cleanly.

## Acceptance criteria

- [x] Reopening a case does not refetch cached transactions unnecessarily.
- [x] Same transaction is stored once.
- [x] Coverage gaps are detectable.
- [x] Parser/registry version changes can invalidate derived caches.
- [x] User can clear local data.

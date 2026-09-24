# Sprint 03 — IndexedDB Cache and Local Persistence

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

- [ ] Reopening a case does not refetch cached transactions unnecessarily.
- [ ] Same transaction is stored once.
- [ ] Coverage gaps are detectable.
- [ ] Parser/registry version changes can invalidate derived caches.
- [ ] User can clear local data.

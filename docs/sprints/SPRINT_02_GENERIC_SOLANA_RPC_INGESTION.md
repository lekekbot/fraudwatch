# Sprint 02 — Generic Solana RPC Ingestion

**Status:** ✅ Complete (checked 2026-09-24)

- JSON-RPC client with retry/backoff on 429/502–504: `src/lib/rpc/json-rpc.ts` (the connection test now uses it too).
- Generic adapter: `src/lib/rpc/generic-adapter.ts`.
- Canonical transaction: `src/lib/solana/canonical.ts`.
- Ingestion: `src/lib/ingest/ingest.ts`. Order: wallet signatures → transactions → token accounts (currently owned under both token programs, plus any the wallet owned in loaded transactions) → their signatures → missing transactions. Signatures are deduplicated per wallet and transactions across wallets. Safety limits (`DEFAULT_LIMITS`): 5,000 in-range signatures and 25 pages per address, 4 parallel `getTransaction` calls.
- UI: "Transactions" card on the case page (`src/app/case/ingestion-panel.tsx`) with progress, a Cancel button, per-wallet coverage and warnings, and a partial-history banner.
- Tests replay the recorded mainnet fixtures, including the transfer reachable only via a token account and the 1,000-transaction generated wallet. A live mainnet run of the A → B → C wallets matched the fixture.
- Not yet: results are held in memory only (the cache is Sprint 03); `enhanced` provider type falls back to standard RPC; safety limits aren't exposed in the UI.

**Goal:** Retrieve bounded wallet history using standard Solana RPC methods.

## Generic RPC adapter

Initial methods:

```text
getSignaturesForAddress
getTransaction
getTokenAccountsByOwner
getAccountInfo
getBalance
getTokenAccountBalance
getLatestBlockhash or lightweight health call
```

## Ingestion flow

```text
wallet
  ↓
getSignaturesForAddress
  ↓
paginate through requested period
  ↓
getTransaction for signatures
  ↓
canonicalize
  ↓
deduplicate
```

## Token-account coverage

For owned token accounts:

```text
wallet
  ↓
getTokenAccountsByOwner
  ↓
token accounts
  ↓
retrieve relevant signatures when necessary
  ↓
merge + deduplicate
```

Keep this adapter separate from enhanced providers.

## Canonical transaction

```ts
type CanonicalTransaction = {
  signature: string;
  slot: number;
  timestamp: string | null;
  success: boolean;

  feeLamports: string;

  accounts: CanonicalAccount[];
  nativeChanges: NativeBalanceChange[];
  tokenChanges: TokenBalanceChange[];

  instructions: CanonicalInstruction[];
  innerInstructions: CanonicalInstruction[];

  raw: unknown;
};
```

## Scope rules

Stop retrieval when:

- older than case start;
- provider history exhausted;
- user cancels;
- configurable safety limit reached.

## Completeness metadata

```ts
type IngestionCoverage = {
  complete: boolean;
  oldestLoaded?: string;
  newestLoaded?: string;
  signatureCount: number;
  transactionCount: number;
  warnings: string[];
};
```

## Progress UI

```text
Loading signatures...
421 signatures found

Fetching transactions...
312 / 421

Token account history...
4 / 7
```

## Cancellation

All ingestion operations must support `AbortController`.

## Acceptance criteria

- [x] Generic Solana RPC can load a bounded wallet history.
- [x] Transactions are canonicalized.
- [x] Duplicate signatures are removed.
- [x] Token-account-related activity is accounted for where possible.
- [x] Partial history is visibly marked.
- [x] User can cancel ingestion.

# Sprint 02 — Generic Solana RPC Ingestion

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

- [ ] Generic Solana RPC can load a bounded wallet history.
- [ ] Transactions are canonicalized.
- [ ] Duplicate signatures are removed.
- [ ] Token-account-related activity is accounted for where possible.
- [ ] Partial history is visibly marked.
- [ ] User can cancel ingestion.

# Sprint 09 — Scaling, Aggregation, Filters, and Navigation

**Goal:** Keep the mapper usable on real high-volume wallets.

## Level of detail

### Far zoom

```text
13 Mar
82 transactions
```

### Medium zoom

```text
21 transfers
8 swaps
3 protocol interactions
```

### Near zoom

Individual transactions.

## Virtualization

Render only:

```text
visible viewport
+ small buffer
```

Do not mount every node/card simultaneously.

## Visual aggregation

Aggregation must never rewrite canonical transactions.

Possible grouping:

```text
time bucket
wallet
counterparty
asset
transaction type
```

## Filters

Sprint 05A already added single-wallet filters by transaction type, by asset moved and individual hiding (`src/lib/timeline/filter.ts`). Extend those to the multi-wallet graph rather than starting over.

- mapped wallet;
- observed address;
- token/mint;
- minimum amount;
- direction;
- transaction type;
- protocol;
- tag;
- date subrange;
- failed/successful.

## Search

Search:

```text
wallet
label
tag
signature
mint
token symbol
protocol
```

## Bookmarks

Allow bookmarks on:

```text
wallet
transaction
date
```

## Performance targets

Test:

```text
1 wallet / 1,000 tx
5 wallets / 2,000 tx
10 wallets / 5,000 tx
```

The exact performance budget should be measured, not guessed.

## Acceptance criteria

- [ ] 1,000 transactions are easy to navigate.
- [ ] 5,000-transaction cases degrade through clustering rather than freezing.
- [ ] Filtering is interactive.
- [ ] Search jumps to matching items.
- [ ] Time context remains visible at every zoom level.

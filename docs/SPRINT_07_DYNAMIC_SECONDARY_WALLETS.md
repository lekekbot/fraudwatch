# Sprint 07 — Dynamic Secondary-Wallet Mapping

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

- [ ] User can map any observed wallet.
- [ ] User controls its start range.
- [ ] Shared transactions are reused.
- [ ] Intersections with all mapped wallets are found.
- [ ] Newly discovered wallets stay shallow.
- [ ] Unmapping does not corrupt cached transactions.

# Sprint 05 — Single-Wallet Chronological Mapper

**Goal:** Turn the current one-wallet MVP into a production-quality chronological timeline.

## Layout

```text
X = time
Y = one wallet lane
```

Example:

```text
OPEN ──●────●──────────●──────●──────── CLOSE
```

## Transaction card

Collapsed:

```text
12 Feb · 15:42
TRANSFER
-10,000 USDC
→ 7Yx...Fsa
```

Expanded side panel:

```text
signature
timestamp
status
protocol if known

wallet before
wallet changes
wallet after

counterparties
raw accounts
raw instructions
raw JSON
explorer link
```

## Spacing modes

### Time spacing

Physical spacing reflects time gaps.

### Event spacing

Events remain readable regardless of gap.

Allow toggle or adaptive behavior.

## Timeline controls

- pan;
- zoom;
- jump to date;
- next/previous transaction;
- fit range;
- reset view.

## Minimap

Show activity histogram across case period.

## Dense intervals

Cluster dense periods rather than overlapping nodes.

Example:

```text
[ 47 transactions · 13 Mar ]
```

## Acceptance criteria

- [ ] One wallet with 1,000 transactions remains usable.
- [ ] Chronological order is obvious.
- [ ] Before/change/after is accessible from every transaction.
- [ ] Raw details are accessible.
- [ ] Dense periods do not become unreadable.

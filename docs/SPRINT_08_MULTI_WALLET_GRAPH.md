# Sprint 08 — Multi-Wallet Chronological Graph

**Goal:** Render several mapped wallets as chronological lanes.

## Layout invariant

```text
X = transaction time/event order
Y = mapped wallet lane
```

## Example

```text
TIME ─────────────────────────────────────────────────►

A   OPEN ─●──────────●────────────────────────●─ CLOSE
                    │                        ▲
                    │                        │
B         OPEN ─────●─────●───────────────●──●─ CLOSE
                          │
                          ▼
C                OPEN ────●─────────●────────── CLOSE
                                      │
                                      ▼
D                           OPEN ─────●────●──── CLOSE
```

## Lane order

Default:

1. primary wallet;
2. mapped wallets ordered by first appearance.

User can reorder lanes.

## Shared transaction

Render one transaction at one X coordinate.

Use connectors to every mapped wallet involved.

## Loops

Transactions such as:

```text
D → A
```

must remain understandable chronologically.

Do not attempt to "center" A.

## Observed endpoints

Unmapped E appears adjacent to the relevant transaction:

```text
B lane ──●──► E
```

not as a full lane.

## Wallet header

Show:

```text
label
short address
tags
opening assets summary
closing assets summary
net change
hide
unmap
```

## Focus mode

Allow:

```text
Focus A + D
```

without deleting other mapped wallets.

## Acceptance criteria

- [ ] 5+ mapped wallets render coherently.
- [ ] Shared transactions appear once.
- [ ] Loops are readable.
- [ ] Lane order is user-controlled.
- [ ] Observed wallets do not become lanes.

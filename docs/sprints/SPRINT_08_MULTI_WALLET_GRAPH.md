# Sprint 08 — Multi-Wallet Chronological Graph

**Status:** ✅ Complete (checked 2026-09-25); loop arrows covered by tests only (see below)

- **Lanes** (`TimelineCanvas`, `WalletTimeline`): the Timeline view draws one lane per visible mapped wallet, stacked; a single wallet keeps the centred two-tier layout. Each lane runs from its own range start (OPEN) to the case end (CLOSE).
- **Forks:** a wallet mapped from its first interaction branches off the lane it was mapped from (`addedFromWallet`) with a dashed curve at that moment, the layout agreed after Sprint 07A.
- **One transaction, one x** (`mergeLaneEvents`, `src/lib/timeline/lanes.ts`, tested): transactions are merged across lanes by signature. A shared one has an entry per lane at the same x and is joined by a vertical connector.
  - Connectors point from each lane that lost value to each that gained it (`connectors`, tested, including loops back to earlier lanes such as D → A). When direction isn't clear (swaps, program calls, all-receive) they join adjacent lanes without arrows.
  - Selecting a transaction highlights its connector and echoes it on the other lanes.
- **Chronology first:** x is time, or event order shared by every lane in event spacing, so loops stay in time order and no lane is re-centred. Clustering and cards run per lane; stacked lanes use one card tier (`placeCards` `tiers: 1`).
- **Many lanes:** the canvas grows taller than the view and scrolls vertically. The time axis stays pinned to the bottom of what's visible; horizontal wheel or Ctrl/⌘+wheel zooms; selecting a transaction scrolls its lane into view.
- **Lane order** (`src/lib/case/lanes.ts`, tested): primary first, then by first appearance. Up/down controls on each wallet row save `laneOrder` on the case; wallets missing from it follow in default order.
- **Hide / focus:** hiding a lane saves `hiddenLanes` (still mapped and loaded). Focus shows only the chosen lanes ("Focus: A + D · Clear focus") without changing the mapping or hidden set.
- **Wallet header:** lanes show the label, short address and first tag on the canvas; clicking a lane name opens it in the inspector with label, tags, note, opening and closing state, **net change** (closing minus opening per asset, `netChange`, tested), hide/show lane and remove from map.
- **Observed endpoints** stay on the cards ("← 8qu…8Px"); they never become lanes.
- **Details** say whose side of a shared transaction they show ("Wallet: …") and list every other mapped wallet in "Shared with". Filters apply per wallet to every lane; counts in the timeline cover the visible lanes.
- **Browser-checked** with a throwaway copy of the real case: the primary plus four low-activity counterparties mapped from first interaction, deleted afterwards.
  - Five lanes in first-appearance order, forks from the primary, and vertical scrolling with the axis pinned.
  - Reorder moved a lane from 5th to 3rd and it was saved; hide and focus (primary + one) worked.
  - Event spacing kept shared transactions on one x. No console errors.
  - Found in the data: one transaction at 29 Aug 14:31:01 sent 1 lamport from `8quCXg…byq8Px` to the primary and three of its counterparties at once, an address-poisoning dust spray. It showed as a single event joining four lanes.
  - Fixed during the check: lane controls squeezed wallet names in the left panel; they now overlay on hover.

**Not checked in the browser:** a directed connector between two lanes (one lane sending to another). The test wallets only received shared transactions, so every connector was the undirected kind. Direction and loop handling are covered by unit tests.

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

- [x] 5+ mapped wallets render coherently.
- [x] Shared transactions appear once.
- [x] Loops are readable (chronological x, directed connectors; unit-tested, not yet seen in real data).
- [x] Lane order is user-controlled.
- [x] Observed wallets do not become lanes.

# Sprint 09 — Scaling, Aggregation, Filters, and Navigation

**Status:** ✅ Complete (checked 2026-09-25)

- **Levels of detail** (`TimelineCanvas`):
  - **Far:** clusters read "82 tx / 13 Mar", as before.
  - **Medium:** each cluster has a composition bar coloured by transaction type, and hovering gives the breakdown ("22 tx · 2 Jun – 16 Jun / 13 program call · 4 receive · 3 send · 2 swap").
  - **Near:** individual cards.
- **Time context at every zoom:** when the axis shows only times (under 3 days in view), the day is pinned at its left ("Sat 29 Aug 2026"); otherwise the year is.
- **Virtualisation:** the timeline and graph are single canvases, so no DOM node is mounted per event. Each frame lays out clusters per lane and paints only what's in view plus a card-width margin.
- **Aggregation never rewrites data:** clusters, buckets and the composition bar are computed per frame from the canonical transactions; nothing is stored.
- **Filters** (`src/lib/timeline/filter.ts`, tested), extending Sprint 05A. Everything is precomputed per transaction as a `FilterableTx` (time, summary, protocols used, addresses involved), so a filter click is only comparisons.
  - Transaction type, including **failed** (so failed/successful is covered).
  - Asset moved.
  - **Direction** (incoming / outgoing; a swap is both).
  - **Minimum amount** of a chosen asset, typed in normal units and converted with `parseUnits` (tested).
  - **Protocol** (only selected; registry names and counts).
  - **Tag** (only transactions involving an address with the tag).
  - **Observed address** ("Show only its transactions" in the address inspector; a chip in Filters to clear it).
  - **Date sub-range.**
  - Individually hidden transactions.
  - **Mapped wallet** is covered by Sprint 08's hide and focus.
  - In the timeline, filters and counts apply across every visible lane.
- **Search** (`src/lib/search.ts`, tested; ⌘K or the Search button):
  - Finds mapped wallets, labelled and observed addresses (by label, tag, note, registry name or pasted address prefix), tags, transactions (pasted signature prefix), tokens (symbol or name) and protocols.
  - Going to a result: a wallet or address opens it; a transaction selects it on the timeline via a `WalletTimeline` `jumpTo` handle; a token or protocol jumps to the first transaction involving it; a tag filters to it.
- **Bookmarks** (`src/lib/case/bookmarks.ts`, tested; saved on the case):
  - Star a transaction in its details (its lane is remembered) or an address in its inspector, or "Bookmark this moment" in the timeline toolbar (the centre of the view).
  - The left-panel Bookmarks list jumps to each; a date opens the timeline on a week around it.
- **Performance work:** summaries are computed once per wallet and cached separately from filtering, so a filter click no longer re-summarises every transaction. Compressed-NFT decoding is skipped for transactions that don't touch Bubblegum.
  - Canvas text widths are cached by font and text, card text is truncated by binary search, and cluster labels are formatted once per frame.
  - These removed 65–175 ms main-thread stalls when zooming 10 wallets / 5,000 transactions.

## Performance (measured 2026-09-25)

**Pipeline** (`PERF=1 pnpm vitest run src/test/perf.test.ts`; synthetic wallets from `generateHighActivity`, Node 24, MacBook). One frame's layout is the median of 7 frames at 1×, 8×, 64× and 512× zoom, 1200 px wide:

| Target | Reconstruct | Summarise | Filter data | Filter click | Merge lanes | One frame's layout |
|---|---|---|---|---|---|---|
| 1 wallet / 1,000 tx | 11.7 ms | 5.7 ms | 1.6 ms | 0.4 ms | 0.4 ms | 0.2–0.5 ms |
| 5 wallets / 2,000 tx | 5.3 ms | 6.5 ms | 1.9 ms | 0.5 ms | 0.6 ms | 0.6–1.1 ms |
| 10 wallets / 5,000 tx | 11.1 ms | 12.1 ms | 8.0 ms | 0.9 ms | 1.9 ms | 1.1–2.4 ms |

**Real app, browser** (10 wallets / 5,000 synthetic transactions seeded into IndexedDB, `next dev`, Chrome):

- **Load:** the case shell appeared in about 1.7 s and the full 10-lane timeline was ready in about 3.7–4.3 s (3 runs, same-origin iframe timing). Most of the gap is reading 5,000 transactions from IndexedDB and reconstructing on development builds; a production build should be faster, but that wasn't measured.
- **Zoom/pan:** before the text-measurement fixes, zoom steps caused 65 ms and 175 ms long tasks. After them, a zoom in → pan → zoom out sequence produced **no long tasks** (none over 50 ms).
- **Filters:** toggling types at 5,000 transactions updated the count straight away (5,000 → 2,898 → 197 → 84) with no long tasks.
- The synthetic case and all seeded records were deleted afterwards.
- A first attempt that replaced `requestAnimationFrame` to time frames hung the tab for over 45 s. It was a harness artefact (without the patch nothing hung) and isn't included in the numbers.

**Not measured:** a production build in the browser, and real (non-synthetic) wallets at these sizes.

**Browser-checked on the real case:**
- Filters: protocols marginfi 24 / Kamino 4 / CCTP 2 / …; only Tensor → 1; outgoing → 14; at least 10 USDC → 19.
- Search: "kamino", "usdc", a signature prefix, and the user's own label "njj" all found the right item; picking the signature selected it on the timeline.
- Bookmarks: transaction and date bookmarks saved and listed; test bookmarks removed.
- Cluster breakdowns and the day context label appeared.

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

- [x] 1,000 transactions are easy to navigate.
- [x] 5,000-transaction cases degrade through clustering rather than freezing.
- [x] Filtering is interactive.
- [x] Search jumps to matching items.
- [x] Time context remains visible at every zoom level.

# Sprint 05 — Single-Wallet Chronological Mapper

**Status:** ✅ Complete (checked 2026-09-24)

- **Rendering:** a custom `<canvas>` (`src/app/case/timeline/`) with `d3-zoom` for gestures and `d3-scale`/`d3-time` for the UTC axis and calendar buckets.
  - No graph library fit. React Flow zooms by magnifying nodes and mounts a DOM node per event. vis-timeline is DOM-based and has no connectors between lanes, which Sprint 08 needs.
  - Zoom stretches time rather than magnifying cards, and only x pans.
- **Layout** (`src/lib/timeline/layout.ts`, all pure and tested):
  - Events are grouped by pixel gap. Dense runs split into calendar buckets (minute → month) wide enough for a two-line pill ("82 tx" / "13 Mar").
  - Overlapping shapes merge by measured width, so pills never collide.
  - Single events get a card above the lane, then below, otherwise a dot.
- **Cards:** date and time, kind (`src/lib/state/summarize.ts`: SEND / RECEIVE / SWAP / FEE / FAILED from balance changes, fee excluded), headline amount, and the top counterparty.
- **Side panel:** signature, time, status, slot, protocol placeholder (Sprint 06), fee, and before/change/after for each asset. Also counterparties, raw accounts and instructions, raw JSON (loaded from `raw_transactions` on demand) and an explorer link.
- **Spacing:** Time or Event toggle. Transactions sharing a second can't be separated by time; opening or selecting one switches to event spacing.
- **Controls:** scroll-zoom, drag-pan, ± zoom, Fit range, Reset, previous/next (← / → keys, Esc closes the panel), jump to date, and click-to-open clusters. Selecting zooms until the transaction stands on its own.
- **Minimap:** a square-root activity histogram across the case period with the visible window drawn on it; click or drag to move.
- The Table view from Sprint 04 is still available through a Timeline/Table toggle.
- **Browser-checked** with the 1,000-transaction synthetic wallet: six pills totalling 1,000 at full range → day buckets → cards. The details panel, raw JSON, jump to 10 May (lands on 11 May 13:45), arrow keys, event spacing and minimap all work, with no console errors.
  - Fixed during the check: pills overlapping; the view jumping weeks off when the panel resized the canvas; a span clamp capping deep zoom at about 570× (now `fitTransform`, with a regression test); a 12-hour axis clock.

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

- [x] One wallet with 1,000 transactions remains usable.
- [x] Chronological order is obvious.
- [x] Before/change/after is accessible from every transaction.
- [x] Raw details are accessible.
- [x] Dense periods do not become unreadable.

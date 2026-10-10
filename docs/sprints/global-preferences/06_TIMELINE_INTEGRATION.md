# Sprint 06 — Timeline Integration

**Status:** Implemented 2026-10-09, uncommitted in the working tree; awaiting review. Results at the end of this file.
**Depends on:** 02, 04 (independent of 05, but reuses its `view-settings-panel.tsx`. If 06 runs first, it creates that component as specified in 05 §5.5.)

## 1. Sprint objective

Connect lane density, connector visibility, and program-interaction and NFT visibility to the timeline, with a View Settings popover and a visible, reversible count of whatever view settings hide. Never split, merge, duplicate or reorder transactions.

## 2. Current implementation findings

Verified in `src/app/case/timeline/`:

- `WalletTimeline` (`wallet-timeline.tsx`) builds `events = mergeLaneEvents(lanes…)`, one entry per signature with one entry per lane it appears on, then `items` (one `TimelineItem` per transaction, `entries` per lane, card from `eventCard`). **A transaction is one item no matter how many lanes or flows it has.**
- Lanes come from `case-shell.tsx` `lanes`, already passed through filters and hiding (`perWallet`). Behaviour observations are computed in `case-shell.tsx` from unfiltered events minus hidden ones, so timeline-only filtering can't change them.
- Geometry constants in `timeline-canvas.tsx` (lines ~82–100): `CARD_W 150`, `CARD_H 64`, `CARD_GAP 22`, `DOT_GAP 12`, `PILL_H 32`, `BUCKET_MIN 84`, `LANE_BAND = CARD_GAP + CARD_H + 48`, `LANES_TOP 60`, `AXIS_SPACE 44`. They're used in `laneY`, `contentHeight`, bucketing and hit-testing.
- Connectors: `connectors(entries)` per item, merged into trunks by `mergeConnectors(links, CONNECTOR_MERGE)` and always drawn; the selected item's link is drawn on top, highlighted (`timeline-canvas.tsx` ~346–401). Hover exists for clusters (~975).
- Card content (`event-card.ts`): fixed four lines (date, type, main amount, party); fees, rent and routing never appear on cards (`MAIN` role set).
- Navigation: `case-shell.tsx` `goToTransaction` calls `timelineRef.current.jumpTo(signature, wallet)`, which returns false when the transaction isn't shown, and toasts "That transaction is hidden by your filters or a hidden lane."
- Session state that stays session state: spacing mode (`time | event`), chart (`lanes | relationships`), `showBehavior`.

## 3. Scope

Keys: `timeline.density`, `timeline.connectors`, `timeline.programInteractions`, `timeline.nft`.

- Density table replacing the fixed geometry constants
- Connector modes `always | hover | selected`
- A display-level category exclusion in `WalletTimeline`, with a count chip and a Show action
- `jumpTo` and the "hidden" toast aware of view-setting exclusions
- View Settings popover (graph's component, timeline keys)
- Timeline section on the Preferences page

## 4. Out of scope

- Repetitive-activity aggregation, timeline fee presentation, token-movement visibility (01 §5.4)
- Override badges and resets (08)
- The relationships chart (`relationship-chart.tsx`): it reads the same `lanes`, and category exclusion doesn't apply to it in this sprint. Document that in the popover ("Applies to the lanes chart").

## 5. Technical approach

### 5.1 Density

```ts
const DENSITY = {
  compact:     { cardW: 132, cardH: 52, cardGap: 14, laneExtra: 32, bucketMin: 72 },
  comfortable: { cardW: 150, cardH: 64, cardGap: 22, laneExtra: 48, bucketMin: 84 },   // today's values
  spacious:    { cardW: 168, cardH: 76, cardGap: 28, laneExtra: 60, bucketMin: 96 },
} as const;
```

`comfortable` must equal today's constants exactly. The compact and spacious numbers are starting points: confirm in the browser that the four card lines fit at compact (drop to three lines, without the date line, if they don't, and record the decision here). `TimelineCanvas` gets `density` as a prop, kept in `latest.current` like `mode`. Changing it re-runs `draw` and the scroll height, nothing upstream.

### 5.2 Connectors

`connectors: "always" | "hover" | "selected"` prop:

- `always`: today.
- `selected`: only the selected item's connectors (already drawn separately).
- `hover`: the selected item's, plus the item under the pointer. Hover tracking already exists for cluster tooltips. Extend the hit test to cards, and schedule a redraw only when the hovered signature changes.

Draw-only. Trunk merging (`mergeConnectors`) still runs on whatever set is drawn.

### 5.3 Category exclusion (view filter)

In `WalletTimeline`, between `events` and `items`:

```ts
const excluded = useMemo(() => new Set<EventCategory>([
  ...(programInteractions === "hidden" ? ["PROGRAM_INTERACTION"] : []),
  ...(nft === "hidden" ? ["NFT_TRADE", "NFT_TRANSFER", "NFT_MINT"] : []),
]), [programInteractions, nft]);
const shownEvents = useMemo(() => events.filter((ev) => !excluded.has(semanticEvents.get(ev.signature)?.category)), [events, excluded, semanticEvents]);
```

- Whole transactions are excluded by their one semantic event's category, across every lane at once. A transaction is never partly shown.
- `selected`, `jumpTo`, `stepEvent`, the minimap's `overviewTimes` and the relationship chart keep their current inputs, except that `items` come from `shownEvents`.
- **The selection survives:** a selected transaction that becomes excluded is deselected. Re-enabling doesn't restore it.
- Chip above the lanes (same style as the graph's): `14 program interactions · 3 NFT events hidden by view settings · Show`. Show sets case overrides back to `shown`.
- `jumpTo` returns a reason (`"filtered" | "view" | null`). For `"view"`, the toast says "Hidden by view settings" with a **Show** action that sets the case override. Search results and bookmarks to such transactions use the same path.

This is not `TxFilter.hiddenCategories`: the filter is session state chosen in the Filter panel. This exclusion is a persistent view setting. Both can apply at once, and the Filter panel doesn't show the view-setting exclusion as a filter.

### 5.4 View Settings

The timeline toolbar gains `View settings`, rendering `view-settings-panel.tsx` with the four timeline keys. Writes go to case overrides; "Use these for all cases" promotes them, as for the graph.

## 6. Affected modules or files

| File | Change |
|---|---|
| `src/app/case/timeline/timeline-canvas.tsx` | density table and prop; connector modes; card hover hit-test |
| `src/app/case/timeline/wallet-timeline.tsx` | category exclusion, chip, `jumpTo` reason, View Settings button |
| `src/app/case/case-shell.tsx` | pass resolved values; toast with Show action |
| `src/app/case/view-settings-panel.tsx` | reused (or created per 05 §5.5) |
| `src/lib/timeline/layout.ts` | a pure `excludeByCategory(events, categoryOf, excluded)` helper if the filter grows beyond one line, so it can be unit-tested |
| `src/lib/timeline/lanes.test.ts` or new `exclusion.test.ts` | tests |
| `src/lib/preferences/schema.ts` | timeline keys `exposed` |

## 7. Detailed implementation tasks

- [ ] Density table; `comfortable` equals today; verify compact card legibility in the browser
- [ ] Connector modes, including card hover
- [ ] Category exclusion with chip and Show; selection handling
- [ ] `jumpTo` reason and toast with Show
- [ ] View Settings popover; Timeline section on the Preferences page
- [ ] Tests (§11); `pnpm test`, `pnpm typecheck`, `pnpm lint`; record results
- [ ] Browser verification (§11)

## 8. Dependencies

02, 04. `view-settings-panel.tsx` from 05 if it exists.

## 9. Edge cases

- A transaction shared by two mapped wallets with category `NFT_TRADE` (buyer and seller lanes): hidden on both lanes together, counted once.
- An excluded transaction is the target of a date bookmark: the bookmark still centres on the time (it's a time, not a signature).
- Every transaction excluded: the empty state says "All transactions here are hidden by view settings" with Show, not "No transactions match the filters".
- Event spacing mode (`mode = "event"`): exclusion changes the index spacing. Expected, and the same as filters today.
- An observation whose every event is excluded: its span is still drawn (observations are evidence of a pattern), and opening it lists its events with a note that they're hidden by view settings.
- 10,000 items at compact density: bucketing still caps drawn pills; verify frame time doesn't regress against comfortable.

## 10. Acceptance criteria

- [ ] Defaults reproduce today's timeline exactly (geometry, connectors, items).
- [ ] Order is stable: shown items keep their relative order under any setting.
- [ ] One signature is never more than one item and is never split; hidden transactions are counted and can be shown in one action.
- [ ] Inspector navigation (`jumpTo`, search, graph "Show on timeline") works, and explains view-setting hiding with a fix.
- [ ] Timeline settings don't change graph settings or behaviour observations.
- [ ] No RPC request on any timeline setting change.

## 11. Test requirements

Unit:

- Exclusion helper: removes only the given categories; keeps order; a multi-lane signature is removed whole; an empty exclusion set returns the input unchanged (same reference, so memos stay stable).
- Counts per category are correct.
- `DENSITY.comfortable` equals the previous constants (guards the "no visual change" promise).

Browser (record results):

- Each density on a multi-lane case: cards readable at compact; scroll height adapts.
- Connector modes: always, selected, hover.
- Hide program interactions: chip count matches the Filter panel's category count; Show restores; reload keeps the case override.
- Search to a hidden transaction: the toast offers Show and then jumps.
- Graph settings unchanged after timeline changes.

## 12. Definition of Done

All tasks checked; defaults unchanged; tests and validation pass with results recorded; browser checks recorded.

## Results (2026-10-09)

Implemented. Browser-checked on a loaded case (the 3-wallet "kai scam" case):
- compact density brings the lanes closer;
- hiding program calls shows "42 hidden · Show" (matching the filter count), and Show restores them;
- settings persist across reload;
- the View settings icon sits beside reset;
- the Timeline section and its nav entry appear in Settings.

Deviations:
- Density changes the spacing around cards, not the cards themselves: they hold four lines.
- Jumping to a hidden transaction offers Show, then completes the jump.

Found and fixed: case overrides are now written in a Dexie transaction from the stored case (`updateViewSettings`). Two quick changes made from the same stale copy could otherwise overwrite each other.

Not checked: the "On hover" connectors, by eye.

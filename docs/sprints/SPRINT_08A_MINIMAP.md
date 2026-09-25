# Sprint 08A — Minimap, Trackpad and Add Wallet

**Status:** ✅ Complete (checked 2026-09-25)

**Problem (reported with a screenshot):** the activity minimap under the timeline couldn't be used properly.

- **It overflowed its space.** It was sized to its container's full width *including* padding, so the canvas was 16px wider than the room it had. Its right end (the most recent dates) and right border ran off the column, under the inspector or off-screen when the inspector was hidden. It also sat flush against the bottom edge, where rounded window corners clip it.
- **Clicking did nothing when zoomed out.** A click centred the current view on that point, and with the whole range in view that changes nothing.

**Fix:**

- **Sizing** (`timeline-minimap.tsx`): the canvas is `width: 100%` of its padded strip and measures its own laid-out width. The strip doesn't shrink and has extra bottom padding. Checked with the inspector hidden: the minimap ends 8px inside the column and 12px above the window bottom.
- **Click:** zoomed out (≥ 90% of the range in view), a click zooms to an eighth of the range around it; zoomed in, it re-centres as before; always kept inside the range (`minimapTarget`, `src/lib/timeline/layout.ts`, tested).
- **Drag inside the view box** pans it, keeping its span.
- **Drag anywhere else** draws a range and zooms the timeline to exactly that range.
- Hover title and aria label say what each gesture does.

**Found and fixed during the check:** the first version of the range drag crashed the page. It read the pointer position inside a React state update, which runs after React clears the event's target. The position is now read first, and the drag start is kept in a ref.

**Browser-checked** on the real case with the inspector hidden: the minimap fits; a click from fully zoomed out zoomed to an eighth of the range; dragging 55%→70% zoomed to about 5–21 Aug; dragging the view box panned to late June–early July. No console errors.

## Trackpad zoom (reported: "can't zoom in and out with the track pad")

- **Cause:** Sprint 08 made vertical wheel movement scroll stacked lanes, and only zoomed with Ctrl/⌘. Once a case had two lanes, a two-finger vertical swipe no longer zoomed. A sideways swipe was handed to d3-zoom, which zooms from the tiny vertical part of the movement, so it neither panned nor zoomed usefully.
- **Fix:** the timeline handles wheel and trackpad gestures itself (`wheelAction`, `src/lib/timeline/layout.ts`, tested); d3-zoom keeps drag-to-pan and the buttons.
  - **Pinch** (a wheel event with ctrlKey, or Ctrl/⌘ + wheel): zoom around the pointer.
  - **Sideways swipe** (or Shift + wheel): pan through time.
  - **Vertical swipe / wheel:** scroll the lanes when they overflow, and zoom when they fit (so a single lane or a few lanes behave as before).
  - Line- and page-mode deltas are converted to px so mice and trackpads move alike.
- **Browser-checked** on the real two-lane case with dispatched wheel events: pinch, sideways swipe and vertical swipe were each handled (default prevented), and the view zoomed and panned to about 26 Jul – 17 Aug.

## Graph tab gestures

- The node graph now works like Figma (`graphWheelAction`, `src/lib/gestures.ts`, tested): **pinch** (or Ctrl/⌘ + wheel) zooms around the pointer; **any swipe pans** in both directions; a plain mouse wheel pans vertically (Shift + wheel sideways). d3-zoom keeps drag-to-pan and node dragging.
- Change for mouse users: the plain wheel no longer zooms the graph; use pinch, Ctrl/⌘ + wheel or the +/− buttons.
- Both gesture rules (timeline and graph) now live in `src/lib/gestures.ts`.
- **Browser-checked** with dispatched wheel events on the real case: a pinch zoomed in around the pointer, and a diagonal swipe panned both ways.

## Add wallet by address

- **"Add wallet"** in the Wallets panel opens the map-wallet dialog with an address field, for a wallet the map hasn't met as a counterparty. The range choices are the same: from first interaction (offered when a loaded transaction involves it), from case start, or custom. It then loads like any mapped wallet.
- **Validation** (`newWalletProblem`, `src/lib/case/wallet-range.ts`, tested): must be a valid Solana address, not already mapped, and not a program or protocol address (registry or any invoked program). The reason shows under the field, and Map and load stays disabled until it passes.
- **Fork parent:** a wallet mapped from its first interaction now forks off the mapped wallet that actually shared that transaction, not whichever wallet happened to be selected.
- **Browser-checked** on the real case, validation only and then cancelled, so the case wasn't changed:
  - `0xabc` → "Not a valid Solana address."
  - Jupiter's program → "That's a program or protocol address, not a wallet."
  - The primary → "This wallet is already mapped."
  - `8GsK…bj1n` → accepted, defaulting to its first interaction (29 Aug 14:30:55).

## Acceptance criteria

- [x] The whole minimap is visible and reachable with the inspector open or hidden.
- [x] A click does something useful at any zoom level.
- [x] The view can be panned and a range selected from the minimap.
- [x] Trackpad pinch zooms and swipes pan, with any number of lanes, and on the graph.
- [x] Any wallet can be added by address, with validation.

# Sprint 05 — Wallet Interaction Graph Integration

**Status:** Implemented 2026-10-09, uncommitted in the working tree; awaiting review. Results at the end of this file.
**Depends on:** 02, 04

## 1. Sprint objective

Make the interaction graph read its defaults from preferences, add a View Settings popover that changes them for this case or for all cases, add a low-value treatment with a visible "hidden" count, and stop losing dragged node positions when the graph is rebuilt.

## 2. Current implementation findings

Verified in `src/app/case/case-shell.tsx` and `src/app/case/graph/wallet-graph.tsx`:

- Session state in `CaseWorkspace`: `graphRanking` ("significant"), `graphNodeLimit` (25), `graphClusters` (empty), `graphEntities` (empty), `showPrograms` (false). It's passed into `buildInteractionGraph` in one `useMemo` (deps include all of them, plus `names`, `perWallet`, `filter.hiddenAssets`).
- `buildInteractionGraph` (`src/lib/graph/build.ts`) options: `hiddenAssets`, `showPrograms`, `maxNodes`, `ranking`, `clusterOf`, `expandedClusters`, `expandedEntities`, `observed`. Clusters: `known | infrastructure | decoy | unknown | one_off`. Result counts include `omittedNodes` and `programConnections`.
- `WalletGraph` keeps spacing in `useState` initialised from `localStorage["fraudwatch:graph-spacing"]`, writing it back on change. Layout: `layoutGraph(nodes, edges, primary, SPACINGS[spacing])`.
- Toolbar (`wallet-graph.tsx` ~905–1000): native selects for ranking, node limit and spacing; zoom ± , fit, reset layout; then the program-calls toggle.
- Arrowheads are drawn per flow (`wallet-graph.tsx` ~394–415), bigger when selected. No edge labels.
- **Dragged positions are discarded on every layout change:** the layout effect tweens `positions.current` to the new `layout` targets for every node, including dragged ones.
- Low-value: no graph treatment. `isDust` exists in `src/lib/labels/lookalikes.ts`. Decoy detection (`verdicts`) runs on unfiltered summaries in `case-shell.tsx`, so it doesn't depend on graph filtering.

## 3. Scope

Keys (01 §5.3): `graph.nodeLimit`, `graph.programs`, `graph.knownServices`, `graph.lowValue`, `graph.spacing`, `graph.arrows`, `graph.confirmLarge`. All are case-scoped except `confirmLarge`.

- Initial and resolved values from preferences
- Toolbar controls that correspond to a key write a **case override**; View Settings offers "Use for all cases"
- Low-value treatment `shown | faded | hidden` with a count chip
- Arrows `all | selected`
- Large-expansion confirmation
- Preserve dragged positions across rebuilds
- Remove the `localStorage` spacing read/write
- Expose graph keys on the Preferences page; expose the detail selector (Sprint 04) if not already

## 4. Out of scope

- Ranking stays a session control (not a preference).
- Override badges, per-key reset and the "N overrides" indicator (Sprint 08). This sprint stores overrides correctly; 08 makes them visible and resettable.
- Edge labels, graph fees, a separate graph animation setting (01 §5.4).
- Any change to which relationships exist, how clusters are chosen, or entity grouping.

## 5. Technical approach

### 5.1 Values in `case-shell.tsx`

```ts
const prefs = usePreferences(c);
const nodeLimit = prefs.get("graph.nodeLimit");           // "10" | … | "all"
const showPrograms = prefs.get("graph.programs") === "shown";
```

- `graphNodeLimit` and `showPrograms` stop being `useState`. They are resolved values, and the toolbar writes `prefs.setForCase(...)`. The resolved value comes back through the live query, so there's one source of truth and no state to keep in sync.
- `graphClusters` stays session state (clicking a cluster is exploration), but its **initial** value includes `known` when `graph.knownServices === "expanded"`. When the resolved value changes mid-session (View Settings, or a global change on another tab), add or remove `known` to match. The setting wins over a click from before the change.
- The `graph` memo deps gain `lowValue` and lose nothing. `spacing` and `arrows` go to `WalletGraph` as props and never enter the build memo, so changing them never rebuilds the graph.

### 5.2 Low-value treatment (`build.ts`)

New option `lowValue?: "shown" | "faded" | "hidden"` and `decimalsOf?: (assetId) => number | undefined` (the existing `decimalsOf` from `case-shell.tsx`).

- An **edge** is low-value when it's an `interaction` edge and every movement on every interaction is `isDust`. Program edges are never low-value. An edge with any NFT movement is never low-value (an NFT's amount is 1).
- `hidden`: such edges are left out **before ranking**, so they don't take node slots, and a counterparty left with no other edge isn't drawn. `counts.lowValueHidden` (new) holds how many edges were removed.
- `faded`: kept, and flagged `edge.lowValue = true`; `WalletGraph` draws it at reduced opacity and its far node muted.
- Mapped wallets are never removed. Selection of a hidden edge (e.g. from the edge panel) clears.
- Chip in the toolbar strip, next to the cluster strip: `12 low-value connections hidden · Show`. Show sets a case override `graph.lowValue = shown`. The chip is visible whenever the count is above zero.

Look-alike and decoy detection keep using unfiltered data in `case-shell.tsx`, so hiding dust here can't hide a poisoning warning. The address panel's look-alike section and the "Hide dust decoys" filter are unchanged.

### 5.3 Spacing, arrows, confirmation (`wallet-graph.tsx`)

- `spacing` becomes a prop. Delete `SPACING_KEY` and its `localStorage` use (Sprint 02 imported the value). The select calls `onSpacingChange` → `setForCase("graph.spacing", …)`.
- `arrows: "all" | "selected"`: with `selected`, arrowheads are drawn only for the selected edge and edges touching the selected or hovered node. A draw-only change.
- `graph.confirmLarge = on`: choosing "All" or expanding a cluster when the resulting drawn address count would exceed 200 opens a confirm dialog ("Draw 1,340 addresses? Large maps can be slow."). It is computed from the counts the build already returns (`omittedNodes`, cluster `addresses`). Confirming applies once; it doesn't change the preference.

### 5.4 Preserve manual positions

Keep a `dragged = useRef(new Set<string>())`, added to on drag end. In the layout effect, nodes in `dragged` that still exist keep their current position as their target; only the others move to the new layout. "Reset layout" clears `dragged`. This makes any build-affecting preference change (node limit, programs, low-value) leave hand-placed nodes where they are. Positions aren't persisted across reloads (nothing persists them today; out of scope).

### 5.5 View Settings popover (`src/app/case/view-settings-panel.tsx`)

A button `View settings` at the end of the graph toolbar opens a small popover (add a shadcn/Base UI popover component):

```text
View settings · Graph
  Addresses shown     ( 10 | 25 | 50 | 100 | All )
  Program calls       [ ]
  Known services      ( Collapsed | Expanded )
  Low-value           ( Shown | Faded | Hidden )
  Spacing             ( Compact | Normal | Wide | Very wide )
  Arrows              ( All | Selected only )
  ─────────────
  Changes apply to this case.  [Use these for all cases]  [Open Preferences]
```

- Every control writes a case override.
- "Use these for all cases" writes each **overridden** graph key's value to the global row and then clears those case overrides (the case now inherits the same values). This is the only path from a case to global, and it's an explicit button.
- The component is generic: it takes a list of keys and labels, and is reused by the timeline (06) and extended with origin badges and resets in 08.

## 6. Affected modules or files

| File | Change |
|---|---|
| `src/lib/graph/build.ts` | `lowValue`, `decimalsOf` options; `counts.lowValueHidden`; `edge.lowValue` |
| `src/lib/graph/build.test.ts` | low-value tests |
| `src/app/case/case-shell.tsx` | resolved values replace `graphNodeLimit`/`showPrograms` state; known-cluster sync; props |
| `src/app/case/graph/wallet-graph.tsx` | spacing/arrows props; remove `localStorage`; faded draw; chip; confirm; dragged-position preservation; View Settings button |
| `src/app/case/view-settings-panel.tsx` | new |
| `src/components/ui/popover.tsx` | new |
| `src/lib/preferences/schema.ts` | graph keys `exposed` |

## 7. Detailed implementation tasks

- [ ] Replace `graphNodeLimit` and `showPrograms` state with resolved values and case-override writes
- [ ] Known-services initial and sync behaviour
- [ ] `lowValue` in `buildInteractionGraph`, applied before ranking; counts; flag
- [ ] Faded drawing; hidden-count chip with Show
- [ ] Spacing and arrows as props; delete the `localStorage` spacing code
- [ ] Large-expansion confirmation
- [ ] Preserve dragged positions; Reset layout clears them
- [ ] View Settings popover with "Use these for all cases"
- [ ] Graph section on the Preferences page; detail selector exposed
- [ ] Tests (§11); `pnpm test`, `pnpm typecheck`, `pnpm lint`; record results
- [ ] Browser verification (§11)

## 8. Dependencies

02 (resolution, case overrides), 04 (preset values for the controlled keys).

## 9. Edge cases

- A selected edge or node disappears because of a setting change: clear the selection; the inspector falls back to the wallet, as today when filters remove it.
- A preference hides every edge of a node the user dragged: the node goes, and its dragged entry is dropped.
- `nodeLimit = all` resolved from a global preference on a 3,000-address case: confirmation applies on open too. The graph opens at 100 with a chip "Showing 100 of 3,000 · Show all". It never auto-draws thousands without consent.
- A primary lane hidden: unchanged (layout already anchors on another wallet).
- An entity node made only of dust edges: treated like any other node.
- A time-range or relationship filter active: low-value runs on what's left; the count reflects only this view.

## 10. Acceptance criteria

- [ ] With default preferences the graph is identical to before (same nodes, edges, layout and spacing).
- [ ] Each setting changes the graph as specified, for this case only, and "Use these for all cases" moves it to global.
- [ ] Hidden low-value connections are counted and can be shown in one click.
- [ ] Changing spacing or arrows doesn't rebuild the graph; changing any graph setting makes no RPC request (network panel).
- [ ] Node and edge selection, hover cards, "Show on timeline" and the edge panel still work.
- [ ] Dragged nodes stay put through node-limit, programs and low-value changes.
- [ ] A 10-wallet, 5,000-transaction case (`performance.test.ts` scale) stays interactive when toggling settings.

## 11. Test requirements

Unit (`build.test.ts`):

- Low-value `hidden` removes dust-only edges before ranking: a dust-only counterparty no longer takes a slot from a real one.
- An edge with one non-dust movement is kept.
- NFT and program edges are never low-value.
- `faded` keeps edges and flags them; `counts.lowValueHidden` is correct; mapped wallets are always present.
- Default options produce the same graph as before the change (snapshot of nodes and edges for a fixture).

Browser (record results):

- Toggle every View Settings control; reload; values persist for the case; another case is unaffected.
- "Use these for all cases"; open another case; it shows the new values.
- Drag two nodes, change the node limit; the dragged nodes stay.
- Low-value hidden on a case with dust: chip count matches; Show restores.
- Network panel shows no RPC calls during all of the above.

## 12. Definition of Done

All tasks checked; graph behaviour unchanged at defaults; tests and validation pass with results recorded; browser checks recorded.

## Results (2026-10-09)

Implemented: resolved values replace the session state, toolbar controls write case overrides, low-value hiding/fading with a count chip, arrows "selected only", the confirm dialog and capped "All" with "Draw all N", dragged nodes kept through rebuilds, and the View settings popover with "Use these for all cases". `buildInteractionGraph` low-value tests added.
The graph memo now depends on the mapped wallet addresses instead of the whole case, so saving a view setting doesn't rebuild the graph.
**Not yet browser-checked on a loaded case** (needs an RPC): every View settings control, the low-value chip, drag preservation, the confirm dialog, and that no RPC request is made.

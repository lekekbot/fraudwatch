# Sprint 05 — Canvas and Directional Layout

**Status:** Planned
**Depends on:** 02, 03 (04 for saved pins; stub with in-memory pins if 04 isn't merged)

## Summary and Why It Matters

The trace must read left to right as "earlier hop → later hop" without suggesting more certainty than the data has. This sprint builds the renderer and a deterministic, incremental column layout. Adding a branch must not reshuffle what the investigator has already read, and pinned nodes must never move.

## Verified Current Repository Findings

### Existing capabilities

- `wallet-graph.tsx`: Canvas 2D, d3-zoom (`zoom`, `zoomIdentity`), d3-selection; `positions` held in a ref; layout via `layoutGraph`; hit testing on pointer events; hover cards; arrowheads sized by zoom; semantic zoom tiers (`zoomTier`); fit animation; wheel handling via `graphWheelAction` (`src/lib/gestures.ts`).
- Shared canvas helpers: `readPalette(el, vars)` reads CSS variables (theme-aware), `sizeCanvas` (DPR), `horizontalZoom` (`src/app/case/canvas.ts`).
- `nodeRadius`, `hashId` in `src/lib/graph/layout.ts`.
- Names: `names.of(address)`; graph-specific `withGraphNames` for entity and burn nodes.
- Theme today follows `prefers-color-scheme` (`globals.css`); the timeline redraws on `matchMedia` change (`timeline-canvas.tsx:898`).
- Known defect to avoid: `wallet-graph.tsx` discards dragged positions whenever its layout recomputes.

### Gaps and limitations

- No column/layered layout code. No minimap for graphs (the timeline has one: `timeline-minimap.tsx`). No keyboard node navigation on canvases.

### Assumptions requiring confirmation

- That a new canvas component (D6) is acceptable, not an extension of `WalletGraph`.

## Objectives and User Outcomes

- A trace drawn in columns by hop: seed in the middle (or left for forward-only), backward to the left, forward to the right.
- Stable positions: an expansion only places new nodes; existing nodes stay; pinned nodes never move.
- Edges show direction, amount and time compactly, with bundled counts, return edges and boundary markers.

## In Scope

- `src/lib/trace/layout.ts`: pure incremental layered layout
- `src/app/case/trace/trace-canvas.tsx`: rendering, pan/zoom/fit, selection, hover, drag-to-pin, keyboard navigation
- Visual language for provenance, boundaries, conversions, staleness

## Explicitly Out of Scope

- Candidate UI and trace editing (06), service folding visuals (07; this sprint draws plain nodes), branch hide/focus (08), the inspector (09), minimap (only if 10's measurements show a need)

## Architecture / Data Contracts / UX Decisions

### Layout (`src/lib/trace/layout.ts`)

```ts
export type TraceLayoutInput = {
  view: { nodes: TraceNode[]; edges: TraceEdge[] };   // from buildTraceView
  previous: ReadonlyMap<string, Point>;               // last positions (for stability)
  pins: Readonly<Record<string, Point>>;
  spacing: { column: number; row: number };           // defaults 240, 72
};
export function layoutTrace(input: TraceLayoutInput): Map<string, Point>;
```

- **x = column = depth × column width.** Depth comes from the view (negative left, positive right). Time is not the x-axis: edges carry their time, and an optional "time order" hint (a small ordinal) when two edges leave one node.
- **y:** a new node is placed next to its parent's y (first free slot below the parent's existing children in that column, sorted by edge order). Existing nodes keep `previous` positions; pinned nodes use `pins`.
- **Collisions:** only newly placed nodes are moved to free slots; existing ones never are.
- **Reset layout** (explicit button): recompute every unpinned node from scratch (barycentric ordering per column to reduce crossings, a few sweeps, deterministic tie-break by id). Pinned nodes stay.
- **Determinism:** same input → same output (no randomness; ties by id).

### Rendering (`trace-canvas.tsx`)

| Element | Drawing |
|---|---|
| Node | Rounded rectangle, name (`names.of`) and short address; seed has a distinct outline and a "Seed" tag; OBSERVED/MAPPED shown by a small marker, as in the address panel |
| Edge | Curved left-to-right line with an arrowhead **at the receiving end**; label `12.5 SOL · 3 Mar 14:02` (asset label via `assetLabel`, full precision trimmed of trailing zeros; inspectors show the exact amount) |
| Bundled edge | One line, label `3 movements · 12.5 SOL total` (multi-asset: `2 assets`) |
| Return edge (`returns`) | Routed below the columns back to the earlier node, dashed, labelled "returns" |
| Conversion | A badge on the node: `USDC → SOL` |
| Boundary | A small terminal marker on the node's outgoing side (forward) or incoming side (backward), icon and text: "History not loaded", "Outside case range", "Custodial", "Ambiguous", "Failed", "Burned", "Bridged out", "Position", "End of history" |
| Stale step | Edge drawn with a warning colour and ⚠ in its label |
| Supporting movement | Thinner line, label prefixed with its role ("royalty") |

A permanent, quiet caption in the corner: **"Observed movements in time order. Lines don't show that the same funds moved."** It links to the limitations section (13).

- Colours come from CSS variables through `readPalette`. Never hard-code theme colours. Redraw on theme change as the timeline does.
- Labels are hidden below a zoom threshold (as with `zoomTier`), and edges keep arrowheads at every zoom. Hovering shows the full label.
- Drag a node → on drop, `setPin(trace, id, point)`. A double-click (or the context menu in 06) unpins it.
- Reduced motion: no tweening of new nodes (`prefers-reduced-motion`). With motion, new nodes fade in (≤ 200 ms) and existing ones never animate.

### Interaction contract

```ts
type TraceCanvasProps = {
  view: TraceView; positions: Map<string, Point>; names: Names; assets: Assets;
  selected: { kind: "node" | "edge"; id: string } | null;
  onSelect(sel: TraceCanvasProps["selected"]): void;
  onPin(nodeId: string, point: Point | null): void;
  onOpenMenu(target: { kind: "node" | "edge"; id: string }, at: Point): void;   // 06 renders the menu
};
```

Keyboard: the canvas is focusable. Arrow keys move selection along edges (→ next hop, ← previous hop, ↑/↓ siblings in a column), Enter opens the inspector, `F` fits, `0` resets zoom, Shift+F10 / the context-menu key opens the menu. A visually hidden live region announces the selected node or edge in words ("B, 2 hops forward, received 12 SOL from A on 3 March").

### Route

`CaseView` gains `"trace"`: `/case/<id>/trace/<traceId?>`. `isCaseRoute` accepts an optional trace id segment only for `trace`. The tab isn't added to the view switcher until 06 (MVP), so nothing half-built is reachable from the UI.

## Prerequisites and Dependencies

02 (view model), 03 (fixtures for realistic views), 04 (pins; optional stub).

## Affected Modules and Proposed Files

- **Existing:** `src/lib/routing/case-path.ts` (+ its tests if added), `src/app/case/case-shell.tsx` (render the trace view for `view === "trace"`)
- **Proposed new:** `src/lib/trace/layout.ts`, `src/lib/trace/layout.test.ts`, `src/app/case/trace/trace-canvas.tsx`, `src/app/case/trace/trace-view.tsx` (container: reads the trace, builds the view, holds positions)

## Implementation Plan

### Task Group A — Layout

- [ ] `layoutTrace` with stable placement, pins, collision handling for new nodes only
- [ ] `resetLayout` (barycentric sweeps, deterministic)
- [ ] Tests (below)

### Task Group B — Canvas

- [ ] Canvas sizing with `sizeCanvas`; zoom and pan with d3-zoom; wheel via `graphWheelAction`
- [ ] Draw nodes, edges, bundled and return edges, conversions, boundaries, stale steps, the caption
- [ ] Hit testing for nodes and edges (reuse the approach in `wallet-graph.tsx`); hover card with the full label
- [ ] Drag to pin; unpin
- [ ] Fit to trace; reset layout button
- [ ] Keyboard navigation and live region; reduced motion
- [ ] Theme redraw

### Task Group C — Route

- [ ] `trace` view in `case-path.ts`; `CaseShell` renders `TraceView` (reachable by URL only until 06)

## UI Behavior and Example Scenarios

- F1: seed A in column 0, B in column 1, edge "12 SOL · 3 Mar 14:02", B shows "History not loaded".
- F6 A→B→C→A: A(0), B(1), C(2); dashed return edge C→A under the columns.
- F8 five A→B transfers added: one bundled edge "5 movements · 40 SOL total".

## Evidence / Data Integrity Invariants

- Arrow direction always equals `from → to` of the underlying movement, regardless of trace direction (a backward trace still points arrows toward the receiver).
- Labels never show a total across different assets.
- Layout and pins never alter steps.

## Edge Cases and Failure Recovery

- An empty trace (seed only): one node, centred; hint text "Add a movement to start" (06 wires the action).
- Very long names: truncated with an ellipsis on canvas; full in hover and inspector.
- A node pinned off-screen: fit includes pinned nodes.
- A pin that refers to a node no longer in the view: ignored at draw; pruned on next save (04).
- Viewport resize: positions are in world coordinates, so only the transform changes.

## Performance Considerations

- Draw only in `requestAnimationFrame` when something changed (the pattern in `timeline-canvas.tsx`).
- Cull nodes and edges outside the viewport. Target **60 fps pan at 300 nodes / 600 edges** on the developer machine; record the measured number (10 refines).
- Layout of 300 nodes incremental **< 5 ms**, reset **< 50 ms** (test with a synthetic labelled view).

## Tests and Fixtures to Add

- `layout.test.ts`: determinism; adding a branch leaves every existing node's position unchanged; pinned nodes never move (including on reset); backward nodes have negative x; return edges don't create new columns; collisions resolved only for new nodes.
- `case-path` tests: `/case/x/trace/` and `/case/x/trace/<id>/` parse; a trace id on other views is rejected.
- Browser: F1, F6 and F8 synthetic traces render as described; keyboard navigation reaches every node; theme switch recolours; reduced motion has no tweening.

## Acceptance Criteria (observable and measurable)

- [ ] No arrow points against its movement (test over generated views: every edge's arrow end = `to`).
- [ ] Zero position change for existing nodes after an expansion (test).
- [ ] Performance numbers recorded against the targets above.
- [ ] Interaction Graph and Timeline unchanged (visual check; no edits to their files except `case-shell.tsx` routing).

## Definition of Done

- [ ] Layout and canvas merged with tests; browser checks recorded; validation commands pass.

## Known Risks / Open Decisions

- Column-by-hop can put a later-in-time movement left of an earlier one across branches. The edge time labels and the caption carry chronology. Revisit with users after MVP.

## Handoff Notes for the Next Sprint

06 adds the toolbar, trace list, seed dialog, candidate panel and context menu around this canvas.

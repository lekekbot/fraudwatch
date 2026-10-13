# Sprint 05 — Canvas and Free Placement

**Status:** Planned (implementation in working tree; browser canvas check and merge pending)
**Depends on:** 02, 03 (04 for saved positions; stub with in-memory positions if 04 isn't merged)

*Revised 2026-10-10 for D9 (free placement). The original column-by-hop layout with pins is replaced; the file name is kept so links stay valid.*

## Summary and Why It Matters

The trace is the investigator's diagram. Like draw.io, whatever they arrange stays exactly where they put it, and nothing they've read moves on its own. This sprint builds the renderer and editing basics for evidence: auto-placing new nodes beside their source, dragging, multi-select, grid and snap, Tidy layout on request, and the visual language that keeps the picture honest about what it shows. Annotations (notes, shapes, connectors) are 05A, on this canvas.

## Repository findings at the original audit

### Existing capabilities

- `wallet-graph.tsx`: Canvas 2D, d3-zoom (`zoom`, `zoomIdentity`), d3-selection; positions held in a ref; hit testing on pointer events; hover cards; arrowheads sized by zoom; semantic zoom tiers (`zoomTier`); fit animation; wheel handling via `graphWheelAction` (`src/lib/gestures.ts`).
- Shared canvas helpers (`src/app/case/canvas.ts`): `readPalette(el, vars)` reads CSS variables (theme-aware), `onThemeChange` (redraw on theme changes, including the Global Preferences theme setting), `sizeCanvas` (DPR), `horizontalZoom`.
- `nodeRadius`, `hashId` in `src/lib/graph/layout.ts`.
- Names: `names.of(address)`; graph-specific `withGraphNames` for entity and burn nodes.
- Known defect to avoid: `wallet-graph.tsx` discards dragged positions whenever its layout recomputes.

### Gaps and limitations

- No layered layout code, no multi-select or marquee on any canvas, no keyboard node navigation on canvases, no graph minimap.

### Assumptions requiring confirmation

- That a new canvas component (D6) is acceptable, not an extension of `WalletGraph`.

## Objectives and User Outcomes

- Every node stays where the investigator puts it, across edits, reloads and expansions.
- Adding movements places new nodes in a readable spot (beside their source, forward to the right, backward to the left) without touching anything already placed.
- Drag one or many nodes, snap to a grid if wanted, and tidy the whole diagram on request (undoable in 08).
- Edges show direction, amount and time compactly, with bundled counts, return edges and boundary markers.

## In Scope

- `src/lib/trace/layout.ts`: pure `autoPlace` (new nodes only), `tidyLayout` (explicit), snapping
- `src/app/case/trace/trace-canvas.tsx`: rendering, pan/zoom/fit, selection (click, Shift-click, marquee), hover, drag and multi-drag, grid and snap, keyboard navigation
- Visual language for provenance, boundaries, conversions, staleness, node colour and size (`NodeStyle`)

## Explicitly Out of Scope

- Notes, shapes, frames and user connectors (05A). Candidate UI and trace editing (06). Service folding visuals (07; this sprint draws plain nodes). Branch hide/focus and undo/redo (08). The inspector (09). Minimap (only if 10's measurements show a need).

## Architecture / Data Contracts / UX Decisions

### Placement (`src/lib/trace/layout.ts`)

```ts
export type PlaceInput = {
  view: { nodes: TraceNode[]; edges: TraceEdge[] };   // from buildTraceView
  positions: Readonly<Record<string, Point>>;         // presentation.positions: placed nodes
  obstacles: readonly Rect[];                         // annotation bounds (05A), so new nodes don't land under a note
  spacing: { column: number; row: number };           // defaults 240, 72
  grid: number | null;                                // snap size when snap is on
};
/** Positions for nodes not yet placed. Placed nodes are never in the result. */
export function autoPlace(input: PlaceInput): Record<string, Point>;
/** Every evidence node, rearranged. Only called from the Tidy layout action. */
export function tidyLayout(input: PlaceInput): Record<string, Point>;
export function snap(p: Point, grid: number): Point;
```

- **Auto-place:** a new node goes beside the placed node it was reached from: `+column` in x for a forward step, `−column` for a backward one, at the parent's y, then the first free slot down (then up) at `row` intervals that doesn't overlap a placed node or obstacle. Several new nodes from one parent are placed in edge order (earliest movement first). The seed of an empty trace goes at the origin. Every result is written to `positions` in the same save as the step (06), so a node is placed exactly once.
- **Placed nodes never move** except by the investigator: drag, arrow-key nudge, or Tidy layout.
- **Tidy layout** (toolbar button): a layered arrangement by depth (backward left of the seed, forward right), barycentric ordering per column to reduce crossings, a few sweeps, ties by id. It moves evidence nodes only; annotations stay put (connectors follow their ends). One undo entry (08).
- **Determinism:** same input → same output (no randomness; ties by id).
- Time is not an axis. Edges carry their time; the caption says lines don't mean the same funds (R2).

### Rendering (`trace-canvas.tsx`)

| Element | Drawing |
|---|---|
| Node | Rounded rectangle, name (`names.of`) and short address; `NodeStyle.color` tints the fill from the palette, `size` scales it; seed has a distinct outline and a "Seed" tag; OBSERVED/MAPPED shown by a small marker, as in the address panel; a note icon when `NodeStyle.note` is set |
| Edge | Curved line between node borders with an arrowhead **at the receiving end**; label `12.5 SOL · 3 Mar 14:02` (asset label via `assetLabel`, full precision trimmed of trailing zeros; inspectors show the exact amount). Solid, evidence colour |
| Bundled edge | One line, label `3 movements · 12.5 SOL total` (multi-asset: `2 assets`) |
| Return edge (`returns`) | Same line, labelled "returns" (with free placement there's no column to route under) |
| Conversion | A badge on the node: `USDC → SOL` |
| Boundary | A small terminal marker on the node, icon and text: "History not loaded", "Outside case range", "Custodial", "Ambiguous", "Failed", "Burned", "Bridged out", "Position", "End of history" |
| Stale step | Edge drawn with a warning colour and ⚠ in its label |
| Supporting movement | Thinner line, label prefixed with its role ("royalty") |
| Grid | Faint dots at the grid size when `canvas.grid` is on |

A permanent, quiet caption in the corner: **"Observed movements in time order. Lines don't show that the same funds moved."** It links to the limitations section (13).

- Evidence edges are always solid and use the evidence palette. Dashed lines are reserved for annotations (05A), so the two can't be confused (R5).
- Colours come from CSS variables through `readPalette`; `ColorKey`s map to palette variables. Never hard-code theme colours. Redraw through `onThemeChange`.
- Labels are hidden below a zoom threshold (as with `zoomTier`), and edges keep arrowheads at every zoom. Hovering shows the full label.
- Reduced motion: no tweening (`prefers-reduced-motion`). With motion, new nodes fade in (≤ 200 ms) and placed ones never animate except during Tidy layout (≤ 300 ms).

### Selection and editing

- Click selects; Shift-click adds or removes; dragging on empty canvas draws a marquee (Space-drag or two-finger swipe pans, as `graphWheelAction`). Selection can hold nodes and, from 05A, annotations.
- Dragging a selected item moves the whole selection; with `canvas.snap`, positions snap to the grid on drop. On drop, one `setPositions` save (04).
- Arrow keys nudge the selection by 1 px (10 px with Shift) when the canvas is in edit focus; otherwise they navigate (below).
- Delete/Backspace on evidence asks (06 wires removal of steps); on annotations it deletes them (05A).

### Interaction contract

```ts
type Selection = { nodes: string[]; edges: string[]; annotations: string[] };
type TraceCanvasProps = {
  view: TraceView; presentation: TracePresentation; names: Names; assets: Assets;
  selection: Selection;
  onSelect(sel: Selection): void;
  onMove(positions: Record<string, Point>, annotationMoves: Record<string, Point>): void;   // on drop
  onOpenMenu(target: { kind: "node" | "edge" | "annotation" | "canvas"; id?: string }, at: Point): void;   // 06/05A render the menu
};
```

Keyboard: the canvas is focusable. Without edit focus, arrow keys move selection along edges (→ next hop, ← previous hop, ↑/↓ the nearest node above/below), Enter opens the inspector, `F` fits, `0` resets zoom, Shift+F10 / the context-menu key opens the menu. A visually hidden live region announces the selection in words ("B, 2 hops forward, received 12 SOL from A on 3 March").

### Route

`CaseView` gains `"trace"`: `/case/<id>/trace/<traceId?>`. `isCaseRoute` accepts an optional trace id segment only for `trace`.

**Done early (2026-10-10, at the product owner's request):** `trace` is a `CaseView` and the **Trace** tab sits after Table in the view switcher, showing a "coming soon" placeholder (`src/app/case/trace/trace-view.tsx`). This sprint replaces the placeholder with the canvas and adds the optional trace id segment.

## Prerequisites and Dependencies

02 (view and canvas model), 03 (fixtures for realistic views), 04 (saved positions; optional stub).

## Affected Modules and Proposed Files

- **Existing:** `src/lib/routing/case-path.ts` and `case-path.test.ts`, `src/app/case/case-shell.tsx` (render the trace view for `view === "trace"`)
- **Proposed new:** `src/lib/trace/layout.ts`, `src/lib/trace/layout.test.ts`, `src/app/case/trace/trace-canvas.tsx`, `src/app/case/trace/trace-view.tsx` (container: reads the trace, builds the view, saves positions)

## Implementation Plan

### Task Group A — Placement

- [x] `autoPlace` (new nodes only; avoids placed nodes and obstacles), `snap`
- [x] `tidyLayout` (layered, barycentric sweeps, deterministic ordering)
- [x] Tests (below)

### Task Group B — Canvas

- [x] Canvas sizing with `sizeCanvas`; zoom and pan with d3-zoom; wheel via `graphWheelAction`
- [x] Draw nodes (with `NodeStyle`), edges, bundled and return edges, conversions, boundaries, stale steps, grid, the caption
- [x] Hit testing for nodes and edges; hover card with the full label
- [x] Selection: click, Shift-click, marquee; drag and multi-drag; snap on drop; arrow-key nudge
- [x] Fit to trace; Tidy layout button; grid and snap toggles
- [x] Basic arrow-key navigation and selection live region
- [ ] Enter-to-inspector, context menu and full keyboard accessibility remain for Sprints 09, 06 and 13
- [x] Theme redraw via `onThemeChange`; no motion effects are used

### Task Group C — Route

- [x] `trace` view in `case-path.ts`; `CaseShell` renders `TraceView` and accepts an optional trace id

## UI Behavior and Example Scenarios

- F1: seed A at the origin, B auto-placed to its right, edge "12 SOL · 3 Mar 14:02", B shows "History not loaded". Drag B below A, reload: B is still below A.
- F6 A→B→C→A: B and C placed right of A in turn; the C→A edge is labelled "returns".
- F8 five A→B transfers added: one bundled edge "5 movements · 40 SOL total".
- Marquee B and C, drag them down 200 px with snap on: both land on grid points, one save.
- Tidy layout on a messy 20-node trace: layered left to right; Undo (08) restores every position.

## Evidence / Data Integrity Invariants

- Arrow direction always equals `from → to` of the underlying movement, regardless of trace direction (a backward trace still points arrows toward the receiver).
- Labels never show a total across different assets.
- Moving, styling or tidying never alters steps (positions and styles are presentation).
- An auto-placed node never overlaps a placed node or annotation (test); a placed node never moves without a user action (test).

## Edge Cases and Failure Recovery

- An empty trace (seed only): one node, centred; hint text "Add a movement to start" (06 wires the action).
- Very long names: truncated with an ellipsis on canvas; full in hover and inspector.
- Fit includes every node and annotation, wherever placed.
- A position for a node no longer in the view: ignored at draw; pruned on the next save that removes steps (04).
- A node with no position (e.g. a trace from an older build or an import without a canvas block): auto-placed on open and saved.
- Viewport resize: positions are in world coordinates, so only the transform changes.

## Performance Considerations

- Draw only in `requestAnimationFrame` when something changed (the pattern in `timeline-canvas.tsx`).
- Cull nodes, edges and annotations outside the viewport. Target **60 fps pan and drag at 300 nodes / 600 edges / 200 annotations** on the developer machine; record the measured number (10 refines).
- `autoPlace` for 20 new nodes into a 300-node trace **< 5 ms**; `tidyLayout` of 300 nodes **< 50 ms** (test with a synthetic labelled view).

## Tests and Fixtures to Add

- `layout.test.ts`: determinism; adding nodes leaves every placed position unchanged; new nodes never overlap placed nodes or obstacles; forward children right of the parent, backward children left; several children stack in edge order; `tidyLayout` puts backward nodes left of the seed and is deterministic; `snap` rounds to the grid.
- `case-path` tests: `/case/x/trace/` and `/case/x/trace/<id>/` parse; a trace id on other views is rejected.
- Browser: F1, F6 and F8 synthetic traces render as described; drag, multi-drag, marquee and snap persist across reload; keyboard navigation reaches every node; theme switch recolours; reduced motion has no tweening.

## Acceptance Criteria (observable and measurable)

- [ ] No arrow points against its movement (test over generated views: every edge's arrow end = `to`).
- [x] Zero position change for placed nodes after adding movements (`autoPlace` test).
- [ ] Positions survive reload (browser).
- [ ] Performance numbers recorded against the targets above.
- [ ] Interaction Graph and Timeline unchanged (visual check; no edits to their files except `case-shell.tsx` routing).

## Definition of Done

- [ ] Placement and canvas merged with tests; browser checks recorded; validation commands pass.

## Known Risks / Open Decisions

- Free placement doesn't encode time, so a later movement can sit left of an earlier one. Edge time labels and the caption carry chronology; Tidy layout gives an ordered starting point.

## Handoff Notes for the Next Sprint

05A adds notes, shapes, frames and user connectors to this canvas and its selection model. 06 expands the read-only trace list with creation and editing, then adds the seed dialog, candidate panel and context menu around the existing canvas toolbar.

## Implementation record (2026-10-13)

Added deterministic placement, a Canvas 2D evidence renderer, pan/zoom, fit, node and edge selection, marquee, drag and multi-drag, snap and grid, tidy layout, hover detail, basic keyboard navigation and a live region. Saved traces open at `/case/<caseId>/trace/<traceId>` even when transaction history is unavailable. Creating traces through the UI and adding candidates remain Sprint 06, so the browser session without cases could verify the Storage count but not a live canvas drag. Pure layout tests cover placement, determinism and snapping. On a local synthetic 300-node/600-edge graph with 20 new nodes, 20-run medians were 0.09 ms for `autoPlace` and 0.46 ms for `tidyLayout`; pan/draw frame rate remains unmeasured. Full validation: `pnpm test` 32 files / 264 tests, `pnpm typecheck`, `pnpm lint`, and `next build --webpack` pass.

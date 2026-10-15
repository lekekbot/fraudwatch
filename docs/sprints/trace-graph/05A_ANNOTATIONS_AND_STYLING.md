# Sprint 05A — Annotations and Styling

**Status:** Core tools implemented on `trace-graph` at `4a66688`, extended 2026-10-15 (see the canvas rework note in `00_README.md`: text scales with zoom, word wrap, resizable notes, Text and Arrow tools, connection points and elbow routing, grouping, locking, alignment, icons); merge pending
**Depends on:** 04 (updaters), 05 (canvas, selection, placement)

*Added 2026-10-10 for D8: the trace canvas carries the investigator's own notes and drawings, like draw.io, kept visibly apart from evidence.*

## Summary and Why It Matters

Investigators reason on the diagram itself: "same operator?", a box around the wallets that came out of one exchange withdrawal, a sticky note with an exchange's reply. Without that they keep a second diagram elsewhere, and the trace stops being the record. The risk is the reverse: a hand-drawn arrow that a reader (or a screenshot) mistakes for an observed transfer. This sprint adds notes, shapes, frames and user connectors, plus node colour and size, with one hard rule: **annotations look, store and export differently from evidence, and never count as evidence.**

## Verified Current Repository Findings

### Existing capabilities

- Canvas, selection, multi-drag, grid and snap, `onMove` (05).
- Annotation and style types, `resolveEnd`, `detachEnds` (02 `src/lib/trace/presentation.ts`); updaters `addAnnotation`, `updateAnnotation`, `removeAnnotations`, `reorderAnnotation`, `setNodeStyle` with size caps (04).
- UI kit: `src/components/ui/` has button, dialog, input, textarea, popover, segmented and switch (popover/segmented/switch added by Global Preferences).

**Branch status (2026-10-13):** The canvas now draws and edits notes, shapes, frames and dashed connectors. Tools, resize handles, text editing, styling, duplication, z-order and deletion use the Sprint 04 updaters. Browser checks covered note editing and reload; the other annotation kinds still need browser checks.

### Remaining gaps and limitations

- The inline style controls use palette keys; there is no separate colour picker component. Automatic zoom to 100% before editing at very small zoom remains open.

### Assumptions requiring confirmation

- That plain text is enough for notes (no Markdown or rich text in MVP).

## Objectives and User Outcomes

- Add a note, rectangle, ellipse or frame anywhere; move, resize, recolour, edit text, delete; bring to front or send to back.
- Draw a connector between any two items (nodes, notes, shapes) or free points, with a label and arrowheads; it follows its ends when they move.
- Colour, resize or attach a short note to an evidence node.
- Anyone reading the diagram can tell evidence from annotation at a glance, including in a PNG.

## In Scope

- Toolbar: Select · Note · Rectangle · Ellipse · Frame · Connector (keys V, N, R, E, F, C; Esc returns to Select)
- Creating, selecting, moving, resizing (8 handles; Shift keeps aspect), deleting, duplicating (Cmd/Ctrl+D), z-order
- In-place text editing (an absolutely positioned `<textarea>` over the canvas, committed on blur or Cmd/Ctrl+Enter, Esc cancels)
- Connector drawing with attachment to item borders; label editing; arrow none/end/both
- Style popover for the selection: colour keys (02 `ColorKey`), fill none/tinted for shapes, node size s/m/l, node note
- Frame behaviour: dragging a frame moves the items whose centre is inside it
- Legend chip on the canvas: "Solid = observed movement · Dashed = your annotation"

## Explicitly Out of Scope

- Freehand drawing, images, rich text, custom hex colours, rotation
- Connectors that become steps (never: D8)
- Copy/paste between traces (post-MVP)
- Undo/redo (08 covers annotation edits through the same updaters)

## Architecture / Data Contracts / UX Decisions

### Visual separation (R5)

| | Evidence | Annotation |
|---|---|---|
| Lines | Solid, evidence palette, arrow at the receiver, amount/time label | **Dashed**, annotation colour, arrowheads only as chosen, free-text label in an outlined pill |
| Boxes | Nodes: rounded rectangle with address | Shapes: thin stroke, optional tinted fill; frames: dashed outline with a title tab |
| Text | Names and amounts from the data | Notes: sticky-note fill, the investigator's text |
| Hit priority | Nodes and edges on top of shapes/frames, below notes | — |
| Inspector | "Observed movement" (09) | "Annotation · drawn by you" with text and ends, no evidence section |

The legend chip is always drawn (and drawn into PNG exports, 11).

### Geometry

- Notes: `width` fixed by the user (default 200), height from wrapped text. Shapes and frames: `at` is the top-left, `width`/`height` ≥ 16. All in world coordinates.
- Connector ends attach to the nearest point on the item's border (node rectangle, shape outline, note box). A `point` end is free and can be dragged onto an item to attach.
- Hit testing: shapes by outline (with 6 px tolerance) unless filled; frames by outline and title tab only, so items inside a frame stay clickable; connectors by distance to the path.

### Editing flow

- Creating with a tool: click places a default-size item; drag sets its size. Then the tool returns to Select (Shift keeps the tool).
- Each commit is one updater call and one save (04): create, drop after move or resize, text commit, style change, delete.
- Moving a frame moves contained items in the same save (`setPositions` for nodes, annotation moves for the rest).
- Deleting an item that connectors point at detaches those ends to points (02 `detachEnds`); the connectors stay.
- Limits: 500 annotations per trace, 2,000 characters per note or label (04 enforces; the UI shows the count near the limit).

## Prerequisites and Dependencies

04, 05.

## Affected Modules and Proposed Files

- **Existing:** `src/app/case/trace/trace-canvas.tsx` (draw and hit-test annotations), `src/app/case/trace/trace-view.tsx`
- **Proposed new:** `src/app/case/trace/annotation-tools.tsx` (toolbar), `src/app/case/trace/annotation-editor.tsx` (text overlay), `src/app/case/trace/style-popover.tsx`, `src/lib/trace/geometry.ts` (+ test: border attachment, hit tests, frame containment, resize maths)

## Implementation Plan

### Task Group A — Geometry

- [x] `geometry.ts`: item bounds, border attachment point, hit tests, frame containment, resize with handles and aspect lock
- [x] Tests

### Task Group B — Canvas

- [x] Draw notes, shapes, frames, connectors with the visual rules above; legend chip
- [x] Selection, move, resize handles, z-order, duplicate, delete
- [x] Connector tool with attach/detach; label editing
- [x] Text editing overlay

### Task Group C — Styling

- [x] Style controls for nodes and annotations; node note (inline toolbar rather than a popover)

## UI Behavior and Example Scenarios

- Draw a frame around B, C and D titled "Out of Binance withdrawal 14 Mar"; drag the frame: all three move with it, one save.
- Connector from D to F labelled "same operator?": dashed, no amount; select it and the inspector says "Annotation · drawn by you".
- Delete note N that a connector points at: the connector stays, its end now free where N was.
- Colour node C red and size L: only the drawing changes; steps, totals and the view model are unchanged (test).

## Evidence / Data Integrity Invariants

- No annotation operation changes `steps`, the view model, totals, branches or candidates (test over every updater).
- A connector is never drawn solid or with an amount label; an evidence edge is never drawn dashed (test the style resolver).
- Annotations appear in their own section of every inspector and export, never mixed with movements.

## Edge Cases and Failure Recovery

| Case | Behaviour |
|---|---|
| Connector end on a node whose steps were all removed | Detached to a point (04) |
| Connector to a node in a hidden branch (08) | Drawn to the branch root's chip |
| Note text at the 2,000-character limit | Further typing is ignored; counter shown |
| Annotation far off-screen | Included in Fit |
| Stored annotation with an unknown kind or invalid numbers (newer build, corruption) | 04's `parseTrace` keeps it in `invalidAnnotations`, listed for removal; the trace still opens |

## Performance Considerations

- Annotations share 05's culling and rAF drawing. Wrapped note text is measured once per text/width change (cache like the timeline's text widths), not per frame.
- Target: 200 annotations at 60 fps pan (recorded in 10).

## Tests and Fixtures to Add

- `geometry.test.ts` (above).
- `edit.test.ts` additions (04): every annotation updater leaves `steps` and `buildTraceView` output identical.
- Browser: each scenario above; text editing with Enter, blur and Esc; keyboard tool shortcuts; reduced motion.

## Acceptance Criteria (observable and measurable)

- [ ] Every annotation kind can be created, moved, resized, restyled, edited and deleted, and survives reload (browser).
- [x] Evidence/annotation separation tests pass.
- [ ] Legend chip visible at every zoom.

## Definition of Done

- [ ] Merged with tests; browser checks recorded; validation commands pass.

## Known Risks / Open Decisions

- Text editing over a zoomed canvas uses a fixed-size screen overlay. Automatic zoom to 100% at very small zoom remains open.

## Handoff Notes for the Next Sprint

08 wraps these updaters in undo/redo. 09 shows annotations in the inspector. 11 exports them in the `canvas` block and draws them, with the legend, in the PNG.

## Implementation Record — 2026-10-13

The branch adds `src/lib/trace/geometry.ts` and canvas tools for notes, rectangles, ellipses, frames and user connectors. Connector endpoints attach to node or annotation borders and can be dragged back to free points or another item. Frame drags save contained node and annotation movement together. The inline style toolbar changes node colour, size and note, and annotation colour, fill, arrow and order. The legend stays in HTML over the canvas at every zoom. `view.test.ts` proves presentation edits do not change evidence output; `geometry.test.ts` covers border, handles, resizing and hit maths.

Browser smoke check: an address trace was created, a note was edited and its text survived reload. Shape, connector, frame, shortcut and reduced-motion checks remain. At very small zoom, text editing uses a fixed-size screen overlay; the planned automatic zoom to 100% is not implemented. Canvas frame-rate measurement remains Sprint 10 work.

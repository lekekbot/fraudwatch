# Sprint 08 — Branches, Cycles, and Trace Operations

**Status:** Implemented on `trace-graph` (2026-10-15); merge pending
**Depends on:** 06 (independent of 07 and 09)

## Summary and Why It Matters

Real traces split, merge, loop back and revisit the same counterparties. Without tools to focus, hide and undo, a trace with 40 steps becomes as hard to read as the Interaction Graph. This sprint adds those tools and makes sure cycles, merges and repeats never mislead (no double counting, no infinite expansion, no implied "same funds").

## Verified Current Repository Findings

### Existing capabilities

- After 02–06: one node per address (D2), `returns` edges, bundled edges, BFS depth, `presentation.hiddenBranches` reserved, pure updaters with immediate save, Undo toasts for single actions.
- Behaviour observations already detect circular movement, fund split, consolidation and rapid forwarding per wallet, with their rules and thresholds (`src/lib/behavior/observations.ts`, `BEHAVIOR_THRESHOLDS`). They're **observations**, not traces.
- No undo/redo stack anywhere in the app.

**Drift found 2026-10-15:** `removeSteps` didn't prune `presentation.hiddenBranches` as this plan assumed; it now does (same rule as positions and styles: entries for removed nodes go, `entity:` ids stay). Sprint 09's navigation isn't merged, so "Observations here" lists the observations and opens each one's first transaction in the Timeline.

### Gaps and limitations

- No branch summary or focus modes.

### Assumptions requiring confirmation

- Undo is per session (D7).

## Objectives and User Outcomes

- Hide or show a branch; focus one path; see branch summaries.
- Undo and redo every trace edit in the session.
- Cycles and merges are drawn and counted correctly.
- Optional link from a trace node to behaviour observations involving it.

## In Scope

- Branch definitions and operations; focus mode; branch summary
- Undo/redo stack over the 04 updaters
- Cycle and merge handling in view and layout; safeguards
- "Observations here" link on nodes

## Explicitly Out of Scope

- Saved snapshots or alternative-branch versions (`ROADMAP.md` §1 "branches and snapshots": post-MVP)
- Path comparison beyond the summary (post-MVP)
- Any automatic path finding between two addresses

## Architecture / Data Contracts / UX Decisions

### Definitions

- **Branch of node N (forward):** N's descendants reachable by steps directed away from the seed, stopping at nodes closer to the seed (so a return edge doesn't make the whole trace a branch). Backward is symmetric.
- **Annotations and branches:** annotations aren't part of any branch. A connector whose end is on a hidden node is drawn to the visible chip of the branch root.
- **Hidden branch:** `presentation.hiddenBranches` holds N. N stays visible with a chip "12 movements hidden ▸"; its branch's nodes and edges aren't drawn. **Steps are kept.**
- **Focus path:** an ephemeral (unsaved) mode showing only the path from the seed to a selected node (the shortest by steps), with the rest dimmed, not removed. Esc leaves it.
- **Branch summary** (on a selected node's panel): number of steps and nodes downstream, per-asset totals of the **added steps** ("Added movements total: 40 SOL, 1,200 USDC"), time span, and boundaries reached. Wording never says "traced funds".

### Cycles, merges, repeats

- **Cycle** (A→B→C→A): A keeps depth 0; C→A is a `returns` edge (05 routing). BFS visits each node once, so there's no infinite loop. Candidates from A after the return are still only those after the return step's order.
- **Merge** (A→C and B→C): C has two incoming edges; its column is the smaller depth; totals are per edge, never combined into "C received from the trace".
- **Repeated counterparty:** several steps between the same pair are one bundled edge (02), listing every signature.
- **Same-transaction legs to the same address** (e.g. two outputs to B in one signature): two steps, two keys, one bundled edge, one signature group in the inspector.
- **Totals over a branch with a cycle:** sum the steps in the branch, each counted once (by step id), never by walking paths.

### Undo / redo

```ts
// src/lib/trace/history.ts, pure
type History = { past: Trace[]; future: Trace[] };   // snapshots of the trace record, cap 100
push(h, before): History; undo(h, current): { history; trace } | null; redo(…)
```

- Every edit (add or remove steps, scope, direction, rename, move, style, annotation add/edit/remove, tidy layout, expand service, hide branch) pushes the previous record, then saves the new one. Undo saves the restored record.
- Cmd/Ctrl+Z, Shift+Cmd/Ctrl+Z, and toolbar buttons. The stack resets when switching traces or reloading (session only, D7).
- Drags push one entry per drop, not per move; text edits push one entry per commit (blur or Enter), not per keystroke.

### Safeguards

- `maxHops` enforced on add (06).
- Visible-item budget: if a trace exceeds **300 nodes or 600 edges** drawn, auto-hide nothing; instead show a banner suggesting hiding branches. Rendering stays culled (05). The budget is re-measured in 10.
- Adding movements that would make a node exceed **100 direct children** asks for confirmation.

## Prerequisites and Dependencies

06. Works with or without 07.

## Affected Modules and Proposed Files

- **Existing:** `src/lib/trace/view.ts` (branch membership, hidden filtering, summaries), `src/lib/trace/edit.ts` (`setBranchHidden` already planned), `src/app/case/trace/trace-view.tsx`, `trace-canvas.tsx`, `trace-toolbar.tsx`
- **Proposed new:** `src/lib/trace/branches.ts`, `src/lib/trace/history.ts`, tests for both

## Implementation Plan

### Task Group A — Branch model

- [x] `branchOf(view, nodeId, direction)` per the definition; `summarizeBranch` with per-asset BigInt totals by unique step id
- [x] Hidden-branch filtering in the view model with the "N movements hidden" chip data
- [x] Focus path (shortest by steps; ties by earliest order)

### Task Group B — Undo/redo

- [x] `history.ts` with cap; wire every updater call through it in `trace-view.tsx`; keyboard shortcuts; toolbar buttons with disabled states

### Task Group C — UI

- [x] Context menu: Hide branch / Show branch, Focus path; Esc to leave focus
- [x] Branch summary in the node panel
- [x] Visible-item banner; children confirmation
- [x] "Observations involving this wallet" link (opens the observation in the Timeline via 09's navigation, or lists them if 09 isn't merged)

## UI Behavior and Example Scenarios

- **F6:** A→B→C→A. A dashed return edge; the branch summary of B shows 2 steps (B→C, C→A) and "Returns to A".
- Hide branch at B in a 40-step trace: B shows "38 movements hidden ▸"; Undo restores; reload keeps it hidden (presentation is saved).
- Undo after deleting 5 steps: the 5 steps return with the same ids and keys.

## Evidence / Data Integrity Invariants

- Hiding and focusing never remove steps.
- Totals count each step once; never cross assets.
- Undo restores exact previous records (deep equality).

## Edge Cases and Failure Recovery

- Hiding the seed's branch: not allowed (the seed is the root); the action is disabled.
- A hidden branch whose root node is removed: the entry is pruned (04 `removeSteps`).
- Undo after the trace was changed in another tab: undo applies to this tab's snapshot; the last write wins, documented. The toast mentions "changed elsewhere" if `updatedAt` moved unexpectedly.
- A cycle through a collapsed service (07): handled the same way on the entity node.

## Performance Considerations

Branch computations are O(nodes + edges) per call, memoised on (view, hidden set). History snapshots of a 500-step trace cost ≈ 150 KB each; a cap of 100 keeps memory under ~15 MB worst case. Lower the cap if 10 measures pressure.

## Tests and Fixtures to Add

- `branches.test.ts`: cycle terminates; a merge counts each step once; branch excludes return targets closer to the seed; hidden filtering keeps steps; focus path deterministic.
- `history.test.ts`: undo/redo sequences; cap; redo cleared after a new edit.
- Synthetic fixtures (labelled): ring of 5 wallets; fan-out 1→200; fan-in 200→1; repeated pair with 50 movements.

## Acceptance Criteria (observable and measurable)

- [x] F6 and the synthetic fixtures behave as tested.
- [x] No operation changes `steps` except add, remove and undo/redo (tests).
- [x] Validation commands pass; browser checks recorded.

## Implementation Notes (2026-10-15)

- `src/lib/trace/branches.ts`: `branchOf`, `summarizeBranch`, `hideBranches`, `focusPath`, all pure over a built `TraceView` (so they work on collapsed service nodes too). `src/lib/trace/history.ts`: the capped undo stack.
- **Hiding with merges and rings.** A node in a hidden branch stays drawn when the seed reaches it without passing through a hidden root: along movements ahead of the seed, against them behind it. So in a merge (A→B→C, A→D→C) hiding B keeps C, and in a ring (A→B→C→D→E→A) hiding B hides only C, because D and E are also 2 and 1 hops behind A. The chip counts the branch's steps that aren't drawn, so it can read "0 movements hidden" when everything is still reachable.
- The chip sits beside the node on the side the branch continues; clicking it shows the branch. Hide branch is disabled for the seed, for unconnected nodes and when there is nothing downstream.
- **Undo** covers every recorded edit made through `persist`; automatic placement of new nodes isn't recorded. The stack is per trace and resets on switching traces or reloading. Not implemented: the "changed elsewhere" note on undo (saves stamp their own `updatedAt`, so there's no reliable baseline yet).
- Automatic placement is no longer retried after a failed save (previously a storage error, such as a full quota, re-saved and toasted on every render).
- Adding movements that give a node more than 100 distinct direct recipients (forward) or senders (backward) asks first. Over 300 drawn nodes or 600 drawn edges shows a banner suggesting hiding branches.

**Validation (2026-10-15):** `pnpm test` (36 files, 284 tests), `pnpm typecheck`, `pnpm lint` pass. Browser check on a local case (live RPC data): added movements to two hops; Undo/Redo by button and Cmd+Z / Shift+Cmd+Z; branch summary (2 steps, 2 nodes, 0.050006 SOL, stops, two circular-movement observations with Open in Timeline); Hide branch from the context menu and the panel; the chip and "1 branch hidden" persisted across reload while the undo stack reset; the chip shows the branch again and Undo re-hides it; Focus path dims everything off the seed→6LQ6→Jitotip path, and Esc leaves it. No console errors. Not checked in the browser: the 300/600 banner and the 100-children confirmation (covered by code review only).

## Definition of Done

- [ ] Model, history, UI merged with tests; results recorded.

## Known Risks / Open Decisions

- Session-only undo can surprise users after reload. The Undo toast for destructive single actions stays as a second safety net.

## Handoff Notes for the Next Sprint

09 adds the full inspector for nodes, edges, steps and branches, and the cross-view navigation used by "Observations here".

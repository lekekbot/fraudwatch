# Sprint 10 — Large-Case Performance

**Status:** Implemented on `trace-graph` (2026-10-15); merge pending
**Depends on:** 06–09

## Summary and Why It Matters

Fraud cases involve wallets with thousands of transfers and counterparties. The trace must stay responsive at that scale, never trigger RPC traffic for presentation changes, and degrade by asking rather than by freezing or silently truncating.

## Verified Current Repository Findings

### Existing capabilities

- Scale reference: `src/lib/semantic/performance.test.ts` scenarios (1 wallet / 1,000 tx / 3 s budget; 5 / 2,000 / 5 s; 10 / 5,000 / 10 s), built from recorded fixtures plus `makeTx` synthetics, covering reconstruction, summaries, interpretation, observations and the graph. `docs/ARCHITECTURE.md` cites ≈ 150 ms for interpretation at 10 wallets / 5,000 transactions.
- Ingestion caps: 5,000 signatures and 25 pages per address; concurrency 8; abort via `AbortController` (`src/lib/ingest/ingest.ts`, `src/hooks/use-ingestion.ts`).
- Derivations are memoised in `CaseWorkspace`; the Graph is built only when its view is active.
- Canvas redraws are scheduled with `requestAnimationFrame` in the Timeline.

**Re-checked 2026-10-15.** Drift and findings:

- `autoPlace` (05) was cubic in a fan-out: each probe for a free row scanned every placed node, and every child re-probed the rows its siblings had already filled. Measured before the fix: 60 children 6 ms, 100 children 28 ms (≈ 0.75 s at 300, minutes at 2,000). Fixed, see below.
- The movement index memo depended on `view`, so it was dropped and rebuilt every time the Trace view was left and reopened. It's now built the first time the Trace view opens and kept, rebuilt only when the events change.
- Layout functions are `autoPlace` (incremental) and `tidyLayout` (reset), not `layoutTrace`.

### Gaps and limitations

- No browser-side performance measurement harness; node-side timing tests only.

### Assumptions requiring confirmation

- That the developer machine numbers recorded here are the baseline. Budgets in tests stay generous (×3 or more), as `performance.test.ts` does.

## Objectives and User Outcomes

- Measured baselines for every trace stage at the reference scale.
- Budgets enforced by tests for pure stages; recorded manual measurements for rendering.
- No RPC requests from trace actions other than Map wallet.

## In Scope

- `src/lib/trace/performance.test.ts`
- Optimisations only where measurements exceed targets
- RPC request audit
- Degradation behaviour above limits

## Explicitly Out of Scope

- Changing ingestion caps or the semantic pipeline
- Web workers, unless a measured stage exceeds its target by more than ×2 with no algorithmic fix (then a separate proposal)

## Architecture / Data Contracts / UX Decisions

### Stages and targets

Targets are starting points. Record the measured value next to each; tests assert **3×** the target.

| Stage | Scale | Target |
|---|---|---|
| `buildMovementIndex` | 10 wallets / 5,000 tx | 150 ms |
| `candidates` page | address with 5,000 movements, filters on | 5 ms |
| `buildTraceView` | 500 steps | 20 ms |
| `layoutTrace` incremental | 300 nodes | 5 ms |
| `layoutTrace` reset | 300 nodes | 50 ms |
| Canvas pan | 300 nodes / 600 edges | 60 fps (manual, recorded) |
| Inspector open | any step | < 1 frame of blocking work (manual) |

### Fixtures

- Use `performance.test.ts`'s generator approach (recorded fixtures plus `makeTx`), extended with labelled **synthetic** shapes: fan-out 1→2,000; fan-in 2,000→1; ring of 50; repeated pair with 1,000 movements; 10 mapped wallets trading with each other (F8).

### Rules

- The movement index is built once per case open while the trace view is active, and rebuilt only when `semanticEvents` changes.
- Presentation changes (move, style, annotation edits, expand service, hide branch, zoom, theme) never rebuild the index; only view and layout as needed.
- The candidate panel virtualises nothing beyond paging (50); if a page renders slowly, reduce the page size before adding a virtualisation dependency.
- Canvas culling and label-hiding thresholds come from measurements.

### Degradation

| Limit | Behaviour |
|---|---|
| Trace above 300 nodes / 600 edges drawn | Banner suggesting branch hiding; nothing hidden automatically |
| Candidate total above 10,000 | Show the count; require a filter (asset or amount) before listing more than the first page |
| Ingestion running | Candidates from the last result; header says results may change |
| Ingestion cap hit for a wallet | Completeness `partial_history`, with the coverage warning text from ingestion |

### RPC audit

With the network panel filtered to the RPC host, run: open trace, add and remove steps, expand services, hide branches, undo/redo, inspect, navigate to Timeline and Graph and back, export (11). Expected: zero requests. Then Map wallet: requests only for that wallet's missing ranges.

## Prerequisites and Dependencies

06–09 merged.

## Affected Modules and Proposed Files

- **Proposed new:** `src/lib/trace/performance.test.ts`
- **Existing:** only files where a measured hotspot is fixed, each change listed in this document with before and after numbers

## Implementation Plan

### Task Group A — Measure

- [x] Write `performance.test.ts` with the synthetic fixtures and stage timings; print timings
- [x] Record baseline numbers in this file
- [x] Measure canvas frame rate and inspector responsiveness in the browser; record

### Task Group B — Fix what exceeds targets

- [x] For each stage over target: profile, fix algorithmically, re-measure, record

### Task Group C — Degradation and audit

- [x] Implement the candidate-total filter requirement and the large-trace banner (if not already present from 08)
- [x] Run and record the RPC audit

## UI Behavior and Example Scenarios

- Fan-out wallet with 2,000 outgoing transfers: the candidate panel shows "50 of 2,000" instantly; scrolling pages adds 50 at a time.
- A wallet with 12,000 movements: "12,000 movements, filter by asset or amount to list them" with the first 50 shown.

## Evidence / Data Integrity Invariants

- Optimisations never change classification, candidates or view output (tests compare outputs before and after on fixtures).

## Edge Cases and Failure Recovery

- Memory: index for 10 wallets / 5,000 tx measured and recorded; if above ~50 MB, revisit storing refs by reference instead of copies.
- Rapid trace switching: no stale renders. Views are pure functions of (trace, index), so switching just recomputes.

## Performance Considerations

This whole sprint.

## Tests and Fixtures to Add

- `src/lib/trace/performance.test.ts` with budgets at 3× target.
- Output-equality tests for any optimised function.

## Acceptance Criteria (observable and measurable)

- [x] Every stage has a recorded number; pure stages within 3× target in CI.
- [x] RPC audit recorded with zero unexpected requests.
- [x] Interaction Graph and Timeline timings in `src/lib/semantic/performance.test.ts` unchanged (no regression).

## Results (2026-10-15)

Machine: Apple M5 Pro (macOS, Node 24.10), `src/lib/trace/performance.test.ts`, fastest of 5 runs; tests assert 3× target.

| Stage | Scale | Target | Measured |
|---|---|---|---|
| `buildMovementIndex` | 10 wallets / 5,000 tx (every 5th a recorded real transaction) | 150 ms | 5–6 ms; ≈ 2 MB heap |
| `candidates` page | 5,000 movements, asset + minimum + dates + counterparty search | 5 ms | 0.5 ms |
| `buildTraceView` | 500 steps / 300 nodes | 20 ms | 0.9 ms |
| `autoPlace` incremental | 300 nodes, 1 new | 5 ms | 0.2 ms |
| `tidyLayout` reset | 300 nodes | 50 ms | 0.6 ms |
| `branchOf` / `hideBranches` (3) / `focusPath` | 300 nodes | 5 / 10 / 5 ms | 0.1 / 0.3 / 0.1 ms |
| Synthetic fan-out 1→2,000 | view / autoPlace / tidy | 40 / 50 / 50 ms | 3.4 / 3.1 / 6.6 ms (autoPlace was minutes before the fix) |
| Synthetic fan-in 2,000→1 | view / autoPlace / tidy | 40 / 50 / 50 ms | 3.3 / 3.0 / 6.7 ms (autoPlace 152 ms after the first fix) |
| Synthetic ring of 50, repeated pair of 1,000 | view / autoPlace / tidy | 40 / 50 / 50 ms | ≤ 0.9 ms |
| Canvas pan and zoom | 300 nodes / 599 edges drawn, all in view | 60 fps | 120 fps (display rate); full redraw 0.8 ms median, 1.3 ms worst |
| Inspector open | node and edge clicks on the 300-node trace, production build | < 1 frame blocking | handler 0–9 ms including React render; no long tasks; input-to-paint 16–32 ms |

The browser figures used a synthetic 300-node / 600-step trace written to the local case (its steps are stale by design and drawn from stored references), measured with `requestAnimationFrame` intervals, the Event Timing API and a long-task observer. The dev build was measured too: same frame rate, input-to-paint 24–48 ms.

**Fixes (output unchanged).** `autoPlace` now buckets placed nodes in node-sized cells (an overlap check looks at 9 cells instead of every node), remembers where probing around each base point stopped (rows found taken stay taken, since nodes are only added), finds a node's first placed neighbour from a per-node edge list, and caches "does any remaining node have a placed neighbour" until the next placement. `layout.test.ts` keeps the previous implementation verbatim and asserts identical output on fan-out, fan-in, ring and mixed shapes, with and without saved positions, obstacles and grid snapping.

**Graph and Timeline (no regression).** `src/lib/semantic/performance.test.ts` is unchanged and passes: 39 / 42 / 101 ms for 1 / 5 / 10 wallets in this run (budgets 3 / 5 / 10 s). That code wasn't touched; an isolated cold run on `HEAD` measured 192 / 200 ms for the 1- and 10-wallet cases, so these numbers vary with JIT warm-up.

**Degradation.** Over 300 nodes / 600 edges: the banner from 08. Over 10,000 candidates with no asset, amount or counterparty filter: the count is shown, "filter by asset, amount or counterparty to list more than the first 50", and "Show 50 more" is withheld. While ingestion runs: "Loading, results may change" (from 06). Partial history: the ingestion coverage warnings (for example the safety-limit text) are now listed under the completeness line.

**RPC audit (production build).** Network log cleared after the case loaded, then: inspect an edge and a node, add a movement, Undo, Redo, Undo, hide and show a branch, Show in Graph and back, Open in Timeline and back. Requests that left localhost: none to the RPC; two token logos from `assets-cdn.trustwallet.com` loaded by the Graph and Timeline views (existing behaviour, not trace actions). Not run: Map wallet (it would change the case) and export (Sprint 11).

**Also changed.** Show in Graph from a node or a bundled edge now labels the Graph's chip "Only the traced movements of …" rather than just the address, which read like an address filter.

Not checked in the browser: the 10,000-candidate message (no wallet that large in the test case; the rule is a plain condition in `candidate-panel.tsx`).

## Definition of Done

- [ ] Tests merged; numbers and audit recorded here; validation commands pass.

## Known Risks / Open Decisions

- Machine-dependent numbers. Budgets are generous and the recorded baselines note the machine.

## Handoff Notes for the Next Sprint

11 serialises traces for export; reuse the view model, not the canvas, for machine-readable output.

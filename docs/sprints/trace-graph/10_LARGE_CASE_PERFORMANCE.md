# Sprint 10 — Large-Case Performance

**Status:** Planned
**Depends on:** 06–09

## Summary and Why It Matters

Fraud cases involve wallets with thousands of transfers and counterparties. The trace must stay responsive at that scale, never trigger RPC traffic for presentation changes, and degrade by asking rather than by freezing or silently truncating.

## Verified Current Repository Findings

### Existing capabilities

- Scale reference: `src/lib/semantic/performance.test.ts` scenarios (1 wallet / 1,000 tx / 3 s budget; 5 / 2,000 / 5 s; 10 / 5,000 / 10 s), built from recorded fixtures plus `makeTx` synthetics, covering reconstruction, summaries, interpretation, observations and the graph. `docs/ARCHITECTURE.md` cites ≈ 150 ms for interpretation at 10 wallets / 5,000 transactions.
- Ingestion caps: 5,000 signatures and 25 pages per address; concurrency 8; abort via `AbortController` (`src/lib/ingest/ingest.ts`, `src/hooks/use-ingestion.ts`).
- Derivations are memoised in `CaseWorkspace`; the Graph is built only when its view is active.
- Canvas redraws are scheduled with `requestAnimationFrame` in the Timeline.

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

- [ ] Write `performance.test.ts` with the synthetic fixtures and stage timings; print timings
- [ ] Record baseline numbers in this file
- [ ] Measure canvas frame rate and inspector responsiveness in the browser; record

### Task Group B — Fix what exceeds targets

- [ ] For each stage over target: profile, fix algorithmically, re-measure, record

### Task Group C — Degradation and audit

- [ ] Implement the candidate-total filter requirement and the large-trace banner (if not already present from 08)
- [ ] Run and record the RPC audit

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

- [ ] Every stage has a recorded number; pure stages within 3× target in CI.
- [ ] RPC audit recorded with zero unexpected requests.
- [ ] Interaction Graph and Timeline timings in `src/lib/semantic/performance.test.ts` unchanged (no regression).

## Definition of Done

- [ ] Tests merged; numbers and audit recorded here; validation commands pass.

## Known Risks / Open Decisions

- Machine-dependent numbers. Budgets are generous and the recorded baselines note the machine.

## Handoff Notes for the Next Sprint

11 serialises traces for export; reuse the view model, not the canvas, for machine-readable output.

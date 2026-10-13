# Sprint 13 — Validation, Accessibility, and Release

**Status:** Planned
**Depends on:** 01–11. **Not** on 12.

## Summary and Why It Matters

Before investigators rely on the Trace Graph, every evidence invariant must be proven, every limitation stated plainly, accessibility checked, and the existing views confirmed unchanged. This sprint is the release gate.

## Verified Current Repository Findings

### Existing capabilities

- Validation commands (`package.json`): `pnpm test` (Vitest), `pnpm typecheck` (`next typegen && tsc --noEmit`), `pnpm lint` (ESLint), `pnpm build`.
- Baseline before this initiative: 14 test files / 142 tests passing; typecheck clean (2026-10-08, `04f121b`).
- No DOM test framework; UI is verified in the browser (`docs/MISTAKES.md` records why: verify in the browser without relying on assumptions).
- Docs to update: `docs/ARCHITECTURE.md`, `docs/TERMINOLOGY.md`, `README.md`, `ROADMAP.md` §1 (mark the shipped slice), `docs/CHRONOLOGY_OPEN_ISSUES.md` (trace-relevant limitations).

### Gaps and limitations

- No feature-flag system. Release is "the Trace tab is visible", which it has been since 06. If the release needs to be held back, hide the tab (one line in the view switcher) rather than adding a flag system.

### Assumptions requiring confirmation

- Release target (private beta per MVP Sprint 11, or public).

## Objectives and User Outcomes

- All invariants covered by automated tests and listed in one place.
- Accessibility and responsive behaviour verified.
- A plain-language limitations statement in the product and the docs.
- Confirmed no regressions in existing views.

## In Scope

- Invariant test audit; end-to-end manual scenarios F1–F8; accessibility; responsive; documentation; release note

## Explicitly Out of Scope

- New features; Sprint 12

## Architecture / Data Contracts / UX Decisions

### Invariant register (each must point to a passing test)

| # | Invariant | Test location |
|---|---|---|
| I1 | One signature is never split into several transactions in any inspector or export | 03, 09, 11 tests |
| I2 | Every edge corresponds to stored steps whose movement keys resolve to real flows, or is marked stale | 02 `view.test.ts` |
| I3 | Arrows always point from `from` to `to` | 05 `layout.test.ts` |
| I4 | No step is removed except by explicit remove or undo | 04 `edit.test.ts`, 08 `branches.test.ts` |
| I5 | Totals never mix assets and count each step once | 02, 08 |
| I6 | Folding preserves real addresses (`via`) and steps | 07 `services.test.ts` |
| I7 | No continuation offered out of a custodial service | 07 |
| I8 | `end_of_history` only with complete coverage | 02 |
| I9 | Exports include every step and every disclosure; never the RPC URL | 11 |
| I10 | Trace actions issue no RPC requests except Map wallet | 10 audit (manual, recorded) |
| I11 | Settlement flows and network fees are never movements | 03 |
| I12 | Case deletion removes its traces; other cases untouched | 04 |

### Limitations statement (in the trace view's "About traces" link and `docs/ARCHITECTURE.md`)

> A trace shows movements FraudWatch observed in loaded transactions, in time order. It doesn't establish that the same funds moved from one step to the next: Solana balances don't carry coin identity. Movements are only known for wallets whose history is loaded (mapped wallets) within the case range. Custodial services such as exchanges pool deposits, so later withdrawals can't be linked to a deposit from on-chain data. Interpretations carry a confidence; check the evidence for each step.

### Accessibility

- Keyboard: every action reachable without a pointer (canvas navigation from 05, menus, dialogs, candidate list checkboxes, undo/redo).
- Screen readers: the canvas live region announces selection; the candidate list is a native list with labelled checkboxes; dialogs use the existing `Dialog` (focus trap).
- Contrast: edges, boundary markers and the stale warning colour meet WCAG AA in light and dark themes (check with the browser's contrast tools).
- Reduced motion respected.
- Colour is never the only signal: provenance and boundaries have icons and text.

### Responsive

- ≥ 1024 px: canvas plus side panel.
- 768–1023 px: the side panel overlays the canvas.
- < 768 px: canvas full width, panel as a bottom sheet; the candidate list remains usable. Building traces on a phone isn't a goal, but reading them must work.

## Prerequisites and Dependencies

01–11 merged.

## Affected Modules and Proposed Files

- **Existing (docs):** `docs/ARCHITECTURE.md`, `docs/TERMINOLOGY.md`, `README.md`, `ROADMAP.md`, `docs/CHRONOLOGY_OPEN_ISSUES.md`, `docs/sprints/trace-graph/00_README.md`
- **Code:** only fixes found by this sprint, each recorded here

## Implementation Plan

### Task Group A — Automated

- [ ] Map I1–I12 to tests; add any missing test
- [ ] `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`; record results

### Task Group B — Manual end-to-end (record each)

- [ ] F1 simple transfer; F2 large wallet; F3 NFT purchase; F4 swap; F5 exchange collapse/expand; F6 cycle; F7 missing data and boundaries; F8 repeated mapped-wallet trading
- [ ] Export/import round trip; PNG snapshot
- [ ] RPC audit (re-run from 10)
- [ ] Regression smoke of existing features: create case, load wallet, map wallet, timeline navigation and filters, graph clusters and selection, table, hide rules, labels, bookmarks, search, storage clearing, RPC error handling

### Task Group C — Accessibility and responsive

- [ ] Keyboard-only run of F1 and F3
- [ ] Screen reader spot check (VoiceOver) of canvas selection and candidate list
- [ ] Contrast check in both themes; 375 px, 768 px and desktop layouts

### Task Group D — Docs and release

- [ ] Limitations statement in the product and `ARCHITECTURE.md`; terminology final; roadmap updated
- [ ] Open issues: add trace-specific known limitations (D1 mapping-to-continue, custodial list scope, free layout doesn't encode time, annotations are claims not evidence)
- [ ] Release note; `00_README.md` statuses updated to reflect only what is done

## UI Behavior and Example Scenarios

F1–F8 as defined in Sprint 01, each run end to end.

## Evidence / Data Integrity Invariants

The register above.

## Edge Cases and Failure Recovery

Re-run each sprint's edge-case list as a checklist; record any that fail and fix them, or document them as known limitations.

## Performance Considerations

Re-run `src/lib/trace/performance.test.ts` and `src/lib/semantic/performance.test.ts`; compare with 10's recorded numbers.

## Tests and Fixtures to Add

Only those the invariant audit finds missing.

## Acceptance Criteria (observable and measurable)

- [ ] I1–I12 each have a passing test or a recorded manual result.
- [ ] All validation commands pass.
- [ ] F1–F8, accessibility, responsive and regression checks recorded as passing.
- [ ] Limitations statement visible in the trace view.
- [ ] Sprint 12 status is irrelevant to this gate.

## Definition of Done

- [ ] Everything above recorded in this file; docs updated; release note written; statuses in `00_README.md` reflect reality.

## Known Risks / Open Decisions

- Mapping-to-continue (D1) is the main UX limitation shipping in this release. The release note says so.

## Handoff Notes for the Next Sprint

Post-MVP candidates, in suggested order: trace-only history loading (D1), context transactions outside the range, suggested continuations (`ROADMAP.md` §1), attribution heuristics with a documented method, PDF reports, cross-chain hops.

## Release note template

```text
Trace Graph (new)
- Build a trace from any wallet, transaction or movement: add the movements that matter, one decision at a time.
- Every step shows its transaction, real addresses, amounts, time and evidence; open it in the Timeline or Graph.
- Services group into one node and expand to their real addresses; exchanges are shown as custodial boundaries.
- Hide branches, focus a path, undo and redo; save several named traces per case.
- Export a trace as JSON (with disclosures) or a PNG snapshot.
Limits: traces show observed movements in time order, not proof that the same funds moved. Continuing past an
unmapped wallet requires mapping it.
```

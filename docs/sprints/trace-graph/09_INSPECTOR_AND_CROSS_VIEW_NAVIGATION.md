# Sprint 09 — Inspector and Cross-View Navigation

**Status:** Implemented on `trace-graph` (2026-10-15); merge pending. **Beta checkpoint** once 07, 08 and 09 are all merged.
**Depends on:** 06

## Summary and Why It Matters

A trace is only as convincing as what's behind each line. The inspector shows the exact evidence for every step (transaction, real accounts, amounts, interpretation and its confidence), and links let the investigator see the same transaction in the Timeline and the same addresses in the Graph without either view being changed.

## Verified Current Repository Findings

### Existing capabilities

- `EventSummary` and `EventEvidence` (`src/app/case/timeline/event-details.tsx`): event reading, flows, participants, evidence statements by category via `explainEvent` (`src/lib/semantic/explain.ts`), developer details and debug bundle (`debug-details.tsx`).
- `TransactionDetails` (`transaction-details.tsx`): lane-scoped (needs a mapped wallet's effect, summary and state); raw response loaded on demand.
- `AddressPanel` (`address-panel.tsx`): names, labels and tags editing, registry entry, look-alikes, Map, bookmark.
- `inspector-ui.tsx` helpers (e.g. `copy`).
- Cross-view: `goToTransaction(signature, wallet)` in `case-shell.tsx` → `WalletTimelineHandle.jumpTo`; if the Timeline isn't mounted, sets `focusSignature` and routes. Timeline → Graph: `TxFilter.relationship = { label, signatures }` and `routeTo("graph")`. Toast when a transaction is hidden by filters or a hidden lane.
- `CaseShell` is hosted by the case layout, so switching views keeps workspace state (comment in `case-shell.tsx`).
- `formatUtc`, `formatAssetAmount`, `assetLabel` (`src/app/case/asset-format.ts`).

**Re-checked 2026-10-15.** The assumption holds: `EventSummary` and `EventEvidence` need only a `WalletState` (for asset decimals, falling back to the case's asset list), not a lane. Drift:

- There is no way to edit a case's date range after creation, so the "Extend the case range" fix is explanation text only.
- An explorer link does exist (Solscan, in `transaction-details.tsx`, `edge-panel.tsx`, `address-panel.tsx`), so the step inspector reuses it.
- The Trace tab dropped the open trace id (`routeTo("trace", null)`), so returning from another view landed on the trace list. Fixed: the shell remembers the last open trace (none after going back to the list).

### Gaps and limitations

- `TransactionDetails` assumes a lane wallet. A step between two OBSERVED addresses (possible after mapping-then-unmapping, or seeded by transaction) has no lane.
- No deep link to a selection within a view.

### Assumptions requiring confirmation

- That the event-level inspector (`EventSummary`, `EventEvidence`) can be used without a lane wallet. The Timeline already renders it per event, so confirm in code before building on it.

## Objectives and User Outcomes

- Inspectors for step, edge (bundled), node (address or entity), conversion, boundary and branch.
- "Open in Timeline" and "Show in Graph" from any step, edge or node, without mutating those views beyond their existing navigation state.
- Returning to the Trace view restores the trace, selection and viewport.

## In Scope

- `src/app/case/trace/trace-inspector.tsx` and its sections
- Navigation callbacks wired in `case-shell.tsx`
- Trace view state retention across view switches
- Deep link `/case/<id>/trace/<traceId>`, already from 05; selection isn't in the URL

## Explicitly Out of Scope

- Editing labels from the trace beyond what `AddressPanel` already does (reused as-is)
- New evidence categories or explanation logic

## Architecture / Data Contracts / UX Decisions

### Inspector content

| Selection | Shows |
|---|---|
| Step / single edge | Signature (copy, explorer link only if one already exists in the app; otherwise none), time UTC (`formatUtc`), slot, asset and exact amount (full precision), **from** and **to real addresses** with names and states, flow role, event category and action, confidence, warnings, fee and fee payer (as context, not part of the movement), other legs of the same signature ("This transaction also moved: …", each addable), `EventEvidence` |
| Bundled edge | Table of its steps (time, signature, asset, amount), per-asset totals of these steps, first and last time; each row selectable |
| Node | `AddressPanel` (reused) plus a trace section: depth, incoming and outgoing steps, boundaries with explanations and fixes, conversions |
| Entity node (07) | Protocol name and category, the real addresses in the trace with their registry labels and roles, "Show addresses separately" |
| Conversion | Spent and received per asset, protocol, `EventEvidence` |
| Boundary | What it means and what would get past it: "Map wallet", "Extend the case range" (opens the existing range edit), "Custodial: start a new trace from a known withdrawal", "Bridged out: destination chain and recipient as recorded" |
| Branch | Summary from 08 |
| Stale step | Stored reference fields, why it's stale, the current movements of that signature (if loaded) with "Replace with this", which is an explicit remove plus add, undoable |

Every inspector section that reports a total labels it "total of added movements".

### Navigation

```ts
// passed from case-shell into TraceView
onOpenInTimeline(signature: string, wallet?: string): void   // existing goToTransaction
onShowInGraph(label: string, signatures: string[]): void      // existing relationship filter + routeTo("graph")
onSelectAddress(address: string): void                        // existing setSelectedAddress (inspector)
```

- **Open in Timeline:** uses `goToTransaction`. When the transaction has no mapped-wallet lane, the toast says "Not on a timeline lane (no mapped wallet in this transaction)" and offers to map the relevant address.
- **Show in Graph:** for an edge or branch, all its signatures; for a node, the signatures of its steps. The Graph shows its existing relationship-filter chip, which the user clears there as usual.
- These don't add any new state to the Timeline or Graph; they reuse exactly the paths the two views already use with each other.

### Retaining context

- Active trace id: URL. Selection and viewport transform: kept in `CaseWorkspace` state keyed by trace id (like other workspace state that survives view switches because the shell is layout-hosted). They aren't saved to IndexedDB.
- Back/forward browser navigation returns to the trace view with the same trace; selection is restored if still valid.

## Prerequisites and Dependencies

06. Shows richer content with 07 (entity) and 08 (branch) if merged; their sections are omitted otherwise.

## Affected Modules and Proposed Files

- **Existing:** `src/app/case/case-shell.tsx` (callbacks, retained trace UI state), possibly `src/app/case/timeline/event-details.tsx` (only if a prop is needed to render without a lane; keep the Timeline's rendering identical)
- **Proposed new:** `src/app/case/trace/trace-inspector.tsx` (replaces 06's `step-summary.tsx`), `src/lib/trace/inspect.ts` (pure helpers: other legs of a signature, boundary explanations, stale replacements), `src/lib/trace/inspect.test.ts`

## Implementation Plan

### Task Group A — Pure helpers

- [x] `otherLegs(index, signature, stepKeys)`; `boundaryExplanation(kind, context)`; `replacementCandidates(index, staleStep)`
- [x] Tests

### Task Group B — Inspector

- [x] Sections per the table; reuse `AddressPanel`, `EventSummary`, `EventEvidence`
- [x] "Replace with this" for stale steps (remove plus add, single undo entry)

### Task Group C — Navigation and retention

- [x] Wire `onOpenInTimeline`, `onShowInGraph`, `onSelectAddress`
- [x] Not-on-a-lane handling
- [x] Retain selection and transform per trace across view switches; restore on back/forward

## UI Behavior and Example Scenarios

- Select edge A→B (F1) → inspector shows the signature, 12 SOL exact, A and B with names, "TRANSFER · HIGH" and the evidence statements → **Open in Timeline** jumps to the transaction on A's lane → the Trace tab returns to the same selection and zoom.
- Select a bundled edge with 5 movements → a table of 5 → Show in Graph → the Graph shows the A–B relationship narrowed to those 5 signatures, with its usual chip.
- F3 step: the payment leg's inspector lists "This transaction also moved: NFT seller→buyer (in trace), royalty → creator 60 USDC (Add), marketplace fee (Add)".

## Evidence / Data Integrity Invariants

- One signature is presented as one transaction everywhere; legs are listed under it.
- Real addresses always visible for folded ends.
- Navigation never edits filters persistently, hide rules, lanes or labels. The relationship filter is the existing temporary one.

## Edge Cases and Failure Recovery

- Linked transaction hidden by a hide rule: Timeline jump fails with the existing toast; the inspector notes "hidden in this case" (D5).
- Linked transaction no longer loaded (stale): navigation actions disabled with a reason.
- Address panel actions (Map, label) from the trace inspector behave exactly as elsewhere.

## Performance Considerations

Inspector sections render only for the selection. `otherLegs` uses `bySignature` (03), O(legs).

## Tests and Fixtures to Add

- `inspect.test.ts`: other legs exclude legs already in the trace and include supporting ones; boundary explanations for every `BoundaryKind`; replacement candidates for a changed-amount stale step come from the same signature only.
- Browser (recorded): the three scenarios above; back/forward restore; hidden-transaction jump message.

## Acceptance Criteria (observable and measurable)

- [x] Every step opens the correct signature in the Timeline when a lane exists (checked on F1 and F3).
- [x] Timeline and Graph render identically before and after a round trip (no residual state except the relationship filter chip).
- [x] Validation commands pass.

## Implementation Notes (2026-10-15)

- `src/lib/trace/inspect.ts`: `otherLegs` (in-trace legs are marked "in trace", not dropped, matching the F3 scenario), `boundaryExplanation` for every `BoundaryKind`, `replacementCandidates` (same signature only, closest match first).
- `src/app/case/trace/trace-inspector.tsx` replaces `step-summary.tsx`. `TraceInspector`: a bundled edge lists its steps as a selectable table with per-asset totals of added movements; a step shows signature (copy, Solscan), UTC time and slot, exact amount, real ends with names and states, role, category · action · confidence, warnings, fee and fee payer as context, "hidden in this case", other legs with Add, the stale reason with "Replace with this" (one edit, one undo entry), then `EventSummary` and `EventEvidence`. `NodeTraceSection`: depth, steps in and out, an entity's real addresses with registry labels, boundaries with explanations and their fix (Map wallet; start a new trace for custodial stops), conversions, Show in Graph.
- Node panel: the trace section, the Sprint 08 branch panel, candidates, then the shell's own `AddressPanel` (passed in as `renderAddressPanel`, so its Map, label and look-alike behaviour is unchanged). An address clicked in the evidence opens its `AddressPanel` in place, with "Back to selection".
- Navigation reuses the shell's paths: Open in Timeline uses `goToTransaction` on a lane that has the transaction (an end's lane first); with no lane it toasts "Not on a timeline lane (no mapped wallet in this transaction)" with Map wallet. Show in Graph sets the existing relationship filter and routes to the Graph.
- Selection and zoom are kept per trace in the case shell for the session (`TraceUiStore`), restored when returning by tab or by browser Back.
- Not implemented: conversion and boundary aren't separate canvas selections; they're shown in the node section.

**Validation (2026-10-15):** `pnpm test` (37 files, 287 tests), `pnpm typecheck`, `pnpm lint` pass. Browser check on a local case (live RPC data): step inspector for 6LQ6 → Jitotip 2 (signature, slot, 0.000006 SOL, both ends, TRANSFER · RECEIVE · low, fee, the other leg "in trace", event reading and evidence); Open in Timeline jumped to the transaction on 6LQ6's lane; the Trace tab and browser Back each returned to the same trace with the same pan and selection; Show in Graph narrowed the Graph to that signature with its usual chip (1 of 105 transactions), which clears as usual; the node inspector with trace section, branch, candidates and `AddressPanel` (look-alike warning intact); clicking an address in the evidence opened its panel. No console errors. Not checked in the browser: the no-lane toast, the hidden-transaction note and "Replace with this" (this case had no such steps).

## Definition of Done

- [ ] Inspector and navigation merged; tests and browser checks recorded; Beta milestone updated in `00_README.md` when 07–09 are done.

## Known Risks / Open Decisions

- An explorer link (Solscan etc.) isn't present in the app today; adding one is a product decision (external request on click, but no data leak beyond the signature). Out of scope unless already present.

## Handoff Notes for the Next Sprint

10 measures the full flow (index build, candidates, view, layout, draw, inspector) on large cases.

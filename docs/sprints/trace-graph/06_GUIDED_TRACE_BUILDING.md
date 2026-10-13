# Sprint 06 — Investigator-Guided Trace Building

**Status:** Planned. **MVP checkpoint** at the end of this sprint. Core storage and canvas code from Sprints 04 and 05 is in the current working tree; their merge and final browser checks remain pending.
**Depends on:** 03, 04, 05

## Summary and Why It Matters

This is where the Trace Graph becomes usable: start a trace from something already in the case, see the movements that could come next, add exactly the ones that matter, and keep going. Every addition is a deliberate choice, and the tool never fills the canvas on its own.

## Verified Current Repository Findings

### Existing capabilities

- View switcher in the workspace top bar: buttons for `timeline | graph | table` calling `routeTo` (`src/app/case/case-shell.tsx` ~1105–1127). A plain switch clears inspector selection.
- Address inspector `AddressPanel` (`src/app/case/address-panel.tsx`), built by `panelFor` in `case-shell.tsx`, with actions such as Map, Bookmark, Filter to, lane toggle.
- Transaction inspector `TransactionDetails` (`src/app/case/timeline/transaction-details.tsx`) with action buttons (hide, bookmark, previous/next).
- Edge inspector `EdgePanel` (`src/app/case/graph/edge-panel.tsx`) with `onShowOnTimeline`, `onOpenInTimeline`.
- Mapping: `setMapTarget(address)` → `MapWalletDialog` → `confirmMap` → `mapWallet` + `ingestion.start` (`case-shell.tsx`, `map-wallet-dialog.tsx`). Range modes include `first_interaction`.
- Side panel primitives: `SidePanel`, `PanelSection`, `ShowMoreList` (`src/app/case/panel.tsx`).
- Base UI primitives installed (`@base-ui/react`: `menu`, `context-menu`, `popover`, `select`, `tabs`). `src/components/ui/` has `dialog`, `button`, `checkbox`, `badge`, `input`.
- Toasts with Undo actions are used for reversible changes (`sonner`, e.g. unmap undo).
- Ingestion state: `idle | running | done | error` (`src/hooks/use-ingestion.ts`).

### Gaps and limitations

- No menu or popover components in `src/components/ui/` yet (add via shadcn, or wrap Base UI directly).

### Assumptions requiring confirmation

- D1 outcome. This plan assumes "Map wallet to continue".

## Objectives and User Outcomes

- Start a trace from an address, a transaction, or a single movement.
- See paginated, filterable candidates for any node in either direction, grouped by transaction.
- Add or remove steps; see boundaries and how to get past them.
- Manage traces: list, create, rename, duplicate, delete.

## In Scope

- "Trace" view tab; trace list; seed and scope dialog
- Candidate panel; context menu on nodes and edges
- Entry actions in the address, transaction and edge inspectors
- Map-to-continue flow; loading and error states
- Expansion safeguards

## Explicitly Out of Scope

- Service folding (07), hide or focus branch and undo (08), the full step inspector and cross-view jumps (09). For MVP, selecting a step shows a compact summary: signature, time, asset, amount, from, to, confidence, plus "Open transaction" that uses the existing `TransactionDetails` when one end is a mapped wallet.

## Architecture / Data Contracts / UX Decisions

### Layout of the view

```text
┌ top bar: … [Timeline] [Graph] [Table] [Trace] …                                          ┐
│ Trace: Hack proceeds ▾  · Forward · USDC, SOL · 1 Mar–31 Mar · 6 hops max   [Scope] [⋯] │
│ ┌────────────────────────────── canvas (05) ─────────────────────┐ ┌ candidates / step ┐ │
│ │                                                                 │ │                  │ │
│ └─────────────────────────────────────────────────────────────────┘ └──────────────────┘ │
│ Observed movements in time order. Lines don't show that the same funds moved.            │
```

- **Trace menu** (▾): list of the case's traces (name, step count, updated), "New trace…", Rename, Duplicate, Delete (confirm dialog naming the step count).
- **No trace yet:** an empty state explaining what a trace is, and "Start a trace" opening the seed dialog.

### Seed and scope dialog

- **Seed:** pre-filled when started from an inspector; otherwise an address field (validated with `isValidSolanaAddress`) or a signature field.
- **Direction:** Forward / Backward / Both.
- **Assets:** "Any", or a multi-select of assets in the case (from `walletStates.assets`, labelled with `assetLabel`).
- **Time:** defaults to the case range; can only narrow it (wider needs context transactions, which aren't available).
- **Minimum amount:** optional, per asset.
- **Max hops:** default 6, 1–20.
- **Seed by transaction:** the dialog then lists that signature's movements (classified, 03), and the investigator ticks which become the first steps.

### Candidate panel

Opens when a node is selected and "Next movements" (forward) or "Earlier movements" (backward) is chosen (buttons on the panel, the context menu, or keys `]` / `[`).

```text
Next movements from B · USDC, SOL · after 3 Mar 14:02            Complete history ✓
[Asset ▾] [Min amount] [Search address]      ☐ Include earlier movements  ☐ Fees, royalties, rent
──────────────────────────────────────────────────────────────
☐ 5xY…a1  4 Mar 09:10  TRANSFER          → C (OBSERVED)   8 SOL
☐ 7pQ…k2  4 Mar 11:55  NFT_TRADE  2 legs → D               1,200 USDC   (payment)
     ☐ royalty → E 60 USDC
☐ 9zR…m3  5 Mar 02:01  TRANSFER          → F   hidden by rule "dust"   0.0001 SOL
Showing 50 of 1,240                                          [Show 50 more]
[Add 2 movements]
```

- Data from `candidates()` (03): grouped by signature; primary legs first; supporting legs only with the toggle; hidden-by-rule rows are marked, not removed (D5).
- Header completeness: **Complete history ✓** (mapped, coverage complete), **Partial: only movements with mapped wallets are known**, plus the action **Map B to see all its movements**, or **Outside the loaded range**.
- Conversions on the node appear as rows "Swapped 1,000 USDC → 6.2 SOL". Adding one adds a conversion step, and the trace's asset scope gains the received asset only if the user ticks "Follow received asset".
- Boundaries on the node appear as non-addable rows ("Bridged out to Ethereum: 0xab…", "Deposited to Binance (custodial)").
- **Already-added** movements are shown checked and disabled.

### Adding and removing

- `addSteps` (04) with the selected movements. The trace saves immediately; the toast reads "Added 2 movements · Undo" (Undo removes exactly those steps).
- Remove: from the edge context menu, the step summary, or Delete on a selected edge. A bundled edge asks which movements to remove (all, or a list).
- **Safeguards:** adding more than **25** movements at once asks for confirmation. A step that would exceed `maxHops` is refused with a message offering to raise the limit. There's no "add all", and no recursive or automatic expansion.

### Map to continue

"Map B" opens the existing `MapWalletDialog` (range mode default `first_interaction`). On confirm, the existing `confirmMap` runs, and the trace view shows "Loading B's history…" from the ingestion state. When done, the candidate panel refreshes with complete history. If ingestion errors, the panel shows the error and keeps the partial candidates. The trace is never changed by a failed load.

### Entry points

| Where | Action | Seed |
|---|---|---|
| `AddressPanel` | "Trace from this address" | address |
| `TransactionDetails` | "Trace this transaction" | transaction (dialog picks movements) |
| `EdgePanel` (graph) | "Trace these movements" | address `a`, with the edge's movements pre-ticked as first steps when they match the direction |
| Trace context menu | "Start new trace here" | address |

Each opens the seed dialog, creates the trace and routes to `/case/<id>/trace/<traceId>`.

### Context menu (Base UI Menu / ContextMenu)

Node: Next movements · Earlier movements · Map wallet (if OBSERVED) · Colour · Add note here · Copy address · Start new trace here. Edge: Show movements · Remove step(s) · Copy signature(s).

## Prerequisites and Dependencies

03 (`candidates`, classification), 04 (storage and updaters), 05 (canvas, route).

## Affected Modules and Proposed Files

- **Existing:** `src/app/case/case-shell.tsx` (Trace tab, wiring the movement index memo, entry callbacks), `src/app/case/address-panel.tsx`, `src/app/case/timeline/transaction-details.tsx`, `src/app/case/graph/edge-panel.tsx` (one action each, passed as optional props so nothing changes when absent)
- **Proposed new:** `src/app/case/trace/trace-view.tsx` (extended), `trace-toolbar.tsx`, `seed-dialog.tsx`, `candidate-panel.tsx`, `step-summary.tsx`, `trace-menu.tsx`; `src/components/ui/menu.tsx` (Base UI wrapper or shadcn `dropdown-menu`)

## Implementation Plan

### Task Group A — Shell

- [ ] Add "Trace" to the view switcher; route `/case/<id>/trace/<traceId?>`; an unknown trace id shows "Trace not found" with the list
- [ ] Movement index memo in `CaseWorkspace`, built only for `view === "trace"`
- [ ] Trace menu: list, new, rename, duplicate, delete with confirm

### Task Group B — Seed

- [ ] Seed dialog with validation, direction, assets, time, min amount, hops
- [ ] Seed-by-transaction movement picker
- [ ] Entry actions in the three inspectors

### Task Group C — Candidates

- [ ] Candidate panel with grouping, filters, paging (50), toggles, completeness header, hidden marking, conversions and boundaries
- [ ] Add selected; Undo toast; > 25 confirmation; max-hops refusal
- [ ] Remove steps (edge menu, Delete key, bundled chooser)

### Task Group D — Continue and states

- [ ] Map-to-continue with the existing dialog; loading, done and error states in the panel
- [ ] Empty, loading (ingestion running), and error (IndexedDB, ingestion) states for the view
- [ ] Step summary panel (MVP inspector)

## UI Behavior and Example Scenarios

- **F1:** Address panel → Trace from this address → Forward, SOL → candidates list the transfer to B → Add → edge A→B; B shows "History not loaded · Map B".
- **F2:** A wallet with 3,000 outgoing transfers: the list shows "50 of 3,000"; filter USDC ≥ 10,000 → 4 rows; add 2. The canvas has 3 nodes.
- **F3:** Trace this transaction (NFT sale): the dialog lists payment (buyer→seller) and nft (seller→buyer) ticked, royalty and fee unticked under "Fees, royalties, rent".
- **F7:** Forward from B with the case range ending 31 Mar: the header shows "Outside the loaded range" after the last loaded movement.

## Evidence / Data Integrity Invariants

- Only movements returned by `candidates` can become steps.
- A movement key is never added twice (`addSteps` guard plus disabled rows).
- No action here triggers an RPC request except confirming Map wallet.
- Hidden-by-rule status is shown, never used to exclude.

## Edge Cases and Failure Recovery

- Seed address not in any loaded transaction: the trace is created; the node shows "No loaded movements" plus "Map this wallet" if not mapped.
- Seed signature not loaded: the dialog says it isn't in this case's loaded data. No fetch.
- Ingestion running while building: candidates come from the last completed result; the header says "Loading… results may change".
- The user unmaps a wallet the trace depends on: steps go stale (04); a banner explains and offers to map it again.
- The trace is deleted in another tab while open: the live query returns missing; show "This trace was deleted".

## Performance Considerations

Candidate queries run synchronously on the in-memory index (03 budgets). The panel renders at most 50 groups per page. The canvas redraws only on trace change or interaction.

## Tests and Fixtures to Add

- Unit: seed-by-transaction preselection (primary ticked, supporting not); the max-hops refusal logic; the > 25 confirmation threshold helper; Undo removes exactly the added step ids.
- Browser (recorded here): F1, F2 (on a real or synthetic large case), F3, F7; map-to-continue end to end; delete trace; reload persistence; network panel shows no RPC calls except during Map wallet.

## Acceptance Criteria (observable and measurable)

- [ ] **MVP:** a user can build, save, reopen and delete an F1 and an F3 trace without RPC traffic beyond Map wallet.
- [ ] Only selected movements appear on the canvas (test: step count equals selections).
- [ ] A failed or cancelled load leaves the trace unchanged.
- [ ] Timeline, Graph and Table behave as before (smoke test recorded).

## Definition of Done

- [ ] All task groups complete; tests and browser checks recorded; `pnpm test`, `pnpm typecheck`, `pnpm lint` pass; `00_README.md` MVP milestone status updated only after this.

## Known Risks / Open Decisions

- Mapping to continue adds lanes the investigator may not want in the Timeline. Mitigation today: hide the lane (`hiddenLanes`). Post-MVP: trace-only loading (D1).

## Handoff Notes for the Next Sprint

07 changes how service addresses appear in nodes and candidates; 08 adds undo and branch tools on top of the same updaters; 09 replaces the step summary with the full inspector.

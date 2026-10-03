# Sprint 09C — Bulk Hide from Map

**Status:** Planned

**Goal:** Let an investigator clear noise in bulk from the table, and keep what they hid.

Today "Hide from map" hides one transaction at a time from the transaction details panel. The hidden set lives in
filter state (`filter.hiddenSignatures`), so it is lost on reload, and hidden rows leave the table, so a single one
can't be brought back.

## Scope

### 1. Persist hidden transactions on the case

- Add `hiddenSignatures?: string[]` to `FraudWatchCase`, next to `hiddenLanes`.
- Pure helpers in `src/lib/case/` (alongside `toggleLaneHidden`): `hideTransactions(c, signatures)` and
  `unhideTransactions(c, signatures)`, both returning a new case with `updatedAt` set.
- The workspace builds `filter.hiddenSignatures` from the case, so the timeline, graph, table and counts keep
  reading it through the existing `passesFilter` path. The single "Hide from map" button and the filter panel's
  "N hidden individually · Show all" write to the case instead of local state.
- One signature hides the transaction on every lane that has it: it is one on-chain transaction.

### 2. Select transactions in the table

- A checkbox per transaction, on its first row (a transaction can span several asset rows).
- Checkbox selects; clicking elsewhere on the row still opens transaction details.
- Shift-click selects the range from the last checked transaction, in the table's current sort and filter order.
- Header checkbox selects the current page; a banner then offers "Select all N matching" for every transaction
  passing the table's Asset/Type filters.
- Selection is cleared when the wallet, view, or table filters change.

### 3. Bulk action bar

- Shown while anything is selected: "N selected · Hide from map · Clear".
- Hide writes once to the case and clears the selection.
- A toast confirms with Undo ("Hid 312 transactions · Undo"); Undo unhides exactly that batch.

### 4. Show hidden in the table

- A "Show hidden" toggle in the table toolbar brings hidden transactions back, dimmed and marked "Hidden".
- With hidden rows shown, the action bar offers "Unhide" for the selection.
- Hidden rows stay out of the timeline and graph whatever the toggle says.

## Non-goals

- Rule-based hiding ("hide all failed", "hide dust"): the existing Type, Asset and Minimum amount filters cover it
  and are reversible.
- Keyboard shortcuts for select/hide.
- Hiding per lane.

## Verification

- `pnpm test` — case helpers: hide/unhide are idempotent, keep order, and leave other fields untouched.
- `pnpm typecheck`
- `pnpm lint`
- `pnpm exec next build --webpack`
- In the browser: bulk-hide a filtered set, reload, confirm it stays hidden across timeline, graph and table; Undo
  restores it; "Show hidden" + Unhide restores a single transaction.

## Acceptance criteria

- [ ] Hidden transactions survive a reload and an exported/imported case.
- [ ] The single-transaction "Hide from map" and the filter panel's "Show all" use the persisted set.
- [ ] Table rows can be selected one by one, by Shift range, by page, and as "all matching".
- [ ] Hide from map applies to the whole selection in one write, with Undo.
- [ ] "Show hidden" lists hidden transactions in the table and lets them be unhidden.
- [ ] Hidden transactions are absent from the timeline and graph on every lane.
- [ ] Existing tests, types, lint, and production build pass.

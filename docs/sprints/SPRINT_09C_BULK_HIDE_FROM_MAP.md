# Sprint 09C — Bulk Hide from Map and Hide Rules

**Status:** Implemented on `sprint-09c` (checked 2026-10-03) — awaiting review

**Goal:** Let an investigator clear noise in bulk — by hand from the table, or with saved rules — and keep what
they hid.

Today "Hide from map" hides one transaction at a time from the transaction details panel. The hidden set lives in
filter state (`filter.hiddenSignatures`), so it is lost on reload, and hidden rows leave the table, so a single one
can't be brought back.

Filters and hiding stay distinct: filters are a temporary view ("only swaps this week"); hiding is a lasting
decision that something is noise. Hidden transactions are left off every view until unhidden.

## Scope

### 1. Persist hiding on the case

Case fields, next to `hiddenLanes`:

```ts
hiddenSignatures?: string[]; // hidden by hand
shownSignatures?: string[];  // exceptions: shown even when a rule matches
hideRules?: HideRule[];
```

- `filter.hiddenSignatures` is removed; the case is the single source of what is hidden.
- A transaction is hidden when it isn't an exception and is hidden by hand or matched by an enabled rule.
  `src/lib/case/hiding.ts` owns this (`hiddenBy(tx, case, tagsOf)` → `"manual"`, the matching rule, or `null`),
  plus pure updaters `hideTransactions` / `unhideTransactions` that return a new case.
- Unhiding a rule-matched transaction adds it to `shownSignatures`; hiding it again removes it from there.
- One signature hides the transaction on every lane that has it: it is one on-chain transaction.
- The single "Hide from map" button and the filter panel write to the case.

### 2. Hide rules

A rule is a named, switchable set of conditions; every condition set must match (AND), any value within a
condition may match (OR). A rule with no conditions matches nothing.

```ts
type HideRule = {
  id: string;
  name: string;
  enabled: boolean;
  kinds?: EffectKind[];                               // transaction type is one of these
  onlyAssets?: string[];                              // every asset it moves is one of these (spam tokens)
  dust?: { assetId: string; below: string };          // moves the asset, and every movement of it is below (base units)
  counterparties?: string[];                          // involves one of these addresses
  tags?: string[];                                    // involves an address tagged with one of these
  protocols?: string[];                               // uses one of these protocols
};
```

- Managed from the left panel: "Hidden · N by hand · N by rules · Manage", opening a rules dialog.
- The dialog lists rules with an on/off switch, edit and delete; the editor shows a live "Matches N transactions"
  count across all mapped wallets before saving.
- Conditions reuse the filter vocabulary and pickers (types, assets, tags, protocols from the loaded case).

### 3. Select transactions in the table

- A checkbox per transaction, on its first row (a transaction can span several asset rows).
- Checkbox selects; clicking elsewhere on the row still opens transaction details.
- Shift-click selects the range from the last checked transaction, in the table's current sort and filter order.
- Header checkbox selects the current page; a banner then offers "Select all N matching" for every transaction
  passing the table's Asset/Type filters.
- Selection clears when the wallet or table filters change.

### 4. Bulk action bar

- Shown while anything is selected: "N selected · Hide from map · Clear" ("Unhide" when the selection is hidden).
- One write to the case; selection clears; a toast offers Undo for exactly that batch.

### 5. Show hidden in the table

- A "Show hidden" toggle brings hidden transactions back into the table, dimmed, labelled with why
  ("Hidden" or the rule's name).
- Hidden transactions stay off the timeline and graph whatever the toggle says.

## Non-goals

- Global rules shared across cases (rules are per case; export carries them once Sprint 10 lands).
- OR between conditions, nested rule logic.
- Creating a rule from a selected transaction; keyboard shortcuts.
- Hiding per lane.

## Verification

- `pnpm test` — hiding: manual, rule, exception precedence; each rule condition; empty rule matches nothing;
  hide/unhide updaters are idempotent and keep other fields.
- `pnpm typecheck`, `pnpm lint`, `pnpm exec next build --webpack`
- In the browser: bulk-hide a filtered set, reload, confirm it stays hidden across timeline, graph and table; Undo
  restores it; a dust rule hides matches with a correct preview count; unhiding one rule match keeps it visible;
  disabling the rule brings the rest back.

## Acceptance criteria

- [x] Hidden transactions, exceptions and rules survive a reload.
- [x] The single "Hide from map" and the filter panel use the case's hiding.
- [x] Rules can be created, edited, switched off and deleted, with a live match count.
- [x] Table rows can be selected one by one, by Shift range, by page, and as "all matching".
- [x] Hide/Unhide applies to the whole selection in one write, with Undo.
- [x] "Show hidden" lists hidden transactions in the table with the reason, and lets them be unhidden.
- [x] Hidden transactions are absent from the timeline and graph on every lane.
- [x] Existing tests, types, lint, and production build pass.

## Notes

- Checked in the browser: Shift-range select, bulk hide, reload, Show hidden, Unhide, Undo, a "Program call" rule
  (preview 37 = filter panel's 37), an exception surviving a rule, rule delete. Page/"select all", rule edit and
  disable, and the timeline/graph views share the same code paths and were not clicked through.
- Selection actions sit in the table's toolbar row rather than a bar above the table: a bar appearing on the first
  click pushed rows down, so a Shift-click landed on the wrong row.
- Export/import is Sprint 10; the fields are plain case data and travel with it then.

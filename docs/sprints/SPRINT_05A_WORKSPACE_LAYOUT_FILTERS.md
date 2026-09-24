# Sprint 05A — Full-Screen Workspace and Transaction Filters

**Status:** ✅ Complete (checked 2026-09-24) · PR #6

- **Workspace** (`src/app/case/case-shell.tsx`, `panel.tsx`): the case page fills the window, with a layout modelled on Figma.
  - Top bar: back to cases, left-panel toggle, case name and range, a centred Timeline/Table switch, Copy link, the RPC badge and an inspector toggle.
  - Left panel: mapped wallets (clicking one selects which wallet is shown; a red dot flags a mismatch or partial history), Filters, History (load button, progress, coverage, warnings) and Delete case at the bottom.
  - Centre: a full-bleed timeline canvas with a floating toolbar (spacing, ± zoom, fit, reset, previous/next, jump to date, help) and the minimap docked along the bottom. The Table view scrolls in the same space.
  - Right inspector: the selected wallet's address (copy and explorer buttons) and opening/closing state, or the selected transaction's details. Selecting a transaction opens the inspector even when it's hidden.
  - Cmd/Ctrl+\ hides and shows both panels.
- **Routing:** the other pages move into a `src/app/(site)/` route group whose layout keeps the header and centred column. The root layout only holds `<html>`, `<body>` and providers. URLs and the static export are unchanged.
- **Canvas sizing:** the timeline canvas sizes to its container, with a 280px minimum, instead of a fixed 280px. The lane sits midway above the axis, and the event-spacing note moved just above the axis so the floating toolbar doesn't cover it.
- **Transaction types — no "Other"** (`src/lib/state/summarize.ts`, tested): Send, Receive and Swap still come from the wallet's balance changes. A transaction that moved none of the wallet's value used to be FEE or OTHER, which lumped very different transactions together. It is now typed from its own instructions:
  - APPROVAL: a token approve, revoke or set-authority anywhere in the transaction, inner instructions included. It wins over everything else because it's what a drainer leaves behind.
  - STAKE: any stake program instruction.
  - ACCOUNT: only token-account setup or close (associated token account, system create/allocate/assign, token initialize/close).
  - PROGRAM: a call to anything else. The action names the program (or its shortened ID until the Sprint 06 registry names it) and the instruction when the RPC parsed one. Setup instructions are skipped when choosing the action, so "create ATA + call X" reads as a call to X.
  - Every summary carries `action` and `actor` (the fee payer when it isn't the wallet). Cards show "by <actor>" when there's no counterparty, and the details panel gains Action and Sent by rows.
  - The real wallet's 37 OTHER "Fee only" transactions turned out to be third-party bots (three fee payers) calling one program with the wallet as a read-only account. They now read "PROGRAM · Hobb…i8qG · by 96Y…tVz".
  - Approval cards are amber on the canvas.
`src/lib/timeline/filter.ts`, pure and tested; UI in `src/app/case/filter-panel.tsx`):
  - By type: Send, Receive, Swap, Approval, Stake, Account setup, Program call, Failed, each with a count.
  - By asset moved: a transaction is hidden only when every asset it moves (fee excluded) is hidden, so hiding SOL doesn't hide a USDC transfer.
  - One at a time: "Hide from map" in the details panel. Selection moves to the neighbouring transaction; "Show all" brings hidden ones back.
  - Filters apply to the map and the table only. Wallet state, coverage and mismatch checks always use the full history.
  - "Showing X of Y" and Reset appear while a filter is active.
  - The selection is tracked by signature, so it survives a filter change. In time spacing the zoom is kept; event spacing re-spreads from the full range.
- **Browser-checked** on a real 65-transaction mainnet wallet. Hiding Program call (37 third-party bot transactions) left 28 of 65 on the map. Hiding the selected Receive left 27 and moved the selection to its neighbour without changing the zoom. Panel toggles, the Table view and the `(site)` pages were also checked, with no console errors.

**Goal:** Give the map the whole screen before more layers land in Sprints 06–08, and let an investigator take noise off it.

## Layout

```text
┌─────────────────────────── top bar ───────────────────────────┐
│ ⛨ ▯  Case name · range      [Timeline|Table]     link  RPC  ▯ │
├──────────┬────────────────────────────────────────┬───────────┤
│ Wallets  │        [ floating toolbar ]            │ Inspector │
│ Filters  │                                        │  wallet   │
│ History  │  OPEN ──●────●──────●───●──── CLOSE    │  state /  │
│          │                                        │  tx       │
│ Delete   │ axis · minimap                         │  details  │
└──────────┴────────────────────────────────────────┴───────────┘
```

## Filters

- transaction type;
- asset moved;
- individually hidden transactions.

These are the first slice of the Sprint 09 filter list. Minimum amount, direction, protocol, tag, date subrange, counterparty and mapped-wallet filters stay in Sprint 09.

## Not in this sprint

- Saving filters per case (they reset on reload).
- Resizable panels.

## Acceptance criteria

- [x] The map uses the whole window; side panels can be hidden.
- [x] Transaction details open in a side inspector without shrinking the canvas unexpectedly.
- [x] Transactions can be hidden by type, by asset and individually.
- [x] Filtering never changes wallet state or coverage warnings.
- [x] Selection and zoom survive filter changes.
- [x] No catch-all "Other" type: every transaction without a value change is typed from its instructions.

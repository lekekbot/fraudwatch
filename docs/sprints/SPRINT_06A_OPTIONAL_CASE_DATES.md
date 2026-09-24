# Sprint 06A — Optional Case Dates from Wallet Activity

**Status:** ✅ Complete (checked 2026-09-24)

- **Empty dates are allowed** on New case (`validateNewCaseInput` in `src/lib/case/model.ts`). Each field now says what an empty value means.
  - Empty start date: the UTC day of the wallet's first transaction.
  - Empty end date: the UTC day of its latest transaction, inclusive like any end date.
  - A date the user enters is used as-is.
- **Activity lookup** (`findActivitySpan`, `src/lib/ingest/activity-span.ts`, tested): reads the wallet's signature list through the configured RPC.
  - The latest transaction takes one `getSignaturesForAddress` call. The first transaction pages back through the whole history, so it's only fetched when the start date is empty.
  - Signatures without a block time are skipped for the nearest one that has one.
  - A safety limit of 100,000 signatures stops the scan. Past it, the user is asked for a start date rather than given a wrong one.
  - The footer shows "Finding the wallet's first transaction… N signatures scanned", with a Stop button.
- **Filling the range** (`completeRange`, tested): errors point at the field to fix.
  - A wallet with no transactions: enter the dates.
  - Too many transactions to scan: enter a start date.
  - An entered start after the wallet's last transaction, or an entered end before its first: the message names that date.
  - Filled dates are written back into the form, so the duplicate-case dialog and "Back" show the real range.
- **No RPC configured:** the empty fields say to enter a date or add an RPC. Nothing is guessed.
- **Browser-checked** with `Ss6DxmwHYNqevep72mDb1nY7iLdYcwv7tqDCFLNqWwG` and both dates empty. The case was created as 2022-08-02 → 2026-03-18 in about 5 s. An independent scan through the public mainnet RPC agreed: 1,194 signatures, oldest 2022-08-02 13:00 UTC, newest 2026-03-18 17:39 UTC.

**Goal:** Let an investigator open a case from just a wallet address.

## Caveats

- **"Creation day" means first transaction.** Solana doesn't record when an account was created, so the oldest transaction in its signature history is the closest real signal. In practice that's usually the funding transfer.
- **The RPC's history limit applies.** A provider without full archival history returns its own oldest transaction, which may be later than the wallet's real first one. FraudWatch can't tell the difference.
- **Busy wallets take time.** Finding the first transaction costs one RPC call per 1,000 signatures, up to the 100,000-signature limit.
- **Dates are fixed at creation.** A case whose end came from "latest transaction" doesn't move forward as the wallet keeps transacting.
- **Startup links still need both dates.** `/map?wallet=&from=&to=` isn't changed. A link with only a wallet shows "Can't open this link", and its "Create a case manually" button doesn't carry the wallet over. Letting such links open New case prefilled is a small follow-up.

## Acceptance criteria

- [x] A case can be created with only a wallet address.
- [x] Empty start uses the day of the wallet's first transaction; empty end uses the day of its latest.
- [x] Entered dates are never overridden.
- [x] Wallets too busy to scan, or with no transactions, ask for dates instead of guessing.
- [x] The lookup shows progress and can be stopped.

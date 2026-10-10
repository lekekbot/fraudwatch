# Sprint 03 — Transaction and Movement Semantics

**Status:** Planned
**Depends on:** 02

## Summary and Why It Matters

This sprint decides which movements in a case can be traced, and what each one means. A royalty isn't the trade, a pool isn't a counterparty, a swap doesn't send money to someone else, and a fee isn't a transfer. Getting this right once, in one pure module, is what keeps the Trace Graph honest. The output is a **movement index** plus a **candidate query**, with no UI.

## Verified Current Repository Findings

### Existing capabilities

- Flow construction: `deltas` → `balanceFlows` (exact pairing only when one side is single; otherwise `null` sides) → interpreter roles → `withSettlement` (settlement flows reconcile pools, escrow, closures) (`src/lib/semantic/flows.ts`, `interpret.ts`).
- Roles (`FlowRole`): `spent`/`received` for swap, stake, lending and bridge actors (other side `null`); NFT parser roles `payment`, `royalty`, `marketplace_fee`, `rent`, `unidentified`, `nft`; `settlement`. Roles are absent for plain transfers.
- Network fee: `metadata.feeLamports`, **not a flow**. `deltas` adds it back to the payer.
- Categories: `TRANSFER, SWAP, NFT_TRADE, NFT_TRANSFER, NFT_MINT, BURN, STAKE, UNSTAKE, LENDING, BRIDGE, LIQUIDITY, ACCOUNT, APPROVAL, PROGRAM_INTERACTION, FAILED, UNKNOWN`. `bridge.direction` is `OUT | IN`.
- Failed transactions: category `FAILED`; only the fee moved (`interpreters.ts:16`).
- Ordering: `compareTransactions(a, b)` by slot, transaction index, signature (`src/lib/state/reconstruct.ts:64`).
- Coverage per wallet: `WalletIngestion.coverage.complete`, `oldestLoaded`, `newestLoaded`, `warnings` (`src/lib/ingest/ingest.ts`).
- Case hiding: `reasons` map (signature → manual or rule) in `case-shell.tsx`.
- Fixtures: `fixtures/solana/basic/{sol-transfer,spl-transfer,failed}.json`, `nft-sale/`, `magic-eden-sale/`, `magic-eden-core/`, `cnft/`, `defi/{jupiter-multi-hop,jupiter-route-relayed,cctp-*,kamino-*,…}`; `makeTx`, `token`, `read` helpers (`src/lib/semantic/testing.ts`). Exchange addresses: `protocols/centralized-vaults.json`.

### Gaps and limitations

- There's no per-address index of flows. The graph builds relationships from `WalletSide` summaries and events, not a reusable movement index.
- Known decoder gaps that will surface in traces (`docs/CHRONOLOGY_OPEN_ISSUES.md`): Drift withdrawals read as Burn (1.1); unpaired multi-party flows (4.2); approximate settlement (4.3); thin pool/vault registry (5.1), so some pools look like wallets.

### Assumptions requiring confirmation

- That traces only use **loaded** transactions (mapped wallets' histories), per D1.

## Objectives and User Outcomes

- A deterministic classification of every flow into: traceable movement, supporting movement, conversion, boundary, or excluded.
- A movement index built once per case open, and a candidate query that's fast enough for wallets with thousands of movements.

## In Scope

- `src/lib/trace/movements.ts`: `classifyEvent`, `buildMovementIndex`, `candidates`
- Fixture-backed tests for each representative flow (F1–F4, F7) from Sprint 01

## Explicitly Out of Scope

- Loading anything (no RPC). Service folding (07). UI (06).
- Coin-level attribution (FIFO, LIFO, proportional, "taint"): post-MVP, not modelled.

## Architecture / Data Contracts / UX Decisions

### Classification

```ts
export type Classified =
  | { kind: "movement"; ref: MovementRef; weight: "primary" | "supporting" }
  | { kind: "conversion"; signature: string; address: string; spent: Amount[]; received: Amount[] }
  | { kind: "boundary"; signature: string; address: string; boundary: BoundaryKind; ref?: MovementRef }
  | { kind: "excluded"; ref: MovementRef; reason: "settlement" | "zero" };

export function classifyEvent(event: SemanticEvent): Classified[];
```

| Event / flow | Classification | Why |
|---|---|---|
| `TRANSFER`, flow with no role, both sides known | movement, primary | Observed wallet-to-wallet movement |
| `NFT_TRANSFER` / `NFT_MINT` `nft` leg | movement, primary | The NFT itself moved |
| `NFT_TRADE` `payment` (buyer → seller) and `nft` (seller → buyer) | movement, primary | The two sides of the trade |
| `NFT_TRADE` `royalty`, `marketplace_fee`, `rent`, `unidentified` | movement, supporting | Real movements, listed under the trade, never offered first |
| `spent` + `received` by one actor (`SWAP`, `UNSTAKE`, `LENDING` withdraw/borrow, `LIQUIDITY` remove) | conversion on the actor | The asset changed; nobody else received it as a counterparty |
| `spent` with no `received` (`STAKE`, `LENDING` deposit, `LIQUIDITY` add) | boundary `protocol_position` | Value went into a position, not to a wallet |
| `BRIDGE` with `bridge.direction = OUT` | boundary `bridged_out` (with `remoteAddress`, `destinationChain`) | Continues off Solana; not traced |
| `BRIDGE` IN | movement into the recipient, `from` shown as `bridged_in` source | Arrival is observed; origin is off-chain |
| `BURN` | boundary `left_supply` | Left supply |
| `FAILED` | boundary `failed` on the fee payer, if seeded or reached; no movements | Nothing moved but the fee |
| Flow with `from` or `to` null (not `spent`/`received`) | boundary `ambiguous` on the known side, with the ref | Pairing unknown (open issue 4.2) |
| `settlement` flows | excluded `settlement` | Routing and closures; reconciliation only |
| Amount `0` | excluded `zero` | — |
| Network fee | never classified | Not a flow; shown in inspectors only |
| `APPROVAL`, `ACCOUNT`, `PROGRAM_INTERACTION` with no non-settlement flows | nothing | No value moved; visible in Timeline |

Supporting movements keep a strict separation: they can be added deliberately, but the UI never presents them as where "the money went".

### Index

```ts
export type MovementIndex = {
  /** Per address: movements it sent / received, chronological by `compareTransactions` order. */
  outgoing: ReadonlyMap<string, readonly IndexedMovement[]>;
  incoming: ReadonlyMap<string, readonly IndexedMovement[]>;
  conversions: ReadonlyMap<string, readonly Extract<Classified, { kind: "conversion" }>[]>;
  boundaries: ReadonlyMap<string, readonly Extract<Classified, { kind: "boundary" }>[]>;
  /** All movements of one signature, for grouping under one transaction. */
  bySignature: ReadonlyMap<string, readonly IndexedMovement[]>;
};
export type IndexedMovement = { ref: MovementRef; weight: "primary" | "supporting"; order: number };

export function buildMovementIndex(events: Iterable<SemanticEvent>, orderOf: (signature: string) => number): MovementIndex;
```

- `orderOf` comes from sorting the loaded canonical transactions once with `compareTransactions`. It gives a total order even within one second.
- Built in `CaseWorkspace` with `useMemo` on `semanticEvents` **only while the trace view is open** (same pattern as `graph`, which is `null` unless `view === "graph"`).

### Candidates

```ts
export type CandidateQuery = {
  node: string;                                   // address
  direction: "forward" | "backward";
  after?: number; before?: number;                // order bounds: forward → after the arrival into the node; backward → before departure
  scope: TraceScope;
  exclude: ReadonlySet<MovementKey>;              // already in the trace
  includeSupporting: boolean;
  hiddenReason: (signature: string) => "manual" | "rule" | null;
};

export type CandidatePage = {
  items: { ref: MovementRef; weight: "primary" | "supporting"; hidden: "manual" | "rule" | null; groupSize: number }[];
  total: number;                                   // matching, before paging
  completeness: "complete" | "partial_history" | "outside_range";
  nextCursor: number | null;
};

export function candidates(index: MovementIndex, q: CandidateQuery, page: { cursor?: number; limit: number }): CandidatePage;
```

- **Forward from a node reached by a step:** `after` = the earliest order of the steps arriving at it. Earlier outgoing movements are available behind an explicit "include earlier" toggle (06), because "earlier" can't be a continuation.
- **From the seed:** bounded by the scope's time range only.
- `completeness` is `partial_history` when the node is OBSERVED (only movements touching mapped wallets are known), and `outside_range` when the scope extends beyond the node's loaded range. The UI always shows it.
- `groupSize` is how many candidate movements share the signature, so the list can group legs of one transaction (one signature = one group).
- Paging is a slice of the pre-sorted per-address array after filtering. With `limit = 50`, filtering is a linear scan of that address's list (bounded by the 5,000-signatures-per-address ingestion cap).

## Prerequisites and Dependencies

02 (`MovementRef`, `keyedFlows`, `BoundaryKind`, `TraceScope`).

## Affected Modules and Proposed Files

- **Proposed new:** `src/lib/trace/movements.ts`, `src/lib/trace/movements.test.ts`
- **Existing, read only:** `src/lib/semantic/{events,flows,interpret,testing}.ts`, `src/lib/state/reconstruct.ts` (`compareTransactions`), `src/lib/ingest/ingest.ts` (coverage types)

## Implementation Plan

### Task Group A — Classification

- [ ] Implement `classifyEvent` per the table, using `keyedFlows` for refs
- [ ] Pair conversions: group `spent` and `received` flows by actor (the address on the non-null side); an actor with both → conversion; only spent → boundary per category
- [ ] Bridge OUT/IN from `event.bridge`
- [ ] Unit-test each row with `makeTx` or a fixture

### Task Group B — Index and candidates

- [ ] `buildMovementIndex` with chronological arrays and `bySignature`
- [ ] `candidates` with scope, order bounds, exclusions, supporting toggle, hidden marking, completeness, paging
- [ ] Deterministic sort: order, then movement key

### Task Group C — Fixture tests for representative flows

- [ ] F1 `basic/sol-transfer.json`: one primary movement, correct direction and amount
- [ ] F3 `nft-sale/transaction.json` and `magic-eden-sale/`: payment and nft primary; royalty and fee supporting; one signature group; `reconciles()` still true for the event
- [ ] F4 `defi/jupiter-multi-hop.json`: one conversion on the trader; no pool appears as a movement endpoint
- [ ] F7 synthetic: OBSERVED node → `partial_history`; failed fixture → boundary `failed`
- [ ] CCTP burn fixture → `bridged_out` with destination chain
- [ ] Kamino deposit → `protocol_position`

## UI Behavior and Example Scenarios

None visible. Example query: forward from B after the step A→B at order 1,204, scope USDC, returns B's USDC outgoing movements at order > 1,204, 50 per page, `completeness: complete` if B is mapped.

## Evidence / Data Integrity Invariants

- Every candidate is a real `SemanticFlow` of a loaded event; nothing is synthesised.
- Settlement and fee never appear as movements.
- One signature's legs are always grouped (`bySignature`, `groupSize`).
- The index never reads presentation or preferences.

## Edge Cases and Failure Recovery

| Case | Behaviour |
|---|---|
| Transaction with no block time | Ordered by slot; `time: null`; time filters treat it as unknown and include it with a marker |
| Same wallet on both sides after owner resolution | Can't come from net-per-owner flows; skip defensively |
| Interpreter threw (event warnings) | Uses the generic reading the pipeline already falls back to; warnings shown in 09 |
| Drift withdrawal misread as Burn (open issue 1.1) | Shows `left_supply`; inspector shows confidence and warnings; documented limitation |
| A pool not in the registry looks like a wallet | It appears as a counterparty; the user can label it; documented limitation (5.1) |
| Wallet with 5,000 outgoing movements | Paging; no full render; query under budget |

## Performance Considerations

- Index build: one pass over events (≈ flows per event × events). Target **< 150 ms for the 10-wallet / 5,000-transaction scenario**, measured in a test modelled on `performance.test.ts` (assert a generous budget, record the actual number here).
- Candidate page: **< 5 ms** for an address with 5,000 movements.

## Tests and Fixtures to Add

- `src/lib/trace/movements.test.ts` covering Task Group C and every classification row.
- No new fixture files unless a row has no existing one. In that case use `makeTx` synthetics and label them synthetic in the test name. Capturing real ones uses `scripts/capture-fixture.ts`.

## Acceptance Criteria (observable and measurable)

- [ ] Every classification row has a passing test.
- [ ] Index and candidate budgets met (numbers recorded).
- [ ] `pnpm test`, `pnpm typecheck`, `pnpm lint` clean.

## Definition of Done

- [ ] Module and tests merged; results recorded; no UI or storage change.

## Known Risks / Open Decisions

- **Bridge IN origin**: shown as an off-chain source node labelled with the source chain. Confirm wording in 05.
- Whether supporting movements should be addable at all in MVP. Recommended yes, behind "Show fees, royalties and rent".

## Handoff Notes for the Next Sprint

04 persists steps made of these refs; 05 draws `buildTraceView` output; 06 calls `candidates`.

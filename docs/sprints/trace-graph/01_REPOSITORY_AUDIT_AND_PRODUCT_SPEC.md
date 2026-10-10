# Sprint 01 — Repository Audit and Product Specification

**Status:** Planned. The audit below was done while writing the plan (2026-10-08, `04f121b`). The sprint's remaining work is review and sign-off of the decisions, with no code.

## Summary and Why It Matters

Every later sprint builds on facts about how FraudWatch stores transactions, reads movements and draws graphs. Getting those wrong produces a trace that looks authoritative and isn't. This sprint fixes the facts, the MVP boundary, the vocabulary and the decisions before any code exists.

## Verified Current Repository Findings

### Existing capabilities

| Area | Finding | Path |
|---|---|---|
| Framework | Next.js 16.3 App Router, React 19.2, TypeScript, Tailwind v4, shadcn/Base UI (`src/components/ui/`: alert, badge, button, card, checkbox, dialog, field, input, label, sonner, textarea). No menu, popover, tabs or select component. | `package.json`, `AGENTS.md` |
| Routing | Case workspace `/case/<id>/<view>[/<wallet>]`, `CaseView = "timeline" \| "graph" \| "table"`. `isCaseRoute` rejects unknown views. The workspace is hosted by the case **layout**, so switching views keeps state. | `src/lib/routing/case-path.ts`, `src/app/case/layout.tsx`, `src/app/case/case-shell.tsx` (`CaseShell` comment) |
| State | No store. `CaseWorkspace` in `case-shell.tsx` (~1,500 lines) owns workspace state and memoised derivations: `semanticEvents`, `summariesByWallet`, `filterables`, `reasons` (hiding), `perWallet`, `lanes`, `graph`, `names`, `observations`. | `src/app/case/case-shell.tsx` |
| Persistence | Dexie v4: `cases`, `rpc_settings`, `transactions`, `raw_transactions`, `wallet_transactions`, `coverage`, `ingestion_jobs`, `meta`, `wallet_states`, `token_metadata`, `address_labels`. Reactive reads with `useLocalQuery`. `deleteCase` removes the case, its labels and its last-load record. | `src/lib/db/db.ts`, `src/lib/db/cases.ts`, `src/hooks/use-local-db.ts` |
| Canonical transaction | One record per `solana:<signature>`: slot, time, success, fee, accounts, native and token balance changes (pre/post/delta, token `owner`), outer and inner instructions. Raw response in `raw_transactions`. | `src/lib/solana/canonical.ts` |
| Movements | `deltas()` nets balances by **owner** (token accounts resolved to `owner`; the payer's fee added back; token-account rent excluded). `balanceFlows()` pairs senders and receivers per asset exactly when one side is single, **otherwise leaves the other side `null`**. `withSettlement()` adds settlement flows so flows reconcile with balances. | `src/lib/semantic/flows.ts` |
| Semantic event | `SemanticEvent` per transaction (`id = solana:<sig>:event:0`): category, action, participants, infrastructure, `flows: SemanticFlow[]` (`assetId`, `amount` base units, `from`, `to`, `source: balance \| compressed_nft`, `role?`), protocol, service, confidence, evidence, warnings, NFT/bridge/stake detail, fee payer and fee. **Computed on open, never stored.** | `src/lib/semantic/events.ts`, `interpret.ts`, `docs/ARCHITECTURE.md` |
| Flow roles | `spent`/`received` (the other side is `null` for swaps, stakes, lending, bridges), `payment`, `royalty`, `marketplace_fee`, `rent`, `unidentified`, `nft`, `settlement`. | `FlowRole` |
| Failed transactions | The `failed` interpreter reads them as `FAILED`; only the fee moved. | `src/lib/semantic/interpreters.ts:16` |
| Projection | `projectEvent(event, wallet)` gives a wallet's outgoing and incoming flows. | `src/lib/semantic/projection.ts` |
| Registry | `RegistryEntry { address, protocolId, protocolName, category, role }`, roles `program, pool, vault, authority, fee_account, market, wallet`; categories include `exchange`. | `src/lib/protocols/registry.ts`, `protocols/` |
| Address states | PRIMARY, MAPPED (history loaded), OBSERVED (seen only through mapped wallets' transactions), INFRASTRUCTURE (non-wallet registry roles and any invoked program). | `src/lib/case/address-state.ts`, `docs/TERMINOLOGY.md` |
| Loading | `useIngestion(c).start(rpcUrl, case)` loads **all mapped wallets** for their ranges, reusing cached coverage; aborts on unmount. Mapping a wallet is explicit (`mapWallet` with `rangeMode` `case \| first_interaction \| custom`) and then reloads. Caps: 5,000 signatures and 25 pages per address. | `src/hooks/use-ingestion.ts`, `src/lib/ingest/ingest.ts`, `src/lib/case/wallet-range.ts` |
| Entity folding | Graph entity nodes (`entity:<protocolId>`) stand for every registry address of a protocol; each movement keeps `via` (the real address). Clusters: known, infrastructure, decoy, unknown, one_off. | `src/lib/graph/build.ts` |
| Names | `createNames`: user label > registry > community > .sol > short address; look-alikes disambiguated. Labels never affect interpretation. | `src/lib/labels/labels.ts` |
| Renderers | Graph: Canvas 2D + d3-zoom/d3-selection, deterministic layout (`layoutGraph`), node dragging in a ref, hover cards, arrowheads, semantic zoom tiers. Timeline: Canvas 2D, d3-scale/d3-time. Shared: `readPalette`, `sizeCanvas`, `horizontalZoom` (`src/app/case/canvas.ts`), `graphWheelAction` (`src/lib/gestures.ts`). No graph library besides d3 modules. | `src/app/case/graph/wallet-graph.tsx`, `src/lib/graph/layout.ts`, `src/app/case/timeline/timeline-canvas.tsx` |
| Inspectors | `EventSummary`, `EventEvidence` (`event-details.tsx`); `TransactionDetails` (lane-scoped); `EdgePanel`; `AddressPanel`; `explainEvent` (facts vs attribution vs heuristics). | `src/app/case/timeline/`, `src/app/case/graph/edge-panel.tsx`, `src/app/case/address-panel.tsx`, `src/lib/semantic/explain.ts` |
| Cross-view links | Graph → Timeline: `goToTransaction` → `WalletTimelineHandle.jumpTo(signature, wallet)`. Timeline → Graph: `onShowInGraph` sets `TxFilter.relationship` and routes to graph. | `case-shell.tsx` |
| Hiding | Case-level `hiddenSignatures`, `shownSignatures`, `hideRules`, evaluated by `hiddenReasons`. | `src/lib/case/hiding.ts` |
| Tests | Vitest, node environment, `src/**/*.test.ts` only; fixtures in `fixtures/solana/{basic,cnft,defi,magic-eden-core,magic-eden-sale,nft-sale}`; helpers `makeTx`, `token`, `ix`, `read`, `reconciles` (`src/lib/semantic/testing.ts`); timing budgets in `src/lib/semantic/performance.test.ts` (1/5/10 wallets, 1k/2k/5k transactions). No DOM tests, no fake IndexedDB (DB tests stub tables). | `vitest.config.mts` |
| Chains | Solana only. `BridgeEnvelope` keeps identifiers for the remote side but nothing is fetched off-chain. | `events.ts` |

### Gaps and limitations

- No Trace Graph code, route, store, branch or doc (all branches checked).
- An OBSERVED address's own history isn't loaded. Its outgoing movements are known only where they touch mapped wallets.
- No context-transaction loading outside the case range (`docs/TERMINOLOGY.md` defines it; MVP Sprint 10 plans it; not built).
- Flows have no stable identity of their own. Their index in `event.flows` can change when an interpreter or `SEMANTIC_VERSION` (now 9) changes.
- No case export/import, no image export, no undo infrastructure.
- Graph node drags reset whenever its layout recomputes (`wallet-graph.tsx` layout effect). That's a known pattern to avoid in the trace canvas.
- `docs/CHRONOLOGY_OPEN_ISSUES.md` items that matter for tracing: 1.1 (Drift withdrawals misread as Burn), 4.2 (several senders and receivers stay unpaired, by design), 4.3 (settlement pairings approximate), 5.1 (registry has few pools, vaults and authorities, so some infrastructure looks like wallets).

### Assumptions requiring confirmation (none blocking)

- That investigators accept mapping a wallet (adding a lane) as the way to continue a trace past it in MVP (D1).
- That a trace's seed is always inside an open case (no case-less trace).

## Objectives and User Outcomes

- An approved MVP boundary, terminology and decision log that Sprints 02–13 can rely on without re-auditing.

## In Scope

Audit (above), product definition, MVP user stories, representative flows, terminology, ADRs, risks.

## Explicitly Out of Scope

Code, dependencies, UI prototypes.

## Architecture / Data Contracts / UX Decisions

### Terminology (add to `docs/TERMINOLOGY.md` in Sprint 02)

- **Trace:** a named, saved, investigator-built set of steps within one case.
- **Seed:** where a trace starts: an address, a transaction, or one movement.
- **Direction:** forward (where value went), backward (where it came from), or both (forward and backward from the seed, drawn on opposite sides).
- **Movement:** one `SemanticFlow` of one event, with both ends known. Identified by a movement key (Sprint 02).
- **Step:** a movement the investigator added, linking two trace nodes.
- **Conversion:** a swap-like event on one address (spent one asset, received another). It changes the asset under the trace without a counterparty edge.
- **Boundary:** a reason a path stops: history not loaded, outside the case range, custodial service, ambiguous pairing, failed transaction, burn, bridge out, end of loaded history.
- **Candidate:** a movement that could be added next from a selected node, given direction and scope.
- **Continuation:** a later movement out of an address that received an earlier one. **It means "then", not "the same funds".**

### MVP user stories

1. From a mapped wallet's address panel, start a forward trace limited to one asset and a date range, and see the wallet as the only node.
2. Open the candidate list for a node and add one or more outgoing movements, each becoming an edge to its recipient.
3. From a Timeline event, start a trace seeded with that transaction's movements, and pick which ones to include.
4. From a node that is OBSERVED, see "History not loaded" and map it (existing dialog) to continue.
5. Click any step and see its transaction, movement, time, asset, amount, real addresses, interpretation confidence and evidence.
6. Save, rename, reopen and delete traces in a case; reopening needs no RPC.

### Representative flows (each becomes a fixture-backed test somewhere in 03–08)

| # | Flow | Expected behaviour | Sprint |
|---|---|---|---|
| F1 | Wallet → wallet SOL transfer | One edge, amount, time; target OBSERVED shows a "history not loaded" boundary | 03, 06 |
| F2 | Wallet with thousands of outgoing transfers | Paginated, filterable candidate list; nothing drawn until chosen | 03, 06, 10 |
| F3 | NFT purchase (payment, royalty, marketplace fee, NFT leg in one signature) | Candidates grouped under one transaction; the payment leg to the seller is the default tracer; royalty and fee legs are addable separately; one signature in the inspector | 03 |
| F4 | Swap with intermediary pools | A conversion on the trader's node (USDC → SOL); pools and settlement legs aren't counterparties; the trace continues from the trader in the new asset | 03, 07 |
| F5 | Exchange deposit, service collapsed then expanded | The exchange node shows a custody boundary; expanding shows the real deposit address (`via`); no continuation candidates out of the exchange | 07 |
| F6 | A → B → C → A return | A gets a return edge; no infinite expansion; totals not double-counted | 08 |
| F7 | Trace hits missing data | "Outside case range", "history not loaded", "ambiguous pairing" boundaries, each with its fix, if any | 03, 06 |
| F8 | Primary and secondary mapped wallets trading back and forth | Repeated movements between the same pair become one bundled edge with a count; each signature is listable | 05, 08 |

### Architecture decision records

| ADR | Decision | Alternatives | Why |
|---|---|---|---|
| 1 | Steps reference `SemanticFlow`s by a content key, re-resolved on open | Store flow index; store a copy of the movement | Indexes shift with interpreter changes. Copies would duplicate evidence and go stale silently. |
| 2 | **D1** MVP continues past an OBSERVED address only by mapping it | Trace-scoped loading without a lane | Reuses tested ingestion and the "explicit map" rule. Trace-only loading is a new loading mode with its own coverage semantics, so it's post-MVP. **Decision Required** sign-off. |
| 3 | **D2** One node per address per trace | One node per occurrence | Keeps address identity unique, as in the Graph; cycles become return edges. |
| 4 | **D3** Traces in a new Dexie table, indexed by `caseId` | On `FraudWatchCase` | Several traces per case, hundreds of steps, edited independently of case writes (whole-record `put` races). |
| 5 | **D6** Dedicated canvas component reusing helpers | Reuse `WalletGraph`; adopt a graph library (React Flow, Cytoscape) | `WalletGraph`'s layout, clusters and hover model are network-specific. A library adds a dependency and a second rendering model when Canvas + d3-zoom already work. |
| 6 | Continuations are chronological, never lineage | FIFO/proportional attribution | No defensible method yet; account-model balances don't carry coin identity. |
| 7 | **D5** Hidden-by-rule transactions are shown as candidates, marked | Excluded | Hide rules declutter the main views; removing evidence from a trace silently would be worse. |

### Success measures (measured in 13)

- An investigator builds F1 and F3 traces without leaving the Trace view, apart from mapping.
- Zero trace actions issue RPC requests except an explicit Map wallet.
- Every exported step carries its signature and movement key.

## Prerequisites and Dependencies

None.

## Affected Modules and Proposed Files

None (documentation).

## Implementation Plan

### Task Group A — Review

- [ ] Reviewer confirms or changes D1–D7 in `00_README.md` §9; record the outcome there
- [ ] Reviewer confirms the MVP stories and post-MVP list

### Task Group B — Hand-off

- [ ] If any decision changes, update the affected sprint files before Sprint 02 starts

## UI Behavior and Example Scenarios

See the representative flows above.

## Evidence / Data Integrity Invariants

The six principles in `00_README.md` §3 are the invariants every sprint tests.

## Edge Cases and Failure Recovery

Recorded per sprint.

## Performance Considerations

Baseline: `performance.test.ts` budgets (10 wallets / 5,000 transactions in < 10 s for the whole open pipeline) are the reference scale.

## Tests and Fixtures to Add

None this sprint. Fixture needs are listed in 03.

## Acceptance Criteria (observable and measurable)

- [ ] Every row of the capability table cites a path that exists at the audited commit.
- [ ] Decisions D1–D7 have a recorded outcome.

## Definition of Done

- [ ] Decisions signed off; affected sprint files updated; no code changed.

## Known Risks / Open Decisions

D1 (continuation past unloaded addresses) is the decision with the most product impact. If trace-only loading is chosen for MVP, add a sprint between 03 and 06 for it.

## Handoff Notes for the Next Sprint

Sprint 02 starts from ADRs 1, 3 and 6. The terminology list above goes into `docs/TERMINOLOGY.md` there.

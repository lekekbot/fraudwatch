# Trace Graph — Initiative Index

**Planning status:** Sprint documents written 2026-10-08; revised 2026-10-10 for a draw.io-style canvas (§1a). **Implementation status:** see §5.
**Audited against:** `timeline-pill-clearance` at `04f121b`. Baseline: `pnpm test` 14 files / 142 tests pass; `pnpm typecheck` clean.

## 1. What the Trace Graph is

FraudWatch answers "what happened?" with the **Timeline** and "who was involved?" with the **Interaction Graph**. The Trace Graph answers a third question: **"where did value go, step by step, according to the evidence?"**

A trace is an investigator-built, saved, left-to-right path of **observed asset movements**, starting from a seed (a wallet, a transaction, or one movement inside a transaction). Nothing is added without the investigator choosing it. Every step points to the semantic event and canonical transaction it came from, and every limit (history not loaded, outside the case range, custodial service, ambiguous pairing) is shown as an explicit boundary, never as "no further transfers".

| | Interaction Graph | Timeline | Trace Graph |
|---|---|---|---|
| Question | Who was involved? | What happened, when? | Where did value go? |
| Unit | Relationship (pair of addresses) | Event per wallet lane | Observed movement (one flow of one event) |
| Content | Everything the filters allow, ranked | Everything the filters allow, in order | Only what the investigator added |
| Layout | Deterministic rings around wallets | x = time, y = wallet lane | Free placement by the investigator; new nodes auto-placed beside their source; time shown on edges |
| Stored | Nothing (recomputed) | Nothing (recomputed) | The trace: steps, positions, styles and annotations (case workspace data) |

### 1a. Direction: an investigator's canvas, like draw.io (decided 2026-10-10)

The Trace Graph is a **user-customisable diagram**, closer to draw.io than to an automatic graph:

- **Free placement.** Every node, note and shape stays exactly where the investigator puts it. New nodes are auto-placed in a sensible spot (beside the node they came from, to the right for forward and to the left for backward); after that only the investigator moves them. **Tidy layout** rearranges evidence nodes on request, and is undoable.
- **Evidence plus annotations.** Two kinds of content share the canvas and never mix:
  - **Evidence:** nodes (addresses) and edges (observed movements) that can only come from loaded transactions, through the candidate list. They can be moved, coloured and given a display note, but not drawn by hand.
  - **Annotations:** text notes, shapes (rectangles, ellipses, group frames) and **user connectors**. Anything can be drawn. They're always styled as annotations (connectors are dashed, carry a label, and never use evidence colours or arrowheads), they're listed separately in inspectors and exports, and they never become steps.
- **Styling:** colour and size of evidence nodes, colour/fill/stroke/font of annotations, grid and snap.

This replaces the column-by-hop layout with pins in the original plan. Hop depth is still computed (for auto-placement, return edges and branches) but no longer fixes x.

It **reads** the existing semantic model (`SemanticEvent.flows`). It never changes ingestion, interpretation, the Interaction Graph or the Timeline, apart from the navigation hooks added in Sprint 09.

**Roadmap link:** this is the first, conservative slice of `ROADMAP.md` §1 "Investigation graph". Suggested continuations, branches-as-alternatives, snapshots and heuristics remain post-MVP.

## 2. Existing, adaptable, missing

| Capability | Status | Where |
|---|---|---|
| Canonical transactions, one per signature | Existing | `src/lib/solana/canonical.ts`, `transactions` table |
| Movements with owner-level `from`/`to`, ambiguity kept as `null` | Existing | `SemanticFlow`, `src/lib/semantic/flows.ts` (`balanceFlows`, `withSettlement`) |
| Flow roles (payment, royalty, spent/received, settlement…) | Existing | `FlowRole` in `src/lib/semantic/events.ts` |
| Event identity `solana:<sig>:event:<i>` | Existing | `eventId` |
| Evidence references and explanations | Existing | `EvidenceRef`, `src/lib/semantic/explain.ts` |
| Protocol registry, roles, categories (exchange) | Existing | `src/lib/protocols/registry.ts`, `protocols/` |
| Entity folding keeping the real address (`via`) | Adaptable | `src/lib/graph/build.ts` |
| Address names and precedence (label > registry > community > .sol) | Existing | `createNames`, `src/lib/labels/labels.ts` |
| Canvas + d3-zoom renderer, palette from CSS | Adaptable (patterns, not the component) | `src/app/case/graph/wallet-graph.tsx`, `src/app/case/canvas.ts`, `src/lib/gestures.ts` |
| Event inspector and evidence UI | Adaptable | `src/app/case/timeline/event-details.tsx` (`EventSummary`, `EventEvidence`), `transaction-details.tsx` |
| Timeline jump to transaction | Existing | `WalletTimelineHandle.jumpTo` |
| Graph narrowed to signatures | Existing | `TxFilter.relationship`, `case-shell.tsx` `onShowInGraph` |
| History for an observed address | **Missing by design**: only PRIMARY and MAPPED wallets are loaded (`docs/TERMINOLOGY.md`) | "Map wallet" (`mapWallet`, `useIngestion.start`) |
| Context transactions outside the case range | Missing (planned in MVP Sprint 10, not built) | — |
| Trace storage, layout, UI | Partly implemented on `trace-graph`: Dexie v7 storage, placement, evidence canvas and read-only list; trace creation and candidate UI remain planned | `src/lib/db/traces.ts`, `src/lib/trace/layout.ts`, `src/app/case/trace/` |
| Case export/import | Missing | MVP Sprint 10 |
| Global Preferences | Planned separately (`docs/sprints/global-preferences/`) | optional Sprint 12 here |

## 3. Core evidence principles

1. **One signature is one transaction.** A trace may show several movements of one transaction; they're grouped under that transaction in every inspector and export.
2. **A step is an observed movement**, i.e. a `SemanticFlow` with both ends known, or a boundary saying which end is unknown.
3. **Adjacency is not lineage.** "B received 12 SOL, then sent 8 SOL to C" is two observed movements in time order, not "8 of those 12 SOL went to C". The UI and exports say "then", never "of which". Coin-level attribution is post-MVP and would need a documented method.
4. **Unknown stays unknown.** Missing history, out-of-range activity, custodial services, ambiguous pairings and failed transactions are explicit boundaries.
5. **Presentation never changes evidence.** Collapsing a service, hiding a branch, moving or styling a node, or deleting a trace changes only the trace record.
6. **No automatic expansion.** Every step is chosen. Large candidate lists are paginated, and multi-step actions confirm.
7. **Annotations are never evidence.** A user connector between two addresses is the investigator's claim, drawn and exported as one; it is never counted in totals, branches, candidates or "observed movements".

## 4. Dependency diagram

```text
01 Audit & Product Spec
 └─► 02 Domain Model & Provenance
      └─► 03 Movement Semantics (candidate index)
           ├─► 04 Workspace & Persistence
           └─► 05 Canvas & Free Placement  (needs 02 view model; 04 for saved positions)
                ├─► 05A Annotations & Styling
                └─► 06 Guided Trace Building   ◄── MVP checkpoint (with 05A)
                     ├─► 07 Service / Entity Integration
                     ├─► 08 Branches / Cycles / Operations
                     └─► 09 Inspector & Cross-View Navigation   ◄── Beta checkpoint (07–09)
                          └─► 10 Large-Case Performance
                               └─► 11 Export & Reproducibility
                                    └─► 13 Validation & Release   ◄── Release

12 Optional Global Preferences add-on: after 06 AND the Global Preferences system exist. Blocks nothing.
```

04 and 05 can run in parallel after 03 if 05 stubs position persistence. 05A and 06 can run in either order after 05. 07, 08 and 09 can run in any order after 06.

## 5. Sprint tracking

| Sprint | Title | Priority | Phase | Dependencies | Status |
|---|---|---|---|---|---|
| 01 | [Repository Audit & Product Spec](01_REPOSITORY_AUDIT_AND_PRODUCT_SPEC.md) | Critical | Foundation | — | Done (decisions recorded 2026-10-10) |
| 02 | [Trace Domain Model & Provenance](02_TRACE_DOMAIN_MODEL_AND_PROVENANCE.md) | Critical | Foundation | 01 | Implemented on `trace-graph`, awaiting review |
| 03 | [Transaction & Movement Semantics](03_TRANSACTION_MOVEMENT_SEMANTICS.md) | Critical | Foundation | 02 | Implemented on `trace-graph`, awaiting review |
| 04 | [Trace Workspace & Persistence](04_TRACE_WORKSPACE_AND_PERSISTENCE.md) | Critical | MVP | 02, 03 | Planned |
| 05 | [Canvas & Free Placement](05_CANVAS_DIRECTIONAL_LAYOUT.md) | Critical | MVP | 02, 03 (04 for saved positions) | Planned |
| 05A | [Annotations & Styling](05A_ANNOTATIONS_AND_STYLING.md) | Critical | MVP | 04, 05 | Planned |
| 06 | [Guided Trace Building](06_GUIDED_TRACE_BUILDING.md) | Critical | MVP | 03, 04, 05 | Planned |
| 07 | [Service, Protocol & Entity Integration](07_SERVICE_PROTOCOL_ENTITY_INTEGRATION.md) | High | Beta | 06 | Planned |
| 08 | [Branches, Cycles & Trace Operations](08_BRANCHES_CYCLES_AND_TRACE_OPERATIONS.md) | High | Beta | 06 | Planned |
| 09 | [Inspector & Cross-View Navigation](09_INSPECTOR_AND_CROSS_VIEW_NAVIGATION.md) | High | Beta | 06 | Planned |
| 10 | [Large-Case Performance](10_LARGE_CASE_PERFORMANCE.md) | High | Release | 06–09 | Planned |
| 11 | [Export & Reproducibility](11_EXPORT_AND_REPRODUCIBILITY.md) | Medium | Release | 04, 09 | Planned |
| 12 | [Optional Global Preferences Add-On](12_OPTIONAL_GLOBAL_PREFERENCES_ADDON.md) | Optional | Add-on | 06 + Global Preferences 02/03 | Optional / Deferred |
| 13 | [Validation, Accessibility & Release](13_VALIDATION_ACCESSIBILITY_AND_RELEASE.md) | Critical | Release | 01–11 | Planned |

Change a status only when the sprint's code is merged and its Definition of Done has been checked, never because a plan exists.

**Branch progress (2026-10-13, `2fc512a`):** Sprint 04 storage, validation, edit updaters and case deletion cascade are committed and tested; the Storage page count was checked in a clean browser session. Sprint 05 placement, routing and evidence canvas are committed and tested, but live canvas drag and frame rate remain unverified. Their status stays Planned until the code is merged and browser checks are complete. Sprint 05A annotations and Sprint 06 trace creation and candidate selection have not been built.

## 6. Milestones

- **MVP (after 05A and 06):** from a mapped wallet or a transaction, build a forward or backward trace of observed wallet-to-wallet movements; arrange it freely; add notes, shapes and connectors; inspect each step; see boundaries; save, reopen and delete named traces. No service folding (services show as plain addresses with their registry names), no branch operations beyond add/remove step.
- **Beta (after 07–09):** services collapse and expand with real addresses kept; cycles, merges, hide and focus branch; undo/redo; full inspector; open in Timeline and Graph.
- **Release (after 10, 11, 13):** measured performance on large cases, JSON export with disclosures, PNG snapshot, accessibility, documentation of attribution limits.
- **Post-MVP (documented, not scheduled):** coin-level attribution heuristics (FIFO/LIFO/proportional), suggested continuations (roadmap §1), trace-only history loading without mapping a lane, context transactions outside the case range, PDF reports, cross-chain hops, branch snapshots.

## 7. Cross-view boundaries

- The Trace Graph reads `semanticEvents`, `walletStates`, `names`, `registry`, labels and the ingestion result from `CaseWorkspace`. It doesn't feed any of them.
- **Filters and hide rules:** the Trace Graph shows hidden transactions' movements as candidates *marked "hidden in this case"*. A hide rule is a triage decision about the main views, not a statement that a movement didn't happen. Steps already in a trace are never removed by a hide rule.
- Navigation hooks (Sprint 09) open the Timeline at a signature (`jumpTo`) and the Graph narrowed to signatures (`TxFilter.relationship`), the same way those views already link to each other.
- Mapping a wallet from the trace uses the existing confirmation dialog (`map-wallet-dialog.tsx`) and adds its lane to the Timeline and Graph, as mapping always does.

## 8. Global Preferences policy

Global Preferences is a separate initiative (`docs/sprints/global-preferences/`). This initiative **does not** build a preferences store, page, presets or migration system. Sprint 12 optionally reads the existing preferences after both exist. Until then, the Trace Graph uses its own fixed defaults and reads the theme from CSS like every other canvas. The `trace.*` keys proposed in `global-preferences/07_TRACE_GRAPH_INTEGRATION.md` are **provisional**; Sprint 12 replaces them with keys matching the behaviours actually built.

## 9. Key risks and Decisions Required

| # | Item | Recommendation | Sprint |
|---|---|---|---|
| D1 | **Continuing past an unloaded address.** Only mapped wallets have history. | MVP: continue by mapping the wallet (existing explicit action, adds a lane). Post-MVP: trace-scoped loading without a lane. | 01, 06 |
| D2 | **Node identity for an address reached at several depths** | One node per address per trace; depth is its smallest hop count; later arrivals draw as return edges | 02, 05, 08 |
| D3 | **Where traces are stored** | New Dexie table `traces` (index `caseId`), not on the case record (multiple, potentially large, independently edited) | 04 |
| D4 | **Swaps** (spent/received with a null side) | A "conversion" step on the same node: asset changes, no counterparty edge | 03 |
| D5 | **Do hide rules affect candidates?** | Shown, marked "hidden in this case" | 03, 06 |
| D6 | **Renderer** | New `trace-canvas.tsx` on Canvas 2D + d3-zoom, reusing `canvas.ts` and gesture helpers; not a fork of `wallet-graph.tsx` | 05 |
| D7 | **Undo scope** | Session-only stack over trace edits (steps, positions, styles, annotations); the saved trace is the current state | 08 |
| D8 | **What can be drawn besides evidence** | **Decided:** annotations (notes, shapes, frames, user connectors), always styled and stored apart from evidence | 02, 05A |
| D9 | **Layout model** | **Decided:** free placement; auto-place new nodes beside their source; Tidy layout on request | 02, 05 |
| R1 | Semantic reinterpretation (`SEMANTIC_VERSION` bump) changes flows under saved steps | Content-keyed movement refs and re-resolution with a "changed reading" state | 02, 04 |
| R2 | Users read the clean layout as proof of same funds | "then" wording, timestamps on edges, a permanent "Observed movements, not coin-level tracing" note, export disclosures | 05, 11, 13 |
| R5 | A user connector is mistaken for an observed movement (in the app or a screenshot) | Distinct dashed style with no evidence colour, a mandatory-looking label slot, "Annotation" in every inspector and export, PNG legend | 05A, 11 |
| R3 | Exchanges and pools break continuity | Custody boundary; no suggested continuation out of a custodial service | 03, 07 |
| R4 | Very large wallets (thousands of outgoing movements) | Indexed candidates, paginated list, filters by asset, time and amount; no draw until chosen | 03, 06, 10 |

## 10. How to execute a sprint

1. Read this file, `01_…` (findings and decisions), and the sprint's own file. Read `docs/MISTAKES.md` and `AGENTS.md` (Next 16: read `node_modules/next/dist/docs/` before writing Next code).
2. Check the sprint's "Verified Current Repository Findings" still hold. Record any drift in the sprint file before coding.
3. Branch from a base containing every earlier sprint (`git merge-base --is-ancestor <prev-branch> HEAD`).
4. Implement only that sprint's tasks. Don't start the next one.
5. Run `pnpm test`, `pnpm typecheck` and `pnpm lint` (and `pnpm build` in 13). Verify UI in the browser. Record the results in the sprint file.
6. Don't run a formatter (no Prettier config in this repo). Don't commit unless asked.

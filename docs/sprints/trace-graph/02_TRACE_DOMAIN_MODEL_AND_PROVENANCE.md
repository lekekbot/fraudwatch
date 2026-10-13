# Sprint 02 — Trace Domain Model and Provenance

**Status:** Implemented on `trace-graph` (2026-10-10), awaiting review
**Depends on:** 01

## Summary and Why It Matters

A trace is only as trustworthy as the link from each drawn line back to the chain. This sprint defines the types, identities and pure functions that map evidence (canonical transactions → semantic events → flows) to investigator decisions (steps) to pixels (view nodes and edges), so that every edge can always say which movement in which signature it is.

## Verified Current Repository Findings

### Existing capabilities

- `SemanticFlow { assetId, amount, from, to, source, role? }`, amounts as base-unit integer strings (`src/lib/semantic/events.ts`). Token flows name **owners**, not token accounts (`deltas` in `src/lib/semantic/flows.ts`).
- Event identity `solana:<signature>:event:<index>` (`eventId`); every transaction has exactly one event today (index 0, `docs/ARCHITECTURE.md`).
- Transaction identity `solana:<signature>` (`transactionKey`, `src/lib/db/db.ts`).
- `SEMANTIC_VERSION = 9`, `analysisVersions()` and `analysisFingerprint()` (`src/lib/semantic/versions.ts`), plus the registry `version`.
- Amount helpers: `abs` and `formatBaseUnits` (`src/lib/solana/amount.ts`); `formatAssetAmount`, `assetLabel` (`src/app/case/asset-format.ts`).
- Graph `Movement` with `via` for folded entities (`src/lib/graph/build.ts`). This is the precedent for keeping real addresses under presentation folding.

### Gaps and limitations

- Flows have no ID. Their position in `event.flows` depends on interpreter order and can change across `SEMANTIC_VERSION`s.
- There's no `src/lib/trace/` module.

### Assumptions requiring confirmation

- That one event per transaction holds. The model keys movements by signature *and* event index, so multi-event transactions later need no migration.

## Objectives and User Outcomes

- Pure, tested types and functions that later sprints build UI and storage on.
- Any movement can be named by a key that survives reloads and most reinterpretations, and is detected (not silently mismatched) when it doesn't.

## In Scope

- `src/lib/trace/model.ts`: types, movement keys, step and trace types, provenance kinds
- `src/lib/trace/view.ts`: `buildTraceView` (steps + current evidence → nodes, edges, boundaries, issues), without layout
- `src/lib/trace/presentation.ts`: canvas types (positions, node styles, annotations) and pure helpers; no editing UI
- Terminology additions to `docs/TERMINOLOGY.md` (from Sprint 01)
- Unit tests

## Explicitly Out of Scope

- Candidate discovery (03), persistence (04), layout and drawing (05), service folding (07; this sprint only reserves the presentation hook)
- Inferred or heuristic links: **not modelled**. Adding a provenance kind for them needs a new ADR, a documented method and tests.

## Architecture / Data Contracts / UX Decisions

### Movement identity

```ts
/** `solana:<signature>:event:<i>:mv:<assetId>:<from|_>:<to|_>:<amount>:<n>`; `n` counts identical tuples in flow order. */
export type MovementKey = string;

export type MovementRef = {
  key: MovementKey;
  signature: string;
  eventIndex: number;            // 0 today
  assetId: string;
  from: string | null;
  to: string | null;
  amount: string;                // base units, integer string; never a float
  role: FlowRole | null;
  /** ms, or null when the RPC gave no block time. Copied for display while evidence is unavailable. */
  time: number | null;
  /** For ordering: block times are seconds and many transactions share one; order by `compareTransactions` (slot, index, signature). */
  slot: number;
};

export function movementKey(signature: string, eventIndex: number, flow: SemanticFlow, occurrence: number): MovementKey;
/** Every flow of an event with its key, in flow order. */
export function keyedFlows(event: SemanticEvent): { flow: SemanticFlow; ref: MovementRef }[];
```

- The key is built from **content**, not position. A reinterpretation that keeps the same movement keeps the key. One that changes the amount, owner or asset produces a different key, and the old step becomes **stale** (below), never silently re-pointed.
- `role` isn't part of the key: a role refinement (e.g. `unidentified` → `marketplace_fee`) shouldn't orphan a step. The current role is always shown from current evidence.
- `from`/`to` `null` is encoded `_`. Such flows can be candidates only as boundaries (03).

### Trace and steps (stored shape; persistence in 04)

```ts
export type TraceSeed =
  | { kind: "address"; address: string }
  | { kind: "transaction"; signature: string }
  | { kind: "movement"; ref: MovementRef };

export type TraceScope = {
  assets: string[] | null;                      // null = any asset
  start: string | null; end: string | null;     // ISO; null = case range
  minAmount: { assetId: string; amount: string } | null;
  maxHops: number;                              // default 6; hard cap 20
};

export type TraceStep =
  | { id: string; kind: "movement"; ref: MovementRef; direction: "forward" | "backward"; addedAt: string; note?: string }
  | { id: string; kind: "conversion"; signature: string; address: string;
      spent: { assetId: string; amount: string }[]; received: { assetId: string; amount: string }[];
      addedAt: string; note?: string };

export type Trace = {
  id: string; caseId: string; name: string;
  schemaVersion: number;
  seed: TraceSeed;
  direction: "forward" | "backward" | "both";
  scope: TraceScope;
  steps: TraceStep[];
  presentation: TracePresentation;              // positions, styles, annotations (04/05/05A/07/08); never evidence
  analysisAtSave: { semantic: number; registry: number };
  createdAt: string; updatedAt: string;
};
```

A step stores the **reference fields** (enough to show "this step referred to 12 SOL A→B in 5xY…") and nothing else from the transaction. Evidence is always read from the cache.

### Provenance of what is drawn

```ts
export type EdgeProvenance =
  | "observed"      // one step, one movement, both ends known
  | "bundled"       // several steps between the same two nodes, same direction: drawn once, each listed
  | "service";      // one end drawn as a collapsed service; the real address is kept in `via` (07)

export type BoundaryKind =
  | "history_not_loaded"   // OBSERVED address: only movements touching mapped wallets are known
  | "outside_range"        // continuing would need activity outside the case or wallet range
  | "custodial"            // verified exchange or custodial service: no linkable continuation
  | "ambiguous"            // flow with a null side (several senders and several receivers)
  | "failed"               // transaction failed; only the fee moved
  | "left_supply"          // burn
  | "bridged_out"          // BridgeEnvelope OUT: continues on another chain (not traced)
  | "protocol_position"    // value went into a stake, lending or liquidity position: no counterparty wallet to follow
  | "end_of_history";      // loaded history ends and coverage is complete: genuinely nothing further in range
```

`end_of_history` is the **only** boundary allowed to read as "no further movements", and only when the ingestion coverage for that wallet is `complete` (`IngestionCoverage.complete`). Otherwise `history_not_loaded` or `outside_range` applies.

### View model

```ts
export type TraceNode = {
  id: string;                    // the address; for a collapsed service, `entity:<protocolId>` (07)
  addresses: string[];           // real addresses behind it (1 unless a collapsed service)
  isSeed: boolean;
  depth: number;                 // hops from the seed: negative = backward, positive = forward
  boundaries: BoundaryKind[];    // computed from evidence; not stored
};

export type TraceEdge = {
  id: string;                    // `${from}->${to}`, direction-sensitive
  from: string; to: string;
  provenance: EdgeProvenance;
  steps: string[];               // TraceStep ids, chronological
  totals: { assetId: string; amount: string }[];   // per asset, BigInt sums; never mixed across assets
  firstTime: number | null; lastTime: number | null;
  returns: boolean;              // goes to a node at a smaller |depth| (cycle or return; 08)
};

export type TraceIssue =
  | { kind: "stale"; stepId: string; reason: "movement_changed" | "transaction_not_loaded" }
  | { kind: "out_of_scope"; stepId: string };

export function buildTraceView(trace: Trace, evidence: TraceEvidence): { nodes: TraceNode[]; edges: TraceEdge[]; issues: TraceIssue[] };

/** What `buildTraceView` reads; all of it already exists in `CaseWorkspace`. */
export type TraceEvidence = {
  events: ReadonlyMap<string, SemanticEvent>;   // by signature (`semanticEvents`)
  coverage: (address: string) => IngestionCoverage | null;   // null = not mapped
  addressState: (address: string) => AddressState;
  isCustodial: (address: string) => boolean;   // registry category "exchange" (07 widens)
};
```

- Depth is computed (BFS from the seed over steps by direction), never stored. The same address reached at two depths is **one node** at its smallest |depth| (D2). Edges into it from deeper columns are `returns: true`.
- Totals are BigInt sums of the steps' own amounts per asset. They're totals of *added steps*, never a wallet's balance and never "funds traced".
- A stale step stays in the trace and in the view (drawn with a warning), with its stored reference fields, until the investigator removes it.

### Presentation: the investigator's canvas (D8, D9)

Everything the investigator arranges or draws. None of it is evidence, and `buildTraceView` reads none of it except service folding (07).

```ts
export type Point = { x: number; y: number };            // world coordinates

export type TracePresentation = {
  /** Every evidence node that has been placed. A node without an entry is auto-placed (05) and then gets one. */
  positions: Record<string, Point>;
  /** Optional per-node look; absent = theme default. Never changes what the node is. */
  nodeStyles: Record<string, NodeStyle>;
  /** Notes, shapes, frames and user connectors, in draw order (later on top). */
  annotations: Annotation[];
  expandedServices: string[];                             // 07 (collapsed is the default)
  hiddenBranches: string[];                               // node ids whose downstream is hidden; 08
  canvas: { grid: boolean; snap: boolean };               // 05
};

/** A palette key, resolved to a CSS variable at draw time so themes keep working. */
export type ColorKey = "default" | "red" | "orange" | "yellow" | "green" | "teal" | "blue" | "purple" | "pink" | "gray";

export type NodeStyle = { color?: ColorKey; size?: "s" | "m" | "l"; note?: string };

/** Where a user connector ends: an evidence node, another annotation, or a free point. */
export type AnnotationEnd = { kind: "node"; id: string } | { kind: "annotation"; id: string } | { kind: "point"; at: Point };

export type Annotation =
  | { id: string; kind: "note"; at: Point; width: number; text: string; color: ColorKey }
  | { id: string; kind: "shape"; shape: "rect" | "ellipse" | "frame"; at: Point; width: number; height: number;
      label: string; stroke: ColorKey; fill: ColorKey | "none" }
  | { id: string; kind: "connector"; from: AnnotationEnd; to: AnnotationEnd; label: string;
      arrow: "none" | "end" | "both"; color: ColorKey };
```

- **Separate list, separate type.** A connector is never a `TraceEdge`, never in `steps`, never in totals, branches or candidates. Its provenance is "annotation" everywhere it's shown (05A draws it dashed; 09 and 11 label it).
- **Ends survive deletion.** Removing a node or annotation that a connector points at turns that end into a `point` at the item's last position (04's updaters), so the investigator's line is never silently deleted.
- **Pure helpers here** (`src/lib/trace/presentation.ts`): `emptyPresentation()`, `isColorKey`, `resolveEnd(end, positions, annotations)` → `Point | null`, and `detachEnds(presentation, removedIds, lastPositions)`. Editing UI is 05A; storage validation is 04.
- The original plan's `pins` are gone: every placed node has a position, so "pinned" is the only state (D9).

## Prerequisites and Dependencies

01 (ADRs 1, 3, 6).

## Affected Modules and Proposed Files

- **Proposed new:** `src/lib/trace/model.ts`, `src/lib/trace/view.ts`, `src/lib/trace/presentation.ts`, and a test file for each
- **Existing, docs only:** `docs/TERMINOLOGY.md` (Trace section), `docs/ARCHITECTURE.md` (one paragraph: trace reads events, stores steps)

## Implementation Plan

### Task Group A — Model

- [x] Create `model.ts` with the types above
- [x] Implement `movementKey` and `keyedFlows`. The occurrence counter is per identical `(assetId, from, to, amount)` tuple in flow order.
- [x] Add `TRACE_SCHEMA_VERSION = 1`, `MAX_HOPS = 20`, `DEFAULT_MAX_HOPS = 6`

### Task Group B — View

- [x] Implement `buildTraceView`: resolve each movement step via `keyedFlows` of the current event; mark stale when the event is missing (`transaction_not_loaded`) or no flow has the key (`movement_changed`)
- [x] BFS depths from the seed; one node per address; `returns` flag
- [x] Group steps into edges by `(from, to)`; `bundled` when more than one step; BigInt totals per asset
- [x] Conversion steps: no edge; listed on their node (05 draws them as a badge)
- [x] Boundaries per node from `TraceEvidence` (rules above; `end_of_history` only with complete coverage)
- [x] `out_of_scope` issue when a step's asset or time falls outside the current scope (the step stays)

### Task Group B2 — Canvas model

- [x] `presentation.ts`: types above, `emptyPresentation`, `isColorKey`, `resolveEnd`, `detachEnds`
- [x] Tests: an end on a removed node becomes a point at its last position; an end on a missing item with no known position resolves to null (drawn as a dangling end, never dropped)

### Task Group C — Docs

- [x] Terminology and architecture paragraphs

## UI Behavior and Example Scenarios

None visible this sprint.

## Evidence / Data Integrity Invariants

- No function here writes anything; all are pure.
- Amounts are only summed as BigInt within one asset.
- No step is dropped, merged or re-pointed by `buildTraceView`; stale and out-of-scope steps are reported, not removed.
- `buildTraceView` output is identical whatever the presentation holds (apart from 07's service folding): positions, styles and annotations can't change nodes, edges, totals or boundaries (test).
- Two flows with identical content in one event get distinct keys (`:0`, `:1`).

## Edge Cases and Failure Recovery

| Case | Behaviour |
|---|---|
| Event missing (wallet unmapped, cache cleared) | Step `stale: transaction_not_loaded`; reference fields still shown |
| Reinterpretation changed the amount | `stale: movement_changed`; the inspector (09) offers the current movements of that signature to re-add |
| Flow with `from` or `to` null | Never an edge; may appear as an `ambiguous` boundary on the known side |
| Self-transfer (`from === to`) | Not possible from `balanceFlows` (net per owner); guard anyway: ignore with an issue |
| Seed address with no steps | One node, depth 0 |
| Compressed NFT flow (`source: compressed_nft`) | Valid movement; amount "1" |
| `maxHops` lowered below existing depths | Existing steps beyond it are `out_of_scope`, never deleted |

## Performance Considerations

`buildTraceView` is O(steps × flows per event). A trace of 500 steps over 5,000-transaction cases must build in < 20 ms (assert generously in a test, as `performance.test.ts` does).

## Tests and Fixtures to Add

- `model.test.ts`: key stability across two `interpretTransaction` runs of the same fixture; distinct keys for duplicate tuples; null sides encoded; role change doesn't change the key; amount change does.
- `view.test.ts`, with `makeTx` (`src/lib/semantic/testing.ts`):
  - A→B→C forward: depths 0/1/2; two observed edges.
  - Three A→B steps: one bundled edge, totals summed per asset, each step id listed.
  - A→B→A: B at 1, A at 0, edge B→A `returns`.
  - Missing event → stale; changed amount → stale; neither removed.
  - Mixed assets on one edge: totals per asset, no cross-asset sum.
  - Boundary rules: OBSERVED target → `history_not_loaded`; complete coverage → `end_of_history`; exchange → `custodial`.
- 500-step view build under the budget.

## Acceptance Criteria (observable and measurable)

- [x] All tests above pass; `pnpm test`, `pnpm typecheck`, `pnpm lint` clean (results recorded here).
- [x] No production UI or storage change.

## Definition of Done

- [ ] Types and functions merged (written with tests on `trace-graph`; awaiting review)
- [x] Terminology and architecture docs updated; validation recorded.

## Known Risks / Open Decisions

- If multi-event transactions arrive, `eventIndex` already covers them. The seed `transaction` kind then lists every event's flows.
- Content keys can't distinguish two genuinely identical movements across reinterpretations if their order swaps. The impact is cosmetic (both identical), so it's accepted.

## Implementation record (2026-10-10)

**Files:** `src/lib/trace/model.ts`, `view.ts`, `presentation.ts`, `testing.ts` (builders for tests), and `model.test.ts`, `view.test.ts`, `presentation.test.ts`. Docs: `docs/TERMINOLOGY.md` (Trace Graph section), `docs/ARCHITECTURE.md` (Trace Graph model).

**Validation:** `pnpm test` 28 files / 244 tests pass (22 new here); `pnpm typecheck` and `pnpm lint` clean. 500-step `buildTraceView`: median **0.69 ms** (budget 20 ms; Apple M5 Pro, Node 24.10). No production UI or storage change.

**Deviations from the plan above, and why:**

- `TraceNode.depth` is `number | null`: a node no step connects to the seed (after removing a middle step) has no hop count rather than a made-up one.
- `TraceNode.conversions` lists conversion step ids, so 05 can draw the badge without searching steps.
- `TraceIssue` gains `ignored` (`unknown_side`, `self_transfer`) for movement steps that can't be edges; the plan said "ignore with an issue" without a kind.
- `out_of_scope` carries its reason (`asset`, `time`, `amount`, `hops`).
- `BoundaryKind` adds `partial_history` (mapped, but loaded history incomplete: the plan had no honest kind for it), and, from Sprint 03's fixtures, `entered_supply` and `bridged_in`.
- Coverage boundaries (`history_not_loaded`, `partial_history`, `end_of_history`) are set only on frontier nodes, where the trace currently ends in its direction; otherwise every mapped wallet mid-path would read "end of history". `custodial` applies anywhere.
- Event-derived boundaries (failed, burned, bridged, position) aren't set by `buildTraceView`; they come from the movement index (03) and 06 attaches them.
- Seed roots: the address; a seeded movement's sender (receiver if unknown); a seeded transaction's senders among its steps.
- `returns` uses signed depth: value flows from lower to higher depth in both directions (0 → 1 forward, −1 → 0 backward), so an edge is a return when its receiver's depth is lower than its sender's.
- Steps order by slot then key in the view (`compareRefs`); refs don't carry the in-slot transaction index. Exact chronological order lives in 03's index.


## Handoff Notes for the Next Sprint

03 produces `MovementRef`s through `keyedFlows` and decides which flows become candidates, conversions or boundaries.

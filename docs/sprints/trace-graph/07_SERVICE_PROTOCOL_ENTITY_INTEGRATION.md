# Sprint 07 — Service, Protocol, and Entity Integration

**Status:** Planned (implemented on `trace-graph`; merge and live-data browser checks pending)
**Depends on:** 06

## Summary and Why It Matters

Investigators think in "Binance", "Magic Eden", "Jupiter", not in vault and fee-account addresses. The trace should show services as recognisable entities, but **never** at the cost of losing which real account received what, and never by implying that funds continued out of a custodial service just because it later paid someone.

## Verified Current Repository Findings

### Existing capabilities

- Registry entries: `{ address, protocolId, protocolName, category, role, label }`, roles `program, pool, vault, authority, fee_account, market, wallet`, categories in `CATEGORIES` (including `exchange`) (`src/lib/protocols/registry.ts`). Data: `protocols/solana.json`, `protocols/centralized-vaults.json`.
- Graph entity folding: `entityNodeId(protocolId)`, `entityProtocol(id)`; movements keep `via` (the real address) when an end is folded (`src/lib/graph/build.ts` ~322); `expandedEntities` set to show a protocol's addresses separately; `withGraphNames` names entity nodes.
- `addressState` → INFRASTRUCTURE for non-wallet registry roles and invoked programs (`src/lib/case/address-state.ts`).
- Name precedence: user label > registry > community > .sol > short address (`displayName`, `src/lib/labels/labels.ts`). Labels and community names never affect interpretation (`docs/ARCHITECTURE.md`).
- Semantic events carry `protocol`, `service` (verified exchange) and `infrastructure` (`events.ts`).
- Behaviour observations include "exchange deposit (verified exchanges only)" (`src/lib/behavior/observations.ts`).

### Gaps and limitations

- Registry coverage of pools, vaults and authorities is thin (`CHRONOLOGY_OPEN_ISSUES.md` 5.1); exchange coverage depends on `centralized-vaults.json` (5.2).
- No notion of "custodial" beyond category `exchange`.

### Custody decision

- Treat verified registry category `exchange` as custodial for this beta. Bridge deposits need separate evidence before the same rule applies.

## Objectives and User Outcomes

- Service addresses fold into one entity node per protocol, by default, with the real address on every movement.
- One-click expand to individual addresses and back, with no loss of steps, positions or annotations.
- Custodial services stop continuation clearly.
- User labels stay visible and respected.

## In Scope

- Folding in `buildTraceView` (02's reserved hook) using `presentation.expandedServices`
- Custody boundaries in classification and candidates
- Entity node rendering, the "via" display, expand and collapse actions
- Candidate rows naming services

## Explicitly Out of Scope

- Registry changes or new attribution sources
- Folding **user-labelled** addresses (a user label means the investigator cares about that address: it's never folded)
- Inferring exchange ownership of unknown addresses

## Architecture / Data Contracts / UX Decisions

### Folding rule

An address is folded into `entity:<protocolId>` when **all** hold:

1. `registry.lookup(address)` exists, and its protocol isn't in `presentation.expandedServices`;
2. the address has no user label (`names.label(address)` empty);
3. it isn't a mapped wallet (`addressState` not PRIMARY or MAPPED).

This is the same exemption logic as the Graph's `clusterOf` in `case-shell.tsx` (labelled and look-alike addresses keep their own node). Reuse the predicate rather than copying it: extract it to `src/lib/labels/` or `src/lib/graph/` if needed, and leave the Graph's behaviour identical.

- `TraceNode.addresses` lists the real addresses behind the entity that appear in the trace; `TraceEdge.provenance = "service"` and each step keeps its real endpoint. The view model adds `via` per step on edges into or out of an entity.
- Folding is **presentation only**: steps are stored with real addresses, and expanding or collapsing re-runs `buildTraceView` without touching `steps`.
- An entity node's position is stored under the entity id; expanding auto-places the individual addresses next to it (05) and collapsing reuses the entity position. Connectors attached to an entity node stay attached to it while expanded (drawn to the first address).

### Custody

- `isCustodial(address)` = registry category `exchange` (configurable list in `src/lib/trace/movements.ts`, documented).
- Forward candidates **from** a custodial node are not offered. The node shows a "Custodial service" boundary: "Deposits are pooled; later withdrawals can't be linked to this deposit from on-chain data." Backward candidates **into** an exchange node are allowed (deposits are observed).
- An investigator who has off-chain information (e.g. an exchange response) can **start a new trace** from the withdrawal recipient; the two traces aren't linked automatically. A note field on a step (04) holds their reasoning.

### Non-custodial protocols

- DEX pools and routers: already never counterparties for swaps (conversion, 03). If an unregistered pool appears as a plain counterparty, the investigator can label it; no automatic fix.
- NFT marketplaces: fee legs to `fee_account` addresses fold into the marketplace entity, as supporting movements.
- Program-call relationships are never edges (03 excludes them), so folding never puts a program edge over a value edge.

### UI

- Entity node: protocol name, category badge, "N addresses" count; context menu "Show addresses separately" / "Group as <protocol>".
- Hovering an edge into an entity shows "to Binance via 9xQ…c4 (hot wallet)" using the registry `label`.
- Candidate rows show `→ Binance (custodial)` with the real address on hover.
- User-labelled addresses show their label even if registered; the registry name appears as secondary text, as in the address panel today.

## Prerequisites and Dependencies

06.

## Affected Modules and Proposed Files

- **Existing:** `src/lib/trace/view.ts`, `src/lib/trace/movements.ts`, `src/app/case/trace/trace-canvas.tsx`, `candidate-panel.tsx`; possibly a small extraction from `case-shell.tsx`'s `clusterOf` predicate (Graph behaviour must not change)
- **Proposed new:** `src/lib/trace/services.ts` (fold, custody), `src/lib/trace/services.test.ts`

## Implementation Plan

### Task Group A — Model

- [ ] Extract or reuse the "keeps its own node" predicate (labelled, look-alike, mapped); verify Graph output unchanged with an existing graph test
- [x] Folding in `buildTraceView` with `via` per step and `addresses` per node
- [x] Custody check; forward candidates suppressed from custodial nodes; boundary attached

### Task Group B — UI

- [x] Entity node drawing; expand and collapse actions writing `setServiceExpanded`
- [x] Hover and inspector "via" display
- [x] Candidate rows with service names and custodial marker

## UI Behavior and Example Scenarios

- **F5:** A → Binance deposit address. The canvas shows A → **Binance** (custodial boundary). Expand → A → `9xQ…c4 (Binance hot wallet)`. Collapse → back. Steps, positions and annotations unchanged throughout.
- Magic Eden sale with the fee leg added as supporting: the fee edge goes to the **Magic Eden** entity, labelled "marketplace fee", via the fee account.
- A user-labelled Binance address "Suspect's Binance deposit": shown on its own node with that label, never folded.

## Evidence / Data Integrity Invariants

- Folding never changes a step, amount or direction; `via` always equals the stored step's real endpoint.
- No continuation candidates are fabricated across custody.
- Two different protocols never fold into one node.

## Edge Cases and Failure Recovery

- An address registered under one protocol but with role `wallet`: folded like the others (role doesn't matter for folding; it matters for `addressState`).
- A registry update moves an address to another protocol: folding follows current data; steps are unaffected.
- Unknown service (not in the registry): a plain node; the investigator can label it.
- An entity with addresses on both sides of a step (internal service movement): drawn as a self-loop badge "internal movement" on the entity, never as an edge to itself; expand to see it.

## Performance Considerations

Folding is a map over steps (O(steps)). No measurable cost; covered by 02's view budget.

## Tests and Fixtures to Add

- `services.test.ts`: fold and unfold round trip leaves `steps` deep-equal; `via` correct; labelled and mapped addresses never folded; two protocols never merged; custodial node has no forward candidates; backward into exchange allowed; internal movement → self badge, no self edge.
- Fixtures: `magic-eden-sale/` (fee account), a `makeTx` synthetic with a `centralized-vaults.json` address (labelled synthetic).
- Graph regression: the existing `src/lib/graph/build.test.ts` passes unchanged.

## Acceptance Criteria (observable and measurable)

- [ ] F5 behaves as described in the browser (recorded).
- [ ] Every folded edge's inspector shows the real address.
- [ ] Graph tests unchanged and passing.

## Definition of Done

- [ ] Model, UI and tests merged; validation commands pass; browser checks recorded.

## Known Risks / Open Decisions

- Custodial list scope: `exchange` only, or also some bridges and lending pools? Recommended: `exchange` only for beta; revisit with real cases.

## Handoff Notes for the Next Sprint

08 hides and focuses branches; collapsed services count as a single node for branch operations.

## Implementation Record — 2026-10-13

`buildTraceView` folds registry addresses into protocol nodes by default, keeps labelled and mapped addresses separate, records real endpoints in `via`, and lists internal service movements on the node. Expanding displays individual addresses while stored steps and entity positions remain intact; connectors attached to a hidden entity use its first visible address. Candidate rows show registry names and custodial markers. Verified exchange addresses stop forward candidate continuation, while backward deposit candidates remain available. Custody uses `exchange` only for this beta; bridge treatment needs separate evidence.

`services.test.ts` covers folding, expansion, preserved endpoints, separate protocols, mapped and labelled exemptions, internal movements and custody direction. Existing Graph tests pass unchanged. The browser had no loaded transactions or service addresses, so F5, marketplace fee folding and service hover remain to be checked with a suitable case before this sprint is marked done.

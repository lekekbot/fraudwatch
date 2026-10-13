# Sprint 04 — Trace Workspace and Persistence

**Status:** Planned
**Depends on:** 02, 03

## Summary and Why It Matters

A trace is investigative work product. It has to survive reloads, stay inside its case, be safe against corrupted or outdated data, and never be confused with evidence or preferences. This sprint adds the storage layer and the pure updaters that every UI action calls.

## Verified Current Repository Findings

### Existing capabilities

- Dexie database `fraudwatch`, schema v4, versions added in blocks with optional `upgrade` (`src/lib/db/db.ts`). Per-case child data lives in its own table with a `caseId` index (`address_labels: "[caseId+address], caseId"`).
- `deleteCase` deletes the case and its child rows in one transaction (`src/lib/db/cases.ts`).
- `clearTransactionCache` clears chain-derived tables only; `clearAllLocalData` deletes the database (`src/lib/db/storage.ts`). `getStorageSummary` lists table counts on the Storage page.
- Pure updaters returning a new object are the house style (`src/lib/case/hiding.ts`, `bookmarks.ts`, `lanes.ts`).
- Reactive reads: `useLocalQuery` (`src/hooks/use-local-db.ts`).
- DB tests use stub tables (`src/lib/db/rpc-settings.test.ts`, `derived.test.ts`).
- **Global Preferences** (separate initiative, planned) will add Dexie v5 (`preferences`) and v6 (`view_presets`). It isn't built at the audited commit.

### Gaps and limitations

- No undo infrastructure, no autosave helpers beyond direct `put`/`update`.
- No case export, so traces can't travel between browsers yet (Sprint 11 adds trace export).

### Assumptions requiring confirmation

- The Dexie version number: use **the next free version at implementation time** (v5 if Global Preferences hasn't landed, otherwise v7). Never reuse a number.

## Objectives and User Outcomes

- Several named traces per case; create, rename, duplicate, delete.
- Every edit is saved immediately and survives reload; nothing needs an RPC to reopen.
- Corrupted or future-version records never crash the case and are never silently deleted.

## In Scope

- Dexie table `traces`, data access functions, validation and migration
- Pure updaters for every trace edit (add or remove step, scope, direction, rename, presentation changes)
- Case deletion cascade; Storage page count
- A `useTraces(caseId)` hook

## Explicitly Out of Scope

- Undo/redo (08; it sits on top of these updaters)
- UI (06)
- Export/import (11)

## Architecture / Data Contracts / UX Decisions

### Table

```ts
// db.ts, v7 (v5/v6 are Global Preferences')
traces: "id, caseId, updatedAt"
```

Stored record = `Trace` (Sprint 02) as-is. `schemaVersion` is `TRACE_SCHEMA_VERSION`.

### Access (`src/lib/db/traces.ts`)

```ts
export async function listTraces(db: FraudWatchDB, caseId: string): Promise<TraceListItem[]>;   // id, name, steps count, updatedAt, valid
export async function getTrace(db: FraudWatchDB, id: string): Promise<LoadedTrace>;
export async function saveTrace(db: FraudWatchDB, trace: Trace): Promise<void>;          // sets updatedAt
export async function createTrace(db: FraudWatchDB, input: NewTraceInput, deps?: { id?: string; now?: Date }): Promise<Trace>;
export async function deleteTrace(db: FraudWatchDB, id: string): Promise<void>;

export type LoadedTrace =
  | { ok: true; trace: Trace; migratedFrom?: number }
  | { ok: false; id: string; reason: "missing" | "invalid" | "newer_version"; raw?: unknown };
```

### Validation and migration (`src/lib/trace/storage.ts`)

- `parseTrace(raw): LoadedTrace` checks shape: required fields, step kinds, base-unit amount strings (`/^\d+$/`), `maxHops` within 1–20, known direction. Validation is hand-written, matching the repo (no validation library).
- `schemaVersion` lower → run the `migrations` chain (empty at v1), mark `migratedFrom`, write back on the next save.
- `schemaVersion` higher → `newer_version`: listed as "Made by a newer FraudWatch; read-only", not editable, never overwritten.
- Invalid → listed as "Couldn't read this trace" with **Delete** and **Copy raw JSON** (for a bug report). Never auto-deleted.
- **Individual invalid steps** inside an otherwise valid trace: the trace loads; those steps are kept in an `invalidSteps` array and shown as an issue, so the user can remove them.
- **Presentation** is validated separately and never blocks loading: positions with non-finite numbers are dropped (the node is auto-placed again), unknown colour keys fall back to `default`, and annotations with an unknown kind or invalid fields are kept in `invalidAnnotations` and listed for removal. A trace without a `presentation` (or an older shape with `pins`) gets `emptyPresentation()`, with any pins carried over as positions.

### Updaters (`src/lib/trace/edit.ts`), all pure, returning a new `Trace`

```ts
addSteps(t, steps: TraceStep[], now?)        // ignores steps whose movement key is already present (no duplicates)
removeSteps(t, stepIds, now?)                // presentation entries for nodes left without steps are pruned
setScope(t, scope, now?)                     // never removes steps; out-of-scope steps become issues (02)
setDirection(t, direction, now?)
renameTrace(t, name, now?)                   // 1–80 chars trimmed; duplicates allowed
setPositions(t, positions: Record<string, Point>, now?)       // move one or many items (nodes by id); one record per drop
setNodeStyle(t, nodeId, style: NodeStyle | null, now?)
addAnnotation(t, annotation, now?) / updateAnnotation(t, id, patch, now?) / removeAnnotations(t, ids, now?)   // removal detaches connector ends (02 `detachEnds`)
reorderAnnotation(t, id, "front" | "back", now?)
setCanvasOptions(t, { grid?, snap? }, now?)
setServiceExpanded(t, protocolId, expanded, now?)
setBranchHidden(t, nodeId, hidden, now?)
duplicateTrace(t, deps?)                     // new id, "Copy of …"
```

### Save model

- Every edit goes `trace → updater → saveTrace`, immediately, as case edits do today. Writes of one trace are serialised (a promise chain per trace id) so rapid edits keep their order.
- Moves (nodes and annotations) are saved on drag end only, not per pointer move. Annotation positions live on the annotation; node positions in `presentation.positions`.
- Save failure: `toast.error(describeStorageError(err))`; the UI shows the stored state (the live query is authoritative).

### Lifecycle against the rest of the case

| Event | Trace behaviour |
|---|---|
| Case deleted | `deleteCase` also deletes `traces.where("caseId")` in the same transaction |
| Wallet unmapped | Steps stay; affected ones become `stale: transaction_not_loaded` until remapped |
| Transaction cache cleared | Same as above until reloaded; the trace itself is untouched |
| Hide rule added | No effect on steps (D5) |
| Label renamed | Names are resolved live; nothing stored |
| Semantic or registry version changes | `analysisAtSave` differs → the trace header shows "Readings updated since this trace was saved"; changed movements show as stale (02) |
| Case range edited | Steps outside the new range stay as `out_of_scope` issues |

### Separation

- **Evidence:** cache tables. Never written here.
- **Trace workspace:** the `traces` table (steps, scope, seed, presentation).
- **Ephemeral:** selection, hover, live drag, open menus, candidate list scroll, undo stack. React state only.
- **Preferences:** not read or written by this sprint (Sprint 12).

### Hook

`useTraces(caseId)` → `{ list, get(id), create, save, remove }` over `useLocalQuery`. The active trace id lives in the URL (05/06 add the route).

## Prerequisites and Dependencies

02 (types), 03 (refs).

## Affected Modules and Proposed Files

- **Existing:** `src/lib/db/db.ts` (new version block, `traces` property, class comment), `src/lib/db/cases.ts` (`deleteCase` cascade), `src/lib/db/storage.ts` (`getStorageSummary` includes traces; `clearTransactionCache` must **not** clear traces)
- **Proposed new:** `src/lib/db/traces.ts`, `src/lib/db/traces.test.ts`, `src/lib/trace/storage.ts`, `src/lib/trace/edit.ts`, `src/lib/trace/edit.test.ts`, `src/hooks/use-traces.ts`

## Implementation Plan

### Task Group A — Storage

- [ ] Add the version block with `traces: "id, caseId, updatedAt"`; update the comment listing versions
- [ ] `parseTrace` with the four outcomes; migration chain scaffold (empty at v1)
- [ ] `listTraces`, `getTrace`, `createTrace`, `saveTrace`, `deleteTrace`
- [ ] `deleteCase` cascade inside its existing transaction (add `db.traces` to the table list)
- [ ] Storage summary count; confirm `clearTransactionCache` leaves traces

### Task Group B — Updaters and hook

- [ ] Implement each updater; duplicate-key guard in `addSteps`; pruning in `removeSteps`
- [ ] Per-trace serialised save queue
- [ ] `useTraces`

## UI Behavior and Example Scenarios

None visible beyond the Storage page count (traces are listed in 06).

## Evidence / Data Integrity Invariants

- No function here touches `transactions`, `raw_transactions`, `wallet_states`, `address_labels` or `cases` (other than `deleteCase`'s cascade).
- A trace record never contains a raw transaction, balance or label; only reference fields.
- Invalid or newer records are never overwritten or deleted without a user action.

## Edge Cases and Failure Recovery

- IndexedDB unavailable: `useLocalQuery` error state; the Trace view shows the storage error (like the case loader).
- Two tabs editing one trace: last write wins per save; the live query updates the other tab. Document it; no locking (matches case edits).
- Quota exceeded: `describeStorageError` message; the edit isn't applied.
- A trace whose `caseId` points to a missing case (manual DB edits): not listed anywhere; removed by "Delete all local data". Acceptable.

## Performance Considerations

A 500-step trace record is ≈ 150 KB of JSON; `put` is well within IndexedDB limits. Position saves happen on drag end only. Annotations are small (a note is its text plus a few numbers); cap 500 per trace and 2,000 characters per note/label, enforced by the updaters and `parseTrace`.

## Tests and Fixtures to Add

- `traces.test.ts` (stub tables): create → get round trip; list per case only (case isolation); delete; `deleteCase` cascade removes only that case's traces.
- `parseTrace`: valid; missing field → invalid; amount `"1.5"` → invalid step kept aside; `schemaVersion` 99 → newer_version; v0 (synthetic) → migrated.
- `edit.test.ts`: `addSteps` ignores duplicate keys; `removeSteps` prunes positions and styles of nodes left without steps and detaches connector ends to points (the connector stays); `removeAnnotations` detaches ends pointing at removed annotations; `setScope` keeps every step; editing trace A leaves trace B (same case) unchanged; every updater leaves `id`, `caseId`, `createdAt` unchanged.

## Acceptance Criteria (observable and measurable)

- [ ] Reload restores every trace exactly (round-trip test).
- [ ] Case isolation and cascade proven by tests.
- [ ] Malformed records produce the documented states, never exceptions.
- [ ] Validation commands pass; results recorded.

## Definition of Done

- [ ] Storage, updaters and hook merged with tests; Storage page count verified in the browser; no visible change elsewhere.

## Known Risks / Open Decisions

- Version-number collision with Global Preferences: resolved by "next free version at implementation time". The reviewer checks `db.ts` before merging.

## Handoff Notes for the Next Sprint

05 reads `presentation.positions` and writes them through `setPositions`; 05A edits styles and annotations through the annotation updaters; 06 builds the trace list and editing UI on `useTraces`.

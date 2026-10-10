# Sprint 07 — Trace Graph Integration

**Status:** Deferred 2026-10-09: trace settings move to `docs/sprints/trace-graph/12_OPTIONAL_GLOBAL_PREFERENCES_ADDON.md`. See the decision at the end of this file.
**Depends on:** 02; visual integration depends on the Trace Graph being built.
**Note (2026-10-08):** The Trace Graph now has its own plan, `docs/sprints/trace-graph/`. Its Sprint 12 replaces the provisional keys below with ones that match the behaviours it builds. Treat this key list as provisional.

## 1. Sprint objective

Define the Trace Graph's settings in the central registry, validated and tested but hidden, and write down the contract the Trace Graph must honour when it's built. Build no Trace UI.

## 2. Current implementation findings

- No Trace Graph code, route, branch or sprint document exists (searched `src/`, `docs/`, all local and remote branches at `04f121b`).
- The nearest plan is `ROADMAP.md` §1 **Investigation graph**: start from one wallet, transaction, token or bridge message; grow the graph one accepted step at a time; suggestions come with evidence and are never auto-added; undo, branches and snapshots; the timeline stays in step.
- MVP `SPRINT_10_BOUNDARY_CONTEXT_PORTABILITY.md` plans "Trace earlier origin" / "Show next movement" (context transactions outside the case range, fetched on request). That's related, also not built.
- `src/lib/routing/case-path.ts` `CaseView` is `timeline | graph | table`. There's no trace view to start on.

## 3. Scope

- Add `trace.*` keys to `SETTINGS` with `exposed: false`
- Tests for their validation, defaults, presets and resolution
- The integration contract (§5.2)

## 4. Out of scope

- Any Trace Graph UI, route or placeholder
- `investigation.startView = trace` (added when the view exists)
- Adding trace keys to detail presets (done when the view exists, so presets don't change hidden values nobody can see)

## 5. Technical approach

### 5.1 Keys

| Key | Values (default **bold**) | Scope | Notes |
|---|---|---|---|
| `trace.direction` | **forward**, backward, both | case | Direction of *suggested* continuations |
| `trace.depth` | **1**, 2, 3 | case | Hops offered per suggestion step. Never auto-adds; no "unlimited" |
| `trace.columnSpacing` | compact, **normal**, wide | case | Same names and meaning as `graph.spacing` |
| `trace.services` | **collapsed**, expanded | case | How a service the path enters is drawn by default |
| `trace.lowValue` | shown, **faded**, hidden | case | Reuses `isDust`, like `graph.lowValue` |
| `trace.edgeLabels` | none, **amount**, amount_time | case | Trace edges *do* carry labels (a path, not a network) |
| `trace.autoLanes` | **on**, off | case | Place newly added nodes in a lane automatically; never moves placed or locked nodes |
| `trace.intermediaries` | **shown**, collapsed | case | Pass-through hops between two path nodes |

Defaults are proposals. The Trace Graph's own design sprint may change them; changing a default before release needs no migration because nothing is stored yet.

### 5.2 Integration contract (for whoever builds the Trace Graph)

1. Read settings only through `usePreferences(c).get("trace.*")`. Don't create a trace-specific store.
2. **Preferences never change the investigator's path.** Nodes, edges and lane assignments the user added, and every locked position, are case data stored by the Trace Graph itself. A preference change may restyle them, collapse or expand services and intermediaries, or change what is *suggested*. It may not add, remove or move them. `trace.autoLanes` applies only at the moment a node is added.
3. Settings that only restyle (`columnSpacing`, `edgeLabels`, `lowValue: faded`) are draw-only and must not re-run layout for placed nodes.
4. Anything hidden (`lowValue: hidden`, collapsed intermediaries) is counted on screen with a Show action, as on the graph and timeline.
5. Changing a trace setting makes no RPC request. Fetching context transactions stays a separate, explicit user action.
6. When the view ships: set `exposed`, add the Trace section to Preferences and View Settings, add `trace` to `investigation.startView`, and decide which keys detail presets control (candidates: `depth`, `lowValue`, `intermediaries`).

### 5.3 Why define keys now

Sprint 02's registry, validation and migration then cover them from day one, and stored values written later need no schema bump. The cost is a few registry lines and tests. They're never shown.

## 6. Affected modules or files

| File | Change |
|---|---|
| `src/lib/preferences/schema.ts` | `trace.*` entries, `exposed: false` |
| `src/lib/preferences/preferences.test.ts` | trace tests |

## 7. Detailed implementation tasks

- [ ] Add the eight keys
- [ ] Ensure the Preferences page and View Settings skip `exposed: false` keys (generated UI already filters; add a test on the filter function)
- [ ] Tests (§11); `pnpm test`, `pnpm typecheck`; record results
- [ ] Mark visual integration **blocked** in `00_README.md` with a link to `ROADMAP.md` §1

## 8. Dependencies

02. Visual integration depends on the Trace Graph (not scheduled).

## 9. Edge cases

- Stored trace values in a browser that later runs an older build: preserved as unknown keys (Sprint 02 rule).
- A case override on a trace key set through import (09) before the view exists: validated, stored, unused.
- `trace.depth` must never be read as permission to fetch: depth bounds suggestions, never ingestion.

## 10. Acceptance criteria

- [ ] Trace keys validate, resolve and report origins like any other key.
- [ ] No trace control appears anywhere in the UI.
- [ ] The contract (§5.2) is in this file and linked from `00_README.md`.

## 11. Test requirements

- Each trace key's default is in its values; invalid values are rejected.
- A global trace value and a case override resolve with the right origins.
- `exposedKeys(category)` (the helper the page uses) excludes every trace key.

## 12. Definition of Done

Keys defined and tested, hidden from the UI, and the contract documented. The visual part stays blocked until the Trace Graph exists.

## Decision (2026-10-09)

Deferred. The Trace Graph plan (`docs/sprints/trace-graph/12_OPTIONAL_GLOBAL_PREFERENCES_ADDON.md`) defines the trace keys from the behaviour it actually builds, and replaces the provisional list above. Adding them now would register settings nothing reads. The registry needs no change to accept them later: unknown stored keys are already preserved.

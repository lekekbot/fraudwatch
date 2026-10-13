# Sprint 12 — OPTIONAL Global Preferences Add-On

**Status:** Optional / Deferred. **Not required for release.** Execute only after both the Trace Graph MVP (06) and the Global Preferences foundation exist.
**Depends on:** Trace Sprint 06; Global Preferences Sprints 02 (schema, resolution, hook) and 03 (page) in `docs/sprints/global-preferences/`

## Summary and Why It Matters

Investigators who set a theme, address length or motion preference expect the Trace Graph to honour it, and may want trace defaults (direction, max hops) set once. This sprint connects the Trace Graph to the **existing** preference system. It builds nothing of that system.

## Verified Current Repository Findings

### Existing capabilities (at planning time)

- **No preference system exists in code** at `04f121b`. It is planned in `docs/sprints/global-preferences/`:
  - Registry `SETTINGS` with typed enum keys, scopes `global | case`, `exposed` flag (`src/lib/preferences/schema.ts`, proposed)
  - Resolution `case > global > preset > default` with origins (`src/lib/preferences/resolve.ts`, proposed)
  - Hook `usePreferences(case?)` with `get`, `origin`, `setGlobal`, `setForCase` (`src/hooks/use-preferences.ts`, proposed)
  - Theme via a class-based dark mode, `appearance.motion`, `appearance.addressFormat`, `appearance.numberFormat`, `labels.*` (Global Preferences Sprint 03)
  - **Provisional** `trace.*` keys (`global-preferences/07_TRACE_GRAPH_INTEGRATION.md`): `direction`, `depth`, `columnSpacing`, `services`, `lowValue`, `edgeLabels`, `autoLanes`, `intermediaries`, all `exposed: false`

**Re-verify all of the above at execution time. Treat anything not in the code as pending.**

### Gaps and limitations

- Several provisional `trace.*` keys don't match behaviours this initiative actually builds (e.g. `edgeLabels`, `autoLanes`, `intermediaries`, `lowValue` have no trace implementation in 05–08).

### Assumptions requiring confirmation

- That the preference registry can be extended by adding keys (it's a single object literal in the plan). If it isn't, stop and record the blocker; don't build a parallel store.

## Objectives and User Outcomes

- The Trace Graph follows shared appearance preferences.
- Optional trace defaults for new traces, global with case overrides.
- Nothing investigator-authored (steps, positions, styles, annotations, hidden branches, expanded services, scope of existing traces) is ever changed by a preference.

## In Scope

- Read shared keys in the trace view
- Replace the provisional `trace.*` keys with ones matching built behaviour; expose them
- A Trace section on the Preferences page and a View Settings popover in the trace view, using the shared components from Global Preferences
- `investigation.startView` gains `trace` only if the product wants it (Decision Required)

## Explicitly Out of Scope

- Any preferences store, page, presets, migration framework or resolution logic
- Changing Timeline or Interaction Graph preferences

## Architecture / Data Contracts / UX Decisions

### Shared keys consumed

| Key | Trace use |
|---|---|
| `appearance.theme` | Already followed through CSS variables (`readPalette`); verify the redraw trigger used by other canvases also redraws the trace canvas |
| `appearance.motion` | Replaces the trace canvas's own `prefers-reduced-motion` check with the shared `useReducedMotion` |
| `appearance.addressFormat`, `labels.*` | Automatically applied through `createNames`; verify the canvas caps at medium as other canvases do |
| `appearance.numberFormat` | Compact amounts on edge labels only; inspector and export always exact |

### Trace keys (final set replaces the provisional list)

| Key | Values (default) | Scope | Effect | Applies to |
|---|---|---|---|---|
| `trace.direction` | forward, backward, both (**forward**) | case | Pre-fills the seed dialog | New traces only |
| `trace.maxHops` | 3, **6**, 10, 20 | case | Pre-fills the seed dialog | New traces only |
| `trace.spacing` | compact, **normal**, wide | case | Auto-place and Tidy layout spacing | Newly placed nodes and Tidy layout only; never moves a placed node |
| `trace.servicesExpanded` | **collapsed**, expanded | case | Initial `expandedServices` for new traces | New traces only |
| `trace.supportingMovements` | **hidden**, shown | case | Default of the candidate panel's "Fees, royalties, rent" toggle | Candidate panel |

Remove the provisional keys `depth`, `lowValue`, `edgeLabels`, `autoLanes`, `intermediaries` from the registry (they were never exposed or stored; Global Preferences' unknown-key rule keeps any stray stored values harmless).

### Precedence

Resolution is Global Preferences' own (`case > global > preset > default`). The trace adds one rule on top, inside the trace view: **values stored on a trace (its scope, direction, positions, styles, annotations, hidden branches, expanded services) always win over preferences**, because they're investigator decisions about that trace, not defaults.

### Fallback

If `usePreferences` is missing (the add-on was reverted) or returns an error, the trace uses the defaults in the table. The trace view must compile and work with the add-on removed. Keep all preference reads in one adapter file (`src/app/case/trace/trace-preferences.ts`) so removal is one file plus imports.

## Prerequisites and Dependencies

Trace 06; Global Preferences 02 and 03 merged. Not a dependency of Trace 13.

## Affected Modules and Proposed Files

- **Existing at execution time (verify):** `src/lib/preferences/schema.ts`, the Preferences page, `view-settings-panel.tsx`
- **Proposed new:** `src/app/case/trace/trace-preferences.ts`
- **Existing trace files:** `seed-dialog.tsx`, `trace-canvas.tsx`, `candidate-panel.tsx`, `trace-view.tsx`

## Implementation Plan

### Task Group A — Verify

- [ ] Confirm the preference APIs exist as planned; record actual names and paths here; stop if the registry isn't extensible

### Task Group B — Shared keys

- [ ] Use `useReducedMotion` in the trace canvas
- [ ] Confirm theme redraw, address format and label options apply; compact amounts on edge labels only

### Task Group C — Trace keys

- [ ] Replace the provisional keys with the table's set; `exposed: true`
- [ ] Trace section on the Preferences page; View Settings in the trace toolbar (case overrides)
- [ ] Wire defaults into the seed dialog, layout spacing, candidate toggle, new-trace service state
- [ ] Adapter with fallbacks

## UI Behavior and Example Scenarios

- Global `trace.maxHops = 10`; Case A override 3. New trace in A: the dialog shows 3; in B: 10. Existing traces keep their stored `maxHops`.
- Change `trace.columnSpacing` to wide: existing trace nodes stay put; Reset layout spreads them wide.

## Evidence / Data Integrity Invariants

- No preference change alters `steps`, positions, styles, annotations, hidden branches or expanded services of any saved trace (test).
- No preference change causes an RPC request.

## Edge Cases and Failure Recovery

- Malformed stored trace preference: Global Preferences' validation ignores it; the trace uses the default.
- A preference changed while the seed dialog is open: the dialog keeps the user's current inputs.

## Performance Considerations

Preference reads are primitives passed into memos; spacing only affects layout (05).

## Tests and Fixtures to Add

- Pure test: the trace adapter returns defaults when the hook result is missing or erroring.
- Test: applying every trace preference value to a saved trace leaves the record deep-equal.
- Browser: the precedence scenario above; theme and motion.

## Acceptance Criteria (observable and measurable)

- [ ] The Trace Graph works fully with this add-on absent (build with the adapter returning defaults; smoke test).
- [ ] No parallel settings store, page or presets system introduced (review checklist).
- [ ] Investigator-authored state unchanged by any preference (test).

## Definition of Done

- [ ] Add-on merged behind the adapter; tests and checks recorded; Global Preferences docs updated to point at the final trace keys.

## Known Risks / Open Decisions

- **Decision Required:** whether `investigation.startView` should offer "Trace". Recommended no (a case opening on a trace needs a chosen trace).

## Handoff Notes for the Next Sprint

None. Sprint 13 doesn't depend on this.

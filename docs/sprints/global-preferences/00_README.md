# Global Preferences & Case View Settings — Initiative Index

**Status (2026-10-09):** Sprints 02–06 and 08–10 are implemented in the working tree (uncommitted, awaiting review); 07 is deferred to the Trace Graph plan. The table below is the source of truth.

**Audited against:** branch `timeline-pill-clearance` at `04f121b` (2026-10-08). Findings are in [01_ARCHITECTURE_AND_AUDIT.md](01_ARCHITECTURE_AND_AUDIT.md).

## Why

Every case today opens the same way: the graph shows the top 25 addresses with program calls off and services collapsed, the timeline draws every connector, the theme follows the OS, and the one remembered choice (graph spacing) is stored in `localStorage` for every case at once. Investigators can't say "I always want program calls" or "this case needs the forensic view" without redoing it on every visit.

The initiative gives investigators control over **how** evidence is presented, never **what** the evidence is:

- **Global preferences** apply to every case.
- **Case view settings** (overrides) let one investigation differ.
- **Detail presets** (Minimal / Balanced / Forensic) change many presentation settings in one step.
- **Custom presets** let investigators save and share their own combinations.

**Guiding rule:** a preference can collapse, de-emphasise or hide something from a view. It never deletes, edits or reinterprets a transaction, and anything it hides is counted on screen and can be brought back.

## Three things that hide data, kept separate

FraudWatch already has two ways to take transactions out of a view. Preferences add a third. They must never be merged.

| Mechanism | What it is | Lifetime | Stored in | Code |
|---|---|---|---|---|
| **Filter** | A temporary question ("only swaps this week") | Session | React state | `TxFilter`, `src/lib/timeline/filter.ts` |
| **Hiding** | An investigator's triage decision that something is noise | Case | Case record | `hiddenSignatures`, `hideRules`, `src/lib/case/hiding.ts` |
| **View setting** | How dense or detailed views are | Global, or per case | `preferences` table, or case `viewSettings` | new, `src/lib/preferences/` |

A view setting never writes a filter or a hide rule, and a hide rule is never created by a preset.

## Architecture at a glance

```text
                 ┌─────────────────────────────┐
 code            │ SETTINGS registry           │  key → allowed values, default, scope,
                 │ src/lib/preferences/schema  │        preset-controlled?, exposed?
                 └──────────────┬──────────────┘
                                │
 IndexedDB       preferences table             cases[id].viewSettings
 (Dexie v5)      { id: "global", values }      { values, appliedPreset? }
                                │                      │
                 ┌──────────────▼──────────────────────▼──┐
 pure            │ resolve(key, layers) → { value, origin }│
                 └──────────────┬─────────────────────────┘
                                │
 React           usePreferences(case?) → resolved values + origins
                                │
 views           case-shell → buildInteractionGraph / WalletGraph / WalletTimeline / Names
```

- **One source of truth:** global values live in a single Dexie row (`preferences`, id `global`). Case overrides live on the case record they belong to. Custom presets get their own table in Sprint 09. The only browser `localStorage` use is a theme mirror the pre-paint script reads (Sprint 03). It's a write-through copy and nothing reads it as authoritative.
- **Sparse storage:** only values the user chose are stored. A missing key means "inherited", so a changed app default reaches everyone who never touched it.
- **Flat, typed keys** (`graph.spacing`, `timeline.connectors`) make per-key resolution and origin tracking trivial. This is the "schema-aware deep resolution" the brief asks for, without nested-object merging.

## Preference hierarchy (normative)

Lowest to highest precedence:

```text
1. Application default        SETTINGS[key].default
2. Active detail preset       preset chosen in Global Preferences (preset-controlled keys only)
3. Global preference          the user's explicit global value
4. Case override              the case's explicit value (case-scoped keys only)
```

The brief lists `Defaults → Global → Preset → Case`. This plan deliberately puts the preset **below** explicit global values. If a preset outranked them, a manual change made after picking a preset would be silently ignored, which breaks "manual adjustments persist" and the "Custom" state. Applying a preset therefore **clears** the user's explicit global values for the keys that preset controls (one action, with undo). Afterwards, any key they change again shows the preset as "customised". Case overrides are never touched by a global preset. See [02](02_PREFERENCE_SCHEMA_AND_STATE.md) §Resolution and [04](04_INVESTIGATION_DETAIL_PRESETS.md).

Each resolved value reports its origin: `default | preset | global | case`.

## Sprint overview

| Sprint | Name | Dependencies | Status |
|---|---|---|---|
| 01 | [Architecture Audit](01_ARCHITECTURE_AND_AUDIT.md) | None | Done (this document set) |
| 02 | [Schema & State](02_PREFERENCE_SCHEMA_AND_STATE.md) | 01 | Implemented, awaiting review |
| 03 | [Preferences UI](03_GLOBAL_PREFERENCES_UI.md) | 02 | Implemented, awaiting review (now the Settings page at `/settings/`) |
| 04 | [Detail Presets](04_INVESTIGATION_DETAIL_PRESETS.md) | 02, 03 | Implemented, awaiting review |
| 05 | [Interaction Graph](05_INTERACTION_GRAPH_INTEGRATION.md) | 02, 04 | Implemented, checked on a loaded case, awaiting review |
| 06 | [Timeline](06_TIMELINE_INTEGRATION.md) | 02, 04 | Implemented, awaiting review |
| 07 | [Trace Graph](07_TRACE_GRAPH_INTEGRATION.md) | 02, Trace availability | Deferred: keys move to trace-graph Sprint 12 |
| 08 | [Case Overrides](08_CASE_OVERRIDES.md) | 02, 05, 06 | Implemented, awaiting review |
| 09 | [Custom Presets](09_CUSTOM_PRESETS.md) | 04, 08 | Implemented, awaiting review |
| 10 | [Testing & Release](10_POLISH_TESTING_AND_RELEASE.md) | All applicable sprints | Done except the items listed in its results; awaiting review |

Sprint 01 is marked done because its only deliverable is the audit and these plans. No code was written.

## Dependency diagram

```text
01 Audit
  └─► 02 Schema & State  (global + case-override storage, resolution, presets interface)
        ├─► 03 Preferences page + global-only wiring (theme, addresses, labels, start view)
        │     └─► 04 Detail presets (Minimal / Balanced / Forensic)
        │           ├─► 05 Interaction graph ─┐
        │           └─► 06 Timeline ──────────┤
        │                                     └─► 08 Case override UX (indicators, reset, scope)
        │                                              └─► 09 Custom presets & import/export
        └─► 07 Trace schema (UI blocked on the Trace Graph itself)
                                                         └─► 10 Release readiness
```

05 and 06 are independent of each other and can run in either order. 05 and 06 already write case overrides through the Sprint 02 functions, so 08 adds the override UX on top instead of replacing anything.

## Completion checklist

- [x] 02 — Registry, validation, migration, resolution, Dexie table, `usePreferences`, case-override storage
- [x] 03 — Settings page (`/settings/`, was `/settings/preferences/`); theme, motion, address/number format, labels and start view wired
- [x] 04 — Built-in detail presets with Custom state and undoable apply
- [x] 05 — Graph reads preferences; View Settings popover; low-value indicator
- [x] 06 — Timeline reads preferences; View Settings popover; hidden-by-view indicator
- [ ] 07 — Deferred to trace-graph Sprint 12 (no trace keys added)
- [x] 08 — Override badges, per-key and all-key reset, "make global default"
- [x] 09 — Custom presets, case application, JSON import/export
- [x] 10 — Accessibility, narrow layouts, large-case performance, migration from real browser data, release note

## Risks and blockers

| Risk | Impact | Mitigation | Sprint |
|---|---|---|---|
| Trace Graph does not exist (it's roadmap §1 "Investigation graph") | No integration target | Schema only; no UI; integration contract documented | 07 |
| Theme switching needs class-based dark mode; Tailwind is currently media-query only, and canvases read `prefers-color-scheme` directly | Flash of wrong theme; canvases ignoring the setting | Class-based `@custom-variant`; pre-paint script; canvases read the resolved theme | 03 |
| Preferences load asynchronously from IndexedDB | Graph laid out once with defaults, then again | Workspace waits for preferences like it waits for the case | 02, 05 |
| Graph drags are lost whenever the layout re-runs (`wallet-graph.tsx` resets `positions` to the new layout) | Build-affecting preferences would discard manual positioning | Preserve dragged positions across layout changes in 05 | 05 |
| Case record writes use whole-record `put` from render-time `c` | An override write could race another case write | Override writes use `cases.update(id, …)` on one field | 02, 08 |
| `fraudwatch:graph-spacing` is global today; it becomes a preference | Users lose their choice unless migrated | One-time import into the global row, then remove the key | 02 |
| Low-value hiding could hide decoy dust that matters for address poisoning | Investigator misses a warning | Look-alike marks and decoy logic run on unfiltered data; the hidden count is always shown | 05 |
| Case export/import (MVP Sprint 10) isn't built | Case overrides can't travel yet | Overrides live on the case record, so export includes them automatically when it lands | 08 |

## Definition of overall completion

The initiative is complete when:

1. Every exposed setting has an owner, a validated value set, a default, and a test proving its effect.
2. A user can set global preferences, override any case-scoped one per case, see which values are overridden and why, and reset them at any level.
3. Changing any preference triggers no RPC request and changes no stored transaction, wallet state, label, hide rule or bookmark.
4. Everything a preference hides is counted on screen and can be shown again in one action.
5. A browser with pre-initiative data (including `fraudwatch:graph-spacing`) upgrades without losing data or settings.
6. `pnpm test`, `pnpm typecheck` and `pnpm lint` pass, and the release checks in Sprint 10 were run and recorded.

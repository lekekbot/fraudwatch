# Sprint 08 — Case-Specific Overrides

**Status:** Implemented 2026-10-09, uncommitted in the working tree; awaiting review. Results at the end of this file.
**Depends on:** 02, 05, 06

## 1. Sprint objective

Make case overrides visible and manageable: which settings this case changes, where every value comes from, how to reset one or all, and how to promote them to global. The storage and resolution already exist (Sprint 02), and the graph and timeline already write overrides (05, 06). This sprint adds the user-facing side and proves inheritance.

## 2. Current implementation findings

At the start of this sprint (after 02, 05, 06):

- `FraudWatchCase.viewSettings` holds sparse overrides; `setCaseOverride` / `clearCaseOverrides` are in `src/lib/case/view-settings.ts`, saved with `cases.update`.
- `usePreferences(c)` resolves `case > global > preset > default` with `origin(key)`.
- `view-settings-panel.tsx` renders graph or timeline keys and writes overrides, with "Use these for all cases".
- Label keys (`labels.*`) are case-scoped but have no case control yet.
- Filters (`TxFilter`), hiding (`hiddenSignatures`, `hideRules`) and bookmarks are separate case data. Overrides must never be confused with them (`00_README.md`, "Three things that hide data").

Re-verify these against the code before starting. If 05 or 06 deviated, record it here.

## 3. Scope

- Origin badge on every View Settings control: `This case` / `All cases` / `Balanced preset` / `Default`
- Per-key "Reset to all-cases value", "Reset all overrides"
- Indicator on the View Settings button: `View settings · 3`
- A "This case" section in View Settings listing every override across categories (graph, timeline, labels) with its global value
- Label overrides in the case workspace (in View Settings, a "Names" group)
- Robustness: malformed overrides, migrated overrides, deleted presets referenced by `appliedPreset`

## 4. Out of scope

- Applying custom presets to a case (09)
- Moving filters or hide rules into view settings (never)

## 5. Technical approach

### 5.1 Indicators

- Button label `View settings` gains a count badge when `caseOverrideCount > 0`, counting only keys relevant to that view, plus labels. The aria-label reads "View settings, 3 settings changed for this case".
- Each control shows its origin as small text under the label. An overridden control shows `This case · All cases: Always` with a reset (↺) icon button (`aria-label="Use the all-cases value"`).
- A "This case changes" list at the top when any override exists: `Edge arrows: Selected only (all cases: All) ↺`. `Reset all` clears every override for the case (no confirm; an Undo toast restores them, the same pattern as hiding's undo).

### 5.2 Global changes and inheritance

No code is needed beyond Sprint 02 resolution. This sprint **proves** it, using the brief's example with a real key:

```text
Global timeline.connectors = selected
Case A override = hover
Case B no override
Global changes to always
→ Case A: hover (origin case)     Case B: always (origin global)
```

The Preferences page shows, under any case-scoped setting, "Overridden in 2 cases" when applicable (one query over `cases` reading `viewSettings.values` keys). It is informational, linking to nothing (there is no cases-by-override view to build).

### 5.3 Robustness

| Situation | Behaviour |
|---|---|
| `viewSettings` not an object, or `values` malformed | Treated as no overrides; left untouched until the user changes one (02 rule 1) |
| Override value invalid for its key | Ignored (inherits); dropped on the next write to that case's overrides |
| Global-scope key in overrides | Ignored |
| `viewSettings.schemaVersion` older | `migrateValues` on read |
| `appliedPreset.id` refers to a deleted or unknown preset | Shown as provenance text only ("Applied: Token flow (deleted)"); values are already materialised, so nothing changes |
| A key removed from the registry in a later version | Unknown key: preserved, ignored |
| Case opened in two tabs, override changed in one | The other tab updates through the live case query |

### 5.4 Label overrides

`labels.preferNames`, `labels.community`, `labels.sns` appear in a "Names" group in both View Settings popovers (the same three controls, the same overrides). `createNames` already takes the options (03).

## 6. Affected modules or files

| File | Change |
|---|---|
| `src/app/case/view-settings-panel.tsx` | origins, resets, the "This case changes" list, Names group, count |
| `src/app/case/graph/wallet-graph.tsx`, `src/app/case/timeline/wallet-timeline.tsx` | button badge |
| `src/app/(site)/settings/preferences/preferences-form.tsx` | "Overridden in N cases" |
| `src/lib/db/preferences.ts` or `cases.ts` | `countCaseOverrides(db): Map<SettingKey, number>` |
| `src/lib/case/view-settings.test.ts` | inheritance and robustness tests |

## 7. Detailed implementation tasks

- [ ] Re-verify 05/06 against this plan; note deviations
- [ ] Origin text and per-key reset in View Settings
- [ ] "This case changes" list; Reset all with Undo
- [ ] Count badge with accessible label
- [ ] Names group
- [ ] "Overridden in N cases" on the Preferences page
- [ ] Tests (§11); `pnpm test`, `pnpm typecheck`, `pnpm lint`; record results
- [ ] Browser verification (§11)

## 8. Dependencies

02 (model), 05 and 06 (views writing overrides).

## 9. Edge cases

- An override equal to the current global value still counts as an override (it won't follow future global changes). The UI shows it, so the user can reset it.
- "Use these for all cases" followed by Undo: restores both the previous global values and the case overrides.
- A case with 0 transactions: View Settings still works.
- A deleted case: its overrides go with it (they live on the record); "Overridden in N cases" updates.

## 10. Acceptance criteria

- [ ] Every View Settings value shows where it comes from.
- [ ] Global changes reach inheriting cases only; overridden cases keep their values (the §5.2 example passes as a test and in the browser).
- [ ] Individual and full resets work, with Undo for full reset.
- [ ] Malformed or migrated override data never breaks a case.
- [ ] No filter, hide rule, bookmark or label is changed by any override action.

## 11. Test requirements

Unit:

- The §5.2 example, literally, through `resolvePreferences` with two cases.
- Reset one key → origin returns to global/preset/default correctly.
- Reset all → no overrides; other case fields byte-identical (JSON equality).
- Malformed `viewSettings` variants (string, array, `values: null`, invalid values) resolve as inherited without throwing.
- `appliedPreset` pointing to a missing preset doesn't affect resolution.

Browser (record results):

- Two cases, the §5.2 sequence through the UI.
- Keyboard: reach and use every reset button; screen reader names on the badge and resets.

## 12. Definition of Done

Overrides visible, explained and resettable; inheritance proven by tests and in the browser; validation passes with results recorded.

## Results (2026-10-09)

Implemented, and browser-checked on a loaded case:
- View settings show each overridden setting as "This case · all cases: X", with a reset.
- "Reset all" restores the settings for all cases, with Undo.
- The icon carries a count, and its accessible name reads "View settings, 2 changed for this case".
- A Names group (the three label settings) appears in both the graph and timeline panels.
- The Settings page notes "N cases use their own value" under any setting a case overrides.

The case A / case B inheritance example is covered by `src/lib/preferences/preferences.test.ts`.
Override writes are transactional (see Sprint 06 results), with a test for two quick changes made from one stale copy.

# Sprint 10 — Polish, Testing and Release Readiness

**Status:** Done 2026-10-09 apart from the open items below; uncommitted, awaiting review.
**Depends on:** all applicable sprints (02–06, 08, 09; 07's schema part)

## 1. Sprint objective

Stabilise the feature: audit every exposed setting, verify accessibility, layouts, migration from real browser data and performance at scale, confirm evidence integrity and RPC silence, and document the release.

## 2. Current implementation findings

To be filled in at the start of the sprint: list every exposed key, where it's consumed, and any deviation from 01 §5.3 recorded by earlier sprints. Re-run the baseline: before this initiative it was 14 files / 142 tests passing, typecheck clean.

## 3. Scope

- Copy audit of every label, description and toast
- Remove redundant or no-op controls; re-check the 01 §5.4 exclusions (anything that now has a real backing can be scheduled, not slipped in)
- Accessibility pass (keyboard, focus order, names, contrast in both themes)
- Narrow and desktop layouts for the Preferences page and both View Settings popovers
- Migration test from a pre-initiative browser profile
- Performance on a large case
- RPC silence and evidence integrity checks
- Docs: `docs/ARCHITECTURE.md` (preferences section), `README.md` if it lists features, a release note
- Delete unused configuration code (e.g. any remaining `SPACING_KEY` references)

## 4. Out of scope

New settings. New views.

## 5. Technical approach

### 5.1 Evidence integrity check

Write a test helper that snapshots, for a fixture case, the `transactions`, `wallet_states`, `address_labels` rows and the case record minus `viewSettings`/`lastView`. Run every preference write function (global set/reset, preset apply, case override set/reset, import) and assert the snapshot is unchanged. This turns "settings never alter evidence" into a test.

### 5.2 RPC silence

In the browser, with the network panel filtered to the RPC host: change every exposed setting in Preferences and both View Settings, apply each preset, import a file. Expected requests: none. The one documented exception is re-showing `.sol` names, which resumes `useSnsNames` lookups for uncached names (Sprint 03). Record the result.

### 5.3 Performance

Use the scale in `src/lib/semantic/performance.test.ts` (10 wallets, 5,000 transactions) or a real large case:

- Graph: toggle node limit 25 → 100 → All (with confirm), programs, low-value; the build plus layout time should stay within 2× of the pre-initiative build for the same options.
- Timeline: density compact vs comfortable frame time while panning; connectors `hover` must not redraw on pointer moves that don't change the hovered card.
- Record numbers here.

### 5.4 Migration

Take a browser profile created on `main` before Sprint 02 (with cases, labels, hide rules and a non-default `fraudwatch:graph-spacing`). Upgrade. Verify: DB opens at v6 with nothing lost; the spacing choice is kept; every case opens with the same graph and timeline as before; `localStorage` no longer holds `fraudwatch:graph-spacing`.

## 6. Affected modules or files

Whatever the audit finds. Docs: `docs/ARCHITECTURE.md`, `docs/sprints/global-preferences/00_README.md` (status table), a release note.

## 7. Detailed implementation tasks

- [ ] Inventory exposed keys vs 01 §5.3; reconcile and record deviations
- [ ] Copy audit; remove redundant controls
- [ ] Keyboard and screen-reader pass; contrast in light and dark
- [ ] 375 px, 768 px and desktop layouts
- [ ] Integrity snapshot test (§5.1)
- [ ] RPC silence check (§5.2)
- [ ] Performance measurements (§5.3)
- [ ] Migration from a pre-initiative profile (§5.4)
- [ ] Settings across multiple cases: open A, B; change global; switch back and forth
- [ ] Custom preset import/export; global and case resets
- [ ] Hidden-information indicators: every hide path (graph low-value, timeline categories) shows a count and a Show action
- [ ] Remove dead configuration code
- [ ] Update `docs/ARCHITECTURE.md` and the status table; write the release note
- [ ] `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`; record results

## 8. Dependencies

All earlier sprints that were implemented. 07's visual part stays blocked and is listed as such in the release note.

## 9. Edge cases

- A user who never opens Preferences sees no change at all (defaults = old behaviour).
- Private browsing with IndexedDB unavailable: the app's existing error appears; Preferences shows the same storage error and doesn't crash.
- "Delete all local data" resets preferences, presets and overrides together, as the Storage page says. Check its copy mentions preferences.

## 10. Acceptance criteria

- [ ] Every exposed control does something verifiable; none is speculative.
- [ ] Preferences are consistent across the graph, timeline and Preferences page.
- [ ] Case overrides stay isolated between cases.
- [ ] Large cases stay usable (numbers recorded).
- [ ] No RPC traffic from presentation changes (recorded).
- [ ] Evidence integrity test passes.
- [ ] All automated checks pass; no regressions in wallet loading, caching, timeline grouping, service aggregation, filters, selection, case persistence or RPC error handling (manual smoke test of each, recorded).

## 11. Test requirements

- §5.1 integrity test (new, automated).
- Full suite green.
- Recorded manual results for §5.2–§5.4 and the smoke test list.

## 12. Definition of Done

All acceptance criteria met with recorded evidence; status table updated to reflect what was actually done; release note written.

## Release note template

```text
Preferences
- New Preferences page (header → Preferences): theme, motion, address and amount format, name sources,
  how cases open, and default graph and timeline settings.
- Detail presets: Minimal, Balanced (unchanged default) and Forensic.
- View settings in the graph and timeline change one case; "Use these for all cases" makes them the default.
- Custom presets, with import and export as JSON.
- Anything a setting hides is counted on screen and can be shown again.
Upgrade: your graph spacing choice carries over. Nothing else changes until you change a setting.
```

## Results (2026-10-09)

| Check | Result |
|---|---|
| `pnpm test` | 203 passed (25 files). The baseline before this initiative was 142 in 14. |
| `pnpm typecheck`, `pnpm lint`, `pnpm build` | Clean; all routes build. `/settings/preferences` and `/settings/storage` now redirect to `/settings/`. |
| Evidence integrity (§5.1) | `src/lib/preferences/integrity.test.ts`: every settings write runs against a database with only the settings tables (anything else throws); case writes change only `viewSettings`. |
| RPC silence (§5.2) | Network panel filtered to the RPC host. Graph View settings (low-value, programs), timeline View settings (density, connectors), applying Minimal and Forensic to a case, and applying a saved preset globally: **no requests**. |
| Migration (§5.4) | Done on the user's real profile from before the initiative (5 cases, ~10k cached transactions). The database opened at v6 with nothing lost; `fraudwatch:graph-spacing` ("wide") imported and removed; cases open as before. |
| Large-case performance (§5.3) | `src/lib/semantic/performance.test.ts` (10 wallets / 5,000 transactions) still passes. Graph rebuilds no longer follow view-setting saves (the memo keys on wallet addresses). **Not measured in the browser.** |
| Accessibility | Segmented controls are radio groups (arrow keys checked); switches and checkboxes come from Base UI; icon buttons have names; the View settings count is in its accessible name. **No screen-reader pass.** |
| Layout | Settings checked at 606 px (the narrowest this Chrome window allows): one column, controls under labels, no sideways overflow; the section list hides below `lg`. **375 px not checked.** |
| Docs | `docs/ARCHITECTURE.md` "Display settings"; `docs/TERMINOLOGY.md` (setting, case override, preset). `README.md` untouched: it has an unrelated uncommitted change. |

Changes made during review, beyond the sprint plans:
- The header has a cog (Settings) and an RPC status badge; the URL is no longer shown.
- Settings and Local storage are one page, with an "On this page" list.
- The graph's "Not on the map" is a checkbox list.
- The graph toolbar fits one row.

Open items: browser performance numbers on a very large case; a screen-reader pass; 375 px; the timeline's "On hover" lines checked by eye; the real file download and picker for import/export (covered by unit tests).

## Release note

```text
Settings
- New Settings page (cog in the header): theme, motion, address and amount format, name sources, how cases
  open, and default graph and timeline settings, with local storage at the bottom.
- Detail presets: Minimal, Balanced (unchanged default) and Forensic. Save your own, apply them to every case
  or to one, and share them as a file.
- View settings (sliders icon) in the graph and timeline change one case; "Use these for all cases" makes them
  the default. A badge shows how many settings a case changes.
- Anything a setting hides is counted on screen with a way to show it again.
Upgrade: your graph spacing carries over. Nothing else changes until you change a setting.
```

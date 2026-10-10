# Sprint 04 — Investigation Detail Presets

**Status:** Implemented 2026-10-09, uncommitted in the working tree; awaiting review. Results at the end of this file.
**Depends on:** 02, 03

## 1. Sprint objective

Add Minimal, Balanced and Forensic: named bundles of the detail-related settings, chosen in one step, with a visible "customised" state when the user has changed something the preset controls.

## 2. Current implementation findings

- No presets exist. The default experience (25 addresses, programs off, services collapsed, every connector drawn, program interactions on the timeline) is hard-coded in `case-shell.tsx` and `timeline-canvas.tsx`.
- Sprint 02 defines `presetLayer(global)` returning `{}` and resolves `case > global > preset > default`.
- The preset-controlled keys are fixed in the 01 ownership matrix (`preset: true` in the registry).

## 3. Scope

- `src/lib/preferences/presets.ts`: built-in definitions, `presetLayer` implementation, `customisedKeys`
- Detail selector at the top of the Preferences page, with the customised state and a summary of what each preset changes
- Applying a preset (global): sets `investigation.detailPreset` and clears the user's explicit global values for the controlled keys, with Undo

## 4. Out of scope

- Custom presets, case-level preset application (09)
- Making the controlled settings do anything in views (05, 06). Until then a preset changes resolved values that nothing reads, so the selector stays `exposed: false` until the first view integration merges. Users never see a control with no effect.

## 5. Technical approach

### 5.1 Definitions

Presets set **only** `preset: true` keys. Balanced equals the defaults, which equal today's behaviour.

| Key | Minimal | Balanced | Forensic |
|---|---|---|---|
| `graph.nodeLimit` | 10 | 25 | 100 |
| `graph.programs` | hidden | hidden | shown |
| `graph.knownServices` | collapsed | collapsed | expanded |
| `graph.lowValue` | hidden | shown | shown |
| `timeline.connectors` | selected | always | always |
| `timeline.programInteractions` | hidden | shown | shown |

Notes:

- **Forensic is not "everything at once".** It stops at 100 addresses, never "All", keeps clusters other than known services collapsed, and leaves the graph's large-expansion confirmation on. Unknown and one-off wallets stay clustered.
- Minimal hides things, and every hidden thing is counted on screen by the view sprints (05: "N low-value connections hidden"; 06: "N program interactions hidden by view settings").
- Keys like spacing, density, arrows, theme and labels are **not** preset-controlled: they're taste, not detail.

```ts
export const DETAIL_PRESETS = {
  minimal:  { name: "Minimal",  summary: "Main movements only…",       values: { … } },
  balanced: { name: "Balanced", summary: "Recommended…",               values: { … } },
  forensic: { name: "Forensic", summary: "Program calls, low-value…",  values: { … } },
} as const satisfies Record<string, { name: string; summary: string; values: PreferenceValues }>;
```

A test asserts that every preset sets every `preset: true` key (no gaps), so a key added later can't silently fall back to defaults in one preset.

### 5.2 Resolution

`presetLayer(global)` returns `DETAIL_PRESETS[global["investigation.detailPreset"] ?? "balanced"].values`. An unknown id resolves as Balanced (Sprint 09 handles deleted custom ids the same way).

### 5.3 Customised state

```ts
/** Controlled keys whose explicit global value differs from the active preset's. */
export function customisedKeys(global: PreferenceValues): SettingKey[];
```

The selector shows `Balanced · customised (2)` when that list isn't empty; expanding it lists the two settings with "Use preset value" per key (which resets that global key). A global value **equal** to the preset's doesn't count as customised.

Case overrides don't affect the global selector. In a case, View Settings (Sprint 08) shows "This case overrides N settings".

### 5.4 Applying a preset

`applyDetailPreset(db, id)` in one Dexie transaction:

1. Remember the current explicit global values of the controlled keys (for Undo).
2. Set `investigation.detailPreset = id`.
3. Remove the controlled keys from the global values.

The toast reads "Forensic applied · Undo". Undo restores the previous preset id and the remembered values. Case overrides are never read or written by this. The preview under each option lists exactly the rows of §5.1 that would change from the current resolved global values ("Shows program calls · Up to 100 addresses …").

Nothing here touches transactions, filters, hide rules, labels or bookmarks. A preset is a set of preference values and nothing more.

## 6. Affected modules or files

| File | Change |
|---|---|
| `src/lib/preferences/presets.ts` | new |
| `src/lib/preferences/resolve.ts` | `presetLayer` uses presets |
| `src/lib/db/preferences.ts` | `applyDetailPreset` |
| `src/app/(site)/settings/preferences/preferences-form.tsx` | detail selector, preview, customised list |
| `src/lib/preferences/preferences.test.ts` | preset tests |

## 7. Detailed implementation tasks

- [ ] Define the three presets per §5.1
- [ ] `presetLayer`, `customisedKeys`, `applyDetailPreset` with Undo
- [ ] Detail selector UI (segmented, keyboard accessible), preview of changes, customised list with per-key reset
- [ ] Gate `exposed` for the selector until a view integration has merged
- [ ] Tests (§11); `pnpm test`, `pnpm typecheck`, `pnpm lint`; record results

## 8. Dependencies

02 (resolution), 03 (page). Visible effect needs 05 and/or 06.

## 9. Edge cases

- The user changes a controlled key to exactly the preset's value: not customised.
- The user applies the preset that is already active: still clears customisations (that's how to "go back to Balanced"), with Undo.
- Stored `detailPreset` is unknown (a deleted custom preset, or garbage): resolves as Balanced. The selector shows Balanced, and the stored value is replaced on the next apply.
- A case with overrides on controlled keys: keeps them after any global preset change (tested).

## 10. Acceptance criteria

- [ ] Each preset produces a deterministic resolved set.
- [ ] Manual changes after applying a preset persist and show "customised".
- [ ] Applying a preset never changes case overrides, case data, hide rules or labels.
- [ ] Applying a preset makes no RPC request (verified in the browser network panel once views use the keys).
- [ ] Forensic never sets node limit "all" and never expands every cluster.

## 11. Test requirements

- Every preset defines every preset-controlled key, and only those.
- Balanced's values equal every controlled key's default.
- `resolvePreferences` with each preset: values and origin `preset`; an explicit global value beats the preset (origin `global`); a case override beats both.
- `customisedKeys`: none after apply; one after a differing change; none when the change equals the preset value.
- `applyDetailPreset` (stub DB): clears controlled keys only, keeps the rest, sets the id; Undo restores exactly.
- A case override on `graph.nodeLimit` survives switching global presets.

## 12. Definition of Done

Presets defined and tested; the selector is visible once a view reads the keys; validation passes and results are recorded.

## Results (2026-10-09)

Implemented. Browser-checked:
- applying Forensic, and its Undo;
- the "customised (1)" state, the per-setting "Changed from Forensic" notes, and "Use Forensic's value".

The selector is exposed together with the graph settings (Sprint 05). Timeline keys stay in the presets but are left out of the preview until Sprint 06 makes them do something.

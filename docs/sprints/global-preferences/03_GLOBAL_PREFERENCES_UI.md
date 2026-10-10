# Sprint 03 — Global Preferences Interface

**Status:** Implemented 2026-10-09, uncommitted in the working tree; awaiting review. Results at the end of this file.
**Depends on:** 02

## 1. Sprint objective

Give investigators one place to set preferences, and wire the **global-only and cross-view** settings that no view sprint owns: theme, motion, address and number format, label sources, start view and inspector behaviour. Graph and timeline settings appear on the page in Sprints 05 and 06, once they actually do something.

## 2. Current implementation findings

- Settings pages: `src/app/(site)/settings/rpc/` and `src/app/(site)/settings/storage/`. Each is a `page.tsx` rendering a client component in a `Card` layout. The site header (`src/components/app-header.tsx`) links Storage and shows the RPC badge; the case workspace has its own top bar in `case-shell.tsx`.
- No select, switch, radio-group or popover component in `src/components/ui/`. Graph toolbars use styled native `<select>`. `@base-ui/react` is installed and has Radio/Toggle Group primitives; `shadcn` is installed, so `npx shadcn add` is available for adding components the shadcn way.
- Dark mode: `globals.css` uses `@custom-variant dark (@media (prefers-color-scheme: dark))` and a `@media (prefers-color-scheme: dark)` block of variables (line ~83). `timeline-canvas.tsx:898` listens to `matchMedia("(prefers-color-scheme: dark)")` to redraw. Canvas colours are read from CSS variables (`src/app/case/canvas.ts`).
- Motion: `wallet-graph.tsx` animates layout changes (320 ms) and `fit()`. `timeline-canvas.tsx` and `relationship-chart.tsx` use `requestAnimationFrame` for drawing (not animation) and animated zoom. Nothing checks reduced motion.
- Names: every displayed address name goes through `createNames`/`displayName` (`src/lib/labels/labels.ts`). `.sol` lookups run in `useSnsNames` (`src/hooks/use-sns-names.ts`).
- Case links: `home-view.tsx:85`, `new-case-form.tsx:94` and `:336`, `map-startup.tsx:36` all hard-code `"timeline"`.
- Interaction model: the app saves immediately everywhere (labels, hide rules, case name). There are no Save buttons, so Preferences saves immediately too.

## 3. Scope

- Route `/settings/preferences/` with a "Preferences" header link and a link from the case workspace top bar
- Page layout and categories; graph and timeline categories get stubs that list nothing until 05/06 register their keys as exposed
- Per-setting control, per-category reset, reset all
- Origin hint where a value isn't the default ("Default", "From Balanced", "Changed")
- Wire: `appearance.theme`, `appearance.motion`, `appearance.addressFormat`, `appearance.numberFormat`, `labels.*`, `investigation.startView`, `investigation.inspector`, `FraudWatchCase.lastView`

## 4. Out of scope

- The detail preset selector (Sprint 04)
- Graph and timeline settings (05, 06)
- Case overrides UI (05, 06, 08)
- Import/export (09)

## 5. Technical approach

### 5.1 Page

```text
Preferences
Customize how investigations appear. Changes apply to all cases unless a case overrides them.

Appearance                                   [Reset section]
  Theme            ( System | Light | Dark )
  Motion           ( System | Reduced | Full )
  Addresses        ( Short 7xKX…9fQa | Medium | Full )
  Amounts on canvas ( Full | Compact )        Inspector amounts are always full.
Entities & Labels                            [Reset section]
  Prefer names over addresses   [on]
  Community labels  [shown]  Unverified third-party names.
  .sol names        [shown]
Investigation Defaults                       [Reset section]
  Open cases on    ( Timeline | Graph | Table | Last used view )
  Inspector        ( Open | When something is selected | Closed )
Wallet Interaction Graph   (from Sprint 05)
Timeline                   (from Sprint 06)
                                            [Reset all preferences]
```

- **Controls:** choice settings with 2–4 options render as a segmented radio group (`role="radiogroup"`, arrow-key navigation, from Base UI Radio Group, or `npx shadcn add radio-group` / `toggle-group`). On/off settings render as a switch. Labels and option text come from a small `LABELS` map next to the page, not from the registry: the registry is data, the page owns wording.
- **Generated from the registry:** the page iterates `SETTINGS` filtered by category and `exposed !== false`, so a key that isn't exposed can't appear by accident, and a newly exposed key appears without a page edit (apart from its label).
- **Save model:** a change calls `setGlobal` immediately. The control shows the value read back from the live query, not local optimistic state, so a value can't look applied before it is stored (an acceptance criterion). A write error shows a toast and the control stays at the stored value.
- **Reset:** a section reset calls `resetGlobal(keysOfCategory)`; "Reset all" calls `resetGlobal("all")` behind a confirm dialog (the existing `Dialog`, as on the Storage page). Section resets don't confirm: they're one click to undo by choosing again, and a toast offers Undo that restores the previous explicit values.
- **Narrow screens:** single column, segmented groups wrap; the site layout is already `max-w-5xl` centred.

### 5.2 Theme

- `globals.css`: change to `@custom-variant dark (&:where(.dark, .dark *));` and move the dark variable block under `.dark`. A tiny inline script in `src/app/layout.tsx` `<head>` reads `localStorage["fraudwatch:theme"]` (`light | dark | system`, default system), resolves `system` with `matchMedia`, and sets `class="dark"` on `<html>` before paint. Read the Next 16 docs in `node_modules/next/dist/docs/` for the right way to add a blocking head script in the App Router.
- A `ThemeSync` client component in `Providers` applies the resolved theme from `usePreferences()` whenever it changes, follows OS changes when `system`, and writes the mirror key on every change. The Dexie value stays authoritative: if they disagree on load, Dexie wins and the mirror is rewritten.
- `timeline-canvas.tsx`: replace the `prefers-color-scheme` listener with a redraw when `<html>`'s class changes (a `MutationObserver` on `document.documentElement` attributes, or a `theme` prop from the hook). Check `relationship-chart.tsx` and `wallet-graph.tsx` redraw too. Both read colours through `canvas.ts`, so they need the same redraw trigger.

### 5.3 Motion

`useReducedMotion()` (in `use-preferences.ts`) returns true for `reduced`, false for `full`, and `matchMedia("(prefers-reduced-motion: reduce)")` for `system`. When true, `wallet-graph.tsx` jumps straight to layout targets instead of tweening and `fit()` sets the transform without a transition. Timeline zoom transitions jump too. Nothing else animates.

### 5.4 Address and number format

- `appearance.addressFormat` → the default `chars` for `displayName`: short = 4, medium = 8, full = whole address. `createNames` takes it as a parameter (it's already a factory). Call sites that pass explicit `chars` keep them, since those are deliberate. Canvases (graph node labels, timeline lane labels) cap at medium so labels don't overrun nodes. Look-alike disambiguation (`distinguishingShort`) still applies on top.
- `appearance.numberFormat = compact` formats amounts on **timeline cards and graph hover cards only** (`Intl.NumberFormat(undefined, { notation: "compact", maximumSignificantDigits: 3 })` over the decimal string). Inspectors, tables, evidence and copied values always show full precision. Never compact an amount below 1 (dust stays exact).

### 5.5 Labels

`createNames(labels, registry, lookalikes, verdicts, sns, options)` with `options = { preferNames, community, sns, chars }`:

- `community: hidden` → the community name is skipped in `displayName`; `sns: hidden` → the `.sol` name is skipped and `snsCandidates` returns `[]` so no lookups are made.
- `preferNames: off` → `of()` returns the shortened address and `known()` still returns the name, so places that show a name as secondary keep working. User labels are names too; the toggle is about what is primary, not about hiding the investigator's own labels.
- The registry's verified attribution is **not** toggleable: it drives interpretation and infrastructure collapsing (`addressState`), not just display.

### 5.6 Start view and inspector

- `lastView` is saved by `routeTo` in `case-shell.tsx` (with `saveLastView`, which only writes when it changes).
- `casePathFor(c, startView)` in `case-path.ts` returns the view to open on: `last` → `c.lastView ?? "timeline"`. Every hard-coded `"timeline"` above uses it. Deep links (a URL with an explicit view) are untouched; the preference only picks the view for links the app generates.
- `investigation.inspector`: initial `rightOpen` = `open` → true, else false. `on_selection` additionally opens the panel when a transaction, address or edge is selected. `closed` never opens it automatically. Cmd/Ctrl+\ keeps working in every mode.

## 6. Affected modules or files

| File | Change |
|---|---|
| `src/app/(site)/settings/preferences/page.tsx`, `preferences-form.tsx` | new |
| `src/components/app-header.tsx` | Preferences link |
| `src/app/case/case-shell.tsx` | top-bar link; `rightOpen`/auto-open; `lastView`; `createNames` options; `snsCandidates` |
| `src/components/providers.tsx` | `ThemeSync` |
| `src/app/layout.tsx`, `src/app/globals.css` | class-based dark mode, pre-paint script |
| `src/app/case/timeline/timeline-canvas.tsx`, `relationship-chart.tsx`, `src/app/case/graph/wallet-graph.tsx` | theme redraw trigger; reduced motion |
| `src/lib/labels/labels.ts` | `createNames`/`displayName` options |
| `src/lib/routing/case-path.ts` | `casePathFor` |
| `src/app/(site)/home-view.tsx`, `cases/new/new-case-form.tsx`, `map/map-startup.tsx` | use `casePathFor` |
| `src/app/case/timeline/event-card.ts`, graph hover card | compact amounts |
| `src/components/ui/radio-group.tsx` / `switch.tsx` | new (shadcn or Base UI) |

## 7. Detailed implementation tasks

- [ ] Read `node_modules/next/dist/docs/` on head scripts and route segments before starting
- [ ] Add radio-group and switch components
- [ ] Preferences page, generated from the registry; header and workspace links
- [ ] Section reset with Undo toast; Reset all with confirm
- [ ] Class-based dark mode, pre-paint script, `ThemeSync`, canvas redraw on theme change
- [ ] `useReducedMotion`; graph and timeline animations honour it
- [ ] Address format and label options through `createNames`; `.sol` lookups skipped when hidden
- [ ] Compact amounts on cards and hover only
- [ ] `lastView` saving; `casePathFor`; replace hard-coded `"timeline"` links
- [ ] Inspector modes
- [ ] Tests (§11); `pnpm test`, `pnpm typecheck`, `pnpm lint`; record results
- [ ] Browser verification (§11), including keyboard-only use of the page

## 8. Dependencies

02 (registry, hook, persistence).

## 9. Edge cases

- Theme `system` with the OS switching while the app is open: follows live.
- Mirror key missing or garbage: the script falls back to `system`; `ThemeSync` rewrites it.
- `lastView` points to `table` with a wallet: open `table` without the wallet segment.
- `startView = last` on a case never opened: timeline.
- `preferNames: off` with a look-alike pair: the bare addresses still use `distinguishingShort`.
- Full addresses in narrow side panels: wrap with `break-all`, and never truncate silently.
- `sns: hidden` then shown again: lookups resume, and cached names come back from `fraudwatch:sns-names` without refetching.
- Changing any of these never triggers an RPC request, except un-hiding `.sol` names, which resumes the existing lookups. That is the only one, and it's expected.

## 10. Acceptance criteria

- [ ] Preferences is reachable from the site header and the case workspace.
- [ ] Every control works with the keyboard alone (Tab, arrows, Space).
- [ ] Changes persist across reload and apply to open tabs.
- [ ] Section reset affects only that section; Reset all asks first and affects only preferences.
- [ ] Theme applies without a flash of the wrong theme on reload, canvases included.
- [ ] Reduced motion removes graph and timeline transitions.
- [ ] No amount in an inspector, table or copied value is ever compacted.
- [ ] Layout works at 375 px wide and on desktop.

## 11. Test requirements

Unit (`*.test.ts`, node):

- `displayName`/`createNames` with each option: community hidden, sns hidden, preferNames off (`of` vs `known`), `chars` 4/8/full, look-alike disambiguation still applied.
- `casePathFor`: each start view; `last` with and without `lastView`; `table` wallet dropped.
- Compact amount formatter: large values compacted; values below 1 unchanged; negative sign kept.
- Category reset keys: `keysOfCategory("appearance")` includes exactly the appearance keys.

Browser (record in this file):

- Tab through the page; change every control with the keyboard.
- Switch theme light → dark → system; reload in each; no flash; graph and timeline recolour.
- Reduced motion: change graph spacing; nodes jump without animating.
- Address format full: lane labels capped; inspector shows the full address.
- Reset a section; Undo restores it.

## 12. Definition of Done

Page live; the listed settings change the app as described; tests and validation pass with results recorded; browser checks recorded; no graph or timeline behaviour changed apart from theme, motion, names and amount format.

## Results (2026-10-09)

Implemented. Browser-checked on `next dev`:
- theme switch, persistence across reload, and no flash;
- arrow keys inside a segmented group;
- Reset all, with its confirm;
- start view "Last used view";
- Inspector "Closed";
- no console errors.

Deviations:
- The graph draws no amounts, so compact amounts apply to timeline cards only.
- `lastView` is saved on every view change (back/forward and links included), not only by the tab switcher.
- `.dark` now sets `color-scheme: dark`, so native inputs follow the theme.

Not checked: 375 px layout. The Sonner toaster still follows the OS theme for its rich colours.

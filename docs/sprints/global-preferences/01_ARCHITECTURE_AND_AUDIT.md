# Sprint 01 — Architecture and Existing System Audit

**Status:** Done (documentation only, 2026-10-08). Audited at `04f121b` on `timeline-pill-clearance`.
**Baseline:** `pnpm test` → 14 files, 142 tests passed. `pnpm typecheck` → clean.

## 1. Sprint objective

Record what exists, decide where every preference lives and who reads it, and fix the persistence, resolution and migration design before any code is written.

## 2. Current implementation findings

### 2.1 Platform

| Concern | Finding |
|---|---|
| Framework | Next.js 16.3 App Router, React 19.2, TypeScript. `AGENTS.md`: read `node_modules/next/dist/docs/` before writing Next code. |
| Styling | Tailwind v4 (`src/app/globals.css`), shadcn/Base UI components in `src/components/ui/` (alert, badge, button, card, checkbox, dialog, field, input, label, sonner, textarea). There is **no** select, switch, radio-group, popover or tabs component. Graph toolbars use native `<select>`. |
| State management | No global store (no Redux/Zustand/Context store). Workspace state is `useState`/`useMemo` in `CaseWorkspace` (`src/app/case/case-shell.tsx`, ~1,500 lines). Persistent state is read reactively with `useLocalQuery` (`src/hooks/use-local-db.ts`, Dexie `useLiveQuery`). |
| Persistence | IndexedDB through Dexie 4 (`src/lib/db/db.ts`, schema v4). Tables: `cases`, `rpc_settings`, `transactions`, `raw_transactions`, `wallet_transactions`, `coverage`, `ingestion_jobs`, `meta`, `wallet_states`, `token_metadata`, `address_labels`. The class comment already anticipates "Later sprints add ui_state in its own version block." |
| Server | None for data. `next.config.ts` serves the UI only. No accounts or auth, and by design (`docs/00_README.md`) there won't be. Preferences therefore stay browser-local. |
| Routing | `(site)` group: `/`, `/cases/new/`, `/map/`, `/settings/rpc/`, `/settings/storage/`. Case workspace: `/case/<id>/<view>[/<wallet>]`, where view is `timeline | graph | table` (`src/lib/routing/case-path.ts`). `trailingSlash: true`. |
| Tests | Vitest, `environment: "node"`, only `src/**/*.test.ts`. No component or DOM tests and no fake IndexedDB: DB code is tested against hand-written table stubs (`rpc-settings.test.ts`, `derived.test.ts`). UI is verified in the browser (see `docs/MISTAKES.md`). |
| Formatter | None configured. Don't run Prettier (`docs/MISTAKES.md`, 2026-10-03). |

### 2.2 Views that exist

| View | Code | Notes |
|---|---|---|
| Timeline | `src/app/case/timeline/wallet-timeline.tsx`, `timeline-canvas.tsx`, `relationship-chart.tsx` | Canvas. Lanes per mapped wallet; zoom-driven cluster pills (`BUCKET_MIN`, `chooseBucket`); cross-lane connectors merged into trunks (`mergeConnectors`, `CONNECTOR_MERGE = 40`), always drawn, with the selected one highlighted. Fixed geometry constants (`CARD_W 150`, `CARD_H 64`, `CARD_GAP 22`, `LANE_BAND`). Session state: spacing mode `time | event`, chart `lanes | relationships`, `showBehavior`. |
| Wallet Interaction Graph | `src/app/case/graph/wallet-graph.tsx`, `src/lib/graph/build.ts`, `src/lib/graph/layout.ts` | Canvas, d3-zoom. Deterministic layout (`layoutGraph`), not force-directed. Spacing presets `SPACINGS = { compact, normal, wide, widest }`. Arrowheads carry direction; **no edge labels are drawn** (detail lives in hover cards and `edge-panel.tsx`). Layout changes animate over 320 ms, and `fit()` animates. |
| Table | `src/app/case/wallet-state-view.tsx` | Per-wallet transaction table, with hidden rows on request. |
| Trace Graph | **Does not exist.** No code, branch or sprint doc. The nearest plan is `ROADMAP.md` §1 "Investigation graph" (investigator-built graph, suggestions, undo, snapshots). |
| "Overview" | **Does not exist.** |

### 2.3 Existing settings and configuration (every one found)

| Setting | Where | Scope | Persisted | Note |
|---|---|---|---|---|
| RPC endpoint | `rpc_settings` table, `/settings/rpc/` | Global | Dexie | Not a display preference; stays as is. |
| Graph spacing | `wallet-graph.tsx` `SPACING_KEY = "fraudwatch:graph-spacing"` | Global (effectively) | `localStorage` | **Migrate** into preferences (Sprint 02). |
| Graph ranking | `case-shell.tsx` `graphRanking` | Session | No | Stays a session control. |
| Graph node limit (10/25/50/100/All, default 25) | `case-shell.tsx` `graphNodeLimit` | Session | No | Becomes the default for `graph.nodeLimit`. |
| Program calls on graph | `case-shell.tsx` `showPrograms` (default off) | Session | No | Becomes `graph.programs`. |
| Expanded clusters / entities | `case-shell.tsx` `graphClusters`, `graphEntities` | Session | No | The initial `known` cluster state comes from `graph.knownServices`. |
| Left/right panels open | `case-shell.tsx` `leftOpen`, `rightOpen` (both `true`) | Session | No | `rightOpen` initial value comes from `investigation.inspector`. |
| Transaction filter | `TxFilter` in `case-shell.tsx` | Session | No | **Not** a preference. Untouched. |
| Hidden lanes, lane order, hidden signatures, hide rules, bookmarks | `FraudWatchCase` | Case | Dexie | Investigation data, **not** preferences. Untouched. |
| Table hide hint seen | `localStorage` `fraudwatch:table-hide-hint-seen` | Global | `localStorage` | One-off onboarding flag; not a preference. Leave. |
| `.sol` name cache | `localStorage` `fraudwatch:sns-names` | Global | `localStorage` | Cache; not a preference. Leave. |
| Theme | `globals.css` `@custom-variant dark (@media (prefers-color-scheme: dark))`; `timeline-canvas.tsx:898` listens to `matchMedia` | OS | — | No user control. Canvas colours come from CSS variables (`src/app/case/canvas.ts`, `getComputedStyle`). |
| Reduced motion | Not handled anywhere | — | — | Graph layout and fit animations ignore `prefers-reduced-motion`. |

### 2.4 Formatting and naming utilities to reuse

- `shortenAddress(address, chars = 4)` in `src/lib/solana/address.ts`. Called with explicit `chars` (4, 6) at many sites.
- `displayName` / `createNames` in `src/lib/labels/labels.ts` is the **single name resolver**. Its order is user label → registry → community list → `.sol` name → shortened address, and look-alikes are shortened just far enough to tell apart (`distinguishingShort`). Label preferences belong here and nowhere else.
- `withGraphNames` (`build.ts`) adds names for the burn and entity nodes.
- `formatBaseUnits` (`src/lib/solana/amount.ts`), `formatAssetAmount`, `assetLabel`, `formatUtc`, `formatUtcMinute` (`src/app/case/asset-format.ts`). Amounts are always full precision today. There is no compact formatting and **no fiat pricing anywhere**.
- `isDust(assetId, amount, decimals)` (`src/lib/labels/lookalikes.ts`) is the existing low-value rule (SOL below `DUST_SOL_LAMPORTS`, tokens below one whole unit). Reuse it for low-value treatment rather than inventing a threshold.

### 2.5 Where derived work runs (performance boundaries)

All in `CaseWorkspace`, memoised (`docs/ARCHITECTURE.md`, "Where work runs"):

```text
transactions ─► semanticEvents ─► summariesByWallet ─► filterables ─► reasons (hiding) ─► perWallet (filter + hiding)
                                                                                         ├─► lanes ─► WalletTimeline
                                                                                         └─► graph = buildInteractionGraph(...) ─► WalletGraph ─► layoutGraph
names = createNames(labels, registry, lookalikes, verdicts, snsNames)  (also a dependency of graph and lanes)
```

Preference changes must enter this chain as late as possible:

| Effect class | Re-runs | Examples |
|---|---|---|
| Draw | the canvas `draw` only | theme, motion, arrows, connectors, lane density, number format |
| Layout | `layoutGraph` | spacing |
| Graph build | `buildInteractionGraph` + layout | node limit, programs, known services, low-value |
| View filter | timeline item list | timeline program/NFT visibility |
| Names | `createNames` and everything that reads `names` | address format, label sources |

None of them touch ingestion, `useWalletStates`, interpretation or the RPC.

### 2.6 Case persistence and workspace state

- The case record (`FraudWatchCase`, `src/lib/case/model.ts`) holds investigation data and is written whole with `getDb().cases.put(next)` from `updateCase` in `case-shell.tsx`, which reads `c` from render (a `latestCase` ref exists for undo).
- `deleteCase` removes the case, its labels and its last-load record. `clearTransactionCache` leaves cases and settings alone. `clearAllLocalData` deletes the whole database.
- **No viewport, zoom, selection or graph positions are persisted.** Graph node drags live in a ref and are **reset whenever the layout recomputes** (`wallet-graph.tsx`, the layout effect replaces `positions` with the new layout targets).
- Case export/import is planned (MVP `SPRINT_10_BOUNDARY_CONTEXT_PORTABILITY.md`) but **not implemented**.

## 3. Scope

- Inventory (above), architecture, ownership matrix, persistence strategy, migration approach, dependency map.

## 4. Out of scope

- Any code change. Any redesign of filters, hiding, or the graph and timeline engines.

## 5. Technical approach (the finalized architecture)

### 5.1 Modules

| Module | Purpose | Sprint |
|---|---|---|
| `src/lib/preferences/schema.ts` | `SETTINGS` registry: key, allowed values, default, scope, preset-controlled flag, exposed flag; `SettingKey`/`SettingValue` types; `validateValue`; `PREFERENCES_SCHEMA_VERSION`; `migrateValues` | 02 |
| `src/lib/preferences/resolve.ts` | `resolvePreferences(layers)` returns values and origins; `presetValues` hook-in point | 02 (presets filled in 04) |
| `src/lib/preferences/presets.ts` | Built-in detail presets; customised-state check | 04 |
| `src/lib/db/preferences.ts` | Read, write and reset the global row; legacy `localStorage` import | 02 |
| `src/lib/case/view-settings.ts` | Pure case-override updaters (the pattern of `hiding.ts`) and the field-level save | 02 |
| `src/hooks/use-preferences.ts` | `usePreferences(caseId?)` returns `{ status, get(key), origin(key), set, reset }` | 02 |
| `src/app/(site)/settings/preferences/` | Global Preferences page | 03 |
| `src/app/case/view-settings-panel.tsx` | In-view View Settings popover, shared by graph and timeline | 05 (extended in 08) |

### 5.2 Storage

| Data | Where | Why |
|---|---|---|
| Global values | New Dexie table `preferences` (schema **v5**), one row `{ id: "global", schemaVersion, values, updatedAt }` | Mirrors `rpc_settings` (single row, `id`). Reactive through `useLocalQuery`, including across tabs. Survives "Clear transaction cache"; removed by "Delete all local data". |
| Case overrides | `FraudWatchCase.viewSettings?: { schemaVersion, values, appliedPreset? }` | Owned by the case: deleted with it, exported with it once case export exists, and never shared between cases. |
| Last view per case | `FraudWatchCase.lastView?: CaseView` | Workspace restoration (Layer 3, persisted), needed for start view "Restore last". Not a preference. |
| Custom presets | Dexie table `view_presets` (schema **v6**) | Sprint 09. Not created earlier (no speculative tables). |
| Theme mirror | `localStorage["fraudwatch:theme"]` | Only so a blocking `<head>` script can set the theme class before paint. Written whenever the global theme is written; never read as truth. |

`values` is **sparse**: only keys the user set. Unknown keys are kept, invalid ones are ignored (see Sprint 02).

### 5.3 Preference ownership matrix

Scope: `G` = global only, `G+C` = global default with per-case override. Preset: controlled by detail presets (Sprint 04). Exposed: shown in UI in this initiative.

| Key | Values (default **bold**) | Scope | Preset | Exposed | Consumer (verified file) | Effect class | Sprint |
|---|---|---|---|---|---|---|---|
| `appearance.theme` | **system**, light, dark | G | — | ✓ | `src/app/layout.tsx`, `globals.css`, `timeline-canvas.tsx` theme listener, `canvas.ts` | Draw | 03 |
| `appearance.motion` | **system**, reduced, full | G | — | ✓ | `wallet-graph.tsx` layout and fit animations; `timeline-canvas.tsx` zoom animations | Draw | 03 |
| `appearance.addressFormat` | **short** (4…4), medium (8…8), full | G | — | ✓ | `displayName`/`createNames` (`labels.ts`); canvases cap at medium | Names | 03 |
| `appearance.numberFormat` | **full**, compact | G | — | ✓ | Timeline card amounts (`event-card.ts`), graph hover card. Inspectors and evidence always full. | Draw | 03 |
| `labels.preferNames` | **on**, off | G+C | — | ✓ | `createNames` (off = address first, name secondary) | Names | 03 |
| `labels.community` | **shown**, hidden | G+C | — | ✓ | `displayName` `other.community` | Names | 03 |
| `labels.sns` | **shown**, hidden | G+C | — | ✓ | `displayName` `other.sns`; skips the lookup in `useSnsNames` when hidden | Names | 03 |
| `investigation.startView` | **timeline**, graph, table, last | G | — | ✓ | `home-view.tsx`, `new-case-form.tsx`, `map-startup.tsx` (`buildCasePath`) | Navigation | 03 |
| `investigation.inspector` | **open**, on_selection, closed | G | — | ✓ | `case-shell.tsx` `rightOpen` initial value and auto-open on selection | Workspace | 03 |
| `investigation.detailPreset` | minimal, **balanced**, forensic (custom ids in 09) | G | — | ✓ | `resolve.ts` preset layer | — | 04 |
| `graph.nodeLimit` | 10, **25**, 50, 100, all | G+C | ✓ | ✓ | `case-shell.tsx` → `buildInteractionGraph({ maxNodes })` | Graph build | 05 |
| `graph.programs` | **hidden**, shown | G+C | ✓ | ✓ | `buildInteractionGraph({ showPrograms })` | Graph build | 05 |
| `graph.knownServices` | **collapsed**, expanded | G+C | ✓ | ✓ | Initial `graphClusters` (`known`) | Graph build | 05 |
| `graph.lowValue` | **shown**, faded, hidden | G+C | ✓ | ✓ | `buildInteractionGraph` (new `lowValue` option using `isDust`); `WalletGraph` draw | Graph build / draw | 05 |
| `graph.spacing` | compact, **normal**, wide, widest | G+C | — | ✓ | `layoutGraph(…, SPACINGS[spacing])` | Layout | 05 |
| `graph.arrows` | **all**, selected | G+C | — | ✓ | `WalletGraph` arrowhead draw | Draw | 05 |
| `graph.confirmLarge` | **on**, off | G | — | ✓ | Confirm before "All" or a cluster expansion above 200 drawn addresses | — | 05 |
| `timeline.density` | compact, **comfortable**, spacious | G+C | — | ✓ | `timeline-canvas.tsx` geometry constants become a density table | Draw | 06 |
| `timeline.connectors` | **always**, hover, selected | G+C | ✓ | ✓ | `timeline-canvas.tsx` trunk drawing | Draw | 06 |
| `timeline.programInteractions` | **shown**, hidden | G+C | ✓ | ✓ | `WalletTimeline` items (category `PROGRAM_INTERACTION`) | View filter | 06 |
| `timeline.nft` | **shown**, hidden | G+C | — | ✓ | `WalletTimeline` items (`NFT_TRADE`, `NFT_TRANSFER`, `NFT_MINT`) | View filter | 06 |
| `trace.*` (8 keys) | see Sprint 07 | G+C | some | ✗ | none yet | — | 07 |

"Balanced" equals the defaults, and the defaults equal **today's behaviour**, so nobody's view changes on upgrade.

### 5.4 Requested options deliberately not included

Each is excluded because nothing real would back it today. Each can be revisited in Sprint 10 or when its feature exists.

| Requested | Why not now |
|---|---|
| Interface density (whole app) | No density system; every panel uses fixed Tailwind spacing. A real implementation is an app-wide restyle. Timeline density and graph spacing cover the dense views. |
| Value representation (USD / Both) | No pricing source exists. Showing fiat without one would be fabrication. |
| Start view "Overview" | No overview view exists. |
| Restore saved workspace position / fit newly opened graph | No viewport is persisted; the graph always fits on open. The option would have no alternative behaviour. |
| Graph edge labels (Always/Hover/Selected) | The graph draws no edge labels by design (`wallet-graph.tsx` header comment); detail lives in hover cards and the edge panel. |
| Graph animation (separate setting) | Duplicates `appearance.motion`. One motion setting covers every view. |
| Graph fee presentation | Network fees never form graph connections; NFT fee and royalty legs already stay inside their trade (`build.ts`). There's nothing to toggle. |
| Timeline fee presentation | Cards are fixed-height and show only main flows (`event-card.ts` `MAIN`); fees are always in the event inspector. Revisit if cards gain an optional detail line. |
| Timeline token-movement visibility | Already covered by the asset filter (`hiddenAssets`), which is per-asset and more precise. |
| Repetitive-activity aggregation toggle | Today's grouping is zoom-driven and required for legibility. Grouping repeated runs is a feature (`ROADMAP.md` §6), not a preference. |
| Entity category badges, protocol names, service identities | Covered by `labels.preferNames`. There is no separate badge renderer to toggle. |
| Risk annotations visibility | The only annotations are look-alike/decoy warnings (address poisoning). Hiding a safety warning by preference is unsafe; they stay on. |

## 6. Affected modules or files

None in this sprint. Later sprints touch the files named in §5.3. The new files are listed in §5.1.

## 7. Detailed implementation tasks

- [x] Inventory platform, views, settings, persistence, utilities, tests
- [x] Decide storage, resolution order and module layout
- [x] Ownership matrix with consumer and effect class for every key
- [x] Record excluded options with reasons
- [x] Write sprint documents 00–10

## 8. Dependencies

None.

## 9. Edge cases (design decisions recorded here)

- **IndexedDB unavailable** (some private modes): `useLocalQuery` already returns an error state. Preferences fall back to defaults, read-only, and the Preferences page shows the storage error like the Storage page does.
- **Two tabs open:** Dexie live queries propagate writes, so both tabs see the same values.
- **"Delete all local data"** removes preferences along with everything else. "Clear transaction cache" doesn't touch them.
- **Downgrade** (an older app reading newer data): unknown keys are preserved on write, and values a version doesn't understand are ignored.

## 10. Acceptance criteria

- [x] Every proposed preference has a defined owner (§5.3).
- [x] There is no competing source of truth: one global row, one case field, one future presets table, and a theme mirror documented as non-authoritative.
- [x] Existing settings are reused: graph spacing values, node-limit values, `showPrograms`, cluster expansion, `isDust`, `createNames`.
- [x] Graph rendering and data ingestion stay separate: no key reaches ingestion, wallet-state reconstruction or interpretation.

## 11. Test requirements

None (documentation sprint). The baseline was recorded above for later comparison.

## 12. Definition of Done

Audit and sprint plans are committed for review. No code changed.

## Implementation dependency map

```text
schema.ts ◄── resolve.ts ◄── presets.ts (04)
    ▲             ▲
    │             │
db/preferences.ts  case/view-settings.ts
    ▲             ▲
    └── hooks/use-preferences.ts ──► settings/preferences page (03)
                                 ──► case-shell.tsx ──► WalletGraph (05) / WalletTimeline (06) / createNames (03)
```

## Open decisions for the reviewer

1. **Precedence of presets below explicit global values** (00_README). Recommended; it's the only order where manual changes after picking a preset stick.
2. **Graph spacing becomes per-case-overridable.** Today the toolbar choice applies to every case. After Sprint 05 the toolbar writes a case override, and "Use for all cases" in View Settings writes the global value. Alternative: keep the toolbar global, at the cost of one more exception to "local controls don't write global".
3. **Theme mirror in `localStorage`.** Needed to avoid a flash of the wrong theme because IndexedDB is async. Alternative: accept a one-frame flash and drop the mirror.

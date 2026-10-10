# Sprint 02 — Preference Schema, Persistence and State

**Status:** Implemented 2026-10-09, uncommitted in the working tree; awaiting review. Results at the end of this file.
**Depends on:** 01

## 1. Sprint objective

Build the configuration system with no visible settings yet: the registry of settings, validation, migration, global persistence, case-override storage, resolution with origins, and the React hook every later sprint reads through. After this sprint the app behaves exactly as before, but the plumbing exists.

## 2. Current implementation findings

- No preference store exists. The only persisted display choice is `localStorage["fraudwatch:graph-spacing"]` (`src/app/case/graph/wallet-graph.tsx:18`), with values `compact | normal | wide | widest`.
- Dexie schema is at v4 (`src/lib/db/db.ts`). Single-row settings already have a pattern: `rpc_settings` with `id: "default"`, accessed through `src/lib/db/rpc-settings.ts`.
- Reactive reads go through `useLocalQuery` (`src/hooks/use-local-db.ts`).
- Pure case updaters that return a new case are the house style (`src/lib/case/hiding.ts`, `lanes.ts`, `bookmarks.ts`).
- DB tests use in-memory table stubs (`src/lib/db/rpc-settings.test.ts`). There's no fake-indexeddb dependency; don't add one.
- No validation library is installed. Validation is hand-written, which is enough for enum-valued settings.

## 3. Scope

- `SETTINGS` registry with every exposed key from the 01 ownership matrix (`trace.*` keys are added by Sprint 07)
- Validation, schema version, migrations
- Dexie v5 `preferences` table, read/write/reset functions, legacy spacing import
- `FraudWatchCase.viewSettings` and `FraudWatchCase.lastView` fields, plus pure override updaters
- Resolution with origins, including the preset layer interface (Sprint 04 fills in the preset values)
- `usePreferences` hook

## 4. Out of scope

- Any visible UI (Sprint 03)
- Built-in preset contents (Sprint 04)
- Connecting graph or timeline (Sprints 05, 06)
- The `view_presets` table (Sprint 09)

## 5. Technical approach

### 5.1 Registry (`src/lib/preferences/schema.ts`)

```ts
type Scope = "global" | "case";          // "case" = global default, overridable per case
type SettingDef<V extends string> = {
  values: readonly V[];                  // every setting is an enum; numbers are encoded as strings ("25", "all")
  default: V;
  scope: Scope;
  preset?: true;                         // controlled by detail presets
  exposed?: false;                       // defined and validated, not shown (trace.*)
};

export const SETTINGS = {
  "appearance.theme": { values: ["system", "light", "dark"], default: "system", scope: "global" },
  "graph.nodeLimit": { values: ["10", "25", "50", "100", "all"], default: "25", scope: "case", preset: true },
  // … every key in 01 §5.3
} as const satisfies Record<string, SettingDef<string>>;

export type SettingKey = keyof typeof SETTINGS;
export type SettingValue<K extends SettingKey> = (typeof SETTINGS)[K]["values"][number];
export type PreferenceValues = Partial<{ [K in SettingKey]: SettingValue<K> }>;
export const PREFERENCES_SCHEMA_VERSION = 1;
export const categoryOf = (key: SettingKey) => key.split(".")[0];   // appearance | labels | investigation | graph | timeline | trace
```

Every setting is an enum on purpose: it makes validation a membership check and every UI control a list of choices. Don't add a free-form or numeric setting without adding its validator here.

### 5.2 Stored documents

```ts
// preferences table row
type GlobalPreferencesRecord = { id: "global"; schemaVersion: number; values: Record<string, unknown>; updatedAt: string };

// on FraudWatchCase (src/lib/case/model.ts)
viewSettings?: { schemaVersion: number; values: Record<string, unknown>; appliedPreset?: { id: string; name: string; at: string } };
lastView?: CaseView;
```

`values` is **sparse**. Only explicit choices are stored, and an absent key means "inherited". `values` is typed `Record<string, unknown>` at rest because stored data is untrusted. Typed access goes only through `readValues`.

### 5.3 Validation and migration

```ts
/** Known keys with valid values, typed. Unknown keys and invalid values are left out; nothing throws. */
export function readValues(raw: unknown, scope: "global" | "case"): { values: PreferenceValues; invalid: string[] };
/** Raw stored values brought from `fromVersion` to the current version. Pure; idempotent at the current version. */
export function migrateValues(raw: Record<string, unknown>, fromVersion: number): Record<string, unknown>;
```

Rules:

1. A row or field that isn't an object, or whose `values` isn't an object, reads as `{}`. **It is not overwritten** until the user changes a setting, so a corrupted value is never "repaired" by deletion behind their back.
2. A known key with a value outside `values` is ignored (it resolves as inherited) and reported in `invalid` (the console warns once per key in development).
3. A key with scope `global` found in case overrides is ignored there.
4. Unknown keys (from a newer version, or removed ones) are **preserved** on write and ignored on read.
5. On write, known keys with invalid values are dropped, and unknown keys and the higher of the stored and current `schemaVersion` are kept.
6. `schemaVersion` greater than the code's: read whatever validates and keep writing safely (rule 5). Never downgrade the number.
7. `migrateValues` is a chain of `{ from, to, migrate }` steps. Version 1 has none; the chain exists so v2 doesn't reinvent it. Migration runs on read; the migrated form is written on the next write.

### 5.4 Resolution (`src/lib/preferences/resolve.ts`)

```ts
export type Origin = "default" | "preset" | "global" | "case";
export type Layers = { global: PreferenceValues; preset: PreferenceValues; caseOverrides?: PreferenceValues };
export type Resolved = { get<K extends SettingKey>(key: K): SettingValue<K>; origin(key: SettingKey): Origin };

export function resolvePreferences(layers: Layers): Resolved;
/** Values the active detail preset supplies; `{}` until Sprint 04. */
export function presetLayer(global: PreferenceValues): PreferenceValues;
```

Per key, highest wins:

```text
case override (scope "case" only) > global explicit > preset (preset-controlled keys only) > default
```

- Resolution is per key: there's no object spreading, and no nested merge to get wrong.
- `presetLayer` reads `investigation.detailPreset` from the global values. It is defined here and returns `{}` until Sprint 04 adds the built-in presets. Sprint 09 extends it to custom presets.
- `resolvePreferences` must be pure and cheap (a few dozen keys). It builds one plain object of resolved values and origins once per input change, so `get` is a lookup.

### 5.5 Persistence (`src/lib/db/preferences.ts`)

```ts
export async function getGlobalPreferences(db: FraudWatchDB): Promise<{ values: PreferenceValues; raw: GlobalPreferencesRecord | undefined }>;
export async function setGlobalPreference<K extends SettingKey>(db, key: K, value: SettingValue<K>): Promise<void>;
export async function resetGlobalPreferences(db, keys: readonly SettingKey[] | "all"): Promise<void>;   // removes keys → inherited
export async function importLegacyPreferences(db, storage: Pick<Storage, "getItem" | "removeItem"> | null): Promise<void>;
```

- Writes run inside a Dexie `rw` transaction (read the row, change one key, put) so two quick changes don't lose each other.
- Setting a key to the value it would inherit anyway still stores it (an explicit choice is an explicit choice). Only reset removes keys.
- `importLegacyPreferences`: if `fraudwatch:graph-spacing` holds a valid spacing **and** the global row has no `graph.spacing`, write it. Then remove the `localStorage` key either way. Idempotent; called once per connection, the way `ensureDerivedCachesCurrent` is.
- Dexie v5: `this.version(5).stores({ preferences: "id" })`. No upgrade function; nothing existing changes. Update the class comment's version list.

### 5.6 Case overrides (`src/lib/case/view-settings.ts`)

Pure updaters in the `hiding.ts` style:

```ts
export function setCaseOverride<C extends FraudWatchCase, K extends SettingKey>(c: C, key: K, value: SettingValue<K>, now?: Date): C;
export function clearCaseOverrides<C extends FraudWatchCase>(c: C, keys: readonly SettingKey[] | "all", now?: Date): C;
export function caseOverrides(c: FraudWatchCase): PreferenceValues;   // readValues(c.viewSettings?.values, "case")
```

They're saved with `db.cases.update(c.id, { viewSettings })` (a new `saveViewSettings(db, id, viewSettings)` beside `cases.ts`), **not** a whole-record `put`. That way an override can't overwrite a concurrent hide-rule or lane change made from a stale `c`. Setting a global-scope key as a case override throws (a programming error).

`lastView` is saved the same way, by `routeTo` in `case-shell.tsx` (Sprint 03 wires it).

### 5.7 Hook (`src/hooks/use-preferences.ts`)

```ts
export function usePreferences(fwCase?: FraudWatchCase): {
  status: "loading" | "ready" | "error";
  error?: string;
  get: Resolved["get"];
  origin: Resolved["origin"];
  setGlobal: <K extends SettingKey>(key: K, value: SettingValue<K>) => Promise<void>;
  resetGlobal: (keys: readonly SettingKey[] | "all") => Promise<void>;
  setForCase: <K extends SettingKey>(key: K, value: SettingValue<K>) => Promise<void>;   // requires fwCase
  resetForCase: (keys: readonly SettingKey[] | "all") => Promise<void>;
};
```

- Reads the global row with `useLocalQuery`. The case comes from the caller (the workspace already live-queries it), so no second case query is needed.
- While loading or on error, `get` returns defaults. Callers that would do expensive work twice (the graph layout) must wait for `status !== "loading"`. In `CaseLoader` this is one more condition beside the case query.
- **Render discipline:** consumers pass individual values (`get("graph.spacing")`), which are strings, into `useMemo` deps, never the whole hook result. That alone keeps unrelated preference changes from re-running memos.
- Write failures surface with `toast.error(describeStorageError(err))`, as other writes do.

## 6. Affected modules or files

| File | Change |
|---|---|
| `src/lib/preferences/schema.ts` | new |
| `src/lib/preferences/resolve.ts` | new |
| `src/lib/preferences/preferences.test.ts` | new |
| `src/lib/db/preferences.ts` | new |
| `src/lib/db/preferences.test.ts` | new |
| `src/lib/case/view-settings.ts` | new |
| `src/hooks/use-preferences.ts` | new |
| `src/lib/db/db.ts` | v5 table, `preferences` property, comment |
| `src/lib/case/model.ts` | `viewSettings?`, `lastView?` fields |
| `src/lib/db/cases.ts` | `saveViewSettings`, `saveLastView` |
| `src/app/case/case-shell.tsx` | `CaseLoader` waits for preferences; calls `importLegacyPreferences` once |

## 7. Detailed implementation tasks

- [ ] Write `schema.ts` with every exposed key from 01 §5.3; check each default equals today's behaviour (cross-check `case-shell.tsx` initial `useState` values and `wallet-graph.tsx` spacing default)
- [ ] `readValues`, write-side sanitising, `migrateValues` chain (empty for v1)
- [ ] `resolve.ts` with `presetLayer` returning `{}`
- [ ] Dexie v5 `preferences` table
- [ ] `db/preferences.ts` read/write/reset in transactions; `importLegacyPreferences`
- [ ] `model.ts` fields; `view-settings.ts` updaters; `saveViewSettings`, `saveLastView`
- [ ] `usePreferences` hook; `CaseLoader` waits for it
- [ ] Tests (§11)
- [ ] `pnpm test`, `pnpm typecheck`, `pnpm lint`; record results here
- [ ] Browser check: open an existing case. The graph and timeline look exactly as before, and graph spacing chosen before the upgrade is kept (it still reads `localStorage` until Sprint 05, but the global row now holds it too).

## 8. Dependencies

01. Nothing visible depends on this sprint until 03.

## 9. Edge cases

| Case | Behaviour |
|---|---|
| No global row yet | All defaults; the row is created on first write |
| Row is a string, `null`, an array, or `values` is not an object | Read as `{}`; row left untouched until the next write |
| `graph.nodeLimit: 42` stored | Ignored → resolves from preset/default; reported in `invalid`; dropped on next write |
| `appearance.theme` in a case's overrides | Ignored (global-scope key) |
| `trace.direction` stored by a newer version, key unknown here | Preserved on write, ignored on read |
| Stored `schemaVersion: 3`, code at 1 | Valid known keys used; `schemaVersion` stays 3 on write |
| `fraudwatch:graph-spacing = "huge"` | Not imported; key removed |
| Legacy key present and global `graph.spacing` already set | Global wins; key removed |
| IndexedDB unavailable | `status: "error"`, defaults returned, writes rejected with a visible error |
| Case deleted while open | Existing "Case not found" path; nothing preference-specific |
| Two rapid `setGlobal` calls on different keys | Both persist (transactional read-modify-write) |

## 10. Acceptance criteria

- [ ] With no stored preferences, every resolved value equals the current hard-coded behaviour.
- [ ] Every resolved value reports a correct origin.
- [ ] Malformed or unknown stored data never throws and never deletes unrelated data.
- [ ] The global row and case overrides are the only stores; nothing reads `fraudwatch:graph-spacing` except the one-time import (and `wallet-graph.tsx` until Sprint 05 replaces it).
- [ ] Resetting preferences changes nothing outside `preferences` and `viewSettings`.
- [ ] No visible change to the app.

## 11. Test requirements

`src/lib/preferences/preferences.test.ts`:

- Every `SETTINGS` default is in its own `values`; every `preset: true` key has scope `case`.
- `readValues`: valid → typed; invalid value ignored and reported; unknown key ignored; non-object input → `{}`; global key in case scope ignored.
- `resolvePreferences`: default only; global beats default; case beats global; global-scope key ignores the case layer; preset layer sits between default and global (with a test preset passed in directly); origins correct for each.
- Determinism: the same layers give identical results; key order in stored objects doesn't matter.
- `migrateValues` at the current version returns an equal object.

`src/lib/db/preferences.test.ts` (stub-table style of `rpc-settings.test.ts`):

- Set → get round trip; reset one key; reset `"all"`; unknown keys survive a set; a corrupted row survives a read untouched and is replaced cleanly on the next set.
- `importLegacyPreferences`: imports a valid value; skips an invalid one; doesn't override an existing global value; removes the key in all cases; second run is a no-op.

`src/lib/case/view-settings.test.ts`:

- `setCaseOverride` / `clearCaseOverrides` leave every other case field (hide rules, lanes, bookmarks) identical.
- Setting a global-scope key throws.

## 12. Definition of Done

All tasks are checked, the tests above pass, `pnpm test` / `pnpm typecheck` / `pnpm lint` pass with results recorded here, and the browser check shows no visible change.

## Results (2026-10-09)

Implemented as planned. `pnpm test` 183 passed (20 files), `pnpm typecheck` clean, `pnpm lint` clean.
Deviation: case overrides are saved with `saveViewSettings` in `src/lib/case/view-settings.ts` (beside the updaters), not in `cases.ts`. The legacy spacing import runs from `usePreferences`, because Dexie live queries can't write.

# Sprint 11 — Export and Reproducibility

**Status:** Implemented on `trace-graph` (2026-10-15); merge pending
**Depends on:** 04, 09

## Summary and Why It Matters

Traces get shared with colleagues, exchanges and law enforcement. An export has to be reproducible (anyone with the signatures can verify every step on-chain) and honest about everything that isn't shown or isn't known. A picture alone isn't evidence, so the machine-readable export comes first.

## Verified Current Repository Findings

### Existing capabilities

- No export or import of any kind exists (case export is planned in `docs/sprints/SPRINT_10_BOUNDARY_CONTEXT_PORTABILITY.md`, not built).
- Debug bundle copy to clipboard: JSON of versions, canonical transaction, effect, summary, event and observations, with "no RPC URL, no labels" (`src/app/case/timeline/debug-details.tsx`, `docs/ARCHITECTURE.md`).
- `analysisVersions()` and `analysisFingerprint()` (`src/lib/semantic/versions.ts`).
- Canvas elements support `toBlob` natively (no dependency needed for PNG).
- Privacy rule: the RPC URL is never included in exports (`docs/00_README.md`, `docs/TERMINOLOGY.md`).

**Re-checked 2026-10-15.** Drift and decisions:

- There's no `trace-menu.tsx`; Export and Import are buttons in the trace header, and Import is also on the trace list.
- This plan both includes the `canvas` block and lists "include layout (off)". Resolved: a checkbox, **on** by default, because without it an import loses the investigator's diagram. Labels stay opt-in, off by default, and label notes are never exported.
- A file download helper already exists in the settings export (`saved-presets.tsx`); the same Blob-and-anchor approach is used.

### Gaps and limitations

- No PDF library installed. PDF is out of scope (post-MVP).

### Assumptions requiring confirmation

- Whether exports should include the investigator's own labels by default. Recommended: opt-in checkbox, off by default (labels can contain sensitive notes).

## Objectives and User Outcomes

- JSON export of a trace that a reviewer can verify step by step.
- PNG snapshot of the canvas with disclosures drawn in.
- Optional import of a trace JSON into a case that has the referenced data.

## In Scope

- `src/lib/trace/export.ts` (pure): build the export document; parse and validate an import
- Download (Blob + anchor) and file input UI in the trace menu
- PNG snapshot with a disclosure footer

## Explicitly Out of Scope

- PDF or report generation (post-MVP; `ROADMAP.md` §5 "Reports")
- Exporting raw transactions or the cache
- Cross-case or cross-browser case export (MVP Sprint 10)

## Architecture / Data Contracts / UX Decisions

### JSON document

```json
{
  "format": "fraudwatch-trace",
  "formatVersion": 1,
  "exportedAt": "2026-10-08T12:00:00.000Z",
  "chain": "solana",
  "analysis": { "parser": 0, "reconstruction": 0, "semantic": 9, "registry": 0, "fingerprint": "…" },
  "case": { "range": { "start": "…", "end": "…" } },
  "trace": {
    "name": "Hack proceeds",
    "seed": { "kind": "address", "address": "…" },
    "direction": "forward",
    "scope": { "assets": ["So111…"], "start": null, "end": null, "minAmount": null, "maxHops": 6 },
    "steps": [
      { "kind": "movement", "signature": "…", "eventIndex": 0, "assetId": "…", "from": "…", "to": "…",
        "amount": "12000000000", "decimals": 9, "role": null, "time": "…", "slot": 0,
        "key": "solana:…:event:0:mv:…", "category": "TRANSFER", "confidence": "HIGH", "status": "ok" }
    ]
  },
  "disclosures": {
    "attribution": "Steps are observed movements in time order. They don't establish that the same funds moved between steps.",
    "hiddenBranches": ["…"],
    "collapsedServices": [{ "protocol": "Binance", "addresses": ["…"] }],
    "boundaries": [{ "address": "…", "kind": "history_not_loaded" }],
    "staleSteps": ["…"],
    "incompleteHistory": ["…"]
  },
  "labels": { "…address…": { "name": "…", "tags": [] } }
}
```

- `analysis` values come from `analysisVersions()` at export time (the numbers above are placeholders).
- `steps` always contains **every** step, including hidden-branch and stale ones (with `status: "stale" | "hidden_branch" | "ok"`). Hiding affects the picture, not the record.
- `labels` is present only when the user ticks "Include my labels". Registry names are included as public attribution under each address in an `attribution` field (registry, protocol name, registry version).
- Never included: RPC URL, raw transactions, balances, other traces, cases' hide rules or bookmarks.
- Included as a separate `canvas` block, clearly marked "investigator presentation, not evidence": positions, node styles and annotations (D8/D9). Without it an imported trace would lose the investigator's diagram. Annotations are listed apart from steps in the JSON and drawn in the PNG with a legend entry "Dashed lines and notes are the investigator's annotations".

### Import

- Accepts `format: "fraudwatch-trace"`, `formatVersion ≤ 1`; size cap 5 MB; JSON parse errors reported.
- Creates a **new** trace in the current case (new id; name suffixed " (imported)" on clash).
- Steps whose signatures aren't loaded in this case become stale steps (02 rules). The import preview says "38 of 40 steps found in this case's loaded data; 2 will show as not loaded".
- No fetching on import.

### PNG snapshot

- Renders the current canvas at 2× into an offscreen canvas, plus a footer with: trace name, export time, scope, the attribution sentence, and counts of hidden branches, collapsed services, boundaries and stale steps. The file name includes the trace name and date.
- The snapshot dialog states that a picture isn't a complete record and offers the JSON alongside.

## Prerequisites and Dependencies

04 (storage), 09 (all states are inspectable, so disclosures are complete). 10 isn't required.

## Affected Modules and Proposed Files

- **Proposed new:** `src/lib/trace/export.ts`, `src/lib/trace/export.test.ts`, `src/app/case/trace/export-dialog.tsx`
- **Existing:** `src/app/case/trace/trace-menu.tsx` (Export, Import, Snapshot items), `trace-canvas.tsx` (snapshot render function)

## Implementation Plan

### Task Group A — Document

- [x] `exportTrace(trace, evidence, options)` → document; decimals from asset metadata; statuses; disclosures computed from the view
- [x] `parseTraceImport(json)` → `{ ok, trace, missing } | { ok: false, error }`
- [x] Tests

### Task Group B — UI

- [x] Export dialog: include labels (off), include layout (off), Download JSON
- [x] Import: file input, preview, confirm
- [x] Snapshot: PNG with footer; dialog note

## UI Behavior and Example Scenarios

- Export F3 trace: JSON with 2 steps (payment, nft) in one signature, `category: NFT_TRADE`, disclosures listing the custodial boundary if any.
- Import into a case missing one wallet: preview shows the 2 not-found steps; after import they appear stale with "Map wallet" in the inspector.

## Evidence / Data Integrity Invariants

- Every exported step carries signature, event index, movement key, asset, exact base-unit amount and decimals.
- Disclosures list everything hidden, collapsed, stale or incomplete. A test asserts that a trace with each condition produces each disclosure.
- Import never writes evidence tables or other traces.

## Edge Cases and Failure Recovery

- Export of a trace with stale steps: included with reference fields and `status: "stale"`.
- Unicode trace names: file names sanitised to `[a-z0-9-]`.
- An import from a future `formatVersion`: rejected with the version in the message.
- The same file imported twice: two traces (no dedupe; names suffixed).

## Performance Considerations

Export is O(steps). A 500-step document is ≈ 300 KB. Snapshot rendering at 2× for 300 nodes is a single draw.

## Tests and Fixtures to Add

- `export.test.ts`: round trip export → import yields an equal trace (except id, name, dates); disclosures for each condition; no RPC URL anywhere in the output (assert by searching the serialised string for the test URL); labels only when opted in; future version rejected; oversized rejected.

## Acceptance Criteria (observable and measurable)

- [x] Round-trip test passes; every disclosure test passes.
- [x] A reviewer can take the JSON and find every step's signature and movement on-chain (manual check of one F1 and one F3 export, recorded).
- [x] PNG includes the footer disclosures (browser check).

## Implementation Notes (2026-10-15)

- `src/lib/trace/export.ts`: `exportTrace(trace, view, evidence, options)` builds the document from the built view, so statuses and disclosures match what the canvas shows. Every step is exported with its id, signature, event index, movement key, asset, exact base-unit amount, decimals (asset metadata, else 9 for SOL, else `null`), role, UTC time, slot, current category and confidence, and `status` (`stale` › `hidden_branch` › `ok`). Conversion steps carry spent and received amounts with decimals. Disclosures: the attribution sentence, hidden branches, collapsed services with their real addresses, boundaries, stale steps, out-of-scope steps (added: the plan didn't list them) and addresses with incomplete loaded history. Registry names appear under `attribution` with the registry version.
- `parseTraceImport(text)`: rejects files over 5 MB, invalid JSON, other formats and newer format versions (naming the version). Steps are rebuilt into trace steps and passed through `parseTrace`, the same gate as stored traces, so a step whose movement key doesn't match its fields is set aside and counted, never imported.
- Import creates a new trace (new id; "(imported)", then "(imported 2)"… on a name clash) through `createTrace`, which now accepts the imported diagram. Steps not in this case's loaded data become stale steps. The preview says how many steps were found, whether a diagram is included, and what couldn't be read.
- PNG: the on-screen canvas at device resolution (2× on a Retina display; lower on a 1× display), with a footer: trace name and export time, scope, the attribution sentence, disclosure counts and the line legend. It captures the current view, so the dialog says to use Fit first.

**Validation (2026-10-15):** `pnpm test` (39 files, 301 tests), `pnpm typecheck`, `pnpm lint` pass. Browser check on the local case, with the download intercepted in the page (no files written): the JSON for a 6-step trace had every step with exact amounts, decimals, categories and `ok` statuses, 5 `history_not_loaded` boundaries, the analysis fingerprint, the `canvas` block, no `labels`, and no URLs at all; the PNG was 2464×1510 with the footer. Re-importing that JSON previewed "6 of 6 steps found" and created "Sprint 08 check (imported)" with the same diagram and no evidence issues. A reviewer check against Solscan for signature `58hyE6JP…bVe6`: slot 444268305, 14:30:11 UTC, 6LQ6…RBF9 → Jitotip 2 for 0.000006 SOL, matching the exported step (`amount: "6000"`, `decimals: 9`). The other leg exported as 0.05 SOL to Fnca…ktLj matches Solscan's balance changes (−0.050006 / +0.04999 after the 0.00001 fee); Solscan's instruction summary shows 0.020540632 for a Phantom program instruction, which isn't the net movement. Not checked in the browser: an F3 NFT sale export (covered by `export.test.ts`) and importing into a case missing a wallet (covered by the stale-step rules and tests).

## Definition of Done

- [ ] Export, import and snapshot merged with tests; checks recorded; validation commands pass.

## Known Risks / Open Decisions

- Labels default off: confirm with users. Some teams will want them on.

## Handoff Notes for the Next Sprint

13 includes export round trips in the release regression list.

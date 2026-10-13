# Sprint 11 — Export and Reproducibility

**Status:** Planned
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

- [ ] `exportTrace(trace, evidence, options)` → document; decimals from asset metadata; statuses; disclosures computed from the view
- [ ] `parseTraceImport(json)` → `{ ok, trace, missing } | { ok: false, error }`
- [ ] Tests

### Task Group B — UI

- [ ] Export dialog: include labels (off), include layout (off), Download JSON
- [ ] Import: file input, preview, confirm
- [ ] Snapshot: PNG with footer; dialog note

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

- [ ] Round-trip test passes; every disclosure test passes.
- [ ] A reviewer can take the JSON and find every step's signature and movement on-chain (manual check of one F1 and one F3 export, recorded).
- [ ] PNG includes the footer disclosures (browser check).

## Definition of Done

- [ ] Export, import and snapshot merged with tests; checks recorded; validation commands pass.

## Known Risks / Open Decisions

- Labels default off: confirm with users. Some teams will want them on.

## Handoff Notes for the Next Sprint

13 includes export round trips in the release regression list.

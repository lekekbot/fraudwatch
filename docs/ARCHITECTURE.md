# FraudWatch — Local-First Architecture

## Overview

```text
┌─────────────────────────────────────────┐
│ Browser                                 │
│                                         │
│  ┌───────────────────────────────────┐  │
│  │ FraudWatch UI                     │  │
│  │ timeline · graph · inspectors     │  │
│  │ evidence and debug views          │  │
│  └───────────────┬───────────────────┘  │
│                  │                      │
│  ┌───────────────▼───────────────────┐  │
│  │ Mapping & interpretation engine   │  │
│  │ wallet expansion, reconstruction  │  │
│  │ semantic events, relationships    │  │
│  │ behaviour observations            │  │
│  └───────┬─────────────────┬─────────┘  │
│          │                 │            │
│  ┌───────▼───────┐ ┌──────▼─────────┐  │
│  │ IndexedDB     │ │ RPC Adapter     │  │
│  │ local cache   │ │ standard JSON-RPC│ │
│  └───────────────┘ └──────┬─────────┘  │
└────────────────────────────┼────────────┘
                             │
                             ▼
                    User-provided RPC
                             │
                             ▼
                          Solana
```

## No application database

No:

```text
Postgres
Supabase
MongoDB
Redis
Neo4j
```

is required for MVP.

IndexedDB is the user's private local persistence layer.

## Data flow

```text
RAW BLOCKCHAIN ACTIVITY        RPC response, cached raw in IndexedDB (raw_transactions)
        ↓
CANONICAL TRANSACTION          provider-independent, stored once per signature (transactions)
        ↓
WALLET EFFECT                  what it did to each mapped wallet's balances (wallet_states)
        ↓
SEMANTIC EVENT                 what the activity means, for the whole transaction (computed on read)
        ↓
WALLET PROJECTION              one wallet's side of an event: buyer bought, seller sold
        ↓
CHRONOLOGICAL STORY            the Timeline: one card per event per lane
        ↓
RELATIONSHIP SUMMARY           the Graph: one connection per address pair, built from events
        ↓
BEHAVIOR OBSERVATION           deterministic patterns across a wallet's events
        ↓
UNDERLYING EVIDENCE            facts, verified attribution, derived and heuristic readings
```

Each stage only reads the one above it. Nothing below the canonical transaction is stored: semantic events, projections, relationships and observations are recomputed when a case opens, from the cached canonical transactions and wallet effects (about 150 ms for 10 wallets and 5,000 transactions; see `src/lib/semantic/performance.test.ts`).

## Semantic model

The product questions, and the object that answers each:

| Question | Object | Code |
|---|---|---|
| What happened? (Timeline) | Semantic event, projected per wallet | `SemanticEvent`, `EventProjection` |
| Who was involved? (Graph) | Relationship | `GraphEdge` with `RelationshipSummary` |
| How are they connected? | Relationship inspector | `edge-panel.tsx` |
| What exactly occurred? | Event inspector | `event-details.tsx` |
| How do we know? | Evidence | `EvidenceRef`, `explainEvent` |
| What pattern emerged over time? | Behaviour observation | `BehaviorObservation` |

### CanonicalTransaction (`src/lib/solana/canonical.ts`)

The single stored copy of a transaction: signature, slot, time, status, fee, accounts, native and token balance changes (pre, post, delta in base units), outer and inner instructions, and the raw response. It is the source of truth every later stage points back to. Versioned by `PARSER_VERSION`.

### Wallet effect (`src/lib/state/reconstruct.ts`)

`WalletTransactionEffect`: one transaction's asset changes for one mapped wallet, with before/after balances chained across the wallet's history. `summarizeEffect` (`src/lib/state/summarize.ts`) reads it into an `EffectSummary` (kind, counterparties, NFT trade), which interpreters reuse. Versioned by `RECONSTRUCTION_VERSION`.

### SemanticEvent (`src/lib/semantic/events.ts`)

What one transaction means, the same for every wallet in it. Built by `interpretTransaction` (`src/lib/semantic/interpret.ts`):

1. **Context** (`buildContext`): the facts every interpreter shares, worked out once: fee payer, signers, summaries per wallet, instructions with evidence pointers, balance flows, the NFT reading, and the protocol resolution.
2. **Protocol resolution** (`resolver.ts`): verified registry matches, infrastructure (programs, token accounts, pools, vaults, authorities, fee accounts, escrows) and every attribution with its source. Only verified registry entries may shape an interpretation.
3. **Interpreters** (`interpreters.ts`, `defi.ts`, `nft.ts`), in priority order, specific before generic: failed → marketplace NFT trade → CCTP bridge → Kamino lending → Marinade staking → Jupiter swap → known DEX swap → native stake → token instruction → generic NFT → generic swap → generic transfer → generic program → unknown. The first reading wins; one that throws is skipped with a warning.
4. **Assembly**: flows (each with a role: spent, received, payment, royalty, marketplace fee, rent, unidentified, NFT, settlement), participants (meaningful actors only), infrastructure, protocol and service, confidence, evidence, NFT detail, bridge envelope, warnings, and the interpreter trace.

Identity: `solana:<signature>:event:<index>`. Today every transaction has exactly one event (index 0).

Confidence is one of three, never a number:

- **HIGH**: a known program's decoded instruction, matching the balance changes.
- **MEDIUM**: a strong balance pattern alongside a known protocol, without a decoded instruction.
- **LOW**: a pattern or program call with nothing definitive behind it, or nothing recognisable.

Settlement flows (routing through pools, escrow and account closures) make the flows add up to the observed balances, but never make participants or graph connections.

### WalletEventProjection (`src/lib/semantic/projection.ts`)

`EventProjection`: one wallet's view of an event (its roles, its own action, its incoming and outgoing flows). A buyer and a seller see the same event ID with actions BUY and SELL. The Timeline draws one card per projection, at one shared x for a transaction several mapped wallets share.

### Relationship (`src/lib/graph/build.ts`)

`GraphEdge` and its `RelationshipSummary`: every event between two addresses, aggregated into one connection. It keeps per-direction counts and per-asset totals, first and last interaction, active days, activity pattern, who signed, and the semantic event composition. Connections come only from meaningful event legs: routing, settlement, infrastructure and the spent/received legs of swaps, stakes, loans and bridges never connect wallets, and NFT fee and royalty legs stay inside the trade. Node ranking uses transparent factors (shared by mapped wallets, events, value moved, behaviour observations, recency) and every node records why it is shown.

### BehaviorObservation (`src/lib/behavior/observations.ts`)

A pattern across several events of one mapped wallet, read by a fixed rule: rapid forwarding, fund split, consolidation, repeated counterparty, circular movement, bridge milestone, exchange deposit (verified exchanges only). Each records the events that triggered it and their role, the rule, the thresholds (all in `BEHAVIOR_THRESHOLDS`) and the values it calculated. Observations annotate events; they never replace them, score a wallet or give a verdict.

### Evidence (`EvidenceRef`, `src/lib/semantic/explain.ts`)

Every event carries references into its canonical transaction (status, balance changes, instruction indexes, returned data) and to lookups (registry matches, NFT metadata). `explainEvent` turns an event into statements in six categories that are never mixed:

| Category | Meaning |
|---|---|
| Fact | Read straight from the chain: status, balance changes, on-chain metadata, returned data |
| Verified attribution | An address the protocol registry verifies |
| Derived interpretation | A deterministic reading of facts: a decoded instruction, the NFT parser's roles |
| Heuristic observation | A pattern FraudWatch infers, or a gap in what it could check |
| User label | The investigator's own name for an address; shown, never used to interpret |
| Community label | A third-party name; unverified, shown, never used to interpret |

Each statement either holds (✓) or names something missing (?), so uncertainty stays visible.

## Versioning and caches

| Version | Covers | Stored output | On change |
|---|---|---|---|
| `PARSER_VERSION` | canonical transactions | `transactions` | cleared and re-derived from `raw_transactions`, no refetch |
| `RECONSTRUCTION_VERSION` | wallet effects and states | `wallet_states` | cleared and rebuilt |
| `SEMANTIC_VERSION` + each interpreter's `version` | semantic events | none | recomputed on next open |
| registry `version` | protocol attribution | none | recomputed on next open |
| `BEHAVIOR_VERSION` | behaviour observations | none | recomputed on next open |

`DERIVED_CACHES` (`src/lib/db/derived.ts`) lists the stored ones; `analysisVersions()` and `analysisFingerprint()` (`src/lib/semantic/versions.ts`) report all of them, and every event is stamped with its model version, interpreter and interpreter trace. A future events cache must key on the fingerprint and register in `DERIVED_CACHES`. Tests: `src/lib/db/derived.test.ts`.

## Debugging a reading

The event inspector's **Developer details** shows, for the selected transaction: every version above, the interpreters considered and their outcome, registry matches, and the canonical transaction, this wallet's effect and summary, the semantic event and its behaviour observations side by side. **Copy debug bundle** puts all of that on the clipboard as JSON (public chain data and FraudWatch's reading of it; no RPC URL, no labels).

## Trace Graph model (`src/lib/trace/`)

A trace reads the semantic model and stores only the investigator's decisions. The `trace-graph` branch now includes guided creation, candidate selection, annotations, service folding, branches with undo/redo, the trace inspector with cross-view navigation, and measured large-case performance. Some browser checks remain pending per sprint. See `docs/sprints/trace-graph/` for status.

- **Steps reference movements by content** (`movementKey`, `keyedFlows` in `model.ts`): signature, event index, asset, owners, amount and an occurrence counter. Nothing from the transaction is copied. `buildTraceView` (`view.ts`) re-resolves every step against the current events each time; a step whose movement is gone or changed is reported stale and kept, never re-pointed.
- **Classification** (`classifyEvent`, `movements.ts`): each flow is a primary or supporting movement, part of a conversion, a boundary, or excluded (settlement, zero, bridge cost). The network fee is never a flow. `buildMovementIndex` builds per-address chronological lists once; `candidates` filters and pages them.
- **Presentation is separate** (`presentation.ts`): node positions, styles and annotations (notes, shapes, user connectors) are the investigator's diagram, never evidence. `buildTraceView` reads only the service expansion flag from presentation; positions, styles and annotations cannot change movements or totals.
- **Local storage** (`src/lib/db/traces.ts`, Dexie v7): each trace is a separate case-scoped record. `parseTrace` validates reads, preserves unreadable items for review and migrates older records; saves for one trace are serialized. Case deletion removes its traces, while clearing transaction cache keeps them.
- **Canvas interaction** (`canvas-ops.ts`, `geometry.ts`, `icons.ts`, `trace-canvas.tsx`): modelled on Figma and draw.io. One selection holds nodes and annotations; a marquee picks both; dragging moves them together with smart alignment guides (`snapToGuides`); Alt-drag, ⌘D and ⌘C/⌘V copy annotations (never evidence). Arrow keys nudge (Alt+arrows walk the trace). Groups (`group` on annotations and node styles) select and move together; locked items (`locked`) stay put. Align and distribute work on selection boxes. Connector ends can attach to a side's connection point, connectors route straight or with right-angle elbows (`connectorPath`) and carry a movable label. Notes have a stored height, word-wrapped world-unit text, a Text variant, size and alignment. Icons are shapes drawn from bundled Lucide path data. A quick toolbar floats over the selection; right-click menus cover nodes, lines, annotations and empty canvas. All of it is presentation: none of it changes steps or totals.
- **Canvas and workflow** (`layout.ts`, `src/app/case/trace/`): missing nodes are auto-placed without moving placed nodes; drag and Tidy layout save positions. `autoPlace` uses a spatial index of placed nodes, so a node with thousands of counterparties places in milliseconds. The UI creates and manages traces, picks movements from paginated candidates (a filter is required to list beyond the first page when more than 10,000 match), and saves notes, shapes, frames and user connectors. Solid lines are observed evidence; dashed lines are user annotations.
- **Branches and history** (`branches.ts`, `history.ts`): a node's branch is what it reaches moving away from the seed, stopping at nodes closer to the seed. Hiding a branch is presentation (`hiddenBranches`); a node still reached from the seed by a visible path stays drawn. Branch totals sum each step once. Focus path is the shortest path from the seed, unsaved. Undo/redo keeps up to 100 whole-trace snapshots per trace for the session.
- **Inspector and navigation** (`inspect.ts`, `trace-inspector.tsx`): a step shows its full evidence (the same `EventSummary` and `EventEvidence` as the Timeline), its transaction's other legs and, when stale, replacements from the same signature. Nodes reuse the case's `AddressPanel`. Open in Timeline and Show in Graph go through the shell's existing `goToTransaction` and relationship filter. Selection and zoom are kept per trace while the case is open.
- **Service nodes** (`view.ts`): registry addresses fold by protocol unless labelled, mapped or expanded. Every folded edge retains the real endpoints in `via`. Verified exchange nodes are custodial boundaries, so forward candidates stop there.
- **Export and import** (`export.ts`, `export-dialog.tsx`): a `fraudwatch-trace` JSON document lists every step (hidden and stale ones included, with a status) with its signature, movement key and exact amount, plus disclosures of everything hidden, collapsed, stale, out of scope or incompletely loaded. Labels are opt-in and never include notes; the RPC URL, raw transactions and balances are never included. Import runs the file through `parseTrace` and creates a new trace. The PNG snapshot draws the scope and disclosures under the canvas.
- No trace operation issues an RPC request (audited in Sprint 10); continuing past an unloaded address means mapping it. The movement index is built when the Trace view first opens and kept until the case's events change. Stage timings are asserted in `src/lib/trace/performance.test.ts`.

## Where work runs

Interpretation, observation and graph building run once per case open in memoised workspace state (`case-shell.tsx`), and again only when their inputs change (new transactions, NFT metadata arriving, filters for the graph). Nothing semantic runs in React render, canvas draw, hover or zoom handlers.

## Display settings

Settings change how evidence is shown, never the evidence. They live in `src/lib/preferences/` (registry, resolution, presets, file format), `src/lib/db/preferences.ts` and `src/lib/db/view-presets.ts` (storage), and `src/lib/case/view-settings.ts` (per-case overrides). Views read them through `usePreferences` (`src/hooks/use-preferences.ts`).

- **Registry** (`SETTINGS` in `schema.ts`): every setting is an enum with a default and a scope: `global` (one value everywhere) or `case` (a default a case may override). Defaults equal how FraudWatch behaved before settings existed.
- **Resolution**, per setting, highest wins: case override › explicit global choice › active preset › default. Every value reports which of these it came from. A preset sits below explicit choices, so a change made after picking one sticks; applying a preset clears the explicit choices for the settings it controls.
- **Storage**: one row in `preferences` (Dexie v5), saved presets in `view_presets` (v6), case overrides on the case record (`viewSettings`), written in a transaction from the stored case. Values are sparse and validated on read: unknown keys are kept, invalid values ignored, malformed data reads as "nothing set" and is never deleted unprompted. A `localStorage` copy of the theme exists only for the pre-paint script.
- **Presets**: Minimal / Balanced / Forensic set the detail settings; saved presets may set any per-case setting. Applying one to a case copies its values in (so later edits to the preset never change the case).
- **Hiding by a setting** (low-value graph connections, timeline program calls or NFT activity) leaves whole transactions or connections off a view and always shows a count with a way back. It's separate from filters (temporary) and hide rules (a case's triage decisions).
- No setting causes an RPC request. `src/lib/preferences/integrity.test.ts` checks that every settings write touches only settings.

## Canonical transaction rule

Store once:

```text
signature
```

Reference many times.

## Wallet expansion rule

```text
observed wallet
    ↓ user action
mapped wallet
    ↓
load scoped history
    ↓
find transactions shared with all mapped wallets
    ↓
add wallet lane
```

## Security model

RPC URL/key stays local.

Portable case configuration excludes it.

## Protocol architecture

```text
protocols/solana.json  ──→  resolveProtocols (verified attribution, infrastructure)
                                     ↓
decoder code (interpreters) ──→  interpretTransaction ──→ SemanticEvent
```

The registry says who an address is; code decides what a transaction did. Community labels (`protocols/community-labels.json`) and user labels are attribution only and never decide meaning.

## Future migration path

A server database becomes useful only if FraudWatch later needs:

- accounts;
- cloud sync;
- teams;
- server-hosted public links;
- scheduled monitoring;
- alerts;
- organization-wide labels;
- large server-side processing.

The MVP should not pre-emptively add this complexity.

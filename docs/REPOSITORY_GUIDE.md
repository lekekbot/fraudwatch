# FraudWatch Repository Documentation

This guide documents the repository's implemented behavior, architecture, data contracts, user workflows, development tools, tests, and limitations. It is intended for developers, maintainers, and technical users who need to understand the entire application.

**Snapshot:** 8 October 2026, based on commit `04f121b` and the source files in this checkout. Package version: `0.1.0`. Registry counts and analysis versions below describe this snapshot, not a permanent API guarantee.

Source code is authoritative when it differs from a sprint plan or older document. This guide distinguishes current features from planned work.

## Contents

1. [Product and scope](#1-product-and-scope)
2. [Technology and setup](#2-technology-and-setup)
3. [Repository structure](#3-repository-structure)
4. [Application routes and lifecycle](#4-application-routes-and-lifecycle)
5. [Case model and wallet mapping](#5-case-model-and-wallet-mapping)
6. [RPC transport and provider support](#6-rpc-transport-and-provider-support)
7. [Ingestion and coverage](#7-ingestion-and-coverage)
8. [Canonical transactions and amounts](#8-canonical-transactions-and-amounts)
9. [Local persistence and cache lifecycle](#9-local-persistence-and-cache-lifecycle)
10. [Wallet reconstruction and summaries](#10-wallet-reconstruction-and-summaries)
11. [Assets, NFTs, and name resolution](#11-assets-nfts-and-name-resolution)
12. [Semantic interpretation and evidence](#12-semantic-interpretation-and-evidence)
13. [Behavior observations](#13-behavior-observations)
14. [Timeline and relationship chart](#14-timeline-and-relationship-chart)
15. [Interaction graph](#15-interaction-graph)
16. [Table, inspectors, search, and filters](#16-table-inspectors-search-and-filters)
17. [Privacy and operational boundaries](#17-privacy-and-operational-boundaries)
18. [Scripts and fixture maintenance](#18-scripts-and-fixture-maintenance)
19. [Tests and continuous integration](#19-tests-and-continuous-integration)
20. [Maintenance and extension guide](#20-maintenance-and-extension-guide)
21. [Troubleshooting and known limitations](#21-troubleshooting-and-known-limitations)
22. [Existing documents and roadmap](#22-existing-documents-and-roadmap)
23. [Source file reference](#23-source-file-reference)

## 1. Product and scope

FraudWatch is a local-first Solana investigation workbench. It fetches bounded wallet history from a user-configured RPC endpoint, reconstructs asset changes, interprets transactions, and presents activity across multiple wallets.

The application's core questions are:

| Question | Application surface |
| --- | --- |
| What happened? | A chronological timeline with wallet-specific event cards |
| Who exchanged value? | A graph of addresses and aggregated relationships |
| How are two addresses connected? | A relationship inspector with directions, assets, counts, and dates |
| What exactly occurred? | An event inspector with participants, flows, protocol, and confidence |
| What supports this reading? | An evidence checklist and underlying transaction data |
| What happened repeatedly or in sequence? | Deterministic behavior observations |
| How did balances change? | Opening/closing summaries and a before/change/after table |

### 1.1 Implemented capabilities

- Create, rename, reopen, and delete local cases.
- Select a primary wallet and a date range, with optional discovery of omitted dates.
- Add secondary wallets at creation or explicitly map addresses later.
- Give secondary wallets their own history start within the case range.
- Pause secondary wallet history loading, hide lanes, focus lanes, and reorder lanes.
- Load standard Solana history, including discovered token-account history.
- Use a Helius indexed history fast path when the endpoint hostname supports it.
- Reuse transaction and coverage caches across cases.
- Reconstruct observed native and token balances and report discontinuities.
- Interpret supported transfers, swaps, NFT activity, lending, staking, bridges, account operations, approvals, and failed transactions.
- Show behavior patterns without fraud verdicts or risk scores.
- Label, annotate, tag, and bookmark investigation targets locally.
- Highlight address look-alikes and likely dust decoys.
- Apply shared view filters, manual transaction hiding, and saved hide rules.
- Open a case from a simple wallet/range startup link.
- Copy a transaction debug bundle to the clipboard.
- Inspect and clear local data through storage settings.

### 1.2 Boundaries

The current chain implementation is Solana. There is no user account system, cloud synchronization, application database server, automatic recursive wallet expansion, or AI inference service.

The Next.js server delivers application pages and assets. Investigation data processing and RPC requests run in the browser. Local-first does not mean the application has no HTTP server for delivering its UI.

Full case file export/import, compressed `#state=` links, boundary-context fetching, watch mode, reports, and cross-chain investigation are planned work. Their appearance in sprint documents does not mean they are implemented.

Sources: [README](../README.md), [roadmap](../ROADMAP.md), [case workspace](../src/app/case/case-shell.tsx).

## 2. Technology and setup

### 2.1 Stack

Declared package versions come from [package.json](../package.json). Caret ranges identify allowed dependency versions; [pnpm-lock.yaml](../pnpm-lock.yaml) records exact resolution.

| Technology | Declared version | Purpose |
| --- | --- | --- |
| Next.js | `16.3.6` | App Router, layouts, development server, production build |
| React / React DOM | `19.2.8` | UI state, composition, effects, and memoization |
| TypeScript | `^5` | Strict domain and component types |
| Tailwind CSS | `^4` | Styling through the PostCSS plugin and global CSS |
| `@base-ui/react` | `^1.8.0` | Accessible UI primitives used by shared components |
| shadcn | `^4.21.0` | Shared component conventions and generator configuration |
| `@solana/kit` | `^5.5.1` | Address validation, codecs, and program-derived addresses |
| Dexie | `^4.4.6` | IndexedDB schema, transactions, indexes, and migrations |
| `dexie-react-hooks` | `^4.4.0` | Reactive local queries |
| d3 force/scale/selection/time/zoom | Package-specific ranges | Graph positioning, scales, and canvas interactions |
| Lucide React | `^1.47.0` | Icons |
| Sonner | `^2.0.8` | Toast notifications |
| `cn`, class-variance-authority | `^0.4.0`, `^0.7.1` | Class composition and UI variants |
| Vitest | `^4.1.11` | Tests in a Node environment |
| ESLint | `^9` | Next.js and TypeScript lint rules |

### 2.2 Requirements

Use Node.js 24 or newer and pnpm. The package manager declaration is `pnpm@11.20.0`; CI uses Node 24.

The browser must support IndexedDB for persistent cases and modern browser APIs used by the client. These include Fetch, AbortController, `AbortSignal.timeout`, `AbortSignal.any`, Web Crypto, Canvas 2D, and localStorage. Clipboard and browser storage estimates depend on browser permissions and availability.

For history loading, configure a Solana endpoint that accepts browser CORS requests. A successful connectivity test does not establish archive-history access or provider-specific method support.

### 2.3 Local development

Run from the repository root:

```sh
pnpm install
pnpm dev
```

Open `http://localhost:3000`, configure RPC settings, and create a case. The application does not require a repository `.env` file for ordinary use: RPC settings are entered in the UI and stored in the browser.

The fixture capture script optionally reads `FRAUDWATCH_RPC_URL`; this is a script setting, not application runtime configuration.

### 2.4 Commands

| Command | Actual script |
| --- | --- |
| `pnpm dev` | `next dev` |
| `pnpm build` | `next build` |
| `pnpm preview` | `next start` |
| `pnpm lint` | `eslint` |
| `pnpm typecheck` | `next typegen && tsc --noEmit` |
| `pnpm test` | `vitest run` |

For a production instance:

```sh
pnpm build
pnpm preview
```

The committed Next configuration enables trailing slashes and disables image optimization. It does **not** configure `output: "export"`; a static-only deployment is not established by this configuration. The root layout uses `next/font/google` for Geist and Geist Mono, so font acquisition can require network access during a build.

### 2.5 Configuration

- [next.config.ts](../next.config.ts): `trailingSlash: true`, `images.unoptimized: true`.
- [tsconfig.json](../tsconfig.json): strict mode, ES2020 target, bundler module resolution, JSON imports, and `@/*` mapped to `src/*`.
- [eslint.config.mjs](../eslint.config.mjs): Next Core Web Vitals and TypeScript rules; generated/build paths are ignored.
- [postcss.config.mjs](../postcss.config.mjs): the Tailwind 4 PostCSS plugin.
- [components.json](../components.json): shadcn `base-nova` style, neutral tokens, Lucide icons, and component aliases.
- [vitest.config.mts](../vitest.config.mts): Node environment, `src/**/*.test.ts`, and the `@` alias.
- [pnpm-workspace.yaml](../pnpm-workspace.yaml): disables install-time builds for `sharp` and `unrs-resolver`.
- [.gitignore](../.gitignore): excludes dependencies, Next output, coverage, environment files, generated Next type declarations, and TypeScript incremental state.

There is no configured formatter. Match the surrounding formatting instead of reformatting unrelated files.

## 3. Repository structure

```text
fraudwatch/
├── .github/workflows/ci.yml   CI checks
├── src/
│   ├── app/
│   │   ├── (site)/           Home, new case, startup link, settings
│   │   ├── case/             Full-window investigation workspace
│   │   │   ├── [[...route]]/ Route validation
│   │   │   ├── timeline/     Timeline, relationship chart, event inspectors
│   │   │   └── graph/        Graph renderer and relationship/entity inspectors
│   │   ├── layout.tsx       Root metadata, fonts, shared providers
│   │   └── globals.css      Tailwind imports and design tokens
│   ├── components/          Header, RPC badge, shared UI primitives
│   ├── hooks/               Reactive DB, ingestion, wallet state, SNS names
│   └── lib/
│       ├── assets/          Built-in assets and on-chain metadata
│       ├── behavior/        Deterministic sequence observations
│       ├── cache/           Coverage interval calculations
│       ├── case/            Cases, mapping ranges, hiding, lanes, bookmarks
│       ├── db/              IndexedDB schema and persistence operations
│       ├── graph/           Relationship aggregation and layout
│       ├── ingest/          History discovery, fetch pools, intersections
│       ├── labels/          Display names, community labels, look-alikes
│       ├── protocols/       Registry parsing and transaction enrichment
│       ├── routing/         Case paths and startup query parameters
│       ├── rpc/             Transport, adapter, endpoint validation and tests
│       ├── semantic/        Context, flows, interpreters, evidence, projections
│       ├── solana/          Canonical parsing, amounts, programs, binary helpers
│       ├── state/           Wallet reconstruction and activity summaries
│       ├── timeline/        Layout, filtering, cross-lane relationships
│       ├── gestures.ts      Wheel and trackpad behavior
│       └── search.ts        Search ranking
├── protocols/               Curated registries and attributed source snapshots
├── fixtures/solana/         Recorded transactions and NFT metadata
├── scripts/                 Fixture capture and community-label generation
├── docs/                    Architecture, terminology, issues, sprint plans
├── README.md                Product introduction and quick start
├── CONTRIBUTING.md          Contribution workflow and domain invariants
├── ROADMAP.md               Future product work
├── AGENTS.md                Local Next.js agent requirements
├── CLAUDE.md                References to AGENTS.md and the mistakes log
├── LICENSE                  MIT license
└── package/config files     Toolchain and dependency configuration
```

Tests sit beside their implementation files. JSON registries are imported into the application bundle; source snapshots are maintained separately. There is no API route layer, backend service directory, or committed `public/` directory in this snapshot.

## 4. Application routes and lifecycle

### 4.1 Route map

The `(site)` route group affects layout organization, not URLs.

| URL | Implementation | Behavior |
| --- | --- | --- |
| `/` | `src/app/(site)/page.tsx`, `home-view.tsx` | Product introduction and recent local cases |
| `/cases/new/` | `cases/new/page.tsx`, `new-case-form.tsx` | Validate and save a primary wallet, dates, and optional secondary wallets |
| `/map/?wallet=...&from=...&to=...` | `map/page.tsx`, `map-startup.tsx` | Reopen a matching local case or prefill new-case creation |
| `/settings/rpc/` | `settings/rpc/page.tsx`, `rpc-settings-form.tsx` | Configure and test an endpoint |
| `/settings/storage/` | `settings/storage/page.tsx`, `storage-settings.tsx` | Inspect storage, clear chain cache, or delete the local database |
| `/case/<id>/timeline/` | Case layout and `CaseShell` | Multi-wallet chronological workspace |
| `/case/<id>/graph/` | Case layout and `CaseShell` | Interaction graph |
| `/case/<id>/table/` | Case layout and `CaseShell` | Wallet asset-change table |
| `/case/<id>/table/<wallet>/` | Case layout and `CaseShell` | Table route carrying an address filter |

The optional catch-all page validates route segments with `isCaseRoute()` and calls Next's `notFound()` for invalid paths. A valid path can still reference a case absent from this browser; `CaseLoader` then shows a local “Case not found” message.

Case identifiers are local database identifiers, not public sharing tokens. A `/case/<id>/...` URL cannot recreate a case on another device.

### 4.2 Root and site layouts

[src/app/layout.tsx](../src/app/layout.tsx) defines the title, description, `no-referrer` metadata, fonts, document language, and `Providers` wrapper. [Providers](../src/components/providers.tsx) installs the Sonner toaster; it is not a centralized application state store.

The site layout uses [AppHeader](../src/components/app-header.tsx). The case layout uses the full-window workbench instead.

### 4.3 Workspace state

[case-shell.tsx](../src/app/case/case-shell.tsx) is the integration layer. It:

1. Reads the case and RPC settings through reactive IndexedDB queries.
2. Marks an opened case as recently used.
3. Rebuilds a usable ingestion result from local cache.
4. Loads uncached history when requested.
5. Reconstructs wallet states and resolves asset metadata.
6. Memoizes summaries and semantic events.
7. Builds names, look-alike assessments, filter inputs, hidden reasons, observations, and graph inputs.
8. Coordinates selected wallets, addresses, transactions, relationships, and navigation.

`CaseShell` lives in `src/app/case/layout.tsx`, not the dynamic page. Switching views therefore retains workspace state. View navigation uses the browser History API. Changing case identity remounts `CaseWorkspace` through its case ID key.

Semantic computation occurs in memoized state, rather than canvas draw or hover handlers. New transactions or arriving NFT metadata can trigger a new reading.

### 4.4 Persistence boundaries

- **IndexedDB:** case configuration, wallet mappings, labels, bookmarks, saved hides, RPC settings, chain caches, and wallet states.
- **URL:** case/view selection, optional table address, or the simple startup wallet/range.
- **React state:** ordinary filters, selections, panel visibility, graph limits/ranking, cluster expansion, and lane focus.
- **localStorage:** SNS name cache, graph spacing preference, and the table hide-help flag.

Ordinary filters are not restored after a full page reload. Saved hide rules are restored because they belong to the case.

## 5. Case model and wallet mapping

Sources: [model.ts](../src/lib/case/model.ts), [range.ts](../src/lib/case/range.ts), [wallet-range.ts](../src/lib/case/wallet-range.ts), [lanes.ts](../src/lib/case/lanes.ts).

### 5.1 `FraudWatchCase`

A case contains:

| Field | Meaning |
| --- | --- |
| `id` | UUID generated by `crypto.randomUUID()` unless supplied for deterministic use |
| `name` | Investigator-facing name, maximum 120 characters |
| `primaryWallet` | Investigation's starting wallet |
| `range` | ISO timestamps defining the case's half-open UTC interval |
| `mappedWallets` | Explicitly loaded wallets and their range settings |
| `laneOrder` | Optional saved order |
| `hiddenLanes` | Mapped wallets hidden from ordinary lane display |
| `hiddenSignatures` | Transactions manually hidden across views |
| `shownSignatures` | Exceptions to matching hide rules |
| `hideRules` | Named, switchable saved hiding conditions |
| `bookmarks` | Wallet/address, transaction, and date bookmarks |
| `createdAt`, `updatedAt` | ISO timestamps used for creation and recent-case ordering |

Labels and tags live in `address_labels`, rather than being embedded in the current case model.

An empty name receives a default based on the shortened primary wallet. Invalid wallet addresses, invalid calendar dates, and reversed ranges produce field-specific errors. Secondary wallet rows reject duplicates, the primary wallet repeated as a secondary, and known infrastructure. Blank secondary rows are ignored.

### 5.2 Date semantics

All investigation ranges use `[start, end)` in UTC. The UI accepts inclusive calendar dates and stores `end` as midnight after the selected final day.

For example, selecting 1–3 October 2026 stores:

```json
{
  "start": "2026-10-01T00:00:00.000Z",
  "end": "2026-10-04T00:00:00.000Z"
}
```

This convention applies to ingestion, coverage, and filtering. User locale does not change stored boundaries. `rangeFromDates()` rejects calendar rollovers such as 31 February.

If a date is omitted, `findActivitySpan()` queries wallet signature history. The newest activity requires the initial page; finding the oldest can require scanning the full available history. Discovery stops at 100,000 signatures and then asks for an explicit start date. An RPC's oldest returned transaction is not proof of the wallet's creation date.

The “extend to today” operation uses the end of the current UTC day. It updates the case range; it is not automatic polling.

### 5.3 Address states

| State | Meaning | Loads history? |
| --- | --- | --- |
| `PRIMARY` | Starting wallet | Yes |
| `MAPPED` | Explicitly added wallet | Yes, unless paused |
| `OBSERVED` | Address encountered through loaded activity | No |
| `INFRASTRUCTURE` | Invoked program or registry address with a non-wallet role | No wallet expansion |

Registry entries with role `wallet`, including exchange wallets, remain observable and mappable. Unknown invoked programs still count as infrastructure.

Observed counterparties remain shallow: only their relationships to loaded wallets are visible. Mapping one wallet does not automatically map its counterparties.

### 5.4 Secondary wallet ranges

`MappedWalletConfig` stores `address`, optional `addedFromWallet`, `rangeMode`, optional `customStart`, and optional `paused`.

Supported modes:

- `case`: use the entire case range.
- `first_interaction`: start at the first loaded interaction resolved when mapping.
- `custom`: start at the chosen timestamp.

Every wallet ends at the case end. A custom start is clamped to the case start and must precede the case end. `firstInteraction()` checks accounts and token owners in loaded transactions; it describes the first **loaded** interaction, not necessarily the first-ever interaction.

Mapping saves the new configuration and starts ingestion if RPC settings exist. Shared transactions are compared across every mapped wallet pair, not only against the wallet from which a secondary was added.

The primary wallet cannot be unmapped or paused through the secondary-wallet operations. Unmapping retains labels and shared chain caches. The workspace offers undo for unmapping.

### 5.5 Lanes and bookmarks

Default lane order is primary first, followed by earliest loaded activity, with mapping order as a tie-break. Saved lane order takes precedence. Hiding a lane changes visibility; pausing a wallet changes history loading. A focus set temporarily selects lanes without rewriting saved hidden lanes.

Bookmarks support `wallet`, `transaction`, and `date`. Their targets are addresses, signatures, or ISO times. Transaction bookmarks can remember a wallet lane. Bookmark toggling matches by kind and target; wallet is contextual data, not part of the duplicate key.

### 5.6 Startup links

[map-params.ts](../src/lib/routing/map-params.ts) reads and writes only `wallet`, `from`, and `to`. Times are Unix seconds, and `to` is exclusive.

```text
/map/?wallet=<solana-address>&from=<start-unix-seconds>&to=<end-unix-seconds>
```

`MapStartup` searches for the same primary wallet and exact range. If several cases match, it opens the most recently updated. Otherwise it prefills the creation form and requires the user to create the case.

The form works in whole UTC days. If an exact startup range is widened to calendar-day boundaries, the form surfaces that difference. The link contains neither RPC credentials nor case labels, secondary mappings, or cached transactions.

## 6. RPC transport and provider support

Sources: [json-rpc.ts](../src/lib/rpc/json-rpc.ts), [generic-adapter.ts](../src/lib/rpc/generic-adapter.ts), [url.ts](../src/lib/rpc/url.ts), [test-connection.ts](../src/lib/rpc/test-connection.ts).

### 6.1 Endpoint validation and settings

The URL validator accepts HTTPS. HTTP is permitted only for `localhost`, `127.0.0.1`, and `[::1]`. URL username/password credentials are rejected. The URL is trimmed before storage.

`RpcSettings` has a single `id: "default"` record. It stores the URL, update time, and optional last-test/load result. `recordRpcResult()` ignores a load outcome if the endpoint changed while that load ran.

`redactRpcUrl()` returns the origin and an ellipsis when the URL has a path, query, or fragment. Those components commonly contain API keys.

### 6.2 Standard adapter methods

| Method | Use |
| --- | --- |
| `getSignaturesForAddress` | Newest-first signature discovery with a `before` cursor |
| `getTransaction` | Parsed transaction details |
| `getTokenAccountsByOwner` | Current token accounts for SPL Token and Token-2022 |
| `getAccountInfo` | Mint and metadata lookup |
| `getAsset` | Optional DAS metadata for compressed NFTs |
| `getTransactionsForAddress` | Optional Helius indexed wallet history |

Standard history requests use finalized commitment. Transactions request `jsonParsed` and permit version 0 via `maxSupportedTransactionVersion: 0`.

The adapter is a typed wrapper over JSON-RPC Fetch requests. It does not sign transactions or connect an investigator's wallet.

### 6.3 Helius fast path

An endpoint hostname ending in `.helius-rpc.com` enables `getTransactionsForAddress`. Requests ask for full parsed transactions in descending order, include all token-account history, and filter by block time.

Ingestion splits ranges around `2022-12-01T00:00:00.000Z`. Older ranges retain standard scanning because the indexed token-account history starts at that cutoff. If indexed history is unavailable for the provider key, ingestion falls back to the standard path.

This is hostname-based support. There is no general provider capability registry or stored `generic/enhanced/auto` setting in the current `RpcSettings` type.

### 6.4 Retries, timeout, and cancellation

`rpcCall()` itself defaults to zero retries. `createRpcAdapter()` supplies four retries by default, giving at most five attempts for retryable failures.

- Retryable failures: network/CORS failures, timeouts, HTTP 429, and HTTP 500/502/503/504.
- Backoff starts from 500 ms, adds jitter, and is capped at 8 seconds.
- HTTP 429 updates a shared adapter pause of at least 1 second, or the larger numeric `Retry-After` duration.
- Each attempt has a 30-second timeout.
- An external abort stops the request and backoff sleep.
- HTTP failures, RPC errors, malformed JSON, and responses missing `result` become `RpcRequestError` with a failure category.

An RPC error returned in a valid JSON-RPC body is not automatically retried by this policy. Browser Fetch cannot distinguish a CORS denial from many network failures, so those share `network_or_cors`.

Requests use POST JSON, `credentials: "omit"`, and `referrerPolicy: "no-referrer"`.

### 6.5 Connectivity test

The settings test calls `getVersion` and `getLatestBlockhash`, under a combined 10-second timeout. It records latency, Solana core version when reported, and a slot. It checks basic connectivity and response shape, not historical completeness, DAS access, or indexed-history entitlement.

## 7. Ingestion and coverage

Sources: [ingest.ts](../src/lib/ingest/ingest.ts), [pool.ts](../src/lib/ingest/pool.ts), [coverage.ts](../src/lib/cache/coverage.ts), [use-ingestion.ts](../src/hooks/use-ingestion.ts).

### 7.1 Standard history path

Wallets are processed in mapping order. Within each wallet, signature discovery overlaps transaction fetching:

1. Read complete cached coverage and indexed signatures for the wallet's range.
2. Calculate uncovered intervals.
3. Reuse cached transactions and transactions already loaded for another wallet.
4. Scan wallet signatures newest first, keeping only `[start, end)` entries.
5. Queue missing transactions as each signature page arrives.
6. Wait for wallet transactions before discovering historical token accounts.
7. List currently owned accounts for both token programs.
8. Add owned token accounts observed in loaded transaction changes, including some accounts closed since.
9. Scan token-account signatures and fetch missing transactions.
10. Save transaction batches, index entries, coverage outcomes, and the last-load record.

Token-account scanning matters because incoming token transfers and relayed transactions can reference a token account without referencing the owner wallet directly.

### 7.2 Limits

| Setting | Value | Scope |
| --- | --- | --- |
| Signature page size | 1,000 | Standard signature request |
| In-range signature cap | 5,000 | Per scanned address; also used by indexed-history scanning |
| Page cap | 25 | Per address/range scan, including pages newer than the requested range |
| Transaction workers | 8 | Standard fetch queue for one wallet |
| Token-account scan workers | 2 | Per wallet |
| Cache batch | 250 | Fetched transactions |
| UI progress interval | 200 ms | React progress updates |
| Activity-span discovery cap | 100,000 signatures | Finding omitted case dates |
| Complete-coverage finality margin | 2 minutes | Relative to load start |

The signature cap is not a single cap on the entire case. Multiple wallets and token accounts can produce more transactions overall.

### 7.3 Ingestion result

`IngestionResult` contains a `Map<signature, CanonicalTransaction>`, per-wallet results, and a cancellation flag. A `WalletIngestion` includes signatures, scanned token accounts, coverage, cache/fetch statistics, and an optional wallet error.

Coverage reports completeness, oldest/newest loaded times, signature and transaction counts, and warnings. Missing block times, safety limits, unavailable transactions, token-account failures, and request failures make coverage partial.

The progress object's `loaded` count means settled work: successful, cached, unavailable, or failed transactions. It is not a count of successful transaction fetches.

### 7.4 Deduplication and partial results

Each signature is requested at most once per ingestion run. If several wallets refer to the same transaction, they share the transaction map entry. A failed transaction request does not stop other transactions.

Cancellation returns data already loaded and marks affected coverage incomplete. Cache-write failures leave loaded data usable in memory, disable further writes during the run, and produce a warning. A reload may then lose unsaved results.

For incomplete wallets, `addSharedTransactions()` adds in-range transactions involving that wallet which other mapped wallets loaded. This improves display and reconstruction without asserting complete history.

### 7.5 Coverage model

`CachedCoverage` stores complete and incomplete intervals per wallet. Complete intervals merge and can suppress later RPC discovery. Incomplete attempts do not fill gaps merely because an attempt occurred.

`missingRanges()` subtracts complete intervals from the requested interval. `recordCoverage()` merges outcomes and drops incomplete attempts fully covered by complete intervals.

`clampToFinalized()` stops complete coverage at two minutes before the run's start. Recent activity is therefore eligible for a later refresh instead of being cached complete indefinitely.

Coverage is keyed by wallet, not RPC endpoint. Changing providers does not create a separate chain cache. Cached “complete” means complete under this discovery strategy and its available source data, not an independent archive proof.

### 7.6 Loading hook

`useIngestion()` exposes `idle`, `running`, `done`, and `error` states, plus `start()` and `cancel()`. It reads cache on case/configuration changes and cancels active work when unmounted.

A generation counter prevents a slower cache read from replacing a newer RPC result. A paused wallet receives only cached history; no missing history request is issued for that wallet. Other background enrichment can still use the endpoint.

## 8. Canonical transactions and amounts

Source: [canonical.ts](../src/lib/solana/canonical.ts).

### 8.1 Canonical transaction

`canonicalize()` converts the parsed RPC response into a provider-independent object. It requires a signature and status metadata.

The object retains:

- Signature, slot, optional position within the slot, and nullable ISO block time.
- Success/failure and fee in lamports.
- Accounts with signer, writable, and transaction/lookup-table source flags.
- Every account's native pre/post balance and delta.
- Token changes by token account, owner, mint, token program, and decimals.
- Outer and inner instructions with program ID, parsed type/info, accounts, raw encoded data, parent outer index, and stack height.
- The original response in `raw` while available in memory.

Token changes join pre/post entries by account index. A missing pre or post entry is treated as zero for a created or closed token account. An absent token owner remains `null`; later code cannot claim an owner was established.

The parser version is currently `PARSER_VERSION = 2`.

### 8.2 Identity and ordering

The durable transaction key is `solana:<signature>`. Wallet indexes point at the transaction rather than copying it into each case.

Reconstruction sorts by slot, then `transactionIndex` when supplied, then signature. Missing transaction indexes sort after known indexes within the same slot. This makes ordering deterministic but cannot recover exact execution order when the source omits it.

Timeline merging separately sorts display events by time and signature. Several transactions in one second do not necessarily have enough timestamp precision to imply their true order.

### 8.3 Amount conventions

Amounts are integer strings in base units. Balance and flow arithmetic uses `BigInt`; display sorting, ranking ratios, and counts can use JavaScript numbers. Native SOL uses reserved asset ID `SOL`; wrapped SOL uses its mint address and remains separate in wallet holdings.

`formatBaseUnits()` formats amounts without converting them to floating-point decimal balances. Native SOL has 9 decimals. Token decimals come from transaction observations or metadata.

Semantic movement amounts are nonnegative; direction belongs to `from` and `to`. Wallet balance deltas are signed. Never infer direction from a semantic amount string.

Native RPC balances arrive as JSON numbers before conversion to `BigInt`. The canonical string representation avoids further arithmetic loss; it cannot repair precision already lost while parsing an unsafe integer from JSON.

## 9. Local persistence and cache lifecycle

Source: [db.ts](../src/lib/db/db.ts). The Dexie database name is `fraudwatch`.

### 9.1 Tables

| Table | Primary key / indexes | Stored data |
| --- | --- | --- |
| `cases` | `id`; `updatedAt`, `primaryWallet` | Case configuration and persistent investigation preferences |
| `rpc_settings` | `id` | The default endpoint and last test/load status |
| `transactions` | `key`; `parserVersion` | Canonical transaction without `raw` |
| `raw_transactions` | `key` | Raw parsed response and cache timestamp |
| `wallet_transactions` | `[wallet+signature]`; `[wallet+blockTime]` | Lightweight wallet-to-transaction index |
| `coverage` | `wallet` | Complete/incomplete range coverage |
| `ingestion_jobs` | `caseId` | Most recent load outcome and wallet warnings |
| `meta` | `key` | Derived-cache version markers |
| `wallet_states` | `key`; `wallet` | Reconstruction for a wallet and exact range |
| `token_metadata` | `id` | Built-in/on-chain metadata shape stored by asset ID |
| `address_labels` | `[caseId+address]`; `caseId` | Case-scoped user name, note, and tags |

Semantic events, wallet event projections, graph relationships, and behavior observations have no database tables. They are computed from cached chain data when the workspace is opened or relevant inputs change.

### 9.2 Schema history

- **v1:** cases and RPC settings.
- **v2:** canonical/raw transactions, wallet index, coverage, last-load records, and metadata markers.
- **v3:** wallet states and token metadata.
- **v4:** address labels; an upgrade migrates old case-embedded label/tag maps into `address_labels` and removes those old maps.

Optional case fields added later do not require a new indexed table. There is no `ui_state` table despite references to future UI persistence in historical comments.

### 9.3 Database access

`getDb()` lazily creates a shared connection and throws when IndexedDB is unavailable. `tryGetDb()` returns `null` instead. `resetDbInstance()` closes and forgets the shared connection.

`useLocalQuery()` wraps Dexie's live queries with explicit loading/ready/error states. Persistence is browser-only and is not accessed during server prerender.

Ingestion and reconstruction have partial fallbacks when cache access fails. Creating and reopening persistent cases still requires functioning IndexedDB.

### 9.4 Raw and parsed transaction cache

Writes save canonical and raw records atomically. Parsed records omit `raw`, avoiding two stored copies of the response.

`getCachedTransactions()`:

1. Ensures derived caches are current.
2. Loads current parser records.
3. Rebuilds stale/missing parser records from stored raw responses.
4. Saves rebuilt records on a best-effort basis.
5. Returns canonical transactions with `raw: null`.

Inspectors can request the raw response separately through `getRawTransaction()`. Cached canonical transactions do not automatically carry all raw-only fields into semantic interpretation. For example, a decoder reading program return data from `tx.raw` may lack that identifier after cache reload.

`readCachedIngestion()` combines wallet indexes, transaction records, coverage, and the matching last-load record. A missing cached transaction or uncovered interval produces warnings rather than fabricated coverage.

### 9.5 Reconstruction cache

The key combines wallet, range start, and range end. Reuse requires matching parser version, reconstruction version, history completeness, and the exact sorted source signature list.

The cache stores the full reconstructed state and a computation timestamp. Failure to save a state means the state is recomputed later; it does not discard the current result.

### 9.6 Analysis versions

| Version | Current value | Effect of change |
| --- | --- | --- |
| `PARSER_VERSION` | 2 | Canonical cache invalidated and rebuilt from stored raw data |
| `RECONSTRUCTION_VERSION` | 1 | Wallet states rebuilt |
| `SEMANTIC_VERSION` | 9 | Semantic readings change on recomputation |
| Runtime registry version | 12 | Attribution changes on recomputation |
| `BEHAVIOR_VERSION` | 1 | Observation rules change on recomputation |

`DERIVED_CACHES` currently registers parser and reconstruction caches. `ensureDerivedCachesCurrent()` runs invalidation once per database connection. Raw data is not a derived cache and is retained.

`analysisVersions()` reports the five values. `analysisFingerprint()` formats them as `p2;r1;s9;reg12;b1` in this snapshot. The current `Interpreter` type has an ID and an interpretation function, not a separate interpreter version field. Interpretation changes are covered by `SEMANTIC_VERSION`.

The runtime registry takes its version from `solana.json` while merging centralized-vault protocols. Changes to centralized attribution should also update the aggregate registry version.

### 9.7 Deletion behavior

| Operation | Deletes | Retains |
| --- | --- | --- |
| Unmap a secondary wallet | That case's wallet mapping | Labels and chain caches |
| Delete a case | Case, its labels, and its last-load record | Shared chain data and RPC settings |
| Clear transaction cache | Parsed/raw transactions, wallet index, coverage, jobs, wallet states, token metadata | Cases, user labels, RPC settings, `meta` |
| Clear all local data | The entire FraudWatch IndexedDB database | Separate localStorage entries |

The “clear all” function deletes IndexedDB; it does not remove SNS name or display-preference localStorage keys. Browser site-data deletion is broader than this application operation.

Storage settings report table counts and, when available, whole-origin usage/quota from `navigator.storage.estimate()`. Those byte estimates are not a precise per-table measurement.

## 10. Wallet reconstruction and summaries

Sources: [reconstruct.ts](../src/lib/state/reconstruct.ts), [summarize.ts](../src/lib/state/summarize.ts), [volume.ts](../src/lib/state/volume.ts), [counterparties.ts](../src/lib/state/counterparties.ts).

### 10.1 Reconstruction

`reconstructWalletState()` tracks holdings per account: the wallet's native lamports and each observed token account owned by the wallet. Per-asset state sums those accounts instead of assuming one account per mint.

The first pre-balance establishes each observed holding's opening amount. Subsequent post-balances establish later state. Reconstruction compares consecutive observations of the same account and emits a `StateMismatch` when the earlier post-balance differs from the next pre-balance.

The resulting `WalletState` contains:

- Chronological `WalletTransactionEffect` entries.
- Opening and closing `AssetState` arrays.
- Opening/closing observed or partial status.
- Reasons for partial state.
- Mismatches with expected/observed balances and neighboring signatures.
- Decimals reported for token assets.

Each effect carries wallet, signature, slot, time, success, asset changes, and fee paid by that wallet. The fee is already included in the SOL balance delta and must not be subtracted again from reconstructed holdings.

### 10.2 Confidence and boundaries

Incomplete ingestion or a state mismatch makes reconstructed opening/closing state partial. Reconstruction reports the discrepancy; it does not invent a missing transfer to close the gap.

Opening/closing balances describe holdings observed through loaded transactions. They are not independent snapshots of every asset owned by the wallet at the case boundaries. An untouched token account may never appear. Compressed NFT ownership and stake-account value are also not ordinary SPL holdings in this reconstruction.

### 10.3 Wallet summaries

`summarizeEffect()` reads a transaction from one wallet's side. `EffectKind` includes `SEND`, `RECEIVE`, `SWAP`, NFT buy/sell/mint/swap/transfer, `BURN`, `APPROVAL`, `STAKE`, `ACCOUNT`, `PROGRAM`, and `FAILED`.

An `EffectSummary` includes fee-adjusted value inflows/outflows, counterparties, a primary instruction/action when available, an actor when someone else initiated activity, and optional NFT trade details.

Summaries and semantic events are distinct. Summaries drive legacy table/filter/counterparty behavior and support semantic interpreters. The semantic event is the transaction-level reading shared by all wallets.

### 10.4 Activity totals

`transactedOverview()` aggregates per-asset inflows/outflows/net movement, NFT counts, and unique transaction counts. It counts a shared signature once, from the first supplied wallet side, and reports skipped shared sides. `collectCounterparties()` separately builds counterparty counts. `counterpartyRows()` builds the relevant perspective for an observed address using transactions already loaded for mapped wallets.

These are movement totals, not a current portfolio, dollar valuation, or inferred ownership relationship. Assets remain separate; the application does not fetch market prices to combine token amounts.

## 11. Assets, NFTs, and name resolution

### 11.1 Asset metadata

[assets.ts](../src/lib/assets/assets.ts) bundles common assets so known tokens are named immediately. Unknown assets use on-chain lookup through the configured RPC:

1. Fetch the mint account and its parsed supply/decimals.
2. Prefer a Token-2022 metadata extension when present.
3. Otherwise derive and fetch the Metaplex metadata PDA.
4. Decode name, symbol, royalty basis points, and creator recipients where available.
5. Retain an unnamed `source: "none"` record if nothing usable is available.

NFT candidacy begins with zero-decimal token changes of one unit. Standard NFT confirmation checks zero decimals and mint supply exactly one. Compressed NFTs follow a separate path.

Metadata sources are `builtin`, `token-2022`, `metaplex`, `bubblegum`, `das`, and `none`. Missing metadata can be retried after seven days. Older cached records missing NFT/royalty fields are refreshed. Positive metadata is otherwise reused; it is not a historical metadata snapshot.

`useWalletStates()` builds states, publishes known metadata, then fetches missing assets with two workers. Arrival of metadata can change a generic transfer reading into an NFT reading.

### 11.2 NFT transaction readings

The NFT parser in `state/summarize.ts` derives trades from asset movement and payment patterns. It supports buys, sells, bundles, NFT-for-NFT swaps, transfers, mints, and some marketplace escrow patterns.

Additional payment recipients are classified as royalties, rent, marketplace fees, or unidentified. Royalty recipients come from current metadata. Marketplace fee attribution requires the registry's fee-account role. Unrecognized recipients remain unidentified.

The semantic NFT adapter in [semantic/nft.ts](../src/lib/semantic/nft.ts) converts the wallet reading into transaction-wide flows, buyer/seller detail, and escrow infrastructure. It handles an accepted bid's NFT recipient separately from the escrow paying the seller.

`NftDetail.price` is the parser's net payment-asset outlay excluding the network fee. It can include account rent, so it is not guaranteed to equal an advertised marketplace price.

### 11.3 Compressed NFTs

[bubblegum.ts](../src/lib/solana/bubblegum.ts) decodes supported Bubblegum instructions and associated no-op leaf-schema events. It produces `CnftMove` records with asset ID, previous owner when known, new owner, movement kind, and an optional minted name.

Compressed NFTs have no SPL token balances. The semantic flow uses amount `1` and source `compressed_nft`; wallet reconstruction does not create a fictitious token holding for them.

Minted names can come from instruction data. Otherwise the adapter tries optional DAS `getAsset`. Unsupported DAS calls resolve to unnamed metadata rather than blocking history loading.

### 11.4 Labels and display priority

[labels.ts](../src/lib/labels/labels.ts) defines case-scoped `AddressLabel` values. Names are limited to 80 characters, notes to 2,000, and individual tags to 40. Tags are trimmed and deduplicated case-insensitively while retaining the first spelling.

Display priority is:

1. User label.
2. Curated registry label.
3. Attributed community label.
4. Wallet's primary SNS `.sol` name.
5. Shortened address.

User/community/SNS display names do not change the verified protocol identity or determine semantic meaning.

### 11.5 SNS names

[sns.ts](../src/lib/solana/sns.ts) reads favorite-domain, ownership, and reverse records from chain data using batched `getMultipleAccounts`. A selected favorite counts only while the wallet still owns that `.sol` domain.

[use-sns-names.ts](../src/hooks/use-sns-names.ts) stores positive and negative results for seven days under `fraudwatch:sns-names`. The workspace considers mapped wallets and up to 300 busiest unnamed counterparties. RPC account batches contain at most 100 addresses per lookup step.

SNS names are owner-selected claims, not verified personal identities.

### 11.6 Look-alikes

[lookalikes.ts](../src/lib/labels/lookalikes.ts) flags different addresses sharing at least two prefix and two suffix characters, with at least six matching characters across both ends. Bucketing limits comparisons to plausible pairs.

`distinguishingShort()` grows the shorter necessary end to make look-alikes visibly different. `judgeLookalikes()` labels a dust-only address as a likely `decoy` if a similar address moved substantive value. Otherwise the result is `real` or `unclear` under that rule.

This look-alike dust rule uses less than 0.01 SOL, or less than one whole token unit. It is separate from the behavior detector's token dust floor. Results depend on activity loaded in this case and are not proof of malicious intent.

### 11.7 Protocol registry

[registry.ts](../src/lib/protocols/registry.ts) validates registry data and indexes addresses. Validation checks positive integer version, protocol IDs, nonempty names and address sets, valid Solana addresses, supported categories/roles, and duplicate addresses.

The runtime object merges `solana.json` protocol entries with `centralized-vaults.json`, with the latter taking precedence for overlapping protocol IDs. At this snapshot:

- `solana.json`: version 12, 146 protocol entries, 325 addresses.
- `centralized-vaults.json`: version 1, 14 service entries, 32 addresses.
- Merged runtime registry: 159 protocol/service entries, 355 addresses.
- `community-labels.json`: 1,300 unverified display names.

Counts do not add directly because one protocol ID overlaps and is replaced during the merge.

Registry roles are `program`, `pool`, `vault`, `authority`, `fee_account`, `market`, and `wallet`. Categories include core infrastructure, DEXes/aggregators, lending, liquid staking, perps, NFTs/marketplaces, exchanges, bridges, launchpads, and other service types. The exact category catalog is `CATEGORIES` in `registry.ts`.

`enrichTransaction()` matches invoked programs, transaction accounts, and token owners. Unknown programs are retained explicitly. `protocolsUsed()` excludes core programs from the user-facing protocol list.

Registry recognition establishes attribution, not decoder support. A known program can still produce a low-confidence or generic event.

## 12. Semantic interpretation and evidence

Sources: [events.ts](../src/lib/semantic/events.ts), [interpret.ts](../src/lib/semantic/interpret.ts), [interpreters.ts](../src/lib/semantic/interpreters.ts), [defi.ts](../src/lib/semantic/defi.ts).

### 12.1 Pipeline

```text
RPC response
    canonicalize()
Canonical transaction + wallet effects + NFT metadata + curated registry
    buildContext()
Transaction context
    prioritized interpreters; first matching reading wins
Semantic event
    projectEvent() for each wallet
Timeline cards, graph relationships, inspectors, behavior observations
```

The context gathers facts once: fee payer, signers, wallet summaries, NFT reading, instructions with evidence pointers, balance deltas/flows, compressed NFT movements, ambiguous assets, and protocol/infrastructure resolution.

`interpretTransaction()` returns an array, but currently creates exactly one event at index zero. Its ID is `solana:<signature>:event:0`.

An interpreter returns a reading or `null`. If an interpreter throws, the pipeline records a failed trace entry, adds a warning, and tries the next interpreter. A context failure produces an inspectable `UNKNOWN` or `FAILED` fallback.

### 12.2 Event contract

A `SemanticEvent` includes:

- Deterministic ID, model version, signature, slot, and nullable time.
- Broad `category` and finer `action`.
- Meaningful participants and separate infrastructure.
- Asset IDs and semantic flows.
- Optional verified protocol and centralized service.
- Confidence: `HIGH`, `MEDIUM`, or `LOW`.
- Evidence references, warnings, winning interpreter ID, and the attempted interpreter trace.
- Optional NFT, bridge, or stake detail.
- Fee payer and fee metadata.

Categories are `TRANSFER`, `SWAP`, `NFT_TRADE`, `NFT_TRANSFER`, `NFT_MINT`, `BURN`, `STAKE`, `UNSTAKE`, `LENDING`, `BRIDGE`, `LIQUIDITY`, `ACCOUNT`, `APPROVAL`, `PROGRAM_INTERACTION`, `FAILED`, and `UNKNOWN`. A category's existence does not imply a decoder for every protocol in that category.

### 12.3 Interpreter priority

The actual order in `INTERPRETERS` is:

| Priority | Interpreter ID | Reading |
| --- | --- | --- |
| 1 | `failed` | Failed chain transaction |
| 2 | `marketplace-nft-trade` | NFT trade alongside a verified marketplace |
| 3 | `cctp-bridge` | Circle CCTP v1/v2 outgoing burns and incoming messages |
| 4 | `relay-bridge` | Relay native/token deposits |
| 5 | `kamino-lending` | Supported top-level Kamino lending operations |
| 6 | `marginfi-lending` | Supported top-level marginfi operations |
| 7 | `marinade-liquid-stake` | Supported top-level Marinade stake/unstake operations |
| 8 | `sanctum-unstake` | Supported top-level instant unstake operations |
| 9 | `spl-stake-pool` | Supported SPL/Sanctum stake-pool instructions, including inner calls |
| 10 | `jupiter-swap` | Supported Jupiter v6 routes, including relayed routes |
| 11 | `known-dex-swap` | Swap balance pattern alongside a known DEX/aggregator/launchpad |
| 12 | `native-stake` | Native stake instructions and supported stake-account handovers |
| 13 | `token-instruction` | Burns, approvals, and account operations |
| 14 | `generic-nft` | NFT activity without a specific marketplace reading |
| 15 | `generic-swap` | Unattributed swap pattern |
| 16 | `generic-transfer` | Wallet send/receive pattern, refined by parsed transfer instructions |
| 17 | `generic-program` | Program interaction with no clearer value reading |
| 18 | `unknown` | No recognized reading |

Specific bridge interpretations precede swap interpretation. A transaction that swaps then deposits to Relay is therefore read as the bridge action, retaining the associated asset movements as evidence.

### 12.4 Supported protocol details

- **Jupiter:** recognizes four supported route discriminators. The actor comes from the route authority account, allowing a relayer to be the fee payer. Multiple routes become one swap with a warning.
- **Kamino and marginfi:** decode supported top-level lending instructions. Multiple action names become a joined action such as `BORROW+DEPOSIT` at medium confidence. The actor is the first signer whose balances moved, otherwise the fee payer.
- **Marinade:** decodes supported top-level deposit, stake-account deposit, liquid unstake, unstake order, and claim instructions. Inner calls made by an aggregator are left to the appropriate broader reading.
- **Sanctum:** identifies an instant unstake paid from pool reserves and records the stake account handed over.
- **SPL stake pools:** decodes supported deposit/withdraw instruction indexes, including slippage variants and inner calls from a router.
- **CCTP:** decodes burn/message envelopes with direction, chains/domains, remote address, asset/amount, and identifiers. V1 can read a returned nonce when raw return data is present; V2 outbound keeps the message account rather than inventing a nonce.
- **Relay:** records the deposit ID and optional memo request ID. Destination and remote recipient remain unknown because those are not supplied by the decoded on-chain deposit.
- **Native stake:** uses parsed instructions. A withdraw-authority handover with incoming payment can become `STAKE_SALE`, at medium confidence.
- **Marketplace NFTs:** current marketplace recognition refines balance-derived trades; it does not fully decode all marketplace instructions. Such trade readings cap at medium confidence.

Bridge envelopes describe the Solana side. No destination-chain RPC lookup or cross-chain matching is performed.

### 12.5 Flow accounting

`deltas()` adds the fee payer's network fee back for value interpretation and omits token-account rent lamports from owner value pairing. Token movement uses owner addresses where supplied.

`balanceFlows()` pairs movements per asset when one sender or one receiver makes pairing defensible. With several possible senders and receivers, it retains unknown endpoints instead of guessing.

Flow roles distinguish economic movement from supporting movement:

| Role | Meaning |
| --- | --- |
| `spent`, `received` | Actor's economic input/output, with the other side intentionally unknown |
| `payment` | NFT consideration |
| `royalty` | Creator payment identified by metadata |
| `marketplace_fee` | Identified marketplace fee recipient |
| `rent` | Supporting account creation payment |
| `unidentified` | Recipient whose role cannot be established |
| `nft` | Traded/minted/transferred NFT |
| `settlement` | Residual routing, escrow, or account-closure movement |

`actorFlows()` builds spent/received legs and retains residual balances as settlement. Supporting settlement does not become a wallet relationship. Flow reconciliation checks in tests compare semantic balance flows against canonical observations.

### 12.6 Participants and infrastructure

Participant roles include sender, receiver, buyer, seller, trader, depositor, withdrawer, borrower, lender, fee recipient, royalty recipient, and signer.

Infrastructure roles include program, marketplace, router, pool, vault, escrow, bridge, fee account, token account, and PDA. Resolution recognizes invoked programs, token accounts, and registry infrastructure. Interpreters can add infrastructure, such as NFT escrow accounts.

Infrastructure does not become a mapped wallet counterparty merely because it appears in transaction accounts. Participant assembly is shared pipeline logic; interpreters currently cannot provide a fully custom participant list.

### 12.7 Confidence

- **HIGH:** direct status/instruction evidence or a supported protocol instruction whose expected balance direction agrees with observations.
- **MEDIUM:** a known protocol with a strong balance pattern, or a decoded instruction whose observed balances do not fully support the reading.
- **LOW:** a generic pattern/program call with incomplete semantic evidence, or an unknown reading.

Confidence is interpretation confidence, not a fraud score. A high-confidence failed event means failure is established, not that the wallet is suspicious.

### 12.8 Wallet projection

`projectEvent()` exposes a wallet's roles, outgoing flows, incoming flows, and action. Buyers and sellers share one event ID but see `BUY` and `SELL`. Transfers are similarly sided. Swaps, lending, staking, and bridges retain the event's action.

A wallet not participating in the event and not appearing on either end of a flow receives `null`.

### 12.9 Evidence and explanations

`EvidenceRef` points to transaction status, native/token deltas, outer/inner instruction indexes, return data, known-address registry matches, the NFT parser, or asset metadata. References avoid copying the entire transaction into each event.

[explain.ts](../src/lib/semantic/explain.ts) creates a checklist with fixed categories: facts, verified attribution, derived interpretation, heuristic observation, user labels, and community labels. Each statement is `met` or `missing`.

Explanations separate observed balances from protocol attribution and heuristic reasoning. They are generated summaries of evidence; they are not independent formal proofs of every decoded condition.

## 13. Behavior observations

Source: [observations.ts](../src/lib/behavior/observations.ts).

`observeWallet()` analyzes one wallet's sequence using deterministic rules. It never changes chain facts or issues a fraud verdict. Observations annotate events and feed graph visibility factors.

### 13.1 Input selection

Detectors use meaningful ordinary transfers and supported bridge movements. They ignore swap routing, NFT settlement, fees, rent, infrastructure, self-transfers, and dust. Wrapped SOL is treated as SOL for behavior rules only.

The workspace computes observations from loaded wallet history after saved/manual hiding, independently of ordinary transient view filters. Hiding an event through a saved rule can therefore change observation results; narrowing a transient date filter does not recompute rules over only that visible slice.

### 13.2 Rules and thresholds

| Rule | Current condition |
| --- | --- |
| `RAPID_FORWARDING` | Receipt followed by outgoing movement to other parties within 600 seconds; at least 80% passed on, with outgoing ratio capped at 125% |
| `FUND_SPLIT` | Outgoing movement to at least 3 recipients within 3,600 seconds; a nearby source receipt is linked only when total is 80–125% of it |
| `CONSOLIDATION` | Incoming movement from at least 3 senders within 3,600 seconds |
| `REPEATED_COUNTERPARTY` | At least 5 transfer events with the same counterparty |
| `CIRCULAR_MOVEMENT` | Opposite-direction return with the same asset/counterparty within 604,800 seconds; at least 50% returned |
| `BRIDGE_MILESTONE` | Eligible decoded bridge movement entering or leaving Solana |
| `EXCHANGE_DEPOSIT` | Outgoing transfer to a registry-verified exchange; runs grouped when successive deposits are within 86,400 seconds |

Behavior dust floors are 10,000,000 lamports for SOL and 0.01 token units when decimals are known, with a minimum of one base unit. Unknown token decimals use a one-base-unit floor.

All thresholds live in `BEHAVIOR_THRESHOLDS`. Observation IDs derive from type, wallet, asset, and the first triggering event. Each observation records its time span, triggering event roles, written rule, thresholds, and calculated values.

Rapid forwarding is greedy and per asset. It does not establish that a particular received coin funded a later transaction, trace forwarding through a swap, or detect arbitrary multi-wallet cycles.

## 14. Timeline and relationship chart

Sources: [wallet-timeline.tsx](../src/app/case/timeline/wallet-timeline.tsx), [timeline-canvas.tsx](../src/app/case/timeline/timeline-canvas.tsx), [layout.ts](../src/lib/timeline/layout.ts), [lanes.ts](../src/lib/timeline/lanes.ts).

### 14.1 Rendering model

The timeline builds per-wallet entries, then merges them by transaction signature. A shared transaction has one display position with an entry on each participating lane. Event cards use semantic wallet projections where available and summary-based fallbacks elsewhere.

The canvas renders timeline items, clusters, cards, cross-lane connectors, lane boundaries/forks, and observation spans. D3 supplies scales and interaction behavior. React renders surrounding controls and inspectors.

`canvas.ts` reads CSS colors, sizes canvas for device pixel ratio, and centralizes horizontal zoom behavior.

### 14.2 Layout

Two spacing modes are available: elapsed time and event spacing. Missing event timestamps inherit the previous known time, starting from a fallback range time; this is display placement, not a recovered chain timestamp.

Pure layout functions:

- Group nearby events by screen-space gap.
- Split dense groups into calendar-aligned UTC buckets.
- Merge overlapping cluster shapes.
- Place cards in available tiers or retain compact dots.
- Build activity histograms.
- Step to neighboring events or find an event at a selected time.
- Compute fit/zoom transforms and minimap targets.

The layout clusters rendered geometry without deleting transactions. Zooming can split a cluster back into individual events.

### 14.3 Shared activity

Cross-lane connectors run from lanes losing value to lanes gaining value when direction is clear. Otherwise adjacent involved lanes connect without an arrow. Nearby connectors merge into trunks with a count to reduce visual clutter.

Wallet-range forks can be marked where a secondary wallet starts from an interaction. This is a mapping origin, not an inferred ownership relationship.

### 14.4 Minimap and relationship mode

`timeline-minimap.tsx` displays an activity histogram and visible window. A click while fully zoomed out zooms to roughly one eighth of the range; otherwise it recenters the existing span. Bounds remain inside the full range.

`relationship-chart.tsx` provides an alternative chronological relationship view using `buildRelationships()`. That helper currently consumes per-wallet summaries, while the interaction graph primarily consumes semantic flows. The two relationship surfaces are not identical domain implementations.

### 14.5 Interaction

- `Cmd/Ctrl+K`: open case search.
- `Cmd/Ctrl+\`: toggle both workspace side panels.
- Focused timeline `ArrowLeft` / `ArrowRight`: step through events.
- Focused timeline `Escape`: clear selection.
- Pinch or `Ctrl/Cmd` plus wheel: zoom.
- Predominantly horizontal wheel movement: pan through time.
- Vertical wheel movement: scroll overflowing lanes; otherwise zoom the timeline.

Search results also support arrow selection and Enter. Timeline selections can open raw data, evidence, behavior observations, bookmarks, and graph navigation.

## 15. Interaction graph

Sources: [build.ts](../src/lib/graph/build.ts), [layout.ts](../src/lib/graph/layout.ts), [wallet-graph.tsx](../src/app/case/graph/wallet-graph.tsx).

### 15.1 Graph construction

`buildInteractionGraph()` receives aligned effects, summaries, and semantic events for filtered wallet lanes. It constructs one relationship edge per address pair while preserving each transaction's direction and amount.

Node kinds are `wallet`, `counterparty`, `program`, `aggregate`, `burn`, and `entity`. Edge kinds distinguish value interactions from optional program-call relationships.

Seen-movement keys prevent a movement from being counted twice when both mapped wallets have it. NFT fee/royalty/supporting legs remain grouped inside the buyer/seller relationship rather than producing unrelated fee nodes. Swaps, staking, lending, and bridges do not connect wallets to every routed pool or vault.

Meaningful flows require known endpoints. `spent`, `received`, and `settlement` legs do not become wallet edges. A burn can be represented using the reserved `__burned__` node.

### 15.2 Entity grouping and clusters

Unmapped registry addresses can collapse into `entity:<protocol>` nodes. Several exchange wallets can therefore appear as one verified service. Expanding an entity restores individual addresses. Mapped wallets retain their wallet identity.

Addresses omitted from individually ranked nodes can appear in fixed groups: known services, infrastructure, decoys, unknown addresses, and one-off counterparties. These are display categories, not community-detection or ownership clusters.

The renderer treats aggregate clusters separately from the main address canvas. Expand/collapse controls manage those groups.

### 15.3 Relationship summaries

`RelationshipSummary` includes unique interaction count, direction counts, per-asset totals for both directions, effect/event composition, first/last interaction, active UTC days, and initiator counts.

Its activity labels are deterministic:

- One interaction or fewer: `One-off`.
- Activity on at most one UTC day: `Single burst`.
- At least 30 elapsed days and 3 active days: `Recurring`.
- Other multi-day activity: `Long-running`.

Amounts remain per asset. The graph does not turn raw token units into an exchange-rate valuation.

### 15.4 Ranking and display limits

Default node limit is 25. Workspace choices include 10, 25, 50, 100, or an unlimited option. Ranking modes are significant relationships, interaction count, value, incoming count, outgoing count, and recency.

The significant view combines transparent visibility factors such as contact with several mapped wallets, event counts, asset movement shares, observations, direction counts, and recency. Nodes record display reasons, including service attribution where applicable. This is a rendering priority, not a risk score.

Increasing the limit expands visibility; it does not ingest additional wallets.

### 15.5 Layout and zoom

`layoutGraph()` anchors mapped wallets, places shared counterparties between connected wallets, places other counterparties around their main mapped wallet, and applies a bounded D3 collision pass. Stable ID hashes and sorted inputs reduce layout drift. The simulation runs 160 synchronous ticks; it is not a permanently running physics simulation.

Spacing choices are compact, normal, wide, and widest. The preference persists under `fraudwatch:graph-spacing`.

Node radius grows logarithmically with transaction count and is capped. Zoom tiers use hysteresis to avoid flicker. At far zoom, major edges keep the busiest relationships plus mapped-wallet and verified-service connections.

The canvas supports pan, zoom, fit/reset controls, selection, hover detail, and local relationship isolation. Ordinary wheel swipes pan in two dimensions; pinch or modified wheel zooms.

Mapped wallets, expanded clusters, and explicitly retained addresses can exceed a chosen display limit. The limit bounds ordinary counterparty ranking, not every node produced by every expansion option.

## 16. Table, inspectors, search, and filters

### 16.1 Transaction table

[wallet-state-view.tsx](../src/app/case/wallet-state-view.tsx) presents one wallet/asset change per row, or a row for a transaction with no asset movement. It supports sorting, pagination, transaction selection, previous/next navigation, and bulk hide/show actions.

Sorting considers the full filtered row set before pagination. A transaction involving multiple assets can occupy multiple rows, so row count is not necessarily unique transaction count.

The default page size is 100 rows. Amount sorting converts balances to decimal JavaScript numbers using known asset metadata; this is display ordering across assets, not a market-value comparison or exact ledger calculation.

Hidden transactions remain available through “Show hidden,” with their hidden reason. Reconstructed before/after values come from full loaded history rather than from only visible rows.

### 16.2 Inspectors

- **Address inspector:** state, full address, registry/community/SNS attribution, user name/note/tags, look-alikes, mapping/pause/unmap actions, and movement totals.
- **Transaction inspector:** wallet effect, semantic event, fee/status, participants, asset changes, shared wallets, observations, bookmark/hide controls, raw JSON, and an explorer link.
- **Event evidence:** separates chain facts, verified attribution, derived readings, heuristic gaps, and display labels.
- **Observation inspector:** rule, thresholds, calculated amounts/time span, and triggering transactions.
- **Relationship inspector:** direction/asset totals, dates, activity composition, observations, and links to contributing transactions.
- **Entity inspector:** the service/protocol and the individual registry addresses grouped under it.
- **Developer details:** analysis versions, interpreter trace, registry matches, canonical transaction, wallet effect/summary, semantic event, and observations.

`Copy debug bundle` copies structured JSON including the fingerprint and those analysis objects. Raw RPC JSON has its own viewer; the bundle's canonical `raw` field is replaced with a marker when present. User case labels and RPC settings are not included. Chain addresses and protocol/infrastructure labels still appear.

### 16.3 Shared filters

`TxFilter` supports semantic categories, low confidence, legacy effect kinds, assets, direction, minimum amount for one asset, protocols, address, user tags, date range, likely decoys, and the signatures of a selected relationship.

`passesFilter()` operates on memoized `FilterableTx` records. Amount comparisons use base units. Asset hiding removes a transaction only if every moved asset is hidden. Filters affect displayed timeline/table/graph inputs, not reconstruction, ingestion completeness, or mismatch checks.

Selecting a relationship or showing a transaction in the graph can narrow the shared filter. An apparently empty graph can therefore reflect current filter state.

### 16.4 Persistent hiding

Manual hides and named hide rules belong to the case. The precedence is:

1. A manual hidden signature remains hidden.
2. A shown signature bypasses hide rules.
3. Otherwise the first enabled matching rule supplies the hidden reason.

Within a rule, every populated condition must match. Multiple values within a condition provide alternatives. Conditions include effect kinds, only specified assets, per-asset amount comparison, counterparties, tags, and protocols. A rule with no conditions matches nothing.

Hidden reasons are resolved across all lanes by signature. Hiding one side hides the same on-chain transaction everywhere. Unhiding a rule-matched transaction can create a shown exception. Undo reapplies only the changed signature sets, preserving later edits.

The likely-decoy hide action creates/updates a saved `lookalike-decoys` rule. It can be disabled in rule management.

### 16.5 Search

The workspace builds search items for mapped wallets, observed/labeled addresses, tags, assets, protocols, and transaction signatures. [search.ts](../src/lib/search.ts) requires every query word to match and prioritizes exact matches, prefixes, then substrings, with kind and label tie-breaks. Default result limit is 12.

Search picks have different actions: select a wallet, open an address, navigate to a transaction, apply a tag filter, or jump to the earliest matching asset/protocol transaction. Search uses loaded case data; it does not query the chain for arbitrary pasted signatures.

## 17. Privacy and operational boundaries

### 17.1 Data ownership

Cases and chain caches reside in the browser's IndexedDB for the application's origin. There is no server copy or synchronization. Different browsers, devices, profiles, hostnames, ports, or protocols can expose different local stores.

Browser site-data clearing, private-mode restrictions, quota limits, or origin changes can make cases unavailable. Current full-case portability is unfinished, so a startup link is not a backup.

### 17.2 Credentials and requests

The configured RPC URL is treated as secret-bearing data and remains in local settings. Application links contain only allowed startup fields or local case routing state. Normal debug bundles omit RPC settings.

RPC providers receive the addresses and transaction requests necessary to load the investigation. Local-first removes a FraudWatch investigation backend; it does not make requests invisible to the selected provider.

The code redacts URLs it formats itself, but upstream provider error messages can be included in surfaced RPC errors. Do not assume arbitrary third-party error text has been sanitized for embedded secrets.

### 17.3 Other network traffic

Chain data and on-chain metadata use the configured endpoint, but it is inaccurate to say the browser makes no other network requests:

- Token artwork can load from Trust Wallet's asset CDN, CoinGecko's image CDN, or a stored HTTPS logo URL.
- Clicking explorer links opens Solscan with the selected public address/signature.
- UI assets are served by the application host.
- Next's Google font integration can fetch fonts during the build.

Artwork requests use `no-referrer`, lazy loading, and text fallback on failure. They still expose normal request metadata and the requested token artwork path to the remote host.

### 17.4 Local storage and trust

IndexedDB/localStorage are local browser persistence, not an application encryption layer. Scripts running under the same origin can access their data. The repo does not implement account authentication or encrypted case storage.

User/community labels are display claims. The curated registry is the only accepted verified attribution input, and curated entries can still be mistaken. SNS names are selected by their owners.

Behavior rules describe movement patterns. They are not findings of culpability or ownership. Inspect the underlying transaction and evidence before relying on a reading.

### 17.5 Public fixtures and third-party data

Fixtures contain public transactions but can disclose which transactions an investigator chose to examine. Capture only material intended for publication.

The community snapshot's attribution and licensing caveat are documented in [protocols/sources/README.md](../protocols/sources/README.md). The source has no stated license; the repository records a need to resolve redistribution rights before relying on it for a public release.

## 18. Scripts and fixture maintenance

### 18.1 Capture transactions

[capture-fixture.ts](../scripts/capture-fixture.ts) runs directly with Node 24's TypeScript support. It is separate from the browser ingestion adapter.

Capture a specific signature:

```sh
node scripts/capture-fixture.ts \
  --out fixtures/solana/defi \
  --signature <public-transaction-signature>
```

Set `FRAUDWATCH_RPC_URL` in the local process environment, or provide `--rpc <endpoint>`.

Search a program's recent transactions for named Anchor instructions:

```sh
node scripts/capture-fixture.ts \
  --out fixtures/solana/defi \
  --program <program-address> \
  --instruction <InstructionName> \
  --count 1 \
  --scan 300
```

`--signature` and `--instruction` can be repeated. Defaults are one example per instruction and a scan target of 300 nonfailed candidate transactions. Program signature requests use pages of 100.

The script reads instruction names from logs while tracking the invoked program stack, saves compact raw transaction JSON, and prints signatures/capture dates. Calls get up to five attempts with increasing waits. Failed fetches and unmet capture counts are reported. This script does not establish comprehensive protocol coverage.

Specific-signature filenames use the first 12 signature characters. Instruction searches use instruction names, optionally with a numeric suffix. Reusing an output name overwrites that file; use a deliberate output location and review the resulting fixture diff.

### 18.2 Generate community labels

[import-community-labels.ts](../scripts/import-community-labels.ts) reads the committed tribixbite snapshot and both curated registry files:

```sh
node scripts/import-community-labels.ts
```

It imports only `program` and `address`, validates addresses, normalizes whitespace, skips curated addresses, excludes accusation/token-trust sections, sorts keys, and writes `protocols/community-labels.json` with source attribution.

The script uses root-relative paths. Run it from the repository root. It does not fetch the remote source automatically. Maintain the snapshot and script instead of hand-editing generated labels.

### 18.3 Fixture groups

| Directory | Coverage |
| --- | --- |
| `basic/` | SOL transfer, SPL transfer, failed transaction |
| `defi/` | Jupiter, generic known swaps, Marinade, Kamino, marginfi, CCTP, Relay, native stake sale, Sanctum, SPL stake pool |
| `cnft/` | Bubblegum mint v2 and transfer |
| `nft-sale/` | Tensor NFT trade and metadata account |
| `magic-eden-sale/` | Magic Eden trade and metadata account |
| `magic-eden-core/` | A Core transaction preserving the known unsupported-reading case |

Some NFT fixtures wrap the response with known buyer/seller/mint context. Test helpers read the appropriate shape; not every JSON file is a bare `getTransaction` result.

## 19. Tests and continuous integration

### 19.1 Test configuration

Vitest runs `src/**/*.test.ts` in Node with no browser DOM environment configured. Tests use recorded fixtures and synthetic canonical transactions. Several database tests use lightweight in-memory/mock table interfaces, not a full browser IndexedDB instance.

The test helper [semantic/testing.ts](../src/lib/semantic/testing.ts) supplies fixture reads, synthetic transactions, common amounts, and reconciliation assertions.

### 19.2 Coverage map

| Test file/group | Main checks |
| --- | --- |
| `case/wallet-range.test.ts` | Secondary wallet validation and creation ranges |
| `db/rpc-settings.test.ts` | Endpoint status recording and stale-endpoint protection |
| `db/derived.test.ts` | Version invalidation, reconstruction cache reuse, analysis fingerprint |
| `timeline/lanes.test.ts` | Cross-lane connector trunk merging and direction |
| `graph/build.test.ts` | Meaningful relationships, routing exclusion, NFT grouping, summaries and ranking |
| `behavior/observations.test.ts` | Rules, thresholds, excluded movements, deterministic IDs |
| `semantic/events.test.ts` | Event categories, flows, infrastructure, ambiguity, failure and stable identity |
| `semantic/interpret.test.ts` | Context, interpreter ordering/failure, and protocol resolution |
| `semantic/nft.test.ts` | Real/synthetic trades, escrow, royalties, bundles, cNFTs, Core fallback |
| `semantic/defi.test.ts` | Protocol decoders, actors, confidence, bridge/stake details |
| `semantic/explain.test.ts` | Evidence categories, claims, labels, and gaps |
| `semantic/regression.test.ts` | Pinned readings of real fixtures and shared-wallet identity |
| `semantic/performance.test.ts` | Pipeline budgets for increasing case sizes |
| `app/case/timeline/event-card.test.ts` | Wallet-sided card wording and amounts |

The regression table pins category, action, interpreter ID, and confidence. Update a pinned reading only when the semantic change is intended. A passing regression test can preserve a known limitation; it does not prove the reading is complete.

### 19.3 Performance scenarios

The performance test times interpretation, reconstruction/summaries, behavior, and graph building:

| Mapped wallets | Transactions | Budget |
| --- | --- | --- |
| 1 | 1,000 | 3,000 ms |
| 5 | 2,000 | 5,000 ms |
| 10 | 5,000 | 10,000 ms |

These are regression budgets in Node using mostly synthetic transfers mixed with recorded transactions. They do not measure RPC latency, real IndexedDB I/O, canvas responsiveness, or memory use in a browser.

### 19.4 CI

[ci.yml](../.github/workflows/ci.yml) runs on pushes to `main` and pull requests. It checks out the repo, uses the package-manager version from `package.json`, installs on Node 24 with a frozen lockfile, and runs:

```sh
pnpm typecheck
pnpm lint
pnpm test
```

Production build and browser end-to-end tests are not CI steps in this workflow.

### 19.5 Verification for this documentation snapshot

`pnpm test` passed on 8 October 2026: **14 test files, 142 tests**. Documentation was checked against repository source and local paths. A production build, browser interaction run, live RPC verification, and independent registry attribution audit were not part of this documentation task.

## 20. Maintenance and extension guide

Read [CONTRIBUTING.md](../CONTRIBUTING.md), [AGENTS.md](../AGENTS.md), and [docs/MISTAKES.md](MISTAKES.md) before changing implementation. The installed Next.js version ships relevant guides in `node_modules/next/dist/docs/`; repository instructions require reading the relevant guide before writing Next.js code.

### 20.1 Add a protocol decoder

1. Capture representative public transactions before editing: a simple action and a relayed/inner/multiple-action edge case where applicable.
2. Confirm program ID, instruction discriminator, and account layout against those fixtures.
3. Reuse `TransactionContext`, binary readers, `reading()`, and `actorFlows()`.
4. Distinguish economic actors from the fee payer.
5. Return `null` for unsupported layouts instead of applying a guessed decoder.
6. Lower confidence and explain disagreement when balance evidence does not support the decoded action.
7. Place the decoder before generic fallbacks in `INTERPRETERS`.
8. Bump `SEMANTIC_VERSION` when readings change; the implemented interpreter type has no per-interpreter version field.
9. Add focused decoder tests and intentional pinned regression rows.
10. Check projections, event cards, inspectors, behavior, and graph exclusion rules for the new event category/action.

Adding a program to the registry alone does not add a decoder.

### 20.2 Change registry attribution

Add verified address mappings to `protocols/solana.json` or centralized service wallets to `protocols/centralized-vaults.json`. Use supported roles and categories, avoid address duplication, and document the evidence in the change description.

Increment the aggregate registry version when attribution changes. Review the runtime merge when editing a protocol ID present in both files. Regenerate community labels when curated entries supersede unverified names.

Third-party snapshots belong under `protocols/sources/` with attribution. Do not promote an unreviewed external list wholesale into verified interpretation data.

### 20.3 Change parser or reconstruction

- Canonical shape/output changes require a parser version bump.
- Balance reconstruction changes require a reconstruction version bump.
- Register any new persisted derived cache in `DERIVED_CACHES` with its invalidation rule.
- Keep raw transactions available so parser updates can avoid refetching.
- Preserve exact amount handling and partial-state reporting.
- If adding a semantic cache, key it on all relevant analysis inputs and the fingerprint; no such cache exists today.

### 20.4 Change behavior rules

Keep thresholds in `BEHAVIOR_THRESHOLDS`, bump `BEHAVIOR_VERSION`, and test boundary cases plus false positives. Preserve triggering events, written rules, thresholds, and values so observations remain inspectable.

Do not silently transform an observation into a risk score, accusation, or inferred ownership link.

### 20.5 Change UI and case state

Reuse components under `src/components/ui/` and established workspace patterns. Keep canvas handlers free of repeated semantic analysis.

Decide whether new state is a persisted case field, a URL field, localStorage preference, or transient React state. A new persistent field needs sensible behavior for old records that lack it. A new IndexedDB index/table requires a versioned schema change.

Keep effects/summaries/events aligned when filtering. Shared signatures represent one transaction across lanes. Preserve keyboard navigation, focus, readable amount labels, and source attribution.

### 20.6 Review gates

Run the CI commands for implementation changes. Also verify relevant browser interaction when changing canvas gestures, persistence flows, sorting, accessibility, or cross-view navigation; Node tests do not exercise those surfaces.

The mistakes log records specific pitfalls: stale sprint bases, implicit form submission, unrelated whole-file formatting, and serialized rewrites of hand-formatted JSON. Make narrow textual data edits and review diff size.

## 21. Troubleshooting and known limitations

### 21.1 Operational troubleshooting

| Symptom | Likely explanation | Next check |
| --- | --- | --- |
| Case URL says case not found | Local case absent on this browser/origin | Open recent cases on the original origin/profile; use startup link to create a new case if needed |
| IndexedDB unavailable | Browser restriction or storage failure | Check browser site-data/private-mode settings |
| HTTP 401/403 | Key/access issue or provider rejecting browser requests | Test the endpoint and its CORS policy |
| Network/CORS failure | Endpoint unavailable or browser access denied | Inspect connectivity; the client cannot disambiguate these failures |
| Repeated HTTP 429 | Provider rate limits | Allow retries or reduce investigation scope |
| Old range remains partial | Scan caps, pruning, missing timestamps, or undiscovered accounts | Read per-wallet coverage warnings and try a narrower range or suitable archive/indexed endpoint |
| Wallet state mismatch | Missing history or uncertain ordering | Inspect expected/observed balances and adjacent signatures |
| Tokens unnamed | Metadata missing/unavailable | Keep the mint identity; inspect RPC metadata support |
| Event changes after load | NFT metadata arrived | Review the new evidence and confidence |
| Graph unexpectedly sparse | Filters, hides, node limits, grouping, or nonrelationship routing | Review filters, hidden transactions, entity/cluster expansion, and graph limits |
| Cache write warning | Quota/write failure | Free browser storage or clear fetched chain data after reviewing what will be removed |
| RPC test passes but history fails | Connectivity is weaker than archive/method capability | Check the failing method and coverage warnings |

### 21.2 Current semantic limitations

- Exactly one semantic event is generated per transaction. Several distinct actions can be combined into a joined reading or represented by one winning interpreter.
- Marketplace instruction decoding is incomplete; NFT trade attribution remains pattern-based and capped at medium confidence.
- Metaplex Core assets lack the ordinary token-balance signal used by the NFT parser. A recorded Core trade intentionally retains a low-confidence transfer fallback.
- Many known registry programs have no specific decoder: examples include broad perps/liquidity activity and several bridge families.
- Kamino/marginfi actor selection uses moving signers, which is less specific than fully decoded obligation ownership.
- Unknown endpoints in ambiguous multi-party flows remain unknown. Settlement balances are supporting evidence, not proof of precise routed transfers.
- NFT royalties use currently fetched metadata, not necessarily the creators/royalties at the transaction's historical date.
- Net outlay and rent can make NFT “price” or protocol “spent” amounts differ from economic consideration alone.
- Some decoders depend on raw-only fields; cached canonical records return `raw: null` and may omit those identifiers on reopen.
- Ordinary filters, relationship chart logic, and some inspectors still consume wallet summaries as well as semantic events.
- Behavior observations are per wallet and per asset; multi-hop/cross-wallet inference and forwarding through swaps are deferred.

### 21.3 History and storage limitations

- Standard scanning discovers current token accounts and accounts observable in loaded history. It cannot guarantee discovery of every historical closed account.
- History is bounded by caps and provider retention. A complete connectivity test does not guarantee complete wallet data.
- Opening/closing reconstruction is restricted to observed holdings, not a comprehensive boundary portfolio snapshot.
- Parser and coverage caches are shared by wallet/chain identity rather than isolated by provider or Solana cluster. The UI has no cluster selector; use the intended network consistently.
- There is no implemented complete-case backup/import, encrypted storage, cloud recovery, or watch daemon.
- Full local database clearing leaves separate localStorage name/preference keys.
- The test suite has strong semantic regression coverage but does not prove browser rendering, real IndexedDB migrations, all older ingestion paths, or arbitrary live protocol layouts.

### 21.4 Reading older issue lists

[CHRONOLOGY_OPEN_ISSUES.md](CHRONOLOGY_OPEN_ISSUES.md) records earlier unresolved work. Some entries are overtaken by current code: stake-pool, marginfi, Sanctum, and Relay support now appears in interpreters/tests. Use that document as historical context and verify an item's current status against implementation.

## 22. Existing documents and roadmap

### 22.1 Documentation roles

| Document | Role |
| --- | --- |
| [README.md](../README.md) | Product introduction, setup, responsible use, links |
| [CONTRIBUTING.md](../CONTRIBUTING.md) | Development workflow, contribution principles, fixture/registry guidance |
| [ROADMAP.md](../ROADMAP.md) | Future product direction without delivery dates |
| [docs/ARCHITECTURE.md](ARCHITECTURE.md) | Local-first data lifecycle and semantic model |
| [docs/TERMINOLOGY.md](TERMINOLOGY.md) | Domain vocabulary, including planned concepts |
| [docs/00_README.md](00_README.md) | Original MVP plan and completion gate |
| [docs/CHRONOLOGY_OPEN_ISSUES.md](CHRONOLOGY_OPEN_ISSUES.md) | Historical issue inventory and suggested work order |
| [docs/SOLANA_BRIDGES.md](SOLANA_BRIDGES.md) | Bridge registry coverage and future correlation context |
| [docs/PROTOTYPE_AUDIT.md](PROTOTYPE_AUDIT.md) | Audit of the earlier prototype; not the current architecture specification |
| [docs/MISTAKES.md](MISTAKES.md) | Repository working rules derived from prior mistakes |
| [protocols/sources/README.md](../protocols/sources/README.md) | Source snapshots, dates, attribution, import rules, licensing caveat |

The terminology and MVP plan include future portability and boundary-context concepts. For implemented tables and workflows, use this guide and source code.

### 22.2 Sprint document catalog

The sprint files under `docs/sprints/` record design and acceptance plans. Their presence is not proof that every acceptance condition shipped.

| Area | Sprint files |
| --- | --- |
| Foundation | `SPRINT_00_ARCHITECTURE_FREEZE.md`, `SPRINT_01_APP_SHELL_RPC_CASE_MODEL.md` |
| Fetch/cache/state | `SPRINT_02_GENERIC_SOLANA_RPC_INGESTION.md`, `SPRINT_03_INDEXEDDB_CACHE.md`, `SPRINT_04_WALLET_STATE_RECONSTRUCTION.md` |
| Timeline/workspace | `SPRINT_05_SINGLE_WALLET_TIMELINE.md`, `SPRINT_05A_WORKSPACE_LAYOUT_FILTERS.md` |
| Attribution/ranges | `SPRINT_06_COUNTERPARTIES_LABELS_PROTOCOLS.md`, `SPRINT_06A_OPTIONAL_CASE_DATES.md` |
| Mapping/NFT/graph | `SPRINT_07_DYNAMIC_SECONDARY_WALLETS.md`, `SPRINT_07A_NODE_GRAPH_VIEW.md`, `SPRINT_07B_NFT_TRADES.md`, `SPRINT_08_MULTI_WALLET_GRAPH.md` |
| Scale/interactions | `SPRINT_08A_MINIMAP.md`, `SPRINT_09_GRAPH_SCALING_FILTERS.md`, `SPRINT_09A_INTERACTION_MAP.md`, `SPRINT_09B_REPOSITORY_RELIABILITY.md`, `SPRINT_09C_BULK_HIDE_FROM_MAP.md` |
| Later MVP plans | `SPRINT_10_BOUNDARY_CONTEXT_PORTABILITY.md`, `SPRINT_11_RELIABILITY_PRIVACY_DEPLOYMENT.md` |
| Semantic foundation | `SPRINT_C1_SEMANTIC_EVENT_DOMAIN_MODEL.md`, `SPRINT_C2_INTERPRETER_FRAMEWORK_PROTOCOL_RESOLUTION.md` |
| Semantic coverage | `SPRINT_C3_NFT_TRADE_RECONSTRUCTION.md`, `SPRINT_C4_DEFI_PROTOCOL_SEMANTIC_EVENTS.md` |
| Event UX/intelligence | `SPRINT_C5_EVENT_CENTRIC_TIMELINE.md`, `SPRINT_C6_BEHAVIORAL_SEQUENCE_DETECTION.md`, `SPRINT_C7_RELATIONSHIP_INTELLIGENCE_GRAPH_INTEGRATION.md` |
| Evidence/reliability | `SPRINT_C8_EVIDENCE_RELIABILITY_INVESTIGATION_POLISH.md` |

An additional [global-preferences initiative](sprints/global-preferences/00_README.md) is present as planning documents in this working tree. It proposes global view preferences, per-case overrides, and detail/custom presets. Its proposed preferences tables, settings route, and `src/lib/preferences/` modules are not implemented in this snapshot.

The initiative's files under `docs/sprints/global-preferences/` are:

- `00_README.md`: initiative index and planning status.
- `01_ARCHITECTURE_AND_AUDIT.md`: current-state audit and proposed layering.
- `02_PREFERENCE_SCHEMA_AND_STATE.md`: proposed settings schema and resolution.
- `03_GLOBAL_PREFERENCES_UI.md`: proposed preference interface and theme controls.
- `04_INVESTIGATION_DETAIL_PRESETS.md`: proposed Minimal/Balanced/Forensic presets.
- `05_INTERACTION_GRAPH_INTEGRATION.md`: graph preference integration plan.
- `06_TIMELINE_INTEGRATION.md`: timeline preference integration plan.
- `07_TRACE_GRAPH_INTEGRATION.md`: proposed trace graph integration.
- `08_CASE_OVERRIDES.md`: proposed case-specific view settings.
- `09_CUSTOM_PRESETS.md`: proposed user presets and sharing.
- `10_POLISH_TESTING_AND_RELEASE.md`: proposed final verification and release gates.

### 22.3 Planned direction

The roadmap prioritizes a user-controlled investigation graph with evidence-backed suggestions, then Ethereum/EVM support and bridge correlation, then Bitcoin/UTXO investigation. Other proposed work includes deeper decoders, notes/reports, portable cases, watch mode, adjustable observations, sourced labels, a demo case, and scale improvements.

These are proposals, not supported APIs. No implementation should assume cross-chain adapters, complete case serialization, or semantic persistence already exists.

## 23. Source file reference

Paths below are relative to the repository root. Test files are listed in section 19. Generated dependency/build files are outside the maintained application inventory.

### 23.1 Domain and persistence modules

| Directory | Files and responsibilities |
| --- | --- |
| `src/lib/assets/` | `assets.ts`: native/wrapped IDs, built-in assets, mint metadata, Metaplex parsing, cNFT naming |
| `src/lib/behavior/` | `observations.ts`: thresholds, meaningful movements, seven detectors, deterministic observations |
| `src/lib/cache/` | `coverage.ts`: interval subtraction/merging and finality clamping |
| `src/lib/case/` | `model.ts`: case types/validation/creation; `range.ts`: UTC ranges; `wallet-range.ts`: mapping/ranges/pause; `address-state.ts`: address classification; `lanes.ts`: ordering/visibility; `bookmarks.ts`: bookmark mutation; `hiding.ts`: rules, hidden reasons, bulk operations and undo |
| `src/lib/db/` | `db.ts`: schema/connection/errors; `cases.ts`: recent/rename/touch/delete/duplicate lookup; `rpc-settings.ts`: endpoint persistence; `address-labels.ts`: label CRUD; `transaction-cache.ts`: raw/canonical/index cache; `ingestion-jobs.ts`: last load/cache rehydration; `wallet-states.ts`: reconstruction/metadata cache; `derived.ts`: version invalidation; `storage.ts`: counts/quota/deletion |
| `src/lib/graph/` | `build.ts`: nodes, meaningful interactions, entities/clusters, summaries/ranking; `layout.ts`: positions, node radius, spacing, zoom detail |
| `src/lib/ingest/` | `ingest.ts`: bounded history; `activity-span.ts`: omitted-date discovery; `pool.ts`: reusable bounded queue; `intersections.ts`: shared signatures and mapping summary |
| `src/lib/labels/` | `labels.ts`: normalized user annotations/display names; `community.ts`: bundled unverified names; `lookalikes.ts`: address comparison, distinguishing display, dust judgments |
| `src/lib/protocols/` | `registry.ts`: parse/merge/index/validate/enrich registry |
| `src/lib/routing/` | `case-path.ts`: view paths and route validation; `map-params.ts`: safe startup wallet/range query fields |
| `src/lib/rpc/` | `json-rpc.ts`: requests/retries/timeouts/errors; `generic-adapter.ts`: standard and optional provider methods; `settings.ts`: settings type; `test-connection.ts`: connection test; `url.ts`: validation/redaction |
| `src/lib/semantic/` | `events.ts`: event contracts; `interpret.ts`: context/pipeline/assembly; `interpreters.ts`: priorities/generic/native readers; `defi.ts`: protocol decoders; `nft.ts`: trade flows; `flows.ts`: pairing/reconciliation; `reading.ts`: shared reader helpers; `resolver.ts`: protocol/infrastructure resolution; `projection.ts`: wallet side; `explain.ts`: evidence checklist; `versions.ts`: analysis versions/fingerprint; `testing.ts`: fixture/assertion helpers |
| `src/lib/solana/` | `address.ts`: validation/shortening; `amount.ts`: integer amount helpers; `anchor.ts`: instruction byte readers; `bubblegum.ts`: cNFT moves; `canonical.ts`: parsed transaction model; `programs.ts`: system/token/stake/memo IDs; `sns.ts`: primary-domain lookup |
| `src/lib/state/` | `reconstruct.ts`: account observations and effects; `summarize.ts`: per-wallet/NFT reading; `counterparties.ts`: unique counterparty counts; `volume.ts`: movement summaries |
| `src/lib/timeline/` | `layout.ts`: pure grouping/placement/navigation; `lanes.ts`: shared events/connectors; `relationships.ts`: chronological pair activity; `filter.ts`: shared display filter |
| `src/lib/` | `gestures.ts`: timeline/graph wheel mapping; `search.ts`: case search ranking |

### 23.2 Hooks and shared components

| File/group | Responsibility |
| --- | --- |
| `src/hooks/use-local-db.ts` | Reactive DB result states and storage error conversion |
| `src/hooks/use-ingestion.ts` | Cache-first result display, start/cancel, progress throttling |
| `src/hooks/use-wallet-states.ts` | Reconstruction and incremental asset enrichment |
| `src/hooks/use-sns-names.ts` | Batched on-chain names and localStorage reuse |
| `src/components/app-header.tsx` | Site navigation/header |
| `src/components/providers.tsx` | Shared toast installation |
| `src/components/rpc-status-badge.tsx` | Configured endpoint's recent status |
| `src/components/ui/` | `alert.tsx`, `badge.tsx`, `button.tsx`, `card.tsx`, `checkbox.tsx`, `dialog.tsx`, `field.tsx`, `input.tsx`, `label.tsx`, `sonner.tsx`, `textarea.tsx`: reusable UI primitives |

### 23.3 Site pages

| Files under `src/app/(site)/` | Responsibility |
| --- | --- |
| `layout.tsx`, `page.tsx`, `home-view.tsx` | Site shell, home/recent cases |
| `cases/new/page.tsx`, `new-case-form.tsx` | Creation, secondary rows, date discovery, duplicate handling |
| `map/page.tsx`, `map-startup.tsx` | Startup link validation and routing |
| `settings/rpc/page.tsx`, `rpc-settings-form.tsx` | Endpoint editing, validation, test result |
| `settings/storage/page.tsx`, `storage-settings.tsx` | Local counts/quota and confirmed deletion actions |

### 23.4 Case workspace files

| Files under `src/app/case/` | Responsibility |
| --- | --- |
| `layout.tsx`, `[[...route]]/page.tsx`, `case-shell.tsx` | Persistent workspace host, path validation, data/state integration |
| `case-name-input.tsx`, `delete-case-button.tsx` | Case rename/delete UI |
| `map-wallet-dialog.tsx`, `ingestion-panel.tsx` | Mapping range choice and loading/coverage UI |
| `address-panel.tsx`, `counterparty-list.tsx` | Address inspection, annotations, counterparties |
| `filter-panel.tsx`, `hide-rules.tsx` | Shared filters and persistent hiding management |
| `search-dialog.tsx` | Keyboard-search dialog |
| `wallet-state-view.tsx` | Opening/closing summary and sorted/paginated effects table |
| `asset-flows.tsx`, `asset-format.ts`, `asset-icon.tsx` | Asset totals, exact formatting, remote artwork/fallback |
| `lookalike.tsx` | Address comparison and warning presentation |
| `panel.tsx` | Shared inspector sections, side panels, expandable lists |
| `canvas.ts` | Canvas palette, device-pixel sizing, horizontal gestures |

### 23.5 Timeline and graph files

| Files | Responsibility |
| --- | --- |
| `timeline/wallet-timeline.tsx` | Merge wallet lanes, selection/navigation, timeline and relationship modes |
| `timeline/timeline-canvas.tsx` | Canvas timeline rendering, clustering, zoom/pan, hit testing |
| `timeline/timeline-minimap.tsx` | Histogram and visible-window navigation |
| `timeline/relationship-chart.tsx` | Chronological pair relationship rendering |
| `timeline/event-card.ts` | Semantic card labels, amounts, party, and tone |
| `timeline/transaction-details.tsx` | Selected transaction, raw data, navigation/actions |
| `timeline/event-details.tsx` | Event narrative, flows, participants, and evidence |
| `timeline/observation-details.tsx` | Rule labels, summaries, thresholds, and triggering events |
| `timeline/debug-details.tsx` | Analysis versions, trace, stage objects, clipboard bundle |
| `timeline/inspector-ui.tsx` | Shared address buttons, sections, clipboard helper |
| `graph/wallet-graph.tsx` | Canvas graph, geometry, hit testing, pan/zoom, grouping controls |
| `graph/edge-panel.tsx` | Relationship detail and constituent transactions |
| `graph/entity-panel.tsx` | Service/protocol grouping detail |

All timeline/graph paths in this table are beneath `src/app/case/`.

### 23.6 Data and administrative files

- `protocols/schema.json`: registry JSON shape and allowed data properties.
- `protocols/solana.json`: main curated protocol attribution.
- `protocols/centralized-vaults.json`: centralized service wallets merged at runtime.
- `protocols/community-labels.json`: generated, attributed, unverified names.
- `protocols/sources/tribixbite-solana-programs.json`: third-party snapshot used by the label importer.
- `protocols/sources/orb-programs.json`: captured Orb program list used as registry source material.
- `protocols/sources/README.md`: provenance and source-specific constraints.
- `scripts/capture-fixture.ts`, `scripts/import-community-labels.ts`: maintenance tools described in section 18.
- `src/app/globals.css`: styling tokens and Tailwind setup.
- `src/app/favicon.ico`: application icon.
- `src/app/layout.tsx`: root layout, fonts, metadata, and provider wrapper.
- `.github/workflows/ci.yml`: automated checks.
- `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`: package metadata, exact resolution, and install behavior.
- `next.config.ts`, `tsconfig.json`, `eslint.config.mjs`, `postcss.config.mjs`, `vitest.config.mts`, `components.json`: tool configuration.
- `AGENTS.md`, `CLAUDE.md`: repository agent guidance.
- `LICENSE`: MIT terms for this repository; third-party source-data caveats are documented separately.

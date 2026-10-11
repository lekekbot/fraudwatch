# Sprint History (Sprints 00–11, 05A–09C, C1–C8)

One record of every sprint in the original plan: what each set out to do, what was built, where it lives, how it was checked, and what was left open.

The 28 sprint files this replaces were removed in `29ae8a4` ("clean: remove old sprints"). Each original is still in git:

```sh
git show 29ae8a4^:docs/sprints/SPRINT_05_SINGLE_WALLET_TIMELINE.md
```

Current initiatives keep their own folders: `docs/sprints/global-preferences/` and `docs/sprints/trace-graph/`.

## Status at a glance

| Sprint | Title | Status | Landed |
|---|---|---|---|
| 00 | Architecture freeze | Done | 2026-09-24 |
| 01 | App shell, RPC settings, local case model | Done | 2026-09-24 |
| 02 | Generic Solana RPC ingestion | Done | 2026-09-24 |
| 03 | IndexedDB cache and local persistence | Done | 2026-09-24 |
| 04 | Wallet asset-state reconstruction | Done | 2026-09-24 |
| 05 | Single-wallet chronological timeline | Done | 2026-09-24 |
| 05A | Full-screen workspace and transaction filters | Done (PR #6) | 2026-09-24 |
| 06 | Observed counterparties, labels, tags, protocol registry | Done | 2026-09-24 |
| 06A | Optional case dates from wallet activity | Done | 2026-09-24 |
| 07 | Dynamic secondary-wallet mapping | Done | 2026-09-24 |
| 07A | Node graph view | Built; node drag and one redraw glitch never confirmed in the browser | 2026-09-24 |
| 07B | NFT trades | Done (PR #10) | 2026-09-24 |
| 08 | Multi-wallet chronological lanes | Done (PR #11); directed connectors unit-tested only | 2026-09-25 |
| 08A | Minimap, trackpad gestures, add wallet by address | Done | 2026-09-25 |
| 09 | Scaling, filters, search, bookmarks | Done (PR #12) | 2026-09-25 |
| 09A | Graph tab as a wallet interaction map | Done (PRs #13, #14) | 2026-09-25 |
| 09B | Repository reliability cleanup | Done | 2026-09-29 |
| 09C | Bulk hide from map and hide rules | Done (PR #17) | 2026-10-03 |
| 10 | Boundary context, case export/import, portable state | **Not started** | — |
| 11 | Reliability, privacy, deployment, private beta | **Not started** | — |
| C1 | Semantic event domain model | Done (PR #20) | 2026-10-06 |
| C2 | Interpreter framework and protocol resolution | Done (PR #21) | 2026-10-06 |
| C3 | NFT trade reconstruction as one event | Done (PR #19) | 2026-10-06 |
| C4 | DeFi and protocol semantic events | Done (PR #22) | 2026-10-06 |
| C5 | Event-centric timeline | Done (PR #23) | 2026-10-06 |
| C6 | Behavioural sequence detection | Done (PR #24) | 2026-10-06 |
| C7 | Relationship intelligence and graph integration | Done (PR #25) | 2026-10-06 |
| C8 | Evidence, reliability and investigation polish | Done (PR #26) | 2026-10-06 |

The numbered sprints (00–11) built the local-first mapper. The C sprints (the "Chronology & Semantic Events" initiative) rebuilt how activity is interpreted, on top of it. Lettered sprints (05A, 07B, …) were inserted when a need came up between planned sprints.

## Contents

- [Part 1 — The local-first mapper (00–11)](#part-1--the-local-first-mapper-0011)
- [Part 2 — Chronology & Semantic Events (C1–C8)](#part-2--chronology--semantic-events-c1c8)
- [Part 3 — Cross-cutting reference](#part-3--cross-cutting-reference)

---

# Part 1 — The local-first mapper (00–11)

## Sprint 00 — Architecture freeze

**Goal:** lock the database-free MVP architecture before writing code.

**Decisions frozen:**

- **Runtime:** a static web app. Everything runs in the browser: IndexedDB, the mapping engine, the graph renderer, and an RPC endpoint the user supplies. There is no central app database.
- **A case is local data:** id, name, primary wallet, start and end time, mapped wallets, labels, tags and UI preferences.
- **RPC endpoint:** user-supplied, stored locally, and excluded from portable case state by default.
- **Address states:** `PRIMARY`, `MAPPED`, `OBSERVED`, `INFRASTRUCTURE`. Only primary and mapped wallets get their full history for the case range.
- **Graph positioning:** x = time or event order, y = wallet lane.
- **Protocol recognition:** comes from a versioned JSON registry.
- **Transaction identity:** `(chain, signature)` is unique within the local cache.

**Delivered:**

- `docs/ARCHITECTURE.md`, `docs/00_README.md` (including the "Explicitly not in MVP" non-goals) and `docs/TERMINOLOGY.md`.
- `docs/PROTOTYPE_AUDIT.md`, an audit of the earlier Railway "Wallet Flow Map" prototype (framework, graph library, RPC calls, parsing, transaction model, token balance logic, layout, reusable UI, hard-coded assumptions).
- Fixtures in `fixtures/solana/` for six scenarios plus `token-account-only`: simple transfers, a swap, A → B, A → B → C, C → D → A, and a high-activity wallet. `node scripts/fixtures/verify.ts` checks them.

**Exit test:** anyone on the project can answer what is cached locally, what is fetched from RPC, what belongs in the URL, when a wallet becomes mapped, when a counterparty stays shallow, and how shared transactions are represented.

## Sprint 01 — App shell, RPC settings, local case model

**Goal:** the minimum application structure around local cases.

**Built:**

- Screens: Home (`src/app/(site)/home-view.tsx`), New case (`src/app/(site)/cases/new/`), RPC settings (`src/app/(site)/settings/rpc/`), the case shell (`src/app/case/`) and `/map` startup (`src/app/(site)/map/`).
- Case model in `src/lib/case/model.ts`, stored in Dexie `cases` and `rpc_settings` tables (`src/lib/db/`).
- Mapped wallet config: `{ address, addedFromWallet?, rangeMode: "case" | "first_interaction" | "custom", customStart? }`.
- Validation: Solana address format, start before end, RPC URL scheme, a connection test (`getVersion` + `getLatestBlockhash`), and a prompt for duplicate cases.
- Startup links: `/map?wallet=<address>&from=<unix>&to=<unix>`. Labels, RPC secrets and fetched data are never put in the URL.

**Checks:** 33 tests, typecheck and lint passing. "Import case" on Home was a disabled placeholder for Sprint 10, which never happened.

## Sprint 02 — Generic Solana RPC ingestion

**Goal:** fetch a bounded wallet history using only standard Solana JSON-RPC.

**Built:**

- `src/lib/rpc/json-rpc.ts`: a JSON-RPC client that retries with backoff on 429 and 502–504. The connection test uses it too.
- `src/lib/rpc/generic-adapter.ts`: `getSignaturesForAddress`, `getTransaction`, `getTokenAccountsByOwner`, `getAccountInfo`, `getBalance`, `getTokenAccountBalance` and a health call. No provider-specific methods.
- `src/lib/solana/canonical.ts`: `CanonicalTransaction` (signature, slot, timestamp, success, fee, accounts, native and token balance changes, outer and inner instructions, raw).
- `src/lib/ingest/ingest.ts`, which runs in this order:
  1. Wallet signatures.
  2. Their transactions.
  3. Token accounts: currently owned under both token programs, plus any the wallet owned in loaded transactions.
  4. Those token accounts' signatures.
  5. Any transactions still missing.

  Signatures are deduplicated per wallet and transactions across wallets. Retrieval stops at the case start, when the provider's history runs out, when the user cancels, or at a safety limit (`DEFAULT_LIMITS`: 5,000 in-range signatures and 25 pages per address, 4 parallel `getTransaction` calls).
- Coverage metadata per wallet (complete or not, oldest and newest loaded, counts, warnings).
- UI: a "Transactions" card with progress, Cancel (`AbortController` throughout), per-wallet coverage and warnings, and a partial-history banner (`src/app/case/ingestion-panel.tsx`).

**Checks:** tests replay recorded mainnet fixtures, including a transfer reachable only through a token account and a generated 1,000-transaction wallet. A live mainnet run of the A → B → C wallets matched the fixture.

**Left for later:** results lived in memory only until Sprint 03, and the safety limits aren't shown in the UI.

## Sprint 03 — IndexedDB cache and local persistence

**Goal:** stop re-fetching the same history every time the browser reopens.

**Built (schema v2, `src/lib/db/db.ts`):**

- `transactions`: parsed transactions keyed `solana:<signature>`, tagged with `parserVersion`. Each transaction is stored once however many wallets touch it.
- `raw_transactions`: the RPC's original responses.
- `wallet_transactions`: a light index of wallet, signature and blockTime. Full transactions are never copied per wallet.
- `coverage` and `ingestion_jobs`: which ranges each wallet has loaded, and each case's last load.
- `meta`: the version each derived cache was built with.
- Upgrading from v1 keeps cases and RPC settings (tested).

**Behaviour:**

- **Coverage** (`src/lib/cache/coverage.ts`): only ranges marked complete skip the RPC, and the gaps are fetched. History newer than 2 minutes before a load is never cached as complete, so recent activity is fetched again.
- **Ingestion through the cache** (`src/lib/db/transaction-cache.ts`): it fetches only uncovered sub-ranges and never re-requests a cached transaction. A failed write (for example, storage full) becomes a warning instead of stopping the load.
- **Derived-cache invalidation** (`src/lib/db/derived.ts`): when a registered cache's version changes, that cache is cleared and parsed transactions are rebuilt from `raw_transactions` without the network.
- **UI:**
  - Cached history shows when a case opens, and the button becomes "Load missing history".
  - Each wallet shows how many transactions came from the cache and how many were fetched.
  - Delete case removes the case and its load record but keeps shared chain data.
  - `/settings/storage` shows cache size and can clear the transaction cache or all local data.

**Checks:** fixtures replayed against fake-indexeddb. Covered: a reopened case making zero RPC calls; each shared transaction stored once; extending a range fetching only the new part; partial coverage not being trusted; the finality margin; storage-full warnings; re-deriving after a parser version change without the network; clearing data.

## Sprint 04 — Wallet asset-state reconstruction

**Goal:** a wallet's holdings before and after every transaction in range.

**Built:**

- `src/lib/state/reconstruct.ts` (`RECONSTRUCTION_VERSION = 1`):
  - **Observed, not simulated:** every balance comes from transaction pre/post metadata.
  - **Per account:** state is tracked for the wallet's lamports and each token account it owns, then summed per mint. A transaction that touches one of several USDC accounts still gives the right wallet total.
  - **Order:** slot → `transactionIndex` → signature. `transactionIndex` was added to canonical transactions, which bumped `PARSER_VERSION` to 2 and re-derived cached transactions from raw.
- **Fees:** recorded only when this wallet paid the fee. The SOL delta already includes it.
- **`STATE_MISMATCH`:** an account's balance after one transaction differs from its balance before the next. It's shown with the asset, account, expected and observed amounts, and both signatures. It is never hidden.
- **Confidence:** `OPENING_STATE_PARTIAL` / `CLOSING_STATE_PARTIAL`, with reasons, when history is incomplete or a mismatch exists. The UI also says that holdings which never moved in range aren't visible.
- **Assets** (`src/lib/assets/assets.ts`):
  - Identity is the mint address, with `SOL` reserved for native lamports. A symbol is never a key.
  - Built-ins: SOL, wSOL, USDC, USDT, USDG.
  - Other mints: Token-2022 `tokenMetadata` first, then Metaplex. Results are cached in `token_metadata`, and misses are retried after 7 days.
- **Persistence (schema v3):** `wallet_states` stores reconstruction version, parser version, `sourceSignatures` and completeness, and is reused only on an exact match. It's registered in `DERIVED_CACHES`.
- **UI:** a Wallet state section (`src/app/case/wallet-state-view.tsx`) with opening and closing state, a mismatch banner, and before/change/after rows per transaction. The fee is noted on SOL, and zero-change rows are hidden.

**Checks:**

- A → B → C: B's USDC goes 0 → 200 → 200.001 (poisoning dust) → 0, with fees attributed correctly.
- The 1,000-transaction wallet chains every balance, and its closing state equals opening plus all deltas. Dropping one transaction produces `STATE_MISMATCH`.
- In the browser: USDG 0 → +2,000 → 2,000 → −2,000 → 0.

## Sprint 05 — Single-wallet chronological timeline

**Goal:** turn the one-wallet MVP into a production-quality timeline.

**Built:**

- **Rendering:** a custom `<canvas>` (`src/app/case/timeline/`), with `d3-zoom` for gestures and `d3-scale`/`d3-time` for the UTC axis and calendar buckets.
  - React Flow was rejected because it zooms by magnifying nodes and mounts a DOM node per event.
  - vis-timeline was rejected because it is DOM-based and has no connectors between lanes, which Sprint 08 needed.
  - Zoom stretches time rather than magnifying cards, and only the x axis pans.
- **Layout** (`src/lib/timeline/layout.ts`, pure and tested):
  - Events are grouped by pixel gap, and dense runs split into calendar buckets (minute → month) wide enough for a two-line pill ("82 tx / 13 Mar").
  - Overlapping shapes merge by measured width.
  - A single event gets a card above the lane, then below it, and otherwise a dot.
- **Cards:** date and time, kind (SEND / RECEIVE / SWAP / FEE / FAILED from balance changes in `src/lib/state/summarize.ts`), headline amount, top counterparty.
- **Side panel:** signature, time, status, slot, protocol, fee, and before/change/after per asset. Also counterparties, raw accounts and instructions, raw JSON (loaded on demand) and an explorer link.
- **Spacing modes:** Time or Event. Transactions in the same second can't be separated by time, so selecting one switches to event spacing.
- **Controls:**
  - Scroll-zoom, drag-pan, ± zoom, Fit range, Reset.
  - Previous/next (← / →), Esc to close, jump to date, click a cluster to open it.
  - Selecting a transaction zooms until it stands alone.
- **Minimap:** a square-root activity histogram over the case period with the visible window drawn on it.

**Checks:** on the 1,000-transaction synthetic wallet, six pills total 1,000 at full range, then day buckets, then cards. Fixed during the check:

- Pills overlapped.
- The view jumped weeks when the panel resized the canvas.
- A span clamp capped deep zoom at about 570×. It's now `fitTransform`, with a regression test.
- The axis used a 12-hour clock.

## Sprint 05A — Full-screen workspace and transaction filters

**Goal:** give the map the whole screen and let an investigator take noise off it.

**Built:**

- **Workspace** (`src/app/case/case-shell.tsx`, `panel.tsx`), laid out like Figma:
  - **Top bar:** back, left-panel toggle, case name and range, a centred Timeline/Table switch, Copy link, RPC badge, inspector toggle.
  - **Left panel:** mapped wallets, Filters, History (load, progress, coverage, warnings), and Delete case.
  - **Centre:** the full-bleed canvas with a floating toolbar and the minimap docked at the bottom.
  - **Right:** an inspector.
  - Cmd/Ctrl+\ toggles both panels.
- **Routing:** non-case pages moved into the `src/app/(site)/` route group. The root layout holds only `<html>`, `<body>` and providers. URLs and the static export didn't change.
- **No catch-all "Other" type.** A transaction that moved none of the wallet's value is typed from its own instructions:
  - **APPROVAL:** any approve, revoke or set-authority, inner instructions included. It wins over everything because a drainer leaves one behind. Shown amber on the canvas.
  - **STAKE:** any stake-program instruction.
  - **ACCOUNT:** token-account setup or close only.
  - **PROGRAM:** anything else, named by program and instruction. Setup instructions are skipped when choosing the action.
  - Every summary carries `action` and `actor` (the fee payer when it isn't the wallet), so cards read "by <actor>".
  - Real finding: 37 "fee only" transactions on a real wallet were third-party bots calling one program with the wallet as a read-only account.
- **Filters** (`src/lib/timeline/filter.ts`, `src/app/case/filter-panel.tsx`): by type with counts, by asset moved (hidden only when every asset it moves is hidden), and one transaction at a time ("Hide from map"). Filters affect the map and table only. Wallet state, coverage and mismatch checks always use the full history. The selection is tracked by signature, so it survives filter changes.

**Checks:** a real 65-transaction mainnet wallet. Hiding Program call left 28 of 65, and hiding the selected Receive moved the selection to its neighbour without changing the zoom.

## Sprint 06 — Observed counterparties, labels, tags, protocol registry

**Goal:** make the timeline readable without mapping every address.

**Built:**

- **Protocol registry** (`protocols/solana.json`, `protocols/schema.json`, `src/lib/protocols/registry.ts`):
  - v1 had 40 program addresses across 19 entries: core Solana/SPL, Jupiter, Raydium, Orca, Meteora, Phoenix, OpenBook, Pump.fun, Kamino, marginfi, Save, Drift, Marinade, Metaplex, Tensor, Magic Eden, Wormhole and Circle CCTP.
  - Every address was confirmed as an executable mainnet program, and programs with an uncertain owner were left out.
  - The JSON is bundled into the build and validated on load (base58, known category and role, non-empty label, no duplicates).
  - It is a lookup only. Transaction meaning stays in code.
- **Enrichment:** `enrichTransaction` returns the registry matches among invoked programs and touched accounts, the unlisted programs, and `protocolRegistryVersion`. It's computed when shown, so there's no cache to invalidate.
- **Address states** (`src/lib/case/address-state.ts`): any program a loaded transaction invokes is INFRASTRUCTURE even when the registry doesn't list it, so a program is never offered as a wallet to map.
- **Observed counterparties** (`src/lib/state/counterparties.ts`): everyone on the other side of the selected wallet's transactions, including whoever sent them, with counts. Their history is never fetched.
- **Local labels** (`address_labels`, schema v4, `src/lib/db/address-labels.ts`):
  - `{ address, caseId, name, note?, tags[] }`, keyed `[caseId+address]`, with fields trimmed and bounded.
  - Clearing every field deletes the label, and deleting a case deletes its labels.
  - The unused Sprint 01 `case.labels`/`case.tags` maps were migrated into the table, which made the case schema version 2.
- **Display names** (`src/lib/labels/labels.ts`): the user's label wins, then the registry name, then the shortened address. The registry is never modified.
- **Address inspector** (`src/app/case/address-panel.tsx`): state, registry match, count, Rename, tags, note, Copy, Explorer. Map wallet stayed disabled until Sprint 07.
- **Transaction details:** a Protocol row and an "Unknown programs" section marked "not in registry vN".

**Checks:** on the real wallet, 44 counterparties. Labelling a bot "Keeper bot A" updated 22 cards, and naming an unknown program relabelled all 37 Program call cards. Fixed during the check: Enter didn't save a name (a form with two inputs and no submit button; see `docs/MISTAKES.md`), and unknown programs showed as OBSERVED wallets.

## Sprint 06A — Optional case dates from wallet activity

**Goal:** open a case from just a wallet address.

**Built:**

- Empty dates are allowed on New case (`validateNewCaseInput`). An empty start means the UTC day of the wallet's first transaction, and an empty end means the day of its latest. Dates the user enters are never overridden.
- `findActivitySpan` (`src/lib/ingest/activity-span.ts`):
  - The latest transaction takes one `getSignaturesForAddress` call.
  - Finding the first one pages back through the whole history, so it only runs when the start is empty.
  - It stops at 100,000 signatures and asks for a start date rather than guessing.
  - It shows progress and has a Stop button.
- `completeRange` gives errors that point at the field to fix: a wallet with no transactions, too many to scan, or an entered date outside the wallet's activity. Filled dates are written back into the form.

**Caveats recorded:**

- "Creation day" means the first transaction, because Solana doesn't record when an account was created.
- An RPC without full archive returns its own oldest transaction instead.
- Dates are fixed at creation and don't follow later activity.
- `/map?wallet=` links still need both dates.

**Checks:** a real wallet with both dates empty resolved to 2022-08-02 → 2026-03-18 in about 5 s. An independent scan agreed: 1,194 signatures.

## Sprint 07 — Dynamic secondary-wallet mapping

**Goal:** promote an observed address to a fully mapped wallet when the investigator asks.

**Built:**

- **Map wallet** opens `MapWalletDialog` with a choice of start:
  - From first interaction (the default): the earliest loaded transaction involving the address in any role, via `firstInteraction`.
  - From case start.
  - A custom UTC day.

  The end is always the case end.
- **Model** (`src/lib/case/wallet-range.ts`):
  - `mapWallet` rejects duplicates and starts at or after the case end, and clamps starts before the case start.
  - `walletRange` gives each wallet its own range.
  - `unmapWallet` never removes the primary.
- **Per-wallet ranges** run through `ingestWallets`, `readCachedIngestion`, `useIngestion` and `useWalletStates`. A mapped wallet's lane opens at its own start.
- **Reuse:** transactions are stored once by signature. One already loaded for another wallet is reused and counted as reused.
- **Intersections** (`src/lib/ingest/intersections.ts`): `sharedTransactions` compares every pair of mapped wallets, not just the new wallet and its parent. Details show a "Shared with" row.
- **Expansion summary:** "Mapping X" with in-range, cached, fetched and shared counts, plus new observed addresses.
- **Shallow by default:** addresses the new wallet reveals stay OBSERVED. Nothing is mapped recursively.
- **Remove from map:** the wallet's labels and cached chain data stay, and other wallets' transactions are untouched.
- **Stale-result fix:** `useIngestion` re-reads the cache on every config change, and a generation counter stops a slow read from replacing a newer one.

**Follow-ups found:**

- **Lookalike addresses:** two different counterparties both displayed as `Hcmh…Px4x`, which is address poisoning. Detection later landed in `8755bff`.
- **Forked lanes:** became Sprint 08.
- **Busy wallets:** bounded by the Sprint 02 safety limits and marked "Partial history".

## Sprint 07A — Node graph view

**Goal:** switch between the time view and a relationship view of the same transactions. Built before Sprint 07 at the user's request.

**Built:**

- A Timeline | Graph | Table switch. All three share filters, labels, counterparties and the inspector.
- **Graph model** (`src/lib/graph/build.ts`), the selected wallet plus everything its filtered transactions touch:
  - **flow** edges per direction, with per-asset totals.
  - **sent_by** edges for fee payers.
  - **program** edges for non-core programs.
  - The busiest 150 nodes are drawn, and the legend says how many were left out.
- **Layout** (`src/lib/graph/layout.ts`): `d3-force`, run to completion up front so the result is deterministic. The wallet is pinned at the centre, busier relationships sit closer, and nodes never overlap.
- **Canvas** (`src/app/case/graph/wallet-graph.tsx`):
  - Nodes: circles for addresses, squares for programs, outlines by address state.
  - Edges: green for in, red for out, dashed for sent-by, dotted blue for programs.
  - Hover highlighting, zoom, pan, node drag, Fit and Reset layout.
- **Inspector:** node → address panel. Edge → `EdgePanel` listing every transaction with "Show on timeline", which switches tabs and centres the transaction.

**Open items (never closed in this sprint):**

- Node drag wasn't tested in the browser.
- One possible redraw "ghost" was seen while the window was resizing.
- Changing a filter re-runs the layout and loses dragged positions.
- Counterparty counts weren't filtered.

Sprint 09A then replaced this graph model.

## Sprint 07B — NFT trades

**Goal:** show an NFT purchase or sale as what it is, not as a SOL transfer.

**Built:**

- **NFT check on-chain, per mint** (`fetchAssetMetadata`): an NFT has 0 decimals and a supply of exactly 1. That covers standard, programmable, edition and Token-2022 NFTs. Only candidates are checked (`nftCandidates`: exactly one unit, 0 decimals, any party), and the result is cached as `AssetMetadata.nft`.
- **Kinds** (`summarizeEffect`):
  - **NFT_BUY:** the NFT came in and value went out.
  - **NFT_SELL:** the NFT went out and value came in, *or* the wallet was paid by the address that got the NFT. The second case covers escrowed marketplace listings.
  - **NFT_MINT:** the NFT came in through `mintTo`.
  - **NFT_TRANSFER:** the NFT moved with nothing in return.
  - **NFT_SWAP:** NFTs moved both ways.
- **Trade details** (`EffectSummary.nft`): mint, price net of fee, the other party, every other recipient, and the marketplace from the registry.
- **UI:** purple cards ("NFT BUY · SMB Gen3 #86 / 3.99313928 SOL / ← seller"), an NFT trade section in the details, and NFT filters. Summaries are now computed once in the workspace and shared by every view.
- **Follow-ups done the same day:**
  - **Compressed NFTs** (`src/lib/solana/bubblegum.ts`): Bubblegum instructions are matched by Anchor discriminators and paired with the leaf-schema event logged through SPL Noop or MPL Noop. The asset id was verified as the PDA of ("asset", tree, nonce). Names come from the mint instruction or from DAS `getAsset`.
  - **Royalty vs fee vs rent:** Metaplex creators are decoded (`decodeMetaplexMetadata`). Recipients are classed as royalty, rent (an account created in the transaction), marketplace fee (a registry `fee_account`) or unidentified. On a real Tensor sale, 0.1865 SOL came out as exactly 5% royalty (500 bps).
  - **Bundles** ("3 NFTs") and NFT-for-NFT swaps ("A → B").

**Still open:**

- Tensor and Magic Eden fee accounts weren't in the registry yet (C3 added Magic Eden's).
- cNFTs aren't part of wallet state.
- v2 cNFT transfers take the previous owner from the signer.

## Sprint 08 — Multi-wallet chronological lanes

**Goal:** render several mapped wallets as lanes in one chronology.

**Built:**

- **Lanes:** one per visible mapped wallet, each running from its own start (OPEN) to the case end (CLOSE). A wallet mapped from first interaction forks off its parent lane with a dashed curve at that moment.
- **One transaction, one x** (`mergeLaneEvents`, `src/lib/timeline/lanes.ts`): a shared transaction has an entry per lane at the same x, joined by a vertical connector.
  - Connectors point from lanes that lost value to lanes that gained it, including loops back such as D → A.
  - Where direction is unclear, they join adjacent lanes without arrows.
- **Chronology first:** no lane is re-centred, and in event spacing every lane shares the same event order.
- **Many lanes:** the canvas scrolls vertically, with the axis pinned to the bottom of the view.
- **Lane order** (`src/lib/case/lanes.ts`): primary first, then first appearance. The user can reorder (`laneOrder`), hide (`hiddenLanes`) and focus ("Focus: A + D").
- **Wallet header:** label, short address and tag on the canvas. The inspector adds opening and closing state, **net change** (`netChange`), hide and remove.
- Observed endpoints stay on cards and never become lanes.

**Checks:** five lanes on a throwaway copy of the real case. Found a single 1-lamport transaction joining four lanes, an address-poisoning dust spray. Directed connectors between two mapped lanes were covered only by unit tests, since the test wallets only received.

## Sprint 08A — Minimap, trackpad gestures, add wallet by address

**Problems reported:**

- The minimap overflowed its column, and a click did nothing when fully zoomed out.
- The trackpad couldn't zoom once a case had two lanes.

**Built:**

- **Minimap** (`timeline-minimap.tsx`):
  - Sized to its padded strip.
  - Fully zoomed out, a click zooms to an eighth of the range. Zoomed in, a click re-centres (`minimapTarget`).
  - Dragging the view box pans, and dragging elsewhere selects a range to zoom to.
  - A crash in the first range-drag (reading the pointer inside a React state updater) was fixed.
- **Timeline gestures** (`wheelAction`):
  - Pinch or Ctrl/⌘+wheel zooms around the pointer.
  - A sideways swipe or Shift+wheel pans time.
  - A vertical swipe scrolls lanes when they overflow and zooms when they fit.
  - Line and page deltas are converted to px.
- **Graph gestures** (`graphWheelAction`): pinch zooms and any swipe pans, like Figma. Both gesture rules live in `src/lib/gestures.ts`.
- **Add wallet by address:** the map-wallet dialog gets an address field. `newWalletProblem` rejects invalid addresses, wallets already mapped, and program or protocol addresses. A wallet mapped from first interaction now forks off the wallet that actually shared that transaction.

## Sprint 09 — Scaling, filters, search, bookmarks

**Goal:** keep the mapper usable on real high-volume wallets.

**Built:**

- **Levels of detail:**
  - Far: cluster pills.
  - Medium: a composition bar coloured by type, with a hover breakdown.
  - Near: cards.
- **Time context at every zoom:** below 3 days in view the day is pinned at the left of the axis, otherwise the year.
- **Virtualisation:** single canvases that paint only what's in view plus a margin. Aggregation is computed per frame and never stored.
- **Filters**, extending 05A: everything is precomputed as a `FilterableTx`, so a filter click is just comparisons.
  - Type (including failed), asset, direction.
  - Minimum amount, typed in normal units via `parseUnits`.
  - Protocol, tag, observed address ("Show only its transactions"), date sub-range, and individual hiding.
  - Filtering by mapped wallet is covered by hide and focus.
- **Search** (`src/lib/search.ts`, ⌘K): wallets, labelled and observed addresses, tags, signature prefixes, tokens and protocols, each with a jump action.
- **Bookmarks** (`src/lib/case/bookmarks.ts`, saved on the case): transactions (with their lane), addresses, and moments in time.
- **Performance work:**
  - Summaries are cached per wallet, separately from filtering.
  - Bubblegum decoding is skipped when a transaction doesn't touch Bubblegum.
  - Text widths are cached, card text is truncated by binary search, and cluster labels are formatted once per frame.
  - Together these removed 65–175 ms stalls.

**Measured (`PERF=1 pnpm vitest run src/test/perf.test.ts`):**

| Target | Reconstruct | Summarise | Filter data | Filter click | Merge lanes | Frame layout |
|---|---|---|---|---|---|---|
| 1 wallet / 1,000 tx | 11.7 ms | 5.7 ms | 1.6 ms | 0.4 ms | 0.4 ms | 0.2–0.5 ms |
| 5 wallets / 2,000 tx | 5.3 ms | 6.5 ms | 1.9 ms | 0.5 ms | 0.6 ms | 0.6–1.1 ms |
| 10 wallets / 5,000 tx | 11.1 ms | 12.1 ms | 8.0 ms | 0.9 ms | 1.9 ms | 1.1–2.4 ms |

In the browser, with 10 wallets and 5,000 synthetic transactions on `next dev`:

- The case shell appeared in about 1.7 s, and the full timeline in about 3.7–4.3 s.
- Zoom and pan produced no long tasks.
- Filters updated straight away (5,000 → 2,898 → 197 → 84).

A production build and real wallets at this size were not measured.

## Sprint 09A — Graph tab as a wallet interaction map

**Problem:** the 07A graph drew a line per direction and kind, which crowded the view and repeated the timeline.

**Built:**

- **`buildInteractionGraph`:** one node per address and **exactly one undirected connection per pair that directly exchanged value**, however many transactions, directions, tokens or days are involved.
  - Each underlying transaction is kept as an `Interaction` with its real movements (from, to, asset, amount), in time order.
  - A movement seen from two mapped wallets is recorded once.
- **Program calls** are a separate connection kind, hidden by default and toggleable. They never join two wallets.
- **One source of truth:** the map is built from the same per-wallet filtered data as the timeline. The asset filter also drops hidden assets' movements.
- **Drawing:** one neutral line per pair, with no arrows or amounts. The count is in a tooltip. Selecting a line dims the rest.
- **Connection panel** (`edge-panel.tsx`): both sides, the date span, and every transaction with direction, amount, token and "Show on timeline" (on the correct lane).
- **Removed:** fee-payer lines. They aren't value interactions.
- **Follow-up:** the right panel became an element viewer where the last thing picked wins. Selecting a transaction clears an open address, and picking a wallet clears the transaction. The address panel's back arrow was removed.

**Found in real data:** a lookalike `dLm6…f5Vo` sent 0.001 USDC to the same recipient 19 seconds after the primary's 3,520 USDC transfer.

## Sprint 09B — Repository reliability cleanup

**Goal:** fix the concrete issues from a whole-repository review without adding scope.

- The fixture verifier ignores raw fixture collections that aren't replay scenarios.
- A connection removed by a filter no longer stays selected and dims everything else.
- Stale Sprint 01 paths were corrected after the route-group move.
- Verified with the fixture verifier, `pnpm test`, `pnpm typecheck`, `pnpm lint` and `pnpm exec next build --webpack`.
- Deliberately no browser-test dependency for one guard. End-to-end automation was left for Sprint 11.

## Sprint 09C — Bulk hide from map and hide rules

**Goal:** clear noise in bulk and keep what was hidden. Hiding had lived in filter state and was lost on reload.

**Built:**

- **Hiding lives on the case:** `hiddenSignatures`, `shownSignatures` (exceptions) and `hideRules`. `filter.hiddenSignatures` was removed.
- **Precedence** (`src/lib/case/hiding.ts`): `hiddenBy(tx, case, tagsOf)` returns `"manual"`, the matching rule, or `null`. An exception wins, then a manual hide, then an enabled rule. One signature hides the transaction on every lane.
- **Hide rules:** named and switchable. Conditions combine with AND, and values within a condition combine with OR. A rule with no conditions matches nothing.

  ```ts
  type HideRule = {
    id: string; name: string; enabled: boolean;
    kinds?: EffectKind[];
    onlyAssets?: string[];        // every asset it moves is one of these
    amount?: { assetId: string; op: "lt" | "gt" | "eq" | "ne"; value: string };
    counterparties?: string[];
    tags?: string[];
    protocols?: string[];
  };
  ```

  The rule editor shows a live "Matches N transactions" count across all wallets.
- **Table selection:** a checkbox per transaction, Shift-click ranges, select the current page, then "Select all N matching". The bulk actions sit in the table toolbar so rows don't shift under a Shift-click. One write per action, with Undo for that batch.
- **Show hidden:** the table can show hidden transactions, dimmed and labelled with the reason. The timeline and graph never show them.
- **Findability:**
  - "Hide these N from the map" under active filters.
  - "Make a rule" beside every Undo, prefilled from what was hidden.
  - An explainer when nothing is hidden.
  - Collapsible filter groups.

**Non-goals:** global rules, OR between conditions, keyboard shortcuts, per-lane hiding.

**Checks:** tests cover precedence, every condition, the empty rule and idempotent updaters. In the browser, a Program call rule previewed 37, matching the filter panel's 37. Filter to marginfi (24) → hide → "Make a rule" prefilled matching 24.

## Sprint 10 — Boundary context, case export/import, portable state (not started)

**Planned:**

- **Boundary model:** keep in-range transactions, boundary snapshots and context transactions separate.
  - Opening state just before the case start, and closing state at or after the case end, with a quality indicator.
  - "Trace earlier origin" and "Show next movement" fetch context outside the range, marked as context and never added silently to the range.
- **Export** to `*.fraudwatch.json`: schema version, case config, wallets, range, mapped-wallet config, labels, tags, notes, lane order, bookmarks, registry version, and optional transaction references. Never RPC credentials.
- **Import:** validate schema, wallet format, dates and chain, then rehydrate from the local cache plus the user's RPC.
- **URL fragment state** (`/map#state=<compressed-config>`) for small cases, with no raw transactions or secrets.

**Today:** none of this exists. Holdings that never moved in range are still invisible. The only portable file is the settings-and-presets document from the Global Preferences initiative (`src/lib/preferences/portable.ts`, format `fraudwatch-settings`), which deliberately carries no cases or labels. Hide rules and bookmarks are plain case fields, ready to travel once export exists.

## Sprint 11 — Reliability, privacy, deployment, private beta (not started)

**Planned:**

- **RPC capability detection:** basic RPC, archive availability, CORS, rate limits and enhanced methods, shown as a summary. `GenericSolanaRpcAdapter` is required, with an optional `HeliusEnhancedAdapter`, and the app must still work in generic mode.
- **Recoverable errors** for:
  - RPC unavailable, CORS blocked, rate limited.
  - Missing history, malformed responses, unavailable transactions.
  - Storage quota exceeded, an invalid imported case, cache corruption.
- **Privacy:**
  - No RPC key in a URL or an export.
  - No transaction telemetry by default, and no analytics with wallet addresses unless explicitly designed and consented to.
  - Cases stay local.
- **Storage settings:** clear case data, clear RPC settings, clear the transaction cache, clear everything.
- **Static deployment:** a backend is never required. A CORS proxy, if ever needed, is optional infrastructure, not a database.
- **Beta checklist:** real cases for a single wallet, A → B, A → B → C, C → D → A, a high-volume wallet and a protocol-heavy wallet. Plus a 12-step user task test: RPC → case → map → before/change/after → counterparty → map it → shared transactions → another wallet → loop → labels → export → reopen without refetching.

**Today:** several pieces exist from earlier sprints:

- A live RPC status badge.
- Storage settings with cache size and clear actions (Sprint 03).
- Retry and backoff (Sprint 02).
- Quota errors shown as warnings (Sprint 03).
- Static export.

Capability detection, a provider adapter, browser end-to-end tests and the beta itself have not been done.

---

# Part 2 — Chronology & Semantic Events (C1–C8)

**Why the initiative existed:** by 09C the pipeline was raw RPC → canonical transaction → wallet effects → summary → views. That works for transfers, but one meaningful Solana action (an NFT purchase, a routed swap, a liquid stake, a bridge) is made of several balance changes, instructions, fees and infrastructure accounts. These showed up as fragmented records. The C sprints added a semantic layer in between:

```text
Raw RPC → Canonical transaction → Balance + instruction reconstruction
  → Protocol / service interpretation → Semantic event
  → Per-wallet event projection → Relationship aggregation
  → Timeline / Graph / Table / Inspector
```

**Product principle:**

- The Timeline answers *what happened and when*.
- The Graph answers *who interacted*.
- The semantic engine explains *what the activity means*.
- The Inspector explains *why FraudWatch believes that*.

**Rules for every C sprint:**

- Stay local-first, with RPC as the source of truth.
- Never give an automatic fraud verdict.
- Keep uncertainty visible.
- Keep infrastructure apart from meaningful counterparties.
- Never auto-expand observed wallets.
- Keep every interpretation traceable to canonical evidence.
- Don't break existing behaviour unless a sprint replaces it on purpose.

All eight were specified up front, then built and merged on 2026-10-06. Each spec ended "do not begin the next sprint automatically". The unresolved items across C1–C8 are tracked in `docs/CHRONOLOGY_OPEN_ISSUES.md`, with priorities and a suggested order.

## C1 — Semantic event domain model (`bef9ede`)

**Spec:** a formal `SemanticEvent` type, architectural only, with no timeline redesign.

**Built** (`src/lib/semantic/events.ts`):

- **One deterministic event per signature.** IDs follow `solana:<signature>:event:<index>`, never random. The model allows more than one event per signature later.
- **A deliberately small taxonomy:** TRANSFER, SWAP, NFT_TRADE, NFT_TRANSFER, NFT_MINT, STAKE, UNSTAKE, LENDING, BRIDGE, LIQUIDITY, ACCOUNT, APPROVAL, PROGRAM_INTERACTION, FAILED, UNKNOWN. `action` carries the finer meaning (e.g. NFT_TRADE / BUY, LENDING / BORROW).
- **Participants kept apart from infrastructure:**
  - Participant roles include sender, receiver, buyer, seller, trader, depositor, withdrawer, borrower, lender, fee recipient and royalty recipient.
  - Infrastructure roles include program, marketplace, router, pool, vault, escrow, bridge, token account and PDA.
  - Infrastructure is never treated as a wallet counterparty.
- **Flows** are separate from the event: balance-paired asset movements supporting the headline interpretation ("A bought X from B for 42 SOL" plus its payment, fee, royalty and NFT legs).
- **Evidence** refers into the canonical transaction (balance and token deltas, outer and inner instructions, known programs, the NFT parser, the registry, DAS metadata) and never copies it.
- **Versioning:** a `SEMANTIC_VERSION` stamp. Built at first from the fee payer's existing summary, through a compatibility layer, so the UI didn't change.
- Brought vitest back for the model's tests, covering identity, SOL send and receive, SPL transfer, failed, program-only, multiple flows, infrastructure separation, unknown, and the compatibility projection.

## C2 — Interpreter framework and protocol resolution (`4a42cac`)

**Spec:** turn "this address belongs to Jupiter" into "this transaction was a Jupiter swap", with one pipeline instead of scattered lookups.

**Built** (`src/lib/semantic/interpret.ts`, `interpreters.ts`, `resolver.ts`):

- **A reusable transaction context:** canonical transaction, wallet effects, accounts, signers, instructions, balance changes, protocol matches, infrastructure classification and NFT metadata. Each is computed once and shared by every interpreter.
- **A prioritised pipeline:** the first interpreter with a reading wins, so specific beats generic. Current order:

  ```text
  failed
  marketplace-nft-trade
  cctp-bridge, relay-bridge
  kamino-lending, marginfi-lending
  marinade-stake, sanctum-unstake, spl-stake-pool
  jupiter-swap, known-dex-swap
  native-stake
  token-instruction
  generic-nft
  generic-swap
  generic-transfer
  generic-program
  unknown
  ```

- **Failure isolation:** one interpreter throwing doesn't make the transaction unusable. It falls through to the next, and the warning is recorded.
- **One protocol resolver:** answers which verified protocols took part and which accounts are programs, vaults, pools, routers, marketplaces, bridges or fee accounts. Verified registry attribution is kept apart from community and user labels, and **community labels never decide what a transaction means**.
- **Confidence is HIGH / MEDIUM / LOW**, with no fake precision:
  - HIGH = known program + known instruction + matching balances.
  - MEDIUM = strong balance pattern + known protocol, without full decoding.
  - LOW = a heuristic only.
- Every event records its interpreter and warnings. `UNKNOWN` is a valid result and is never covered up with an invented meaning.

## C3 — NFT trade reconstruction as one event (`ad15424`)

**Spec:** the first complete semantic implementation, reusing the proven 07B NFT parser rather than rewriting it. Magic Eden fragmentation was the main regression target.

**Built** (`src/lib/semantic/nft.ts`, `projection.ts`):

- **One event per NFT trade, mint or transfer:** buyer, seller, NFTs, price, and bundle and compressed flags.
- **Supporting flows reconcile to observed balances:** payment, royalty, marketplace fee, rent and settlement.
- **Escrows and fee accounts are infrastructure,** not primary relationships.
- **`projectEvent`** gives each wallet its own view of the *same* event ("Bought …" for the buyer, "Sold …" for the seller), with one id and one signature.
- **Accepted bids paid from escrow** name the bidder as the buyer.
- Real Tensor, Magic Eden and compressed-NFT fixtures were added, plus Magic Eden's treasury and escrow authority in the registry.
- The existing cNFT limits were kept: compressed NFTs are not presented as SPL holdings.

## C4 — DeFi and protocol semantic events (`dc5fc70`)

**Spec:** a few well-supported high-value patterns rather than shallow coverage of many protocols. In priority order: swaps, staking, lending, bridge envelopes, liquidity (only when the evidence is strong).

**Built** (`src/lib/semantic/defi.ts`):

- **Decoders matched by Anchor discriminators and checked against the actor's balances:**
  - Jupiter v6 routes.
  - Marinade liquid staking.
  - Kamino Lend.
  - Circle CCTP v1 and v2.
- **Swaps, stakes, loans and bridges** record what the actor spent and received. Routing through pools and vaults stays in settlement flows, so a multi-hop route doesn't become a set of wallet relationships and only the actor is a participant.
- **Bridge envelopes, Solana side only:** CCTP events carry source and destination domains, the remote address, the nonce and the message account, kept for future destination-chain correlation. No cross-chain tracing was done.
- Unsupported activity falls back cleanly to TRANSFER / SWAP / PROGRAM_INTERACTION / UNKNOWN.
- Real mainnet DeFi fixtures were added.

**Extended after C8** (2026-10-07/08):

- Relay deposits read as bridge-outs (`631c8de`).
- Sanctum instant unstakes (`af2231e`).
- SPL stake pools and marginfi decoded, and launchpad swaps read (`922c980`).
- Stake amounts and stake sales (`b670356`).
- The Orb program list imported into the registry (`02bb586`).

## C5 — Event-centric timeline (`099b0bc`)

**Spec:** make semantic events what the timeline shows, within the existing canvas architecture.

**Built:**

- The workspace interprets every loaded transaction **once** into a semantic event. Nothing is computed in render, draw, hover or zoom paths.
- Cards, colours, connectors and cluster breakdowns come from the event, **projected per lane** (a purchase on the buyer's lane, a sale on the seller's).
- A shared event stays at one x on every lane it touches, and selecting either copy selects the same event.
- **Connectors follow meaningful roles** (sender → receiver, buyer ← NFT ← seller, wallet → bridge), not fee accounts, pools, routers, token accounts or PDAs.
- **The inspector shows three levels:**
  - The card: type, amount, counterparty or protocol.
  - What happened: sentence, participants, flows, protocol, confidence.
  - Why: interpreter, evidence, settlement, infrastructure, bridge identifiers.
- Adds Event and low-confidence filters, and event labels in search. Existing filters and signature-keyed bookmarks were unchanged, so no bookmark migration was needed.

## C6 — Behavioural sequence detection (`5732322`)

**Spec:** deterministic patterns across several events. Explicitly **not** fraud detection: no verdicts, no ML, no opaque scores.

**Built** (`src/lib/behavior/observations.ts`, `BEHAVIOR_VERSION = 1`):

- **`BehaviorObservation`**, kept separate from `SemanticEvent`. An event is what happened in one transaction, and an observation is a pattern across several.
- **Seven detectors** over each mapped wallet's history:
  - Rapid forwarding.
  - Fund split (fan-out).
  - Consolidation (fan-in).
  - Repeated counterparty.
  - Circular movement.
  - Bridge milestone.
  - Verified exchange deposit runs. These use verified attribution only, never community labels.
- **All thresholds in one constant** (`BEHAVIOR_THRESHOLDS`):

  | Rule | Thresholds |
  |---|---|
  | Rapid forwarding | within 600 s; outgoing ≥ 80% of incoming and ≤ 125% |
  | Fund split | within 1 h; ≥ 3 branches; a source receipt counts at 80–125% of the split |
  | Consolidation | within 1 h; ≥ 3 sources |
  | Repeated counterparty | ≥ 5 interactions |
  | Circular movement | within 7 days; ≥ 50% returns |
  | Exchange deposit run | deposits ≤ 24 h apart group into one run |
  | Dust floor (all rules) | ≥ 0.01 SOL, ≥ 1% of a token unit |

- **False-positive controls:** only meaningful transfers and bridges count. Swap routing, NFT settlement, fees, rent, infrastructure, wrapping mechanics and dust are ignored.
- **Explainable:** every observation records the triggering events, the rule, the thresholds and the calculated values (window, amounts, coverage ratio).
- **On the timeline:** amber markers over the lanes that merge when zoomed out, and never hide the underlying events. The inspector links back to each event.

## C7 — Relationship intelligence and graph integration (`227fae2`)

**Spec:** the graph is a relationship map built from semantic events, not a raw transaction picture.

**Built:**

- Graph movements come from each wallet's projection of its semantic event:
  - Routing, settlement and infrastructure never connect wallets, and neither do swap, stake, lending or bridge legs.
  - NFT fee, royalty and rent legs stay inside the trade.
- **Interactions carry the timeline's event id and category,** so both views share one identity. Relationships add semantic event composition (transfers, NFT trades, …).
- **The connection inspector shows:**
  - First and last interaction, and active days.
  - Direction-specific totals.
  - Event categories.
  - The behaviour observations the pair took part in.
  - The underlying events, with jump-to-timeline.
- **Node ranking adds value moved and behaviour observations** to the existing factors, and each node records why it is shown. Still no risk score.
- Adds "Show in graph" from timeline events, plus graph builder tests.
- Kept: one aggregated edge per pair, deterministic layout, node limits, canvas rendering.

This built on the relationship-centric graph redesign that landed just before the C sprints (`c2cea52`, 2026-10-05).

## C8 — Evidence, reliability and investigation polish (`cebf695`)

**Spec:** make the semantic system defensible. Trust, provenance, debugging, cache correctness, regression coverage, performance and docs, with no new feature categories.

**Built:**

- **`explainEvent`** (`src/lib/semantic/explain.ts`): each event as checkable statements in six categories that are never mixed: fact, verified attribution, derived interpretation, heuristic observation, user label, community label. The inspector marks ✓ for what holds and ? for what's missing ("? Protocol unknown", "? Swap instruction not decoded").
- **The interpreter trace:** events record every interpreter tried, not only the winner.
- **Developer details:**
  - All analysis versions, the trace, and registry matches.
  - The canonical transaction, wallet effect, semantic event and behaviour observations side by side.
  - A copyable debug bundle.
- **Versions** (`src/lib/semantic/versions.ts`): `analysisVersions()` and `analysisFingerprint()` (e.g. `p2;r1;s9;reg…;b1`) report parser, reconstruction, semantic, registry and behaviour versions. Parser and reconstruction outputs are cached and cleared on a version change. **Semantic events and observations are never stored**: they are recomputed on read, so stale classifications can't survive a logic change. Tests lock both properties in.
- **Fixtures:**
  - Recorded SOL transfer, SPL transfer, failed transaction, and CCTP with a hook.
  - A pinned regression table over every recorded fixture (`regression.test.ts`).
  - A shared mapped-wallet test.
  - Performance tests at the three target scenarios (`performance.test.ts`).
- **Docs:** `docs/ARCHITECTURE.md` and `docs/TERMINOLOGY.md` were updated for CanonicalTransaction → SemanticEvent → WalletEventProjection → Relationship → BehaviorObservation, and `docs/CHRONOLOGY_OPEN_ISSUES.md` was added.

**End state the initiative aimed for:** not "a Solana wallet tracker with a timeline" but "a local-first Solana investigation workbench that reconstructs blockchain activity into human-readable events, relationships, chronological patterns and inspectable evidence."

---

# Part 3 — Cross-cutting reference

## Data lifecycle as built

```text
RPC (user's endpoint)
  → raw_transactions                  stored        (Sprint 03)
  → CanonicalTransaction              stored        PARSER_VERSION 2 (02, 04)
  → wallet state / effects            stored        RECONSTRUCTION_VERSION 1 (04)
  → summaries (kind, action, actor)   memory        (05A, 07B)
  → SemanticEvent + projection        memory        SEMANTIC_VERSION (C1–C5)
  → BehaviorObservation               memory        BEHAVIOR_VERSION 1 (C6)
  → relationships / graph             memory        (09A, C7)
  → filters → hiding → views          case + state  (05A, 09, 09C)
```

"Stored" means IndexedDB, cleared when its version changes (`DERIVED_CACHES`). "Memory" means recomputed when a case opens.

## IndexedDB schema history (`src/lib/db/db.ts`)

| Version | Added | Sprint |
|---|---|---|
| 1 | `cases`, `rpc_settings` | 01 |
| 2 | `transactions`, `raw_transactions`, `wallet_transactions`, `coverage`, `ingestion_jobs`, `meta` | 03 |
| 3 | `wallet_states`, `token_metadata` | 04 |
| 4 | `address_labels` (migrates `case.labels`/`case.tags`) | 06 |
| 5 | `preferences` | Global Preferences |
| 6 | `view_presets` | Global Preferences |

The `protocol_cache` and `ui_state` stores planned in Sprint 03 were never needed. The registry is a pure lookup, and view state ended up in `preferences`.

## Three ways to take a transaction out of a view

| Mechanism | Lifetime | Stored | Sprint |
|---|---|---|---|
| Filter | Session | React state | 05A, 09 |
| Hiding (manual, rules, exceptions) | Case | Case record | 09C |
| View setting | Global or per case | `preferences` / case `viewSettings` | Global Preferences |

None of them changes wallet state, coverage or mismatch checks.

## Recurring themes

- **Address poisoning** came up repeatedly in real data: lookalikes in 07 and 09A, and dust sprays in 04 and 08. Lookalike detection landed in `8755bff` (2026-10-04). C6's dust floor keeps it out of behaviour rules.
- **Browser checks found bugs that tests didn't:**
  - Enter-to-save on a two-input form (06).
  - A React event read inside a state updater (08A).
  - Shift-click landing on a shifted row (09C).
  - These are why `docs/MISTAKES.md` requires checking in the browser.
- **Determinism:** the force layout runs to completion, event IDs come from signatures, and observations come from fixed thresholds. The same case should always look the same.
- **Honesty over completeness:** partial history, opening/closing confidence, `STATE_MISMATCH`, UNKNOWN events, LOW confidence and "?" evidence are always shown, never smoothed over.

## Work between and after the sprints

Not part of any sprint file, but it shaped the code the sprints describe:

- **2026-10-04/05:**
  - Look-alike detection and signers (`8755bff`).
  - Public names, pausing and removing secondary wallets (`cb8dc70`).
  - The graph spacing setting.
  - Burns drawn into a Burned node.
  - The relationship-centric graph (`c2cea52`).
- **2026-10-06/07:**
  - Open-source preparation (`82bc259`).
  - Renaming and deleting cases, secondary wallets on new cases, live RPC status (`ec44e4a`).
  - A roadmap.
  - Code cleanup.
- **2026-10-08:** timeline declutter and pill clearance (PRs #32–#34):
  - Every relationship row, with the axis pinned.
  - Cross-lane links merged into trunks.
  - Spans kept out of cluster pills.
- **2026-10-09/10:** Global Preferences (PR #35, `docs/sprints/global-preferences/`). The Trace Graph plan was written (`docs/sprints/trace-graph/`), with nothing implemented yet.

## What's still open from the original plan

1. **Sprint 10 entirely:** boundary snapshots, context outside the range, case export/import, URL fragment state.
2. **Sprint 11 entirely:** RPC capability detection, the full error-handling matrix, browser end-to-end tests, the private beta and its user task test.
3. **Sprint 07A:** node drag and the redraw ghost were never confirmed in the browser.
4. **Sprint 08:** a directed connector between two mapped lanes has only been seen in unit tests.
5. **Sprint 07B:**
   - Tensor fee accounts aren't in the registry.
   - cNFTs are absent from wallet state and the asset filter.
   - v2 cNFT transfers name the signer as the previous owner.
6. **Sprint 06A:** `/map?wallet=` links still need both dates.
7. **Sprint 09:** performance hasn't been measured on a production build or on real wallets at 5,000 transactions.
8. **C1–C8:** everything in `docs/CHRONOLOGY_OPEN_ISSUES.md`. It starts with protocols that have a registry entry but no decoder (Drift withdrawals reading as "Burn" with the vault as a counterparty is rated High).

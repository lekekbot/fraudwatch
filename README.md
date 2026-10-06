# FraudWatch

FraudWatch is a local-first Solana investigation workbench. It reconstructs a wallet's on-chain activity into human-readable events, relationships, chronological patterns and inspectable evidence, across several wallets at once.

Give it your own Solana RPC endpoint, a primary wallet and an optional date range. Everything runs in your browser: there is no FraudWatch server, account or database.

## What it does

Each view answers one question:

| View | Question | What you see |
|---|---|---|
| **Timeline** | What happened? | One card per event per mapped wallet, in time order: "NFT purchase · 42 SOL · Magic Eden", "Swap · 24.3 SOL → 3,561 USDC · Jupiter", "Bridge out · 100 USDC → Ethereum · CCTP". Dense periods cluster; a transaction shared by two mapped wallets sits at one point across both lanes. |
| **Graph** | Who was involved? | One connection per pair of addresses, built from events, so swap routing, pools and other infrastructure don't clutter it. |
| **Relationship inspector** | How are they connected? | Each direction's totals per asset, first and last contact, active days, what the events were, and any behaviour patterns the pair took part in. |
| **Event inspector** | What exactly occurred? | A one-sentence reading, the participants, every asset movement with its role (payment, royalty, fee, rent, routing…), protocol, confidence, and the raw transaction. |
| **Evidence** | How do we know? | A checklist in fixed categories (facts from the chain, verified attribution, interpretation, heuristics and gaps, your labels, community labels), with ✓ for what holds and ? for what's missing. |
| **Behaviour observations** | What pattern emerged over time? | Deterministic patterns across a wallet's events: rapid forwarding, fund splits, consolidation, repeated counterparties, round trips, bridge milestones and deposits to verified exchanges. Each records its rule, thresholds and triggering events. |

It reads these protocols today: Jupiter swaps, Marinade liquid staking, Kamino lending, Circle CCTP bridges, NFT trades on Magic Eden and Tensor (including compressed NFTs), plus generic transfers, swaps, mints, burns, approvals and stake instructions. Activity it can't decode is still shown, at low confidence, rather than guessed. The known gaps are listed in [docs/CHRONOLOGY_OPEN_ISSUES.md](docs/CHRONOLOGY_OPEN_ISSUES.md).

Other features: map counterparties as extra wallets (each with its own history), find transactions shared between mapped wallets, reconstruct each wallet's balances before and after every transaction, label, tag and bookmark addresses and transactions, flag likely address-poisoning look-alikes, and filter every view the same way.

## Responsible use

FraudWatch describes what happened on-chain. It does **not** decide who is guilty of anything.

- **No verdicts, no scores.** Behaviour observations describe patterns ("received 100 SOL, sent 95 on within 74 seconds"). Many legitimate wallets show the same patterns: exchanges, market makers, payment processors, bots.
- **Interpretations can be wrong.** Every event shows its confidence and its evidence. Low-confidence readings rest on balance patterns, not decoded instructions. Check the evidence and the raw transaction before relying on a reading.
- **Labels are not facts.** Your own labels and the community label list are shown with their source, and are never used to interpret a transaction. Only the curated protocol registry counts as verified attribution, and it can contain mistakes too.
- **Verify before acting.** Treat anything FraudWatch shows as a lead to verify, especially before naming a person, reporting an address or taking action against anyone.
- **Your investigations stay private.** Cases, labels and fetched transactions live in your browser's IndexedDB. Your RPC URL stays on your machine and is never put in URLs or exports.

## Getting started

Requires Node 24+ and [pnpm](https://pnpm.io) (the version is pinned in `package.json`).

```sh
pnpm install
pnpm dev          # http://localhost:3000
```

Open the app, add your Solana RPC endpoint under RPC settings, and create a case for a wallet. A free public RPC works for small cases but rate-limits heavily; a provider key (Helius, Triton, QuickNode…) is much faster.

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Start the dev server |
| `pnpm build` | Build the production app |
| `pnpm preview` | Serve the production build |
| `pnpm typecheck` | Generate Next route types and run `tsc` |
| `pnpm lint` | Run ESLint |
| `pnpm test` | Run the test suite (Vitest) |
| `node scripts/capture-fixture.ts` | Record mainnet transactions as test fixtures (see [CONTRIBUTING.md](CONTRIBUTING.md)) |

## Project layout

```text
src/app/              Next.js app: site pages and the case workspace (timeline, graph, table, inspectors)
src/lib/semantic/     Semantic events: transaction context, protocol resolver, interpreters, evidence
src/lib/behavior/     Behaviour observations and their thresholds
src/lib/graph/        Relationship graph
src/lib/state/        Wallet balance reconstruction and per-wallet summaries
src/lib/              Also: RPC adapter, ingestion, IndexedDB cache, timeline layout, labels, search
src/components/       Shared UI components
protocols/            Protocol registry (solana.json), centralized exchange wallets, community labels
fixtures/solana/      Recorded mainnet transactions used by the tests
docs/                 Architecture, terminology, open issues and the sprint plans
```

## Docs

- [Architecture](docs/ARCHITECTURE.md): the data lifecycle and the semantic model
- [Terminology](docs/TERMINOLOGY.md)
- [Open issues](docs/CHRONOLOGY_OPEN_ISSUES.md): known gaps and the suggested order of work
- [Contributing](CONTRIBUTING.md)
- [Sprint plans](docs/sprints/)

## Data sources

- **Protocol registry** (`protocols/solana.json`, `protocols/centralized-vaults.json`): curated by this project; each change bumps the registry version.
- **Community labels** (`protocols/community-labels.json`): display names imported from the [tribixbite solana-programs gist](https://gist.github.com/tribixbite/9a7f0a45e41c2f9cf64428f900a25c5b), shown as unverified and attributed. See [protocols/sources/README.md](protocols/sources/README.md).
- **Chain data**: fetched from the RPC endpoint you configure. FraudWatch calls no other service.

## Licence

[MIT](LICENSE).

Built with Next.js 16, React 19, Tailwind CSS 4, `@solana/kit`, Dexie (IndexedDB) and d3.

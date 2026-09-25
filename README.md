# FraudWatch

FraudWatch maps Solana wallet transactions in time order, across several wallets at once. Give it an RPC endpoint, a primary wallet and an optional date range. It then:

- loads the wallet's transaction history from your RPC;
- rebuilds the wallet's asset state before and after each transaction;
- shows transactions on a timeline, with one lane per mapped wallet;
- lists counterparties without fetching their history (you choose which ones to map as extra wallets);
- finds transactions shared between mapped wallets;
- lets you label, tag and bookmark addresses and transactions;
- recognises known protocols from a versioned JSON registry (`protocols/`).

The app runs entirely in the browser. It has no server, no API routes and no application database. Transactions, cases and labels are stored locally in IndexedDB. Your RPC endpoint stays on your machine and is never put in URLs or exports.

## Getting started

Requires Node and [pnpm](https://pnpm.io) (the version is pinned in `package.json`).

```sh
pnpm install
pnpm dev          # http://localhost:3000
```

Open the app, add your Solana RPC endpoint in settings and create a case for a wallet.

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Start the dev server |
| `pnpm build` | Build the static export into `out/` |
| `pnpm preview` | Serve the built `out/` folder |
| `pnpm test` | Run the Vitest suite |
| `pnpm typecheck` | Generate Next route types and run `tsc` |
| `pnpm lint` | Run ESLint |

## Project layout

```text
src/app/          Next.js app: site pages and the case workspace (timeline, graph, table, inspector)
src/lib/          Core logic: RPC adapter, ingestion, IndexedDB cache, state reconstruction,
                  timeline and graph projection, labels, protocols, search
src/components/   Shared UI components
protocols/        Protocol registry (solana.json) and its JSON schema
fixtures/solana/  Replayable RPC fixtures used by the tests
scripts/fixtures/ Scripts to capture mainnet fixtures and generate synthetic ones
docs/             Architecture, terminology and the sprint plan
```

## Docs

- [Sprint plan and MVP scope](docs/00_README.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Terminology](docs/TERMINOLOGY.md)
- [Sprints](docs/sprints/)

Built with Next.js 16, React 19, Tailwind CSS 4, `@solana/kit`, Dexie (IndexedDB) and d3.

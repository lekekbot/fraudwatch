# Protocol registry sources

Raw third-party inputs for the Sprint 06 protocol registry (`protocols/solana.json`).
Files here are snapshots, unmodified except where noted below. Convert them into the versioned registry schema; never load them into the app directly.

## tribixbite-solana-programs.json

- Source: https://gist.github.com/tribixbite/9a7f0a45e41c2f9cf64428f900a25c5b
- Gist revision: `35cb2e3604ff685ebd4712283c16d07258ee5f7d` (last updated 2026-07-28)
- Snapshot taken: 2026-09-24
- Shape: `{ "<section>": { "<address>": "<display name>" } }`
  - `program` (263): program IDs → names
  - `address` (1,169): non-program addresses (vaults, authorities, exchange wallets, …) → names
  - `hacker` (24): addresses the gist author attributes to exploits. **Removed from this snapshot** (2026-10-06): third-party accusations aren't something FraudWatch redistributes, and the importer never used them.
  - `trust_token` (3)
- May be outdated; the maintainer does not guarantee it. Every entry needs verifying before it counts as fact.

Import caveats for Sprint 06:

- `hacker` entries are **third-party attributions, not FraudWatch verdicts**. Automatic fraud verdicts are a non-goal. If they are imported at all, show them as an attributed external label (e.g. "labelled by tribixbite gist"), never as a protocol or verdict.
- Names are free text, with duplicates and trailing spaces. Normalise them into `{ protocol, role, label }` by hand or with a reviewed script.
- Validate every key as a base58 32-byte address when importing.

## Solscan popular programs

Snapshot checked against [Solscan's program leaderboard](https://solscan.io/leaderboard/program) on 2026-10-04. Registry v6 includes all 34 named service programs in the top 40 by interaction volume. Five unlabeled programs and one dedicated arbitrage bot were excluded. Leaderboard labels identify active programs; they are not ownership proof.

## Solscan popular tokens

Snapshot checked against [Solscan's token leaderboard](https://solscan.io/leaderboard/token) on 2026-10-04. The built-in asset registry includes the top 10 tokens in each displayed category: DeFi, Liquid Stake, Stablecoin, Meme, and Stocks (50 mints total). Each mint account and its decimals were verified against Solana mainnet; leaderboard labels are display metadata, not an endorsement.

## Solscan centralized vaults

`protocols/centralized-vaults.json` groups 31 named wallets from 14 centralized exchanges and custodial providers under canonical service identities. The 2026-10-04 snapshot includes every exchange provider shown in the first 20 results of [Solscan's Exchange Wallet tag](https://solscan.io/labelcloud/exchange_wallet#accounts), excluding gambling services, plus current major wallets verified on their Solscan account pages. Funding relationships and ordinary deposit addresses are not treated as ownership proof.

## Explorer-verified labels

Checked against Solscan's public labels on 2026-10-04:

- Coinbase: `H8sMJSCQxfKiFTCfDR3DUMLPwcRbM61LGFJ8N4dK3WjS`, `2AQdpHJ2JpcEgPiATUXjQxA8QmafFegfQwSLWSprPicm`, `GJRs4FwHtemZ5ZE9x3FNvJ8TMwitKTh21yxdRPqn7npE`
- MEXC: `ASTyfSima4LLAdDgoFGkgqoKowG1LZFDr9fAQrg7iaJZ`
- Jupiter Limit Order: `j1o2qRpjcyUwEvwtcfhEQefh773ZgjxcVRry7LDqg5X`, `jupoNjAxXgZ4rjzxzPMP4oxduvQsQtZzyknqvzYNrNu`
- Jupiter Perpetuals: `PERPHjGBqRHArX4DySjwM6UJHiR3sWAatqfdBS2qQJu`
- Magic Eden cNFT: `M3mxk5W2tt27WGT7THox7PmgRDp4m6NEhL5xvxrBfS1`
- Solana Name Service: `namesLPneVptA9Z5rqUDD9tMTWEJwofgaYwp8cawRkX`, `jCebN34bUfdeUYJT13J1yG16XWQpt5PDx6Mse9GUqhR`, `85iDfUvr3HJyLM2zcq5BXSiDvUWfw6cSE1FfNBo8Ap29`, `2KkyPzjaAYaz2ojQZ9P3xYakLd96B5UH6a2isLaZ4Cgs`
- Solflare: Swap Fees: `2rbMgYvzAb3xDk6vXrzKkY3VwsmyDZsJTkvB3JJYsRzA` (checked 2026-10-04; Solscan tags #Solflare #Fee Vault)

Exchange labels describe known service wallets, not every deposit address. Phantom and Ledger are wallet software/signers; ordinary Solana addresses do not reveal which app or hardware created them, so they are not registry entries.

## Community labels

`protocols/community-labels.json` is generated from the tribixbite snapshot by `node scripts/import-community-labels.ts`. It holds display names only (address → name) for the `program` and `address` sections, minus every address already in the verified registry; `hacker` attributions are left out. The app shows these names attributed as "community list, unverified" and never uses them to decide what protocol a transaction used. Verify an entry and move it into `solana.json` to make it count.

## Licensing

The gist states no licence. FraudWatch redistributes the `program` and `address` names (as `protocols/community-labels.json`, shown as unverified and attributed) on the understanding that they are factual address–name pairs collected from public sources. Before relying on that for a public release, confirm with the gist's author, or ship only `scripts/import-community-labels.ts` and have users fetch the snapshot themselves.

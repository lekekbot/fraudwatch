# Protocol registry sources

Raw third-party inputs for the Sprint 06 protocol registry (`protocols/solana.json`).
Files here are **unmodified snapshots**. Convert them into the versioned registry schema; never load them into the app directly.

## tribixbite-solana-programs.json

- Source: https://gist.github.com/tribixbite/9a7f0a45e41c2f9cf64428f900a25c5b
- Gist revision: `35cb2e3604ff685ebd4712283c16d07258ee5f7d` (last updated 2026-07-28)
- Snapshot taken: 2026-09-24
- Shape: `{ "<section>": { "<address>": "<display name>" } }`
  - `program` (263): program IDs → names
  - `address` (1,169): non-program addresses (vaults, authorities, exchange wallets, …) → names
  - `hacker` (24): addresses the gist author attributes to exploits
  - `trust_token` (3)
- May be outdated; the maintainer does not guarantee it. Every entry needs verifying before it counts as fact.

Import caveats for Sprint 06:

- `hacker` entries are **third-party attributions, not FraudWatch verdicts**. Automatic fraud verdicts are a non-goal. If they are imported at all, show them as an attributed external label (e.g. "labelled by tribixbite gist"), never as a protocol or verdict.
- Names are free text, with duplicates and trailing spaces. Normalise them into `{ protocol, role, label }` by hand or with a reviewed script.
- Validate every key as a base58 32-byte address when importing.

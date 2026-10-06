# Contributing to FraudWatch

Thanks for helping. FraudWatch is a local-first Solana investigation workbench: everything runs in the browser against the user's own RPC. Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) first for the data lifecycle and the semantic model. [docs/CHRONOLOGY_OPEN_ISSUES.md](docs/CHRONOLOGY_OPEN_ISSUES.md) lists known gaps and is a good place to find work.

## Setup

Requires Node 24+ and pnpm (version pinned in `package.json`).

```sh
pnpm install
pnpm dev        # http://localhost:3000
```

Before opening a pull request, all three must pass (CI runs them too):

```sh
pnpm typecheck
pnpm lint
pnpm test
```

## Principles every change must keep

- **Local-first.** No server, no account, no application database. Chain data comes only from the user's RPC; nothing calls another service.
- **RPC credentials stay local.** Never put an RPC URL in a URL, an export, a log or a debug bundle.
- **No verdicts.** FraudWatch describes activity; it never labels a wallet guilty, scores risk or ranks suspicion. Behaviour observations describe patterns, with their rule and evidence.
- **Don't guess.** When evidence is incomplete, say so: lower confidence, a `null` side on a flow, a warning, or `UNKNOWN`. A wrong confident reading is worse than an honest unknown.
- **Traceable.** Every interpretation must point back to the canonical transaction (`EvidenceRef`).
- **Infrastructure isn't a counterparty.** Programs, pools, vaults, escrows, token accounts and fee accounts never become participants or graph connections.
- **Labels don't interpret.** Only the curated protocol registry counts as verified attribution. Community and user labels are shown with their source and never decide what a transaction means.

## Adding a protocol interpreter

Interpreters live in `src/lib/semantic/` (`defi.ts` for protocol decoders, `interpreters.ts` for the priority list). Each one reads a `TransactionContext` and returns a reading or `null`.

1. **Record real transactions first.** Use the capture script against a non-rate-limited RPC:

   ```sh
   node scripts/capture-fixture.ts --rpc "$RPC" --out fixtures/solana/defi \
     --program <program id> --instruction <AnchorInstructionName> --count 1
   ```

   Pick simple examples (one action, called at the top level) plus at least one awkward one (called from inside another program, or several actions in one transaction).

2. **Decode the instruction.** For Anchor programs, match the 8-byte discriminator (`sha256("global:<snake_case_name>")[0..8]`) with `bytesOf` and `discriminator` from `src/lib/solana/anchor.ts`. Check each discriminator against your captured data before relying on it. Read the actor from the decoded account list, not the fee payer: relayers often pay fees for other wallets.

3. **Return an honest reading.** Use `reading()` in `defi.ts`: **HIGH** only when the decoded instruction and the actor's balances agree, **MEDIUM** with a warning when they don't. Let `actorFlows()` build the flows, so routing becomes settlement evidence, not relationships.

4. **Bump versions.** Give a new interpreter `version: 1`; bump an existing interpreter's version whenever its output changes.

5. **Place it in priority order** in `INTERPRETERS`: specific before generic.

6. **Test it.** Add cases to the relevant test file (e.g. `src/lib/semantic/defi.test.ts`), and pin each recorded fixture's reading in `src/lib/semantic/regression.test.ts`. If your change alters an existing pinned row, the change must be intended: say why in the PR.

## Adding registry entries

`protocols/solana.json` (and `protocols/centralized-vaults.json` for exchange wallets) map addresses to a protocol, category and role. They are lookup data only: what a transaction did is decided in code.

- Every entry needs a source you can point to (the protocol's docs or IDL, an explorer label that matches on-chain behaviour). Note it in the PR.
- Use the right role: `program`, `pool`, `vault`, `authority`, `fee_account`, `market` or `wallet`. Roles decide infrastructure handling.
- Bump the registry's `version` on every change.
- Don't import third-party lists wholesale into the registry; they belong in `protocols/sources/` as attributed, unverified snapshots (see `protocols/sources/README.md`).

## Behaviour rules

Detectors live in `src/lib/behavior/observations.ts`. All thresholds belong in `BEHAVIOR_THRESHOLDS`, never inline. Every observation must record its triggering events, rule, thresholds and calculated values. Bump `BEHAVIOR_VERSION` when a rule or threshold changes. Add tests for each rule's boundaries and for the false positives it must ignore (routing, fees, rent, dust).

## Code and commits

- Match the surrounding style by hand; the repo has no formatter. Don't reformat files you're only editing, including data files (edit them textually).
- Keep comments to the why, not the what.
- Commit messages follow Conventional Commits (`feat(scope): …`, `fix(scope): …`, `chore: …`), with a body explaining the change.
- Fixtures are public chain data. Never commit data from a case you're investigating unless you mean to publish it.

## Reporting a misreading

If FraudWatch reads a transaction wrongly, open an issue with the signature and, ideally, the **debug bundle**: open the transaction in the event inspector, expand **Developer details**, and click **Copy debug bundle**. It contains public chain data and FraudWatch's reading, with no RPC URL or labels, but it does include the wallets in that transaction.

## Licence

By contributing you agree that your contributions are licensed under the [MIT licence](LICENSE).

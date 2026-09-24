# Sprint 06 — Observed Counterparties, Labels, Tags, and Protocol Registry

**Status:** ✅ Complete (checked 2026-09-24)

- **Protocol registry** (`protocols/solana.json`, `protocols/schema.json`, loader in `src/lib/protocols/registry.ts`):
  - v1 lists 40 program addresses across 19 entries: core Solana and SPL, Jupiter, Raydium, Orca, Meteora, Phoenix, OpenBook, Pump.fun, Kamino, marginfi, Save, Drift, Marinade, Metaplex, Tensor, Magic Eden, Wormhole and Circle CCTP.
  - Every address was confirmed as an executable program on mainnet before it went in. Programs whose owner wasn't certain were left out rather than guessed.
  - The JSON is bundled into the static build and validated on load (`parseRegistry`, following the schema's rules): valid base58 address, known category and role, non-empty label, no address listed twice.
  - Lookup only. What a transaction did stays in code (`summarize.ts`).
- **Enrichment:** `enrichTransaction` returns the registry matches among the programs invoked (outer and inner) and the accounts touched, the programs the registry doesn't list, and `protocolRegistryVersion`.
  - It's a pure lookup computed when shown, so there is no enrichment cache to invalidate. The version travels with every result, so a future cache or export can tell which registry it was read against.
- **Address states** (`src/lib/case/address-state.ts`): PRIMARY, MAPPED, INFRASTRUCTURE, or OBSERVED, as defined in TERMINOLOGY.md.
  - Any program the loaded transactions invoke is INFRASTRUCTURE even when the registry doesn't list it, so a program is never offered as a wallet to map.
- **Observed counterparties** (`src/lib/state/counterparties.ts`, left-panel "Counterparties" list): every address on the other side of the selected wallet's transactions, including whoever sent them, with a count and state. No history is fetched for them.
- **Local labels** (`address_labels` table, IndexedDB v4, `src/lib/db/address-labels.ts`): `AddressLabel { address, caseId, name, note?, tags[] }` as specced, keyed by `[caseId+address]`.
  - Fields are trimmed and bounded, and tags are de-duplicated case-insensitively. Clearing every field deletes the label, and deleting a case deletes its labels.
  - The unused Sprint 01 `case.labels`/`case.tags` maps move into the table during the v4 upgrade. The case schema is now version 2.
- **Local override** (`displayName` / `createNames` in `src/lib/labels/labels.ts`): a label's name wins on screen, then the registry label, then the shortened address. The registry itself is never modified, and a label with only tags doesn't hide the registry name.
- **Address inspector** (`src/app/case/address-panel.tsx`): opened from the Counterparties list, the wallet list, or any counterparty, sender or unknown program in the transaction details, with a back button to the transaction.
  - Shows the state, registry match and transaction count.
  - Has Rename, tags (Enter or comma to add), a note, Copy address and Open explorer.
  - Map wallet appears disabled for observed addresses until Sprint 07.
- **Transaction details:** the Protocol row lists the non-core protocols the registry matched ("None identified" otherwise). A new "Unknown programs" section lists unmatched programs, marked as not in registry vN; they can be named but stay unknown to the registry. Action and card headlines use label or registry names.
- **Browser-checked** on the real 65-transaction wallet:
  - The v4 migration ran on existing data, and the list showed 44 counterparties.
  - Labelling the top sender "Keeper bot A" (tag `bot`) updated 22 cards to "by Keeper bot A", and the label survived a reload.
  - One transaction showed Protocol: marginfi, with five unknown programs.
  - Naming the unknown `Hobbak…` program made all 37 Program call cards read "Hobbak automation". The address showed as INFRASTRUCTURE with no Map wallet button.
  - The test labels were removed afterwards.
  - Fixed during the check: Enter didn't save a name (a form with two inputs and no submit button never submits on Enter), and unknown programs showed as OBSERVED wallets.

**Goal:** Make the timeline readable without mapping every address.

## Observed counterparty

A transaction may expose:

```text
Wallet A ── 10,000 USDC ──► Wallet B
```

If B is not mapped, show it as an observed endpoint.

Do not retrieve B history.

## Counterparty actions

```text
Map wallet
Rename
Add tag
Add note
Copy address
Open explorer
```

## Local labels

```ts
type AddressLabel = {
  address: string;
  caseId: string;
  name: string;
  note?: string;
  tags: string[];
};
```

Persist in IndexedDB.

## Protocol registry

Files:

```text
/protocols/schema.json
/protocols/solana.json
```

Example:

```json
{
  "version": 1,
  "protocols": {
    "jupiter": {
      "name": "Jupiter",
      "category": "dex_aggregator",
      "addresses": {
        "PROGRAM_ID": {
          "role": "program",
          "label": "Jupiter"
        }
      }
    }
  }
}
```

## Registry responsibilities

Use JSON for:

```text
address → protocol
address → role
address → display label
```

Do not encode complex transaction parsing logic in JSON.

## Local override

Allow a user label to override display text visually without changing protocol metadata.

## Versioning

Every enriched transaction remembers:

```text
protocol_registry_version
```

## Acceptance criteria

- [x] Unmapped counterparties appear without creating timelines.
- [x] User can label/tag addresses.
- [x] Labels survive reload.
- [x] Protocol JSON identifies configured addresses.
- [x] Unknown protocols remain unknown.

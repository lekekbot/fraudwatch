# Sprint 06 — Observed Counterparties, Labels, Tags, and Protocol Registry

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

- [ ] Unmapped counterparties appear without creating timelines.
- [ ] User can label/tag addresses.
- [ ] Labels survive reload.
- [ ] Protocol JSON identifies configured addresses.
- [ ] Unknown protocols remain unknown.

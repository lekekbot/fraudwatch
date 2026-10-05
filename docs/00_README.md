# FraudWatch — Local-First MVP Sprint Plan

## MVP definition

FraudWatch is a **chronological multi-wallet transaction mapper** for Solana.

The user provides:

- a Solana RPC endpoint;
- one primary wallet;
- a date range.

FraudWatch:

1. retrieves the wallet's transaction history;
2. reconstructs asset state over time;
3. renders transactions chronologically;
4. keeps counterparties shallow by default;
5. lets the user explicitly map additional wallets;
6. discovers intersections between all mapped wallets;
7. lets the user label/tag addresses;
8. identifies known protocols from a versioned JSON registry;
9. stores everything locally in the browser;
10. exports/imports portable case files.

There is **no centralized application database** in the MVP.

---

# Architecture principles

## Blockchain data is not persisted server-side

The RPC/provider is the authoritative data source.

FraudWatch only reconstructs and caches data locally.

## IndexedDB is the local database

Use IndexedDB for:

- canonical transactions;
- parsed/normalized transactions;
- wallet asset states;
- case configuration;
- mapped wallets;
- labels;
- tags;
- protocol enrichment cache;
- ingestion checkpoints.

## URL state is configuration, not transaction storage

Simple URLs may include:

```text
wallet
start
end
```

Complex/shareable case configuration should use a compressed URL fragment:

```text
/map#state=<compressed-case-state>
```

Never include RPC credentials in URLs.

## RPC credentials stay local

Store the user's RPC endpoint locally.

Do not include it in:

- query strings;
- URL fragments;
- exports by default;
- logs;
- analytics.

## One transaction exists once

If A and B are both mapped and participate in the same transaction, FraudWatch stores one canonical transaction and multiple wallet effects.

## Counterparties remain shallow

Seeing Wallet D does not automatically fetch D's history.

The user must explicitly click:

```text
Map wallet
```

## Chronological layout

```text
X axis = time
Y axis = mapped wallet lane
```

Do not use force-directed positioning for the main graph.

---

# MVP sprint order

| Sprint | Outcome |
|---|---|
| 00 | Freeze architecture and prototype rules |
| 01 | App shell, RPC settings, local case model |
| 02 | Generic Solana RPC adapter and ingestion |
| 03 | IndexedDB transaction/cache layer |
| 04 | Wallet asset-state reconstruction |
| 05 | Single-wallet chronological mapper |
| 05A | Full-screen workspace and transaction filters |
| 06 | Observed counterparties, labels, tags, protocol JSON |
| 06A | Optional case dates from wallet activity |
| 07 | Dynamic secondary-wallet mapping |
| 07A | Node graph view (Timeline / Graph / Table tabs) |
| 07B | NFT trades (on-chain NFT check, buy / sale / mint / transfer) |
| 08 | Multi-wallet chronological graph |
| 08A | Minimap, trackpad gestures, add wallet by address |
| 09 | Scaling, filters, aggregation, navigation |
| 09A | Graph tab as a wallet interaction map |
| 09B | Repository reliability cleanup |
| 09C | Bulk hide from map and hide rules |
| 10 | Boundary context, case portability, export/import |
| 11 | Reliability, privacy, deployment, private beta |

## Chronology & Semantic Events initiative

Follows the MVP sprints. Each file in `docs/sprints/SPRINT_C*.md` opens with the initiative's shared principles and rules.

| Sprint | Outcome |
|---|---|
| C1 | Semantic event domain model |
| C2 | Interpreter framework and protocol resolution |
| C3 | NFT trade reconstruction consolidation |
| C4 | DeFi and protocol semantic events |
| C5 | Event-centric timeline |
| C6 | Behavioral sequence detection |
| C7 | Relationship intelligence and graph integration |
| C8 | Evidence, reliability and investigation polish |

## MVP completion gate

The MVP is complete after Sprint 11 when a user can:

- open FraudWatch;
- provide an RPC;
- enter a wallet/date range;
- load transactions;
- inspect before/change/after asset state;
- see the wallet chronologically;
- map secondary wallets;
- see intersections between mapped wallets;
- label/tag addresses;
- identify configured protocols;
- reopen the case from IndexedDB;
- export/import the case;
- use the app without any application database.

---

# Explicitly not in MVP

- accounts/login;
- cloud saved cases;
- server-side Postgres;
- server-side job queue;
- collaboration;
- permanent hosted share links;
- automatic fraud verdicts;
- wallet ownership inference;
- AML scoring;
- alerts/monitoring;
- EVM/Arbitrum;
- universal protocol decoding;
- AI-generated conclusions.

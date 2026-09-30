# FraudWatch MVP — Local-First Architecture

## Overview

```text
┌─────────────────────────────────────────┐
│ Browser                                 │
│                                         │
│  ┌───────────────────────────────────┐  │
│  │ FraudWatch UI                     │  │
│  │ chronological graph              │  │
│  │ wallet/transaction inspector      │  │
│  └───────────────┬───────────────────┘  │
│                  │                      │
│  ┌───────────────▼───────────────────┐  │
│  │ Mapping Engine                    │  │
│  │ wallet expansion                  │  │
│  │ transaction intersection          │  │
│  │ state reconstruction              │  │
│  └───────┬─────────────────┬─────────┘  │
│          │                 │            │
│  ┌───────▼───────┐ ┌──────▼─────────┐  │
│  │ IndexedDB     │ │ RPC Adapter     │  │
│  │ local cache   │ │ standard JSON-RPC│ │
│  └───────────────┘ └──────┬─────────┘  │
└────────────────────────────┼────────────┘
                             │
                             ▼
                    User-provided RPC
                             │
                             ▼
                          Solana
```

## No application database

No:

```text
Postgres
Supabase
MongoDB
Redis
Neo4j
```

is required for MVP.

IndexedDB is the user's private local persistence layer.

## Data flow

```text
RPC
 ↓
raw transaction
 ↓
canonical transaction
 ↓
wallet-specific effects
 ↓
wallet asset-state reconstruction
 ↓
protocol/address enrichment
 ↓
chronological graph projection
```

## Canonical transaction rule

Store once:

```text
signature
```

Reference many times.

## Wallet expansion rule

```text
observed wallet
    ↓ user action
mapped wallet
    ↓
load scoped history
    ↓
find transactions shared with all mapped wallets
    ↓
add wallet lane
```

## Security model

RPC URL/key stays local.

Portable case configuration excludes it.

## Protocol architecture

```text
protocols/solana.json
        ↓
address resolver

decoder code
        ↓
transaction interpretation
```

## Future migration path

A server database becomes useful only if FraudWatch later needs:

- accounts;
- cloud sync;
- teams;
- server-hosted public links;
- scheduled monitoring;
- alerts;
- organization-wide labels;
- large server-side processing.

The MVP should not pre-emptively add this complexity.

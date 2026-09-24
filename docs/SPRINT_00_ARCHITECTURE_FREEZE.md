# Sprint 00 — Architecture Freeze

**Goal:** Lock the database-free MVP architecture before implementation.

## Decisions to freeze

### Runtime model

```text
Static web app
    ↓
Browser
    ├── IndexedDB
    ├── mapping engine
    ├── graph renderer
    └── user-supplied RPC
```

No centralized app database.

### Case identity

A case is local data:

```text
case_id
name
primary_wallet
start_time
end_time
mapped_wallets
labels
tags
UI preferences
```

### RPC configuration

RPC endpoint is user supplied.

It is stored locally and excluded from portable case state by default.

### Address states

```text
PRIMARY
MAPPED
OBSERVED
INFRASTRUCTURE
```

Only `PRIMARY` and `MAPPED` wallets get full scoped history.

### Graph positioning

```text
x = time/event order
y = wallet lane
```

### Protocol registry

Protocol recognition comes from versioned JSON.

### Transaction identity

```text
(chain, signature)
```

is globally unique inside the local cache.

## Prototype audit

Document the current Railway MVP:

- framework;
- graph library;
- RPC/provider calls;
- data parsing;
- transaction model;
- token balance logic;
- layout behavior;
- reusable UI pieces;
- hard-coded assumptions.

## Fixtures

Create static fixtures for:

1. one wallet / simple transfers;
2. one wallet / swap;
3. A → B;
4. A → B → C;
5. C → D → A;
6. high-activity wallet.

## Deliverables

- [ ] architecture decision record;
- [ ] prototype audit;
- [ ] fixture set;
- [ ] terminology list;
- [ ] non-goals list.

## Exit criteria

Everyone can answer:

- what is cached locally;
- what is fetched from RPC;
- what belongs in URL state;
- when a wallet becomes mapped;
- when a counterparty stays shallow;
- how shared transactions are represented.

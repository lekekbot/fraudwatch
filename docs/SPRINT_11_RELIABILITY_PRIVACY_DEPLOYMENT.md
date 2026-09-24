# Sprint 11 — Reliability, Privacy, Deployment, and Private Beta

**Goal:** Ship the complete local-first MVP.

## RPC capability detection

On RPC setup test:

```text
basic RPC
archive/history availability
CORS
rate-limit behavior
optional enhanced methods
```

Show capability summary.

## Provider adapters

At minimum:

```text
GenericSolanaRpcAdapter
```

Optionally:

```text
HeliusEnhancedAdapter
```

if the endpoint supports enhanced historical methods.

The app must still work in generic mode.

## Error handling

Handle:

- RPC unavailable;
- CORS blocked;
- rate limited;
- historical data missing;
- malformed response;
- transaction unavailable;
- browser storage quota exceeded;
- invalid imported case;
- local cache corruption.

## Privacy rules

- no RPC key in URL;
- no RPC key in exported case;
- no transaction telemetry by default;
- no analytics containing wallet addresses unless explicitly designed/consented;
- local cases remain local.

## Cache settings

Provide:

```text
storage usage
clear case data
clear RPC settings
clear transaction cache
clear everything
```

## Static deployment

Target architecture:

```text
Static frontend hosting
      ↓
Browser
 ├── IndexedDB
 └── RPC
```

A backend should not be required for normal use.

If a proxy is later needed for CORS, treat it as optional infrastructure, not the application database.

## Beta checklist

Test real cases with:

```text
single wallet
A → B
A → B → C
C → D → A
high-volume wallet
protocol-heavy wallet
```

## User task test

A beta user should be able to:

1. enter an RPC;
2. create a case;
3. map the primary wallet;
4. understand before/change/after;
5. identify a counterparty;
6. map it;
7. understand shared transactions;
8. map another wallet;
9. see a loop/intersection;
10. label wallets;
11. export the case;
12. reopen it later without refetching everything.

## MVP acceptance criteria

- [ ] No centralized database is required.
- [ ] No account is required.
- [ ] User RPC remains private/local.
- [ ] Case survives browser reload.
- [ ] Transactions are cached locally.
- [ ] Multi-wallet mapping works.
- [ ] Chronology remains readable.
- [ ] Case export/import works.
- [ ] Errors are recoverable.
- [ ] Product can be deployed as a static web app.

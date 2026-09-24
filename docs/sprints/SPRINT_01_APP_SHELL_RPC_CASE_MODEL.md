# Sprint 01 — App Shell, RPC Settings, and Local Case Model

**Status:** ✅ Complete (checked 2026-09-24)

- Screens: home (`src/app/home-view.tsx`), new case (`src/app/cases/new/`), RPC settings (`src/app/settings/rpc/`), case shell (`src/app/case/`), `/map` startup (`src/app/map/`).
- Model and storage: `src/lib/case/model.ts`, Dexie `cases` + `rpc_settings` stores in `src/lib/db/`.
- Validation: Solana address, range, RPC URL scheme, connection test (`getVersion` + `getLatestBlockhash`), duplicate-case prompt.
- `pnpm test` (33 tests), `pnpm typecheck`, `pnpm lint` all pass.
- Note: the "Import case" button on Home is a disabled placeholder; import arrives in Sprint 10.

**Goal:** Build the minimum application structure around local cases.

## Screens

### Home

```text
New case
Recent local cases
RPC settings
Import case
```

### New case

Inputs:

```text
case name
primary wallet
start date
end date
```

### RPC settings

Inputs:

```text
RPC URL
provider type: auto / generic / enhanced
test connection
save locally
```

Never put RPC URL into query parameters.

## Local case model

```ts
type FraudWatchCase = {
  id: string;
  version: number;
  name: string;

  chain: "solana";

  primaryWallet: string;

  range: {
    start: string;
    end: string;
  };

  mappedWallets: MappedWalletConfig[];

  labels: Record<string, string>;
  tags: Record<string, string[]>;

  createdAt: string;
  updatedAt: string;
};
```

## Mapped wallet config

```ts
type MappedWalletConfig = {
  address: string;
  role: "primary" | "mapped";

  addedFromWallet?: string;
  addedFromTransaction?: string;

  rangeMode:
    | "case"
    | "first_interaction"
    | "custom";

  customStart?: string;
};
```

## Simple routing

Support:

```text
/map?wallet=<address>&from=<unix>&to=<unix>
```

for simple startup only.

Do not encode labels, RPC secrets, or fetched data in query parameters.

## Validation

- valid Solana address;
- start < end;
- RPC URL scheme valid;
- connection test succeeds;
- duplicate case handling.

## Acceptance criteria

- [x] User can enter/save an RPC locally.
- [x] User can test RPC connectivity.
- [x] User can create a local case.
- [x] User can reopen a recent local case shell.
- [x] RPC credentials never enter the URL.

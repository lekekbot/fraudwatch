# Sprint 01 — App Shell, RPC Settings, and Local Case Model

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

- [ ] User can enter/save an RPC locally.
- [ ] User can test RPC connectivity.
- [ ] User can create a local case.
- [ ] User can reopen a recent local case shell.
- [ ] RPC credentials never enter the URL.

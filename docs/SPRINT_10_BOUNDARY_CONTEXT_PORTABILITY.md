# Sprint 10 — Boundary Context, Case Export, Import, and Portable State

**Goal:** Explain assets around the date range and make cases portable without cloud storage.

## Boundary model

Separate:

```text
IN-RANGE TRANSACTIONS
BOUNDARY SNAPSHOTS
CONTEXT TRANSACTIONS
```

## Opening state

Show:

```text
Wallet state immediately before case start
```

If available.

## Closing state

Show:

```text
Wallet state at/after case end
```

with quality indicator.

## Trace opening asset

User can choose:

```text
Trace earlier origin
```

FraudWatch fetches earlier relevant transactions as context.

Do not add them silently to the case range.

## Follow closing asset

User can choose:

```text
Show next movement
```

Again, mark it as context.

## Visual distinction

Example:

```text
context      |        case range         | context
-------------|---------------------------|---------
Dec 20       | Jan 1 ... Jun 30          | Jul 3
```

## Export format

Create:

```text
*.fraudwatch.json
```

Include:

```text
schema_version
case config
primary wallet
date range
mapped wallet config
labels
tags
notes
lane order
bookmarks
protocol registry version
optional transaction references
```

Do not include RPC credentials.

## Import

Validate:

- schema version;
- wallet format;
- dates;
- supported chain.

Then rehydrate using:

```text
local cache
+
user RPC
```

## URL fragment state

For smaller cases/configs support:

```text
/map#state=<compressed-config>
```

Do not put raw transactions or RPC secrets into fragment state.

## Acceptance criteria

- [ ] Opening/closing context is visually distinct.
- [ ] User can trace outside range explicitly.
- [ ] Case can be exported.
- [ ] Case can be imported on another browser.
- [ ] RPC credentials are excluded.
- [ ] Small case configuration can be shared via URL fragment.

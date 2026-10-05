# FraudWatch — Chronology & Semantic Events Initiative

FraudWatch is a local-first Solana investigation workbench focused on chronological transaction reconstruction.

Core product principle:

> The Timeline answers **what happened and when**.  
> The Graph answers **who interacted**.  
> The semantic event engine explains **what the blockchain activity means**.  
> The Inspector explains **why FraudWatch believes that interpretation**.

Project rules that apply to every sprint:

- Preserve local-first architecture.
- RPC remains the source of truth.
- Do not introduce automatic fraud verdicts.
- Preserve uncertainty when evidence is incomplete.
- Keep infrastructure separate from meaningful wallet counterparties.
- Do not automatically expand observed wallets into full-history ingestion.
- Every interpretation must remain traceable to canonical transaction evidence.
- Existing application functionality should continue working unless a sprint explicitly replaces it.


# CHRONOLOGY C7 — Relationship Intelligence & Graph Integration

## Objective

Make the Graph consume the improved semantic event model and reduce wallet-interaction noise.

The Graph should become a relationship map, not a raw transaction visualization.

---

## Relationship principle

One connection should represent a meaningful relationship between two addresses.

Not one edge per transaction.

FraudWatch already aggregates repeated interactions; C7 should improve that aggregation using semantic events.

---

## Relationship summary

A relationship should be able to describe:

```text
A ↔ B

1,897 events

First interaction
Last interaction
Active days

A → B
totals by asset

B → A
totals by asset

Event composition:
transfers
NFT trades
funding
other

Observed behavior:
repeated funding
bidirectional activity
rapid forwarding association
etc.
```

Do not stop at:

```text
1,897 transactions
```

when semantic event breakdowns exist.

---

## Infrastructure reduction

Protocol programs, pools, vaults, token accounts, marketplace fee accounts, routers, escrows, and PDAs should not dominate the default Graph.

Infrastructure may be optionally revealed.

Default Graph emphasis should remain meaningful wallets/entities.

---

## Directionality

The Graph may continue using one aggregated relationship edge between address pairs, but direction-specific statistics must remain available in the connection inspector.

For example:

```text
A → B
428 events
391 SOL

B → A
317 events
204 SOL
```

---

## Event composition

Connections should summarize semantic event types rather than raw transaction kinds where possible.

Example:

```text
Transfers: 740
NFT trades: 41
Funding events: 12
Shared swaps: 8
Other: 1,096
```

Use categories that are actually meaningful in the implemented model.

---

## Timeline ↔ Graph navigation

Strengthen cross-navigation.

From a Graph relationship:

```text
Show events on Timeline
```

From a Timeline event:

```text
Show related wallets in Graph
```

Both views must operate on the same semantic event identity.

---

## Relationship inspector

The connection inspector should show:

- participants;
- first interaction;
- last interaction;
- active days;
- direction-specific totals;
- assets;
- event categories;
- notable behavior observations;
- underlying events;
- jump-to-timeline actions.

Do not make the inspector dependent on raw transfer count alone.

---

## Node ranking

Interaction count alone should not determine node importance.

Consider transparent factors such as:

```text
mapped status
semantic event count
value movement
recency
relationship diversity
verified service attribution
behavior observations
```

Do not introduce an opaque risk score.

---

## Graph performance

Preserve:

- aggregated edges;
- deterministic layout;
- node limits;
- canvas rendering;
- time-range filtering;
- connection inspector;
- timeline jump behavior.

Do not expand the graph back into one edge per event.

---

## Acceptance criteria

C7 is complete when:

- graph relationships derive from semantic events where available;
- protocol infrastructure is less noisy;
- repeated interactions summarize coherently;
- graph and timeline agree on semantic event identity;
- connection inspector exposes meaningful event breakdowns;
- direction-specific statistics remain available;
- raw transaction drill-down remains possible.

---

## End-of-sprint report

Report:

1. graph model changes;
2. relationship aggregation changes;
3. infrastructure suppression rules;
4. graph/timeline linking;
5. node ranking changes;
6. performance impact;
7. unresolved graph edge cases.

Do not begin C8 automatically.

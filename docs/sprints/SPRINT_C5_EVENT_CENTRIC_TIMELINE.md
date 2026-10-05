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


# CHRONOLOGY C5 — Event-Centric Timeline

## Objective

Make semantic events the primary object displayed by the Timeline.

This is the sprint where the UI should begin feeling materially different.

Do not redesign the entire application's visual language.

Work within the existing Timeline architecture.

---

## Product principle

The Timeline answers:

> What happened, and in what order?

The Graph answers:

> Who interacted?

Do not turn the Timeline into another graph.

---

## Event cards

Replace fragmented wallet-effect cards with semantic event cards where interpretation exists.

Examples:

```text
NFT PURCHASE
Mad Lads #1234
42 SOL
Magic Eden
```

```text
SWAP
24.3 SOL → 3,561 USDC
Jupiter
```

```text
TRANSFER
100 USDC → 8KNR…
```

```text
BRIDGE OUT
100 USDC
Solana → Ethereum
CCTP
```

---

## Progressive disclosure

Timeline cards must remain compact.

Use a three-level information hierarchy.

### Level 1 — Timeline card

Show only what is needed to understand chronology:

```text
event type
primary amount / assets
counterparty or protocol
```

### Level 2 — Selected event

Show:

```text
participants
asset flows
protocol
time
signature
relevant behavioral context
```

### Level 3 — Evidence inspector

Show:

```text
balance changes
instructions
inner instructions
accounts
raw/canonical transaction reference
classification evidence
confidence
```

---

## Shared events

When two mapped wallets participate in the same semantic event:

- render one shared x-position;
- preserve lane relationship logic;
- do not duplicate it into unrelated event objects;
- both lanes may reference the same semantic event;
- selecting either representation should select the same underlying event.

---

## Event direction

Direction should reflect meaningful roles.

Examples:

```text
sender → receiver
buyer ← NFT ← seller
buyer → payment → seller
wallet → bridge
wallet ↔ swap protocol
```

Avoid drawing meaningless connectors to every:

- fee account;
- pool;
- router;
- token account;
- program;
- PDA.

---

## Clustering

Existing dense-transaction clustering must continue working.

Clusters should represent semantic events rather than fragmented wallet effects where possible.

Far zoom:

```text
128 events
```

Near zoom:

individual event cards.

---

## Filtering

Preserve current filters and extend them where useful for:

```text
semantic category
semantic action
protocol
assets
participants
event confidence
```

Do not silently remove existing filtering functionality.

---

## Search and bookmarks

Existing search/bookmark workflows must continue working.

If bookmark identity previously depended on wallet-effect rows, migrate safely so bookmarks can reference semantic events without breaking existing cases.

---

## Event inspector

Selecting a semantic event should expose:

```text
human-readable interpretation
participants
protocol/service
asset flows
supporting fees
evidence
signature
classification provenance
confidence
```

The investigator should be able to move from:

```text
What happened?
```

to:

```text
Why does FraudWatch believe this happened?
```

without leaving the case.

---

## Performance constraints

Do not perform expensive interpretation work inside:

- React render loops;
- Canvas draw loops;
- hover handlers;
- zoom handlers.

Semantic events should be precomputed/cached.

Preserve the existing canvas strategy and dense-case performance targets.

---

## Acceptance criteria

C5 is complete when:

- Timeline primarily renders semantic events;
- Magic Eden purchases no longer fragment visually;
- supported swaps no longer look like arbitrary sends/receives;
- shared events remain synchronized across lanes;
- zoom/clustering still works;
- bookmarks/navigation remain functional;
- filters continue working;
- unsupported transactions still appear using generic fallback events;
- performance remains acceptable.

---

## End-of-sprint report

Report:

1. Timeline data-source changes;
2. event card design;
3. shared-event handling;
4. clustering changes;
5. filter/bookmark migrations;
6. performance impact;
7. UI regressions discovered.

Do not begin C6 automatically.

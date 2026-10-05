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


# CHRONOLOGY C1 — Semantic Event Domain Model

## Objective

Introduce a formal semantic event layer without significantly changing the UI.

This sprint is architectural.

Do **not** redesign the Timeline in this sprint.

Do **not** implement broad protocol support yet.

---

## Problem

FraudWatch already has:

```text
Raw RPC
  ↓
Canonical transaction
  ↓
Wallet effects
  ↓
Transaction summary/classification
  ↓
Timeline / Graph / Table
```

This works for simple transfers but becomes difficult when a single Solana transaction represents one meaningful action composed of multiple balance changes, instructions, fees, infrastructure accounts, and asset movements.

Examples include:

- NFT purchase;
- DEX swap;
- staking operation;
- lending operation;
- bridge transfer;
- liquidity operation;
- complex protocol interaction.

The investigator should not see one meaningful action fragmented into several unrelated UI records simply because multiple asset movements occurred.

---

## Target architecture

Move toward:

```text
Raw RPC
  ↓
Canonical transaction
  ↓
Balance + instruction reconstruction
  ↓
Protocol / service interpretation
  ↓
Semantic event
  ↓
Per-wallet event projections
  ↓
Relationship aggregation
  ↓
Timeline / Graph / Table / Inspector
```

C1 only introduces the semantic-event layer.

---

## Required work

Create a formal semantic event model.

The exact TypeScript shape should follow the existing repository conventions rather than blindly copying this example, but it should conceptually support:

```ts
SemanticEvent {
  id
  signature
  timestamp
  slot

  category
  action

  participants
  infrastructure

  assets
  flows

  protocol
  service

  confidence
  evidence

  metadata
}
```

---

## Event identity

Transaction-backed event IDs must be deterministic.

A conceptual format could be:

```text
solana:<signature>:event:<index>
```

Do not use random IDs for derived semantic events.

Most normal transactions should initially produce one primary semantic event.

The model must still support more than one meaningful semantic event from a single signature in the future if needed.

---

## Event taxonomy

Create a limited, extensible taxonomy.

At minimum support representation for:

```text
TRANSFER
SWAP

NFT_TRADE
NFT_TRANSFER
NFT_MINT

STAKE
UNSTAKE

LENDING

BRIDGE

LIQUIDITY

ACCOUNT
APPROVAL

PROGRAM_INTERACTION

FAILED
UNKNOWN
```

Use `action` for finer meaning.

Examples:

```text
category: NFT_TRADE
action: BUY
```

```text
category: LENDING
action: BORROW
```

Avoid creating dozens of categories prematurely.

---

## Participants

Distinguish meaningful actors from infrastructure.

Potential participant roles:

```text
SENDER
RECEIVER
BUYER
SELLER
TRADER
DEPOSITOR
WITHDRAWER
BORROWER
LENDER
FEE_RECIPIENT
ROYALTY_RECIPIENT
```

Potential infrastructure roles:

```text
PROGRAM
MARKETPLACE
ROUTER
POOL
VAULT
ESCROW
BRIDGE
TOKEN_ACCOUNT
PDA
```

Do not automatically treat infrastructure addresses as normal wallet counterparties.

---

## Flows

Represent asset movements separately from the high-level event.

Example:

```text
NFT PURCHASE

Primary interpretation:
A bought NFT X from B for 42 SOL

Supporting flows:
A → B        39.4 SOL
A → Magic    0.8 SOL
A → Creator  1.8 SOL
B → A        NFT X
```

This separation is mandatory.

---

## Evidence

Every semantic interpretation must be able to record why it exists.

Possible evidence references include:

```text
balance delta
token delta
outer instruction
inner instruction
known program address
NFT trade parser
protocol registry
DAS metadata
```

Do not duplicate the full raw transaction inside each semantic event.

Reference the canonical transaction.

---

## Compatibility layer

Existing UI components currently consume transaction summaries and wallet effects.

Do not rewrite the entire application during C1.

Introduce adapters or projections where necessary so:

- Timeline still works;
- Graph still works;
- Table still works;
- existing transaction inspector behavior remains available.

C1 should introduce the domain model without destabilizing the product.

---

## Derived cache versioning

Semantic events are derived data.

Integrate them with the existing parser/reconstruction versioning philosophy.

Changes to semantic event schema or interpretation logic must not silently reuse stale derived cache data.

---

## Tests

Add tests covering:

1. deterministic event identity;
2. simple SOL send;
3. simple SOL receive;
4. SPL token transfer;
5. failed transaction;
6. program-only interaction;
7. multiple flows inside one event;
8. infrastructure separation;
9. unknown classification;
10. compatibility projection from existing transaction summaries where appropriate.

Existing tests must continue passing.

---

## Acceptance criteria

C1 is complete when:

- a formal semantic event type exists;
- canonical transactions remain unchanged as source of truth;
- semantic events can reference required evidence;
- simple existing transactions can be represented as events;
- event IDs are deterministic;
- infrastructure is separate from participants;
- UI behavior remains substantially unchanged;
- derived data has versioning;
- tests cover the new model;
- TypeScript, lint, and existing tests pass.

---

## End-of-sprint report

Report:

1. files added;
2. files changed;
3. semantic event model design;
4. compatibility decisions;
5. derived cache/versioning decisions;
6. tests added;
7. architectural concerns discovered.

Do not begin C2 automatically.

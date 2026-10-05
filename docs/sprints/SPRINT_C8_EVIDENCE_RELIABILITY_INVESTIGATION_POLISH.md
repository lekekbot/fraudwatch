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


# CHRONOLOGY C8 — Evidence, Reliability & Investigation Polish

## Objective

Harden the semantic system so it is defensible as an investigation tool.

Do not add another large feature category.

This sprint is about:

- trust;
- provenance;
- parser debugging;
- cache correctness;
- regression coverage;
- performance;
- documentation.

---

## Interpretation inspector

Provide a clear way to inspect why an event was classified.

Example:

```text
Classification
NFT PURCHASE

Interpreter
magic-eden-nft-trade@3

Confidence
HIGH

Evidence

✓ Known Magic Eden program invoked
✓ NFT ownership changed Seller → Buyer
✓ Buyer SOL decreased
✓ Seller SOL increased
✓ Marketplace fee account matched
✓ Royalty recipient matched

Warnings
None
```

Uncertain example:

```text
Classification
Possible swap

Confidence
LOW

Evidence
✓ Wallet lost token A
✓ Wallet gained token B
? Protocol unknown
? Swap instruction not decoded
```

---

## Evidence categories

The inspector should clearly distinguish:

```text
fact
verified attribution
derived interpretation
heuristic observation
user label
community label
```

These categories must not be conflated.

---

## Debug tooling

Developer/debug tooling should make it possible to compare:

```text
canonical transaction
wallet effect
semantic event
behavior observation
```

without manually searching through unrelated application state.

Useful debug output may include:

- interpreter selected;
- interpreters considered;
- protocol matches;
- confidence;
- warnings;
- evidence references;
- parser version;
- derived cache version.

---

## Parser/cache versioning

Verify that derived caches invalidate correctly when:

```text
semantic event schema changes
interpreter logic changes
protocol interpretation changes
behavior detector logic changes
```

Do not allow stale semantic classifications to survive incompatible parser changes.

---

## Regression fixtures

Add or expand recorded/synthetic fixtures around:

```text
NFT purchase
NFT sale
Magic Eden trade
Jupiter swap
plain SOL transfer
plain SPL transfer
failed transaction
unknown program
staking
bridge envelope
fund split
consolidation
shared mapped-wallet transaction
```

Use recorded mainnet fixtures where practical.

Synthetic fixtures remain useful for deterministic edge cases.

---

## Performance validation

Re-run FraudWatch target scenarios:

```text
1 wallet / ~1,000 transactions
5 wallets / ~2,000 transactions
10 wallets / ~5,000 transactions
```

Semantic reconstruction must not make the Timeline or Graph unusable.

Prefer:

- precomputation;
- cache reuse;
- indexed lookup;
- batched writes;
- memoized derived data;

over repeated interpretation during rendering.

Do not put heavy parsing logic inside:

- React render loops;
- Canvas draw loops;
- hover handlers;
- zoom handlers.

---

## Documentation

Update architecture documentation for:

```text
CanonicalTransaction
SemanticEvent
WalletEventProjection
Relationship
BehaviorObservation
```

Document the lifecycle:

```text
RAW BLOCKCHAIN ACTIVITY
        ↓
CANONICAL TRANSACTION
        ↓
SEMANTIC EVENT
        ↓
WALLET PROJECTION
        ↓
CHRONOLOGICAL STORY
        ↓
RELATIONSHIP SUMMARY
        ↓
BEHAVIOR OBSERVATION
        ↓
UNDERLYING EVIDENCE
```

---

## Product framing

At the end of this initiative, FraudWatch should not feel primarily like:

> A Solana wallet tracker with a timeline.

It should feel like:

> A local-first Solana investigation workbench that reconstructs blockchain activity into human-readable events, relationships, chronological patterns, and inspectable evidence.

The product questions should remain:

```text
Timeline:
What happened?

Graph:
Who was involved?

Relationship inspector:
How are they connected?

Event inspector:
What exactly occurred?

Evidence:
How do we know?

Behavior observations:
What noteworthy pattern occurred across time?
```

---

## Acceptance criteria

C8 is complete when:

- event interpretation is inspectable;
- evidence provenance is explicit;
- uncertainty is visible;
- cache invalidation is reliable;
- regression fixtures cover the major semantic paths;
- performance remains within existing targets;
- architecture documentation reflects the new model;
- semantic events, relationships, observations, and evidence are clearly separated.

---

## End-of-sprint report

Report:

1. evidence UI added;
2. debug tooling added;
3. parser/cache versioning changes;
4. regression fixtures added;
5. performance results;
6. documentation changes;
7. remaining reliability risks.

Do not begin unrelated future initiatives automatically.

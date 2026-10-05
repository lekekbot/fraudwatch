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


# CHRONOLOGY C2 — Interpreter Framework & Protocol Resolution

## Objective

Create the framework that turns canonical transactions into semantic events.

This sprint establishes interpretation architecture.

Do **not** try to support every Solana protocol.

Do **not** redesign the Timeline yet.

---

## Problem

FraudWatch can know:

```text
This address belongs to Jupiter.
```

That is not the same as knowing:

```text
This transaction was a Jupiter swap.
```

Protocol attribution must become an input into semantic interpretation.

---

## Interpreter pipeline

Introduce a clear interpretation pipeline:

```text
CanonicalTransaction
        ↓
Transaction context
        ↓
Candidate interpreters
        ↓
Evidence evaluation
        ↓
SemanticEvent
```

A conceptual interpreter interface might look like:

```ts
interface TransactionInterpreter {
  id: string
  version: number

  matches(context): boolean

  interpret(context): InterpretationResult
}
```

Adapt this to the repository architecture.

---

## Interpreter priority

Specific interpretation must beat generic interpretation.

Conceptually:

```text
Known marketplace NFT trade
        ↓
Known DEX swap
        ↓
Known staking operation
        ↓
Generic asset swap
        ↓
Generic transfer
        ↓
Generic program interaction
        ↓
Unknown
```

A generic transfer interpreter must not overwrite a confident higher-level interpretation.

---

## Transaction context

Build a reusable transaction context that exposes enough normalized information for interpreters without forcing each interpreter to independently recalculate the same facts.

Potential context fields:

- canonical transaction;
- wallet-relative balance effects;
- account metadata;
- signer information;
- outer instructions;
- inner instructions;
- SOL balance changes;
- SPL token balance changes;
- known protocol/address matches;
- infrastructure classification;
- NFT metadata if already available.

Avoid duplicating expensive computations across interpreters.

---

## Protocol resolver

Create one protocol-resolution layer rather than scattering registry lookups throughout the app.

It should answer:

```text
Which verified protocols participated?

Which accounts are:
programs?
vaults?
pools?
routers?
marketplaces?
bridges?
fee accounts?

What attribution is verified?
What came from a community label?
What is user-defined?
```

Verified and unverified/community attribution must remain distinguishable.

Community labels must never determine transaction meaning by themselves.

---

## Interpretation result

Interpreter output should include, where possible:

```text
matched interpreter
event category
event action
protocol
participants
infrastructure
asset flows
confidence
evidence
warnings
```

---

## Confidence

Use a small explicit confidence model.

For example:

```text
HIGH
MEDIUM
LOW
```

Do not invent fake mathematical precision.

Suggested interpretation:

### HIGH

Known program + known instruction + matching balance effects.

### MEDIUM

Strong balance pattern + known protocol, but incomplete instruction decoding.

### LOW

Heuristic balance pattern without definitive protocol/instruction evidence.

---

## Failure isolation

One interpreter failing must not make a transaction unusable.

Interpretation should degrade to:

```text
PROGRAM_INTERACTION
TRANSFER
UNKNOWN
FAILED
```

as appropriate.

Capture interpreter warnings/errors in debug information where useful.

---

## Fallback behavior

Every transaction must remain inspectable.

Unknown activity is a valid result.

Never fabricate a semantic meaning simply to avoid `UNKNOWN`.

---

## Tests

Add fixture/unit coverage for:

- verified protocol resolution;
- unknown program resolution;
- infrastructure classification;
- competing interpreters;
- priority ordering;
- interpreter failure isolation;
- confidence handling;
- generic fallback;
- community labels not producing semantic certainty;
- deterministic interpreter output.

---

## Acceptance criteria

C2 is complete when:

- one clear interpreter pipeline exists;
- protocol lookup is centralized;
- interpretation context is reusable;
- specific interpreters can override generic ones;
- unknown activity remains representable;
- attribution provenance is preserved;
- interpreter failures degrade gracefully;
- confidence is explicit;
- priority/fallback logic has tests;
- no major UI redesign has occurred.

---

## End-of-sprint report

Report:

1. interpreter architecture;
2. priority rules;
3. protocol resolver design;
4. confidence model;
5. failure isolation behavior;
6. tests added;
7. unsupported cases discovered.

Do not begin C3 automatically.

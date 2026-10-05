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


# CHRONOLOGY C6 — Behavioral Sequence Detection

## Objective

Move from understanding individual blockchain events to recognizing useful patterns across sequences of events.

This is **not fraud detection**.

It is deterministic behavioral summarization.

---

## New abstraction

Introduce a separate concept from `SemanticEvent`.

A possible name:

```text
BehaviorObservation
```

Do not overload individual semantic events with multi-event meaning.

Conceptually:

```text
SemanticEvent
= what happened in one blockchain event

BehaviorObservation
= what pattern emerged across several events
```

---

## Initial behavior types

Start with deterministic, explainable patterns.

### Rapid forwarding

Example:

```text
Received 100 SOL
then sent 95 SOL onward
within 74 seconds
```

### Fan-out / fund split

```text
100 SOL received
↓
33 SOL → B
33 SOL → C
34 SOL → D
```

### Fan-in / consolidation

```text
B → D
C → D
E → D
within a defined window
```

### Repeated counterparty

Repeated meaningful wallet interactions across time.

### Circular movement

Assets return to a previously involved wallet where evidence is sufficiently clear.

### Bridge milestone

Existing semantic bridge events may be surfaced as notable chronology milestones.

### Exchange deposit

Only when the destination has verified exchange attribution.

Do not infer exchange ownership from community labels alone.

---

## Deterministic rule output

Every behavioral observation must record why it triggered.

Example:

```text
RAPID_FORWARDING

source event: X
destination events: Y, Z

time window: 74 seconds
incoming amount: 100 SOL
outgoing amount: 95 SOL
coverage ratio: 95%
```

Do not create opaque scores.

---

## Centralized thresholds

Keep detector thresholds centralized/configurable.

Examples include:

- time window;
- minimum amount;
- minimum outgoing coverage;
- minimum branch count;
- minimum interaction count.

Do not scatter magic numbers across detectors.

---

## False-positive controls

Avoid aggressive classification for:

- routine protocol routing;
- fee movements;
- marketplace settlement;
- token-account creation;
- rent;
- known infrastructure;
- self-transfers caused by Solana account structure;
- wrapped asset mechanics;
- internal swap routing.

Behavior detection should operate primarily on meaningful semantic events, not raw instruction-level flows.

---

## Timeline representation

Behavior observations should look visually different from normal semantic events.

Example:

```text
◆ FUND SPLIT
100 SOL → 3 destinations
within 74 seconds
```

Observations may span a time range.

Do not hide or replace the underlying semantic events.

Observations are annotations over them.

---

## Evidence

Every observation must answer:

```text
Which events triggered this?
What rule matched?
What thresholds applied?
What values were calculated?
```

The inspector should allow the investigator to navigate back to the underlying semantic events.

---

## Tests

Add deterministic tests for:

- rapid forwarding;
- fund split;
- consolidation;
- repeated counterparty;
- circular movement if implemented;
- exchange deposit with verified attribution;
- false-positive suppression for protocol routing;
- false-positive suppression for fees/rent;
- threshold boundaries.

---

## Acceptance criteria

C6 is complete when FraudWatch can detect a small set of deterministic multi-event patterns with traceable evidence.

There must be:

- no fraud verdict;
- no ML risk score;
- no opaque ranking.

Every observation must be explainable from underlying semantic events.

---

## End-of-sprint report

Report:

1. behavior types implemented;
2. rule definitions;
3. thresholds;
4. false-positive safeguards;
5. timeline representation;
6. tests added;
7. patterns deliberately deferred.

Do not begin C7 automatically.

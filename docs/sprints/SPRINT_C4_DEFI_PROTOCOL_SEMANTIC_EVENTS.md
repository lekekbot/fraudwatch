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


# CHRONOLOGY C4 — DeFi & Protocol Semantic Events

## Objective

Expand semantic reconstruction beyond NFTs.

Focus on a small number of high-value, well-supported transaction patterns rather than shallow support for many protocols.

---

## Priority order

Implement semantic interpretation approximately in this order:

1. Jupiter-style swaps;
2. generic token swaps;
3. staking / liquid staking;
4. lending operations;
5. bridge-out / bridge-in envelopes;
6. liquidity operations where evidence is reliable.

Use actual repository protocol coverage to determine exact protocol-specific implementations.

---

## Swap events

A swap should answer:

```text
Who swapped?
What was spent?
What was received?
Through which protocol?
```

Example:

```text
SWAP

Wallet A
24.3 SOL → 3,561 USDC
via Jupiter
```

Supporting router/pool movements remain evidence.

Do not render each internal route hop as an independent wallet transaction.

---

## Multi-hop routing

A route involving:

```text
wallet
router
pool 1
pool 2
vault
token accounts
```

must not explode into investigation-level wallet relationships.

Internal routing should remain infrastructure-level evidence.

---

## Staking

Support semantic events such as:

```text
STAKED
25 SOL

RECEIVED
24.8 mSOL

via Marinade
```

or:

```text
UNSTAKED
```

depending on actual protocol evidence.

Do not classify liquid staking as unrelated SEND + RECEIVE actions if the evidence supports a single staking operation.

---

## Lending

Where protocol decoding is reliable, support actions such as:

```text
DEPOSIT
WITHDRAW
BORROW
REPAY
SUPPLY_COLLATERAL
REMOVE_COLLATERAL
```

Do not guess if instruction evidence is insufficient.

Unknown or partially decoded lending interactions should remain uncertain.

---

## Bridges

Do not implement full cross-chain tracing in this sprint.

Only create a Solana-side semantic bridge envelope when evidence permits.

Example:

```text
BRIDGE OUT

Wallet A
100 USDC
Solana → Ethereum
via CCTP

Message identifier: ...
```

Preserve bridge identifiers that may later support destination-chain correlation, including where available:

```text
VAA identity
CCTP nonce
order ID
request ID
message hash
GUID
```

Destination-chain search/correlation belongs to future work.

---

## Liquidity events

Only add liquidity semantics where evidence is strong enough to differentiate actions such as:

```text
ADD_LIQUIDITY
REMOVE_LIQUIDITY
```

Do not overfit generic token movement patterns into liquidity operations.

---

## Confidence and evidence

Each protocol semantic event must carry:

```text
signature
protocol
asset flows
participants
infrastructure
confidence
evidence
```

Specific protocol decoders should have higher precedence than generic pattern interpreters.

---

## Generic fallback

Unsupported protocol activity must still degrade cleanly into:

```text
TRANSFER
SWAP
PROGRAM_INTERACTION
UNKNOWN
```

depending on available evidence.

---

## Tests

Add coverage for:

- Jupiter swap;
- multi-hop Jupiter route;
- generic swap;
- staking/liquid staking;
- at least one lending operation if supported;
- bridge-out envelope if supported;
- unsupported protocol fallback;
- infrastructure suppression;
- confidence differences between specific and generic interpretation.

---

## Acceptance criteria

C4 is complete when common supported DeFi actions can become coherent semantic events such as:

```text
SWAP
STAKE
UNSTAKE
BORROW
REPAY
BRIDGE_OUT
```

instead of arbitrary transfer fragments.

Internal protocol routing must remain evidence rather than investigation-level noise.

---

## End-of-sprint report

Report:

1. protocols supported;
2. interpreters added;
3. generic vs protocol-specific behavior;
4. routing/infrastructure handling;
5. bridge metadata preserved;
6. tests/fixtures added;
7. unsupported DeFi cases.

Do not begin C5 automatically.

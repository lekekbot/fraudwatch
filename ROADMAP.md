# FraudWatch roadmap

Where FraudWatch is heading. There are no dates: items are grouped by theme and ordered by what they build on, not by when they'll ship. Known gaps in what exists today are tracked in [docs/CHRONOLOGY_OPEN_ISSUES.md](docs/CHRONOLOGY_OPEN_ISSUES.md); this document is about direction.

Every item keeps the project's principles: local-first (no FraudWatch server, your own RPC or node for every chain), no fraud verdicts or risk scores, uncertainty kept visible, and every reading traceable to on-chain evidence.

---

## 1. Investigation graph

Today a case starts from a fixed set of wallets and the graph shows everything they touched, ranked and trimmed. The investigation graph turns that around: **you build the graph as you investigate**.

- **Start from anything suspicious.** A single wallet, a transaction signature, a token, or a bridge message. The graph begins with just that.
- **Grow it step by step.** Add the wallets, services, swaps, bridges and transactions that matter, one decision at a time, instead of loading everything a wallet ever touched.
- **Suggested continuations.** FraudWatch proposes likely next steps from what's already on the graph, each with its reason and evidence. For example:
  - where most of the value went next (the largest outflows after a receipt);
  - the next hop of a rapid forwarding or the branches of a fund split;
  - the destination of a bridge, or the exchange a deposit went to;
  - counterparties shared by two wallets already on the graph;
  - the wallet that funded this one, or the first transaction that touched it.
- **You decide what stays.** Suggestions are never added on their own. Accept one and it joins the graph with its evidence; dismiss it and it stays dismissed, so the graph reflects your judgement, not an algorithm's.
- **Every addition is explained.** Each node and connection records why it's there: added by you, from which suggestion, and on what evidence. Removing something never deletes the underlying data.
- **Undo, branches and snapshots.** Step back through how the graph grew, try a branch of the investigation without losing the main line, and save named snapshots of the graph at key moments.
- **Timeline stays in step.** Whatever is on the graph is what the timeline shows, so "what happened" and "who was involved" always describe the same investigation.

This builds on today's semantic events, relationships and behaviour observations: suggestions come from the same deterministic rules, not from a model that scores wallets.

## 2. Ethereum, with bridging to and from Solana

Follow funds when they leave Solana for Ethereum, and back.

- **Ethereum as a second chain**, read from your own Ethereum RPC, with the same pipeline as Solana: canonical transactions (including internal calls and token transfers read from event logs), wallet balances before and after, semantic events, relationships and evidence.
- **Ethereum interpreters** for the activity that matters in investigations: ETH and ERC-20 transfers, NFT trades, DEX swaps (Uniswap, aggregators), lending, staking and mixers.
- **Cross-chain correlation, both directions.** FraudWatch already keeps the identifiers of Solana bridge transfers (CCTP nonces and message accounts, domains, remote recipients). With Ethereum available, a bridge-out on one chain is matched to its arrival on the other, starting with Circle CCTP and Wormhole, then deBridge, Mayan and others. A matched pair becomes one cross-chain event, with both transactions as evidence.
- **One case, several chains.** Lanes and graph nodes carry their chain; a wallet on Ethereum and one on Solana can sit in the same timeline, connected by the bridge event between them.
- **Other EVM chains** (Base, Arbitrum, Optimism, Polygon, BNB Chain…) through the same adapter, since they share Ethereum's transaction model.

## 3. Bitcoin, with bridging to the other chains

Bring Bitcoin into the same investigation, and link it to Solana, Ethereum and the EVM chains.

- **Bitcoin read from your own node or an Esplora-compatible API**, modelled on its own terms: transactions as inputs and outputs (UTXOs), not account balances.
- **Address grouping as a visible heuristic.** Common-input and change-output grouping can suggest that addresses share an owner. These are shown as heuristic observations with their evidence, never merged silently.
- **Bitcoin bridges and wrapped BTC**, in both directions: wrapped Bitcoin on Ethereum and Solana (WBTC, cbBTC, tBTC, Wormhole-wrapped BTC), and native swaps (THORChain, Chainflip). Deposits and withdrawals are matched across chains the same way as Solana–Ethereum bridges.
- **A single cross-chain story.** Funds that start on Bitcoin, wrap onto Ethereum and bridge to Solana read as one chain of linked events across three lanes.

## 4. Protocol coverage

Deepen what FraudWatch can read on Solana, prioritised by what shows up in real cases:

- Drift (deposits, withdrawals and liquidations) and its vault addresses.
- Metaplex Core NFTs, now most of Magic Eden's volume.
- More bridges with full envelopes: Wormhole, Mayan, deBridge, Allbridge, LayerZero.
- SPL stake pools (Jito, BlazeStake and others) and native staking on behalf of others.
- Liquidity adds and removes on Raydium, Orca and Meteora, only where the instruction is decoded.
- marginfi, pump.fun, Jupiter Perps and order-book DEXes.
- Interpreters that report each check they made, so the evidence checklist shows what was verified rather than inferring it from confidence.

## 5. Investigation workflow

- **Notes on events, wallets and patterns**, kept with the case, so reasoning lives next to the evidence.
- **Reports.** Export a case as a readable report (timeline, graph, relationships and the evidence behind each statement) in Markdown or PDF, for colleagues, exchanges or law enforcement.
- **Portable cases.** Export and import a whole case as a file (configuration, labels, notes and graph), still without RPC credentials, so an investigation can move between machines or people.
- **Watch mode.** Keep a case open and see new activity on its wallets as it happens, from your own RPC.
- **Saved views.** Name combinations of filters, hidden transactions and graph layout, and switch between them.

## 6. Behaviour observations

- Thresholds you can see and adjust per case, with the effect shown before you apply it.
- Patterns across several wallets: multi-hop cycles, and many case wallets consolidating into one outside address.
- Forwarding through swaps (USDC in, swapped, SOL out), using the swap's own rate.
- Likely exchange deposit addresses, detected by structure and kept separate from verified attribution.
- Runs of repeated forwarding grouped into one observation, so busy wallets stay readable.

## 7. Labels and attribution

- Growing the curated registry: protocol vaults, pools, authorities and exchange wallets, each with a stated source.
- Importing and exporting label sets (your own, or a team's), always shown with their source and never treated as verified.
- Optional third-party label sources that you choose to fetch, rather than data bundled with the app.

## 8. Reliability and scale

- A local cache of semantic events for very large cases, invalidated by the analysis version fingerprint.
- A seeded demo case, so anyone can try FraudWatch without an RPC and contributors can check UI changes.
- Broader test coverage of reconstruction, ingestion and the caches, and browser-side performance checks.
- Recorded fixtures for every supported protocol, captured with `scripts/capture-fixture.ts`.

---

## Not planned

Some things FraudWatch deliberately won't do:

- **Fraud verdicts or risk scores.** It describes activity and patterns with their evidence; deciding what they mean stays with the investigator.
- **A FraudWatch server holding your investigations.** Cases stay on your machine. Any future sharing works through files you choose to send.
- **Automatic, unbounded wallet expansion.** The investigation graph suggests; you decide what's added.

Ideas and contributions are welcome: see [CONTRIBUTING.md](CONTRIBUTING.md).

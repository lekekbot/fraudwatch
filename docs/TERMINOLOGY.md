# Terminology

Terms used across the architecture and sprint docs. When code names differ, the type or table name is given in `code`.

## Cases

- **Case** (`FraudWatchCase`): one local investigation. It holds a name, primary wallet, date range, mapped wallets, labels, tags and UI preferences. It lives in IndexedDB only; there is no server copy.
- **Case range** (`range`): the case's start/end window. Only transactions inside it are fetched for mapped wallets unless the user asks for context.
- **Recent cases:** cases in this browser, sorted by last opened (`updatedAt`).
- **Portable case state:** the case configuration that can be exported, imported or put in a `#state=` URL fragment. It never includes the RPC URL or fetched transaction data.

## Addresses

- **Address state:** how FraudWatch treats an address inside a case. There are exactly four:
  - **PRIMARY:** the wallet the case was opened for. Its full history within the case range is loaded.
  - **MAPPED:** a wallet the user explicitly promoted with "Map wallet". Its full history is loaded for its own range (`rangeMode`: `case`, `first_interaction`, or `custom`).
  - **OBSERVED:** a counterparty seen in a mapped wallet's transactions. It is shown but its history is **not** fetched.
  - **INFRASTRUCTURE:** programs, protocol vaults and system/token accounts. They are identified (often via the protocol registry) but never treated as wallets to map. Any program a loaded transaction invokes counts, even one the registry doesn't list.
- **Counterparty:** any address on the other side of a mapped wallet's transaction.
- **Shallow:** the default for counterparties. You see the transactions they share with mapped wallets and nothing else.
- **Mapping / map wallet:** the user action that turns OBSERVED into MAPPED. Addresses revealed by a newly mapped wallet stay OBSERVED; nothing expands recursively.
- **Mapped wallet config** (`MappedWalletConfig`): the stored record of a mapped wallet: address, role, where it was added from, and range mode.
- **Label / tag:** user-supplied notes on an address, stored locally per case (`AddressLabel` in the `address_labels` table). A label has one name, an optional note and a list of tags. A label's name overrides the registry label on screen only.

## Transactions

- **Transaction identity:** `(chain, signature)`. It is globally unique in the local cache.
- **Canonical transaction:** the single stored copy of a transaction. If several mapped wallets take part in it, it is still stored once.
- **Wallet effect** (`WalletTransactionEffect`): what one transaction did to one wallet: asset deltas (with before/after where known) and fee. One canonical transaction has one effect per mapped wallet involved.
- **Shared transaction / intersection:** a canonical transaction with effects on two or more mapped wallets. In the graph it is drawn once, spanning their lanes.
- **Ingestion checkpoint:** saved pagination progress for a wallet's signature history, so loading can resume without refetching.

## Asset state

- **Asset state:** a wallet's holdings (SOL + tokens) at a point in time.
- **Before / change / after:** the state immediately before a transaction, the transaction's delta, and the state immediately after.
- **Opening / closing state:** the wallet state just before the case start and at/after the case end.
- **Boundary snapshot:** an opening or closing state. It explains balances the wallet already had at the start or still holds at the end.
- **Context transaction:** a transaction outside the case range, fetched only on request ("Trace earlier origin", "Show next movement"). It is visually marked and never silently added to the range.

## RPC

- **RPC endpoint:** the user's own Solana JSON-RPC URL, and the only source of truth. It is stored locally and never goes into URLs, exports or logs.
- **Provider type:** `generic` (standard Solana JSON-RPC methods only), `enhanced` (provider-specific APIs such as parsed history), or `auto` (detect which applies).
- **RPC adapter:** the layer that hides provider differences from the mapping engine.

## Graph

- **Lane:** a horizontal row for one mapped wallet (the y-axis).
- **Chronological layout:** x = time/event order, y = wallet lane. Force-directed layout is never used for the main graph.
- **Visual aggregation:** grouping many similar events for display. It never rewrites canonical transactions.

## Protocols

- **Protocol registry:** versioned JSON (`protocols/`) mapping program IDs and addresses to protocol names, categories and roles.
- **Protocol enrichment:** attaching registry matches to addresses and transactions. It is cached locally.

## Semantic model (Chronology initiative, C1–C8)

See `ARCHITECTURE.md` → Semantic model for how these fit together.

- **Semantic event** (`SemanticEvent`): what one transaction means (a swap, an NFT purchase, a bridge out), the same for every wallet in it. Its ID is `solana:<signature>:event:<index>`.
- **Category / action:** the event's broad kind (`NFT_TRADE`, `SWAP`, `LENDING`…) and finer meaning (`BUY`, `BORROW`…).
- **Interpreter:** code that reads one kind of activity from a transaction context. They run in priority order, specific before generic, and the first reading wins.
- **Interpreter trace** (`trace`): every interpreter tried for an event and what each returned (matched, no match, failed).
- **Flow** (`SemanticFlow`): one asset movement inside an event, with a role. `spent`/`received` are the actor's own legs; `payment`, `royalty`, `marketplace_fee`, `rent`, `unidentified` and `nft` come from the NFT parser; `settlement` is routing and closures that only reconcile balances.
- **Participant:** a meaningful actor in an event (buyer, seller, sender, trader…). Never infrastructure.
- **Infrastructure:** programs, token accounts, pools, vaults, escrows, fee accounts and authorities an event went through. Never shown as a wallet counterparty.
- **Confidence:** HIGH (decoded instruction matching the balances), MEDIUM (known protocol plus a balance pattern), LOW (a pattern only, or nothing recognisable). Never a number.
- **Wallet projection** (`EventProjection`): one wallet's view of an event: its roles, its own action (buyer BUY, seller SELL) and its flows.
- **Relationship** (`GraphEdge`, `RelationshipSummary`): all events between two addresses aggregated into one graph connection, with per-direction statistics and event composition.
- **Behaviour observation** (`BehaviorObservation`): a deterministic pattern across a wallet's events (rapid forwarding, fund split, consolidation, repeated counterparty, circular movement, bridge milestone, exchange deposit). It records its rule, thresholds, values and triggering events. Not a verdict or a score.
- **Evidence reference** (`EvidenceRef`): a pointer from an event into its canonical transaction or a lookup that supports the reading.
- **Evidence categories:** fact, verified attribution, derived interpretation, heuristic observation, user label, community label. Kept apart in the inspector; labels are shown but never used to interpret.
- **Bridge envelope** (`BridgeEnvelope`): the Solana side of a cross-chain transfer, with the identifiers (nonce, message account, domains) that could find the other side.
- **Analysis versions** (`analysisVersions`): parser, reconstruction, semantic model, each interpreter, registry and behaviour rule versions, reported together; the stored caches clear when theirs change.

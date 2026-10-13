# Chronology & Semantic Events: Open Issues (C1–C8)

Everything left unresolved, deferred, approximated or only partly verified across Sprints C1–C8. First written after C7, then updated at the end of C8: items C8 resolved are marked **Resolved in C8**, and C8's own remaining risks are in section 12.

Each entry gives:

- **Origin**: the sprint where it came up.
- **Today**: what actually happens now.
- **Where**: the code that owns it.
- **Why it matters**: the investigative or correctness impact.
- **Next step**: the smallest change that would resolve it.
- **Priority**: High (wrong or misleading output an investigator could act on), Medium (incomplete or noisy, but honest), Low (polish, coverage, maintenance).

Nothing here is a known crash or data-loss bug. Every item either shows less than it could, or shows something correct but imprecise. The model's rules (stay uncertain, never guess, keep everything traceable) hold throughout.

**2026-10-13 high-priority pass:** Sections 1.1, 1.6, and 5.1 below describe the original findings. Drift spot deposits/withdrawals now use decoded account roles, and the vault is infrastructure; this is covered by a synthetic withdrawal test, but still needs a real case fixture and verification of `AVzP…QK49`. Metaplex Core transfers and Magic Eden MMM Core fills now produce NFT events, verified against the existing real MMM fixture. Magic Eden `CoreExecuteSaleV2` still needs a fixture and decoder. The registry now names Drift spot vault 0 and MMM; other case-specific pools, reserves, and custody accounts remain open under 5.1.

---

## Contents

1. [Interpretation gaps: protocols with no decoder](#1-interpretation-gaps-protocols-with-no-decoder)
2. [Decoders that are partial or only lightly verified](#2-decoders-that-are-partial-or-only-lightly-verified)
3. [NFT reconstruction limits](#3-nft-reconstruction-limits)
4. [Flow and amount accounting](#4-flow-and-amount-accounting)
5. [Protocol registry and attribution](#5-protocol-registry-and-attribution)
6. [Architecture: logic not yet on the semantic model](#6-architecture-logic-not-yet-on-the-semantic-model)
7. [Event identity, caching and versioning](#7-event-identity-caching-and-versioning)
8. [Timeline (C5) gaps](#8-timeline-c5-gaps)
9. [Behaviour observations (C6) gaps](#9-behaviour-observations-c6-gaps)
10. [Graph (C7) gaps](#10-graph-c7-gaps)
11. [Tests, fixtures and reproducibility](#11-tests-fixtures-and-reproducibility)
12. [Remaining reliability risks after C8](#12-remaining-reliability-risks-after-c8)
13. [Suggested order of work](#13-suggested-order-of-work)

---

## 1. Interpretation gaps: protocols with no decoder

These protocols are in the registry (so they're named and attributed), but nothing decodes their instructions. Their transactions fall through to the generic interpreters (`generic-swap`, `generic-transfer`, `generic-program`, `unknown`) at LOW confidence, or get mislabelled by the per-wallet summary they're built from.

### 1.1 Drift withdrawals read as "Burn", with the vault as a counterparty — High
- **Origin:** found in C7 browser testing on the "Drift hacker" case.
- **Today:** money pulled out of Drift reached the hacker in transactions read as `BURN`. An unregistered address `AVzP…QK49` shows as a counterparty that sent 48.9M USDC, 3,357 WETH and 319 WBTC. It's almost certainly a Drift vault or its authority. The `BURN` category comes from the fee payer's summary (`summarize.ts`), which finds a token `burn` instruction somewhere in the transaction. Drift burns its own receipt or position tokens during a withdrawal.
- **Where:** `src/lib/state/summarize.ts` (`burnInstruction`, `kind: "BURN"`); `src/lib/semantic/interpreters.ts` (`token-instruction` maps `BURN` straight through); no Drift interpreter in `src/lib/semantic/defi.ts`.
- **Why it matters:** this is the central event of the case, and it reads as a burn with an anonymous sender instead of "withdrew X from Drift". The graph draws `AVzP…` as an ordinary wallet.
- **Next step:**
  1. Add a `drift` interpreter keyed on Drift v2 (`dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH`) Anchor discriminators: `withdraw`, `deposit`, `transfer_deposit`, plus liquidation instructions. Read the actor and vault from decoded accounts, as `jupiter-swap` does.
  2. Add Drift's vault, authority and signer PDAs to `protocols/solana.json` (roles `vault`/`authority`), so they become infrastructure.
  3. Capture a real withdrawal fixture from this case.

### 1.2 Wormhole, Mayan, deBridge, Allbridge, LayerZero and other bridges — Medium
- **Origin:** C4.
- **Today:** only Circle CCTP produces a `BRIDGE` event with an envelope. Twelve other bridge protocols are in the registry (category `bridge`), but their transactions read as transfers or program calls with `bridge: null`. A test pins this deliberately ("still reads a bridge program the code can't decode as plain activity, never a bridge").
- **Where:** `src/lib/semantic/defi.ts` (only `cctpBridge`).
- **Why it matters:** bridge-outs are key laundering milestones, and C6's `BRIDGE_MILESTONE` only fires for CCTP.
- **Next step:**
  - Start with Wormhole Token Bridge `transfer_tokens` / `transfer_wrapped`. The VAA identity is emitter + sequence. The sequence is in the Core Bridge `post_message` log ("Sequence: N"), and the emitter is a known PDA.
  - Then Mayan (`swift`/`wh` routes) and deBridge DLN `create_order` (the order ID is in the instruction data).
  - Each needs a captured fixture.

### 1.3 SPL stake pools (Jito, BlazeStake, etc.) and native stake on behalf of others — Medium
- **Origin:** C4.
- **Today:** only Marinade is decoded as liquid staking. SPL stake-pool deposits and withdrawals read as swaps (SOL out, LST in) at LOW confidence, or as program calls. The SPL Stake Pool program (`SPoo1Ku8WFXoNDMHPsrGSTSG1Y47rzgn41SLUNakuHy`) isn't in the registry, and its instructions aren't Anchor (they use a one-byte tag).
- **Where:** `src/lib/semantic/defi.ts`; `protocols/solana.json`.
- **Next step:** a `stake-pool` interpreter on the one-byte instruction tag (`DepositSol`, `WithdrawSol`, `DepositStake`, `WithdrawStake`), plus pool addresses in the registry.

### 1.4 Liquidity add/remove — Medium
- **Origin:** C4, deferred on purpose. The sprint says not to overfit.
- **Today:** no `LIQUIDITY` events are ever produced. Raydium, Orca and Meteora LP deposits and withdrawals read as swaps (two assets out, LP token in) or program calls.
- **Next step:** decode `deposit`/`withdraw` style instructions per AMM (Raydium CPMM/CLMM, Orca Whirlpool `increase_liquidity`/`decrease_liquidity`, Meteora DLMM `add_liquidity`/`remove_liquidity`). Only emit `LIQUIDITY` when the instruction is decoded.

### 1.5 Perps, other lending, launchpads, DEX order books — Low
- **Origin:** C4.
- **Today:** Drift (beyond 1.1), Jupiter Perps, marginfi, Save, Jupiter Lend, pump.fun, Phoenix and OpenBook all fall to generic readings. Kamino is the only lending decoder.
- **Next step:** add as cases demand. marginfi and pump.fun are the most common in fraud cases.

### 1.6 Metaplex Core NFTs (most of Magic Eden's current volume) — High
- **Origin:** C3.
- **Today:** Core assets have no SPL token balances, so the NFT parser can't see them. A Core sale reads as a LOW-confidence `TRANSFER` with `nft: null` (pinned by test). While capturing fixtures, 81 of the 100 most recent Magic Eden v2 transactions were Core listings (`CoreSell`).
- **Where:** `src/lib/state/summarize.ts` (`nftTrade` only reads token balances and Bubblegum moves); `src/lib/semantic/nft.ts`.
- **Why it matters:** modern NFT scams increasingly use Core collections. Those trades show up as anonymous SOL movements.
- **Next step:** decode Metaplex Core (`CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d`) `transfer_v1` and the marketplace Core instructions (`CoreExecuteSaleV2`, MMM `SolMplCoreFulfillBuy`/`Sell`) into `CnftMove`-style moves. The NFT reading already handles moves without balances, so this mostly needs a decoder.

---

## 2. Decoders that are partial or only lightly verified

### 2.1 Kamino: borrow and withdraw have no simple fixture — Medium
- **Origin:** C4.
- **Today:** `DEPOSIT` and `REPAY` are tested on real single-action transactions. `BORROW` and `WITHDRAW` were only seen inside a leveraged loop (deposit + borrow + Manifest swap) and a CPI'd repay + withdraw. About 450 recent Kamino transactions had no simple borrow or withdraw. Their discriminators were checked against real data; the single-action readings weren't.
- **Next step:** capture one standalone `borrow_obligation_liquidity_v2` and one `withdraw_obligation_collateral_and_redeem_reserve_collateral_v2`, and add tests.

### 2.2 Kamino: actor is "first signer whose balances moved" — Medium
- **Origin:** C4.
- **Today:** Kamino's v2 instructions don't put the owner at account 0 (the captured repay had a non-signer there). So `kaminoLending` uses `movingSigner`: the first signer with any balance change, else the fee payer. A relayer that pays rent would be picked as the actor.
- **Where:** `src/lib/semantic/defi.ts` (`movingSigner`).
- **Next step:** read the owner from the decoded account layout per instruction (klend IDL account order), as Jupiter does with `user_transfer_authority`.

### 2.3 Kamino: several actions in one transaction are joined — Low
- **Origin:** C4.
- **Today:** a leveraged loop reads as one event, `LENDING/BORROW+DEPOSIT`, at MEDIUM with a warning. The model supports several events per signature (`id` ends `:event:<index>`), but the pipeline always returns one.
- **Next step:** let an interpreter return several readings. That touches `interpretTransaction`, timeline items (one item per signature today) and bookmarks (see 7.2).

### 2.4 Kamino called from inside another program is generic — Low
- **Origin:** C4.
- **Today:** only top-level KLend instructions are read as lending. A vault or strategy program that calls Kamino reads as that program's call. This is deliberate (it's the outer program's action), but the lending detail is lost.
- **Next step:** attach a nested-lending note or warning to the outer event, rather than creating a second event.

### 2.5 Jupiter `*_v2` routes and unverified Marinade layouts — Medium
- **Origin:** C4.
- **Today:**
  - **Jupiter:** only `route`, `shared_accounts_route`, `exact_out_route` and `shared_accounts_exact_out_route` are decoded. The `*_v2` variants (`route_v2` etc.) aren't, because their account layout wasn't confirmed, so v2 routes fall to `known-dex-swap` (MEDIUM, fee payer as trader).
  - **Marinade:** `deposit_stake_account`, `order_unstake` and `claim` are decoded, but their actor index wasn't verified on mainnet, so they use the fee payer.
- **Next step:** capture one of each and set the authority/actor index.

### 2.6 Marketplace instructions aren't decoded, so NFT trades cap at MEDIUM — Low
- **Origin:** C2/C3.
- **Today:** `marketplace-nft-trade` needs a verified marketplace program plus the NFT parser's balance pattern. Without the instruction decoded, it's MEDIUM by the confidence model.
- **Next step:** decode Magic Eden v2 `execute_sale_v2`, Tensor `buy_single_listing`/`take_bid` and the cNFT marketplaces, with buyer and seller from accounts. This would also fix 3.3 (accepted bids) and 3.2 (price) exactly.

### 2.7 CCTP details — Low
- **Origin:** C4.
- **Today:**
  - **Unknown domains:** domain names stop at 14 (Worldchain). Domain 27 was seen on mainnet and shows as `cctp-domain-27`.
  - **v2 bridge-out:** no nonce at burn time (Circle assigns it at attestation). Correlation has to go through the message account and Circle's attestation API.
  - **Hook data:** `deposit_for_burn_with_hook` is decoded, but its hook data isn't kept. (C8 added its fixture, `fixtures/solana/defi/cctp-v2-burn-with-hook.json`, now pinned in the regression table.)
  - **v1 bridge-in:** v1 `receive_message` is decoded but untested; only a v2 bridge-in fixture exists.
- **Where:** `src/lib/semantic/defi.ts` (`CCTP_DOMAINS`, `cctpOut`, `cctpIn`).
- **Next step:** extend the domain table from Circle's current list, add a with-hook and a v1 receive fixture, and keep a short hook-data hash in `identifiers`.

### 2.8 Generic transfer confidence is conservative — Low
- **Origin:** C2.
- **Today:** `generic-transfer` is HIGH only when every top-level instruction is a plain system, token, ATA, compute or memo program. Any other program in the transaction drops a real transfer to LOW. That's intentional (the other program may have been doing more), but it covers many legitimate wallets (Phantom/Backpack memo, priority-fee programs, Lighthouse guards).
- **Next step:** keep an allowlist of known passive wrappers (Lighthouse, wallet guard programs) that don't change a transfer's meaning.

---

## 3. NFT reconstruction limits

### 3.1 Royalties are judged against today's metadata — Medium
- **Origin:** C3, seen on the real Magic Eden sale.
- **Today:** royalty recipients come from the NFT's current Metaplex creators. The 2022 Magic Eden fixture paid four creators who were changed later, so those payouts read as `unidentified`, not `royalty`.
- **Where:** `src/hooks/use-wallet-states.ts` (fetches current metadata); `summarize.ts` (`royaltyRecipients`).
- **Why it matters:** this is honest (it doesn't claim a royalty it can't verify), but it understates royalties on older sales.
- **Next step:** read the creators as they were at the sale. Either take historical metadata from the account state at that slot (needs an archive RPC), or, when the transaction updates or reads the metadata account, decode it from the transaction itself.

### 3.2 Price includes rent, and "payment" can exceed "price" — Medium
- **Origin:** C3.
- **Today:**
  - **Price includes rent:** `NftDetail.price` is the buyer's net outlay in the payment asset, fee excluded. That includes rent for accounts the purchase opened (the buyer's new ATA, about 0.002 SOL), matching what the existing parser and UI already showed.
  - **Payment can exceed price:** the `payment` flow is the seller's gain, which can include an escrow rent refund. So in the inspector, payment can read higher than price: 0.08988644 vs 0.08932928 SOL on a real Magic Eden purchase in the "NFT scammer" case.
- **Where:** `src/lib/semantic/nft.ts` (`spent`, `payment` flow).
- **Why it matters:** cosmetic, but an investigator comparing the two numbers may be confused.
- **Next step:** subtract the rent flows the parser already identifies (role `rent`) from the price. Split the seller's gain into payment plus refund when an escrow closure (a settlement flow into the seller) is present. Or decode the marketplace instruction (2.6) and read the price from it directly.

### 3.3 Accepted bids are only tested synthetically — Medium
- **Origin:** C3.
- **Today:** when a seller accepts a bid paid from the bidder's escrow, the bidder is named as buyer and the escrow becomes infrastructure. This logic exists and is tested on a synthetic transaction only; no real accepted-bid fixture was found (rate limits, see 11.2).
- **Next step:** capture a real Magic Eden `take_bid` / Tensor `take_bid` and confirm it.

### 3.4 Magic Eden "MEisE" marketplace transactions with ownerless token balances — Low
- **Origin:** C3.
- **Today:** a real sale on the newer `MEisE1HzehtrDpAAT8PnLHjpSSkRYakotTuJRPjTpo8` program (`5esdLb…`) had token balances with no `owner`, so the parser couldn't attribute the NFT. It wasn't kept as a fixture.
- **Next step:** resolve the token account owner from the instruction accounts, or with a follow-up `getAccountInfo`, when `owner` is missing.

### 3.5 NFT reading picks one side — Low
- **Origin:** C3.
- **Today:** the NFT reading comes from the fee payer, else the first NFT recipient, else the first sender (`TransactionContext.nft`). A transaction with two independent NFT moves (a bundle with different counterparties, or a relayer moving several users' NFTs) reads only the first side.
- **Where:** `src/lib/semantic/interpret.ts` (`buildContext`).
- **Next step:** comes with multi-event support (2.3 / 7.2).

### 3.6 Royalty paid to a mapped wallet stays grouped — Low
- **Origin:** C7.
- **Today:** in the graph, royalty, fee, rent and unidentified legs always group under the trade's buyer–seller line. If the royalty recipient is itself a mapped wallet, it gets no line of its own. The old per-wallet path used to break out mapped recipients.
- **Where:** `src/lib/graph/build.ts` (`fromEvent`, `GROUPED`).
- **Next step:** in `fromEvent`, draw grouped legs as normal movements when the other side is mapped.

---

## 4. Flow and amount accounting

### 4.1 "Spent" includes rent — Low
- **Origin:** C4.
- **Today:** an actor's `spent` flows are their summary's outflows, which include rent for accounts the action created. For example, a Kamino supply shows "spent 0.00148844 SOL" next to the 100 USDC, and the 2.6M USDC transfer card's wallet section includes rent. This matches the existing summary, but it makes some swaps look multi-asset.
- **Where:** `src/lib/semantic/reading.ts` (`actorFlows`).
- **Next step:** move SOL that went into newly created accounts (`pre == 0` and closed or initialised in the same transaction) into `rent` flows, and leave it out of `spent`.

### 4.2 Several senders and several receivers stay unpaired — Low (by design)
- **Origin:** C1.
- **Today:** `balanceFlows` pairs exactly with one sender or one receiver. Otherwise each side keeps a `null` other side and the event warns. That's correct (never guess), but complex transfers can have many unattributed flows.
- **Where:** `src/lib/semantic/flows.ts`.
- **Next step:** use decoded inner `transfer`/`transferChecked` instructions (exact source and destination) to pair flows before falling back to balances.

### 4.3 Settlement flows are approximate pairings — Low
- **Origin:** C3/C4.
- **Today:** settlement flows reconcile the event with observed balances (escrow refunds, pool routing). Their pairing uses the same one-to-many rule as 4.2, so on routes with many pools some settlement flows have a `null` side. They never create participants or graph lines.
- **Next step:** same as 4.2.

---

## 5. Protocol registry and attribution

### 5.1 The registry has almost no pools, vaults or authorities — High
- **Origin:** C1, still true after C7.
- **Today:** `protocols/solana.json` (v9) lists only `program`, `fee_account` and `authority` roles. The only non-program entries are Magic Eden's treasury and escrow authority (added in C3) and two fee accounts (Solflare, Hyperlane).
  - **Not infrastructure:** pool vaults, AMM authorities, lending reserves, bridge custody and escrow PDAs are never classed as infrastructure by the resolver.
  - **Partial mitigation:** C3–C7 work around this structurally. Settlement and routing never make participants or graph lines, and NFT escrows are inferred.
  - **Remaining gap:** a protocol account that does sit in a meaningful flow (a Drift vault, see 1.1; a CEX hot wallet missing from `centralized-vaults.json`) still shows as a counterparty.
- **Next step:** add vault, authority and reserve addresses for the protocols in real cases (Drift, Kamino reserves, Raydium/Orca/Meteora pool authorities, Wormhole custody). Each needs a source per the `protocols/sources` README.

### 5.2 Exchange coverage depends on `centralized-vaults.json` — Medium
- **Origin:** C6.
- **Today:** `EXCHANGE_DEPOSIT` only fires for registry entries in category `exchange`. Deposit addresses (per-user, swept to hot wallets) are almost never in the registry. Most real exchange deposits are therefore invisible: only direct transfers to listed hot wallets count. This is correct by the sprint's rule (no inference from community labels), but recall is low.
- **Next step:** detect deposit addresses by structure. An address that receives from the case, then sweeps everything to a verified exchange hot wallet within a short window, can be labelled as a likely deposit address, kept separate from verified attribution.

### 5.4 Community label data has no stated licence — Medium (blocks a public release)
- **Origin:** open-source prep.
- **Today:** `protocols/community-labels.json` is built from a snapshot of the tribixbite solana-programs gist, which states no licence. Its third-party "hacker" attributions were removed from the snapshot (they were never imported).
- **Next step:** confirm with the gist's author that redistributing the address–name pairs is fine. If not, remove the snapshot and the generated labels, and ship only `scripts/import-community-labels.ts` for users to run themselves.

### 5.3 Two Magic Eden addresses were added from public labels plus observation — Low
- **Origin:** C3.
- **Today:** `rFqFJ9g7TGBD8Ed7TPDnvGKZ5pWLPDyxLcvcH2eRCtt` (treasury, `fee_account`) and `1BWutmTvYPwDtmw9abTkS4Ssr8no61spGAvW1X6NDix` (v2 escrow authority, `authority`) were added because Solscan labels them and the captured sale behaves that way. They're treated as verified registry entries.
- **Next step:** record a source for them under `protocols/sources` so the registry's provenance stays auditable.

---

## 6. Architecture: logic not yet on the semantic model

### 6.1 The NFT parser still reads the registry directly — Low
- **Origin:** C2.
- **Today:** `summarize.ts` calls `registry.lookup` itself to find the marketplace and fee accounts (lines 247 and 260), bypassing `resolveProtocols`. A custom registry passed to `interpretTransaction` therefore doesn't affect the NFT reading. In the app both are the same bundled registry, so results agree.
- **Next step:** pass a lookup function (or the resolution) into `summarizeEffect`. It's also used by the UI's per-wallet path, so change both callers.

### 6.2 UI code still calls the registry directly — Low
- **Origin:** C2.
- **Today:** these still call the registry directly instead of going through the resolver:
  - `case-shell.tsx`: protocol ids for filters (`protocolsUsed(enrichTransaction(tx))`), names, search keywords and the address panel;
  - `transaction-details.tsx`: the "Protocol" row and the unknown programs list;
  - `entity-panel.tsx`;
  - `graph/build.ts`: entity collapsing and program-edge filtering.

  The functions are the same, so results agree, but "protocol lookup is centralized" only holds for interpretation.
- **Next step:**
  - Filter protocols: read from `SemanticEvent` (protocol, service, KNOWN_ADDRESS evidence) instead.
  - Transaction details: drop the "Protocol" row in favour of the event's.
  - Display-name lookups: these can stay in `labels.ts`; display isn't interpretation.

### 6.3 Interpreters can't override participants — Low
- **Origin:** C2.
- **Today:** participants are always derived from flows plus category (`participantsOf`). C3/C4 added `actor`, `nft` buyer/seller and supporting-flow rules, which covers current needs. A future interpreter that knows roles directly (a lending liquidator and liquidatee, a bridge relayer) can't set them.
- **Next step:** add an optional `participants` to `Interpretation`, used in place of the derived ones.

### 6.4 Several timeline and inspector pieces still use the per-wallet summary — Low
- **Origin:** C5.
- **Today:** per-wallet summaries still drive:
  - Program, Burn, Approval and Account cards (`event-card.ts`, `describeAction(summary.action…)`);
  - the inspector's "Action" row (`transaction-details.tsx`);
  - the wallet table (`wallet-state-view.tsx`);
  - the Relationships chart (`relationship-chart.tsx`, `lib/timeline/relationships.ts`);
  - the counterparty list (`lib/state/counterparties.ts`);
  - "Wallet effect" filters, look-alike verdicts and SNS candidates.

  Swaps, NFTs, DeFi and bridges read correctly in the cards, but these surfaces can disagree in wording with the event. For example, the table may say "Swap" for what the timeline calls "Liquid stake".
- **Next step:** move the table's type column and the relationships chart onto events first (most visible), then the counterparty list.

### 6.5 Program-call graph connections use the summary — Low
- **Origin:** C7.
- **Today:** "Program call" connections come from `summary.action.programId`, not `event.protocol`. A Jupiter swap therefore links the wallet to the Jupiter program, but a decoded Kamino deposit links to whichever instruction the summary picked.
- **Where:** `src/lib/graph/build.ts` (program edge in the per-effect loop).
- **Next step:** when an event has a `protocol`, link to the protocol's entity node; fall back to the summary's program otherwise.

---

## 7. Event identity, caching and versioning

### 7.1 Semantic events are never stored — Low (C8 added the version fingerprint a cache would need)
- **Origin:** C1.
- **Today:** events are worked out in memory (`case-shell.tsx`, `semanticEvents` memo) every time a case opens, and again when NFT metadata arrives. That's about 0.08 ms per transaction, so about 0.6 s for 7,842 transactions. `SEMANTIC_VERSION` (now 4) and each interpreter's `version` are stamped on events. No IndexedDB table holds events, so nothing in `DERIVED_CACHES` invalidates them (the comment in `src/lib/db/derived.ts` says a table must register there).
- **Why it matters:** fine at today's case sizes. Very large cases (50k+ transactions) would spend a few seconds on each open and each metadata update.
- **Next step:** if needed, cache events keyed by signature plus `analysisFingerprint()` (C8, `src/lib/semantic/versions.ts`: parser, reconstruction, semantic, each interpreter, registry and behaviour versions) plus an NFT-metadata fingerprint, and register the table in `DERIVED_CACHES`. C8's tests (`src/lib/db/derived.test.ts`) lock in that nothing semantic is stored today.

### 7.2 One event per transaction is baked into the UI — Medium
- **Origin:** C1/C5.
- **Today:** `interpretTransaction` returns an array, and IDs carry an index. But the timeline has one item per signature, selection and bookmarks are keyed by signature, and the graph takes `events[i]` per effect. Several events per signature (2.3, 3.5) would need:
  - timeline items keyed by event ID;
  - bookmark targets carrying the event index (with a migration from signature-only bookmarks);
  - graph interactions per event.
- **Next step:** only when a decoder actually needs it. Migrate bookmarks by mapping an old signature to that signature's `:event:0`.

### 7.3 Events change once NFT metadata loads — Low
- **Origin:** C1/C5.
- **Today:** on first open, NFT checks aren't known yet, so trades briefly read as transfers or swaps. When metadata arrives, every event is re-interpreted and the cards change. Harmless, but visible on slow RPCs.
- **Next step:** show a "reading NFTs…" state, or wait to first render until known-metadata lookups finish (they're local IndexedDB reads).

---

## 8. Timeline (C5) gaps

### 8.1 Unpriced and generic cards keep the old wording — Low
- **Origin:** C5.
- **Today:** program calls read "Token Program · …" from the summary's action, and "by X" when someone else signed. These are accurate but less informative than the event's protocol and action. See 6.4.

### 8.2 Card text is fixed to four lines and truncated — Low
- **Origin:** C5.
- **Today:** long amounts ("5,992,368.014144 USDC") and long protocol names ("→ Ethereum · Circle CCTP") are cut off on 150 px cards.
- **Next step:** use the protocol's short name on cards (e.g. "CCTP"); compact large amounts (5.99M USDC) on cards only.

### 8.3 Event filters aren't saved — Low
- **Origin:** C5.
- **Today:** like every filter, "Event" categories and "Hide low-confidence readings" are in-memory and reset when the case reopens.
- **Next step:** save the filter per case, if investigators ask.

---

## 9. Behaviour observations (C6) gaps

### 9.1 High volume on busy wallets — Medium
- **Origin:** C6, seen on the "NFT scammer" case.
- **Today:** 689 observations, mostly 337 small-value rapid forwardings and 188 consolidations. They're real patterns (0.0999 SOL in, 0.1 out within 37 s), but too many to review. The SOL dust floor is fixed at 0.01 SOL, and thresholds can only be changed in code (`BEHAVIOR_THRESHOLDS`).
- **Next step:**
  - Show thresholds in the UI (read-only first, then editable per case).
  - Add a per-type toggle beside the ◆ button.
  - Merge repeated forwardings through the same wallet within a window into a single run (as exchange deposits already are).

### 9.2 The same pattern appears once per mapped wallet — Low
- **Origin:** C6/C7.
- **Today:** detection runs per mapped wallet. When two mapped wallets transact with each other, "Repeated counterparty" fires on both sides. The C7 connection inspector lists both: "13 transfers with 8ubo4…" and "13 transfers with HkGz…".
- **Where:** `src/app/case/case-shell.tsx` (`observations` memo) and the edge panel filter.
- **Next step:** de-duplicate pair-level types (repeated counterparty, circular movement) when both ends are mapped, keeping the one on the earlier lane.

### 9.3 Deferred patterns — Medium
- **Origin:** C6.
- **Today:** not implemented:
  - multi-hop cycles across several mapped wallets (A→B→C→A); only direct round trips are detected;
  - forwarding through a swap (USDC in → swapped → SOL out);
  - exchange deposits via deposit addresses (see 5.2);
  - patterns centred on an unmapped address, such as many case wallets consolidating into the same outside wallet.
- **Next step:**
  - Cross-wallet cycles need a case-level pass over all wallets' moves.
  - Swap-forwarding needs value comparison across assets (prices or the swap's own rate).

### 9.4 Rapid forwarding is greedy and per asset — Low
- **Origin:** C6.
- **Today:** onward sends are matched chronologically to the earliest receipt in the window, each send used once, same asset only, capped at 125%. Interleaved receipts and sends can be attributed to the wrong receipt. That's acceptable for a summary, but each observation's "source" is one plausible pairing, not proof.
- **Next step:** say so in the observation inspector ("paired in time order"), or use FIFO lot matching.

### 9.5 Observations don't feed back into events — Resolved in C8 (partly)
- **Origin:** C6 (by design).
- **Now:** the event inspector's "Why FraudWatch reads it this way" lists each observation the event is part of, as a heuristic statement ("Part of a behaviour observation: ◆ Fund split: …"), and Developer details shows them as JSON.
- **Still open:** those statements aren't links; opening the observation itself still goes through the timeline marker.

---

## 10. Graph (C7) gaps

### 10.1 Faint low-value lines make nodes look disconnected — Low
- **Origin:** C7 browser testing (rendering predates C7).
- **Today:** line opacity and width scale with value share, so low-value connections almost disappear. Several nodes on the "Drift hacker" map looked isolated until selected.
- **Where:** `src/app/case/graph/wallet-graph.tsx` (edge drawing via `flowShares`).
- **Next step:** set a minimum visible opacity and width for any drawn connection.

### 10.2 Ranking reasons can under-report — Low
- **Origin:** C7.
- **Today:** reasons list the factors a node meets in the top-N lists (events top 10, value top 5, behaviour top 5, incoming, outgoing and recent top 5). A shared counterparty often shows only "dealt with 2 mapped wallets", even when it also ranks high on value, if it falls just outside a top-N cut.
- **Next step:** show the node's actual figures (events, value share, observations) alongside its reasons.

### 10.3 Behaviour only counts for addresses that appear as counterparties — Low
- **Origin:** C7.
- **Today:** `observedAddresses` counts an address when it's an observation's counterparty or deposit address. Observations about a mapped wallet itself don't lift its counterparties, and patterns across unmapped addresses aren't detected at all (9.3).

### 10.4 "Show in graph" narrows the graph via the shared filter — Low
- **Origin:** C7.
- **Today:** "Show in graph" sets the case-wide relationship filter to one signature. So the timeline and table are narrowed too until the chip is cleared, which is consistent with "filters apply the same way everywhere" but can surprise.
- **Next step:** clearer chip wording, or a graph-only focus that doesn't touch the shared filter.

---

## 11. Tests, fixtures and reproducibility

### 11.1 Only the new code is tested — Medium
- **Origin:** C1 (vitest restored for sprint tests after commit `665e55c` removed the whole suite).
- **Today:** 121 tests (after C8) cover the semantic model, interpreters, NFT and DeFi readings, timeline cards, behaviour detectors, graph building, event explanations, cache invalidation, a pinned regression table over every recorded fixture, and performance at the target scales. The pre-existing modules (reconstruction, ingestion, IndexedDB caches, hiding rules, layout, search, labels) have no tests since the suite was removed. `summarize.ts`'s per-wallet NFT reading is covered only indirectly, plus one "unchanged behaviour" test.
- **Next step:** decide whether to restore the old suite (it's recoverable from `665e55c^`), or add tests per module as each is touched.

### 11.2 Fixture capture isn't reproducible from the repo — Resolved (script committed)
- **Origin:** C3/C4.
- **Now:** `scripts/capture-fixture.ts` records transactions by signature, or by searching a program's recent transactions for Anchor instruction names. It retries with backoff, logs every failed fetch, and reports what's missing. The early fixtures were captured with throwaway scripts against the rate-limited public RPC, so some searches may have missed matches.
- **Still open:** fill the gaps in 11.3 by running it against a non-rate-limited RPC.

### 11.3 Fixture gaps — Medium
No real fixture yet for:
- a Metaplex Core sale with a decoder to test it (1.6), beyond the one "stays a transfer" fixture;
- an accepted bid (3.3);
- a standalone Kamino borrow or withdraw (2.1);
- Jupiter v2 routes (2.5);
- Marinade `order_unstake` / `claim` (2.5);
- CCTP v1 bridge-in (2.7); v2 with hook was added in C8;
- a Drift withdrawal (1.1), available in the "Drift hacker" case;
- any non-CCTP bridge (1.2), stake pool (1.3) or liquidity action (1.4).

### 11.4 Browser verification depends on local cases — Low
- **Origin:** C5–C7.
- **Today:** UI changes were checked in Chrome against the "NFT scammer" and "Drift hacker" cases in your local IndexedDB. Those aren't reproducible elsewhere, and there are no automated UI tests.
- **Next step:** add a small seeded demo case (fixture transactions loaded straight into IndexedDB), so UI behaviour can be checked without a live RPC.

---

## 12. Remaining reliability risks after C8

### 12.1 Explanations are worded by rule, not proved — Medium
- **Origin:** C8.
- **Today:** `explainEvent` builds its checklist from the event's confidence, protocol, flows and evidence. "A known program's instruction was decoded and matches the balance changes" is inferred from confidence HIGH. It isn't a per-check result recorded by the interpreter. If an interpreter assigns HIGH wrongly, the explanation repeats it.
- **Where:** `src/lib/semantic/explain.ts`.
- **Next step:** have interpreters return their own checks (each condition and whether it held), and render those instead of inferring them.

### 12.2 Performance was measured in Node, with mostly synthetic transactions — Low
- **Origin:** C8.
- **Today:** `performance.test.ts` times reconstruction, interpretation, behaviour and graph building at the three target scales: 48 ms, 62 ms and 146 ms. Four in five transactions are cheap synthetic transfers, so real cases run roughly 2–4× slower; real transactions cost about 0.08 ms each (measured in C5). Browser rendering (canvas, React) isn't covered; it was checked by hand on the 7,842-transaction case.
- **Next step:** a browser-side timing mark around the workspace's semantic memo, plus a seeded large demo case (11.4).

### 12.3 The debug bundle includes the full canonical transaction — Low
- **Origin:** C8.
- **Today:** "Copy debug bundle" copies the canonical transaction, wallet effect, event and observations. It holds no RPC URL and no labels, but it does name the case's wallets, since they're in the transaction. Sharing a bundle shares which wallets are under investigation.
- **Next step:** offer a redacted bundle that replaces non-registry addresses with stable placeholders.

### 12.4 The regression table pins today's readings, including known gaps — Low
- **Origin:** C8.
- **Today:** the pinned table includes readings known to be incomplete: the Core sale as a LOW transfer, the Kamino CPI as a generic program call, the leveraged Kamino loop as MEDIUM. Fixing those gaps will (correctly) fail these rows.
- **Next step:** update the row in the same change as the decoder that fixes it. The table's header comment says so.

### 12.5 The explanation names the signer's action, not the lane's — Low
- **Origin:** C8 browser check.
- **Today:** an event's `action` is written from the side of whoever sent it. On the receiver's lane the card correctly says "Receive", but the explanation reads "Read as TRANSFER · SEND by the generic-transfer interpreter". It's accurate for the event, but it reads as a contradiction next to the card.
- **Where:** `src/lib/semantic/explain.ts` (first derived statement); `src/app/case/timeline/event-details.tsx`.
- **Next step:** pass the lane's projection into `explainEvent` and say both, e.g. "Read as TRANSFER · SEND (this wallet: RECEIVE)".

### 12.6 Registry matches include core programs — Low
- **Origin:** C8.
- **Today:** Developer details lists every registry match, including core programs (System, Token, ATA). They're correct but noisy next to the protocol matches that matter.
- **Next step:** list non-core matches first, and fold core ones under a count.

---

## 13. Suggested order of work

1. **Drift decoder plus Drift vault registry entries** (1.1, 5.1). This fixes the central mislabelled event in the main real case.
2. **Metaplex Core decoding** (1.6). Most current Magic Eden volume is invisible today.
3. **A reproducible fixture capture script, run against a good RPC** (11.2, 11.3). This unblocks verification of 2.1, 2.5, 2.7 and 3.3.
4. **Wormhole bridge envelope** (1.2). Second most common bridge in laundering after CCTP.
5. **Behaviour noise controls** (9.1, 9.2): per-type toggles, merging forwarding runs, de-duplicating pair observations.
6. **Moving the table and relationships chart onto events** (6.4), so every view uses the same wording.
7. **Price and rent clean-up** (3.2, 4.1).
8. Everything else as cases need it.

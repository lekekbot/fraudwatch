# Solana bridge inventory

Snapshot: 2026-10-03

This inventory covers public bridge protocols with a distinct, verifiable Solana mainnet deployment. It is designed for transaction attribution in FraudWatch, not as a recommendation to use any service.

## Registry coverage

| Protocol | Coverage in `protocols/solana.json` | Primary source |
| --- | --- | --- |
| Wormhole | Core, Wrapped Token Transfer, NFT Bridge, message shim | [Wormhole contract addresses](https://wormhole.com/docs/build/reference/contract-addresses/) and [Wormhole source](https://github.com/wormhole-foundation/wormhole) |
| Circle CCTP | V1 and V2 Message Transmitter and Token Messenger programs | [Circle Solana CCTP contracts](https://github.com/circlefin/solana-cctp-contracts) |
| deBridge DLN | Source, destination, base, settings, and hook-executor programs | [deBridge Solana client example](https://docs.debridge.com/dln-details/affiliates/withdrawing-affiliate-fees) and [hook documentation](https://docs.debridge.com/dln-details/integration-guidelines/order-creation/hooks/solana-hook-data) |
| Mayan Finance | Current Mayan, Auction, MCTP, Fast MCTP, Swift, Swift v2, MPS, fee, and helper programs | [Mayan SDK address constants](https://github.com/mayan-finance/swap-sdk/blob/main/src/addresses.ts) |
| Allbridge | Core plus deprecated Classic and Classic Validator programs | [Allbridge Core SDK IDL](https://github.com/allbridge-io/allbridge-core-js-sdk/blob/main/src/services/models/sol/types/bridge.json) and [Classic contracts](https://docs.allbridge.io/allbridge-overview/bridge-contracts) |
| Across | Solana SVM SpokePool | [Across Solana migration guide](https://docs.across.to/guides/migration/solana) |
| Chainflip | Vault and Swap Endpoint | [Chainflip mainnet addresses](https://docs.chainflip.io/protocol/supported-chains-assets/mainnet-addresses) |
| Relay | Depository v2 | [Relay live chain registry](https://api.relay.link/chains) and [Relay documentation](https://docs.relay.link) |
| Chainlink CCIP | Router, Fee Quoter, token-pool implementations, RMN Remote, and OffRamp | [CCIP mainnet directory](https://docs.chain.link/ccip/directory/mainnet) and [CCIP API](https://api.ccip.chain.link/v2/chains/124615329519749607) |
| Hyperlane | Mailbox, gas paymaster, ISMs, Universal Router, and Validator Announce | [Hyperlane registry](https://github.com/hyperlane-xyz/hyperlane-registry/blob/main/chains/solanamainnet/addresses.yaml) and [canonical program IDs](https://github.com/hyperlane-xyz/hyperlane-monorepo/blob/main/rust/sealevel/environments/mainnet3/solanamainnet/core/program-ids.json) |
| LayerZero | Endpoint v2, Executor, Price Feed, ULN, blocked-message library, and default DVN | [`@layerzerolabs/lz-solana-sdk-v2`](https://www.npmjs.com/package/@layerzerolabs/lz-solana-sdk-v2) deployment manifests and [Solana overview](https://docs.layerzero.network/v2/developers/solana/technical-overview) |
| NEAR Omni Bridge | Solana bridge program | [NEAR Omni Bridge repository](https://github.com/Near-One/omni-bridge) |
| Wanchain | WanBridge, Admin Board, and fee programs | [Wanchain direct-contract documentation](https://docs.wanchain.org/developers/wanbridge-api/2.-creating-cross-chain-transactions-for-wanbridge/2.1-direct-interaction-with-on-chain-contracts) |
| Base Bridge | Bridge and Base Relayer programs | [Base Bridge deployment configuration](https://github.com/base/bridge/blob/main/scripts/src/internal/constants.ts) |
| Axelar | Gateway, Gas Service, Operators, Memo, and Interchain Token Service | [Axelar mainnet deployment registry](https://github.com/axelarnetwork/axelar-contract-deployments/blob/main/axelar-chains-config/info/mainnet.json) |

Every registry address was checked against Solana mainnet on 2026-10-03. Program entries existed and were executable. Hyperlane's `JAv...` address is intentionally classified as a fee account; its executable owner is the canonical `BhNcat...` gas-paymaster program.

## Cross-chain wallet correlation

“Direct” means one source transaction contains enough data to recover the source wallet, destination chain, and destination wallet. The decoder may still need an IDL, Borsh layout, inner instructions, or a program account lookup. “Conditional” means the protocol exposes only the destination application by default; the final user wallet depends on an application-specific payload.

| Protocol | Source transaction coverage | Extraction | Important caveat |
| --- | --- | --- | --- |
| Wormhole | Direct for Wrapped Token Transfers | Read the token owner/authority from Solana accounts, then decode `To` and `ToChain` from the WTT message payload. Join with `(emitter chain, emitter address, sequence)`. [Payload format](https://wormhole.com/docs/products/token-transfers/wrapped-token-transfers/concepts/payload-structure/) | A payload-3 transfer names a destination contract and source contract. Final beneficiary may be inside its application payload. |
| Circle CCTP | Direct | Decode the depositor/owner account plus `destinationDomain` and `mintRecipient` from `depositForBurn`. Join with CCTP nonce/message hash. [Solana contracts](https://github.com/circlefin/solana-cctp-contracts) | Do not treat fee payer as depositor when another authority signs the token transfer. |
| deBridge DLN | Direct | Decode maker, give/take chain IDs, and receiver from the create-order instruction or order state. Join fills with deterministic order ID. [Order fields](https://docs.debridge.com/dln-details/protocol-specs/deterministic-order-id) | Hooks may forward assets after the recorded receiver. |
| Mayan Finance | Direct | Decode swapper account plus `destinationChain` and `destinationAddress` from Mayan instruction data. [Solana swap layout](https://github.com/mayan-finance/swap-sdk/blob/main/src/solana/solanaSwap.ts) | Route-specific programs use different layouts; keep one decoder per Mayan program family. |
| Allbridge | Direct for Core | Decode `user` account and `BridgeArgs.recipient` plus `destination_chain_id`. [Core IDL](https://github.com/allbridge-io/allbridge-core-js-sdk/blob/main/src/services/models/sol/types/bridge.json) | Classic is deprecated and needs its older instruction layout. |
| Across | Direct | Decode depositor, recipient, destination chain ID, and deposit ID from the deposit instruction/event. [Deposit event](https://docs.across.to/introduction/tracking-deposits) | Recipient can be a contract or differ from depositor. |
| Chainflip | API/state-chain correlation | Source transaction shows sender and unique deposit-channel address. Resolve that channel or swap ID through broker/state-chain data to obtain destination chain and recipient. [Deposit-channel design](https://docs.chainflip.io/protocol/vaults/solana-vault-design) | Standard deposit transaction does not contain destination wallet. CCM or encoded vault-swap paths can carry more data. |
| Relay | API/order correlation | Extract order ID or request ID from depository data or Solana memo, then resolve the Relay request/order. Relay supports transaction-hash-to-request lookup. [Settlement flow](https://github.com/relayprotocol/relay-settlement) and [lookup behavior](https://github.com/relayprotocol/relay-mcp/blob/main/TESTING.md) | Plain transfer to a solver/depository does not reliably expose destination wallet. |
| Chainlink CCIP | Conditional | Decode source sender, destination chain selector, message ID, and `receiver` from the CCIP message. For token-only SVM delivery, decode `token_receiver`. [SVM message fields](https://docs.chain.link/ccip/v1/svm/api-reference/v1.6.0/messages) | `receiver` normally identifies a destination program/contract. Final beneficiary may live in `data` or application state. |
| Hyperlane | Conditional; direct for Warp Routes | Mailbox message contains sender, destination domain, recipient application, and body. Warp Route body adds token recipient and amount. [Mailbox dispatch](https://github.com/hyperlane-xyz/hyperlane-monorepo/blob/main/solidity/contracts/Mailbox.sol) and [Warp Route format](https://github.com/hyperlane-xyz/hyperlane-monorepo/blob/main/solidity/contracts/token/README.md) | Generic Mailbox recipient is an application, not necessarily a wallet. Decode that application's body. |
| LayerZero | Conditional; direct for OFT | OFT `SendParams` contains `dst_eid` and `to`; signer/token-source accounts identify source wallet. Join with emitted GUID. [Solana OFT send](https://github.com/LayerZero-Labs/devtools/blob/main/examples/oft-solana/programs/oft/src/instructions/send.rs) | Generic OApp sends expose destination peer application; final beneficiary is application-specific. |
| NEAR Omni Bridge | Direct | Decode source signer and `InitTransferPayload.recipient`. Omni Address prefix identifies destination chain, such as `near:` or `base:`. [SDK address format](https://github.com/Near-One/bridge-sdk-js) | Recipient is a variable-length chain-prefixed string, not always a 32-byte address. |
| Wanchain | Direct plus token-pair lookup | Decode `user` account, `user_account` destination bytes, and `token_pair_id`. Resolve destination chain from the referenced token-pair account. [Solana instruction definitions](https://docs.wanchain.org/developers/wanbridge-api/2.-creating-cross-chain-transactions-for-wanbridge/2.1-direct-interaction-with-on-chain-contracts) | Destination chain ID is not a standalone instruction argument. Preserve historical token-pair state when possible. |
| Base Bridge | Direct | Solana-to-Base instruction contains `from` and `to`; destination is fixed to Base. Base-to-Solana transfer serialization also includes `to`. Join with outgoing-message account/hash. [Solana bridge builder](https://github.com/base/bridge/blob/main/scripts/src/commands/sol/bridge/solana-to-base/bridge-sol.handler.ts) | Call variants can target contracts and execute further instructions. |
| Axelar | Conditional; direct for ITS | ITS payload contains source address, destination chain, and destination address. Generic GMP exposes destination contract and payload. [ITS transfer fields](https://github.com/axelarnetwork/interchain-token-service/blob/main/contracts/InterchainTokenService.sol/) and [source-transaction decoder](https://github.com/axelarnetwork/axe/blob/main/docs/axelar-debugging.md) | ITS routes through the Axelar hub, producing multiple message legs/IDs. Generic GMP final beneficiary is application-specific. |

### Recommended ingestion order

1. Start with CCTP, deBridge, Mayan, Allbridge Core, Across, Wormhole WTT, NEAR Omni Bridge, and Base Bridge. One source transaction provides the complete wallet pair.
2. Add Wanchain with a token-pair metadata cache.
3. Add OFT, Warp Route, CCIP token-transfer, and Axelar ITS decoders. Treat generic application recipients as contracts unless their payload decoder proves a final wallet.
4. Add Chainflip and Relay only with their API or state-chain correlation. Program-address matching alone cannot recover the destination wallet.

Store both `protocol_recipient` and `beneficiary_wallet`. Never silently label a destination contract as the user's wallet. For Solana, derive `source_wallet` from the bridge's depositor, maker, swapper, or token-authority account; the fee payer is only a fallback. Preserve bridge message/order ID, extraction method, and confidence beside both wallets.

### Solana and Ethereum first slice

Limit initial correlation to transfers whose two endpoints are Solana and Ethereum mainnet. Do not build a universal chain abstraction for bridge parsing yet.

Start with direct source-transaction decoders for CCTP, Wormhole WTT, deBridge DLN, Mayan, Allbridge Core, and Across. Add LayerZero OFT, Hyperlane Warp Routes, Axelar ITS, and Wanchain after their application or account lookups are available. Leave Chainflip and Relay out of the first slice because their standard source transactions do not contain the destination wallet.

Ethereum ingestion must retain transaction `from`, `to`, `input`, `value`, chain ID, status, block/transaction index, and complete receipt logs with topics and data. Without calldata and logs, FraudWatch cannot recover bridge recipients or message IDs reliably.

Use one normalized result for either direction:

```text
protocol
source_chain, source_transaction, source_wallet
destination_chain, protocol_recipient, beneficiary_wallet
message_or_order_id
extraction_method: source_transaction | account_lookup | api
confidence: exact | application_recipient | unresolved
```

## Services that route underlying protocols

These names may appear in a user interface or API, but they should not become separate protocol labels unless they deploy a distinct Solana program:

- Portal uses Wormhole Wrapped Token Transfers.
- Jumper and LI.FI aggregate several bridge protocols.
- Squid routes Axelar and, for some routes, Chainflip.
- Symbiosis routes Solana through Chainflip.
- Allbridge Next routes OFT, CCTP, or intent providers. The candidate `EmLt...` ID found in its SDK IDL was not deployed on Solana mainnet when checked.
- Stargate uses LayerZero and token-specific OFT programs on Solana.
- NEAR Intents uses NEAR Omni Bridge for Solana settlement.
- Sunrise coordinates token launches and uses token-specific interoperability deployments rather than one universal Solana bridge program.
- Jupiter bridge and universal-deposit experiences aggregate routes rather than define one bridge protocol.
- Rango, Rubic, and Owlto are route or interface layers; attribute the executed program instead.

## Dynamic and historical scope

No static file can enumerate every token-specific bridge deployment. Wormhole NTT managers, LayerZero OFTs, Hyperlane Warp Routes, and application-specific CCIP pools can each deploy a new Solana program. Those require a separate mint-to-program feed.

Historical or low-confidence candidates not added without a current first-party deployment source: Mayan's legacy Swap Bridge, Meson, Picasso IBC, NeonPass, RenVM, Glitter Finance, PowerFlow, WavesBridge, SoDEX Bridge, and Neony Exchange Bridge. Allbridge Classic remains in the registry because historical transaction attribution needs it, but its label is explicitly deprecated.

Discovery sources used to check coverage include [DeFiLlama's Solana bridge category](https://defillama.com/protocols/bridge/solana), [DeFiLlama's Solana bridge aggregators](https://defillama.com/bridge-aggregators/chain/solana), [LI.FI's live tools API](https://li.quest/v1/tools), and the archived [Solana bridge adapter](https://github.com/solana-labs/bridge-adapter). First-party deployment sources, not discovery lists, determine registry inclusion.

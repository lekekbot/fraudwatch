# Solana bridge inventory

Snapshot: 2026-10-04

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

## Solana–Ethereum transaction correlation

The first implementation slice accepts completed token-transfer paths between Solana and Ethereum mainnet. Both retrieved chain transactions must yield a local wallet owner and local asset. A free public protocol API, explorer, or state-chain lookup may correlate the two transaction hashes; the chain transactions remain the final wallet-and-asset evidence.

RPC responses do not literally return a `wallet` field. Decoders must derive the Solana owner from bridge accounts or token-balance owners, and derive the Ethereum owner from bridge events, calldata, or ERC-20 `Transfer` logs. The fee payer, relayer, transaction submitter, token account, bridge vault, and destination application are not automatically the beneficiary wallet.

| Protocol | Coverage | Solana transaction evidence | Ethereum transaction evidence | Correlation method |
| --- | --- | --- | --- | --- |
| Wormhole | Accept WTT; payload 3 conditional | Token authority/owner and SPL mint; WTT payload contains recipient and token origin. [Payload format](https://wormhole.com/docs/products/token-transfers/wrapped-token-transfers/concepts/payload-structure/) | VAA redemption identifies recipient and origin token; token transfer identifies local ERC-20 asset. | VAA `(emitter chain, emitter address, sequence)` |
| Circle CCTP | Accept | `depositForBurn`/receive-message data exposes depositor or mint recipient and USDC mint. [Solana instruction](https://github.com/circlefin/solana-cctp-contracts/blob/master/programs/token-messenger-minter/src/token_messenger/instructions/deposit_for_burn.rs) | `DepositForBurn` or mint/withdraw events expose depositor or mint recipient; asset is USDC. | CCTP source domain and nonce, or message hash |
| deBridge DLN | Accept | Created order contains maker, give token, receiver, take token, and chain IDs. | Created/fill order data contains the same wallet and asset fields. [Order contract](https://github.com/debridge-finance/dln-contracts/blob/main/contracts/DLN/DlnSource.sol) | Deterministic DLN order ID |
| Mayan Finance | Accept | Mayan instruction or deposit contains source wallet and mint. [Swap layout](https://github.com/mayan-finance/swap-sdk/blob/main/src/solana/solanaSwap.ts) | Settlement contains the destination wallet and delivered ERC-20 asset. | MCTP/Wormhole use their on-chain message IDs. Swift and MPS use Mayan's free [Explorer API](https://github.com/mayan-finance/swap-sdk#tracking-swaps) by source transaction hash. |
| Allbridge | Accept Core and Classic transfers | Bridge instruction contains user, source mint, recipient, destination chain, and receive-token bytes. [Core IDL](https://github.com/allbridge-io/allbridge-core-js-sdk/blob/main/src/services/models/sol/types/bridge.json) | Lock/unlock calldata and token logs contain wallet and ERC-20 asset. | Allbridge nonce/message hash |
| Across | Accept token deposits | Deposit instruction/event contains depositor, recipient, input/output tokens, destination chain, and deposit ID. | Deposit/fill event contains wallet and ERC-20 asset. [Deposit fields](https://docs.across.to/introduction/tracking-deposits) | Origin chain ID and deposit ID |
| Chainflip | Accept with free lookup | Deposit transaction returns source wallet and asset. | Egress transaction returns destination wallet and asset. | Search the free [Chainflip Explorer](https://scan.chainflip.io/) or read State Chain deposit-channel/swap events, which record destination address and asset. [Deposit-channel data](https://docs.chainflip.io/brokers/broker-deposit-channels-swaps) |
| Relay | Accept with free lookup | Deposit returns source wallet, asset, and request ID or deposit address. | Withdrawal returns destination wallet and asset. | Relay's public transaction-status lookup accepts an on-chain transaction hash and returns the paired request/transactions. API key is optional for status lookups. [Relay MCP/API behavior](https://github.com/relayprotocol/relay-mcp) |
| Chainlink CCIP | Accept token transfers; generic messages conditional | Message contains sender, receiver/token receiver, token amounts, and message ID. [SVM message fields](https://docs.chain.link/ccip/v1/svm/api-reference/v1.6.0/messages) | Execution message and token logs contain receiver, ERC-20 asset, and message ID. | CCIP message ID |
| Hyperlane | Accept Warp Routes; generic Mailbox conditional | Warp transfer body contains recipient and amount; invoked route identifies local SPL mint. | Warp transfer/fill identifies recipient; invoked route and token log identify ERC-20 asset. [Warp Route format](https://github.com/hyperlane-xyz/hyperlane-monorepo/blob/main/solidity/contracts/token/README.md) | Hyperlane message ID |
| LayerZero | Accept OFT; generic OApp conditional | OFT `SendParams` contains destination endpoint and recipient; signer/token-source accounts identify owner and mint. [Solana OFT send](https://github.com/LayerZero-Labs/devtools/blob/main/examples/oft-solana/programs/oft/src/instructions/send.rs) | OFT send/receive and ERC-20 logs identify wallet and local token. | LayerZero GUID |
| NEAR Omni Bridge | Accept asset transfers | Init/finalize payload contains chain-prefixed recipient and token; signer/token accounts identify local owner and mint. [Omni Address format](https://github.com/Near-One/bridge-sdk-js) | Init/finalize calldata and token logs identify wallet and ERC-20 asset. | Omni transfer/message hash |
| Wanchain | Accept with free lookup | Instruction contains user, destination `user_account`, token-pair ID, and local mint. [Solana instruction definitions](https://docs.wanchain.org/developers/wanbridge-api/2.-creating-cross-chain-transactions-for-wanbridge/2.1-direct-interaction-with-on-chain-contracts) | Lock/burn/mint calldata and logs identify wallet and ERC-20 asset. | Free [status API](https://docs.wanchain.org/developers/wanbridge-api/4.-status-query) maps `lockHash` to `redeemHash`; `smgID` alone is not a transfer ID. |
| Base Bridge | Out of scope | Its transfer instruction contains owner, asset, and recipient. | Destination is Base, not Ethereum mainnet. [Bridge scope](https://github.com/base/bridge) | Outgoing message account/hash |
| Axelar | Accept ITS; generic GMP conditional | ITS payload contains source address, token ID, destination chain, and destination address. | ITS execution and token logs contain wallet and ERC-20 asset. [ITS fields](https://github.com/axelarnetwork/interchain-token-service/blob/main/contracts/InterchainTokenService.sol/) | Axelar message ID plus ITS token ID |

Generic Wormhole payload-3, CCIP, Hyperlane Mailbox, LayerZero OApp, and Axelar GMP messages are conditionally accepted. Decode the application payload and destination receipt. Accept a record only when a token transfer, native transfer, or application event identifies the final wallet and local asset. Follow a later payout transaction only when a public message ID or application state links it. Otherwise mark that record unresolved; never return the destination application as the user's wallet.

Use free sources first:

1. Chain RPC and receipt/log decoding.
2. Mayan Explorer API, Relay transaction-status API, Wanchain status API, or Chainflip Explorer/State Chain.
3. Application-specific payload and event decoder.

No paid provider is required for these paths. Public endpoints are rate-limited and have no availability guarantee. Cache successful correlations. Chainflip has no documented stable public lookup API; its free Explorer works for investigations, while reliable bulk historical ingestion requires indexing State Chain events or operating an archive node.

For each accepted pair, emit:

```text
protocol, bridge_id
solana_transaction, solana_wallet, solana_asset
ethereum_transaction, ethereum_wallet, ethereum_asset
solana_wallet_kind, ethereum_wallet_kind
correlation: on_chain | free_protocol_lookup | application_decoder
correlation_source
evidence: on_chain_verified
```

`*_asset` is the local mint or token contract, not a ticker; use an explicit native-asset sentinel for SOL or ETH. Resolve symbols separately. Return a token-account owner on Solana, not the ATA. Return the event recipient on Ethereum, not the relayer's `tx.from`.

No bridge can prove from source calldata alone that a destination address is user-controlled. Classify address kind at the destination block/slot: inspect Ethereum code and Solana account owner/executable state. Keep smart-contract wallets valid, but label them explicitly instead of silently treating every recipient as an EOA.

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

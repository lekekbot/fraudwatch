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

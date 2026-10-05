/**
 * Bump when the event shape or the pipeline changes; each interpreter also
 * carries its own version. Events are computed on read from canonical
 * transactions and never stored, so nothing stale can be reused yet; a store
 * for them must check both (see `DERIVED_CACHES`).
 */
export const SEMANTIC_VERSION = 4;

/**
 * Broad kinds of meaningful action. `action` carries the finer meaning (BUY,
 * BORROW, an instruction name); add a category only when an action can't say it.
 */
export type EventCategory =
  | "TRANSFER"
  | "SWAP"
  | "NFT_TRADE"
  | "NFT_TRANSFER"
  | "NFT_MINT"
  | "BURN"
  | "STAKE"
  | "UNSTAKE"
  | "LENDING"
  | "BRIDGE"
  | "LIQUIDITY"
  | "ACCOUNT"
  | "APPROVAL"
  | "PROGRAM_INTERACTION"
  | "FAILED"
  | "UNKNOWN";

/** What a meaningful actor did in the event. SIGNER: sent the transaction and had no clearer role. */
export type ParticipantRole =
  | "SIGNER"
  | "SENDER"
  | "RECEIVER"
  | "BUYER"
  | "SELLER"
  | "TRADER"
  | "DEPOSITOR"
  | "WITHDRAWER"
  | "BORROWER"
  | "LENDER"
  | "FEE_RECIPIENT"
  | "ROYALTY_RECIPIENT";

/** Addresses the event went through rather than parties to it. Never shown as wallet counterparties. */
export type InfrastructureRole = "PROGRAM" | "MARKETPLACE" | "ROUTER" | "POOL" | "VAULT" | "ESCROW" | "BRIDGE" | "FEE_ACCOUNT" | "TOKEN_ACCOUNT" | "PDA";

export type Participant = { address: string; role: ParticipantRole };
export type Infrastructure = { address: string; role: InfrastructureRole; label: string | null };

/**
 * One asset movement inside the event. Amounts are integer strings in base
 * units. Token flows name owners, not token accounts. A side is null when
 * balances can't say who it was: several senders and several receivers of
 * one asset, a balance that appeared from nowhere (an account closing), or
 * value that left supply.
 */
export type SemanticFlow = {
  assetId: string;
  amount: string;
  from: string | null;
  to: string | null;
  /** balance: paired from pre/post balances. compressed_nft: a Bubblegum leaf event. */
  source: "balance" | "compressed_nft";
  /** What the movement is for, when an interpreter knows; see `FlowRole`. */
  role?: FlowRole;
};

/**
 * spent, received: what the actor gave up and got back in a swap, stake,
 * lending or bridge action; the other side is null, routing shows in settlement.
 * payment: the main consideration (buyer to seller). royalty, marketplace_fee,
 * rent, unidentified: the payer's other recipients, as the NFT parser names
 * them. nft: the traded asset itself. settlement: whatever else moved
 * balances (escrow and account closures refunding rent), so the flows still
 * add up to the observed changes. Supporting roles never make a participant.
 */
export type FlowRole = "spent" | "received" | "payment" | "royalty" | "marketplace_fee" | "rent" | "unidentified" | "nft" | "settlement";

/**
 * An NFT trade, mint or transfer in one place. Buyer and seller are the
 * wallets on either side, whoever sent the transaction; null when the side
 * isn't a sale (a swap, a transfer, a mint's issuer).
 */
export type NftDetail = {
  /** NFTs that changed hands (both directions in a swap). */
  assets: string[];
  buyer: string | null;
  seller: string | null;
  /**
   * The buyer's net outlay in the payment asset, network fee excluded, as the
   * NFT parser reports it: it includes rent for accounts the purchase opened.
   * For an accepted bid it's what the bid's escrow paid out.
   */
  price: { assetId: string; amount: string } | null;
  /** More than one NFT on one side. */
  bundle: boolean;
  /** Some of the NFTs are compressed: moved in Bubblegum leaf events, never held as SPL tokens. */
  compressed: boolean;
};

/**
 * Why the event reads the way it does. Everything points into the canonical
 * transaction (by account or instruction index) or at a lookup; the
 * transaction itself is never copied.
 */
export type EvidenceRef =
  | { kind: "TRANSACTION_STATUS"; success: boolean }
  | { kind: "BALANCE_DELTA"; account: string }
  | { kind: "TOKEN_DELTA"; account: string; mint: string }
  /** Index into `CanonicalTransaction.instructions` / `.innerInstructions`. */
  | { kind: "OUTER_INSTRUCTION"; index: number }
  | { kind: "INNER_INSTRUCTION"; index: number }
  /** Data a program returned (CCTP's nonce, for one). */
  | { kind: "RETURN_DATA"; programId: string }
  | { kind: "KNOWN_ADDRESS"; address: string; protocolId: string; registryVersion: number }
  | { kind: "NFT_TRADE_PARSER" }
  /** On-chain or DAS metadata that said this asset is an NFT. */
  | { kind: "ASSET_METADATA"; assetId: string };

/**
 * HIGH: a known program's decoded instruction, matching the balance changes.
 * MEDIUM: a strong balance pattern alongside a known protocol, without a decoded instruction.
 * LOW: a balance pattern or program call with nothing definitive behind it, or nothing recognisable.
 */
export type EventConfidence = "HIGH" | "MEDIUM" | "LOW";

/**
 * The Solana side of a cross-chain transfer, with whatever identifiers could
 * later find the other side. Nothing here is traced off-chain.
 */
export type BridgeEnvelope = {
  direction: "OUT" | "IN";
  /** Chain names; a domain or chain id the code doesn't know stays as `<protocol>-domain-<n>`. */
  sourceChain: string;
  destinationChain: string;
  asset: { assetId: string; amount: string } | null;
  /** Recipient on the destination chain (out) or sender on the source chain (in), as the protocol encodes it. */
  remoteAddress: string | null;
  /** Protocol identifiers for correlation: nonce, message account, domains, VAA sequence. */
  identifiers: Record<string, string>;
};

export type ProtocolRef = { id: string; name: string; category: string };

export type SemanticEvent = {
  /** `solana:<signature>:event:<index>`; deterministic, see `eventId`. */
  id: string;
  version: number;
  signature: string;
  slot: number;
  timestamp: string | null;
  category: EventCategory;
  action: string;
  participants: Participant[];
  infrastructure: Infrastructure[];
  /** Every asset that moved, in flow order. */
  assets: string[];
  flows: SemanticFlow[];
  /** The verified protocol that performed the action, when an interpreter attributes it. */
  protocol: ProtocolRef | null;
  /** A verified centralized service (exchange) taking part. */
  service: ProtocolRef | null;
  confidence: EventConfidence;
  evidence: EvidenceRef[];
  /** The interpreter whose reading this is. */
  interpreter: { id: string; version: number };
  /** Interpreters that failed, flows balances couldn't pair, and similar caveats. */
  warnings: string[];
  /** Set for NFT_TRADE, NFT_TRANSFER and NFT_MINT events read by the NFT parser. */
  nft: NftDetail | null;
  /** Set for BRIDGE events: the Solana side only. */
  bridge: BridgeEnvelope | null;
  /** The interpretation is read from the fee payer's side; their fee is not a flow. */
  metadata: { feePayer: string | null; feeLamports: string };
};

export const eventId = (signature: string, index: number) => `solana:${signature}:event:${index}`;

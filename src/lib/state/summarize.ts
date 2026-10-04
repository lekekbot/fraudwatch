import { NATIVE_SOL } from "@/lib/assets/assets";
import { registry } from "@/lib/protocols/registry";
import { shortenAddress } from "@/lib/solana/address";
import { cnftMoves } from "@/lib/solana/bubblegum";
import type { CanonicalInstruction, CanonicalTransaction } from "@/lib/solana/canonical";
import {
  ASSOCIATED_TOKEN_PROGRAM,
  COMPUTE_BUDGET_PROGRAM,
  MEMO_PROGRAMS,
  STAKE_PROGRAM,
  SYSTEM_PROGRAM,
  TOKEN_PROGRAMS,
} from "@/lib/solana/programs";
import type { AssetChange, WalletTransactionEffect } from "./reconstruct";

/**
 * A plain-language reading of what one transaction did to one wallet, from its
 * balance changes, or from its instructions when none of the wallet's value
 * moved. Protocol-aware labels (Sprint 06) refine this; they never replace the
 * observed deltas.
 */
/**
 * SEND / RECEIVE / SWAP come from the wallet's balance changes, except when a
 * token instruction gives the movement a more precise meaning (such as BURN).
 * A transaction that moved none of the wallet's value is typed by what it did instead:
 * APPROVAL (token delegate or authority change), STAKE, ACCOUNT (token
 * account setup or close), or PROGRAM (a call to any other program). There is
 * deliberately no catch-all "other".
 */
export type EffectKind =
  | "SEND"
  | "RECEIVE"
  | "SWAP"
  | "NFT_BUY"
  | "NFT_SELL"
  | "NFT_MINT"
  | "NFT_SWAP"
  | "NFT_TRANSFER"
  | "BURN"
  | "APPROVAL"
  | "STAKE"
  | "ACCOUNT"
  | "PROGRAM"
  | "FAILED";

/**
 * An NFT changing hands in a transaction, from one wallet's side. What counts
 * as an NFT is checked on-chain per mint (see `AssetMetadata.nft`).
 */
export type NftTrade = {
  /** NFTs this wallet received and gave up; more than one is a bundle, both sides a swap. */
  received: string[];
  sent: string[];
  /** Value this wallet paid (buy, mint) or received (sale) alongside; null for a plain transfer or swap. */
  payment: ValueChange | null;
  /** The other side: seller for a buy, buyer for a sale, counterparty for a transfer or swap. */
  party: string | null;
  /** Everyone else paid in the payment asset, largest first, with what they most likely are. */
  others: { address: string; amount: string; role: RecipientRole }[];
  /** Marketplace program, when the registry knows one in the transaction. */
  marketplace: string | null;
};

/**
 * royalty: a creator with a royalty share in a traded NFT's metadata.
 * rent: an account created in this transaction. marketplace_fee: a registry
 * fee account. unidentified: anyone else (often a marketplace fee the
 * registry doesn't list).
 */
export type RecipientRole = "royalty" | "rent" | "marketplace_fee" | "unidentified";

/** What's known about NFTs, from on-chain metadata; see `AssetMetadata`. */
export type NftCatalog = {
  isNft: (mint: string) => boolean;
  royaltyRecipients: (mint: string) => readonly string[];
};

export const NO_NFTS: NftCatalog = { isNft: () => false, royaltyRecipients: () => [] };

/** The instruction that best describes a transaction. */
export type TxAction = { programId: string; program: string | null; instruction: string | null };

export type ValueChange = { assetId: string; delta: string };

export type Counterparty = {
  /** Owner of the counterparty token account, or the account itself for SOL. */
  address: string;
  assetId: string;
  /** The counterparty's own delta; opposite in sign to the wallet's. */
  delta: string;
};

export type EffectSummary = {
  kind: EffectKind;
  /** Assets the wallet lost / gained, with SOL net of the fee it paid. */
  outflows: ValueChange[];
  inflows: ValueChange[];
  counterparties: Counterparty[];
  action: TxAction | null;
  /** Fee payer when it isn't the wallet: someone else sent this transaction. */
  actor: string | null;
  /** Set for every NFT_ kind. */
  nft?: NftTrade;
};

const ZERO = BigInt(0);
const abs = (v: bigint) => (v < ZERO ? -v : v);

function valueChanges(effect: WalletTransactionEffect): ValueChange[] {
  const fee = BigInt(effect.feeLamports);
  return effect.assetChanges
    .map((c: AssetChange) => {
      // The fee is reported separately; don't let it read as a SOL transfer.
      const delta = c.assetId === NATIVE_SOL ? BigInt(c.delta) + fee : BigInt(c.delta);
      return { assetId: c.assetId, delta };
    })
    .filter((c) => c.delta !== ZERO)
    .map((c) => ({ assetId: c.assetId, delta: c.delta.toString() }));
}

function counterpartiesFor(wallet: string, tx: CanonicalTransaction, changes: ValueChange[]): Counterparty[] {
  const tokenAccounts = new Set(tx.tokenChanges.map((t) => t.account));
  const found: Array<Counterparty & { size: bigint }> = [];
  for (const change of changes) {
    const negative = change.delta.startsWith("-");
    const opposite = (delta: string) => delta !== "0" && delta.startsWith("-") !== negative;
    if (change.assetId === NATIVE_SOL) {
      for (const n of tx.nativeChanges) {
        // Token accounts move lamports for rent, not value.
        if (n.account === wallet || tokenAccounts.has(n.account) || !opposite(n.delta)) continue;
        found.push({ address: n.account, assetId: NATIVE_SOL, delta: n.delta, size: abs(BigInt(n.delta)) });
      }
    } else {
      for (const t of tx.tokenChanges) {
        if (t.mint !== change.assetId || t.owner === wallet || !opposite(t.delta)) continue;
        found.push({ address: t.owner ?? t.account, assetId: t.mint, delta: t.delta, size: abs(BigInt(t.delta)) });
      }
    }
  }
  const seen = new Set<string>();
  return found
    .sort((a, b) => (b.size > a.size ? 1 : b.size < a.size ? -1 : 0))
    .filter((c) => {
      const key = `${c.address}:${c.assetId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map(({ address, assetId, delta }) => ({ address, assetId, delta }));
}

const INFRASTRUCTURE = new Set<string>([COMPUTE_BUDGET_PROGRAM, ...MEMO_PROGRAMS]);
const TOKEN = new Set<string>(TOKEN_PROGRAMS);
const APPROVALS = new Set(["approve", "approveChecked", "revoke", "setAuthority"]);
const BURNS = new Set(["burn", "burnChecked"]);
const SYSTEM_SETUP = new Set(["createAccount", "createAccountWithSeed", "allocate", "allocateWithSeed", "assign", "assignWithSeed"]);
const TOKEN_SETUP = new Set(["initializeAccount", "initializeAccount2", "initializeAccount3", "initializeImmutableOwner", "closeAccount", "syncNative", "getAccountDataSize"]);

const isSetup = (ix: CanonicalInstruction) =>
  ix.programId === ASSOCIATED_TOKEN_PROGRAM ||
  (ix.programId === SYSTEM_PROGRAM && SYSTEM_SETUP.has(ix.type ?? "")) ||
  (TOKEN.has(ix.programId) && TOKEN_SETUP.has(ix.type ?? ""));

const toAction = (ix: CanonicalInstruction): TxAction => ({ programId: ix.programId, program: ix.program, instruction: ix.type });

/** A parsed SPL burn that consumed tokens owned by this wallet. */
function burnInstruction(wallet: string, tx: CanonicalTransaction | undefined): CanonicalInstruction | null {
  if (!tx) return null;
  const burned = tx.tokenChanges.filter((change) => change.owner === wallet && BigInt(change.delta) < ZERO);
  if (burned.length === 0) return null;
  return (
    [...tx.instructions, ...tx.innerInstructions].find((ix) => {
      if (!TOKEN.has(ix.programId) || !BURNS.has(ix.type ?? "")) return false;
      const info = typeof ix.info === "object" && ix.info !== null ? (ix.info as { account?: unknown; mint?: unknown }) : {};
      const account = typeof info.account === "string" ? info.account : null;
      const mint = typeof info.mint === "string" ? info.mint : null;
      return (account !== null || mint !== null) && burned.some((change) => (!account || change.account === account) && (!mint || change.mint === mint));
    }) ?? null
  );
}

/** Types a transaction that moved none of the wallet's value, from its instructions. */
export function classifyInstructions(tx: CanonicalTransaction | undefined): { kind: EffectKind; action: TxAction | null } {
  if (!tx) return { kind: "PROGRAM", action: null };
  const every = [...tx.instructions, ...tx.innerInstructions];
  const approval = every.find((ix) => TOKEN.has(ix.programId) && APPROVALS.has(ix.type ?? ""));
  if (approval) return { kind: "APPROVAL", action: toAction(approval) };
  const stake = every.find((ix) => ix.programId === STAKE_PROGRAM);
  if (stake) return { kind: "STAKE", action: toAction(stake) };
  const outer = tx.instructions.filter((ix) => !INFRASTRUCTURE.has(ix.programId));
  const main = outer.find((ix) => !isSetup(ix));
  if (!main) return { kind: outer.length > 0 ? "ACCOUNT" : "PROGRAM", action: outer[0] ? toAction(outer[0]) : null };
  return { kind: "PROGRAM", action: toAction(main) };
}

/**
 * "spl-token · approve". `programName` (a user label or registry name) wins over
 * the RPC's program name; with neither, the program ID is shortened.
 */
export function describeAction(action: TxAction | null, programName?: string): string {
  if (!action) return "Unknown program";
  const program = programName ?? action.program ?? shortenAddress(action.programId, 4);
  return action.instruction ? `${program} · ${action.instruction}` : program;
}

/** Addresses whose balance of `assetId` went up in the transaction (owners, for tokens), largest first. Token accounts' rent is left out. */
function recipients(tx: CanonicalTransaction, assetId: string): { address: string; amount: bigint }[] {
  const out = new Map<string, bigint>();
  if (assetId === NATIVE_SOL) {
    const tokenAccounts = new Set(tx.tokenChanges.map((t) => t.account));
    for (const n of tx.nativeChanges) {
      if (!tokenAccounts.has(n.account) && BigInt(n.delta) > ZERO) out.set(n.account, BigInt(n.delta));
    }
  } else {
    for (const t of tx.tokenChanges) {
      const owner = t.owner ?? t.account;
      if (t.mint === assetId && BigInt(t.delta) > ZERO) out.set(owner, (out.get(owner) ?? ZERO) + BigInt(t.delta));
    }
  }
  return [...out].map(([address, amount]) => ({ address, amount })).sort((a, b) => (b.amount > a.amount ? 1 : b.amount < a.amount ? -1 : 0));
}

const MINT_TYPES = new Set(["mintTo", "mintToChecked"]);

function nftTrade(
  effect: WalletTransactionEffect,
  tx: CanonicalTransaction | undefined,
  changes: ValueChange[],
  counterparties: Counterparty[],
  nfts: NftCatalog,
): { kind: EffectKind; nft: NftTrade } | null {
  // Compressed NFTs have no token balances; their moves come from Bubblegum's leaf events.
  const moves = tx ? cnftMoves(tx) : [];
  const cnftsIn = moves.filter((m) => m.to === effect.wallet && m.from !== effect.wallet);
  const cnftsOut = moves.filter((m) => m.from === effect.wallet && m.to !== effect.wallet);
  const received = [
    ...changes.filter((c) => !c.delta.startsWith("-") && nfts.isNft(c.assetId)).map((c) => c.assetId),
    ...cnftsIn.map((m) => m.assetId),
  ];
  const sent = [
    ...changes.filter((c) => c.delta.startsWith("-") && nfts.isNft(c.assetId)).map((c) => c.assetId),
    ...cnftsOut.map((m) => m.assetId),
  ];
  const valueIn = changes.find((c) => !c.delta.startsWith("-") && !nfts.isNft(c.assetId));
  const valueOut = changes.find((c) => c.delta.startsWith("-") && !nfts.isNft(c.assetId));
  const every = tx ? [...tx.instructions, ...tx.innerInstructions] : [];
  const marketplace = every.find((ix) => registry.lookup(ix.programId)?.category === "nft_marketplace")?.programId ?? null;
  // Payers lose what this wallet gains; payees gain what it loses. Counterparties are sorted by size.
  const payer = (assetId: string) => counterparties.find((c) => c.assetId === assetId && c.delta.startsWith("-"))?.address ?? null;
  const payee = (assetId: string) => counterparties.find((c) => c.assetId === assetId && !c.delta.startsWith("-"))?.address ?? null;

  const trade = (kind: EffectKind, nftsIn: string[], nftsOut: string[], payment: ValueChange | null, party: string | null) => {
    const royalty = new Set([...nftsIn, ...nftsOut].flatMap((m) => nfts.royaltyRecipients(m)));
    const created = new Set(tx?.nativeChanges.filter((n) => n.pre === "0").map((n) => n.account) ?? []);
    const role = (address: string): RecipientRole =>
      royalty.has(address)
        ? "royalty"
        : created.has(address)
          ? "rent"
          : registry.lookup(address)?.role === "fee_account"
            ? "marketplace_fee"
            : "unidentified";
    const others =
      payment && tx
        ? recipients(tx, payment.assetId)
            .filter((r) => r.address !== effect.wallet && r.address !== party)
            .map((r) => ({ address: r.address, amount: r.amount.toString(), role: role(r.address) }))
        : [];
    return { kind, nft: { received: nftsIn, sent: nftsOut, payment, party, others, marketplace } };
  };

  // The other side of a cNFT move, which balance changes can't show.
  const cnftFrom = cnftsIn[0]?.from ?? null;
  const cnftTo = cnftsOut[0]?.to ?? null;
  if (received.length > 0 && sent.length > 0) {
    const payment = valueOut ?? valueIn ?? null;
    return trade("NFT_SWAP", received, sent, payment, payee(sent[0]) ?? payer(received[0]) ?? cnftTo ?? cnftFrom);
  }
  if (received.length > 0) {
    const minted =
      cnftsIn.some((m) => m.kind === "mint") ||
      received.some((mint) => every.some((ix) => MINT_TYPES.has(ix.type ?? "") && (ix.info as { mint?: string } | null)?.mint === mint));
    if (minted) return trade("NFT_MINT", received, [], valueOut ?? null, valueOut ? payee(valueOut.assetId) : null);
    if (valueOut) return trade("NFT_BUY", received, [], valueOut, payee(valueOut.assetId) ?? cnftFrom);
    return trade("NFT_TRANSFER", received, [], null, payer(received[0]) ?? cnftFrom);
  }
  if (sent.length > 0) {
    if (valueIn) return trade("NFT_SELL", [], sent, valueIn, payer(valueIn.assetId) ?? cnftTo);
    return trade("NFT_TRANSFER", [], sent, null, payee(sent[0]) ?? cnftTo);
  }
  // A listing held in marketplace escrow never sits in the seller's wallet: it's a sale when the
  // address that paid this wallet received NFTs in the same transaction.
  if (valueIn && !valueOut && tx) {
    const payers = new Set(counterparties.filter((c) => c.assetId === valueIn.assetId && c.delta.startsWith("-")).map((c) => c.address));
    const bought = [
      ...tx.tokenChanges.filter((t) => t.delta === "1" && t.owner && payers.has(t.owner) && nfts.isNft(t.mint)).map((t) => ({ id: t.mint, owner: t.owner! })),
      ...moves.filter((m) => payers.has(m.to)).map((m) => ({ id: m.assetId, owner: m.to })),
    ];
    if (bought.length > 0) return trade("NFT_SELL", [], [...new Set(bought.map((b) => b.id))], valueIn, bought[0].owner);
  }
  return null;
}

/**
 * `nfts` says which mints are NFTs and who their royalties go to (checked
 * on-chain; see `AssetMetadata`). Without it, NFT trades read as plain sends,
 * receives and swaps.
 */
export function summarizeEffect(
  effect: WalletTransactionEffect,
  tx: CanonicalTransaction | undefined,
  nfts: NftCatalog = NO_NFTS,
): EffectSummary {
  const burnAction = effect.success ? burnInstruction(effect.wallet, tx) : null;
  // A burn's SOL pays for it (rent for the accounts the program creates, a bridge relayer's fee), so
  // it isn't value sent to anyone; the tokens leave supply, not to an address. Balances still show it.
  const changes = burnAction ? valueChanges(effect).filter((c) => c.assetId !== NATIVE_SOL) : valueChanges(effect);
  const outflows = changes.filter((c) => c.delta.startsWith("-"));
  const inflows = changes.filter((c) => !c.delta.startsWith("-"));
  const classified = classifyInstructions(tx);
  const counterparties = tx ? counterpartiesFor(effect.wallet, tx, changes) : [];
  const nft = effect.success && !burnAction ? nftTrade(effect, tx, changes, counterparties, nfts) : null;
  const kind: EffectKind = !effect.success
    ? "FAILED"
    : burnAction
      ? "BURN"
      : nft
      ? nft.kind
      : outflows.length > 0 && inflows.length > 0
        ? "SWAP"
        : outflows.length > 0
          ? "SEND"
          : inflows.length > 0
            ? "RECEIVE"
            : classified.kind;
  const feePayer = tx?.accounts[0]?.address;
  return {
    kind,
    outflows,
    inflows,
    counterparties,
    action: burnAction ? toAction(burnAction) : classified.action,
    actor: feePayer && feePayer !== effect.wallet ? feePayer : null,
    ...(nft ? { nft: nft.nft } : {}),
  };
}

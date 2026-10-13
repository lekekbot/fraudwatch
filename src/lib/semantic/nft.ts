import { NATIVE_SOL } from "@/lib/assets/assets";
import { bytesOf, discriminator } from "@/lib/solana/anchor";
import type { EffectSummary } from "@/lib/state/summarize";
import type { EvidenceRef, FlowRole, Infrastructure, NftDetail, SemanticFlow } from "./events";
import { netByAddress, netOf, withSettlement } from "./flows";
import type { Interpretation, Interpreter, TransactionContext } from "./interpret";
import { protocolOf } from "./reading";

const CORE = "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d";
const MMM = "mmm3XBJg5gk8XJxEKBvdgptZz6SgK4tXvn36sodowMc";
const MMM_CORE = new Map([
  ["171,167,34,193,112,21,142,89", "SELL"], // sol_mpl_core_fulfill_buy
  ["252,231,201,176,30,213,118,18", "BUY"], // sol_mpl_core_fulfill_sell
]);

/** Core assets have no token balances. MMM's decoded accounts supply the economic buyer and seller. */
export const coreNft: Interpreter = {
  id: "metaplex-core",
  interpret: (ctx) => {
    const transfers = ctx.instructions.filter(({ ix }) => ix.programId === CORE && bytesOf(ix.data)?.[0] === 14 && ix.accounts.length >= 5);
    const transfer = transfers[0];
    if (!transfer) return null;
    const assetId = transfer.ix.accounts[0];
    const recipient = transfer.ix.accounts[4];
    const market = ctx.instructions.find(({ ix }) => ix.programId === MMM && MMM_CORE.has(discriminator(bytesOf(ix.data)) ?? "") && ix.accounts[6] === assetId);
    const action = market && MMM_CORE.get(discriminator(bytesOf(market.ix.data)) ?? "");
    const payer = market?.ix.accounts[0];
    const owner = market?.ix.accounts[1];
    const pool = market?.ix.accounts[4];
    const escrow = market?.ix.accounts[5];
    if (market && action && payer && owner && pool && escrow && (action === "SELL" ? recipient === owner || recipient === pool : recipient === payer)) {
      const buyer = action === "SELL" ? owner : payer;
      const seller = action === "SELL" ? payer : owner;
      const source = action === "SELL" ? escrow : buyer;
      const destination = action === "SELL" ? seller : [pool, escrow].find((a) => a !== source) ?? pool;
      const payment = ctx.tx.innerInstructions.find((ix) => ix.type === "transfer" && ix.info && typeof ix.info === "object" && (ix.info as { source?: string }).source === source && (ix.info as { destination?: string }).destination === destination);
      const amount = payment && (payment.info as { lamports?: number }).lamports;
      const flows: SemanticFlow[] = [{ assetId, amount: "1", from: seller, to: buyer, source: "core_nft", role: "nft" }];
      if (typeof amount === "number" && amount > 0) flows.push({ assetId: NATIVE_SOL, amount: String(amount), from: source, to: destination, source: "balance", role: "payment" });
      const settled = withSettlement(ctx.deltas, flows);
      return {
        category: "NFT_TRADE", action, actor: payer, confidence: amount ? "HIGH" : "MEDIUM",
        protocol: protocolOf(ctx, MMM), evidence: [market.ref, transfer.ref],
        ...settled,
        warnings: [...(amount ? [] : ["MMM's Core transfer was decoded, but its SOL payment was not found."]), ...settled.warnings],
        infrastructure: [{ address: pool, role: "POOL", label: "MMM pool" }, { address: escrow, role: "ESCROW", label: "MMM SOL escrow" }],
        nft: { assets: [assetId], buyer, seller, price: null, bundle: false, compressed: false },
      };
    }
    const flow: SemanticFlow = { assetId, amount: "1", from: null, to: recipient, source: "core_nft", role: "nft" };
    return {
      category: "NFT_TRANSFER", action: "TRANSFER", confidence: "MEDIUM", evidence: [transfer.ref],
      ...withSettlement(ctx.deltas, [flow]),
      warnings: ["The previous Metaplex Core owner is not recorded in this transaction."],
      nft: { assets: [assetId], buyer: null, seller: null, price: null, bundle: false, compressed: false },
    };
  },
};

function categoryAndAction(summary: EffectSummary) {
  switch (summary.kind) {
    case "NFT_BUY":
      return { category: "NFT_TRADE", action: "BUY" } as const;
    case "NFT_SELL":
      return { category: "NFT_TRADE", action: "SELL" } as const;
    case "NFT_SWAP":
      return { category: "NFT_TRADE", action: "SWAP" } as const;
    case "NFT_MINT":
      return { category: "NFT_MINT", action: "MINT" } as const;
    case "NFT_TRANSFER":
      return { category: "NFT_TRANSFER", action: summary.nft?.received.length ? "RECEIVE" : "SEND" } as const;
    default:
      return null;
  }
}

/**
 * One NFT trade, mint or transfer as a single reading, from the NFT parser in
 * `summarize.ts` (buyer, seller, payment, royalties, fees, rent, unidentified
 * recipients, compressed moves). Read from one side (see `TransactionContext.nft`),
 * then laid out as flows for the whole transaction. Balance changes the parser doesn't
 * account for become settlement flows, so nothing observed is dropped.
 */
export function readNft(ctx: TransactionContext): Omit<Interpretation, "confidence" | "protocol"> | null {
  if (!ctx.nft) return null;
  const { wallet, summary } = ctx.nft;
  const reading = categoryAndAction(summary);
  const n = summary.nft;
  if (!reading || !n) return null;
  const kind = summary.kind;

  const net = netByAddress(ctx.deltas);
  const balanceAssets = new Set(ctx.deltas.map((d) => d.assetId));

  const flows: SemanticFlow[] = [];
  const flow = (assetId: string, amount: bigint | string, from: string | null, to: string | null, role: FlowRole) =>
    flows.push({ assetId, amount: amount.toString(), from, to, source: balanceAssets.has(assetId) ? "balance" : "compressed_nft", role });

  // Who paid whom: the payment is the fee payer's own change in the payment asset.
  const payment = n.payment;
  const paid = payment?.delta.startsWith("-") ?? false;
  const payer = payment ? (paid ? wallet : n.party) : null;
  const payee = payment ? (paid ? n.party : wallet) : null;
  if (payment && payee) {
    const received = netOf(net, payment.assetId, payee);
    if (received > 0n) flow(payment.assetId, received, payer, payee, "payment");
  }
  if (payment) for (const o of n.others) flow(payment.assetId, o.amount, payer, o.address, o.role);
  // An accepted bid is paid from the bidder's escrow, which the parser sees as the other party;
  // the NFT itself goes to the bidder.
  const nftRecipient =
    ctx.tx.tokenChanges.find((t) => n.sent.includes(t.mint) && BigInt(t.delta) > 0n && t.owner && t.owner !== wallet)?.owner ??
    ctx.cnftMoves.find((m) => n.sent.includes(m.assetId) && m.to !== wallet)?.to ??
    null;
  const bidEscrow = kind === "NFT_SELL" && nftRecipient && n.party && nftRecipient !== n.party ? n.party : null;
  const counterparty = bidEscrow ? nftRecipient : n.party;
  for (const id of n.received) flow(id, "1", kind === "NFT_MINT" ? null : n.party, wallet, "nft");
  for (const id of n.sent) flow(id, "1", wallet, counterparty, "nft");

  const settled = withSettlement(ctx.deltas, flows);

  // A mint's buyer is whoever paid for it; a free mint (or an airdrop) has none.
  const buyer = kind === "NFT_BUY" || (kind === "NFT_MINT" && paid) ? wallet : kind === "NFT_SELL" ? counterparty : null;
  const seller = kind === "NFT_BUY" ? n.party : kind === "NFT_SELL" ? wallet : null;
  const assets = [...n.received, ...n.sent];

  // An NFT leaving an account that belongs to neither side sat in escrow (a marketplace listing).
  const sides = new Set([wallet, buyer, seller, bidEscrow ? null : n.party].filter((a) => a !== null));
  const escrows = new Set(bidEscrow ? [bidEscrow] : []);
  for (const owner of ctx.tx.tokenChanges.filter((t) => assets.includes(t.mint) && BigInt(t.delta) < 0n && t.owner && !sides.has(t.owner)).map((t) => t.owner!)) escrows.add(owner);
  const infrastructure: Infrastructure[] = [...escrows].map((address) => ({ address, role: "ESCROW", label: null }));

  // The bidder's escrow paid on the bidder's behalf.
  const spender = bidEscrow ?? buyer;
  const spent = spender && payment ? -netOf(net, payment.assetId, spender) : 0n;
  const nft: NftDetail = {
    assets,
    buyer,
    seller,
    price: payment && spent > 0n ? { assetId: payment.assetId, amount: spent.toString() } : null,
    bundle: n.received.length > 1 || n.sent.length > 1,
    compressed: assets.some((id) => !balanceAssets.has(id)),
  };
  const evidence: EvidenceRef[] = [{ kind: "NFT_TRADE_PARSER" }, ...assets.filter((id) => ctx.nfts.isNft(id)).map((assetId) => ({ kind: "ASSET_METADATA", assetId }) as const)];
  return { ...reading, actor: wallet, flows: settled.flows, infrastructure, nft, evidence, warnings: settled.warnings };
}

import { NATIVE_SOL } from "@/lib/assets/assets";
import { bytesOf, discriminator, hex, reader } from "@/lib/solana/anchor";
import type { CanonicalInstruction } from "@/lib/solana/canonical";
import { MEMO_PROGRAMS } from "@/lib/solana/programs";
import type { BridgeEnvelope, EventCategory, EvidenceRef } from "./events";
import { netByAddress, netOf, withSettlement } from "./flows";
import type { Interpretation, Interpreter, TransactionContext } from "./interpret";
import { actorFlows, moved, protocolOf, receivedAny, spentAny, stakeAccount } from "./reading";

/**
 * Protocol decoders: a known program, a decoded instruction (Anchor
 * discriminators, checked against mainnet transactions) and the actor's
 * balances agreeing gives HIGH; a decoded instruction the balances don't
 * bear out drops to MEDIUM with a warning.
 */

type Found = { ix: CanonicalInstruction; ref: EvidenceRef; bytes: Uint8Array };

/** Instructions of `programId` whose discriminator is in `ops`, outer first. */
function decoded<T>(ctx: TransactionContext, programId: string, ops: ReadonlyMap<string, T>, outerOnly = false): (Found & { op: T })[] {
  const out: (Found & { op: T })[] = [];
  for (const { ix, ref } of ctx.instructions) {
    if (ix.programId !== programId || (outerOnly && ref.kind !== "OUTER_INSTRUCTION")) continue;
    const bytes = bytesOf(ix.data);
    const op = ops.get(discriminator(bytes) ?? "");
    if (bytes && op !== undefined) out.push({ ix, ref, bytes, op });
  }
  return out;
}

/** The first signer whose balances moved, else the fee payer: who a lending call was for. */
const movingSigner = (ctx: TransactionContext) => ctx.signers.find((s) => moved(ctx, s)) ?? ctx.feePayer;

function reading(
  ctx: TransactionContext,
  base: { category: EventCategory; action: string; programId: string; actor: string; evidence: EvidenceRef[] },
  agrees: boolean,
  disagreement: string,
): Interpretation {
  const { flows, warnings } = actorFlows(ctx, base.actor);
  return {
    category: base.category,
    action: base.action,
    actor: base.actor,
    confidence: agrees ? "HIGH" : "MEDIUM",
    protocol: protocolOf(ctx, base.programId),
    evidence: base.evidence,
    flows,
    warnings: agrees ? warnings : [disagreement, ...warnings],
  };
}

// Jupiter v6 routes. `authority`: index of user_transfer_authority in the instruction's accounts.
const JUPITER_V6 = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
const JUPITER_ROUTES = new Map([
  ["229,23,203,151,122,227,173,42", { authority: 1 }], // route
  ["193,32,155,51,65,214,156,129", { authority: 2 }], // shared_accounts_route
  ["208,51,239,151,123,43,237,92", { authority: 1 }], // exact_out_route
  ["176,209,105,168,154,125,69,62", { authority: 2 }], // shared_accounts_exact_out_route
]);

/** A Jupiter route: one swap for the wallet that authorised it, however many pools it hopped through. */
export const jupiterSwap: Interpreter = {
  id: "jupiter-swap",
  interpret: (ctx) => {
    const routes = decoded(ctx, JUPITER_V6, JUPITER_ROUTES);
    const route = routes[0];
    const actor = route?.ix.accounts[route.op.authority];
    if (!route || !actor) return null;
    const result = reading(
      ctx,
      { category: "SWAP", action: "SWAP", programId: JUPITER_V6, actor, evidence: routes.map((r) => r.ref) },
      spentAny(ctx, actor) && receivedAny(ctx, actor),
      "The route's authority didn't both give up and receive an asset in this transaction.",
    );
    if (routes.length > 1) result.warnings = [`${routes.length} Jupiter routes in one transaction; read as one swap.`, ...(result.warnings ?? [])];
    return result;
  },
};

// Marinade liquid staking. `actor`: index of the user's account, where checked against mainnet.
const MARINADE = "MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD";
const MARINADE_OPS = new Map<string, { category: EventCategory; action: string; actor: number | null; gives?: string; gets?: string }>([
  ["242,35,198,137,82,225,242,182", { category: "STAKE", action: "LIQUID_STAKE", actor: 6, gives: NATIVE_SOL }], // deposit
  ["110,130,115,41,164,102,2,59", { category: "STAKE", action: "LIQUID_STAKE", actor: null }], // deposit_stake_account
  ["30,30,119,240,191,227,12,16", { category: "UNSTAKE", action: "LIQUID_UNSTAKE", actor: 6, gets: NATIVE_SOL }], // liquid_unstake
  ["97,167,144,107,117,190,128,36", { category: "UNSTAKE", action: "ORDER_UNSTAKE", actor: null }], // order_unstake
  ["62,198,214,193,213,159,108,210", { category: "UNSTAKE", action: "CLAIM", actor: null, gets: NATIVE_SOL }], // claim
]);

/** A top-level Marinade call: SOL in for mSOL, or mSOL back for SOL. Routed through Marinade by an aggregator, it's that swap. */
export const marinadeStake: Interpreter = {
  id: "marinade-liquid-stake",
  interpret: (ctx) => {
    const [call] = decoded(ctx, MARINADE, MARINADE_OPS, true);
    const actor = call && ((call.op.actor !== null ? call.ix.accounts[call.op.actor] : null) ?? ctx.feePayer);
    if (!call || !actor) return null;
    const { op } = call;
    const agrees = moved(ctx, actor) && (!op.gives || spentAny(ctx, actor, op.gives)) && (!op.gets || receivedAny(ctx, actor, op.gets));
    return reading(ctx, { category: op.category, action: op.action, programId: MARINADE, actor, evidence: [call.ref] }, agrees, "Marinade's instruction and the wallet's balances don't agree.");
  },
};

// Sanctum Unstake (unstake.it). Accounts: unstaker, stake account, destination, pool, pool SOL reserves, …
const SANCTUM_UNSTAKE = "unpXTU2Ndrc7WWNyEhQWe4udTzSibLPi25SXv2xbCHQ";
const SANCTUM_UNSTAKES = new Map([
  ["90,95,107,42,205,124,50,225", "unstake"],
  ["125,93,190,135,89,174,142,149", "unstake_wsol"],
]);

/**
 * An instant unstake: the wallet hands a stake account's authorities to the
 * pool and is paid SOL (or wSOL) from its reserves, less a fee. The stake
 * account's balance doesn't move, so balances alone read it as the reserves
 * sending the wallet SOL.
 */
export const sanctumUnstake: Interpreter = {
  id: "sanctum-unstake",
  interpret: (ctx) => {
    const [call] = decoded(ctx, SANCTUM_UNSTAKE, SANCTUM_UNSTAKES, true);
    const actor = call?.ix.accounts[0];
    if (!call || !actor) return null;
    const result = reading(
      ctx,
      { category: "UNSTAKE", action: "INSTANT_UNSTAKE", programId: SANCTUM_UNSTAKE, actor, evidence: [call.ref] },
      receivedAny(ctx, actor),
      "The unstaker wasn't paid in this transaction.",
    );
    return { ...result, stake: stakeAccount(ctx, call.ix.accounts[1], call.ix.accounts[3]) };
  },
};

// Kamino Lend (klend). Supplying and repaying take value in; withdrawing and borrowing give it back.
const KAMINO = "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD";
const KAMINO_OPS = new Map([
  ["169,201,30,126,6,205,102,68", "DEPOSIT"], // deposit_reserve_liquidity
  ["234,117,181,125,185,142,220,29", "WITHDRAW"], // redeem_reserve_collateral
  ["129,199,4,2,222,39,26,46", "DEPOSIT"], // deposit_reserve_liquidity_and_obligation_collateral
  ["216,224,191,27,204,151,102,175", "DEPOSIT"], // …_v2
  ["75,93,93,220,34,150,218,196", "WITHDRAW"], // withdraw_obligation_collateral_and_redeem_reserve_collateral
  ["235,52,119,152,149,197,20,7", "WITHDRAW"], // …_v2
  ["108,209,4,72,21,22,118,133", "SUPPLY_COLLATERAL"], // deposit_obligation_collateral
  ["137,145,151,94,167,113,4,145", "SUPPLY_COLLATERAL"], // …_v2
  ["37,116,205,103,243,192,92,198", "REMOVE_COLLATERAL"], // withdraw_obligation_collateral
  ["202,249,117,114,231,192,47,138", "REMOVE_COLLATERAL"], // …_v2
  ["121,127,18,204,73,245,225,65", "BORROW"], // borrow_obligation_liquidity
  ["161,128,143,245,171,199,194,6", "BORROW"], // …_v2
  ["145,178,13,225,76,240,147,72", "REPAY"], // repay_obligation_liquidity
  ["116,174,213,76,180,53,210,144", "REPAY"], // …_v2
]);
const PAYS_IN = new Set(["DEPOSIT", "SUPPLY_COLLATERAL", "REPAY"]);

/**
 * Top-level calls to one lending program. Several in one transaction (a
 * leveraged loop, say) are named together and kept MEDIUM; one called from
 * inside another program is that program's action and left to the generic readers.
 */
function lending(id: string, programId: string, ops: ReadonlyMap<string, string>): Interpreter {
  return {
    id,
    interpret: (ctx) => {
      const calls = decoded(ctx, programId, ops, true);
      const actor = movingSigner(ctx);
      if (calls.length === 0 || !actor) return null;
      const actions = [...new Set(calls.map((c) => c.op))];
      const evidence = calls.map((c) => c.ref);
      const name = protocolOf(ctx, programId)?.name ?? "The lending program";
      if (actions.length > 1) {
        return reading(ctx, { category: "LENDING", action: actions.join("+"), programId, actor, evidence }, false, `Several lending actions in one transaction: ${actions.join(", ")}.`);
      }
      const [action] = actions;
      const agrees = PAYS_IN.has(action) ? spentAny(ctx, actor) : receivedAny(ctx, actor);
      return reading(ctx, { category: "LENDING", action, programId, actor, evidence }, agrees, `${name}'s ${action} doesn't match the wallet's balances.`);
    },
  };
}

export const kaminoLending = lending("kamino-lending", KAMINO, KAMINO_OPS);

// Drift v2 spot deposits and withdrawals. Account order follows Drift's public IDL.
const DRIFT = "dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH";
const DRIFT_OPS = new Map([
  ["242,35,198,137,82,225,242,182", { action: "DEPOSIT", token: 5 }],
  ["183,18,70,156,148,109,161,34", { action: "WITHDRAW", token: 6 }],
]);

export const driftSpot: Interpreter = {
  id: "drift-spot",
  interpret: (ctx) => {
    const [call] = decoded(ctx, DRIFT, DRIFT_OPS, true);
    const actor = call?.ix.accounts[3];
    const vault = call?.ix.accounts[4];
    const tokenAccount = call?.ix.accounts[call.op.token];
    const amount = call && reader(call.bytes).u64(10);
    if (!call || !actor || !vault || !tokenAccount || amount === null) return null;
    const change = ctx.tx.tokenChanges.find((t) => t.account === tokenAccount && t.owner === actor);
    const agrees = !!change && BigInt(change.delta) === (call.op.action === "WITHDRAW" ? amount : -amount);
    const net = netByAddress(ctx.deltas);
    const flows = [...new Set(ctx.deltas.map((d) => d.assetId))].flatMap((assetId) => {
      const delta = netOf(net, assetId, actor);
      return delta === 0n ? [] : [{ assetId, amount: (delta < 0n ? -delta : delta).toString(), from: delta < 0n ? actor : null, to: delta > 0n ? actor : null, source: "balance" as const, role: delta < 0n ? "spent" as const : "received" as const }];
    });
    const settled = withSettlement(ctx.deltas, flows);
    return {
      category: "LENDING", action: call.op.action, actor, protocol: protocolOf(ctx, DRIFT), evidence: [call.ref],
      confidence: agrees ? "HIGH" : "MEDIUM",
      flows: settled.flows,
      warnings: [...(agrees ? [] : ["Drift's spot instruction amount doesn't match the wallet's token balance change."]), ...settled.warnings],
      infrastructure: [
        { address: vault, role: "VAULT", label: "Drift spot market vault" },
        ...(call.op.action === "WITHDRAW" && call.ix.accounts[5] ? [{ address: call.ix.accounts[5], role: "PDA" as const, label: "Drift signer" }] : []),
      ],
    };
  },
};

// marginfi v2.
const MARGINFI = "MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA";
export const marginfiLending = lending(
  "marginfi-lending",
  MARGINFI,
  new Map([
    ["171,94,235,103,82,64,212,140", "DEPOSIT"], // lending_account_deposit
    ["36,72,74,19,210,210,192,192", "WITHDRAW"], // lending_account_withdraw
    ["4,126,116,53,48,5,212,31", "BORROW"], // lending_account_borrow
    ["79,209,172,177,222,51,173,151", "REPAY"], // lending_account_repay
  ]),
);

// SPL stake pools: the SPL program and Sanctum's single- and multi-validator deployments of it.
// Not Anchor: the first data byte is the instruction's index.
const STAKE_POOLS = new Set(["SPoo1Ku8WFXoNDMHPsrGSTSG1Y47rzgn41SLUNakuHy", "SP12tWFxD9oJsVWNavTTBZvMbA6gkAmxtVgxdqvyvhY", "SPMBzsVUuoHA4Jm6KunbsotaahvVikZs1JyTW6iJvbn"]);
const STAKE_POOL_OPS = new Map<number, { category: EventCategory; action: string }>([
  [9, { category: "STAKE", action: "LIQUID_STAKE" }], // DepositStake
  [10, { category: "UNSTAKE", action: "LIQUID_UNSTAKE" }], // WithdrawStake
  [14, { category: "STAKE", action: "LIQUID_STAKE" }], // DepositSol
  [16, { category: "UNSTAKE", action: "LIQUID_UNSTAKE" }], // WithdrawSol
  [23, { category: "STAKE", action: "LIQUID_STAKE" }], // DepositStakeWithSlippage
  [24, { category: "UNSTAKE", action: "LIQUID_UNSTAKE" }], // WithdrawStakeWithSlippage
  [25, { category: "STAKE", action: "LIQUID_STAKE" }], // DepositSolWithSlippage
  [26, { category: "UNSTAKE", action: "LIQUID_UNSTAKE" }], // WithdrawSolWithSlippage
]);

/**
 * A deposit into or withdrawal from a stake pool, at any depth: a router
 * (Sanctum's, say) calling the pool is still the wallet staking. Pool upkeep
 * (balance updates, rebalancing) isn't a user action and is left alone.
 */
export const splStakePool: Interpreter = {
  id: "spl-stake-pool",
  interpret: (ctx) => {
    for (const { ix, ref } of ctx.instructions) {
      if (!STAKE_POOLS.has(ix.programId)) continue;
      const op = STAKE_POOL_OPS.get(bytesOf(ix.data)?.[0] ?? -1);
      const actor = op && movingSigner(ctx);
      if (!op || !actor) continue;
      const agrees = op.category === "STAKE" ? spentAny(ctx, actor) && receivedAny(ctx, actor) : receivedAny(ctx, actor);
      const programId = ctx.instructions.find((i) => i.ref.kind === "OUTER_INSTRUCTION" && protocolOf(ctx, i.ix.programId))?.ix.programId ?? ix.programId;
      return reading(ctx, { ...op, programId, actor, evidence: [ref] }, agrees, "The stake pool's instruction and the wallet's balances don't agree.");
    }
    return null;
  },
};

// Circle CCTP. Message fields are big-endian; instruction arguments are Borsh (little-endian).
const CCTP = {
  tokenMessenger: { "CCTPiPYPc6AsJuwueEnWgSgucamXDZwBd53dQ11YiKX3": 1, "CCTPV2vPZJS2u2BBsUoscuikbYjnpFmbFsvVuJdgUMQe": 2 } as Record<string, 1 | 2>,
  messageTransmitter: { "CCTPmbSD7gX1bxKPAmg77w8oFzNFpaQiQUWD43TKaecd": 1, "CCTPV2Sm4AdWt5296sk4P66VBZ7bEhcARwFaaS9YPbeC": 2 } as Record<string, 1 | 2>,
};
const BURNS = new Map([
  ["215,60,61,46,114,55,128,176", "deposit_for_burn"],
  ["111,245,62,131,204,108,223,155", "deposit_for_burn_with_hook"],
]);
const RECEIVE = new Map([["38,144,127,225,31,225,238,25", "receive_message"]]);
/** Circle's domain numbers. One the code doesn't know is kept as a number, not guessed. */
const CCTP_DOMAINS: Record<number, string> = {
  0: "ethereum",
  1: "avalanche",
  2: "optimism",
  3: "arbitrum",
  4: "noble",
  5: "solana",
  6: "base",
  7: "polygon",
  8: "sui",
  9: "aptos",
  10: "unichain",
  11: "linea",
  12: "codex",
  13: "sonic",
  14: "worldchain",
};
const chain = (domain: number) => CCTP_DOMAINS[domain] ?? `cctp-domain-${domain}`;
/** A bytes32 address: an EVM address when left-padded with zeros. */
const remote = (bytes: Uint8Array | null) => (!bytes ? null : bytes.subarray(0, 12).every((b) => b === 0) ? `0x${hex(bytes.subarray(12))}` : `0x${hex(bytes)}`);

/** The u64 a program returned, when the RPC reported return data for it. */
function returnedU64(ctx: TransactionContext, programId: string): bigint | null {
  const data = (ctx.tx.raw as { meta?: { returnData?: { programId?: string; data?: [string, string] } } } | null)?.meta?.returnData;
  if (data?.programId !== programId || !data.data?.[0]) return null;
  const bytes = Uint8Array.from(atob(data.data[0]), (c) => c.charCodeAt(0));
  return bytes.length >= 8 ? reader(bytes).u64(0) : null;
}

function cctpOut(ctx: TransactionContext): Interpretation | null {
  for (const [programId, version] of Object.entries(CCTP.tokenMessenger)) {
    const [burn] = decoded(ctx, programId, BURNS);
    if (!burn) continue;
    const r = reader(burn.bytes);
    const amount = r.u64(8);
    const domain = r.u32(16);
    const owner = burn.ix.accounts[0];
    if (amount === null || domain === null || !owner) return null;
    const mint = burn.ix.accounts[version === 1 ? 9 : 10] ?? null;
    const messageAccount = burn.ix.accounts[version === 1 ? 10 : 11];
    const nonce = version === 1 ? returnedU64(ctx, programId) : null;
    const bridge: BridgeEnvelope = {
      direction: "OUT",
      sourceChain: "solana",
      destinationChain: chain(domain),
      asset: mint ? { assetId: mint, amount: amount.toString() } : null,
      remoteAddress: remote(r.slice(20, 32)),
      identifiers: {
        protocol: `cctp-v${version}`,
        destinationDomain: String(domain),
        ...(messageAccount ? { messageAccount } : {}),
        ...(nonce !== null ? { nonce: nonce.toString() } : {}),
      },
    };
    const burned = ctx.summaryOf(owner).outflows.find((c) => c.assetId === mint);
    const result = reading(
      ctx,
      { category: "BRIDGE", action: "BRIDGE_OUT", programId, actor: owner, evidence: [burn.ref, ...(nonce !== null ? [{ kind: "RETURN_DATA", programId } as const] : [])] },
      burned?.delta === `-${amount}`,
      "The burned amount doesn't match the sender's balance change.",
    );
    return { ...result, bridge };
  }
  return null;
}

function cctpIn(ctx: TransactionContext): Interpretation | null {
  for (const [programId, version] of Object.entries(CCTP.messageTransmitter)) {
    const [receive] = decoded(ctx, programId, RECEIVE);
    if (!receive) continue;
    const length = reader(receive.bytes).u32(8);
    const message = length !== null ? reader(receive.bytes).slice(12, length) : null;
    if (!message) return null;
    const m = reader(message);
    const body = version === 1 ? 116 : 148;
    const source = m.u32(4, false);
    const destination = m.u32(8, false);
    const nonce = version === 1 ? m.u64(12, false)?.toString() : (m.slice(12, 32) && hex(m.slice(12, 32)!));
    const mintRecipient = m.address(body + 36);
    const amount = m.slice(body + 68, 32);
    // Not a token burn message (CCTP carries other messages too).
    if (source === null || destination === null || !nonce || !mintRecipient || !amount || amount.subarray(0, 24).some((b) => b !== 0)) return null;
    const account = ctx.tx.tokenChanges.find((t) => t.account === mintRecipient);
    const actor = account?.owner ?? mintRecipient;
    const bridge: BridgeEnvelope = {
      direction: "IN",
      sourceChain: chain(source),
      destinationChain: chain(destination),
      asset: account ? { assetId: account.mint, amount: reader(amount).u64(24, false)!.toString() } : null,
      remoteAddress: remote(m.slice(body + 100, 32)),
      identifiers: { protocol: `cctp-v${version}`, sourceDomain: String(source), nonce },
    };
    const result = reading(
      ctx,
      { category: "BRIDGE", action: "BRIDGE_IN", programId, actor, evidence: [receive.ref] },
      account ? receivedAny(ctx, actor, account.mint) : false,
      "The message's recipient didn't receive tokens in this transaction.",
    );
    return { ...result, bridge };
  }
  return null;
}

/** CCTP burns (out) and mints (in): the Solana side of a USDC bridge, with what could find the other side. */
export const cctpBridge: Interpreter = {
  id: "cctp-bridge",
  interpret: (ctx) => cctpOut(ctx) ?? cctpIn(ctx),
};

// Relay Depository v2. Both take (amount: u64, id: [u8; 32]); accounts: relayer config, sender, depositor, vault, mint (token only).
const RELAY_DEPOSITORY = "99vQwtBwYtrqqD9YSXbdum3KBdxPAVxYTaQ3cfnJSrN2";
const RELAY_DEPOSITS = new Map([
  ["11,156,96,218,39,163,180,19", "token"], // deposit_token
  ["13,158,13,223,95,213,28,6", "native"], // deposit_native
]);

/**
 * A Relay deposit: value handed to Relay's solver to deliver on another
 * chain. Often the tail of a Jupiter route in the same transaction, so the
 * depositor spends one asset and Relay receives another. The destination
 * chain and recipient live off-chain, keyed by the memo's request id.
 */
export const relayBridge: Interpreter = {
  id: "relay-bridge",
  interpret: (ctx) => {
    const [deposit] = decoded(ctx, RELAY_DEPOSITORY, RELAY_DEPOSITS);
    if (!deposit) return null;
    const r = reader(deposit.bytes);
    const actor = deposit.ix.accounts[2];
    const amount = r.u64(8);
    const id = r.slice(16, 32);
    if (!actor || amount === null || !id) return null;
    const assetId = deposit.op === "native" ? NATIVE_SOL : (deposit.ix.accounts[4] ?? null);
    const memo = ctx.tx.instructions.find((ix) => (MEMO_PROGRAMS as readonly string[]).includes(ix.programId) && typeof ix.info === "string" && /^0x[0-9a-f]{64}$/i.test(ix.info));
    const bridge: BridgeEnvelope = {
      direction: "OUT",
      sourceChain: "solana",
      destinationChain: "unknown",
      asset: assetId ? { assetId, amount: amount.toString() } : null,
      remoteAddress: null,
      identifiers: { protocol: "relay", depositId: `0x${hex(id)}`, ...(memo ? { requestId: memo.info as string } : {}) },
    };
    const result = reading(
      ctx,
      { category: "BRIDGE", action: "BRIDGE_OUT", programId: RELAY_DEPOSITORY, actor, evidence: [deposit.ref] },
      spentAny(ctx, actor),
      "The depositor's balances didn't go down in this transaction.",
    );
    return { ...result, bridge };
  },
};

import { NATIVE_SOL } from "@/lib/assets/assets";
import type { CanonicalTransaction } from "@/lib/solana/canonical";
import type { SemanticFlow } from "./events";

export type Delta = { address: string; account: string; assetId: string; delta: bigint };

const keyOf = (assetId: string, address: string) => `${assetId}|${address}`;

/** Value deltas by owner (wallet for SOL), with the payer's fee added back. Token accounts' rent lamports are left out. */
export function deltas(tx: CanonicalTransaction, feePayer: string | null): Delta[] {
  const tokenAccounts = new Set(tx.tokenChanges.map((t) => t.account));
  const out: Delta[] = [];
  for (const n of tx.nativeChanges) {
    if (tokenAccounts.has(n.account)) continue;
    const delta = BigInt(n.delta) + (n.account === feePayer ? BigInt(tx.feeLamports) : 0n);
    if (delta !== 0n) out.push({ address: n.account, account: n.account, assetId: NATIVE_SOL, delta });
  }
  for (const t of tx.tokenChanges) {
    const delta = BigInt(t.delta);
    if (delta !== 0n) out.push({ address: t.owner ?? t.account, account: t.account, assetId: t.mint, delta });
  }
  return out;
}

/**
 * Pair senders with receivers per asset. Exact with one sender (or one
 * receiver) whose amount covers the other side; otherwise each side is kept
 * with the other left unknown rather than guessed.
 */
export function balanceFlows(all: Delta[]): { flows: SemanticFlow[]; ambiguousAssets: string[] } {
  const byAddress = new Map<string, bigint>();
  const assets: string[] = [];
  for (const d of all) {
    const key = `${d.assetId}|${d.address}`;
    if (!assets.includes(d.assetId)) assets.push(d.assetId);
    byAddress.set(key, (byAddress.get(key) ?? 0n) + d.delta);
  }
  const flows: SemanticFlow[] = [];
  const ambiguousAssets: string[] = [];
  for (const assetId of assets) {
    const net = [...byAddress].filter(([key, v]) => key.startsWith(`${assetId}|`) && v !== 0n).map(([key, v]) => ({ address: key.slice(assetId.length + 1), v }));
    const senders = net.filter((n) => n.v < 0n).map((n) => ({ address: n.address, amount: -n.v }));
    const receivers = net.filter((n) => n.v > 0n).map((n) => ({ address: n.address, amount: n.v }));
    const sum = (xs: { amount: bigint }[]) => xs.reduce((s, x) => s + x.amount, 0n);
    const flow = (amount: bigint, from: string | null, to: string | null): SemanticFlow => ({ assetId, amount: amount.toString(), from, to, source: "balance" });
    if (senders.length === 1 && receivers.length > 0 && sum(receivers) <= senders[0].amount) {
      flows.push(...receivers.map((r) => flow(r.amount, senders[0].address, r.address)));
      const rest = senders[0].amount - sum(receivers);
      if (rest > 0n) flows.push(flow(rest, senders[0].address, null));
    } else if (receivers.length === 1 && senders.length > 0 && sum(senders) <= receivers[0].amount) {
      flows.push(...senders.map((s) => flow(s.amount, s.address, receivers[0].address)));
      const rest = receivers[0].amount - sum(senders);
      if (rest > 0n) flows.push(flow(rest, null, receivers[0].address));
    } else {
      if (senders.length > 0 && receivers.length > 0) ambiguousAssets.push(assetId);
      flows.push(...senders.map((s) => flow(s.amount, s.address, null)), ...receivers.map((r) => flow(r.amount, null, r.address)));
    }
  }
  return { flows, ambiguousAssets };
}

/** Net change per asset and address. */
export function netByAddress(all: Delta[]): Map<string, bigint> {
  const net = new Map<string, bigint>();
  for (const d of all) net.set(keyOf(d.assetId, d.address), (net.get(keyOf(d.assetId, d.address)) ?? 0n) + d.delta);
  return net;
}

export const netOf = (net: Map<string, bigint>, assetId: string, address: string) => net.get(keyOf(assetId, address)) ?? 0n;

/**
 * `flows` plus settlement flows for whatever balances moved beyond them
 * (routing through pools, escrow and account closures), so the event's flows
 * always add up to the observed changes. Compressed NFT flows have no balances
 * and are left out of the sum.
 */
export function withSettlement(all: Delta[], flows: SemanticFlow[]): { flows: SemanticFlow[]; warnings: string[] } {
  const residual = netByAddress(all);
  for (const f of flows) {
    if (f.source !== "balance") continue;
    if (f.from) residual.set(keyOf(f.assetId, f.from), netOf(residual, f.assetId, f.from) + BigInt(f.amount));
    if (f.to) residual.set(keyOf(f.assetId, f.to), netOf(residual, f.assetId, f.to) - BigInt(f.amount));
  }
  const rest: Delta[] = [...residual]
    .filter(([, delta]) => delta !== 0n)
    .map(([key, delta]) => {
      const [assetId, address] = [key.slice(0, key.indexOf("|")), key.slice(key.indexOf("|") + 1)];
      return { assetId, address, account: address, delta };
    });
  const settlement = balanceFlows(rest);
  return {
    flows: [...flows, ...settlement.flows.map((f) => ({ ...f, role: "settlement" as const }))],
    warnings: settlement.ambiguousAssets.map((assetId) => `Balances can't pair the remaining senders and receivers of ${assetId}.`),
  };
}

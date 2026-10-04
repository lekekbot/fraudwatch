import type { FilterableTx, TxFilter } from "@/lib/timeline/filter";
import type { FraudWatchCase, HideRule } from "./model";

type Hiding = Pick<FraudWatchCase, "hiddenSignatures" | "shownSignatures" | "hideRules">;

const abs = (v: bigint) => (v < BigInt(0) ? -v : v);

/** Whether a rule's conditions all hold for a transaction; a rule without conditions never matches. */
export function ruleMatches(rule: HideRule, tx: FilterableTx, tagsOf: (address: string) => readonly string[] = () => []): boolean {
  const { summary } = tx;
  const changes = [...summary.inflows, ...summary.outflows];
  const moved = [...new Set(changes.map((c) => c.assetId))];
  const checks: boolean[] = [];
  if (rule.kinds?.length) checks.push(rule.kinds.includes(summary.kind));
  if (rule.onlyAssets?.length) checks.push(moved.length > 0 && moved.every((a) => rule.onlyAssets!.includes(a)));
  if (rule.amount) {
    const { assetId, op, value } = rule.amount;
    const target = BigInt(value);
    const holds = (moved: bigint) => (op === "lt" ? moved < target : op === "gt" ? moved > target : op === "eq" ? moved === target : moved !== target);
    const of = changes.filter((c) => c.assetId === assetId);
    checks.push(of.length > 0 && of.every((c) => holds(abs(BigInt(c.delta)))));
  }
  if (rule.counterparties?.length) checks.push(tx.addresses.some((a) => rule.counterparties!.includes(a)));
  if (rule.tags?.length) checks.push(tx.addresses.some((a) => tagsOf(a).some((t) => rule.tags!.includes(t))));
  if (rule.protocols?.length) checks.push(tx.protocols.some((p) => rule.protocols!.includes(p)));
  return checks.length > 0 && checks.every(Boolean);
}

/** Why a transaction is off the map, or null when it's shown. */
export type HiddenReason = "manual" | HideRule | null;

/**
 * Why a transaction is off the map: hidden by hand, by the first enabled rule
 * that matches, or not at all. An exception beats every rule.
 */
export function hiddenBy(c: Hiding, tx: FilterableTx, tagsOf?: (address: string) => readonly string[]): HiddenReason {
  if (c.hiddenSignatures?.includes(tx.signature)) return "manual";
  if (c.shownSignatures?.includes(tx.signature)) return null;
  return c.hideRules?.find((r) => r.enabled && ruleMatches(r, tx, tagsOf)) ?? null;
}

/** Hides transactions by hand; any exceptions for them are dropped. */
export function hideTransactions<C extends FraudWatchCase>(c: C, signatures: readonly string[], now = new Date()): C {
  const add = new Set(signatures);
  return {
    ...c,
    hiddenSignatures: [...new Set([...(c.hiddenSignatures ?? []), ...signatures])],
    shownSignatures: (c.shownSignatures ?? []).filter((s) => !add.has(s)),
    updatedAt: now.toISOString(),
  };
}

/**
 * Brings transactions back. `ruleMatched` are those a rule would still hide;
 * they become exceptions so they stay visible.
 */
export function unhideTransactions<C extends FraudWatchCase>(c: C, signatures: readonly string[], ruleMatched: readonly string[] = [], now = new Date()): C {
  const remove = new Set(signatures);
  return {
    ...c,
    hiddenSignatures: (c.hiddenSignatures ?? []).filter((s) => !remove.has(s)),
    shownSignatures: [...new Set([...(c.shownSignatures ?? []), ...ruleMatched.filter((s) => remove.has(s))])],
    updatedAt: now.toISOString(),
  };
}

/** Adds or replaces a rule by id. */
export function saveRule<C extends FraudWatchCase>(c: C, rule: HideRule, now = new Date()): C {
  const rules = c.hideRules ?? [];
  const next = rules.some((r) => r.id === rule.id) ? rules.map((r) => (r.id === rule.id ? rule : r)) : [...rules, rule];
  return { ...c, hideRules: next, updatedAt: now.toISOString() };
}

export function deleteRule<C extends FraudWatchCase>(c: C, id: string, now = new Date()): C {
  return { ...c, hideRules: (c.hideRules ?? []).filter((r) => r.id !== id), updatedAt: now.toISOString() };
}

/**
 * Undoes one hide or unhide: re-applies the difference between `before` and
 * `after` in reverse onto `latest`, so changes made since are kept.
 */
export function revertHiding<C extends FraudWatchCase>(latest: C, before: Hiding, after: Hiding, now = new Date()): C {
  const revert = (current: string[] = [], was: string[] = [], became: string[] = []) => {
    const added = new Set(became.filter((s) => !was.includes(s)));
    const removed = was.filter((s) => !became.includes(s));
    return [...new Set([...current.filter((s) => !added.has(s)), ...removed])];
  };
  return {
    ...latest,
    hiddenSignatures: revert(latest.hiddenSignatures, before.hiddenSignatures, after.hiddenSignatures),
    shownSignatures: revert(latest.shownSignatures, before.shownSignatures, after.shownSignatures),
    updatedAt: now.toISOString(),
  };
}

/**
 * A starting point for "Make a rule" after a hide: the transaction types that
 * were hidden (when there are a few), plus the active filter's protocols, tags
 * and address. The editor's live count lets the user check and adjust it.
 */
export function ruleFrom(hidden: readonly FilterableTx[], filter: Pick<TxFilter, "protocols" | "tags" | "address">, id: string, name: string): HideRule {
  const kinds = [...new Set(hidden.map((row) => row.summary.kind))];
  return {
    id,
    name,
    enabled: true,
    ...(kinds.length > 0 && kinds.length <= 3 ? { kinds } : {}),
    ...(filter.protocols.size ? { protocols: [...filter.protocols] } : {}),
    ...(filter.tags.size ? { tags: [...filter.tags] } : {}),
    ...(filter.address ? { counterparties: [filter.address] } : {}),
  };
}

/**
 * Each lane's transactions with the lane's own wallet counted as involved:
 * a rule about an address then also covers that wallet's own lane.
 */
export function withLaneWallets(lanes: Iterable<[wallet: string, rows: readonly FilterableTx[]]>): FilterableTx[] {
  const out: FilterableTx[] = [];
  for (const [wallet, rows] of lanes) {
    for (const row of rows) out.push(row.addresses.includes(wallet) ? row : { ...row, addresses: [...row.addresses, wallet] });
  }
  return out;
}

/**
 * Why each transaction is off the map, decided once per signature across
 * every lane's side of it: hidden on one side means hidden on all, since it's
 * one on-chain transaction. Rows should come from `withLaneWallets`.
 */
export function hiddenReasons(c: Hiding, rows: readonly FilterableTx[], tagsOf?: (address: string) => readonly string[]): Map<string, HiddenReason> {
  const out = new Map<string, HiddenReason>();
  for (const row of rows) {
    if (out.get(row.signature)) continue;
    const why = hiddenBy(c, row, tagsOf);
    if (why) out.set(row.signature, why);
  }
  return out;
}

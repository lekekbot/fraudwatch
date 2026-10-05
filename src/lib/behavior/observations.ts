import { NATIVE_SOL, WRAPPED_SOL_MINT } from "@/lib/assets/assets";
import type { SemanticEvent } from "@/lib/semantic/events";
import { projectEvent } from "@/lib/semantic/projection";

/**
 * Patterns across several semantic events, each read by a deterministic rule
 * that records which events triggered it, the thresholds it used and what it
 * calculated. A summary of behaviour, never a verdict: nothing here scores or
 * ranks a wallet.
 */

export type BehaviorType =
  | "RAPID_FORWARDING"
  | "FUND_SPLIT"
  | "CONSOLIDATION"
  | "REPEATED_COUNTERPARTY"
  | "CIRCULAR_MOVEMENT"
  | "BRIDGE_MILESTONE"
  | "EXCHANGE_DEPOSIT";

/** What one event contributed to an observation. */
export type ObservationEvent = {
  eventId: string;
  signature: string;
  /** ms. */
  time: number;
  role: "source" | "destination" | "interaction" | "milestone";
  assetId?: string;
  /** Base units. */
  amount?: string;
  counterparty?: string | null;
};

export type BehaviorObservation = {
  /** `<type>:<wallet>:<asset>:<first event id>`; the same events always give the same id. */
  id: string;
  type: BehaviorType;
  wallet: string;
  /** The span it covers, ms. */
  start: number;
  end: number;
  /** In time order. */
  events: ObservationEvent[];
  /** The rule, in words. */
  rule: string;
  /** The thresholds the rule was checked against. */
  thresholds: Record<string, number>;
  /** What the rule calculated. Keys ending in `Amount` are base units of `assetId`. */
  values: Record<string, string | number>;
  assetId: string | null;
};

/**
 * Every detector threshold, in one place. Windows are seconds; ratios are
 * fractions. Dust floors keep fees, rent and poisoning dust out of every rule.
 */
export const BEHAVIOR_THRESHOLDS = {
  rapidForwarding: { windowSeconds: 600, minCoverage: 0.8, maxOutgoingRatio: 1.25 },
  /** A receipt shortly before counts as the split's source only when the split is `sourceMinCoverage`–`sourceMaxRatio` of it. */
  fundSplit: { windowSeconds: 3600, minBranches: 3, sourceMinCoverage: 0.8, sourceMaxRatio: 1.25 },
  consolidation: { windowSeconds: 3600, minSources: 3 },
  repeatedCounterparty: { minInteractions: 5 },
  circularMovement: { windowSeconds: 7 * 86_400, minReturnRatio: 0.5 },
  /** Deposits to one exchange each within this long of the last read as one run. */
  exchangeDeposit: { groupGapSeconds: 86_400 },
  dust: { minLamports: 10_000_000, minTokenFraction: 0.01 },
} as const;

export type BehaviorThresholds = typeof BEHAVIOR_THRESHOLDS;

/** A value moving between the wallet and someone else, as the rules see it. */
type Move = {
  event: SemanticEvent;
  time: number;
  direction: "in" | "out";
  assetId: string;
  amount: bigint;
  /** The other side, or `bridge:<chain>` for a bridge. */
  counterparty: string;
};

const ZERO = BigInt(0);
const isBridge = (counterparty: string) => counterparty.startsWith("bridge:");
/** Wrapped SOL is SOL moved through a token account; the rules treat them as one asset. */
const assetKey = (assetId: string) => (assetId === WRAPPED_SOL_MINT ? NATIVE_SOL : assetId);

/**
 * The wallet's meaningful value movements: transfers to and from other
 * wallets, and bridges. Swaps, NFT settlement, protocol routing, fees, rent,
 * infrastructure, self-transfers and dust never become moves.
 */
function movesOf(wallet: string, sequence: readonly { event: SemanticEvent; time: number }[], t: BehaviorThresholds, decimalsOf: (assetId: string) => number | undefined): Move[] {
  const floor = (assetId: string) => {
    if (assetId === NATIVE_SOL) return BigInt(t.dust.minLamports);
    const decimals = decimalsOf(assetId);
    return decimals === undefined ? BigInt(1) : BigInt(Math.max(1, Math.round(10 ** decimals * t.dust.minTokenFraction)));
  };
  const moves: Move[] = [];
  for (const { event, time } of sequence) {
    if (event.category === "TRANSFER") {
      const projection = projectEvent(event, wallet);
      const infrastructure = new Set(event.infrastructure.map((i) => i.address));
      for (const f of [...(projection?.outgoing ?? []), ...(projection?.incoming ?? [])]) {
        if (f.source !== "balance" || f.role === "settlement" || f.role === "rent") continue;
        const direction = f.from === wallet ? "out" : "in";
        const counterparty = direction === "out" ? f.to : f.from;
        if (!counterparty || counterparty === wallet || infrastructure.has(counterparty)) continue;
        const assetId = assetKey(f.assetId);
        const amount = BigInt(f.amount);
        if (amount >= floor(assetId)) moves.push({ event, time, direction, assetId, amount, counterparty });
      }
    } else if (event.category === "BRIDGE" && event.bridge?.asset) {
      const out = event.bridge.direction === "OUT";
      const actor = event.participants[0]?.address;
      if (actor !== wallet) continue;
      const assetId = assetKey(event.bridge.asset.assetId);
      const amount = BigInt(event.bridge.asset.amount);
      if (amount >= floor(assetId)) {
        moves.push({ event, time, direction: out ? "out" : "in", assetId, amount, counterparty: `bridge:${out ? event.bridge.destinationChain : event.bridge.sourceChain}` });
      }
    }
  }
  return moves.sort((a, b) => a.time - b.time || a.event.id.localeCompare(b.event.id));
}

const seconds = (from: number, to: number) => Math.round((to - from) / 1000);
const percent = (part: bigint, whole: bigint) => (whole === ZERO ? 0 : Number((part * BigInt(10_000)) / whole) / 100);
const asEvent = (m: Move, role: ObservationEvent["role"]): ObservationEvent => ({
  eventId: m.event.id,
  signature: m.event.signature,
  time: m.time,
  role,
  assetId: m.assetId,
  amount: m.amount.toString(),
  counterparty: m.counterparty,
});

function observation(type: BehaviorType, wallet: string, assetId: string | null, events: ObservationEvent[], rest: Pick<BehaviorObservation, "rule" | "thresholds" | "values">): BehaviorObservation {
  const sorted = [...events].sort((a, b) => a.time - b.time || a.eventId.localeCompare(b.eventId));
  return { id: `${type}:${wallet}:${assetId ?? "-"}:${sorted[0].eventId}`, type, wallet, start: sorted[0].time, end: sorted[sorted.length - 1].time, events: sorted, assetId, ...rest };
}

const byAsset = (moves: Move[]) => {
  const out = new Map<string, Move[]>();
  for (const m of moves) out.set(m.assetId, [...(out.get(m.assetId) ?? []), m]);
  return out;
};

/** Received, then most of it sent on to others soon after. */
function rapidForwarding(wallet: string, moves: Move[], t: BehaviorThresholds["rapidForwarding"]): BehaviorObservation[] {
  const found: BehaviorObservation[] = [];
  for (const [assetId, list] of byAsset(moves)) {
    const used = new Set<Move>();
    for (const incoming of list.filter((m) => m.direction === "in")) {
      const onward: Move[] = [];
      let sent = ZERO;
      for (const m of list) {
        if (sent >= incoming.amount) break;
        // Sent back to whoever sent it is a round trip, not forwarding.
        if (m.direction !== "out" || used.has(m) || m.time <= incoming.time || m.counterparty === incoming.counterparty) continue;
        if (m.time - incoming.time > t.windowSeconds * 1000) break;
        // Far more than came in is the wallet's own balance moving, not this receipt passed on.
        if ((sent + m.amount) * BigInt(100) > incoming.amount * BigInt(Math.round(t.maxOutgoingRatio * 100))) continue;
        onward.push(m);
        sent += m.amount;
      }
      const coverage = percent(sent < incoming.amount ? sent : incoming.amount, incoming.amount);
      if (onward.length === 0 || coverage < t.minCoverage * 100) continue;
      for (const m of onward) used.add(m);
      found.push(
        observation("RAPID_FORWARDING", wallet, assetId, [asEvent(incoming, "source"), ...onward.map((m) => asEvent(m, "destination"))], {
          rule: `Received, then sent on at least ${t.minCoverage * 100}% of it (and no more than ${t.maxOutgoingRatio * 100}%) to others within ${t.windowSeconds} seconds.`,
          thresholds: { ...t },
          values: { windowSeconds: seconds(incoming.time, onward[onward.length - 1].time), incomingAmount: incoming.amount.toString(), outgoingAmount: sent.toString(), coveragePercent: coverage },
        }),
      );
    }
  }
  return found;
}

/** Many senders or many recipients of one asset within a short window. */
function fan(
  wallet: string,
  moves: Move[],
  direction: "in" | "out",
  t: { windowSeconds: number; minParties: number; sourceMinCoverage?: number; sourceMaxRatio?: number },
): BehaviorObservation[] {
  const found: BehaviorObservation[] = [];
  const type: BehaviorType = direction === "out" ? "FUND_SPLIT" : "CONSOLIDATION";
  for (const [assetId, list] of byAsset(moves)) {
    const side = list.filter((m) => m.direction === direction);
    let i = 0;
    while (i < side.length) {
      const window = side.slice(i).filter((m) => m.time - side[i].time <= t.windowSeconds * 1000);
      const parties = new Set(window.map((m) => m.counterparty));
      if (parties.size < t.minParties) {
        i++;
        continue;
      }
      const total = window.reduce((sum, m) => sum + m.amount, ZERO);
      // A split often follows a receipt: the latest one shortly before, of about the split's size, is its source.
      const comparable = (m: Move) =>
        total * BigInt(100) >= m.amount * BigInt(Math.round((t.sourceMinCoverage ?? 0) * 100)) &&
        total * BigInt(100) <= m.amount * BigInt(Math.round((t.sourceMaxRatio ?? Infinity) * 100));
      const source =
        direction === "out"
          ? [...list].reverse().find((m) => m.direction === "in" && m.time <= window[0].time && window[0].time - m.time <= t.windowSeconds * 1000 && comparable(m))
          : undefined;
      found.push(
        observation(type, wallet, assetId, [...(source ? [asEvent(source, "source")] : []), ...window.map((m) => asEvent(m, direction === "out" ? "destination" : "source"))], {
          rule:
            direction === "out"
              ? `Sent to at least ${t.minParties} different recipients within ${t.windowSeconds} seconds.`
              : `Received from at least ${t.minParties} different senders within ${t.windowSeconds} seconds.`,
          thresholds:
            direction === "out"
              ? { windowSeconds: t.windowSeconds, minBranches: t.minParties, sourceMinCoverage: t.sourceMinCoverage ?? 0, sourceMaxRatio: t.sourceMaxRatio ?? 0 }
              : { windowSeconds: t.windowSeconds, minSources: t.minParties },
          values: {
            windowSeconds: seconds(window[0].time, window[window.length - 1].time),
            [direction === "out" ? "branches" : "sources"]: parties.size,
            totalAmount: total.toString(),
            ...(source ? { sourceAmount: source.amount.toString() } : {}),
          },
        }),
      );
      i += window.length;
    }
  }
  return found;
}

/** The same wallet on the other side again and again. */
function repeatedCounterparty(wallet: string, moves: Move[], t: BehaviorThresholds["repeatedCounterparty"]): BehaviorObservation[] {
  const byParty = new Map<string, Move[]>();
  for (const m of moves) if (!isBridge(m.counterparty)) byParty.set(m.counterparty, [...(byParty.get(m.counterparty) ?? []), m]);
  const found: BehaviorObservation[] = [];
  for (const [party, list] of byParty) {
    const events = [...new Map(list.map((m) => [m.event.id, m])).values()];
    if (events.length < t.minInteractions) continue;
    found.push(
      observation("REPEATED_COUNTERPARTY", wallet, null, events.map((m) => asEvent(m, "interaction")), {
        rule: `At least ${t.minInteractions} transfers with the same wallet.`,
        thresholds: { ...t },
        values: {
          counterparty: party,
          interactions: events.length,
          sent: list.filter((m) => m.direction === "out").length,
          received: list.filter((m) => m.direction === "in").length,
          spanSeconds: seconds(events[0].time, events[events.length - 1].time),
        },
      }),
    );
  }
  return found;
}

/** Value that went back to where it came from: sent and mostly returned, or received and mostly sent back. */
function circularMovement(wallet: string, moves: Move[], t: BehaviorThresholds["circularMovement"]): BehaviorObservation[] {
  const found: BehaviorObservation[] = [];
  const used = new Set<Move>();
  for (const first of moves) {
    if (used.has(first) || isBridge(first.counterparty)) continue;
    const back = moves.find(
      (m) =>
        m.direction !== first.direction &&
        !used.has(m) &&
        m.counterparty === first.counterparty &&
        m.assetId === first.assetId &&
        m.time > first.time &&
        m.time - first.time <= t.windowSeconds * 1000 &&
        m.amount * BigInt(100) >= first.amount * BigInt(Math.round(t.minReturnRatio * 100)),
    );
    if (!back) continue;
    used.add(first);
    used.add(back);
    found.push(
      observation("CIRCULAR_MOVEMENT", wallet, first.assetId, [asEvent(first, "source"), asEvent(back, "destination")], {
        rule: `Value went back to the wallet it came from or went to: at least ${t.minReturnRatio * 100}% of it, within ${t.windowSeconds} seconds.`,
        thresholds: { ...t },
        values: {
          counterparty: first.counterparty,
          firstDirection: first.direction,
          windowSeconds: seconds(first.time, back.time),
          firstAmount: first.amount.toString(),
          returnedAmount: back.amount.toString(),
          returnPercent: percent(back.amount, first.amount),
        },
      }),
    );
  }
  return found;
}

/** Every bridge event, as a chronology milestone. */
function bridgeMilestones(wallet: string, moves: Move[]): BehaviorObservation[] {
  return moves
    .filter((m) => isBridge(m.counterparty))
    .map((m) =>
      observation("BRIDGE_MILESTONE", wallet, m.assetId, [asEvent(m, "milestone")], {
        rule: "A bridge event: value left or entered Solana.",
        thresholds: {},
        values: {
          direction: m.direction === "out" ? "out" : "in",
          chain: m.counterparty.slice("bridge:".length),
          bridgedAmount: m.amount.toString(),
          ...(m.event.protocol ? { protocol: m.event.protocol.name } : {}),
          ...Object.fromEntries(Object.entries(m.event.bridge?.identifiers ?? {}).map(([k, v]) => [`identifier.${k}`, v])),
        },
      }),
    );
}

/**
 * Transfers to addresses the registry verifies as an exchange; community
 * labels never count. A run of deposits to one exchange, each soon after the
 * last, reads as one observation.
 */
function exchangeDeposits(wallet: string, moves: Move[], exchangeOf: (address: string) => string | undefined, t: BehaviorThresholds["exchangeDeposit"]): BehaviorObservation[] {
  const runs = new Map<string, Move[][]>();
  for (const m of moves) {
    const exchange = m.direction === "out" && !isBridge(m.counterparty) ? exchangeOf(m.counterparty) : undefined;
    if (!exchange) continue;
    const key = `${exchange}|${m.assetId}`;
    const list = runs.get(key) ?? [];
    const last = list[list.length - 1];
    if (last && m.time - last[last.length - 1].time <= t.groupGapSeconds * 1000) last.push(m);
    else list.push([m]);
    runs.set(key, list);
  }
  return [...runs].flatMap(([key, list]) =>
    list.map((run) => {
      const exchange = key.slice(0, key.indexOf("|"));
      return observation("EXCHANGE_DEPOSIT", wallet, run[0].assetId, run.map((m) => asEvent(m, "destination")), {
        rule: `Transfers to addresses the protocol registry verifies as a centralized exchange; deposits within ${t.groupGapSeconds} seconds of the last are one run.`,
        thresholds: { ...t },
        values: {
          exchange,
          deposits: run.length,
          depositAddresses: new Set(run.map((m) => m.counterparty)).size,
          ...(run.length === 1 ? { depositAddress: run[0].counterparty } : {}),
          depositedAmount: run.reduce((sum, m) => sum + m.amount, ZERO).toString(),
          ...(run.length > 1 ? { spanSeconds: seconds(run[0].time, run[run.length - 1].time) } : {}),
        },
      });
    }),
  );
}

/**
 * Every observation for one wallet, from its semantic events in any order.
 * `exchangeOf` names a verified exchange (registry only); `decimalsOf` sets
 * token dust floors.
 */
export function observeWallet(
  wallet: string,
  sequence: readonly { event: SemanticEvent; time: number }[],
  options: { exchangeOf?: (address: string) => string | undefined; decimalsOf?: (assetId: string) => number | undefined; thresholds?: BehaviorThresholds } = {},
): BehaviorObservation[] {
  const t = options.thresholds ?? BEHAVIOR_THRESHOLDS;
  const moves = movesOf(wallet, sequence, t, options.decimalsOf ?? (() => undefined));
  return [
    ...rapidForwarding(wallet, moves, t.rapidForwarding),
    ...fan(wallet, moves, "out", { ...t.fundSplit, minParties: t.fundSplit.minBranches }),
    ...fan(wallet, moves, "in", { windowSeconds: t.consolidation.windowSeconds, minParties: t.consolidation.minSources }),
    ...repeatedCounterparty(wallet, moves, t.repeatedCounterparty),
    ...circularMovement(wallet, moves, t.circularMovement),
    ...bridgeMilestones(wallet, moves),
    ...exchangeDeposits(wallet, moves, options.exchangeOf ?? (() => undefined), t.exchangeDeposit),
  ].sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
}

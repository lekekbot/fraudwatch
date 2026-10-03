import type { EffectSummary } from "@/lib/state/summarize";

/** One transaction in a relationship, from `a`'s side: value went out to `b`, came in from it, or both. */
export type RelationshipEvent = { signature: string; time: number; sent: boolean; received: boolean };

/** Everything two addresses did with each other: `a` is a mapped wallet; `b` a counterparty or another mapped wallet. */
export type Relationship = {
  a: string;
  b: string;
  /** Time order. */
  events: RelationshipEvent[];
  sent: number;
  received: number;
};

/** One mapped wallet's transactions, as the views show them. */
export type RelationshipLane = { wallet: string; signatures: readonly string[]; times: readonly number[]; summaries: readonly EffectSummary[] };

/**
 * Pairs each mapped wallet with every address it moved value with, over the
 * given transactions. Between two mapped wallets the pair is seen from the
 * earlier lane, and a transaction both lanes have counts once. Busiest first.
 */
export function buildRelationships(lanes: readonly RelationshipLane[]): Relationship[] {
  const order = new Map(lanes.map((l, i) => [l.wallet, i]));
  const pairs = new Map<string, Relationship & { seen: Set<string> }>();
  for (const lane of lanes) {
    lane.summaries.forEach((summary, i) => {
      // A counterparty's own delta is the opposite of the wallet's: positive means the wallet sent to it.
      const flows = new Map<string, { sent: boolean; received: boolean }>();
      for (const c of summary.counterparties) {
        if (c.address === lane.wallet || c.delta === "0") continue;
        const flow = flows.get(c.address) ?? { sent: false, received: false };
        if (c.delta.startsWith("-")) flow.received = true;
        else flow.sent = true;
        flows.set(c.address, flow);
      }
      for (const [other, flow] of flows) {
        // Two mapped wallets: always from the earlier lane's side.
        const flipped = (order.get(other) ?? Infinity) < (order.get(lane.wallet) ?? Infinity);
        const [a, b] = flipped ? [other, lane.wallet] : [lane.wallet, other];
        const key = `${a}|${b}`;
        const pair = pairs.get(key) ?? { a, b, events: [], sent: 0, received: 0, seen: new Set<string>() };
        pairs.set(key, pair);
        const signature = lane.signatures[i];
        if (pair.seen.has(signature)) continue;
        pair.seen.add(signature);
        const sent = flipped ? flow.received : flow.sent;
        const received = flipped ? flow.sent : flow.received;
        pair.events.push({ signature, time: lane.times[i], sent, received });
        if (sent) pair.sent += 1;
        if (received) pair.received += 1;
      }
    });
  }
  return [...pairs.values()]
    .map((pair) => ({ a: pair.a, b: pair.b, sent: pair.sent, received: pair.received, events: pair.events.sort((x, y) => x.time - y.time) }))
    .sort((x, y) => y.events.length - x.events.length || x.a.localeCompare(y.a) || x.b.localeCompare(y.b));
}

/** Activity in one screen slice of a band. */
export type Bin = { index: number; sent: number; received: number; first: RelationshipEvent };

/**
 * Splits a relationship's events into slices `width` px wide along `xOf`,
 * starting at `left`; only slices with activity are returned.
 */
export function binEvents(events: readonly RelationshipEvent[], xOf: (time: number) => number, left: number, width: number): Bin[] {
  const bins = new Map<number, Bin>();
  for (const e of events) {
    const index = Math.floor((xOf(e.time) - left) / width);
    const bin = bins.get(index) ?? { index, sent: 0, received: 0, first: e };
    if (e.sent) bin.sent += 1;
    if (e.received) bin.received += 1;
    bins.set(index, bin);
  }
  return [...bins.values()].sort((x, y) => x.index - y.index);
}

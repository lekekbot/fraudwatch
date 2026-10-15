import type { BoundaryKind, MovementKey, MovementRef, TraceStep } from "./model";
import type { MovementIndex, Weight } from "./movements";

/** Pure helpers behind the trace inspector (see docs/sprints/trace-graph/09). */

export type Leg = { ref: MovementRef; weight: Weight; inTrace: boolean };

/**
 * The other legs of one transaction, in flow order: listed under the same
 * signature so one transaction reads as one. Supporting legs (fees, royalties)
 * are included; legs already in the trace are marked rather than dropped.
 */
export function otherLegs(index: MovementIndex, signature: string, own: MovementKey, inTrace: ReadonlySet<MovementKey>): Leg[] {
  return (index.bySignature.get(signature) ?? []).filter((m) => m.ref.key !== own).map((m) => ({ ref: m.ref, weight: m.weight, inTrace: inTrace.has(m.ref.key) }));
}

/** What would get past a boundary, when the app can do it. */
export type BoundaryFix = "map_wallet" | "start_from_withdrawal" | null;

const BOUNDARIES: Record<BoundaryKind, { meaning: string; fix: BoundaryFix }> = {
  history_not_loaded: { meaning: "This address isn't a mapped wallet, so only its movements with mapped wallets are known. Map it to load its own history.", fix: "map_wallet" },
  partial_history: { meaning: "This wallet's loaded history is incomplete (a safety limit was reached or the provider's history ran out), so later movements may be missing.", fix: null },
  outside_range: { meaning: "Continuing would need activity outside the case or wallet date range. A new case with a wider range would load it.", fix: null },
  custodial: { meaning: "A verified exchange or custodial service. Deposits can't be linked to later withdrawals on-chain; start a new trace from a known withdrawal instead.", fix: "start_from_withdrawal" },
  ambiguous: { meaning: "The movement has several senders and several receivers, so who paid whom isn't recorded.", fix: null },
  failed: { meaning: "The transaction failed; nothing moved except the network fee.", fix: null },
  left_supply: { meaning: "Burned: the asset left circulation here.", fix: null },
  entered_supply: { meaning: "Minted to this address: there's no sender to go back to.", fix: null },
  bridged_out: { meaning: "Bridged to another chain. The destination chain and recipient are as the bridge recorded them; the trail continues off Solana.", fix: null },
  bridged_in: { meaning: "Arrived from another chain; its origin isn't on Solana.", fix: null },
  protocol_position: { meaning: "Value went into (or came out of) a stake, lending or liquidity position rather than to a wallet.", fix: null },
  end_of_history: { meaning: "The wallet's loaded history is complete and nothing further was found in range.", fix: null },
};

export function boundaryExplanation(kind: BoundaryKind): { meaning: string; fix: BoundaryFix } {
  return BOUNDARIES[kind];
}

/**
 * For a stale movement step, the movements its signature has now, from the
 * same signature only. Ones with the same asset and ends list first.
 */
export function replacementCandidates(index: MovementIndex, step: Extract<TraceStep, { kind: "movement" }>): MovementRef[] {
  const { ref } = step;
  const score = (r: MovementRef) => Number(r.assetId === ref.assetId) + Number(r.from === ref.from) + Number(r.to === ref.to);
  return (index.bySignature.get(ref.signature) ?? []).map((m) => m.ref).filter((r) => r.key !== ref.key).sort((a, b) => score(b) - score(a));
}

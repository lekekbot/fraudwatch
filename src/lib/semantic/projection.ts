import type { ParticipantRole, SemanticEvent, SemanticFlow } from "./events";

/**
 * One wallet's view of an event. Buyer and seller see the same event (same id
 * and signature) with their own action: the buyer bought, the seller sold.
 */
export type EventProjection = {
  eventId: string;
  signature: string;
  wallet: string;
  roles: ParticipantRole[];
  /** For transfers and trades, BUY, SELL, SEND, RECEIVE or ROYALTY from this wallet's side; otherwise the event's own action. */
  action: string;
  outgoing: SemanticFlow[];
  incoming: SemanticFlow[];
};

const ACTION_BY_ROLE: Partial<Record<ParticipantRole, string>> = {
  BUYER: "BUY",
  SELLER: "SELL",
  SENDER: "SEND",
  RECEIVER: "RECEIVE",
  ROYALTY_RECIPIENT: "ROYALTY",
  FEE_RECIPIENT: "FEE",
};

/** Null when the wallet is neither a participant nor on either end of a flow. */
export function projectEvent(event: SemanticEvent, wallet: string): EventProjection | null {
  const roles = event.participants.filter((p) => p.address === wallet).map((p) => p.role);
  const outgoing = event.flows.filter((f) => f.from === wallet);
  const incoming = event.flows.filter((f) => f.to === wallet);
  if (roles.length === 0 && outgoing.length === 0 && incoming.length === 0) return null;
  // Roles specific to the event's meaning (buyer, seller) speak for the wallet; generic ones only fill in.
  const sided = roles.map((r) => ACTION_BY_ROLE[r]).find((a) => a !== undefined);
  // Only transfers and trades read differently from each side; a swap, stake, loan or bridge keeps its own action.
  const sidedCategory = event.category === "TRANSFER" || event.category === "NFT_TRANSFER" || event.category === "NFT_TRADE";
  return {
    eventId: event.id,
    signature: event.signature,
    wallet,
    roles,
    action: (sidedCategory && sided) || event.action,
    outgoing,
    incoming,
  };
}

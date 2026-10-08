import { NATIVE_SOL } from "@/lib/assets/assets";
import type { Names } from "@/lib/labels/labels";
import type { EventCategory, FlowRole, SemanticEvent } from "@/lib/semantic/events";
import { projectEvent } from "@/lib/semantic/projection";
import type { WalletState } from "@/lib/state/reconstruct";
import { describeAction, type EffectSummary } from "@/lib/state/summarize";
import type { Flow } from "@/lib/timeline/lanes";
import { type Assets, assetLabel, formatAssetAmount, nftLabel } from "../asset-format";

/** Card colour, one per broad kind of activity. */
export type Tone = "send" | "receive" | "swap" | "nft" | "defi" | "bridge" | "burn" | "approval" | "neutral" | "failed";

const titleCase = (action: string) => action.charAt(0) + action.slice(1).toLowerCase().replaceAll("_", " ");

/** "ethereum" → "Ethereum"; a domain the code doesn't know ("cctp-domain-27") stays as it is. */
export const chainName = (chain: string) => (chain.includes("-") ? chain : chain.charAt(0).toUpperCase() + chain.slice(1));

/** What an event is called, from one wallet's side: a purchase for the buyer, a sale for the seller. */
export function eventLabel(event: SemanticEvent, wallet?: string): string {
  const action = (wallet && projectEvent(event, wallet)?.action) || event.action;
  const bundle = event.nft?.bundle ? " bundle" : "";
  switch (event.category) {
    case "TRANSFER":
      return action === "RECEIVE" ? "Receive" : "Send";
    case "NFT_TRADE":
      return action === "BUY" ? `NFT${bundle} purchase` : action === "SELL" ? `NFT${bundle} sale` : action === "SWAP" ? "NFT swap" : "NFT trade";
    case "NFT_MINT":
      return "NFT mint";
    case "NFT_TRANSFER":
      return "NFT transfer";
    case "SWAP":
      return "Swap";
    case "STAKE":
      return action === "LIQUID_STAKE" ? "Liquid stake" : "Stake";
    case "UNSTAKE":
      return action === "LIQUID_UNSTAKE" ? "Liquid unstake" : action === "STAKE_SALE" ? "Stake sale" : "Unstake";
    case "LENDING":
      return action.split("+").map(titleCase).join(" + ");
    case "BRIDGE":
      return action === "BRIDGE_IN" ? "Bridge in" : "Bridge out";
    case "LIQUIDITY":
      return titleCase(action);
    case "BURN":
      return "Burn";
    case "APPROVAL":
      return "Approval";
    case "ACCOUNT":
      return "Account";
    case "PROGRAM_INTERACTION":
      return "Program";
    case "FAILED":
      return "Failed";
    default:
      return "Unknown";
  }
}

const TONE: Partial<Record<EventCategory, Tone>> = {
  SWAP: "swap",
  NFT_TRADE: "nft",
  NFT_MINT: "nft",
  NFT_TRANSFER: "nft",
  STAKE: "defi",
  UNSTAKE: "defi",
  LENDING: "defi",
  LIQUIDITY: "defi",
  BRIDGE: "bridge",
  BURN: "burn",
  APPROVAL: "approval",
  FAILED: "failed",
};

/** Movements that say what the event was; fees, rent and routing only support it. */
const MAIN = new Set<FlowRole | undefined>([undefined, "spent", "received", "payment", "nft", "unidentified"]);

const cardDate = (ms: number) => {
  const d = new Date(ms);
  // The year only when it isn't this one, matching the nodes' labels on the canvas.
  const options: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", timeZone: "UTC" };
  if (d.getUTCFullYear() !== new Date().getUTCFullYear()) options.year = "numeric";
  return `${d.toLocaleDateString("en-GB", options)} · ${d.toISOString().slice(11, 16)}`;
};

export type EventCard = {
  tone: Tone;
  label: string;
  lines: string[];
  flow: Flow;
  /** Who or what the detail line names (an address, or a protocol's name), to spot the same counterparty across cards. */
  party?: string;
};

/**
 * One lane's card for an event: date, what happened, the main amount, and
 * who or what it was with. `summary` (this wallet's own reading) names the
 * program for activity that moved no value.
 */
export function eventCard(event: SemanticEvent, wallet: string, time: number, state: WalletState, summary: EffectSummary, assets: Assets, names: Names): EventCard {
  const projection = projectEvent(event, wallet);
  const out = (projection?.outgoing ?? []).filter((f) => MAIN.has(f.role) && f.source === "balance");
  const into = (projection?.incoming ?? []).filter((f) => MAIN.has(f.role) && f.source === "balance");
  const amount = (f: { amount: string; assetId: string }) => `${formatAssetAmount(f.amount, f.assetId, state, assets)} ${assetLabel(f.assetId, assets)}`;
  const label = eventLabel(event, wallet);
  const protocol = event.protocol?.name ?? event.service?.name ?? "";
  // The actor's own spent and received flows: a swap, stake, loan or bridge, whoever's lane this is.
  const role = (r: FlowRole) => event.flows.find((f) => f.role === r);
  const nftName = event.nft ? nftLabel(event.nft.assets, assets) : "";

  let type = label.toUpperCase();
  let main = "";
  let detail = protocol;
  let party: string | undefined = protocol || undefined;
  switch (event.category) {
    case "TRANSFER": {
      const sent = label === "Send";
      const flow = sent ? out[0] : into[0];
      main = flow ? amount(flow) : "";
      const address = sent ? flow?.to : flow?.from;
      if (address) {
        detail = `${sent ? "→" : "←"} ${names.of(address, 3)}`;
        party = address ?? undefined;
      }
      break;
    }
    case "NFT_TRADE":
    case "NFT_MINT":
    case "NFT_TRANSFER": {
      const swap = event.action === "SWAP";
      const price = event.nft?.price;
      // The NFT's name goes on the type line when the price takes the amount line, and only once.
      if (!swap && price) type = `${type} · ${nftName}`;
      main = !swap && price ? amount(price) : nftName;
      if (!protocol) {
        const nft = event.flows.find((f) => f.role === "nft" && (f.from === wallet || f.to === wallet));
        const address = nft ? (nft.to === wallet ? nft.from : nft.to) : undefined;
        detail = address ? `${nft?.to === wallet ? "←" : "→"} ${names.of(address, 3)}` : "";
        party = address ?? undefined;
      }
      break;
    }
    case "SWAP":
    case "STAKE":
    case "UNSTAKE":
    case "LIQUIDITY": {
      // A stake account's SOL isn't the wallet's balance: shown on its own, or as what an unstake gave up.
      const staked = event.stake && { amount: event.stake.lamports, assetId: NATIVE_SOL };
      const received = role("received");
      // A stake account handed over for what came back (a sale, an instant unstake) is what was given up.
      const spent = role("spent") ?? (event.stake?.newOwner && received ? staked : undefined);
      main = spent && received ? `${amount(spent)} → ${amount(received)}` : spent ? amount(spent) : received ? amount(received) : staked ? amount(staked) : "";
      if (event.stake?.newOwner && !protocol) {
        detail = `→ ${names.of(event.stake.newOwner, 3)}`;
        party = event.stake.newOwner;
      }
      break;
    }
    case "LENDING": {
      const flow = event.action === "BORROW" || event.action === "WITHDRAW" || event.action === "REMOVE_COLLATERAL" ? (role("received") ?? role("spent")) : (role("spent") ?? role("received"));
      main = flow ? amount(flow) : "";
      break;
    }
    case "BRIDGE": {
      const asset = event.bridge?.asset ?? (role("spent") || role("received")) ?? null;
      main = asset ? amount(asset) : "";
      const remote = event.bridge ? (event.action === "BRIDGE_IN" ? `← ${chainName(event.bridge.sourceChain)}` : `→ ${chainName(event.bridge.destinationChain)}`) : "";
      detail = [remote, protocol].filter(Boolean).join(" · ");
      break;
    }
    case "BURN":
      main = out[0] ? amount(out[0]) : describeAction(summary.action, summary.action ? names.known(summary.action.programId) : undefined);
      break;
    case "FAILED":
      main = "No balance change";
      break;
    default:
      main = describeAction(summary.action, summary.action ? names.known(summary.action.programId) : undefined);
      detail = protocol || (summary.actor ? `by ${names.of(summary.actor, 3)}` : "");
      party = protocol || summary.actor || undefined;
  }

  const tone: Tone = event.category === "TRANSFER" ? (label === "Send" ? "send" : "receive") : (TONE[event.category] ?? "neutral");
  // Which way the event's value went for this wallet, to orient connectors between lanes: a buyer pays, a seller is paid.
  const roles = projection?.roles ?? [];
  const flow: Flow =
    event.category === "NFT_TRADE"
      ? roles.includes("BUYER")
        ? "out"
        : roles.includes("SELLER")
          ? "in"
          : "none"
      : out.length > 0 && into.length === 0
        ? "out"
        : into.length > 0 && out.length === 0
          ? "in"
          : "none";
  return { tone, label, lines: [cardDate(time), type, main, detail], flow, party };
}

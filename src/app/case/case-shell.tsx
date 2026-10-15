"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownIcon, ArrowUpIcon, CalendarIcon, EyeIcon, EyeOffIcon, FocusIcon, Link2Icon, PanelLeftIcon, HashIcon, PanelRightIcon, PauseIcon, SettingsIcon, PencilIcon, PlayIcon, PlusIcon, SearchIcon, ShieldIcon, Trash2Icon, WalletIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
import { RpcStatusBadge } from "@/components/rpc-status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useIngestion } from "@/hooks/use-ingestion";
import { useSnsNames } from "@/hooks/use-sns-names";
import { useLocalQuery } from "@/hooks/use-local-db";
import { type Preferences, usePreferences, useReducedMotion } from "@/hooks/use-preferences";
import { saveLastView } from "@/lib/case/view-settings";
import type { SettingKey } from "@/lib/preferences/schema";
import { ViewSettingsPanel } from "./view-settings-panel";
import { useWalletStates } from "@/hooks/use-wallet-states";
import { addressState } from "@/lib/case/address-state";
import { isBookmarked, removeBookmark, toggleBookmark } from "@/lib/case/bookmarks";
import { laneOrder, moveLane, toggleLaneHidden, visibleLanes } from "@/lib/case/lanes";
import { firstInteraction, mapWallet, newWalletProblem, toggleWalletPaused, unmapWallet, walletRange, walletRanges } from "@/lib/case/wallet-range";
import { mappingSummary, sharedTransactions } from "@/lib/ingest/intersections";
import { buildInteractionGraph, type ClusterKind, entityNodeId, entityProtocol, type GraphEdge, type GraphRanking, withGraphNames } from "@/lib/graph/build";
import type { FraudWatchCase } from "@/lib/case/model";
import { datesFromRange, extendedToToday, formatRange } from "@/lib/case/range";
import { getAddressLabels } from "@/lib/db/address-labels";
import { touchCase } from "@/lib/db/cases";
import { getDb } from "@/lib/db/db";
import { getRpcSettings } from "@/lib/db/rpc-settings";
import { communityLabel } from "@/lib/labels/community";
import { ADDRESS_CHARS, createNames } from "@/lib/labels/labels";
import { isDust, judgeLookalikes, lookalikeGroups, type LookalikeVerdict } from "@/lib/labels/lookalikes";
import { enrichTransaction, protocolsUsed, registry } from "@/lib/protocols/registry";
import { buildMapSearch } from "@/lib/routing/map-params";
import { buildCasePath, isCaseRoute, parseCasePath, type CaseView } from "@/lib/routing/case-path";
import type { RpcSettings } from "@/lib/rpc/settings";
import { shortenAddress } from "@/lib/solana/address";
import { collectCounterparties } from "@/lib/state/counterparties";
import { type BehaviorObservation, observeWallet } from "@/lib/behavior/observations";
import type { EventCategory, SemanticEvent } from "@/lib/semantic/events";
import { interpretTransaction } from "@/lib/semantic/interpret";
import { eventLabel } from "./timeline/event-card";
import { type EffectSummary, type NftCatalog, summarizeEffect } from "@/lib/state/summarize";
import { counterpartyRows, type TransactedRow, transactedOverview } from "@/lib/state/volume";
import { type HiddenReason, hiddenBy, hiddenReasons, hideTransactions, revertHiding, ruleFrom, saveRule, unhideTransactions, withLaneWallets } from "@/lib/case/hiding";
import { EMPTY_FILTER, type FilterableTx, type TxFilter, involvedAddresses, isFilterActive, movedAssets, passesFilter, toggled } from "@/lib/timeline/filter";
import type { SearchItem } from "@/lib/search";
import { eventTimes } from "@/lib/timeline/layout";
import { cn } from "cn";
import { AddressPanel } from "./address-panel";
import { LookalikeMark } from "./lookalike";
import { AssetFlows } from "./asset-flows";
import { CounterpartyList } from "./counterparty-list";
import { CaseNameInput } from "./case-name-input";
import { DeleteCaseButton } from "./delete-case-button";
import { FilterPanel, kindLabel } from "./filter-panel";
import { HidingSection, type RulesDialogState } from "./hide-rules";
import { type MapWalletChoice, MapWalletDialog } from "./map-wallet-dialog";
import { EdgePanel } from "./graph/edge-panel";
import { EntityPanel } from "./graph/entity-panel";
import { WalletGraph } from "./graph/wallet-graph";
import { IngestionPanel } from "./ingestion-panel";
import { PanelSection, ShowMoreList, SidePanel } from "./panel";
import { type WalletLane, WalletTimeline, type WalletTimelineHandle } from "./timeline/wallet-timeline";
import { SearchDialog } from "./search-dialog";
import { assetLabel, assetLogo, formatAssetAmount, formatUtcMinute, type Assets } from "./asset-format";
import { copy } from "./timeline/inspector-ui";
import { TransactionDetails } from "./timeline/transaction-details";
import { TraceView } from "./trace/trace-view";
import type { TraceEvidence } from "@/lib/trace/view";
import { buildMovementIndex, chronologicalOrder } from "@/lib/trace/movements";
import { classifyEvent } from "@/lib/trace/movements";
import type { MovementRef, TraceSeed } from "@/lib/trace/model";
import type { TraceStartRequest } from "./trace/seed-dialog";
import { type TableNav, type TableSide, WalletStateSummary, WalletStateTable } from "./wallet-state-view";

/** Most counterparties whose .sol names are looked up per case, busiest first. */
const SNS_LOOKUP_LIMIT = 300;
/** The hide rule that holds likely look-alike decoys. */
const DECOY_RULE_ID = "lookalike-decoys";
const SHOWN_WALLETS = 50;
const NO_ADDRESSES: string[] = [];
const EMPTY_ASSETS: Assets = new Map();
/** Above this many addresses, drawing all of them asks first (`graph.confirmLarge`). */
const LARGE_GRAPH = 200;
const TIMELINE_VIEW_KEYS: SettingKey[] = ["timeline.density", "timeline.connectors", "timeline.programInteractions", "timeline.nft"];
const GRAPH_VIEW_KEYS: SettingKey[] = ["graph.nodeLimit", "graph.programs", "graph.knownServices", "graph.lowValue", "graph.spacing", "graph.arrows"];

/**
 * Hosted by the case layout, not the page: the page segment is keyed by its
 * params, so switching view would remount it and drop the workspace's state.
 */
export function CaseShell() {
  const pathname = usePathname();
  // Invalid paths get the page's not-found instead.
  if (!isCaseRoute(pathname.split("/").filter(Boolean).slice(1))) return null;
  return <CaseLoader id={parseCasePath(pathname).caseId} />;
}

function CaseLoader({ id }: { id: string }) {
  const fwCase = useLocalQuery((db) => db.cases.get(id), [id]);
  const rpc = useLocalQuery((db) => getRpcSettings(db), []);
  const found = fwCase.status === "ready" && fwCase.data !== undefined;
  // Read here, so the workspace never lays out once with defaults and again with the stored values.
  const prefs = usePreferences(found ? fwCase.data : undefined);

  useEffect(() => {
    if (found) void touchCase(getDb(), id).catch(() => {});
  }, [found, id]);

  if (fwCase.status === "loading" || prefs.status === "loading") {
    return <p className="flex h-dvh items-center justify-center text-sm text-muted-foreground">Loading case…</p>;
  }
  if (fwCase.status === "error" || !fwCase.data) {
    return (
      <div className="flex h-dvh items-center justify-center p-4">
        <Alert variant="destructive" className="max-w-2xl">
          <AlertTitle>Case not found</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-3">
            <span>
              {fwCase.status === "error"
                ? fwCase.error
                : "This case isn't in this browser's local storage. Cases don't sync between browsers or devices."}
            </span>
            <Link href="/" className={buttonVariants({ variant: "outline", size: "sm" })}>
              Back to cases
            </Link>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return <CaseWorkspace key={fwCase.data.id} c={fwCase.data} prefs={prefs} rpc={rpc.status === "ready" ? rpc.data : undefined} rpcKnown={rpc.status === "ready"} />;
}

/**
 * Full-window workspace: the map fills the screen, with a thin top bar,
 * wallets and loading on the left, and an inspector on the right.
 * Cmd/Ctrl+\ hides both panels.
 */
function CaseWorkspace({ c, prefs, rpc, rpcKnown }: { c: FraudWatchCase; prefs: Preferences; rpc: RpcSettings | undefined; rpcKnown: boolean }) {
  const pathname = usePathname();
  const route = parseCasePath(pathname);
  const ingestion = useIngestion(c);
  const { state } = ingestion;
  const walletStates = useWalletStates(state.status === "done" ? state.result : null, c.range, rpc?.url, walletRanges(c));
  const [leftOpen, setLeftOpen] = useState(true);
  /** The case name in the header is being edited. */
  const [renaming, setRenaming] = useState(false);
  const inspectorMode = prefs.get("investigation.inspector");
  const [rightOpen, setRightOpen] = useState(inspectorMode === "open");
  const reducedMotion = useReducedMotion(prefs);
  const view = route.view;
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const [rulesDialog, setRulesDialog] = useState<RulesDialogState>(null);
  /** Transaction open from the table view. */
  const [tableTx, setTableTx] = useState<TableSide | null>(null);
  /** Transaction to open the timeline on, from the graph's "Show on timeline". */
  const [focusSignature, setFocusSignature] = useState<string | undefined>(undefined);
  /** Moment to open the timeline on, from a date bookmark. */
  const [focusTime, setFocusTime] = useState<number | undefined>(undefined);
  const [selectedWallet, setSelectedWallet] = useState(c.primaryWallet);
  const [filter, setFilter] = useState(() => ({ ...EMPTY_FILTER, address: route.wallet }));
  const [graphRanking, setGraphRanking] = useState<GraphRanking>("significant");
  // Graph display comes from the case's view settings; clicking a cluster open is exploration, kept for the session.
  const graphNodeLimit = prefs.get("graph.nodeLimit");
  const showPrograms = prefs.get("graph.programs") === "shown";
  const graphLowValue = prefs.get("graph.lowValue");
  const confirmLarge = prefs.get("graph.confirmLarge") === "on";
  const [graphClusters, setGraphClusters] = useState<ReadonlySet<ClusterKind>>(new Set());
  // Known services follow their setting; a click flips them until the setting itself changes (the toggle remembers which value it flipped).
  const knownSetting = prefs.get("graph.knownServices");
  const [knownFlippedAt, setKnownFlippedAt] = useState<string | null>(null);
  const knownExpanded = (knownSetting === "expanded") !== (knownFlippedAt === knownSetting);
  const expandedClusters = useMemo(() => {
    const out = new Set(graphClusters);
    if (knownExpanded) out.add("known");
    else out.delete("known");
    return out;
  }, [graphClusters, knownExpanded]);
  /** "All" draws more than LARGE_GRAPH addresses only once confirmed, for this session. */
  const [allowLarge, setAllowLarge] = useState(false);
  const [confirmDraw, setConfirmDraw] = useState<{ count: number; run: () => void } | null>(null);
  const [graphEntities, setGraphEntities] = useState<ReadonlySet<string>>(new Set());
  /** Observed address the Map wallet dialog is open for. */
  const [mapTarget, setMapTarget] = useState<string | null>(null);
  const [traceSeed, setTraceSeed] = useState<TraceStartRequest | null>(null);
  /** The "Add wallet" dialog, for an address the map hasn't met. */
  const [addingWallet, setAddingWallet] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const timelineRef = useRef<WalletTimelineHandle>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const [mapBusy, setMapBusy] = useState(false);
  /** Most recently mapped wallet, whose loading summary is shown until dismissed. */
  const [justMapped, setJustMapped] = useState<string | null>(null);
  /** An address opened in the inspector (counterparty, sender, program); shown over transaction details. */
  const [selectedAddress, setSelectedAddress] = useState<string | null>(null);
  // "When something is selected": the inspector opens for each new selection, and can still be closed.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- opening follows the selection, which several handlers set
    if (inspectorMode === "on_selection" && (selectedAddress || selectedEdge || tableTx)) setRightOpen(true);
  }, [inspectorMode, selectedAddress, selectedEdge, tableTx]);

  const routeTo = (nextView: CaseView, wallet?: string | null, replace = false) => {
    if (nextView === "table") setFilter((current) => ({ ...current, address: wallet ?? null }));
    window.history[replace ? "replaceState" : "pushState"](null, "", buildCasePath(c.id, nextView, wallet));
  };

  // Remembered for "open cases on the last used view", however the view was reached (tabs, links, back and forward).
  useEffect(() => {
    if (view !== c.lastView) void saveLastView(getDb(), c.id, view).catch(() => {});
  }, [view, c.id, c.lastView]);

  const updateFilter = (next: TxFilter) => {
    setFilter(next);
    if (view === "table" && next.address !== route.wallet) {
      window.history.pushState(null, "", buildCasePath(c.id, "table", next.address));
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the URL is the source of truth on back/forward navigation
    if (route.view === "table") setFilter((current) => (current.address === route.wallet ? current : { ...current, address: route.wallet }));
  }, [route.view, route.wallet]);
  const labelRows = useLocalQuery((db) => getAddressLabels(db, c.id), [c.id]);
  const labels = useMemo(() => (labelRows.status === "ready" ? labelRows.data : []), [labelRows]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
        return;
      }
      if (!(event.metaKey || event.ctrlKey) || event.key !== "\\") return;
      event.preventDefault();
      const show = !(leftOpen || rightOpen);
      setLeftOpen(show);
      setRightOpen(show);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [leftOpen, rightOpen]);

  const walletState = walletStates?.states.find((s) => s.wallet === selectedWallet);
  const transactions = state.status === "done" ? state.result.transactions : undefined;
  // What's known about NFTs on-chain (AssetMetadata.nft: 0 decimals, supply 1; royalty recipients from Metaplex).
  const assets = walletStates?.assets;
  const nfts = useMemo<NftCatalog>(
    () => ({ isNft: (m) => assets?.get(m)?.nft === true, royaltyRecipients: (m) => assets?.get(m)?.royaltyRecipients ?? [] }),
    [assets],
  );
  // One semantic event per loaded transaction, interpreted once here, never while drawing or filtering.
  // Re-read when NFT metadata arrives, since it can turn a transfer into a trade.
  const semanticEvents = useMemo(() => {
    const out = new Map<string, SemanticEvent>();
    for (const [signature, tx] of transactions ?? []) out.set(signature, interpretTransaction(tx, { nfts })[0]);
    return out;
  }, [transactions, nfts]);
  const traceIndex = useMemo(() => {
    if (view !== "trace") return null;
    const order = chronologicalOrder(transactions?.values() ?? []);
    return buildMovementIndex(semanticEvents.values(), (signature) => order.get(signature));
  }, [view, transactions, semanticEvents]);
  // Summaries once per wallet (the costly part); filtering below is plain comparisons on them.
  const summariesByWallet = useMemo(() => {
    const out = new Map<string, EffectSummary[]>();
    if (!walletStates || !transactions) return out;
    for (const ws of walletStates.states) out.set(ws.wallet, ws.effects.map((e) => summarizeEffect(e, transactions.get(e.signature), nfts)));
    return out;
  }, [walletStates, transactions, nfts]);
  // Every address the case has met: mapped wallets, labelled ones, and everyone in the loaded transactions.
  // Any two that start and end alike (see `readsAlike`) are flagged as look-alikes: the address-poisoning trick.
  const caseAddresses = useMemo(() => {
    const seen = new Set<string>(c.mappedWallets.map((w) => w.address));
    for (const l of labels) seen.add(l.address);
    for (const sums of summariesByWallet.values()) for (const sum of sums) for (const a of involvedAddresses(sum)) seen.add(a);
    return seen;
  }, [c.mappedWallets, labels, summariesByWallet]);
  const lookalikes = useMemo(() => lookalikeGroups(caseAddresses), [caseAddresses]);
  /** Look-alikes of any address, including one typed in that the case hasn't met. */
  const lookalikesOf = (address: string) =>
    caseAddresses.has(address) ? (lookalikes.get(address) ?? []) : (lookalikeGroups([address, ...caseAddresses]).get(address) ?? []);
  /** An asset's decimals: its metadata, else what a transaction reported. */
  const decimalsOf = useCallback(
    (assetId: string) => walletStates?.assets.get(assetId)?.decimals ?? walletStates?.states.find((st) => assetId in st.decimals)?.decimals[assetId],
    [walletStates],
  );
  // Decoy or real: a decoy only ever moves dust with the case's wallets, the account it imitates moves real value.
  const verdicts = useMemo(() => {
    if (lookalikes.size === 0 || !walletStates) return new Map<string, LookalikeVerdict>();
    const moves = new Map<string, { assetId: string; delta: string }[]>();
    const add = (address: string, change: { assetId: string; delta: string }) => {
      if (!lookalikes.has(address)) return;
      const list = moves.get(address) ?? [];
      list.push(change);
      moves.set(address, list);
    };
    for (const [wallet, sums] of summariesByWallet) {
      for (const sum of sums) {
        // A look-alike's own lane shows what it moved; other lanes show what it moved with them.
        for (const change of [...sum.inflows, ...sum.outflows]) add(wallet, change);
        for (const cp of sum.counterparties) add(cp.address, cp);
      }
    }
    return judgeLookalikes(lookalikes, (address) => {
      const list = moves.get(address);
      return list && list.length > 0 ? list.every((m) => isDust(m.assetId, BigInt(m.delta), decimalsOf(m.assetId) ?? 0)) : null;
    });
  }, [lookalikes, summariesByWallet, walletStates, decimalsOf]);
  // Primary .sol names, looked up on-chain for the case's wallets and its busiest counterparties that have no better name.
  const snsCandidates = useMemo(() => {
    const userLabelled = new Set(labels.filter((l) => l.name).map((l) => l.address));
    const activity = new Map<string, number>();
    for (const sums of summariesByWallet.values()) for (const sum of sums) for (const a of involvedAddresses(sum)) activity.set(a, (activity.get(a) ?? 0) + 1);
    const unnamed = (a: string) => !userLabelled.has(a) && !registry.lookup(a) && !communityLabel(a);
    const busiest = [...activity].filter(([a]) => unnamed(a)).sort((x, y) => y[1] - x[1]).slice(0, SNS_LOOKUP_LIMIT).map(([a]) => a);
    return [...new Set([...c.mappedWallets.map((w) => w.address).filter(unnamed), ...busiest])];
  }, [labels, summariesByWallet, c.mappedWallets]);
  const showSns = prefs.get("labels.sns") === "shown";
  // Hidden .sol names aren't looked up at all.
  const snsNames = useSnsNames(showSns ? snsCandidates : NO_ADDRESSES, rpc?.url);
  const preferNames = prefs.get("labels.preferNames") === "on";
  const showCommunity = prefs.get("labels.community") === "shown";
  const addressChars = ADDRESS_CHARS[prefs.get("appearance.addressFormat")];
  const names = useMemo(
    () =>
      createNames(new Map(labels.map((l) => [l.address, l])), registry, lookalikes, verdicts, snsNames, {
        chars: addressChars,
        preferNames,
        community: showCommunity,
        sns: showSns,
      }),
    [labels, lookalikes, verdicts, snsNames, addressChars, preferNames, showCommunity, showSns],
  );
  // Canvases have room for medium addresses at most; inspectors show the preference in full.
  const canvasNames = useMemo(
    () =>
      addressChars <= ADDRESS_CHARS.medium
        ? names
        : createNames(new Map(labels.map((l) => [l.address, l])), registry, lookalikes, verdicts, snsNames, {
            chars: ADDRESS_CHARS.medium,
            preferNames,
            community: showCommunity,
            sns: showSns,
          }),
    [names, addressChars, labels, lookalikes, verdicts, snsNames, preferNames, showCommunity, showSns],
  );
  const graphNames = useMemo(() => withGraphNames(canvasNames), [canvasNames]);
  /** Likely dust decoys, for the "Hide dust decoys" filter. */
  const decoySet = useMemo(() => new Set([...verdicts].filter(([, v]) => v === "decoy").map(([a]) => a)), [verdicts]);
  const isDecoy = useCallback((address: string) => decoySet.has(address), [decoySet]);
  const decoys = [...decoySet];
  const decoyRule = c.hideRules?.find((r) => r.id === DECOY_RULE_ID);
  /** True once every likely decoy's transactions are hidden by the decoy rule. */
  const decoysHidden = decoys.length > 0 && Boolean(decoyRule?.enabled) && decoys.every((d) => decoyRule?.counterparties?.includes(d));
  // One rule covers every likely decoy, so the views show the accounts they imitate instead; switch it off in Rules to see them again.
  const hideDecoys = () => {
    void updateCase(saveRule(c, { id: DECOY_RULE_ID, name: "Look-alike decoys", enabled: true, counterparties: decoys }));
    toast.success(`Hiding transactions with ${decoys.length} likely decoy${decoys.length === 1 ? "" : "s"}. Turn it off under Hidden transactions → Manage.`);
  };
  const filterables = useMemo(() => {
    const protocolsOf = new Map<string, string[]>();
    const out = new Map<string, FilterableTx[]>();
    for (const ws of walletStates?.states ?? []) {
      const sums = summariesByWallet.get(ws.wallet) ?? [];
      const times = eventTimes(ws.effects.map((e) => e.timestamp), Date.parse(c.range.start));
      out.set(
        ws.wallet,
        ws.effects.map((e, i) => {
          let protocols = protocolsOf.get(e.signature);
          if (!protocols) {
            const tx = transactions?.get(e.signature);
            protocols = tx ? protocolsUsed(enrichTransaction(tx)).map((p) => p.id) : [];
            protocolsOf.set(e.signature, protocols);
          }
          return { signature: e.signature, time: times[i], summary: sums[i], event: semanticEvents.get(e.signature) ?? null, protocols, addresses: involvedAddresses(sums[i]) };
        }),
      );
    }
    return out;
  }, [walletStates, summariesByWallet, semanticEvents, transactions, c.range.start]);
  // Only the views are filtered; the wallet state panel keeps the full history.
  // Hidden transactions (by hand or by rule) leave every view; the table keeps them, with why, for "Show hidden".
  const { hiddenSignatures, shownSignatures, hideRules } = c;
  /** Every lane's transactions, each counting its own wallet as involved, for hiding rules. */
  const hidingRows = useMemo(() => withLaneWallets(filterables), [filterables]);
  // Decided once per transaction across all lanes: hidden on one side is hidden on every side.
  const reasons = useMemo(
    () => hiddenReasons({ hiddenSignatures, shownSignatures, hideRules }, hidingRows, names.tags),
    [hiddenSignatures, shownSignatures, hideRules, hidingRows, names],
  );
  // Behaviour patterns across each mapped wallet's whole history (not the filtered view), without hidden transactions.
  const observations = useMemo<BehaviorObservation[]>(() => {
    if (!walletStates) return [];
    const exchangeOf = (address: string) => {
      const entry = registry.lookup(address);
      return entry?.category === "exchange" ? entry.protocolName : undefined;
    };
    return walletStates.states.flatMap((ws) => {
      const times = eventTimes(ws.effects.map((e) => e.timestamp), Date.parse(c.range.start));
      const sequence = ws.effects.flatMap((e, i) => {
        const event = semanticEvents.get(e.signature);
        return event && !reasons.get(e.signature) ? [{ event, time: times[i] }] : [];
      });
      return observeWallet(ws.wallet, sequence, { exchangeOf, decimalsOf });
    });
  }, [walletStates, semanticEvents, reasons, c.range.start, decimalsOf]);
  /** How many behaviour observations each counterparty appears in, for the graph's ranking. */
  const observedAddresses = useMemo(() => {
    const out = new Map<string, number>();
    for (const o of observations) {
      const involved = new Set([...o.events.map((e) => e.counterparty), o.values.counterparty, o.values.depositAddress].filter((a): a is string => typeof a === "string" && !a.startsWith("bridge:")));
      for (const address of involved) out.set(address, (out.get(address) ?? 0) + 1);
    }
    return out;
  }, [observations]);
  const perWallet = useMemo(() => {
    const out = new Map<
      string,
      {
        all: EffectSummary[];
        state: NonNullable<typeof walletState>;
        summaries: EffectSummary[];
        table: { state: NonNullable<typeof walletState>; summaries: EffectSummary[]; hidden: HiddenReason[] };
      }
    >();
    for (const ws of walletStates?.states ?? []) {
      const rows = filterables.get(ws.wallet) ?? [];
      // A decoy's own lane is all decoy activity: the filter takes it out whole.
      const decoyLane = filter.hideDecoys && isDecoy(ws.wallet);
      const passes = rows.map((row) => !decoyLane && passesFilter(row, filter, names.tags, isDecoy));
      const why = rows.map((row, i) => (passes[i] ? (reasons.get(row.signature) ?? null) : null));
      const keep = passes.map((p, i) => p && why[i] === null);
      const all = summariesByWallet.get(ws.wallet) ?? [];
      out.set(ws.wallet, {
        all,
        state: { ...ws, effects: ws.effects.filter((_, i) => keep[i]) },
        summaries: all.filter((_, i) => keep[i]),
        table: {
          state: { ...ws, effects: ws.effects.filter((_, i) => passes[i]) },
          summaries: all.filter((_, i) => passes[i]),
          hidden: why.filter((_, i) => passes[i]),
        },
      });
    }
    return out;
  }, [walletStates, filterables, summariesByWallet, filter, names, reasons, isDecoy]);
  const visible = perWallet.get(selectedWallet);
  const visibleState = visible?.state;
  // Every program the loaded transactions invoked; unknown programs are still infrastructure.
  const programs = useMemo(() => {
    const ids = new Set<string>();
    for (const tx of transactions?.values() ?? []) for (const ix of [...tx.instructions, ...tx.innerInstructions]) ids.add(ix.programId);
    return ids;
  }, [transactions]);
  const traceEvidence = useMemo<TraceEvidence>(() => ({
    events: semanticEvents,
    coverage: (address) => state.status === "done" ? state.result.wallets.find((w) => w.wallet === address)?.coverage ?? null : null,
    addressState: (address) => addressState(address, c, registry, programs),
    isCustodial: (address) => registry.lookup(address)?.category === "exchange",
    serviceOf: (address) => registry.lookup(address),
    hasUserLabel: (address) => Boolean(names.label(address)),
  }), [semanticEvents, state, c, programs, names]);
  const startTrace = (seed: TraceSeed, refs?: MovementRef[]) => { setTraceSeed({ seed, refs }); routeTo("trace"); };
  const shareSearch = buildMapSearch({ wallet: c.primaryWallet, range: c.range });

  // Lane order: saved order, else primary then first appearance. Focus narrows without changing it.
  const [focus, setFocus] = useState<ReadonlySet<string>>(new Set());
  const order = useMemo(() => {
    const firstSeen = new Map<string, number>();
    for (const ws of walletStates?.states ?? []) {
      const t = ws.effects.find((e) => e.timestamp)?.timestamp;
      if (t) firstSeen.set(ws.wallet, Date.parse(t));
    }
    return laneOrder(c, firstSeen);
  }, [c, walletStates]);
  const shownLanes = useMemo(() => visibleLanes(order, c.hiddenLanes ?? [], focus), [order, c.hiddenLanes, focus]);
  const lanes = useMemo<WalletLane[]>(
    () =>
      shownLanes.flatMap((wallet) => {
        const data = perWallet.get(wallet);
        const config = c.mappedWallets.find((w) => w.address === wallet);
        if (!data || !config) return [];
        const r = walletRange(c, config);
        const tags = names.tags(wallet);
        return [
          {
            wallet,
            state: data.state,
            summaries: data.summaries,
            range: r,
            label: names.known(wallet) ?? shortenAddress(wallet, 4),
            sublabel: [names.known(wallet) ? shortenAddress(wallet, 4) : null, tags[0] ?? null].filter(Boolean).join(" · ") || undefined,
            ...(config.rangeMode === "first_interaction" && config.addedFromWallet ? { forkFrom: { wallet: config.addedFromWallet, time: r.start } } : {}),
          },
        ];
      }),
    [shownLanes, perWallet, c, names],
  );
  // Who the shown lanes dealt with, through the same filters as every view.
  const counterparties = useMemo(
    () =>
      collectCounterparties(
        shownLanes.flatMap((wallet) => {
          const data = perWallet.get(wallet);
          return data ? [{ wallet, summaries: data.summaries, signatures: data.state.effects.map((e) => e.signature) }] : [];
        }),
      ).map((r) => ({ ...r, state: addressState(r.address, c, registry, programs) })),
    [shownLanes, perWallet, c, programs],
  );
  // Every mapped wallet each signature belongs to.
  const owners = useMemo(() => {
    const out = new Map<string, string[]>();
    for (const w of state.status === "done" ? state.result.wallets : []) for (const sig of w.signatures) out.set(sig, [...(out.get(sig) ?? []), w.wallet]);
    return out;
  }, [state]);

  // Everything search can find in this case.
  const searchIndex = useMemo<SearchItem[]>(() => {
    const items: SearchItem[] = [];
    const mapped = new Set(c.mappedWallets.map((w) => w.address));
    for (const w of c.mappedWallets) {
      items.push({ kind: "wallet", id: w.address, label: names.of(w.address), detail: shortenAddress(w.address, 6), keywords: [w.address, ...names.tags(w.address)] });
    }
    const seen = new Set<string>();
    const addAddress = (a: string) => {
      if (mapped.has(a) || seen.has(a)) return;
      seen.add(a);
      const label = names.label(a);
      items.push({
        kind: "address",
        id: a,
        label: names.of(a),
        detail: [shortenAddress(a, 6), ...(label?.tags ?? [])].join(" · "),
        keywords: [a, ...(label?.tags ?? []), ...(label?.note ? [label.note] : []), ...(registry.lookup(a) ? [registry.lookup(a)!.protocolName] : [])],
      });
    };
    for (const l of labels) addAddress(l.address);
    const assetIds = new Set<string>();
    const protocolIds = new Set<string>();
    const tags = new Set<string>();
    for (const [wallet, rows] of filterables) {
      for (const row of rows) {
        for (const a of row.addresses) addAddress(a);
        for (const a of movedAssets(row.summary)) assetIds.add(a);
        for (const p of row.protocols) protocolIds.add(p);
        if (!seen.has(`tx:${row.signature}`)) {
          seen.add(`tx:${row.signature}`);
          items.push({
            kind: "transaction",
            id: row.signature,
            label: shortenAddress(row.signature, 6),
            detail: `${formatUtcMinute(row.time)} UTC · ${row.event ? eventLabel(row.event, wallet) : kindLabel(row.summary.kind)} · ${names.of(wallet)}`,
            keywords: row.event ? [row.event.category.toLowerCase().replaceAll("_", " "), ...(row.event.protocol ? [row.event.protocol.name] : [])] : [],
          });
        }
      }
    }
    for (const l of labels) for (const t of l.tags) tags.add(t);
    for (const t of tags) items.push({ kind: "tag", id: t, label: t, detail: "Filter to transactions involving it", keywords: [] });
    for (const id of assetIds) {
      const meta = walletStates?.assets.get(id);
      items.push({ kind: "asset", id, label: meta?.symbol || meta?.name || shortenAddress(id, 4), detail: meta?.name ?? undefined, keywords: [meta?.name ?? "", meta?.symbol ?? ""].filter(Boolean) });
    }
    for (const id of protocolIds) {
      const p = registry.protocols.get(id);
      items.push({ kind: "protocol", id, label: p?.name ?? id, detail: p?.category.replace("_", " "), keywords: [id] });
    }
    return items;
  }, [c.mappedWallets, names, labels, filterables, walletStates]);

  /** Show a mapped wallet in the inspector: the last pick wins over any open address, line or transaction. */
  function pickWallet(address: string) {
    setSelectedWallet(address);
    setSelectedAddress(null);
    setSelectedEdge(null);
    setTableTx(null);
    timelineRef.current?.clearSelection();
  }

  /** Select a transaction on the timeline, switching to it if needed. */
  function goToTransaction(signature: string, wallet?: string) {
    if (view === "timeline" && timelineRef.current) {
      if (timelineRef.current.jumpTo(signature, wallet)) return;
      if (timelineRef.current.hiddenByView(signature)) {
        toast.info("That transaction is hidden by this case's View settings.", {
          action: {
            label: "Show",
            onClick: () => {
              pendingJump.current = { signature, wallet };
              void showHiddenTimeline();
            },
          },
        });
      } else toast.info("That transaction is hidden by your filters or a hidden lane.");
      return;
    }
    setFocusSignature(signature);
    routeTo("timeline");
  }

  function pickSearch(item: SearchItem) {
    setSearchOpen(false);
    const earliest = (match: (row: FilterableTx) => boolean) => {
      let best: FilterableTx | undefined;
      let bestWallet: string | undefined;
      for (const [wallet, rows] of filterables) {
        for (const row of rows) {
          if (match(row) && (!best || row.time < best.time)) {
            best = row;
            bestWallet = wallet;
          }
        }
      }
      return best && { signature: best.signature, wallet: bestWallet };
    };
    if (item.kind === "wallet") pickWallet(item.id);
    else if (item.kind === "address") setSelectedAddress(item.id);
    else if (item.kind === "transaction") goToTransaction(item.id, owners.get(item.id)?.[0]);
    else if (item.kind === "tag") {
      setFilter((f) => ({ ...f, tags: new Set([item.id]) }));
      toast.success(`Showing transactions involving “${item.id}”.`);
    } else {
      const first = earliest((row) => (item.kind === "asset" ? movedAssets(row.summary).includes(item.id) : row.protocols.includes(item.id)));
      if (first) goToTransaction(first.signature, first.wallet);
    }
  }

  async function updateCase(next: FraudWatchCase) {
    try {
      await getDb().cases.put(next);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the case.");
    }
  }

  const result = state.status === "done" ? state.result : null;
  // Transactions each mapped wallet shares with every other mapped wallet.
  const shared = useMemo(() => (result ? sharedTransactions(result.wallets) : new Map<string, Map<string, string[]>>()), [result]);
  const summary = useMemo(() => {
    const w = justMapped ? result?.wallets.find((x) => x.wallet === justMapped) : undefined;
    if (!w || !result || !walletStates) return null;
    // Counterparties of a wallet, from its reconstructed effects.
    const counterpartiesOf = (wallet: string) => {
      const s = walletStates.states.find((x) => x.wallet === wallet);
      if (!s) return [];
      const summaries = s.effects.map((e) => summarizeEffect(e, result.transactions.get(e.signature), nfts));
      return collectCounterparties([{ wallet, summaries, signatures: s.effects.map((e) => e.signature) }]).map((r) => r.address);
    };
    const mapped = c.mappedWallets.map((m) => m.address);
    const known = new Set([...mapped, ...mapped.filter((m) => m !== w.wallet).flatMap(counterpartiesOf)]);
    return mappingSummary(w, shared, counterpartiesOf(w.wallet), known);
  }, [justMapped, result, walletStates, shared, c.mappedWallets, nfts]);

  async function confirmMap(address: string, choice: MapWalletChoice) {
    setMapBusy(true);
    setMapError(null);
    try {
      const first = result ? firstInteraction(address, result.transactions.values()) : null;
      // It forks off the mapped wallet that shared that first transaction, not whichever is selected.
      const parent = first ? (owners.get(first.signature)?.[0] ?? selectedWallet) : undefined;
      const next = mapWallet(c, {
        address,
        ...choice,
        addedFromWallet: parent,
      });
      await getDb().cases.put(next);
      setMapTarget(null);
      setAddingWallet(false);
      setSelectedAddress(null);
      setSelectedEdge(null);
      setSelectedWallet(address);
      setJustMapped(address);
      if (rpc) void ingestion.start(rpc.url, next);
    } catch (err) {
      setMapError(err instanceof Error ? err.message : "Could not map this wallet.");
    } finally {
      setMapBusy(false);
    }
  }

  async function unmap(address: string) {
    const index = c.mappedWallets.findIndex((w) => w.address === address);
    const config = c.mappedWallets[index];
    try {
      await getDb().cases.put(unmapWallet(c, address));
      if (selectedWallet === address) setSelectedWallet(c.primaryWallet);
      if (justMapped === address) setJustMapped(null);
      setSelectedAddress(null);
      toast.success(`${names.of(address)} removed from the map. Its label and cached transactions are kept.`, {
        // Undo puts it back where it was, with the same settings; its cached history is still there.
        action: {
          label: "Undo",
          onClick: () => {
            const latest = latestCase.current;
            if (!config || latest.mappedWallets.some((w) => w.address === address)) return;
            const mappedWallets = [...latest.mappedWallets];
            mappedWallets.splice(Math.min(index, mappedWallets.length), 0, config);
            void updateCase({ ...latest, mappedWallets, updatedAt: new Date().toISOString() });
          },
        },
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove this wallet.");
    }
  }

  const formatAmount = (amount: string, assetId: string, signed = false) => {
    if (!walletStates || !walletState) return amount;
    const source = walletStates.states.find((st) => assetId in st.decimals) ?? walletState;
    return formatAssetAmount(amount, assetId, source, walletStates.assets, signed);
  };
  // One mapped wallet's side of the filtered transactions the views show; effects and summaries are filtered in lockstep.
  const walletRows = (address: string): TransactedRow[] => {
    const data = perWallet.get(address);
    if (!data) return [];
    const rows: TransactedRow[] = [];
    const { effects } = data.state;
    data.summaries.forEach((summary, i) => {
      const effect = effects[i];
      if (effect) rows.push({ signature: effect.signature, time: effect.timestamp ? Date.parse(effect.timestamp) : null, summary });
    });
    return rows;
  };
  // Any other address (a clicked graph node or counterparty) is read from the visible lanes' transactions with it;
  // its other side is that lane's wallet, with the opposite deltas.
  const overviewFor = (address: string): TransactedRow[] => {
    if (perWallet.has(address)) return walletRows(address);
    const out: TransactedRow[] = [];
    for (const lane of shownLanes) {
      for (const row of counterpartyRows(address, walletRows(lane))) {
        out.push({
          ...row,
          summary: {
            ...row.summary,
            counterparties: [...row.summary.inflows, ...row.summary.outflows].map((c) => ({
              address: lane,
              assetId: c.assetId,
              delta: c.delta.startsWith("-") ? c.delta.slice(1) : `-${c.delta}`,
            })),
          },
        });
      }
    }
    return out;
  };

  const rangeText = (address: string) => {
    const w = c.mappedWallets.find((m) => m.address === address);
    if (!w) return "";
    const r = walletRange(c, w);
    const how = w.rangeMode === "first_interaction" ? " (first interaction)" : w.rangeMode === "custom" ? " (custom start)" : "";
    return `from ${formatUtcMinute(r.start)} UTC${how} to the case end`;
  };

  const panelFor = (address: string, beforeAnnotations?: React.ReactNode, withAssets = true) => {
    // A clicked address opens with what moved through it; addresses without loaded history have none.
    const rows = withAssets ? overviewFor(address) : [];
    const flows = transactedOverview(rows, nfts).assets;
    const assetFlows = flows.length > 0 && walletStates && (
      <AssetFlows
        flows={flows.map((a) => ({ assetId: a.assetId, received: a.in, sent: a.out, txCount: a.count }))}
        assets={walletStates.assets}
        formatAmount={formatAmount}
      />
    );
    return (
      <AddressPanel
        key={address}
        caseId={c.id}
        address={address}
        state={addressState(address, c, registry, programs)}
        label={names.label(address)}
        entry={registry.lookup(address)}
        lookalikes={names.lookalikes(address)}
        publicName={
          registry.lookup(address)
            ? undefined
            : communityLabel(address)
              ? { source: "community", text: communityLabel(address)! }
              : snsNames.get(address)
                ? { source: "sns", text: snsNames.get(address)! }
                : undefined
        }
        verdictOf={names.verdict}
        onHideDecoys={decoysHidden ? undefined : hideDecoys}
        onSelectAddress={setSelectedAddress}
        onTrace={() => startTrace({ kind: "address", address })}
        transactionCount={address === selectedWallet ? undefined : counterparties.find((r) => r.address === address)?.count}
        beforeAnnotations={
          <>
            {assetFlows}
            {beforeAnnotations}
          </>
        }
        onMap={() => {
          setMapError(null);
          setMapTarget(address);
        }}
        mapped={
          c.mappedWallets.some((m) => m.address === address) && address !== c.primaryWallet
            ? {
                rangeText: rangeText(address),
                // eslint-disable-next-line react-hooks/refs -- unmap reads the latest case only in its Undo click handler, never during render
                onUnmap: () => void unmap(address),
                paused: Boolean(c.mappedWallets.find((m) => m.address === address)?.paused),
                onTogglePaused: () => void updateCase(toggleWalletPaused(c, address)),
              }
            : undefined
        }
        bookmark={{ on: isBookmarked(c, "wallet", address), toggle: () => void updateCase(toggleBookmark(c, { kind: "wallet", target: address })) }}
        onFilterTo={
          c.mappedWallets.some((m) => m.address === address)
            ? undefined
            : { active: filter.address === address, toggle: () => updateFilter({ ...filter, address: filter.address === address ? null : address }) }
        }
        lane={
          c.mappedWallets.length > 1 && c.mappedWallets.some((m) => m.address === address)
            ? { hidden: (c.hiddenLanes ?? []).includes(address), onToggle: () => void updateCase(toggleLaneHidden(c, address)) }
            : undefined
        }
      />
    );
  };
  // The inspector shows the last thing selected; an address stays until something else is picked.

  const walletInspector = panelFor(
    selectedWallet,
    walletState && walletStates && (
      <PanelSection title="Wallet state" defaultCollapsed>
        <WalletStateSummary state={walletState} assets={walletStates.assets} />
      </PanelSection>
    ),
  );

  // Only the wallet addresses, so saving a view setting on the case doesn't rebuild the graph.
  const mappedKey = c.mappedWallets.map((w) => w.address).join(",");
  const caseWallets = useMemo(() => ({ primaryWallet: c.primaryWallet, mappedWallets: mappedKey.split(",").map((address) => ({ address })) }), [c.primaryWallet, mappedKey]);
  // The interaction map covers every visible lane, from the same filtered transactions as the timeline.
  const graph = useMemo(() => {
    if (view !== "graph") return null;
    const sides = shownLanes.flatMap((wallet) => {
      const data = perWallet.get(wallet);
      return data ? [{ wallet, effects: data.state.effects, summaries: data.summaries, events: data.state.effects.map((e) => semanticEvents.get(e.signature)) }] : [];
    });
    return buildInteractionGraph(sides, {
      observed: observedAddresses,
      hiddenAssets: filter.hiddenAssets,
      showPrograms,
      maxNodes: graphNodeLimit === "all" ? (confirmLarge && !allowLarge ? LARGE_GRAPH : Infinity) : Number(graphNodeLimit),
      ranking: graphRanking,
      lowValue: graphLowValue,
      decimalsOf,
      // Look-alikes and labelled addresses are investigation signals: they always keep their own node.
      clusterOf: (address) => {
        if (names.verdict(address) === "decoy") return "decoy";
        if (names.lookalikes(address).length > 0 || names.label(address)) return null;
        if (addressState(address, caseWallets, registry, programs) === "INFRASTRUCTURE") return "infrastructure";
        return names.known(address) ? "known" : "unknown";
      },
      expandedClusters,
      expandedEntities: graphEntities,
    });
  }, [view, shownLanes, perWallet, semanticEvents, observedAddresses, filter.hiddenAssets, showPrograms, caseWallets, graphNodeLimit, confirmLarge, allowLarge, graphRanking, graphLowValue, decimalsOf, names, programs, expandedClusters, graphEntities]);
  // Event categories the timeline's View settings leave off; whole transactions, counted on the timeline.
  const hideProgramCalls = prefs.get("timeline.programInteractions") === "hidden";
  const hideNfts = prefs.get("timeline.nft") === "hidden";
  const timelineHidden = useMemo(
    () => new Set<EventCategory>([...(hideProgramCalls ? (["PROGRAM_INTERACTION"] as const) : []), ...(hideNfts ? (["NFT_TRADE", "NFT_TRANSFER", "NFT_MINT"] as const) : [])]),
    [hideProgramCalls, hideNfts],
  );
  const showHiddenTimeline = () => prefs.setManyForCase({ "timeline.programInteractions": "shown", "timeline.nft": "shown" });
  /** A jump waiting for hidden transactions to be shown again. */
  const pendingJump = useRef<{ signature: string; wallet?: string } | null>(null);
  useEffect(() => {
    const jump = pendingJump.current;
    if (jump && timelineRef.current?.jumpTo(jump.signature, jump.wallet)) pendingJump.current = null;
  }, [timelineHidden]);
  /** Asks first when an action would draw more than LARGE_GRAPH addresses (unless that's switched off). */
  const guardLarge = (count: number, run: () => void) => (confirmLarge && count > LARGE_GRAPH ? setConfirmDraw({ count, run }) : run());
  const edge = graph?.edges.find((e) => e.id === selectedEdge);
  // The Timeline narrowed to exactly the transactions behind some graph lines.
  const openInTimeline = (label: string, lines: readonly GraphEdge[]) => {
    setSelectedEdge(null);
    if (selectedAddress && entityProtocol(selectedAddress)) setSelectedAddress(null);
    setFilter((current) => ({ ...current, relationship: { label, signatures: new Set(lines.flatMap((line) => line.interactions.map((it) => it.signature))) } }));
    routeTo("timeline");
  };
  const toggleEntity = (protocolId: string) => {
    // An expanded service's node is gone from the map, so its selection goes too.
    if (selectedAddress === entityNodeId(protocolId)) {
      setSelectedAddress(null);
      setSelectedEdge(null);
    }
    setGraphEntities((current) => toggled(current, protocolId));
  };
  const selectedEntity = selectedAddress ? entityProtocol(selectedAddress) : undefined;
  const addressPanel =
    selectedAddress &&
    (selectedEntity ? (
      <EntityPanel
        key={selectedEntity}
        protocolId={selectedEntity}
        addresses={graph?.nodes.find((node) => node.id === selectedAddress)?.entity?.addresses ?? []}
        names={names}
        onSelectAddress={setSelectedAddress}
        onExpand={() => toggleEntity(selectedEntity)}
        onOpenInTimeline={() =>
          openInTimeline(
            graphNames.of(selectedAddress),
            (graph?.edges ?? []).filter((line) => line.kind === "interaction" && (line.a === selectedAddress || line.b === selectedAddress)),
          )
        }
        onClose={() => setSelectedAddress(null)}
      />
    ) : (
      panelFor(selectedAddress)
    ));
  const graphWallet = shownLanes.includes(selectedWallet) ? selectedWallet : (shownLanes[0] ?? selectedWallet);

  // Hiding: one write per batch, with Undo. Undo reverses just that batch on the case as it is then.
  const latestCase = useRef(c);
  useEffect(() => {
    latestCase.current = c;
  }, [c]);
  const undoOf = (before: FraudWatchCase, next: FraudWatchCase) => () => void updateCase(revertHiding(latestCase.current, before, next));
  const changeHiding = (next: FraudWatchCase, message: string) => {
    void updateCase(next);
    toast.success(message, { action: { label: "Undo", onClick: undoOf(c, next) } });
  };
  // After a hide, the toast offers to turn it into a rule, prefilled from what was hidden and the filter in use.
  const hideBatch = (signatures: string[], context: TxFilter = EMPTY_FILTER) => {
    const next = hideTransactions(c, signatures);
    const wanted = new Set(signatures);
    const rows = [...filterables.values()].flat().filter((row) => wanted.has(row.signature));
    const name = `Rule ${(c.hideRules?.length ?? 0) + 1}`;
    void updateCase(next);
    toast.success(`Hid ${signatures.length.toLocaleString()} transaction${signatures.length === 1 ? "" : "s"} from the map.`, {
      action: { label: "Make a rule", onClick: () => setRulesDialog(ruleFrom(rows, context, crypto.randomUUID(), name)) },
      cancel: { label: "Undo", onClick: undoOf(c, next) },
    });
  };
  // The timeline minimap's activity: every filter but the date range, which the minimap itself sets.
  const overviewTimes = useMemo(() => {
    if (!filter.dateRange) return undefined;
    const undated = { ...filter, dateRange: null };
    const times = new Map<string, number>();
    for (const wallet of shownLanes) {
      for (const row of filterables.get(wallet) ?? []) {
        if (!reasons.has(row.signature) && passesFilter(row, undated, names.tags, isDecoy)) times.set(row.signature, row.time);
      }
    }
    return [...times.values()];
  }, [filter, shownLanes, filterables, reasons, names, isDecoy]);
  // What the views show right now (every visible lane), once per transaction.
  const shownNow = [...new Set(shownLanes.flatMap((w) => perWallet.get(w)?.state.effects.map((e) => e.signature) ?? []))];
  // What the filters take out of view (not already hidden, and not shown on another lane): the noise when types or assets are unticked.
  const filteredOut = (() => {
    if (!isFilterActive(filter)) return [];
    const shownSet = new Set(shownNow);
    const out = shownLanes.flatMap((w) =>
      (filterables.get(w) ?? []).filter(
        (row) => !shownSet.has(row.signature) && !(passesFilter(row, filter, names.tags, isDecoy) && !(filter.hideDecoys && isDecoy(w))) && !reasons.has(row.signature),
      ),
    );
    return [...new Set(out.map((row) => row.signature))];
  })();
  const unhideBatch = (signatures: string[]) => {
    // Ones a rule would still hide become exceptions, so they really come back.
    const rulesOnly = { hideRules: c.hideRules };
    const wanted = new Set(signatures);
    const ruleMatched = hidingRows.filter((row) => wanted.has(row.signature) && hiddenBy(rulesOnly, row, names.tags) !== null).map((row) => row.signature);
    changeHiding(unhideTransactions(c, signatures, ruleMatched), `Brought back ${signatures.length.toLocaleString()} transaction${signatures.length === 1 ? "" : "s"}.`);
  };

  // The table's open transaction, in the same panel the timeline uses; the table supplies its own order for stepping.
  const tableDetails = (nav: TableNav | null) => {
    // From the table's rows, which include hidden transactions when "Show hidden" is on: the open side's wallet.
    const table = tableTx ? perWallet.get(tableTx.wallet)?.table : undefined;
    const index = table && tableTx ? table.state.effects.findIndex((e) => e.signature === tableTx.signature) : -1;
    if (!nav || !table || !walletStates || state.status !== "done" || index === -1) return null;
    const effect = table.state.effects[index];
    return (
      <TransactionDetails
        key={effect.signature}
        effect={effect}
        summary={table.summaries[index]}
        event={semanticEvents.get(effect.signature)}
        onTrace={() => startTrace({ kind: "transaction", signature: effect.signature })}
        wallet={tableTx!.wallet}
        observations={observations.filter((o) => o.events.some((e) => e.signature === effect.signature))}
        tx={state.result.transactions.get(effect.signature)}
        state={table.state}
        assets={walletStates.assets}
        position={{ index: nav.index, count: nav.count }}
        onPrevious={nav.previous}
        onNext={nav.next}
        onClose={() => setTableTx(null)}
        onHide={() => {
          // Move on to a neighbour so stepping through isn't interrupted.
          setTableTx(nav.neighbour);
          hideBatch([effect.signature]);
        }}
        names={names}
        onSelectAddress={setSelectedAddress}
        sharedWith={(owners.get(effect.signature) ?? []).filter((w) => w !== tableTx!.wallet)}
        walletName={c.mappedWallets.length > 1 ? names.of(tableTx!.wallet) : undefined}
        bookmarked={isBookmarked(c, "transaction", effect.signature)}
        onToggleBookmark={() => void updateCase(toggleBookmark(c, { kind: "transaction", target: effect.signature, wallet: tableTx!.wallet }))}
      />
    );
  };

  let center: React.ReactNode;
  if (view === "trace") {
    center = <TraceView caseId={c.id} traceId={route.traceId} evidence={traceEvidence} index={traceIndex} caseRange={c.range} loadedRange={(address) => { const wallet = c.mappedWallets.find((item) => item.address === address); return wallet ? walletRange(c, wallet) : null; }} hiddenReason={(signature) => reasons.get(signature) === "manual" ? "manual" : reasons.get(signature) ? "rule" : null} wallets={c.mappedWallets.map((wallet) => wallet.address)} names={canvasNames} assets={walletStates?.assets ?? EMPTY_ASSETS} observations={observations} requestedSeed={traceSeed} onSeedHandled={() => setTraceSeed(null)} onMapWallet={(address) => { setMapError(null); setMapTarget(address); }} onOpenTransaction={(signature, from, to) => goToTransaction(signature, c.mappedWallets.find((wallet) => wallet.address === from || wallet.address === to)?.address)} loadStatus={state.status} loadError={state.status === "error" ? state.error : null} />;
  } else if (state.status === "done" && walletStates && walletState && visible && visibleState) {
    center =
      view === "graph" && graph ? (
        <>
          <WalletGraph
            graph={graph}
            wallet={graphWallet}
            primaryWallet={c.primaryWallet}
            names={graphNames}
            reducedMotion={reducedMotion}
            assetInfo={(assetId) => ({ id: assetId, label: assetLabel(assetId, walletStates.assets), logo: assetLogo(assetId, walletStates.assets) })}
            stateOf={(address) => addressState(address, c, registry, programs)}
            selectedNode={selectedAddress}
            selectedEdge={edge?.id ?? null}
            onSelectNode={setSelectedAddress}
            onSelectEdge={setSelectedEdge}
            showPrograms={showPrograms}
            onToggleProgramCalls={() => void prefs.setForCase("graph.programs", showPrograms ? "hidden" : "shown")}
            ranking={graphRanking}
            onRankingChange={setGraphRanking}
            nodeLimit={graphNodeLimit === "all" ? null : (Number(graphNodeLimit) as 10 | 25 | 50 | 100)}
            onNodeLimitChange={(limit) => void prefs.setForCase("graph.nodeLimit", limit === null ? "all" : (String(limit) as "10" | "25" | "50" | "100"))}
            timeRange={filter.dateRange}
            onClearTimeRange={() => updateFilter({ ...filter, dateRange: null })}
            expandedClusters={expandedClusters}
            onToggleCluster={(kind) => {
              if (kind === "known") return setKnownFlippedAt((at) => (at === knownSetting ? null : knownSetting));
              const opening = !graphClusters.has(kind);
              const toggle = () => setGraphClusters((current) => toggled(current, kind));
              const size = graph.nodes.find((n) => n.cluster?.kind === kind)?.cluster?.addresses ?? 0;
              if (opening) guardLarge(graph.counts.addresses + size, toggle);
              else toggle();
            }}
            expandedEntities={graphEntities}
            onToggleEntity={toggleEntity}
            spacing={prefs.get("graph.spacing")}
            onSpacingChange={(spacing) => void prefs.setForCase("graph.spacing", spacing)}
            arrows={prefs.get("graph.arrows")}
            lowValueHidden={graph.counts.lowValueHidden}
            onShowLowValue={() => void prefs.setForCase("graph.lowValue", "shown")}
            viewSettings={<ViewSettingsPanel prefs={prefs} keys={GRAPH_VIEW_KEYS} title="Graph" appliedPreset={c.viewSettings?.appliedPreset} />}
            drawAll={
              graphNodeLimit === "all" &&
              confirmLarge &&
              !allowLarge &&
              graph.omittedNodes > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    title={`Showing the top ${LARGE_GRAPH.toLocaleString()}. Large maps can be slow.`}
                    onClick={() => guardLarge(graph.counts.addresses + graph.omittedNodes, () => setAllowLarge(true))}
                  >
                    Draw all {(graph.counts.addresses + graph.omittedNodes).toLocaleString()}
                  </Button>
              )
            }
          />
          {(rightOpen || addressPanel || edge) && (
            <SidePanel side="right" label="Inspector">
              {edge ? (
                <>
                  <EdgePanel
                    key={edge.id}
                    edge={edge}
                    focusWallet={graphWallet}
                    names={graphNames}
                    assets={walletStates.assets}
                    formatAmount={formatAmount}
                    events={semanticEvents}
                    observations={observations.filter((o) => {
                      // Patterns one end of the line was in, with the other end on the other side.
                      const other = o.wallet === edge.a ? edge.b : o.wallet === edge.b ? edge.a : null;
                      return other !== null && (o.values.counterparty === other || o.values.depositAddress === other || o.events.some((e) => e.counterparty === other));
                    })}
                    onSelectAddress={setSelectedAddress}
                    onShowOnTimeline={(signature, wallet) => {
                      setSelectedEdge(null);
                      goToTransaction(signature, wallet);
                    }}
                    onViewAll={(counterparty) => {
                      setSelectedEdge(null);
                      routeTo("table", counterparty);
                    }}
                    onOpenInTimeline={() => openInTimeline(`${graphNames.of(edge.a)} ↔ ${graphNames.of(edge.b)}`, [edge])}
                    onClose={() => setSelectedEdge(null)}
                    onTrace={() => {
                      const signatures = new Set(edge.interactions.map((item) => item.signature));
                      const side = (address: string) => { const entry = registry.lookup(address); return entry && entry.category !== "core" && !c.mappedWallets.some((wallet) => wallet.address === address) ? entityNodeId(entry.protocolId) : address; };
                      const refs = [...signatures].flatMap((signature) => {
                        const event = semanticEvents.get(signature);
                        return event ? classifyEvent(event).flatMap((item) => item.kind === "movement" && item.ref.from && item.ref.to && ((side(item.ref.from) === edge.a && side(item.ref.to) === edge.b) || (side(item.ref.from) === edge.b && side(item.ref.to) === edge.a)) ? [item.ref] : []) : [];
                      });
                      if (refs.length) startTrace({ kind: "address", address: refs[0].from! }, refs);
                      else toast.info("No traceable movements on this connection.");
                    }}
                  />
                  {/* An endpoint's Assets would repeat the connection's Assets above it. */}
                  {selectedAddress && (selectedEntity ? addressPanel : panelFor(selectedAddress, undefined, selectedAddress !== edge.a && selectedAddress !== edge.b))}
                </>
              ) : (
                addressPanel || walletInspector
              )}
            </SidePanel>
          )}
        </>
      ) : view === "timeline" ? (
        <WalletTimeline
          ref={timelineRef}
          initialSignature={focusSignature}
          lanes={lanes}
          transactions={state.result.transactions}
          events={semanticEvents}
          observations={observations}
          onShowInGraph={(signature) => {
            // The same event identity on both views: the Graph narrowed to this one event's wallets.
            setFilter((current) => ({ ...current, relationship: { label: `the wallets in ${shortenAddress(signature, 4)}`, signatures: new Set([signature]) } }));
            routeTo("graph");
          }}
          range={c.range}
          assets={walletStates.assets}
          names={canvasNames}
          compactAmounts={prefs.get("appearance.numberFormat") === "compact"}
          density={prefs.get("timeline.density")}
          connectorMode={prefs.get("timeline.connectors")}
          hiddenCategories={timelineHidden}
          onShowHidden={() => void showHiddenTimeline()}
          viewSettings={<ViewSettingsPanel prefs={prefs} keys={TIMELINE_VIEW_KEYS} title="Timeline" appliedPreset={c.viewSettings?.appliedPreset} />}
          inspector={walletInspector}
          addressPanel={addressPanel}
          onSelectAddress={setSelectedAddress}
          inspectorOpen={rightOpen}
          emptyMessage={
            lanes.length === 0
              ? "Every lane is hidden. Show one from the Wallets panel."
              : lanes.some((l) => (walletStates.states.find((s) => s.wallet === l.wallet)?.effects.length ?? 0) > 0)
                ? "No transactions match the filters."
                : undefined
          }
          onHide={(signature) => hideBatch([signature])}
          onSelectLane={pickWallet}
          sharedWith={(signature, wallet) => (owners.get(signature) ?? []).filter((w) => w !== wallet)}
          isBookmarked={(signature) => isBookmarked(c, "transaction", signature)}
          onToggleBookmark={(signature, wallet) => void updateCase(toggleBookmark(c, { kind: "transaction", target: signature, wallet }))}
          onBookmarkTime={(time) => {
            void updateCase(toggleBookmark(c, { kind: "date", target: new Date(time).toISOString() }));
            toast.success(`Bookmarked ${formatUtcMinute(time)} UTC.`);
          }}
          initialTime={focusTime}
          onSelectTransaction={() => {
            setSelectedAddress(null);
            setSelectedEdge(null);
            if (inspectorMode === "on_selection") setRightOpen(true);
          }}
          onDateRangeChange={(dateRange) => updateFilter({ ...filter, dateRange })}
          overviewTimes={overviewTimes}
        />
      ) : (
        // Every shown lane, like the timeline and graph, through the same filters.
      <WalletStateTable
          lanes={shownLanes.flatMap((wallet) => {
            const data = perWallet.get(wallet);
            return data ? [{ wallet, ...data.table }] : [];
          })}
          assets={walletStates.assets}
          hiddenAssets={filter.hiddenAssets}
          walletName={(wallet) => names.of(wallet)}
          onHide={hideBatch}
          onUnhide={unhideBatch}
          selected={tableTx}
          onSelect={(side) => {
            // The inspector shows the last thing picked: this transaction now.
            setSelectedAddress(null);
            setTableTx(side);
          }}
          renderPanel={(nav) => {
            const details = tableDetails(nav);
            return (
              (rightOpen || addressPanel || details) && (
                <SidePanel side="right" label="Inspector">
                  {addressPanel || details || walletInspector}
                </SidePanel>
              )
            );
          }}
        />
      );
  } else {
    const message =
      state.status === "running"
        ? "Loading history…"
        : state.status === "error"
          ? "Loading failed. See History for details."
          : state.status === "done"
            ? walletStates
              ? "This wallet's history isn't loaded."
              : "Reconstructing wallet state…"
            : "Load this case's transactions to map them.";
    center = (
      <>
        <div className="flex min-w-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-sm text-muted-foreground">
          <p>{message}</p>
          {state.status === "idle" && rpc && (
            <Button size="sm" onClick={() => ingestion.start(rpc.url)}>
              Load transactions
            </Button>
          )}
        </div>
        {(rightOpen || addressPanel) && (
          <SidePanel side="right" label="Inspector">
            {addressPanel || walletInspector}
          </SidePanel>
        )}
      </>
    );
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <header className="relative flex h-11 shrink-0 items-center gap-1 border-b px-2">
        <Link href="/" aria-label="All cases" title="All cases" className={buttonVariants({ variant: "ghost", size: "icon-sm" })}>
          <ShieldIcon />
        </Link>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={leftOpen ? "Hide left panel" : "Show left panel"}
          aria-pressed={leftOpen}
          title="Toggle left panel"
          onClick={() => setLeftOpen((o) => !o)}
        >
          <PanelLeftIcon />
        </Button>
        <div className="ml-1 flex min-w-0 items-center gap-2">
          {renaming ? (
            <CaseNameInput id={c.id} name={c.name} onDone={() => setRenaming(false)} className="h-7 w-64 text-sm" />
          ) : (
            <button
              type="button"
              className="group/name flex min-w-0 items-center gap-1 rounded-md px-1 py-0.5 hover:bg-muted"
              title="Rename case"
              onClick={() => setRenaming(true)}
            >
              <h1 className="truncate text-sm font-medium">{c.name}</h1>
              <PencilIcon className="size-3 shrink-0 text-muted-foreground opacity-60 group-hover/name:opacity-100" aria-hidden />
              <span className="sr-only">Rename case</span>
            </button>
          )}
          <span className="hidden truncate text-xs text-muted-foreground md:inline">{formatRange(c.range)}</span>
        </div>

        {(
          <div className="absolute left-1/2 flex -translate-x-1/2 rounded-lg border p-0.5" role="group" aria-label="View">
            {(["timeline", "graph", "table", "trace"] as const).map((v) => (
              <Button
                key={v}
                size="xs"
                variant={view === v ? "secondary" : "ghost"}
                aria-pressed={view === v}
                onClick={() => {
                  routeTo(v, v === "table" ? filter.address : null);
                  setFocusSignature(undefined);
                  setFocusTime(undefined);
                  // A plain view switch starts the inspector fresh; jumps from a panel ("Show on timeline", "View all") keep it.
                  if (v !== view) {
                    setSelectedAddress(null);
                    setSelectedEdge(null);
                    setTableTx(null);
                  }
                }}
              >
                {v === "timeline" ? "Timeline" : v === "graph" ? "Graph" : v === "table" ? "Table" : "Trace"}
              </Button>
            ))}
          </div>
        )}

        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setSearchOpen(true)} title="Search this case (⌘K)">
            <SearchIcon />
            Search
            <kbd className="ml-1 rounded border px-1 text-[10px] text-muted-foreground">⌘K</kbd>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            title="Opens this wallet and date range on another browser. Contains only the wallet and dates, never labels or RPC settings."
            onClick={() => copy(`${window.location.origin}/map/?${shareSearch}`, "Startup link")}
          >
            <Link2Icon />
            Copy link
          </Button>
          <RpcStatusBadge />
          <Link href="/settings/" aria-label="Settings" title="Settings" className={buttonVariants({ variant: "ghost", size: "icon-sm" })}>
            <SettingsIcon />
          </Link>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={rightOpen ? "Hide inspector" : "Show inspector"}
            aria-pressed={rightOpen}
            title="Toggle inspector"
            onClick={() => setRightOpen((o) => !o)}
          >
            <PanelRightIcon />
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {leftOpen && (
          <SidePanel side="left" label="Case">
            {rpcKnown && !rpc && (
              <div className="border-b p-3">
                <Alert>
                  <AlertTitle>No RPC configured</AlertTitle>
                  <AlertDescription>
                    Loading transactions needs your own Solana RPC endpoint.{" "}
                    <Link href="/settings/rpc/" className="underline underline-offset-4">
                      Add one in RPC settings
                    </Link>
                    .
                  </AlertDescription>
                </Alert>
              </div>
            )}
            <PanelSection
              title="Wallets"
              action={
                focus.size > 0 && (
                  <Button variant="ghost" size="xs" onClick={() => setFocus(new Set())}>
                    Clear focus
                  </Button>
                )
              }
            >
              <ShowMoreList items={order} limit={SHOWN_WALLETS}>
                {(listedWallets) => (
              <ul className="-mx-1 flex flex-col">
                {listedWallets.map((address, position) => {
                  const w = c.mappedWallets.find((m) => m.address === address)!;
                  const s = walletStates?.states.find((st) => st.wallet === address);
                  const flagged = s && (s.mismatches.length > 0 || s.openingStatus !== "OBSERVED");
                  const hidden = (c.hiddenLanes ?? []).includes(address);
                  const focused = focus.has(address);
                  const shown = shownLanes.includes(address);
                  return (
                    <li key={address} className="group/row relative flex items-center">
                      <button
                        type="button"
                        aria-current={address === selectedWallet}
                        onClick={() => pickWallet(address)}
                        className={cn(
                          "flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
                          address === selectedWallet ? "bg-muted" : "hover:bg-muted/50",
                          !shown && "opacity-50",
                        )}
                      >
                        <WalletIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                        <span className={cn("min-w-0 flex-1 truncate text-xs", !names.known(address) && "font-mono")}>
                          {names.of(address)}
                        </span>
                        {names.lookalikes(address).length > 0 && <LookalikeMark count={names.lookalikes(address).length} />}
                        {flagged && <span className="text-destructive" title="State mismatch or partial history">•</span>}
                        {w.paused && (
                          <span className="text-[10px] text-muted-foreground" title="Paused: only cached history is shown; it isn't loaded from the RPC">
                            paused
                          </span>
                        )}
                        {address === c.primaryWallet ? (
                          <Badge variant="secondary">primary</Badge>
                        ) : (
                          w.rangeMode !== "case" && (
                            <span className="text-[10px] text-muted-foreground" title={rangeText(address)}>
                              from {walletRange(c, w).start.slice(5, 10)}
                            </span>
                          )
                        )}
                      </button>
                      {c.mappedWallets.length > 1 && (
                        // Overlaid on hover so the wallet's name keeps its full width otherwise.
                        <span className="absolute top-1/2 right-1 flex -translate-y-1/2 rounded-md bg-muted opacity-0 transition-opacity group-hover/row:opacity-100 focus-within:opacity-100">
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            aria-label="Move lane up"
                            title="Move lane up"
                            disabled={position === 0}
                            onClick={() => void updateCase(moveLane(c, order, address, -1))}
                          >
                            <ArrowUpIcon />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            aria-label="Move lane down"
                            title="Move lane down"
                            disabled={position === order.length - 1}
                            onClick={() => void updateCase(moveLane(c, order, address, 1))}
                          >
                            <ArrowDownIcon />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            aria-label={hidden ? "Show lane" : "Hide lane"}
                            aria-pressed={hidden}
                            title={hidden ? "Show lane" : "Hide lane (stays mapped)"}
                            onClick={() => void updateCase(toggleLaneHidden(c, address))}
                          >
                            {hidden ? <EyeOffIcon /> : <EyeIcon />}
                          </Button>
                          <Button
                            variant={focused ? "secondary" : "ghost"}
                            size="icon-xs"
                            aria-label={focused ? "Remove from focus" : "Focus on this lane"}
                            aria-pressed={focused}
                            title="Focus: show only focused lanes, without unmapping the rest"
                            onClick={() => setFocus((f) => toggled(f, address))}
                          >
                            <FocusIcon />
                          </Button>
                          {address !== c.primaryWallet && (
                            <>
                              <Button
                                variant={w.paused ? "secondary" : "ghost"}
                                size="icon-xs"
                                aria-label={w.paused ? "Resume loading from the RPC" : "Pause loading from the RPC"}
                                aria-pressed={Boolean(w.paused)}
                                title={w.paused ? "Paused: shows cached history only. Click to load from the RPC again." : "Pause: keep cached history, never load more from the RPC"}
                                onClick={() => void updateCase(toggleWalletPaused(c, address))}
                              >
                                {w.paused ? <PlayIcon /> : <PauseIcon />}
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon-xs"
                                aria-label="Remove from map"
                                title="Remove from map (label and cached transactions are kept)"
                                onClick={() => void unmap(address)}
                              >
                                <Trash2Icon />
                              </Button>
                            </>
                          )}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
                )}
              </ShowMoreList>
              <Button
                variant="outline"
                size="sm"
                className="self-start"
                onClick={() => {
                  setMapError(null);
                  setAddingWallet(true);
                }}
              >
                <PlusIcon />
                Add wallet
              </Button>
              {focus.size > 0 && (
                <p className="text-xs text-muted-foreground">
                  Focus: {[...focus].map((f) => names.of(f)).join(" + ")}. Other lanes are still mapped.
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Only mapped wallets get a full history load. Counterparties stay shallow until you map them.
              </p>
            </PanelSection>
            {walletState && walletStates && visibleState && (
              <FilterPanel
                // Every view covers the same visible lanes.
                // Hidden transactions are out of every view, so the filters count only what's left.
                rows={shownLanes.flatMap((w) => filterables.get(w) ?? []).filter((row) => !reasons.get(row.signature))}
                assets={walletStates.assets}
                names={names}
                decimalsOf={(assetId) => decimalsOf(assetId) ?? 0}
                caseRange={c.range}
                filter={filter}
                // Distinct transactions: one two lanes share counts once, as in the table.
                shown={shownNow.length}
                onChange={updateFilter}
                decoyCount={decoySet.size}
                hidden={{
                  count: new Set(shownLanes.flatMap((w) => filterables.get(w) ?? []).filter((row) => reasons.get(row.signature)).map((row) => row.signature)).size,
                  onShow: () => document.getElementById("hidden-transactions")?.scrollIntoView({ behavior: "smooth", block: "nearest" }),
                }}
                // Filtering to the noise, then hiding it, is the everyday way to bulk-hide.
                hide={{
                  shown: { count: shownNow.length, run: () => hideBatch(shownNow, filter) },
                  filteredOut: { count: filteredOut.length, run: () => hideBatch(filteredOut, filter) },
                }}
              />
            )}
            {walletStates && (
              <div id="hidden-transactions">
                <HidingSection
                  c={c}
                  rows={hidingRows}
                  assets={walletStates.assets}
                  names={names}
                  decimalsOf={(assetId) => decimalsOf(assetId) ?? 0}
                  dialog={rulesDialog}
                  onDialog={setRulesDialog}
                  onPickInTable={view === "table" ? undefined : () => routeTo("table", filter.address)}
                  onSave={(next) => void updateCase(next)}
                />
              </div>
            )}
            {(c.bookmarks ?? []).length > 0 && (
              <PanelSection title={`Bookmarks (${c.bookmarks!.length})`}>
                <ul className="-mx-1 flex flex-col">
                  {[...c.bookmarks!]
                    .sort((a, b) => a.kind.localeCompare(b.kind) || a.createdAt.localeCompare(b.createdAt))
                    .map((b) => {
                      const Icon = b.kind === "wallet" ? WalletIcon : b.kind === "transaction" ? HashIcon : CalendarIcon;
                      const text =
                        b.kind === "wallet"
                          ? names.of(b.target)
                          : b.kind === "transaction"
                            ? shortenAddress(b.target, 5)
                            : `${formatUtcMinute(b.target)} UTC`;
                      return (
                        <li key={b.id} className="group/bm flex items-center">
                          <button
                            type="button"
                            className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1 text-left text-xs hover:bg-muted/50"
                            onClick={() => {
                              if (b.kind === "wallet") {
                                if (c.mappedWallets.some((w) => w.address === b.target)) pickWallet(b.target);
                                else setSelectedAddress(b.target);
                              } else if (b.kind === "transaction") goToTransaction(b.target, b.wallet);
                              else if (view === "timeline" && timelineRef.current) timelineRef.current.showTime(Date.parse(b.target));
                              else {
                                setFocusTime(Date.parse(b.target));
                                routeTo("timeline");
                              }
                            }}
                          >
                            <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                            <span className={cn("min-w-0 flex-1 truncate", b.kind !== "date" && !names.known(b.target) && "font-mono")}>{text}</span>
                          </button>
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            aria-label="Remove bookmark"
                            className="opacity-0 group-hover/bm:opacity-100 focus-visible:opacity-100"
                            onClick={() => void updateCase(removeBookmark(c, b.id))}
                          >
                            <XIcon />
                          </Button>
                        </li>
                      );
                    })}
                </ul>
              </PanelSection>
            )}
            {walletState && (
              <CounterpartyList rows={counterparties} names={names} selected={selectedAddress} onSelect={setSelectedAddress} />
            )}
            {justMapped && (
              <PanelSection
                title={`Mapping ${names.of(justMapped)}`}
                action={
                  <Button variant="ghost" size="xs" onClick={() => setJustMapped(null)}>
                    Dismiss
                  </Button>
                }
              >
                {state.status === "running" ? (
                  <p className="text-xs text-muted-foreground">Loading its history…</p>
                ) : summary ? (
                  <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 text-xs">
                    <dt className="text-muted-foreground">Transactions in range</dt>
                    <dd className="text-right tabular-nums">{summary.inRange.toLocaleString()}</dd>
                    <dt className="text-muted-foreground">Already cached</dt>
                    <dd className="text-right tabular-nums">{summary.cached.toLocaleString()}</dd>
                    <dt className="text-muted-foreground">Fetched</dt>
                    <dd className="text-right tabular-nums">{summary.fetched.toLocaleString()}</dd>
                    <dt className="col-span-2 pt-1.5 text-muted-foreground">Shared with mapped wallets</dt>
                    {summary.shared.length === 0 ? (
                      <dd className="col-span-2">None in the loaded range.</dd>
                    ) : (
                      summary.shared.map((s) => (
                        <div key={s.wallet} className="col-span-2 flex justify-between gap-2">
                          <dt className="truncate">{names.of(s.wallet)}</dt>
                          <dd className="tabular-nums">{s.count.toLocaleString()} tx</dd>
                        </div>
                      ))
                    )}
                    <dt className="pt-1.5 text-muted-foreground">New observed addresses</dt>
                    <dd className="pt-1.5 text-right tabular-nums">{summary.newObserved.toLocaleString()}</dd>
                  </dl>
                ) : (
                  <p className="text-xs text-muted-foreground">Load its history to see what it shares with the map.</p>
                )}
              </PanelSection>
            )}
            <IngestionPanel
              names={names}
              rpc={rpc}
              ingestion={ingestion}
              extend={
                extendedToToday(c.range)
                  ? {
                      lastDay: datesFromRange(c.range).endDate,
                      // Carry the case on to today, then load: the cache means only the new stretch is fetched.
                      run: () => {
                        const range = extendedToToday(c.range);
                        if (!range || !rpc) return;
                        const next = { ...c, range, updatedAt: new Date().toISOString() };
                        void updateCase(next).then(() => ingestion.start(rpc.url, next));
                      },
                    }
                  : undefined
              }
            />
            <div className="mt-auto p-2">
              <DeleteCaseButton id={c.id} name={c.name} />
            </div>
          </SidePanel>
        )}
        {center}
      </div>
      {searchOpen && <SearchDialog items={searchIndex} onPick={pickSearch} onClose={() => setSearchOpen(false)} />}
      {addingWallet && (
        <MapWalletDialog
          name=""
          lookalikesOf={lookalikesOf}
          first={null}
          enterAddress={{
            problem: (address) => newWalletProblem(address, c, (a) => addressState(a, c, registry, programs) === "INFRASTRUCTURE"),
            firstFor: (address) => (result ? firstInteraction(address, result.transactions.values()) : null),
          }}
          caseRange={c.range}
          hasRpc={Boolean(rpc)}
          busy={mapBusy}
          error={mapError}
          onConfirm={(choice, address) => address && void confirmMap(address, choice)}
          onCancel={() => setAddingWallet(false)}
        />
      )}
      {mapTarget && (
        <MapWalletDialog
          name={names.of(mapTarget)}
          address={mapTarget}
          lookalikesOf={lookalikesOf}
          first={result ? firstInteraction(mapTarget, result.transactions.values()) : null}
          caseRange={c.range}
          hasRpc={Boolean(rpc)}
          busy={mapBusy}
          error={mapError}
          onConfirm={(choice) => void confirmMap(mapTarget, choice)}
          onCancel={() => setMapTarget(null)}
        />
      )}
      <Dialog open={confirmDraw !== null} onOpenChange={(open) => !open && setConfirmDraw(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Draw {confirmDraw?.count.toLocaleString()} addresses?</DialogTitle>
            <DialogDescription>Large maps can be slow to draw and hard to read. You can turn this question off in Settings.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmDraw(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                confirmDraw?.run();
                setConfirmDraw(null);
              }}
            >
              Draw them
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownIcon, ArrowUpIcon, CalendarIcon, EyeIcon, EyeOffIcon, FocusIcon, Link2Icon, PanelLeftIcon, HashIcon, PanelRightIcon, PlusIcon, SearchIcon, ShieldIcon, WalletIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
import { RpcStatusBadge } from "@/components/rpc-status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { useIngestion } from "@/hooks/use-ingestion";
import { useLocalQuery } from "@/hooks/use-local-db";
import { useWalletStates } from "@/hooks/use-wallet-states";
import { addressState } from "@/lib/case/address-state";
import { isBookmarked, removeBookmark, toggleBookmark } from "@/lib/case/bookmarks";
import { laneOrder, moveLane, toggleLaneHidden, visibleLanes } from "@/lib/case/lanes";
import { firstInteraction, mapWallet, newWalletProblem, unmapWallet, walletRange, walletRanges } from "@/lib/case/wallet-range";
import { mappingSummary, sharedTransactions } from "@/lib/ingest/intersections";
import { buildInteractionGraph } from "@/lib/graph/build";
import type { FraudWatchCase } from "@/lib/case/model";
import { formatRange } from "@/lib/case/range";
import { getAddressLabels } from "@/lib/db/address-labels";
import { getCase, saveCase, touchCase } from "@/lib/db/cases";
import { getDb } from "@/lib/db/db";
import { getRpcSettings } from "@/lib/db/rpc-settings";
import { createNames } from "@/lib/labels/labels";
import { enrichTransaction, protocolsUsed, registry } from "@/lib/protocols/registry";
import { buildMapSearch } from "@/lib/routing/map-params";
import type { RpcSettings } from "@/lib/rpc/settings";
import { shortenAddress } from "@/lib/solana/address";
import { collectCounterparties } from "@/lib/state/counterparties";
import { type EffectSummary, type NftCatalog, summarizeEffect } from "@/lib/state/summarize";
import { EMPTY_FILTER, type FilterableTx, involvedAddresses, movedAssets, passesFilter, toggled } from "@/lib/timeline/filter";
import type { SearchItem } from "@/lib/search";
import { eventTimes } from "@/lib/timeline/layout";
import { cn } from "@/lib/utils";
import { AddressPanel } from "./address-panel";
import { CounterpartyList } from "./counterparty-list";
import { DeleteCaseButton } from "./delete-case-button";
import { FilterPanel } from "./filter-panel";
import { type MapWalletChoice, MapWalletDialog } from "./map-wallet-dialog";
import { EdgePanel } from "./graph/edge-panel";
import { WalletGraph } from "./graph/wallet-graph";
import { IngestionPanel } from "./ingestion-panel";
import { PanelSection, SidePanel } from "./panel";
import { type WalletLane, WalletTimeline, type WalletTimelineHandle } from "./timeline/wallet-timeline";
import { SearchDialog } from "./search-dialog";
import { formatAssetAmount } from "./asset-format";
import { WalletStateSummary, WalletStateTable } from "./wallet-state-view";

const NO_SUMMARIES: EffectSummary[] = [];

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${what} copied.`);
  } catch {
    toast.error("Clipboard unavailable.");
  }
}

export function CaseShell() {
  const id = useSearchParams().get("id") ?? "";
  const fwCase = useLocalQuery((db) => getCase(db, id), [id]);
  const rpc = useLocalQuery((db) => getRpcSettings(db), []);
  const found = fwCase.status === "ready" && fwCase.data !== undefined;

  useEffect(() => {
    if (found) void touchCase(getDb(), id).catch(() => {});
  }, [found, id]);

  if (fwCase.status === "loading") {
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

  return <CaseWorkspace key={fwCase.data.id} c={fwCase.data} rpc={rpc.status === "ready" ? rpc.data : undefined} rpcKnown={rpc.status === "ready"} />;
}

/**
 * Full-window workspace: the map fills the screen, with a thin top bar,
 * wallets and loading on the left, and an inspector on the right.
 * Cmd/Ctrl+\ hides both panels.
 */
function CaseWorkspace({ c, rpc, rpcKnown }: { c: FraudWatchCase; rpc: RpcSettings | undefined; rpcKnown: boolean }) {
  const ingestion = useIngestion(c);
  const { state } = ingestion;
  const walletStates = useWalletStates(state.status === "done" ? state.result : null, c.range, rpc?.url, walletRanges(c));
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [view, setView] = useState<"timeline" | "graph" | "table">("timeline");
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  /** Transaction to open the timeline on, from the graph's "Show on timeline". */
  const [focusSignature, setFocusSignature] = useState<string | undefined>(undefined);
  /** Moment to open the timeline on, from a date bookmark. */
  const [focusTime, setFocusTime] = useState<number | undefined>(undefined);
  const [selectedWallet, setSelectedWallet] = useState(c.primaryWallet);
  const [filter, setFilter] = useState(EMPTY_FILTER);
  /** Observed address the Map wallet dialog is open for. */
  const [mapTarget, setMapTarget] = useState<string | null>(null);
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
  const labelRows = useLocalQuery((db) => getAddressLabels(db, c.id), [c.id]);
  const names = useMemo(
    () => createNames(new Map((labelRows.status === "ready" ? labelRows.data : []).map((l) => [l.address, l])), registry),
    [labelRows],
  );

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
  // Summaries once per wallet (the costly part); filtering below is plain comparisons on them.
  const summariesByWallet = useMemo(() => {
    const out = new Map<string, EffectSummary[]>();
    if (!walletStates || !transactions) return out;
    for (const ws of walletStates.states) out.set(ws.wallet, ws.effects.map((e) => summarizeEffect(e, transactions.get(e.signature), nfts)));
    return out;
  }, [walletStates, transactions, nfts]);
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
          return { signature: e.signature, time: times[i], summary: sums[i], protocols, addresses: involvedAddresses(sums[i]) };
        }),
      );
    }
    return out;
  }, [walletStates, summariesByWallet, transactions, c.range.start]);
  // Only the views are filtered; the wallet state panel keeps the full history.
  const perWallet = useMemo(() => {
    const tagsOf = (address: string) => names.label(address)?.tags ?? [];
    const out = new Map<string, { all: EffectSummary[]; state: NonNullable<typeof walletState>; summaries: EffectSummary[] }>();
    for (const ws of walletStates?.states ?? []) {
      const rows = filterables.get(ws.wallet) ?? [];
      const keep = rows.map((row) => passesFilter(row, filter, tagsOf));
      const all = summariesByWallet.get(ws.wallet) ?? [];
      out.set(ws.wallet, {
        all,
        state: { ...ws, effects: ws.effects.filter((_, i) => keep[i]) },
        summaries: all.filter((_, i) => keep[i]),
      });
    }
    return out;
  }, [walletStates, filterables, summariesByWallet, filter, names]);
  const summaries = summariesByWallet.get(selectedWallet) ?? NO_SUMMARIES;
  const visible = perWallet.get(selectedWallet);
  const visibleState = visible?.state;
  // Program connections are separate from wallet interactions and hidden until asked for.
  const [showPrograms, setShowPrograms] = useState(false);
  // Every program the loaded transactions invoked; unknown programs are still infrastructure.
  const programs = useMemo(() => {
    const ids = new Set<string>();
    for (const tx of transactions?.values() ?? []) for (const ix of [...tx.instructions, ...tx.innerInstructions]) ids.add(ix.programId);
    return ids;
  }, [transactions]);
  const counterparties = useMemo(
    () => collectCounterparties(selectedWallet, summaries).map((r) => ({ ...r, state: addressState(r.address, c, registry, programs) })),
    [selectedWallet, summaries, c, programs],
  );
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
        const tags = names.label(wallet)?.tags ?? [];
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
    const tagsOf = (a: string) => names.label(a)?.tags ?? [];
    for (const w of c.mappedWallets) {
      items.push({ kind: "wallet", id: w.address, label: names.of(w.address), detail: shortenAddress(w.address, 6), keywords: [w.address, ...tagsOf(w.address)] });
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
    for (const l of labelRows.status === "ready" ? labelRows.data : []) addAddress(l.address);
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
            detail: `${new Date(row.time).toISOString().slice(0, 16).replace("T", " ")} UTC · ${row.summary.kind.replace("_", " ")} · ${names.of(wallet)}`,
            keywords: [],
          });
        }
      }
    }
    for (const l of labelRows.status === "ready" ? labelRows.data : []) for (const t of l.tags) tags.add(t);
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
  }, [c.mappedWallets, names, labelRows, filterables, walletStates]);

  /** Show a mapped wallet in the inspector: the last pick wins over any open address, line or transaction. */
  function pickWallet(address: string) {
    setSelectedWallet(address);
    setSelectedAddress(null);
    setSelectedEdge(null);
    timelineRef.current?.clearSelection();
  }

  /** Select a transaction on the timeline, switching to it if needed. */
  function goToTransaction(signature: string, wallet?: string) {
    if (view === "timeline" && timelineRef.current) {
      if (!timelineRef.current.jumpTo(signature, wallet)) toast.info("That transaction is hidden by your filters or a hidden lane.");
      return;
    }
    setFocusSignature(signature);
    setView("timeline");
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
      await saveCase(getDb(), next);
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
      return s ? collectCounterparties(wallet, s.effects.map((e) => summarizeEffect(e, result.transactions.get(e.signature), nfts))).map((r) => r.address) : [];
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
        addedFromTransaction: choice.rangeMode === "first_interaction" ? first?.signature : undefined,
      });
      await saveCase(getDb(), next);
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
    try {
      await saveCase(getDb(), unmapWallet(c, address));
      if (selectedWallet === address) setSelectedWallet(c.primaryWallet);
      if (justMapped === address) setJustMapped(null);
      setSelectedAddress(null);
      toast.success(`${names.of(address)} removed from the map. Its label and cached transactions are kept.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove this wallet.");
    }
  }

  const rangeText = (address: string) => {
    const w = c.mappedWallets.find((m) => m.address === address);
    if (!w) return "";
    const r = walletRange(c, w);
    const how = w.rangeMode === "first_interaction" ? " (first interaction)" : w.rangeMode === "custom" ? " (custom start)" : "";
    return `from ${r.start.slice(0, 16).replace("T", " ")} UTC${how} to the case end`;
  };

  const panelFor = (address: string) => (
    <AddressPanel
      key={address}
      caseId={c.id}
      address={address}
      state={addressState(address, c, registry, programs)}
      label={names.label(address)}
      entry={registry.lookup(address)}
      transactionCount={address === selectedWallet ? undefined : counterparties.find((r) => r.address === address)?.count}
      onMap={() => {
        setMapError(null);
        setMapTarget(address);
      }}
      mapped={
        c.mappedWallets.some((m) => m.address === address && m.role === "mapped")
          ? { rangeText: rangeText(address), onUnmap: () => void unmap(address) }
          : undefined
      }
      bookmark={{ on: isBookmarked(c, "wallet", address), toggle: () => void updateCase(toggleBookmark(c, { kind: "wallet", target: address })) }}
      onFilterTo={
        c.mappedWallets.some((m) => m.address === address)
          ? undefined
          : { active: filter.address === address, toggle: () => setFilter((f) => ({ ...f, address: f.address === address ? null : address })) }
      }
      lane={
        c.mappedWallets.length > 1 && c.mappedWallets.some((m) => m.address === address)
          ? { hidden: (c.hiddenLanes ?? []).includes(address), onToggle: () => void updateCase(toggleLaneHidden(c, address)) }
          : undefined
      }
    />
  );
  // The inspector shows the last thing selected; an address stays until something else is picked.
  const addressPanel = selectedAddress && panelFor(selectedAddress);

  const walletInspector = (
    <>
      {panelFor(selectedWallet)}
      {walletState && walletStates && (
        <PanelSection title="Wallet state">
          <WalletStateSummary state={walletState} assets={walletStates.assets} />
        </PanelSection>
      )}
    </>
  );

  // The interaction map covers every visible lane, from the same filtered transactions as the timeline.
  const graph = useMemo(() => {
    if (view !== "graph") return null;
    const sides = shownLanes.flatMap((wallet) => {
      const data = perWallet.get(wallet);
      return data ? [{ wallet, effects: data.state.effects, summaries: data.summaries }] : [];
    });
    return buildInteractionGraph(sides, { hiddenAssets: filter.hiddenAssets, showPrograms });
  }, [view, shownLanes, perWallet, filter.hiddenAssets, showPrograms]);
  const edge = graph?.edges.find((e) => e.id === selectedEdge);
  const formatAmount = (amount: string, assetId: string) => {
    if (!walletStates || !walletState) return amount;
    const source = walletStates.states.find((st) => assetId in st.decimals) ?? walletState;
    return formatAssetAmount(amount, assetId, source, walletStates.assets);
  };

  let center: React.ReactNode;
  if (state.status === "done" && walletStates && walletState && visible && visibleState) {
    center =
      view === "graph" && graph ? (
        <>
          <WalletGraph
            graph={graph}
            wallet={shownLanes.includes(selectedWallet) ? selectedWallet : (shownLanes[0] ?? selectedWallet)}
            names={names}
            stateOf={(address) => addressState(address, c, registry, programs)}
            selectedNode={selectedAddress}
            selectedEdge={selectedEdge}
            onSelectNode={setSelectedAddress}
            onSelectEdge={setSelectedEdge}
            showPrograms={showPrograms}
            onToggleProgramCalls={() => setShowPrograms((v) => !v)}
          />
          {(rightOpen || addressPanel || edge) && (
            <SidePanel side="right" label="Inspector">
              {addressPanel ||
                (edge ? (
                  <EdgePanel
                    key={edge.id}
                    edge={edge}
                    names={names}
                    assets={walletStates.assets}
                    formatAmount={formatAmount}
                    onSelectAddress={setSelectedAddress}
                    onShowOnTimeline={(signature, wallet) => {
                      setSelectedEdge(null);
                      goToTransaction(signature, wallet);
                    }}
                    onClose={() => setSelectedEdge(null)}
                  />
                ) : (
                  walletInspector
                ))}
            </SidePanel>
          )}
        </>
      ) : view === "timeline" ? (
        <WalletTimeline
          ref={timelineRef}
          initialSignature={focusSignature}
          lanes={lanes}
          transactions={state.result.transactions}
          range={c.range}
          assets={walletStates.assets}
          names={names}
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
          onHide={(signature) => setFilter((f) => ({ ...f, hiddenSignatures: toggled(f.hiddenSignatures, signature) }))}
          onSelectLane={pickWallet}
          sharedWith={(signature, wallet) => (owners.get(signature) ?? []).filter((w) => w !== wallet)}
          isBookmarked={(signature) => isBookmarked(c, "transaction", signature)}
          onToggleBookmark={(signature, wallet) => void updateCase(toggleBookmark(c, { kind: "transaction", target: signature, wallet }))}
          onBookmarkTime={(time) => {
            void updateCase(toggleBookmark(c, { kind: "date", target: new Date(time).toISOString() }));
            toast.success(`Bookmarked ${new Date(time).toISOString().slice(0, 16).replace("T", " ")} UTC.`);
          }}
          initialTime={focusTime}
          onSelectTransaction={() => {
            setSelectedAddress(null);
            setSelectedEdge(null);
          }}
        />
      ) : (
        <>
          <div className="min-w-0 flex-1 overflow-auto p-4">
            <WalletStateTable state={visibleState} assets={walletStates.assets} />
          </div>
          {(rightOpen || addressPanel) && (
            <SidePanel side="right" label="Inspector">
              {addressPanel || walletInspector}
            </SidePanel>
          )}
        </>
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
        <div className="ml-1 flex min-w-0 items-baseline gap-2">
          <h1 className="truncate text-sm font-medium">{c.name}</h1>
          <span className="hidden truncate text-xs text-muted-foreground md:inline">{formatRange(c.range)}</span>
        </div>

        {walletState && (
          <div className="absolute left-1/2 flex -translate-x-1/2 rounded-lg border p-0.5" role="group" aria-label="View">
            {(["timeline", "graph", "table"] as const).map((v) => (
              <Button
                key={v}
                size="xs"
                variant={view === v ? "secondary" : "ghost"}
                aria-pressed={view === v}
                onClick={() => {
                  setView(v);
                  setFocusSignature(undefined);
                  setFocusTime(undefined);
                }}
              >
                {v === "timeline" ? "Timeline" : v === "graph" ? "Graph" : "Table"}
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
              <ul className="-mx-1 flex flex-col">
                {order.map((address, position) => {
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
                        {flagged && <span className="text-destructive" title="State mismatch or partial history">•</span>}
                        {w.role === "primary" ? (
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
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
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
                // The timeline and graph cover every visible lane; the table shows the selected wallet.
                rows={view !== "table" ? shownLanes.flatMap((w) => filterables.get(w) ?? []) : (filterables.get(selectedWallet) ?? [])}
                assets={walletStates.assets}
                names={names}
                decimalsOf={(assetId) =>
                  walletStates.assets.get(assetId)?.decimals ?? walletStates.states.find((st) => assetId in st.decimals)?.decimals[assetId] ?? 0
                }
                caseRange={c.range}
                filter={filter}
                shown={view !== "table" ? lanes.reduce((n, l) => n + l.state.effects.length, 0) : visibleState.effects.length}
                onChange={setFilter}
              />
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
                            : `${b.target.slice(0, 16).replace("T", " ")} UTC`;
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
                                setView("timeline");
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
            <IngestionPanel names={names} rpc={rpc} ingestion={ingestion} />
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
          first={result ? firstInteraction(mapTarget, result.transactions.values()) : null}
          caseRange={c.range}
          hasRpc={Boolean(rpc)}
          busy={mapBusy}
          error={mapError}
          onConfirm={(choice) => void confirmMap(mapTarget, choice)}
          onCancel={() => setMapTarget(null)}
        />
      )}
    </div>
  );
}

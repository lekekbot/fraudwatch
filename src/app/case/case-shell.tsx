"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ArrowDownIcon, ArrowUpIcon, EyeIcon, EyeOffIcon, FocusIcon, Link2Icon, PanelLeftIcon, PanelRightIcon, ShieldIcon, WalletIcon } from "lucide-react";
import { toast } from "sonner";
import { RpcStatusBadge } from "@/components/rpc-status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { useIngestion } from "@/hooks/use-ingestion";
import { useLocalQuery } from "@/hooks/use-local-db";
import { useWalletStates } from "@/hooks/use-wallet-states";
import { addressState } from "@/lib/case/address-state";
import { laneOrder, moveLane, toggleLaneHidden, visibleLanes } from "@/lib/case/lanes";
import { firstInteraction, mapWallet, unmapWallet, walletRange, walletRanges } from "@/lib/case/wallet-range";
import { mappingSummary, sharedTransactions } from "@/lib/ingest/intersections";
import { buildWalletGraph, type GraphEdge } from "@/lib/graph/build";
import type { FraudWatchCase } from "@/lib/case/model";
import { formatRange } from "@/lib/case/range";
import { getAddressLabels } from "@/lib/db/address-labels";
import { getCase, saveCase, touchCase } from "@/lib/db/cases";
import { getDb } from "@/lib/db/db";
import { getRpcSettings } from "@/lib/db/rpc-settings";
import { createNames } from "@/lib/labels/labels";
import { registry } from "@/lib/protocols/registry";
import { buildMapSearch } from "@/lib/routing/map-params";
import type { RpcSettings } from "@/lib/rpc/settings";
import { shortenAddress } from "@/lib/solana/address";
import { collectCounterparties } from "@/lib/state/counterparties";
import { type NftCatalog, summarizeEffect } from "@/lib/state/summarize";
import { EMPTY_FILTER, passesFilter, toggled } from "@/lib/timeline/filter";
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
import { type WalletLane, WalletTimeline } from "./timeline/wallet-timeline";
import { assetLabel, formatAssetAmount } from "./asset-format";
import { WalletStateSummary, WalletStateTable } from "./wallet-state-view";

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
  const [selectedWallet, setSelectedWallet] = useState(c.primaryWallet);
  const [filter, setFilter] = useState(EMPTY_FILTER);
  /** Observed address the Map wallet dialog is open for. */
  const [mapTarget, setMapTarget] = useState<string | null>(null);
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
  const summaries = useMemo(
    () => (walletState && transactions ? walletState.effects.map((e) => summarizeEffect(e, transactions.get(e.signature), nfts)) : []),
    [walletState, transactions, nfts],
  );
  // Only the views are filtered; the wallet state panel keeps the full history.
  const visible = useMemo(() => {
    if (!walletState) return undefined;
    const keep = walletState.effects.map((e, i) => passesFilter(e.signature, summaries[i], filter));
    return {
      state: { ...walletState, effects: walletState.effects.filter((_, i) => keep[i]) },
      summaries: summaries.filter((_, i) => keep[i]),
    };
  }, [walletState, summaries, filter]);
  const visibleState = visible?.state;

  // Every mapped wallet's summaries and filtered effects, for the lanes.
  const perWallet = useMemo(() => {
    const out = new Map<string, { all: ReturnType<typeof summarizeEffect>[]; state: NonNullable<typeof walletState>; summaries: ReturnType<typeof summarizeEffect>[] }>();
    if (!walletStates || !transactions) return out;
    for (const ws of walletStates.states) {
      const all = ws.effects.map((e) => summarizeEffect(e, transactions.get(e.signature), nfts));
      const keep = ws.effects.map((e, i) => passesFilter(e.signature, all[i], filter));
      out.set(ws.wallet, {
        all,
        state: { ...ws, effects: ws.effects.filter((_, i) => keep[i]) },
        summaries: all.filter((_, i) => keep[i]),
      });
    }
    return out;
  }, [walletStates, transactions, nfts, filter]);
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

  async function updateCase(next: FraudWatchCase) {
    try {
      await saveCase(getDb(), next);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the case.");
    }
  }
  const graph = useMemo(
    () => (view === "graph" && visible ? buildWalletGraph(selectedWallet, visible.state.effects, visible.summaries) : null),
    [view, visible, selectedWallet],
  );
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
      const next = mapWallet(c, {
        address,
        ...choice,
        addedFromWallet: selectedWallet,
        addedFromTransaction: choice.rangeMode === "first_interaction" ? first?.signature : undefined,
      });
      await saveCase(getDb(), next);
      setMapTarget(null);
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

  const panelFor = (address: string, onBack?: () => void) => (
    <AddressPanel
      key={address}
      caseId={c.id}
      address={address}
      state={addressState(address, c, registry, programs)}
      label={names.label(address)}
      entry={registry.lookup(address)}
      transactionCount={address === selectedWallet ? undefined : counterparties.find((r) => r.address === address)?.count}
      onBack={onBack}
      onMap={() => {
        setMapError(null);
        setMapTarget(address);
      }}
      mapped={
        c.mappedWallets.some((m) => m.address === address && m.role === "mapped")
          ? { rangeText: rangeText(address), onUnmap: () => void unmap(address) }
          : undefined
      }
      lane={
        c.mappedWallets.length > 1 && c.mappedWallets.some((m) => m.address === address)
          ? { hidden: (c.hiddenLanes ?? []).includes(address), onToggle: () => void updateCase(toggleLaneHidden(c, address)) }
          : undefined
      }
    />
  );
  const addressPanel = selectedAddress && panelFor(selectedAddress, () => setSelectedAddress(null));

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

  const edge = graph?.edges.find((e) => e.id === selectedEdge);
  const describeEdge = (e: GraphEdge) => {
    const n = `${e.signatures.length.toLocaleString()} tx`;
    if (e.kind !== "flow" || !walletState || !walletStates) return e.kind === "program" ? `${n} · program call` : `${n} · sent`;
    const [top, ...rest] = e.totals;
    const amount = top ? ` · ${formatAssetAmount(top.amount, top.assetId, walletState, walletStates.assets)} ${assetLabel(top.assetId, walletStates.assets)}` : "";
    return `${n}${amount}${rest.length > 0 ? ` +${rest.length} more` : ""}`;
  };

  let center: React.ReactNode;
  if (state.status === "done" && walletStates && walletState && visible && visibleState) {
    center =
      view === "graph" && graph ? (
        <>
          <WalletGraph
            graph={graph}
            wallet={selectedWallet}
            names={names}
            stateOf={(address) => addressState(address, c, registry, programs)}
            selectedNode={selectedAddress}
            selectedEdge={selectedEdge}
            onSelectNode={setSelectedAddress}
            onSelectEdge={setSelectedEdge}
            describeEdge={describeEdge}
          />
          {(rightOpen || addressPanel || edge) && (
            <SidePanel side="right" label="Inspector">
              {addressPanel ||
                (edge ? (
                  <EdgePanel
                    key={edge.id}
                    edge={edge}
                    names={names}
                    state={walletState}
                    assets={walletStates.assets}
                    rows={visible.state.effects
                      .map((effect, i) => ({ effect, summary: visible.summaries[i] }))
                      .filter((r) => edge.signatures.includes(r.effect.signature))}
                    onSelectAddress={setSelectedAddress}
                    onShowOnTimeline={(signature) => {
                      setFocusSignature(signature);
                      setSelectedEdge(null);
                      setView("timeline");
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
          onSelectLane={(wallet) => {
            setSelectedWallet(wallet);
            setSelectedAddress(null);
          }}
          sharedWith={(signature, wallet) => (owners.get(signature) ?? []).filter((w) => w !== wallet)}
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
                }}
              >
                {v === "timeline" ? "Timeline" : v === "graph" ? "Graph" : "Table"}
              </Button>
            ))}
          </div>
        )}

        <div className="ml-auto flex items-center gap-2">
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
                        onClick={() => {
                          setSelectedWallet(address);
                          setSelectedAddress(null);
                          setSelectedEdge(null);
                        }}
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
                // The timeline filters every visible lane; the graph and table show the selected wallet.
                summaries={view === "timeline" ? shownLanes.flatMap((w) => perWallet.get(w)?.all ?? []) : summaries}
                assets={walletStates.assets}
                filter={filter}
                shown={view === "timeline" ? lanes.reduce((n, l) => n + l.state.effects.length, 0) : visibleState.effects.length}
                onChange={setFilter}
              />
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

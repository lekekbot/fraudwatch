"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Link2Icon, PanelLeftIcon, PanelRightIcon, ShieldIcon, WalletIcon } from "lucide-react";
import { toast } from "sonner";
import { RpcStatusBadge } from "@/components/rpc-status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { useIngestion } from "@/hooks/use-ingestion";
import { useLocalQuery } from "@/hooks/use-local-db";
import { useWalletStates } from "@/hooks/use-wallet-states";
import { addressState } from "@/lib/case/address-state";
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
import { collectCounterparties } from "@/lib/state/counterparties";
import { summarizeEffect } from "@/lib/state/summarize";
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
import { WalletTimeline } from "./timeline/wallet-timeline";
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
  const summaries = useMemo(
    () => (walletState && transactions ? walletState.effects.map((e) => summarizeEffect(e, transactions.get(e.signature))) : []),
    [walletState, transactions],
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
  const sharedWith = useMemo(() => {
    const bySignature = new Map<string, string[]>();
    for (const [other, signatures] of shared.get(selectedWallet) ?? []) {
      for (const s of signatures) bySignature.set(s, [...(bySignature.get(s) ?? []), other]);
    }
    return bySignature;
  }, [shared, selectedWallet]);
  const summary = useMemo(() => {
    const w = justMapped ? result?.wallets.find((x) => x.wallet === justMapped) : undefined;
    if (!w || !result || !walletStates) return null;
    // Counterparties of a wallet, from its reconstructed effects.
    const counterpartiesOf = (wallet: string) => {
      const s = walletStates.states.find((x) => x.wallet === wallet);
      return s ? collectCounterparties(wallet, s.effects.map((e) => summarizeEffect(e, result.transactions.get(e.signature)))).map((r) => r.address) : [];
    };
    const mapped = c.mappedWallets.map((m) => m.address);
    const known = new Set([...mapped, ...mapped.filter((m) => m !== w.wallet).flatMap(counterpartiesOf)]);
    return mappingSummary(w, shared, counterpartiesOf(w.wallet), known);
  }, [justMapped, result, walletStates, shared, c.mappedWallets]);

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
          key={walletState.wallet}
          initialSignature={focusSignature}
          state={visibleState}
          transactions={state.result.transactions}
          range={walletRange(c, c.mappedWallets.find((w) => w.address === selectedWallet) ?? c.mappedWallets[0])}
          assets={walletStates.assets}
          names={names}
          inspector={walletInspector}
          addressPanel={addressPanel}
          onSelectAddress={setSelectedAddress}
          inspectorOpen={rightOpen}
          emptyMessage={walletState.effects.length > 0 ? "No transactions match the filters." : undefined}
          onHide={(signature) => setFilter((f) => ({ ...f, hiddenSignatures: toggled(f.hiddenSignatures, signature) }))}
          sharedWith={(signature) => sharedWith.get(signature) ?? []}
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
            <PanelSection title="Wallets">
              <ul className="-mx-1 flex flex-col">
                {c.mappedWallets.map((w) => {
                  const s = walletStates?.states.find((st) => st.wallet === w.address);
                  const flagged = s && (s.mismatches.length > 0 || s.openingStatus !== "OBSERVED");
                  return (
                    <li key={w.address}>
                      <button
                        type="button"
                        aria-current={w.address === selectedWallet}
                        onClick={() => {
                          setSelectedWallet(w.address);
                          setSelectedAddress(null);
                          setSelectedEdge(null);
                        }}
                        className={cn(
                          "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
                          w.address === selectedWallet ? "bg-muted" : "hover:bg-muted/50",
                        )}
                      >
                        <WalletIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                        <span className={cn("min-w-0 flex-1 truncate text-xs", !names.known(w.address) && "font-mono")}>
                          {names.of(w.address)}
                        </span>
                        {flagged && <span className="text-destructive" title="State mismatch or partial history">•</span>}
                        {w.role === "primary" ? (
                          <Badge variant="secondary">primary</Badge>
                        ) : (
                          w.rangeMode !== "case" && (
                            <span className="text-[10px] text-muted-foreground" title={rangeText(w.address)}>
                              from {walletRange(c, w).start.slice(5, 10)}
                            </span>
                          )
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
              <p className="text-xs text-muted-foreground">
                Only mapped wallets get a full history load. Counterparties stay shallow until you map them.
              </p>
            </PanelSection>
            {walletState && walletStates && visibleState && (
              <FilterPanel
                summaries={summaries}
                assets={walletStates.assets}
                filter={filter}
                shown={visibleState.effects.length}
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

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
import type { FraudWatchCase } from "@/lib/case/model";
import { formatRange } from "@/lib/case/range";
import { getAddressLabels } from "@/lib/db/address-labels";
import { getCase, touchCase } from "@/lib/db/cases";
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
import { IngestionPanel } from "./ingestion-panel";
import { PanelSection, SidePanel } from "./panel";
import { WalletTimeline } from "./timeline/wallet-timeline";
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
  const walletStates = useWalletStates(state.status === "done" ? state.result : null, c.range, rpc?.url);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [view, setView] = useState<"timeline" | "table">("timeline");
  const [selectedWallet, setSelectedWallet] = useState(c.primaryWallet);
  const [filter, setFilter] = useState(EMPTY_FILTER);
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
  // Only the map and table are filtered; the wallet state panel keeps the full history.
  const visibleState = useMemo(
    () => walletState && { ...walletState, effects: walletState.effects.filter((e, i) => passesFilter(e.signature, summaries[i], filter)) },
    [walletState, summaries, filter],
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

  let center: React.ReactNode;
  if (state.status === "done" && walletStates && walletState && visibleState) {
    center =
      view === "timeline" ? (
        <WalletTimeline
          key={walletState.wallet}
          state={visibleState}
          transactions={state.result.transactions}
          range={c.range}
          assets={walletStates.assets}
          names={names}
          inspector={walletInspector}
          addressPanel={addressPanel}
          onSelectAddress={setSelectedAddress}
          inspectorOpen={rightOpen}
          emptyMessage={walletState.effects.length > 0 ? "No transactions match the filters." : undefined}
          onHide={(signature) => setFilter((f) => ({ ...f, hiddenSignatures: toggled(f.hiddenSignatures, signature) }))}
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
            {(["timeline", "table"] as const).map((v) => (
              <Button key={v} size="xs" variant={view === v ? "secondary" : "ghost"} aria-pressed={view === v} onClick={() => setView(v)}>
                {v === "timeline" ? "Timeline" : "Table"}
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
                        {w.role === "primary" && <Badge variant="secondary">primary</Badge>}
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
            <IngestionPanel names={names} rpc={rpc} ingestion={ingestion} />
            <div className="mt-auto p-2">
              <DeleteCaseButton id={c.id} name={c.name} />
            </div>
          </SidePanel>
        )}
        {center}
      </div>
    </div>
  );
}

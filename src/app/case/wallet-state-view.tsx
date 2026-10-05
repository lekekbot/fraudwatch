"use client";

import { Tabs } from "@base-ui/react/tabs";
import { useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon, ExternalLinkIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import type { HiddenReason } from "@/lib/case/hiding";
import { formatLamports } from "@/lib/solana/amount";
import { shortenAddress } from "@/lib/solana/address";
import { type AssetChange, type AssetState, netChange, type WalletState, type WalletTransactionEffect } from "@/lib/state/reconstruct";
import type { EffectKind, EffectSummary } from "@/lib/state/summarize";
import { type Assets, assetLabel, assetLogo, formatAssetAmount, formatUtc } from "./asset-format";
import { cn } from "cn";
import { AssetIcon } from "./asset-icon";
import { ShowMoreList } from "./panel";
import { kindLabel } from "./filter-panel";

/** Rows per table page, pickable in the table's footer. */
const PAGE_SIZES = [25, 50, 100, 200, 500];
/** Assets listed per state card before "Show more". */
const SHOWN = 6;

const amount = formatAssetAmount;
const time = formatUtc;

function TransactionCell({ e, kind, wallet }: { e: WalletTransactionEffect; kind: EffectKind | undefined; wallet?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span>{time(e.timestamp)}</span>
      {wallet && <span className="text-xs font-medium">{wallet}</span>}
      <a
        href={`https://solscan.io/tx/${e.signature}`}
        target="_blank"
        rel="noreferrer noopener"
        className="inline-flex items-center gap-1 font-mono text-xs text-muted-foreground underline-offset-4 hover:underline"
      >
        {shortenAddress(e.signature, 6)}
        <ExternalLinkIcon className="size-3" />
      </a>
      {kind && kind !== "FAILED" && <span className="text-xs text-muted-foreground">{kindLabel(kind)}</span>}
      {!e.success && <span className="text-xs text-destructive">Failed</span>}
    </div>
  );
}

function AssetName({ assetId, assets }: { assetId: string; assets: Assets }) {
  const label = assetLabel(assetId, assets);
  return (
    <span className="flex items-center gap-2" title={assetId}>
      <AssetIcon label={label} logo={assetLogo(assetId, assets)} />
      <span>{label}</span>
    </span>
  );
}

function StateTable({ title, rows, status, state, assets }: {
  title: string;
  rows: AssetState[];
  status: string;
  state: WalletState;
  assets: Assets;
}) {
  const observed = status === "OBSERVED";
  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">{title}</h3>
        <Badge variant={observed ? "secondary" : "destructive"}>{observed ? "Observed" : status}</Badge>
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">No balances observed in this range.</p>
      ) : (
        <ShowMoreList items={rows} limit={SHOWN}>
          {(visible) => (
            <dl className="text-sm">
              {visible.map((r) => (
                <div key={r.assetId} className="flex justify-between gap-4 py-0.5">
                  <dt className="text-muted-foreground">
                    <AssetName assetId={r.assetId} assets={assets} />
                  </dt>
                  <dd className="tabular-nums">{amount(r.amount, r.assetId, state, assets)}</dd>
                </div>
              ))}
            </dl>
          )}
        </ShowMoreList>
      )}
    </div>
  );
}

export function WalletStateSummary({ state, assets }: { state: WalletState; assets: Assets }) {
  return (
    <div className="flex flex-col gap-3">
      {state.mismatches.length > 0 && (
        <Alert variant="destructive">
          <AlertTitle>STATE_MISMATCH — {state.mismatches.length} balance(s) don&apos;t chain</AlertTitle>
          <AlertDescription>
            <p>
              A balance changed between two loaded transactions without a transaction to explain it. History is
              probably missing here.
            </p>
            <ul className="mt-2 flex flex-col gap-1 text-xs">
              {state.mismatches.map((m) => (
                <li key={`${m.account}:${m.beforeSignature}`} className="font-mono break-all">
                  {assetLabel(m.assetId, assets)} in {shortenAddress(m.account, 4)}: expected{" "}
                  {amount(m.expected, m.assetId, state, assets)}, observed {amount(m.observed, m.assetId, state, assets)}{" "}
                  (after {shortenAddress(m.afterSignature, 4)}, before {shortenAddress(m.beforeSignature, 4)})
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <Tabs.Root defaultValue="opening" className="flex flex-col gap-2">
        <Tabs.List className="flex rounded-lg border p-0.5" aria-label="Wallet state">
          {(["opening", "closing", "net"] as const).map((tab) => (
            <Tabs.Tab
              key={tab}
              value={tab}
              className="flex-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none data-active:bg-secondary data-active:text-foreground"
            >
              {tab === "opening" ? "Opening" : tab === "closing" ? "Closing" : "Net change"}
            </Tabs.Tab>
          ))}
        </Tabs.List>
        <Tabs.Panel value="opening">
          <StateTable title="Opening state" rows={state.opening} status={state.openingStatus} state={state} assets={assets} />
        </Tabs.Panel>
        <Tabs.Panel value="closing">
          <StateTable title="Closing state" rows={state.closing} status={state.closingStatus} state={state} assets={assets} />
        </Tabs.Panel>
        <Tabs.Panel value="net">
          <NetChange state={state} assets={assets} />
        </Tabs.Panel>
      </Tabs.Root>
      <ul className="list-disc pl-5 text-xs text-muted-foreground">
        {state.partialReasons.map((r) => (
          <li key={r}>{r}</li>
        ))}
        <li>Only assets that moved in this range are shown. Holdings that sat untouched aren&apos;t visible yet.</li>
      </ul>
    </div>
  );
}

const HIDE_HINT_KEY = "fraudwatch:table-hide-hint-seen";

/** One wallet's side of a transaction: what the table opens, steps through and highlights. */
export type TableSide = { signature: string; wallet: string };

/** Where the open transaction sits in the table's sorted, filtered order, and how to move from it. */
export type TableNav = { index: number; count: number; previous: () => void; next: () => void; /** Neighbour to open when this one is hidden. */ neighbour: TableSide | null };

/** One mapped wallet's (already filtered) transactions. */
export type TableLane = {
  wallet: string;
  state: WalletState;
  summaries?: readonly EffectSummary[];
  /** Why each of `state.effects` is hidden from the map, or null; hidden ones show only with "Show hidden". */
  hidden?: readonly HiddenReason[];
};

/** One displayed line: a wallet's change of one asset in a transaction, or its "nothing moved" row. */
type TableRow = { effect: WalletTransactionEffect; wallet: string; state: WalletState; kind: EffectKind | undefined; change: AssetChange | null; hidden: HiddenReason };

const sideKey = (side: TableSide) => `${side.wallet}|${side.signature}`;

type SortKey = "time" | "asset" | "before" | "change" | "after";

const SORT_LABEL: Record<SortKey, string> = { time: "Time (UTC)", asset: "Asset", before: "Before", change: "Change", after: "After" };
/** Numeric columns open on their most useful direction first. */
/** Time starts newest first and assets A–Z; amounts start largest first. */
const firstDirection = (key: SortKey): 1 | -1 => (key === "asset" ? 1 : -1);

/** Base units as a decimal number, so rows of different assets compare. */
function asNumber(value: string | null | undefined, assetId: string | null, assets: Assets): number {
  if (!value || !assetId) return Number.NEGATIVE_INFINITY;
  return Number(value) / 10 ** (assets.get(assetId)?.decimals ?? 0);
}

const selectClass = "h-7 rounded-md border bg-transparent px-1.5 text-xs outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring";

/**
 * Balance changes of every shown wallet's transactions, filtered by the case's filters (which run before this:
 * the table has none of its own). With several wallets, each row names its wallet.
 */
export function WalletStateTable({ lanes, assets, hiddenAssets, walletName, selected, onSelect, renderPanel, onHide, onUnhide }: {
  lanes: readonly TableLane[];
  assets: Assets;
  /** Assets the filters hide: their rows leave the table, as their movements leave the graph. */
  hiddenAssets?: ReadonlySet<string>;
  walletName?: (wallet: string) => string;
  /** The transaction side open in the inspector; its rows are highlighted. */
  selected?: TableSide | null;
  /** Opens a transaction side in the inspector, or closes it with null. */
  onSelect?: (side: TableSide | null) => void;
  /** The inspector beside the table, told where the open transaction sits in the table's current order. */
  renderPanel?: (nav: TableNav | null) => React.ReactNode;
  /** Hide or bring back a batch of transactions; enables row selection. */
  onHide?: (signatures: string[]) => void;
  onUnhide?: (signatures: string[]) => void;
}) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "time", dir: -1 });
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(100);
  const [showHidden, setShowHidden] = useState(false);
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  // A how-to until the first hide from the table; the table only mounts in the browser, so storage is there.
  const [hinted, setHinted] = useState(() => localStorage.getItem(HIDE_HINT_KEY) === "1");
  const selectable = Boolean(onHide && onUnhide);
  const hiddenCount = new Set(lanes.flatMap((lane) => lane.state.effects.filter((_, i) => (lane.hidden?.[i] ?? null) !== null).map((e) => e.signature))).size;
  const many = lanes.length > 1;

  // Every row from the whole history, not just the first page: sort sees it all.
  const allRows: TableRow[] = lanes.flatMap((lane) =>
    lane.state.effects.flatMap((e, i): TableRow[] => {
      const why = lane.hidden?.[i] ?? null;
      if (why !== null && !showHidden) return [];
      const kind = lane.summaries?.[i]?.kind;
      const base = { effect: e, wallet: lane.wallet, state: lane.state, kind, hidden: why };
      // Unchanged balances stay in the data but add nothing to the table; nor do filtered-out assets.
      const rows = e.assetChanges.filter((c) => (c.delta !== "0" || (c.assetId === "SOL" && e.feeLamports !== "0")) && !hiddenAssets?.has(c.assetId));
      if (rows.length === 0) return [{ ...base, change: null }];
      return rows.map((change) => ({ ...base, change }));
    }),
  );
  const timeOf = (row: TableRow) => (row.effect.timestamp ? Date.parse(row.effect.timestamp) : 0);
  const sorted = [...allRows].sort((a, b) => {
    let byKey = 0;
    if (sort.key === "time") byKey = timeOf(a) - timeOf(b);
    else if (sort.key === "asset") byKey = assetLabel(a.change?.assetId ?? "", assets).localeCompare(assetLabel(b.change?.assetId ?? "", assets));
    else if (sort.key === "before") byKey = asNumber(a.change?.before, a.change?.assetId ?? null, assets) - asNumber(b.change?.before, b.change?.assetId ?? null, assets);
    else if (sort.key === "after") byKey = asNumber(a.change?.after, a.change?.assetId ?? null, assets) - asNumber(b.change?.after, b.change?.assetId ?? null, assets);
    else byKey = Math.abs(asNumber(a.change?.delta, a.change?.assetId ?? null, assets)) - Math.abs(asNumber(b.change?.delta, b.change?.assetId ?? null, assets));
    // Time, then signature and wallet, keep the order stable when the key ties.
    return (
      byKey * sort.dir ||
      timeOf(a) - timeOf(b) ||
      a.effect.signature.localeCompare(b.effect.signature) ||
      a.wallet.localeCompare(b.wallet) ||
      (a.change?.assetId ?? "").localeCompare(b.change?.assetId ?? "")
    );
  });
  // Pages slice the sorted rows; filters and sort always see the whole history.
  const maxPage = Math.max(0, Math.ceil(sorted.length / pageSize) - 1);
  const current = Math.min(page, maxPage);
  const shown = sorted.slice(current * pageSize, (current + 1) * pageSize);
  const transactionCount = new Set(allRows.map((row) => row.effect.signature)).size;

  // Stepping follows the table as sorted, one wallet's side of a transaction at a time, turning the page as needed.
  const sides = new Map<string, TableSide>();
  for (const row of sorted) {
    const side = { signature: row.effect.signature, wallet: row.wallet };
    if (!sides.has(sideKey(side))) sides.set(sideKey(side), side);
  }
  const order = [...sides.values()];
  const at = selected ? order.findIndex((side) => sideKey(side) === sideKey(selected)) : -1;
  const open = (side: TableSide | undefined) => {
    if (!side || !onSelect) return;
    setPage(Math.floor(sorted.findIndex((row) => row.effect.signature === side.signature && row.wallet === side.wallet) / pageSize));
    onSelect(side);
  };
  // Hiding is per transaction, on every wallet's side at once: selection is by signature.
  const signatures = [...new Set(order.map((side) => side.signature))];
  const picked = signatures.filter((sig) => checked.has(sig));
  const hiddenSigs = new Set(sorted.filter((row) => row.hidden !== null).map((row) => row.effect.signature));
  const pickedHidden = picked.filter((sig) => hiddenSigs.has(sig));
  const pickedShown = picked.filter((sig) => !hiddenSigs.has(sig));
  const pageSigs = [...new Set(shown.map((row) => row.effect.signature))];
  const pageAll = pageSigs.length > 0 && pageSigs.every((sig) => checked.has(sig));
  const check = (signature: string, range: boolean) => {
    const next = new Set(checked);
    const on = !checked.has(signature);
    const from = range && anchor ? signatures.indexOf(anchor) : -1;
    const to = signatures.indexOf(signature);
    // Shift-click sets every transaction between the last one clicked and this one, in the table's order.
    const span = from === -1 ? [signature] : signatures.slice(Math.min(from, to), Math.max(from, to) + 1);
    for (const sig of span) if (on) next.add(sig); else next.delete(sig);
    setChecked(next);
    setAnchor(signature);
  };
  const act = (run: (signatures: string[]) => void, signatures: string[]) => {
    run(signatures);
    if (!hinted) {
      localStorage.setItem(HIDE_HINT_KEY, "1");
      setHinted(true);
    }
    setChecked(new Set());
    setAnchor(null);
  };

  const nav: TableNav | null =
    at === -1
      ? null
      : { index: at, count: order.length, previous: () => open(order[at - 1]), next: () => open(order[at + 1]), neighbour: order[at + 1] ?? order[at - 1] ?? null };

  /** The same pager above and below the table; only the top copy is a live region. */
  const pager = (className: string, live: boolean) => (
    <div className={cn("flex flex-wrap items-center gap-2 text-xs text-muted-foreground", className)}>
      <span className="tabular-nums">
        Rows {(current * pageSize + 1).toLocaleString()}–{Math.min((current + 1) * pageSize, sorted.length).toLocaleString()} of{" "}
        {sorted.length.toLocaleString()}
      </span>
      <div className="ml-auto flex items-center gap-2">
        <label className="flex items-center gap-1.5">
          Rows per page
          <select
            className={selectClass}
            value={pageSize}
            onChange={(event) => {
              setPageSize(Number(event.target.value));
              setPage(0);
            }}
          >
            {PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
        <span className="tabular-nums" aria-live={live ? "polite" : undefined}>
          Page {current + 1} of {maxPage + 1}
        </span>
        <Button variant="ghost" size="icon-xs" aria-label="Previous page" disabled={current === 0} onClick={() => setPage(current - 1)}>
          <ChevronLeftIcon />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Next page"
          disabled={current >= maxPage}
          onClick={() => setPage(current + 1)}
        >
          <ChevronRightIcon />
        </Button>
      </div>
    </div>
  );

  const header = (key: SortKey) => {
    const active = sort.key === key;
    const numeric = key === "before" || key === "change" || key === "after";
    return (
      <th
        className={`py-2 ${key === "after" ? "pr-0" : "pr-4"} ${numeric ? "text-right" : "text-left"} font-medium`}
        aria-sort={active ? (sort.dir === 1 ? "ascending" : "descending") : "none"}
      >
        <button
          type="button"
          onClick={() => {
            setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: firstDirection(key) }));
            setPage(0);
          }}
          className={`inline-flex items-center gap-1 hover:text-foreground ${active ? "text-foreground" : ""}`}
          title={`Sort by ${SORT_LABEL[key].toLowerCase()}`}
        >
          {SORT_LABEL[key]}
          {active && <span aria-hidden>{sort.dir === 1 ? "↑" : "↓"}</span>}
        </button>
      </th>
    );
  };

  return (
    <>
      <div className="min-w-0 flex-1 overflow-auto p-4">
        <div className="flex flex-col gap-4">
          {allRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No transactions in this range.</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                {selectable && hiddenCount > 0 && (
                  <label className="flex items-center gap-1.5">
                    <Checkbox checked={showHidden} onCheckedChange={setShowHidden} />
                    Show hidden ({hiddenCount.toLocaleString()})
                  </label>
                )}
                {/* Selection actions take the count's place in this row, so rows don't move under the cursor mid-selection. */}
                {picked.length > 0 ? (
                  <span className="ml-auto flex flex-wrap items-center gap-1" role="toolbar" aria-label="Selected transactions">
                    <span className="pr-1 font-medium text-foreground tabular-nums" aria-live="polite">
                      {picked.length.toLocaleString()} selected
                    </span>
                    {pageAll && signatures.length > picked.length && (
                      <Button variant="ghost" size="xs" onClick={() => setChecked(new Set(signatures))}>
                        Select all {signatures.length.toLocaleString()}
                      </Button>
                    )}
                    {pickedShown.length > 0 && (
                      <Button size="xs" onClick={() => act(onHide!, pickedShown)}>
                        Hide {pickedShown.length.toLocaleString()} from map
                      </Button>
                    )}
                    {pickedHidden.length > 0 && (
                      <Button size="xs" variant="outline" onClick={() => act(onUnhide!, pickedHidden)}>
                        Unhide {pickedHidden.length.toLocaleString()}
                      </Button>
                    )}
                    <Button size="xs" variant="ghost" onClick={() => setChecked(new Set())}>
                      Clear
                    </Button>
                  </span>
                ) : (
                  <span className="ml-auto tabular-nums" aria-live="polite">
                    {selectable && !hinted && <span className="pr-3 text-muted-foreground/80">Double-click a row to select it · Shift-click selects a range ·</span>}
                    {transactionCount.toLocaleString()} transactions
                  </span>
                )}
              </div>
              {sorted.length === 0 ? (
                <p className="text-sm text-muted-foreground">No rows to show.</p>
              ) : (
                <div className="overflow-x-auto">
                  {pager("pb-2", true)}
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs text-muted-foreground">
                      <tr>
                        {selectable && (
                          <th className="w-8 px-1 py-2 align-middle">
                            <Checkbox
                              className="mx-auto"
                              aria-label="Select this page"
                              checked={pageAll}
                              indeterminate={!pageAll && pageSigs.some((sig) => checked.has(sig))}
                              onCheckedChange={() => {
                                const next = new Set(checked);
                                for (const sig of pageSigs) if (pageAll) next.delete(sig); else next.add(sig);
                                setChecked(next);
                              }}
                            />
                          </th>
                        )}
                        {header("time")}
                        {header("asset")}
                        {header("before")}
                        {header("change")}
                        {header("after")}
                      </tr>
                    </thead>
                    <tbody>
                      {shown.map((row, i) => {
                        const { effect: e, kind, change: c, wallet, state } = row;
                        const side = { signature: e.signature, wallet };
                        const isSelected = selected ? sideKey(selected) === sideKey(side) : false;
                        // The time cell opens each transaction side's group of rows in the current order.
                        const groupStart = i === 0 || shown[i - 1].effect.signature !== e.signature || shown[i - 1].wallet !== wallet;
                        // Every row of a transaction opens it; Enter does too, for keyboard users.
                        // A double-click selects the transaction for bulk hiding, on top of opening it.
                        const rowProps = onSelect && {
                          tabIndex: 0,
                          "aria-selected": isSelected,
                          onClick: () => onSelect(side),
                          onDoubleClick: (event: React.MouseEvent) => {
                            if (!selectable) return;
                            event.stopPropagation();
                            check(e.signature, event.shiftKey);
                          },
                          onKeyDown: (event: React.KeyboardEvent) => event.key === "Enter" && onSelect(side),
                        };
                        const rowClass = cn(
                          onSelect && "cursor-pointer hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none",
                          isSelected && "bg-muted/60 hover:bg-muted/60",
                          row.hidden !== null && "text-muted-foreground opacity-60",
                        );
                        // One checkbox per transaction, on the first of its rows; it selects without opening the row.
                        const selectCell = selectable && (
                          <td className="w-8 px-1 py-1.5 align-middle" onClick={(event) => event.stopPropagation()}>
                            {groupStart && (
                              <Checkbox
                                className="mx-auto"
                                aria-label={`Select ${e.signature}`}
                                checked={checked.has(e.signature)}
                                // The native event rides along, so shift-click still selects a range.
                                onCheckedChange={(_checked, details) => check(e.signature, Boolean((details.event as { shiftKey?: boolean } | undefined)?.shiftKey))}
                              />
                            )}
                          </td>
                        );
                        const hiddenNote = groupStart && row.hidden !== null && (
                          <span className="block text-[10px] tracking-wide uppercase">{row.hidden === "manual" ? "Hidden" : `Hidden · ${row.hidden.name}`}</span>
                        );
                        if (!c) {
                          return (
                            <tr key={`${wallet}:${e.signature}:none`} className={cn(groupStart && "border-t", rowClass)} {...rowProps}>
                              {selectCell}
                              <td className="py-1.5 pr-4 align-top whitespace-nowrap tabular-nums">
                                {groupStart && <TransactionCell e={e} kind={kind} wallet={many ? walletName?.(wallet) : undefined} />}
                                {hiddenNote}
                              </td>
                              <td colSpan={4} className="py-1.5 text-muted-foreground">
                                No balance change for this wallet
                              </td>
                            </tr>
                          );
                        }
                        return (
                          <tr key={`${wallet}:${e.signature}:${c.assetId}`} className={cn(groupStart && "border-t", rowClass)} {...rowProps}>
                            {selectCell}
                            <td className="py-1.5 pr-4 align-top whitespace-nowrap tabular-nums">
                              {groupStart && <TransactionCell e={e} kind={kind} wallet={many ? walletName?.(wallet) : undefined} />}
                              {hiddenNote}
                            </td>
                            <td className="py-1.5 pr-4">
                              <div className="flex items-start gap-2">
                                <AssetIcon label={assetLabel(c.assetId, assets)} logo={assetLogo(c.assetId, assets)} className="mt-0.5" />
                                <div title={c.assetId}>
                                  {assetLabel(c.assetId, assets)}
                                  {c.assetId === "SOL" && e.feeLamports !== "0" && (
                                    <span className="block text-xs text-muted-foreground">incl. {formatLamports(e.feeLamports)} fee</span>
                                  )}
                                </div>
                              </div>
                            </td>
                            <td className="py-1.5 pr-4 text-right tabular-nums">{c.before && amount(c.before, c.assetId, state, assets)}</td>
                            <td
                              className={`py-1.5 pr-4 text-right tabular-nums ${c.delta.startsWith("-") ? "text-destructive" : c.delta !== "0" ? "text-emerald-500" : "text-muted-foreground"}`}
                            >
                              {amount(c.delta, c.assetId, state, assets, true)}
                            </td>
                            <td className="py-1.5 pr-0 text-right tabular-nums">{c.after && amount(c.after, c.assetId, state, assets)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {pager("pt-1", false)}
                </div>
              )}
            </>
          )}
        </div>
      </div>
      {renderPanel?.(nav)}
    </>
  );
}

/** Closing minus opening per asset: what the wallet gained or lost over its range. */
function NetChange({ state, assets }: { state: WalletState; assets: Assets }) {
  const changes = netChange(state);
  const partial = state.openingStatus !== "OBSERVED" || state.closingStatus !== "OBSERVED";
  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">Net change</h3>
        {partial && <Badge variant="destructive">Partial</Badge>}
      </div>
      {changes.length === 0 ? (
        <p className="text-xs text-muted-foreground">No balance changed between opening and closing.</p>
      ) : (
        <ShowMoreList items={changes} limit={SHOWN}>
          {(visible) => (
            <dl className="text-sm">
              {visible.map((c) => (
                <div key={c.assetId} className="flex justify-between gap-4 py-0.5">
                  <dt className="text-muted-foreground">
                    <AssetName assetId={c.assetId} assets={assets} />
                  </dt>
                  <dd className={`tabular-nums ${c.delta.startsWith("-") ? "text-destructive" : "text-emerald-500"}`}>
                    {amount(c.delta, c.assetId, state, assets, true)}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </ShowMoreList>
      )}
    </div>
  );
}

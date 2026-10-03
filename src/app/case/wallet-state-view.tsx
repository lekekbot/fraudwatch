"use client";

import { Tabs } from "@base-ui/react/tabs";
import { useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon, ExternalLinkIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatLamports } from "@/lib/solana/amount";
import { shortenAddress } from "@/lib/solana/address";
import { type AssetChange, type AssetState, netChange, type WalletState, type WalletTransactionEffect } from "@/lib/state/reconstruct";
import type { EffectKind, EffectSummary } from "@/lib/state/summarize";
import { type Assets, assetLabel, assetLogo, formatAssetAmount, formatUtc } from "./asset-format";
import { cn } from "cn";
import { AssetIcon } from "./asset-icon";
import { ShowMoreList } from "./panel";

/** Rows per table page, pickable in the table's footer. */
const PAGE_SIZES = [25, 50, 100, 200, 500];
/** Assets listed per state card before "Show more". */
const SHOWN = 6;

const amount = formatAssetAmount;
const time = formatUtc;

function TransactionCell({ e, kind }: { e: WalletTransactionEffect; kind: EffectKind | undefined }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span>{time(e.timestamp)}</span>
      <a
        href={`https://solscan.io/tx/${e.signature}`}
        target="_blank"
        rel="noreferrer noopener"
        className="inline-flex items-center gap-1 font-mono text-xs text-muted-foreground underline-offset-4 hover:underline"
      >
        {shortenAddress(e.signature, 6)}
        <ExternalLinkIcon className="size-3" />
      </a>
      {kind && kind !== "FAILED" && <span className="text-xs text-muted-foreground">{kind.replaceAll("_", " ").toLowerCase()}</span>}
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

/** Where the open transaction sits in the table's sorted, filtered order, and how to move from it. */
export type TableNav = { index: number; count: number; previous: () => void; next: () => void; /** Neighbour to open when this one is hidden. */ neighbour: string | null };

/** One displayed line: a transaction's change of one asset, or its "nothing moved" row. */
type TableRow = { effect: WalletTransactionEffect; kind: EffectKind | undefined; change: AssetChange | null };

type SortKey = "time" | "asset" | "before" | "change" | "after";

const SORT_LABEL: Record<SortKey, string> = { time: "Time (UTC)", asset: "Asset", before: "Before", change: "Change", after: "After" };
/** Numeric columns open on their most useful direction first. */
const firstDirection = (key: SortKey): 1 | -1 => (key === "time" || key === "asset" ? 1 : -1);

/** Base units as a decimal number, so rows of different assets compare. */
function asNumber(value: string | null | undefined, assetId: string | null, assets: Assets): number {
  if (!value || !assetId) return Number.NEGATIVE_INFINITY;
  return Number(value) / 10 ** (assets.get(assetId)?.decimals ?? 0);
}

const selectClass = "h-7 rounded-md border bg-transparent px-1.5 text-xs outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring";

export function WalletStateTable({ state, assets, summaries, selected, onSelect, renderPanel }: {
  state: WalletState;
  assets: Assets;
  summaries?: readonly EffectSummary[];
  /** Signature open in the inspector; its rows are highlighted. */
  selected?: string | null;
  /** Opens a transaction in the inspector, or closes it with null. */
  onSelect?: (signature: string | null) => void;
  /** The inspector beside the table, told where the open transaction sits in the table's current order. */
  renderPanel?: (nav: TableNav | null) => React.ReactNode;
}) {
  const [assetFilter, setAssetFilter] = useState<string | null>(null);
  const [kindFilter, setKindFilter] = useState<EffectKind | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "time", dir: 1 });
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(100);

  // Every row from the whole history, not just the first page: filters and sort see it all.
  const allRows: TableRow[] = state.effects.flatMap((e, i): TableRow[] => {
    const kind = summaries?.[i]?.kind;
    // Unchanged balances stay in the data but add nothing to the table.
    const rows = e.assetChanges.filter((c) => c.delta !== "0" || (c.assetId === "SOL" && e.feeLamports !== "0"));
    if (rows.length === 0) return [{ effect: e, kind, change: null }];
    return rows.map((change) => ({ effect: e, kind, change }));
  });
  const countBy = <K extends string>(keys: (row: TableRow) => K | null) => {
    const counts = new Map<K, number>();
    for (const row of allRows) {
      const key = keys(row);
      if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
  };
  const assetOptions = countBy((row) => row.change?.assetId ?? null);
  const kindOptions = countBy((row) => row.kind ?? null);

  const filtered = allRows.filter(
    (row) => (!assetFilter || row.change?.assetId === assetFilter) && (!kindFilter || row.kind === kindFilter),
  );
  const timeOf = (row: TableRow) => (row.effect.timestamp ? Date.parse(row.effect.timestamp) : 0);
  const sorted = [...filtered].sort((a, b) => {
    let byKey = 0;
    if (sort.key === "time") byKey = timeOf(a) - timeOf(b);
    else if (sort.key === "asset") byKey = assetLabel(a.change?.assetId ?? "", assets).localeCompare(assetLabel(b.change?.assetId ?? "", assets));
    else if (sort.key === "before") byKey = asNumber(a.change?.before, a.change?.assetId ?? null, assets) - asNumber(b.change?.before, b.change?.assetId ?? null, assets);
    else if (sort.key === "after") byKey = asNumber(a.change?.after, a.change?.assetId ?? null, assets) - asNumber(b.change?.after, b.change?.assetId ?? null, assets);
    else byKey = Math.abs(asNumber(a.change?.delta, a.change?.assetId ?? null, assets)) - Math.abs(asNumber(b.change?.delta, b.change?.assetId ?? null, assets));
    // Time, then signature, keep the order stable when the key ties.
    return byKey * sort.dir || timeOf(a) - timeOf(b) || a.effect.signature.localeCompare(b.effect.signature) || (a.change?.assetId ?? "").localeCompare(b.change?.assetId ?? "");
  });
  // Pages slice the sorted rows; filters and sort always see the whole history.
  const maxPage = Math.max(0, Math.ceil(sorted.length / pageSize) - 1);
  const current = Math.min(page, maxPage);
  const shown = sorted.slice(current * pageSize, (current + 1) * pageSize);
  const filteredTxs = new Set(filtered.map((row) => row.effect.signature)).size;
  const filtersActive = assetFilter !== null || kindFilter !== null;

  // Stepping follows the table as sorted and filtered, one transaction at a time, turning the page as needed.
  const order = [...new Set(sorted.map((row) => row.effect.signature))];
  const at = selected ? order.indexOf(selected) : -1;
  const open = (signature: string | undefined) => {
    if (!signature || !onSelect) return;
    setPage(Math.floor(sorted.findIndex((row) => row.effect.signature === signature) / pageSize));
    onSelect(signature);
  };
  const nav: TableNav | null =
    at === -1
      ? null
      : { index: at, count: order.length, previous: () => open(order[at - 1]), next: () => open(order[at + 1]), neighbour: order[at + 1] ?? order[at - 1] ?? null };

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
                <label className="flex items-center gap-1.5">
                  Asset
                  <select
                    className={selectClass}
                    value={assetFilter ?? ""}
                    onChange={(event) => {
                      setAssetFilter(event.target.value || null);
                      setPage(0);
                    }}
                  >
                    <option value="">All</option>
                    {assetOptions.map(([assetId, count]) => (
                      <option key={assetId} value={assetId}>
                        {assetLabel(assetId, assets)} ({count})
                      </option>
                    ))}
                  </select>
                </label>
                {kindOptions.length > 0 && (
                  <label className="flex items-center gap-1.5">
                    Type
                    <select
                      className={selectClass}
                      value={kindFilter ?? ""}
                      onChange={(event) => {
                        setKindFilter((event.target.value || null) as EffectKind | null);
                        setPage(0);
                      }}
                    >
                      <option value="">All</option>
                      {kindOptions.map(([kind, count]) => (
                        <option key={kind} value={kind}>
                          {kind.replaceAll("_", " ").toLowerCase()} ({count})
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {filtersActive && (
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => {
                      setAssetFilter(null);
                      setKindFilter(null);
                      setPage(0);
                    }}
                  >
                    Reset
                  </Button>
                )}
                <span className="ml-auto tabular-nums" aria-live="polite">
                  {filtersActive && `${filtered.length.toLocaleString()} of ${allRows.length.toLocaleString()} rows · `}
                  {filteredTxs.toLocaleString()} transactions
                </span>
              </div>
              {sorted.length === 0 ? (
                <p className="text-sm text-muted-foreground">No rows match the filters.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs text-muted-foreground">
                      <tr>
                        {header("time")}
                        {header("asset")}
                        {header("before")}
                        {header("change")}
                        {header("after")}
                      </tr>
                    </thead>
                    <tbody>
                      {shown.map((row, i) => {
                        const { effect: e, kind, change: c } = row;
                        // Every row of a transaction opens it; Enter does too, for keyboard users.
                        const rowProps = onSelect && {
                          tabIndex: 0,
                          "aria-selected": selected === e.signature,
                          onClick: () => onSelect(e.signature),
                          onKeyDown: (event: React.KeyboardEvent) => event.key === "Enter" && onSelect(e.signature),
                        };
                        const rowClass = cn(
                          onSelect && "cursor-pointer hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none",
                          selected === e.signature && "bg-muted/60 hover:bg-muted/60",
                        );
                        // The time cell opens each transaction's group of rows in the current order.
                        const groupStart = i === 0 || shown[i - 1].effect.signature !== e.signature;
                        if (!c) {
                          return (
                            <tr key={`${e.signature}:none`} className={cn(groupStart && "border-t", rowClass)} {...rowProps}>
                              <td className="py-1 pr-4 align-top whitespace-nowrap tabular-nums">
                                {groupStart && <TransactionCell e={e} kind={kind} />}
                              </td>
                              <td colSpan={4} className="py-1 text-muted-foreground">
                                No balance change for this wallet
                              </td>
                            </tr>
                          );
                        }
                        return (
                          <tr key={`${e.signature}:${c.assetId}`} className={cn(groupStart && "border-t", rowClass)} {...rowProps}>
                            <td className="py-1 pr-4 align-top whitespace-nowrap tabular-nums">
                              {groupStart && <TransactionCell e={e} kind={kind} />}
                            </td>
                            <td className="py-1 pr-4">
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
                            <td className="py-1 pr-4 text-right tabular-nums">{c.before && amount(c.before, c.assetId, state, assets)}</td>
                            <td
                              className={`py-1 pr-4 text-right tabular-nums ${c.delta.startsWith("-") ? "text-destructive" : c.delta !== "0" ? "text-emerald-500" : "text-muted-foreground"}`}
                            >
                              {amount(c.delta, c.assetId, state, assets, true)}
                            </td>
                            <td className="py-1 pr-0 text-right tabular-nums">{c.after && amount(c.after, c.assetId, state, assets)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <div className="flex flex-wrap items-center gap-2 pt-1 text-xs text-muted-foreground">
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
                      <span className="tabular-nums" aria-live="polite">
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

"use client";

import { ExternalLinkIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { formatLamports } from "@/lib/solana/amount";
import { shortenAddress } from "@/lib/solana/address";
import { type AssetState, netChange, type WalletState, type WalletTransactionEffect } from "@/lib/state/reconstruct";
import { type Assets, assetLabel, assetLogo, formatAssetAmount, formatUtc } from "./asset-format";
import { AssetIcon } from "./asset-icon";

const MAX_ROWS = 200;

const amount = formatAssetAmount;
const time = formatUtc;

function TransactionCell({ e }: { e: WalletTransactionEffect }) {
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
        <dl className="text-sm">
          {rows.map((r) => (
            <div key={r.assetId} className="flex justify-between gap-4 py-0.5">
              <dt className="text-muted-foreground">
                <AssetName assetId={r.assetId} assets={assets} />
              </dt>
              <dd className="tabular-nums">{amount(r.amount, r.assetId, state, assets)}</dd>
            </div>
          ))}
        </dl>
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

      <StateTable title="Opening state" rows={state.opening} status={state.openingStatus} state={state} assets={assets} />
      <StateTable title="Closing state" rows={state.closing} status={state.closingStatus} state={state} assets={assets} />
      <NetChange state={state} assets={assets} />
      <ul className="list-disc pl-5 text-xs text-muted-foreground">
        {state.partialReasons.map((r) => (
          <li key={r}>{r}</li>
        ))}
        <li>Only assets that moved in this range are shown. Holdings that sat untouched aren&apos;t visible yet.</li>
      </ul>
    </div>
  );
}

export function WalletStateTable({ state, assets }: { state: WalletState; assets: Assets }) {
  const effects = state.effects.slice(0, MAX_ROWS);
  return (
    <div className="flex flex-col gap-4">
      {effects.length === 0 ? (
        <p className="text-sm text-muted-foreground">No transactions in this range.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="py-2 pr-4 font-medium">Time (UTC)</th>
                <th className="py-2 pr-4 font-medium">Asset</th>
                <th className="py-2 pr-4 text-right font-medium">Before</th>
                <th className="py-2 pr-4 text-right font-medium">Change</th>
                <th className="py-2 text-right font-medium">After</th>
              </tr>
            </thead>
            {effects.map((e) => {
              // Unchanged balances stay in the data but add nothing to the table.
              const rows = e.assetChanges.filter((c) => c.delta !== "0" || (c.assetId === "SOL" && e.feeLamports !== "0"));
              return (
              <tbody key={e.signature} className="border-t">
                {rows.length === 0 && (
                  <tr>
                    <td className="py-1 pr-4 align-top whitespace-nowrap tabular-nums">
                      <TransactionCell e={e} />
                    </td>
                    <td colSpan={4} className="py-1 text-muted-foreground">
                      No balance change for this wallet
                    </td>
                  </tr>
                )}
                {rows.map((c, i) => (
                  <tr key={c.assetId}>
                    <td className="py-1 pr-4 align-top whitespace-nowrap tabular-nums">
                      {i === 0 && <TransactionCell e={e} />}
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
                    <td className="py-1 text-right tabular-nums">{c.after && amount(c.after, c.assetId, state, assets)}</td>
                  </tr>
                ))}
              </tbody>
              );
            })}
          </table>
          {state.effects.length > MAX_ROWS && (
            <p className="pt-2 text-xs text-muted-foreground">
              Showing the first {MAX_ROWS} of {state.effects.length.toLocaleString()} transactions.
            </p>
          )}
        </div>
      )}
    </div>
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
        <dl className="text-sm">
          {changes.map((c) => (
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
    </div>
  );
}

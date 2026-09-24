"use client";

import { useState } from "react";
import { ExternalLinkIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { AssetMetadata } from "@/lib/assets/assets";
import type { FraudWatchCase } from "@/lib/case/model";
import { formatBaseUnits, formatLamports } from "@/lib/solana/amount";
import { shortenAddress } from "@/lib/solana/address";
import type { AssetState, WalletState, WalletTransactionEffect } from "@/lib/state/reconstruct";

const MAX_ROWS = 200;

type Assets = Map<string, AssetMetadata>;

function assetLabel(assetId: string, assets: Assets) {
  const meta = assets.get(assetId);
  return meta?.symbol || meta?.name || shortenAddress(assetId, 4);
}

function amount(value: string, assetId: string, state: WalletState, assets: Assets, signed = false) {
  const decimals = state.decimals[assetId] ?? assets.get(assetId)?.decimals ?? 0;
  const text = formatBaseUnits(value, decimals);
  return signed && !value.startsWith("-") && value !== "0" ? `+${text}` : text;
}

function time(timestamp: string | null) {
  return timestamp ? timestamp.slice(0, 19).replace("T", " ") : "—";
}

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
              <dt className="text-muted-foreground" title={r.assetId}>
                {assetLabel(r.assetId, assets)}
              </dt>
              <dd className="tabular-nums">{amount(r.amount, r.assetId, state, assets)}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

function WalletStatePanel({ state, assets }: { state: WalletState; assets: Assets }) {
  const effects = state.effects.slice(0, MAX_ROWS);
  return (
    <div className="flex flex-col gap-4">
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

      <div className="grid gap-3 sm:grid-cols-2">
        <StateTable title="Opening state" rows={state.opening} status={state.openingStatus} state={state} assets={assets} />
        <StateTable title="Closing state" rows={state.closing} status={state.closingStatus} state={state} assets={assets} />
      </div>
      <ul className="list-disc pl-5 text-xs text-muted-foreground">
        {state.partialReasons.map((r) => (
          <li key={r}>{r}</li>
        ))}
        <li>Only assets that moved in this range are shown. Holdings that sat untouched aren&apos;t visible yet.</li>
      </ul>

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
                    <td className="py-1 pr-4" title={c.assetId}>
                      {assetLabel(c.assetId, assets)}
                      {c.assetId === "SOL" && e.feeLamports !== "0" && (
                        <span className="block text-xs text-muted-foreground">incl. {formatLamports(e.feeLamports)} fee</span>
                      )}
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

export function WalletStateView({ c, states, assets }: { c: FraudWatchCase; states: WalletState[]; assets: Assets }) {
  const [selected, setSelected] = useState(0);
  const state = states[Math.min(selected, states.length - 1)];
  if (!state) return null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-medium">Wallet state</h3>
        {states.length > 1 &&
          states.map((s, i) => (
            <Button key={s.wallet} size="xs" variant={s === state ? "secondary" : "ghost"} onClick={() => setSelected(i)}>
              <span className="font-mono">{c.labels[s.wallet] ?? shortenAddress(s.wallet, 4)}</span>
              {(s.mismatches.length > 0 || s.openingStatus !== "OBSERVED") && <span className="text-destructive">•</span>}
            </Button>
          ))}
      </div>
      <WalletStatePanel state={state} assets={assets} />
    </div>
  );
}

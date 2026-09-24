"use client";

import { DownloadIcon, ExternalLinkIcon, SquareIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useIngestion } from "@/hooks/use-ingestion";
import type { FraudWatchCase } from "@/lib/case/model";
import type { IngestionProgress, IngestionResult, WalletIngestion } from "@/lib/ingest/ingest";
import type { RpcSettings } from "@/lib/rpc/settings";
import { formatLamports } from "@/lib/solana/amount";
import { shortenAddress } from "@/lib/solana/address";

const MAX_ROWS = 200;

function walletName(c: FraudWatchCase, address: string) {
  return c.labels[address] ?? shortenAddress(address, 6);
}

function ProgressLines({ progress, c }: { progress: IngestionProgress | null; c: FraudWatchCase }) {
  if (!progress) return <p className="text-sm">Starting…</p>;
  const { phase, done, total, signaturesFound } = progress;
  return (
    <div className="flex flex-col gap-1 text-sm" aria-live="polite">
      {progress.walletCount > 1 && (
        <p className="text-muted-foreground">
          Wallet {progress.walletIndex + 1} of {progress.walletCount}:{" "}
          <span className="font-mono">{walletName(c, progress.wallet)}</span>
        </p>
      )}
      <p>
        {phase === "signatures" ? "Loading signatures…" : "Signatures"}{" "}
        <span className="text-muted-foreground">{signaturesFound.toLocaleString()} found</span>
      </p>
      {phase === "transactions" && (
        <p>
          Fetching transactions… <span className="tabular-nums">{done.toLocaleString()} / {total.toLocaleString()}</span>
        </p>
      )}
      {phase === "token_accounts" && (
        <p>
          Token account history… <span className="tabular-nums">{done} / {total}</span>
        </p>
      )}
    </div>
  );
}

function WalletCoverage({ w, c }: { w: WalletIngestion; c: FraudWatchCase }) {
  const { coverage } = w;
  return (
    <li className="flex flex-col gap-2 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm">{walletName(c, w.wallet)}</span>
        {coverage.complete ? <Badge variant="secondary">Complete</Badge> : <Badge variant="destructive">Partial history</Badge>}
        <span className="text-xs text-muted-foreground">
          {coverage.transactionCount.toLocaleString()} of {coverage.signatureCount.toLocaleString()} transactions ·{" "}
          {w.tokenAccounts.length} token account{w.tokenAccounts.length === 1 ? "" : "s"} searched
          {coverage.oldestLoaded && coverage.newestLoaded && (
            <>
              {" "}
              · {coverage.oldestLoaded.slice(0, 16).replace("T", " ")} → {coverage.newestLoaded.slice(0, 16).replace("T", " ")} UTC
            </>
          )}
        </span>
      </div>
      {w.error && <p className="text-sm text-destructive">{w.error}</p>}
      {coverage.warnings.length > 0 && (
        <ul className="list-disc pl-5 text-xs text-muted-foreground">
          {coverage.warnings.map((warning) => (
            <li key={warning} className="break-all">
              {warning}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function TransactionList({ result, c }: { result: IngestionResult; c: FraudWatchCase }) {
  const walletsBySignature = new Map<string, string[]>();
  for (const w of result.wallets) {
    for (const s of w.signatures) walletsBySignature.set(s, [...(walletsBySignature.get(s) ?? []), w.wallet]);
  }
  const rows = [...result.transactions.values()].sort((a, b) => b.slot - a.slot);
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">No transactions in this range.</p>;

  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="py-2 pr-4 font-medium">Time (UTC)</th>
              <th className="py-2 pr-4 font-medium">Signature</th>
              <th className="py-2 pr-4 font-medium">Status</th>
              <th className="py-2 pr-4 font-medium">Fee</th>
              <th className="py-2 pr-4 font-medium">Token changes</th>
              <th className="py-2 font-medium">Mapped wallets</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.slice(0, MAX_ROWS).map((tx) => (
              <tr key={tx.signature}>
                <td className="py-2 pr-4 whitespace-nowrap tabular-nums">
                  {tx.timestamp ? tx.timestamp.slice(0, 19).replace("T", " ") : "—"}
                </td>
                <td className="py-2 pr-4">
                  <a
                    href={`https://solscan.io/tx/${tx.signature}`}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex items-center gap-1 font-mono underline-offset-4 hover:underline"
                  >
                    {shortenAddress(tx.signature, 6)}
                    <ExternalLinkIcon className="size-3" />
                  </a>
                </td>
                <td className="py-2 pr-4">
                  {tx.success ? "Success" : <span className="text-destructive">Failed</span>}
                </td>
                <td className="py-2 pr-4 whitespace-nowrap tabular-nums">{formatLamports(tx.feeLamports)}</td>
                <td className="py-2 pr-4 tabular-nums">{tx.tokenChanges.filter((t) => t.delta !== "0").length}</td>
                <td className="py-2 font-mono text-xs">
                  {(walletsBySignature.get(tx.signature) ?? []).map((w) => walletName(c, w)).join(", ")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > MAX_ROWS && (
        <p className="text-xs text-muted-foreground">
          Showing the newest {MAX_ROWS} of {rows.length.toLocaleString()} transactions.
        </p>
      )}
    </div>
  );
}

export function IngestionPanel({ c, rpc }: { c: FraudWatchCase; rpc: RpcSettings | undefined }) {
  const { state, start, cancel } = useIngestion();
  const wallets = c.mappedWallets.map((w) => w.address);
  const running = state.status === "running";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Transactions</CardTitle>
        <CardDescription>
          Loads each mapped wallet&apos;s history for the case range from your RPC, including activity that only touches
          its token accounts. Results are not cached yet, so reloading the page clears them.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          {running ? (
            <Button variant="outline" size="sm" onClick={cancel}>
              <SquareIcon />
              Cancel
            </Button>
          ) : (
            <Button size="sm" disabled={!rpc} onClick={() => rpc && start(rpc.url, wallets, c.range)}>
              <DownloadIcon />
              {state.status === "idle" ? "Load transactions" : "Reload transactions"}
            </Button>
          )}
          {rpc?.providerType === "enhanced" && (
            <span className="text-xs text-muted-foreground">Enhanced provider APIs are not used yet; loading with standard RPC.</span>
          )}
        </div>

        {state.status === "running" && <ProgressLines progress={state.progress} c={c} />}

        {state.status === "error" && (
          <Alert variant="destructive">
            <AlertTitle>Loading failed</AlertTitle>
            <AlertDescription>{state.error}</AlertDescription>
          </Alert>
        )}

        {state.status === "done" && (
          <>
            {(state.result.cancelled || state.result.wallets.some((w) => !w.coverage.complete)) && (
              <Alert variant="destructive">
                <AlertTitle>{state.result.cancelled ? "Loading cancelled — partial history" : "Partial history"}</AlertTitle>
                <AlertDescription>
                  Some activity in the range may be missing. Don&apos;t treat the absence of a transaction below as
                  evidence it didn&apos;t happen.
                  {state.result.wallets.length < wallets.length &&
                    ` ${wallets.length - state.result.wallets.length} mapped wallet(s) were not loaded.`}
                </AlertDescription>
              </Alert>
            )}
            <ul className="divide-y">
              {state.result.wallets.map((w) => (
                <WalletCoverage key={w.wallet} w={w} c={c} />
              ))}
            </ul>
            <TransactionList result={state.result} c={c} />
          </>
        )}
      </CardContent>
    </Card>
  );
}

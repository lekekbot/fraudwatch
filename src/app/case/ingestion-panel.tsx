"use client";

import { DownloadIcon, SquareIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useIngestion } from "@/hooks/use-ingestion";
import { useWalletStates } from "@/hooks/use-wallet-states";
import type { FraudWatchCase } from "@/lib/case/model";
import type { IngestionProgress, WalletIngestion } from "@/lib/ingest/ingest";
import type { RpcSettings } from "@/lib/rpc/settings";
import { shortenAddress } from "@/lib/solana/address";
import { WalletStateView } from "./wallet-state-view";

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
          {coverage.transactionCount.toLocaleString()} of {coverage.signatureCount.toLocaleString()} transactions
          {w.stats.fetchedTransactions > 0 && <> · {w.stats.fetchedTransactions.toLocaleString()} fetched</>}
          {w.stats.cachedTransactions > 0 && <> · {w.stats.cachedTransactions.toLocaleString()} from local cache</>}
          {w.tokenAccounts.length > 0 && (
            <>
              {" "}
              · {w.tokenAccounts.length} token account{w.tokenAccounts.length === 1 ? "" : "s"} searched
            </>
          )}
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

export function IngestionPanel({ c, rpc }: { c: FraudWatchCase; rpc: RpcSettings | undefined }) {
  const { state, start, cancel, wallets } = useIngestion(c);
  const walletStates = useWalletStates(state.status === "done" ? state.result : null, c.range, rpc?.url);
  const running = state.status === "running";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Transactions</CardTitle>
        <CardDescription>
          Loads each mapped wallet&apos;s history for the case range from your RPC, including activity that only touches
          its token accounts. Results are cached in this browser; later loads only fetch what isn&apos;t cached yet.
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
            <Button size="sm" disabled={!rpc} onClick={() => rpc && start(rpc.url)}>
              <DownloadIcon />
              {state.status === "done" ? "Load missing history" : "Load transactions"}
            </Button>
          )}
          {state.status === "done" && state.lastLoadedAt && (
            <span className="text-xs text-muted-foreground">
              {state.source === "cache" ? "From local cache · " : ""}last loaded{" "}
              {state.lastLoadedAt.slice(0, 16).replace("T", " ")} UTC
            </span>
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
            {walletStates && <WalletStateView c={c} states={walletStates.states} assets={walletStates.assets} transactions={state.result.transactions} />}
          </>
        )}
      </CardContent>
    </Card>
  );
}

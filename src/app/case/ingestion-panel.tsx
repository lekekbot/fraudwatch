"use client";

import { DownloadIcon, SquareIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { useIngestion } from "@/hooks/use-ingestion";
import type { IngestionProgress, WalletIngestion } from "@/lib/ingest/ingest";
import type { Names } from "@/lib/labels/labels";
import type { RpcSettings } from "@/lib/rpc/settings";
import { PanelSection } from "./panel";

function ProgressLines({ progress, names }: { progress: IngestionProgress | null; names: Names }) {
  if (!progress) return <p className="text-sm">Starting…</p>;
  const { phase, signaturesFound, transactions: tx } = progress;
  return (
    <div className="flex flex-col gap-1 text-sm" aria-live="polite">
      {progress.walletCount > 1 && (
        <p className="text-muted-foreground">
          Wallet {progress.walletIndex + 1} of {progress.walletCount}:{" "}
          <span className="font-mono">{names.of(progress.wallet, 6)}</span>
        </p>
      )}
      <p>
        {phase === "signatures" ? "Loading signatures…" : "Signatures"}{" "}
        <span className="text-muted-foreground">{signaturesFound.toLocaleString()} found</span>
      </p>
      {phase === "token_accounts" && (
        <p>
          Token account history…{" "}
          <span className="tabular-nums">
            {progress.tokenAccountsDone} / {progress.tokenAccountsTotal}
          </span>
        </p>
      )}
      {signaturesFound > 0 && (
        <p>
          {phase === "transactions" ? "Fetching transactions…" : "Transactions"}{" "}
          <span className="tabular-nums">
            {tx.loaded.toLocaleString()} / {signaturesFound.toLocaleString()}
          </span>
          {tx.loading + tx.queued > 0 && (
            <span className="text-muted-foreground"> · {(tx.loading + tx.queued).toLocaleString()} pending</span>
          )}
          {tx.failed > 0 && <span className="text-destructive"> · {tx.failed.toLocaleString()} failed</span>}
        </p>
      )}
    </div>
  );
}

function WalletCoverage({ w, names }: { w: WalletIngestion; names: Names }) {
  const { coverage } = w;
  return (
    <li className="flex flex-col gap-2 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm">{names.of(w.wallet, 6)}</span>
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

/** Left-panel section: loads history from the RPC and reports how complete it is. */
export function IngestionPanel({
  names,
  rpc,
  ingestion,
}: {
  names: Names;
  rpc: RpcSettings | undefined;
  ingestion: ReturnType<typeof useIngestion>;
}) {
  const { state, start, cancel, wallets } = ingestion;
  const running = state.status === "running";

  return (
    <PanelSection title="History" collapsible defaultCollapsed>
      <p className="text-xs text-muted-foreground">
        Loads each mapped wallet&apos;s history for the case range from your RPC, including its token accounts. Cached
        in this browser; later loads only fetch what&apos;s missing.
      </p>
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
      {state.status === "running" && <ProgressLines progress={state.progress} names={names} />}

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
                Some activity in the range may be missing. Don&apos;t treat the absence of a transaction as evidence it
                didn&apos;t happen.
                {state.result.wallets.length < wallets.length &&
                  ` ${wallets.length - state.result.wallets.length} mapped wallet(s) were not loaded.`}
              </AlertDescription>
            </Alert>
          )}
          <ul className="divide-y">
            {state.result.wallets.map((w) => (
              <WalletCoverage key={w.wallet} w={w} names={names} />
            ))}
          </ul>
        </>
      )}
    </PanelSection>
  );
}

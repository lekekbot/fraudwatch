import { CopyIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { BehaviorObservation } from "@/lib/behavior/observations";
import type { SemanticEvent } from "@/lib/semantic/events";
import { analysisFingerprint, analysisVersions } from "@/lib/semantic/versions";
import type { CanonicalTransaction } from "@/lib/solana/canonical";
import type { WalletTransactionEffect } from "@/lib/state/reconstruct";
import type { EffectSummary } from "@/lib/state/summarize";

/** JSON that survives bigints. */
const json = (value: unknown) => JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2);

function Block({ label, value }: { label: string; value: unknown }) {
  return (
    <details className="rounded-md border">
      <summary className="cursor-pointer px-2 py-1.5 text-xs">{label}</summary>
      <pre className="max-h-72 overflow-auto border-t p-2 text-[11px] leading-snug">{json(value)}</pre>
    </details>
  );
}

/**
 * For debugging a reading: every stage of one transaction side by side
 * (canonical transaction, this wallet's effect, the semantic event, the
 * behaviour observations it's in), with the versions that produced them.
 */
export function DebugDetails({
  event,
  tx,
  effect,
  summary,
  observations,
}: {
  event: SemanticEvent;
  tx: CanonicalTransaction | undefined;
  effect: WalletTransactionEffect;
  summary: EffectSummary;
  observations: readonly BehaviorObservation[];
}) {
  const versions = analysisVersions();
  // The canonical transaction without the raw RPC response, which has its own viewer.
  const canonical = tx ? { ...tx, raw: tx.raw == null ? null : "(see Raw JSON)" } : null;
  const bundle = { fingerprint: analysisFingerprint(), versions, canonical, walletEffect: { effect, summary }, event, observations };
  return (
    <details className="rounded-md border" aria-label="Developer details">
      <summary className="cursor-pointer px-2 py-1.5 text-xs font-medium">Developer details</summary>
      <div className="flex flex-col gap-2 border-t p-2">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
          <dt className="text-muted-foreground">Parser</dt>
          <dd className="font-mono">v{versions.parser}</dd>
          <dt className="text-muted-foreground">Reconstruction</dt>
          <dd className="font-mono">v{versions.reconstruction}</dd>
          <dt className="text-muted-foreground">Semantic model</dt>
          <dd className="font-mono">v{versions.semantic} (event v{event.version})</dd>
          <dt className="text-muted-foreground">Registry</dt>
          <dd className="font-mono">v{versions.registry}</dd>
          <dt className="text-muted-foreground">Behaviour rules</dt>
          <dd className="font-mono">v{versions.behavior}</dd>
        </dl>
        <div>
          <p className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">Interpreters considered</p>
          <ol className="flex flex-col text-xs">
            {event.trace.map((t) => (
              <li key={t.id} className="flex justify-between gap-2 font-mono">
                <span>
                  {t.id}@{t.version}
                </span>
                <span className={t.outcome === "matched" ? "text-emerald-500" : t.outcome === "failed" ? "text-destructive" : "text-muted-foreground"}>{t.outcome.replace("_", " ")}</span>
              </li>
            ))}
          </ol>
        </div>
        <div>
          <p className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">Registry matches</p>
          <ul className="flex flex-col text-xs">
            {event.evidence.flatMap((e) =>
              e.kind === "KNOWN_ADDRESS"
                ? [
                    <li key={e.address} className="truncate font-mono" title={e.address}>
                      {e.protocolId} · {e.address}
                    </li>,
                  ]
                : [],
            )}
            {!event.evidence.some((e) => e.kind === "KNOWN_ADDRESS") && <li className="text-muted-foreground">None</li>}
          </ul>
        </div>
        <Block label="Canonical transaction" value={canonical} />
        <Block label="Wallet effect and summary" value={{ effect, summary }} />
        <Block label="Semantic event" value={event} />
        <Block label={`Behaviour observations (${observations.length})`} value={observations} />
        <Button
          variant="outline"
          size="sm"
          onClick={() => navigator.clipboard.writeText(json(bundle)).then(() => toast.success("Debug bundle copied."), () => toast.error("Couldn't copy."))}
        >
          <CopyIcon /> Copy debug bundle
        </Button>
        <p className="text-[11px] text-muted-foreground">The bundle has no RPC URL or labels; it holds public chain data and FraudWatch&apos;s reading of it.</p>
      </div>
    </details>
  );
}

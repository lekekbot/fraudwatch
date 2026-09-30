"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { findDuplicateCases } from "@/lib/db/cases";
import { getDb } from "@/lib/db/db";
import { parseMapParams } from "@/lib/routing/map-params";
import { buildCasePath } from "@/lib/routing/case-path";

/**
 * /map?wallet=&from=&to= — simple startup link.
 * Opens the matching local case if one exists; otherwise pre-fills New case.
 * Never creates a case without the user confirming.
 */
export function MapStartup() {
  const router = useRouter();
  const search = useSearchParams().toString();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const parsed = parseMapParams(new URLSearchParams(search));
    if (!parsed.ok) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- surfaced once per URL
      setError(parsed.error);
      return;
    }
    let cancelled = false;
    findDuplicateCases(getDb(), parsed.value.wallet, parsed.value.range)
      .then((matches) => {
        if (cancelled) return;
        if (matches.length > 0) {
          const newest = [...matches].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
          router.replace(buildCasePath(newest.id, "timeline"));
        } else {
          router.replace(`/cases/new/?${search}`);
        }
      })
      .catch((err: unknown) => !cancelled && setError(err instanceof Error ? err.message : "Local storage error."));
    return () => {
      cancelled = true;
    };
  }, [router, search]);

  if (!error) return <p className="text-sm text-muted-foreground">Opening…</p>;
  return (
    <Alert variant="destructive" className="mx-auto max-w-2xl">
      <AlertTitle>Can&apos;t open this link</AlertTitle>
      <AlertDescription className="flex flex-col items-start gap-3">
        <span>{error} Expected /map?wallet=&lt;address&gt;&amp;from=&lt;unix&gt;&amp;to=&lt;unix&gt;.</span>
        <Link href="/cases/new/" className={buttonVariants({ variant: "outline", size: "sm" })}>
          Create a case manually
        </Link>
      </AlertDescription>
    </Alert>
  );
}

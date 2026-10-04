"use client";

import { TriangleAlertIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { LookalikeVerdict } from "@/lib/labels/lookalikes";

const VERDICT_TEXT: Record<LookalikeVerdict, string> = {
  decoy: "Likely decoy",
  real: "Likely real",
  unclear: "Look-alike",
};

/** Amber warning badge for an address with a look-alike in the case, saying which side it's likely on. */
export function LookalikeBadge({ verdict = "unclear" }: { verdict?: LookalikeVerdict }) {
  return (
    <Badge
      variant="outline"
      className={verdict === "decoy" ? "border-destructive/60 text-destructive" : "border-amber-500/60 text-amber-500"}
      title={
        verdict === "decoy"
          ? "Only moves dust, while an address that reads the same moves real value: likely an address-poisoning decoy."
          : verdict === "real"
            ? "Moves real value; an address that reads the same only moves dust and is likely a decoy of this one."
            : "Another address in this case starts and ends with the same or nearly the same characters: a possible address-poisoning decoy."
      }
    >
      <TriangleAlertIcon /> {VERDICT_TEXT[verdict]}
    </Badge>
  );
}

/** Small amber marker for list rows. */
export function LookalikeMark({ count }: { count: number }) {
  return (
    <TriangleAlertIcon
      className="size-3.5 shrink-0 text-amber-500"
      aria-label={`Looks like ${count} other address${count === 1 ? "" : "es"} in this case`}
    >
      <title>Looks like another address in this case: possible address poisoning</title>
    </TriangleAlertIcon>
  );
}

/** `address` in full, with the characters that differ from `against` highlighted. */
export function AddressDiff({ address, against }: { address: string; against: string }) {
  let head = 0;
  while (head < address.length && head < against.length && address[head] === against[head]) head++;
  let tail = 0;
  while (tail < address.length - head && tail < against.length - head && address[address.length - 1 - tail] === against[against.length - 1 - tail]) tail++;
  return (
    <span className="font-mono break-all">
      {address.slice(0, head)}
      <mark className="rounded-sm bg-amber-500/25 px-px text-amber-500">{address.slice(head, address.length - tail)}</mark>
      {address.slice(address.length - tail)}
    </span>
  );
}

/**
 * The look-alikes of `address`, each shown in full beside it so the
 * difference is visible; picking one opens it.
 */
export function LookalikeComparison({
  address,
  twins,
  onSelect,
  verdictOf,
  onHideDecoys,
}: {
  address: string;
  twins: readonly string[];
  onSelect?: (address: string) => void;
  verdictOf?: (address: string) => LookalikeVerdict | undefined;
  /** Hides the decoys' transactions, so the real account shows instead; offered when one of these is a likely decoy. */
  onHideDecoys?: () => void;
}) {
  const tag = (a: string) => {
    const v = verdictOf?.(a);
    return v && v !== "unclear" ? ` · ${VERDICT_TEXT[v].toLowerCase()}` : "";
  };
  const anyDecoy = [address, ...twins].some((a) => verdictOf?.(a) === "decoy");
  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs">
      <p className="font-medium text-amber-500">Looks like {twins.length === 1 ? "another address" : `${twins.length} other addresses`} in this case</p>
      <p className="text-muted-foreground">
        They start and end with the same or nearly the same characters, so they read alike at a glance. Decoys like this are used for address poisoning: check
        which one is the real counterparty.
      </p>
      <div className="flex flex-col gap-0.5">
        <span className="text-muted-foreground">This address{tag(address)}</span>
        <AddressDiff address={address} against={twins[0]} />
      </div>
      {twins.map((twin) => (
        <div key={twin} className="flex flex-col gap-0.5">
          <span className="text-muted-foreground">Look-alike{tag(twin)}</span>
          {onSelect ? (
            <button type="button" className="text-left underline-offset-4 hover:underline" onClick={() => onSelect(twin)}>
              <AddressDiff address={twin} against={address} />
            </button>
          ) : (
            <AddressDiff address={twin} against={address} />
          )}
        </div>
      ))}
      {anyDecoy && (
        <p className="text-muted-foreground">The decoy only moved dust; the other moved real value.</p>
      )}
      {anyDecoy && onHideDecoys && (
        <Button variant="outline" size="xs" className="self-start" onClick={onHideDecoys}>
          Hide decoy transactions
        </Button>
      )}
    </div>
  );
}

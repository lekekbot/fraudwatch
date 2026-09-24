"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { InfoIcon } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { type FraudWatchCase, type NewCaseErrors, type NewCaseInput, createCase, validateNewCaseInput } from "@/lib/case/model";
import { type CaseRange, datesFromRange, formatRange, rangeFromDates, sameRange } from "@/lib/case/range";
import { findDuplicateCases, saveCase } from "@/lib/db/cases";
import { getDb } from "@/lib/db/db";
import { parseMapParams } from "@/lib/routing/map-params";

type Pending = { value: { name: string; primaryWallet: string; range: CaseRange }; duplicates: FraudWatchCase[] };

function initialInput(params: URLSearchParams): { input: NewCaseInput; widenedFrom?: CaseRange } {
  const empty: NewCaseInput = { name: "", primaryWallet: "", startDate: "", endDate: "" };
  const parsed = parseMapParams(params);
  const wallet = parsed.ok ? parsed.value.wallet : parsed.partial.wallet;
  const range = parsed.ok ? parsed.value.range : parsed.partial.range;
  if (!wallet && !range) return { input: empty };

  const dates = range ? datesFromRange(range) : { startDate: "", endDate: "" };
  // The form works in whole UTC days; flag when a link's exact range gets widened.
  const dayRange = range ? rangeFromDates(dates.startDate, dates.endDate) : null;
  const widened = range && dayRange && !sameRange(range, dayRange) ? range : undefined;
  return { input: { ...empty, primaryWallet: wallet ?? "", ...dates }, widenedFrom: widened };
}

export function NewCaseForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [{ input: initial, widenedFrom }] = useState(() => initialInput(new URLSearchParams(searchParams.toString())));
  const [input, setInput] = useState<NewCaseInput>(initial);
  const [errors, setErrors] = useState<NewCaseErrors>({});
  const [saving, setSaving] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);

  function update<K extends keyof NewCaseInput>(key: K, value: NewCaseInput[K]) {
    setInput((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => ({ ...prev, [key]: undefined }));
  }

  async function persist(value: Pending["value"]) {
    setSaving(true);
    try {
      const fwCase = createCase(value);
      await saveCase(getDb(), fwCase);
      router.push(`/case/?id=${encodeURIComponent(fwCase.id)}`);
    } catch (err) {
      setSaving(false);
      toast.error(err instanceof Error ? err.message : "Could not save the case.");
    }
  }

  async function submit() {
    const result = validateNewCaseInput(input);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    try {
      const duplicates = await findDuplicateCases(getDb(), result.value.primaryWallet, result.value.range);
      if (duplicates.length > 0) {
        setPending({ value: result.value, duplicates });
        return;
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not read local cases.");
      return;
    }
    await persist(result.value);
  }

  return (
    <>
      <Card className="mx-auto max-w-2xl">
        <CardHeader>
          <CardTitle>New case</CardTitle>
          <CardDescription>
            A case is one primary wallet over a date range. It is saved only in this browser.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            id="new-case"
            method="post"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <FieldGroup>
              {widenedFrom && (
                <Alert>
                  <InfoIcon />
                  <AlertDescription>
                    The link asked for {widenedFrom.start} → {widenedFrom.end}. Cases use whole UTC days, so the range
                    has been widened to {formatRange(rangeFromDates(input.startDate, input.endDate) ?? widenedFrom)}.
                  </AlertDescription>
                </Alert>
              )}

              <Field data-invalid={errors.primaryWallet ? true : undefined}>
                <FieldLabel htmlFor="primary-wallet">Primary wallet</FieldLabel>
                <Input
                  id="primary-wallet"
                  placeholder="Solana address"
                  value={input.primaryWallet}
                  onChange={(e) => update("primaryWallet", e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  aria-invalid={errors.primaryWallet ? true : undefined}
                  className="font-mono"
                />
                <FieldError>{errors.primaryWallet}</FieldError>
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field data-invalid={errors.startDate ? true : undefined}>
                  <FieldLabel htmlFor="start-date">Start date (UTC)</FieldLabel>
                  <Input
                    id="start-date"
                    type="date"
                    value={input.startDate}
                    onChange={(e) => update("startDate", e.target.value)}
                    aria-invalid={errors.startDate ? true : undefined}
                  />
                  <FieldError>{errors.startDate}</FieldError>
                </Field>
                <Field data-invalid={errors.endDate ? true : undefined}>
                  <FieldLabel htmlFor="end-date">End date (UTC, inclusive)</FieldLabel>
                  <Input
                    id="end-date"
                    type="date"
                    value={input.endDate}
                    onChange={(e) => update("endDate", e.target.value)}
                    aria-invalid={errors.endDate ? true : undefined}
                  />
                  <FieldError>{errors.endDate}</FieldError>
                </Field>
              </div>

              <Field data-invalid={errors.name ? true : undefined}>
                <FieldLabel htmlFor="case-name">Case name</FieldLabel>
                <Input
                  id="case-name"
                  placeholder="Optional. Defaults to the wallet"
                  value={input.name}
                  onChange={(e) => update("name", e.target.value)}
                  autoComplete="off"
                />
                {errors.name ? <FieldError>{errors.name}</FieldError> : <FieldDescription>Only visible to you.</FieldDescription>}
              </Field>
            </FieldGroup>
          </form>
        </CardContent>
        <CardFooter className="justify-end gap-2">
          <Link href="/" className={buttonVariants({ variant: "ghost" })}>
            Cancel
          </Link>
          <Button type="submit" form="new-case" disabled={saving}>
            Create case
          </Button>
        </CardFooter>
      </Card>

      <Dialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>A matching case already exists</DialogTitle>
            <DialogDescription>
              {pending?.duplicates.length === 1 ? "A local case" : `${pending?.duplicates.length} local cases`} already use
              this wallet and exactly this date range.
            </DialogDescription>
          </DialogHeader>
          <ul className="flex flex-col gap-2">
            {pending?.duplicates.map((d) => (
              <li key={d.id}>
                <Link
                  href={`/case/?id=${encodeURIComponent(d.id)}`}
                  className={buttonVariants({ variant: "outline", className: "w-full justify-between" })}
                >
                  <span className="truncate">{d.name}</span>
                  <span className="text-xs text-muted-foreground">Open</span>
                </Link>
              </li>
            ))}
          </ul>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPending(null)}>
              Back
            </Button>
            <Button disabled={saving} onClick={() => pending && void persist(pending.value)}>
              Create another anyway
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

"use client";

import { useState } from "react";
import { PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { deleteRule, hiddenBy, ruleMatches, saveRule } from "@/lib/case/hiding";
import type { AmountOp, FraudWatchCase, HideRule } from "@/lib/case/model";
import type { Names } from "@/lib/labels/labels";
import { formatBaseUnits, parseUnits } from "@/lib/solana/amount";
import type { EffectKind } from "@/lib/state/summarize";
import { type FilterableTx, movedAssets } from "@/lib/timeline/filter";
import { cn } from "cn";
import { type Assets, assetLabel } from "./asset-format";
import { KINDS, protocolName } from "./filter-panel";
import { PanelSection } from "./panel";

const SHOWN_CHOICES = 12;

const AMOUNT_OPS: { op: AmountOp; label: string; hint: string }[] = [
  { op: "lt", label: "Less than", hint: "smaller" },
  { op: "gt", label: "More than", hint: "larger" },
  { op: "eq", label: "Exactly", hint: "exactly this" },
  { op: "ne", label: "Not", hint: "anything but this" },
];

/** What the rules dialog shows: closed, the rule list, or the editor on a rule (new or existing). */
export type RulesDialogState = null | "list" | HideRule;

/** Left-panel section: what's hidden from the map, and the case's hide rules. */
export function HidingSection({ c, rows, assets, names, decimalsOf, dialog, onDialog, onPickInTable, onSave }: {
  c: FraudWatchCase;
  /** Every lane's side of every loaded transaction, before filters, with the lane's wallet counted as involved. */
  rows: FilterableTx[];
  assets: Assets;
  names: Names;
  decimalsOf: (assetId: string) => number;
  dialog: RulesDialogState;
  onDialog: (next: RulesDialogState) => void;
  /** Opens the table, where transactions can be ticked and hidden. */
  onPickInTable?: () => void;
  onSave: (next: FraudWatchCase) => void;
}) {
  const tagsOf = (address: string) => names.label(address)?.tags ?? [];
  const manual = c.hiddenSignatures?.length ?? 0;
  // A transaction counts once however many lanes it's on.
  const byRules = new Set(
    rows.filter((row) => {
      const why = hiddenBy(c, row, tagsOf);
      return why !== null && why !== "manual";
    }).map((row) => row.signature),
  ).size;
  const rules = c.hideRules ?? [];
  const newRule = (): HideRule => ({ id: crypto.randomUUID(), name: `Rule ${rules.length + 1}`, enabled: true });

  return (
    <PanelSection title="Hidden transactions" collapsible>
      {manual === 0 && byRules === 0 ? (
        <p className="text-xs text-muted-foreground">Hide noise from the map: filter to it and hide it, tick rows in the table, or add a rule.</p>
      ) : (
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="text-muted-foreground">
            {manual.toLocaleString()} by hand · {byRules.toLocaleString()} by rules
          </span>
          {manual > 0 && (
            <Button variant="ghost" size="xs" onClick={() => onSave({ ...c, hiddenSignatures: [], updatedAt: new Date().toISOString() })}>
              Unhide by hand
            </Button>
          )}
        </div>
      )}
      {rules.length > 0 && (
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="text-muted-foreground">
            {rules.filter((r) => r.enabled).length} of {rules.length} rule{rules.length === 1 ? "" : "s"} on
          </span>
          <Button variant="ghost" size="xs" onClick={() => onDialog("list")}>
            Manage
          </Button>
        </div>
      )}
      {manual === 0 && byRules === 0 && onPickInTable && (
        <Button variant="outline" size="xs" className="w-full" onClick={onPickInTable}>
          Pick in table
        </Button>
      )}
      <Button variant="outline" size="sm" className="w-full" onClick={() => onDialog(newRule())}>
        <PlusIcon /> Add Rule
      </Button>
      {dialog !== null && (
        <RulesDialog
          key={dialog === "list" ? "list" : dialog.id}
          c={c}
          rows={rows}
          assets={assets}
          names={names}
          decimalsOf={decimalsOf}
          initial={dialog === "list" ? null : dialog}
          newRule={newRule}
          onSave={onSave}
          onClose={() => onDialog(null)}
        />
      )}
    </PanelSection>
  );
}

function RulesDialog({ c, rows, assets, names, decimalsOf, initial, newRule, onSave, onClose }: {
  c: FraudWatchCase;
  rows: FilterableTx[];
  assets: Assets;
  names: Names;
  decimalsOf: (assetId: string) => number;
  /** Opens straight into the editor on this rule. */
  initial: HideRule | null;
  newRule: () => HideRule;
  onSave: (next: FraudWatchCase) => void;
  onClose: () => void;
}) {
  const [editing, setEditing] = useState<HideRule | null>(initial);
  const tagsOf = (address: string) => names.label(address)?.tags ?? [];
  const rules = c.hideRules ?? [];
  const matches = (rule: HideRule) => new Set(rows.filter((row) => ruleMatches(rule, row, tagsOf)).map((row) => row.signature)).size;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
        {editing ? (
          <RuleEditor
            rule={editing}
            isNew={!rules.some((r) => r.id === editing.id)}
            rows={rows}
            assets={assets}
            names={names}
            decimalsOf={decimalsOf}
            matches={matches}
            onCancel={() => setEditing(null)}
            onSave={(rule) => {
              onSave(saveRule(c, rule));
              setEditing(null);
            }}
          />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Hide rules</DialogTitle>
              <DialogDescription>
                Transactions matching an enabled rule are left off the map, on every lane. Unhide one from the table to keep it visible anyway.
              </DialogDescription>
            </DialogHeader>
            {rules.length === 0 ? (
              <p className="text-sm text-muted-foreground">No rules yet.</p>
            ) : (
              <ul className="flex flex-col divide-y rounded-lg border">
                {rules.map((rule) => (
                  <li key={rule.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                    <Checkbox
                      checked={rule.enabled}
                      aria-label={`${rule.enabled ? "Disable" : "Enable"} ${rule.name}`}
                      onCheckedChange={() => onSave(saveRule(c, { ...rule, enabled: !rule.enabled }))}
                    />
                    <span className={cn("min-w-0 flex-1 truncate", !rule.enabled && "text-muted-foreground")}>{rule.name}</span>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{matches(rule).toLocaleString()} match</span>
                    <Button variant="ghost" size="icon-xs" aria-label={`Edit ${rule.name}`} onClick={() => setEditing(rule)}>
                      <PencilIcon />
                    </Button>
                    <Button variant="ghost" size="icon-xs" aria-label={`Delete ${rule.name}`} onClick={() => onSave(deleteRule(c, rule.id))}>
                      <Trash2Icon />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>
                Done
              </Button>
              <Button onClick={() => setEditing(newRule())}>
                <PlusIcon /> New rule
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Values seen in the loaded transactions, most frequent first, to pick conditions from. */
function seen<T>(rows: FilterableTx[], values: (row: FilterableTx) => readonly T[]): T[] {
  const counts = new Map<T, number>();
  for (const row of rows) for (const v of new Set(values(row))) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]).map(([v]) => v);
}

function RuleEditor({ rule, isNew, rows, assets, names, decimalsOf, matches, onCancel, onSave }: {
  rule: HideRule;
  isNew: boolean;
  rows: FilterableTx[];
  assets: Assets;
  names: Names;
  decimalsOf: (assetId: string) => number;
  matches: (rule: HideRule) => number;
  onCancel: () => void;
  onSave: (rule: HideRule) => void;
}) {
  const [draft, setDraft] = useState(rule);
  const assetChoices = seen(rows, (row) => movedAssets(row.summary));
  const [amountAsset, setAmountAsset] = useState(rule.amount?.assetId ?? assetChoices[0] ?? "");
  const [amountOp, setAmountOp] = useState<AmountOp>(rule.amount?.op ?? "lt");
  const [amountText, setAmountText] = useState(rule.amount ? formatBaseUnits(rule.amount.value, decimalsOf(rule.amount.assetId)).replaceAll(",", "") : "");
  const [addressText, setAddressText] = useState((rule.counterparties ?? []).join("\n"));

  const amountValue = amountText.trim() ? parseUnits(amountText, decimalsOf(amountAsset)) : null;
  // Nothing moves less than zero, so "less than 0" could never match.
  const amountInvalid = amountText.trim() !== "" && (amountValue === null || (amountOp === "lt" && amountValue === "0"));
  const counterparties = addressText.split(/[\s,]+/).filter(Boolean);
  const candidate: HideRule = {
    id: draft.id,
    name: draft.name.trim() || "Untitled rule",
    enabled: draft.enabled,
    ...(draft.kinds?.length ? { kinds: draft.kinds } : {}),
    ...(draft.onlyAssets?.length ? { onlyAssets: draft.onlyAssets } : {}),
    ...(amountValue && !amountInvalid && amountAsset ? { amount: { assetId: amountAsset, op: amountOp, value: amountValue } } : {}),
    ...(counterparties.length ? { counterparties } : {}),
    ...(draft.tags?.length ? { tags: draft.tags } : {}),
    ...(draft.protocols?.length ? { protocols: draft.protocols } : {}),
  };
  const empty = Object.keys(candidate).length === 3;
  const count = empty ? 0 : matches(candidate);
  const toggle = <K extends "kinds" | "onlyAssets" | "tags" | "protocols">(key: K, value: NonNullable<HideRule[K]>[number]) => {
    const list = (draft[key] ?? []) as (typeof value)[];
    setDraft({ ...draft, [key]: list.includes(value) ? list.filter((v) => v !== value) : [...list, value] });
  };

  const kindsSeen = new Set(seen<EffectKind>(rows, (row) => [row.summary.kind]));
  const tagChoices = seen(rows, (row) => row.addresses.flatMap((a) => names.label(a)?.tags ?? []));
  const protocolChoices = seen(rows, (row) => row.protocols);

  return (
    <>
      <DialogHeader>
        <DialogTitle>{isNew ? "New rule" : "Edit rule"}</DialogTitle>
        <DialogDescription>Every condition you set must match. Leave a condition empty to ignore it.</DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-4 text-sm">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Name
          <Input value={draft.name} maxLength={60} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
        </label>

        <Condition title="Transaction type is any of">
          <div className="flex flex-wrap gap-1">
            {KINDS.filter((k) => kindsSeen.has(k.kind) || draft.kinds?.includes(k.kind)).map((k) => (
              <Chip key={k.kind} on={draft.kinds?.includes(k.kind) ?? false} onClick={() => toggle("kinds", k.kind)}>
                {k.label}
              </Chip>
            ))}
          </div>
        </Condition>

        <Condition title="Only moves these assets" hint="For spam tokens: matches when every asset moved is selected.">
          <Choices
            items={assetChoices}
            selected={draft.onlyAssets ?? []}
            label={(a) => assetLabel(a, assets)}
            onToggle={(a) => toggle("onlyAssets", a)}
          />
        </Condition>

        <Condition
          title="Amount moved"
          hint={`Matches when the transaction moves this asset and every movement of it is ${AMOUNT_OPS.find((o) => o.op === amountOp)!.hint}. In or out counts the same.`}
        >
          <div className="flex gap-1">
            <select
              aria-label="Comparison"
              className="h-8 rounded-md border bg-transparent px-1 text-xs dark:bg-input/30"
              value={amountOp}
              onChange={(event) => setAmountOp(event.target.value as AmountOp)}
            >
              {AMOUNT_OPS.map((o) => (
                <option key={o.op} value={o.op}>
                  {o.label}
                </option>
              ))}
            </select>
            <Input
              inputMode="decimal"
              aria-label="Amount"
              aria-invalid={amountInvalid || undefined}
              placeholder="e.g. 0.001"
              className="h-8 min-w-0 flex-1"
              value={amountText}
              onChange={(event) => setAmountText(event.target.value)}
            />
            <select
              aria-label="Amount asset"
              className="h-8 max-w-36 truncate rounded-md border bg-transparent px-1 text-xs dark:bg-input/30"
              value={amountAsset}
              onChange={(event) => setAmountAsset(event.target.value)}
            >
              {assetChoices.map((a) => (
                <option key={a} value={a}>
                  {assetLabel(a, assets)}
                </option>
              ))}
            </select>
          </div>
          {amountInvalid && <p className="text-xs text-destructive">Not a valid amount for this asset.</p>}
        </Condition>

        <Condition title="Involves any of these addresses" hint="One per line.">
          <textarea
            aria-label="Addresses"
            rows={2}
            className="w-full rounded-md border bg-transparent px-2 py-1 font-mono text-xs dark:bg-input/30"
            value={addressText}
            onChange={(event) => setAddressText(event.target.value)}
          />
        </Condition>

        {tagChoices.length > 0 && (
          <Condition title="Involves an address tagged">
            <Choices items={tagChoices} selected={draft.tags ?? []} label={(t) => t} onToggle={(t) => toggle("tags", t)} />
          </Condition>
        )}

        {protocolChoices.length > 0 && (
          <Condition title="Uses any of these protocols">
            <Choices items={protocolChoices} selected={draft.protocols ?? []} label={protocolName} onToggle={(p) => toggle("protocols", p)} />
          </Condition>
        )}
      </div>
      <DialogFooter className="items-center">
        <span className="mr-auto text-xs text-muted-foreground" aria-live="polite">
          {empty ? "Set at least one condition." : `Matches ${count.toLocaleString()} transaction${count === 1 ? "" : "s"}`}
        </span>
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button disabled={empty || amountInvalid} onClick={() => onSave(candidate)}>
          Save rule
        </Button>
      </DialogFooter>
    </>
  );
}

function Condition({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="pb-1 text-xs text-muted-foreground">{title}</legend>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </fieldset>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn("rounded-full border px-2 py-0.5 text-xs", on ? "border-foreground bg-secondary" : "text-muted-foreground hover:text-foreground")}
    >
      {children}
    </button>
  );
}

/** Chips for the most common values; selected ones always show. */
function Choices<T extends string>({ items, selected, label, onToggle }: {
  items: T[];
  selected: T[];
  label: (item: T) => string;
  onToggle: (item: T) => void;
}) {
  const [all, setAll] = useState(false);
  const shown = all ? items : [...new Set([...selected, ...items.slice(0, SHOWN_CHOICES)])];
  return (
    <div className="flex flex-wrap gap-1">
      {shown.map((item) => (
        <Chip key={item} on={selected.includes(item)} onClick={() => onToggle(item)}>
          {label(item)}
        </Chip>
      ))}
      {items.length > SHOWN_CHOICES && (
        <Button variant="ghost" size="xs" onClick={() => setAll(!all)}>
          {all ? "Fewer" : `+${(items.length - SHOWN_CHOICES).toLocaleString()} more`}
        </Button>
      )}
    </div>
  );
}

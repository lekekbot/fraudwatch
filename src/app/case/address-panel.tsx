"use client";

import { useState } from "react";
import { ArrowLeftIcon, CopyIcon, ExternalLinkIcon, GitBranchPlusIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { AddressState } from "@/lib/case/address-state";
import { describeStorageError, getDb } from "@/lib/db/db";
import { saveAddressLabel } from "@/lib/db/address-labels";
import { type AddressLabel, MAX_LABEL_NAME, MAX_LABEL_NOTE, MAX_TAG } from "@/lib/labels/labels";
import type { RegistryEntry } from "@/lib/protocols/registry";
import { PanelSection } from "./panel";

const STATE_TEXT: Record<AddressState, string> = {
  PRIMARY: "Primary wallet. Its full history in the case range is loaded.",
  MAPPED: "Mapped wallet. Its full history in its range is loaded.",
  OBSERVED: "Observed counterparty. Only the transactions it shares with mapped wallets are shown; its own history isn't loaded.",
  INFRASTRUCTURE: "Program or protocol address. It's never mapped as a wallet.",
};

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success("Address copied.");
  } catch {
    toast.error("Clipboard unavailable.");
  }
}

/**
 * Inspector for one address: what the case knows about it, and the user's own
 * name, tags and note. A name overrides the registry label on screen only.
 */
export function AddressPanel({
  caseId,
  address,
  state,
  label,
  entry,
  transactionCount,
  onBack,
}: {
  caseId: string;
  address: string;
  state: AddressState;
  label: AddressLabel | undefined;
  entry: RegistryEntry | undefined;
  /** Transactions of the selected wallet that involve this address. */
  transactionCount?: number;
  onBack?: () => void;
}) {
  const [name, setName] = useState(label?.name ?? "");
  const [note, setNote] = useState(label?.note ?? "");
  const [tagDraft, setTagDraft] = useState("");
  const tags = label?.tags ?? [];

  async function save(patch: Partial<AddressLabel>) {
    try {
      await saveAddressLabel(getDb(), { caseId, address, name, note, tags, ...patch });
    } catch (err) {
      toast.error(describeStorageError(err));
    }
  }

  function addTags(text: string) {
    const added = text.split(",").map((t) => t.trim()).filter(Boolean);
    setTagDraft("");
    if (added.length > 0) void save({ tags: [...tags, ...added] });
  }

  return (
    <>
      <PanelSection
        title={state === "OBSERVED" ? "Observed address" : state === "INFRASTRUCTURE" ? "Infrastructure" : "Wallet"}
        action={
          <span className="flex">
            {onBack && (
              <Button variant="ghost" size="icon-xs" aria-label="Back" title="Back" onClick={onBack}>
                <ArrowLeftIcon />
              </Button>
            )}
            <Button variant="ghost" size="icon-xs" aria-label="Copy address" title="Copy address" onClick={() => copy(address)}>
              <CopyIcon />
            </Button>
            <a
              href={`https://solscan.io/account/${address}`}
              target="_blank"
              rel="noreferrer noopener"
              aria-label="Open in explorer"
              title="Open in explorer"
              className={buttonVariants({ variant: "ghost", size: "icon-xs" })}
            >
              <ExternalLinkIcon />
            </a>
          </span>
        }
      >
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant={state === "OBSERVED" ? "outline" : "secondary"}>{state}</Badge>
          {entry && (
            <Badge variant="outline" title={`${entry.protocolName} · ${entry.category} · ${entry.role}`}>
              {entry.protocolName}
            </Badge>
          )}
        </div>
        <p className="font-mono text-xs break-all text-muted-foreground">{address}</p>
        {entry ? (
          <p className="text-xs text-muted-foreground">
            Registry: {entry.label} ({entry.role}, {entry.category.replace("_", " ")})
            {label?.name && " — your name is shown instead."}
          </p>
        ) : (
          state === "INFRASTRUCTURE" && <p className="text-xs text-muted-foreground">Unknown program: not in the protocol registry.</p>
        )}
        <p className="text-xs text-muted-foreground">{STATE_TEXT[state]}</p>
        {transactionCount !== undefined && (
          <p className="text-xs text-muted-foreground">
            In {transactionCount.toLocaleString()} of this wallet&apos;s transactions.
          </p>
        )}
        {state === "OBSERVED" && (
          <Button variant="outline" size="sm" disabled title="Mapping observed wallets arrives in Sprint 07">
            <GitBranchPlusIcon />
            Map wallet (Sprint 07)
          </Button>
        )}
      </PanelSection>

      <PanelSection title="Your label">
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Name
            <Input
              value={name}
              maxLength={MAX_LABEL_NAME}
              placeholder={entry?.label ?? "e.g. Suspected cash-out"}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
              onBlur={() => name !== (label?.name ?? "") && void save({})}
            />
          </label>
          <div className="flex flex-col gap-1 text-xs text-muted-foreground">
            <label htmlFor={`tags-${address}`}>Tags</label>
            {tags.length > 0 && (
              <ul className="flex flex-wrap gap-1">
                {tags.map((tag) => (
                  <li key={tag}>
                    <Badge variant="secondary" className="gap-0.5 pr-0.5">
                      {tag}
                      <button
                        type="button"
                        aria-label={`Remove tag ${tag}`}
                        className="rounded-sm p-0.5 hover:bg-muted"
                        onClick={() => void save({ tags: tags.filter((t) => t !== tag) })}
                      >
                        <XIcon className="size-3" />
                      </button>
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
            <Input
              id={`tags-${address}`}
              value={tagDraft}
              maxLength={MAX_TAG * 4}
              placeholder="Add tag, press Enter"
              onChange={(event) => {
                const value = event.target.value;
                if (value.endsWith(",")) addTags(value);
                else setTagDraft(value);
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                addTags(tagDraft);
              }}
              onBlur={() => tagDraft.trim() && addTags(tagDraft)}
            />
          </div>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Note
            <Textarea
              value={note}
              maxLength={MAX_LABEL_NOTE}
              placeholder="What you know about this address"
              onChange={(event) => setNote(event.target.value)}
              onBlur={() => note !== (label?.note ?? "") && void save({})}
            />
          </label>
          <p className="text-xs text-muted-foreground">Saved in this browser, for this case only.</p>
        </div>
      </PanelSection>
    </>
  );
}

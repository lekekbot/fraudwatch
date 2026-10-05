"use client";

import { XIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Names } from "@/lib/labels/labels";
import { registry } from "@/lib/protocols/registry";
import { PanelSection } from "../panel";

/**
 * Inspector for an entity node: one protocol or service standing in for several of its registry addresses.
 * Every real address stays listed and clickable; nothing is merged for good.
 */
export function EntityPanel({
  protocolId,
  addresses,
  names,
  onSelectAddress,
  onExpand,
  onOpenInTimeline,
  onClose,
}: {
  protocolId: string;
  /** The real addresses the map collapsed into this node. */
  addresses: readonly string[];
  names: Names;
  onSelectAddress: (address: string) => void;
  onExpand: () => void;
  onOpenInTimeline: () => void;
  onClose: () => void;
}) {
  const protocol = registry.protocols.get(protocolId);
  return (
    <PanelSection
      title="Service"
      collapsible
      action={
        <Button variant="ghost" size="icon-xs" aria-label="Close" onClick={onClose}>
          <XIcon />
        </Button>
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{protocol?.name ?? protocolId}</span>
        {protocol && <Badge variant="outline">{protocol.category.replaceAll("_", " ")}</Badge>}
      </div>
      <p className="text-xs text-muted-foreground">
        {addresses.length === 1 ? "The protocol registry lists this address under the service." : `The map draws these ${addresses.length.toLocaleString()} registry addresses as one node.`}
      </p>
      <ul className="flex flex-col gap-1 text-xs">
        {addresses.map((address) => (
          <li key={address} className="flex min-w-0 items-center gap-2">
            <button type="button" title={address} onClick={() => onSelectAddress(address)} className="min-w-0 truncate text-left underline-offset-4 hover:underline">
              {names.of(address)}
            </button>
            <span className="shrink-0 text-muted-foreground">{registry.lookup(address)?.role.replaceAll("_", " ")}</span>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" className="flex-1" onClick={onOpenInTimeline}>
          Open in Timeline
        </Button>
        {addresses.length > 1 && (
          <Button variant="outline" size="sm" className="flex-1" onClick={onExpand}>
            Show each on map
          </Button>
        )}
      </div>
    </PanelSection>
  );
}

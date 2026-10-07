import { toast } from "sonner";
import type { Names } from "@/lib/labels/labels";
import { cn } from "cn";

/** Copies to the clipboard and says so: "<what> copied." */
export async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${what} copied.`);
  } catch {
    toast.error("Clipboard unavailable.");
  }
}

/** An address that opens in the inspector, where it can be labelled. */
export function AddressButton({ address, names, onSelect, className }: { address: string; names: Names; onSelect: (address: string) => void; className?: string }) {
  const known = names.known(address);
  return (
    <button
      type="button"
      title={address}
      onClick={() => onSelect(address)}
      className={cn("truncate text-left text-xs underline-offset-4 hover:underline", !known && "font-mono", className)}
    >
      {known ?? names.of(address, 6)}
    </button>
  );
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</h4>
      {children}
    </section>
  );
}

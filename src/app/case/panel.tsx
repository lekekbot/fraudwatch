import { cn } from "cn";

/** A docked side panel of the case workspace, scrolling independently of the canvas. */
export function SidePanel({ side, label, className, children }: {
  side: "left" | "right";
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <aside
      aria-label={label}
      className={cn(
        "flex shrink-0 flex-col overflow-y-auto bg-background",
        side === "left" ? "w-64 border-r" : "w-80 border-l",
        className,
      )}
    >
      {children}
    </aside>
  );
}

export function PanelSection({ title, action, children }: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2 border-b p-3">
      <div className="flex min-h-6 items-center justify-between gap-2">
        <h2 className="text-xs font-medium text-muted-foreground">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/**
 * The Trace Graph: an investigator-built, step-by-step path of where value
 * went, on a canvas they arrange (docs/sprints/trace-graph/). The model and
 * movement index exist in src/lib/trace/; the canvas and editing come next,
 * so for now the tab says so.
 */
export function TraceView() {
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
      <p className="font-medium text-foreground">Trace Graph</p>
      <p className="max-w-md">Follow where value went, one observed movement at a time, on a canvas you arrange with your own notes and shapes.</p>
      <p className="max-w-md">Coming soon: the canvas is being built. Nothing can be traced here yet.</p>
    </div>
  );
}

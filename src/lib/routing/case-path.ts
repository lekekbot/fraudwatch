export type CaseView = "timeline" | "graph" | "table" | "trace";

const VIEWS: CaseView[] = ["timeline", "graph", "table", "trace"];

export function parseCasePath(pathname: string): { caseId: string; view: CaseView; wallet: string | null; traceId: string | null } {
  const [, caseId = "", view, child] = pathname.split("/").filter(Boolean);
  const validView = VIEWS.includes(view as CaseView) ? (view as CaseView) : "timeline";
  return { caseId, view: validView, wallet: validView === "table" && child ? child : null, traceId: validView === "trace" && child ? child : null };
}

export function buildCasePath(caseId: string, view: CaseView, child?: string | null): string {
  return `/case/${encodeURIComponent(caseId)}/${view}${(view === "table" || view === "trace") && child ? `/${encodeURIComponent(child)}` : ""}`;
}

/** Route segments after /case: a case id, a view, and an optional table wallet or trace id. */
export function isCaseRoute(segments: readonly string[]): boolean {
  const [caseId, view, child, extra] = segments;
  return Boolean(caseId) && VIEWS.includes(view as CaseView) && extra === undefined && (!child || view === "table" || view === "trace");
}

/** Where a link to a case opens, by the start view preference: a view, or the one last open ("last"). */
export function casePathFor(c: { id: string; lastView?: CaseView }, startView: CaseView | "last"): string {
  const view = startView === "last" ? (c.lastView && VIEWS.includes(c.lastView) ? c.lastView : "timeline") : startView;
  return buildCasePath(c.id, view);
}

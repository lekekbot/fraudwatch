export type CaseView = "timeline" | "graph" | "table" | "trace";

const VIEWS: CaseView[] = ["timeline", "graph", "table", "trace"];

export function parseCasePath(pathname: string): { caseId: string; view: CaseView; wallet: string | null } {
  const [, caseId = "", view, wallet] = pathname.split("/").filter(Boolean);
  const validView = VIEWS.includes(view as CaseView) ? (view as CaseView) : "timeline";
  return { caseId, view: validView, wallet: validView === "table" && wallet ? wallet : null };
}

export function buildCasePath(caseId: string, view: CaseView, wallet?: string | null): string {
  return `/case/${encodeURIComponent(caseId)}/${view}${view === "table" && wallet ? `/${encodeURIComponent(wallet)}` : ""}`;
}

/** Route segments after /case: a case id, a view, and a wallet only on the table view. */
export function isCaseRoute(segments: readonly string[]): boolean {
  const [caseId, view, wallet, extra] = segments;
  return Boolean(caseId) && VIEWS.includes(view as CaseView) && extra === undefined && (!wallet || view === "table");
}

/** Where a link to a case opens, by the start view preference: a view, or the one last open ("last"). */
export function casePathFor(c: { id: string; lastView?: CaseView }, startView: CaseView | "last"): string {
  const view = startView === "last" ? (c.lastView && VIEWS.includes(c.lastView) ? c.lastView : "timeline") : startView;
  return buildCasePath(c.id, view);
}

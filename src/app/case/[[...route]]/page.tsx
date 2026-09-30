import { notFound } from "next/navigation";
import { CaseShell } from "../case-shell";

export default async function Page({ params }: PageProps<"/case/[[...route]]">) {
  const { route } = await params;
  const [caseId, view, wallet, extra] = route ?? [];
  if (!caseId || !(["timeline", "graph", "table"].includes(view)) || extra || (wallet && view !== "table")) notFound();
  return <CaseShell />;
}

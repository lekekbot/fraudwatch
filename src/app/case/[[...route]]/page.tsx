import { notFound } from "next/navigation";
import { isCaseRoute } from "@/lib/routing/case-path";

// The workspace lives in ../layout.tsx so it survives view changes; this only rejects bad paths.
export default async function Page({ params }: PageProps<"/case/[[...route]]">) {
  const { route } = await params;
  if (!isCaseRoute(route ?? [])) notFound();
  return null;
}

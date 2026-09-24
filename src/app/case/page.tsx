import { Suspense } from "react";
import { CaseShell } from "./case-shell";

export default function Page() {
  return (
    <Suspense>
      <CaseShell />
    </Suspense>
  );
}

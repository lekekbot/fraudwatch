import { Suspense } from "react";
import { NewCaseForm } from "./new-case-form";

export default function Page() {
  return (
    <Suspense>
      <NewCaseForm />
    </Suspense>
  );
}

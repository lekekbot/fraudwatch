import { Suspense } from "react";
import { MapStartup } from "./map-startup";

export default function Page() {
  return (
    <Suspense>
      <MapStartup />
    </Suspense>
  );
}

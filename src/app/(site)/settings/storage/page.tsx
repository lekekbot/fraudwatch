import { redirect } from "next/navigation";

/** Storage became part of Settings. */
export default function Page() {
  redirect("/settings/");
}

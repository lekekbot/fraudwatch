import { redirect } from "next/navigation";

/** Preferences became part of Settings. */
export default function Page() {
  redirect("/settings/");
}

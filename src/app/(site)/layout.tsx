import { AppHeader } from "@/components/app-header";

/** Everything except the case workspace: header plus a centred column. */
export default function SiteLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <AppHeader />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">{children}</main>
    </>
  );
}

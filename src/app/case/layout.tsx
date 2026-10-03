import { CaseShell } from "./case-shell";

export default function CaseLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <CaseShell />
    </>
  );
}

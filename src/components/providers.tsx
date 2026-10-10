import { ThemeSync } from "@/components/theme-sync";
import { Toaster } from "@/components/ui/sonner";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ThemeSync />
      {children}
      <Toaster richColors position="bottom-right" />
    </>
  );
}

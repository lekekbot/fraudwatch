"use client";

import { useEffect } from "react";
import { usePreferences } from "@/hooks/use-preferences";
import { isDark, THEME_MIRROR_KEY } from "@/lib/preferences/theme";

/**
 * Applies the theme preference to <html>, following the OS while it's
 * "system", and keeps the pre-paint script's copy in step.
 */
export function ThemeSync() {
  const prefs = usePreferences();
  const theme = prefs.get("appearance.theme");
  const ready = prefs.status !== "loading";
  useEffect(() => {
    // Until the stored preference is read, the pre-paint script's choice stands.
    if (!ready) return;
    const os = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => document.documentElement.classList.toggle("dark", isDark(theme, os.matches));
    apply();
    try {
      localStorage.setItem(THEME_MIRROR_KEY, theme);
    } catch {
      // Without localStorage the theme still applies; only the first paint may differ.
    }
    os.addEventListener("change", apply);
    return () => os.removeEventListener("change", apply);
  }, [theme, ready]);
  return null;
}

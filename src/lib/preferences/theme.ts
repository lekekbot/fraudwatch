import type { SettingValue } from "./schema";

export type ThemeChoice = SettingValue<"appearance.theme">;

/**
 * A copy of the theme preference, read only by the pre-paint script: IndexedDB
 * is async, so the authoritative value arrives after first paint. Written
 * whenever the preference is applied; never read as the source of truth.
 */
export const THEME_MIRROR_KEY = "fraudwatch:theme";

/** Runs in <head> before paint: dark class from the mirror, or the OS when it's missing or "system". */
export const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem("${THEME_MIRROR_KEY}");var d=t==="dark"||(t!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d)}catch(e){}})()`;

export const isDark = (choice: ThemeChoice, osDark: boolean) => choice === "dark" || (choice === "system" && osDark);

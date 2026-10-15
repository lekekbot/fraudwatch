/**
 * Icons for investigation diagrams, placed on the trace canvas like shapes and
 * drawn with Path2D (so they appear in PNG snapshots too). Path data from
 * Lucide (https://lucide.dev, ISC licence), 24-unit grid, 2-unit stroke.
 */
export const ICONS = {
  wallet: { label: "Wallet", paths: ["M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1","M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"] },
  exchange: { label: "Exchange", paths: ["M10 18v-7","M11.119 2.205a2 2 0 0 1 1.762 0l7.84 3.846A.5.5 0 0 1 20.5 7h-17a.5.5 0 0 1-.22-.949z","M14 18v-7","M18 18v-7","M3 22h18","M6 18v-7"] },
  company: { label: "Company or service", paths: ["M10 12h4","M10 8h4","M14 21v-3a2 2 0 0 0-4 0v3","M6 10H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-2","M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16"] },
  person: { label: "Person", paths: ["M7 8a5 5 0 1 0 10 0a5 5 0 1 0 -10 0","M20 21a8 8 0 0 0-16 0"] },
  attacker: { label: "Attacker", paths: ["m12.5 17-.5-1-.5 1h1z","M15 22a1 1 0 0 0 1-1v-1a2 2 0 0 0 1.56-3.25 8 8 0 1 0-11.12 0A2 2 0 0 0 8 20v1a1 1 0 0 0 1 1z","M14 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0","M8 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"] },
  phishing: { label: "Phishing", paths: ["M6.5 12c.94-3.46 4.94-6 8.5-6 3.56 0 6.06 2.54 7 6-.94 3.47-3.44 6-7 6s-7.56-2.53-8.5-6Z","M18 12v.5","M16 17.93a9.77 9.77 0 0 1 0-11.86","M7 10.67C7 8 5.58 5.97 2.73 5.5c-1 1.5-1 5 .23 6.5-1.24 1.5-1.24 5-.23 6.5C5.58 18.03 7 16 7 13.33","M10.46 7.26C10.2 5.88 9.17 4.24 8 3h5.8a2 2 0 0 1 1.98 1.67l.23 1.4","m16.01 17.93-.23 1.4A2 2 0 0 1 13.8 21H9.5a5.96 5.96 0 0 0 1.49-3.98"] },
  mixer: { label: "Mixer", paths: ["m18 14 4 4-4 4","m18 2 4 4-4 4","M2 18h1.973a4 4 0 0 0 3.3-1.7l5.454-8.6a4 4 0 0 1 3.3-1.7H22","M2 6h1.972a4 4 0 0 1 3.6 2.2","M22 18h-6.041a4 4 0 0 1-3.3-1.8l-.359-.45"] },
  bridge: { label: "Bridge", paths: ["M10 9.728V16","M14 9.728V16","M18 20V4","m22 11-4-4A7.5 7.5 0 0 1 6 7l-4 4","M22 16H2","M6 20V4"] },
  tokens: { label: "Tokens", paths: ["M13.744 17.736a6 6 0 1 1-7.48-7.48","M15 6h1v4","m6.134 14.768.866-.5 2 3.464","M10 8a6 6 0 1 0 12 0a6 6 0 1 0 -12 0"] },
  website: { label: "Website", paths: ["M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0","M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20","M2 12h20"] },
  infrastructure: { label: "Infrastructure", paths: ["M4 2h16a2 2 0 0 1 2 2v4a2 2 0 0 1 -2 2h-16a2 2 0 0 1 -2 -2v-4a2 2 0 0 1 2 -2Z","M4 14h16a2 2 0 0 1 2 2v4a2 2 0 0 1 -2 2h-16a2 2 0 0 1 -2 -2v-4a2 2 0 0 1 2 -2Z","M6 6L6.01 6","M6 18L6.01 18"] },
  frozen: { label: "Frozen funds", paths: ["M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-7a2 2 0 0 1 2 -2Z","M7 11V7a5 5 0 0 1 10 0v4"] },
  flag: { label: "Flag", paths: ["M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 7.333 2q2 0 3.067-.8A1 1 0 0 1 20 4v10a1 1 0 0 1-.4.8A6 6 0 0 1 16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.528"] },
  warning: { label: "Warning", paths: ["m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3","M12 9v4","M12 17h.01"] },
} as const;

export type IconKey = keyof typeof ICONS;
export const ICON_KEYS = Object.keys(ICONS) as IconKey[];
export const isIconKey = (value: unknown): value is IconKey => typeof value === "string" && value in ICONS;

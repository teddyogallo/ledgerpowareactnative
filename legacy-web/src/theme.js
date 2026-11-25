// Ledger Sawa themes.
//
// Light mode is not the dark palette inverted. Two things had to change:
//
//   1. Gold (#D4AF37) as a *text* colour on white sits at roughly 2.4:1
//      contrast - well under the 4.5:1 needed to be readable. So in light mode
//      the deep blue takes the action role, and gold stays a highlight. That is
//      also closer to the brand kit, which describes gold as an accent for
//      milestones rather than the primary colour.
//   2. Everything else is a straight palette swap through CSS custom
//      properties, so a change repaints instantly without re-rendering React.

const DARK = {
  name: "Dark",
  bg: "#0B1A2D",
  surface: "#14273F",
  surface2: "#102134",
  sunken: "#071322",
  border: "#1E3A5C",
  borderSoft: "#1A3350",
  text: "#FFFFFF",
  textDim: "#A8BCD4",
  textFaint: "#6E86A4",
  textFaintest: "#4E6480",
  accent: "#D4AF37",
  accentInk: "#0B1A2D",
  positive: "#4FA8D8",
  negative: "#E08585",
  warn: "#E0B585",
  info: "#3B82C4",
  income: "#4FA8D8",
  adminBg: "#221A33",
  adminBorder: "#4A3D66",
  adminText: "#B89BD6",
  shadow: "none",
};

const LIGHT = {
  name: "Light",
  bg: "#F2F5F9",         // soft off-white; pure white glares on a phone
  surface: "#FFFFFF",
  surface2: "#F8FAFC",
  sunken: "#E7ECF3",
  border: "#D9E1EC",
  borderSoft: "#EAEFF5",
  text: "#0B1A2D",       // the brand navy, for continuity
  textDim: "#42556E",
  textFaint: "#5F7089",
  textFaintest: "#93A2B5",
  accent: "#15497A",     // deep blue takes the action role here
  accentInk: "#FFFFFF",
  positive: "#1F7A52",   // green reads as "good" more clearly on white
  negative: "#B3392C",
  warn: "#9A6B12",
  info: "#15497A",
  income: "#1F7A52",
  adminBg: "#F1EDF8",
  adminBorder: "#CFC2E4",
  adminText: "#5B4680",
  shadow: "0 1px 2px rgba(11,26,45,0.06)",
};

export const THEMES = { dark: DARK, light: LIGHT };
const STORAGE_KEY = "ledger-sawa-theme";

// "system" follows the device setting, which is what most people expect by
// default. An explicit choice overrides it and is remembered.
export function getThemePreference() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === "light" || saved === "dark" ? saved : "system";
  } catch {
    return "system";
  }
}

export function resolveTheme(pref) {
  if (pref === "light" || pref === "dark") return pref;
  try {
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function setThemePreference(pref) {
  try {
    if (pref === "system") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, pref);
  } catch { /* private mode - the choice just won't persist */ }
  applyTheme();
}

export function applyTheme() {
  const key = resolveTheme(getThemePreference());
  const t = THEMES[key];
  const root = document.documentElement;
  Object.entries(t).forEach(([k, v]) => {
    if (k === "name") return;
    root.style.setProperty(`--ls-${k}`, v);
  });
  root.style.setProperty("color-scheme", key);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", t.bg);
  return key;
}

// Repaint when the device switches, but only while following the system.
export function watchSystemTheme() {
  try {
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const handler = () => { if (getThemePreference() === "system") applyTheme(); };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  } catch {
    return () => {};
  }
}

// Note on category tints: components append an 8-digit hex alpha (e.g. #8B5E3426)
// rather than reading a per-theme value. Alpha composites against whatever
// background is actually behind it, so the same value reads correctly on both
// palettes - and unlike a computed value it updates instantly when the theme
// changes, with no re-render needed.

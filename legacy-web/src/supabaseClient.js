import { createClient } from "@supabase/supabase-js";

const rawUrl = import.meta.env.VITE_SUPABASE_URL;
const rawKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Values Vercel pre-fills as examples. Deploying with these produces a blank
// page and no visible error, which is very hard to diagnose — so they are
// treated as "not configured" and reported on screen instead.
const PLACEHOLDERS = [
  "your-project-ref", "your-anon-key", "your-publishable-key",
  "abcde.supabase.co", "example.supabase.co",
];

function diagnose(url, key) {
  if (!url && !key) return "Neither VITE_SUPABASE_URL nor VITE_SUPABASE_ANON_KEY is set.";
  if (!url) return "VITE_SUPABASE_URL is not set.";
  if (!key) return "VITE_SUPABASE_ANON_KEY is not set.";
  const lower = url.toLowerCase();
  if (PLACEHOLDERS.some((p) => lower.includes(p))) {
    return `VITE_SUPABASE_URL is still an example value (${url}). Replace it with your real project URL.`;
  }
  if (PLACEHOLDERS.some((p) => key.toLowerCase().includes(p))) {
    return "VITE_SUPABASE_ANON_KEY is still an example value. Replace it with your real publishable key.";
  }
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(url.trim())) {
    return `VITE_SUPABASE_URL doesn't look like a Supabase project URL (${url}). It should be https://something.supabase.co`;
  }
  if (key.trim().length < 20) {
    return "VITE_SUPABASE_ANON_KEY looks too short to be a real key.";
  }
  return null;
}

export const configError = diagnose(rawUrl, rawKey);

// Only build a client if the configuration is sane. Calling createClient with a
// bad URL throws at import time, which blanks the page before React can render
// anything the user could read.
export const supabase = configError
  ? null
  : createClient(rawUrl.trim().replace(/\/$/, ""), rawKey.trim());

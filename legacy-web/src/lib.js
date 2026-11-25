import {
  Home, GraduationCap, Stethoscope, ShoppingBag, Popcorn, Shirt, BookOpen,
  UserCheck, ShoppingCart, Store, Zap, Wifi, MoreHorizontal, Car, Plane,
  Droplet, Phone, Gift, Wrench, Heart, Briefcase,
} from "lucide-react";

export const ICONS = {
  home: Home, school: GraduationCap, health: Stethoscope, bag: ShoppingBag,
  fun: Popcorn, shirt: Shirt, book: BookOpen, person: UserCheck, cart: ShoppingCart,
  store: Store, zap: Zap, wifi: Wifi, more: MoreHorizontal, car: Car, plane: Plane,
  water: Droplet, phone: Phone, gift: Gift, tools: Wrench, heart: Heart, work: Briefcase,
};
export const ICON_KEYS = Object.keys(ICONS);
export const iconFor = (k) => ICONS[k] || MoreHorizontal;

export const PALETTE = [
  "#8B5E34", "#3B6E71", "#7A8B4A", "#8A6B9C", "#5C8B5A", "#4A7B9C",
  "#B89B2A", "#3D8A8A", "#A13D3D", "#6B5A9C", "#B8863B", "#3D6B8A", "#5A5A5A",
];

// Month attribution must follow the user's local calendar, not UTC. Slicing the
// stored ISO string put a 23:30 entry on 31 August into September for anyone
// east of Greenwich, so the displayed date and the month it counted in disagreed.
export const monthKey = (d) => {
  if (!d) return "";
  if (typeof d === "string" && d.length <= 7) return d;          // already YYYY-MM
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return String(d).slice(0, 7);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
};

// A datetime-local input gives "YYYY-MM-DDTHH:MM" with no zone. Sending that
// straight to a timestamptz column makes Postgres read it as UTC, shifting every
// entry by the user's offset. Convert to a real instant first.
export function localToISO(dtLocal) {
  if (!dtLocal) return new Date().toISOString();
  const d = new Date(dtLocal);
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}
export const monthLabel = (k) => {
  const [y, m] = k.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
};
// Currency is set once when a ledger loads, rather than threaded through every
// component. Defaults to KES.
let CURRENCY = "KES";
export function setCurrency(code) {
  if (code && /^[A-Z]{3}$/.test(code)) CURRENCY = code;
}
export const getCurrency = () => CURRENCY;
export const CURRENCIES = ["KES", "UGX", "TZS", "RWF", "NGN", "ZAR", "GHS", "USD", "EUR", "GBP"];
export const fmt = (n) => {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency", currency: CURRENCY, maximumFractionDigits: 0,
    }).format(Number(n) || 0);
  } catch {
    return `${CURRENCY} ${Math.round(Number(n) || 0).toLocaleString()}`;
  }
};
export const nowDT = () => {
  const d = new Date(), p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
// Populating an edit form must show the user's local time, not the stored UTC
// instant, or opening and re-saving an entry silently shifts it.
export function toDTLocal(s) {
  if (!s) return nowDT();
  if (typeof s === "string" && s.length === 10) return `${s}T00:00`;
  const d = new Date(s);
  if (isNaN(d.getTime())) return nowDT();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
export const fmtDT = (s) => {
  const d = new Date(s);
  return isNaN(d) ? s : d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
};
export const monthSeq = (mk) => { const [y, m] = mk.split("-").map(Number); return y * 12 + (m - 1); };

const MN = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// Terms are rows in the `terms` table — a household can define none, two,
// three, four, however many. Each term is a set of calendar months.
export function termForMonth(mk, terms) {
  const [y, m] = mk.split("-").map(Number);
  const list = (terms || []).filter((t) => (t.months || []).length);
  const t = list.find((x) => x.months.includes(m));
  if (!t) return null;
  const first = Math.min(...t.months), last = Math.max(...t.months);
  return { id: t.id, name: t.name, label: `${t.name} (${MN[first - 1]}–${MN[last - 1]} ${y})` };
}

// Chronological index so per-term budgets carry forward correctly across terms.
// Terms are ranked by the month they begin in, then numbered year by year, so
// the count between any two terms is the real number of terms elapsed.
export function termSeq(mk, terms) {
  const [y, m] = mk.split("-").map(Number);
  const list = (terms || []).filter((t) => (t.months || []).length)
    .slice().sort((a, b) => Math.min(...a.months) - Math.min(...b.months));
  if (!list.length) return null;
  const rank = list.findIndex((t) => t.months.includes(m));
  if (rank === -1) return null;
  return y * list.length + rank;
}

// A term wrapping past December, or a month claimed by two terms, breaks the
// ordering above. Surfaced in the UI rather than silently producing bad numbers.
export function termProblems(terms) {
  const list = (terms || []).filter((t) => (t.months || []).length);
  const problems = [];
  const seen = new Map();
  list.forEach((t) => t.months.forEach((m) => {
    if (seen.has(m)) problems.push(`${MN[m - 1]} is in both ${seen.get(m)} and ${t.name}.`);
    else seen.set(m, t.name);
  }));
  list.forEach((t) => {
    if (t.months.includes(12) && t.months.some((m) => m <= 6)) {
      problems.push(`${t.name} runs across the end of the year, which isn't supported.`);
    }
  });
  return problems;
}

// ---- Offline write queue ----
// Writes that fail because the device is offline are stored locally and
// replayed when connectivity returns. Reads still require a connection.
export const QUEUE_KEY = "expense-tracker-pending-writes";

export function readQueue() {
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]"); } catch { return []; }
}
export function writeQueue(items) {
  try { localStorage.setItem(QUEUE_KEY, JSON.stringify(items)); } catch { /* storage full or blocked */ }
}
export function enqueue(op) {
  const q = readQueue();
  q.push({ ...op, queuedAt: Date.now() });
  writeQueue(q);
  return q.length;
}
export function clearQueue() { writeQueue([]); }

// A spreadsheet treats a cell starting with = + - or @ as a formula, regardless
// of quoting. Exported notes and category names are user-typed, so without this
// an entry named =HYPERLINK(...) becomes a live formula in Excel or Sheets.
function csvSafe(v) {
  const str = String(v ?? "");
  return /^[=+\-@\t\r]/.test(str) ? `'${str}` : str;
}

// Escapes text going into the printable report. Every value here is user-typed -
// household names, categories, notes - and the report is rendered as HTML in a
// new window. An administrator viewing another household's report would
// otherwise execute whatever that household put in its name.
function htmlSafe(v) {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function toCSV(rows) {
  const headers = ["Date", "Category", "For", "Paid by", `Amount (${CURRENCY})`, "Note", "Reference"];
  const esc = (v) => `"${csvSafe(v).replace(/"/g, '""')}"`;
  const lines = [headers.map(esc).join(",")];
  rows.forEach((r) => {
    lines.push([
      fmtDT(r.date), r.category, r.recipient || "", r.paid_by_label || "",
      Number(r.amount), r.note || "", r.reference || "",
    ].map(esc).join(","));
  });
  return lines.join("\n");
}

export function downloadFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Printable HTML report — opens the print dialog so the user can "Save as PDF".
// Avoids shipping a PDF library for something the browser already does well.
export function printReport({ householdName, monthName, rows, byCategory, byPayer, total }) {
  const w = window.open("", "_blank");
  if (!w) return false;
  const rowsHtml = rows.map((r) => `<tr>
    <td>${htmlSafe(fmtDT(r.date))}</td><td>${htmlSafe(r.category)}</td><td>${htmlSafe(r.recipient)}</td>
    <td>${htmlSafe(r.paid_by_label)}</td>
    <td class="num">${htmlSafe(fmt(r.amount))}</td><td>${htmlSafe(r.note)}</td>
    <td>${htmlSafe(r.reference)}</td></tr>`).join("");
  const payerHtml = (byPayer || []).length > 1
    ? `<h2>Who paid</h2><table>${byPayer.map((p) => `<tr><td>${htmlSafe(p.label)} (${htmlSafe(p.count)})</td><td class="num">${htmlSafe(fmt(p.total))}</td></tr>`).join("")}</table>`
    : "";
  const catHtml = byCategory.map((c) => `<tr><td>${htmlSafe(c.name)}</td><td class="num">${htmlSafe(fmt(c.total))}</td></tr>`).join("");
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${htmlSafe(householdName)} - ${htmlSafe(monthName)}</title>
  <style>
    body{font-family:Georgia,serif;padding:32px;color:#111}
    h1{font-size:20px;margin:0 0 4px}h2{font-size:14px;margin:24px 0 8px;text-transform:uppercase;letter-spacing:.08em;color:#555}
    table{width:100%;border-collapse:collapse;font-size:12px}
    th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #ddd}
    th{background:#f4f4f4}.num{text-align:right;font-variant-numeric:tabular-nums}
    .total{font-size:16px;font-weight:bold;margin-top:16px}
  </style></head><body>
  <h1>${htmlSafe(householdName)}</h1><div>${htmlSafe(monthName)}</div>
  <h2>By category</h2><table>${catHtml}</table>
  <div class="total">Total: ${htmlSafe(fmt(total))}</div>
  ${payerHtml}
  <h2>All entries</h2>
  <table><tr><th>Date</th><th>Category</th><th>For</th><th>Paid by</th><th>Amount</th><th>Note</th><th>Reference</th></tr>${rowsHtml}</table>
  </body></html>`);
  w.document.close();
  setTimeout(() => w.print(), 300);
  return true;
}

// ---- Amount parsing ----
// parseFloat is too permissive for money: it accepts Infinity, silently
// truncates "12,000" to 12, and happily returns values a numeric column cannot
// store. Returns null for anything that isn't a sane amount, so callers can
// show an error rather than writing nonsense.
export const MAX_AMOUNT = 1e12; // a trillion - far beyond any household figure

export function parseAmount(raw) {
  if (raw === null || raw === undefined) return null;
  const str = String(raw).trim();
  if (str === "") return null;
  // Reject grouping separators outright rather than guessing what was meant.
  if (/[,\s]/.test(str)) return null;
  if (!/^\d*\.?\d+$/.test(str)) return null;
  const n = Number(str);
  if (!Number.isFinite(n) || n <= 0 || n > MAX_AMOUNT) return null;
  // Money is stored to 2 decimals; avoid float dust like 0.1+0.2.
  return Math.round(n * 100) / 100;
}

// ---- Budget maths ----
// Shared by the household and personal ledgers so the two can never disagree.
//
// rollover=true  -> obligation: budget accrues every period since tracking began,
//                   so shortfalls and credits carry forward.
// rollover=false -> cap: only the period being viewed counts. Unspent money is
//                   reported as savings, never added to the next period.
export function computeBudget(cat, rows, viewMonth, terms) {
  const amount = Number(cat.budget_amount);
  const rollover = cat.budget_rollover !== false;

  if (cat.budget_period === "monthly") {
    const cur = monthSeq(viewMonth);
    if (!rollover) {
      const spent = rows.filter((e) => monthKey(e.date) === viewMonth)
        .reduce((s, e) => s + Number(e.amount), 0);
      return { active: true, rollover, periodLabel: monthLabel(viewMonth), spent, budget: amount, remaining: amount - spent };
    }
    const start = rows.length ? Math.min(...rows.map((e) => monthSeq(monthKey(e.date)))) : cur;
    const periods = Math.max(1, cur - start + 1);
    const spent = rows.filter((e) => { const q = monthSeq(monthKey(e.date)); return q >= start && q <= cur; })
      .reduce((s, e) => s + Number(e.amount), 0);
    const budget = amount * periods;
    return { active: true, rollover, periodLabel: `${periods} month${periods > 1 ? "s" : ""} tracked`, spent, budget, remaining: budget - spent };
  }

  if (cat.budget_period === "yearly") {
    const cur = Number(viewMonth.slice(0, 4));
    if (!rollover) {
      const spent = rows.filter((e) => Number(monthKey(e.date).slice(0, 4)) === cur)
        .reduce((s, e) => s + Number(e.amount), 0);
      return { active: true, rollover, periodLabel: String(cur), spent, budget: amount, remaining: amount - spent };
    }
    const years = rows.map((e) => Number(monthKey(e.date).slice(0, 4)));
    const start = years.length ? Math.min(...years, cur) : cur;
    const periods = Math.max(1, cur - start + 1);
    const spent = rows.filter((e) => { const y = Number(monthKey(e.date).slice(0, 4)); return y >= start && y <= cur; })
      .reduce((s, e) => s + Number(e.amount), 0);
    const budget = amount * periods;
    return { active: true, rollover, periodLabel: `${periods} year${periods > 1 ? "s" : ""} tracked`, spent, budget, remaining: budget - spent };
  }

  // termly
  if (!terms || !terms.length) {
    return { active: false, reason: "No payment periods defined yet - add them under Payment periods." };
  }
  const term = termForMonth(viewMonth, terms);
  if (!term) return { active: false, reason: `No period covers ${monthLabel(viewMonth)}.` };
  const cur = termSeq(viewMonth, terms);
  if (!rollover) {
    const spent = rows.filter((e) => termSeq(monthKey(e.date), terms) === cur)
      .reduce((s, e) => s + Number(e.amount), 0);
    return { active: true, rollover, periodLabel: term.label, spent, budget: amount, remaining: amount - spent };
  }
  const seqs = rows.map((e) => termSeq(monthKey(e.date), terms)).filter((q) => q !== null);
  const start = seqs.length ? Math.min(...seqs, cur) : cur;
  const periods = Math.max(1, cur - start + 1);
  const spent = rows.filter((e) => { const q = termSeq(monthKey(e.date), terms); return q !== null && q >= start && q <= cur; })
    .reduce((s, e) => s + Number(e.amount), 0);
  const budget = amount * periods;
  return { active: true, rollover, periodLabel: term.label, spent, budget, remaining: budget - spent };
}

// Wording differs because the two mean different things: an obligation you still
// owe, versus a cap you have room under.
export function budgetPhrase(b) {
  if (b.rollover) {
    return b.remaining < 0
      ? `${fmt(Math.abs(b.remaining))} credit carried forward`
      : `${fmt(b.remaining)} owed`;
  }
  return b.remaining < 0
    ? `${fmt(Math.abs(b.remaining))} over`
    : `${fmt(b.remaining)} left`;
}

// Overall monthly cap. Always resets; leftover is reported as savings.
export function computeMonthlyTotal(monthlyBudget, entries, categories, viewMonth) {
  if (!monthlyBudget) return null;
  const excluded = new Set(categories.filter((c) => c.exclude_from_total).map((c) => c.name));
  const rows = entries.filter((e) => monthKey(e.date) === viewMonth && !excluded.has(e.category));
  const counted = rows.reduce((s, e) => s + Number(e.amount), 0);
  const excludedTotal = entries.filter((e) => monthKey(e.date) === viewMonth && excluded.has(e.category))
    .reduce((s, e) => s + Number(e.amount), 0);
  return {
    budget: Number(monthlyBudget),
    spent: counted,
    remaining: Number(monthlyBudget) - counted,
    excludedTotal,
    excludedCount: excluded.size,
  };
}

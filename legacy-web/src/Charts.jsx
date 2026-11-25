// Chart primitives, hand-drawn SVG rather than a charting library. A charting
// dependency would add ~50kb to a phone app for three simple shapes, and every
// one of these needs to inherit the theme's CSS variables anyway.
import { fmt, monthKey, monthLabel } from "./lib";

// Progress ring. `value` and `max` in the same units; over-budget is shown by
// the ring completing and changing colour rather than overflowing.
export function Ring({ value, max, size = 148, stroke = 14, label, sublabel, footnote }) {
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  // Values can arrive as undefined or NaN on the first render, before data
  // loads. An NaN reaches strokeDasharray as an invalid attribute and the ring
  // silently fails to draw, so coerce here rather than trusting the caller.
  const safeValue = Number.isFinite(Number(value)) ? Number(value) : 0;
  const safeMax = Number.isFinite(Number(max)) && Number(max) > 0 ? Number(max) : 1;
  const ratio = Math.min(1, Math.max(0, safeValue / safeMax));
  const over = safeValue > safeMax;
  const dash = circumference * ratio;

  return (
    <div style={{ position: "relative", width: size, height: size, margin: "0 auto" }}>
      <svg width={size} height={size} style={{ display: "block" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--ls-surface2)" strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke={over ? "var(--ls-negative)" : "var(--ls-accent)"}
          strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div style={{
        position: "absolute", inset: 0, display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center", textAlign: "center", padding: "0 12px",
      }}>
        <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 21, color: "var(--ls-text)", fontVariantNumeric: "tabular-nums" }}>
          {label}
        </div>
        {sublabel && <div style={{ fontSize: 10, color: "var(--ls-textFaint)", marginTop: 2 }}>{sublabel}</div>}
        {footnote && (
          <div style={{ fontSize: 11, color: over ? "var(--ls-negative)" : "var(--ls-positive)", marginTop: 4 }}>
            {footnote}
          </div>
        )}
      </div>
    </div>
  );
}

// Returns the last `count` months ending at `endMonth`, as YYYY-MM keys.
export function recentMonths(endMonth, count = 6) {
  const [y, m] = endMonth.split("-").map(Number);
  const out = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(y, m - 1 - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

export function monthlyTotals(entries, endMonth, count = 6) {
  const months = recentMonths(endMonth, count);
  return months.map((mk) => ({
    month: mk,
    total: entries
      .filter((e) => monthKey(e.date) === mk)
      .reduce((s, e) => s + Number(e.amount), 0),
  }));
}

// Small inline trend line for a tile. Deliberately unlabelled - it conveys
// direction, not values.
export function Sparkline({ data, color = "var(--ls-info)", width = 110, height = 22 }) {
  if (!data || data.length < 2) return null;
  const values = data.map((d) => d.total);
  const max = Math.max(...values, 1);
  const step = width / (values.length - 1);
  const points = values.map((v, i) => `${i * step},${height - (v / max) * (height - 3) - 1.5}`).join(" ");
  const flat = values.every((v) => v === values[0]);
  return (
    <svg width={width} height={height} style={{ display: "block", overflow: "visible" }}>
      <polyline
        points={points} fill="none" stroke={color} strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round" opacity={flat ? 0.35 : 1}
      />
      <circle
        cx={(values.length - 1) * step}
        cy={height - (values[values.length - 1] / max) * (height - 3) - 1.5}
        r="2.5" fill={color}
      />
    </svg>
  );
}

// Six-month bar chart. The current month is highlighted; everything else is
// context. Bars are labelled with short month names only - the numbers live in
// the report, and cramming them here makes it unreadable on a phone.
export function MonthBars({ data, currentMonth, height = 78 }) {
  if (!data || !data.length) return null;
  const safe = data.map((d) => ({ ...d, total: Number.isFinite(Number(d.total)) ? Number(d.total) : 0 }));
  const max = Math.max(...safe.map((d) => d.total), 1);
  const allZero = safe.every((d) => d.total === 0);

  return (
    <div style={{ background: "var(--ls-surface)", border: "1px solid var(--ls-border)", borderRadius: 12, padding: "12px 10px 8px" }}>
      {allZero ? (
        <div style={{ fontSize: 12, color: "var(--ls-textFaint)", textAlign: "center", padding: "16px 0" }}>
          Not enough history yet.
        </div>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height }}>
            {safe.map((d) => {
              const isCurrent = d.month === currentMonth;
              const h = Math.max(3, (d.total / max) * height);
              return (
                <div key={d.month} style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-end", height: "100%" }}>
                  <div
                    title={`${monthLabel(d.month)}: ${fmt(d.total)}`}
                    style={{
                      height: h, borderRadius: 4,
                      background: isCurrent ? "var(--ls-accent)" : "var(--ls-border)",
                    }}
                  />
                </div>
              );
            })}
          </div>
          <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
            {safe.map((d) => {
              const isCurrent = d.month === currentMonth;
              const short = monthLabel(d.month).slice(0, 3);
              return (
                <div key={d.month} style={{
                  flex: 1, textAlign: "center", fontSize: 9,
                  color: isCurrent ? "var(--ls-accent)" : "var(--ls-textFaint)",
                }}>{short}</div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// Compares this month's spend to whatever history exists, and names the basis
// honestly rather than always claiming an average.
//
//   3+ prior months with data -> "your 3-month average"
//   exactly one, immediately before -> "last month"
//   exactly one, further back -> that month by name, since calling June
//     "last month" in September is simply wrong
//   none -> null, and the caller shows nothing
export function compareToHistory(rows, currentTotal, viewMonth, lookback = 6) {
  const trend = monthlyTotals(rows, viewMonth, lookback);
  const prior = trend.slice(0, -1);
  const withData = prior.filter((t) => t.total > 0);
  if (!withData.length) return null;

  const avg = withData.reduce((s, t) => s + t.total, 0) / withData.length;
  if (avg <= 0) return null;

  let basis;
  if (withData.length >= 2) {
    basis = `your ${withData.length}-month average`;
  } else {
    const only = withData[0];
    const immediatelyBefore = prior[prior.length - 1];
    basis = only.month === immediatelyBefore.month
      ? "last month"
      : monthLabel(only.month).split(" ")[0];
  }

  const diff = currentTotal - avg;
  const pct = Math.round((Math.abs(diff) / avg) * 100);
  return { pct, higher: diff > 0, same: pct < 1, basis, monthsUsed: withData.length };
}

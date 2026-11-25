import { fmt, monthKey, monthLabel, iconFor } from "./lib";
import { SectionLabel } from "./ui";

// A month grid showing when recurring bills fall due, plus a list of what is
// coming. Entirely passive - it tells you when you open it, and never pushes.
//
// A bill counts as paid for a month when an expense in that month is linked to
// its template. Matching on amount alone would be guesswork.

const DOW = ["S", "M", "T", "W", "T", "F", "S"];

function daysInMonth(y, m) {
  return new Date(y, m, 0).getDate();
}

// A bill due on the 31st still needs to appear in a 30-day month.
export function clampDueDay(day, y, m) {
  return Math.min(day, daysInMonth(y, m));
}

export function BillCalendar({ templates, entries, categories = [], viewMonth }) {
  const [year, month] = viewMonth.split("-").map(Number);
  const total = daysInMonth(year, month);
  const firstDow = new Date(year, month - 1, 1).getDay();

  const bills = (templates || [])
    .filter((t) => !t.archived && t.due_day)
    .map((t) => {
      const day = clampDueDay(t.due_day, year, month);
      const paid = (entries || []).some(
        (e) => e.template_id === t.id && monthKey(e.date) === viewMonth
      );
      return { ...t, day, paid };
    })
    .sort((a, b) => a.day - b.day);

  const billsByDay = new Map();
  bills.forEach((b) => {
    if (!billsByDay.has(b.day)) billsByDay.set(b.day, []);
    billsByDay.get(b.day).push(b);
  });

  const dueTotal = bills.reduce((s, b) => s + Number(b.amount), 0);
  const paidTotal = bills.filter((b) => b.paid).reduce((s, b) => s + Number(b.amount), 0);

  const today = new Date();
  const isThisMonth = monthKey(today.toISOString()) === viewMonth;
  const todayDay = isThisMonth ? today.getDate() : null;

  const cells = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= total; d++) cells.push(d);

  if (!bills.length) {
    return (
      <div style={{ marginBottom: 22 }}>
        <SectionLabel>Bill calendar</SectionLabel>
        <div style={{ background: "var(--ls-surface2)", border: "1px solid var(--ls-border)", borderRadius: 12, padding: 18 }}>
          <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 6, color: "var(--ls-text)" }}>
            No recurring bills with a due date
          </div>
          <div style={{ fontSize: 13, color: "var(--ls-textDim)", lineHeight: 1.6 }}>
            Add a due day to a quick entry under Setup &rarr; Quick entries, and it
            will show up here so you can see what is coming.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ marginBottom: 22 }}>
      <SectionLabel>Bill calendar</SectionLabel>

      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <div style={{ flex: 1, background: "var(--ls-surface)", border: "1px solid var(--ls-border)", borderRadius: 10, padding: "10px 12px" }}>
          <div style={{ fontSize: 9, letterSpacing: "0.1em", color: "var(--ls-textFaint)" }}>DUE THIS MONTH</div>
          <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 15, color: "var(--ls-text)", marginTop: 3 }}>{fmt(dueTotal)}</div>
        </div>
        <div style={{ flex: 1, background: "var(--ls-surface)", border: "1px solid var(--ls-border)", borderRadius: 10, padding: "10px 12px" }}>
          <div style={{ fontSize: 9, letterSpacing: "0.1em", color: "var(--ls-textFaint)" }}>PAID</div>
          <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 15, color: "var(--ls-positive)", marginTop: 3 }}>{fmt(paidTotal)}</div>
        </div>
      </div>

      <div style={{ background: "var(--ls-surface)", border: "1px solid var(--ls-border)", borderRadius: 12, padding: "12px 8px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", marginBottom: 6 }}>
          {DOW.map((d, i) => (
            <div key={i} style={{ textAlign: "center", fontSize: 9, color: "var(--ls-textFaintest)" }}>{d}</div>
          ))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", rowGap: 4 }}>
          {cells.map((d, i) => {
            if (d === null) return <div key={`e${i}`} />;
            const dayBills = billsByDay.get(d) || [];
            const isToday = d === todayDay;
            return (
              <div key={d} style={{ textAlign: "center", paddingBottom: 3 }}>
                <div style={{
                  fontSize: 11, lineHeight: "22px", height: 22, width: 22, margin: "0 auto",
                  borderRadius: "50%", color: isToday ? "var(--ls-accent)" : "var(--ls-textDim)",
                  border: isToday ? "1px solid var(--ls-accent)" : "1px solid transparent",
                }}>{d}</div>
                <div style={{ display: "flex", gap: 2, justifyContent: "center", minHeight: 4, marginTop: 1 }}>
                  {dayBills.slice(0, 3).map((b) => (
                    <div key={b.id} title={`${b.label} - ${fmt(b.amount)}`} style={{
                      width: 11, height: 3, borderRadius: 2,
                      background: b.paid ? "var(--ls-positive)" : "var(--ls-accent)",
                      opacity: b.paid ? 0.55 : 1,
                    }} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ marginTop: 14 }}>
        <SectionLabel>Due this month</SectionLabel>
        {bills.map((b) => {
          // A template has no icon of its own - it borrows its category's.
          const cat = categories.find((c) => c.name === b.category);
          const I = iconFor(cat?.icon_key || "more");
          const barColor = b.paid ? "var(--ls-positive)" : (cat?.color || "var(--ls-accent)");
          const daysAway = todayDay === null ? null : b.day - todayDay;
          const soon = !b.paid && daysAway !== null && daysAway >= 0 && daysAway <= 3;
          const late = !b.paid && daysAway !== null && daysAway < 0;
          return (
            <div key={b.id} style={{
              display: "flex", alignItems: "center", gap: 10,
              background: "var(--ls-surface)",
              border: `1px solid ${soon || late ? "var(--ls-warn)" : "var(--ls-border)"}`,
              borderRadius: 10, padding: "10px 12px", marginBottom: 8,
              opacity: b.paid ? 0.6 : 1,
            }}>
              <div style={{ width: 4, alignSelf: "stretch", borderRadius: 2, background: barColor }} />
              <div style={{ width: 24, height: 24, borderRadius: 6, background: (cat?.color || "#5A5A5A") + "33", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <I size={12} color={cat?.color || "#5A5A5A"} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, color: "var(--ls-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {b.label}
                </div>
                <div style={{ fontSize: 10, marginTop: 2, color: b.paid ? "var(--ls-positive)" : late ? "var(--ls-negative)" : soon ? "var(--ls-warn)" : "var(--ls-textFaint)" }}>
                  {b.paid
                    ? `Paid this month`
                    : late
                      ? `${Math.abs(daysAway)} day${Math.abs(daysAway) === 1 ? "" : "s"} overdue`
                      : daysAway === 0
                        ? "Due today"
                        : daysAway !== null && daysAway <= 3
                          ? `Due in ${daysAway} day${daysAway === 1 ? "" : "s"}`
                          : `Due ${b.day} ${monthLabel(viewMonth).split(" ")[0]}`}
                </div>
              </div>
              <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 13, color: b.paid ? "var(--ls-textFaint)" : "var(--ls-text)", flexShrink: 0 }}>
                {fmt(b.amount)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

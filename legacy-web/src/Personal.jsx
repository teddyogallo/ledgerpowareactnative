import { useState, useEffect, useRef } from "react";
import { Plus, Trash2, Pencil, ChevronLeft, ChevronRight, FileText, Download, Printer, Search, Settings as Cog } from "lucide-react";
import { supabase } from "./supabaseClient";
import { iconFor, ICON_KEYS, PALETTE, monthKey, monthLabel, fmt, nowDT, toDTLocal, fmtDT, toCSV, downloadFile, printReport, computeBudget, budgetPhrase, computeMonthlyTotal, localToISO, parseAmount } from "./lib";
import { buildBreakdown } from "./breakdown";
import {
  Card, SectionLabel, Row, Big, Banner, toggleBtn, iconBtn, input,
  primaryBtn, ghostBtn, smallGhost, smallPrimary,
} from "./ui";

// `ownerId` is the account whose ledger is shown. It equals the signed-in user
// except when an administrator is viewing someone else's, which is read-only.
export function PersonalLedger({ session, ownerId, ownerLabel, readOnly, viewMonth: vmProp, setViewMonth: setVmProp }) {
  const uid = ownerId || session.user.id;
  const [categories, setCategories] = useState([]);
  const [settings, setSettings] = useState(null);
  const [entries, setEntries] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(null);
  // Household expenses this person paid for, per household. Shown as a summary
  // on the personal tab so "what did I actually spend" has a real answer -
  // deliberately NOT mixed into the entries list (they aren't editable here)
  // and NOT counted against the personal cap (a rent payment would blow it).
  const [contributions, setContributions] = useState([]);
  const [localMonth, setLocalMonth] = useState(monthKey(nowDT()));
  const viewMonth = vmProp ?? localMonth;
  const setViewMonth = setVmProp ?? setLocalMonth;
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ amount: "", category: "", note: "", reference: "", date: nowDT() });

  useEffect(() => {
    setShowForm(false); setEditingId(null); setSearch(""); setShowSetup(false);
    load();
  }, [uid]);

  const loadSeq = useRef(0);

  async function load() {
    const seq = ++loadSeq.current;
    const requestedFor = uid;
    const [c, e, st, hh] = await Promise.all([
      supabase.from("personal_categories").select("*").eq("user_id", uid).order("sort_order"),
      supabase.from("personal_expenses").select("*").eq("user_id", uid).order("date", { ascending: false }),
      supabase.from("personal_settings").select("*").eq("user_id", uid).maybeSingle(),
      // Household expenses this person is recorded as having paid for. RLS
      // already limits this to households they belong to.
      supabase.from("expenses").select("amount,date,household_id").eq("paid_by_user_id", uid),
    ]);
    setSettings(st.data || null);
    const missing = [["personal_categories", c], ["personal_expenses", e]]
      .filter(([, r]) => r.error && /does not exist|schema cache/i.test(r.error.message || ""));
    if (missing.length) {
      setError(`Database setup incomplete - missing: ${missing.map(([n]) => n).join(", ")}. Run supabase-schema-v7.sql.`);
    } else {
      const failed = [c, e].filter((r) => r.error);
      setError(failed.length ? "Couldn't load your personal entries. Check your connection." : null);
    }
    if (seq !== loadSeq.current || requestedFor !== uid) return;
    setCategories(c.data || []);
    setEntries(e.data || []);
    // Resolve household names for whatever they contributed to.
    const hhRows = hh.data || [];
    if (hhRows.length) {
      const ids = [...new Set(hhRows.map((r) => r.household_id).filter(Boolean))];
      const { data: names } = await supabase.from("households").select("id,name").in("id", ids);
      const nameById = new Map((names || []).map((h) => [h.id, h.name]));
      setContributions(hhRows.map((r) => ({ ...r, householdName: nameById.get(r.household_id) || "Household" })));
    } else {
      setContributions([]);
    }
    if (c.data?.length) setForm((f) => ({ ...f, category: f.category || c.data[0].name }));
    setLoaded(true);
  }

  const catByName = (n) => categories.find((c) => c.name === n) || { name: n, icon_key: "more", color: "#5A5A5A" };
  const searching = search.trim().length > 0;
  const monthEntries = entries.filter((e) => monthKey(e.date) === viewMonth);
  const monthTotal = monthEntries.reduce((s, e) => s + Number(e.amount), 0);
  // Grouped per household, for the month being viewed. Kept entirely separate
  // from monthTotal so it never reaches computeMonthlyTotal and the cap.
  const contributionsThisMonth = (() => {
    const map = new Map();
    contributions
      .filter((r) => monthKey(r.date) === viewMonth)
      .forEach((r) => {
        const cur = map.get(r.household_id) || { id: r.household_id, name: r.householdName, total: 0, count: 0 };
        cur.total += Number(r.amount); cur.count += 1;
        map.set(r.household_id, cur);
      });
    return [...map.values()].sort((a, b) => b.total - a.total);
  })();
  const contributionsTotal = contributionsThisMonth.reduce((s, h) => s + h.total, 0);
  const scoped = searching
    ? entries.filter((e) => {
        const q = search.toLowerCase();
        return (e.note || "").toLowerCase().includes(q) || (e.reference || "").toLowerCase().includes(q)
          || (e.category || "").toLowerCase().includes(q) || String(e.amount).includes(q);
      })
    : monthEntries;

  const byCategory = buildBreakdown(monthEntries, categories);
  const activeCategories = categories.filter((c) => !c.archived);
  const maxCat = Math.max(1, ...byCategory.map((c) => c.total));

  const budgeted = categories
    .filter((c) => c.budget_amount != null && c.budget_period)
    .map((c) => ({ ...c, ...computeBudget(c, entries.filter((e) => e.category === c.name), viewMonth, null) }));

  const totalBudget = computeMonthlyTotal(settings?.monthly_budget, entries, categories, viewMonth);

  async function save(ev) {
    ev.preventDefault();
    const amt = parseAmount(form.amount);
    if (amt === null) { setError("Enter an amount as plain digits, e.g. 12000 or 12000.50"); return; }
    setSaving(true);
    const payload = {
      user_id: uid, amount: amt, category: form.category,
      note: form.note.trim(), reference: form.reference.trim(), date: localToISO(form.date),
    };
    const { error: err } = editingId
      ? await supabase.from("personal_expenses").update(payload).eq("id", editingId)
      : await supabase.from("personal_expenses").insert(payload);
    setSaving(false);
    if (err) return setError("Save failed. " + err.message);
    setError(null);
    setForm({ amount: "", category: activeCategories[0]?.name || "", note: "", reference: "", date: nowDT() });
    setEditingId(null); setShowForm(false); load();
  }

  async function remove(entry) {
    if (!window.confirm(`Delete this ${fmt(entry.amount)} ${entry.category} entry? This can't be undone.`)) return;
    const { error: err } = await supabase.from("personal_expenses").delete().eq("id", entry.id);
    if (err) return setError(`Couldn't delete: ${err.message}`);
    setError(null); load();
  }

  function shiftMonth(d) {
    const [y, m] = viewMonth.split("-").map(Number);
    const dt = new Date(y, m - 1 + d, 1);
    setViewMonth(`${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`);
  }

  function exportCSV() {
    const rows = (searching ? scoped : monthEntries).map((e) => ({ ...e, recipient: "" }));
    downloadFile(`personal-${searching ? "search" : viewMonth}.csv`, toCSV(rows), "text/csv");
  }
  function exportPDF() {
    const ok = printReport({
      householdName: ownerLabel || "Personal expenses",
      monthName: monthLabel(viewMonth),
      rows: monthEntries.map((e) => ({ ...e, recipient: "" })),
      byCategory: byCategory.filter((c) => c.total > 0),
      total: monthTotal,
    });
    if (!ok) setError("Your browser blocked the print window. Allow pop-ups for this site.");
  }

  if (!loaded) return <div style={{ color: "var(--ls-textFaint)" }}>Loading…</div>;

  return (
    <div>
      {error && <Banner>{error}</Banner>}

      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
        <button onClick={() => setShowReport(!showReport)} style={toggleBtn(showReport, "var(--ls-info)")}>
          <FileText size={14} />Report
        </button>
        {!readOnly && (
          <button onClick={() => setShowSetup(!showSetup)} style={toggleBtn(showSetup, "var(--ls-income)")}>
            <Cog size={14} />My categories
          </button>
        )}
      </div>

      {showSetup && !readOnly && (
        <PersonalCategories uid={uid} categories={categories} settings={settings} reload={load} />
      )}

      <div style={{ position: "relative", marginBottom: 14 }}>
        <Search size={15} style={{ position: "absolute", left: 12, top: 12, color: "var(--ls-textFaint)" }} />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search your entries…"
          style={{ ...input, paddingLeft: 34, fontSize: 13 }} />
      </div>

      {!searching && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "var(--ls-surface)", borderRadius: 12, padding: "10px 8px", marginBottom: 18, border: "1px solid var(--ls-border)" }}>
          <button onClick={() => shiftMonth(-1)} style={iconBtn}><ChevronLeft size={18} /></button>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 16, fontWeight: 500 }}>{monthLabel(viewMonth)}</div>
            <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 20, color: "var(--ls-accent)" }}>{fmt(monthTotal)}</div>
          </div>
          <button onClick={() => shiftMonth(1)} style={iconBtn}><ChevronRight size={18} /></button>
        </div>
      )}

      {contributionsThisMonth.length > 0 && !searching && (
        <div style={{ marginBottom: 20 }}>
          <SectionLabel>This month, in total</SectionLabel>
          <Card>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "var(--ls-textDim)", padding: "3px 0" }}>
              <span>Personal spending</span>
              <span style={{ fontFamily: "ui-monospace, monospace" }}>{fmt(monthTotal)}</span>
            </div>
            {contributionsThisMonth.map((h) => (
              <div key={h.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "var(--ls-textDim)", padding: "3px 0" }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginRight: 8 }}>
                  {h.name} <span style={{ color: "var(--ls-textFaint)" }}>({h.count})</span>
                </span>
                <span style={{ fontFamily: "ui-monospace, monospace", flexShrink: 0 }}>{fmt(h.total)}</span>
              </div>
            ))}
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 15, fontWeight: 600, marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--ls-border)" }}>
              <span>Total out</span>
              <span style={{ fontFamily: "ui-monospace, monospace", color: "var(--ls-accent)" }}>{fmt(monthTotal + contributionsTotal)}</span>
            </div>
            <div style={{ fontSize: 10.5, color: "var(--ls-textFaint)", marginTop: 8, lineHeight: 1.5 }}>
              Household amounts are what you personally paid for. They are shown here for
              your own picture only - they belong to the household ledger, are edited there,
              and are not counted against your personal cap.
            </div>
          </Card>
        </div>
      )}

      {(totalBudget || budgeted.length > 0) && !searching && (
        <div style={{ marginBottom: 20 }}>
          <SectionLabel>Budgets</SectionLabel>
          {totalBudget && (
            <Card style={{ borderColor: "var(--ls-adminBorder)", background: "var(--ls-adminBg)" }}>
              <Row label={`Monthly cap - ${monthLabel(viewMonth)}`} value={`${fmt(totalBudget.spent)} / ${fmt(totalBudget.budget)}`} />
              <Big positive={totalBudget.remaining >= 0}>
                {totalBudget.remaining >= 0 ? `${fmt(totalBudget.remaining)} left` : `${fmt(Math.abs(totalBudget.remaining))} over`}
              </Big>
              {totalBudget.excludedCount > 0 && (
                <div style={{ fontSize: 11, color: "var(--ls-textFaint)", marginTop: 4 }}>
                  Excludes {totalBudget.excludedCount} fixed {totalBudget.excludedCount === 1 ? "category" : "categories"} ({fmt(totalBudget.excludedTotal)} this month)
                </div>
              )}
            </Card>
          )}
          {budgeted.map((b) => (
            <Card key={b.id}>
              {b.active ? (
                <>
                  <Row label={`${b.name} - ${b.periodLabel}`} value={`${fmt(b.spent)} / ${fmt(b.budget)}`} />
                  <Big positive={b.rollover ? b.remaining <= 0 : b.remaining >= 0}>{budgetPhrase(b)}</Big>
                </>
              ) : (
                <div style={{ fontSize: 13, color: "var(--ls-textFaint)" }}>{b.name} - {b.reason}</div>
              )}
            </Card>
          ))}
        </div>
      )}

      {showReport && !searching && (
        <div style={{ marginBottom: 22, background: "var(--ls-surface2)", border: "1px solid var(--ls-border)", borderRadius: 12, padding: 16 }}>
          <SectionLabel color="var(--ls-info)">Monthly report</SectionLabel>
          <div style={{ fontSize: 16, fontWeight: 500, marginBottom: 12 }}>{monthLabel(viewMonth)}</div>
          {byCategory.map((c) => (
            <div key={c.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "4px 0", borderBottom: "1px solid #1F2E4E" }}>
              <span style={{ color: c.total > 0 ? "var(--ls-text)" : "var(--ls-textFaintest)" }}>{c.name}</span>
              <span style={{ fontFamily: "ui-monospace, monospace", color: c.total > 0 ? "var(--ls-text)" : "var(--ls-textFaintest)" }}>{fmt(c.total)}</span>
            </div>
          ))}
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 15, fontWeight: 600, marginTop: 12, paddingTop: 10, borderTop: "1px solid var(--ls-border)" }}>
            <span>Total spent</span><span style={{ fontFamily: "ui-monospace, monospace", color: "var(--ls-accent)" }}>{fmt(monthTotal)}</span>
          </div>
          {totalBudget && (
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--ls-border)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "var(--ls-textDim)" }}>
                <span>Monthly cap</span><span style={{ fontFamily: "ui-monospace, monospace" }}>{fmt(totalBudget.budget)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 15, fontWeight: 600, marginTop: 4 }}>
                <span>{totalBudget.remaining >= 0 ? "Saved this month" : "Over by"}</span>
                <span style={{ fontFamily: "ui-monospace, monospace", color: totalBudget.remaining >= 0 ? "var(--ls-positive)" : "var(--ls-negative)" }}>
                  {fmt(Math.abs(totalBudget.remaining))}
                </span>
              </div>
            </div>
          )}
          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
            <button onClick={exportCSV} style={{ ...smallGhost, flex: 1 }}><Download size={13} style={{ marginRight: 4, verticalAlign: -2 }} />CSV</button>
            <button onClick={exportPDF} style={{ ...smallGhost, flex: 1 }}><Printer size={13} style={{ marginRight: 4, verticalAlign: -2 }} />PDF</button>
          </div>
        </div>
      )}

      {!searching && byCategory.some((c) => c.total > 0) && (
        <div style={{ marginBottom: 20 }}>
          <SectionLabel>By category</SectionLabel>
          {byCategory.filter((c) => c.total > 0).sort((a, b) => b.total - a.total).map((c) => {
            const I = iconFor(c.icon_key);
            return (
              <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                <div style={{ width: 26, height: 26, borderRadius: 7, background: c.color + "33", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><I size={14} color={c.color} /></div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 3 }}>
                    <span>{c.name}</span><span style={{ fontFamily: "ui-monospace, monospace" }}>{fmt(c.total)}</span>
                  </div>
                  <div style={{ height: 5, background: "var(--ls-sunken)", borderRadius: 3 }}><div style={{ height: "100%", width: `${(c.total / maxCat) * 100}%`, background: c.color, borderRadius: 3 }} /></div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {categories.length > 0 && (
        <SectionLabel>{searching ? `${scoped.length} match${scoped.length === 1 ? "" : "es"}` : "Entries"}</SectionLabel>
      )}
      {scoped.length === 0 ? (
        categories.length > 0 && (
          <div style={{ color: "var(--ls-textFaint)", fontSize: 14, padding: "16px 0" }}>
            {searching ? "Nothing matched that search." : `Nothing logged for ${monthLabel(viewMonth)} yet.`}
          </div>
        )
      ) : scoped.map((e) => {
        const cat = catByName(e.category); const I = iconFor(cat.icon_key);
        return (
          <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 10, background: "var(--ls-surface)", border: "1px solid var(--ls-border)", borderRadius: 10, padding: "10px 12px", marginBottom: 8 }}>
            <div style={{ width: 30, height: 30, borderRadius: 8, background: cat.color + "33", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><I size={15} color={cat.color} /></div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, display: "flex", justifyContent: "space-between", gap: 8 }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.note || cat.name}</span>
                <span style={{ fontFamily: "ui-monospace, monospace", flexShrink: 0 }}>{fmt(e.amount)}</span>
              </div>
              <div style={{ fontSize: 11, color: "var(--ls-textFaint)", marginTop: 2 }}>{fmtDT(e.date)} · {cat.name}</div>
              {e.reference && <div style={{ fontSize: 11, color: "var(--ls-textDim)", marginTop: 2, fontFamily: "ui-monospace, monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Ref: {e.reference}</div>}
            </div>
            {!readOnly && <>
              <button onClick={() => { setForm({ amount: String(e.amount), category: e.category, note: e.note || "", reference: e.reference || "", date: toDTLocal(e.date) }); setEditingId(e.id); setShowForm(true); }} style={iconBtn}><Pencil size={14} /></button>
              <button onClick={() => remove(e)} style={{ ...iconBtn, color: "var(--ls-negative)" }}><Trash2 size={15} /></button>
            </>}
          </div>
        );
      })}

      {!readOnly && categories.length === 0 && (
        <div style={{ background: "var(--ls-surface2)", border: "1px solid var(--ls-border)", borderRadius: 12, padding: 18, marginTop: 8 }}>
          <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 6 }}>Start by adding a category</div>
          <div style={{ fontSize: 13, color: "var(--ls-textDim)", lineHeight: 1.6, marginBottom: 14 }}>
            Personal expenses are yours to define - transport, meals, airtime, whatever
            you actually want to track. Nothing is set up for you.
          </div>
          <button onClick={() => setShowSetup(true)} style={primaryBtn}>
            <Plus size={16} style={{ marginRight: 6, verticalAlign: -3 }} />Add my first category
          </button>
        </div>
      )}

      {!readOnly && categories.length > 0 && (
        <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, display: "flex", justifyContent: "center", padding: 16, background: "linear-gradient(transparent, var(--ls-bg) 40%)" }}>
          <div style={{ width: "100%", maxWidth: 480 }}>
            {showForm ? (
              <form onSubmit={save} style={{ background: "var(--ls-surface)", border: "1px solid var(--ls-border)", borderRadius: 14, padding: 16, display: "flex", flexDirection: "column", gap: 10, maxHeight: "78vh", overflowY: "auto" }}>
                <input type="number" step="0.01" placeholder="Amount" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} style={input} autoFocus required />
                <input type="datetime-local" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} style={input} />
                <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} style={input}>
                  {categories.filter((c) => !c.archived).map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
                </select>
                <input placeholder="Note (optional)" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} style={input} />
                <input placeholder="Transaction reference (optional)" value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} style={input} />
                <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                  <button type="button" onClick={() => { setShowForm(false); setEditingId(null); }} style={{ ...ghostBtn, flex: 1 }}>Cancel</button>
                  <button type="submit" disabled={saving} style={{ ...primaryBtn, flex: 2, opacity: saving ? 0.6 : 1 }}>{saving ? "Saving…" : editingId ? "Save changes" : "Save entry"}</button>
                </div>
              </form>
            ) : (
              <button onClick={() => { setForm({ amount: "", category: activeCategories[0]?.name || "", note: "", reference: "", date: nowDT() }); setEditingId(null); setShowForm(true); }} style={primaryBtn}>
                <Plus size={16} style={{ marginRight: 6, verticalAlign: -3 }} />Log a personal expense
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const pill = (active) => ({
  flex: 1, padding: "7px 0", fontSize: 11, borderRadius: 6, cursor: "pointer", fontFamily: "inherit",
  background: active ? "var(--ls-accent)" : "transparent",
  color: active ? "var(--ls-bg)" : "var(--ls-textFaint)",
  border: `1px solid ${active ? "var(--ls-accent)" : "var(--ls-border)"}`,
});

function PersonalMonthlyCap({ uid, settings, reload }) {
  const [value, setValue] = useState(settings?.monthly_budget ?? "");
  const [saved, setSaved] = useState(false);
  const [capError, setCapError] = useState(null);
  useEffect(() => { setValue(settings?.monthly_budget ?? ""); }, [settings?.monthly_budget]);

  async function save() {
    // Blank clears the cap, which is valid. Anything else has to be a real
    // amount - "12,000" silently became 12 before parseAmount was used here.
    let amount = null;
    if (value !== "") {
      amount = parseAmount(value);
      if (amount === null) {
        setCapError("Enter the cap as plain digits, e.g. 30000 - or leave it blank for no cap.");
        return;
      }
    }
    const { error } = await supabase.from("personal_settings")
      .upsert({ user_id: uid, monthly_budget: amount, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
    if (error) { setCapError(`Couldn't save: ${error.message}`); return; }
    setCapError(null); setSaved(true); reload(); setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div style={{ marginBottom: 14, paddingBottom: 14, borderBottom: "1px solid var(--ls-border)" }}>
      <div style={{ fontSize: 12, color: "var(--ls-textDim)", marginBottom: 6 }}>My monthly cap (optional)</div>
      {capError && <Banner>{capError}</Banner>}
      <div style={{ display: "flex", gap: 6 }}>
        <input type="number" placeholder="Amount per month" value={value}
          onChange={(e) => setValue(e.target.value)} style={{ ...input, fontSize: 13 }} />
        <button onClick={save} style={{ ...smallPrimary, width: "auto", padding: "8px 16px" }}>{saved ? "Saved" : "Save"}</button>
      </div>
      <div style={{ fontSize: 11, color: "var(--ls-textFaint)", marginTop: 6, lineHeight: 1.5 }}>
        Resets each month. Whatever is left shows as savings in your report.
      </div>
    </div>
  );
}

function PersonalCategories({ uid, categories, settings, reload }) {
  const blank = { name: "", icon_key: "more", color: PALETTE[0], budget_amount: "", budget_period: "", budget_rollover: false, exclude_from_total: false };
  const [draft, setDraft] = useState(null);
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState(null);

  // Mirrors household categories: one with spending history is archived rather
  // than deleted. Deleting it outright would lose exclude_from_total, which
  // silently corrupts the personal spending cap for every past month.
  async function remove(c) {
    const { count } = await supabase
      .from("personal_expenses")
      .select("id", { count: "exact", head: true })
      .eq("user_id", uid)
      .eq("category", c.name);

    if (count > 0) {
      const ok = window.confirm(
        `"${c.name}" has ${count} entr${count === 1 ? "y" : "ies"} logged against it.\n\n` +
        `It will be archived rather than deleted: hidden when logging, but kept so past months still add up correctly.`
      );
      if (!ok) return;
      const { error: err } = await supabase.from("personal_categories").update({ archived: true }).eq("id", c.id);
      if (err) return setError(`Couldn't archive: ${err.message}`);
      setError(null); reload();
      return;
    }

    if (!window.confirm(`Delete the category "${c.name}"?`)) return;
    const { error: err } = await supabase.from("personal_categories").delete().eq("id", c.id);
    if (err) return setError(`Couldn't delete: ${err.message}`);
    setError(null); reload();
  }

  async function restore(c) {
    const { error: err } = await supabase.from("personal_categories").update({ archived: false }).eq("id", c.id);
    if (err) return setError(`Couldn't restore: ${err.message}`);
    setError(null); reload();
  }

  async function save(e) {
    e.preventDefault();
    if (!draft.name.trim()) return;
    const payload = {
      user_id: uid, name: draft.name.trim(), icon_key: draft.icon_key, color: draft.color,
      budget_amount: draft.budget_amount === "" ? null : Number(draft.budget_amount),
      budget_period: draft.budget_period === "" ? null : draft.budget_period,
      budget_rollover: draft.budget_rollover,
      exclude_from_total: draft.exclude_from_total,
    };
    const { error: err } = editing
      ? await supabase.from("personal_categories").update(payload).eq("id", editing)
      : await supabase.from("personal_categories").insert(payload);
    if (err) {
      return setError(
        /duplicate key|unique constraint/i.test(err.message)
          ? `You already have a category named "${payload.name}".`
          : `Couldn't save: ${err.message}`
      );
    }
    setError(null); setDraft(null); setEditing(null); reload();
  }

  const Form = (
    <form onSubmit={save} style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10, padding: 10, background: "var(--ls-surface)", borderRadius: 8, border: "1px solid var(--ls-border)" }}>
      <input placeholder="Category name" value={draft?.name || ""} onChange={(e) => setDraft({ ...draft, name: e.target.value })} style={{ ...input, fontSize: 13 }} autoFocus required />
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {ICON_KEYS.map((k) => {
          const I = iconFor(k);
          return <button type="button" key={k} onClick={() => setDraft({ ...draft, icon_key: k })} style={{
            width: 30, height: 30, borderRadius: 6, cursor: "pointer",
            background: draft?.icon_key === k ? draft.color + "44" : "transparent",
            border: `1px solid ${draft?.icon_key === k ? draft.color : "var(--ls-border)"}`,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}><I size={14} color={draft?.icon_key === k ? draft.color : "var(--ls-textFaint)"} /></button>;
        })}
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {PALETTE.map((c) => (
          <button type="button" key={c} onClick={() => setDraft({ ...draft, color: c })} style={{
            width: 24, height: 24, borderRadius: 5, background: c, cursor: "pointer",
            border: draft?.color === c ? "2px solid #F4EFE4" : "1px solid var(--ls-border)",
          }} />
        ))}
      </div>
      <div style={{ fontSize: 11, color: "var(--ls-textFaint)" }}>Budget (optional)</div>
      <div style={{ display: "flex", gap: 6 }}>
        <input type="number" placeholder="Amount" value={draft?.budget_amount ?? ""} onChange={(e) => setDraft({ ...draft, budget_amount: e.target.value })} style={{ ...input, fontSize: 13 }} />
        <select value={draft?.budget_period ?? ""} onChange={(e) => setDraft({ ...draft, budget_period: e.target.value })} style={{ ...input, fontSize: 13 }}>
          <option value="">No budget</option>
          <option value="monthly">Per month</option>
          <option value="yearly">Per year</option>
        </select>
      </div>
      {draft?.budget_period && (
        <div style={{ background: "var(--ls-bg)", borderRadius: 6, padding: 10, display: "flex", flexDirection: "column", gap: 10 }}>
          <div>
            <div style={{ fontSize: 11, color: "var(--ls-textDim)", marginBottom: 6 }}>Leftover at the end of a period</div>
            <div style={{ display: "flex", gap: 6 }}>
              <button type="button" onClick={() => setDraft({ ...draft, budget_rollover: false })} style={pill(!draft.budget_rollover)}>Resets</button>
              <button type="button" onClick={() => setDraft({ ...draft, budget_rollover: true })} style={pill(draft.budget_rollover)}>Carries forward</button>
            </div>
            <div style={{ fontSize: 10, color: "var(--ls-textFaint)", marginTop: 6, lineHeight: 1.5 }}>
              {draft.budget_rollover
                ? "Unspent money is added to next period's allowance."
                : "Each period starts fresh. Leftover is reported as savings."}
            </div>
          </div>
          <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12, color: "var(--ls-textDim)", cursor: "pointer" }}>
            <input type="checkbox" checked={draft.exclude_from_total}
              onChange={(e) => setDraft({ ...draft, exclude_from_total: e.target.checked })} style={{ marginTop: 2 }} />
            <span>Leave out of my monthly cap
              <span style={{ display: "block", fontSize: 10, color: "var(--ls-textFaint)", marginTop: 2 }}>
                For fixed costs you can't cut back on.
              </span>
            </span>
          </label>
        </div>
      )}
      <div style={{ display: "flex", gap: 6 }}>
        <button type="button" onClick={() => { setDraft(null); setEditing(null); }} style={{ ...smallGhost, flex: 1 }}>Cancel</button>
        <button type="submit" style={{ ...smallPrimary, flex: 2 }}>Save</button>
      </div>
    </form>
  );

  return (
    <div style={{ marginBottom: 22, background: "var(--ls-surface2)", border: "1px solid var(--ls-border)", borderRadius: 12, padding: 16 }}>
      <SectionLabel>My categories</SectionLabel>
      {error && <Banner>{error}</Banner>}
      <PersonalMonthlyCap uid={uid} settings={settings} reload={reload} />
      {categories.filter((c) => !c.archived).map((c) => {
        const I = iconFor(c.icon_key);
        return editing === c.id ? <div key={c.id}>{Form}</div> : (
          <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderBottom: "1px solid #1F2E4E" }}>
            <div style={{ width: 26, height: 26, borderRadius: 6, background: c.color + "33", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><I size={14} color={c.color} /></div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14 }}>{c.name}</div>
              {c.budget_amount != null && <div style={{ fontSize: 11, color: "var(--ls-textFaint)" }}>{fmt(c.budget_amount)} per {c.budget_period === "yearly" ? "year" : "month"}{c.budget_rollover ? " - carries forward" : " - resets"}{c.exclude_from_total ? " - outside cap" : ""}</div>}
            </div>
            <button onClick={() => { setDraft({ name: c.name, icon_key: c.icon_key, color: c.color, budget_amount: c.budget_amount ?? "", budget_period: c.budget_period ?? "", budget_rollover: c.budget_rollover === true, exclude_from_total: Boolean(c.exclude_from_total) }); setEditing(c.id); }} style={iconBtn}><Pencil size={13} /></button>
            <button onClick={() => remove(c)} style={{ ...iconBtn, color: "var(--ls-negative)" }}><Trash2 size={13} /></button>
          </div>
        );
      })}
      {categories.some((c) => c.archived) && (
        <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid var(--ls-border)" }}>
          <div style={{ fontSize: 11, color: "var(--ls-textFaint)", marginBottom: 8 }}>
            Archived - hidden when logging, kept so past months still add up
          </div>
          {categories.filter((c) => c.archived).map((c) => {
            const I = iconFor(c.icon_key);
            return (
              <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", opacity: 0.6 }}>
                <div style={{ width: 22, height: 22, borderRadius: 5, background: c.color + "33", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <I size={12} color={c.color} />
                </div>
                <div style={{ flex: 1, fontSize: 13 }}>{c.name}</div>
                <button onClick={() => restore(c)} style={{ ...smallGhost, width: "auto", padding: "5px 12px", fontSize: 11 }}>Restore</button>
              </div>
            );
          })}
        </div>
      )}

      {draft && !editing ? Form : (
        !editing && <button onClick={() => setDraft(blank)} style={{ ...smallGhost, marginTop: 10 }}>
          <Plus size={13} style={{ marginRight: 4, verticalAlign: -2 }} />Add a category
        </button>
      )}
    </div>
  );
}

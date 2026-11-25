import { useState, useEffect, useRef } from "react";
import { Plus, Trash2, Pencil, ChevronLeft, ChevronRight, Search, Settings as Cog, Download } from "lucide-react";
import { supabase } from "./supabaseClient";
import { iconFor, ICON_KEYS, PALETTE, monthKey, monthLabel, fmt, nowDT, toDTLocal, fmtDT, toCSV, downloadFile, localToISO, parseAmount } from "./lib";
import { buildBreakdown } from "./breakdown";
import { Card, SectionLabel, Banner, input, primaryBtn, ghostBtn, smallGhost, smallPrimary, iconBtn, toggleBtn } from "./ui";

// Income is scope-aware in exactly the same way as expenses: a personal income
// entry is invisible to household members, and vice versa.
export function IncomeLedger({ session, scope, householdId, ownerId, viewMonth, setViewMonth, readOnly }) {
  const [categories, setCategories] = useState([]);
  const [entries, setEntries] = useState([]);
  // Fetched here rather than passed in. The expenses view is unmounted while
  // this one is showing, so a prop would go stale the moment the month changed
  // and the net figure would quietly report the wrong savings.
  const [allExpenses, setAllExpenses] = useState([]);
  const [contributions, setContributions] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ amount: "", category: "", source: "", note: "", reference: "", date: nowDT() });

  // ownerId lets an admin view a specific person's income instead of always
  // the signed-in account's own. Defaults to self for every normal user.
  const targetUserId = ownerId || session.user.id;
  const owner = { scope: "personal", user_id: targetUserId, household_id: null };

  useEffect(() => { setShowForm(false); setEditingId(null); setSearch(""); load(); }, [scope, householdId, ownerId]);

  const loadSeq = useRef(0);

  async function load() {
    const seq = ++loadSeq.current;
    const [c, e, x, hh] = await Promise.all([
      supabase.from("income_categories").select("*")
        .eq("scope", "personal").eq("user_id", targetUserId).order("sort_order"),
      supabase.from("income").select("*")
        .eq("scope", "personal").eq("user_id", targetUserId).order("date", { ascending: false }),
      supabase.from("personal_expenses").select("amount,date").eq("user_id", targetUserId),
      // Household expenses this person paid for. Without these the net figure
      // counts all their income but only part of their spending, which reads
      // as a healthy surplus when they may in fact be well down for the month.
      supabase.from("expenses").select("amount,date").eq("paid_by_user_id", targetUserId),
    ]);
    const missing = [c, e].filter((r) => r.error && /does not exist|schema cache/i.test(r.error.message || ""));
    if (missing.length) setError("Database setup incomplete - run supabase-schema-v12.sql.");
    else setError([c, e].some((r) => r.error) ? "Couldn't load income. Check your connection." : null);
    if (seq !== loadSeq.current) return;
    setCategories(c.data || []);
    setEntries(e.data || []);
    setAllExpenses(x.data || []);
    setContributions(hh.data || []);
    if (c.data?.length) setForm((f) => ({ ...f, category: f.category || c.data[0].name }));
    setLoaded(true);
  }

  const catByName = (n) => categories.find((c) => c.name === n) || { name: n, icon_key: "work", color: "var(--ls-income)" };
  const searching = search.trim().length > 0;
  const monthEntries = entries.filter((e) => monthKey(e.date) === viewMonth);
  const monthTotal = monthEntries.reduce((s, e) => s + Number(e.amount), 0);
  const scoped = searching
    ? entries.filter((e) => {
        const q = search.toLowerCase();
        return (e.note || "").toLowerCase().includes(q) || (e.source || "").toLowerCase().includes(q)
          || (e.reference || "").toLowerCase().includes(q) || (e.category || "").toLowerCase().includes(q)
          || String(e.amount).includes(q);
      })
    : monthEntries;

  const byCategory = buildBreakdown(monthEntries, categories).filter((c) => c.total > 0);
  const activeCategories = categories.filter((c) => !c.archived);
  const maxCat = Math.max(1, ...byCategory.map((c) => c.total));
  // Recomputed from the fetched rows against the currently viewed month, so it
  // stays correct when the month is changed from this screen.
  const personalExpensesThisMonth = allExpenses
    .filter((e) => monthKey(e.date) === viewMonth)
    .reduce((s, e) => s + Number(e.amount), 0);
  const householdPaidThisMonth = contributions
    .filter((e) => monthKey(e.date) === viewMonth)
    .reduce((s, e) => s + Number(e.amount), 0);
  // Money out is everything this person actually paid, personal and household
  // alike - matching the "Total out" figure on the Expenses tab.
  const expenseTotalForMonth = personalExpensesThisMonth + householdPaidThisMonth;
  const net = monthTotal - expenseTotalForMonth;

  async function save(ev) {
    ev.preventDefault();
    const amt = parseAmount(form.amount);
    if (amt === null) { setError("Enter an amount as plain digits, e.g. 12000 or 12000.50"); return; }
    setSaving(true);
    const payload = {
      ...owner, amount: amt, category: form.category, source: form.source.trim(),
      note: form.note.trim(), reference: form.reference.trim(), date: localToISO(form.date),
      created_by: session.user.id,
    };
    const { error: err } = editingId
      ? await supabase.from("income").update(payload).eq("id", editingId)
      : await supabase.from("income").insert(payload);
    setSaving(false);
    if (err) return setError("Save failed. " + err.message);
    setError(null);
    setForm({ amount: "", category: activeCategories[0]?.name || "", source: "", note: "", reference: "", date: nowDT() });
    setEditingId(null); setShowForm(false); load();
  }

  async function remove(entry) {
    if (!window.confirm(`Delete this ${fmt(entry.amount)} ${entry.category} entry? This can't be undone.`)) return;
    const { error: err } = await supabase.from("income").delete().eq("id", entry.id);
    if (err) return setError(`Couldn't delete: ${err.message}`);
    setError(null); load();
  }

  function shiftMonth(d) {
    const [y, m] = viewMonth.split("-").map(Number);
    const dt = new Date(y, m - 1 + d, 1);
    setViewMonth(`${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`);
  }

  function exportCSV() {
    const rows = (searching ? scoped : monthEntries).map((e) => ({
      date: e.date, category: e.category, recipient: e.source || "", amount: e.amount,
      note: e.note || "", reference: e.reference || "",
    }));
    downloadFile(`income-${searching ? "search" : viewMonth}.csv`, toCSV(rows), "text/csv");
  }

  if (!loaded) return <div style={{ color: "var(--ls-textFaint)" }}>Loading…</div>;

  return (
    <div>
      {error && <Banner>{error}</Banner>}

      {!readOnly && (
        <button onClick={() => setShowSetup(!showSetup)} style={{ ...toggleBtn(showSetup, "var(--ls-income)"), marginBottom: 14 }}>
          <Cog size={14} />Income categories
        </button>
      )}

      {showSetup && !readOnly && (
        <IncomeCategories owner={owner} categories={categories} reload={load} />
      )}

      <div style={{ position: "relative", marginBottom: 14 }}>
        <Search size={15} style={{ position: "absolute", left: 12, top: 12, color: "var(--ls-textFaint)" }} />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search income…"
          style={{ ...input, paddingLeft: 34, fontSize: 13 }} />
      </div>

      {!searching && (
        <>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "var(--ls-surface)", borderRadius: 12, padding: "10px 8px", marginBottom: 12, border: "1px solid var(--ls-border)" }}>
            <button onClick={() => shiftMonth(-1)} style={iconBtn}><ChevronLeft size={18} /></button>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 16, fontWeight: 500 }}>{monthLabel(viewMonth)}</div>
              <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 20, color: "var(--ls-positive)" }}>{fmt(monthTotal)}</div>
            </div>
            <button onClick={() => shiftMonth(1)} style={iconBtn}><ChevronRight size={18} /></button>
          </div>

          <Card style={{ background: "var(--ls-surface2)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "var(--ls-textDim)", marginBottom: 3 }}>
              <span>Income</span><span style={{ fontFamily: "ui-monospace, monospace", color: "var(--ls-positive)" }}>{fmt(monthTotal)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "var(--ls-textDim)", marginBottom: householdPaidThisMonth > 0 ? 3 : 6 }}>
              <span>Personal expenses</span><span style={{ fontFamily: "ui-monospace, monospace", color: "var(--ls-warn)" }}>{fmt(personalExpensesThisMonth)}</span>
            </div>
            {householdPaidThisMonth > 0 && (
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "var(--ls-textDim)", marginBottom: 6 }}>
                <span>Paid toward households</span><span style={{ fontFamily: "ui-monospace, monospace", color: "var(--ls-warn)" }}>{fmt(householdPaidThisMonth)}</span>
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 15, fontWeight: 600, paddingTop: 8, borderTop: "1px solid var(--ls-border)" }}>
              <span>{net >= 0 ? "Net saved" : "Net shortfall"}</span>
              <span style={{ fontFamily: "ui-monospace, monospace", color: net >= 0 ? "var(--ls-positive)" : "var(--ls-negative)" }}>{fmt(Math.abs(net))}</span>
            </div>
          </Card>
        </>
      )}

      {!searching && byCategory.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <SectionLabel>Where it came from</SectionLabel>
          {byCategory.sort((a, b) => b.total - a.total).map((c) => {
            const I = iconFor(c.icon_key);
            return (
              <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                <div style={{ width: 26, height: 26, borderRadius: 7, background: c.color + "33", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><I size={14} color={c.color} /></div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 3 }}>
                    <span>{c.name}</span><span style={{ fontFamily: "ui-monospace, monospace" }}>{fmt(c.total)}</span>
                  </div>
                  <div style={{ height: 5, background: "var(--ls-sunken)", borderRadius: 3 }}>
                    <div style={{ height: "100%", width: `${(c.total / maxCat) * 100}%`, background: c.color, borderRadius: 3 }} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!readOnly && categories.length === 0 && (
        <div style={{ background: "var(--ls-surface2)", border: "1px solid var(--ls-border)", borderRadius: 12, padding: 18, marginTop: 8 }}>
          <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 6 }}>Add an income category</div>
          <div style={{ fontSize: 13, color: "var(--ls-textDim)", lineHeight: 1.6, marginBottom: 14 }}>
            Salary, business income, loans received, gifts, repayments - whatever money
            actually comes in. Nothing is set up for you.
          </div>
          <button onClick={() => setShowSetup(true)} style={primaryBtn}>
            <Plus size={16} style={{ marginRight: 6, verticalAlign: -3 }} />Add my first income category
          </button>
        </div>
      )}

      {categories.length > 0 && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <SectionLabel>{searching ? `${scoped.length} match${scoped.length === 1 ? "" : "es"}` : "Entries"}</SectionLabel>
          {scoped.length > 0 && <button onClick={exportCSV} style={{ ...iconBtn, color: "var(--ls-textFaint)" }}><Download size={13} /></button>}
        </div>
      )}

      {scoped.length === 0 ? (
        categories.length > 0 && (
          <div style={{ color: "var(--ls-textFaint)", fontSize: 14, padding: "16px 0" }}>
            {searching ? "Nothing matched that search." : `No income recorded for ${monthLabel(viewMonth)}.`}
          </div>
        )
      ) : scoped.map((e) => {
        const cat = catByName(e.category); const I = iconFor(cat.icon_key);
        return (
          <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 10, background: "var(--ls-surface)", border: "1px solid var(--ls-border)", borderRadius: 10, padding: "10px 12px", marginBottom: 8 }}>
            <div style={{ width: 30, height: 30, borderRadius: 8, background: cat.color + "33", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><I size={15} color={cat.color} /></div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, display: "flex", justifyContent: "space-between", gap: 8 }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.source || e.note || cat.name}</span>
                <span style={{ fontFamily: "ui-monospace, monospace", flexShrink: 0, color: "var(--ls-positive)" }}>+{fmt(e.amount)}</span>
              </div>
              <div style={{ fontSize: 11, color: "var(--ls-textFaint)", marginTop: 2 }}>{fmtDT(e.date)} · {cat.name}</div>
              {e.reference && <div style={{ fontSize: 11, color: "var(--ls-textDim)", marginTop: 2, fontFamily: "ui-monospace, monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Ref: {e.reference}</div>}
            </div>
            {!readOnly && <>
              <button onClick={() => { setForm({ amount: String(e.amount), category: e.category, source: e.source || "", note: e.note || "", reference: e.reference || "", date: toDTLocal(e.date) }); setEditingId(e.id); setShowForm(true); }} style={iconBtn}><Pencil size={14} /></button>
              <button onClick={() => remove(e)} style={{ ...iconBtn, color: "var(--ls-negative)" }}><Trash2 size={15} /></button>
            </>}
          </div>
        );
      })}

      {!readOnly && categories.length > 0 && (
        <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, display: "flex", justifyContent: "center", padding: 16, background: "linear-gradient(transparent, var(--ls-bg) 40%)" }}>
          <div style={{ width: "100%", maxWidth: 480 }}>
            {showForm ? (
              <form onSubmit={save} style={{ background: "var(--ls-surface)", border: "1px solid var(--ls-border)", borderRadius: 14, padding: 16, display: "flex", flexDirection: "column", gap: 10, maxHeight: "78vh", overflowY: "auto" }}>
                <input type="number" step="0.01" placeholder="Amount received" value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })} style={input} autoFocus required />
                <input type="datetime-local" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} style={input} />
                <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} style={input}>
                  {categories.filter((c) => !c.archived).map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
                </select>
                <input placeholder="Who from (optional)" value={form.source}
                  onChange={(e) => setForm({ ...form, source: e.target.value })} style={input} />
                <input placeholder="Note (optional)" value={form.note}
                  onChange={(e) => setForm({ ...form, note: e.target.value })} style={input} />
                <input placeholder="Transaction reference (optional)" value={form.reference}
                  onChange={(e) => setForm({ ...form, reference: e.target.value })} style={input} />
                <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                  <button type="button" onClick={() => { setShowForm(false); setEditingId(null); }} style={{ ...ghostBtn, flex: 1 }}>Cancel</button>
                  <button type="submit" disabled={saving} style={{ ...primaryBtn, flex: 2, opacity: saving ? 0.6 : 1, background: "var(--ls-income)", color: "var(--ls-text)" }}>
                    {saving ? "Saving…" : editingId ? "Save changes" : "Record income"}
                  </button>
                </div>
              </form>
            ) : (
              <button onClick={() => { setForm({ amount: "", category: activeCategories[0]?.name || "", source: "", note: "", reference: "", date: nowDT() }); setEditingId(null); setShowForm(true); }}
                style={{ ...primaryBtn, background: "var(--ls-income)", color: "var(--ls-text)" }}>
                <Plus size={16} style={{ marginRight: 6, verticalAlign: -3 }} />Record income
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function IncomeCategories({ owner, categories, reload }) {
  const blank = { name: "", icon_key: "work", color: PALETTE[4] };
  const [draft, setDraft] = useState(null);
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState(null);

  // Archived rather than deleted when it has history, so past months still
  // attribute their income correctly.
  async function remove(c) {
    const { count } = await supabase
      .from("income")
      .select("id", { count: "exact", head: true })
      .eq("scope", "personal").eq("user_id", owner.user_id).eq("category", c.name);

    if (count > 0) {
      const ok = window.confirm(
        `"${c.name}" has ${count} entr${count === 1 ? "y" : "ies"} logged against it.\n\n` +
        `It will be archived rather than deleted: hidden when recording income, but kept so past months still add up.`
      );
      if (!ok) return;
      const { error: err } = await supabase.from("income_categories").update({ archived: true }).eq("id", c.id);
      if (err) return setError(`Couldn't archive: ${err.message}`);
      setError(null); reload();
      return;
    }

    if (!window.confirm(`Delete the category "${c.name}"?`)) return;
    const { error: err } = await supabase.from("income_categories").delete().eq("id", c.id);
    if (err) return setError(`Couldn't delete: ${err.message}`);
    setError(null); reload();
  }

  async function restore(c) {
    const { error: err } = await supabase.from("income_categories").update({ archived: false }).eq("id", c.id);
    if (err) return setError(`Couldn't restore: ${err.message}`);
    setError(null); reload();
  }

  async function save(e) {
    e.preventDefault();
    if (!draft.name.trim()) return;
    const payload = { ...owner, name: draft.name.trim(), icon_key: draft.icon_key, color: draft.color };
    const { error: err } = editing
      ? await supabase.from("income_categories").update(payload).eq("id", editing)
      : await supabase.from("income_categories").insert(payload);
    if (err) {
      return setError(
        /duplicate key|unique constraint/i.test(err.message)
          ? `You already have an income category named "${payload.name}".`
          : `Couldn't save: ${err.message}`
      );
    }
    setError(null); setDraft(null); setEditing(null); reload();
  }

  const Form = (
    <form onSubmit={save} style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10, padding: 10, background: "var(--ls-surface)", borderRadius: 8, border: "1px solid var(--ls-border)" }}>
      <input placeholder="e.g. Salary, Business, Gifts" value={draft?.name || ""}
        onChange={(e) => setDraft({ ...draft, name: e.target.value })} style={{ ...input, fontSize: 13 }} autoFocus required />
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
      <div style={{ display: "flex", gap: 6 }}>
        <button type="button" onClick={() => { setDraft(null); setEditing(null); }} style={{ ...smallGhost, flex: 1 }}>Cancel</button>
        <button type="submit" style={{ ...smallPrimary, flex: 2 }}>Save</button>
      </div>
    </form>
  );

  return (
    <div style={{ marginBottom: 22, background: "var(--ls-surface2)", border: "1px solid var(--ls-border)", borderRadius: 12, padding: 16 }}>
      <SectionLabel>Income categories</SectionLabel>
      {error && <Banner>{error}</Banner>}
      {categories.filter((c) => !c.archived).map((c) => {
        const I = iconFor(c.icon_key);
        return editing === c.id ? <div key={c.id}>{Form}</div> : (
          <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderBottom: "1px solid #1F2E4E" }}>
            <div style={{ width: 26, height: 26, borderRadius: 6, background: c.color + "33", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><I size={14} color={c.color} /></div>
            <div style={{ flex: 1, fontSize: 14 }}>{c.name}</div>
            <button onClick={() => { setDraft({ name: c.name, icon_key: c.icon_key, color: c.color }); setEditing(c.id); }} style={iconBtn}><Pencil size={13} /></button>
            <button onClick={() => remove(c)} style={{ ...iconBtn, color: "var(--ls-negative)" }}><Trash2 size={13} /></button>
          </div>
        );
      })}
      {categories.some((c) => c.archived) && (
        <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid var(--ls-border)" }}>
          <div style={{ fontSize: 11, color: "var(--ls-textFaint)", marginBottom: 8 }}>
            Archived - hidden when recording, kept so past months still add up
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

      {draft && !editing ? Form : (!editing && (
        <button onClick={() => setDraft(blank)} style={{ ...smallGhost, marginTop: 10 }}>
          <Plus size={13} style={{ marginRight: 4, verticalAlign: -2 }} />Add a category
        </button>
      ))}
    </div>
  );
}

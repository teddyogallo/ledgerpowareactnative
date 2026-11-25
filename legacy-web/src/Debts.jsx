import { useState, useEffect, useRef } from "react";
import { Plus, Trash2, Pencil, ArrowUpRight, ArrowDownLeft, AlertTriangle, Check, ChevronDown, ChevronUp } from "lucide-react";
import { supabase } from "./supabaseClient";
import { fmt, nowDT, fmtDT, localToISO, parseAmount } from "./lib";
import { Card, Banner, input, primaryBtn, ghostBtn, smallGhost, smallPrimary, iconBtn } from "./ui";

const todayISO = () => new Date().toISOString().slice(0, 10);

// Days until due. Negative means overdue.
function daysUntil(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr + "T00:00:00");
  const now = new Date(); now.setHours(0, 0, 0, 0);
  return Math.round((d - now) / 86400000);
}

function dueLabel(dateStr) {
  const n = daysUntil(dateStr);
  if (n === null) return { text: "No due date", tone: "var(--ls-textFaint)", urgent: false };
  if (n < 0) return { text: `${Math.abs(n)} day${Math.abs(n) === 1 ? "" : "s"} overdue`, tone: "var(--ls-negative)", urgent: true };
  if (n === 0) return { text: "Due today", tone: "var(--ls-warn)", urgent: true };
  if (n <= 7) return { text: `Due in ${n} day${n === 1 ? "" : "s"}`, tone: "var(--ls-warn)", urgent: true };
  return { text: `Due ${new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`, tone: "var(--ls-textFaint)", urgent: false };
}

export function DebtTracker({ session, scope, householdId, ownerId, categories = [], incomeCategories = [], readOnly, onLedgerChanged }) {
  const [debts, setDebts] = useState([]);
  const [payments, setPayments] = useState({});
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState("active"); // active | cleared | all
  const [expanded, setExpanded] = useState(null);
  const [editing, setEditing] = useState(null);
  const [adding, setAdding] = useState(false);
  const [payingId, setPayingId] = useState(null);
  const [payForm, setPayForm] = useState({ amount: "", date: nowDT(), reference: "", note: "" });

  const blank = {
    direction: "owe", counterparty: "", principal: "", total_repayable: "",
    due_date: "", notes: "", expense_category: "", income_category: "",
  };
  const [draft, setDraft] = useState(blank);

  // ownerId lets an admin view a specific person's debts instead of always
  // the signed-in account's own. Defaults to self for every normal user.
  const owner = ownerId || session.user.id;

  useEffect(() => { setExpanded(null); setAdding(false); setEditing(null); load(); }, [scope, householdId, ownerId]);

  const loadSeq = useRef(0);

  async function load() {
    const seq = ++loadSeq.current;
    let q = supabase.from("debts").select("*");
    q = scope === "personal"
      ? q.eq("scope", "personal").eq("user_id", owner)
      : q.eq("scope", "household").eq("household_id", householdId);
    const { data, error: err } = await q.order("due_date", { ascending: true, nullsFirst: false });
    if (err) {
      setError(/does not exist|schema cache/i.test(err.message || "")
        ? "Database setup incomplete - run supabase-schema-v10.sql."
        : "Couldn't load debts. Check your connection.");
      setLoaded(true);
      return;
    }
    if (seq !== loadSeq.current) return;
    setError(null);
    setDebts(data || []);
    const ids = (data || []).map((d) => d.id);
    if (ids.length) {
      const { data: pays } = await supabase.from("debt_payments").select("*").in("debt_id", ids).order("date", { ascending: false });
      const grouped = {};
      (pays || []).forEach((p) => { (grouped[p.debt_id] = grouped[p.debt_id] || []).push(p); });
      setPayments(grouped);
    } else {
      setPayments({});
    }
    setLoaded(true);
  }

  const paidFor = (id) => (payments[id] || []).reduce((s, p) => s + Number(p.amount), 0);
  const owedFor = (d) => Number(d.total_repayable ?? d.principal);
  const remainingFor = (d) => owedFor(d) - paidFor(d.id);

  async function saveDebt(e) {
    e.preventDefault();
    const principal = parseAmount(draft.principal);
    if (!draft.counterparty.trim()) return;
    if (principal === null) { setError("Enter the amount as plain digits, e.g. 40000"); return; }
    const repayable = draft.total_repayable === "" ? null : parseAmount(draft.total_repayable);
    if (draft.total_repayable !== "" && repayable === null) {
      return setError("Enter the total to repay as plain digits, e.g. 45000");
    }
    if (repayable !== null && repayable < principal) {
      return setError("The total repayable cannot be less than the original amount.");
    }
    const payload = {
      scope,
      user_id: scope === "personal" ? session.user.id : null,
      household_id: scope === "household" ? householdId : null,
      direction: draft.direction,
      counterparty: draft.counterparty.trim(),
      principal,
      total_repayable: repayable,
      due_date: draft.due_date || null,
      notes: draft.notes.trim(),
      // Only debts you owe post to the expense ledger.
      expense_category: draft.direction === "owe" ? (draft.expense_category || null) : null,
      income_category: draft.direction === "owed" ? (draft.income_category || null) : null,
      created_by: session.user.id,
    };
    const { error: err } = editing
      ? await supabase.from("debts").update(payload).eq("id", editing)
      : await supabase.from("debts").insert(payload);
    if (err) return setError("Couldn't save: " + err.message);
    setError(null); setDraft(blank); setAdding(false); setEditing(null); load();
  }

  async function addPayment(debt, e) {
    e.preventDefault();
    const amt = parseAmount(payForm.amount);
    if (amt === null) { setError("Enter the amount as plain digits, e.g. 5000"); return; }
    const remaining = remainingFor(debt);
    if (amt > remaining + 0.001) {
      // Allowed, but say so - overpaying is usually a typo.
      if (!window.confirm(`That's more than the ${fmt(remaining)} outstanding. Record it anyway?`)) return;
    }
    // Post to the matching expense ledger first, so a failure there doesn't
    // leave a payment recorded with no corresponding expense.
    let householdExpenseId = null, personalExpenseId = null, incomeId = null;
    const shouldPost = debt.direction === "owe" && debt.expense_category;
    // Scope-gated even though the form no longer offers this for household debts -
    // protects against a debt that had an income category saved before household
    // income was removed.
    const shouldPostIncome = scope === "personal" && debt.direction === "owed" && debt.income_category;

    if (shouldPostIncome) {
      const { data, error: iErr } = await supabase.from("income").insert({
        scope,
        user_id: scope === "personal" ? session.user.id : null,
        household_id: scope === "household" ? householdId : null,
        amount: amt, category: debt.income_category, source: debt.counterparty,
        note: `Repayment - ${debt.counterparty}`, reference: payForm.reference.trim(),
        date: localToISO(payForm.date), created_by: session.user.id,
      }).select("id").single();
      if (iErr) return setError("Couldn't record the matching income: " + iErr.message);
      incomeId = data.id;
    }

    if (shouldPost) {
      const note = `Debt payment - ${debt.counterparty}`;
      if (scope === "household") {
        const { data, error: xErr } = await supabase.from("expenses").insert({
          amount: amt, category: debt.expense_category, recipient: "", note,
          reference: payForm.reference.trim(), date: localToISO(payForm.date), household_id: householdId,
        }).select("id").single();
        if (xErr) return setError("Couldn't add the matching expense: " + xErr.message);
        householdExpenseId = data.id;
      } else {
        const { data, error: xErr } = await supabase.from("personal_expenses").insert({
          user_id: session.user.id, amount: amt, category: debt.expense_category,
          note, reference: payForm.reference.trim(), date: localToISO(payForm.date),
        }).select("id").single();
        if (xErr) return setError("Couldn't add the matching expense: " + xErr.message);
        personalExpenseId = data.id;
      }
    }

    const { error: err } = await supabase.from("debt_payments").insert({
      debt_id: debt.id, amount: amt, date: localToISO(payForm.date),
      reference: payForm.reference.trim(), note: payForm.note.trim(),
      household_expense_id: householdExpenseId, personal_expense_id: personalExpenseId,
      income_id: incomeId,
      created_by: session.user.id,
    });
    if (err) {
      // Roll the expense back rather than leaving an orphan in the ledger.
      if (householdExpenseId) await supabase.from("expenses").delete().eq("id", householdExpenseId);
      if (personalExpenseId) await supabase.from("personal_expenses").delete().eq("id", personalExpenseId);
      if (incomeId) await supabase.from("income").delete().eq("id", incomeId);
      return setError("Couldn't record payment: " + err.message);
    }
    // Clear the debt automatically once it's fully paid.
    if (paidFor(debt.id) + amt >= owedFor(debt) - 0.001 && debt.status === "active") {
      await supabase.from("debts").update({ status: "cleared" }).eq("id", debt.id);
    }
    setPayForm({ amount: "", date: nowDT(), reference: "", note: "" });
    setPayingId(null); load();
    if ((shouldPost || shouldPostIncome) && onLedgerChanged) onLedgerChanged();
  }

  async function setStatus(id, status) {
    const { error: err } = await supabase.from("debts").update({ status }).eq("id", id);
    if (err) return setError(`Couldn't update: ${err.message}`);
    setError(null); load();
  }
  async function removeDebt(d) {
    const linked = (payments[d.id] || []).filter((p) => p.household_expense_id || p.personal_expense_id || p.income_id);
    const warning = linked.length
      ? `Delete "${d.counterparty}", its ${(payments[d.id] || []).length} recorded payment(s), and the ${linked.length} matching ledger entr${linked.length === 1 ? "y" : "ies"}? This can't be undone.`
      : `Delete "${d.counterparty}" and all its recorded payments? This can't be undone.`;
    if (!window.confirm(warning)) return;
    // Batched into one query per table rather than one per payment. A debt with
    // a dozen payments was previously a dozen sequential round-trips, which on
    // a phone connection is a visible wait on a destructive action.
    const hhIds = linked.map((p) => p.household_expense_id).filter(Boolean);
    const perIds = linked.map((p) => p.personal_expense_id).filter(Boolean);
    const incIds = linked.map((p) => p.income_id).filter(Boolean);
    const cleanup = await Promise.all([
      hhIds.length ? supabase.from("expenses").delete().in("id", hhIds) : null,
      perIds.length ? supabase.from("personal_expenses").delete().in("id", perIds) : null,
      incIds.length ? supabase.from("income").delete().in("id", incIds) : null,
    ]);
    const cleanupErr = cleanup.find((r) => r && r.error);
    if (cleanupErr) return setError(`Couldn't remove the linked entries: ${cleanupErr.error.message}`);
    const { error: err } = await supabase.from("debts").delete().eq("id", d.id);
    if (err) return setError(`Couldn't delete: ${err.message}`);
    setError(null); load(); if (linked.length && onLedgerChanged) onLedgerChanged();
  }
  async function removePayment(p) {
    // Remove the linked expense as well, or the ledger keeps a charge for a
    // payment that no longer exists.
    const cleanup = await Promise.all([
      p.household_expense_id ? supabase.from("expenses").delete().eq("id", p.household_expense_id) : null,
      p.personal_expense_id ? supabase.from("personal_expenses").delete().eq("id", p.personal_expense_id) : null,
      p.income_id ? supabase.from("income").delete().eq("id", p.income_id) : null,
    ]);
    const cleanupErr = cleanup.find((r) => r && r.error);
    if (cleanupErr) return setError(`Couldn't remove the linked entry: ${cleanupErr.error.message}`);
    const { error: err } = await supabase.from("debt_payments").delete().eq("id", p.id);
    if (err) return setError(`Couldn't remove payment: ${err.message}`);
    setError(null); load(); if ((p.household_expense_id || p.personal_expense_id || p.income_id) && onLedgerChanged) onLedgerChanged();
  }

  const visible = debts.filter((d) => filter === "all" ? true : filter === "active" ? d.status === "active" : d.status !== "active");
  const sorted = [...visible].sort((a, b) => {
    const ua = daysUntil(a.due_date), ub = daysUntil(b.due_date);
    if (ua === null && ub === null) return 0;
    if (ua === null) return 1;
    if (ub === null) return -1;
    return ua - ub;
  });

  const iOwe = debts.filter((d) => d.status === "active" && d.direction === "owe")
    .reduce((s, d) => s + Math.max(0, remainingFor(d)), 0);
  const owedToMe = debts.filter((d) => d.status === "active" && d.direction === "owed")
    .reduce((s, d) => s + Math.max(0, remainingFor(d)), 0);

  if (!loaded) return <div style={{ color: "var(--ls-textFaint)" }}>Loading…</div>;

  const DebtForm = (
    <form onSubmit={saveDebt} style={{ background: "var(--ls-surface)", border: "1px solid var(--ls-border)", borderRadius: 12, padding: 14, display: "flex", flexDirection: "column", gap: 10, marginBottom: 12 }}>
      <div style={{ display: "flex", gap: 6 }}>
        <button type="button" onClick={() => setDraft({ ...draft, direction: "owe" })}
          style={dirPill(draft.direction === "owe", "var(--ls-negative)")}>
          <ArrowUpRight size={13} style={{ verticalAlign: -2, marginRight: 4 }} />I owe them
        </button>
        <button type="button" onClick={() => setDraft({ ...draft, direction: "owed" })}
          style={dirPill(draft.direction === "owed", "var(--ls-positive)")}>
          <ArrowDownLeft size={13} style={{ verticalAlign: -2, marginRight: 4 }} />They owe me
        </button>
      </div>
      <input placeholder={draft.direction === "owe" ? "Who you owe" : "Who owes you"}
        value={draft.counterparty} onChange={(e) => setDraft({ ...draft, counterparty: e.target.value })}
        style={input} autoFocus required />
      <input type="number" step="0.01" placeholder="Amount" value={draft.principal}
        onChange={(e) => setDraft({ ...draft, principal: e.target.value })} style={input} required />
      <input type="number" step="0.01"
        placeholder={draft.direction === "owe" ? "Total to repay incl. interest (optional)" : "Total they should repay incl. interest (optional)"}
        value={draft.total_repayable} onChange={(e) => setDraft({ ...draft, total_repayable: e.target.value })} style={input} />
      <div>
        <div style={{ fontSize: 11, color: "var(--ls-textFaint)", marginBottom: 4 }}>Due date (optional)</div>
        <input type="date" value={draft.due_date} onChange={(e) => setDraft({ ...draft, due_date: e.target.value })} style={input} />
      </div>
      {draft.direction === "owe" && (
        <div>
          <div style={{ fontSize: 11, color: "var(--ls-textFaint)", marginBottom: 4 }}>
            Log payments as a {scope === "household" ? "household" : "personal"} expense under
          </div>
          {categories.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--ls-warn)", background: "rgba(224,181,133,0.18)", padding: "8px 10px", borderRadius: 6 }}>
              No expense categories set up yet. Add one first if you want payments to appear in the expense tracker.
            </div>
          ) : (
            <select value={draft.expense_category}
              onChange={(e) => setDraft({ ...draft, expense_category: e.target.value })} style={input}>
              <option value="">Don't log as an expense</option>
              {categories.filter((c) => !c.archived).map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
            </select>
          )}
        </div>
      )}
      {draft.direction === "owed" && scope === "personal" && (
        <div>
          <div style={{ fontSize: 11, color: "var(--ls-textFaint)", marginBottom: 4 }}>
            Log repayments received as income under
          </div>
          {incomeCategories.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--ls-warn)", background: "rgba(224,181,133,0.18)", padding: "8px 10px", borderRadius: 6 }}>
              No income categories set up yet. Add one under Personal → Income if you want repayments recorded there.
            </div>
          ) : (
            <select value={draft.income_category}
              onChange={(e) => setDraft({ ...draft, income_category: e.target.value })} style={input}>
              <option value="">Don't log as income</option>
              {incomeCategories.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
            </select>
          )}
          <div style={{ fontSize: 10, color: "var(--ls-textFaint)", marginTop: 6, lineHeight: 1.5 }}>
            Money coming back to you is income, never an expense.
          </div>
        </div>
      )}
      {draft.direction === "owed" && scope === "household" && (
        <div style={{ fontSize: 11, color: "var(--ls-textFaint)", lineHeight: 1.5, background: "var(--ls-sunken)", padding: "8px 10px", borderRadius: 6 }}>
          Ledger Sawa doesn't track household income. Repayments will reduce this
          debt's balance but won't be logged anywhere else.
        </div>
      )}
      <input placeholder="Note (optional)" value={draft.notes}
        onChange={(e) => setDraft({ ...draft, notes: e.target.value })} style={input} />
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" onClick={() => { setAdding(false); setEditing(null); setDraft(blank); }} style={{ ...ghostBtn, flex: 1 }}>Cancel</button>
        <button type="submit" style={{ ...primaryBtn, flex: 2 }}>{editing ? "Save changes" : "Add debt"}</button>
      </div>
    </form>
  );

  return (
    <div>
      {error && <Banner>{error}</Banner>}

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <Card style={{ flex: 1, marginBottom: 0 }}>
          <div style={{ fontSize: 11, color: "var(--ls-textFaint)", marginBottom: 4 }}>I owe</div>
          <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 18, color: iOwe > 0 ? "var(--ls-negative)" : "var(--ls-positive)" }}>{fmt(iOwe)}</div>
        </Card>
        <Card style={{ flex: 1, marginBottom: 0 }}>
          <div style={{ fontSize: 11, color: "var(--ls-textFaint)", marginBottom: 4 }}>Owed to me</div>
          <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 18, color: "var(--ls-positive)" }}>{fmt(owedToMe)}</div>
        </Card>
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
        {[["active", "Active"], ["cleared", "Settled"], ["all", "All"]].map(([k, label]) => (
          <button key={k} onClick={() => setFilter(k)} style={{
            flex: 1, padding: "7px 0", fontSize: 12, borderRadius: 6, cursor: "pointer", fontFamily: "inherit",
            background: filter === k ? "var(--ls-border)" : "transparent",
            color: filter === k ? "var(--ls-text)" : "var(--ls-textFaint)",
            border: "1px solid var(--ls-border)",
          }}>{label}</button>
        ))}
      </div>

      {!readOnly && (adding || editing ? DebtForm : (
        <button onClick={() => { setDraft(blank); setAdding(true); }} style={{ ...primaryBtn, marginBottom: 14 }}>
          <Plus size={16} style={{ marginRight: 6, verticalAlign: -3 }} />Add a debt
        </button>
      ))}

      {sorted.length === 0 ? (
        <div style={{ color: "var(--ls-textFaint)", fontSize: 14, padding: "16px 0" }}>
          {filter === "active" ? "No active debts." : filter === "cleared" ? "Nothing settled yet." : "Nothing recorded yet."}
        </div>
      ) : sorted.map((d) => {
        const paid = paidFor(d.id);
        const total = owedFor(d);
        const remaining = total - paid;
        const cleared = d.status !== "active";
        const due = dueLabel(d.due_date);
        const pct = total > 0 ? Math.min(100, (paid / total) * 100) : 0;
        const isOwe = d.direction === "owe";
        const tint = isOwe ? "var(--ls-negative)" : "var(--ls-positive)";
        const list = payments[d.id] || [];
        const open = expanded === d.id;

        return (
          <Card key={d.id} style={{ opacity: cleared ? 0.65 : 1 }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
              <div style={{ width: 30, height: 30, borderRadius: 8, background: tint + "26", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                {isOwe ? <ArrowUpRight size={15} color={tint} /> : <ArrowDownLeft size={15} color={tint} />}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.counterparty}</span>
                  <span style={{ fontFamily: "ui-monospace, monospace", flexShrink: 0 }}>{fmt(total)}</span>
                </div>
                <div style={{ fontSize: 11, color: "var(--ls-textFaint)", marginTop: 2 }}>
                  {isOwe ? "You owe" : "Owes you"}
                  {d.total_repayable != null && Number(d.total_repayable) !== Number(d.principal) &&
                    ` · ${fmt(d.principal)} borrowed`}
                </div>
                {!cleared && (
                  <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: due.tone, marginTop: 4 }}>
                    {due.urgent && <AlertTriangle size={11} />}{due.text}
                  </div>
                )}
                {cleared && (
                  <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--ls-positive)", marginTop: 4 }}>
                    <Check size={11} />{d.status === "cleared" ? "Settled" : (isOwe ? "Forgiven by them" : "Written off")}
                  </div>
                )}
                {(d.expense_category || d.income_category) && (
                  <div style={{ fontSize: 10, color: "var(--ls-textDim)", marginTop: 4 }}>
                    {d.expense_category
                      ? `Payments post to ${d.expense_category}`
                      : `Repayments post to ${d.income_category}`}
                  </div>
                )}
              </div>
              {!readOnly && (
                <button onClick={() => { setDraft({
                  direction: d.direction, counterparty: d.counterparty, principal: String(d.principal),
                  total_repayable: d.total_repayable == null ? "" : String(d.total_repayable),
                  due_date: d.due_date || "", notes: d.notes || "",
                  expense_category: d.expense_category || "",
                  income_category: d.income_category || "",
                }); setEditing(d.id); setAdding(false); }} style={iconBtn}><Pencil size={13} /></button>
              )}
              {!readOnly && <button onClick={() => removeDebt(d)} style={{ ...iconBtn, color: "var(--ls-negative)" }}><Trash2 size={13} /></button>}
            </div>

            <div style={{ marginTop: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--ls-textDim)", marginBottom: 4 }}>
                <span style={{ fontFamily: "ui-monospace, monospace" }}>{fmt(paid)} paid</span>
                <span style={{ fontFamily: "ui-monospace, monospace", color: remaining <= 0 ? "var(--ls-positive)" : "var(--ls-text)" }}>
                  {remaining <= 0 ? "Cleared" : `${fmt(remaining)} left`}
                </span>
              </div>
              <div style={{ height: 6, background: "var(--ls-sunken)", borderRadius: 3, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${pct}%`, background: remaining <= 0 ? "var(--ls-positive)" : tint, borderRadius: 3 }} />
              </div>
            </div>

            {d.notes && <div style={{ fontSize: 11, color: "var(--ls-textFaint)", marginTop: 8 }}>{d.notes}</div>}

            {!readOnly && !cleared && (payingId === d.id ? (
              <form onSubmit={(e) => addPayment(d, e)} style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
                <input type="number" step="0.01" placeholder={`${isOwe ? "Payment" : "Amount received"} (${fmt(remaining)} left)`}
                  value={payForm.amount} onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })}
                  style={{ ...input, fontSize: 13 }} autoFocus required />
                <input type="datetime-local" value={payForm.date}
                  onChange={(e) => setPayForm({ ...payForm, date: e.target.value })} style={{ ...input, fontSize: 13 }} />
                <input placeholder="Transaction reference (optional)" value={payForm.reference}
                  onChange={(e) => setPayForm({ ...payForm, reference: e.target.value })} style={{ ...input, fontSize: 13 }} />
                <div style={{ display: "flex", gap: 6 }}>
                  <button type="button" onClick={() => setPayingId(null)} style={{ ...smallGhost, flex: 1 }}>Cancel</button>
                  <button type="submit" style={{ ...smallPrimary, flex: 2 }}>Record payment</button>
                </div>
              </form>
            ) : (
              <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
                <button onClick={() => { setPayForm({ amount: "", date: nowDT(), reference: "", note: "" }); setPayingId(d.id); }}
                  style={{ ...smallPrimary, flex: 2 }}>{isOwe ? "Record a payment" : "Record a repayment"}</button>
                <button onClick={() => setStatus(d.id, "written_off")} style={{ ...smallGhost, flex: 1 }}>
                  {isOwe ? "Forgiven" : "Write off"}
                </button>
              </div>
            ))}

            {!readOnly && cleared && (
              <button onClick={() => setStatus(d.id, "active")} style={{ ...smallGhost, marginTop: 10 }}>Reopen</button>
            )}

            {list.length > 0 && (
              <>
                <button onClick={() => setExpanded(open ? null : d.id)} style={{
                  ...smallGhost, marginTop: 10, display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                }}>
                  {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                  {list.length} payment{list.length === 1 ? "" : "s"}
                </button>
                {open && (
                  <div style={{ marginTop: 8 }}>
                    {list.map((p) => (
                      <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: "1px solid #1F2E4E" }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontFamily: "ui-monospace, monospace" }}>{fmt(p.amount)}</div>
                          <div style={{ fontSize: 10, color: "var(--ls-textFaint)" }}>{fmtDT(p.date)}</div>
                          {p.reference && <div style={{ fontSize: 10, color: "var(--ls-textDim)", fontFamily: "ui-monospace, monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Ref: {p.reference}</div>}
                        </div>
                        {!readOnly && <button onClick={() => removePayment(p)} style={{ ...iconBtn, color: "var(--ls-negative)" }}><Trash2 size={12} /></button>}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </Card>
        );
      })}

      <div style={{ fontSize: 11, color: "var(--ls-textFaint)", marginTop: 16, lineHeight: 1.5 }}>
        Payments on debts you owe post to {scope === "household" ? "household" : "personal"} expenses.
        Repayments you receive post to income. Both only if you pick a category.
        Personal and household stay separate - a personal debt never touches
        household records.
      </div>
    </div>
  );
}

const dirPill = (active, tint) => ({
  flex: 1, padding: "9px 0", fontSize: 12, borderRadius: 8, cursor: "pointer", fontFamily: "inherit",
  background: active ? tint + "26" : "transparent",
  color: active ? tint : "var(--ls-textFaint)",
  border: `1px solid ${active ? tint : "var(--ls-border)"}`,
});

import { useState } from "react";
import { Trash2, Plus, Pencil } from "lucide-react";
import { supabase } from "./supabaseClient";
import { iconFor, ICON_KEYS, PALETTE, fmt, fmtDT, termProblems, parseAmount } from "./lib";
import { SectionLabel, Banner, input, smallGhost, smallPrimary, iconBtn } from "./ui";

export function Settings({ householdId, household, categories, templates, people, terms, audit, reload, log }) {
  const [tab, setTab] = useState("categories");
  const tabs = [
    ["categories", "Expenses & budgets"],
    ["templates", "Quick entries"],
    ["people", "People"],
    ["cap", "Monthly cap"],
    ["terms", "Payment periods"],
    ["audit", "History"],
  ];
  return (
    <div style={{ marginBottom: 22, background: "var(--ls-surface2)", border: "1px solid var(--ls-border)", borderRadius: 12, padding: 16 }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
        {tabs.map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} style={{
            background: tab === k ? "var(--ls-border)" : "transparent", color: tab === k ? "var(--ls-text)" : "var(--ls-textFaint)",
            border: "1px solid var(--ls-border)", borderRadius: 6, padding: "6px 10px", fontSize: 12, cursor: "pointer",
          }}>{label}</button>
        ))}
      </div>
      {tab === "categories" && <CategoryManager householdId={householdId} categories={categories} reload={reload} log={log} />}
      {tab === "templates" && <TemplateManager householdId={householdId} categories={categories} templates={templates} people={people} reload={reload} log={log} />}
      {tab === "people" && <PeopleManager householdId={householdId} household={household} people={people} reload={reload} />}
      {tab === "cap" && <MonthlyCap household={household} reload={reload} />}
      {tab === "terms" && <TermManager householdId={householdId} terms={terms} reload={reload} />}
      {tab === "audit" && <AuditView audit={audit} />}
    </div>
  );
}

function CategoryManager({ householdId, categories, reload, log }) {
  const [editing, setEditing] = useState(null);
  const [adding, setAdding] = useState(false);
  // Every save/delete below now surfaces its error instead of failing
  // silently. A failed request with no visible message looks identical to
  // "the app won't let me" - which is exactly what was reported.
  const [error, setError] = useState(null);
  const blank = { name: "", icon_key: "more", color: PALETTE[0], budget_amount: "", budget_period: "", budget_rollover: true, exclude_from_total: false };
  const [draft, setDraft] = useState(blank);

  async function save(e) {
    e.preventDefault();
    if (!draft.name.trim()) return;
    const payload = {
      household_id: householdId,
      name: draft.name.trim(),
      icon_key: draft.icon_key,
      color: draft.color,
      budget_amount: draft.budget_amount === "" ? null : Number(draft.budget_amount),
      budget_period: draft.budget_period === "" ? null : draft.budget_period,
      budget_rollover: draft.budget_rollover,
      exclude_from_total: draft.exclude_from_total,
    };
    const { error: err } = editing
      ? await supabase.from("categories").update(payload).eq("id", editing)
      : await supabase.from("categories").insert(payload);
    if (err) {
      // The most common real cause: a category with this name already exists
      // in this household (names must be unique per household). Say so
      // plainly rather than showing Postgres's raw constraint wording.
      setError(
        /duplicate key|unique constraint/i.test(err.message)
          ? `A category named "${payload.name}" already exists.`
          : `Couldn't save: ${err.message}`
      );
      return;
    }
    setError(null);
    log(editing ? "edited" : "created", "category", `${payload.name}${payload.budget_amount ? ` — budget ${fmt(payload.budget_amount)}/${payload.budget_period}` : ""}`);
    setEditing(null); setAdding(false); setDraft(blank); reload();
  }

  // Categories with spending history are archived, never deleted. Deleting them
  // would drop the exclude_from_total flag, silently pulling historical fixed
  // costs into the discretionary monthly cap. Only an unused category is
  // actually removed.
  async function remove(c) {
    const { count } = await supabase
      .from("expenses")
      .select("id", { count: "exact", head: true })
      .eq("household_id", householdId)
      .eq("category", c.name);

    if (count > 0) {
      const ok = window.confirm(
        `"${c.name}" has ${count} expense${count === 1 ? "" : "s"} logged against it.\n\n` +
        `It will be archived rather than deleted: hidden when logging new expenses, ` +
        `but kept so past reports still add up correctly.`
      );
      if (!ok) return;
      const { error: err } = await supabase.from("categories").update({ archived: true }).eq("id", c.id);
      if (err) return setError(`Couldn't archive: ${err.message}`);
      setError(null); log("archived", "category", `${c.name} (${count} entries kept)`); reload();
      return;
    }

    const { error: err } = await supabase.from("categories").delete().eq("id", c.id);
    if (err) return setError(`Couldn't delete: ${err.message}`);
    setError(null); log("deleted", "category", c.name); reload();
  }

  async function restore(c) {
    const { error: err } = await supabase.from("categories").update({ archived: false }).eq("id", c.id);
    if (err) return setError(`Couldn't restore: ${err.message}`);
    setError(null); log("restored", "category", c.name); reload();
  }

  const Form = (
    <form onSubmit={save} style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10, padding: 10, background: "var(--ls-surface)", borderRadius: 8, border: "1px solid var(--ls-border)" }}>
      <input placeholder="Expense name (e.g. Water, Transport)" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} style={{ ...input, fontSize: 13 }} autoFocus required />
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {ICON_KEYS.map((k) => {
          const I = iconFor(k);
          return <button type="button" key={k} onClick={() => setDraft({ ...draft, icon_key: k })} style={{
            width: 30, height: 30, borderRadius: 6, cursor: "pointer",
            background: draft.icon_key === k ? draft.color + "44" : "transparent",
            border: `1px solid ${draft.icon_key === k ? draft.color : "var(--ls-border)"}`,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}><I size={14} color={draft.icon_key === k ? draft.color : "var(--ls-textFaint)"} /></button>;
        })}
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {PALETTE.map((c) => (
          <button type="button" key={c} onClick={() => setDraft({ ...draft, color: c })} style={{
            width: 24, height: 24, borderRadius: 5, background: c, cursor: "pointer",
            border: draft.color === c ? "2px solid #F4EFE4" : "1px solid var(--ls-border)",
          }} />
        ))}
      </div>
      <div style={{ fontSize: 11, color: "var(--ls-textFaint)" }}>Budget (optional — leave blank for no target)</div>
      <div style={{ display: "flex", gap: 6 }}>
        <input type="number" placeholder="Amount" value={draft.budget_amount} onChange={(e) => setDraft({ ...draft, budget_amount: e.target.value })} style={{ ...input, fontSize: 13 }} />
        <select value={draft.budget_period} onChange={(e) => setDraft({ ...draft, budget_period: e.target.value })} style={{ ...input, fontSize: 13 }}>
          <option value="">No budget</option>
          <option value="monthly">Per month</option>
          <option value="termly">Per term / period</option>
          <option value="yearly">Per year</option>
        </select>
      </div>
      {draft.budget_period && (
        <div style={{ background: "var(--ls-bg)", borderRadius: 6, padding: 10, display: "flex", flexDirection: "column", gap: 10 }}>
          <div>
            <div style={{ fontSize: 11, color: "var(--ls-textDim)", marginBottom: 6 }}>If you underpay or overpay one period</div>
            <div style={{ display: "flex", gap: 6 }}>
              <button type="button" onClick={() => setDraft({ ...draft, budget_rollover: true })}
                style={pill(draft.budget_rollover)}>Carries forward</button>
              <button type="button" onClick={() => setDraft({ ...draft, budget_rollover: false })}
                style={pill(!draft.budget_rollover)}>Resets each period</button>
            </div>
            <div style={{ fontSize: 10, color: "var(--ls-textFaint)", marginTop: 6, lineHeight: 1.5 }}>
              {draft.budget_rollover
                ? "An obligation - a shortfall is still owed next period, a credit reduces it. Use for rent, school fees."
                : "A spending cap - each period starts fresh at the full amount. Use for groceries, entertainment."}
            </div>
          </div>
          <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12, color: "var(--ls-textDim)", cursor: "pointer" }}>
            <input type="checkbox" checked={draft.exclude_from_total}
              onChange={(e) => setDraft({ ...draft, exclude_from_total: e.target.checked })}
              style={{ marginTop: 2 }} />
            <span>Leave out of the monthly spending cap
              <span style={{ display: "block", fontSize: 10, color: "var(--ls-textFaint)", marginTop: 2 }}>
                For fixed bills you can't cut back on, so the cap reflects money you can actually influence.
              </span>
            </span>
          </label>
        </div>
      )}
      <div style={{ display: "flex", gap: 6 }}>
        <button type="button" onClick={() => { setEditing(null); setAdding(false); setDraft(blank); }} style={{ ...smallGhost, flex: 1 }}>Cancel</button>
        <button type="submit" style={{ ...smallPrimary, flex: 2 }}>Save</button>
      </div>
    </form>
  );

  return (
    <div>
      <SectionLabel>Expenses & budgets</SectionLabel>
      {error && <Banner>{error}</Banner>}
      {categories.filter((c) => !c.archived).map((c) => {
        const I = iconFor(c.icon_key);
        return editing === c.id ? <div key={c.id}>{Form}</div> : (
          <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderBottom: "1px solid #1F2E4E" }}>
            <div style={{ width: 26, height: 26, borderRadius: 6, background: c.color + "33", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <I size={14} color={c.color} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14 }}>{c.name}</div>
              {c.budget_amount != null && (
                <div style={{ fontSize: 11, color: "var(--ls-textFaint)" }}>
                  {fmt(c.budget_amount)} per {c.budget_period === "termly" ? "term" : c.budget_period === "yearly" ? "year" : "month"}
                  {c.budget_rollover === false ? " - resets" : " - carries forward"}
                  {c.exclude_from_total ? " - outside cap" : ""}
                </div>
              )}
            </div>
            <button onClick={() => { setDraft({ name: c.name, icon_key: c.icon_key, color: c.color, budget_amount: c.budget_amount ?? "", budget_period: c.budget_period ?? "", budget_rollover: c.budget_rollover !== false, exclude_from_total: Boolean(c.exclude_from_total) }); setEditing(c.id); setAdding(false); }} style={iconBtn}><Pencil size={13} /></button>
            <button onClick={() => remove(c)} style={{ ...iconBtn, color: "var(--ls-negative)" }}><Trash2 size={13} /></button>
          </div>
        );
      })}
      {categories.some((c) => c.archived) && (
        <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid var(--ls-border)" }}>
          <div style={{ fontSize: 11, color: "var(--ls-textFaint)", marginBottom: 8 }}>
            Archived - hidden when logging, kept so past reports still add up
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

      {adding ? Form : (
        <button onClick={() => { setDraft(blank); setAdding(true); setEditing(null); }} style={{ ...smallGhost, marginTop: 10 }}>
          <Plus size={13} style={{ marginRight: 4, verticalAlign: -2 }} />Add an expense type
        </button>
      )}
    </div>
  );
}

function TemplateManager({ householdId, categories, templates, people, reload, log }) {
  const [adding, setAdding] = useState(false);
  const blank = { label: "", category: categories[0]?.name || "", amount: "", recipient: "", due_day: "" };
  const [draft, setDraft] = useState(blank);
  const [error, setError] = useState(null);

  async function save(e) {
    e.preventDefault();
    const amt = parseAmount(draft.amount);
    if (!draft.label.trim()) return;
    if (amt === null) return setError("Enter the amount as plain digits, e.g. 5000");
    const { error: err } = await supabase.from("templates").insert({
      household_id: householdId, label: draft.label.trim(), category: draft.category,
      amount: amt, recipient: draft.recipient,
      due_day: draft.due_day === "" ? null : Number(draft.due_day),
    });
    if (err) return setError(`Couldn't save: ${err.message}`);
    setError(null); log("created", "template", draft.label.trim()); setDraft(blank); setAdding(false); reload();
  }
  async function remove(t) {
    if (!window.confirm(`Delete the quick entry "${t.label}"? Expenses already logged with it are kept.`)) return;
    const { error: err } = await supabase.from("templates").delete().eq("id", t.id);
    if (err) return setError(`Couldn't delete: ${err.message}`);
    setError(null); log("deleted", "template", t.label); reload();
  }

  return (
    <div>
      <SectionLabel>Quick entries</SectionLabel>
      {error && <Banner>{error}</Banner>}
      <div style={{ fontSize: 12, color: "var(--ls-textFaint)", marginBottom: 10 }}>
        Saved amounts you pay regularly. They appear as one-tap buttons on the logging screen.
      </div>
      {templates.map((t) => (
        <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 0", borderBottom: "1px solid #1F2E4E" }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14 }}>{t.label}</div>
            <div style={{ fontSize: 11, color: "var(--ls-textFaint)" }}>{fmt(t.amount)} · {t.category}{t.due_day ? ` · due ${t.due_day}${t.due_day === 1 ? "st" : t.due_day === 2 ? "nd" : t.due_day === 3 ? "rd" : "th"}` : ""}</div>
          </div>
          <button onClick={() => remove(t)} style={{ ...iconBtn, color: "var(--ls-negative)" }}><Trash2 size={13} /></button>
        </div>
      ))}
      {adding ? (
        <form onSubmit={save} style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
          <input placeholder="Label (e.g. Monthly rent)" value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} style={{ ...input, fontSize: 13 }} autoFocus required />
          <input type="number" placeholder="Amount" value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })} style={{ ...input, fontSize: 13 }} required />
          <select value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} style={{ ...input, fontSize: 13 }}>
            {categories.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
          </select>
          <select value={draft.recipient} onChange={(e) => setDraft({ ...draft, recipient: e.target.value })} style={{ ...input, fontSize: 13 }}>
            <option value="">No specific person</option>
            {people.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
          </select>
          <div>
            <div style={{ fontSize: 11, color: "var(--ls-textFaint)", marginBottom: 4 }}>
              Day of the month it falls due (optional) - shows it on the bill calendar
            </div>
            <select value={draft.due_day} onChange={(e) => setDraft({ ...draft, due_day: e.target.value })} style={{ ...input, fontSize: 13 }}>
              <option value="">Not a dated bill</option>
              {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button type="button" onClick={() => setAdding(false)} style={{ ...smallGhost, flex: 1 }}>Cancel</button>
            <button type="submit" style={{ ...smallPrimary, flex: 2 }}>Save</button>
          </div>
        </form>
      ) : (
        <button onClick={() => { setDraft(blank); setAdding(true); }} style={{ ...smallGhost, marginTop: 10 }}>
          <Plus size={13} style={{ marginRight: 4, verticalAlign: -2 }} />Add a quick entry
        </button>
      )}
    </div>
  );
}

function PeopleManager({ householdId, household, people, reload }) {
  const [name, setName] = useState("");
  const [error, setError] = useState(null);
  async function add(e) {
    e.preventDefault();
    if (!name.trim()) return;
    const { error: err } = await supabase.from("people").insert({ household_id: householdId, name: name.trim() });
    if (err) return setError(`Couldn't add: ${err.message}`);
    setError(null); setName(""); reload();
  }

  async function removePerson(p) {
    // Past expenses store the person's name as text, so they keep their
    // attribution - but say so rather than letting it look like data loss.
    if (!window.confirm(`Remove "${p.name}"? Past entries that name them are kept.`)) return;
    const { error: err } = await supabase.from("people").delete().eq("id", p.id);
    if (err) return setError(`Couldn't remove: ${err.message}`);
    setError(null); reload();
  }
  return (
    <div>
      <SectionLabel>People</SectionLabel>
      {error && <Banner>{error}</Banner>}
      {people.map((p) => (
        <div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 0", borderBottom: "1px solid #1F2E4E" }}>
          <span style={{ fontSize: 14 }}>{p.name}</span>
          <button onClick={() => removePerson(p)} style={{ ...iconBtn, color: "var(--ls-negative)" }}><Trash2 size={13} /></button>
        </div>
      ))}
      <form onSubmit={add} style={{ display: "flex", gap: 6, marginTop: 10 }}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Add a person" style={{ ...input, fontSize: 13 }} />
        <button type="submit" style={{ ...smallPrimary, width: "auto", padding: "8px 16px" }}>Add</button>
      </form>
      {household?.invite_code && (
        <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid var(--ls-border)" }}>
          <div style={{ fontSize: 12, color: "var(--ls-textDim)", marginBottom: 4 }}>Invite someone to this household</div>
          <div style={{ fontSize: 20, fontFamily: "ui-monospace, monospace", color: "var(--ls-accent)", letterSpacing: "0.1em" }}>{household.invite_code}</div>
          <div style={{ fontSize: 11, color: "var(--ls-textFaint)", marginTop: 4 }}>
            They create an account, then choose "Have an invite code? Join instead".
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

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function TermManager({ householdId, terms, reload }) {
  const [draft, setDraft] = useState(null); // {id?, name, months}
  const [error, setError] = useState(null);
  const problems = termProblems(terms);

  async function save(e) {
    e.preventDefault();
    if (!draft.name.trim() || !draft.months.length) return;
    const payload = { household_id: householdId, name: draft.name.trim(), months: draft.months, sort_order: draft.sort_order ?? 100 };
    const { error: err } = draft.id
      ? await supabase.from("terms").update(payload).eq("id", draft.id)
      : await supabase.from("terms").insert(payload);
    if (err) return setError(`Couldn't save: ${err.message}`);
    setError(null); setDraft(null); reload();
  }

  async function removeTerm(t) {
    // Termly budgets are calculated from these periods, so removing one
    // changes what past termly categories were measured against.
    if (!window.confirm(`Delete "${t.name}"? Any termly budgets will be recalculated without it.`)) return;
    const { error: err } = await supabase.from("terms").delete().eq("id", t.id);
    if (err) return setError(`Couldn't delete: ${err.message}`);
    setError(null); reload();
  }

  const toggle = (m) => setDraft((d) => ({
    ...d, months: d.months.includes(m) ? d.months.filter((x) => x !== m) : [...d.months, m].sort((a, b) => a - b),
  }));

  return (
    <div>
      <SectionLabel>Payment periods</SectionLabel>
      {error && <Banner>{error}</Banner>}
      <div style={{ fontSize: 12, color: "var(--ls-textFaint)", marginBottom: 12, lineHeight: 1.5 }}>
        Only needed if you set a "per term" budget on an expense. Define however many
        periods your school uses — two semesters, three terms, four quarters. Leave
        this empty if it doesn't apply to you.
      </div>

      {problems.map((p, i) => (
        <div key={i} style={{ fontSize: 12, color: "var(--ls-negative)", background: "rgba(224,133,133,0.18)", padding: "8px 10px", borderRadius: 6, marginBottom: 8 }}>{p}</div>
      ))}

      {terms.length === 0 && !draft && (
        <div style={{ fontSize: 13, color: "var(--ls-textFaint)", marginBottom: 10 }}>No periods defined.</div>
      )}

      {terms.map((t) => draft?.id === t.id ? (
        <TermForm key={t.id} draft={draft} setDraft={setDraft} toggle={toggle} save={save} onCancel={() => setDraft(null)} />
      ) : (
        <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 0", borderBottom: "1px solid #1F2E4E" }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14 }}>{t.name}</div>
            <div style={{ fontSize: 11, color: "var(--ls-textFaint)" }}>
              {(t.months || []).length ? t.months.map((m) => MONTHS[m - 1]).join(", ") : "no months selected"}
            </div>
          </div>
          <button onClick={() => setDraft({ id: t.id, name: t.name, months: t.months || [], sort_order: t.sort_order })} style={iconBtn}><Pencil size={13} /></button>
          <button onClick={() => removeTerm(t)} style={{ ...iconBtn, color: "var(--ls-negative)" }}><Trash2 size={13} /></button>
        </div>
      ))}

      {draft && !draft.id && (
        <TermForm draft={draft} setDraft={setDraft} toggle={toggle} save={save} onCancel={() => setDraft(null)} />
      )}

      {!draft && (
        <button onClick={() => setDraft({ name: `Term ${terms.length + 1}`, months: [], sort_order: (terms.length + 1) * 10 })} style={{ ...smallGhost, marginTop: 10 }}>
          <Plus size={13} style={{ marginRight: 4, verticalAlign: -2 }} />Add a period
        </button>
      )}
    </div>
  );
}

function TermForm({ draft, setDraft, toggle, save, onCancel }) {
  return (
    <form onSubmit={save} style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10, padding: 10, background: "var(--ls-surface)", borderRadius: 8, border: "1px solid var(--ls-border)" }}>
      <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        placeholder="Name (e.g. Term 1, Semester 1)" style={{ ...input, fontSize: 13 }} autoFocus required />
      <div style={{ fontSize: 11, color: "var(--ls-textFaint)" }}>Months in this period</div>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        {MONTHS.map((m, i) => (
          <button key={m} type="button" onClick={() => toggle(i + 1)} style={{
            padding: "5px 8px", fontSize: 11, borderRadius: 5, cursor: "pointer",
            background: draft.months.includes(i + 1) ? "var(--ls-accent)" : "transparent",
            color: draft.months.includes(i + 1) ? "var(--ls-bg)" : "var(--ls-textFaint)",
            border: `1px solid ${draft.months.includes(i + 1) ? "var(--ls-accent)" : "var(--ls-border)"}`,
          }}>{m}</button>
        ))}
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <button type="button" onClick={onCancel} style={{ ...smallGhost, flex: 1 }}>Cancel</button>
        <button type="submit" style={{ ...smallPrimary, flex: 2 }}>Save period</button>
      </div>
    </form>
  );
}

function MonthlyCap({ household, reload }) {
  const [value, setValue] = useState(household?.monthly_budget ?? "");
  const [saved, setSaved] = useState(false);
  const [msg, setMsg] = useState(null);

  async function save() {
    let amount = null;
    if (value !== "") {
      amount = parseAmount(value);
      if (amount === null) return setMsg("Enter the cap as plain digits, e.g. 250000 - or leave blank for no cap.");
    }
    const { error } = await supabase.from("households").update({ monthly_budget: amount }).eq("id", household.id);
    if (error) return setMsg(error.message);
    setMsg(null); setSaved(true); reload(); setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div>
      <SectionLabel>Monthly spending cap</SectionLabel>
      <div style={{ fontSize: 12, color: "var(--ls-textFaint)", marginBottom: 12, lineHeight: 1.5 }}>
        Optional overall limit for the household each month. It resets every month -
        anything unspent is reported as savings for that month, not added to the next.
        Leave blank for no cap.
      </div>
      <input type="number" placeholder="Amount per month" value={value}
        onChange={(e) => setValue(e.target.value)} style={{ ...input, fontSize: 13, marginBottom: 10 }} />
      {msg && <div style={{ fontSize: 12, color: "var(--ls-negative)", marginBottom: 8 }}>{msg}</div>}
      <button onClick={save} style={smallPrimary}>{saved ? "Saved" : "Save cap"}</button>
      <div style={{ fontSize: 11, color: "var(--ls-textFaint)", marginTop: 10, lineHeight: 1.5 }}>
        Expenses marked "leave out of the monthly spending cap" are not counted
        towards it - set that per expense type under Expenses & budgets.
      </div>
    </div>
  );
}

function AuditView({ audit }) {
  return (
    <div>
      <SectionLabel>History</SectionLabel>
      {audit.length === 0 && <div style={{ fontSize: 13, color: "var(--ls-textFaint)" }}>No changes recorded yet.</div>}
      {audit.map((a) => (
        <div key={a.id} style={{ padding: "7px 0", borderBottom: "1px solid #1F2E4E" }}>
          <div style={{ fontSize: 13 }}>
            <span style={{ color: a.action === "deleted" ? "var(--ls-negative)" : a.action === "created" ? "var(--ls-positive)" : "var(--ls-warn)" }}>{a.action}</span>
            {" "}{a.entity} — {a.summary}
          </div>
          <div style={{ fontSize: 11, color: "var(--ls-textFaint)", marginTop: 2 }}>{a.user_email || "unknown"} · {fmtDT(a.created_at)}</div>
        </div>
      ))}
    </div>
  );
}

import { useState, useEffect } from "react";
import { Wallet, Users, Scale, ChevronRight, Check, Circle, Copy, RefreshCw, Plus } from "lucide-react";
import { supabase } from "./supabaseClient";
import { monthKey, monthLabel, fmt, nowDT } from "./lib";
import { Shell, SectionLabel, Banner, ghostBtn, smallGhost, smallPrimary } from "./ui";
import { Wordmark } from "./Brand";
import { getThemePreference, setThemePreference } from "./theme";
import { Ring, Sparkline, monthlyTotals, compareToHistory } from "./Charts";

// Landing screen. Stays useful after setup by showing this month's totals, so
// it isn't a wizard that becomes dead weight once both ledgers exist.
export function HomeScreen({ session, myHouseholds, isAdmin, onOpenPersonal, onOpenHousehold, onOpenDebts, onCreateOrJoin, onSignOut, onDeleteAccount }) {
  const [personal, setPersonal] = useState({ total: 0, income: 0, categories: 0, rows: [], loaded: false });
  const [household, setHousehold] = useState({ total: 0, categories: 0, rows: [], cap: null, loaded: false });
  const [debt, setDebt] = useState({ owe: 0, owed: 0, overdue: 0, any: false });
  const [themePref, setThemePref] = useState(getThemePreference());
  // What this person paid toward any household. The headline and the Personal
  // tile's Net both need it: without it the headline showed the household's
  // whole spend (not this person's), and Net counted all their income against
  // only their personal expenses.
  const [contributions, setContributions] = useState([]);
  const viewMonth = monthKey(nowDT());
  const primary = myHouseholds[0] || null;
  // Everything this person actually paid this month, personal and household
  // alike. The household tile still shows the household's own total separately.
  const paidToHouseholds = contributions
    .filter((r) => monthKey(r.date) === viewMonth)
    .reduce((s, r) => s + Number(r.amount), 0);
  const myTotalOut = personal.total + paidToHouseholds;

  useEffect(() => { loadPersonal(); loadDebts(); }, []);
  useEffect(() => { if (primary) loadHousehold(primary.id); else setHousehold({ total: 0, categories: 0, rows: [], cap: null, loaded: true }); }, [primary?.id]);

  async function loadPersonal() {
    const [c, e, i, hh] = await Promise.all([
      supabase.from("personal_categories").select("id").eq("user_id", session.user.id),
      supabase.from("personal_expenses").select("amount,date").eq("user_id", session.user.id),
      supabase.from("income").select("amount,date").eq("scope", "personal").eq("user_id", session.user.id),
      supabase.from("expenses").select("amount,date").eq("paid_by_user_id", session.user.id),
    ]);
    const inMonth = (rows) => (rows || []).filter((x) => monthKey(x.date) === viewMonth).reduce((s, x) => s + Number(x.amount), 0);
    setPersonal({ total: inMonth(e.data), income: inMonth(i.data), categories: (c.data || []).length, rows: e.data || [], loaded: true });
    setContributions(hh.data || []);
  }

  // Debts are personal-only now - query scope='personal' directly rather than
  // fetching everything and filtering, since household-scope rows shouldn't
  // exist going forward.
  async function loadDebts() {
    const { data } = await supabase.from("debts").select("*")
      .eq("scope", "personal").eq("user_id", session.user.id).eq("status", "active");
    const mine = data || [];
    if (!mine.length) return setDebt({ owe: 0, owed: 0, overdue: 0, any: false });
    const { data: pays } = await supabase.from("debt_payments").select("debt_id,amount").in("debt_id", mine.map((d) => d.id));
    const paid = {};
    (pays || []).forEach((p) => { paid[p.debt_id] = (paid[p.debt_id] || 0) + Number(p.amount); });
    const rem = (d) => Math.max(0, Number(d.total_repayable ?? d.principal) - (paid[d.id] || 0));
    const today = new Date(); today.setHours(0, 0, 0, 0);
    setDebt({
      owe: mine.filter((d) => d.direction === "owe").reduce((s, d) => s + rem(d), 0),
      owed: mine.filter((d) => d.direction === "owed").reduce((s, d) => s + rem(d), 0),
      overdue: mine.filter((d) => d.due_date && new Date(d.due_date + "T00:00:00") < today && rem(d) > 0).length,
      any: true,
    });
  }

  // Household income was removed by design - only the categories and expenses
  // queries remain here.
  async function loadHousehold(id) {
    const [c, e] = await Promise.all([
      supabase.from("categories").select("id,name,exclude_from_total").eq("household_id", id),
      supabase.from("expenses").select("amount,date,category").eq("household_id", id),
    ]);
    const inMonth = (rows) => (rows || []).filter((x) => monthKey(x.date) === viewMonth).reduce((s, x) => s + Number(x.amount), 0);
    // The ring measures spend against the cap, so it must respect the same
    // exclusions the cap itself uses - otherwise rent fills the ring instantly.
    const excluded = new Set((c.data || []).filter((x) => x.exclude_from_total).map((x) => x.name));
    const capRows = (e.data || []).filter((x) => monthKey(x.date) === viewMonth && !excluded.has(x.category));
    setHousehold({
      total: inMonth(e.data),
      cappedSpend: capRows.reduce((s, x) => s + Number(x.amount), 0),
      cap: primary?.monthly_budget ?? null,
      categories: (c.data || []).length,
      rows: e.data || [],
      loaded: true,
    });
  }

  const Tile = ({ icon: Icon, tint, label, sub, total, income, alsoOut = 0, trend, ready, onClick, cta }) => (
    <button onClick={onClick} style={{
      width: "100%", textAlign: "left", background: "var(--ls-surface)", border: "1px solid var(--ls-border)",
      borderRadius: 14, padding: 16, marginBottom: 12, cursor: "pointer", fontFamily: "inherit", color: "var(--ls-text)",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: ready ? 10 : 6 }}>
        <div style={{ width: 34, height: 34, borderRadius: 9, background: tint + "33", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <Icon size={17} color={tint} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 500 }}>{label}</div>
          <div style={{ fontSize: 12, color: "var(--ls-textFaint)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sub}</div>
        </div>
        <ChevronRight size={18} color="var(--ls-textFaintest)" />
      </div>
      {ready ? (
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 10, color: "var(--ls-textFaint)" }}>Spent</div>
            <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 19, color: "var(--ls-accent)", fontVariantNumeric: "tabular-nums" }}>{fmt(total)}</div>
          </div>
          {income > 0 && (
            <>
              <div>
                <div style={{ fontSize: 10, color: "var(--ls-textFaint)" }}>In</div>
                <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 19, color: "var(--ls-positive)", fontVariantNumeric: "tabular-nums" }}>{fmt(income)}</div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: "var(--ls-textFaint)" }}>Net</div>
                <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 19, color: income - (total + alsoOut) >= 0 ? "var(--ls-positive)" : "var(--ls-negative)", fontVariantNumeric: "tabular-nums" }}>
                  {fmt(Math.abs(income - (total + alsoOut)))}
                </div>
              </div>
            </>
          )}
        </div>
      ) : (
        <div style={{ fontSize: 13, color: "var(--ls-accent)" }}>{cta}</div>
      )}
      {ready && trend && trend.length > 1 && (
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginTop: 10 }}>
          <Sparkline data={trend} color={tint} />
          <span style={{ fontSize: 9, color: "var(--ls-textFaintest)" }}>6-month trend</span>
        </div>
      )}
    </button>
  );

  return (
    <Shell>
      <div style={{ marginBottom: 22 }}>
        <Wordmark />
        <div style={{ fontSize: 14, color: "var(--ls-textFaint)", marginTop: 10 }}>
          {isAdmin ? `Administrator · ${monthLabel(viewMonth)}` : monthLabel(viewMonth)}
        </div>
      </div>

      {/* A spending cap is optional. With one, the ring measures against it.
          Without, the same space compares this month to the recent average -
          which needs no setup at all, so a brand new household still gets a
          headline figure instead of a blank space. */}
      {/* Shown whenever there is anything to show. Gating this on household
          categories meant someone using the app for personal spending only got
          no headline figure at all. */}
      {!isAdmin && (household.categories > 0 || personal.categories > 0) && (
        <div style={{ marginBottom: 20 }}>
          {household.cap > 0 ? (
            <Ring
              value={household.cappedSpend || 0}
              max={household.cap}
              label={fmt(household.cappedSpend || 0)}
              sublabel={`of ${fmt(household.cap)} cap`}
              footnote={
                household.cap - (household.cappedSpend || 0) >= 0
                  ? `${fmt(household.cap - (household.cappedSpend || 0))} left`
                  : `${fmt((household.cappedSpend || 0) - household.cap)} over`
              }
            />
          ) : (
            <div style={{ textAlign: "center", padding: "8px 0 4px" }}>
              {/* This is what YOU paid out - personal plus your share of any
                  household - not the household's own total, which has its own
                  tile below. Labelled explicitly so the two aren't confused. */}
              <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 34, color: "var(--ls-accent)", fontVariantNumeric: "tabular-nums" }}>
                {fmt(myTotalOut)}
              </div>
              <div style={{ fontSize: 11, color: "var(--ls-textFaint)", marginTop: 2 }}>
                you paid out this month
              </div>
              {paidToHouseholds > 0 && (
                <div style={{ fontSize: 10.5, color: "var(--ls-textFaintest)", marginTop: 3 }}>
                  {fmt(personal.total)} personal &middot; {fmt(paidToHouseholds)} household
                </div>
              )}
              {(() => {
                // Compared against the same measure shown above - this person's
                // own outlay - not the household's total, or the percentage
                // would describe a different number than the one displayed.
                const myRows = [...personal.rows, ...contributions];
                const cmp = compareToHistory(myRows, myTotalOut, viewMonth);
                if (!cmp) return null;
                if (cmp.same) return (
                  <div style={{ fontSize: 12, color: "var(--ls-textFaint)", marginTop: 6 }}>
                    about the same as {cmp.basis}
                  </div>
                );
                return (
                  <div style={{ fontSize: 12, marginTop: 6, color: cmp.higher ? "var(--ls-warn)" : "var(--ls-positive)" }}>
                    {cmp.pct}% {cmp.higher ? "more" : "less"} than {cmp.basis}
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      )}

      {/* An administrator account has no ledger of its own - every tile points
          at somebody else's records, read-only, and must never invite it to
          create categories, join a household, or record a debt. */}
      <Tile
        icon={Wallet} tint="var(--ls-info)" label="Personal"
        sub={isAdmin ? "View any person's ledger, read-only" : "Only you can see these"}
        total={personal.total} income={personal.income} alsoOut={paidToHouseholds}
        trend={isAdmin ? null : monthlyTotals(personal.rows, viewMonth)}
        ready={isAdmin ? false : personal.categories > 0}
        cta={isAdmin ? "Choose a person to view" : "Set up your categories to get started"}
        onClick={onOpenPersonal}
      />

      {/* Shown only to someone who is actually in a household, or to an
          administrator browsing them. Deriving this from real membership rather
          than asking at sign-up means it can never disagree with reality - and
          it appears on its own the moment someone joins one. */}
      {(primary || isAdmin) && (
        <Tile
          icon={Users} tint="var(--ls-info)"
          label={primary ? primary.name : "Households"}
          sub={primary ? "Shared with your household members" : "View any household, read-only"}
          total={household.total}
          trend={isAdmin ? null : monthlyTotals(household.rows, viewMonth)}
          ready={Boolean(primary) && household.categories > 0}
          cta={primary ? "Add expense types to get started" : "Browse households"}
          onClick={onOpenHousehold}
        />
      )}

      <button onClick={onOpenDebts} style={{
        width: "100%", textAlign: "left", background: "var(--ls-surface)", border: "1px solid var(--ls-border)",
        borderRadius: 14, padding: 16, marginBottom: 12, cursor: "pointer", fontFamily: "inherit", color: "var(--ls-text)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: debt.any ? 10 : 6 }}>
          <div style={{ width: 34, height: 34, borderRadius: 9, background: "#B8863B33", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Scale size={17} color="var(--ls-accent)" />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 500 }}>Debts</div>
            <div style={{ fontSize: 12, color: "var(--ls-textFaint)" }}>
              {isAdmin
                ? "View any person's debts, read-only"
                : debt.overdue > 0 ? `${debt.overdue} overdue` : "What you owe and what you're owed"}
            </div>
          </div>
          <ChevronRight size={18} color="var(--ls-textFaintest)" />
        </div>
        {isAdmin ? (
          <div style={{ fontSize: 13, color: "var(--ls-accent)" }}>Choose a person to view</div>
        ) : debt.any ? (
          <div style={{ display: "flex", gap: 16 }}>
            <div>
              <div style={{ fontSize: 10, color: "var(--ls-textFaint)" }}>You owe</div>
              <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 17, color: debt.owe > 0 ? "var(--ls-negative)" : "var(--ls-positive)" }}>{fmt(debt.owe)}</div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: "var(--ls-textFaint)" }}>Owed to you</div>
              <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 17, color: "var(--ls-positive)" }}>{fmt(debt.owed)}</div>
            </div>
          </div>
        ) : (
          <div style={{ fontSize: 13, color: "var(--ls-accent)" }}>Record a debt to start tracking</div>
        )}
      </button>

      {/* Deliberately quiet - a plain line, not a button. Someone who doesn't
          use households shouldn't be sold one, but it has to remain findable,
          and it's now the ONLY route in for anyone not already in a household
          since the tile above is hidden from them. */}
      {!isAdmin && (
        <button
          onClick={onCreateOrJoin}
          style={{
            width: "100%", textAlign: "left", background: "transparent", border: "none",
            color: "var(--ls-textFaintest)", fontFamily: "inherit", fontSize: 12.5,
            padding: "10px 2px", marginTop: 2, cursor: "pointer",
          }}
        >
          <Plus size={12} style={{ marginRight: 5, verticalAlign: -2 }} />
          {myHouseholds.length === 0
            ? "Create or join a household"
            : myHouseholds.length > 1
              ? `Create or join another (you're in ${myHouseholds.length})`
              : "Create or join another household"}
        </button>
      )}

      <button onClick={onSignOut} style={{ ...ghostBtn, marginTop: 24, fontSize: 13, padding: "10px 0" }}>
        Sign out
      </button>

      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 18 }}>
        <span style={{ fontSize: 11, color: "var(--ls-textFaint)", marginRight: 2 }}>Appearance</span>
        {[["system", "Auto"], ["light", "Light"], ["dark", "Dark"]].map(([key, label]) => (
          <button key={key} onClick={() => { setThemePreference(key); setThemePref(key); }} style={{
            flex: 1, padding: "7px 0", fontSize: 11, borderRadius: 6, cursor: "pointer", fontFamily: "inherit",
            background: themePref === key ? "var(--ls-accent)" : "transparent",
            color: themePref === key ? "var(--ls-accentInk)" : "var(--ls-textFaint)",
            border: `1px solid ${themePref === key ? "var(--ls-accent)" : "var(--ls-border)"}`,
          }}>{label}</button>
        ))}
      </div>

      {onDeleteAccount && !isAdmin && (
        <button onClick={onDeleteAccount} style={{
          width: "100%", marginTop: 10, background: "transparent", color: "var(--ls-negative)",
          border: "1px solid #4A2020", borderRadius: 12, padding: "10px 0", fontSize: 12, cursor: "pointer", fontFamily: "inherit",
        }}>
          Delete my account
        </button>
      )}

      <div style={{ marginTop: 28, paddingTop: 18, borderTop: "1px solid #1F2E4E", textAlign: "center" }}>
        <div style={{ fontSize: 11, color: "var(--ls-textFaintest)", letterSpacing: "0.04em" }}>
          Ledger Sawa is a product owned by Alcorp Holdings Ltd.
        </div>
      </div>
    </Shell>
  );
}

// Shown inside the household ledger until it's set up. Nothing here blocks
// anything else - the order is the user's choice.
export function HouseholdChecklist({ household, categoriesCount, peopleCount, memberCount, onAddCategories, onAddPeople, reload }) {
  const [code, setCode] = useState(household?.invite_code);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  useEffect(() => { setCode(household?.invite_code); }, [household?.invite_code]);

  const joinLink = `${window.location.origin}/?join=${code}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(joinLink);
      setCopied(true); setTimeout(() => setCopied(false), 2000);
    } catch {
      setMsg("Couldn't copy automatically - select the link and copy it manually.");
    }
  }

  async function regenerate() {
    if (!window.confirm("Generate a new code? The current one stops working immediately, and anyone who has it will not be able to join.")) return;
    setBusy(true); setMsg(null);
    const { data, error } = await supabase.rpc("regenerate_invite_code", { p_household_id: household.id });
    setBusy(false);
    if (error) return setMsg(error.message);
    setCode(data);
    reload();
  }

  const Item = ({ done, label, detail, action, onAction }) => (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 0", borderBottom: "1px solid #1F2E4E" }}>
      {done
        ? <Check size={16} color="var(--ls-positive)" style={{ marginTop: 2, flexShrink: 0 }} />
        : <Circle size={16} color="var(--ls-textFaintest)" style={{ marginTop: 2, flexShrink: 0 }} />}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, color: done ? "var(--ls-textDim)" : "var(--ls-text)" }}>{label}</div>
        <div style={{ fontSize: 11, color: "var(--ls-textFaint)", marginTop: 2 }}>{detail}</div>
      </div>
      {!done && action && (
        <button onClick={onAction} style={{ ...smallPrimary, width: "auto", padding: "6px 12px", fontSize: 12 }}>{action}</button>
      )}
    </div>
  );

  return (
    <div style={{ marginBottom: 22, background: "var(--ls-surface2)", border: "1px solid var(--ls-border)", borderRadius: 12, padding: 16 }}>
      <SectionLabel>Getting set up</SectionLabel>
      <div style={{ fontSize: 12, color: "var(--ls-textFaint)", marginBottom: 10, lineHeight: 1.5 }}>
        Do these in any order. You can start logging as soon as you have one expense type.
      </div>

      <Item
        done={categoriesCount > 0}
        label="Add your expense types"
        detail={categoriesCount > 0 ? `${categoriesCount} set up` : "Rent, groceries, electricity - whatever this household actually spends on"}
        action="Add" onAction={onAddCategories}
      />
      <Item
        done={peopleCount > 0}
        label="Add the people in this household"
        detail={peopleCount > 0 ? `${peopleCount} added` : "Optional - lets you tag who an expense was for"}
        action="Add" onAction={onAddPeople}
      />
      <Item
        done={memberCount > 1}
        label="Invite the others"
        detail={memberCount > 1 ? `${memberCount} accounts have access` : "Share the link below so they can join with their own login"}
      />

      <div style={{ marginTop: 14, padding: 12, background: "var(--ls-surface)", borderRadius: 8, border: "1px solid var(--ls-border)" }}>
        <div style={{ fontSize: 11, color: "var(--ls-textFaint)", marginBottom: 6 }}>Invite link</div>
        <div style={{ fontSize: 12, fontFamily: "ui-monospace, monospace", color: "var(--ls-info)", wordBreak: "break-all", marginBottom: 4 }}>
          {joinLink}
        </div>
        <div style={{ fontSize: 11, color: "var(--ls-textFaint)", marginBottom: 10 }}>
          Code: <strong style={{ color: "var(--ls-accent)", letterSpacing: "0.08em" }}>{code}</strong>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={copy} style={{ ...smallGhost, flex: 1 }}>
            <Copy size={12} style={{ marginRight: 4, verticalAlign: -2 }} />{copied ? "Copied" : "Copy link"}
          </button>
          <button onClick={regenerate} disabled={busy} style={{ ...smallGhost, flex: 1, opacity: busy ? 0.5 : 1 }}>
            <RefreshCw size={12} style={{ marginRight: 4, verticalAlign: -2 }} />New code
          </button>
        </div>
        <div style={{ fontSize: 11, color: "var(--ls-textFaint)", marginTop: 8, lineHeight: 1.5 }}>
          Anyone with this link can join and read everything in this household.
          Generate a new code if it ends up somewhere it shouldn't.
        </div>
        {msg && <div style={{ marginTop: 8 }}><Banner>{msg}</Banner></div>}
      </div>
    </div>
  );
}

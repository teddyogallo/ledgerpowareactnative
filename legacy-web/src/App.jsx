import { useState, useEffect, useCallback, useRef } from "react";
import {
  Plus, Trash2, Pencil, ChevronLeft, ChevronRight, FileText, WifiOff, LogOut,
  Settings as Cog, Shield, Search, Download, Printer, CloudOff, Zap, CalendarDays,
} from "lucide-react";
import { supabase, configError } from "./supabaseClient";
import { AuthScreen, SetNewPassword, useRecoveryMode } from "./Auth";
import { Settings } from "./Settings";
import { PersonalLedger } from "./Personal";
import { HomeScreen, HouseholdChecklist } from "./Home";
import { DebtTracker } from "./Debts";
import { IncomeLedger } from "./Income";
import { buildBreakdown } from "./breakdown";
import { MonthBars, monthlyTotals } from "./Charts";
import { BillCalendar } from "./Bills";
import { iconFor, monthKey, monthLabel, fmt, nowDT, toDTLocal, fmtDT, readQueue, writeQueue, enqueue, clearQueue, toCSV, downloadFile, printReport, computeBudget, budgetPhrase, computeMonthlyTotal, localToISO, setCurrency, parseAmount } from "./lib";
import {
  Shell, Card, SectionLabel, Row, Big, Banner, toggleBtn, iconBtn, input,
  primaryBtn, ghostBtn, smallGhost, smallPrimary,
} from "./ui";

// A join link looks like  https://theapp/?join=A1B2C3
// Read once at startup and remembered through signup, so a new user who arrives
// from an invite is placed in that household automatically.
function readJoinCode() {
  try {
    const p = new URLSearchParams(window.location.search).get("join");
    if (p) {
      sessionStorage.setItem("pending-join-code", p.trim().toUpperCase());
      window.history.replaceState({}, "", window.location.pathname);
    }
    return sessionStorage.getItem("pending-join-code");
  } catch {
    return null;
  }
}

export default function App() {
  const [session, setSession] = useState(null);
  const [booting, setBooting] = useState(true);
  const [recovery, setRecovery] = useRecoveryMode();

  // Shown instead of a blank page when the deployment's environment variables
  // are missing or still set to example values.
  if (configError) {
    return (
      <Shell>
        <div style={{ fontSize: 12, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--ls-negative)", marginBottom: 6 }}>
          Not configured
        </div>
        <h1 style={{ fontSize: 22, margin: "0 0 14px", fontWeight: 500 }}>The app can't reach its database</h1>
        <Banner>{configError}</Banner>
        <div style={{ fontSize: 13, color: "var(--ls-textDim)", lineHeight: 1.6 }}>
          Fix it in Vercel: <strong>Settings → Environment Variables</strong>. You need
          exactly two, named <code>VITE_SUPABASE_URL</code> and{" "}
          <code>VITE_SUPABASE_ANON_KEY</code>. Get their values from Supabase under{" "}
          <strong>Project Settings → API Keys</strong> — the project URL, and the
          publishable key.
          <br /><br />
          After saving, you must <strong>redeploy</strong> — saving alone does not
          update the live site.
        </div>
      </Shell>
    );
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setBooting(false); });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (booting) return <Shell><div style={{ color: "var(--ls-textFaint)" }}>Loading…</div></Shell>;
  if (recovery) return <SetNewPassword onDone={() => setRecovery(false)} />;
  if (!session) return <AuthScreen />;
  return <Main session={session} />;
}

function Main({ session }) {
  const [household, setHousehold] = useState(null);
  const [myHouseholds, setMyHouseholds] = useState([]);
  const [forceSetup, setForceSetup] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [allHouseholds, setAllHouseholds] = useState([]);
  const [viewingId, setViewingId] = useState(null);
  const [booted, setBooted] = useState(false);
  const [loadFailed, setLoadFailed] = useState(null);
  const [mode, setMode] = useState("home"); // home | household | personal | debts
  const [personalCats, setPersonalCats] = useState([]);
  const [ledgerView, setLedgerView] = useState("expenses"); // expenses | income
  const [incomeCats, setIncomeCats] = useState([]);
  const [personalMonth, setPersonalMonth] = useState(monthKey(nowDT()));
  const [pendingJoin, setPendingJoin] = useState(null);
  const [allUsers, setAllUsers] = useState([]);
  const [viewingUserId, setViewingUserId] = useState(null);

  const [people, setPeople] = useState([]);
  const [categories, setCategories] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [terms, setTerms] = useState([]);
  const [entries, setEntries] = useState([]);
  const [obligations, setObligations] = useState([]);
  const [audit, setAudit] = useState([]);
  const [memberCount, setMemberCount] = useState(1);
  const [members, setMembers] = useState([]);
  const [error, setError] = useState(null);
  const [online, setOnline] = useState(navigator.onLine);
  const [pending, setPending] = useState(readQueue().length);

  const [viewMonth, setViewMonth] = useState(monthKey(nowDT()));
  const [showForm, setShowForm] = useState(false);
  const [showObl, setShowObl] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [showBills, setShowBills] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ amount: "", category: "", recipient: "", note: "", reference: "", date: nowDT(), paid_by_user_id: "", template_id: null });
  const [showNewObl, setShowNewObl] = useState(false);
  const [oblForm, setOblForm] = useState({ title: "", category: "", totalAmount: "" });
  const [payingId, setPayingId] = useState(null);
  const [payForm, setPayForm] = useState({ amount: "", date: nowDT(), reference: "" });

  const activeId = viewingId || household?.id;
  // Read-only unless the signed-in user is genuinely a member of the household
  // being viewed. An admin browsing another family can look but not touch.
  const readOnly = !myHouseholds.some((h) => h.id === activeId);
  const activeHousehold = viewingId ? allHouseholds.find((h) => h.id === viewingId) : household;

  const log = useCallback(async (action, entity, summary) => {
    if (!activeId || readOnly) return;
    await supabase.from("audit_log").insert({
      household_id: activeId, user_id: session.user.id, user_email: session.user.email,
      action, entity, summary,
    });
  }, [activeId, readOnly, session]);

  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);

  useEffect(() => { bootstrap(); }, []);
  useEffect(() => { setCurrency(activeHousehold?.currency); }, [activeHousehold?.currency]);
  // Debts and their income-category posting are personal-only now, so this no
  // longer needs to branch on scope.
  // These belong to the signed-in account, not to whichever tab is open, so
  // they're fetched once rather than on every tab switch. Re-fetching two
  // tables on each tap was the cause of the delay when moving between tabs.
  useEffect(() => {
    (async () => {
      const [pc, ic] = await Promise.all([
        supabase.from("personal_categories").select("id,name")
          .eq("user_id", session.user.id).order("sort_order"),
        supabase.from("income_categories").select("id,name")
          .eq("scope", "personal").eq("user_id", session.user.id).order("sort_order"),
      ]);
      setPersonalCats(pc.data || []);
      setIncomeCats(ic.data || []);
    })();
  }, [session.user.id]);
  useEffect(() => {
    if (!activeId) return;
    // Switching households invalidates anything half-entered, and a category
    // selected in one household may not exist in the next.
    setShowForm(false); setEditingId(null); setPayingId(null);
    setShowNewObl(false); setSearch("");
    setForm({ amount: "", category: "", recipient: "", note: "", reference: "", date: nowDT() });
    loadAll();
  }, [activeId]);
  useEffect(() => { if (online && pending > 0 && activeId) flushQueue(); }, [online, activeId, pending]);
  useEffect(() => () => clearTimeout(retryTimer.current), []);

  async function deleteAccount() {
    const typed = window.prompt(
      "This permanently deletes your account, your personal records, and any household left with no other members. It cannot be undone.\n\nType DELETE to confirm."
    );
    if (typed !== "DELETE") return;
    const { error: err } = await supabase.rpc("delete_my_account");
    if (err) { setLoadFailed("Couldn't delete the account: " + err.message); return; }
    await supabase.auth.signOut();
  }

  async function bootstrap() {
    const { data: adminRow } = await supabase.from("admins").select("user_id").eq("user_id", session.user.id).maybeSingle();
    setIsAdmin(Boolean(adminRow));
    // A person can belong to more than one household (e.g. their own family
    // plus a shared tracker with someone else), so load all memberships.
    // If this account arrived from an invite link, join before loading, so the
    // household appears immediately rather than after a manual step.
    // Admin accounts are read-only and must never hold real household
    // membership - the database rejects this too, but skipping it client-side
    // avoids a confusing "join failed" message for an admin who happens to
    // open a household invite link.
    const code = readJoinCode();
    if (code && !adminRow) {
      const { error: joinErr } = await supabase.rpc("join_household", { p_code: code });
      try { sessionStorage.removeItem("pending-join-code"); } catch { /* ignore */ }
      setPendingJoin(joinErr ? { failed: true, code, message: joinErr.message } : { joined: true, code });
    } else if (code) {
      try { sessionStorage.removeItem("pending-join-code"); } catch { /* ignore */ }
    }

    const { data: mems, error: memErr } = await supabase
      .from("household_members").select("households(*)").eq("user_id", session.user.id);
    if (memErr) {
      // Never conclude "no households" from a failed query — that would prompt
      // the user to create a duplicate of one they already have.
      setLoadFailed(memErr.message);
      setBooted(true);
      return;
    }
    setLoadFailed(null);
    const mine = (mems || []).map((m) => m.households).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
    setMyHouseholds(mine);
    // Reconcile against the fresh list rather than the value captured when this
    // function was created — otherwise creating a second household can leave
    // the app with no active household selected.
    setHousehold((prev) => mine.find((h) => h.id === prev?.id) || mine[0] || null);
    if (adminRow) {
      const { data: hs } = await supabase.from("households").select("*").order("name");
      setAllHouseholds(hs || []);
      const { data: us } = await supabase.rpc("admin_list_users");
      setAllUsers(us || []);
    }
    setBooted(true);
  }

  // Guards against out-of-order responses. Switching households quickly can
  // leave an earlier request in flight; without this, the slower response can
  // land last and render one household's figures under another's name.
  const loadSeq = useRef(0);

  async function loadAll() {
    const seq = ++loadSeq.current;
    const requestedFor = activeId;
    const [p, c, t, e, o, a, tm, mc, ml] = await Promise.all([
      supabase.from("people").select("*").eq("household_id", activeId).order("name"),
      supabase.from("categories").select("*").eq("household_id", activeId).order("sort_order"),
      supabase.from("templates").select("*").eq("household_id", activeId).order("created_at"),
      supabase.from("expenses").select("*").eq("household_id", activeId).order("date", { ascending: false }),
      supabase.from("obligations").select("*").eq("household_id", activeId).order("created_at", { ascending: false }),
      supabase.from("audit_log").select("*").eq("household_id", activeId).order("created_at", { ascending: false }).limit(100),
      supabase.from("terms").select("*").eq("household_id", activeId).order("sort_order"),
      supabase.from("household_members").select("id").eq("household_id", activeId),
      // Runs alongside the rest rather than after it. As a separate sequential
      // call this added a full round-trip to every household load, and its
      // error was discarded - so if it failed, the "Paid by" feature silently
      // vanished with no way to tell why.
      supabase.rpc("household_member_list", { p_household_id: activeId }),
    ]);
    // A newer request has started, or the household changed while this was in
    // flight - discard rather than overwrite fresher data.
    if (seq !== loadSeq.current || requestedFor !== activeId) return;

    // If a schema step was missed, the table won't exist and every read against
    // it fails. Say which one rather than rendering an empty, broken-looking app.
    const named = [["people", p], ["categories", c], ["templates", t],
                   ["expenses", e], ["obligations", o], ["audit_log", a], ["terms", tm]];
    const absent = named.filter(([, r]) => r.error && /does not exist|schema cache/i.test(r.error.message || ""));
    if (absent.length) {
      setError(`Database setup incomplete — missing: ${absent.map(([n]) => n).join(", ")}. Re-run the schema files (they're safe to run again).`);
    } else {
      const failed = named.filter(([, r]) => r.error);
      setError(failed.length ? `Couldn't load ${failed.map(([n]) => n).join(", ")}. Check your connection.` : null);
    }

    setPeople(p.data || []);
    setCategories(c.data || []);
    setTemplates(t.data || []);
    setEntries(e.data || []);
    setObligations(o.data || []);
    setAudit(a.data || []);
    setTerms(tm.data || []);
    setMemberCount((mc.data || []).length || 1);
    if (ml.error) {
      setError(`Couldn't load household members, so "Paid by" is unavailable: ${ml.error.message}`);
    }
    setMembers(ml.data || []);
    if (c.data?.length) {
      setForm((f) => ({ ...f, category: f.category || c.data[0].name }));
      setOblForm((f) => ({ ...f, category: f.category || c.data[0].name }));
    }
  }

  // Guards against two flushes running at once - the online event can fire more
  // than once in quick succession, and a double run would insert each queued
  // entry twice.
  const flushing = useRef(false);
  const retryTimer = useRef(null);

  async function flushQueue() {
    if (flushing.current) return;
    const q = readQueue();
    if (!q.length) return;
    flushing.current = true;
    let failed = [];
    try {
      for (const op of q) {
        const { error: err } = await supabase.from(op.table).insert(op.payload);
        if (err) failed.push(op);
      }
      if (failed.length) writeQueue(failed);
      else clearQueue();
      setPending(failed.length);
      loadAll();
    } finally {
      flushing.current = false;
    }

    // A partial failure while online would otherwise strand those entries until
    // the app was reloaded, because the sync effect only re-runs when
    // connectivity changes. Retry on a delay instead.
    if (failed.length && navigator.onLine) {
      clearTimeout(retryTimer.current);
      retryTimer.current = setTimeout(() => flushQueue(), 30000);
    }
  }

  if (!booted) return <Shell><div style={{ color: "var(--ls-textFaint)" }}>Loading…</div></Shell>;
  if (loadFailed) {
    return (
      <Shell>
        <h1 style={{ fontSize: 22, margin: "0 0 14px", fontWeight: 500 }}>Couldn't load your households</h1>
        <Banner>{loadFailed}</Banner>
        <div style={{ fontSize: 13, color: "var(--ls-textDim)", marginBottom: 16 }}>
          Your data is safe. This is usually a connection problem.
        </div>
        <button onClick={() => { setBooted(false); bootstrap(); }} style={primaryBtn}>Try again</button>
        <SignOutBtn />
      </Shell>
    );
  }
  // A dedicated admin account has no household of its own — send it straight to
  // the selector rather than forcing it through household creation.
  // The forceSetup guard has to be here too. Without it, tapping "Create or
  // join a household" from the Home screen set forceSetup, re-rendered, hit
  // this branch first, and returned Home again - the setup screen below was
  // unreachable and the button appeared to do nothing.
  if (mode === "home" && !forceSetup) {
    return (
      <>
        {pendingJoin && (
          <div style={{ maxWidth: 480, margin: "0 auto", padding: "16px 18px 0" }}>
            <Banner tone={pendingJoin.failed ? "error" : "info"}>
              {pendingJoin.failed
                ? `Couldn't join with code ${pendingJoin.code}: ${pendingJoin.message}`
                : `You've been added to a household.`}
            </Banner>
          </div>
        )}
        <HomeScreen
          session={session}
          myHouseholds={myHouseholds}
          isAdmin={isAdmin}
          onOpenPersonal={() => setMode("personal")}
          onOpenHousehold={() => setMode("household")}
          onOpenDebts={() => setMode("debts")}
          onCreateOrJoin={() => setForceSetup(true)}
          onSignOut={() => supabase.auth.signOut()}
          onDeleteAccount={deleteAccount}
        />
      </>
    );
  }

  // Household debts were removed by the same reasoning as household income:
  // a shared record of who-owes-what within a household created more friction
  // than it resolved. Debts are personal only now.
  if (mode === "debts" && !forceSetup) {
    const debtTargetId = viewingUserId || session.user.id;
    const debtTargetLabel = viewingUserId
      ? (allUsers.find((u) => u.user_id === viewingUserId)?.email || "user")
      : "Mine";
    // An admin account has no debts of its own to show or edit - it exists
    // only to look at someone else's, one person at a time, read-only.
    const adminNeedsSelection = isAdmin && !viewingUserId;
    return (
      <Shell>
        <ModeSwitch mode={mode} setMode={setMode} />
        {isAdmin && (
          <div style={{ marginBottom: 16, background: "var(--ls-adminBg)", border: "1px solid var(--ls-adminBorder)", borderRadius: 10, padding: "10px 12px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--ls-adminText)", marginBottom: 8 }}>
              <Shield size={12} /> Administrator
            </div>
            <select value={viewingUserId || ""} onChange={(e) => setViewingUserId(e.target.value || null)} style={{ ...input, fontSize: 13 }}>
              <option value="">Choose a person's debts to view…</option>
              {allUsers.filter((u) => u.user_id !== session.user.id).map((u) => (
                <option key={u.user_id} value={u.user_id}>{u.email}</option>
              ))}
            </select>
          </div>
        )}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--ls-accent)", marginBottom: 4 }}>Debts</div>
          <h1 style={{ fontSize: 26, margin: 0, fontWeight: 500, wordBreak: "break-word" }}>{debtTargetLabel}</h1>
          {isAdmin && viewingUserId && <div style={{ fontSize: 12, color: "var(--ls-warn)", marginTop: 6 }}>Read-only view</div>}
        </div>
        {adminNeedsSelection ? (
          <div style={{ color: "var(--ls-textFaint)", fontSize: 14 }}>Choose a person above to view their debts.</div>
        ) : (
          <DebtTracker
            session={session}
            scope="personal"
            householdId={null}
            ownerId={debtTargetId}
            categories={personalCats}
            incomeCategories={incomeCats}
            readOnly={isAdmin}
          />
        )}
        <SignOutBtn />
      </Shell>
    );
  }

  // Personal mode is independent of households - it works even for an account
  // that belongs to none. An admin account never has a personal ledger of its
  // own to fall back to - it must always pick a real person to view, and that
  // view is always read-only regardless of anything else.
  if (mode === "personal" && !forceSetup) {
    const targetId = viewingUserId || session.user.id;
    const targetLabel = viewingUserId
      ? (allUsers.find((u) => u.user_id === viewingUserId)?.email || "user")
      : session.user.email;
    const adminNeedsSelection = isAdmin && !viewingUserId;
    const personalReadOnly = isAdmin || Boolean(viewingUserId);
    return (
      <Shell>
        <ModeSwitch mode={mode} setMode={setMode} />
        {isAdmin && (
          <div style={{ marginBottom: 16, background: "var(--ls-adminBg)", border: "1px solid var(--ls-adminBorder)", borderRadius: 10, padding: "10px 12px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--ls-adminText)", marginBottom: 8 }}>
              <Shield size={12} /> Administrator
            </div>
            <select value={viewingUserId || ""} onChange={(e) => setViewingUserId(e.target.value || null)} style={{ ...input, fontSize: 13 }}>
              <option value="">Choose a person to view…</option>
              {allUsers.filter((u) => u.user_id !== session.user.id).map((u) => (
                <option key={u.user_id} value={u.user_id}>{u.email}</option>
              ))}
            </select>
          </div>
        )}
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 12, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--ls-accent)", marginBottom: 4 }}>Personal</div>
          <h1 style={{ fontSize: 26, margin: 0, fontWeight: 500, wordBreak: "break-word" }}>{adminNeedsSelection ? "Personal" : targetLabel}</h1>
          {personalReadOnly && !adminNeedsSelection && <div style={{ fontSize: 12, color: "var(--ls-warn)", marginTop: 6 }}>Read-only view</div>}
        </div>
        {adminNeedsSelection ? (
          <div style={{ color: "var(--ls-textFaint)", fontSize: 14 }}>Choose a person above to view their personal ledger.</div>
        ) : (
          <>
            <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
              {[["expenses", "Expenses"], ["income", "Income"]].map(([k, label]) => (
                <button key={k} onClick={() => setLedgerView(k)} style={{
                  flex: 1, padding: "8px 0", fontSize: 13, fontWeight: 600, borderRadius: 8, cursor: "pointer", fontFamily: "inherit",
                  background: ledgerView === k ? (k === "income" ? "var(--ls-income)" : "var(--ls-accent)") : "transparent",
                  color: ledgerView === k ? "var(--ls-bg)" : "var(--ls-textDim)", border: "1px solid var(--ls-border)",
                }}>{label}</button>
              ))}
            </div>
            {ledgerView === "expenses" ? (
              <PersonalLedger
                session={session}
                ownerId={targetId}
                ownerLabel={targetLabel}
                readOnly={personalReadOnly}
                viewMonth={personalMonth}
                setViewMonth={setPersonalMonth}
              />
            ) : (
              <IncomeLedger
                session={session}
                scope="personal"
                householdId={null}
                ownerId={targetId}
                viewMonth={personalMonth}
                setViewMonth={setPersonalMonth}
                readOnly={personalReadOnly}
              />
            )}
          </>
        )}
        <SignOutBtn />
      </Shell>
    );
  }

  if (forceSetup) {
    return <HouseholdSetup session={session} canCancel={myHouseholds.length > 0}
      onCancel={() => setForceSetup(false)}
      onSwitchToPersonal={() => { setForceSetup(false); setMode("personal"); }}
      onDone={() => { setForceSetup(false); bootstrap(); }} />;
  }
  if (!activeId && myHouseholds.length === 0 && !isAdmin) {
    return <HouseholdSetup session={session} canCancel
      onCancel={() => setMode("home")}
      onSwitchToPersonal={() => setMode("personal")}
      onDone={() => { setMode("household"); bootstrap(); }} />;
  }
  if (!activeId) {
    return (
      <Shell>
        <ModeSwitch mode={mode} setMode={setMode} />
        <AdminBar {...{ isAdmin, allHouseholds, viewingId, setViewingId, household }} />
        {myHouseholds.length > 0 ? (
          <>
            <div style={{ color: "var(--ls-textFaint)", fontSize: 14, marginBottom: 10 }}>Choose a household:</div>
            <select value="" onChange={(e) => setHousehold(myHouseholds.find((h) => h.id === e.target.value))} style={{ ...input, fontSize: 13 }}>
              <option value="">Select…</option>
              {myHouseholds.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>
          </>
        ) : (
          <div style={{ color: "var(--ls-textFaint)", fontSize: 14, marginTop: 20 }}>
            {allHouseholds.length === 0
              ? "No households exist yet. Once someone creates one, it will appear here."
              : "Select a household above to view its records."}
          </div>
        )}
        <SignOutBtn />
      </Shell>
    );
  }

  const catByName = (n) => categories.find((c) => c.name === n) || { name: n, icon_key: "more", color: "#5A5A5A" };
  const searching = search.trim().length > 0;
  const scoped = searching
    ? entries.filter((e) => {
        const q = search.toLowerCase();
        return (e.note || "").toLowerCase().includes(q) || (e.reference || "").toLowerCase().includes(q)
          || (e.category || "").toLowerCase().includes(q) || (e.recipient || "").toLowerCase().includes(q)
          || String(e.amount).includes(q);
      })
    : entries.filter((e) => monthKey(e.date) === viewMonth);
  const monthEntries = entries.filter((e) => monthKey(e.date) === viewMonth);
  const monthTotal = monthEntries.reduce((s, e) => s + Number(e.amount), 0);

  // Includes categories that no longer exist, so the rows always sum to the
  // reported total. See breakdown.js.
  const byCategory = buildBreakdown(monthEntries, categories);
  // Archived categories stay out of the pickers but remain in every calculation.
  const activeCategories = categories.filter((c) => !c.archived);

  // Per-category budgets, using the shared helper so household and personal
  // ledgers can never disagree about how a budget behaves.
  const budgeted = categories
    .filter((c) => c.budget_amount != null && c.budget_period)
    .map((c) => ({ ...c, ...computeBudget(c, entries.filter((e) => e.category === c.name), viewMonth, terms) }));

  // Overall monthly cap. Always resets; leftover is reported as savings.
  const totalBudget = computeMonthlyTotal(activeHousehold?.monthly_budget, entries, categories, viewMonth);

  // Who paid what this month. Unattributed rows are shown honestly rather than
  // folded into whoever happens to be signed in.
  const byPayer = (() => {
    const map = new Map();
    monthEntries.forEach((e) => {
      const key = e.paid_by_user_id || "unattributed";
      const label = e.paid_by_user_id
        ? (e.paid_by_user_id === session.user.id ? `${e.paid_by_label || "me"} (me)` : (e.paid_by_label || "Unknown"))
        : "Not recorded";
      const cur = map.get(key) || { key, label, total: 0, count: 0 };
      cur.total += Number(e.amount); cur.count += 1;
      map.set(key, cur);
    });
    return [...map.values()].sort((a, b) => b.total - a.total);
  })();

  async function saveEntry(ev) {
    ev.preventDefault();
    const amt = parseAmount(form.amount);
    if (amt === null) { setError("Enter an amount as plain digits, e.g. 12000 or 12000.50"); return; }
    setSaving(true);
    const payer = members.find((m) => m.user_id === (form.paid_by_user_id || session.user.id));
    const payload = {
      amount: amt, category: form.category, recipient: form.recipient, note: form.note.trim(),
      reference: form.reference.trim(), date: localToISO(form.date), household_id: activeId,
      paid_by_user_id: form.paid_by_user_id || session.user.id,
      paid_by_label: payer?.email || session.user.email,
      template_id: form.template_id || null,
      ...(editingId
        ? { updated_by: session.user.id, updated_at: new Date().toISOString() }
        : { created_by: session.user.id }),
    };
    if (!navigator.onLine && !editingId) {
      setPending(enqueue({ table: "expenses", payload }));
      setSaving(false); setShowForm(false);
      setForm({ amount: "", category: activeCategories[0]?.name || "", recipient: "", note: "", reference: "", date: nowDT(), paid_by_user_id: session.user.id, template_id: null });
      return;
    }
    const { error: err } = editingId
      ? await supabase.from("expenses").update(payload).eq("id", editingId)
      : await supabase.from("expenses").insert(payload);
    setSaving(false);
    if (err) return setError("Save failed. " + err.message);
    setError(null);
    log(editingId ? "edited" : "created", "expense", `${fmt(amt)} · ${form.category}`);
    setForm({ amount: "", category: activeCategories[0]?.name || "", recipient: "", note: "", reference: "", date: nowDT(), paid_by_user_id: session.user.id, template_id: null });
    setEditingId(null); setShowForm(false); loadAll();
  }

  async function deleteEntry(e) {
    // A shared ledger entry is a real financial record and there is no undo,
    // so a single mis-tap on the bin icon should not destroy it silently.
    if (!window.confirm(`Delete this ${fmt(e.amount)} ${e.category} entry? This can't be undone.`)) return;
    const { error: err } = await supabase.from("expenses").delete().eq("id", e.id);
    if (err) return setError(`Couldn't delete: ${err.message}`);
    log("deleted", "expense", `${fmt(e.amount)} · ${e.category}`);
    loadAll();
  }

  // template_id is carried through so the bill calendar can tell this bill was
  // actually paid, rather than inferring it from a matching amount.
  function applyTemplate(t) {
    setForm({
      amount: String(t.amount), category: t.category, recipient: t.recipient || "",
      note: t.label, reference: "", date: nowDT(),
      paid_by_user_id: session.user.id, template_id: t.id,
    });
    setEditingId(null); setShowForm(true);
  }

  async function addObligation(ev) {
    ev.preventDefault();
    const amt = parseAmount(oblForm.totalAmount);
    if (!oblForm.title.trim()) return;
    if (amt === null) { setError("Enter an amount as plain digits, e.g. 12000"); return; }
    const { error: err } = await supabase.from("obligations").insert({
      title: oblForm.title.trim(), category: oblForm.category, total_amount: amt, household_id: activeId,
    });
    if (err) return setError("Couldn't save obligation.");
    log("created", "obligation", `${oblForm.title.trim()} — ${fmt(amt)}`);
    setOblForm({ title: "", category: activeCategories[0]?.name || "", totalAmount: "" });
    setShowNewObl(false); loadAll();
  }

  async function addPayment(o, ev) {
    ev.preventDefault();
    const amt = parseAmount(payForm.amount);
    if (amt === null) { setError("Enter an amount as plain digits, e.g. 12000"); return; }
    const { error: err } = await supabase.from("expenses").insert({
      amount: amt, category: o.category, recipient: "", note: `Payment toward ${o.title}`,
      reference: payForm.reference.trim(), date: localToISO(payForm.date), obligation_id: o.id, household_id: activeId,
    });
    if (err) return setError("Payment failed.");
    log("created", "expense", `Payment ${fmt(amt)} toward ${o.title}`);
    setPayForm({ amount: "", date: nowDT(), reference: "" }); setPayingId(null); loadAll();
  }

  const oblPaid = (id) => entries.filter((e) => e.obligation_id === id).reduce((s, e) => s + Number(e.amount), 0);

  function shiftMonth(d) {
    const [y, m] = viewMonth.split("-").map(Number);
    const dt = new Date(y, m - 1 + d, 1);
    setViewMonth(`${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`);
  }

  function exportCSV() {
    const rows = searching ? scoped : monthEntries;
    const name = searching ? "search-results" : viewMonth;
    downloadFile(`${(activeHousehold?.name || "expenses").replace(/\s+/g, "-")}-${name}.csv`, toCSV(rows), "text/csv");
  }
  function exportPDF() {
    const ok = printReport({
      householdName: activeHousehold?.name || "Expenses",
      monthName: monthLabel(viewMonth),
      rows: monthEntries,
      byCategory: byCategory.filter((c) => c.total > 0),
      byPayer,
      total: monthTotal,
    });
    if (!ok) setError("Your browser blocked the print window. Allow pop-ups for this site.");
  }

  return (
    <div style={{ minHeight: "100vh", background: "var(--ls-bg)", fontFamily: "'Iowan Old Style', Georgia, serif", color: "var(--ls-text)" }}>
      <div style={{ maxWidth: 480, margin: "0 auto", padding: "28px 18px 110px" }}>
        <ModeSwitch mode={mode} setMode={setMode} />
        <AdminBar {...{ isAdmin, allHouseholds, viewingId, setViewingId, household }} />

        {myHouseholds.length > 1 && !readOnly && (
          <div style={{ marginBottom: 14 }}>
            <select value={household?.id || ""} onChange={(e) => {
              setViewingId(null);
              setHousehold(myHouseholds.find((h) => h.id === e.target.value));
            }} style={{ ...input, fontSize: 13 }}>
              {myHouseholds.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>
          </div>
        )}

        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 12, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--ls-accent)", marginBottom: 4 }}>Ledger Sawa</div>
          <h1 style={{ fontSize: 30, margin: 0, fontWeight: 500 }}>{activeHousehold?.name}</h1>
          {readOnly && <div style={{ fontSize: 12, color: "var(--ls-warn)", marginTop: 6 }}>Read-only view</div>}
          <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            <button onClick={() => setShowObl(!showObl)} style={toggleBtn(showObl, "var(--ls-accent)")}>{showObl ? "Hide obligations" : "Obligations"}</button>
            <button onClick={() => setShowReport(!showReport)} style={toggleBtn(showReport, "var(--ls-info)")}><FileText size={14} />Report</button>
            <button onClick={() => setShowBills(!showBills)} style={toggleBtn(showBills, "var(--ls-warn)")}><CalendarDays size={14} />Bills</button>
            {!readOnly && <button onClick={() => setShowSettings(!showSettings)} style={toggleBtn(showSettings, "var(--ls-income)")}><Cog size={14} />Setup</button>}
          </div>
        </div>

        {/* Household income was deliberately removed - a shared, visible household
            income figure is a real source of friction in many East African
            households (unequal earners, support obligations, disclosure norms).
            Personal income stays, since that's private to each person. */}

        {!online && <Banner tone="warn"><CloudOff size={14} />Offline. New entries are saved on this device and will sync when you reconnect.</Banner>}
        {pending > 0 && online && <Banner tone="info">Syncing {pending} pending {pending === 1 ? "entry" : "entries"}…</Banner>}
        {error && <Banner><WifiOff size={14} />{error}</Banner>}

        {showSettings && !readOnly && (
          <Settings householdId={activeId} household={activeHousehold} categories={categories}
            templates={templates} people={people} terms={terms} audit={audit} reload={loadAll} log={log} />
        )}

        <div style={{ position: "relative", marginBottom: 14 }}>
          <Search size={15} style={{ position: "absolute", left: 12, top: 12, color: "var(--ls-textFaint)" }} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search all entries…"
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
            {byPayer.length > 1 && (
              <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid var(--ls-border)" }}>
                <div style={{ fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--ls-textFaint)", marginBottom: 8 }}>
                  Who paid
                </div>
                {byPayer.map((p) => (
                  <div key={p.key} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "4px 0" }}>
                    <span style={{ color: p.key === "unattributed" ? "var(--ls-textFaint)" : "var(--ls-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginRight: 8 }}>
                      {p.label} <span style={{ color: "var(--ls-textFaint)" }}>({p.count})</span>
                    </span>
                    <span style={{ fontFamily: "ui-monospace, monospace", flexShrink: 0 }}>
                      {fmt(p.total)}
                      <span style={{ color: "var(--ls-textFaint)", fontSize: 11 }}>
                        {" "}{monthTotal > 0 ? Math.round((p.total / monthTotal) * 100) : 0}%
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            )}
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

        {showObl && (
          <div style={{ marginBottom: 22 }}>
            {totalBudget && (
              <Card style={{ borderColor: "var(--ls-adminBorder)", background: "var(--ls-adminBg)" }}>
                <Row label={`Monthly spending cap - ${monthLabel(viewMonth)}`} value={`${fmt(totalBudget.spent)} / ${fmt(totalBudget.budget)}`} />
                <Big positive={totalBudget.remaining >= 0}>
                  {totalBudget.remaining >= 0 ? `${fmt(totalBudget.remaining)} left` : `${fmt(Math.abs(totalBudget.remaining))} over`}
                </Big>
                {totalBudget.excludedCount > 0 && (
                  <div style={{ fontSize: 11, color: "var(--ls-textFaint)", marginTop: 4 }}>
                    Excludes {totalBudget.excludedCount} fixed {totalBudget.excludedCount === 1 ? "expense" : "expenses"} ({fmt(totalBudget.excludedTotal)} this month)
                  </div>
                )}
                <div style={{ fontSize: 11, color: "var(--ls-textFaint)", marginTop: 2 }}>Resets each month - leftover is shown as savings in the report.</div>
              </Card>
            )}

            <SectionLabel>Remaining toward obligations</SectionLabel>
            {budgeted.length === 0 && <div style={{ fontSize: 13, color: "var(--ls-textFaint)", marginBottom: 10 }}>No budgets set. Add one under Setup → Expenses & budgets.</div>}
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

            <div style={{ marginTop: 16 }}>
              <SectionLabel>Other obligations</SectionLabel>
              {obligations.length === 0 && <div style={{ fontSize: 13, color: "var(--ls-textFaint)", marginBottom: 10 }}>No upcoming expenses logged.</div>}
              {obligations.map((o) => {
                const paid = oblPaid(o.id), rem = Number(o.total_amount) - paid;
                const cat = catByName(o.category); const I = iconFor(cat.icon_key);
                return (
                  <Card key={o.id}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14 }}><I size={14} color={cat.color} />{o.title}</div>
                      {!readOnly && <button onClick={async () => {
                        if (!window.confirm(`Delete the obligation "${o.title}"? Expenses logged against it are kept.`)) return;
                        const { error: dErr } = await supabase.from("obligations").delete().eq("id", o.id);
                        if (dErr) return setError("Couldn't delete that obligation: " + dErr.message);
                        log("deleted", "obligation", o.title); loadAll();
                      }} style={{ ...iconBtn, color: "var(--ls-negative)" }}><Trash2 size={14} /></button>}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--ls-textDim)", fontFamily: "ui-monospace, monospace" }}>{fmt(paid)} / {fmt(o.total_amount)}</div>
                    <Big positive={rem <= 0}>{rem < 0 ? `${fmt(Math.abs(rem))} overpaid` : `${fmt(rem)} remaining`}</Big>
                    {!readOnly && (payingId === o.id ? (
                      <form onSubmit={(e) => addPayment(o, e)} style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
                        <input type="number" step="0.01" placeholder="Payment amount" value={payForm.amount} onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })} style={{ ...input, fontSize: 13 }} autoFocus required />
                        <input type="datetime-local" value={payForm.date} onChange={(e) => setPayForm({ ...payForm, date: e.target.value })} style={{ ...input, fontSize: 13 }} />
                        <input placeholder="Transaction reference (optional)" value={payForm.reference} onChange={(e) => setPayForm({ ...payForm, reference: e.target.value })} style={{ ...input, fontSize: 13 }} />
                        <div style={{ display: "flex", gap: 6 }}>
                          <button type="button" onClick={() => setPayingId(null)} style={{ ...smallGhost, flex: 1 }}>Cancel</button>
                          <button type="submit" style={{ ...smallPrimary, flex: 2 }}>Add payment</button>
                        </div>
                      </form>
                    ) : rem > 0 && (
                      <button onClick={() => { setPayForm({ amount: "", date: nowDT(), reference: "" }); setPayingId(o.id); }} style={{ ...smallGhost, marginTop: 8 }}>Add payment</button>
                    ))}
                  </Card>
                );
              })}
              {!readOnly && (showNewObl ? (
                <form onSubmit={addObligation} style={{ marginTop: 10, background: "var(--ls-surface)", border: "1px solid var(--ls-border)", borderRadius: 10, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                  <input placeholder="What's the expense" value={oblForm.title} onChange={(e) => setOblForm({ ...oblForm, title: e.target.value })} style={{ ...input, fontSize: 13 }} autoFocus required />
                  <select value={oblForm.category} onChange={(e) => setOblForm({ ...oblForm, category: e.target.value })} style={{ ...input, fontSize: 13 }}>
                    {categories.filter((c) => !c.archived).map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
                  </select>
                  <input type="number" placeholder="Total amount" value={oblForm.totalAmount} onChange={(e) => setOblForm({ ...oblForm, totalAmount: e.target.value })} style={{ ...input, fontSize: 13 }} required />
                  <div style={{ display: "flex", gap: 6 }}>
                    <button type="button" onClick={() => setShowNewObl(false)} style={{ ...smallGhost, flex: 1 }}>Cancel</button>
                    <button type="submit" style={{ ...smallPrimary, flex: 2 }}>Save</button>
                  </div>
                </form>
              ) : (
                <button onClick={() => setShowNewObl(true)} style={{ ...smallGhost, marginTop: 10 }}><Plus size={13} style={{ marginRight: 4, verticalAlign: -2 }} />New upcoming expense</button>
              ))}
            </div>
          </div>
        )}

        {showBills && !searching && (
          <BillCalendar templates={templates} entries={entries} categories={categories} viewMonth={viewMonth} />
        )}

        {/* KPI strip - the at-a-glance numbers, before any detail */}
        {!searching && (
          <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
            <div style={{ flex: 1, background: "var(--ls-surface)", border: "1px solid var(--ls-border)", borderRadius: 10, padding: "10px 12px" }}>
              <div style={{ fontSize: 9, letterSpacing: "0.1em", color: "var(--ls-textFaint)" }}>SPENT</div>
              <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 15, color: "var(--ls-accent)", marginTop: 3, fontVariantNumeric: "tabular-nums" }}>{fmt(monthTotal)}</div>
            </div>
            {totalBudget ? (
              <>
                <div style={{ flex: 1, background: "var(--ls-surface)", border: "1px solid var(--ls-border)", borderRadius: 10, padding: "10px 12px" }}>
                  <div style={{ fontSize: 9, letterSpacing: "0.1em", color: "var(--ls-textFaint)" }}>CAP</div>
                  <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 15, color: "var(--ls-textDim)", marginTop: 3 }}>{fmt(totalBudget.budget)}</div>
                </div>
                <div style={{ flex: 1, background: "var(--ls-surface)", border: "1px solid var(--ls-border)", borderRadius: 10, padding: "10px 12px" }}>
                  <div style={{ fontSize: 9, letterSpacing: "0.1em", color: "var(--ls-textFaint)" }}>
                    {totalBudget.remaining >= 0 ? "LEFT" : "OVER"}
                  </div>
                  <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 15, marginTop: 3, color: totalBudget.remaining >= 0 ? "var(--ls-positive)" : "var(--ls-negative)" }}>
                    {fmt(Math.abs(totalBudget.remaining))}
                  </div>
                </div>
              </>
            ) : (
              <div style={{ flex: 2, background: "var(--ls-surface)", border: "1px solid var(--ls-border)", borderRadius: 10, padding: "10px 12px" }}>
                <div style={{ fontSize: 9, letterSpacing: "0.1em", color: "var(--ls-textFaint)" }}>ENTRIES</div>
                <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 15, color: "var(--ls-textDim)", marginTop: 3 }}>{monthEntries.length}</div>
              </div>
            )}
          </div>
        )}

        {/* Category tiles - the colour and icon already stored per category,
            finally used for something more legible than a 5px bar. */}
        {!searching && byCategory.some((c) => c.total > 0) && (
          <div style={{ marginBottom: 22 }}>
            <SectionLabel>Where it went</SectionLabel>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {byCategory.filter((c) => c.total > 0).sort((a, b) => b.total - a.total).map((c) => {
                const I = iconFor(c.icon_key);
                const share = monthTotal > 0 ? Math.round((c.total / monthTotal) * 100) : 0;
                return (
                  <div key={c.id} style={{
                    background: c.color + "26", border: `1px solid ${c.color}59`,
                    borderRadius: 12, padding: "12px 12px 10px",
                  }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <div style={{ width: 26, height: 26, borderRadius: 8, background: c.color, display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <I size={14} color="var(--ls-bg)" />
                      </div>
                      <span style={{ fontSize: 10, color: "var(--ls-textFaint)" }}>{share}%</span>
                    </div>
                    <div style={{ fontSize: 11, color: "var(--ls-textDim)", marginTop: 8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {c.name}{c.orphaned ? " (archived)" : ""}
                    </div>
                    <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 14, color: "var(--ls-text)", marginTop: 2, fontVariantNumeric: "tabular-nums" }}>
                      {fmt(c.total)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Six months of context. A single month can't tell you if this one is
            unusual, which is the question people actually have. */}
        {!searching && entries.length > 0 && (
          <div style={{ marginBottom: 22 }}>
            <SectionLabel>Last 6 months</SectionLabel>
            <MonthBars data={monthlyTotals(entries, viewMonth)} currentMonth={viewMonth} />
          </div>
        )}

        {!readOnly && (categories.length === 0 || memberCount < 2) && (
          <HouseholdChecklist
            household={activeHousehold}
            categoriesCount={categories.length}
            peopleCount={people.length}
            memberCount={memberCount}
            onAddCategories={() => setShowSettings(true)}
            onAddPeople={() => setShowSettings(true)}
            reload={() => { bootstrap(); loadAll(); }}
          />
        )}

        {!readOnly && categories.length === 0 && (
          <div style={{ background: "var(--ls-surface2)", border: "1px solid var(--ls-border)", borderRadius: 12, padding: 18, marginBottom: 20 }}>
            <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 6 }}>Set up your expense types</div>
            <div style={{ fontSize: 13, color: "var(--ls-textDim)", lineHeight: 1.6, marginBottom: 14 }}>
              Nothing is set up for you - add the expenses your household actually has,
              and set a budget on any of them if you want to track what's left.
            </div>
            <button onClick={() => setShowSettings(true)} style={primaryBtn}>
              <Plus size={16} style={{ marginRight: 6, verticalAlign: -3 }} />Add my first expense type
            </button>
          </div>
        )}

        {categories.length > 0 && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <SectionLabel>{searching ? `${scoped.length} match${scoped.length === 1 ? "" : "es"}` : "Entries"}</SectionLabel>
          {scoped.length > 0 && <button onClick={exportCSV} style={{ ...iconBtn, color: "var(--ls-textFaint)", fontSize: 12 }}><Download size={13} /></button>}
        </div>
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
                <div style={{ fontSize: 11, color: "var(--ls-textFaint)", marginTop: 2 }}>
                  {fmtDT(e.date)} · {cat.name}{e.recipient ? ` · ${e.recipient}` : ""}
                </div>
                {e.paid_by_label && members.length > 1 && (
                  <div style={{ fontSize: 10, color: "var(--ls-textDim)", marginTop: 2 }}>
                    Paid by {e.paid_by_user_id === session.user.id ? "me" : e.paid_by_label}
                    {e.updated_by && e.updated_by !== e.created_by ? " (edited)" : ""}
                  </div>
                )}
                {e.reference && <div style={{ fontSize: 11, color: "var(--ls-textDim)", marginTop: 2, fontFamily: "ui-monospace, monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Ref: {e.reference}</div>}
              </div>
              {!readOnly && <>
                <button onClick={() => { setForm({ amount: String(e.amount), category: e.category, recipient: e.recipient || "", note: e.note || "", reference: e.reference || "", date: toDTLocal(e.date), paid_by_user_id: e.paid_by_user_id || session.user.id }); setEditingId(e.id); setShowForm(true); }} style={iconBtn}><Pencil size={14} /></button>
                <button onClick={() => deleteEntry(e)} style={{ ...iconBtn, color: "var(--ls-negative)" }}><Trash2 size={15} /></button>
              </>}
            </div>
          );
        })}

        {!readOnly && (
          <button onClick={() => setForceSetup(true)} style={{ ...ghostBtn, marginTop: 24, fontSize: 13, padding: "10px 0" }}>
            <Plus size={14} style={{ marginRight: 6, verticalAlign: -2 }} />Create or join another household
          </button>
        )}
        <SignOutBtn />
      </div>

      {!readOnly && myHouseholds.some((h) => h.id === activeId) && categories.length > 0 && (
        <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, display: "flex", justifyContent: "center", padding: 16, background: "linear-gradient(transparent, var(--ls-bg) 40%)" }}>
          <div style={{ width: "100%", maxWidth: 480 }}>
            {showForm ? (
              <form onSubmit={saveEntry} style={{ background: "var(--ls-surface)", border: "1px solid var(--ls-border)", borderRadius: 14, padding: 16, display: "flex", flexDirection: "column", gap: 10, maxHeight: "78vh", overflowY: "auto" }}>
                <input type="number" step="0.01" placeholder="Amount" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} style={input} autoFocus required />
                <input type="datetime-local" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} style={input} />
                <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} style={input}>
                  {categories.filter((c) => !c.archived).map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
                </select>
                <select value={form.recipient} onChange={(e) => setForm({ ...form, recipient: e.target.value })} style={input}>
                  <option value="">No specific person</option>
                  {people.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
                </select>
                {members.length > 1 && (
                  <div>
                    <div style={{ fontSize: 11, color: "var(--ls-textFaint)", marginBottom: 4 }}>Paid by</div>
                    <select value={form.paid_by_user_id || session.user.id}
                      onChange={(e) => setForm({ ...form, paid_by_user_id: e.target.value })} style={input}>
                      {members.map((m) => (
                        <option key={m.user_id} value={m.user_id}>
                          {m.email}{m.user_id === session.user.id ? " (me)" : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <input placeholder="Note (optional)" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} style={input} />
                <input placeholder="Transaction reference / confirmation message" value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} style={input} />
                <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                  <button type="button" onClick={() => { setShowForm(false); setEditingId(null); }} style={{ ...ghostBtn, flex: 1 }}>Cancel</button>
                  <button type="submit" disabled={saving} style={{ ...primaryBtn, flex: 2, opacity: saving ? 0.6 : 1 }}>{saving ? "Saving…" : editingId ? "Save changes" : "Save entry"}</button>
                </div>
              </form>
            ) : (
              <div>
                {templates.length > 0 && (
                  <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 8 }}>
                    {templates.map((t) => (
                      <button key={t.id} onClick={() => applyTemplate(t)} style={{
                        flexShrink: 0, background: "var(--ls-surface)", border: "1px solid var(--ls-border)", borderRadius: 20,
                        padding: "7px 12px", fontSize: 12, color: "var(--ls-accent)", cursor: "pointer", fontFamily: "inherit",
                      }}><Zap size={11} style={{ marginRight: 4, verticalAlign: -1 }} />{t.label}</button>
                    ))}
                  </div>
                )}
                <button onClick={() => { setForm({ amount: "", category: activeCategories[0]?.name || "", recipient: "", note: "", reference: "", date: nowDT(), paid_by_user_id: session.user.id, template_id: null }); setEditingId(null); setShowForm(true); }} style={primaryBtn}>
                  <Plus size={16} style={{ marginRight: 6, verticalAlign: -3 }} />Log an expense
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ModeSwitch({ mode, setMode }) {
  const tab = (key) => ({
    flex: 1, padding: "9px 0", fontSize: 12, fontWeight: 600, cursor: "pointer",
    background: mode === key ? "var(--ls-accent)" : "transparent",
    color: mode === key ? "var(--ls-bg)" : "var(--ls-textDim)",
    border: "1px solid var(--ls-border)", borderRadius: 8, fontFamily: "inherit",
  });
  return (
    <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
      <button onClick={() => setMode("home")} style={tab("home")}>Home</button>
      <button onClick={() => setMode("household")} style={tab("household")}>Household</button>
      <button onClick={() => setMode("personal")} style={tab("personal")}>Personal</button>
      <button onClick={() => setMode("debts")} style={tab("debts")}>Debts</button>
    </div>
  );
}

function AdminBar({ isAdmin, allHouseholds, viewingId, setViewingId, household }) {
  if (!isAdmin) return null;
  return (
    <div style={{ marginBottom: 16, background: "var(--ls-adminBg)", border: "1px solid var(--ls-adminBorder)", borderRadius: 10, padding: "10px 12px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--ls-adminText)", marginBottom: 8 }}>
        <Shield size={12} /> Administrator — {allHouseholds.length} household{allHouseholds.length === 1 ? "" : "s"}
      </div>
      <select
        value={viewingId || household?.id || ""}
        onChange={(e) => {
          const v = e.target.value;
          if (!v) return setViewingId(null);
          setViewingId(v === household?.id ? null : v);
        }}
        style={{ ...input, fontSize: 13 }}
      >
        <option value="">Choose a household…</option>
        {household && <option value={household.id}>{household.name} (mine)</option>}
        {allHouseholds.filter((h) => h.id !== household?.id).map((h) => (
          <option key={h.id} value={h.id}>{h.name}</option>
        ))}
      </select>
    </div>
  );
}

function HouseholdSetup({ session, onDone, canCancel, onCancel, onSwitchToPersonal }) {
  const [mode, setMode] = useState("create");
  const [name, setName] = useState("");
  const [members, setMembers] = useState("");
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);


  async function create(e) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true); setMsg(null);
    const people = members.split(",").map((s) => s.trim()).filter(Boolean);
    const { error } = await supabase.rpc("create_household", { p_name: name.trim(), p_people: people });
    setBusy(false);
    if (error) return setMsg(error.message);
    onDone();
  }

  async function join(e) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    const { error } = await supabase.rpc("join_household", { p_code: code.trim() });
    setBusy(false);
    if (error) return setMsg(error.message.replace(/^.*exception:?\s*/i, ""));
    onDone();
  }

  return (
    <Shell>
      {onSwitchToPersonal && (
        <button onClick={onSwitchToPersonal} style={{ ...ghostBtn, marginBottom: 16, fontSize: 13, padding: "10px 0" }}>
          Skip for now - use personal expenses only
        </button>
      )}
      <div style={{ fontSize: 12, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--ls-accent)", marginBottom: 4 }}>Setup</div>
      <h1 style={{ fontSize: 26, margin: "0 0 16px", fontWeight: 500 }}>{mode === "create" ? "Create your household" : "Join a household"}</h1>
      {mode === "create" ? (
        <form onSubmit={create} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <input placeholder="Household name" value={name} onChange={(e) => setName(e.target.value)} style={input} required autoFocus />
          <input placeholder="People in the household, comma separated" value={members} onChange={(e) => setMembers(e.target.value)} style={input} />
          <button type="submit" disabled={busy} style={{ ...primaryBtn, opacity: busy ? 0.6 : 1 }}>{busy ? "Creating…" : "Create household"}</button>
          <div style={{ fontSize: 11, color: "var(--ls-textFaint)", lineHeight: 1.5 }}>Your household starts empty. You will add your own expense types and budgets next.</div>
        </form>
      ) : (
        <form onSubmit={join} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <input placeholder="Invite code" value={code} onChange={(e) => setCode(e.target.value)} style={input} required autoFocus />
          <button type="submit" disabled={busy} style={{ ...primaryBtn, opacity: busy ? 0.6 : 1 }}>{busy ? "Joining…" : "Join household"}</button>
        </form>
      )}
      {msg && <div style={{ marginTop: 12 }}><Banner>{msg}</Banner></div>}
      <button onClick={() => { setMode(mode === "create" ? "join" : "create"); setMsg(null); }} style={{ ...ghostBtn, marginTop: 12 }}>
        {mode === "create" ? "Have an invite code? Join instead" : "Create a new household instead"}
      </button>
      {canCancel && (
        <button onClick={onCancel} style={{ ...ghostBtn, marginTop: 8, border: "none", color: "var(--ls-textFaint)", fontSize: 13 }}>
          Back to my households
        </button>
      )}
      <SignOutBtn />
    </Shell>
  );
}

function SignOutBtn() {
  return (
    <button onClick={() => supabase.auth.signOut()} style={{ ...ghostBtn, marginTop: 24, fontSize: 13, padding: "10px 0" }}>
      <LogOut size={14} style={{ marginRight: 6, verticalAlign: -2 }} />Sign out
    </button>
  );
}

import { useState, useEffect } from "react";
import { supabase } from "./supabaseClient";
import { Shell, Banner, input, primaryBtn, ghostBtn } from "./ui";
import { Wordmark } from "./Brand";

export function AuthScreen() {
  const [mode, setMode] = useState("signin"); // signin | signup | reset
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [msg, setMsg] = useState(null);
  const [tone, setTone] = useState("error");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      if (mode === "reset") {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: window.location.origin,
        });
        if (error) throw error;
        setTone("info");
        setMsg("If that email has an account, a reset link is on its way. Open it on this device.");
      } else if (mode === "signup") {
        // Checked here rather than only relying on the browser, since a typo
        // in a password nobody can see is otherwise invisible until the next
        // sign-in fails.
        if (password !== confirmPassword) {
          setTone("error");
          setMsg("Those passwords don't match.");
          setBusy(false);
          return;
        }
        const { data, error } = await supabase.auth.signUp({ email: email.trim(), password });
        if (error) throw error;
        setTone("info");
        // Supabase returns no session when confirmation is required, and a
        // real session when it isn't - branching on that tells the truth
        // about what just happened instead of hedging with "if enabled".
        if (data.session) {
          setMsg("Account created and signed in.");
        } else {
          setMsg("Account created. Check your email for a confirmation link before signing in.");
          setMode("signin");
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
      }
    } catch (err) {
      setTone("error");
      // Supabase's own wording for this case ("Email not confirmed") is
      // already reasonably clear, but the fix isn't obvious from that alone.
      setMsg(
        err.message === "Email not confirmed"
          ? "Confirm your email first - check your inbox for the link, including spam."
          : err.message
      );
    }
    setBusy(false);
  }

  const title = mode === "signin" ? "Sign in" : mode === "signup" ? "Create account" : "Reset password";

  return (
    <Shell>
      <div style={{ marginBottom: 24 }}><Wordmark tagline /></div>
      <h1 style={{ fontSize: 24, margin: "0 0 20px", fontWeight: 500 }}>{title}</h1>
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} style={input} required autoComplete="email" />
        {mode !== "reset" && (
          <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} style={input} required minLength={6}
            autoComplete={mode === "signin" ? "current-password" : "new-password"} />
        )}
        {mode === "signup" && (
          <input type="password" placeholder="Confirm password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} style={input} required minLength={6}
            autoComplete="new-password" />
        )}
        <button type="submit" disabled={busy} style={{ ...primaryBtn, opacity: busy ? 0.6 : 1 }}>
          {busy ? "Working…" : mode === "signin" ? "Sign in" : mode === "signup" ? "Create account" : "Send reset link"}
        </button>
      </form>
      {msg && <div style={{ marginTop: 12 }}><Banner tone={tone}>{msg}</Banner></div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
        <button onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setMsg(null); setConfirmPassword(""); }} style={ghostBtn}>
          {mode === "signin" ? "Need an account? Create one" : "Already have an account? Sign in"}
        </button>
        {mode !== "reset" && (
          <button onClick={() => { setMode("reset"); setMsg(null); }} style={{ ...ghostBtn, border: "none", color: "var(--ls-textFaint)", fontSize: 13 }}>
            Forgot your password?
          </button>
        )}
      </div>
    </Shell>
  );
}

// Shown when the user arrives from a password-reset email link.
export function SetNewPassword({ onDone }) {
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) setMsg(error.message);
    else onDone();
  }

  return (
    <Shell>
      <h1 style={{ fontSize: 26, margin: "0 0 16px", fontWeight: 500 }}>Choose a new password</h1>
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <input type="password" placeholder="New password" value={password} onChange={(e) => setPassword(e.target.value)} style={input} required minLength={6} autoFocus autoComplete="new-password" />
        <button type="submit" disabled={busy} style={{ ...primaryBtn, opacity: busy ? 0.6 : 1 }}>{busy ? "Saving…" : "Save password"}</button>
      </form>
      {msg && <div style={{ marginTop: 12 }}><Banner>{msg}</Banner></div>}
    </Shell>
  );
}

export function useRecoveryMode() {
  const [recovery, setRecovery] = useState(false);
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setRecovery(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);
  return [recovery, setRecovery];
}

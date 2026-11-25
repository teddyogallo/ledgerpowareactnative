export const Shell = ({ children }) => (
  <div style={{ minHeight: "100vh", background: "var(--ls-bg)", fontFamily: "'Iowan Old Style', Georgia, serif", color: "var(--ls-text)" }}>
    <div style={{ maxWidth: 480, margin: "0 auto", padding: "28px 18px 110px" }}>{children}</div>
  </div>
);

export const Card = ({ children, style }) => (
  <div style={{ background: "var(--ls-surface)", border: "1px solid var(--ls-border)", borderRadius: 10, padding: "12px 14px", marginBottom: 8, ...style }}>{children}</div>
);

export const SectionLabel = ({ children, color = "var(--ls-textFaint)" }) => (
  <div style={{ fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color, marginBottom: 10 }}>{children}</div>
);

export const Row = ({ label, value }) => (
  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "var(--ls-textDim)", marginBottom: 4 }}>
    <span>{label}</span><span style={{ fontFamily: "ui-monospace, monospace" }}>{value}</span>
  </div>
);

export const Big = ({ children, positive }) => (
  <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 17, color: positive ? "var(--ls-positive)" : "var(--ls-negative)" }}>{children}</div>
);

export const Banner = ({ tone = "error", children }) => {
  const tones = {
    error: { bg: "rgba(224,133,133,0.18)", fg: "var(--ls-negative)" },
    warn: { bg: "rgba(224,181,133,0.18)", fg: "var(--ls-warn)" },
    info: { bg: "var(--ls-borderSoft)", fg: "var(--ls-info)" },
  };
  const t = tones[tone] || tones.error;
  return (
    <div style={{ background: t.bg, color: t.fg, padding: "10px 14px", borderRadius: 8, fontSize: 13, marginBottom: 16, display: "flex", gap: 8, alignItems: "center" }}>
      {children}
    </div>
  );
};

export const toggleBtn = (active, color) => ({
  display: "flex", alignItems: "center", gap: 6,
  background: active ? color : "transparent", color: active ? "var(--ls-bg)" : color,
  border: `1px solid ${color}`, borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer",
});

export const iconBtn = { background: "transparent", border: "none", color: "var(--ls-textDim)", cursor: "pointer", padding: 6, display: "flex", alignItems: "center", justifyContent: "center" };
export const input = { width: "100%", boxSizing: "border-box", background: "var(--ls-sunken)", border: "1px solid var(--ls-border)", borderRadius: 8, padding: "10px 12px", color: "var(--ls-text)", fontSize: 14, fontFamily: "inherit", outline: "none" };
export const primaryBtn = { width: "100%", background: "var(--ls-accent)", color: "var(--ls-bg)", border: "none", borderRadius: 12, padding: "14px 0", fontSize: 15, fontWeight: 600, cursor: "pointer" };
export const ghostBtn = { width: "100%", background: "transparent", color: "var(--ls-textDim)", border: "1px solid var(--ls-border)", borderRadius: 12, padding: "12px 0", fontSize: 14, cursor: "pointer" };
export const smallGhost = { ...ghostBtn, padding: "8px 0", fontSize: 13, borderRadius: 8 };
export const smallPrimary = { ...primaryBtn, padding: "8px 0", fontSize: 13, borderRadius: 8 };

// The Ledger Sawa mark - a coin, verified.
//
// Brand colours are deliberately hardcoded rather than themed. A logo that
// changes colour with light/dark mode isn't a logo. Blue and gold both hold up
// on either background.
//
// Geometry matches public/icon.svg, scaled up to fill the viewBox since this
// version has no rounded-square background behind it. If the mark changes,
// update both.

export function Mark({ size = 40 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" role="img" aria-label="Ledger Sawa">
      <circle cx="256" cy="256" r="200" fill="none" stroke="#4FA8D8" strokeWidth="28" />
      <circle cx="256" cy="256" r="153" fill="none" stroke="#4FA8D8" strokeWidth="8" opacity="0.4" />
      <path
        d="M165 265 L231 334 L359 184"
        fill="none" stroke="#D4AF37" strokeWidth="47"
        strokeLinecap="round" strokeLinejoin="round"
      />
    </svg>
  );
}

// Icon + name, for the sign-in screen and home screen - the two places someone
// actually needs to recognise the brand, not repeated on every internal screen.
export function Wordmark({ tagline = false }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <Mark size={40} />
      <div>
        <div style={{ fontSize: 22, fontWeight: 500, color: "var(--ls-text)", fontFamily: "Georgia, 'Iowan Old Style', serif" }}>
          Ledger Sawa
        </div>
        {tagline && (
          <div style={{ fontSize: 10, letterSpacing: "0.12em", color: "var(--ls-textFaint)", fontFamily: "ui-monospace, monospace" }}>
            HOUSEHOLD BOOKKEEPING, BALANCED
          </div>
        )}
      </div>
    </div>
  );
}

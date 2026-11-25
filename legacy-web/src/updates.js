// Keeps the installed app up to date without anyone having to delete and
// re-add it from their home screen.
//
// The config already said registerType: "autoUpdate", but nothing ever
// registered the service worker, so none of it was actually running. This wires
// it up, and adds the parts autoUpdate alone does not solve:
//
//   1. A home-screen app can stay open for days. Without an explicit check it
//      may never notice a new version exists, so we re-check whenever it comes
//      back to the foreground.
//   2. autoUpdate installs the new version but the running page keeps using the
//      old code until it reloads. Reloading out of nowhere mid-typing would
//      throw away a half-entered expense, so we ask first - unless nothing is
//      in progress, in which case we just do it.

// Imported dynamically rather than at the top level. If this virtual module
// ever fails to resolve, a static import would break the entire build and ship
// a blank screen; this way the app still loads and simply doesn't self-update.

const CHECK_INTERVAL_MS = 60 * 60 * 1000; // hourly while the app stays open

// True when the person is part-way through something we shouldn't interrupt.
function isBusy() {
  const el = document.activeElement;
  if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT")) return true;
  // Any visible form means an entry is open.
  return document.querySelector("form") !== null;
}

function showUpdateBanner(applyUpdate) {
  if (document.getElementById("ls-update-banner")) return;

  const bar = document.createElement("div");
  bar.id = "ls-update-banner";
  bar.style.cssText = [
    "position:fixed", "left:12px", "right:12px", "bottom:12px", "z-index:9999",
    "background:var(--ls-surface,#14273F)", "color:var(--ls-text,#fff)",
    "border:1px solid var(--ls-accent,#D4AF37)", "border-radius:12px",
    "padding:12px 14px", "display:flex", "align-items:center", "gap:12px",
    "font-family:'Iowan Old Style',Georgia,serif", "font-size:14px",
    "box-shadow:0 6px 24px rgba(0,0,0,0.35)",
    "max-width:480px", "margin:0 auto",
  ].join(";");

  const text = document.createElement("div");
  text.style.cssText = "flex:1;line-height:1.4";
  text.textContent = "A new version is ready.";

  const btn = document.createElement("button");
  btn.textContent = "Update";
  btn.style.cssText = [
    "background:var(--ls-accent,#D4AF37)", "color:var(--ls-bg,#0B1A2D)",
    "border:none", "border-radius:8px", "padding:9px 16px",
    "font-family:inherit", "font-size:13px", "font-weight:700", "cursor:pointer",
    "flex-shrink:0",
  ].join(";");
  btn.onclick = () => { bar.remove(); applyUpdate(); };

  const later = document.createElement("button");
  later.textContent = "Later";
  later.style.cssText = [
    "background:transparent", "color:var(--ls-textFaint,#6E86A4)",
    "border:none", "font-family:inherit", "font-size:13px", "cursor:pointer",
    "flex-shrink:0",
  ].join(";");
  later.onclick = () => bar.remove();

  bar.append(text, btn, later);
  document.body.appendChild(bar);
}

export async function initAutoUpdate() {
  let registerSW;
  try {
    ({ registerSW } = await import("virtual:pwa-register"));
  } catch (err) {
    console.error("Auto-update unavailable:", err);
    return;
  }

  let updateSW;

  updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      // A new version is downloaded and waiting. Apply it straight away if
      // nothing is in progress; otherwise offer it rather than discarding
      // whatever they were typing.
      if (!isBusy()) {
        updateSW(true);
      } else {
        showUpdateBanner(() => updateSW(true));
      }
    },
    onRegisteredSW(_url, registration) {
      if (!registration) return;

      // Re-check when the app is brought back to the foreground. A home-screen
      // app is often resumed rather than launched, so this is the moment a new
      // version is most likely to be picked up.
      const check = () => {
        if (document.visibilityState === "visible") {
          registration.update().catch(() => { /* offline - try again later */ });
        }
      };
      document.addEventListener("visibilitychange", check);
      window.addEventListener("focus", check);
      setInterval(check, CHECK_INTERVAL_MS);
    },
    onRegisterError(err) {
      // Not fatal - the app still works, it just won't self-update.
      console.error("Service worker registration failed:", err);
    },
  });
}

import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import { applyTheme, watchSystemTheme } from "./theme";
import { initAutoUpdate } from "./updates";

applyTheme();
watchSystemTheme();
initAutoUpdate();

// Without this, any error thrown while rendering unmounts the whole tree and
// leaves a blank white page with nothing on screen to act on.
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error("App crashed:", error, info);
  }
  render() {
    if (!this.state.error) return this.props.children;
    const msg = String(this.state.error?.message || this.state.error);
    return (
      <div style={{
        minHeight: "100vh", background: "var(--ls-bg)", color: "var(--ls-text)",
        fontFamily: "'Iowan Old Style', Georgia, serif", padding: "32px 18px",
      }}>
        <div style={{ maxWidth: 480, margin: "0 auto" }}>
          <div style={{ fontSize: 12, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--ls-negative)", marginBottom: 6 }}>
            Something broke
          </div>
          <h1 style={{ fontSize: 22, margin: "0 0 14px", fontWeight: 500 }}>The app hit an error</h1>
          <div style={{ background: "rgba(224,133,133,0.18)", color: "var(--ls-negative)", padding: "10px 14px", borderRadius: 8, fontSize: 13, marginBottom: 16, wordBreak: "break-word" }}>
            {msg}
          </div>
          <div style={{ fontSize: 13, color: "var(--ls-textDim)", lineHeight: 1.6, marginBottom: 16 }}>
            Your saved data is not affected. Try reloading. If it keeps happening,
            send the message above — it says exactly what went wrong.
          </div>
          <button
            onClick={() => {
              // Clear the service worker cache too — a stale broken build can
              // otherwise survive an ordinary reload.
              if ("serviceWorker" in navigator) {
                navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister()));
              }
              if (window.caches) caches.keys().then((ks) => ks.forEach((k) => caches.delete(k)));
              setTimeout(() => window.location.reload(), 300);
            }}
            style={{
              width: "100%", background: "var(--ls-accent)", color: "var(--ls-bg)", border: "none",
              borderRadius: 12, padding: "14px 0", fontSize: 15, fontWeight: 600, cursor: "pointer",
            }}
          >
            Reload the app
          </button>
        </div>
      </div>
    );
  }
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);

import { useEffect, useState } from "react";
import { api, fetchMe, type Finding, type Me } from "../lib/api";
import { findingHelp } from "../lib/finding-fix";
import { navigate } from "../lib/router";

type Props = {
  me: Me | null;
  onMe: (me: Me) => void;
};

const PERMS = [
  "Webhook Endpoints: Read",
  "Events: Read",
  "Events: Write (resend)",
  "Subscriptions: Read",
  "Invoices: Read",
  "Customers: Read",
];

export function AppPage({ me, onMe }: Props) {
  const [email, setEmail] = useState("");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [lastScanAt, setLastScanAt] = useState<number | null>(null);
  const [replaying, setReplaying] = useState<string | null>(null);

  const qs = new URLSearchParams(window.location.search);

  useEffect(() => {
    const token = qs.get("token");
    const sessionId = qs.get("session_id");
    const checkout = qs.get("checkout");
    async function boot() {
      try {
        if (token) {
          const next = await api<Me>(`/auth/verify?token=${encodeURIComponent(token)}`);
          onMe(next);
          window.history.replaceState({}, "", "/leak/app");
          return;
        }
        if (checkout === "success" && sessionId) {
          const next = await api<Me>("/checkout/confirm", {
            method: "POST",
            body: JSON.stringify({ sessionId }),
          });
          onMe(next);
          window.history.replaceState({}, "", "/leak/app");
        }
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Could not complete sign-in.");
      }
    }
    void boot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!me?.pro) return;
    void loadFindings();
  }, [me?.pro, me?.connected]);

  async function loadFindings() {
    try {
      const data = await api<{ findings: Finding[]; lastScanAt: number | null }>("/findings");
      setFindings(data.findings);
      setLastScanAt(data.lastScanAt);
    } catch {
      /* not connected yet */
    }
  }

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const res = await api<{ loginUrl?: string }>("/auth/request", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      setMsg(res.loginUrl ? `Dev link: ${res.loginUrl}` : "Check your email for a sign-in link.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not send the link.");
    } finally {
      setBusy(false);
    }
  }

  async function checkout() {
    setBusy(true);
    setErr(null);
    try {
      const { url } = await api<{ url: string }>("/checkout", { method: "POST", body: "{}" });
      window.location.href = url;
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Checkout failed.");
      setBusy(false);
    }
  }

  async function portal() {
    setBusy(true);
    try {
      const { url } = await api<{ url: string }>("/portal", { method: "POST" });
      window.location.href = url;
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Portal failed.");
      setBusy(false);
    }
  }

  async function logout() {
    await api("/auth/logout", { method: "POST" });
    onMe(await fetchMe());
    navigate("/");
  }

  async function connect(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await api("/stripe/connect", { method: "POST", body: JSON.stringify({ key }) });
      setKey("");
      onMe(await fetchMe());
      setMsg("Key saved. Run a scan.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not connect that key.");
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!confirm("Remove the stored key and findings for this account?")) return;
    setBusy(true);
    try {
      await api("/stripe/disconnect", { method: "POST" });
      onMe(await fetchMe());
      setFindings([]);
      setLastScanAt(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Disconnect failed.");
    } finally {
      setBusy(false);
    }
  }

  async function scan() {
    setBusy(true);
    setErr(null);
    try {
      await api("/scan", { method: "POST" });
      await loadFindings();
      onMe(await fetchMe());
      setMsg("Scan finished.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Scan failed.");
    } finally {
      setBusy(false);
    }
  }

  async function replay(findingId: string) {
    setReplaying(findingId);
    setErr(null);
    try {
      await api("/replay", { method: "POST", body: JSON.stringify({ findingId }) });
      await loadFindings();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Replay failed.");
    } finally {
      setReplaying(null);
    }
  }

  return (
    <div className="shell">
      <header className="top">
        <button className="brand" type="button" onClick={() => navigate("/")}>
          <span className="brand-mark">Lk</span>
          Leak
        </button>
        <div className="row">
          {me?.email ? <span className="muted">{me.email}</span> : null}
          {me?.pro ? (
            <span className="pill">{me.status}</span>
          ) : null}
          {me?.email ? (
            <button className="btn" type="button" onClick={() => void logout()}>
              Sign out
            </button>
          ) : null}
        </div>
      </header>

      {!me?.email ? (
        <section className="card" style={{ maxWidth: 420 }}>
          <h2>Sign in</h2>
          <p className="muted">We’ll email a one-time link. Checkout also signs you in.</p>
          <form className="stack" onSubmit={(e) => void signIn(e)}>
            <input
              type="email"
              required
              placeholder="you@company.com"
              value={email}
              onChange={(ev) => setEmail(ev.target.value)}
            />
            <button className="btn primary" type="submit" disabled={busy}>
              Email link
            </button>
          </form>
          <p className="muted">No account yet?</p>
          <button className="btn" type="button" disabled={busy} onClick={() => void checkout()}>
            Start 7-day trial · $39/mo
          </button>
        </section>
      ) : null}

      {me?.email && !me.pro ? (
        <section className="card">
          <h2>Start a trial to connect Stripe</h2>
          <p className="muted">Connect, scan, and replay are included on Pro ($39/mo, 7-day trial).</p>
          <button className="btn primary" type="button" disabled={busy} onClick={() => void checkout()}>
            Start 7-day trial
          </button>
        </section>
      ) : null}

      {me?.pro ? (
        <>
          <section className="card">
            <h2>Connect</h2>
            <p className="muted">
              Paste a restricted key only (<code>rk_test_</code> / <code>rk_live_</code>). Never a
              secret key.{" "}
              <a href="https://dashboard.stripe.com/apikeys" target="_blank" rel="noreferrer">
                Create one in the Dashboard
              </a>
              .
            </p>
            <ul className="perms">
              {PERMS.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
            {me.connected ? (
              <p className="ok">
                Connected · {me.livemode ? "live" : "test"} · ••••{me.last4}
              </p>
            ) : null}
            <form className="stack" onSubmit={(e) => void connect(e)}>
              <input
                type="password"
                autoComplete="off"
                placeholder="rk_live_… or rk_test_…"
                value={key}
                onChange={(ev) => setKey(ev.target.value)}
              />
              <div className="row">
                <button className="btn primary" type="submit" disabled={busy || !key}>
                  Save key
                </button>
                {me.connected ? (
                  <button className="btn danger" type="button" disabled={busy} onClick={() => void disconnect()}>
                    Disconnect
                  </button>
                ) : null}
              </div>
            </form>
          </section>

          <section className="card" style={{ marginTop: 16 }}>
            <header className="row" style={{ justifyContent: "space-between" }}>
              <h2>Findings</h2>
              <div className="row">
                <span className="muted">
                  {lastScanAt ? `Last scan ${new Date(lastScanAt).toLocaleString()}` : "Not scanned yet"}
                </span>
                <button className="btn" type="button" disabled={busy || !me.connected} onClick={() => void scan()}>
                  Run now
                </button>
              </div>
            </header>
            {findings.length === 0 ? (
              <p className="muted">No open findings. Connect a key and run a scan.</p>
            ) : (
              <div className="stack" style={{ marginTop: 12 }}>
                {findings.map((f) => {
                  const help = findingHelp(f.kind, f.stripe_id, me.livemode, f.detail);
                  return (
                    <article key={f.id} className="finding">
                      <header>
                        <span className={`pill ${f.severity}`}>{f.severity}</span>
                        <span className="pill">{f.status}</span>
                        <strong>{f.title}</strong>
                        {f.stripe_id ? <span className="mono muted">{f.stripe_id}</span> : null}
                      </header>
                      <p className="why">{help.why}</p>
                      {help.steps.length ? (
                        <div className="fix">
                          <h3>How to fix</h3>
                          <ol>
                            {help.steps.map((step) => (
                              <li key={step}>{step}</li>
                            ))}
                          </ol>
                          {help.links.length ? (
                            <div className="row">
                              {help.links.map((link) => (
                                <a
                                  key={link.href}
                                  className="btn"
                                  href={link.href}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  {link.label}
                                </a>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        <p className="muted detail">{f.detail}</p>
                      )}
                      {f.kind === "delivery_failed" ? (
                        <button
                          className="btn"
                          type="button"
                          disabled={f.status === "replayed" || replaying === f.id}
                          onClick={() => void replay(f.id)}
                        >
                          {f.status === "replayed"
                            ? "Replayed"
                            : replaying === f.id
                              ? "Replaying…"
                              : "Replay after the endpoint is fixed"}
                        </button>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          <section className="card" style={{ marginTop: 16 }}>
            <h2>Account</h2>
            <p>
              {me.email} · {me.status}
              {me.plan ? ` · ${me.plan}` : ""}
            </p>
            <button className="btn" type="button" disabled={busy} onClick={() => void portal()}>
              Customer Portal
            </button>
          </section>
        </>
      ) : null}

      {msg ? <p className="ok">{msg}</p> : null}
      {err ? <p className="err">{err}</p> : null}
    </div>
  );
}

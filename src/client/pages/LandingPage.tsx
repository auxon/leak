import { useState } from "react";
import { api } from "../lib/api";
import { navigate } from "../lib/router";
import type { Me } from "../lib/api";

type Props = {
  me: Me | null;
};

export function LandingPage({ me }: Props) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function checkout() {
    setErr(null);
    setBusy(true);
    try {
      const { url } = await api<{ url: string }>("/checkout", { method: "POST", body: "{}" });
      window.location.href = url;
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Checkout failed.");
      setBusy(false);
    }
  }

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setMsg(null);
    setBusy(true);
    try {
      const res = await api<{ ok: true; loginUrl?: string }>("/auth/request", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      if (res.loginUrl) {
        setMsg(`Dev link: ${res.loginUrl}`);
      } else {
        setMsg("Check your email for a sign-in link.");
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not send the link.");
    } finally {
      setBusy(false);
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
          {me?.email ? (
            <button className="btn" type="button" onClick={() => navigate("/app")}>
              Dashboard
            </button>
          ) : null}
          <button className="btn primary" type="button" disabled={busy} onClick={() => void checkout()}>
            Start 7-day trial
          </button>
        </div>
      </header>

      <section className="hero">
        <h1>Failed deliveries, disabled endpoints, missing events, past-due subs — replay in one click.</h1>
        <p className="lead">
          Leak watches your Stripe account with a restricted key. It surfaces webhook failures and
          past-due subscriptions so you can fix them before they become silent revenue leaks.
        </p>
        <div className="row">
          <button className="btn primary" type="button" disabled={busy} onClick={() => void checkout()}>
            Start 7-day trial · $39/mo
          </button>
          <button className="btn" type="button" onClick={() => navigate("/app")}>
            Sign in
          </button>
        </div>
      </section>

      <div className="grid">
        <article className="card">
          <h3>No endpoint / disabled</h3>
          <p>Stripe stops sending after retries. We flag missing and disabled webhook endpoints.</p>
        </article>
        <article className="card">
          <h3>Missing events</h3>
          <p>
            At least one enabled endpoint must listen for invoice paid/failed, subscription
            updated/deleted, and checkout completed.
          </p>
        </article>
        <article className="card">
          <h3>Failed deliveries</h3>
          <p>Events with unsuccessful delivery in the last 15 days — resend them from Leak.</p>
        </article>
        <article className="card">
          <h3>Past-due still open</h3>
          <p>
            Stripe thinks these subscriptions are past_due. If your app still treats them as Pro,
            you are leaking.
          </p>
        </article>
      </div>

      <p className="note">
        Restricted key only — never a secret key. We store an encrypted <code>rk_</code> and never
        send it back to the browser. Leak cannot see your app database; findings come from Stripe
        APIs only.
      </p>

      {!me?.email ? (
        <form className="stack" style={{ marginTop: 32, maxWidth: 360 }} onSubmit={(e) => void signIn(e)}>
          <label htmlFor="email">Already have an account?</label>
          <input
            id="email"
            type="email"
            required
            placeholder="you@company.com"
            value={email}
            onChange={(ev) => setEmail(ev.target.value)}
          />
          <button className="btn" type="submit" disabled={busy}>
            Email me a sign-in link
          </button>
        </form>
      ) : null}

      {msg ? <p className="ok">{msg}</p> : null}
      {err ? <p className="err">{err}</p> : null}

      <footer className="foot">Leak · EntangleIT · $39/month after a 7-day trial</footer>
    </div>
  );
}

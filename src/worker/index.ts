import {
  cookieHeader,
  parseCookie,
  randomToken,
  sha256Hex,
  signSession,
  verifySession,
  verifyStripeSignature,
} from "./crypto";
import { sendEmail } from "./email";
import { unwrapSecret, wrapSecret } from "./keys";
import { collectFindings, persistFindings } from "./scan";
import {
  createCheckoutSession,
  createPortalSession,
  findCustomerByEmail,
  getCheckoutSession,
  getSubscription,
  stripeConfigured,
  type StripeSubscription,
} from "./stripe-platform";
import { probeKey, retryEvent, listWebhookEndpoints } from "./stripe-customer";
import {
  deleteAccount,
  getAccount,
  getEntitlement,
  isProStatus,
  magicKey,
  putAccount,
  putEntitlement,
  rateKey,
  type AccountRecord,
  type Entitlement,
  type FindingRow,
  type MeResponse,
  type Plan,
} from "./store";

const PREFIX = "/leak";
const SESSION_DAYS = 90;
const MAGIC_TTL_SEC = 60 * 15;
const SCAN_INTERVAL_MS = 15 * 60 * 1000;
const ALERT_THROTTLE_MS = 60 * 60 * 1000;

function json(data: unknown, status = 200, extra?: HeadersInit): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...Object.fromEntries(new Headers(extra)),
    },
  });
}

function appUrl(env: Env, path: string): string {
  const base = env.APP_BASE.replace(/\/$/, "");
  return `${env.APP_ORIGIN}${base}${path}`;
}

function isLocal(url: URL): boolean {
  return url.hostname === "localhost" || url.hostname === "127.0.0.1";
}

function cookiePath(env: Env): string {
  return env.APP_BASE || "/leak";
}

function toMe(
  email: string | null,
  ent: Entitlement | null,
  acct: AccountRecord | null,
  configured: boolean,
): MeResponse {
  const status = ent?.status ?? "free";
  return {
    email,
    status: email && isProStatus(status) ? status : email ? status : "free",
    plan: ent?.plan ?? null,
    currentPeriodEnd: ent?.currentPeriodEnd ?? null,
    configured,
    pro: Boolean(email && isProStatus(status)),
    connected: Boolean(acct),
    last4: acct?.last4 ?? null,
    livemode: acct?.livemode ?? null,
  };
}

async function sessionEmail(request: Request, env: Env): Promise<string | null> {
  const token = parseCookie(request.headers.get("cookie"), "leak_session");
  if (!token || !env.SESSION_SECRET) return null;
  return verifySession(token, env.SESSION_SECRET);
}

async function setSession(env: Env, request: Request, email: string): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + SESSION_DAYS * 24 * 60 * 60;
  const token = await signSession(email, exp, env.SESSION_SECRET);
  return cookieHeader("leak_session", token, {
    maxAge: SESSION_DAYS * 24 * 60 * 60,
    secure: !isLocal(new URL(request.url)),
    path: cookiePath(env),
  });
}

function clearSession(env: Env, request: Request): string {
  return cookieHeader("leak_session", "", {
    maxAge: 0,
    secure: !isLocal(new URL(request.url)),
    path: cookiePath(env),
  });
}

function planForPrice(env: Env, priceId: string | undefined): Plan {
  if (priceId && priceId === env.STRIPE_PRICE_MONTHLY) return "monthly";
  return null;
}

async function entitlementFromSubscription(
  env: Env,
  email: string,
  customerId: string,
  sub: StripeSubscription,
): Promise<Entitlement> {
  const priceId = sub.items?.data?.[0]?.price?.id;
  const periodEnd = sub.current_period_end ? sub.current_period_end * 1000 : Date.now();
  const ent: Entitlement = {
    email,
    customerId,
    subscriptionId: sub.id,
    status: (sub.status as Entitlement["status"]) ?? "free",
    priceId: priceId ?? "",
    plan: planForPrice(env, priceId),
    currentPeriodEnd: periodEnd,
    updatedAt: Date.now(),
  };
  await putEntitlement(env.KV, ent);
  return ent;
}

async function requireEmail(request: Request, env: Env): Promise<string | Response> {
  const email = await sessionEmail(request, env);
  if (!email) return json({ error: "Sign in first." }, 401);
  return email;
}

async function requirePro(request: Request, env: Env): Promise<string | Response> {
  const emailOr = await requireEmail(request, env);
  if (emailOr instanceof Response) return emailOr;
  const ent = await getEntitlement(env.KV, emailOr);
  if (!isProStatus(ent?.status)) return json({ error: "Start a trial to connect Stripe." }, 402);
  return emailOr;
}

async function customerKeyFor(env: Env, email: string): Promise<string | null> {
  const acct = await getAccount(env.KV, email);
  if (!acct) return null;
  return unwrapSecret(acct.wrappedKey, env.KEY_ENCRYPTION_KEY);
}

async function handleMe(request: Request, env: Env): Promise<Response> {
  const email = await sessionEmail(request, env);
  const ent = email ? await getEntitlement(env.KV, email) : null;
  const acct = email ? await getAccount(env.KV, email) : null;
  return json(toMe(email, ent, acct, stripeConfigured(env)));
}

async function handleAuthRequest(request: Request, env: Env): Promise<Response> {
  if (!env.SESSION_SECRET) return json({ error: "Auth is not configured yet." }, 503);
  const body = (await request.json()) as { email?: string };
  const email = (body.email ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: "Enter a valid email." }, 400);
  }
  const rl = rateKey(email);
  if (await env.KV.get(rl)) return json({ ok: true });
  await env.KV.put(rl, "1", { expirationTtl: 60 });

  const token = randomToken(24);
  const hash = await sha256Hex(token);
  await env.KV.put(magicKey(hash), email, { expirationTtl: MAGIC_TTL_SEC });
  const loginUrl = appUrl(env, `/app?token=${token}`);

  if (env.RESEND_API_KEY) {
    const ok = await sendEmail(
      env,
      email,
      "Your Leak sign-in link",
      `Sign in to Leak:\n\n${loginUrl}\n\nThis link expires in 15 minutes. If you did not request it, ignore this email.`,
    );
    if (!ok) return json({ error: "Could not send the sign-in email. Try again in a minute." }, 502);
    return json({ ok: true });
  }
  if (env.ENVIRONMENT !== "production") return json({ ok: true, loginUrl });
  return json(
    {
      error:
        "Email sign-in is not configured yet. Start a 7-day trial with Stripe — that signs you in.",
    },
    503,
  );
}

async function handleAuthVerify(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") ?? "";
  if (!token) return json({ error: "Missing sign-in link." }, 400);
  const hash = await sha256Hex(token);
  const email = await env.KV.get(magicKey(hash));
  if (!email) return json({ error: "That sign-in link expired. Request a new one." }, 400);
  await env.KV.delete(magicKey(hash));
  const ent = await getEntitlement(env.KV, email);
  const acct = await getAccount(env.KV, email);
  return json(toMe(email, ent, acct, stripeConfigured(env)), 200, {
    "set-cookie": await setSession(env, request, email),
  });
}

async function handleLogout(request: Request, env: Env): Promise<Response> {
  return json({ ok: true }, 200, { "set-cookie": clearSession(env, request) });
}

async function handleCheckout(request: Request, env: Env): Promise<Response> {
  if (!stripeConfigured(env)) return json({ error: "Billing is not configured yet." }, 503);
  const email = await sessionEmail(request, env);
  let customer = email ? await findCustomerByEmail(env, email) : null;
  if (email) {
    const ent = await getEntitlement(env.KV, email);
    if (ent && isProStatus(ent.status) && ent.customerId) {
      const portal = await createPortalSession(env, ent.customerId, appUrl(env, "/app"));
      return json({ url: portal.url });
    }
    if (ent?.customerId) customer = ent.customerId;
  }
  try {
    const session = await createCheckoutSession(env, {
      priceId: env.STRIPE_PRICE_MONTHLY,
      customerId: customer,
      customerEmail: customer ? undefined : (email ?? undefined),
      successUrl: appUrl(env, "/app?checkout=success&session_id={CHECKOUT_SESSION_ID}"),
      cancelUrl: appUrl(env, "/"),
    });
    if (!session.url) return json({ error: "Could not start checkout." }, 502);
    return json({ url: session.url });
  } catch (err) {
    console.error(JSON.stringify({ msg: "checkout_failed", err: String(err) }));
    return json(
      { error: err instanceof Error ? err.message : "Could not start checkout." },
      502,
    );
  }
}

async function handleConfirm(request: Request, env: Env): Promise<Response> {
  if (!stripeConfigured(env)) return json({ error: "Billing is not configured yet." }, 503);
  const body = (await request.json()) as { sessionId?: string };
  const sessionId = body.sessionId ?? "";
  if (!sessionId.startsWith("cs_")) return json({ error: "Missing checkout session." }, 400);
  const session = await getCheckoutSession(env, sessionId);
  const email = (session.customer_details?.email ?? session.customer_email ?? "").trim().toLowerCase();
  if (!email) return json({ error: "Checkout did not include an email." }, 400);
  const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id;
  const subscriptionId =
    typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
  if (customerId && subscriptionId) {
    const sub = await getSubscription(env, subscriptionId);
    await entitlementFromSubscription(env, email, customerId, sub);
  }
  const ent = await getEntitlement(env.KV, email);
  const acct = await getAccount(env.KV, email);
  return json(toMe(email, ent, acct, true), 200, {
    "set-cookie": await setSession(env, request, email),
  });
}

async function handlePortal(request: Request, env: Env): Promise<Response> {
  if (!stripeConfigured(env)) return json({ error: "Billing is not configured yet." }, 503);
  const emailOr = await requireEmail(request, env);
  if (emailOr instanceof Response) return emailOr;
  const ent = await getEntitlement(env.KV, emailOr);
  const customerId = ent?.customerId ?? (await findCustomerByEmail(env, emailOr));
  if (!customerId) return json({ error: "No billing account for this email yet." }, 404);
  const portal = await createPortalSession(env, customerId, appUrl(env, "/app"));
  return json({ url: portal.url });
}

async function handlePlatformWebhook(request: Request, env: Env): Promise<Response> {
  if (!env.STRIPE_WEBHOOK_SECRET || !env.STRIPE_SECRET_KEY) {
    return json({ error: "Webhook not configured." }, 503);
  }
  const payload = await request.text();
  const sig = request.headers.get("stripe-signature") ?? "";
  const ok = await verifyStripeSignature(payload, sig, env.STRIPE_WEBHOOK_SECRET);
  if (!ok) return json({ error: "Invalid signature." }, 400);
  const event = JSON.parse(payload) as { type: string; data: { object: Record<string, unknown> } };

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as {
      customer?: string | { id: string };
      customer_email?: string;
      customer_details?: { email?: string };
      subscription?: string | { id: string };
    };
    const email = (session.customer_details?.email ?? session.customer_email ?? "").trim().toLowerCase();
    const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id;
    const subscriptionId =
      typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
    if (email && customerId && subscriptionId) {
      const sub = await getSubscription(env, subscriptionId);
      await entitlementFromSubscription(env, email, customerId, sub);
    }
  }

  if (
    event.type === "customer.subscription.updated" ||
    event.type === "customer.subscription.deleted" ||
    event.type === "customer.subscription.created"
  ) {
    const sub = event.data.object as StripeSubscription & { customer?: string };
    const customerId = typeof sub.customer === "string" ? sub.customer : undefined;
    if (customerId && sub.id) {
      const full = await getSubscription(env, sub.id);
      const email = (
        full.customer && typeof full.customer === "object"
          ? (full.customer as { email?: string }).email
          : undefined
      )
        ?.trim()
        .toLowerCase();
      const existingEmail =
        email ?? (await env.KV.get(`cust:${customerId}`)) ?? (await findEmailForCustomer(env, customerId));
      if (existingEmail) {
        await env.KV.put(`cust:${customerId}`, existingEmail);
        await entitlementFromSubscription(env, existingEmail, customerId, full);
      }
    }
  }

  return json({ received: true });
}

async function findEmailForCustomer(env: Env, customerId: string): Promise<string | null> {
  const listed = await env.KV.list({ prefix: "ent:" });
  for (const key of listed.keys) {
    const ent = await env.KV.get<Entitlement>(key.name, "json");
    if (ent?.customerId === customerId) return ent.email;
  }
  return null;
}

async function handleConnect(request: Request, env: Env): Promise<Response> {
  const emailOr = await requirePro(request, env);
  if (emailOr instanceof Response) return emailOr;
  if (!env.KEY_ENCRYPTION_KEY) return json({ error: "Key encryption is not configured yet." }, 503);
  const body = (await request.json()) as { key?: string };
  const key = (body.key ?? "").trim();
  if (!/^rk_(test|live)_/.test(key)) {
    return json({ error: "Paste a restricted key (rk_test_ or rk_live_). Secret keys (sk_) are not accepted." }, 400);
  }
  try {
    await probeKey(key);
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 401 || status === 403) {
      return json(
        {
          error:
            "That key was rejected. Grant Webhook Endpoints Read, Events Read+Write, Subscriptions Read, Invoices Read, and Customers Read.",
        },
        403,
      );
    }
    throw err;
  }
  const wrappedKey = await wrapSecret(key, env.KEY_ENCRYPTION_KEY);
  const acct: AccountRecord = {
    wrappedKey,
    livemode: key.startsWith("rk_live_"),
    last4: key.slice(-4),
    createdAt: Date.now(),
    nextScanAt: Date.now(),
  };
  await putAccount(env.KV, emailOr, acct);
  return json({ ok: true, last4: acct.last4, livemode: acct.livemode });
}

async function handleDisconnect(request: Request, env: Env): Promise<Response> {
  const emailOr = await requireEmail(request, env);
  if (emailOr instanceof Response) return emailOr;
  await deleteAccount(env.KV, emailOr);
  await env.DB.prepare("DELETE FROM findings WHERE email = ?").bind(emailOr).run();
  await env.DB.prepare("DELETE FROM scan_runs WHERE email = ?").bind(emailOr).run();
  return json({ ok: true });
}

async function runScanForEmail(env: Env, email: string): Promise<{ created: number; reopened: number }> {
  const key = await customerKeyFor(env, email);
  if (!key) throw new Error("not_connected");
  const drafts = await collectFindings(key);
  const { created, reopened } = await persistFindings(env.DB, email, drafts);
  const acct = await getAccount(env.KV, email);
  if (acct) {
    const now = Date.now();
    const shouldAlert =
      (created.length > 0 || reopened.length > 0) &&
      (!acct.lastAlertAt || now - acct.lastAlertAt >= ALERT_THROTTLE_MS);
    if (shouldAlert) {
      const lines = [...created, ...reopened].map((f) => `- ${f.title}: ${f.detail}`).join("\n");
      await sendEmail(
        env,
        email,
        `Leak found ${created.length + reopened.length} issue(s)`,
        `New or reopened findings:\n\n${lines}\n\n${appUrl(env, "/app")}`,
      );
      acct.lastAlertAt = now;
    }
    acct.nextScanAt = now + SCAN_INTERVAL_MS;
    await putAccount(env.KV, email, acct);
  }
  return { created: created.length, reopened: reopened.length };
}

async function handleScan(request: Request, env: Env): Promise<Response> {
  const emailOr = await requirePro(request, env);
  if (emailOr instanceof Response) return emailOr;
  const acct = await getAccount(env.KV, emailOr);
  if (!acct) return json({ error: "Connect a restricted key first." }, 400);
  try {
    const result = await runScanForEmail(env, emailOr);
    return json({ ok: true, ...result });
  } catch (err) {
    console.error(JSON.stringify({ msg: "scan_failed", err: String(err) }));
    return json({ error: "Scan failed. Check that the key still has the required permissions." }, 502);
  }
}

async function handleFindings(request: Request, env: Env): Promise<Response> {
  const emailOr = await requirePro(request, env);
  if (emailOr instanceof Response) return emailOr;
  const rows = await env.DB.prepare(
    "SELECT * FROM findings WHERE email = ? AND status != 'resolved' ORDER BY last_seen DESC",
  )
    .bind(emailOr)
    .all<FindingRow>();
  const last = await env.DB.prepare(
    "SELECT started_at FROM scan_runs WHERE email = ? ORDER BY started_at DESC LIMIT 1",
  )
    .bind(emailOr)
    .first<{ started_at: number }>();
  return json({ findings: rows.results ?? [], lastScanAt: last?.started_at ?? null });
}

async function handleReplay(request: Request, env: Env): Promise<Response> {
  const emailOr = await requirePro(request, env);
  if (emailOr instanceof Response) return emailOr;
  const body = (await request.json()) as { findingId?: string };
  const findingId = body.findingId ?? "";
  const row = await env.DB.prepare("SELECT * FROM findings WHERE id = ? AND email = ?")
    .bind(findingId, emailOr)
    .first<FindingRow>();
  if (!row || row.kind !== "delivery_failed" || !row.stripe_id) {
    return json({ error: "That finding cannot be replayed." }, 400);
  }
  const key = await customerKeyFor(env, emailOr);
  if (!key) return json({ error: "Connect a restricted key first." }, 400);
  try {
    const endpoints = await listWebhookEndpoints(key);
    const enabled = endpoints.filter((e) => e.status === "enabled").map((e) => e.id);
    await retryEvent(key, row.stripe_id, enabled);
  } catch (err) {
    const raw = err instanceof Error ? err.message : "Stripe rejected the resend.";
    console.error(JSON.stringify({ msg: "replay_failed", err: raw }));
    const permission = /permission denied|events_write|rak_event_write/i.test(raw);
    return json(
      {
        error: permission
          ? "Your restricted key cannot resend events. In the Stripe Dashboard, edit that rk_ and enable Events: Write, then paste the key into Leak again."
          : raw,
      },
      502,
    );
  }
  await env.DB.prepare("UPDATE findings SET status = ? WHERE id = ?").bind("replayed", row.id).run();
  return json({ ok: true });
}

async function routeApi(request: Request, env: Env, path: string): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { status: 204 });
  if (path === "/api/health" && request.method === "GET") {
    return json({ ok: true, stripe: stripeConfigured(env) });
  }
  if (path === "/api/me" && request.method === "GET") return handleMe(request, env);
  if (path === "/api/auth/request" && request.method === "POST") return handleAuthRequest(request, env);
  if (path === "/api/auth/verify" && request.method === "GET") return handleAuthVerify(request, env);
  if (path === "/api/auth/logout" && request.method === "POST") return handleLogout(request, env);
  if (path === "/api/checkout" && request.method === "POST") return handleCheckout(request, env);
  if (path === "/api/checkout/confirm" && request.method === "POST") return handleConfirm(request, env);
  if (path === "/api/portal" && request.method === "POST") return handlePortal(request, env);
  if (path === "/api/stripe/webhook" && request.method === "POST") return handlePlatformWebhook(request, env);
  if (path === "/api/stripe/connect" && request.method === "POST") return handleConnect(request, env);
  if (path === "/api/stripe/disconnect" && request.method === "POST") return handleDisconnect(request, env);
  if (path === "/api/scan" && request.method === "POST") return handleScan(request, env);
  if (path === "/api/findings" && request.method === "GET") return handleFindings(request, env);
  if (path === "/api/replay" && request.method === "POST") return handleReplay(request, env);
  return json({ error: "Not found" }, 404);
}

async function scheduledScan(env: Env): Promise<void> {
  const listed = await env.KV.list({ prefix: "acct:" });
  const now = Date.now();
  for (const key of listed.keys) {
    const email = key.name.slice("acct:".length);
    const ent = await getEntitlement(env.KV, email);
    if (!isProStatus(ent?.status)) continue;
    const acct = await getAccount(env.KV, email);
    if (!acct) continue;
    if (acct.nextScanAt && acct.nextScanAt > now) continue;
    try {
      await runScanForEmail(env, email);
    } catch (err) {
      console.error(JSON.stringify({ msg: "cron_scan_failed", email, err: String(err) }));
    }
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === PREFIX) {
      url.pathname = `${PREFIX}/`;
      return Response.redirect(url.toString(), 308);
    }

    let stripped = url.pathname;
    if (stripped.startsWith(`${PREFIX}/`)) stripped = stripped.slice(PREFIX.length) || "/";
    else if (stripped === PREFIX) stripped = "/";

    try {
      if (stripped.startsWith("/api/")) {
        return await routeApi(request, env, stripped);
      }
    } catch (err) {
      console.error(JSON.stringify({ msg: "leak_error", err: String(err) }));
      return json({ error: "Something went wrong." }, 500);
    }

    if (env.ASSETS) {
      const assetPath = stripped === "/" ? "/index.html" : stripped;
      const asset = await env.ASSETS.fetch(new Request(new URL(assetPath, "https://assets.local")));
      const isFile = /\.[a-z0-9]+$/i.test(stripped);
      if (asset.status === 200) return asset;
      if (isFile) return new Response("Not found", { status: 404 });
      return env.ASSETS.fetch(new Request(new URL("/index.html", "https://assets.local")));
    }
    return json({ error: "Not found" }, 404);
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(scheduledScan(env));
  },
};

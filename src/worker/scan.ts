import { randomToken } from "./crypto";
import {
  listFailedEvents,
  listOpenInvoices,
  listSubscriptionsByStatus,
  listWebhookEndpoints,
} from "./stripe-customer";
import type { FindingKind, FindingRow } from "./store";

export const CRITICAL_EVENTS = [
  "invoice.payment_failed",
  "invoice.paid",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "checkout.session.completed",
] as const;

const FIFTEEN_DAYS = 15 * 24 * 60 * 60;

export type DraftFinding = {
  kind: FindingKind;
  dedupe_key: string;
  severity: FindingRow["severity"];
  title: string;
  detail: string;
  stripe_id: string | null;
};

function livemodeFromKey(key: string): boolean {
  return key.startsWith("rk_live_");
}

function dash(live: boolean, path: string): string {
  return `${live ? "https://dashboard.stripe.com" : "https://dashboard.stripe.com/test"}${path}`;
}

function describeEndpoints(endpoints: { id: string; url: string; status: string }[]): string {
  if (!endpoints.length) return "None.";
  return endpoints.map((e) => `${e.status} · ${e.id} · ${e.url}`).join("\n");
}

export async function collectFindings(key: string): Promise<DraftFinding[]> {
  const out: DraftFinding[] = [];
  const live = livemodeFromKey(key);
  const endpoints = await listWebhookEndpoints(key);
  const enabled = endpoints.filter((e) => e.status === "enabled");
  const webhookUrl = dash(live, "/webhooks");

  if (endpoints.length === 0) {
    out.push({
      kind: "no_endpoints",
      dedupe_key: "no_endpoints",
      severity: "critical",
      title: "No webhook endpoints",
      detail: [
        "Stripe has no destination for Checkout or subscription events, so your app will not be notified.",
        `Fix: ${webhookUrl} → Add destination → paste your HTTPS handler URL.`,
        "Subscribe at least to invoice.payment_failed, invoice.paid, customer.subscription.updated, customer.subscription.deleted, and checkout.session.completed.",
      ].join("\n"),
      stripe_id: null,
    });
  }

  for (const ep of endpoints) {
    if (ep.status !== "enabled") {
      out.push({
        kind: "endpoint_disabled",
        dedupe_key: `disabled:${ep.id}`,
        severity: "critical",
        title: "Webhook endpoint disabled",
        detail: [
          `${ep.url} is ${ep.status}. Stripe stops sending after retries fail.`,
          `Fix: ${dash(live, `/webhooks/${ep.id}`)} → check failed attempts → repair the URL/handler so it returns 2xx → Enable endpoint.`,
          "Then replay any failed events still in the 15-day window.",
        ].join("\n"),
        stripe_id: ep.id,
      });
    }
  }

  if (enabled.length > 0) {
    const covered = new Set<string>();
    for (const ep of enabled) {
      if (ep.enabled_events.includes("*")) {
        for (const ev of CRITICAL_EVENTS) covered.add(ev);
      }
      for (const ev of ep.enabled_events) covered.add(ev);
    }
    const missing = CRITICAL_EVENTS.filter((ev) => !covered.has(ev));
    if (missing.length) {
      out.push({
        kind: "missing_events",
        dedupe_key: `missing:${missing.slice().sort().join(",")}`,
        severity: "warning",
        title: "Missing critical webhook events",
        detail: [
          `No enabled endpoint listens for: ${missing.join(", ")}.`,
          "Enabled endpoints:",
          describeEndpoints(enabled),
          `Fix: ${webhookUrl} → open an enabled endpoint your app handles → Update details → add those events → Save.`,
          "One enabled endpoint covering all of them is enough. Then run a scan again.",
        ].join("\n"),
        stripe_id: null,
      });
    }
  }

  const since = Math.floor(Date.now() / 1000) - FIFTEEN_DAYS;
  const failed = await listFailedEvents(key, since);
  for (const ev of failed) {
    out.push({
      kind: "delivery_failed",
      dedupe_key: `fail:${ev.id}`,
      severity: "critical",
      title: `Failed delivery: ${ev.type}`,
      detail: [
        `${ev.id} did not deliver to all endpoints in the last 15 days.`,
        `Your endpoints:\n${describeEndpoints(endpoints)}`,
        `Fix: ${dash(live, `/events/${ev.id}`)} → Webhook attempts → note the URL and HTTP status.`,
        "Repair or disable that endpoint so it returns 2xx (or is no longer used). Then click Replay here. Replaying into a still-broken URL will fail again.",
      ].join("\n"),
      stripe_id: ev.id,
    });
  }

  const pastDue = [
    ...(await listSubscriptionsByStatus(key, "past_due")),
    ...(await listSubscriptionsByStatus(key, "unpaid")),
  ];
  for (const sub of pastDue) {
    out.push({
      kind: "past_due_sub",
      dedupe_key: `past_due:${sub.id}`,
      severity: "warning",
      title: `Subscription ${sub.status}`,
      detail: [
        `${sub.id} is ${sub.status} in Stripe. If your app still treats this customer as Pro, you are leaking access.`,
        `Fix: ${dash(live, `/subscriptions/${sub.id}`)} → confirm the failed invoice and payment method.`,
        "In your app, only active/trialing should keep Pro unless you have an explicit grace period. Retry or collect a new card if they should stay paid.",
      ].join("\n"),
      stripe_id: sub.id,
    });
  }

  const invoices = await listOpenInvoices(key);
  for (const inv of invoices) {
    if (!inv.attempted && !inv.next_payment_attempt) continue;
    const amount = inv.amount_due != null ? (inv.amount_due / 100).toFixed(2) : "?";
    out.push({
      kind: "open_invoice",
      dedupe_key: `invoice:${inv.id}`,
      severity: "warning",
      title: "Open invoice after payment attempt",
      detail: [
        `${inv.id} is open (${amount} ${inv.currency ?? "usd"}). A failed charge may have left the customer entitled in your app.`,
        `Fix: ${dash(live, `/invoices/${inv.id}`)} → see the decline reason, retry, collect a new payment method, or void if access should end.`,
        "Your handler for invoice.payment_failed should revoke or freeze Pro until this invoice is paid.",
      ].join("\n"),
      stripe_id: inv.id,
    });
  }

  return out;
}

export async function persistFindings(
  db: D1Database,
  email: string,
  drafts: DraftFinding[],
): Promise<{ runId: string; created: FindingRow[]; reopened: FindingRow[] }> {
  const now = Date.now();
  const runId = randomToken(16);
  await db
    .prepare(
      "INSERT INTO scan_runs (id, email, started_at, finished_at, ok, summary) VALUES (?, ?, ?, ?, 1, ?)",
    )
    .bind(runId, email, now, now, JSON.stringify({ count: drafts.length }))
    .run();

  const existing = await db
    .prepare("SELECT * FROM findings WHERE email = ?")
    .bind(email)
    .all<FindingRow>();
  const byKey = new Map((existing.results ?? []).map((f) => [f.dedupe_key, f]));
  const seen = new Set<string>();
  const created: FindingRow[] = [];
  const reopened: FindingRow[] = [];

  for (const d of drafts) {
    seen.add(d.dedupe_key);
    const prev = byKey.get(d.dedupe_key);
    if (!prev) {
      const row: FindingRow = {
        id: randomToken(16),
        email,
        kind: d.kind,
        dedupe_key: d.dedupe_key,
        severity: d.severity,
        title: d.title,
        detail: d.detail,
        stripe_id: d.stripe_id,
        status: "open",
        first_seen: now,
        last_seen: now,
      };
      await db
        .prepare(
          `INSERT INTO findings (id, email, kind, dedupe_key, severity, title, detail, stripe_id, status, first_seen, last_seen)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          row.id,
          row.email,
          row.kind,
          row.dedupe_key,
          row.severity,
          row.title,
          row.detail,
          row.stripe_id,
          row.status,
          row.first_seen,
          row.last_seen,
        )
        .run();
      created.push(row);
      continue;
    }
    const reopen = prev.status === "resolved";
    await db
      .prepare(
        `UPDATE findings SET severity = ?, title = ?, detail = ?, stripe_id = ?, status = ?, last_seen = ?
         WHERE id = ?`,
      )
      .bind(
        d.severity,
        d.title,
        d.detail,
        d.stripe_id,
        reopen ? "open" : prev.status === "replayed" ? "replayed" : "open",
        now,
        prev.id,
      )
      .run();
    if (reopen) {
      reopened.push({ ...prev, status: "open", last_seen: now, title: d.title, detail: d.detail });
    }
  }

  for (const prev of existing.results ?? []) {
    if (seen.has(prev.dedupe_key)) continue;
    if (prev.status === "resolved") continue;
    await db
      .prepare("UPDATE findings SET status = ?, last_seen = ? WHERE id = ?")
      .bind("resolved", now, prev.id)
      .run();
  }

  return { runId, created, reopened };
}

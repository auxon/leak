import type Stripe from "stripe";

/**
 * Leak scan engine, ported from the standalone Leak SaaS
 * (../../src/worker/scan.ts) to the Stripe Apps platform client.
 *
 * Read-only by design: every check is a list call against the installing
 * account. Fixes happen in the Dashboard (deep links) — the app never
 * writes to the account.
 */

export const CRITICAL_EVENTS = [
  "invoice.payment_failed",
  "invoice.paid",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "checkout.session.completed",
] as const;

const FIFTEEN_DAYS = 15 * 24 * 60 * 60;

export type FindingSeverity = "critical" | "warning";

export interface Finding {
  kind: string;
  title: string;
  detail: string;
  severity: FindingSeverity;
  stripeId: string | null;
  /** Deep link into the installer's own Dashboard for the fix. */
  fixUrl: string | null;
}

function dash(livemode: boolean, path: string): string {
  return `${livemode ? "https://dashboard.stripe.com" : "https://dashboard.stripe.com/test"}${path}`;
}

export function summarize(findings: Finding[]): {
  critical: number;
  warnings: number;
  healthy: boolean;
} {
  const critical = findings.filter((f) => f.severity === "critical").length;
  const warnings = findings.filter((f) => f.severity === "warning").length;
  return { critical, warnings, healthy: findings.length === 0 };
}

export async function collectFindings(
  stripe: Stripe,
  livemode: boolean,
): Promise<Finding[]> {
  const out: Finding[] = [];
  const webhookUrl = dash(livemode, "/webhooks");

  const endpoints = await stripe.webhookEndpoints.list({ limit: 100 });
  const enabled = (endpoints.data ?? []).filter((e) => e.status === "enabled");

  if ((endpoints.data ?? []).length === 0) {
    out.push({
      kind: "no_endpoints",
      severity: "critical",
      title: "No webhook endpoints",
      detail:
        "Stripe has no destination for Checkout or subscription events, so your app will not be notified. Subscribe at least to invoice.payment_failed, invoice.paid, customer.subscription.updated, customer.subscription.deleted, and checkout.session.completed.",
      stripeId: null,
      fixUrl: webhookUrl,
    });
  }

  for (const ep of endpoints.data ?? []) {
    if (ep.status === "enabled") continue;
    out.push({
      kind: "endpoint_disabled",
      severity: "critical",
      title: "Webhook endpoint disabled",
      detail: `${ep.url} is ${ep.status}. Stripe stops sending after retries fail. Check failed attempts, repair the handler so it returns 2xx, then re-enable.`,
      stripeId: ep.id,
      fixUrl: dash(livemode, `/webhooks/${ep.id}`),
    });
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
    if (missing.length > 0) {
      out.push({
        kind: "missing_events",
        severity: "warning",
        title: "Missing critical webhook events",
        detail: `No enabled endpoint listens for: ${missing.join(", ")}. One enabled endpoint covering all of them is enough.`,
        stripeId: null,
        fixUrl: webhookUrl,
      });
    }
  }

  const since = Math.floor(Date.now() / 1000) - FIFTEEN_DAYS;
  // delivery_success is a list filter in the Events API; stripe-node types
  // lag behind, hence the targeted cast.
  const failed = await stripe.events.list({
    limit: 100,
    created: { gte: since },
    delivery_success: false,
  } as unknown as Stripe.EventListParams);
  for (const ev of failed.data ?? []) {
    out.push({
      kind: "delivery_failed",
      severity: "critical",
      title: `Failed delivery: ${ev.type}`,
      detail: `${ev.id} did not deliver to all endpoints in the last 15 days. Open it, note the URL and HTTP status, repair or disable that endpoint, then resend from the Dashboard.`,
      stripeId: ev.id,
      fixUrl: dash(livemode, `/events/${ev.id}`),
    });
  }

  for (const status of ["past_due", "unpaid"] as const) {
    const subs = await stripe.subscriptions.list({ status, limit: 100 });
    for (const sub of subs.data ?? []) {
      out.push({
        kind: "past_due_sub",
        severity: "warning",
        title: `Subscription ${sub.status}`,
        detail: `${sub.id} is ${sub.status}. If your app still treats this customer as Pro, you are leaking access. Confirm the failed invoice, retry or collect a new card.`,
        stripeId: sub.id,
        fixUrl: dash(livemode, `/subscriptions/${sub.id}`),
      });
    }
  }

  const invoices = await stripe.invoices.list({ status: "open", limit: 100 });
  for (const inv of invoices.data ?? []) {
    if (!inv.attempted && !inv.next_payment_attempt) continue;
    const amount =
      inv.amount_due != null ? (inv.amount_due / 100).toFixed(2) : "?";
    out.push({
      kind: "open_invoice",
      severity: "warning",
      title: "Open invoice after payment attempt",
      detail: `${inv.id} is open (${amount} ${inv.currency ?? "usd"}). A failed charge may have left the customer entitled. See the decline reason, retry, collect a new method, or void.`,
      stripeId: inv.id ?? null,
      fixUrl: dash(livemode, `/invoices/${inv.id}`),
    });
  }

  return out;
}

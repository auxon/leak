function dash(live: boolean | null, path: string): string {
  const prefix = live === false ? "https://dashboard.stripe.com/test" : "https://dashboard.stripe.com";
  return `${prefix}${path}`;
}

export type FindingHelp = {
  why: string;
  steps: string[];
  links: Array<{ label: string; href: string }>;
};

export function findingHelp(
  kind: string,
  stripeId: string | null,
  livemode: boolean | null,
  detail: string,
): FindingHelp {
  const live = livemode !== false;

  if (kind === "no_endpoints") {
    return {
      why: "Stripe has nowhere to send Checkout and subscription events, so your app will not hear about new customers or failed payments.",
      steps: [
        "Open Developers → Webhooks in the Stripe Dashboard.",
        "Click Add destination and paste the HTTPS URL your app uses for Stripe events.",
        "Subscribe at least to invoice.payment_failed, invoice.paid, customer.subscription.updated, customer.subscription.deleted, and checkout.session.completed.",
        "Signing secret goes in your app only — never paste it into Leak.",
        "Run a scan again in Leak.",
      ],
      links: [{ label: "Open Webhooks", href: dash(live, "/webhooks") }],
    };
  }

  if (kind === "endpoint_disabled") {
    return {
      why: "Stripe disables an endpoint after repeated delivery failures and then stops sending. Events after that never reach your app.",
      steps: [
        "Open the endpoint in Developers → Webhooks.",
        "Check recent attempts for 4xx/5xx, timeouts, or a dead URL.",
        "Fix the URL or handler so it returns 2xx, then click Enable endpoint.",
        "Replay any failed events still in the 15-day window from Leak or from the event page.",
      ],
      links: [
        { label: "Open Webhooks", href: dash(live, "/webhooks") },
        ...(stripeId
          ? [{ label: "Open this endpoint", href: dash(live, `/webhooks/${stripeId}`) }]
          : []),
      ],
    };
  }

  if (kind === "missing_events") {
    const listed = detail.match(/listens for:\s*(.+?)(?:\.|$)/i)?.[1] ?? "the events named above";
    return {
      why: `No enabled webhook is subscribed to ${listed.trim()}. Stripe will not POST those events to your app until they are selected on at least one enabled endpoint.`,
      steps: [
        "Open Developers → Webhooks and click an enabled endpoint (the URL your app actually handles).",
        "Click the overflow menu → Update details.",
        `Under Events, add: ${listed.trim()}.`,
        "Save. You do not need every event on every endpoint — one enabled endpoint covering all of them is enough.",
        "Run a scan again. Leak cannot see whether your handler code ignores the event; this only proves Stripe will send it.",
      ],
      links: [{ label: "Open Webhooks", href: dash(live, "/webhooks") }],
    };
  }

  if (kind === "delivery_failed") {
    return {
      why: "Stripe sent this event and at least one endpoint did not return 2xx in time. Automatic retries may have already stopped. Replay only after the endpoint can succeed.",
      steps: [
        "Open the event in the Dashboard. Expand Webhook attempts and note the URL and HTTP status.",
        "If the URL is wrong or the app is down, fix that first (deploy, TLS, 2xx response within Stripe’s timeout).",
        "If the endpoint is leftover and unused, disable or delete it so it stops failing.",
        "Come back here and click Replay. The connected rk_ must have Events: Write (resend). You can also click Resend on the event page in the Dashboard.",
        "Stripe only keeps events for resend for 15 days.",
      ],
      links: [
        ...(stripeId
          ? [{ label: "Open this event", href: dash(live, `/events/${stripeId}`) }]
          : []),
        { label: "Open Webhooks", href: dash(live, "/webhooks") },
      ],
    };
  }

  if (kind === "past_due_sub") {
    return {
      why: "Stripe has marked this subscription past_due or unpaid. If your app still treats the customer as Pro, they are getting paid features for free.",
      steps: [
        "Open the subscription in the Dashboard and confirm status, failed invoice, and payment method.",
        "In your app, map Stripe status to access: only active and trialing should stay Pro; past_due/unpaid/canceled should lose paid features (or match the grace period you intend).",
        "Fix the customer’s card via Customer Portal or retry the invoice if you want them to keep access.",
        "This finding is not a webhook bug. It is Stripe’s view of money owed.",
      ],
      links: [
        ...(stripeId
          ? [{ label: "Open this subscription", href: dash(live, `/subscriptions/${stripeId}`) }]
          : []),
        { label: "Open subscriptions", href: dash(live, "/subscriptions?status=past_due") },
      ],
    };
  }

  if (kind === "open_invoice") {
    return {
      why: "Stripe still has an open invoice after a payment attempt. The customer may be entitled in your app while this invoice is unpaid.",
      steps: [
        "Open the invoice. See why the charge failed and whether a retry is scheduled.",
        "Collect a new payment method or void the invoice if access should end.",
        "Make sure invoice.payment_failed updates access in your app.",
      ],
      links: [
        ...(stripeId ? [{ label: "Open this invoice", href: dash(live, `/invoices/${stripeId}`) }] : []),
      ],
    };
  }

  return { why: detail, steps: [], links: [] };
}

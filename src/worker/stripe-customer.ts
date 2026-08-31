type StripeList<T> = { data: T[]; has_more?: boolean };

export type WebhookEndpoint = {
  id: string;
  url: string;
  status: string;
  enabled_events: string[];
};

export type StripeEvent = {
  id: string;
  type: string;
  created: number;
  pending_webhooks?: number;
};

export type CustomerSubscription = {
  id: string;
  status: string;
  customer: string | { id: string };
  current_period_end?: number;
};

export type StripeInvoice = {
  id: string;
  status: string;
  attempted?: boolean;
  next_payment_attempt?: number | null;
  customer?: string | { id: string };
  amount_due?: number;
  currency?: string;
};

async function customerGet<T>(key: string, path: string): Promise<T> {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  const data = (await res.json()) as T & { error?: { message?: string; code?: string } };
  if (!res.ok) {
    const err = new Error(data.error?.message ?? `Stripe GET ${path} failed`) as Error & {
      status: number;
    };
    err.status = res.status;
    throw err;
  }
  return data;
}

async function customerPost<T>(
  key: string,
  path: string,
  params?: Record<string, string>,
): Promise<T> {
  const body = new URLSearchParams(params ?? {}).toString();
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const data = (await res.json()) as T & { error?: { message?: string } };
  if (!res.ok) {
    const err = new Error(data.error?.message ?? `Stripe POST ${path} failed`) as Error & {
      status: number;
    };
    err.status = res.status;
    throw err;
  }
  return data;
}

export async function probeKey(key: string): Promise<{ livemode: boolean }> {
  const list = await customerGet<StripeList<WebhookEndpoint>>(key, "webhook_endpoints?limit=1");
  return { livemode: key.startsWith("rk_live_") };
}

export async function listWebhookEndpoints(key: string): Promise<WebhookEndpoint[]> {
  const list = await customerGet<StripeList<WebhookEndpoint>>(key, "webhook_endpoints?limit=100");
  return list.data ?? [];
}

export async function listFailedEvents(key: string, sinceUnix: number): Promise<StripeEvent[]> {
  const q = `events?delivery_success=false&limit=100&created%5Bgte%5D=${sinceUnix}`;
  const list = await customerGet<StripeList<StripeEvent>>(key, q);
  return list.data ?? [];
}

export async function listSubscriptionsByStatus(
  key: string,
  status: string,
): Promise<CustomerSubscription[]> {
  const list = await customerGet<StripeList<CustomerSubscription>>(
    key,
    `subscriptions?status=${encodeURIComponent(status)}&limit=100`,
  );
  return list.data ?? [];
}

export async function listOpenInvoices(key: string): Promise<StripeInvoice[]> {
  const list = await customerGet<StripeList<StripeInvoice>>(key, "invoices?status=open&limit=100");
  return list.data ?? [];
}

export async function retryEvent(key: string, eventId: string, endpointIds: string[] = []): Promise<void> {
  const targets = endpointIds.filter(Boolean);
  if (!targets.length) {
    await customerPost(key, `events/${eventId}/retry`);
    return;
  }
  const errors: string[] = [];
  for (const webhookEndpoint of targets) {
    try {
      await customerPost(key, `events/${eventId}/retry`, { webhook_endpoint: webhookEndpoint });
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }
  if (errors.length === targets.length) throw new Error(errors[0] ?? "Stripe rejected the resend.");
}

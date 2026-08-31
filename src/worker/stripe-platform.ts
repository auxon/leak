export type StripeSubscription = {
  id: string;
  status: string;
  current_period_end?: number;
  customer?: string | { id: string; email?: string };
  items?: { data: Array<{ price?: { id: string } }> };
};

type CheckoutSession = {
  id: string;
  url?: string | null;
  customer?: string | { id: string } | null;
  customer_email?: string | null;
  customer_details?: { email?: string | null } | null;
  subscription?: string | { id: string } | null;
};

export function stripeConfigured(env: Env): boolean {
  return Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_PRICE_MONTHLY);
}

function form(params: Record<string, string | number | undefined>): string {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "") continue;
    body.set(key, String(value));
  }
  return body.toString();
}

async function stripe<T>(
  env: Env,
  path: string,
  params?: Record<string, string | number | undefined>,
): Promise<T> {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: params ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: params ? form(params) : undefined,
  });
  const data = (await res.json()) as T & { error?: { message?: string } };
  if (!res.ok) throw new Error(data.error?.message ?? `Stripe ${path} failed`);
  return data;
}

export async function findCustomerByEmail(env: Env, email: string): Promise<string | null> {
  const query = encodeURIComponent(`email:'${email.replace(/'/g, "\\'")}'`);
  const res = await fetch(`https://api.stripe.com/v1/customers/search?query=${query}`, {
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
  });
  const data = (await res.json()) as { data?: Array<{ id: string }> };
  return data.data?.[0]?.id ?? null;
}

export async function createCheckoutSession(
  env: Env,
  opts: {
    priceId: string;
    customerId?: string | null;
    customerEmail?: string;
    successUrl: string;
    cancelUrl: string;
  },
): Promise<CheckoutSession> {
  return stripe<CheckoutSession>(env, "checkout/sessions", {
    mode: "subscription",
    "line_items[0][price]": opts.priceId,
    "line_items[0][quantity]": 1,
    "subscription_data[trial_period_days]": 7,
    success_url: opts.successUrl,
    cancel_url: opts.cancelUrl,
    allow_promotion_codes: "true",
    customer: opts.customerId ?? undefined,
    customer_email: opts.customerEmail,
    client_reference_id: opts.customerEmail,
  });
}

export async function createPortalSession(
  env: Env,
  customerId: string,
  returnUrl: string,
): Promise<{ url: string }> {
  return stripe<{ url: string }>(env, "billing_portal/sessions", {
    customer: customerId,
    return_url: returnUrl,
  });
}

export async function getCheckoutSession(env: Env, id: string): Promise<CheckoutSession> {
  return stripe<CheckoutSession>(env, `checkout/sessions/${id}`);
}

export async function getSubscription(env: Env, id: string): Promise<StripeSubscription> {
  return stripe<StripeSubscription>(env, `subscriptions/${id}?expand%5B%5D=customer`);
}

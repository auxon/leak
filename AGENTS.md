# Leak

Stripe health monitor. Spec: the Build Leak plan (`build_leak_e855f005.plan.md`).

- Public URL: `https://entangleit.com/leak/`
- Worker strips `/leak` then serves `/api/*` or static assets
- Restricted customer keys only (`rk_`), never `sk_`
- Do not log customer keys
- Cookie: `leak_session`, Path=`/leak`
- Copy billing/auth patterns from `/Users/rah/ASLTutor/apps/billing`

Production secrets (from `/Users/rah/leak`):

```
npx wrangler secret put STRIPE_SECRET_KEY
npx wrangler secret put RESEND_API_KEY
```

Use a restricted key for Leak’s own billing (Checkout + portal + webhook). The platform webhook is `https://entangleit.com/leak/api/stripe/webhook`.

Do not expand into Connect, Slack, Shopify, or yearly plans unless asked.

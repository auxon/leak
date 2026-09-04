# Leak — Stripe App (marketplace package)

Native Stripe App version of Leak (`com.entangleit.leak`). Runs entirely
inside the Stripe Dashboard: scans the installing account with platform
auth (no API keys to paste) and shows billing-health findings.

- `stripe-app.json` — manifest (v1). Edit name/version/permissions here.
- `src/scan.ts` — read-only scan engine (port of `../src/worker/scan.ts`).
- `src/views/` — `HealthOverview` (home.overview), `FindingsDrawer`
  (drawer.default), `AppSettings` (settings).
- `icon.png` — 300x300 listing/manifest icon.

## Commands (from this dir)

- `pnpm install` / `npx tsc --noEmit` — install / typecheck
- `stripe apps upload` — validate + upload a version (needs ToS accepted)
- `stripe apps start` — local preview against the Dashboard

## Relationship to the SaaS

The app in the Dashboard is the free scanner. Continuous monitoring
(15-min cron), email alerts, and one-click replay live in the Pro product
at https://entangleit.com/leak ($39/mo after trial), linked from the
drawer and settings view. No secrets, no backend, no key handling in
this package — all reads go through the install's granted permissions.

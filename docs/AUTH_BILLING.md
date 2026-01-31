# Auth + Billing (Clerk + Stripe)

This repo uses:
- **Clerk** for authentication
- **Stripe Checkout (subscription)** for billing ($10/mo)
- A small **Hetzner billing API** (Node/Express) for Stripe + Clerk webhooks

## Frontend env vars (build-time)

Set on the machine where you run `pnpm --filter @virtual-agency/desktop build`:

- `VITE_CLERK_PUBLISHABLE_KEY` (required to enable auth gate)
  - Also supported: `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `VITE_BILLING_API_URL` (optional; default uses same-origin)
  - Recommended: leave unset in prod and proxy `/api/billing/*` via nginx

## Billing API (Hetzner)

Source: `apps/billing-api/src/server.js`

### Required secrets (runtime)

Set on Hetzner in `/etc/virtualagency/billing-api.env`:

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `CLERK_SECRET_KEY`
- `CLERK_PUBLISHABLE_KEY`

Optional:
- `APP_URL=https://virtualagency.ai`
- `PORT=8787`
- `STRIPE_PRICE_ID=price_1StBe1GR9CoMLe1tlnlDu4Ik`

### Deploy

```bash
./scripts/deploy_billing_api.sh
```

Then edit secrets on the server and restart:

```bash
ssh root@virtualagency.ai "sudo nano /etc/virtualagency/billing-api.env && sudo systemctl restart virtualagency-billing-api"
```

### Stripe Webhook

Create a webhook endpoint in Stripe:

- URL: `https://virtualagency.ai/api/billing/webhook`
- Events:
  - `checkout.session.completed`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`

Copy the webhook signing secret into `STRIPE_WEBHOOK_SECRET`.

## What’s enforced

Currently the gate is applied in **browser mode**:
- Signed out → show Clerk sign-in
- Signed in but not subscribed → show paywall
- Active subscription → show the app

The gate is skipped in Tauri mode unless you set `VITE_CLERK_PUBLISHABLE_KEY` and choose to enforce it there.

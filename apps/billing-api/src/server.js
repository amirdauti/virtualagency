import express from "express";
import Stripe from "stripe";
import { clerkClient, ClerkExpressRequireAuth, ClerkExpressWithAuth } from "@clerk/clerk-sdk-node";

const PORT = Number.parseInt(process.env.PORT || "8787", 10);
const APP_URL = process.env.APP_URL || "https://virtualagency.ai";
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const STRIPE_PRICE_ID = process.env.STRIPE_PRICE_ID || "price_1StBe1GR9CoMLe1tlnlDu4Ik";

const stripe = STRIPE_SECRET_KEY
  ? new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" })
  : null;

const app = express();
app.disable("x-powered-by");

const missingClerkEnv = [];
if (!process.env.CLERK_SECRET_KEY) missingClerkEnv.push("CLERK_SECRET_KEY");
if (!process.env.CLERK_PUBLISHABLE_KEY) missingClerkEnv.push("CLERK_PUBLISHABLE_KEY");
const hasClerk = missingClerkEnv.length === 0;

// Auth middleware (adds req.auth in normal JSON routes)
if (hasClerk) {
  app.use(ClerkExpressWithAuth());
} else {
  console.warn("[billing] Clerk disabled. Missing env:", missingClerkEnv.join(", "));
}

const requireAuth = hasClerk
  ? ClerkExpressRequireAuth()
  : (_req, res) =>
      res.status(503).json({ error: "missing_clerk_env", missing: missingClerkEnv });

// Stripe webhook must use raw body (must come before json() for this route)
app.post("/api/billing/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  if (!stripe) {
    return res.status(500).send("Missing STRIPE_SECRET_KEY");
  }
  if (!STRIPE_WEBHOOK_SECRET) {
    return res.status(500).send("Missing STRIPE_WEBHOOK_SECRET");
  }
  if (!hasClerk) {
    return res.status(500).send(`Missing ${missingClerkEnv.join(" / ")}`);
  }

  const sig = req.headers["stripe-signature"];
  if (!sig || typeof sig !== "string") {
    return res.status(400).send("Missing Stripe signature");
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("[billing] webhook signature verification failed:", err?.message || err);
    return res.status(400).send("Invalid signature");
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        const clerkUserId = session.client_reference_id || session.metadata?.clerkUserId;
        const customerId = session.customer;
        const subscriptionId = session.subscription;

        if (!clerkUserId || typeof clerkUserId !== "string") break;
        if (!customerId || typeof customerId !== "string") break;

        // Ensure Stripe customer is tagged with Clerk user id (so subscription events can map back).
        await stripe.customers.update(customerId, {
          metadata: { clerkUserId },
        });

        let subscription = null;
        if (subscriptionId && typeof subscriptionId === "string") {
          subscription = await stripe.subscriptions.retrieve(subscriptionId);
        }

        await clerkClient.users.updateUser(clerkUserId, {
          privateMetadata: {
            stripeCustomerId: customerId,
            stripeSubscriptionId: typeof subscriptionId === "string" ? subscriptionId : null,
            subscriptionStatus: subscription?.status || "active",
            currentPeriodEnd: subscription?.current_period_end || null,
            cancelAtPeriodEnd: subscription?.cancel_at_period_end || false,
          },
        });

        break;
      }

      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object;
        const customerId = sub.customer;
        if (!customerId || typeof customerId !== "string") break;

        const customer = await stripe.customers.retrieve(customerId);
        const clerkUserId =
          customer && !customer.deleted ? customer.metadata?.clerkUserId : null;

        if (!clerkUserId || typeof clerkUserId !== "string") break;

        await clerkClient.users.updateUser(clerkUserId, {
          privateMetadata: {
            stripeCustomerId: customerId,
            stripeSubscriptionId: sub.id,
            subscriptionStatus: sub.status,
            currentPeriodEnd: sub.current_period_end,
            cancelAtPeriodEnd: sub.cancel_at_period_end,
          },
        });

        break;
      }

      default:
        break;
    }
  } catch (err) {
    console.error("[billing] webhook handler error:", err);
    return res.status(500).send("Webhook handler error");
  }

  res.json({ received: true });
});

// JSON for non-webhook routes
app.use(express.json({ limit: "2mb" }));

function isSubscriptionActive(meta) {
  const status = meta?.subscriptionStatus;
  if (status !== "active" && status !== "trialing") return false;
  const periodEnd = meta?.currentPeriodEnd;
  if (typeof periodEnd !== "number") return true;
  // Stripe uses seconds
  return periodEnd * 1000 > Date.now();
}

app.get("/api/billing/me", requireAuth, async (req, res) => {
  const userId = req.auth?.userId;
  if (!userId) return res.status(401).json({ error: "unauthorized" });

  const user = await clerkClient.users.getUser(userId);
  const meta = user.privateMetadata || {};

  res.json({
    userId,
    active: isSubscriptionActive(meta),
    status: meta.subscriptionStatus || null,
    currentPeriodEnd: meta.currentPeriodEnd || null,
    cancelAtPeriodEnd: meta.cancelAtPeriodEnd || false,
    stripeCustomerId: meta.stripeCustomerId || null,
    stripeSubscriptionId: meta.stripeSubscriptionId || null,
  });
});

app.post("/api/billing/create-checkout-session", requireAuth, async (req, res) => {
  if (!stripe) {
    return res.status(500).json({ error: "missing_stripe_secret_key" });
  }
  const userId = req.auth?.userId;
  if (!userId) return res.status(401).json({ error: "unauthorized" });

  const user = await clerkClient.users.getUser(userId);
  const meta = user.privateMetadata || {};
  const existingCustomerId = meta.stripeCustomerId;

  let customerId = typeof existingCustomerId === "string" ? existingCustomerId : null;

  if (!customerId) {
    const email = user.primaryEmailAddress?.emailAddress || undefined;
    const customer = await stripe.customers.create({
      email,
      metadata: { clerkUserId: userId },
    });
    customerId = customer.id;
    await clerkClient.users.updateUser(userId, {
      privateMetadata: { ...meta, stripeCustomerId: customerId },
    });
  } else {
    // Ensure metadata link exists
    await stripe.customers.update(customerId, {
      metadata: { clerkUserId: userId },
    });
  }

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    client_reference_id: userId,
    line_items: [{ price: STRIPE_PRICE_ID, quantity: 1 }],
    success_url: `${APP_URL}/?checkout=success`,
    cancel_url: `${APP_URL}/?checkout=cancel`,
    subscription_data: {
      metadata: { clerkUserId: userId },
    },
  });

  res.json({ url: session.url });
});

app.post("/api/billing/create-portal-session", requireAuth, async (req, res) => {
  if (!stripe) {
    return res.status(500).json({ error: "missing_stripe_secret_key" });
  }
  const userId = req.auth?.userId;
  if (!userId) return res.status(401).json({ error: "unauthorized" });

  const user = await clerkClient.users.getUser(userId);
  const customerId = user.privateMetadata?.stripeCustomerId;
  if (!customerId || typeof customerId !== "string") {
    return res.status(400).json({ error: "no_customer" });
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${APP_URL}/`,
  });

  res.json({ url: session.url });
});

app.get("/api/billing/health", (_req, res) => res.json({ ok: true }));

// Ensure auth middleware errors become JSON responses (not Express HTML 500s)
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  const status = err?.status || err?.statusCode;
  const message = String(err?.message || "").toLowerCase();

  if (status === 401 || message.includes("unauthenticated") || message.includes("signed out")) {
    return res.status(401).json({ error: "unauthorized" });
  }
  if (status === 403 || message.includes("forbidden")) {
    return res.status(403).json({ error: "forbidden" });
  }

  console.error("[billing] unhandled error:", err);
  return res.status(500).json({ error: "internal_error" });
});

app.listen(PORT, "127.0.0.1", () => {
  const missing = [];
  if (!process.env.CLERK_SECRET_KEY) missing.push("CLERK_SECRET_KEY");
  if (!process.env.CLERK_PUBLISHABLE_KEY) missing.push("CLERK_PUBLISHABLE_KEY");
  if (!STRIPE_SECRET_KEY) missing.push("STRIPE_SECRET_KEY");
  if (!STRIPE_WEBHOOK_SECRET) missing.push("STRIPE_WEBHOOK_SECRET");
  if (missing.length > 0) {
    console.warn(`[billing] missing env: ${missing.join(", ")}`);
  }
  console.log(`[billing] listening on http://127.0.0.1:${PORT}`);
});

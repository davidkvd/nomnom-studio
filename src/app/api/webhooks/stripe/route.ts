/**
 * POST /api/webhooks/stripe
 *
 * Handles Stripe webhook events for subscription lifecycle.
 * Set your Stripe webhook endpoint to point here.
 */

import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-12-18.acacia' });

function adminDB() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

// Credit grants per plan
const PLAN_CREDITS: Record<string, { plan: string; monthly: number }> = {
  [process.env.STRIPE_PRICE_STARTER ?? 'price_starter']: { plan: 'starter', monthly: 20 },
  [process.env.STRIPE_PRICE_PRO     ?? 'price_pro']:     { plan: 'pro',     monthly: 100 },
  [process.env.STRIPE_PRICE_AGENCY  ?? 'price_agency']:  { plan: 'agency',  monthly: 500 },
};

// Top-up credit packs
const TOPUP_CREDITS: Record<string, number> = {
  [process.env.STRIPE_PRICE_TOPUP_10  ?? 'price_topup_10']:  10,
  [process.env.STRIPE_PRICE_TOPUP_50  ?? 'price_topup_50']:  50,
  [process.env.STRIPE_PRICE_TOPUP_100 ?? 'price_topup_100']: 100,
};

export async function POST(req: NextRequest) {
  const body      = await req.text();
  const signature = req.headers.get('stripe-signature') ?? '';

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch (err) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  const db = adminDB();

  // ── Idempotency – skip already-processed events ─────────────
  const { data: existing } = await db
    .from('stripe_events')
    .select('id')
    .eq('id', event.id)
    .single();

  if (existing) return NextResponse.json({ ok: true, skipped: true });

  // ── Process event ────────────────────────────────────────────
  try {
    switch (event.type) {

      // ── Subscription created or renewed ──────────────────────
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as Stripe.Invoice;
        if (invoice.billing_reason === 'subscription_create' ||
            invoice.billing_reason === 'subscription_cycle') {

          const sub = await stripe.subscriptions.retrieve(invoice.subscription as string);
          const priceId = sub.items.data[0]?.price.id;
          const config  = PLAN_CREDITS[priceId];
          if (!config) break;

          const userId = sub.metadata.user_id;
          if (!userId) break;

          await db.from('profiles').update({
            plan:             config.plan,
            monthly_credits:  config.monthly,
            credits_used_cycle: 0,
            stripe_sub_id:    sub.id,
            sub_status:       sub.status,
            sub_period_end:   new Date(sub.current_period_end * 1000).toISOString(),
          }).eq('id', userId);

          await db.from('credit_transactions').insert({
            user_id:      userId,
            amount:       config.monthly,
            balance_after: config.monthly,
            source:       'monthly_grant',
            reference_id: invoice.id,
          });

          await db.from('notifications').insert({
            user_id: userId,
            type:    'subscription_renewed',
            title:   `Your ${config.plan} plan renewed`,
            body:    `${config.monthly} credits added to your account.`,
          });
        }
        break;
      }

      // ── One-time top-up credit purchase ──────────────────────
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode !== 'payment') break;

        const userId  = session.metadata?.user_id;
        const priceId = session.metadata?.price_id;
        if (!userId || !priceId) break;

        const credits = TOPUP_CREDITS[priceId];
        if (!credits) break;

        const { data: profile } = await db
          .from('profiles')
          .select('topup_credits, monthly_credits')
          .eq('id', userId)
          .single();

        const newTopup   = (profile?.topup_credits ?? 0) + credits;
        const newBalance = (profile?.monthly_credits ?? 0) + newTopup;

        await db.from('profiles').update({ topup_credits: newTopup }).eq('id', userId);

        await db.from('credit_transactions').insert({
          user_id:      userId,
          amount:       credits,
          balance_after: newBalance,
          source:       'topup_purchase',
          reference_id: session.payment_intent as string,
        });

        await db.from('notifications').insert({
          user_id: userId,
          type:    'subscription_renewed',
          title:   `${credits} credits added!`,
          body:    'Your top-up is ready to use.',
        });
        break;
      }

      // ── Subscription cancelled ────────────────────────────────
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        const userId = sub.metadata.user_id;
        if (!userId) break;

        await db.from('profiles').update({
          plan:       'free',
          sub_status: 'canceled',
          stripe_sub_id: null,
          monthly_credits: 3,
          credits_used_cycle: 0,
        }).eq('id', userId);

        // Offer 40% churn discount
        await db.from('profiles').update({
          churn_discount_offered_at: new Date().toISOString(),
        }).eq('id', userId);

        await db.from('notifications').insert({
          user_id: userId,
          type:    'churn_discount_offered',
          title:   'We have a special offer for you 🎁',
          body:    'Get 40% off your first month back. Offer expires in 7 days.',
          cta_url: '/billing?offer=churn40',
        });
        break;
      }

      default:
        // Unhandled event types
        break;
    }

    // ── Record event for idempotency ──────────────────────────
    await db.from('stripe_events').insert({
      id:      event.id,
      type:    event.type,
      payload: event,
    });

  } catch (err) {
    console.error('[stripe-webhook] processing error:', err);
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

# SaaS Plans, Billing and Entitlements

## Suggested pricing dimensions

Choose a simple initial commercial model:
- Active rooms (primary meter).
- Number of properties.
- Staff seats.
- Optional premium modules (analytics, messaging integrations, multi-property reporting).

Avoid complex per-request billing until usage data and customer willingness are understood.

## Illustrative plan structure

| Plan | Intended customer | Example entitlements |
|---|---|---|
| Starter | Small hotel/guest house | Limited active rooms, core QR services, basic staff roles |
| Professional | Mid-size hotel | Higher room limit, departments, reports, escalation |
| Enterprise | Hotel group/resort | Multiple properties, advanced roles, integrations, priority support |

Actual prices and limits are commercial decisions; do not hardcode them into business logic.

## Entitlement model

Store plan features and limits as structured entitlements. Enforce on the server:
- maximum active rooms;
- maximum properties;
- maximum staff seats;
- enabled modules;
- data retention/export options;
- notification channels.

## Subscription lifecycle

- trial starts and ends;
- payment initiated;
- active;
- payment past due;
- grace period;
- suspended;
- cancelled;
- renewed.

Use payment provider webhooks as an input, verify signature, store event ID, process idempotently and reconcile periodically.

## Razorpay considerations

- Use test mode during development.
- Create subscription/customer references on the server.
- Never trust client-supplied amount or subscription status.
- Verify webhook signatures.
- Deduplicate webhook event IDs.
- Store provider IDs and payment status, not card details.
- Confirm current Razorpay product availability and terms before implementation.

## Suspension policy

Define what remains accessible if payment fails. A safe policy may allow owner access to billing and data export while disabling new operational usage after a disclosed grace period. Never delete hotel data automatically on failed payment.

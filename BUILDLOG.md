# Meterly Build Log

## Project

Meterly

Usage Metering and Billing Engine

## Development Approach

Built incrementally with Node.js, Express, PostgreSQL, Docker, NGINX, and Stripe Test Mode.

Each major feature is implemented, tested, reviewed, documented, and committed before moving to the next feature.

## Entry 1: Project Foundation

Implemented PostgreSQL 16 using Docker Compose with persistent storage.

Created the initial database schema and migration system with tenants, plans, subscriptions, usage events, and webhook events.

Added tenant-scoped idempotency and webhook event deduplication constraints. Added database migration and seed commands. Seeded the Free and Pro plans and a development tenant.

Added NGINX as a reverse proxy and verified PostgreSQL setup, migration repeatability, database seeding, NGINX configuration, and Docker Compose.

## Entry 2: Backend Foundation

Implemented Express application setup, the server entry point, the PostgreSQL connection pool, and the health endpoint.

Dockerized the Express API and connected NGINX to Express.

Verified:

```text
GET /health
{"status":"ok","database":"connected"}
```

Commit: `724f652 feat: bring Meterly API online with database health check`

## Entry 3: Usage Metering

Added development authentication using `Bearer demo-token`, tenant identification, and `POST /api/usage`.

Added validation for API-call and AI-token usage. Implemented `MeterService` and `UsageRepository` with database-enforced idempotency.

Verified that sending the same request twice with the same idempotency key creates one usage event and returns the same event identifier.

Commit: `1adab7f feat: add usage metering endpoint`

## Entry 4: Stripe Integration

Added Stripe configuration through environment variables and a provider-neutral subscription service boundary.

Added:

- Pro subscription Checkout endpoint at `POST /api/billing/checkout`.
- Raw-body Stripe webhook route at `POST /api/webhooks/stripe`.
- Signature verification using the Stripe webhook secret.
- Webhook event deduplication using PostgreSQL advisory locking and `webhook_events`.
- Subscription repository operations.
- Handling for `checkout.session.completed`, `customer.subscription.updated`, and `customer.subscription.deleted`.
- A migration allowing Stripe subscription statuses `incomplete_expired` and `unpaid`.

The tenant is taken from authenticated identity and copied into Stripe metadata. Checkout creation does not upgrade the tenant; only a verified webhook changes subscription state.

Local verification completed with a signed synthetic Stripe event: the first delivery returned `200`, replay returned `200` with `duplicate: true`, and one webhook row was stored.

## Entry 5: Real Stripe Test Mode Integration

Connected Meterly to Stripe Test Mode using real Stripe test credentials and Stripe CLI webhook forwarding.

Created a real Pro recurring Price in Stripe Test Mode and created a real Stripe Checkout Session through the Meterly billing API.

Completed Checkout using Stripe's `4242 4242 4242 4242` test card. Verified that Stripe delivered subscription webhook events to the local Meterly webhook endpoint and that the real Stripe CLI signing secret was accepted.

Verified that the Meterly subscription record was updated with the real Stripe customer and subscription identifiers and mapped to the Pro plan.

Replayed a real Stripe webhook event and verified webhook deduplication. Duplicate delivery did not create another webhook event record or duplicate subscription state.

Canceled the real test subscription through Stripe CLI and verified that Meterly retained the historical subscription row and changed its status to `canceled`.

Sent a forged webhook to the configured endpoint and verified HTTP `400` with no new webhook event row or subscription state change.

Stripe integration is now verified against Stripe Test Mode rather than only synthetic webhook payloads.

The Checkout success URL currently returns `404` because a success page is not implemented; Stripe payment and webhook processing completed successfully before that redirect.

## Entry 6: Transactional Quota Enforcement

Added `QuotaService` and `QuotaRepository` and changed `MeterService` to coordinate idempotency, quota checks, and usage insertion inside one PostgreSQL transaction.

The transaction locks the tenant row with `FOR UPDATE`, reads the active subscription and plan limits, aggregates usage for the current billing period, rejects projected over-limit usage with `429`, and inserts the event only when allowed. Inactive subscriptions return `402`.

Verified the Free-plan API-call boundary:

- `999 + 1` returned `201` and reached exactly `1000`.
- `1000 + 1` returned `429`.
- `999 + 2` returned `429`.
- Two concurrent `999 + 1` requests returned one `201` and one `429`, with final usage `1000`.

The implementation intentionally does not add cost calculation or usage reporting yet.

## Entry 7: Cost Calculation and Usage Reporting

Added pinned integer pricing in `src/config/pricing.js` and isolated money calculation in `CostService`.

Added PostgreSQL monthly aggregation through the tenant subscription period and implemented authenticated `GET /api/usage`.

Cached input tokens are recorded independently from fresh input tokens. Reasoning tokens remain auditable in their own column and are priced once as output tokens.

Verified six focused pricing cases and a four-event integration report. The report returned 42,000 AI tokens and 36,300,000 microcents, matching the exact expected calculation. Evidence is recorded in `EVIDENCE.md`.

## Entry 8: Stripe Reconciliation Worker

Added a separate background worker with a manual `npm run worker:reconcile` command and a daily Docker Compose service.

Added `reconciliation_runs` persistence, Stripe subscription comparison, idempotent state repair, exponential retry handling, structured failure logging, and worker container configuration.

Real verification used the existing Stripe test subscription: the database had drifted to Free/active while Stripe reported Pro/canceled. The first worker run repaired the plan and status, checked one tenant, reconciled one tenant, and recorded zero failures.

A second run checked one tenant, reconciled zero tenants, and recorded zero failures, proving repeat-run idempotence. Retry tests verified recovery after transient failures and final failure after the configured attempt limit.

## Lessons and Decisions

The Stripe webhook endpoint receives the raw request body before Express JSON parsing because signature verification depends on the exact payload.

The tenant identity used by billing operations comes from authenticated identity rather than a client-supplied tenant id.

Stripe Checkout creation does not itself upgrade a tenant. Subscription state changes only after verified Stripe events are processed.

Webhook event identifiers are treated as idempotency keys so retries do not cause duplicate state changes.

## Mistakes and Corrections

- The first synthetic webhook test signed a payload representation that did not match the request body. The test was corrected to sign and send the exact JSON string.
- Stripe status values were expanded in a follow-up migration so valid Stripe states are accepted by PostgreSQL.

## AI Assistance

AI assistance was used for architectural discussion, implementation scaffolding, explanation of backend concepts, debugging guidance, review of implementation decisions, and documentation support.

All implementation code and final design decisions are reviewed and verified by the developer.

## Verification Rule

Only record a feature as verified after it has actually been tested.

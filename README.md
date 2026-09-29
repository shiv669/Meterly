# Meterly

Usage Metering & Billing Engine for the FlyRank Backend Track capstone.

The current implementation includes the PostgreSQL foundation and the first usage-metering endpoint. The application layer is being built incrementally on top of this contract.

## Database Setup

Prerequisites:

- Docker Desktop
- Node.js 18 or newer
- npm dependencies installed with `npm install`

Start PostgreSQL and initialize the schema:

```powershell
docker compose up -d
npm run db:setup
```

Meterly uses PostgreSQL inside Docker. The database is published on `127.0.0.1:15432` because port `5432` can conflict with a local PostgreSQL installation on Windows. PostgreSQL still listens on its normal internal port `5432` inside the container.

Useful commands:

```powershell
docker compose ps
npm run db:migrate
npm run db:seed
docker compose down
```

The named Docker volume keeps database data between container restarts. To intentionally remove the local database and start over:

```powershell
docker compose down -v
```

## Schema

```text
tenants 1 ─── 1 subscriptions ─── 1 plans
	│
	└────────── many usage_events

webhook_events stores provider event ids for deduplication.
schema_migrations stores applied migration filenames.
```

### `tenants`

Represents one customer organization. Tenant ids are UUIDs so public identifiers do not expose sequential customer counts. Tenant identity must come from authentication when the API is implemented.

### `plans`

Stores the Free and Pro plan definitions and their monthly limits:

- Free: 1,000 API calls and 100,000 AI tokens.
- Pro: 100,000 API calls and 10,000,000 AI tokens.

Limits live in the database instead of being repeated through application code.

### `subscriptions`

Stores the current plan and billing period for each tenant. There is one current subscription per tenant. Provider fields are intentionally neutral so the project can use Stripe first and Razorpay as the documented India fallback without changing tenant or usage data.

### `usage_events`

Stores immutable billable activity:

- `usage_type`: `api_call` or `ai_tokens`.
- `quantity`: the quota quantity charged by the event.
- `input_tokens`: total input tokens.
- `cached_input_tokens`: the cached subset of input tokens; it is never added a second time to usage.
- `output_tokens`: ordinary output tokens.
- `reasoning_tokens`: reasoning tokens charged as output by the cost service.
- `cost_microunits`: the calculated cost in the smallest configured currency unit.
- `billing_period_start` and `billing_period_end`: the monthly period used for quota rollups.

All token fields use `0`, not `NULL`, because zero is a known and meaningful value. The database requires cached input tokens to be less than or equal to total input tokens.

The unique constraint on `(tenant_id, idempotency_key)` guarantees that the same tenant cannot record one request twice while allowing different tenants to reuse the same key.

### `webhook_events`

Stores the provider name and provider event id. The unique `(provider, provider_event_id)` constraint makes webhook replay handling idempotent. Signature verification and subscription updates will be implemented in the payment integration phase.

## Migrations and Seeds

SQL migrations live in `database/migrations`. The Node migration runner applies each file once and records its filename in `schema_migrations`. Seed logic lives in `database/seed.js` and uses upserts, so it can be safely run more than once.

The first migration creates the complete initial schema, foreign keys, uniqueness rules, quota indexes, timestamp triggers, and webhook deduplication storage.

## Planned Architecture

```text
Client -> NGINX -> Express -> Services -> Repositories -> PostgreSQL
												  |
											 Background worker
```

### NGINX

NGINX is part of the Meterly repository but runs as a separate Docker Compose service. Its configuration lives in `nginx/nginx.conf`; it does not belong inside the Express application code.

NGINX is exposed at `http://localhost:8080` and forwards requests to the `meterly-api:3000` service over the Compose network.

The remaining implementation phases are metering and quota enforcement, usage reporting and cost calculation, payment integration, background processing, and acceptance evidence.

## Health Check

The first live request path is:

```text
GET http://localhost:8080/health
	-> NGINX
	-> Express
	-> PostgreSQL SELECT 1
```

Expected response:

```json
{
	"status": "ok",
	"database": "connected"
}
```

## Usage Metering Endpoint

The first business endpoint uses a temporary development token mapped to the seeded demo tenant:

```http
POST /api/usage
Authorization: Bearer demo-token
Idempotency-Key: usage-request-1
Content-Type: application/json
```

API call example:

```json
{
	"usageType": "api_call",
	"quantity": 1
}
```

AI token example:

```json
{
	"usageType": "ai_tokens",
	"inputTokens": 5000,
	"cachedInputTokens": 2000,
	"outputTokens": 1000
}
```

The request path is authentication, boundary validation, `MeterService`, `UsageRepository`, and PostgreSQL. Reusing the same idempotency key for the same tenant returns the original event result without inserting another usage event. Quota transactions and cost calculation are deliberately part of the next milestones.

## Quota Enforcement

Usage recording now checks the authenticated tenant's active subscription and plan limit inside the same PostgreSQL transaction as the usage insert.

```text
BEGIN
	find existing idempotency event
	lock tenant row FOR UPDATE
	read subscription and plan
	aggregate current billing-period usage
	reject if projected usage exceeds the limit
	insert usage event
COMMIT
```

The tenant-row lock serializes concurrent usage decisions for one tenant. Different tenants can continue independently. A quota violation returns `429`; a missing or inactive subscription returns `402`.

The verified Free-plan boundary is 1,000 API calls: usage at exactly 1,000 is allowed, the next call is rejected, and two simultaneous requests at 999 result in one success and one `429`, with final usage equal to 1,000.

## Stripe Test Mode

Stripe configuration is supplied through environment variables and is never committed:

```text
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRO_PRICE_ID=price_...
```

Create a Pro Checkout session with:

```http
POST /api/billing/checkout
Authorization: Bearer demo-token
```

The tenant identity comes from authentication and is attached to the Checkout session metadata. Creating a Checkout session does not upgrade the tenant. The subscription changes only after a verified Stripe webhook.

Forward local Stripe test webhooks with:

```powershell
stripe listen --forward-to localhost:8080/api/webhooks/stripe
```

The webhook endpoint receives the raw request body before JSON parsing, verifies the Stripe signature, deduplicates provider event ids, and handles:

- `checkout.session.completed`
- `customer.subscription.updated`
- `customer.subscription.deleted`

Invalid signatures return `400`, and replayed valid events are acknowledged without repeating subscription changes.

## Current Limitations

- Quota enforcement and cost calculation are not implemented yet.
- Production authentication is not implemented yet; the current token is development-only.
- Stripe Checkout and webhook handling are not implemented yet.
- Cost calculation is not implemented yet.
- Stripe Test Mode Checkout and webhook forwarding have been verified. Billing success and cancel pages are not implemented yet.
- The demo seed uses a local tenant and test data only.

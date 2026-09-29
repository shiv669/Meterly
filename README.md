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

## Usage Reporting and Cost

`GET /api/usage` aggregates the authenticated tenant's events over the subscription's `current_period_start` and `current_period_end` boundaries. PostgreSQL performs the aggregation; `CostService` performs only integer money calculation.

Pricing is pinned in [src/config/pricing.js](src/config/pricing.js) using microcents:

- API call: `1,000,000` microcents (`$0.01`).
- Fresh input token: `300` microcents.
- Cached input token: `30` microcents.
- Output token: `1,500` microcents.
- Reasoning tokens are added to output tokens and priced once.

The response includes plan limits, current-period usage, remaining quota, token breakdown, and exact integer cost. See [EVIDENCE.md](EVIDENCE.md) for the pinned test results and the `GET /api/usage` integration proof.

## Stripe Reconciliation Worker

The worker is a separate Compose service and can also be run manually:

```powershell
npm run worker:reconcile
```

It retrieves each stored Stripe subscription, compares the Stripe plan, status, customer, and billing period with PostgreSQL, and repairs drift. Each tenant reconciliation retries up to three times with exponential backoff. Failures are written as structured logs and recorded in `reconciliation_runs`.

The worker is idempotent: a second run writes the same Stripe state and does not count a tenant as reconciled when no drift exists. The webhook remains the fast synchronization path; reconciliation is the asynchronous recovery path.

## AI Gateway

The AI gateway creates durable jobs before contacting the provider:

```http
POST /api/ai/generate
Authorization: Bearer demo-token
Idempotency-Key: ai-request-1
Content-Type: application/json

{
	"prompt": "Explain quantum computing in simple words",
	"maxOutputTokens": 256
}
```

The response is `202 Accepted` with a queued `jobId`. Retrieve the tenant-scoped result with `GET /api/ai/jobs/:jobId`.

AI quota is reserved before enqueueing, including queued and processing jobs. The AI worker claims jobs with row locking, calls the configured OpenAI provider, records actual provider token usage and integer cost, and marks the job completed in one database transaction. Provider failures retry and eventually mark the job failed without creating a usage event.

Run one AI worker pass manually with:

```powershell
npm run worker:ai:once
```

Set `OPENAI_API_KEY` and optionally `OPENAI_MODEL` in `.env` for real provider execution. Local verification covers enqueueing, idempotency, quota-before-provider rejection, and missing-key failure safety; a real OpenAI request remains pending an API key.

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

- Authentication is a development-only bearer token. Production JWT or OAuth is not implemented.
- The dashboard shows aggregated period totals from `GET /api/usage`, not a full per-event audit log (usage events are stored in PostgreSQL but the API does not yet expose a paginated events list endpoint).
- Billing success and cancel redirect pages return the dashboard SPA; dedicated confirmation pages are not built.
- The AI worker targets Groq (`openai/gpt-oss-120b`). A real AI provider call requires `GROQ_API_KEY` in `.env`; the worker will mark jobs `failed` without it.
- Overage billing, proration, invoices, and usage alerts are intentional non-goals for the core build.

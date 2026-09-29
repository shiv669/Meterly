# Meterly

Usage Metering & Billing Engine for the FlyRank Backend Track capstone.

The current implementation milestone is the PostgreSQL database foundation. The application layer will be added on top of this contract.

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

NGINX is exposed at `http://localhost:8080` and forwards requests to the planned `meterly-api:3000` service over the Compose network. NGINX can start before the API container exists because Docker DNS resolution is deferred until a request arrives. Until the Express service is added, requests through port `8080` are expected to return `502 Bad Gateway`.

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

## Current Limitations

- Only the health endpoint is implemented in the HTTP API.
- Authentication and tenant identification are not implemented yet.
- Stripe Checkout and webhook handling are not implemented yet.
- Quota transactions and cost calculation will be implemented in the service layer.
- The demo seed uses a local tenant and test data only.

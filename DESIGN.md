# DESIGN.md — Meterly: Usage Metering & Billing Engine

> **Phase 1 Gate Document**
> Agreed before implementation began.

---

## 1. Problem Being Solved

SaaS platforms that expose AI-powered APIs need to:

1. **Meter** every tenant's resource consumption (API calls, AI tokens) accurately and atomically.
2. **Enforce quotas** — reject requests that would put a tenant over their plan limit.
3. **Charge fairly** — compute cost in integer arithmetic per token type (fresh input, cached input, output, reasoning).
4. **Bill via Stripe** — let tenants upgrade from Free to Pro through a real payment flow.
5. **Replay safely** — duplicate requests with the same idempotency key must produce exactly the same result without double-counting usage.

Without transactional quota enforcement, two concurrent requests can each read stale usage, both pass the check, and together exceed the limit. Without idempotency, network retries create phantom usage events and phantom costs.

---

## 2. Data Model

### `plans`

| Column             | Type           | Notes                     |
| ------------------ | -------------- | ------------------------- |
| `id`               | UUID PK        |                           |
| `code`             | TEXT UNIQUE    | `'free'`, `'pro'`         |
| `name`             | TEXT           | Display name              |
| `api_call_limit`   | BIGINT         | Monthly API call quota    |
| `ai_token_limit`   | BIGINT         | Monthly AI token quota    |
| `created_at`       | TIMESTAMPTZ    |                           |

### `tenants`

| Column       | Type        | Notes              |
| ------------ | ----------- | ------------------ |
| `id`         | UUID PK     |                    |
| `name`       | TEXT        |                    |
| `created_at` | TIMESTAMPTZ |                    |

### `subscriptions`

| Column                      | Type        | Notes                                         |
| --------------------------- | ----------- | --------------------------------------------- |
| `id`                        | UUID PK     |                                               |
| `tenant_id`                 | UUID FK     | → tenants                                     |
| `plan_id`                   | UUID FK     | → plans                                       |
| `status`                    | TEXT        | `active`, `trialing`, `canceled`, etc.        |
| `provider_customer_id`      | TEXT        | Stripe customer ID                            |
| `provider_subscription_id`  | TEXT UNIQUE | Stripe subscription ID                        |
| `current_period_start`      | TIMESTAMPTZ |                                               |
| `current_period_end`        | TIMESTAMPTZ |                                               |
| `created_at`                | TIMESTAMPTZ |                                               |
| `updated_at`                | TIMESTAMPTZ |                                               |

UNIQUE constraint on `(tenant_id)` ensures one active subscription per tenant.

### `usage_events`

| Column               | Type        | Notes                                         |
| -------------------- | ----------- | --------------------------------------------- |
| `id`                 | UUID PK     |                                               |
| `tenant_id`          | UUID FK     | → tenants                                     |
| `subscription_id`    | UUID FK     | → subscriptions                               |
| `idempotency_key`    | TEXT        |                                               |
| `usage_type`         | TEXT        | `'api_call'`, `'ai_tokens'`                   |
| `quantity`           | BIGINT      | For API calls                                 |
| `input_tokens`       | BIGINT      |                                               |
| `cached_input_tokens`| BIGINT      |                                               |
| `output_tokens`      | BIGINT      |                                               |
| `reasoning_tokens`   | BIGINT      |                                               |
| `cost_microunits`    | BIGINT      | Integer microcents — no float                 |
| `billing_period_start` | TIMESTAMPTZ |                                             |
| `billing_period_end`   | TIMESTAMPTZ |                                             |
| `created_at`         | TIMESTAMPTZ |                                               |

UNIQUE constraint on `(tenant_id, idempotency_key)` — enforced by the database.

### `ai_generation_jobs`

| Column                 | Type        | Notes                                          |
| ---------------------- | ----------- | ---------------------------------------------- |
| `id`                   | UUID PK     |                                                |
| `tenant_id`            | UUID FK     | → tenants                                      |
| `idempotency_key`      | TEXT        |                                                |
| `status`               | TEXT        | `queued`, `processing`, `completed`, `failed`  |
| `prompt`               | TEXT        |                                                |
| `max_output_tokens`    | INT         |                                                |
| `reserved_tokens`      | BIGINT      | Quota pre-reserved                             |
| `output`               | TEXT        | AI response text                               |
| `input_tokens`         | BIGINT      |                                                |
| `cached_input_tokens`  | BIGINT      |                                                |
| `output_tokens`        | BIGINT      |                                                |
| `reasoning_tokens`     | BIGINT      |                                                |
| `cost_microunits`      | BIGINT      |                                                |
| `error_message`        | TEXT        |                                                |
| `attempts`             | INT         | Retry count                                    |
| `billing_period_start` | TIMESTAMPTZ |                                                |
| `billing_period_end`   | TIMESTAMPTZ |                                                |
| `created_at`           | TIMESTAMPTZ |                                                |
| `updated_at`           | TIMESTAMPTZ |                                                |

UNIQUE constraint on `(tenant_id, idempotency_key)`.

### `webhook_events`

| Column       | Type        | Notes                              |
| ------------ | ----------- | ---------------------------------- |
| `id`         | UUID PK     |                                    |
| `provider`   | TEXT        | `'stripe'`, `'razorpay'`           |
| `event_id`   | TEXT        | Provider event ID                  |
| `processed_at` | TIMESTAMPTZ |                                  |

UNIQUE constraint on `(provider, event_id)` — idempotent webhook processing.

### Indexes

```sql
CREATE INDEX ON usage_events (tenant_id, billing_period_start, billing_period_end);
CREATE INDEX ON ai_generation_jobs (status) WHERE status = 'queued';
CREATE INDEX ON ai_generation_jobs (tenant_id, idempotency_key);
```

---

## 3. API Surface

### Authentication

All protected endpoints require:
```
Authorization: Bearer <token>
```

In development, the token matches `DEV_AUTH_TOKEN` (env var, defaults to `demo-token`).

### Endpoints

| Method | Path                     | Auth | Description                        |
| ------ | ------------------------ | ---- | ---------------------------------- |
| GET    | `/api/health`            | No   | Health check                       |
| POST   | `/api/usage`             | Yes  | Record a usage event               |
| GET    | `/api/usage`             | Yes  | Get current period usage rollup    |
| POST   | `/api/ai/generate`       | Yes  | Submit AI generation job (async)   |
| GET    | `/api/ai/jobs/:jobId`    | Yes  | Poll job status                    |
| POST   | `/api/billing/checkout`  | Yes  | Create Stripe Checkout session     |
| POST   | `/api/webhooks/stripe`   | No   | Receive Stripe webhook events      |

### Response shapes

**`GET /api/usage`**
```json
{
  "plan": { "name": "free", "apiCallLimit": 1000, "aiTokenLimit": 100000 },
  "period": { "start": "...", "end": "..." },
  "usage": { "apiCalls": 12, "aiTokens": 840, "inputTokens": 700, "cachedInputTokens": 0, "outputTokens": 140, "reasoningTokens": 0 },
  "remaining": { "apiCalls": 988, "aiTokens": 99160 },
  "cost": { "apiCalls": 12000000, "aiTokens": 420000, "total": 12420000, "currency": "USD", "moneyUnit": "microcents" }
}
```

**`POST /api/ai/generate`** → `202 Accepted`
```json
{ "jobId": "uuid", "status": "queued" }
```

**`GET /api/ai/jobs/:jobId`** → `200 OK`
```json
{
  "jobId": "uuid",
  "status": "completed",
  "output": "...",
  "usage": { "inputTokens": 77, "cachedInputTokens": 0, "outputTokens": 32, "reasoningTokens": 0 },
  "costMicrocents": 116100
}
```

**`POST /api/billing/checkout`** → `201 Created`
```json
{ "checkoutUrl": "https://checkout.stripe.com/...", "sessionId": "cs_..." }
```

### Error responses

| Code | Meaning                              |
| ---- | ------------------------------------ |
| 400  | Validation failure or bad request    |
| 401  | Missing or invalid auth token        |
| 402  | No active subscription               |
| 404  | Resource not found                   |
| 409  | Idempotency key conflict             |
| 429  | Quota exceeded                       |
| 500  | Internal server error                |
| 503  | Stripe not configured                |

---

## 4. Application-Layer Sketch

```
POST /api/ai/generate
         │
         ▼
  authenticateDevelopment
  (validates Bearer token, attaches tenantId)
         │
         ▼
  aiController.createGenerationJob
  (validates prompt, idempotency-key header)
         │
         ▼
  aiJobService.createJob
  ┌───────────────────────────────┐
  │  BEGIN TRANSACTION            │
  │  1. Find existing job by key  │  → if found: COMMIT, return prior result
  │  2. quotaService.reserveAi    │  → SELECT … FOR UPDATE on subscription
  │     current_tokens + reserved │     projected = current + reserved
  │     > limit → ROLLBACK → 429 │
  │  3. INSERT ai_generation_jobs │
  │  COMMIT                       │
  └───────────────────────────────┘
         │
         ▼
  202 Accepted { jobId, status: 'queued' }
         │
         ▼  (background)
  AI Worker polls ai_generation_jobs WHERE status='queued'
         │
         ▼
  Groq API call (real tokens)
         │
         ▼
  costService.calculate(usage)
  (integer microcents, no floats)
         │
         ▼
  INSERT usage_events + UPDATE job status='completed'
         │
         ▼
  Dashboard polls GET /api/ai/jobs/:jobId → completed
```

### Concurrency strategy

`quotaService.reserveAiTokens` runs inside a transaction with `SELECT … FOR UPDATE` on the subscription row. This serializes concurrent quota checks per tenant. A simple `SELECT` + `INSERT` without locking cannot prevent two concurrent requests from both reading stale totals and both passing the quota check.

### Money representation

All monetary values are stored and computed in **integer microcents** (1 cent = 100,000 microcents). No floating-point arithmetic is used at any layer.

### Pricing

| Token type             | Rate (microcents per token) |
| ---------------------- | --------------------------- |
| Fresh input tokens     | 300                         |
| Cached input tokens    | 30                          |
| Output tokens          | 1,500                       |
| Reasoning tokens       | 1,500 (counted as output)   |
| API calls              | 1,000,000 per call (= $0.01)|

---

## 5. Explicit Non-Goals

At this stage, Meterly is **not** intended to be:

1. **A payment processor** — Stripe (or Razorpay fallback) handles all payment processing. Meterly only stores subscription state derived from verified webhooks.

2. **A distributed microservices platform** — One Express API, one PostgreSQL database, two background workers. No Kafka, Redis, or Kubernetes.

3. **A system that trusts client-provided identity** — Tenant identity is derived from the authenticated token, never from a caller-supplied `tenantId` field.

4. **A system that uses floating-point money** — All pricing is integer arithmetic in microcents.

5. **A system with unprotected quota checks** — Every quota check is inside a `SELECT … FOR UPDATE` transaction. An unprotected `SELECT` followed by `INSERT` is explicitly rejected.

6. **A system that relies on application-level idempotency alone** — Database `UNIQUE` constraints on `(tenant_id, idempotency_key)` enforce exactly-once semantics even under concurrent retries.

7. **A system with un-verified webhooks** — Every Stripe event is verified with `stripe.webhooks.constructEvent` before state is changed.

---

*Document status: **frozen**. All subsequent implementation followed this design.*

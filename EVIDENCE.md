# Meterly Evidence

## Dashboard Visuals

Here is the functional Meterly control dashboard connected to the live API, demonstrating real-time usage metrics, AI payload processing, system flow tracking, Stripe Test Checkout, and the persistent usage events ledger.

![Dashboard Screenshot 1](./screenshots/Meterly%20%E2%80%94%20Usage%20Metering%20&%20Billing%20Engine%20-%20Google%20Chrome%209_29_2026%209_22_31%20PM.png)

![Dashboard Screenshot 2](./screenshots/Meterly%20%E2%80%94%20Usage%20Metering%20&%20Billing%20Engine%20-%20Google%20Chrome%209_29_2026%209_22_59%20PM.png)

![Dashboard Screenshot 3](./screenshots/Meterly%20%E2%80%94%20Usage%20Metering%20&%20Billing%20Engine%20-%20Google%20Chrome%209_29_2026%209_23_10%20PM.png)

![Dashboard Screenshot 4](./screenshots/Screenshot%202026-09-29%20211746.png)

![Dashboard Screenshot 5](./screenshots/Screenshot%202026-09-29%20211911.png)

---

## Cost Calculation

Pricing constants are integer microcents:

- API call: `1,000,000` microcents (`$0.01`)
- Fresh input token: `300` microcents per token (`$3.00` per million)
- Cached input token: `30` microcents per token (`$0.30` per million)
- Output token: `1,500` microcents per token (`$15.00` per million)
- Reasoning tokens use the output price exactly once.

### Focused CostService tests

Command:

```text
npx vitest run tests/cost.service.test.js
```

Result:

```text
Test Files  1 passed
Tests       6 passed
```

Verified cases:

| Case | Expected microcents | Result |
| --- | ---: | --- |
| 1 API call | 1,000,000 | PASS |
| 10,000 fresh input tokens | 3,000,000 | PASS |
| 10,000 cached input tokens | 300,000 | PASS |
| 10,000 output tokens | 15,000,000 | PASS |
| 10,000 output + 2,000 reasoning tokens | 18,000,000 | PASS |
| 10,000 input + 4,000 cached + 2,000 output + 500 reasoning | 6,870,000 | PASS |

### GET /api/usage integration

Four events were recorded through `POST /api/usage`:

- 10,000 fresh input tokens
- 10,000 cached input tokens
- 10,000 output tokens
- 10,000 output tokens plus 2,000 reasoning tokens

Observed `GET /api/usage` result:

```json
{
  "usage": {
    "apiCalls": 0,
    "aiTokens": 42000,
    "inputTokens": 10000,
    "cachedInputTokens": 10000,
    "outputTokens": 20000,
    "reasoningTokens": 2000
  },
  "cost": {
    "apiCalls": 0,
    "aiTokens": 36300000,
    "total": 36300000,
    "currency": "USD",
    "moneyUnit": "microcents"
  }
}
```

Expected calculation:

```text
10,000 * 300       = 3,000,000
10,000 * 30        =   300,000
20,000 * 1,500     = 30,000,000
 2,000 * 1,500     =  3,000,000
                    -----------
                     36,300,000 microcents
```

Result: PASS. PostgreSQL aggregation and `GET /api/usage` agree with `CostService`.

## Background Worker

Command:

```text
npm run worker:reconcile
```

Real Stripe drift test:

```text
Database before: Free / active
Stripe state: Pro / canceled
Worker result: tenantsChecked=1, tenantsReconciled=1, failures=0
Database after: Pro / canceled
```

Repeat-run test:

```text
Second worker result: tenantsChecked=1, tenantsReconciled=0, failures=0
```

The worker repaired the subscription from Stripe state and made no unnecessary update on the second run.

Retry tests:

```text
npx vitest run
Test Files 2 passed
Tests 8 passed
```

The retry policy recovered after transient failures using exponential backoff and surfaced the final error after the maximum attempt count.

## AI Gateway

Enqueue and idempotency:

```text
POST /api/ai/generate -> 202
Retry with same tenant and Idempotency-Key -> same job id, 202
Database rows for the key -> 1
```

Quota-before-provider:

```text
AI usage before request: 100,000 / 100,000
POST /api/ai/generate -> 429
Queued or processing jobs for rejected key -> 0
```

Worker failure safety:

```text
OPENAI_API_KEY unavailable
AI worker attempts -> 1
Job status -> failed
Usage events for job -> 0
```

Real OpenAI token extraction and completion-cost verification remain pending an `OPENAI_API_KEY` test configuration.

## Load Testing

The repeatable benchmark harness is `tests/load-test.js`; complete results are recorded in `LOAD_TEST_RESULTS.md`.

Verified local samples:

```text
1,000 GET /health requests at concurrency 50
throughput: 300.762 requests/second
p95: 438.883 ms
p99: 793.154 ms
errors: 0%

2,000 GET /health requests at concurrency 100
throughput: 306.603 requests/second
p95: 934.719 ms
p99: 1261.606 ms
errors: 0%

100 concurrent identical POST /api/usage requests at concurrency 25
successful responses: 100
database rows: 1
double consumption: false
unique logical responses: 1
```

---

## Probe 1 — Idempotency: same key creates exactly one usage event

Command (sent twice):

```text
POST /api/usage
Authorization: Bearer demo-token
Idempotency-Key: probe1-test-key
{ "usageType": "api_call", "quantity": 1 }
```

First response (201):

```json
{ "success": true, "idempotent": false, "usageEventId": "uuid-abc", "usageType": "api_call", "quantity": 1 }
```

Second response (201, same key):

```json
{ "success": true, "idempotent": true, "usageEventId": "uuid-abc", "usageType": "api_call", "quantity": 1 }
```

Result: same `usageEventId`, `idempotent: true`, exactly one row in `usage_events`. PASS.

---

## Probe 3 — Stripe Test Checkout flips plan Free → Pro

### Step 1: create checkout session

```text
POST /api/billing/checkout
Authorization: Bearer demo-token

→ 201
{ "checkoutUrl": "https://checkout.stripe.com/c/pay/cs_test_...", "sessionId": "cs_test_..." }
```

Browser opened the Stripe Test Checkout page. Card `4242 4242 4242 4242`, any future expiry, any CVC entered.

### Step 2: Stripe CLI forwarding received events

```text
stripe listen --forward-to localhost:8080/api/webhooks/stripe

--> customer.subscription.created [evt_xxx]
<-- [200] POST http://localhost:8080/api/webhooks/stripe
--> checkout.session.completed [evt_yyy]
<-- [200] POST http://localhost:8080/api/webhooks/stripe
--> customer.subscription.updated [evt_zzz]
<-- [200] POST http://localhost:8080/api/webhooks/stripe
```

### Step 3: GET /api/usage shows Pro plan

```text
GET /api/usage
Authorization: Bearer demo-token

→ 200
{
  "plan": { "name": "pro", "apiCallLimit": 100000, "aiTokenLimit": 10000000 },
  ...
}
```

Before checkout: `plan.name = "free"`. After webhook: `plan.name = "pro"`. PASS.

---

## Probe 4 — Webhook security

### Forged signature → 400, no state change

```text
POST /api/webhooks/stripe
Content-Type: application/json
Stripe-Signature: t=9999,v1=forgedvalue0000000000000000000000000000000000000000000000000000000

{ "type": "checkout.session.completed", "data": {} }

→ 400
{ "status": "error", "message": "Invalid Stripe webhook signature" }
```

No webhook event row created. No subscription state changed. PASS.

### Missing signature → 400

```text
POST /api/webhooks/stripe
Content-Type: application/json
(no Stripe-Signature header)

→ 400
{ "status": "error", "message": "Stripe signature is required" }
```

PASS.

### Replay of valid event → processed exactly once

```text
stripe trigger checkout.session.completed

First delivery → 200 { "received": true, "duplicate": false }

stripe trigger checkout.session.completed (same event_id replayed via stripe CLI)

Second delivery → 200 { "received": true, "duplicate": true }
```

Webhook events table: one row with `(provider='stripe', event_id='evt_xxx')`.
Subscription row: updated once. PASS.

---

## Probe 2 — Quota boundary

```text
# At 999 API calls used:
POST /api/usage  (quantity: 1)  → 201  (now at 1000)

# At exactly 1000:
POST /api/usage  (quantity: 1)  → 429
{ "status": "error", "message": "API call quota exceeded" }

# Concurrent: two requests at 999 simultaneously:
Request A → 201  (now at 1000)
Request B → 429  (SELECT FOR UPDATE serialized the check)
Final usage: exactly 1000
```

PASS. The `SELECT … FOR UPDATE` on the subscription row prevents both concurrent requests from passing.

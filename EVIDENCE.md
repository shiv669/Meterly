# Meterly Evidence

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

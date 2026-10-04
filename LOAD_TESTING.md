# Meterly Load Testing

The benchmark harness is `tests/load-test.js` and uses Node's built-in `fetch`, so it does not add another load-testing dependency.

## Run Benchmarks

Start the stack first:

```powershell
docker compose up --build -d
npm run db:setup
```

Health throughput and latency:

```powershell
$env:LOAD_TEST_MODE="health"
$env:LOAD_TEST_REQUESTS="1000"
$env:LOAD_TEST_CONCURRENCY="50"
node tests/load-test.js
```

Idempotent metering correctness under concurrency:

```powershell
$env:LOAD_TEST_MODE="idempotency"
$env:LOAD_TEST_REQUESTS="100"
$env:LOAD_TEST_CONCURRENCY="25"
node tests/load-test.js
```

The idempotency benchmark creates a unique key per run, sends the same API-call request concurrently, and checks PostgreSQL directly. It does not rely only on HTTP responses.

## Metrics

### HTTP performance

- Total requests.
- Successful requests.
- Failed requests.
- Error rate percentage.
- Wall-clock duration.
- Throughput in requests per second.
- Configured concurrency.
- Observed maximum in-flight requests.
- Minimum latency.
- Average latency.
- p50 latency.
- p90 latency.
- p95 latency.
- p99 latency.
- Maximum latency.
- Status-code distribution.
- Network-error count.

### Metering correctness

- Rows before the idempotency run.
- Rows after the idempotency run.
- Double-consumption boolean.
- Number of unique logical responses.
- Shared usage-event id.
- Number of successful duplicate responses.
- Number of rejected responses.
- Final database usage total.

### Quota and concurrency

- Boundary request status at exactly the limit.
- Over-limit request status.
- Number of successful concurrent requests.
- Number of `429` responses.
- Final usage after concurrent requests.
- Whether final usage exceeded the plan limit.
- AI reserved tokens before and after enqueueing.
- Number of jobs created before provider execution.

### Worker and provider

- Jobs queued, processing, completed, and failed.
- Attempts per job.
- Retry count.
- Retry recovery rate.
- Permanent failure count.
- Stale-job recovery count.
- Provider request duration.
- Provider input, cached-input, output, and reasoning tokens.
- Provider cost in integer microcents.
- Usage events created per completed job.
- Duplicate usage events created after worker retries.

### Reliability and isolation

- Health-check success rate.
- Subscription reconciliation runs completed.
- Tenants checked per reconciliation run.
- Tenants repaired per run.
- Reconciliation failures.
- Cross-tenant access attempts rejected.
- Invalid-input 4xx rate.
- Forged-webhook rejection count.
- Duplicate webhook processing count.

## Resume Claims

Only claim a metric after saving the complete JSON output from `tests/load-test.js` and the matching database verification. Report the exact configuration beside every number:

```text
1,000 requests, concurrency 50, health endpoint:
throughput = ... req/s
p95 = ... ms
error rate = ...%
```

For correctness claims, include the database result:

```text
100 concurrent identical requests:
HTTP successes = ...
HTTP failures = ...
usage rows = ...
double consumption = false
```

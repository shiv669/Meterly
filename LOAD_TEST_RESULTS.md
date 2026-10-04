# Meterly Load-Test Results

These results were produced by `tests/load-test.js` against `http://localhost:8080` with Docker Compose running locally.

## Health Endpoint Baseline

Configuration:

```text
requests=200
concurrency=25
endpoint=GET /health
```

Results:

```text
successful=200
failed=0
error_rate=0%
throughput=279.890 requests/second
latency_avg=80.836 ms
latency_p50=77.261 ms
latency_p95=139.767 ms
latency_p99=210.556 ms
latency_max=213.327 ms
```

## Health Endpoint Higher Concurrency

Configuration:

```text
requests=1000
concurrency=50
endpoint=GET /health
```

Results:

```text
successful=1000
failed=0
error_rate=0%
throughput=300.762 requests/second
latency_avg=161.610 ms
latency_p50=152.241 ms
latency_p95=438.883 ms
latency_p99=793.154 ms
latency_max=908.978 ms
```

## Health Endpoint Saturation Sample

Configuration:

```text
requests=2000
concurrency=100
endpoint=GET /health
```

Results:

```text
successful=2000
failed=0
error_rate=0%
throughput=306.603 requests/second
latency_avg=317.787 ms
latency_p50=325.574 ms
latency_p95=934.719 ms
latency_p99=1261.606 ms
latency_max=1493.581 ms
```

## Concurrent Idempotency

Configuration:

```text
requests=100
concurrency=25
endpoint=POST /api/usage
body={"usageType":"api_call","quantity":1}
all requests used the same tenant and Idempotency-Key
```

Results:

```text
successful=100
failed=0
error_rate=0%
throughput=347.762 requests/second
latency_avg=57.017 ms
latency_p50=49.798 ms
latency_p95=91.982 ms
latency_p99=98.912 ms
latency_max=100.552 ms
http_status_201=100
rows_before=0
rows_after=1
double_consumption=false
unique_logical_responses=1
```

The idempotency result was verified with a direct PostgreSQL query, not inferred from HTTP responses alone.

## Reproduction

```powershell
$env:LOAD_TEST_MODE="health"
$env:LOAD_TEST_REQUESTS="2000"
$env:LOAD_TEST_CONCURRENCY="100"
node tests/load-test.js

$env:LOAD_TEST_MODE="idempotency"
$env:LOAD_TEST_REQUESTS="100"
$env:LOAD_TEST_CONCURRENCY="25"
node tests/load-test.js
```

CREATE TABLE ai_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    idempotency_key TEXT NOT NULL CHECK (length(btrim(idempotency_key)) > 0),
    status TEXT NOT NULL CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
    prompt TEXT NOT NULL CHECK (length(btrim(prompt)) > 0),
    max_output_tokens INTEGER NOT NULL CHECK (max_output_tokens > 0),
    reserved_tokens BIGINT NOT NULL CHECK (reserved_tokens > 0),
    billing_period_start DATE NOT NULL,
    billing_period_end DATE NOT NULL CHECK (billing_period_end > billing_period_start),
    provider TEXT NOT NULL CHECK (provider IN ('openai')),
    provider_request_id TEXT,
    output TEXT,
    input_tokens BIGINT NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
    cached_input_tokens BIGINT NOT NULL DEFAULT 0 CHECK (cached_input_tokens >= 0),
    output_tokens BIGINT NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
    reasoning_tokens BIGINT NOT NULL DEFAULT 0 CHECK (reasoning_tokens >= 0),
    cost_microunits BIGINT NOT NULL DEFAULT 0 CHECK (cost_microunits >= 0),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ai_jobs_idempotency_per_tenant UNIQUE (tenant_id, idempotency_key)
);

CREATE INDEX ai_jobs_status_created_at_idx
    ON ai_jobs (status, created_at);

CREATE INDEX ai_jobs_tenant_created_at_idx
    ON ai_jobs (tenant_id, created_at DESC);

CREATE TRIGGER ai_jobs_set_updated_at
BEFORE UPDATE ON ai_jobs
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

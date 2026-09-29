CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL CHECK (length(btrim(name)) > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL UNIQUE CHECK (code IN ('free', 'pro')),
    name TEXT NOT NULL,
    api_call_limit BIGINT NOT NULL CHECK (api_call_limit >= 0),
    ai_token_limit BIGINT NOT NULL CHECK (ai_token_limit >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
    plan_id UUID NOT NULL REFERENCES plans(id),
    provider TEXT NOT NULL DEFAULT 'stripe' CHECK (provider IN ('stripe', 'razorpay')),
    provider_customer_id TEXT,
    provider_subscription_id TEXT UNIQUE,
    status TEXT NOT NULL CHECK (status IN ('trialing', 'active', 'past_due', 'canceled', 'incomplete', 'paused')),
    current_period_start TIMESTAMPTZ NOT NULL,
    current_period_end TIMESTAMPTZ NOT NULL CHECK (current_period_end > current_period_start),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE usage_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    idempotency_key TEXT NOT NULL CHECK (length(btrim(idempotency_key)) > 0),
    usage_type TEXT NOT NULL CHECK (usage_type IN ('api_call', 'ai_tokens')),
    quantity BIGINT NOT NULL CHECK (quantity > 0),
    input_tokens BIGINT NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
    cached_input_tokens BIGINT NOT NULL DEFAULT 0 CHECK (cached_input_tokens >= 0),
    output_tokens BIGINT NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
    reasoning_tokens BIGINT NOT NULL DEFAULT 0 CHECK (reasoning_tokens >= 0),
    cost_microunits BIGINT NOT NULL DEFAULT 0 CHECK (cost_microunits >= 0),
    billing_period_start DATE NOT NULL,
    billing_period_end DATE NOT NULL CHECK (billing_period_end > billing_period_start),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT usage_events_idempotency_key_per_tenant UNIQUE (tenant_id, idempotency_key),
    CONSTRAINT cached_tokens_must_be_input_tokens CHECK (cached_input_tokens <= input_tokens),
    CONSTRAINT api_call_has_no_token_breakdown CHECK (
        usage_type <> 'api_call'
        OR (input_tokens = 0 AND cached_input_tokens = 0 AND output_tokens = 0 AND reasoning_tokens = 0)
    ),
    CONSTRAINT ai_tokens_have_token_breakdown CHECK (
        usage_type <> 'ai_tokens'
        OR (input_tokens + output_tokens + reasoning_tokens > 0)
    )
);

CREATE TABLE webhook_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider TEXT NOT NULL CHECK (provider IN ('stripe', 'razorpay')),
    provider_event_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    payload JSONB NOT NULL,
    processed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (provider, provider_event_id)
);

CREATE INDEX usage_events_tenant_period_idx
    ON usage_events (tenant_id, billing_period_start, usage_type);

CREATE INDEX usage_events_created_at_idx
    ON usage_events (created_at);

CREATE INDEX webhook_events_created_at_idx
    ON webhook_events (created_at);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

CREATE TRIGGER tenants_set_updated_at
BEFORE UPDATE ON tenants
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER plans_set_updated_at
BEFORE UPDATE ON plans
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER subscriptions_set_updated_at
BEFORE UPDATE ON subscriptions
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

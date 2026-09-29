CREATE TABLE reconciliation_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'completed_with_failures', 'failed')),
    tenants_checked INTEGER NOT NULL DEFAULT 0 CHECK (tenants_checked >= 0),
    tenants_reconciled INTEGER NOT NULL DEFAULT 0 CHECK (tenants_reconciled >= 0),
    failures INTEGER NOT NULL DEFAULT 0 CHECK (failures >= 0),
    error_message TEXT
);

CREATE INDEX reconciliation_runs_started_at_idx
    ON reconciliation_runs (started_at DESC);

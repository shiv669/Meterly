ALTER TABLE subscriptions
    DROP CONSTRAINT subscriptions_status_check;

ALTER TABLE subscriptions
    ADD CONSTRAINT subscriptions_status_check CHECK (
        status IN (
            'trialing',
            'active',
            'past_due',
            'canceled',
            'incomplete',
            'incomplete_expired',
            'unpaid',
            'paused'
        )
    );

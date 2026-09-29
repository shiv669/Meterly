ALTER TABLE usage_events
    DROP CONSTRAINT ai_tokens_have_token_breakdown;

ALTER TABLE usage_events
    ADD CONSTRAINT ai_tokens_have_token_breakdown CHECK (
        usage_type <> 'ai_tokens'
        OR (input_tokens + cached_input_tokens + output_tokens + reasoning_tokens > 0)
    );

async function findUsageEventByIdempotencyKey(client, tenantId, idempotencyKey) {
  const result = await client.query(`
    SELECT id, usage_type, quantity
    FROM usage_events
    WHERE tenant_id = $1 AND idempotency_key = $2
  `, [tenantId, idempotencyKey]);

  return result.rows[0] || null;
}

async function insertUsageEvent({
  client,
  tenantId,
  idempotencyKey,
  usageType,
  quantity,
  inputTokens,
  cachedInputTokens,
  outputTokens,
  reasoningTokens,
  billingPeriodStart,
  billingPeriodEnd
}) {
  const values = [
    tenantId,
    idempotencyKey,
    usageType,
    quantity,
    inputTokens,
    cachedInputTokens,
    outputTokens,
    reasoningTokens,
    billingPeriodStart,
    billingPeriodEnd
  ];

  const inserted = await client.query(`
    INSERT INTO usage_events (
      tenant_id,
      idempotency_key,
      usage_type,
      quantity,
      input_tokens,
      cached_input_tokens,
      output_tokens,
      reasoning_tokens,
      billing_period_start,
      billing_period_end
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
    RETURNING id, usage_type, quantity
  `, values);

  if (inserted.rows.length > 0) {
    return inserted.rows[0];
  }

  const existing = await findUsageEventByIdempotencyKey(client, tenantId, idempotencyKey);

  if (!existing) {
    throw new Error('Usage event was not inserted or found');
  }

  return existing;
}

module.exports = { findUsageEventByIdempotencyKey, insertUsageEvent };

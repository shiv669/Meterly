const crypto = require('node:crypto');
const { pool } = require('../config/database');

async function withDeduplicatedEvent({ provider, event, handler }) {
  const client = await pool.connect();
  const lockKey = crypto
    .createHash('sha256')
    .update(`${provider}:${event.id}`)
    .digest()
    .readBigInt64BE(0);

  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [lockKey]);

    const existing = await client.query(`
      SELECT processed_at
      FROM webhook_events
      WHERE provider = $1 AND provider_event_id = $2
    `, [provider, event.id]);

    if (existing.rows[0]?.processed_at) {
      await client.query('COMMIT');
      return { duplicate: true };
    }

    if (existing.rows.length === 0) {
      await client.query(`
        INSERT INTO webhook_events (
          provider,
          provider_event_id,
          event_type,
          payload
        )
        VALUES ($1, $2, $3, $4)
      `, [provider, event.id, event.type, event]);
    }

    const result = await handler(client, event);

    await client.query(`
      UPDATE webhook_events
      SET processed_at = NOW()
      WHERE provider = $1 AND provider_event_id = $2
    `, [provider, event.id]);

    await client.query('COMMIT');
    return { duplicate: false, result };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { withDeduplicatedEvent };

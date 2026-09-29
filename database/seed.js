const { Client } = require('pg');
require('dotenv').config();

const connectionString = process.env.DATABASE_URL
  || 'postgres://meterly:meterly_dev_password@127.0.0.1:15432/meterly';

async function seedDatabase() {
  const client = new Client({ connectionString });
  await client.connect();

  try {
    await client.query('BEGIN');

    await client.query(`
      INSERT INTO plans (code, name, api_call_limit, ai_token_limit)
      VALUES
        ('free', 'Free', 1000, 100000),
        ('pro', 'Pro', 100000, 10000000)
      ON CONFLICT (code) DO UPDATE SET
        name = EXCLUDED.name,
        api_call_limit = EXCLUDED.api_call_limit,
        ai_token_limit = EXCLUDED.ai_token_limit,
        updated_at = NOW()
    `);

    const tenantResult = await client.query(`
      INSERT INTO tenants (id, name)
      VALUES ('00000000-0000-4000-8000-000000000001', 'Meterly Demo Tenant')
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, updated_at = NOW()
      RETURNING id
    `);

    await client.query(`
      INSERT INTO subscriptions (
        tenant_id,
        plan_id,
        provider,
        status,
        current_period_start,
        current_period_end
      )
      SELECT
        $1,
        plans.id,
        'stripe',
        'active',
        DATE_TRUNC('month', NOW()),
        DATE_TRUNC('month', NOW()) + INTERVAL '1 month'
      FROM plans
      WHERE plans.code = 'free'
      ON CONFLICT (tenant_id) DO UPDATE SET
        plan_id = EXCLUDED.plan_id,
        status = EXCLUDED.status,
        current_period_start = EXCLUDED.current_period_start,
        current_period_end = EXCLUDED.current_period_end,
        updated_at = NOW()
    `, [tenantResult.rows[0].id]);

    await client.query('COMMIT');
    console.log('Seed completed: Free and Pro plans plus the demo tenant.');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

seedDatabase().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

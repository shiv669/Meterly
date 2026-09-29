const { Pool } = require('pg');
require('dotenv').config();

const connectionString = process.env.DATABASE_URL || [
  `postgresql://${encodeURIComponent(process.env.DB_USER || 'meterly')}`,
  `:${encodeURIComponent(process.env.DB_PASSWORD || 'meterly_dev_password')}`,
  `@${process.env.DB_HOST || '127.0.0.1'}`,
  `:${process.env.DB_PORT || '15432'}`,
  `/${process.env.DB_NAME || 'meterly'}`
].join('');

const pool = new Pool({
  connectionString,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
});

module.exports = { pool };

const { pool } = require('../config/database');

async function getHealth(_request, response, next) {
  try {
    await pool.query('SELECT 1');
    response.json({
      status: 'ok',
      database: 'connected'
    });
  } catch (error) {
    next(error);
  }
}

module.exports = { getHealth };

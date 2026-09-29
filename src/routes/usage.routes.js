const express = require('express');
const { authenticateDevelopment } = require('../middleware/auth.middleware');
const { createUsage } = require('../controllers/usage.controller');

const router = express.Router();

router.post('/api/usage', authenticateDevelopment, createUsage);

module.exports = router;

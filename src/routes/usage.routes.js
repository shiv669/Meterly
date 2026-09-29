const express = require('express');
const { authenticateDevelopment } = require('../middleware/auth.middleware');
const { createUsage, getUsage } = require('../controllers/usage.controller');

const router = express.Router();

router.post('/api/usage', authenticateDevelopment, createUsage);
router.get('/api/usage', authenticateDevelopment, getUsage);

module.exports = router;

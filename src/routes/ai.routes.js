const express = require('express');
const { authenticateDevelopment } = require('../middleware/auth.middleware');
const {
  createGenerationJob,
  getGenerationJob
} = require('../controllers/ai.controller');

const router = express.Router();

router.post('/api/ai/generate', authenticateDevelopment, createGenerationJob);
router.get('/api/ai/jobs/:jobId', authenticateDevelopment, getGenerationJob);

module.exports = router;

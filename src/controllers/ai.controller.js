const { z } = require('zod');
const aiJobService = require('../services/ai-job.service');

const generateSchema = z.object({
  prompt: z.string().trim().min(1).max(20000),
  maxOutputTokens: z.number().int().positive().max(4096).optional().default(256)
}).strict();

function createBadRequestError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

async function createGenerationJob(request, response, next) {
  try {
    const idempotencyKey = request.get('idempotency-key')?.trim();
    if (!idempotencyKey) {
      throw createBadRequestError('Idempotency-Key header is required');
    }

    const parsed = generateSchema.safeParse(request.body);
    if (!parsed.success) {
      throw createBadRequestError(parsed.error.issues[0].message);
    }

    const job = await aiJobService.createJob({
      tenantId: request.tenantId,
      idempotencyKey,
      prompt: parsed.data.prompt,
      maxOutputTokens: parsed.data.maxOutputTokens
    });

    response.status(202).json(job);
  } catch (error) {
    next(error);
  }
}

async function getGenerationJob(request, response, next) {
  try {
    const job = await aiJobService.getJob({
      tenantId: request.tenantId,
      jobId: request.params.jobId
    });
    response.json(job);
  } catch (error) {
    next(error);
  }
}

module.exports = { createGenerationJob, getGenerationJob };

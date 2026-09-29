const { z } = require('zod');
const meterService = require('../services/meter.service');
const usageService = require('../services/usage.service');

const apiCallSchema = z.object({
  usageType: z.literal('api_call'),
  quantity: z.number().int().positive()
}).strict();

const aiTokensSchema = z.object({
  usageType: z.literal('ai_tokens'),
  inputTokens: z.number().int().nonnegative(),
  cachedInputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  reasoningTokens: z.number().int().nonnegative().optional().default(0)
}).strict().superRefine((value, context) => {
  if (
    value.inputTokens
    + value.cachedInputTokens
    + value.outputTokens
    + value.reasoningTokens === 0
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['inputTokens'],
      message: 'At least one token quantity is required'
    });
  }
});

const usageSchema = z.discriminatedUnion('usageType', [apiCallSchema, aiTokensSchema]);

function createBadRequestError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

async function createUsage(request, response, next) {
  try {
    const idempotencyKey = request.get('idempotency-key')?.trim();
    if (!idempotencyKey) {
      throw createBadRequestError('Idempotency-Key header is required');
    }

    const parsedUsage = usageSchema.safeParse(request.body);
    if (!parsedUsage.success) {
      throw createBadRequestError(parsedUsage.error.issues[0].message);
    }

    const result = await meterService.record({
      tenantId: request.tenantId,
      idempotencyKey,
      usage: parsedUsage.data
    });

    response.status(201).json({
      success: true,
      ...result
    });
  } catch (error) {
    next(error);
  }
}

async function getUsage(request, response, next) {
  try {
    const result = await usageService.getUsage({ tenantId: request.tenantId });
    response.json(result);
  } catch (error) {
    next(error);
  }
}

module.exports = { createUsage, getUsage };

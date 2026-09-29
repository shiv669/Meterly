const Groq = require('groq-sdk');
require('dotenv').config();

const client = new Groq({
  apiKey: process.env.GROQ_API_KEY || 'groq_key_placeholder'
});

async function generate({ prompt, maxOutputTokens }) {
  if (!process.env.GROQ_API_KEY) {
    throw new Error('GROQ_API_KEY is not configured');
  }

  const response = await client.chat.completions.create({
    model: process.env.GROQ_MODEL || 'openai/gpt-oss-120b',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: maxOutputTokens
  });

  const usage = response.usage || {};
  const promptDetails = usage.prompt_tokens_details || {};
  const completionDetails = usage.completion_tokens_details || {};

  return {
    output: response.choices[0]?.message?.content || '',
    providerRequestId: response.id,
    inputTokens: usage.prompt_tokens || 0,
    cachedInputTokens: promptDetails.cached_tokens || 0,
    outputTokens: usage.completion_tokens || 0,
    reasoningTokens: completionDetails.reasoning_tokens || 0
  };
}

module.exports = { generate };
import { describe, expect, it } from 'vitest';
import { calculate } from '../src/services/cost.service.js';

const microcentsPerCent = 1000000;

describe('CostService', () => {
  it('prices one API call in integer money units', () => {
    expect(calculate({ apiCalls: 1 })).toMatchObject({
      apiCalls: microcentsPerCent,
      aiTokens: 0,
      total: microcentsPerCent,
      currency: 'USD'
    });
  });

  it('prices fresh input tokens', () => {
    expect(calculate({ inputTokens: 10000 }).aiTokens).toBe(3000000);
  });

  it('prices cached input tokens more cheaply than fresh input', () => {
    const fresh = calculate({ inputTokens: 10000 }).aiTokens;
    const cached = calculate({ cachedInputTokens: 10000 }).aiTokens;

    expect(cached).toBe(300000);
    expect(cached).toBeLessThan(fresh);
  });

  it('prices output tokens', () => {
    expect(calculate({ outputTokens: 10000 }).aiTokens).toBe(15000000);
  });

  it('counts reasoning tokens exactly once as output-priced tokens', () => {
    expect(calculate({ outputTokens: 10000, reasoningTokens: 2000 }).aiTokens)
      .toBe(18000000);
  });

  it('calculates mixed usage exactly', () => {
    expect(calculate({
      inputTokens: 10000,
      cachedInputTokens: 4000,
      outputTokens: 2000,
      reasoningTokens: 500
    }).aiTokens).toBe(6870000);
  });
});

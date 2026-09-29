import { describe, expect, it } from 'vitest';
import { withRetry } from '../worker/retry.js';

describe('worker retry policy', () => {
  it('retries a transient failure with exponential backoff', async () => {
    let attempts = 0;
    const retryAttempts = [];

    const result = await withRetry(async () => {
      attempts += 1;
      if (attempts < 3) {
        throw new Error('temporary Stripe failure');
      }
      return 'recovered';
    }, {
      maxAttempts: 3,
      baseDelayMilliseconds: 1,
      onRetry: (retry) => retryAttempts.push(retry)
    });

    expect(result).toBe('recovered');
    expect(attempts).toBe(3);
    expect(retryAttempts.map((retry) => retry.waitMilliseconds)).toEqual([1, 2]);
  });

  it('surfaces the final failure after the attempt limit', async () => {
    let attempts = 0;

    await expect(withRetry(async () => {
      attempts += 1;
      throw new Error('Stripe unavailable');
    }, {
      maxAttempts: 3,
      baseDelayMilliseconds: 1
    })).rejects.toThrow('Stripe unavailable');

    expect(attempts).toBe(3);
  });
});

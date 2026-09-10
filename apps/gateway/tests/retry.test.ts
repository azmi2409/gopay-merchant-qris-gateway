import { describe, it, expect, vi } from 'vitest';
import { withRetry } from '../src/utils/retry';

describe('withRetry utility', () => {
  it('returns value without retrying on success', async () => {
    const fn = vi.fn().mockResolvedValue('success');
    const result = await withRetry(fn, { retries: 3, delayMs: 10 });
    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on network or 5xx failures and succeeds', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce({ response: { status: 503 } })
      .mockResolvedValue('recovered');

    const result = await withRetry(fn, { retries: 2, delayMs: 10 });
    expect(result).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does not retry on 4xx client errors by default', async () => {
    const fn = vi.fn().mockRejectedValue({ response: { status: 400, data: 'bad request' } });

    await expect(withRetry(fn, { retries: 2, delayMs: 10 })).rejects.toMatchObject({
      response: { status: 400 }
    });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('throws after exceeding maximum retries', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('Persistent network failure'));

    await expect(withRetry(fn, { retries: 2, delayMs: 10 })).rejects.toThrow(
      'Persistent network failure'
    );
    expect(fn).toHaveBeenCalledTimes(3);
  });
});

export interface RetryOptions {
  retries?: number;
  delayMs?: number;
  backoffFactor?: number;
  shouldRetry?: (error: any) => boolean;
}

/**
 * Executes an async operation with exponential backoff retry.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    retries = 2,
    delayMs = 500,
    backoffFactor = 2,
    shouldRetry = (err) => {
      // Retry on network errors or 5xx server errors
      if (!err.response) return true;
      const status = err.response.status;
      return status >= 500 && status <= 599;
    }
  } = options;

  let attempt = 0;
  let currentDelay = delayMs;

  while (true) {
    try {
      return await fn();
    } catch (err: any) {
      attempt++;
      if (attempt > retries || !shouldRetry(err)) {
        throw err;
      }
      await new Promise((res) => setTimeout(res, currentDelay));
      currentDelay *= backoffFactor;
    }
  }
}

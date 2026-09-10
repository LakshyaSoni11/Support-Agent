import { MODEL } from "./model";

export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {}
): Promise<T> {
  const { maxRetries = 6, baseDelayMs = 1500, maxDelayMs = 30000 } = opts;

  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e: any) {
      const status = e?.status;
      const code = e?.error?.error?.code;
      const message = e?.error?.error?.message || e?.message || "";

      const retriable =
        status === 429 ||
        status >= 500 ||
        code === "json_validate_failed" ||
        /rate|overloaded|temporarily|json/i.test(message);

      if (!retriable || attempt >= maxRetries) {
        throw e;
      }

      const jitter = Math.random() * 0.3 + 0.85;
      const backoff = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt)) * jitter;
      console.log(`[retry] ${MODEL} attempt ${attempt + 1}/${maxRetries} (${e?.status}): waiting ${Math.round(backoff)}ms`);
      await sleep(backoff);
    }
  }
}
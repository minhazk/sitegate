import type { LoginAttemptLimiter, RateLimitDecision } from "./types.js";

interface MemoryRateLimiterOptions {
  maxAttempts: number;
  globalMaxAttempts: number;
  windowSeconds: number;
}

export function createMemoryRateLimiter(options: MemoryRateLimiterOptions): LoginAttemptLimiter {
  const attempts = new Map<string, number[]>();
  let globalAttempts: Array<{ clientKey: string; timestamp: number }> = [];
  const windowMs = options.windowSeconds * 1000;
  const maxBuckets = 10_000;
  let attemptsRecorded = 0;

  function clientKey(clientId: string): string {
    const key = `client:${clientId}`;
    if (attempts.has(key) || attempts.size < maxBuckets) return key;
    return "client:overflow";
  }

  function recent(key: string, now: number): number[] {
    const cutoff = now - windowMs;
    const values = (attempts.get(key) ?? []).filter((timestamp) => timestamp > cutoff);
    if (values.length === 0) attempts.delete(key);
    else attempts.set(key, values);
    return values;
  }

  function decision(values: number[], maximum: number, now: number): RateLimitDecision {
    if (values.length < maximum) return { limited: false };
    const oldest = values[0] ?? now;
    return {
      limited: true,
      retryAfterSeconds: Math.max(60, Math.ceil((oldest + windowMs - now) / (60 * 1000)) * 60),
    };
  }

  function cleanAll(now: number): void {
    for (const key of attempts.keys()) recent(key, now);
    const cutoff = now - windowMs;
    globalAttempts = globalAttempts.filter(({ timestamp }) => timestamp > cutoff);
  }

  return {
    scope: "process",
    consume(clientId, now) {
      attemptsRecorded += 1;
      if (attemptsRecorded % 128 === 0) cleanAll(now);
      const key = clientKey(clientId);
      const clientValues = recent(key, now);
      const cutoff = now - windowMs;
      globalAttempts = globalAttempts.filter(({ timestamp }) => timestamp > cutoff);
      const globalValues = globalAttempts.map(({ timestamp }) => timestamp);
      const client = decision(clientValues, options.maxAttempts, now);
      const global = decision(globalValues, options.globalMaxAttempts, now);
      if (client.limited || global.limited) {
        return {
          limited: true,
          retryAfterSeconds: Math.max(client.retryAfterSeconds ?? 1, global.retryAfterSeconds ?? 1),
        };
      }
      attempts.set(key, [...clientValues, now]);
      globalAttempts.push({ clientKey: key, timestamp: now });
      return { limited: false };
    },
    reset(clientId) {
      const key = clientKey(clientId);
      attempts.delete(key);
      globalAttempts = globalAttempts.filter(({ clientKey: recordedKey }) => recordedKey !== key);
    },
  };
}

export async function defaultClientId(request: Request, trustProxy: boolean): Promise<string> {
  if (!trustProxy) return "untrusted-proxy";
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const address = forwarded || request.headers.get("x-real-ip")?.trim();
  if (!address) return "unknown";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(address));
  return Array.from(new Uint8Array(digest).slice(0, 12), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

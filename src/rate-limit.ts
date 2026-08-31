import type { LoginAttemptLimiter, RateLimitDecision } from "./types.js";

interface MemoryRateLimiterOptions {
  maxAttempts: number;
  globalMaxAttempts: number;
  windowSeconds: number;
}

interface TimestampQueue {
  values: number[];
  head: number;
}

interface GlobalAttempt {
  clientKey: string;
  timestamp: number;
  previous: GlobalAttempt | undefined;
  next: GlobalAttempt | undefined;
}

export function createMemoryRateLimiter(options: MemoryRateLimiterOptions): LoginAttemptLimiter {
  const attempts = new Map<string, TimestampQueue>();
  const globalByClient = new Map<string, Set<GlobalAttempt>>();
  let globalHead: GlobalAttempt | undefined;
  let globalTail: GlobalAttempt | undefined;
  let globalActiveCount = 0;
  const windowMs = options.windowSeconds * 1000;
  const maxBuckets = 10_000;
  let attemptsRecorded = 0;

  function clientKey(clientId: string): string {
    const key = `client:${clientId}`;
    if (attempts.has(key) || attempts.size < maxBuckets) return key;
    return "client:overflow";
  }

  function compact(queue: TimestampQueue): void {
    if (queue.head < 128 || queue.head * 2 < queue.values.length) return;
    queue.values.splice(0, queue.head);
    queue.head = 0;
  }

  function recent(key: string, now: number): TimestampQueue {
    const cutoff = now - windowMs;
    const queue = attempts.get(key) ?? { values: [], head: 0 };
    while ((queue.values[queue.head] ?? Number.POSITIVE_INFINITY) <= cutoff) queue.head += 1;
    compact(queue);
    if (queue.head === queue.values.length) {
      queue.values.length = 0;
      queue.head = 0;
      attempts.delete(key);
    }
    return queue;
  }

  function decision(
    count: number,
    oldest: number | undefined,
    maximum: number,
    now: number,
  ): RateLimitDecision {
    if (count < maximum) return { limited: false };
    return {
      limited: true,
      retryAfterSeconds: Math.max(
        60,
        Math.ceil(((oldest ?? now) + windowMs - now) / (60 * 1000)) * 60,
      ),
    };
  }

  function unlinkGlobal(attempt: GlobalAttempt): void {
    if (attempt.previous === undefined) globalHead = attempt.next;
    else attempt.previous.next = attempt.next;
    if (attempt.next === undefined) globalTail = attempt.previous;
    else attempt.next.previous = attempt.previous;

    const records = globalByClient.get(attempt.clientKey);
    records?.delete(attempt);
    if (records?.size === 0) globalByClient.delete(attempt.clientKey);
    attempt.previous = undefined;
    attempt.next = undefined;
    globalActiveCount -= 1;
  }

  function expireGlobal(now: number): void {
    const cutoff = now - windowMs;
    while (globalHead !== undefined && globalHead.timestamp <= cutoff) unlinkGlobal(globalHead);
  }

  function cleanAll(now: number): void {
    for (const key of attempts.keys()) recent(key, now);
    expireGlobal(now);
  }

  return {
    scope: "process",
    consume(clientId, now) {
      attemptsRecorded += 1;
      if (attemptsRecorded % 128 === 0) cleanAll(now);
      const key = clientKey(clientId);
      const clientQueue = recent(key, now);
      expireGlobal(now);
      const client = decision(
        clientQueue.values.length - clientQueue.head,
        clientQueue.values[clientQueue.head],
        options.maxAttempts,
        now,
      );
      const global = decision(
        globalActiveCount,
        globalHead?.timestamp,
        options.globalMaxAttempts,
        now,
      );
      if (client.limited || global.limited) {
        return {
          limited: true,
          retryAfterSeconds: Math.max(client.retryAfterSeconds ?? 1, global.retryAfterSeconds ?? 1),
        };
      }
      clientQueue.values.push(now);
      attempts.set(key, clientQueue);
      const globalAttempt: GlobalAttempt = {
        clientKey: key,
        timestamp: now,
        previous: globalTail,
        next: undefined,
      };
      if (globalTail === undefined) globalHead = globalAttempt;
      else globalTail.next = globalAttempt;
      globalTail = globalAttempt;
      const clientGlobalAttempts = globalByClient.get(key) ?? new Set<GlobalAttempt>();
      clientGlobalAttempts.add(globalAttempt);
      globalByClient.set(key, clientGlobalAttempts);
      globalActiveCount += 1;
      return { limited: false };
    },
    reset(clientId) {
      const key = clientKey(clientId);
      attempts.delete(key);
      for (const attempt of globalByClient.get(key) ?? []) unlinkGlobal(attempt);
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

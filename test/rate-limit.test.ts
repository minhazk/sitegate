import { describe, expect, it } from "vitest";
import { createMemoryRateLimiter } from "../src/index.js";

describe("memory rate limiter", () => {
  it("uses rolling per-client and global windows", async () => {
    const limiter = createMemoryRateLimiter({
      maxAttempts: 2,
      globalMaxAttempts: 3,
      windowSeconds: 60,
    });
    expect(await limiter.consume("a", 0)).toEqual({ limited: false });
    expect(await limiter.consume("a", 1)).toEqual({ limited: false });
    expect(await limiter.consume("a", 2)).toMatchObject({ limited: true, retryAfterSeconds: 60 });
    expect(await limiter.consume("b", 2)).toEqual({ limited: false });
    expect(await limiter.consume("c", 3)).toMatchObject({ limited: true });
    expect(await limiter.consume("a", 60_001)).toEqual({ limited: false });
  });

  it("can explicitly reset a client failure bucket", async () => {
    const limiter = createMemoryRateLimiter({
      maxAttempts: 1,
      globalMaxAttempts: 10,
      windowSeconds: 60,
    });
    await limiter.consume("a", 0);
    await limiter.reset("a");
    expect(await limiter.consume("a", 1)).toEqual({ limited: false });
  });

  it("removes a successful client's reservations from the global bucket", async () => {
    const limiter = createMemoryRateLimiter({
      maxAttempts: 1,
      globalMaxAttempts: 1,
      windowSeconds: 60,
    });
    expect(await limiter.consume("a", 0)).toEqual({ limited: false });
    await limiter.reset("a");
    expect(await limiter.consume("b", 1)).toEqual({ limited: false });
  });

  it("admits and records attempts atomically", async () => {
    const limiter = createMemoryRateLimiter({
      maxAttempts: 2,
      globalMaxAttempts: 20,
      windowSeconds: 60,
    });
    const decisions = await Promise.all(
      Array.from({ length: 20 }, () => limiter.consume("a", Date.now())),
    );
    expect(decisions.filter((decision) => !decision.limited)).toHaveLength(2);
    expect(decisions.filter((decision) => decision.limited)).toHaveLength(18);
  });
});

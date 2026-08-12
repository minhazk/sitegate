import { describe, expect, it } from "vitest";
import { createMemoryRateLimiter } from "../src/index.js";

describe("memory rate limiter", () => {
  it("uses rolling per-client and global windows", async () => {
    const limiter = createMemoryRateLimiter({
      maxAttempts: 2,
      globalMaxAttempts: 3,
      windowSeconds: 60,
    });
    await limiter.recordFailure("a", 0);
    await limiter.recordFailure("a", 1);
    expect(await limiter.check("a", 2)).toMatchObject({ limited: true, retryAfterSeconds: 60 });
    expect(await limiter.check("b", 2)).toEqual({ limited: false });
    await limiter.recordFailure("b", 2);
    expect(await limiter.check("c", 3)).toMatchObject({ limited: true });
    expect(await limiter.check("a", 60_001)).toEqual({ limited: false });
  });

  it("resets only the successful client bucket", async () => {
    const limiter = createMemoryRateLimiter({
      maxAttempts: 1,
      globalMaxAttempts: 10,
      windowSeconds: 60,
    });
    await limiter.recordFailure("a", 0);
    await limiter.reset("a");
    expect(await limiter.check("a", 1)).toEqual({ limited: false });
  });
});

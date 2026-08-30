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

  it("expires attempts exactly at the rolling-window boundary", async () => {
    const limiter = createMemoryRateLimiter({
      maxAttempts: 1,
      globalMaxAttempts: 1,
      windowSeconds: 60,
    });
    expect(await limiter.consume("a", 0)).toEqual({ limited: false });
    expect(await limiter.consume("a", 59_999)).toMatchObject({ limited: true });
    expect(await limiter.consume("a", 60_000)).toEqual({ limited: false });
  });

  it("resets only the successful client from an interleaved global history", async () => {
    const limiter = createMemoryRateLimiter({
      maxAttempts: 3,
      globalMaxAttempts: 3,
      windowSeconds: 60,
    });
    expect(await limiter.consume("a", 0)).toEqual({ limited: false });
    expect(await limiter.consume("b", 1)).toEqual({ limited: false });
    expect(await limiter.consume("a", 2)).toEqual({ limited: false });
    await limiter.reset("a");
    expect(await limiter.consume("c", 3)).toEqual({ limited: false });
    expect(await limiter.consume("d", 4)).toEqual({ limited: false });
    expect(await limiter.consume("e", 5)).toMatchObject({ limited: true });
  });

  it("keeps retry timing anchored to the oldest active global attempt", async () => {
    const limiter = createMemoryRateLimiter({
      maxAttempts: 10,
      globalMaxAttempts: 2,
      windowSeconds: 120,
    });
    await limiter.consume("reset-me", 0);
    await limiter.consume("active", 61_000);
    await limiter.reset("reset-me");
    await limiter.consume("new", 62_000);
    expect(await limiter.consume("blocked", 63_000)).toEqual({
      limited: true,
      retryAfterSeconds: 120,
    });
  });

  it("handles maximum supported histories and saturated rejections without full-array copies", async () => {
    const limiter = createMemoryRateLimiter({
      maxAttempts: 10_000,
      globalMaxAttempts: 100_000,
      windowSeconds: 60,
    });

    for (let client = 0; client < 10; client += 1) {
      for (let attempt = 0; attempt < 10_000; attempt += 1) {
        const result = await limiter.consume(`client-${client}`, attempt);
        if (result.limited) throw new Error("The maximum supported history filled early.");
      }
    }

    for (let attempt = 0; attempt < 10_000; attempt += 1) {
      expect((await limiter.consume("blocked", 10_000)).limited).toBe(true);
    }
  }, 10_000);

  it("can clear a maximum-size client bucket without scanning unrelated clients", async () => {
    const limiter = createMemoryRateLimiter({
      maxAttempts: 10_000,
      globalMaxAttempts: 10_000,
      windowSeconds: 60,
    });
    for (let attempt = 0; attempt < 10_000; attempt += 1) {
      await limiter.consume("successful", attempt);
    }
    await limiter.reset("successful");
    expect(await limiter.consume("other", 10_000)).toEqual({ limited: false });
  });
});

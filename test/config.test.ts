import { afterEach, describe, expect, it, vi } from "vitest";
import { createSitegate, SitegateConfigurationError, type SitegateConfig } from "../src/index.js";
import { submitLogin, TEST_PASSWORD, TEST_SECRET } from "./helpers.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("configuration", () => {
  it.each([
    [{ password: "", secret: TEST_SECRET }, "password"],
    [{ password: TEST_PASSWORD, secret: "short" }, "secret"],
    [
      {
        password: "same password and secret value 000000",
        secret: "same password and secret value 000000",
      },
      "different",
    ],
    [{ password: TEST_PASSWORD, secret: TEST_SECRET, loginPath: "login" }, "loginPath"],
    [
      { password: TEST_PASSWORD, secret: TEST_SECRET, loginPath: "/%5Fsitegate/login" },
      "loginPath",
    ],
    [
      { password: TEST_PASSWORD, secret: TEST_SECRET, sessionDuration: 31 * 24 * 60 * 60 },
      "sessionDuration",
    ],
    [
      { password: TEST_PASSWORD, secret: TEST_SECRET, branding: { accentColor: "red" } },
      "accentColor",
    ],
    [
      { password: TEST_PASSWORD, secret: TEST_SECRET, branding: { logo: "https://evil.test/x" } },
      "logo",
    ],
    [{ password: TEST_PASSWORD, secret: TEST_SECRET, branding: { logo: "/private?x=1" } }, "logo"],
    [{ password: TEST_PASSWORD, secret: TEST_SECRET, branding: { logo: "/private#logo" } }, "logo"],
    [
      { password: TEST_PASSWORD, secret: TEST_SECRET, branding: { logo: "/brand/%6cogo.svg" } },
      "logo",
    ],
    [
      { password: TEST_PASSWORD, secret: TEST_SECRET, strings: { language: "not a locale!" } },
      "strings.language",
    ],
    [
      { password: TEST_PASSWORD, secret: TEST_SECRET, rateLimit: { maxAttempts: 0 } },
      "rateLimit.maxAttempts",
    ],
    [
      {
        password: TEST_PASSWORD,
        secret: TEST_SECRET,
        rateLimit: { globalMaxAttempts: 100_001 },
      },
      "rateLimit.globalMaxAttempts",
    ],
    [
      { password: TEST_PASSWORD, secret: TEST_SECRET, rateLimit: { windowSeconds: 100_000 } },
      "rateLimit.windowSeconds",
    ],
  ])("rejects unsafe config: %s", (config, field) => {
    expect(() => createSitegate(config)).toThrowError(SitegateConfigurationError);
    expect(() => createSitegate(config)).toThrow(String(field));
  });

  it.each([
    ["enabled", { password: "", secret: "", enabled: 0 }],
    ["secureCookies", { password: TEST_PASSWORD, secret: TEST_SECRET, secureCookies: "false" }],
    ["sameSite", { password: TEST_PASSWORD, secret: TEST_SECRET, sameSite: "none" }],
    ["rateLimit", { password: TEST_PASSWORD, secret: TEST_SECRET, rateLimit: true }],
    ["rateLimit", { password: TEST_PASSWORD, secret: TEST_SECRET, rateLimit: [] }],
    [
      "rateLimit.trustProxy",
      {
        password: TEST_PASSWORD,
        secret: TEST_SECRET,
        rateLimit: { trustProxy: "true" },
      },
    ],
  ])("rejects untyped runtime config for %s", (field, config) => {
    expect(() => createSitegate(config as unknown as SitegateConfig)).toThrowError(
      SitegateConfigurationError,
    );
    expect(() => createSitegate(config as unknown as SitegateConfig)).toThrow(String(field));
  });

  it("accepts and authenticates a one-character shared password", async () => {
    const gate = createSitegate({ password: "x", secret: TEST_SECRET });
    expect((await submitLogin(gate, "x")).status).toBe(303);
  });

  it("does not require secrets while disabled", async () => {
    const gate = createSitegate({ enabled: false, password: "", secret: "" });
    const response = await gate.handle(new Request("https://example.test/private"), () =>
      Promise.resolve(new Response("ok")),
    );
    expect(await response.text()).toBe("ok");
  });

  it("requires shared or external rate limiting in AWS Lambda/SST", () => {
    vi.stubEnv("AWS_LAMBDA_FUNCTION_NAME", "starla-production");

    expect(() => createSitegate({ password: TEST_PASSWORD, secret: TEST_SECRET })).toThrow(
      "shared limiter",
    );

    expect(() =>
      createSitegate({
        password: TEST_PASSWORD,
        secret: TEST_SECRET,
        rateLimit: {
          limiter: {
            scope: "shared",
            consume: () => ({ limited: false }),
            reset: () => {},
          },
        },
      }),
    ).not.toThrow();

    expect(() =>
      createSitegate({
        password: TEST_PASSWORD,
        secret: TEST_SECRET,
        rateLimit: {
          limiter: {
            scope: "process",
            consume: () => ({ limited: false }),
            reset: () => {},
          },
        },
      }),
    ).toThrow('scope is "shared"');

    expect(() =>
      createSitegate({ password: TEST_PASSWORD, secret: TEST_SECRET, rateLimit: false }),
    ).not.toThrow();

    vi.unstubAllEnvs();
    vi.stubEnv("AWS_EXECUTION_ENV", "AWS_Lambda_nodejs24.x");
    expect(() => createSitegate({ password: TEST_PASSWORD, secret: TEST_SECRET })).toThrow(
      "shared limiter",
    );
  });
});

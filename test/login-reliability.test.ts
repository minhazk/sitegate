import { describe, expect, it, vi } from "vitest";
import { createSitegate, type SitegateConfig, SitegateConfigurationError } from "../src/index.js";
import {
  BASE_URL,
  blocked,
  cookieValue,
  loginForm,
  makeGate,
  submitLogin,
  TEST_PASSWORD,
} from "./helpers.js";

describe("browser login reliability", () => {
  const navigation = {
    Origin: "null",
    "Sec-Fetch-Site": "same-origin",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Dest": "document",
  };

  async function post(headers: Record<string, string>, tokenValid = true) {
    const gate = makeGate();
    const form = await loginForm(gate);
    return gate.handle(
      new Request(`${BASE_URL}${gate.loginPath}`, {
        method: "POST",
        headers: {
          ...headers,
          Cookie: form.cookie,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          password: TEST_PASSWORD,
          csrf: tokenValid ? form.token : "invalid",
        }),
      }),
      blocked,
    );
  }

  it("accepts the opaque Origin sent by a same-origin browser form under no-referrer", async () => {
    expect((await post(navigation)).status).toBe(303);
    expect((await post(navigation, false)).status).toBe(403);
  });

  it.each([
    { Origin: "null" },
    { ...navigation, "Sec-Fetch-Site": "cross-site" },
    { ...navigation, "Sec-Fetch-Site": "same-site" },
    { ...navigation, "Sec-Fetch-Site": "none" },
    { ...navigation, "Sec-Fetch-Mode": "cors" },
    { ...navigation, "Sec-Fetch-Dest": "iframe" },
    { ...navigation, Referer: "https://evil.example/" },
    { ...navigation, Origin: "https://evil.example" },
  ])("still rejects untrusted source metadata %j", async (headers) => {
    expect((await post(headers)).status).toBe(403);
  });

  it("opening a second login tab does not invalidate the first form", async () => {
    const gate = makeGate();
    const first = await loginForm(gate, "/reports");
    const second = await gate.handle(
      new Request(`${BASE_URL}${gate.loginPath}`, {
        headers: { Cookie: first.cookie },
      }),
      blocked,
    );
    const currentCookie = `__Host-sitegate_csrf=${cookieValue(second, "__Host-sitegate_csrf")}`;
    expect(
      (await submitLogin(gate, TEST_PASSWORD, "/reports", { ...first, cookie: currentCookie }))
        .status,
    ).toBe(303);
  });

  it("browser source failures offer a usable form instead of a JSON dead end", async () => {
    const result = await post({ Origin: "https://other.example", Accept: "text/html" });
    expect(result.status).toBe(403);
    expect(result.headers.get("content-type")).toContain("text/html");
    expect(await result.text()).toContain("<form");
  });

  it("refreshes an expired form in place and keeps the destination", async () => {
    let now = Date.now();
    const gate = makeGate({ now: () => now });
    const form = await loginForm(gate, "/reports?filter=mine");
    now += 606_000;
    const expired = await submitLogin(gate, TEST_PASSWORD, "/reports?filter=mine", form);
    expect(expired.status).toBe(403);
    const html = await expired.text();
    expect(html).toContain("Enter your password again");
    expect(html).not.toContain("Reload the page");
    const token = /name="csrf" value="([^"]+)"/u.exec(html)?.[1] ?? "";
    const result = await submitLogin(gate, TEST_PASSWORD, "/reports?filter=mine", {
      ...form,
      token,
    });
    expect(result.status).toBe(303);
    expect(result.headers.get("location")).toBe("/reports?filter=mine");
  });

  it("distinguishes a missing browser cookie from a stale form", async () => {
    const gate = makeGate();
    const form = await loginForm(gate);
    const response = await submitLogin(gate, TEST_PASSWORD, "/", { ...form, cookie: "" });
    expect(response.status).toBe(403);
    expect(await response.text()).toContain("Allow cookies for this site");
  });

  it("supports long Unicode passwords within the advertised input limit", async () => {
    const password = "密".repeat(1024);
    const gate = makeGate({ password });
    expect((await submitLogin(gate, password)).status).toBe(303);
  });

  it.each([
    "/_sitegate/login",
    "/_sitegate/login?next=%2F_sitegate%2Flogin",
    "/_sitegate/logout",
    "/%5Fsitegate/login",
  ])("avoids sending users back to an auth endpoint: %s", async (destination) => {
    expect(
      (await submitLogin(makeGate(), TEST_PASSWORD, destination)).headers.get("location"),
    ).toBe("/");
  });

  it("handles a configured HTTPS public origin behind an HTTP reverse proxy", async () => {
    const gate = makeGate({ publicOrigin: BASE_URL });
    const internal = "http://internal:3000";
    const response = await gate.handle(new Request(`${internal}${gate.loginPath}`), blocked);
    const cookie = response.headers.getSetCookie()[0]?.split(";")[0] ?? "";
    expect(cookie).toMatch(/^__Host-sitegate_csrf=/u);
    expect(response.headers.get("set-cookie")).toContain("Secure");
    const token = /name="csrf" value="([^"]+)"/u.exec(await response.text())?.[1] ?? "";
    const login = await gate.handle(
      new Request(`${internal}${gate.loginPath}`, {
        method: "POST",
        headers: { Cookie: cookie, Origin: BASE_URL, Referer: `${BASE_URL}/_sitegate/login` },
        body: new URLSearchParams({ csrf: token, password: TEST_PASSWORD }),
      }),
      blocked,
    );
    expect(login.status).toBe(303);
    const session = login.headers.getSetCookie()[0]?.split(";")[0] ?? "";
    expect(
      await gate.isAuthenticated(new Request(internal, { headers: { Cookie: session } })),
    ).toBe(true);
    const hostile = await gate.handle(
      new Request(`${internal}${gate.loginPath}`, {
        method: "POST",
        headers: { Cookie: session, Origin: "https://evil.example" },
        body: new URLSearchParams({ csrf: token, password: TEST_PASSWORD }),
      }),
      blocked,
    );
    expect(hostile.status).toBe(403);
  });

  it("does not trust forwarded origin headers implicitly", async () => {
    const gate = makeGate();
    const form = await loginForm(gate);
    const result = await gate.handle(
      new Request(`http://internal:3000${gate.loginPath}`, {
        method: "POST",
        headers: {
          Origin: BASE_URL,
          "X-Forwarded-Proto": "https",
          "X-Forwarded-Host": "preview.example.com",
          Cookie: form.cookie,
        },
        body: new URLSearchParams({ csrf: form.token, password: TEST_PASSWORD }),
      }),
      blocked,
    );
    expect(result.status).toBe(403);
  });

  it.each(["consume", "reset"] as const)(
    "fails closed with a friendly page when the shared limiter's %s fails",
    async (method) => {
      const onEvent = vi.fn();
      const gate = makeGate({
        onEvent,
        rateLimit: {
          limiter: {
            scope: "shared",
            consume: () => {
              if (method === "consume") throw new Error("sensitive connection URL");
              return { limited: false };
            },
            reset: () => {
              if (method === "reset") throw new Error("sensitive connection URL");
            },
          },
        },
      });
      const response = await submitLogin(gate, TEST_PASSWORD);
      expect(response.status).toBe(503);
      expect(response.headers.get("set-cookie")).not.toContain("sitegate_session=");
      const html = await response.text();
      expect(html).toContain("Sign-in is temporarily unavailable");
      expect(html).not.toContain("sensitive connection URL");
      expect(onEvent).toHaveBeenCalledWith({ type: "login_unavailable" });
    },
  );

  it("shows the limiter's retry delay", async () => {
    const gate = makeGate({
      rateLimit: {
        limiter: {
          scope: "shared",
          consume: () => ({ limited: true, retryAfterSeconds: 45 }),
          reset: () => {},
        },
      },
    });
    const response = await submitLogin(gate, TEST_PASSWORD);
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("45");
    expect(await response.text()).toContain("Try again in 45 seconds");
  });

  it.each([
    { password: undefined },
    { password: null },
    { password: 123 },
    { secret: undefined },
    { secret: null },
    { secret: 123 },
    { password: "x".repeat(1025) },
    { publicOrigin: "https://example.com/path" },
    { publicOrigin: "https://user:password@example.com" },
    { publicOrigin: "ftp://example.com" },
    { publicOrigin: "not a URL" },
  ])("reports actionable configuration errors instead of raw runtime errors: %j", (overrides) => {
    expect(() =>
      createSitegate({
        password: TEST_PASSWORD,
        secret: "this is a stable test signing secret",
        ...overrides,
      } as SitegateConfig),
    ).toThrow(SitegateConfigurationError);
  });
});

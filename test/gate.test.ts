import { decodeJwt } from "jose";
import { describe, expect, it, vi } from "vitest";
import {
  BASE_URL,
  blocked,
  cookieValue,
  loginForm,
  makeGate,
  submitLogin,
  TEST_PASSWORD,
} from "./helpers.js";

describe("request protection", () => {
  it("redirects browser navigation and denies direct API access", async () => {
    const gate = makeGate();
    const page = await gate.handle(
      new Request(`${BASE_URL}/reports?id=7`, { headers: { Accept: "text/html" } }),
      blocked,
    );
    expect(page.status).toBe(307);
    const expectedLocation = `/_sitegate/login?${new URLSearchParams({ next: "/reports?id=7" })}`;
    expect(page.headers.get("location")).toBe(expectedLocation);

    const api = await gate.handle(
      new Request(`${BASE_URL}/api/private`, { headers: { Accept: "application/json" } }),
      blocked,
    );
    expect(api.status).toBe(401);
    expect(await api.json()).toEqual({ error: "Authentication required." });
    expect(api.headers.get("x-robots-tag")).toContain("noindex");
    expect(api.headers.get("cache-control")).toContain("no-store");
  });

  it("serves an accessible, dependency-free login page without leaking config", async () => {
    const gate = makeGate({
      secret: "do-not-leak-this-secret-0000000000",
      branding: { siteName: "Acme Preview" },
    });
    const { response } = await loginForm(gate, "/work");
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain("Secure");
    expect(response.headers.get("set-cookie")).toContain("SameSite=Strict");
    expect(html).toContain("Acme Preview");
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain(TEST_PASSWORD);
    expect(html).not.toContain("do-not-leak-this-secret");
    expect(html).not.toContain("<script");
  });

  it("authenticates server-side and lets the session access pages and APIs", async () => {
    const gate = makeGate();
    const login = await submitLogin(gate, TEST_PASSWORD, "/reports?month=8");
    expect(login.status).toBe(303);
    expect(login.headers.get("location")).toBe("/reports?month=8");
    const token = cookieValue(login, "__Host-sitegate_session");
    const claims = decodeJwt(token);
    expect(claims["type"]).toBe("session");
    expect(claims).not.toHaveProperty("password");

    const response = await gate.handle(
      new Request(`${BASE_URL}/api/private`, {
        headers: { Cookie: `__Host-sitegate_session=${encodeURIComponent(token)}` },
      }),
      () => Promise.resolve(Response.json({ private: true })),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ private: true });
    expect(response.headers.get("vary")).toContain("Cookie");
  });

  it("rejects wrong passwords with a generic error and emits secret-free events", async () => {
    const onEvent = vi.fn();
    const gate = makeGate({ onEvent });
    const response = await submitLogin(gate, "not the password");
    expect(response.status).toBe(401);
    expect(await response.text()).toContain("That password is not correct.");
    expect(response.headers.get("set-cookie")).not.toContain("sitegate_session=");
    expect(onEvent).toHaveBeenCalledWith({ type: "login_failed", clientId: "untrusted-proxy" });
  });

  it("does not let asynchronous telemetry block authentication responses", async () => {
    const onEvent = vi.fn(() => new Promise<void>(() => {}));
    const gate = makeGate({ onEvent });
    const result = await Promise.race([
      submitLogin(gate, "not the password"),
      new Promise<"blocked">((resolve) => setTimeout(() => resolve("blocked"), 100)),
    ]);
    expect(result).not.toBe("blocked");
    expect(result).toBeInstanceOf(Response);
    expect(onEvent).toHaveBeenCalledWith({ type: "login_failed", clientId: "untrusted-proxy" });

    const failingGate = makeGate({
      onEvent: () => Promise.reject(new Error("telemetry unavailable")),
    });
    expect((await submitLogin(failingGate, "not the password")).status).toBe(401);
    await Promise.resolve();
  });

  it("rejects forged, malformed, expired, and password-invalidated sessions", async () => {
    let now = Date.UTC(2026, 7, 11, 12);
    const gate = makeGate({ now: () => now, sessionDuration: 60 });
    const login = await submitLogin(gate, TEST_PASSWORD);
    const token = cookieValue(login, "__Host-sitegate_session");

    const [header, payload, signature = ""] = token.split(".");
    const changedSignature = `${signature[0] === "a" ? "b" : "a"}${signature.slice(1)}`;
    for (const forged of [
      `${header}.${payload}.${changedSignature}`,
      "not.a.jwt",
      "x".repeat(5000),
    ]) {
      const request = new Request(`${BASE_URL}/private`, {
        headers: { Cookie: `__Host-sitegate_session=${forged}` },
      });
      expect(await gate.isAuthenticated(request)).toBe(false);
    }

    now += 66_000;
    expect(
      await gate.isAuthenticated(
        new Request(`${BASE_URL}/private`, {
          headers: { Cookie: `__Host-sitegate_session=${token}` },
        }),
      ),
    ).toBe(false);

    const changedPasswordGate = makeGate({ password: "a completely different password" });
    expect(
      await changedPasswordGate.isAuthenticated(
        new Request(`${BASE_URL}/private`, {
          headers: { Cookie: `__Host-sitegate_session=${token}` },
        }),
      ),
    ).toBe(false);
  });

  it("protects and excludes only explicitly configured routes", async () => {
    const gate = makeGate({ protectedPaths: ["/admin", "/api"], excludedPaths: ["/api/health"] });
    for (const path of ["/", "/api/health", "/administrator"]) {
      const response = await gate.handle(new Request(`${BASE_URL}${path}`), () =>
        Promise.resolve(new Response("open")),
      );
      expect(await response.text()).toBe("open");
      expect(response.headers.get("x-robots-tag")).toContain("noindex");
    }
    expect((await gate.handle(new Request(`${BASE_URL}/api/users`), blocked)).status).toBe(401);
  });

  it("protects encoded variants of selectively protected routes", async () => {
    const gate = makeGate({ protectedPaths: ["/admin"] });
    for (const path of ["/%61dmin", "/%2561dmin", "/admin%2Fusers", "/admin%5Cusers"]) {
      const response = await gate.handle(new Request(`${BASE_URL}${path}`), blocked);
      expect(response.status).toBe(401);
    }
  });

  it("does not grant exclusions to a different raw path representation", async () => {
    const gate = makeGate({ excludedPaths: ["/public"] });
    expect((await gate.handle(new Request(`${BASE_URL}/public`), blocked)).status).toBe(200);
    expect((await gate.handle(new Request(`${BASE_URL}/%70ublic`), blocked)).status).toBe(401);
  });

  it("does not make a configured logo public without an explicit path exclusion", async () => {
    const gate = makeGate({ branding: { logo: "/brand/logo.svg" } });
    expect((await gate.handle(new Request(`${BASE_URL}/brand/logo.svg`), blocked)).status).toBe(
      401,
    );

    const gateWithPublicLogo = makeGate({
      branding: { logo: "/brand/logo.svg" },
      excludedPaths: ["/brand/logo.svg"],
    });
    const logo = await gateWithPublicLogo.handle(new Request(`${BASE_URL}/brand/logo.svg`), () =>
      Promise.resolve(new Response("logo")),
    );
    expect(await logo.text()).toBe("logo");
    expect(
      (await gateWithPublicLogo.handle(new Request(`${BASE_URL}/brand/private.svg`), blocked))
        .status,
    ).toBe(401);
  });

  it("can secure immutable continuation responses without corrupting Vary star", async () => {
    const gate = makeGate({ excludedPaths: ["/public"] });
    const upstream = await fetch("data:text/plain,public", { headers: { Accept: "text/plain" } });
    const withVary = new Response(upstream.body, { headers: { Vary: "*" } });
    const response = await gate.handle(new Request(`${BASE_URL}/public`), () => withVary);
    expect(await response.text()).toBe("public");
    expect(response.headers.get("vary")).toBe("*");
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
});

describe("login and logout security", () => {
  it("requires same-origin requests and a signed form-bound CSRF value", async () => {
    const gate = makeGate();
    const page = await loginForm(gate);
    const body = new URLSearchParams({ csrf: page.token, password: TEST_PASSWORD });
    const crossSite = await gate.handle(
      new Request(`${BASE_URL}${gate.loginPath}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Cookie: page.cookie,
          Origin: "https://evil.test",
          "Sec-Fetch-Site": "cross-site",
        },
        body,
      }),
      blocked,
    );
    expect(crossSite.status).toBe(403);

    const forged = await submitLogin(gate, TEST_PASSWORD, "/", {
      ...page,
      token: `${page.token}x`,
    });
    expect(forged.status).toBe(403);
  });

  it("rate limits repeated failures before rechecking the password", async () => {
    const gate = makeGate({
      rateLimit: { maxAttempts: 2, globalMaxAttempts: 2, windowSeconds: 60 },
    });
    expect((await submitLogin(gate, "wrong password 1")).status).toBe(401);
    expect((await submitLogin(gate, "wrong password 2")).status).toBe(401);
    const limited = await submitLogin(gate, TEST_PASSWORD);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBeTruthy();
  });

  it("does not count successful logins against the global failure budget", async () => {
    const gate = makeGate({
      rateLimit: { maxAttempts: 2, globalMaxAttempts: 2, windowSeconds: 60 },
    });
    expect((await submitLogin(gate, TEST_PASSWORD)).status).toBe(303);
    expect((await submitLogin(gate, TEST_PASSWORD)).status).toBe(303);
    expect((await submitLogin(gate, TEST_PASSWORD)).status).toBe(303);
  });

  it("does not admit concurrent attempts beyond the configured limit", async () => {
    const gate = makeGate({
      rateLimit: { maxAttempts: 2, globalMaxAttempts: 20, windowSeconds: 60 },
    });
    const responses = await Promise.all(
      Array.from({ length: 10 }, (_, index) => submitLogin(gate, `wrong password ${index}`)),
    );
    expect(responses.filter((response) => response.status === 401)).toHaveLength(2);
    expect(responses.filter((response) => response.status === 429)).toHaveLength(8);
  });

  it("invalidates the browser cookie on same-origin POST logout", async () => {
    const gate = makeGate();
    const response = await gate.handle(
      new Request(`${BASE_URL}${gate.logoutPath}`, {
        method: "POST",
        headers: { Origin: BASE_URL, "Sec-Fetch-Site": "same-origin" },
      }),
      blocked,
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("set-cookie")).toContain(
      "sitegate_session=; Path=/; HttpOnly; Secure",
    );
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("rejects non-form and oversized login bodies", async () => {
    const gate = makeGate();
    const headers = { Origin: BASE_URL, "Sec-Fetch-Site": "same-origin" };
    const json = await gate.handle(
      new Request(`${BASE_URL}${gate.loginPath}`, { method: "POST", headers, body: "{}" }),
      blocked,
    );
    expect(json.status).toBe(400);
    const oversized = await gate.handle(
      new Request(`${BASE_URL}${gate.loginPath}`, {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": "5000",
        },
        body: "password=x",
      }),
      blocked,
    );
    expect(oversized.status).toBe(413);

    let cancelled = false;
    const streamedBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(4096));
        controller.enqueue(new Uint8Array([1]));
      },
      cancel() {
        cancelled = true;
      },
    });
    const streamed = await gate.handle(
      new Request(`${BASE_URL}${gate.loginPath}`, {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: streamedBody,
        duplex: "half",
      } as RequestInit & { duplex: "half" }),
      blocked,
    );
    expect(streamed.status).toBe(413);
    expect(cancelled).toBe(true);
  });

  it("never redirects to an external origin after login", async () => {
    const gate = makeGate();
    const response = await submitLogin(gate, TEST_PASSWORD, "//evil.test/path");
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/");
  });
});

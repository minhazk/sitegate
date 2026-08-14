import { NextRequest } from "next/server.js";
import { describe, expect, it, vi } from "vitest";
import { createSitegateNext, sitegate } from "../src/next.js";
import { cookieValue, TEST_PASSWORD, TEST_SECRET } from "./helpers.js";

const NEXT_ORIGIN = "https://preview.example.test";

describe("Next.js adapter", () => {
  it("composes with NextResponse.next when disabled", async () => {
    const proxy = sitegate({ enabled: false });
    const result = await proxy(new NextRequest("https://preview.example.test/dashboard"));
    expect(result).toBeInstanceOf(Response);
    expect(result?.headers.get("x-middleware-next")).toBe("1");
  });

  it("emits an absolute unauthenticated redirect for OpenNext-compatible hosts", async () => {
    const proxy = sitegate({
      password: TEST_PASSWORD,
      secret: TEST_SECRET,
      rateLimit: false,
    });
    const result = await proxy(
      new NextRequest(`${NEXT_ORIGIN}/dashboard?tab=activity`, {
        headers: { Accept: "text/html" },
      }),
    );
    const expectedLogin = new URL("/_sitegate/login", NEXT_ORIGIN);
    expectedLogin.searchParams.set("next", "/dashboard?tab=activity");

    expect(result.headers.get("location")).toBe(expectedLogin.toString());
  });

  it("emits absolute successful-login and logout redirects", async () => {
    const proxy = sitegate({ password: TEST_PASSWORD, secret: TEST_SECRET, rateLimit: false });
    const loginPage = await proxy(
      new NextRequest(`${NEXT_ORIGIN}/_sitegate/login?next=${encodeURIComponent("/dashboard")}`, {
        headers: { Accept: "text/html" },
      }),
    );
    const html = await loginPage.clone().text();
    const csrfToken = /name="csrf" value="([^"]+)"/u.exec(html)?.[1];
    if (csrfToken === undefined) throw new Error("Missing CSRF token");
    const csrfCookie = cookieValue(loginPage, "__Host-sitegate_csrf");

    const login = await proxy(
      new NextRequest(`${NEXT_ORIGIN}/_sitegate/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Cookie: `__Host-sitegate_csrf=${encodeURIComponent(csrfCookie)}`,
          Origin: NEXT_ORIGIN,
          "Sec-Fetch-Site": "same-origin",
        },
        body: new URLSearchParams({ csrf: csrfToken, next: "/dashboard", password: TEST_PASSWORD }),
      }),
    );
    expect(login.headers.get("location")).toBe(`${NEXT_ORIGIN}/dashboard`);

    const logout = await proxy(
      new NextRequest(`${NEXT_ORIGIN}/_sitegate/logout`, {
        method: "POST",
        headers: {
          Origin: NEXT_ORIGIN,
          "Sec-Fetch-Site": "same-origin",
        },
      }),
    );
    expect(logout.headers.get("location")).toBe(`${NEXT_ORIGIN}/_sitegate/login`);
  });

  it("preserves API denial without turning it into an HTML redirect", async () => {
    const proxy = sitegate({ password: TEST_PASSWORD, secret: TEST_SECRET, rateLimit: false });
    const response = await proxy(
      new NextRequest(`${NEXT_ORIGIN}/api/private`, {
        headers: { Accept: "application/json" },
      }),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("location")).toBeNull();
    expect(await response.json()).toEqual({ error: "Authentication required." });
  });

  it("continues into an existing Proxy or Middleware handler", async () => {
    const next = vi.fn((request: NextRequest) =>
      Promise.resolve(
        new Response(null, {
          status: 204,
          headers: { "X-Existing-Proxy-Path": request.nextUrl.pathname },
        }),
      ),
    );
    const proxy = createSitegateNext({ enabled: false }, { next });
    const request = new NextRequest("https://preview.example.test/dashboard");

    const response = await proxy(request);

    expect(next).toHaveBeenCalledWith(request);
    expect(response.status).toBe(204);
    expect(response.headers.get("x-existing-proxy-path")).toBe("/dashboard");
  });

  it("treats an empty existing handler result as NextResponse.next", async () => {
    const proxy = createSitegateNext({ enabled: false }, { next: () => undefined });

    const response = await proxy(new NextRequest("https://preview.example.test/dashboard"));

    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("normalizes safe relative continuation redirects without rejecting malformed host output", async () => {
    const relativeProxy = createSitegateNext(
      { enabled: false },
      {
        next: () => new Response(null, { status: 307, headers: { Location: "/refreshed" } }),
      },
    );
    expect(
      (await relativeProxy(new NextRequest("https://preview.example.test/dashboard"))).headers.get(
        "location",
      ),
    ).toBe("https://preview.example.test/refreshed");

    const malformedProxy = createSitegateNext(
      { enabled: false },
      {
        next: () => new Response(null, { status: 307, headers: { Location: "http://[" } }),
      },
    );
    expect(
      (await malformedProxy(new NextRequest("https://preview.example.test/dashboard"))).headers.get(
        "location",
      ),
    ).toBe("http://[");
  });
});

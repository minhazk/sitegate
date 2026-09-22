import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { sitegate } from "../src/hono.js";
import { TEST_PASSWORD, TEST_SECRET } from "./helpers.js";

const ORIGIN = "https://preview.example.test";

function cookies(response: Response): string[] {
  return response.headers.getSetCookie();
}

function cookieValue(values: readonly string[], name: string): string {
  for (const cookie of values) {
    const match = new RegExp(`^${name}=([^;]*)`, "u").exec(cookie);
    if (match?.[1] !== undefined) return decodeURIComponent(match[1]);
  }
  throw new Error(`Missing ${name} cookie.`);
}

function protectedApp(): Hono {
  const app = new Hono();
  app.use("*", sitegate({ password: TEST_PASSWORD, secret: TEST_SECRET, rateLimit: false }));
  app.get("/private", (context) => {
    context.header("Cache-Control", "public, max-age=3600");
    context.header("Referrer-Policy", "unsafe-url");
    context.header("Vary", "Accept-Encoding");
    context.header("Set-Cookie", "downstream_one=1; Path=/", { append: true });
    context.header("Set-Cookie", "downstream_two=2; Path=/", { append: true });
    return context.body("hono application", 201, { "X-Hono-Route": "private" });
  });
  app.get("/api/private", (context) => context.json({ private: true }));
  app.get("/error", () => {
    throw new Error("downstream failed");
  });
  app.onError(
    (error) =>
      new Response(error.message, {
        status: 555,
        headers: { "Cache-Control": "public, max-age=3600" },
      }),
  );
  return app;
}

async function login(app: Hono, destination = "/private"): Promise<Response> {
  const page = await app.request(
    `${ORIGIN}/_sitegate/login?next=${encodeURIComponent(destination)}`,
  );
  const token = /name="csrf" value="([^"]+)"/u.exec(await page.text())?.[1];
  if (token === undefined) throw new Error("Missing CSRF token.");
  const csrf = cookieValue(cookies(page), "__Host-sitegate_csrf");
  return app.request(`${ORIGIN}/_sitegate/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: `__Host-sitegate_csrf=${encodeURIComponent(csrf)}`,
      Origin: ORIGIN,
      "Sec-Fetch-Site": "same-origin",
    },
    body: new URLSearchParams({ csrf: token, next: destination, password: TEST_PASSWORD }),
  });
}

describe("Hono adapter", () => {
  it("redirects HTML requests and denies APIs before Hono handlers", async () => {
    const app = protectedApp();
    const page = await app.request(`${ORIGIN}/private?tab=one`, {
      headers: { Accept: "text/html" },
    });
    expect(page.status).toBe(307);
    expect(page.headers.get("location")).toBe(
      `/_sitegate/login?${new URLSearchParams({ next: "/private?tab=one" })}`,
    );

    const api = await app.request(`${ORIGIN}/api/private`, {
      headers: { Accept: "application/json" },
    });
    expect(api.status).toBe(401);
    expect(await api.json()).toEqual({ error: "Authentication required." });
  });

  it("completes login and preserves separate session and CSRF-expiry cookies", async () => {
    const response = await login(protectedApp());
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/private");
    expect(cookies(response)).toHaveLength(2);
    expect(cookieValue(cookies(response), "__Host-sitegate_session")).toBeTruthy();
    expect(cookies(response).join("\n")).toContain("__Host-sitegate_csrf=;");
  });

  it("replaces Hono's response while preserving downstream output and cookies", async () => {
    const app = protectedApp();
    const session = cookieValue(cookies(await login(app)), "__Host-sitegate_session");
    const response = await app.request(`${ORIGIN}/private`, {
      headers: { Cookie: `__Host-sitegate_session=${encodeURIComponent(session)}` },
    });
    expect(response.status).toBe(201);
    expect(await response.text()).toBe("hono application");
    expect(response.headers.get("x-hono-route")).toBe("private");
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("vary")).toContain("Accept-Encoding");
    expect(response.headers.get("vary")).toContain("Cookie");
    expect(cookies(response)).toEqual(["downstream_one=1; Path=/", "downstream_two=2; Path=/"]);
  });

  it("secures Hono error-handler responses", async () => {
    const app = protectedApp();
    const session = cookieValue(cookies(await login(app, "/error")), "__Host-sitegate_session");
    const response = await app.request(`${ORIGIN}/error`, {
      headers: { Cookie: `__Host-sitegate_session=${encodeURIComponent(session)}` },
    });
    expect(response.status).toBe(555);
    expect(await response.text()).toBe("downstream failed");
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(response.headers.get("x-robots-tag")).toContain("noindex");
  });

  it("preserves a downstream streaming body", async () => {
    const app = new Hono();
    app.use(
      "*",
      sitegate({
        password: TEST_PASSWORD,
        secret: TEST_SECRET,
        rateLimit: false,
        excludedPaths: ["/stream"],
      }),
    );
    app.get("/stream", () => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("streamed "));
          controller.enqueue(new TextEncoder().encode("application"));
          controller.close();
        },
      });
      return new Response(stream, { headers: { "X-Stream": "1" } });
    });
    const response = await app.request(`${ORIGIN}/stream`);
    expect(await response.text()).toBe("streamed application");
    expect(response.headers.get("x-stream")).toBe("1");
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("does not consume downstream POST bodies while disabled", async () => {
    const app = new Hono();
    app.use("*", sitegate({ password: "", secret: "", enabled: false, rateLimit: false }));
    app.post("/_sitegate/login", async (context) => context.text(await context.req.text()));
    const response = await app.request(`${ORIGIN}/_sitegate/login`, {
      method: "POST",
      body: "downstream body",
    });
    expect(await response.text()).toBe("downstream body");
  });

  it("intercepts login before later body-consuming middleware", async () => {
    const app = new Hono();
    let reads = 0;
    app.use("*", sitegate({ password: TEST_PASSWORD, secret: TEST_SECRET, rateLimit: false }));
    app.use("*", async (context, next) => {
      reads += 1;
      await context.req.text();
      await next();
    });
    app.post("/_sitegate/login", (context) => context.text("downstream"));
    const response = await app.request(`${ORIGIN}/_sitegate/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: ORIGIN,
        "Sec-Fetch-Site": "same-origin",
      },
      body: "password=wrong",
    });
    expect(response.status).toBe(403);
    expect(reads).toBe(0);
  });

  it("does not let encoded path aliases match a public exclusion", async () => {
    const app = new Hono();
    let routes = 0;
    app.use(
      "*",
      sitegate({
        password: TEST_PASSWORD,
        secret: TEST_SECRET,
        rateLimit: false,
        excludedPaths: ["/public"],
      }),
    );
    app.all("*", (context) => {
      routes += 1;
      return context.text("downstream");
    });
    const response = await app.request(`${ORIGIN}/public%2F..%2Fprivate`);
    expect(response.status).toBe(401);
    expect(routes).toBe(0);
  });

  it("rejects an oversized login form before later Hono middleware", async () => {
    const app = protectedApp();
    const page = await app.request(`${ORIGIN}/_sitegate/login`);
    const token = /name="csrf" value="([^"]+)"/u.exec(await page.text())?.[1];
    if (token === undefined) throw new Error("Missing CSRF token.");
    const csrf = cookieValue(cookies(page), "__Host-sitegate_csrf");
    const response = await app.request(`${ORIGIN}/_sitegate/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: `__Host-sitegate_csrf=${encodeURIComponent(csrf)}`,
        Origin: ORIGIN,
        "Sec-Fetch-Site": "same-origin",
      },
      body: new URLSearchParams({ csrf: token, password: "x".repeat(16385) }),
    });
    expect(response.status).toBe(413);
  });

  it("wins over later middleware that weakens downstream security headers", async () => {
    const app = new Hono();
    app.use(
      "*",
      sitegate({
        password: TEST_PASSWORD,
        secret: TEST_SECRET,
        rateLimit: false,
        excludedPaths: ["/public"],
      }),
    );
    app.use("*", async (context, next) => {
      await next();
      context.header("Cache-Control", "public, max-age=3600");
      context.header("Referrer-Policy", "unsafe-url");
      context.header("X-Robots-Tag", "index");
    });
    app.get("/public", (context) => context.text("public route"));
    const response = await app.request(`${ORIGIN}/public`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-robots-tag")).toContain("noindex");
  });
});

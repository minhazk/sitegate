import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sitegate } from "../src/fastify.js";
import { TEST_PASSWORD, TEST_SECRET } from "./helpers.js";

function setCookies(response: {
  headers: Record<string, number | string | string[] | undefined>;
}): string[] {
  const value = response.headers["set-cookie"];
  if (value === undefined) return [];
  if (typeof value === "number") return [String(value)];
  return Array.isArray(value) ? value : [value];
}

function cookieValue(cookies: readonly string[], name: string): string {
  for (const cookie of cookies) {
    const match = new RegExp(`^${name}=([^;]*)`, "u").exec(cookie);
    if (match?.[1] !== undefined) return decodeURIComponent(match[1]);
  }
  throw new Error(`Missing ${name} cookie.`);
}

describe("Fastify adapter", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    app.setErrorHandler((error, _request, reply) =>
      reply.code(555).send(error instanceof Error ? error.message : "unknown error"),
    );
    await app.register(sitegate, {
      password: TEST_PASSWORD,
      secret: TEST_SECRET,
      rateLimit: false,
    });
    app.addHook("onSend", (request, reply, payload, done) => {
      if (request.url === "/api/terminal-late") {
        reply.header("Cache-Control", "public, max-age=3600");
        reply.removeHeader("Referrer-Policy");
        reply.header("X-Robots-Tag", "index, follow");
      }
      done(null, payload);
    });
    app.get("/private", (_request, reply) => {
      reply.header("Cache-Control", "public, max-age=3600");
      reply.removeHeader("X-Robots-Tag");
      reply.header("Vary", "Accept-Encoding");
      reply.header("X-Fastify-Route", "private");
      return reply.code(201).send("fastify application");
    });
    app.get("/api/private", () => ({ private: true }));
    app.get("/api/terminal-late", () => ({ private: true }));
    app.get("/error", () => {
      throw new Error("downstream failed");
    });
    app.get(
      "/late-hook",
      {
        onSend(_request, reply, payload, done) {
          reply.header("Cache-Control", "public, max-age=3600");
          reply.header("X-Robots-Tag", "index, follow");
          reply.header("Vary", "Origin");
          done(null, payload);
        },
      },
      () => "late hook application",
    );
    await app.register(async (nested) => {
      nested.get("/nested", () => "nested application");
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  async function login(destination = "/private") {
    const page = await app.inject({
      method: "GET",
      url: `/_sitegate/login?next=${encodeURIComponent(destination)}`,
    });
    const token = /name="csrf" value="([^"]+)"/u.exec(page.body)?.[1];
    if (token === undefined) throw new Error("Missing CSRF token.");
    const csrf = cookieValue(setCookies(page), "sitegate_csrf");
    return app.inject({
      method: "POST",
      url: "/_sitegate/login",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        cookie: `sitegate_csrf=${encodeURIComponent(csrf)}`,
        origin: "http://localhost",
        "sec-fetch-site": "same-origin",
      },
      payload: new URLSearchParams({
        csrf: token,
        next: destination,
        password: TEST_PASSWORD,
      }).toString(),
    });
  }

  it("redirects HTML and denies APIs before Fastify handlers", async () => {
    const page = await app.inject({
      method: "GET",
      url: "/private?tab=one",
      headers: { accept: "text/html" },
    });
    expect(page.statusCode).toBe(307);
    expect(page.headers.location).toBe(
      `/_sitegate/login?${new URLSearchParams({ next: "/private?tab=one" })}`,
    );

    const api = await app.inject({
      method: "GET",
      url: "/api/private",
      headers: { accept: "application/json" },
    });
    expect(api.statusCode).toBe(401);
    expect(api.json()).toEqual({ error: "Authentication required." });
  });

  it("completes login and preserves multiple Set-Cookie headers", async () => {
    const response = await login();
    expect(response.statusCode, response.body).toBe(303);
    expect(response.headers.location).toBe("/private");
    const cookies = setCookies(response);
    expect(cookies).toHaveLength(2);
    expect(cookieValue(cookies, "sitegate_session")).toBeTruthy();
    expect(cookies.join("\n")).toContain("sitegate_csrf=;");
  });

  it("applies root-scoped protection to nested plugins", async () => {
    const denied = await app.inject({ method: "GET", url: "/nested" });
    expect(denied.statusCode).toBe(401);
    const session = cookieValue(setCookies(await login("/nested")), "sitegate_session");
    const allowed = await app.inject({
      method: "GET",
      url: "/nested",
      headers: { cookie: `sitegate_session=${encodeURIComponent(session)}` },
    });
    expect(allowed.body).toBe("nested application");
  });

  it("locks protected downstream response headers", async () => {
    const session = cookieValue(setCookies(await login()), "sitegate_session");
    const response = await app.inject({
      method: "GET",
      url: "/private",
      headers: { cookie: `sitegate_session=${encodeURIComponent(session)}` },
    });
    expect(response.statusCode).toBe(201);
    expect(response.body).toBe("fastify application");
    expect(response.headers["x-fastify-route"]).toBe("private");
    expect(response.headers["cache-control"]).toBe("private, no-store, max-age=0");
    expect(response.headers["x-robots-tag"]).toContain("noindex");
    expect(response.headers.vary).toContain("Accept-Encoding");
    expect(response.headers.vary).toContain("Cookie");
  });

  it("keeps locked headers on Fastify error responses", async () => {
    const session = cookieValue(setCookies(await login()), "sitegate_session");
    const response = await app.inject({
      method: "GET",
      url: "/error",
      headers: { cookie: `sitegate_session=${encodeURIComponent(session)}` },
    });
    expect(response.statusCode).toBe(555);
    expect(response.body).toBe("downstream failed");
    expect(response.headers["cache-control"]).toBe("private, no-store, max-age=0");
  });

  it("keeps header locks after route-level onSend hooks", async () => {
    const session = cookieValue(setCookies(await login()), "sitegate_session");
    const response = await app.inject({
      method: "GET",
      url: "/late-hook",
      headers: { cookie: `sitegate_session=${encodeURIComponent(session)}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe("late hook application");
    expect(response.headers["cache-control"]).toBe("private, no-store, max-age=0");
    expect(response.headers["x-robots-tag"]).toContain("noindex");
    expect(response.headers.vary).toContain("Origin");
    expect(response.headers.vary).toContain("Cookie");
  });

  it("locks terminal denial headers after later shared onSend hooks", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/terminal-late",
      headers: { accept: "application/json" },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "Authentication required." });
    expect(response.headers["cache-control"]).toBe("private, no-store, max-age=0");
    expect(response.headers["referrer-policy"]).toBe("no-referrer");
    expect(response.headers["x-robots-tag"]).toContain("noindex");
  });

  it("rejects oversized login bodies in onRequest before Fastify parsing", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/_sitegate/login",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        origin: "http://localhost",
        "sec-fetch-site": "same-origin",
      },
      payload: "x".repeat(4097),
    });
    expect(response.statusCode, response.body).toBe(413);
  });

  it("fails closed when an origin override is not an origin", async () => {
    const invalid = Fastify();
    await invalid.register(sitegate, {
      password: TEST_PASSWORD,
      secret: TEST_SECRET,
      rateLimit: false,
      origin: "https://preview.example.test/path",
    });
    try {
      const response = await invalid.inject({ method: "GET", url: "/private" });
      expect(response.statusCode, response.body).toBe(400);
      expect(response.json()).toEqual({ error: "Invalid request URL." });
    } finally {
      await invalid.close();
    }
  });

  it("leaves POST bodies untouched when disabled", async () => {
    const disabled = Fastify();
    await disabled.register(sitegate, { enabled: false });
    disabled.post("/_sitegate/login", (request) => request.body);
    try {
      const response = await disabled.inject({
        method: "POST",
        url: "/_sitegate/login",
        headers: { "content-type": "text/plain" },
        payload: "downstream body",
      });
      expect(response.body).toBe("downstream body");
    } finally {
      await disabled.close();
    }
  });
});

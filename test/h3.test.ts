import { createServer, request as nodeRequest, type Server } from "node:http";
import {
  connect as connectHttp2,
  createServer as createHttp2Server,
  type Http2ServerRequest,
  type Http2ServerResponse,
} from "node:http2";
import type { AddressInfo } from "node:net";
import { createApp, eventHandler, readRawBody, toNodeListener, toWebHandler, type App } from "h3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sitegate } from "../src/h3.js";
import { TEST_PASSWORD, TEST_SECRET } from "./helpers.js";

const ORIGIN = "https://preview.example.test";
const openServers = new Set<Server>();

function cookieValue(response: Response, name: string): string {
  for (const cookie of response.headers.getSetCookie()) {
    const match = new RegExp(`^${name}=([^;]*)`, "u").exec(cookie);
    if (match?.[1] !== undefined) return decodeURIComponent(match[1]);
  }
  throw new Error(`Missing ${name} cookie.`);
}

function protectedApp(): App {
  const app = createApp();
  sitegate(app, { password: TEST_PASSWORD, secret: TEST_SECRET, rateLimit: false });
  app.use(
    "/private",
    eventHandler((event) => {
      event.node.res.statusCode = 201;
      event.node.res.setHeader("Cache-Control", "public, max-age=3600");
      event.node.res.setHeader("Referrer-Policy", "unsafe-url");
      event.node.res.setHeader("Vary", "Accept-Encoding");
      event.node.res.appendHeader("Set-Cookie", "downstream_one=1; Path=/");
      event.node.res.appendHeader("Set-Cookie", "downstream_two=2; Path=/");
      return "h3 application";
    }),
  );
  app.use(
    "/api/private",
    eventHandler(() => ({ private: true })),
  );
  return app;
}

async function login(
  fetchApp: (request: Request) => Promise<Response>,
  destination = "/private",
): Promise<Response> {
  const page = await fetchApp(
    new Request(`${ORIGIN}/_sitegate/login?${new URLSearchParams({ next: destination })}`),
  );
  const token = /name="csrf" value="([^"]+)"/u.exec(await page.clone().text())?.[1];
  if (token === undefined) throw new Error("Missing CSRF token.");
  const csrf = cookieValue(page, "__Host-sitegate_csrf");
  return fetchApp(
    new Request(`${ORIGIN}/_sitegate/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: `__Host-sitegate_csrf=${encodeURIComponent(csrf)}`,
        Origin: ORIGIN,
        "Sec-Fetch-Site": "same-origin",
      },
      body: new URLSearchParams({ csrf: token, next: destination, password: TEST_PASSWORD }),
    }),
  );
}

async function listen(app: App): Promise<{ baseUrl: string; port: number }> {
  const server = createServer(toNodeListener(app));
  openServers.add(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${address.port}`, port: address.port };
}

afterEach(async () => {
  await Promise.all(
    Array.from(
      openServers,
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error === undefined ? resolve() : reject(error)));
        }),
    ),
  );
  openServers.clear();
});

describe("H3 adapter", () => {
  it("redirects HTML requests and denies APIs before H3 handlers", async () => {
    const app = toWebHandler(protectedApp());
    const page = await app(
      new Request(`${ORIGIN}/private?tab=one`, { headers: { Accept: "text/html" } }),
    );
    expect(page.status).toBe(307);
    expect(page.headers.get("location")).toBe(
      `/_sitegate/login?${new URLSearchParams({ next: "/private?tab=one" })}`,
    );
    const api = await app(
      new Request(`${ORIGIN}/api/private`, { headers: { Accept: "application/json" } }),
    );
    expect(api.status).toBe(401);
    expect(await api.json()).toEqual({ error: "Authentication required." });
  });

  it("runs before H3 onRequest hooks and locks the outer handler", async () => {
    let hookCalls = 0;
    const app = createApp({
      async onRequest(event) {
        hookCalls += 1;
        await event.respondWith(new Response("hook response"));
      },
    });
    sitegate(app, {
      password: TEST_PASSWORD,
      secret: TEST_SECRET,
      rateLimit: false,
      excludedPaths: ["/public"],
    });
    const handler = toWebHandler(app);
    const denied = await handler(
      new Request(`${ORIGIN}/private`, { headers: { Accept: "application/json" } }),
    );
    expect(denied.status).toBe(401);
    expect(hookCalls).toBe(0);
    const allowed = await handler(new Request(`${ORIGIN}/public`));
    expect(await allowed.text()).toBe("hook response");
    expect(hookCalls).toBe(1);
    expect(Object.getOwnPropertyDescriptor(app, "handler")).toMatchObject({
      configurable: false,
      writable: false,
    });
    expect(() => Object.defineProperty(app, "handler", { value: async () => undefined })).toThrow();
  });

  it("rejects duplicate installation on one H3 application", () => {
    const app = createApp();
    const config = { password: TEST_PASSWORD, secret: TEST_SECRET, rateLimit: false as const };
    sitegate(app, config);
    expect(() => sitegate(app, config)).toThrow("already installed");
  });

  it("completes login and locks final H3 response headers without merging cookies", async () => {
    const app = toWebHandler(protectedApp());
    const loginResponse = await login(app);
    expect(loginResponse.status).toBe(303);
    expect(loginResponse.headers.getSetCookie()).toHaveLength(2);
    const session = cookieValue(loginResponse, "__Host-sitegate_session");
    const response = await app(
      new Request(`${ORIGIN}/private`, {
        headers: { Cookie: `__Host-sitegate_session=${encodeURIComponent(session)}` },
      }),
    );
    expect(response.status).toBe(201);
    expect(await response.text()).toBe("h3 application");
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("vary")).toContain("Accept-Encoding");
    expect(response.headers.get("vary")).toContain("Cookie");
    expect(response.headers.getSetCookie()).toEqual([
      "downstream_one=1; Path=/",
      "downstream_two=2; Path=/",
    ]);
  });

  it("keeps security headers on an H3 error response", async () => {
    const app = createApp();
    sitegate(app, {
      password: TEST_PASSWORD,
      secret: TEST_SECRET,
      rateLimit: false,
      excludedPaths: ["/error"],
    });
    app.use(
      "/error",
      eventHandler(() => {
        throw new Error("downstream failed");
      }),
    );
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await toWebHandler(app)(new Request(`${ORIGIN}/error`));
    log.mockRestore();
    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(response.headers.get("x-robots-tag")).toContain("noindex");
  });

  it("preserves a downstream H3 streaming response", async () => {
    const app = createApp();
    sitegate(app, {
      password: TEST_PASSWORD,
      secret: TEST_SECRET,
      rateLimit: false,
      excludedPaths: ["/stream"],
    });
    app.use(
      "/stream",
      eventHandler(
        () =>
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(new TextEncoder().encode("h3 stream"));
                controller.close();
              },
            }),
            { headers: { "X-Stream": "1" } },
          ),
      ),
    );
    const response = await toWebHandler(app)(new Request(`${ORIGIN}/stream`));
    expect(await response.text()).toBe("h3 stream");
    expect(response.headers.get("x-stream")).toBe("1");
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("leaves a disabled login-path POST body untouched", async () => {
    const app = createApp();
    sitegate(app, { password: "", secret: "", enabled: false, rateLimit: false });
    app.use(
      "/_sitegate/login",
      eventHandler(async (event) => readRawBody(event)),
    );
    const response = await toWebHandler(app)(
      new Request(`${ORIGIN}/_sitegate/login`, { method: "POST", body: "downstream body" }),
    );
    expect(await response.text()).toBe("downstream body");
  });

  it("does not let later caller mutation disable an initialized H3 gate", async () => {
    const config = {
      password: TEST_PASSWORD,
      secret: TEST_SECRET,
      rateLimit: false as const,
      enabled: true,
    };
    const app = createApp();
    sitegate(app, config);
    config.enabled = false;
    app.use(eventHandler(() => "downstream"));
    const response = await toWebHandler(app)(
      new Request(`${ORIGIN}/private`, { headers: { Accept: "application/json" } }),
    );
    expect(response.status).toBe(401);
  });

  it("does not let an encoded alias match a public H3 exclusion", async () => {
    const app = createApp();
    let downstream = 0;
    sitegate(app, {
      password: TEST_PASSWORD,
      secret: TEST_SECRET,
      rateLimit: false,
      excludedPaths: ["/public"],
    });
    app.use(
      eventHandler(() => {
        downstream += 1;
        return "public";
      }),
    );
    const response = await toWebHandler(app)(
      new Request(`${ORIGIN}/public%2F..%2Fprivate`, {
        headers: { Accept: "application/json" },
      }),
    );
    expect(response.status).toBe(401);
    expect(downstream).toBe(0);
  });

  it("preserves a non-login Node request stream and bounds login bodies", async () => {
    const app = createApp();
    let loginRouteCalls = 0;
    sitegate(app, {
      password: TEST_PASSWORD,
      secret: TEST_SECRET,
      rateLimit: false,
      excludedPaths: ["/echo"],
    });
    app.use(
      "/echo",
      eventHandler(async (event) => readRawBody(event)),
    );
    app.use(
      "/_sitegate/login",
      eventHandler(() => {
        loginRouteCalls += 1;
        return "downstream login";
      }),
    );
    const { baseUrl } = await listen(app);
    const echo = await fetch(`${baseUrl}/echo`, { method: "POST", body: "node body" });
    expect(await echo.text()).toBe("node body");
    const oversized = await fetch(`${baseUrl}/_sitegate/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: baseUrl,
        "Sec-Fetch-Site": "same-origin",
      },
      body: "x".repeat(4097),
    });
    expect(oversized.status).toBe(413);
    expect(loginRouteCalls).toBe(0);
  });

  it("rejects an absolute-form Node target before H3 routes", async () => {
    const app = createApp();
    let downstream = 0;
    sitegate(app, { password: TEST_PASSWORD, secret: TEST_SECRET, rateLimit: false });
    app.use(
      eventHandler(() => {
        downstream += 1;
        return "downstream";
      }),
    );
    const { port } = await listen(app);
    const status = await new Promise<number>((resolve, reject) => {
      const request = nodeRequest(
        {
          host: "127.0.0.1",
          port,
          path: "http://evil.test/private",
          headers: { Host: `127.0.0.1:${port}` },
        },
        (response) => {
          response.resume();
          resolve(response.statusCode ?? 0);
        },
      );
      request.once("error", reject);
      request.end();
    });
    expect(status).toBe(400);
    expect(downstream).toBe(0);
  });

  it("denies a real HTTP/2 request reconstructed from its authority pseudoheader", async () => {
    const app = createApp();
    sitegate(app, { password: TEST_PASSWORD, secret: TEST_SECRET, rateLimit: false });
    app.use(eventHandler(() => "downstream"));
    const listener = toNodeListener(app) as unknown as (
      request: Http2ServerRequest,
      response: Http2ServerResponse,
    ) => void;
    const server = createHttp2Server(listener);
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address() as AddressInfo;
    const client = connectHttp2(`http://127.0.0.1:${address.port}`);
    try {
      const outcome = await new Promise<{ body: string; status: number }>((resolve, reject) => {
        const request = client.request({
          ":method": "GET",
          ":path": "/private",
          accept: "application/json",
        });
        let body = "";
        let status = 0;
        request.setEncoding("utf8");
        request.on("response", (headers) => {
          status = Number(headers[":status"] ?? 0);
        });
        request.on("data", (chunk: string) => {
          body += chunk;
        });
        request.once("error", reject);
        request.once("end", () => resolve({ body, status }));
        request.end();
      });
      expect(outcome.status).toBe(401);
      expect(JSON.parse(outcome.body)).toEqual({ error: "Authentication required." });
    } finally {
      client.close();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error === undefined ? resolve() : reject(error)));
      });
    }
  });
});

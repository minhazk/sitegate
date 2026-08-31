import { request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import express, { type Express } from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sitegate } from "../src/express.js";
import { TEST_PASSWORD, TEST_SECRET } from "./helpers.js";

function cookieValue(response: Response, name: string): string {
  for (const cookie of response.headers.getSetCookie()) {
    const match = new RegExp(`^${name}=([^;]*)`, "u").exec(cookie);
    if (match?.[1] !== undefined) return decodeURIComponent(match[1]);
  }
  throw new Error(`Missing ${name} cookie.`);
}

function listen(
  app: Express,
): Promise<{ baseUrl: string; close: () => Promise<void>; port: number }> {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      resolve({
        baseUrl: `http://127.0.0.1:${address.port}`,
        port: address.port,
        close: () =>
          new Promise<void>((done, reject) =>
            server.close((error) => (error ? reject(error) : done())),
          ),
      });
    });
  });
}

describe("Express adapter", () => {
  let baseUrl: string;
  let close: () => Promise<void>;
  let port: number;

  beforeAll(async () => {
    const app = express();
    app.use(sitegate({ password: TEST_PASSWORD, secret: TEST_SECRET, rateLimit: false }));
    app.use((request, response) => {
      if (request.path === "/error") throw new Error("downstream failed");
      if (request.path === "/write-head") {
        response.writeHead(202, {
          "Cache-Control": "public, max-age=3600",
          Vary: "Origin",
          "X-Robots-Tag": "index, follow",
        });
        response.end("writeHead application");
        return;
      }
      if (request.path === "/write-head-array") {
        response.writeHead(203, "Non-Authoritative Information", [
          "Cache-Control",
          "public, max-age=3600",
          "Vary",
          "Origin",
          "X-Robots-Tag",
          "index, follow",
        ]);
        response.end("raw header array application");
        return;
      }
      if (request.path === "/append-header") {
        response.appendHeader("Cache-Control", "public, max-age=3600");
        response.appendHeader("Referrer-Policy", "unsafe-url");
        response.appendHeader("Vary", "Origin");
        response.end("appendHeader application");
        return;
      }
      response.status(201);
      response.setHeader("Cache-Control", "public, max-age=3600");
      response.removeHeader("X-Robots-Tag");
      response.setHeader("Vary", "Accept-Encoding");
      response.setHeader("X-Express-Path", request.originalUrl);
      response.send("express application");
    });
    app.use(((error, _request, response, _next) => {
      response.status(555).send(error instanceof Error ? error.message : "unknown error");
    }) satisfies express.ErrorRequestHandler);
    ({ baseUrl, close, port } = await listen(app));
  });

  afterAll(async () => {
    await close();
  });

  async function login(destination = "/private"): Promise<Response> {
    const page = await fetch(`${baseUrl}/_sitegate/login?next=${encodeURIComponent(destination)}`, {
      redirect: "manual",
    });
    const token = /name="csrf" value="([^"]+)"/u.exec(await page.text())?.[1];
    if (token === undefined) throw new Error("Missing CSRF token.");
    const csrf = cookieValue(page, "sitegate_csrf");
    return fetch(`${baseUrl}/_sitegate/login`, {
      method: "POST",
      redirect: "manual",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: `sitegate_csrf=${encodeURIComponent(csrf)}`,
        Origin: baseUrl,
        "Sec-Fetch-Site": "same-origin",
      },
      body: new URLSearchParams({ csrf: token, next: destination, password: TEST_PASSWORD }),
    });
  }

  it("redirects browser requests and denies API requests before Express routes", async () => {
    const page = await fetch(`${baseUrl}/private?tab=one`, {
      headers: { Accept: "text/html" },
      redirect: "manual",
    });
    expect(page.status).toBe(307);
    expect(page.headers.get("location")).toBe(
      `/_sitegate/login?${new URLSearchParams({ next: "/private?tab=one" })}`,
    );

    const api = await fetch(`${baseUrl}/api/private`, { headers: { Accept: "application/json" } });
    expect(api.status).toBe(401);
    expect(await api.json()).toEqual({ error: "Authentication required." });
  });

  it("completes login and preserves both session and CSRF-expiry cookies", async () => {
    const response = await login();
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/private");
    expect(response.headers.getSetCookie()).toHaveLength(2);
    expect(cookieValue(response, "sitegate_session")).toBeTruthy();
    expect(response.headers.getSetCookie().join("\n")).toContain("sitegate_csrf=;");
  });

  it("continues exactly once and locks response security headers", async () => {
    const session = cookieValue(await login(), "sitegate_session");
    const response = await fetch(`${baseUrl}/private?tab=locked`, {
      headers: { Cookie: `sitegate_session=${encodeURIComponent(session)}` },
    });
    expect(response.status).toBe(201);
    expect(await response.text()).toBe("express application");
    const downstreamPath = new URL(
      response.headers.get("x-express-path") ?? "/missing",
      "http://local.test",
    );
    expect(downstreamPath.pathname).toBe("/private");
    expect(downstreamPath.searchParams.get("tab")).toBe("locked");
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(response.headers.get("x-robots-tag")).toContain("noindex");
    expect(response.headers.get("vary")).toContain("Accept-Encoding");
    expect(response.headers.get("vary")).toContain("Cookie");
  });

  it("keeps header locks on downstream error-handler responses", async () => {
    const session = cookieValue(await login(), "sitegate_session");
    const response = await fetch(`${baseUrl}/error`, {
      headers: { Cookie: `sitegate_session=${encodeURIComponent(session)}` },
    });
    expect(response.status).toBe(555);
    expect(await response.text()).toBe("downstream failed");
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
  });

  it("keeps header locks when downstream code writes headers directly", async () => {
    const session = cookieValue(await login(), "sitegate_session");
    const response = await fetch(`${baseUrl}/write-head`, {
      headers: { Cookie: `sitegate_session=${encodeURIComponent(session)}` },
    });
    expect(response.status).toBe(202);
    expect(await response.text()).toBe("writeHead application");
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(response.headers.get("x-robots-tag")).toContain("noindex");
    expect(response.headers.get("vary")).toContain("Origin");
    expect(response.headers.get("vary")).toContain("Cookie");
  });

  it("keeps header locks when downstream code appends conflicting values", async () => {
    const session = cookieValue(await login(), "sitegate_session");
    const response = await fetch(`${baseUrl}/append-header`, {
      headers: { Cookie: `sitegate_session=${encodeURIComponent(session)}` },
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("appendHeader application");
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("vary")).toContain("Origin");
    expect(response.headers.get("vary")).toContain("Cookie");
  });

  it("sanitizes raw writeHead arrays while preserving the downstream status", async () => {
    const session = cookieValue(await login(), "sitegate_session");
    const response = await fetch(`${baseUrl}/write-head-array`, {
      headers: { Cookie: `sitegate_session=${encodeURIComponent(session)}` },
    });
    expect(response.status).toBe(203);
    expect(await response.text()).toBe("raw header array application");
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(response.headers.get("x-robots-tag")).toContain("noindex");
    expect(response.headers.get("vary")).toContain("Origin");
    expect(response.headers.get("vary")).toContain("Cookie");
  });

  it("rejects a chunked login body after capturing only the bounded prefix", async () => {
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const request = httpRequest(
        {
          host: "127.0.0.1",
          port,
          path: "/_sitegate/login",
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Origin: baseUrl,
            "Sec-Fetch-Site": "same-origin",
          },
        },
        (response) => {
          resolve(response.statusCode);
          response.resume();
        },
      );
      request.once("error", reject);
      request.end("x".repeat(4097));
    });
    expect(status).toBe(413);
  });

  it("fails closed when the Host header is missing", async () => {
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const request = httpRequest(
        { host: "127.0.0.1", port, path: "/private", setHost: false },
        (response) => {
          resolve(response.statusCode);
          response.resume();
        },
      );
      request.once("error", reject);
      request.end();
    });
    expect(status).toBe(400);
  });

  it("leaves downstream POST bodies untouched when disabled", async () => {
    const app = express();
    app.use(sitegate({ enabled: false }));
    app.use((request, response) => {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk: string) => {
        body += chunk;
      });
      request.on("end", () => response.send(body));
    });
    const disabled = await listen(app);
    try {
      const response = await fetch(`${disabled.baseUrl}/_sitegate/login`, {
        method: "POST",
        body: "downstream body",
      });
      expect(await response.text()).toBe("downstream body");
    } finally {
      await disabled.close();
    }
  });

  it("fails closed before a selectively protected Express route can normalize an alias", async () => {
    const app = express();
    app.use(
      sitegate({
        password: TEST_PASSWORD,
        secret: TEST_SECRET,
        rateLimit: false,
        protectedPaths: ["/index.html"],
      }),
    );
    app.use((_request, response) => response.send("protected fixture"));
    const selective = await listen(app);
    try {
      const result = await new Promise<{ body: string; status: number | undefined }>(
        (resolve, reject) => {
          const request = httpRequest(
            {
              host: "127.0.0.1",
              port: selective.port,
              path: "/public%2F..%2F%2Findex.html",
            },
            (response) => {
              response.setEncoding("utf8");
              let body = "";
              response.on("data", (chunk: string) => {
                body += chunk;
              });
              response.on("end", () => resolve({ body, status: response.statusCode }));
            },
          );
          request.once("error", reject);
          request.end();
        },
      );
      expect(result.status).toBe(401);
      expect(result.body).not.toContain("protected fixture");
    } finally {
      await selective.close();
    }
  });

  it("honors Express trust-proxy scheme reconstruction", async () => {
    const app = express();
    app.set("trust proxy", "loopback");
    app.use(sitegate({ password: TEST_PASSWORD, secret: TEST_SECRET, rateLimit: false }));
    const trusted = await listen(app);
    try {
      const response = await fetch(`${trusted.baseUrl}/_sitegate/login`, {
        headers: { Host: "preview.example.test", "X-Forwarded-Proto": "https" },
      });
      expect(response.headers.get("set-cookie")).toContain("__Host-sitegate_csrf=");
      expect(response.headers.get("set-cookie")).toContain("Secure");
    } finally {
      await trusted.close();
    }
  });

  it("supports an application-owned public-origin override", async () => {
    const app = express();
    app.use(
      sitegate(
        { password: TEST_PASSWORD, secret: TEST_SECRET, rateLimit: false },
        { origin: "https://preview.example.test" },
      ),
    );
    const overridden = await listen(app);
    try {
      const response = await fetch(`${overridden.baseUrl}/_sitegate/login`);
      expect(response.status).toBe(200);
      expect(response.headers.get("set-cookie")).toContain("__Host-sitegate_csrf=");
      expect(response.headers.get("set-cookie")).toContain("Secure");
    } finally {
      await overridden.close();
    }
  });

  it("forwards unexpected origin-callback errors to Express error middleware", async () => {
    const app = express();
    app.use(
      sitegate(
        { password: TEST_PASSWORD, secret: TEST_SECRET, rateLimit: false },
        {
          origin() {
            throw new Error("origin resolution failed");
          },
        },
      ),
    );
    app.use(((error, _request, response, _next) => {
      response.status(555).send(error instanceof Error ? error.message : "unknown error");
    }) satisfies express.ErrorRequestHandler);
    const failing = await listen(app);
    try {
      const response = await fetch(`${failing.baseUrl}/private`);
      expect(response.status).toBe(555);
      expect(await response.text()).toBe("origin resolution failed");
    } finally {
      await failing.close();
    }
  });
});

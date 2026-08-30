import { createApp, eventHandler, readRawBody, toWebHandler, type App } from "h3";
import { describe, expect, it, vi } from "vitest";
import {
  createSitegateNuxt,
  SitegateNuxtConfigurationError,
  type SitegateNuxtConfig,
  type SitegateNuxtPlugin,
} from "../src/nuxt.js";
import { TEST_PASSWORD, TEST_SECRET } from "./helpers.js";

const ORIGIN = "https://preview.example.test";

function baseConfig(overrides: Partial<SitegateNuxtConfig> = {}): SitegateNuxtConfig {
  return {
    password: TEST_PASSWORD,
    secret: TEST_SECRET,
    rateLimit: false,
    ...overrides,
  };
}

function install(plugin: SitegateNuxtPlugin, app: App): void {
  plugin({ h3App: app });
}

function cookieValue(response: Response, name: string): string {
  for (const cookie of response.headers.getSetCookie()) {
    const match = new RegExp(`^${name}=([^;]*)`, "u").exec(cookie);
    if (match?.[1] !== undefined) return decodeURIComponent(match[1]);
  }
  throw new Error(`Missing ${name} cookie.`);
}

async function submitLogin(
  fetchApp: (request: Request) => Promise<Response>,
  password: string,
): Promise<Response> {
  const page = await fetchApp(new Request(`${ORIGIN}/_sitegate/login`));
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
      body: new URLSearchParams({ csrf: token, password }),
    }),
  );
}

describe("Nuxt adapter", () => {
  it("runs ahead of a terminating Nitro route-rule layer", async () => {
    const app = createApp();
    let routeRules = 0;
    app.use(
      eventHandler((event) => {
        routeRules += 1;
        event.node.res.statusCode = 302;
        event.node.res.setHeader("Location", "https://public.example.test/");
        return "route-rule redirect";
      }),
    );
    install(createSitegateNuxt(baseConfig()), app);
    const response = await toWebHandler(app)(
      new Request(`${ORIGIN}/private`, { headers: { Accept: "application/json" } }),
    );
    expect(response.status).toBe(401);
    expect(routeRules).toBe(0);
  });

  it("runs before a terminating Nitro request hook and locks the outer handler", async () => {
    let requestHooks = 0;
    const app = createApp({
      async onRequest(event) {
        requestHooks += 1;
        await event.respondWith(new Response("request-hook secret"));
      },
    });
    install(createSitegateNuxt(baseConfig({ excludedPaths: ["/public"] })), app);
    const handler = toWebHandler(app);
    const denied = await handler(
      new Request(`${ORIGIN}/private`, { headers: { Accept: "application/json" } }),
    );
    expect(denied.status).toBe(401);
    expect(requestHooks).toBe(0);
    const allowed = await handler(new Request(`${ORIGIN}/public`));
    expect(await allowed.text()).toBe("request-hook secret");
    expect(requestHooks).toBe(1);
    expect(Object.getOwnPropertyDescriptor(app, "handler")).toMatchObject({
      configurable: false,
      writable: false,
    });
    expect(() => Object.defineProperty(app, "handler", { value: async () => undefined })).toThrow();
  });

  it("rejects duplicate installation on the same Nitro application", () => {
    const app = createApp();
    const plugin = createSitegateNuxt(baseConfig());
    install(plugin, app);
    expect(() => install(plugin, app)).toThrow(SitegateNuxtConfigurationError);
  });

  it("resolves asynchronous per-request configuration without stale state", async () => {
    const app = createApp();
    let resolutions = 0;
    const resolver = vi.fn(async () => {
      resolutions += 1;
      return baseConfig({ enabled: resolutions !== 1 });
    });
    install(createSitegateNuxt(resolver), app);
    app.use(eventHandler(() => "downstream"));
    const handler = toWebHandler(app);
    const open = await handler(new Request(`${ORIGIN}/open`));
    const denied = await handler(
      new Request(`${ORIGIN}/private`, { headers: { Accept: "application/json" } }),
    );
    expect(await open.text()).toBe("downstream");
    expect(denied.status).toBe(401);
    expect(resolver).toHaveBeenCalledTimes(2);
  });

  it("fails closed with secured headers when the config resolver rejects", async () => {
    const app = createApp();
    let downstream = 0;
    install(
      createSitegateNuxt(async () => {
        throw new Error("runtime config unavailable");
      }),
      app,
    );
    app.use(
      eventHandler(() => {
        downstream += 1;
        return "downstream";
      }),
    );
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await toWebHandler(app)(new Request(`${ORIGIN}/private`));
    log.mockRestore();
    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(response.headers.get("x-robots-tag")).toContain("noindex");
    expect(downstream).toBe(0);
  });

  it("requires an explicit distributed rate-limit choice at runtime", async () => {
    const app = createApp();
    let downstream = 0;
    const invalid: Partial<SitegateNuxtConfig> = {
      password: TEST_PASSWORD,
      secret: TEST_SECRET,
    };
    // @ts-expect-error Deliberately exercise validation for untyped JavaScript callers.
    install(createSitegateNuxt(invalid), app);
    app.use(
      eventHandler(() => {
        downstream += 1;
        return "downstream";
      }),
    );
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await toWebHandler(app)(new Request(`${ORIGIN}/private`));
    log.mockRestore();
    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(downstream).toBe(0);
  });

  it("rejects a process-local limiter at runtime", async () => {
    const app = createApp();
    const invalid = {
      password: TEST_PASSWORD,
      secret: TEST_SECRET,
      rateLimit: {
        limiter: {
          scope: "process" as const,
          consume: () => ({ limited: false }),
          reset: () => undefined,
        },
      },
    };
    // @ts-expect-error Deliberately exercise validation for untyped JavaScript callers.
    install(createSitegateNuxt(invalid), app);
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await toWebHandler(app)(new Request(`${ORIGIN}/private`));
    log.mockRestore();
    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("rejects a string-valued proxy-trust setting from runtime configuration", async () => {
    const app = createApp();
    const invalid = {
      password: TEST_PASSWORD,
      secret: TEST_SECRET,
      rateLimit: {
        trustProxy: "true" as const,
        limiter: {
          scope: "shared" as const,
          consume: () => ({ limited: false }),
          reset: () => undefined,
        },
      },
    };
    // @ts-expect-error Deliberately exercise validation for untyped runtime configuration.
    install(createSitegateNuxt(invalid), app);
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await toWebHandler(app)(new Request(`${ORIGIN}/private`));
    log.mockRestore();
    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("uses and resets a shared limiter during the real login flow", async () => {
    const limiter = {
      scope: "shared" as const,
      consume: vi.fn(() => ({ limited: false })),
      reset: vi.fn(),
    };
    const app = createApp();
    install(createSitegateNuxt(baseConfig({ rateLimit: { limiter } })), app);
    app.use(eventHandler(() => "downstream"));
    const response = await submitLogin(toWebHandler(app), TEST_PASSWORD);
    expect(response.status).toBe(303);
    expect(limiter.consume).toHaveBeenCalledOnce();
    expect(limiter.reset).toHaveBeenCalledOnce();
  });

  it("binds concurrent event work to each request's waitUntil context", async () => {
    const first = vi.fn();
    const second = vi.fn();
    const app = createApp();
    install(createSitegateNuxt(baseConfig({ onEvent: async () => undefined })), app);
    app.use(eventHandler(() => "downstream"));
    const handler = toWebHandler(app);
    const firstContext = { waitUntil: first };
    const secondContext = { waitUntil: second };
    await Promise.all([
      submitLogin((request) => handler(request, firstContext), "first wrong password"),
      submitLogin((request) => handler(request, secondContext), "second wrong password"),
    ]);
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
    expect(first.mock.calls[0]?.[0]).not.toBe(second.mock.calls[0]?.[0]);
  });

  it("keeps telemetry best-effort when event work and waitUntil fail", async () => {
    const app = createApp();
    install(
      createSitegateNuxt(
        baseConfig({
          onEvent() {
            throw new Error("telemetry failed");
          },
        }),
      ),
      app,
    );
    const handler = toWebHandler(app);
    const response = await submitLogin(
      (request) =>
        handler(request, {
          waitUntil() {
            throw new Error("lifecycle unavailable");
          },
        }),
      "wrong password",
    );
    expect(response.status).toBe(401);
  });

  it("leaves a disabled login-path body untouched for downstream Nitro handlers", async () => {
    const app = createApp();
    install(createSitegateNuxt(baseConfig({ password: "", secret: "", enabled: false })), app);
    app.use(
      "/_sitegate/login",
      eventHandler(async (event) => readRawBody(event)),
    );
    const response = await toWebHandler(app)(
      new Request(`${ORIGIN}/_sitegate/login`, { method: "POST", body: "downstream body" }),
    );
    expect(await response.text()).toBe("downstream body");
  });
});

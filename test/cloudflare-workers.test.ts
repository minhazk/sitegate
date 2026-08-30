import { describe, expect, it, vi } from "vitest";
import {
  cloudflareClientId,
  createSitegateWorker,
  SitegateWorkerConfigurationError,
  type SitegateWorkerConfig,
  type SitegateWorkerContext,
} from "../src/cloudflare-workers.js";
import { TEST_PASSWORD, TEST_SECRET } from "./helpers.js";

const ORIGIN = "https://preview.example.test";

function baseConfig(overrides: Partial<SitegateWorkerConfig> = {}): SitegateWorkerConfig {
  return {
    password: TEST_PASSWORD,
    secret: TEST_SECRET,
    rateLimit: false,
    ...overrides,
  };
}

function context(waitUntil = vi.fn()): SitegateWorkerContext & { waitUntil: typeof waitUntil } {
  return { waitUntil };
}

function cookieValue(response: Response, name: string): string {
  for (const cookie of response.headers.getSetCookie()) {
    const match = new RegExp(`^${name}=([^;]*)`, "u").exec(cookie);
    if (match?.[1] !== undefined) return decodeURIComponent(match[1]);
  }
  throw new Error(`Missing ${name} cookie.`);
}

async function submitLogin<Env extends object>(
  handler: ReturnType<typeof createSitegateWorker<Env>>,
  env: Env,
  workerContext: SitegateWorkerContext,
  password: string,
): Promise<Response> {
  const page = await handler(new Request(`${ORIGIN}/_sitegate/login`), env, workerContext);
  const token = /name="csrf" value="([^"]+)"/u.exec(await page.clone().text())?.[1];
  if (token === undefined) throw new Error("Missing CSRF token.");
  const csrf = cookieValue(page, "__Host-sitegate_csrf");
  return handler(
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
    env,
    workerContext,
  );
}

describe("Cloudflare Workers adapter", () => {
  it("forwards the exact request, env, and context objects", async () => {
    const request = new Request(`${ORIGIN}/private`);
    const env = { marker: "bindings" };
    const workerContext = context();
    const next = vi.fn((receivedRequest, receivedEnv, receivedContext) => {
      expect(receivedRequest).toBe(request);
      expect(receivedEnv).toBe(env);
      expect(receivedContext).toBe(workerContext);
      return new Response("worker application", { status: 209 });
    });
    const handler = createSitegateWorker(baseConfig({ enabled: false }), next);
    const response = await handler(request, env, workerContext);
    expect(response.status).toBe(209);
    expect(await response.text()).toBe("worker application");
    expect(next).toHaveBeenCalledOnce();
  });

  it("denies protected requests without invoking the downstream Worker", async () => {
    const next = vi.fn(() => new Response("private"));
    const handler = createSitegateWorker(baseConfig(), next);
    const response = await handler(
      new Request(`${ORIGIN}/api/private`, { headers: { Accept: "application/json" } }),
      {},
      context(),
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Authentication required." });
    expect(next).not.toHaveBeenCalled();
  });

  it("resolves binding-derived configuration independently for every request", async () => {
    const resolver = vi.fn(async (env: { enabled: boolean }) =>
      baseConfig({ enabled: env.enabled }),
    );
    const next = vi.fn(() => new Response("downstream"));
    const handler = createSitegateWorker(resolver, next);

    const allowed = await handler(new Request(`${ORIGIN}/private`), { enabled: false }, context());
    const denied = await handler(
      new Request(`${ORIGIN}/private`, { headers: { Accept: "application/json" } }),
      { enabled: true },
      context(),
    );
    expect(await allowed.text()).toBe("downstream");
    expect(denied.status).toBe(401);
    expect(resolver).toHaveBeenCalledTimes(2);
    expect(next).toHaveBeenCalledOnce();
  });

  it("fails closed when an asynchronous configuration resolver rejects", async () => {
    const next = vi.fn(() => new Response("downstream"));
    const handler = createSitegateWorker(async () => {
      throw new Error("bindings unavailable");
    }, next);
    await expect(handler(new Request(`${ORIGIN}/private`), {}, context())).rejects.toThrow(
      "bindings unavailable",
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("requires callers to make the distributed rate-limit choice explicit", async () => {
    const invalid: Partial<SitegateWorkerConfig> = {
      password: TEST_PASSWORD,
      secret: TEST_SECRET,
    };
    // @ts-expect-error Deliberately exercise validation for untyped JavaScript callers.
    const handler = createSitegateWorker(invalid, () => new Response("downstream"));
    await expect(handler(new Request(`${ORIGIN}/private`), {}, context())).rejects.toBeInstanceOf(
      SitegateWorkerConfigurationError,
    );
  });

  it("rejects a process-local limiter at runtime", async () => {
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
    const handler = createSitegateWorker(invalid, () => new Response("downstream"));
    await expect(handler(new Request(`${ORIGIN}/private`), {}, context())).rejects.toThrow(
      'rateLimit.limiter.scope to be "shared"',
    );
  });

  it.each([true, "true", 1] as const)(
    "rejects generic forwarding-header trust in the Workers adapter (%j)",
    async (trustProxy) => {
      const invalid = {
        password: TEST_PASSWORD,
        secret: TEST_SECRET,
        rateLimit: {
          trustProxy,
          limiter: {
            scope: "shared" as const,
            consume: () => ({ limited: false }),
            reset: () => undefined,
          },
        },
      };
      // @ts-expect-error Deliberately exercise validation for untyped JavaScript callers.
      const handler = createSitegateWorker(invalid, () => new Response("downstream"));
      await expect(handler(new Request(`${ORIGIN}/private`), {}, context())).rejects.toThrow(
        "do not accept trustProxy",
      );
    },
  );

  it("uses a shared limiter for login attempts and resets it after success", async () => {
    const limiter = {
      scope: "shared" as const,
      consume: vi.fn(() => ({ limited: false })),
      reset: vi.fn(),
    };
    const handler = createSitegateWorker(
      baseConfig({ rateLimit: { limiter } }),
      () => new Response("downstream"),
    );
    const response = await submitLogin(handler, {}, context(), TEST_PASSWORD);
    expect(response.status).toBe(303);
    expect(limiter.consume).toHaveBeenCalledOnce();
    expect(limiter.reset).toHaveBeenCalledOnce();
  });

  it("registers asynchronous security events with waitUntil", async () => {
    const events: string[] = [];
    let release: (() => void) | undefined;
    const eventWork = new Promise<void>((resolve) => {
      release = resolve;
    });
    const workerContext = context();
    const handler = createSitegateWorker(
      baseConfig({
        onEvent(event) {
          events.push(event.type);
          return eventWork;
        },
      }),
      () => new Response("downstream"),
    );
    const response = await submitLogin(handler, {}, workerContext, "wrong password");
    expect(response.status).toBe(401);
    expect(events).toEqual(["login_failed"]);
    expect(workerContext.waitUntil).toHaveBeenCalledOnce();
    release?.();
    await workerContext.waitUntil.mock.calls[0]?.[0];
  });

  it("binds concurrent event work to each request's own context", async () => {
    const first = context();
    const second = context();
    const handler = createSitegateWorker(
      baseConfig({ onEvent: async () => undefined }),
      () => new Response("downstream"),
    );
    await Promise.all([
      submitLogin(handler, {}, first, "first wrong password"),
      submitLogin(handler, {}, second, "second wrong password"),
    ]);
    expect(first.waitUntil).toHaveBeenCalledOnce();
    expect(second.waitUntil).toHaveBeenCalledOnce();
    expect(first.waitUntil.mock.calls[0]?.[0]).not.toBe(second.waitUntil.mock.calls[0]?.[0]);
  });

  it("calls waitUntil with its context receiver intact", async () => {
    let workerContext: SitegateWorkerContext;
    workerContext = {
      waitUntil(promise) {
        expect(this).toBe(workerContext);
        void promise;
      },
    };
    const handler = createSitegateWorker(
      baseConfig({ onEvent: async () => undefined }),
      () => new Response("downstream"),
    );
    const response = await submitLogin(handler, {}, workerContext, "wrong password");
    expect(response.status).toBe(401);
  });

  it("keeps telemetry best-effort when waitUntil or the event handler fails", async () => {
    const workerContext = context(
      vi.fn(() => {
        throw new Error("lifecycle unavailable");
      }),
    );
    const handler = createSitegateWorker(
      baseConfig({
        onEvent() {
          throw new Error("telemetry failed");
        },
      }),
      () => new Response("downstream"),
    );
    const response = await submitLogin(handler, {}, workerContext, "wrong password");
    expect(response.status).toBe(401);
    expect(workerContext.waitUntil).toHaveBeenCalledOnce();
  });

  it("preserves streaming downstream responses while adding gate headers", async () => {
    const handler = createSitegateWorker(baseConfig({ excludedPaths: ["/stream"] }), () => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("worker stream"));
          controller.close();
        },
      });
      return new Response(body, { headers: { "X-Stream": "1" } });
    });
    const response = await handler(new Request(`${ORIGIN}/stream`), {}, context());
    expect(await response.text()).toBe("worker stream");
    expect(response.headers.get("x-stream")).toBe("1");
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("propagates downstream failures without failing open or using pass-through", async () => {
    const passThroughOnException = vi.fn();
    const workerContext = {
      ...context(),
      passThroughOnException,
    };
    const handler = createSitegateWorker(baseConfig({ excludedPaths: ["/error"] }), () => {
      throw new Error("downstream failed");
    });
    await expect(handler(new Request(`${ORIGIN}/error`), {}, workerContext)).rejects.toThrow(
      "downstream failed",
    );
    expect(passThroughOnException).not.toHaveBeenCalled();
  });

  it("hashes Cloudflare's visitor address without trusting forwarding headers", async () => {
    const first = await cloudflareClientId(
      new Request(`${ORIGIN}/`, {
        headers: { "CF-Connecting-IP": "203.0.113.42", "X-Forwarded-For": "198.51.100.1" },
      }),
      TEST_SECRET,
    );
    const repeated = await cloudflareClientId(
      new Request(`${ORIGIN}/`, { headers: { "CF-Connecting-IP": "203.0.113.42" } }),
      TEST_SECRET,
    );
    const rotated = await cloudflareClientId(
      new Request(`${ORIGIN}/`, { headers: { "CF-Connecting-IP": "203.0.113.42" } }),
      `${TEST_SECRET}-rotated`,
    );
    expect(first).toBe(repeated);
    expect(first).not.toBe(rotated);
    expect(first).toMatch(/^[0-9a-f]{24}$/u);
    expect(first).not.toContain("203.0.113.42");
    expect(await cloudflareClientId(new Request(`${ORIGIN}/`), TEST_SECRET)).toBe("unknown");
    await expect(
      cloudflareClientId(
        new Request(`${ORIGIN}/`, { headers: { "CF-Connecting-IP": "203.0.113.42" } }),
        "short",
      ),
    ).rejects.toThrow("at least 32 UTF-8 bytes");
  });
});

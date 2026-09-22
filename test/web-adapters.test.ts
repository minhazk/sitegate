import { describe, expect, it, vi } from "vitest";
import { sitegate as astro } from "../src/astro.js";
import { sitegate as sveltekit } from "../src/sveltekit.js";
import { BASE_URL, TEST_PASSWORD, TEST_SECRET } from "./helpers.js";

const config = { password: TEST_PASSWORD, secret: TEST_SECRET };

describe.each(["astro", "sveltekit"] as const)("%s adapter", (framework) => {
  function handler(enabled = true) {
    const options = { ...config, enabled };
    if (framework === "astro") {
      const middleware = astro(options);
      return (request: Request, next: () => Response | Promise<Response>) =>
        middleware({ request }, next);
    }
    const handle = sveltekit(options);
    return (request: Request, next: () => Response | Promise<Response>) =>
      handle({ event: { request }, resolve: next });
  }

  it("blocks pages and APIs before downstream handlers", async () => {
    const next = vi.fn(() => new Response("private"));
    const handle = handler();
    expect(
      (await handle(new Request(`${BASE_URL}/reports`, { headers: { Accept: "text/html" } }), next))
        .status,
    ).toBe(307);
    expect((await handle(new Request(`${BASE_URL}/api/private`), next)).status).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("signs in, preserves cookies, protects final headers, and signs out", async () => {
    const handle = handler();
    const next = vi.fn(() => new Response("private", { headers: { "Cache-Control": "public" } }));
    const page = await handle(new Request(`${BASE_URL}/_sitegate/login`), next);
    const token = /name="csrf" value="([^"]+)"/u.exec(await page.text())?.[1] ?? "";
    const cookie = page.headers.getSetCookie()[0]?.split(";")[0] ?? "";
    const result = await handle(
      new Request(`${BASE_URL}/_sitegate/login`, {
        method: "POST",
        headers: { Cookie: cookie, Origin: BASE_URL },
        body: new URLSearchParams({ csrf: token, password: TEST_PASSWORD, next: "/reports" }),
      }),
      next,
    );
    expect(result.status).toBe(303);
    expect(result.headers.get("location")).toBe("/reports");
    expect(result.headers.getSetCookie()).toHaveLength(2);
    const session = result.headers.getSetCookie()[0]?.split(";")[0] ?? "";
    const response = await handle(
      new Request(`${BASE_URL}/reports`, { headers: { Cookie: session } }),
      next,
    );
    expect(await response.text()).toBe("private");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(next).toHaveBeenCalledOnce();
    const logout = await handle(
      new Request(`${BASE_URL}/_sitegate/logout`, {
        method: "POST",
        headers: { Cookie: session, Origin: BASE_URL },
      }),
      next,
    );
    expect(logout.status).toBe(303);
    expect(logout.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("passes request bodies through unchanged when disabled", async () => {
    const request = new Request(`${BASE_URL}/_sitegate/login`, {
      method: "POST",
      body: "untouched",
    });
    expect(
      await (await handler(false)(request, async () => new Response(await request.text()))).text(),
    ).toBe("untouched");
  });
});

it("keeps the complete SvelteKit event for the next hook", async () => {
  const event = { request: new Request(BASE_URL), locals: { locale: "de" } };
  const resolve = vi.fn((received: typeof event) => new Response(received.locals.locale));
  const result = await sveltekit({ ...config, enabled: false })({ event, resolve });
  expect(resolve).toHaveBeenCalledWith(event);
  expect(await result.text()).toBe("de");
});

it("fails clearly for Astro prerendering rather than publishing a static login page", async () => {
  const context = { request: new Request(BASE_URL), isPrerendered: true };
  expect(() => astro(config)(context, () => new Response("private"))).toThrow('output: "server"');
  expect(
    (await astro({ ...config, enabled: false })(context, () => new Response("public"))).status,
  ).toBe(200);
});

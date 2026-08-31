import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const ORIGIN = "https://fixture.example";

function cookieValue(response: Response, name: string): string {
  for (const cookie of response.headers.getSetCookie()) {
    const match = new RegExp(`^${name}=([^;]*)`, "u").exec(cookie);
    if (match?.[1] !== undefined) return decodeURIComponent(match[1]);
  }
  throw new Error(`Missing ${name} cookie.`);
}

async function fetchWorker(path: string, init?: RequestInit): Promise<Response> {
  return exports.default.fetch(new Request(`${ORIGIN}${path}`, init));
}

describe("sitegate/cloudflare-workers compatibility", () => {
  it("denies unauthenticated API requests inside the Workers runtime", async () => {
    const response = await fetchWorker("/api/private", {
      headers: { Accept: "application/json" },
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: "Authentication required.",
    });
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(response.headers.get("x-robots-tag")).toContain("noindex");
  });

  it("completes login and serves the protected asset binding", async () => {
    const page = await fetchWorker(`/_sitegate/login?${new URLSearchParams({ next: "/" })}`, {
      headers: { Accept: "text/html" },
    });
    const html = await page.text();
    const csrfToken = /name="csrf" value="([^"]+)"/u.exec(html)?.[1];

    if (csrfToken === undefined) throw new Error("Missing CSRF token.");

    const csrfCookie = cookieValue(page, "__Host-sitegate_csrf");
    const login = await fetchWorker("/_sitegate/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: `__Host-sitegate_csrf=${encodeURIComponent(csrfCookie)}`,
        Origin: ORIGIN,
        "Sec-Fetch-Site": "same-origin",
      },
      redirect: "manual",
      body: new URLSearchParams({
        csrf: csrfToken,
        next: "/",
        password: env.SITEGATE_PASSWORD,
      }),
    });

    expect(login.status).toBe(303);
    expect(login.headers.get("location")).toBe("/");

    const sessionCookie = cookieValue(login, "__Host-sitegate_session");
    const application = await fetchWorker("/", {
      headers: {
        Cookie: `__Host-sitegate_session=${encodeURIComponent(sessionCookie)}`,
      },
    });

    expect(application.status).toBe(200);
    expect(await application.text()).toContain("Cloudflare Workers compatibility fixture.");
    expect(application.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(application.headers.get("vary")).toContain("Cookie");
    expect(application.headers.get("x-robots-tag")).toContain("noindex");
  });
});

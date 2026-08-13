import type { AddressInfo } from "node:net";
import { request as httpRequest } from "node:http";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createServer, type Plugin, type ViteDevServer } from "vite";
import { viteSitegate } from "../src/vite.js";
import { TEST_PASSWORD, TEST_SECRET } from "./helpers.js";

describe("Vite adapter", () => {
  let server: ViteDevServer;
  let baseUrl: string;
  let plugin: Plugin;

  beforeAll(async () => {
    plugin = viteSitegate({ password: TEST_PASSWORD, secret: TEST_SECRET });
    server = await createServer({
      root: fileURLToPath(new URL("./fixtures/vite", import.meta.url)),
      logLevel: "silent",
      plugins: [plugin],
      server: { host: "127.0.0.1", port: 0 },
    });
    await server.listen();
    const address = server.httpServer?.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await server.close();
  });

  it("protects Vite pages before the internal middleware stack", async () => {
    const response = await fetch(`${baseUrl}/`, {
      headers: { Accept: "text/html" },
      redirect: "manual",
    });
    expect(response.status).toBe(307);
    const expectedLocation = `/_sitegate/login?${new URLSearchParams({ next: "/" })}`;
    expect(response.headers.get("location")).toBe(expectedLocation);
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("serves login, creates a session, and protects the downstream Vite response", async () => {
    const loginPage = await fetch(`${baseUrl}/_sitegate/login?next=%2F`);
    const html = await loginPage.text();
    const csrfToken = /name="csrf" value="([^"]+)"/u.exec(html)?.[1];
    const csrfCookie = /(?:^|, )sitegate_csrf=([^;]+)/u.exec(
      loginPage.headers.get("set-cookie") ?? "",
    )?.[1];
    expect(csrfToken).toBeTruthy();
    expect(csrfCookie).toBeTruthy();

    const login = await fetch(`${baseUrl}/_sitegate/login`, {
      method: "POST",
      body: new URLSearchParams({
        csrf: csrfToken ?? "",
        next: "/",
        password: TEST_PASSWORD,
      }),
      headers: {
        Cookie: `sitegate_csrf=${csrfCookie}`,
        Origin: baseUrl,
        "Sec-Fetch-Site": "same-origin",
      },
      redirect: "manual",
    });
    expect(login.status).toBe(303);
    const session = /(?:^|, )sitegate_session=([^;]+)/u.exec(
      login.headers.get("set-cookie") ?? "",
    )?.[1];
    expect(session).toBeTruthy();

    const protectedPage = await fetch(`${baseUrl}/`, {
      headers: { Cookie: `sitegate_session=${session}` },
    });
    expect(protectedPage.status).toBe(200);
    expect(await protectedPage.text()).toContain("Protected Vite fixture");
    expect(protectedPage.headers.get("cache-control")).toContain("no-store");
    expect(protectedPage.headers.get("vary")).toContain("Cookie");
    expect(protectedPage.headers.get("x-robots-tag")).toContain("noindex");
  });

  it("rejects oversized chunked login bodies before the request ends", async () => {
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const request = httpRequest(
        `${baseUrl}/_sitegate/login`,
        {
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
          request.end();
        },
      );
      request.once("error", reject);
      request.write("x".repeat(4097));
    });
    expect(status).toBe(413);
  });

  it("rejects and drains declared-oversized login bodies before the request ends", async () => {
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const request = httpRequest(
        `${baseUrl}/_sitegate/login`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "Content-Length": "5000",
            Origin: baseUrl,
            "Sec-Fetch-Site": "same-origin",
          },
        },
        (response) => {
          resolve(response.statusCode);
          response.resume();
          request.end();
        },
      );
      request.once("error", reject);
      request.write("x");
    });
    expect(status).toBe(413);
  });

  it("reads login bodies for canonicalized login-path aliases", async () => {
    const loginPage = await fetch(`${baseUrl}/_sitegate/login`);
    const html = await loginPage.text();
    const csrfToken = /name="csrf" value="([^"]+)"/u.exec(html)?.[1];
    const csrfCookie = /(?:^|, )sitegate_csrf=([^;]+)/u.exec(
      loginPage.headers.get("set-cookie") ?? "",
    )?.[1];

    const login = await fetch(`${baseUrl}/_sitegate%2Flogin`, {
      method: "POST",
      body: new URLSearchParams({ csrf: csrfToken ?? "", password: TEST_PASSWORD }),
      headers: {
        Cookie: `sitegate_csrf=${csrfCookie}`,
        Origin: baseUrl,
        "Sec-Fetch-Site": "same-origin",
      },
      redirect: "manual",
    });
    expect(login.status).toBe(303);
    expect(login.headers.get("set-cookie")).toContain("sitegate_session=");
  });

  it("registers the same gate with Vite's preview-server hook", () => {
    const use = vi.fn();
    const configurePreview = plugin.configurePreviewServer as unknown as (server: {
      middlewares: { use: typeof use };
    }) => void;
    configurePreview({ middlewares: { use } });
    expect(use).toHaveBeenCalledOnce();
    expect(use.mock.calls[0]?.[0]).toBeTypeOf("function");
  });
});

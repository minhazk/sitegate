import { Readable } from "node:stream";
import type { IncomingHttpHeaders, IncomingMessage } from "node:http";
import { describe, expect, it } from "vitest";
import { nodeWebRequest, SitegateNodeRequestError } from "../src/node-http.js";
import { makeGate } from "./helpers.js";

interface IncomingFixture {
  body?: string;
  encrypted?: boolean;
  headers?: IncomingHttpHeaders;
  method?: string;
  url?: string;
}

function incoming(fixture: IncomingFixture = {}): IncomingMessage {
  const request = Readable.from(fixture.body === undefined ? [] : [fixture.body]);
  Object.defineProperties(request, {
    headers: { value: fixture.headers ?? { host: "preview.example.test" } },
    method: { value: fixture.method ?? "GET" },
    socket: { value: { encrypted: fixture.encrypted ?? false } },
    url: { value: fixture.url ?? "/" },
  });
  return request as IncomingMessage;
}

describe("shared Node request conversion", () => {
  const gate = makeGate({ rateLimit: false });

  it("reconstructs HTTPS URLs, raw queries, and request headers", async () => {
    const converted = await nodeWebRequest(
      incoming({
        encrypted: true,
        headers: {
          accept: "text/html",
          cookie: "one=1; two=2",
          host: "preview.example.test:8443",
          "x-list": ["one", "two"],
        },
        url: "/private?tab=one",
      }),
      gate,
    );
    expect(converted.url).toBe("https://preview.example.test:8443/private?tab=one");
    expect(converted.headers.get("cookie")).toBe("one=1; two=2");
    expect(converted.headers.get("x-list")).toBe("one, two");
  });

  it("accepts a validated URL returned by an origin callback", async () => {
    const converted = await nodeWebRequest(incoming({ url: "/private" }), gate, {
      origin: () => new URL("https://public.example.test"),
    });
    expect(converted.url).toBe("https://public.example.test/private");
  });

  it("uses HTTP/2 authority while omitting pseudoheaders from Fetch headers", async () => {
    const converted = await nodeWebRequest(
      incoming({
        headers: {
          ":authority": "preview.example.test",
          ":method": "GET",
          ":path": "/private",
          ":scheme": "https",
        } as IncomingHttpHeaders,
        url: "/private",
      }),
      gate,
    );
    expect(converted.url).toBe("http://preview.example.test/private");
    expect([...converted.headers.keys()].some((name) => name.startsWith(":"))).toBe(false);
  });

  it("rejects contradictory Host and HTTP/2 authority values", async () => {
    await expect(
      nodeWebRequest(
        incoming({
          headers: {
            ":authority": "authority.example.test",
            host: "host.example.test",
          } as IncomingHttpHeaders,
        }),
        gate,
      ),
    ).rejects.toBeInstanceOf(SitegateNodeRequestError);
  });

  it.each([
    "private",
    "http://other.example/private",
    "/private\\alias",
    "/private#fragment",
    "/private\u0000alias",
  ])("rejects malformed request target %j", async (url) => {
    await expect(nodeWebRequest(incoming({ url }), gate)).rejects.toBeInstanceOf(
      SitegateNodeRequestError,
    );
  });

  it.each([
    "not an origin",
    "ftp://preview.example.test",
    "https://user@preview.example.test",
    "https://preview.example.test/path",
    "https://preview.example.test/?query=1",
    "https://preview.example.test/#fragment",
  ])("rejects invalid public-origin override %j", async (origin) => {
    await expect(nodeWebRequest(incoming(), gate, { origin })).rejects.toBeInstanceOf(
      SitegateNodeRequestError,
    );
  });

  it("captures at most 4,097 bytes from an unknown-length login stream", async () => {
    const converted = await nodeWebRequest(
      incoming({
        body: "x".repeat(5000),
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          host: "preview.example.test",
        },
        method: "POST",
        url: gate.loginPath,
      }),
      gate,
    );
    expect((await converted.arrayBuffer()).byteLength).toBe(4097);
  });

  it("does not attach a declared-oversized login stream to the web request", async () => {
    const converted = await nodeWebRequest(
      incoming({
        body: "x".repeat(5000),
        headers: {
          "content-length": "5000",
          "content-type": "application/x-www-form-urlencoded",
          host: "preview.example.test",
        },
        method: "POST",
        url: gate.loginPath,
      }),
      gate,
    );
    expect(converted.body).toBeNull();
    expect(converted.headers.get("content-length")).toBe("5000");
  });

  it("leaves login streams unread when body capture is disabled", async () => {
    const request = incoming({
      body: "downstream body",
      headers: { host: "preview.example.test" },
      method: "POST",
      url: gate.loginPath,
    });
    const converted = await nodeWebRequest(request, gate, { captureLoginBody: false });
    expect(converted.body).toBeNull();
    expect(request.readableEnded).toBe(false);
  });

  it("keeps network-path references as path data for fail-closed canonical validation", async () => {
    const converted = await nodeWebRequest(incoming({ url: "//other.example/private" }), gate);
    expect(new URL(converted.url).origin).toBe("http://preview.example.test");
    expect(new URL(converted.url).pathname).toBe("//other.example/private");
  });
});

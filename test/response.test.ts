import { describe, expect, it } from "vitest";
import { secureResponse } from "../src/response.js";

describe("response hardening", () => {
  it("hardens mutable responses in place so runtime extensions survive", () => {
    const webSocket = { accepted: false };
    const response = new Response("application", {
      headers: { "Cache-Control": "public", Vary: "Origin" },
    });
    Object.defineProperties(response, {
      encodeBody: { value: "manual" },
      webSocket: { value: webSocket },
    });

    const secured = secureResponse(response) as Response & {
      encodeBody: string;
      webSocket: typeof webSocket;
    };
    expect(secured).toBe(response);
    expect(secured.webSocket).toBe(webSocket);
    expect(secured.encodeBody).toBe("manual");
    expect(secured.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(secured.headers.get("vary")).toContain("Origin");
    expect(secured.headers.get("vary")).toContain("Cookie");
  });

  it("clones responses whose header guard is immutable", () => {
    const immutable = Response.redirect("https://preview.example.test/login");
    expect(() => immutable.headers.set("Cache-Control", "private")).toThrow();
    const secured = secureResponse(immutable);
    expect(secured).not.toBe(immutable);
    expect(secured.status).toBe(302);
    expect(secured.headers.get("location")).toBe("https://preview.example.test/login");
    expect(secured.headers.get("cache-control")).toBe("private, no-store, max-age=0");
  });

  it("preserves Vary star on a mutable response", () => {
    const response = secureResponse(new Response(null, { headers: { Vary: "*" } }));
    expect(response.headers.get("vary")).toBe("*");
  });
});

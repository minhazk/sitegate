import { NextRequest } from "next/server.js";
import { describe, expect, it } from "vitest";
import { sitegate } from "../src/next.js";

describe("Next.js adapter", () => {
  it("composes with NextResponse.next when disabled", async () => {
    const proxy = sitegate({ enabled: false });
    const result = await proxy(new NextRequest("https://preview.example.test/dashboard"));
    expect(result).toBeInstanceOf(Response);
    expect(result?.headers.get("x-middleware-next")).toBe("1");
  });
});

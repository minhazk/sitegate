import { describe, expect, it } from "vitest";
import { isProtectedPath, safeDestination } from "../src/index.js";

describe("path policy", () => {
  it("matches string prefixes on path boundaries", () => {
    expect(isProtectedPath("/admin", ["/admin"], [])).toBe(true);
    expect(isProtectedPath("/admin/users", ["/admin"], [])).toBe(true);
    expect(isProtectedPath("/administrator", ["/admin"], [])).toBe(false);
  });

  it("supports regular expressions and callbacks", () => {
    expect(isProtectedPath("/client/42", [/^\/client\//u], [])).toBe(true);
    expect(isProtectedPath("/report", [(path) => path.endsWith("report")], [])).toBe(true);
  });

  it("lets exclusions take precedence", () => {
    expect(isProtectedPath("/admin/health", ["/admin"], ["/admin/health"])).toBe(false);
  });
});

describe("safeDestination", () => {
  it.each(["https://evil.test", "//evil.test", "/\\evil.test", " /admin", "/admin\nX-Test: yes"])(
    "rejects unsafe redirect %s",
    (destination) => expect(safeDestination(destination)).toBe("/"),
  );

  it("preserves a safe local path, query, and hash", () => {
    const destination = `/reports?${"id"}=4#summary`;
    expect(safeDestination(destination)).toBe(destination);
  });
});

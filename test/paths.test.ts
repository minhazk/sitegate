import { describe, expect, it } from "vitest";
import { canonicalPathname, isProtectedPath, safeDestination } from "../src/index.js";

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

  it("matches percent-encoded paths against their canonical route", () => {
    expect(isProtectedPath("/%61dmin", ["/admin"], [])).toBe(true);
    expect(isProtectedPath("/%2561dmin", ["/admin"], [])).toBe(true);
    expect(isProtectedPath("/admin%2Fusers", ["/admin"], [])).toBe(true);
    expect(isProtectedPath("/api/%68ealth", ["/api"], ["/api/health"])).toBe(true);
    expect(isProtectedPath("/public%2F..%2Fadmin", ["/admin"], ["/public"])).toBe(true);
    expect(isProtectedPath("/%70ublic", undefined, ["/public"])).toBe(true);
    expect(isProtectedPath("/%2570ublic", undefined, ["/public"])).toBe(true);
    expect(isProtectedPath("/%zz", ["/admin"], [])).toBe(true);
    expect(isProtectedPath("/%252525252561dmin", ["/admin"], [])).toBe(true);
    expect(isProtectedPath("/admin%5Cusers", ["/admin"], [])).toBe(true);
  });

  it("requires exclusions to match both raw and canonical path representations", () => {
    expect(isProtectedPath("/public", undefined, ["/public"])).toBe(false);
    expect(isProtectedPath("/%70ublic", undefined, [/^\/public$/u])).toBe(true);
    expect(isProtectedPath("/%70ublic", undefined, [(path) => path === "/public"])).toBe(true);
  });

  it("normalizes paths to a stable authorization representation", () => {
    expect(canonicalPathname("/%2561dmin")).toBe("/admin");
    expect(canonicalPathname("/public%2F..%2Fadmin")).toBe("/admin");
    expect(canonicalPathname("/%zz")).toBeUndefined();
    expect(canonicalPathname("/%252525252561dmin")).toBeUndefined();
    expect(canonicalPathname("/admin%5Cusers")).toBeUndefined();
    expect(canonicalPathname("/admin%3Fpublic")).toBeUndefined();
    expect(canonicalPathname(`/admin${"%23"}public`)).toBeUndefined();
    expect(canonicalPathname("/%2Fevil.test/admin")).toBeUndefined();
    expect(canonicalPathname("/admin%00public")).toBeUndefined();
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

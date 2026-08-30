import type { PathMatcher } from "./types.js";

function matches(pathname: string, matcher: PathMatcher): boolean {
  if (typeof matcher === "string") {
    if (matcher === "/") return pathname === "/";
    const prefix = matcher.endsWith("/") ? matcher.slice(0, -1) : matcher;
    return pathname === prefix || pathname.startsWith(`${prefix}/`);
  }
  if (matcher instanceof RegExp) {
    matcher.lastIndex = 0;
    return matcher.test(pathname);
  }
  return matcher(pathname);
}

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
}

function hasAmbiguousPathSyntax(pathname: string): boolean {
  return (
    /%[0-9a-f]{2}/iu.test(pathname) ||
    pathname.startsWith("//") ||
    pathname.includes("\\") ||
    pathname.includes("?") ||
    pathname.includes("#") ||
    hasControlCharacter(pathname)
  );
}

function hasUnsafeNormalizedPathSyntax(pathname: string): boolean {
  return (
    pathname.startsWith("//") ||
    pathname.includes("\\") ||
    pathname.includes("?") ||
    pathname.includes("#") ||
    hasControlCharacter(pathname)
  );
}

function normalizeLocalDestination(value: string | null | undefined): string | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  if (
    value !== value.trim() ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    hasControlCharacter(value)
  ) {
    return undefined;
  }

  try {
    const base = new URL("https://sitegate.invalid");
    const destination = new URL(value, base);
    if (
      destination.origin !== base.origin ||
      !destination.pathname.startsWith("/") ||
      destination.pathname.startsWith("//") ||
      destination.pathname.includes("\\")
    ) {
      return undefined;
    }
    const serialized = `${destination.pathname}${destination.search}${destination.hash}`;
    if (new URL(serialized, base).origin !== base.origin) return undefined;
    return serialized;
  } catch {
    return undefined;
  }
}

export function canonicalPathname(pathname: string): string | undefined {
  let canonical = pathname;
  for (let pass = 0; pass < 4; pass += 1) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(canonical);
    } catch {
      return undefined;
    }
    if (decoded === canonical) break;
    canonical = decoded;
  }

  if (hasAmbiguousPathSyntax(canonical)) return undefined;
  try {
    const base = new URL("https://sitegate.invalid");
    const normalized = new URL(canonical, base);
    if (normalized.origin !== base.origin || hasUnsafeNormalizedPathSyntax(normalized.pathname)) {
      return undefined;
    }
    return normalized.pathname;
  } catch {
    return undefined;
  }
}

export function isProtectedPath(
  pathname: string,
  protectedPaths: readonly PathMatcher[] | undefined,
  excludedPaths: readonly PathMatcher[],
): boolean {
  const canonical = canonicalPathname(pathname);
  if (canonical === undefined) return true;
  const variants = canonical === pathname ? [pathname] : [pathname, canonical];
  if (excludedPaths.some((matcher) => variants.every((variant) => matches(variant, matcher)))) {
    return false;
  }
  return (
    protectedPaths === undefined ||
    protectedPaths.some((matcher) => variants.some((variant) => matches(variant, matcher)))
  );
}

export function safeDestination(value: string | null | undefined, fallback = "/"): string {
  return normalizeLocalDestination(value) ?? normalizeLocalDestination(fallback) ?? "/";
}

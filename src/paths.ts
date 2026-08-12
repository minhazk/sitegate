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

export function isProtectedPath(
  pathname: string,
  protectedPaths: readonly PathMatcher[] | undefined,
  excludedPaths: readonly PathMatcher[],
): boolean {
  if (excludedPaths.some((matcher) => matches(pathname, matcher))) return false;
  return (
    protectedPaths === undefined || protectedPaths.some((matcher) => matches(pathname, matcher))
  );
}

export function safeDestination(value: string | null | undefined, fallback = "/"): string {
  if (value === null || value === undefined || value === "") return fallback;
  const hasControlCharacter = Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
  if (
    value !== value.trim() ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    hasControlCharacter
  ) {
    return fallback;
  }
  try {
    const base = new URL("https://sitegate.invalid");
    const destination = new URL(value, base);
    if (destination.origin !== base.origin) return fallback;
    return `${destination.pathname}${destination.search}${destination.hash}`;
  } catch {
    return fallback;
  }
}

import type { ResolvedConfig } from "./config.js";

const SESSION_COOKIE = "sitegate_session";
const SECURE_SESSION_COOKIE = "__Host-sitegate_session";
const CSRF_COOKIE = "sitegate_csrf";
const SECURE_CSRF_COOKIE = "__Host-sitegate_csrf";

export interface CookieNames {
  session: string;
  csrf: string;
  secure: boolean;
}

export function cookieNames(request: Request, config: ResolvedConfig): CookieNames {
  const secure =
    config.secureCookies === true ||
    (config.secureCookies === "auto" &&
      new URL(config.publicOrigin ?? request.url).protocol === "https:");
  return {
    session: secure ? SECURE_SESSION_COOKIE : SESSION_COOKIE,
    csrf: secure ? SECURE_CSRF_COOKIE : CSRF_COOKIE,
    secure,
  };
}

export function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie");
  if (header === null) return undefined;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const key = part.slice(0, separator).trim();
    if (key !== name) continue;
    const value = part.slice(separator + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

interface SerializeCookieOptions {
  maxAge?: number;
  secure: boolean;
  sameSite: "lax" | "strict";
}

export function serializeCookie(
  name: string,
  value: string,
  options: SerializeCookieOptions,
): string {
  const attributes = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    options.secure ? "Secure" : "",
    `SameSite=${options.sameSite === "strict" ? "Strict" : "Lax"}`,
    options.maxAge === undefined ? "" : `Max-Age=${options.maxAge}`,
  ].filter(Boolean);
  return attributes.join("; ");
}

export function expireCookie(name: string, secure: boolean, sameSite: "lax" | "strict"): string {
  return serializeCookie(name, "", { maxAge: 0, secure, sameSite });
}

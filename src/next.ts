import type { NextRequest } from "next/server.js";
import { NextResponse } from "next/server.js";
import { createSitegate } from "./gate.js";
import type { MaybePromise, SitegateConfig } from "./types.js";

export interface NextSitegateConfig extends Omit<SitegateConfig, "password" | "secret"> {
  /** Defaults to the server-only SITEGATE_PASSWORD environment variable. */
  password?: string | undefined;
  /** Defaults to the server-only SITEGATE_SECRET environment variable. */
  secret?: string | undefined;
}

/**
 * Create a Next.js request interceptor that protects every path included by the
 * consuming application's matcher. Export it as `middleware` from `middleware.ts`
 * on Next.js 14/15, or as `proxy` from `proxy.ts` on Next.js 16. Never import it
 * into a Client Component.
 */
export type SitegateNextHandler = (request: NextRequest) => Promise<Response>;

export interface SitegateNextOptions {
  /** Continue into an existing Proxy or Middleware handler after Sitegate grants access. */
  next?: (request: NextRequest) => MaybePromise<Response | undefined>;
}

function withAbsoluteRedirect(response: Response, request: NextRequest): Response {
  const location = response.headers.get("Location");
  if (location === null) return response;

  let absoluteLocation: string;
  try {
    absoluteLocation = new URL(location, request.url).toString();
  } catch {
    return response;
  }
  if (absoluteLocation === location) return response;

  const headers = new Headers(response.headers);
  headers.set("Location", absoluteLocation);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function createSitegateNext(
  config: NextSitegateConfig = {},
  adapter: SitegateNextOptions = {},
): SitegateNextHandler {
  const gate = createSitegate({
    ...config,
    password: config.password ?? process.env["SITEGATE_PASSWORD"] ?? "",
    secret: config.secret ?? process.env["SITEGATE_SECRET"] ?? "",
  });
  const next = adapter.next ?? (() => NextResponse.next());

  return async (request) =>
    withAbsoluteRedirect(
      await gate.handle(request, async () => (await next(request)) ?? NextResponse.next()),
      request,
    );
}

export const sitegate = createSitegateNext;
export const createSitegateProxy = createSitegateNext;

export type { SitegateConfig } from "./types.js";

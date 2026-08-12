import type { NextRequest } from "next/server.js";
import { NextResponse } from "next/server.js";
import { createSitegate } from "./gate.js";
import type { SitegateConfig } from "./types.js";

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

export function sitegate(options: NextSitegateConfig = {}): SitegateNextHandler {
  const gate = createSitegate({
    ...options,
    password: options.password ?? process.env["SITEGATE_PASSWORD"] ?? "",
    secret: options.secret ?? process.env["SITEGATE_SECRET"] ?? "",
  });

  return async (request) => gate.handle(request, () => NextResponse.next());
}

export const createSitegateProxy = sitegate;

export type { SitegateConfig } from "./types.js";

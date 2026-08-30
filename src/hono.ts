import type { Env, MiddlewareHandler } from "hono";
import { createSitegate } from "./gate.js";
import type { SitegateConfig } from "./types.js";

/**
 * Create Hono middleware. Register it first so Sitegate sees the original request body and wraps
 * the final downstream response.
 */
export function createSitegateHono<E extends Env = Env>(
  config: SitegateConfig,
): MiddlewareHandler<E> {
  const gate = createSitegate(config);

  return async (context, next) => {
    const result = await gate.handle(context.req.raw, async () => {
      await next();
      return context.res;
    });

    // Hono merges headers when an existing response is replaced. Clear it first so downstream
    // headers cannot overwrite Sitegate's final cache and indexing policy.
    context.res = undefined;
    context.res = result;
  };
}

export const sitegate = createSitegateHono;

export type { SitegateConfig } from "./types.js";

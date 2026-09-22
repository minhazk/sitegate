import { SitegateConfigurationError } from "./config.js";
import { createSitegate } from "./gate.js";
import type { MaybePromise, SitegateConfig } from "./types.js";

/** The request boundary used by Astro's MiddlewareHandler. */
export interface SitegateAstroContext {
  request: Request;
  isPrerendered?: boolean;
}

/** Export as onRequest in src/middleware.ts, first in sequence() when composing middleware. */
export function createSitegateAstro(config: SitegateConfig) {
  const gate = createSitegate(config);
  return (context: SitegateAstroContext, next: () => MaybePromise<Response>): Promise<Response> => {
    if (config.enabled !== false && context.isPrerendered === true) {
      throw new SitegateConfigurationError(
        'Sitegate needs an Astro server request. Set output: "server" with a server adapter and remove prerender: true from private routes. Protect static assets at the host or edge.',
      );
    }
    return gate.handle(context.request, next);
  };
}

export const sitegate = createSitegateAstro;
export type { SitegateConfig } from "./types.js";

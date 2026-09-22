import { createSitegate } from "./gate.js";
import type { MaybePromise, SitegateConfig } from "./types.js";

/** The structural server-hook boundary, compatible with SvelteKit's Handle type. */
export interface SitegateSvelteKitEvent {
  request: Request;
}

/**
 * Export from hooks.server.ts, or put first in SvelteKit's sequence().
 * Private routes must be server-rendered. Static assets and prerendered pages need a host gate.
 */
export function createSitegateSvelteKit(config: SitegateConfig) {
  const gate = createSitegate(config);
  return <Event extends SitegateSvelteKitEvent>({
    event,
    resolve,
  }: {
    event: Event;
    resolve: (event: Event) => MaybePromise<Response>;
  }): Promise<Response> => gate.handle(event.request, () => resolve(event));
}

export const sitegate = createSitegateSvelteKit;
export type { SitegateConfig } from "./types.js";

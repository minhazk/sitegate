import { type App, eventHandler } from "h3";
import { SitegateConfigurationError } from "./config.js";
import { createSitegate } from "./gate.js";
import {
  type H3SitegateOptions,
  handleH3Sitegate,
  hasH3Sitegate,
  lockH3AppHandler,
} from "./h3-internal.js";
import type { SitegateConfig } from "./types.js";

/**
 * Install Sitegate as the immutable outer handler of an H3 1.x Node-compatible application.
 * Routes may be added before or after installation, but no handler can execute before this gate.
 */
export function createSitegateH3(
  app: App,
  config: SitegateConfig,
  options: H3SitegateOptions = {},
): App {
  if (hasH3Sitegate(app)) {
    throw new SitegateConfigurationError("Sitegate is already installed on this H3 application.");
  }
  const gate = createSitegate(config);
  const disabled = config.enabled === false;
  const downstream = app.handler;
  const handler = eventHandler(async (event) => {
    if (disabled) return downstream(event);
    const result = await handleH3Sitegate(event, gate, options);
    if (result === undefined) return downstream(event);
    await event.respondWith(result);
  });
  lockH3AppHandler(app, handler);
  return app;
}

export const sitegate = createSitegateH3;

export type { H3SitegateOptions, SitegateConfig };

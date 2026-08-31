import type { App, H3Event } from "h3";
import { createSitegate } from "./gate.js";
import {
  handleH3Sitegate,
  hasH3Sitegate,
  lockH3AppHandler,
  lockH3FailureHeaders,
} from "./h3-internal.js";
import type {
  LoginAttemptLimiter,
  MaybePromise,
  RateLimitOptions,
  SitegateConfig,
  SitegateEvent,
} from "./types.js";

export interface SharedNuxtRateLimitOptions extends Omit<RateLimitOptions, "limiter"> {
  /** Nuxt deployments can span processes or regions, so the limiter must coordinate all of them. */
  limiter: LoginAttemptLimiter & { readonly scope: "shared" };
}

/** Nitro must use a shared limiter or explicitly accept unthrottled login attempts. */
export type SitegateNuxtConfig = Omit<SitegateConfig, "rateLimit"> & {
  rateLimit: false | SharedNuxtRateLimitOptions;
};

export type SitegateNuxtConfigSource =
  | SitegateNuxtConfig
  | (() => MaybePromise<SitegateNuxtConfig>);

export class SitegateNuxtConfigurationError extends Error {
  override readonly name = "SitegateNuxtConfigurationError";
}

export interface NuxtSitegateOptions {
  /** Fixed, application-owned public origin for a trusted TLS-termination topology. */
  origin?: string | URL;
}

/** Minimal structural plugin boundary; avoids coupling consumers to Sitegate's Nitro/H3 type copy. */
export interface SitegateNitroApp {
  readonly h3App: object;
}

export type SitegateNuxtPlugin = (nitro: SitegateNitroApp) => void;

function assertNuxtRateLimit(config: SitegateNuxtConfig): void {
  const rateLimit = config.rateLimit as
    | (RateLimitOptions & {
        limiter?: LoginAttemptLimiter & { readonly scope?: string };
      })
    | false
    | undefined;
  if (rateLimit === undefined) {
    throw new SitegateNuxtConfigurationError("Nuxt requires rateLimit: false or a shared limiter.");
  }
  if (rateLimit !== false && rateLimit.limiter?.scope !== "shared") {
    throw new SitegateNuxtConfigurationError(
      'Nuxt requires rateLimit.limiter.scope to be "shared".',
    );
  }
  if (
    rateLimit !== false &&
    rateLimit.trustProxy !== undefined &&
    typeof rateLimit.trustProxy !== "boolean"
  ) {
    throw new SitegateNuxtConfigurationError("Nuxt rateLimit.trustProxy must be a boolean.");
  }
}

function withNuxtLifecycle(config: SitegateNuxtConfig, event: H3Event): SitegateNuxtConfig {
  const onEvent = config.onEvent;
  if (onEvent === undefined) return config;

  return {
    ...config,
    onEvent(sitegateEvent: SitegateEvent) {
      const work = Promise.resolve()
        .then(() => onEvent(sitegateEvent))
        .then(
          () => undefined,
          () => undefined,
        );
      try {
        const requestEvent = event as H3Event & {
          waitUntil?: (promise: Promise<unknown>) => void;
        };
        if (typeof requestEvent.waitUntil === "function") {
          requestEvent.waitUntil(work);
        } else {
          const context = event.context as {
            waitUntil?: (promise: Promise<unknown>) => void;
          };
          context.waitUntil?.(work);
        }
      } catch {
        // The core also observes the returned promise, so telemetry remains best-effort.
      }
      return work;
    },
  };
}

/**
 * Create a Nitro 2 plugin. The plugin locks Sitegate around the complete H3 handler so request
 * hooks, route rules, scanned middleware, and routes cannot execute before authentication.
 */
export function createSitegateNuxt(
  config: SitegateNuxtConfigSource,
  options: NuxtSitegateOptions = {},
): SitegateNuxtPlugin {
  return (nitro) => {
    const h3App = nitro.h3App as App;
    if (hasH3Sitegate(h3App)) {
      throw new SitegateNuxtConfigurationError(
        "Sitegate is already installed on this Nitro application.",
      );
    }
    const downstream = h3App.handler;
    const handler: typeof downstream = async (event) => {
      let resolved: SitegateNuxtConfig;
      try {
        resolved = typeof config === "function" ? await config() : config;
        assertNuxtRateLimit(resolved);
        if (resolved.enabled === false) return downstream(event);
      } catch (error) {
        lockH3FailureHeaders(event);
        throw error;
      }
      let gate: ReturnType<typeof createSitegate>;
      try {
        gate = createSitegate(withNuxtLifecycle(resolved, event));
      } catch (error) {
        lockH3FailureHeaders(event);
        throw error;
      }
      const result = await handleH3Sitegate(event, gate, options);
      if (result === undefined) return downstream(event);
      await event.respondWith(result);
    };
    lockH3AppHandler(h3App, handler);
  };
}

export const sitegate = createSitegateNuxt;

export type { LoginAttemptLimiter, SitegateConfig };

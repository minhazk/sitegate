import { createSitegate } from "./gate.js";
import type {
  LoginAttemptLimiter,
  MaybePromise,
  RateLimitOptions,
  SitegateConfig,
  SitegateEvent,
} from "./types.js";

/** The lifecycle capability Sitegate uses from Cloudflare's ExecutionContext. */
export interface SitegateWorkerContext {
  waitUntil(promise: Promise<unknown>): void;
}

export interface SharedWorkerRateLimitOptions
  extends Omit<RateLimitOptions, "limiter" | "trustProxy"> {
  /** Workers are distributed, so the limiter must coordinate every relevant isolate. */
  limiter: LoginAttemptLimiter & { readonly scope: "shared" };
  /** Cloudflare callers should use an edge-controlled signal through getClientId instead. */
  trustProxy?: false;
}

/** Workers must select a shared limiter or explicitly accept unthrottled login attempts. */
export type SitegateWorkerConfig = Omit<SitegateConfig, "rateLimit"> & {
  rateLimit: false | SharedWorkerRateLimitOptions;
};

export type SitegateWorkerConfigSource<Env extends object> =
  | SitegateWorkerConfig
  | ((env: Env) => MaybePromise<SitegateWorkerConfig>);

export type SitegateWorkerFetch<
  Env extends object,
  Context extends SitegateWorkerContext = SitegateWorkerContext,
> = (request: Request, env: Env, context: Context) => MaybePromise<Response>;

export class SitegateWorkerConfigurationError extends Error {
  override readonly name = "SitegateWorkerConfigurationError";
}

function assertWorkerRateLimit(config: SitegateWorkerConfig): void {
  const rateLimit = config.rateLimit as
    | (RateLimitOptions & {
        limiter?: LoginAttemptLimiter & { readonly scope?: string };
      })
    | false
    | undefined;
  if (rateLimit === undefined) {
    throw new SitegateWorkerConfigurationError(
      "Cloudflare Workers require rateLimit: false or a shared limiter.",
    );
  }
  if (rateLimit !== false && rateLimit.limiter?.scope !== "shared") {
    throw new SitegateWorkerConfigurationError(
      'Cloudflare Workers require rateLimit.limiter.scope to be "shared".',
    );
  }
  if (rateLimit !== false && rateLimit.trustProxy !== undefined && rateLimit.trustProxy !== false) {
    throw new SitegateWorkerConfigurationError(
      "Cloudflare Workers do not accept trustProxy; provide an edge-controlled getClientId.",
    );
  }
}

function withWorkerLifecycle(
  config: SitegateWorkerConfig,
  context: SitegateWorkerContext,
): SitegateWorkerConfig {
  const onEvent = config.onEvent;
  if (onEvent === undefined) return config;

  return {
    ...config,
    onEvent(event: SitegateEvent) {
      const work = Promise.resolve()
        .then(() => onEvent(event))
        .then(
          () => undefined,
          () => undefined,
        );
      try {
        context.waitUntil(work);
      } catch {
        // The core also observes this returned promise, so telemetry remains best-effort.
      }
      return work;
    },
  };
}

/** Derive a secret-keyed client pseudonym from Cloudflare's edge-controlled visitor address. */
export async function cloudflareClientId(request: Request, secret: string): Promise<string> {
  const address = request.headers.get("cf-connecting-ip")?.trim();
  if (!address) return "unknown";
  const encoder = new TextEncoder();
  const secretBytes = encoder.encode(secret);
  if (secretBytes.byteLength < 32) {
    throw new SitegateWorkerConfigurationError(
      "cloudflareClientId requires a secret of at least 32 UTF-8 bytes.",
    );
  }
  const key = await crypto.subtle.importKey(
    "raw",
    secretBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`sitegate:cloudflare-client-id:${address}`),
  );
  return Array.from(new Uint8Array(digest).slice(0, 12), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

/**
 * Wrap a Cloudflare Worker fetch handler. Configuration is resolved per request so binding-only
 * deployments and rotated secrets cannot leave an isolate using stale derived state.
 */
export function createSitegateWorker<
  Env extends object,
  Context extends SitegateWorkerContext = SitegateWorkerContext,
>(
  config: SitegateWorkerConfigSource<Env>,
  next: SitegateWorkerFetch<Env, Context>,
): SitegateWorkerFetch<Env, Context> {
  return async (request, env, context) => {
    const resolved = typeof config === "function" ? await config(env) : config;
    assertWorkerRateLimit(resolved);
    const gate = createSitegate(withWorkerLifecycle(resolved, context));
    return gate.handle(request, () => next(request, env, context));
  };
}

export const sitegate = createSitegateWorker;

export type { LoginAttemptLimiter, SitegateConfig } from "./types.js";

import type { IncomingMessage, ServerResponse } from "node:http";
import { loadEnv, type Plugin } from "vite";
import { createSitegate } from "./gate.js";
import {
  isNodeContinuation,
  lockNodeResponseHeaders,
  nodeContinuationResponse,
  nodeWebRequest,
  sendNodeResponse,
  SitegateNodeRequestError,
} from "./node-http.js";
import { jsonError } from "./response.js";
import type { Sitegate, SitegateConfig } from "./types.js";

export interface ViteSitegateConfig extends Omit<SitegateConfig, "password" | "secret"> {
  /** Defaults to SITEGATE_PASSWORD from process.env or Vite's server-side env files. */
  password?: string | undefined;
  /** Defaults to SITEGATE_SECRET from process.env or Vite's server-side env files. */
  secret?: string | undefined;
}

type ConnectNext = (error?: unknown) => void;

function connectMiddleware(gate: Sitegate, enabled: boolean) {
  return async (request: IncomingMessage, response: ServerResponse, next: ConnectNext) => {
    if (!enabled) {
      next();
      return;
    }
    try {
      const result = await gate.handle(await nodeWebRequest(request, gate), () =>
        Promise.resolve(nodeContinuationResponse()),
      );
      if (isNodeContinuation(result)) {
        lockNodeResponseHeaders(result, response);
        next();
        return;
      }
      await sendNodeResponse(result, response);
    } catch (error) {
      if (error instanceof SitegateNodeRequestError) {
        await sendNodeResponse(jsonError("Invalid request URL.", 400), response);
        return;
      }
      next(error);
    }
  };
}

/**
 * Protect Vite's development server and local preview server. This cannot
 * protect the static files emitted by `vite build`; production protection must
 * run in the deployment host, reverse proxy, CDN, or an SSR server adapter.
 */
export function viteSitegate(options: ViteSitegateConfig = {}): Plugin {
  let gate: Sitegate | undefined;

  function requireGate(): Sitegate {
    if (gate === undefined) throw new Error("Sitegate's Vite plugin was not configured.");
    return gate;
  }

  return {
    name: "sitegate",
    apply: "serve",
    enforce: "pre",
    configResolved(config) {
      const env = loadEnv(config.mode, config.envDir, "SITEGATE_");
      gate = createSitegate({
        ...options,
        password:
          options.password ?? process.env["SITEGATE_PASSWORD"] ?? env["SITEGATE_PASSWORD"] ?? "",
        secret: options.secret ?? process.env["SITEGATE_SECRET"] ?? env["SITEGATE_SECRET"] ?? "",
      });
    },
    configureServer(server) {
      server.middlewares.use(connectMiddleware(requireGate(), options.enabled !== false));
    },
    configurePreviewServer(server) {
      server.middlewares.use(connectMiddleware(requireGate(), options.enabled !== false));
    },
  };
}

export const sitegate = viteSitegate;

export type { SitegateConfig } from "./types.js";

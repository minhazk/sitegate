import type { Request as ExpressRequest, RequestHandler } from "express";
import { createSitegate } from "./gate.js";
import {
  isNodeContinuation,
  lockNodeResponseHeaders,
  nodeContinuationResponse,
  nodeWebRequest,
  sendNodeResponse,
  SitegateNodeRequestError,
  type NodeRequestOrigin,
} from "./node-http.js";
import { jsonError } from "./response.js";
import type { SitegateConfig } from "./types.js";

export interface ExpressSitegateConfig extends Omit<SitegateConfig, "password" | "secret"> {
  /** Defaults to the server-only SITEGATE_PASSWORD environment variable. */
  password?: string | undefined;
  /** Defaults to the server-only SITEGATE_SECRET environment variable. */
  secret?: string | undefined;
}

export interface ExpressSitegateOptions {
  /** Override public-origin reconstruction for a known reverse-proxy topology. */
  origin?: NodeRequestOrigin<ExpressRequest>;
}

function defaultExpressOrigin(request: ExpressRequest): string {
  const host = request.get("host");
  if (host === undefined) throw new SitegateNodeRequestError("The request Host header is missing.");
  return `${request.protocol}://${host}`;
}

/**
 * Create Express middleware. Register it before body parsers, static files, and protected routes.
 * Express `trust proxy` must describe the real proxy topology before forwarded scheme data is used.
 */
export function createSitegateExpress(
  config: ExpressSitegateConfig = {},
  adapter: ExpressSitegateOptions = {},
): RequestHandler {
  const gate = createSitegate({
    ...config,
    password: config.password ?? process.env["SITEGATE_PASSWORD"] ?? "",
    secret: config.secret ?? process.env["SITEGATE_SECRET"] ?? "",
  });

  return (request, response, next) => {
    if (config.enabled === false) {
      next();
      return;
    }
    void (async () => {
      try {
        const result = await gate.handle(
          await nodeWebRequest(request, gate, {
            target: request.originalUrl,
            origin: adapter.origin ?? defaultExpressOrigin,
          }),
          () => Promise.resolve(nodeContinuationResponse()),
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
    })();
  };
}

export const sitegate = createSitegateExpress;

export type { SitegateConfig } from "./types.js";

import type { App, EventHandler, H3Event } from "h3";
import {
  isNodeContinuation,
  lockNodeResponseHeaders,
  nodeContinuationResponse,
  nodeWebRequest,
  SitegateNodeRequestError,
} from "./node-http.js";
import { jsonError, secureResponse } from "./response.js";
import type { Sitegate } from "./types.js";

export type H3RequestOrigin = string | URL | ((event: H3Event) => string | URL);

export interface H3SitegateOptions {
  /** Override public-origin reconstruction for a fixed, trusted reverse-proxy topology. */
  origin?: H3RequestOrigin;
}

export const H3_SITEGATE_INSTALLED = Symbol.for("sitegate.h3.installed");

type SitegateH3App = App & { [H3_SITEGATE_INSTALLED]?: true };

export function hasH3Sitegate(app: App): boolean {
  return (app as SitegateH3App)[H3_SITEGATE_INSTALLED] === true;
}

/** Make Sitegate the immutable outer handler so H3 onRequest hooks cannot run before the gate. */
export function lockH3AppHandler(app: App, handler: EventHandler): void {
  Object.defineProperty(app, "handler", {
    configurable: false,
    enumerable: true,
    value: handler,
    writable: false,
  });
  Object.defineProperty(app, H3_SITEGATE_INSTALLED, { value: true });
}

export function lockH3FailureHeaders(event: H3Event): void {
  lockNodeResponseHeaders(secureResponse(new Response(null, { status: 500 })), event.node.res);
}

async function h3WebRequest(
  event: H3Event,
  gate: Sitegate,
  options: H3SitegateOptions,
): Promise<Request> {
  if (event.web?.request !== undefined) return event.web.request;
  const origin = typeof options.origin === "function" ? options.origin(event) : options.origin;
  const target = event.node.req.originalUrl ?? event.node.req.url;
  return nodeWebRequest(event.node.req, gate, {
    ...(target === undefined ? {} : { target }),
    ...(origin === undefined ? {} : { origin }),
  });
}

/** Run Sitegate before an H3 1.x application and return undefined only for allowed requests. */
export async function handleH3Sitegate(
  event: H3Event,
  gate: Sitegate,
  options: H3SitegateOptions,
): Promise<Response | undefined> {
  try {
    const result = await gate.handle(await h3WebRequest(event, gate, options), () =>
      Promise.resolve(nodeContinuationResponse()),
    );
    lockNodeResponseHeaders(result, event.node.res);
    return isNodeContinuation(result) ? undefined : result;
  } catch (error) {
    if (error instanceof SitegateNodeRequestError) {
      const response = jsonError("Invalid request URL.", 400);
      lockNodeResponseHeaders(response, event.node.res);
      return response;
    }
    lockH3FailureHeaders(event);
    throw error;
  }
}

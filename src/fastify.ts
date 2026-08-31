import { Buffer } from "node:buffer";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest, onSendHookHandler } from "fastify";
import fastifyPlugin from "fastify-plugin";
import { createSitegate } from "./gate.js";
import {
  continuationHeaders,
  isNodeContinuation,
  lockNodeResponseHeaders,
  mergeVaryHeader,
  nodeContinuationResponse,
  nodeWebRequest,
  SitegateNodeRequestError,
} from "./node-http.js";
import { jsonError } from "./response.js";
import type { SitegateConfig } from "./types.js";

export interface FastifySitegateConfig extends Omit<SitegateConfig, "password" | "secret"> {
  /** Defaults to the server-only SITEGATE_PASSWORD environment variable. */
  password?: string | undefined;
  /** Defaults to the server-only SITEGATE_SECRET environment variable. */
  secret?: string | undefined;
  /** Override public-origin reconstruction for a known reverse-proxy topology. */
  origin?: string | URL | ((request: FastifyRequest) => string | URL);
}

async function sendFastifyResponse(response: Response, reply: FastifyReply): Promise<void> {
  lockNodeResponseHeaders(response, reply.raw);
  reply.code(response.status);
  for (const [name, value] of response.headers) {
    if (name === "set-cookie") continue;
    reply.header(name, value);
  }
  const cookies = response.headers.getSetCookie();
  if (cookies.length > 0) reply.header("set-cookie", cookies);
  if (response.body === null) {
    await reply.send();
    return;
  }
  await reply.send(Buffer.from(await response.arrayBuffer()));
}

function defaultFastifyOrigin(request: FastifyRequest): string {
  return `${request.protocol}://${request.host}`;
}

const implementation: FastifyPluginAsync<FastifySitegateConfig> = async (fastify, options) => {
  const { origin, ...config } = options;
  const gate = createSitegate({
    ...config,
    password: config.password ?? process.env["SITEGATE_PASSWORD"] ?? "",
    secret: config.secret ?? process.env["SITEGATE_SECRET"] ?? "",
  });
  const lockedByRequest = new WeakMap<FastifyRequest, ReadonlyMap<string, string>>();

  fastify.addHook("onRequest", async (request, reply) => {
    if (config.enabled === false) return;
    let result: Response;
    try {
      const requestOrigin =
        typeof origin === "function" ? origin(request) : (origin ?? defaultFastifyOrigin(request));
      result = await gate.handle(
        await nodeWebRequest(request.raw, gate, {
          target: request.originalUrl,
          origin: requestOrigin,
        }),
        () => Promise.resolve(nodeContinuationResponse()),
      );
    } catch (error) {
      if (!(error instanceof SitegateNodeRequestError)) throw error;
      await sendFastifyResponse(jsonError("Invalid request URL.", 400), reply);
      return reply;
    }
    if (isNodeContinuation(result)) {
      lockedByRequest.set(request, continuationHeaders(result));
      lockNodeResponseHeaders(result, reply.raw);
      return;
    }
    await sendFastifyResponse(result, reply);
    return reply;
  });

  const lockHeaders: onSendHookHandler = (request, reply, payload, done) => {
    const locked = lockedByRequest.get(request);
    if (locked !== undefined) {
      for (const [name, value] of locked) {
        if (name === "vary") reply.header(name, mergeVaryHeader(value, reply.getHeader(name)));
        else reply.header(name, value);
      }
    }
    done(null, payload);
  };
  fastify.addHook("onSend", lockHeaders);
};

/** Register before protected routes so the root-scoped hooks run first. */
export const fastifySitegate = fastifyPlugin(implementation, {
  name: "sitegate",
  fastify: ">=5.8.5 <6",
});

export const sitegate = fastifySitegate;

export type { SitegateConfig } from "./types.js";

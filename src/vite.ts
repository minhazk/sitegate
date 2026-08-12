import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "node:http";
import { Buffer } from "node:buffer";
import { loadEnv, type Plugin } from "vite";
import { createSitegate } from "./gate.js";
import type { Sitegate, SitegateConfig } from "./types.js";

const CONTINUE_HEADER = "x-sitegate-connect-next";
const MAX_CAPTURED_BODY_BYTES = 4097;

export interface ViteSitegateConfig extends Omit<SitegateConfig, "password" | "secret"> {
  /** Defaults to SITEGATE_PASSWORD from process.env or Vite's server-side env files. */
  password?: string | undefined;
  /** Defaults to SITEGATE_SECRET from process.env or Vite's server-side env files. */
  secret?: string | undefined;
}

type ConnectNext = (error?: unknown) => void;

function requestHeaders(source: IncomingHttpHeaders): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(source)) {
    if (value === undefined) continue;
    headers.set(name, Array.isArray(value) ? value.join(name === "cookie" ? "; " : ", ") : value);
  }
  return headers;
}

function requestUrl(request: IncomingMessage): URL {
  const encrypted =
    "encrypted" in request.socket && (request.socket as { encrypted?: boolean }).encrypted === true;
  const protocol = encrypted ? "https" : "http";
  const host = request.headers.host ?? "localhost";
  return new URL(request.url ?? "/", `${protocol}://${host}`);
}

function readBoundedBody(request: IncomingMessage): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let captured = 0;
    request.on("data", (chunk: Buffer | string) => {
      if (captured >= MAX_CAPTURED_BODY_BYTES) return;
      const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      const remaining = MAX_CAPTURED_BODY_BYTES - captured;
      const selected = bytes.subarray(0, remaining);
      chunks.push(selected);
      captured += selected.byteLength;
    });
    request.once("end", () => {
      const body = Buffer.concat(chunks);
      resolve(body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer);
    });
    request.once("error", reject);
    request.once("aborted", () => reject(new Error("Request body was aborted.")));
  });
}

async function webRequest(request: IncomingMessage, gate: Sitegate): Promise<Request> {
  const url = requestUrl(request);
  const method = request.method ?? "GET";
  const headers = requestHeaders(request.headers);
  const init: RequestInit = { method, headers };
  if (method === "POST" && url.pathname === gate.loginPath) {
    const contentLength = Number(headers.get("content-length") ?? "0");
    if (!Number.isFinite(contentLength) || contentLength <= 4096) {
      init.body = await readBoundedBody(request);
    }
  }
  return new Request(url, init);
}

function copyHeaders(response: Response, target: ServerResponse, continuation: boolean): void {
  for (const [name, value] of response.headers) {
    if (name === "set-cookie" || (continuation && name === CONTINUE_HEADER)) continue;
    target.setHeader(name, value);
  }
  const cookies = response.headers.getSetCookie();
  if (cookies.length > 0) target.setHeader("Set-Cookie", cookies);
}

function lockContinuationHeaders(source: Response, target: ServerResponse): void {
  const locked = new Map<string, string>();
  for (const [name, value] of source.headers) {
    if (name === CONTINUE_HEADER || name === "set-cookie") continue;
    locked.set(name.toLowerCase(), value);
  }

  const originalSetHeader = target.setHeader.bind(target);
  const originalRemoveHeader = target.removeHeader.bind(target);

  for (const [name, value] of locked) originalSetHeader(name, value);

  target.setHeader = ((name: string, value: number | string | readonly string[]) => {
    const normalizedName = name.toLowerCase();
    const lockedValue = locked.get(normalizedName);
    if (lockedValue === undefined) return originalSetHeader(name, value);
    if (normalizedName !== "vary") return originalSetHeader(name, lockedValue);

    const downstream = Array.isArray(value) ? value.join(", ") : String(value);
    if (downstream.trim() === "*") return originalSetHeader(name, "*");
    const values = downstream
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    if (!values.some((part) => part.toLowerCase() === "cookie")) values.push("Cookie");
    return originalSetHeader(name, values.join(", "));
  }) as ServerResponse["setHeader"];

  target.removeHeader = ((name: string) => {
    if (locked.has(name.toLowerCase())) return;
    originalRemoveHeader(name);
  }) as ServerResponse["removeHeader"];
}

async function sendResponse(response: Response, target: ServerResponse): Promise<void> {
  target.statusCode = response.status;
  if (response.statusText !== "") target.statusMessage = response.statusText;
  copyHeaders(response, target, false);
  if (response.body === null) {
    target.end();
    return;
  }
  target.end(Buffer.from(await response.arrayBuffer()));
}

function connectMiddleware(gate: Sitegate) {
  return async (request: IncomingMessage, response: ServerResponse, next: ConnectNext) => {
    try {
      const result = await gate.handle(await webRequest(request, gate), () =>
        Promise.resolve(new Response(null, { status: 204, headers: { [CONTINUE_HEADER]: "1" } })),
      );
      if (result.headers.get(CONTINUE_HEADER) === "1") {
        lockContinuationHeaders(result, response);
        next();
        return;
      }
      await sendResponse(result, response);
    } catch (error) {
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
      server.middlewares.use(connectMiddleware(requireGate()));
    },
    configurePreviewServer(server) {
      server.middlewares.use(connectMiddleware(requireGate()));
    },
  };
}

export const sitegate = viteSitegate;

export type { SitegateConfig } from "./types.js";

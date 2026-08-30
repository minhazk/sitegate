import { Buffer } from "node:buffer";
import type {
  IncomingHttpHeaders,
  IncomingMessage,
  OutgoingHttpHeader,
  OutgoingHttpHeaders,
  ServerResponse,
} from "node:http";
import { canonicalPathname } from "./paths.js";
import type { Sitegate } from "./types.js";

const CONTINUE_HEADER = "x-sitegate-node-next";
const MAX_LOGIN_BODY_BYTES = 4096;
const MAX_CAPTURED_BODY_BYTES = MAX_LOGIN_BODY_BYTES + 1;

export type NodeRequestOrigin<T extends IncomingMessage = IncomingMessage> =
  | string
  | URL
  | ((request: T) => string | URL);

export interface NodeWebRequestOptions<T extends IncomingMessage = IncomingMessage> {
  target?: string;
  origin?: NodeRequestOrigin<T>;
  captureLoginBody?: boolean;
}

export class SitegateNodeRequestError extends Error {
  override readonly name = "SitegateNodeRequestError";
}

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
}

function requestHeaders(source: IncomingHttpHeaders): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(source)) {
    if (value === undefined || name.startsWith(":")) continue;
    headers.set(name, Array.isArray(value) ? value.join(name === "cookie" ? "; " : ", ") : value);
  }
  return headers;
}

function socketOrigin(request: IncomingMessage): string {
  const encrypted =
    "encrypted" in request.socket && (request.socket as { encrypted?: boolean }).encrypted === true;
  const host = request.headers.host;
  if (host === undefined) throw new SitegateNodeRequestError("The request Host header is missing.");
  return `${encrypted ? "https" : "http"}://${host}`;
}

function normalizedOrigin(value: string | URL): URL {
  let origin: URL;
  try {
    origin = new URL(value);
  } catch {
    throw new SitegateNodeRequestError("The request origin is malformed.");
  }
  if (
    (origin.protocol !== "http:" && origin.protocol !== "https:") ||
    origin.username !== "" ||
    origin.password !== "" ||
    origin.pathname !== "/" ||
    origin.search !== "" ||
    origin.hash !== ""
  ) {
    throw new SitegateNodeRequestError("The request origin must be an HTTP(S) origin.");
  }
  return origin;
}

function requestUrl<T extends IncomingMessage>(request: T, options: NodeWebRequestOptions<T>): URL {
  const target = options.target ?? request.url ?? "/";
  if (
    !target.startsWith("/") ||
    target.includes("\\") ||
    target.includes("#") ||
    hasControlCharacter(target)
  ) {
    throw new SitegateNodeRequestError("The HTTP request target is malformed.");
  }

  const configuredOrigin =
    typeof options.origin === "function" ? options.origin(request) : options.origin;
  const origin = normalizedOrigin(configuredOrigin ?? socketOrigin(request));
  try {
    return new URL(`${origin.origin}${target}`);
  } catch {
    throw new SitegateNodeRequestError("The HTTP request target is malformed.");
  }
}

async function readBoundedBody(request: IncomingMessage): Promise<ArrayBuffer> {
  const chunks: Buffer[] = [];
  let captured = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    const remaining = MAX_CAPTURED_BODY_BYTES - captured;
    const selected = bytes.subarray(0, remaining);
    chunks.push(selected);
    captured += selected.byteLength;
    if (captured >= MAX_CAPTURED_BODY_BYTES) {
      request.resume();
      break;
    }
  }
  const body = Buffer.concat(chunks);
  return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer;
}

export async function nodeWebRequest<T extends IncomingMessage>(
  request: T,
  gate: Sitegate,
  options: NodeWebRequestOptions<T> = {},
): Promise<Request> {
  const url = requestUrl(request, options);
  const method = request.method ?? "GET";
  const headers = requestHeaders(request.headers);
  const init: RequestInit = { method, headers };
  if (
    options.captureLoginBody !== false &&
    method === "POST" &&
    canonicalPathname(url.pathname) === gate.loginPath
  ) {
    const contentLength = Number(headers.get("content-length") ?? "0");
    if (Number.isFinite(contentLength) && contentLength > MAX_LOGIN_BODY_BYTES) {
      request.resume();
    } else {
      init.body = await readBoundedBody(request);
    }
  }
  return new Request(url, init);
}

export function nodeContinuationResponse(): Response {
  return new Response(null, { status: 204, headers: { [CONTINUE_HEADER]: "1" } });
}

export function isNodeContinuation(response: Response): boolean {
  return response.headers.get(CONTINUE_HEADER) === "1";
}

export function continuationHeaders(response: Response): ReadonlyMap<string, string> {
  const locked = new Map<string, string>();
  for (const [name, value] of response.headers) {
    if (name === CONTINUE_HEADER || name === "set-cookie") continue;
    locked.set(name.toLowerCase(), value);
  }
  return locked;
}

export function mergeVaryHeader(lockedValue: string, downstreamValue: unknown): string {
  const downstream = Array.isArray(downstreamValue)
    ? downstreamValue.join(", ")
    : String(downstreamValue ?? "");
  if (downstream.trim() === "*") return "*";
  const values = downstream
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  for (const required of lockedValue
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)) {
    if (!values.some((part) => part.toLowerCase() === required.toLowerCase()))
      values.push(required);
  }
  return values.join(", ");
}

export function lockNodeResponseHeaders(
  source: Response | ReadonlyMap<string, string>,
  target: ServerResponse,
): void {
  const locked = source instanceof Response ? continuationHeaders(source) : source;
  const originalSetHeader = target.setHeader.bind(target);
  const originalAppendHeader = target.appendHeader.bind(target);
  const originalRemoveHeader = target.removeHeader.bind(target);
  const originalWriteHead = target.writeHead.bind(target);

  for (const [name, value] of locked) originalSetHeader(name, value);

  target.setHeader = ((name: string, value: number | string | readonly string[]) => {
    const normalizedName = name.toLowerCase();
    const lockedValue = locked.get(normalizedName);
    if (lockedValue === undefined) return originalSetHeader(name, value);
    if (normalizedName !== "vary") return originalSetHeader(name, lockedValue);
    return originalSetHeader(name, mergeVaryHeader(lockedValue, value));
  }) as ServerResponse["setHeader"];

  target.appendHeader = ((name: string, value: readonly string[] | string) => {
    const normalizedName = name.toLowerCase();
    const lockedValue = locked.get(normalizedName);
    if (lockedValue === undefined) return originalAppendHeader(name, value);
    if (normalizedName !== "vary") return originalSetHeader(name, lockedValue);
    return originalSetHeader(
      name,
      mergeVaryHeader(lockedValue, [target.getHeader(name), value].flat()),
    );
  }) as ServerResponse["appendHeader"];

  target.removeHeader = ((name: string) => {
    if (locked.has(name.toLowerCase())) return;
    originalRemoveHeader(name);
  }) as ServerResponse["removeHeader"];

  function lockedWriteHeadHeaders(
    headers: OutgoingHttpHeader[] | OutgoingHttpHeaders,
  ): OutgoingHttpHeader[] | OutgoingHttpHeaders {
    if (Array.isArray(headers)) {
      const safe: OutgoingHttpHeader[] = [];
      let downstreamVary: OutgoingHttpHeader | undefined;
      for (let index = 0; index < headers.length; index += 2) {
        const name = String(headers[index]);
        const value = headers[index + 1];
        const normalizedName = name.toLowerCase();
        if (!locked.has(normalizedName) && value !== undefined) {
          safe.push(name, value);
        } else if (normalizedName === "vary") {
          downstreamVary = value;
        }
      }
      for (const [name, value] of locked) {
        safe.push(name, name === "vary" ? mergeVaryHeader(value, downstreamVary) : value);
      }
      return safe;
    }

    const safe: OutgoingHttpHeaders = { ...headers };
    for (const [name, value] of locked) {
      const downstreamName = Object.keys(safe).find(
        (candidate) => candidate.toLowerCase() === name,
      );
      const downstreamValue = downstreamName === undefined ? undefined : safe[downstreamName];
      if (downstreamName !== undefined && downstreamName !== name) delete safe[downstreamName];
      safe[name] = name === "vary" ? mergeVaryHeader(value, downstreamValue) : value;
    }
    return safe;
  }

  function restoreStoredHeaders(): void {
    for (const [name, value] of locked) {
      originalSetHeader(
        name,
        name === "vary" ? mergeVaryHeader(value, target.getHeader(name)) : value,
      );
    }
  }

  target.writeHead = ((
    statusCode: number,
    statusMessageOrHeaders?: string | OutgoingHttpHeader[] | OutgoingHttpHeaders,
    headers?: OutgoingHttpHeader[] | OutgoingHttpHeaders,
  ) => {
    restoreStoredHeaders();
    if (typeof statusMessageOrHeaders === "string") {
      return headers === undefined
        ? originalWriteHead(statusCode, statusMessageOrHeaders)
        : originalWriteHead(statusCode, statusMessageOrHeaders, lockedWriteHeadHeaders(headers));
    }
    return statusMessageOrHeaders === undefined
      ? originalWriteHead(statusCode)
      : originalWriteHead(statusCode, lockedWriteHeadHeaders(statusMessageOrHeaders));
  }) as ServerResponse["writeHead"];
}

function copyResponseHeaders(response: Response, target: ServerResponse): void {
  for (const [name, value] of response.headers) {
    if (name === "set-cookie" || name === CONTINUE_HEADER) continue;
    target.setHeader(name, value);
  }
  const cookies = response.headers.getSetCookie();
  if (cookies.length > 0) target.setHeader("Set-Cookie", cookies);
}

export async function sendNodeResponse(response: Response, target: ServerResponse): Promise<void> {
  target.statusCode = response.status;
  if (response.statusText !== "") target.statusMessage = response.statusText;
  copyResponseHeaders(response, target);
  if (response.body === null) {
    target.end();
    return;
  }
  target.end(Buffer.from(await response.arrayBuffer()));
}

import { resolveConfig } from "./config.js";
import { cookieNames, expireCookie, readCookie, serializeCookie } from "./cookies.js";
import { createCryptoService } from "./crypto.js";
import { canonicalPathname, isProtectedPath, safeDestination } from "./paths.js";
import { createMemoryRateLimiter, defaultClientId } from "./rate-limit.js";
import { jsonError, redirect, secureResponse } from "./response.js";
import type {
  LoginAttemptLimiter,
  RateLimitDecision,
  Sitegate,
  SitegateConfig,
  SitegateEvent,
} from "./types.js";
import { type LoginPageStatus, loginPage } from "./ui.js";

const MAX_LOGIN_BODY_BYTES = 16 * 1024;

async function readLoginBody(request: Request): Promise<string | undefined> {
  const reader = request.body?.getReader();
  if (reader === undefined) return "";

  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_LOGIN_BODY_BYTES) {
        try {
          await reader.cancel("Login request is too large.");
        } catch {
          // The size limit is already enforced even if the runtime cannot cancel the source.
        }
        return undefined;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

function appendSetCookie(response: Response, value: string): void {
  response.headers.append("Set-Cookie", value);
}

function requestDestination(request: Request): string {
  const url = new URL(request.url);
  return `${url.pathname}${url.search}`;
}

function acceptsHtml(request: Request): boolean {
  return (request.headers.get("accept") ?? "").includes("text/html");
}

function sourceHeadersAllowRequest(
  request: Request,
  allowMissing: boolean,
  publicOrigin?: string,
): boolean {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site" || fetchSite === "same-site") return false;

  const target = new URL(publicOrigin ?? request.url).origin;
  let hasSourceHeader = false;

  const origin = request.headers.get("origin");
  if (origin !== null) {
    hasSourceHeader = true;
    // Privacy policies can serialize a real same-origin form's Origin as "null".
    // Fetch Metadata is browser-controlled; opaque cross-site/sandboxed forms still fail.
    const trustedNavigation =
      origin === "null" &&
      fetchSite === "same-origin" &&
      request.headers.get("sec-fetch-mode") === "navigate" &&
      request.headers.get("sec-fetch-dest") === "document";
    if (origin !== target && !trustedNavigation) return false;
  }

  const referer = request.headers.get("referer");
  if (referer !== null) {
    hasSourceHeader = true;
    try {
      if (new URL(referer).origin !== target) return false;
    } catch {
      return false;
    }
  }

  return hasSourceHeader || fetchSite === "same-origin" || (allowMissing && fetchSite === null);
}

function emit(handler: SitegateConfig["onEvent"], event: SitegateEvent): void {
  if (handler === undefined) return;
  try {
    void Promise.resolve(handler(event)).catch(() => {});
  } catch {
    // Security behavior must not depend on telemetry availability.
  }
}

export function createSitegate(input: SitegateConfig): Sitegate {
  const config = resolveConfig(input);
  const cryptoService = createCryptoService(
    config.enabled ? config.secret : "sitegate-disabled-signing-key-000000",
    config.password,
  );
  const rateOptions = config.rateLimit === false ? undefined : config.rateLimit;
  const defaultGlobalMaxAttempts = rateOptions?.globalMaxAttempts ?? 200;
  const hasTrustedClientIdentity =
    rateOptions?.getClientId !== undefined || rateOptions?.trustProxy === true;
  const limiter: LoginAttemptLimiter | undefined =
    rateOptions === undefined
      ? undefined
      : (rateOptions.limiter ??
        createMemoryRateLimiter({
          maxAttempts:
            rateOptions.maxAttempts ?? (hasTrustedClientIdentity ? 10 : defaultGlobalMaxAttempts),
          globalMaxAttempts: defaultGlobalMaxAttempts,
          windowSeconds: rateOptions.windowSeconds ?? 15 * 60,
        }));

  function loginDestination(value: string | null): string {
    const destination = safeDestination(value);
    const pathname = canonicalPathname(new URL(destination, "https://sitegate.invalid").pathname);
    return pathname === config.loginPath || pathname === config.logoutPath ? "/" : destination;
  }

  async function getClientId(request: Request): Promise<string> {
    if (rateOptions?.getClientId !== undefined) return rateOptions.getClientId(request);
    return defaultClientId(request, rateOptions?.trustProxy ?? false);
  }

  async function isAuthenticated(request: Request): Promise<boolean> {
    if (!config.enabled) return true;
    const names = cookieNames(request, config);
    const token = readCookie(request, names.session);
    if (token === undefined || token.length > 4096) return false;
    const valid = await cryptoService.verifySession(token, config.now());
    if (!valid) emit(config.onEvent, { type: "invalid_session" });
    return valid;
  }

  async function renderLogin(
    request: Request,
    destination: string,
    error?: string,
    status?: LoginPageStatus,
    retryAfterSeconds?: number,
  ): Promise<Response> {
    const names = cookieNames(request, config);
    const existingNonce = readCookie(request, names.csrf);
    // Keep open forms usable across tabs/retries; the signed token still expires after 10 minutes.
    const nonce =
      existingNonce !== undefined &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(existingNonce)
        ? existingNonce
        : crypto.randomUUID();
    const response = loginPage({
      config,
      csrfToken: await cryptoService.createCsrf(nonce, config.now()),
      destination,
      ...(error === undefined ? {} : { error }),
      ...(status === undefined ? {} : { status }),
      ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
    });
    appendSetCookie(
      response,
      serializeCookie(names.csrf, nonce, {
        maxAge: 10 * 60,
        secure: names.secure,
        sameSite: config.sameSite,
      }),
    );
    return response;
  }

  async function handleLogin(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const destination = loginDestination(url.searchParams.get("next"));
    const requestError = (message: string, status: 400 | 403 | 413) =>
      acceptsHtml(request)
        ? renderLogin(
            request,
            destination,
            status === 403 ? config.strings.invalidRequest : config.strings.invalidForm,
            status,
          )
        : jsonError(message, status);
    if (request.method === "GET") {
      if (await isAuthenticated(request)) return redirect(destination);
      return renderLogin(request, destination);
    }
    if (request.method !== "POST") return jsonError("Method not allowed.", 405);
    if (!sourceHeadersAllowRequest(request, true, config.publicOrigin)) {
      return requestError("Cross-site login request rejected.", 403);
    }
    // A second tab may still show a form after another tab has signed in.
    if (await isAuthenticated(request)) return redirect(destination);

    const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
    if (contentType !== "application/x-www-form-urlencoded") {
      return requestError("Expected an HTML form submission.", 400);
    }
    const contentLength = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(contentLength) && contentLength > MAX_LOGIN_BODY_BYTES) {
      try {
        await request.body?.cancel("Login request is too large.");
      } catch {
        // The declared-size rejection does not depend on cancellation support.
      }
      return requestError("Login request is too large.", 413);
    }
    const body = await readLoginBody(request);
    if (body === undefined) {
      return requestError("Login request is too large.", 413);
    }
    const form = new URLSearchParams(body);
    const submittedDestination = loginDestination(form.get("next") ?? url.searchParams.get("next"));
    const names = cookieNames(request, config);
    const csrfCookie = readCookie(request, names.csrf);
    const csrfToken = form.get("csrf");
    if (
      csrfCookie === undefined ||
      csrfToken === null ||
      !(await cryptoService.verifyCsrf(csrfToken, csrfCookie, config.now()))
    ) {
      return renderLogin(
        request,
        submittedDestination,
        csrfCookie === undefined ? config.strings.cookiesRequired : config.strings.expiredForm,
        403,
      );
    }

    let clientId: string;
    let limit: RateLimitDecision | undefined;
    try {
      clientId = await getClientId(request);
      limit = await limiter?.consume(clientId, config.now());
    } catch {
      emit(config.onEvent, { type: "login_unavailable" });
      return renderLogin(request, submittedDestination, config.strings.unavailable, 503);
    }
    if (limit?.limited === true) {
      emit(config.onEvent, { type: "login_rate_limited", clientId });
      const response = await renderLogin(
        request,
        submittedDestination,
        config.strings.rateLimited,
        429,
        limit.retryAfterSeconds,
      );
      if (limit.retryAfterSeconds !== undefined) {
        response.headers.set("Retry-After", String(limit.retryAfterSeconds));
      }
      return response;
    }

    const password = form.get("password") ?? "";
    if (password.length > 1024 || !(await cryptoService.verifyPassword(password))) {
      emit(config.onEvent, { type: "login_failed", clientId });
      return renderLogin(request, submittedDestination, config.strings.incorrectPassword);
    }

    try {
      await limiter?.reset(clientId);
    } catch {
      emit(config.onEvent, { type: "login_unavailable" });
      return renderLogin(request, submittedDestination, config.strings.unavailable, 503);
    }
    emit(config.onEvent, { type: "login_succeeded", clientId });
    const response = redirect(submittedDestination);
    appendSetCookie(
      response,
      serializeCookie(
        names.session,
        await cryptoService.createSession(config.now(), config.sessionDuration),
        {
          maxAge: config.sessionDuration,
          secure: names.secure,
          sameSite: config.sameSite,
        },
      ),
    );
    appendSetCookie(response, expireCookie(names.csrf, names.secure, config.sameSite));
    return response;
  }

  async function handleLogout(request: Request): Promise<Response> {
    if (request.method !== "POST") return jsonError("Method not allowed.", 405);
    if (!sourceHeadersAllowRequest(request, false, config.publicOrigin)) {
      return jsonError("Cross-site logout request rejected.", 403);
    }
    const names = cookieNames(request, config);
    const response = redirect(config.loginPath);
    appendSetCookie(response, expireCookie(names.session, names.secure, config.sameSite));
    appendSetCookie(response, expireCookie(names.csrf, names.secure, config.sameSite));
    emit(config.onEvent, { type: "logout" });
    return response;
  }

  return {
    loginPath: config.loginPath,
    logoutPath: config.logoutPath,
    isAuthenticated,
    async handle(request, next) {
      if (!config.enabled) return next();
      const rawPathname = new URL(request.url).pathname;
      const pathname = canonicalPathname(rawPathname);
      if (pathname === undefined) return jsonError("Authentication required.", 401);
      if (pathname === config.loginPath) return handleLogin(request);
      if (pathname === config.logoutPath) return handleLogout(request);
      if (!isProtectedPath(rawPathname, config.protectedPaths, config.excludedPaths)) {
        return secureResponse(await next());
      }
      if (await isAuthenticated(request)) return secureResponse(await next());
      if (request.method === "GET" && acceptsHtml(request)) {
        const login = new URL(config.loginPath, request.url);
        login.searchParams.set("next", requestDestination(request));
        return redirect(`${login.pathname}${login.search}`, 307);
      }
      return jsonError("Authentication required.", 401);
    },
  };
}

import { cookieNames, expireCookie, readCookie, serializeCookie } from "./cookies.js";
import { resolveConfig } from "./config.js";
import { createCryptoService } from "./crypto.js";
import { isProtectedPath, safeDestination } from "./paths.js";
import { createMemoryRateLimiter, defaultClientId } from "./rate-limit.js";
import { jsonError, redirect, secureResponse } from "./response.js";
import type { LoginAttemptLimiter, Sitegate, SitegateConfig, SitegateEvent } from "./types.js";
import { loginPage } from "./ui.js";

const MAX_LOGIN_BODY_BYTES = 4096;

function appendSetCookie(response: Response, value: string): void {
  response.headers.append("Set-Cookie", value);
}

function requestDestination(request: Request): string {
  const url = new URL(request.url);
  return `${url.pathname}${url.search}`;
}

function acceptsHtml(request: Request): boolean {
  return request.method === "GET" && (request.headers.get("accept") ?? "").includes("text/html");
}

function sameOrigin(request: Request): boolean {
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  const target = new URL(request.url).origin;
  const source = request.headers.get("origin");
  if (source !== null) return source === target;
  const referer = request.headers.get("referer");
  if (referer === null) return false;
  try {
    return new URL(referer).origin === target;
  } catch {
    return false;
  }
}

async function emit(handler: SitegateConfig["onEvent"], event: SitegateEvent): Promise<void> {
  try {
    await handler?.(event);
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
    if (!valid) await emit(config.onEvent, { type: "invalid_session" });
    return valid;
  }

  async function renderLogin(
    request: Request,
    destination: string,
    error?: string,
    status?: 200 | 401 | 403 | 429,
  ): Promise<Response> {
    const names = cookieNames(request, config);
    const nonce = crypto.randomUUID();
    const response = loginPage({
      config,
      csrfToken: await cryptoService.createCsrf(nonce, config.now()),
      destination,
      ...(error === undefined ? {} : { error }),
      ...(status === undefined ? {} : { status }),
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
    const destination = safeDestination(url.searchParams.get("next"));
    if (request.method === "GET") {
      if (await isAuthenticated(request)) return redirect(destination);
      return renderLogin(request, destination);
    }
    if (request.method !== "POST") return jsonError("Method not allowed.", 405);
    if (!sameOrigin(request)) return jsonError("Cross-site login request rejected.", 403);

    const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
    if (contentType !== "application/x-www-form-urlencoded") {
      return jsonError("Expected an HTML form submission.", 400);
    }
    const contentLength = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(contentLength) && contentLength > MAX_LOGIN_BODY_BYTES) {
      return jsonError("Login request is too large.", 413);
    }
    const body = await request.text();
    if (new TextEncoder().encode(body).byteLength > MAX_LOGIN_BODY_BYTES) {
      return jsonError("Login request is too large.", 413);
    }
    const form = new URLSearchParams(body);
    const submittedDestination = safeDestination(form.get("next"));
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
        "Login form expired. Reload the page and try again.",
        403,
      );
    }

    const clientId = await getClientId(request);
    const limit = await limiter?.check(clientId, config.now());
    if (limit?.limited === true) {
      await emit(config.onEvent, { type: "login_rate_limited", clientId });
      const response = await renderLogin(
        request,
        submittedDestination,
        "Too many login attempts. Try again later.",
        429,
      );
      if (limit.retryAfterSeconds !== undefined) {
        response.headers.set("Retry-After", String(limit.retryAfterSeconds));
      }
      return response;
    }

    const password = form.get("password") ?? "";
    if (password.length > 1024 || !(await cryptoService.verifyPassword(password))) {
      await limiter?.recordFailure(clientId, config.now());
      await emit(config.onEvent, { type: "login_failed", clientId });
      return renderLogin(request, submittedDestination, "That password is not correct.");
    }

    await limiter?.reset(clientId);
    await emit(config.onEvent, { type: "login_succeeded", clientId });
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
    if (!sameOrigin(request)) return jsonError("Cross-site logout request rejected.", 403);
    const names = cookieNames(request, config);
    const response = redirect(config.loginPath);
    appendSetCookie(response, expireCookie(names.session, names.secure, config.sameSite));
    appendSetCookie(response, expireCookie(names.csrf, names.secure, config.sameSite));
    await emit(config.onEvent, { type: "logout" });
    return response;
  }

  return {
    loginPath: config.loginPath,
    logoutPath: config.logoutPath,
    isAuthenticated,
    async handle(request, next) {
      if (!config.enabled) return next();
      const pathname = new URL(request.url).pathname;
      if (pathname === config.loginPath) return handleLogin(request);
      if (pathname === config.logoutPath) return handleLogout(request);
      if (!isProtectedPath(pathname, config.protectedPaths, config.excludedPaths)) {
        return secureResponse(await next());
      }
      if (await isAuthenticated(request)) return secureResponse(await next());
      if (acceptsHtml(request)) {
        const login = new URL(config.loginPath, request.url);
        login.searchParams.set("next", requestDestination(request));
        return redirect(`${login.pathname}${login.search}`, 307);
      }
      return jsonError("Authentication required.", 401);
    },
  };
}

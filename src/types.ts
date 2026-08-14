export type MaybePromise<T> = T | Promise<T>;

export type PathMatcher = string | RegExp | ((pathname: string) => boolean);

export type SitegateSameSite = "lax" | "strict";

export type SitegateEvent =
  | { type: "login_succeeded"; clientId: string }
  | { type: "login_failed"; clientId: string }
  | { type: "login_rate_limited"; clientId: string }
  | { type: "invalid_session" }
  | { type: "logout" };

export interface RateLimitDecision {
  limited: boolean;
  retryAfterSeconds?: number;
}

/**
 * Pluggable login-attempt limiter. Implement this with a shared store when an
 * application runs in multiple regions or processes.
 */
export interface LoginAttemptLimiter {
  /** Storage scope. Set `shared` only when all application instances coordinate this limiter. */
  readonly scope?: "process" | "shared";
  /** Atomically admit and provisionally record one login attempt. */
  consume(clientId: string, now: number): MaybePromise<RateLimitDecision>;
  /** Clear this client's entries from every relevant bucket after successful authentication. */
  reset(clientId: string): MaybePromise<void>;
}

export interface RateLimitOptions {
  /** Attempts allowed per client. Successful attempts are cleared. */
  maxAttempts?: number;
  /** Attempts allowed globally. Successful attempts are cleared. Default: 200. */
  globalMaxAttempts?: number;
  /** Rolling-window duration in seconds. Default: 900 (15 minutes). */
  windowSeconds?: number;
  /** Use a deployment-specific shared limiter. Required in recognized serverless runtimes. */
  limiter?: LoginAttemptLimiter;
  /** Derive a non-sensitive client key. Do not return raw secrets or cookie values. */
  getClientId?: (request: Request) => MaybePromise<string>;
  /** Trust the first X-Forwarded-For/X-Real-IP value. Only enable behind a trusted proxy. */
  trustProxy?: boolean;
}

export interface SitegateBranding {
  /** Product or client name shown above the form. Default: "Sitegate". */
  siteName?: string;
  /** Main login heading. Default: "This site is private". */
  title?: string;
  /** Supporting copy below the heading. */
  description?: string;
  /** Root-relative image URL, for example `/brand/logo.svg`. */
  logo?: string;
  /** Six-digit CSS hex color. Default: `#635bff`. */
  accentColor?: string;
}

export interface SitegateConfig {
  /** Shared password. Must contain at least 12 Unicode characters when enabled. */
  password: string;
  /** Signing secret. Must contain at least 32 UTF-8 bytes when enabled. */
  secret: string;
  /** Turn protection on or off without removing integration code. Default: true. */
  enabled?: boolean;
  /** Absolute session lifetime in seconds. Default: 28,800 (8 hours). */
  sessionDuration?: number;
  /** Built-in login endpoint. Default: `/_sitegate/login`. */
  loginPath?: string;
  /** Built-in logout endpoint. Default: `/_sitegate/logout`. */
  logoutPath?: string;
  /** Protect only matching paths. Omit to protect everything. */
  protectedPaths?: readonly PathMatcher[];
  /** Paths that bypass authentication. Login/logout endpoints are always handled. */
  excludedPaths?: readonly PathMatcher[];
  /** Secure cookie behavior. Default: `auto` (HTTPS requests only). */
  secureCookies?: boolean | "auto";
  /** Session and CSRF cookie SameSite value. Default: `strict`. */
  sameSite?: SitegateSameSite;
  /**
   * Login-attempt limiting. Set `false` for zero-infrastructure mode: Sitegate creates no limiter
   * and the host accepts responsibility for password guessing and login-endpoint abuse.
   */
  rateLimit?: false | RateLimitOptions;
  branding?: SitegateBranding;
  /** Receives best-effort, non-blocking security events without passwords, secrets, or tokens. */
  onEvent?: (event: SitegateEvent) => MaybePromise<void>;
  /** Test/support hook for supplying time. */
  now?: () => number;
}

export interface Sitegate {
  /**
   * Handle an incoming request. `next` is called only when the request may
   * continue to the protected application.
   */
  handle(request: Request, next: () => MaybePromise<Response>): Promise<Response>;
  /** Verify a request's session without rendering or redirecting. */
  isAuthenticated(request: Request): Promise<boolean>;
  readonly loginPath: string;
  readonly logoutPath: string;
}

import type { PathMatcher, SitegateBranding, SitegateConfig, SitegateSameSite } from "./types.js";

export interface ResolvedConfig {
  password: string;
  secret: string;
  enabled: boolean;
  sessionDuration: number;
  loginPath: string;
  logoutPath: string;
  protectedPaths: readonly PathMatcher[] | undefined;
  excludedPaths: readonly PathMatcher[];
  secureCookies: boolean | "auto";
  sameSite: SitegateSameSite;
  rateLimit: SitegateConfig["rateLimit"];
  branding: Required<Omit<SitegateBranding, "logo">> & Pick<SitegateBranding, "logo">;
  onEvent: SitegateConfig["onEvent"];
  now: () => number;
}

const DEFAULT_DESCRIPTION = "Enter the shared password to continue.";

export class SitegateConfigurationError extends Error {
  override readonly name = "SitegateConfigurationError";
}

function assertInternalPath(value: string, field: string): void {
  if (
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("?") ||
    value.includes("#")
  ) {
    throw new SitegateConfigurationError(
      `${field} must be a root-relative path without a query or hash.`,
    );
  }
}

export function resolveConfig(config: SitegateConfig): ResolvedConfig {
  const enabled = config.enabled ?? true;
  const loginPath = config.loginPath ?? "/_sitegate/login";
  const logoutPath = config.logoutPath ?? "/_sitegate/logout";

  assertInternalPath(loginPath, "loginPath");
  assertInternalPath(logoutPath, "logoutPath");
  if (loginPath === logoutPath) {
    throw new SitegateConfigurationError("loginPath and logoutPath must be different.");
  }

  if (enabled) {
    if ([...config.password].length < 12) {
      throw new SitegateConfigurationError(
        "password must contain at least 12 characters when Sitegate is enabled.",
      );
    }
    if (new TextEncoder().encode(config.secret).byteLength < 32) {
      throw new SitegateConfigurationError(
        "secret must contain at least 32 UTF-8 bytes when Sitegate is enabled.",
      );
    }
    if (config.password === config.secret) {
      throw new SitegateConfigurationError("password and secret must be different values.");
    }
  }

  const sessionDuration = config.sessionDuration ?? 8 * 60 * 60;
  if (
    !Number.isSafeInteger(sessionDuration) ||
    sessionDuration < 60 ||
    sessionDuration > 30 * 24 * 60 * 60
  ) {
    throw new SitegateConfigurationError(
      "sessionDuration must be an integer from 60 to 2,592,000 seconds.",
    );
  }

  if (config.rateLimit !== false) {
    const maxAttempts = config.rateLimit?.maxAttempts ?? 10;
    const globalMaxAttempts = config.rateLimit?.globalMaxAttempts ?? 200;
    const windowSeconds = config.rateLimit?.windowSeconds ?? 15 * 60;
    if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10_000) {
      throw new SitegateConfigurationError(
        "rateLimit.maxAttempts must be an integer from 1 to 10,000.",
      );
    }
    if (
      !Number.isSafeInteger(globalMaxAttempts) ||
      globalMaxAttempts < 1 ||
      globalMaxAttempts > 100_000
    ) {
      throw new SitegateConfigurationError(
        "rateLimit.globalMaxAttempts must be an integer from 1 to 100,000.",
      );
    }
    if (!Number.isSafeInteger(windowSeconds) || windowSeconds < 1 || windowSeconds > 86_400) {
      throw new SitegateConfigurationError(
        "rateLimit.windowSeconds must be an integer from 1 to 86,400.",
      );
    }
  }

  const accentColor = config.branding?.accentColor ?? "#635bff";
  if (!/^#[0-9a-f]{6}$/iu.test(accentColor)) {
    throw new SitegateConfigurationError("branding.accentColor must be a six-digit hex color.");
  }
  const logo = config.branding?.logo;
  if (
    logo !== undefined &&
    (!logo.startsWith("/") || logo.startsWith("//") || logo.includes("\\"))
  ) {
    throw new SitegateConfigurationError("branding.logo must be a root-relative URL.");
  }
  const logoPath =
    logo === undefined ? undefined : new URL(logo, "https://sitegate.invalid").pathname;

  return {
    password: config.password,
    secret: config.secret,
    enabled,
    sessionDuration,
    loginPath,
    logoutPath,
    protectedPaths: config.protectedPaths,
    excludedPaths: [
      ...(config.excludedPaths ?? []),
      ...(logoPath === undefined ? [] : [(pathname: string) => pathname === logoPath]),
    ],
    secureCookies: config.secureCookies ?? "auto",
    sameSite: config.sameSite ?? "strict",
    rateLimit: config.rateLimit === undefined ? {} : config.rateLimit,
    branding: {
      siteName: config.branding?.siteName ?? "Sitegate",
      title: config.branding?.title ?? "This site is private",
      description: config.branding?.description ?? DEFAULT_DESCRIPTION,
      ...(logo === undefined ? {} : { logo }),
      accentColor,
    },
    onEvent: config.onEvent,
    now: config.now ?? Date.now,
  };
}

import type {
  PathMatcher,
  SitegateBranding,
  SitegateConfig,
  SitegateSameSite,
  SitegateStrings,
} from "./types.js";
import { canonicalPathname } from "./paths.js";

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
  strings: Required<SitegateStrings>;
  onEvent: SitegateConfig["onEvent"];
  now: () => number;
}

const DEFAULT_DESCRIPTION = "Enter the shared password to continue.";
const DEFAULT_STRINGS: Required<SitegateStrings> = {
  language: "en",
  passwordLabel: "Password",
  submitLabel: "Continue",
  footerText: "Protected by Sitegate",
  incorrectPassword: "That password is not correct.",
  expiredForm: "Login form expired. Reload the page and try again.",
  rateLimited: "Too many login attempts. Try again later.",
};

export class SitegateConfigurationError extends Error {
  override readonly name = "SitegateConfigurationError";
}

function runsOnKnownMultiInstanceRuntime(): boolean {
  const runtime = globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> };
  };
  const environment = runtime.process?.env;
  if (environment === undefined) return false;

  return (
    environment["AWS_LAMBDA_FUNCTION_NAME"] !== undefined ||
    environment["AWS_EXECUTION_ENV"]?.startsWith("AWS_Lambda_") === true ||
    environment["VERCEL"] === "1" ||
    environment["NETLIFY"] === "true" ||
    environment["FUNCTION_TARGET"] !== undefined ||
    environment["K_SERVICE"] !== undefined ||
    environment["WEBSITE_INSTANCE_ID"] !== undefined
  );
}

function assertInternalPath(value: string, field: string): void {
  if (
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("?") ||
    value.includes("#") ||
    canonicalPathname(value) !== value
  ) {
    throw new SitegateConfigurationError(
      `${field} must be a root-relative path without a query or hash.`,
    );
  }
}

export function resolveConfig(config: SitegateConfig): ResolvedConfig {
  if (config.enabled !== undefined && typeof config.enabled !== "boolean") {
    throw new SitegateConfigurationError("enabled must be a boolean.");
  }
  if (
    config.secureCookies !== undefined &&
    config.secureCookies !== "auto" &&
    typeof config.secureCookies !== "boolean"
  ) {
    throw new SitegateConfigurationError('secureCookies must be true, false, or "auto".');
  }
  if (config.sameSite !== undefined && config.sameSite !== "lax" && config.sameSite !== "strict") {
    throw new SitegateConfigurationError('sameSite must be "lax" or "strict".');
  }
  if (
    config.rateLimit !== undefined &&
    config.rateLimit !== false &&
    (typeof config.rateLimit !== "object" ||
      config.rateLimit === null ||
      Array.isArray(config.rateLimit))
  ) {
    throw new SitegateConfigurationError("rateLimit must be false or an options object.");
  }
  if (
    config.rateLimit !== undefined &&
    config.rateLimit !== false &&
    config.rateLimit.trustProxy !== undefined &&
    typeof config.rateLimit.trustProxy !== "boolean"
  ) {
    throw new SitegateConfigurationError("rateLimit.trustProxy must be a boolean.");
  }
  const enabled = config.enabled ?? true;
  const loginPath = config.loginPath ?? "/_sitegate/login";
  const logoutPath = config.logoutPath ?? "/_sitegate/logout";

  assertInternalPath(loginPath, "loginPath");
  assertInternalPath(logoutPath, "logoutPath");
  if (loginPath === logoutPath) {
    throw new SitegateConfigurationError("loginPath and logoutPath must be different.");
  }

  if (enabled) {
    if ([...config.password].length < 1) {
      throw new SitegateConfigurationError(
        "password must contain at least 1 character when Sitegate is enabled.",
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
    if (
      enabled &&
      config.rateLimit?.limiter?.scope !== "shared" &&
      runsOnKnownMultiInstanceRuntime()
    ) {
      throw new SitegateConfigurationError(
        'Process-local rate limiting is unsafe in this serverless runtime. Configure rateLimit.limiter with a shared limiter whose scope is "shared", or set rateLimit to false only when equivalent rate limiting is enforced outside Sitegate.',
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
    (!logo.startsWith("/") ||
      logo.startsWith("//") ||
      logo.includes("\\") ||
      logo.includes("?") ||
      logo.includes("#") ||
      canonicalPathname(logo) !== logo)
  ) {
    throw new SitegateConfigurationError(
      "branding.logo must be a root-relative path without a query or hash.",
    );
  }
  const language = config.strings?.language ?? DEFAULT_STRINGS.language;
  if (!/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/iu.test(language) || language.length > 35) {
    throw new SitegateConfigurationError(
      "strings.language must be a valid language tag such as en, de, or en-GB.",
    );
  }
  return {
    password: config.password,
    secret: config.secret,
    enabled,
    sessionDuration,
    loginPath,
    logoutPath,
    protectedPaths: config.protectedPaths,
    excludedPaths: config.excludedPaths ?? [],
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
    strings: {
      language,
      passwordLabel: config.strings?.passwordLabel ?? DEFAULT_STRINGS.passwordLabel,
      submitLabel: config.strings?.submitLabel ?? DEFAULT_STRINGS.submitLabel,
      footerText: config.strings?.footerText ?? DEFAULT_STRINGS.footerText,
      incorrectPassword: config.strings?.incorrectPassword ?? DEFAULT_STRINGS.incorrectPassword,
      expiredForm: config.strings?.expiredForm ?? DEFAULT_STRINGS.expiredForm,
      rateLimited: config.strings?.rateLimited ?? DEFAULT_STRINGS.rateLimited,
    },
    onEvent: config.onEvent,
    now: config.now ?? Date.now,
  };
}

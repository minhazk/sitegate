# Changelog

All notable changes to Sitegate will be documented here. The project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) and the structure from
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [0.5.1] - 2026-09-09

### Fixed

- Allow Node.js 20 and newer without an upper version limit instead of restricting consumers to
  Node.js 24. Individual framework requirements still apply.
- Add built-package authentication and Node HTTP compatibility checks across Node.js 20, 22, 24,
  and 26, including the minimum supported release.

## [0.5.0] - 2026-08-31

### Added

- Add an H3 1.15 adapter for Node-compatible servers with bounded login-body conversion, untouched
  downstream streams, final raw-response header locking, and isolated compatibility coverage.
- Add a Nuxt 3–4 / Nitro 2 server-plugin adapter with per-request private configuration resolution,
  best-effort event work, shared-limiter enforcement, and production-server compatibility fixtures.

### Security

- Lock H3 and Nuxt Sitegate handlers around the complete H3 application so `onRequest`/Nitro
  request hooks, route-rule redirects/proxies, scanned middleware, and routes cannot run first.
- Require Nuxt deployments to explicitly disable throttling or attest that their limiter is shared,
  preventing a fresh per-request memory limiter from silently resetting attempt history.
- Lock security headers across H3/Nitro continuations, terminal responses, and error handling while
  rejecting malformed raw request targets before protected handlers execute.
- Detect duplicate Nitro plugin installation and keep resolver/configuration failures fail-closed.
- Strictly reject malformed untyped enablement, cookie-policy, rate-limit, and proxy-trust values
  instead of coercing a security configuration.

## [0.4.0] - 2026-08-30

### Added

- Add a Hono 4 middleware adapter with original-request handling, final-response replacement,
  streaming/error coverage, and isolated Hono 4.0 and current Hono compatibility fixtures.
- Add a Cloudflare Workers fetch wrapper with binding-derived per-request configuration, exact
  request/environment/context forwarding, and real workerd integration coverage.
- Add `cloudflareClientId` for secret-keyed client pseudonyms derived from Cloudflare's
  edge-controlled visitor-address header.

### Security

- Require Workers callers to explicitly disable login throttling or provide a limiter marked as
  shared; process-local rate history is rejected at both the type and runtime boundaries.
- Reject generic proxy-header trust in the Workers adapter and provide a secret-keyed helper for
  Cloudflare's edge-controlled visitor address instead.
- Register best-effort asynchronous security events with the request's `waitUntil` context without
  mutating shared configuration or mixing concurrent request lifecycles.
- Harden mutable responses in place so Cloudflare WebSocket and manual-encoding extensions survive,
  while retaining a clone fallback for responses with immutable headers.
- Document first/root Hono registration and `assets.run_worker_first` as required routing controls
  that prevent application or static-asset paths from bypassing the gate.

## [0.3.0] - 2026-08-30

### Added

- Add an Express adapter for Express 4.22.2 through 5, including full login/session integration,
  bounded login-body handling, error middleware continuation, and isolated compatibility fixtures.
- Add a root-scoped Fastify 5 plugin with nested-plugin coverage, pre-parser login handling, native
  error integration, multiple-cookie support, and an isolated compatibility fixture.
- Add shared, fail-closed Node request conversion and response utilities reused by Express,
  Fastify, and Vite.

### Security

- Lock cache, cookie-variance, and anti-indexing headers through direct Node `writeHead` calls and
  late Fastify `onSend` hooks so downstream code cannot weaken an authenticated response.
- Reject malformed request targets and public-origin overrides before the protected application is
  invoked, while bounding login streams at 4,097 captured bytes.

### Fixed

- Make disabled Vite protection bypass request conversion entirely, preserving malformed or
  hostless requests for the downstream development server just like the other adapters.

## [0.2.3] - 2026-08-30

### Security

- Revalidate canonical paths after URL normalization so encoded separators and dot segments cannot
  bypass selective `protectedPaths` policies in Vite or another normalizing downstream server.
- Revalidate normalized login destinations before emitting `Location`, preventing dot segments
  from creating an external network-path redirect.
- Replace full-array rate-limit history copies with bounded queues and indexed client records, so
  maximum supported windows and saturated rejections remain amortized constant-time.
- Split release validation and npm publication into separate least-privilege jobs, transfer one
  checksummed immutable tarball, and publish only that artifact from the OIDC-enabled job.

### Changed

- Remove the unused `SITEGATE_ENABLED` example variable; callers continue to pass `enabled`
  explicitly in adapter configuration.
- Clarify the deliberate shared-budget behavior of the default untrusted-proxy rate limiter.

## [0.2.2] - 2026-08-23

### Changed

- Lower the enabled shared-password minimum from 12 Unicode characters to 1, leaving password
  strength policy to the consuming application while continuing to reject an empty password.

### Fixed

- Allow login requests with no `Origin`, `Referer`, or `Sec-Fetch-Site` headers to reach the signed
  CSRF-cookie and CSRF-token validation, while continuing to reject explicit cross-site, same-site,
  malformed, and mismatched source signals.

## [0.2.1] - 2026-08-23

### Fixed

- Accept legitimate same-origin login and logout requests when browsers omit both `Origin` and
  `Referer` but send `Sec-Fetch-Site: same-origin`, while retaining strict source-header and CSRF
  validation.

## [0.2.0] - 2026-08-14

### Added

- Add `createSitegateNext(config, { next })` so the Next.js adapter composes with an existing Proxy
  or Middleware continuation.
- Add escaped built-in-page string customization for language, password and submit labels, footer,
  incorrect-password, expired-form, and rate-limit messages.
- Add an SST/OpenNext deployment guide covering matcher scope, deployment-stage propagation, and
  live gate verification.

### Fixed

- Resolve every Next.js adapter redirect against `request.url`, preventing OpenNext/SST deployments
  from rejecting relative unauthenticated, successful-login, and logout `Location` headers.

### Changed

- Explain optional peer dependencies, the host framework security boundary, current patched Next.js
  lines, and the risks of matcher exclusions.

## [0.1.3] - 2026-08-14

### Added

- Document zero-infrastructure `rateLimit: false` mode, which creates no in-process limiter and
  requires no database, Redis instance, or hosted service.
- Regression coverage for fully disabled rate limiting and developer-provided
  `LoginAttemptLimiter` implementations.

### Changed

- Clarify the security and compute-abuse tradeoff when login throttling is disabled and that
  Sitegate never bundles provider-specific rate-limit adapters.

## [0.1.2] - 2026-08-13

### Security

- Clear a successful client's provisional entries from both per-client and global attempt budgets,
  so repeated successful authentication cannot exhaust the global bucket.
- Refuse the process-local limiter in recognized multi-instance serverless runtimes, including AWS
  Lambda, unless the application supplies a limiter explicitly marked `scope: "shared"` or relies
  on equivalent external rate limiting.
- Retain canonical matching across raw and decoded path representations for selective
  `protectedPaths` policies.

## [0.1.1] - 2026-08-13

### Security

- Canonicalize percent-encoded request paths before selective route matching.
- Reject ambiguous encoded path representations and normalize route policy against a stable path.
- Require public exclusions to match both raw and canonical request-path representations.
- Stop branding configuration from implicitly exposing the configured logo path; public logos now
  require an explicit path exclusion.
- Bound and cancel oversized streaming login requests before buffering the full body.
- Atomically admit login attempts and document the contract for shared limiters.
- Keep authentication responses independent of slow or failing event handlers.
- Canonicalize Vite login aliases and drain declared-oversized transport bodies before responding.
- Pin privileged GitHub Actions dependencies to immutable commit SHAs.
- Bind npm publication to a matching version tag descended from the protected main branch.

### Changed

- Clarify that Sitegate can protect trusted-group sites on production infrastructure while remaining
  distinct from per-user application authentication and authorization.

## [0.1.0] - 2026-08-12

### Added

- Framework-neutral TypeScript request gate.
- Next.js 14–16 Middleware/Proxy adapter with isolated compatibility fixtures.
- Vite 6–8 development and local-preview server adapter.
- Signed sessions, signed login CSRF tokens, hardened cookies, and logout.
- Dependency-free login page with safe branding.
- Route policy, security headers, indexing protection, and pluggable rate limiting.
- Unit, integration, security, and bypass tests.

### Changed

- Require Node.js 24 LTS and run CI and release workflows on its supported action runtime.

[Unreleased]: https://github.com/minhazk/sitegate/compare/v0.5.1...HEAD
[0.5.1]: https://github.com/minhazk/sitegate/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/minhazk/sitegate/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/minhazk/sitegate/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/minhazk/sitegate/compare/v0.2.3...v0.3.0
[0.2.3]: https://github.com/minhazk/sitegate/compare/v0.2.2...v0.2.3
[0.2.2]: https://github.com/minhazk/sitegate/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/minhazk/sitegate/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/minhazk/sitegate/compare/v0.1.3...v0.2.0
[0.1.3]: https://github.com/minhazk/sitegate/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/minhazk/sitegate/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/minhazk/sitegate/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/minhazk/sitegate/releases/tag/v0.1.0

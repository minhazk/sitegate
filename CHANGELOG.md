# Changelog

All notable changes to Sitegate will be documented here. The project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) and the structure from
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

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

[Unreleased]: https://github.com/minhazk/sitegate/compare/v0.2.2...HEAD
[0.2.2]: https://github.com/minhazk/sitegate/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/minhazk/sitegate/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/minhazk/sitegate/compare/v0.1.3...v0.2.0
[0.1.3]: https://github.com/minhazk/sitegate/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/minhazk/sitegate/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/minhazk/sitegate/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/minhazk/sitegate/releases/tag/v0.1.0

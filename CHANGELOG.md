# Changelog

All notable changes to Sitegate will be documented here. The project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) and the structure from
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

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

[Unreleased]: https://github.com/minhazk/sitegate/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/minhazk/sitegate/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/minhazk/sitegate/releases/tag/v0.1.0

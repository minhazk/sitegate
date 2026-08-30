# Sitegate threat model

## Goal and security boundary

Sitegate provides one coarse-grained, shared-password boundary around a site shared by one trusted
group. The boundary is the server request interception layer. An unauthenticated request must
not reach a protected page, API, handler, or asset even when the requester bypasses the UI and sends
HTTP directly.

The consuming application's Proxy, Middleware, or server-plugin registration and deployment routing
are part of the trusted computing base. Sitegate cannot protect a request that the platform routes
around it.

## Assets

- Content and endpoints in the protected deployment.
- The configured shared password.
- The session signing secret.
- Authenticated session tokens.
- Availability of the login endpoint.
- Integrity and provenance of the published npm tarball.

## Attacker capabilities

An unauthenticated remote attacker may:

- discover every deployment URL;
- inspect HTML, CSS, JavaScript, headers, and cookies returned to their browser;
- address page and API paths directly with arbitrary HTTP methods and bodies;
- alter, truncate, replay, or forge cookie and JWT values;
- submit cross-site forms and manipulate redirect parameters;
- repeatedly guess the shared password;
- send malformed, oversized, or duplicated input;
- spoof forwarding headers unless a trusted edge normalizes them.

The expected deployment uses HTTPS. The origin host, build pipeline, dependencies, source repository,
deployment account, and server environment are trusted.

## Controls

| Threat | Control |
| --- | --- |
| Frontend-only bypass | Authentication occurs before the protected application continuation; non-HTML endpoints receive `401`. |
| Password disclosure | Server-only configuration; no password/secret claims, HTML, client script, or event fields. |
| Timing comparison | Native Web Crypto HMAC verification over domain-separated password input. |
| Token forgery or algorithm confusion | `jose` HS256 signatures; fixed algorithm allow-list; issuer, audience, type, expiry, issued-at, and ID validation. |
| Session fixation | A fresh random session ID and new signed token are issued after authentication; the pre-session CSRF cookie is deleted. |
| Stale sessions after password rotation | The session signing key is derived from both the independent secret and current password. |
| Cookie theft from script | `HttpOnly`; `Secure` on HTTPS; host-only `__Host-` names; no `Domain`; `Path=/`. |
| Login CSRF | `SameSite=Strict` by default; Fetch Metadata and exact Origin/Referer validation; signed, cookie-bound, expiring login-form token. |
| Logout CSRF | POST-only endpoint plus `SameSite=Strict`, Fetch Metadata, and exact Origin/Referer validation. Logout does not accept the login-form token as a substitute for source validation. |
| Path-policy ambiguity | Encoded input is decoded to a bounded depth and ambiguous syntax is rejected both before and after URL normalization; exclusions must match raw and canonical representations. |
| Open redirect | Only root-relative destinations that remain local after final URL normalization and reparsing are accepted. |
| Brute force | Rolling per-client and global queue-based attempt buckets; successful reservations clear from both; pluggable shared limiter; generic `429`. |
| Sensitive caching | `Cache-Control: private, no-store, max-age=0` and `Vary: Cookie` on all responses while enabled. |
| Accidental indexing | `X-Robots-Tag` on every enabled response plus login-page robots metadata. |
| Login-page injection | All text/attributes escaped; colors and logo URLs constrained; restrictive CSP; no JavaScript. |
| Oversized input | Form content type required; body capped at 4 KiB; password capped at 1,024 characters. |
| Node adapter bypass | Express, Fastify, and Vite reconstruct a validated HTTP(S) URL from the raw target, reject malformed or ambiguous targets before continuation, and consume only bounded login bodies. |
| Downstream header weakening | Node response setters, removals, direct `writeHead` calls, and late Fastify send hooks cannot replace Sitegate's cache, cookie-variance, or anti-indexing headers. |
| Hono middleware bypass | The Hono adapter uses the original raw request and must be registered first and root-scoped; it clears Hono's previous response before installing the final secured response. |
| Worker isolate-local throttling | The Workers adapter requires either explicit unthrottled operation or a caller-supplied limiter attested as shared; it never silently creates per-request or per-isolate rate history. |
| Worker binding and lifecycle confusion | Worker configuration is resolved for each request without mutating shared objects; the exact environment and context continue downstream, and event work is attached to that request's `waitUntil`. |
| Worker response-extension loss | Mutable application responses are secured in place, retaining Worker WebSocket and encoding behavior; immutable network responses use a standards-compatible clone. |
| OpenNext redirect handling | The Next.js adapter resolves Sitegate and continuation `Location` headers against the incoming request URL before returning them to the host. |
| Release artifact substitution | Validation/build runs without OIDC, produces one checksummed immutable tarball, and transfers it to an isolated publisher that has no checkout and publishes only that tarball with lifecycle scripts disabled. |

## Residual risks and deliberate limitations

- This is one shared identity. Sitegate cannot attribute actions to a person or apply permissions.
- A copied session is a bearer token. Logout clears browser state but cannot revoke that copy without
  a database. Password or secret rotation revokes all tokens.
- Stateless sessions enforce an absolute timeout, not an idle timeout.
- The default in-memory limiter is neither durable nor globally coordinated. Recognized serverless
  runtimes reject it; scaled deployments must configure a coordinated control or explicitly disable
  rate limiting and accept the residual risk.
- Without a trusted client identity, the default limiter intentionally shares one 200-attempt
  budget across all requesters. One requester can temporarily exhaust new-login capacity; existing
  sessions remain valid. Trust forwarding headers only behind an edge that overwrites them.
- When `rateLimit: false`, login submissions have no brute-force or compute-abuse throttle. Sitegate
  still validates origin, CSRF, body size, and passwords, but the host explicitly accepts the
  remaining availability and password-guessing risk.
- A distributed attacker can still consume login capacity or attempt guesses across many instances.
- Application XSS can perform same-origin actions using the victim's browser even though it cannot
  read an `HttpOnly` cookie.
- `noindex` is advisory and does not make a hostname secret.
- A CDN, alternate origin, preview bypass, stale public cache, or incorrect matcher can route around
  the gate. Deployment verification is required.
- Next.js/OpenNext/SST Proxy or Middleware execution and the public origin reconstructed in
  `request.url` are trusted host inputs. Keep the framework and adapter patched and reject untrusted
  host headers at the public edge.
- The Vite plugin protects HTTP requests in development and local preview only. A static Vite build
  has no authentication server, and HMR WebSocket traffic is outside the plugin's HTTP middleware
  boundary.
- Express and Fastify trust the host framework's resolved public protocol and host. Incorrect proxy
  trust can produce insecure cookies or source-check failures; configure the actual proxy topology
  or use a fixed application-owned origin, never an arbitrary client-supplied forwarding value.
- Register Express before body parsers/static middleware and register Fastify on the root instance
  before protected routes. Earlier middleware or host routing remains outside Sitegate's boundary.
- Register Hono Sitegate middleware first and root-scoped. A route or outer middleware that returns
  before it reaches Sitegate is outside the boundary; on Workers, use the outer Worker wrapper when
  secrets or lifecycle work come from request-scoped bindings and execution context.
- Cloudflare static assets must run the Worker first. A platform route or asset binding configured
  to answer before the Worker is outside Sitegate's boundary.
- The Workers adapter treats a caller-supplied `scope: "shared"` marker as an attestation; Sitegate
  cannot prove that the limiter's storage and atomic operations really span every relevant isolate.
- Fetched responses with immutable headers must be cloned to add mandatory security headers. Test
  any specialized upstream runtime behavior that depends on response identity or host extensions.
- Sitegate does not add HSTS because TLS topology and preload/subdomain policy belong to the host.
- Release security still depends on repository/tag governance, GitHub environment protection, and
  the npm trusted-publisher identity accepting only the intended workflow and environment.

## Security design references

- [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)
- [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
- [OWASP CSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)
- [OWASP HTTP Headers Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Headers_Cheat_Sheet.html)
- [OWASP Bot Management and Anti-Automation Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Bot_Management_and_Anti-Automation_Cheat_Sheet.html)
- [Next.js 16 Proxy documentation](https://nextjs.org/docs/app/api-reference/file-conventions/proxy)
- [Next.js authentication guidance](https://nextjs.org/docs/app/guides/authentication)
- [Vite Plugin API](https://vite.dev/guide/api-plugin.html)
- [Vite static deployment guidance](https://vite.dev/guide/static-deploy.html)
- [Express middleware guide](https://expressjs.com/en/guide/using-middleware.html)
- [Express behind proxies](https://expressjs.com/en/guide/behind-proxies.html)
- [Fastify hooks](https://fastify.dev/docs/latest/Reference/Hooks/)
- [Fastify plugins](https://fastify.dev/docs/latest/Guides/Plugins-Guide/)
- [Hono middleware](https://hono.dev/docs/guides/middleware)
- [Cloudflare Workers best practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/)
- [Cloudflare execution context](https://developers.cloudflare.com/workers/runtime-apis/context/)
- [Cloudflare static assets](https://developers.cloudflare.com/workers/static-assets/binding/)
- [GitHub Actions OIDC reference](https://docs.github.com/en/actions/reference/security/oidc)
- [pnpm publish](https://pnpm.io/cli/publish)
- [Web Crypto `SubtleCrypto.verify`](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/verify)

This design uses established platform primitives and `jose`; it does not define a new cryptographic
algorithm.

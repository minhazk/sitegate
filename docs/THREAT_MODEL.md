# Sitegate threat model

## Goal and security boundary

Sitegate provides one coarse-grained, shared-password boundary around a non-production web
application. The boundary is the server request interception layer. An unauthenticated request must
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
| CSRF login/logout | `SameSite=Strict` by default; Fetch Metadata and exact Origin/Referer validation; signed, cookie-bound, expiring login token; state changes use POST. |
| Open redirect | Only normalized root-relative paths without authorities, backslashes, whitespace, or controls are accepted. |
| Brute force | Rolling per-client and global failure buckets; pluggable shared limiter; generic `429`. |
| Sensitive caching | `Cache-Control: private, no-store, max-age=0` and `Vary: Cookie` on all responses while enabled. |
| Accidental indexing | `X-Robots-Tag` on every enabled response plus login-page robots metadata. |
| Login-page injection | All text/attributes escaped; colors and logo URLs constrained; restrictive CSP; no JavaScript. |
| Oversized input | Form content type required; body capped at 4 KiB; password capped at 1,024 characters. |

## Residual risks and deliberate limitations

- This is one shared identity. Sitegate cannot attribute actions to a person or apply permissions.
- A copied session is a bearer token. Logout clears browser state but cannot revoke that copy without
  a database. Password or secret rotation revokes all tokens.
- Stateless sessions enforce an absolute timeout, not an idle timeout.
- The default in-memory limiter is neither durable nor globally coordinated. Scaled deployments
  need the pluggable limiter and/or an edge rate limit.
- A distributed attacker can still consume login capacity or attempt guesses across many instances.
- Application XSS can perform same-origin actions using the victim's browser even though it cannot
  read an `HttpOnly` cookie.
- `noindex` is advisory and does not make a hostname secret.
- A CDN, alternate origin, preview bypass, stale public cache, or incorrect matcher can route around
  the gate. Deployment verification is required.
- The Vite plugin protects HTTP requests in development and local preview only. A static Vite build
  has no authentication server, and HMR WebSocket traffic is outside the plugin's HTTP middleware
  boundary.
- Sitegate does not add HSTS because TLS topology and preload/subdomain policy belong to the host.

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
- [Web Crypto `SubtleCrypto.verify`](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/verify)

This design uses established platform primitives and `jose`; it does not define a new cryptographic
algorithm.

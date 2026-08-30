# Design research

Research was completed on 11 August 2026 before Sitegate's initial architecture was finalized. The
review covered current platform/security guidance and the published artifacts of representative
packages; Sitegate is an independent implementation.

## Existing package review

### `staging-next` 0.0.4

The [published Next.js adapter](https://www.npmjs.com/package/staging-next) was downloaded from npm
and its ESM artifact inspected.

- It returns responses from Next.js request interception and provides a built-in login flow.
- Its default matcher/public-route setup excludes framework static/image paths and other assets.
- Cookies are `HttpOnly`, `SameSite=Lax`, and marked `Secure` according to `NODE_ENV` rather than the
  observed request scheme.
- When a JWT secret is not supplied, the adapter generates one during initialization. That avoids a
  literal default key, but separately initialized processes may not share sessions.
- The adapter accepts JSON and form login bodies. No body cap, CSRF check, or attempt limiter is
  visible in the adapter artifact; some behavior is delegated to its `staging` core dependency.

Sitegate therefore requires stable explicit signing configuration, protects all matched resource
types, derives cookie security from the request by default, caps login input, and makes CSRF and
throttling behavior part of the visible core.

### `@charamza/next-password-protect` 0.0.1-development

The [published package](https://www.npmjs.com/package/@charamza/next-password-protect) and its ESM
handlers were inspected.

- It uses a React higher-order component that calls a password-check API. Consumers must separately
  wire login/logout/check endpoints, and the UI layer does not itself protect arbitrary direct API
  requests.
- Password comparison uses `safe-compare` and the cookie is `HttpOnly`.
- The JWT is signed directly with the shared password and the inspected sign call does not add an
  expiry claim. Cookie expiry is configurable separately.
- `SameSite` defaults off and `Secure` defaults from `NODE_ENV`.
- The published artifact includes bundled copies of its dependency tree and React UI code.

Sitegate separates password and signing secret, enforces absolute token expiry, defaults to strict
same-site host cookies, intercepts server requests, and renders a no-JavaScript login page.

## Next.js guidance

Current [Next.js Proxy documentation](https://nextjs.org/docs/app/api-reference/file-conventions/proxy)
confirms that Next.js 16 renamed `middleware.ts` to `proxy.ts`, Proxy runs before routes render, it
can produce a response directly, and it uses the Node.js runtime. Next.js 14 and 15 use
`middleware.ts`; Node.js runtime support became stable in 15.5. Next.js also recommends keeping
interception checks optimistic and cookie-based rather than performing slow data access on every
request.

Sitegate's adapter consequently returns a structural request handler that works under the differing
Next.js 14–16 exported type names, validates a self-contained signed cookie, does no database/network
access, and leaves the matcher's static declaration in the consuming application. Isolated consumers
pin and smoke-test Next.js 14.2.35, 15.5.22, and 16.2.12 with their required file conventions.

## Vite guidance

Vite's [Plugin API](https://vite.dev/guide/api-plugin.html) provides `configureServer` and
`configurePreviewServer` hooks for adding Connect middleware to its development and preview HTTP
servers. Sitegate registers the same request gate in both hooks; isolated consumers pin and
smoke-test Vite 6.4.3, 7.3.6, and 8.2.1.

Vite's [static deployment guidance](https://vite.dev/guide/static-deploy.html) says `vite preview` is
for local preview and is not designed as a production server. A `vite build` output is only static
assets, so the plugin cannot accompany those files into production. Production static deployments
must enforce authentication in the host, CDN, reverse proxy, server, or edge boundary.

## Security guidance

The design maps to these primary references:

- [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html): generic errors and login throttling.
- [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html): unpredictable sessions, hardened cookies, fixation resistance, and absolute expiry.
- [OWASP CSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html): same-origin validation, Fetch Metadata, signed cookie-bound tokens, and POST state changes.
- [OWASP Bot Management and Anti-Automation Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Bot_Management_and_Anti-Automation_Cheat_Sheet.html): independent per-client/global login buckets and explicit distributed-limiter limitations.
- [OWASP HTTP Headers Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Headers_Cheat_Sheet.html): `no-store`, anti-indexing, content sniffing, and framing controls.
- [Web Crypto HMAC verification](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/verify): native verification instead of a JavaScript string comparison.

The resulting decisions and residual risk are recorded in [the threat model](THREAT_MODEL.md).

## Release integrity guidance

GitHub documents that `id-token: write` enables OIDC token issuance for the job where it is granted,
so Sitegate keeps repository checkout, tests, builds, and packing in a job without that permission.
The current official artifact actions provide an immutable cross-job artifact; both actions are
pinned to full commit SHAs. The packaging job records a SHA-256 digest and the isolated publisher
verifies it before publication.

The [pnpm publish documentation](https://pnpm.io/cli/publish) accepts a tarball path. Sitegate
therefore publishes the transferred `.tgz` rather than asking the OIDC-enabled job to pack a mutable
checkout again, and disables package lifecycle scripts at both pack and publish time. See GitHub's
[OIDC permission reference](https://docs.github.com/en/actions/reference/security/oidc) and the
official [artifact upload](https://github.com/actions/upload-artifact) and
[artifact download](https://github.com/actions/download-artifact) repositories.

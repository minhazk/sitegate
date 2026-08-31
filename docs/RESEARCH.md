# Design research

Research was completed on 11 August 2026 before Sitegate's initial architecture was finalized and
expanded on 30 August 2026 for the provider adapters. The review covered current platform/security
guidance and the published artifacts of representative packages; Sitegate is an independent
implementation.

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

## Express guidance

Express's [middleware guide](https://expressjs.com/en/guide/using-middleware.html) defines
application middleware as an ordered stack and requires `next()` to continue. Sitegate therefore
returns a conventional request handler, stops the stack when it emits login or denial responses,
and must be registered before parsers, static files, and protected routers. The adapter catches its
asynchronous work explicitly so the same implementation forwards errors to both Express 4 and
Express 5 error middleware.

Express's [proxy guidance](https://expressjs.com/en/guide/behind-proxies.html) documents that
`request.protocol` and related values can use forwarded headers when `trust proxy` is enabled.
Sitegate uses Express's resolved protocol and host by default, leaves proxy trust to the
application, and accepts an explicit application-owned origin for unusual topologies. Isolated
consumers pin and smoke-test Express 4.22.2 with `@types/express` 4.17.25 and Express 5.2.1 with
`@types/express` 5.0.6.

## Fastify guidance

Fastify's [hook reference](https://fastify.dev/docs/latest/Reference/Hooks/) places `onRequest`
before body parsing and allows a hook to reply before the route runs. Sitegate uses that boundary
to inspect only its own login submission and to deny unauthenticated requests before parsing or
handlers. A final response lock covers route-level hooks that run after shared `onSend` hooks.

Fastify's [plugin guide](https://fastify.dev/docs/latest/Guides/Plugins-Guide/) explains its
encapsulation model. The exported adapter uses `fastify-plugin` so registration on the root instance
protects later routes and nested plugins. The isolated consumer pins Fastify 5.12.1, while the peer
range begins at the verified 5.8.5 API floor.

## Hono guidance

Hono's [middleware guide](https://hono.dev/docs/guides/middleware) defines ordered middleware and
documents clearing `c.res` before replacing a response when previous headers must not be merged.
Sitegate uses that exact replacement sequence after the downstream chain completes, because a
normal Hono assignment could merge a route's public cache or indexing headers over the gate's final
policy. Hono's [request API](https://hono.dev/docs/api/request#raw) exposes the original web-standard
`Request`, which keeps core path and bounded-body handling independent of Hono's routed path view.

The adapter is generic over Hono's `Env`, imports framework types only, and is smoke-tested against
Hono 4.0.0 and 4.13.5. The static adapter must be registered first and root-scoped. For Hono running
on Cloudflare, the outer Workers wrapper is the supported binding-derived configuration and
execution-lifecycle boundary.

## Cloudflare Workers guidance

Cloudflare's [Workers best practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/)
warn against mutable request-specific global state because isolates can serve concurrent requests.
The Sitegate wrapper consequently resolves configuration and creates derived gate state per request,
copies rather than mutates shared configuration, and forwards the exact request, environment, and
context objects to the application.

The [execution-context API](https://developers.cloudflare.com/workers/runtime-apis/context/)
requires background work to be passed to `waitUntil`. Sitegate binds each request's best-effort
event promise to that context while retaining its receiver and handling both synchronous and
asynchronous telemetry failures. The wrapper never calls `passThroughOnException`, so resolver,
authentication, and downstream errors cannot fall through to an alternate origin path.

Workers are distributed across isolates and regions, so creating a gate per request with the core's
default memory limiter would reset login history on every submission. The Workers contract instead
requires `rateLimit: false` or a limiter declaring `scope: "shared"`. The marker is a caller
attestation, while atomic coordination remains the implementation's responsibility.

Cloudflare's [bindings guidance](https://developers.cloudflare.com/workers/runtime-apis/bindings/)
and [secret guidance](https://developers.cloudflare.com/workers/configuration/secrets/) support
per-request `env` access and secret storage outside source. The compatibility fixture uses required
secret binding names, generated Wrangler types, ephemeral test-only values, and no committed secret
values. Its asset configuration runs the Worker before the binding so static files cannot bypass
the gate.

The current [Response API](https://developers.cloudflare.com/workers/runtime-apis/response/)
includes WebSocket and manual body-encoding extensions. Sitegate secures mutable application
responses in place to preserve their identity and extensions, with a clone only when a standards
network response exposes immutable headers. The fixture uses `@cloudflare/vitest-plugin` 1.1.2,
Wrangler 4.127.1, generated Workers bindings, real workerd tests, and a production-bundle dry run.

## H3 and Nuxt guidance

Current Nuxt 3.21.11 and 4.5.2 both use Nitro 2.13.4 and H3 1.15.11. H3's current `latest` npm tag
is a breaking 2.0 release candidate with a different event/middleware API, so Sitegate deliberately
targets the maintained H3 1 line and does not claim H3 2 compatibility.

H3 1's [event-handler guidance](https://v1.h3.dev/guide/event-handler) defines an ordered handler
stack in which a middleware-style handler continues by returning no value. H3 runs its application
`onRequest` callback before that stack, however, so even the first middleware cannot be the complete
authentication boundary. Sitegate instead replaces and locks the H3 application's outer handler.
It authenticates the original raw target before `onRequest` or stack code, consumes only a bounded
login body, and protects allowed Node responses at the raw `ServerResponse` boundary.

Nitro's [routing documentation](https://v2.nitro.build/guide/routing) shows that route rules can
redirect or proxy requests, while the published Nitro 2 runtime registers that route-rule handler
before scanned server middleware. A normal Nuxt `server/middleware` file could consequently be
skipped by a terminating rule. Sitegate instead returns a Nitro server plugin that replaces and
immutably locks `nitro.h3App.handler` around the complete application. This also places the gate
before Nitro `request` hooks, which H3 invokes before its stack. The H3 application-handler boundary
is pinned to Nitro 2 and guarded by Nuxt 3/4 production build and runtime fixtures.

Nuxt's [server-directory guidance](https://nuxt.com/docs/4.x/directory-structure/server) separates
server plugins from routes/middleware and documents private runtime configuration. Sitegate calls a
zero-argument private-configuration source for each request and requires `rateLimit: false` or a
shared limiter. Event promises are registered with an already-available request lifecycle and remain
observed best-effort otherwise. The resolver receives no event or body, preserving the login stream
and preventing Nitro request helpers from moving ahead of the gate.

The Nuxt adapter targets the Nitro Node server preset. Prerendered output, host-served `public/`
files, WebSocket upgrades, provider routes outside Nitro, and H3 2 remain separate boundaries rather
than implied coverage.

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

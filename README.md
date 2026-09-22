# Sitegate

Sitegate is a small, self-hosted password gate for staging, preview, client-review, and internal
websites. It protects the request boundary, not merely the rendered frontend, so pages, APIs, route
handlers, and direct HTTP requests all require a valid session.

It has no database, hosted service, React UI, or Sitegate backend. Authentication runs inside your
application using server-only configuration.

> [!WARNING]
> Sitegate is coarse-grained access protection for previews, internal tools, and other sites shared
> by one trusted group. It can run on production infrastructure, but it is not a replacement for
> per-user authentication, authorization, roles, audit trails, SSO, or MFA in a multi-user
> application.

## Why Sitegate?

- One shared password protects the complete request surface.
- Password verification and session handling are server-side.
- Signed, tamper-resistant, expiring sessions use standard HMAC-SHA-256 JWTs via `jose`.
- Cookies are `HttpOnly`, `SameSite=Strict`, and `Secure` on HTTPS by default.
- The responsive login page works without JavaScript. A small optional enhancement adds password
  visibility, Caps Lock feedback, and a submitting state, with no UI dependencies.
- Login CSRF protection combines same-origin checks, Fetch Metadata, a signed token, and a
  short-lived `__Host-` pre-session cookie.
- A rolling, process-local brute-force limiter is included, can be disabled completely, and accepts
  a developer-provided implementation through a small interface.
- Protected responses are marked `private, no-store`, varied on cookies, and excluded from compliant
  search indexing.
- The core uses standard `Request` and `Response`; adapters cover Next.js 14–16, Vite 6–8,
  Express 4–5, Fastify 5, Hono 4, Cloudflare Workers, H3 1, Nuxt 3–4, SvelteKit, and Astro.

## Install

```bash
pnpm add sitegate
```

Choose the integration that runs **on your server**, set a password and a stable signing secret,
then register Sitegate before your application routes. There is no database or hosted Sitegate
account to set up.

| Your stack | Integration | Where it runs |
| --- | --- | --- |
| Next.js / OpenNext / SST | [`sitegate/next`](#minimal-nextjs-setup) | Proxy or Middleware, with the broad matcher |
| React, Vue, Svelte, Angular, or Solid using Vite | [`sitegate/vite`](#vite-development-and-local-preview) | Development and local preview; deployed static files need a host gate |
| Express / React Router / Remix on Express | [`sitegate/express`](#express) | Before parsers, static files, and the framework request handler |
| Fastify / NestJS on Fastify | [`sitegate/fastify`](#fastify) | Root server plugin, before routes |
| Hono | [`sitegate/hono`](#hono) | First root middleware |
| Cloudflare Workers / Pages behind a Worker | [`sitegate/cloudflare-workers`](#cloudflare-workers) | Outer fetch handler, including assets |
| Nuxt / Nitro | [`sitegate/nuxt`](#nuxt) | Nitro server plugin |
| SvelteKit | [`sitegate/sveltekit`](#sveltekit) | First server hook; server-rendered routes |
| Astro | [`sitegate/astro`](#astro) | First middleware; server output |
| H3 | [`sitegate/h3`](#h3) | Outer application handler |
| Other servers using Web Request/Response | [Core API](#framework-neutral-core) | Outer server request handler |

Frontend frameworks do not need a special login component. A static-only deployment cannot run
server-side authentication by installing an npm dependency: put the gate at its host, edge, or proxy.
The [framework guide](docs/FRAMEWORKS.md) covers composition, public URLs, and asset boundaries.

Sitegate requires Node.js 20 or newer, with no upper version limit. Individual frameworks may
require a newer Node.js version; follow the requirements of the framework version you install.
The repository's development and release tooling uses Node.js 24 LTS and pinned pnpm.
Runtime compatibility checks cover Node.js 20, 22, 24, and 26, including Node.js 20.0.0 and 22.0.0.
Its optional framework
peers support Next.js 14.2–16, Vite 6–8, Express 4.22.2–5, Fastify 5.8.5–5, and Hono 4. H3 support
starts at 1.15.11, and the Nuxt adapter covers Nuxt 3.21.11 through Nuxt 4 on Nitro 2.13.4–2.
The framework-neutral core and Cloudflare adapter use web-standard runtime APIs.

`jose` and the small `fastify-plugin` registration helper are Sitegate's direct runtime
dependencies. Frameworks are supplied by the consuming application; direct adapter imports are
declared as optional peers, while the Nuxt plugin uses a structural boundary so it does not add a
second Nitro/H3 type graph. Package-manager audits may still display optional peers in paths beneath
Sitegate because peers participate in the host's resolved dependency graph.

## Minimal Next.js setup

Add server-only variables to the deployment environment:

```dotenv
SITEGATE_PASSWORD=a-long-unique-shared-password
SITEGATE_SECRET=at-least-32-random-characters-generated-securely
```

Generate a signing secret instead of inventing one:

```bash
openssl rand -base64 32
```

Save this value once and use it on every instance of the deployment. Generating a new secret on
every request or cold start invalidates login forms and sessions intermittently.

Choose your login-attempt policy before deploying: `sitegate()` includes an in-memory limiter for
a single server. For Vercel, Lambda, or other distributed hosts, provide a shared limiter or choose
`sitegate({ rateLimit: false })` explicitly for zero-infrastructure, unthrottled operation. See
[rate-limit choices](#lightweight-rate-limit-choices). Sitegate never silently disables throttling.

On Next.js 16, create `proxy.ts` at the same level as `app` or `pages`:

```ts
import { sitegate } from "sitegate/next";

export const proxy = sitegate();

export const config = {
  matcher: ["/:path*"],
};
```

On Next.js 14 or 15, put the same configuration in `middleware.ts` and export it as `middleware`:

```ts
import { sitegate } from "sitegate/next";

export const middleware = sitegate();

export const config = {
  matcher: ["/:path*"],
};
```

Sitegate reads `SITEGATE_PASSWORD` and `SITEGATE_SECRET` only in this server-side interception
module. Never prefix them with `NEXT_PUBLIC_`, place them in client code, or pass them as client
props.

| Next.js line | Tested patch | File and export | Default runtime |
| --- | --- | --- | --- |
| 14 | 14.2.35 | `middleware.ts` / `middleware` | Edge |
| 15 | 15.5.22 | `middleware.ts` / `middleware` | Edge; Node.js is available from 15.5 |
| 16 | 16.2.12 | `proxy.ts` / `proxy` | Node.js |

Each line is checked in an isolated TypeScript consumer and runtime smoke test. Use the latest
security patch within your chosen Next.js line. Next.js 15 and 16 are the current upstream LTS
lines; Next.js 14 remains compatibility-tested here but is no longer covered by the upstream
[support policy](https://nextjs.org/support-policy). The July 2026 security release requires at
least 15.5.21 or 16.2.11; Sitegate tests newer patches from both lines. Keep the host framework
patched because Sitegate relies on its Proxy/Middleware boundary executing correctly.

### Required matcher

Use the broad matcher unless a narrower policy has been deliberately reviewed:

```ts
export const config = {
  matcher: ["/:path*"],
};
```

This sends pages, route handlers, direct API calls, and framework-served assets through the gate,
including Sitegate's own login and logout endpoints. `excludedPaths` lets the gate pass an explicit
public route through after interception. Do not exclude `_next`, API, image, download, or static
paths merely for convenience if any response can contain private staging content. Test the exact
deployed matcher because Sitegate cannot protect requests that Next.js or the hosting adapter routes
around Proxy/Middleware.

## Enable only for previews

Keep the interception file in place and make the environment choice explicit (name this export
`middleware` on Next.js 14 or 15):

```ts
import { sitegate } from "sitegate/next";

export const proxy = sitegate({
  enabled: process.env.VERCEL_ENV === "preview",
});

export const config = { matcher: ["/:path*"] };
```

When `enabled` is `false`, password and secret configuration is not required and the request passes
through unchanged. Do not accidentally disable Sitegate on an environment that is intended to be
private.

## Compose with an existing Next.js Proxy or Middleware

`createSitegateNext` can continue into an existing handler after Sitegate grants access:

```ts
import { createSitegateNext } from "sitegate/next";
import { existingProxy } from "./src/auth/existing-proxy";

export const proxy = createSitegateNext(
  { rateLimit: false },
  { next: (request) => existingProxy(request) },
);

export const config = { matcher: ["/:path*"] };
```

The continuation may return a `Response` synchronously or asynchronously and can refresh
authentication, mutate request/response headers, redirect, rewrite, or call `NextResponse.next()`.
It is called only when Sitegate is disabled, the path is explicitly public, or the request has a
valid Sitegate session. The default remains `NextResponse.next()`.

The Next.js adapter emits absolute `Location` headers for unauthenticated, successful-login, and
logout redirects. This preserves compatibility with OpenNext/SST hosts that reject relative
redirect locations. The framework-neutral core continues to use valid Fetch API relative
locations.

## Vite development and local preview

```ts
import { defineConfig } from "vite";
import { sitegate } from "sitegate/vite";

export default defineConfig({
  plugins: [sitegate()],
});
```

The plugin reads `SITEGATE_PASSWORD` and `SITEGATE_SECRET` from the server environment and protects
HTTP pages, assets, and API routes served by Vite's development and local preview servers. Never use
the client-exposed `VITE_` prefix for either secret.

The compatibility suite pins Vite 6.4.3, 7.3.6, and 8.2.1. Vite 8.2.1 also runs the real-server
login, CSRF, cookie, redirect, cache-control, and indexing integration tests.

> [!IMPORTANT]
> `vite build` produces static files with no authentication server, and Vite documents
> `vite preview` as a local preview rather than a production server. For a deployed static Vite
> site, enforce Sitegate's framework-neutral core in the hosting platform, reverse proxy, CDN,
> server, or edge runtime before any file is served. Vite HMR WebSocket traffic is also outside the
> plugin's HTTP middleware boundary.

## Express

Register Sitegate before body parsers, static-file middleware, and every protected router:

```ts
import express from "express";
import { sitegate } from "sitegate/express";

const app = express();

app.use(sitegate());
app.use(express.urlencoded({ extended: false }));
app.use(express.static("public"));
```

The adapter supports Express 4.22.2 through Express 5 and reads `SITEGATE_PASSWORD` and
`SITEGATE_SECRET` by default. It consumes only a login submission body, caps that body at 16 KiB,
and leaves every other downstream request stream untouched. Sitegate responses preserve separate
`Set-Cookie` fields, while allowed downstream responses keep their status and body with Sitegate's
cache and indexing headers locked in place.

Express derives `request.protocol` from the socket unless `trust proxy` is configured. Behind a
reverse proxy, set the narrowest correct trust policy before registering Sitegate so the public
HTTPS scheme is reconstructed without trusting arbitrary forwarding headers:

```ts
app.set("trust proxy", "loopback");
app.use(sitegate());
```

For a topology that cannot use Express's proxy policy, pass a validated application-owned public
origin as the adapter's second argument: `sitegate(config, { origin: "https://preview.example" })`.
Do not derive this override from an untrusted request header.

## Fastify

Register the plugin on the root instance before protected routes or nested plugins:

```ts
import Fastify from "fastify";
import { sitegate } from "sitegate/fastify";

const app = Fastify();

await app.register(sitegate);
app.get("/private", async () => ({ private: true }));
```

The adapter supports Fastify 5.8.5 through Fastify 5. It runs in `onRequest`, before Fastify parses
the body, and consumes only Sitegate login submissions. Root registration protects later nested
plugins as well as root routes. It preserves Fastify error handling and response serialization,
then locks Sitegate's security headers through the final response write.

Configure Fastify's `trustProxy` only for the actual proxy topology if public HTTPS is terminated
upstream. An application-owned `origin` string, URL, or callback can instead be supplied in the
Sitegate plugin options; it must resolve to an HTTP(S) origin with no credentials, path, query, or
fragment.

## Hono

Register Sitegate first and at the root, before validators, body readers, other middleware, and
routes:

```ts
import { Hono } from "hono";
import { sitegate } from "sitegate/hono";

const app = new Hono();

app.use(
  "*",
  sitegate({
    password: process.env["SITEGATE_PASSWORD"]!,
    secret: process.env["SITEGATE_SECRET"]!,
  }),
);
app.get("/private", (context) => context.text("Private preview"));
```

The adapter supports Hono 4.0 through Hono 4. It passes Hono's original `Request` into Sitegate,
calls the downstream chain exactly once after authentication, and replaces the completed response
so later route headers cannot restore public caching or indexing. Registration order is part of the
security boundary: a route or middleware registered first can return without ever reaching
Sitegate.

This fixed-config adapter is runtime-neutral. On Cloudflare Workers, wrap the complete `app.fetch`
handler with the Cloudflare adapter shown below instead. That resolves binding-only secrets per
request, enforces an explicit distributed rate-limit choice, and registers asynchronous events with
the request's execution context. On any other multi-isolate Hono runtime, explicitly provide a
shared limiter or set `rateLimit: false`; do not rely on the process-local default.

## Cloudflare Workers

Resolve secrets from generated bindings for every request and export an object with a `fetch`
property:

```ts
import { createSitegateWorker } from "sitegate/cloudflare-workers";

export default {
  fetch: createSitegateWorker<CloudflareBindings>(
    (env) => ({
      password: env.SITEGATE_PASSWORD,
      secret: env.SITEGATE_SECRET,
      rateLimit: false,
    }),
    (request, env) => env.ASSETS.fetch(request),
  ),
} satisfies ExportedHandler<CloudflareBindings>;
```

`rateLimit` is deliberately required. Set it to `false` only when you explicitly accept
unthrottled login attempts, or provide a limiter whose `scope` is `"shared"`; the adapter rejects a
process-local limiter because isolates, regions, and cold starts cannot share its history. A shared
limiter can use `(request) => cloudflareClientId(request, env.SITEGATE_SECRET)` as `getClientId` to
create a secret-keyed pseudonym from Cloudflare's edge-controlled `CF-Connecting-IP` value without
trusting a client-supplied forwarding header or storing the address itself. The Workers adapter
rejects `trustProxy: true`; use an explicit `getClientId` instead.

Store production values with `wrangler secret put SITEGATE_PASSWORD` and
`wrangler secret put SITEGATE_SECRET`. Declare the required binding names in Wrangler, then run
`pnpm exec wrangler types` and use the generated `CloudflareBindings` interface rather than writing
one by hand. Do not put secret values in source, `wrangler.jsonc`, or committed development files.

When a Worker serves static assets, set `assets.run_worker_first` so an asset match cannot bypass
Sitegate. The wrapper forwards the exact request, bindings, and context to the application; it does
not use `passThroughOnException`. Promise-returning `onEvent` work is registered with that request's
`waitUntil` context and remains best-effort. Sitegate-created and application-created mutable
responses retain Worker response extensions such as WebSocket attachments and manual encoding while
their security headers are hardened. A fetched response with immutable headers uses a
standards-compatible clone, so test specialized upstream response behavior in the deployed runtime.

Hono on Workers uses the same outer boundary:

```ts
import { Hono } from "hono";
import { createSitegateWorker } from "sitegate/cloudflare-workers";

const app = new Hono<{ Bindings: CloudflareBindings }>();
app.get("/private", (context) => context.text("Private preview"));

export default {
  fetch: createSitegateWorker<CloudflareBindings>(
    (env) => ({
      password: env.SITEGATE_PASSWORD,
      secret: env.SITEGATE_SECRET,
      rateLimit: false,
    }),
    (request, env, context) => app.fetch(request, env, context),
  ),
} satisfies ExportedHandler<CloudflareBindings>;
```

## H3

Install Sitegate on the H3 1 application before exposing it through a listener. Routes may be added
before or after installation:

```ts
import { createApp, eventHandler } from "h3";
import { sitegate } from "sitegate/h3";

const app = createApp();

sitegate(app, {
  password: process.env["SITEGATE_PASSWORD"]!,
  secret: process.env["SITEGATE_SECRET"]!,
});
app.use("/private", eventHandler(() => ({ private: true })));
```

The adapter targets H3 1.15.11 on Node-compatible servers. It locks Sitegate as the application's
outer handler, before H3 `onRequest` hooks and the route stack. It uses the original request target,
reads only a bounded Sitegate login submission, leaves every other request stream untouched, and
locks the raw response so later H3 handlers cannot remove the cache, cookie-variance, or indexing
policy. A second installation or a later attempt to replace the outer handler fails visibly. H3 2
currently has a different release-candidate API and is not covered by this adapter.

Behind TLS termination, pass a fixed application-owned public origin as the third argument:

```ts
sitegate(
  app,
  {
    password: process.env["SITEGATE_PASSWORD"]!,
    secret: process.env["SITEGATE_SECRET"]!,
  },
  { origin: "https://preview.example" },
);
```

Do not derive it from an arbitrary Host or forwarding header. H3 WebSocket upgrades resolve outside
the locked HTTP application handler and require a separate authentication boundary.

## Nuxt

Use a Nitro server plugin—not client route middleware or ordinary `server/middleware`—so Sitegate
can lock itself around Nitro request hooks, route-rule redirects/proxies, and every protected server
response. Put private defaults in `nuxt.config.ts`:

```ts
export default defineNuxtConfig({
  runtimeConfig: {
    sitegate: {
      password: "",
      secret: "",
    },
  },
});
```

Supply production values as `NUXT_SITEGATE_PASSWORD` and `NUXT_SITEGATE_SECRET`, then add
`server/plugins/99.sitegate.ts`:

```ts
import { sitegate } from "sitegate/nuxt";

export default sitegate(
  () => {
    const runtime = useRuntimeConfig();
    return {
      password: runtime.sitegate.password,
      secret: runtime.sitegate.secret,
      rateLimit: false,
    };
  },
  { origin: "https://preview.example" },
);
```

The adapter supports Nuxt 3.21.11 through Nuxt 4 on Nitro 2.13.4–2 with the Node server preset. The
zero-argument configuration source is resolved independently for every request. Keep it limited to
private runtime/binding lookup; it runs outside Nitro request hooks so those hooks cannot precede
authentication. Sitegate locks its handler around Nitro's complete H3 application, including
`request` hooks, route-rule redirects/proxies, scanned middleware, and routes. A second installation
or later handler replacement fails at startup.

`rateLimit` is required: use `false` only when accepting unthrottled login attempts, or supply a
limiter marked `scope: "shared"` whose operations really coordinate every process and region.
Set `trustProxy: true` only when the deployment edge removes incoming forwarding headers and writes
the client address itself; string environment values are rejected rather than treated as truthy.

The resolver receives no request, so it cannot consume Sitegate's login stream. Do not
prerender/generate protected content, and do not place sensitive files in
`public/` when the host can serve that directory before Nitro. WebSocket upgrades are outside this
HTTP boundary. Use the outer Cloudflare Worker adapter for a Worker-hosted application instead of
assuming the Nitro Node plugin protects platform routes that bypass its server.

Terminal Sitegate responses run before Nitro request/response hooks and Nitro's request async
context by design. Sitegate event callbacks remain observed and use a host-supplied request
lifecycle when one is already available, but they must stay best-effort; use upstream access logs
when every denied request must be recorded independently of application hooks.

## SvelteKit

In `src/hooks.server.ts`, use SvelteKit's private environment variables:

```ts
import { env } from "$env/dynamic/private";
import { sitegate } from "sitegate/sveltekit";

export const handle = sitegate({
  password: env.SITEGATE_PASSWORD ?? "",
  secret: env.SITEGATE_SECRET ?? "",
});
```

When composing hooks, use `sequence(sitegate(config), existingHandle)` from `@sveltejs/kit/hooks`.
The complete event, locals, and downstream request body are preserved. Keep private routes
server-rendered; SvelteKit's hook does not protect prerendered pages or files in `static/`.
For those, wrap the deployed server or use an edge gate. Choose a shared limiter or explicit
`rateLimit: false` on distributed hosts. Tested against SvelteKit 2.70.3 with adapter-node 5.5.7.

## Astro

Use `output: "server"` and a server adapter in `astro.config.mjs`. In `src/middleware.ts`:

```ts
import { sitegate } from "sitegate/astro";

export const onRequest = sitegate({
  password: import.meta.env.SITEGATE_PASSWORD ?? "",
  secret: import.meta.env.SITEGATE_SECRET ?? "",
});
```

Keep these variables server-only, without the `PUBLIC_` prefix. On hosts that supply runtime
bindings, resolve private values using the host's server environment instead. Place Sitegate first
in `sequence()` when composing middleware. Prerendering a protected page fails with a setup error
instead of emitting a broken static login form. Static files in `public/` still require protection
at the host or edge. Choose a shared limiter or explicit `rateLimit: false` on distributed hosts.
Tested against Astro 7.3.3 with its Node adapter 11.1.6.

## Configuration

```ts
export const proxy = sitegate({
  password: process.env.SITEGATE_PASSWORD,
  secret: process.env.SITEGATE_SECRET,
  sessionDuration: 8 * 60 * 60,
  sameSite: "strict",
  secureCookies: "auto",
  excludedPaths: ["/health", "/acme-logo.svg"],
  branding: {
    siteName: "Acme Preview",
    title: "Client review",
    description: "Enter the preview password to continue.",
    logo: "/acme-logo.svg",
    accentColor: "#635bff",
  },
  strings: {
    language: "en-GB",
    passwordLabel: "Password",
    submitLabel: "Continue",
    footerText: "Internal staging environment",
    incorrectPassword: "That password is not correct.",
    expiredForm: "Login form expired. Reload the page and try again.",
    rateLimited: "Too many login attempts. Try again later.",
  },
});
```

| Option | Default | Notes |
| --- | --- | --- |
| `password` | `SITEGATE_PASSWORD` in the Next/Vite/Express/Fastify adapters | Required when enabled; at least 1 Unicode character. Hono, Workers, H3, Nuxt, and the core require an explicit value. The application owner controls password-strength policy. |
| `secret` | `SITEGATE_SECRET` in the Next/Vite/Express/Fastify adapters | Required when enabled; at least 32 UTF-8 bytes. Hono, Workers, H3, Nuxt, and the core require an explicit value. Keep separate from the password. |
| `publicOrigin` | Request URL origin | Set the exact public origin, such as `https://preview.example.com`, when a proxy presents an internal HTTP URL. Controls origin checks and secure-cookie detection; Next.js also uses it for relative redirects. Never derive it from untrusted forwarding headers. |
| `enabled` | `true` | Makes protection easy to remove or scope by environment. |
| `sessionDuration` | 8 hours | Absolute lifetime; between 60 seconds and 30 days. |
| `loginPath` | `/_sitegate/login` | Built-in GET/POST login endpoint. |
| `logoutPath` | `/_sitegate/logout` | Built-in POST-only logout endpoint. |
| `protectedPaths` | all paths | String prefixes, regular expressions, or pathname callbacks. |
| `excludedPaths` | none | Always wins over `protectedPaths`; login/logout remain handled. |
| `secureCookies` | `"auto"` | Adds `Secure` for HTTPS. Set `true` when TLS is terminated before an HTTP origin and the request URL is not reconstructed as HTTPS. |
| `sameSite` | `"strict"` | May be changed to `"lax"` when cross-site navigation continuity matters. |
| `rateLimit` | process-local rolling window | `10` attempts/trusted client and `200` globally per 15 minutes. Successful logins are removed from both budgets. Set `false` for zero-infrastructure mode, or pass your own `limiter`. |
| `branding` | Sitegate defaults | Text, a root-relative logo path without a query or hash, and a six-digit accent color. No raw HTML. Add the logo path to `excludedPaths` if it must load before login. |
| `strings` | English defaults | HTML language, field/button/footer labels, and escaped incorrect-password, expired-form, and rate-limit messages. |
| `onEvent` | none | Receives best-effort, non-blocking, secret-free success/failure/limit/session/logout events, plus `login_unavailable` when the attempt limiter cannot be checked or reset. |

String path matchers respect boundaries: `/admin` matches `/admin` and `/admin/users`, but not
`/administrator`.

## Logout

Logout is deliberately POST-only:

```html
<form action="/_sitegate/logout" method="post">
  <button type="submit">Leave preview</button>
</form>
```

Logout removes the browser's session and CSRF cookies. Because sessions are stateless, a copied
token cannot be individually revoked without storage. Rotate `SITEGATE_SECRET` or change the shared
password to invalidate every existing session immediately.

## Framework-neutral core

Adapters only need to supply a continuation response:

```ts
import { createSitegate } from "sitegate";

const gate = createSitegate({
  password: process.env.SITEGATE_PASSWORD!,
  secret: process.env.SITEGATE_SECRET!,
});

const response = await gate.handle(request, () => application.handle(request));
```

The core exposes typed path policy helpers and a `LoginAttemptLimiter` interface so additional
servers and edge runtimes can integrate without rewriting session or login logic.

## Lightweight rate-limit choices

Sitegate never installs or connects to Redis, a database, or a hosted rate-limit service. Choose one
of three modes:

1. Omit `rateLimit` to use the included, bounded in-process `Map`. This is the default and needs no
   infrastructure, but it is suitable only when one process owns the login budget.
2. Set `rateLimit: false` to create no limiter at all—no `Map`, database, service, or rate-limit
   calls:

   ```ts
   export const proxy = sitegate({
     rateLimit: false,
   });
   ```

3. Pass an implementation the application already owns. Sitegate depends only on the interface and
   never bundles a provider adapter:

   ```ts
   import type { LoginAttemptLimiter } from "sitegate";

   const limiter: LoginAttemptLimiter = myApplicationLimiter;

   export const proxy = sitegate({
     rateLimit: { limiter },
   });
   ```

With rate limiting disabled, unauthenticated protected-route requests do a cookie lookup and deny or
redirect; a supplied session cookie also requires cryptographic verification. Login submissions
still run origin, CSRF, form-size, and password checks. Disabling the limiter therefore removes
password-guessing and login-endpoint compute-abuse throttling. Use a strong unique password and make
this explicit tradeoff only for deployments where that risk is acceptable.

## Rate limiting in serverless and multi-region deployments

The default limiter is bounded to the current JavaScript process. It is suitable for a single
server, but it is not coordinated across processes, regions, or cold starts. In recognized
multi-instance runtimes—including AWS Lambda/SST, Vercel, Netlify, Google serverless runtimes, and
Azure App Service/Functions—Sitegate refuses to start with the process-local default. Pass a
`LoginAttemptLimiter` backed by infrastructure your application already uses with `scope: "shared"`,
or explicitly set `rateLimit: false` to accept the unthrottled-login risk. A custom limiter's
`consume` operation must atomically reserve an attempt, and `reset` must clear that client's entries
from client and global buckets after successful authentication.

Runtime detection is a fail-safe for known platforms, not a substitute for deployment design. If a
different platform can create multiple processes or isolates, choose a shared limiter, an external
control, or the explicit unthrottled mode. Successful logins clear their client's provisional
entries from both the client and global budgets. An already-exhausted bucket still rejects every
submission before password verification; otherwise rate limiting would not constrain password
guessing.

Sitegate deliberately does not choose or bundle a DynamoDB, Redis, or provider-specific
implementation. For example, an SST application can pass its own shared atomic limiter, enforce an
equivalent rule at its edge, or explicitly use `rateLimit: false` without adding infrastructure.

See the [SST/OpenNext deployment example](docs/SST_OPENNEXT.md) for stage propagation, matcher,
composition, and live verification guidance.

By default Sitegate does not trust `X-Forwarded-For`, so untrusted clients cannot rotate a spoofed
header to evade the local limiter. Set `rateLimit.trustProxy: true` only when your platform strips
incoming forwarding headers and writes a trustworthy client address. Custom client identifiers are
hashed or otherwise made non-sensitive by the application before use.

Without a trusted client identity, every requester deliberately shares the same 200-attempt global
budget. This prevents a requester from evading the limiter with spoofed forwarding headers, but one
requester can consume the budget and temporarily reject every new login until attempts expire.
Existing authenticated sessions remain valid. Behind a trusted proxy, enable `trustProxy`, or pass
an application-owned non-sensitive `getClientId`, when per-client isolation is preferable.

## Security model

Sitegate assumes:

- the URL is public knowledge;
- an attacker can issue arbitrary requests to every route, including APIs;
- client bundles and HTML are visible;
- cookies can be read and modified by their holder;
- attackers will guess passwords and submit malformed tokens;
- the deployment uses HTTPS and keeps server environment variables secret.

The password is compared using Web Crypto HMAC verification rather than a JavaScript string
comparison. Sessions and CSRF tokens use allow-listed HS256 verification with issuer, audience,
type, issued-at, expiry, and unique-ID checks. The password is part of domain-separated session-key
derivation, so changing either password or secret invalidates existing sessions. Passwords, secrets,
and tokens are never included in Sitegate events.

See the [design research](docs/RESEARCH.md), full [threat model](docs/THREAT_MODEL.md), and
[security policy](SECURITY.md).

### What Sitegate does not protect against

- A compromised origin, CI system, deployment account, environment-variable store, or signing
  secret.
- Someone who knows or is given the shared password.
- Session theft on a compromised browser or device.
- XSS or malicious server code in the protected application. `HttpOnly` reduces token theft, but an
  active same-origin script can still act through the browser.
- Platform bypass domains, stale CDN objects, or routes that do not execute the configured Proxy,
  Middleware, or server adapter.
- Per-user identity, permissions, accountability, MFA, password recovery, or server-side token
  revocation.
- Search engines that ignore `noindex`; indexing directives reduce accidental discovery but are not
  access control.

## Deployment checklist

1. Use HTTPS at the public edge and confirm the application observes the public scheme.
2. Generate independent, high-entropy password and signing-secret values.
3. On Next.js, configure `matcher` so every route needing protection executes Proxy or Middleware.
   On other hosts, register the gate before static files and application routes. Test a page, API,
   static asset, image, and route handler without cookies. On Cloudflare, enable
   `assets.run_worker_first`.
4. Confirm the CDN cannot serve a previously cached private response before the gate runs. Purge
   old public objects when enabling Sitegate on an existing deployment.
5. Choose the login-attempt mode explicitly: the default for one process, an application-owned
   shared/edge limiter for coordinated throttling, or `rateLimit: false` with its documented risk.
6. Test the platform's canonical URL, preview aliases, origin hostname, and branch URLs; disable
   bypass URLs where possible.
7. Verify `Set-Cookie`, `Cache-Control`, `Vary`, and `X-Robots-Tag` on the deployed response.
8. Keep authorization inside the application wherever users have different permissions.
9. Keep the host framework and runtime patched. For Nuxt, verify the Nitro server plugin still runs
   before route rules and that no protected output is prerendered or served directly from `public/`.
   Rerun unauthenticated page, API, login, and logout checks after upgrades.

## Troubleshooting

**A normal login shows “Cross-site login request rejected” or raw JSON**

Upgrade to 0.6.0 or newer. Older versions could reject their own browser form because
`Referrer-Policy: no-referrer` produced `Origin: null`. The fix uses a same-origin referrer policy
on the login page and accepts an opaque origin only with same-origin, top-level-navigation Fetch
Metadata. Signed CSRF validation still runs. Browser errors now show a recoverable login form.

**Sign-in sometimes expires after opening another tab**

Upgrade to 0.6.0 or newer. Login pages now reuse the browser's pre-session nonce so one tab does not
invalidate another. Each signed form still expires after 10 minutes. An expired form is refreshed
in place: enter the password again. A missing cookie gets its own message about allowing cookies.

**Forms or sessions fail intermittently across requests**

Ensure `SITEGATE_SECRET` and `SITEGATE_PASSWORD` are identical on all instances and regions. Keep
the secret stable across cold starts. Do not use `randomUUID()` or `randomBytes()` inside the
request handler to configure the signing secret. Keep the deployment clocks synchronized.

**The browser uses HTTPS but the server sees HTTP or an internal hostname**

Set `publicOrigin: "https://preview.example.com"` in any adapter. This fixes source validation and
secure-cookie selection without trusting arbitrary `X-Forwarded-*` headers. Use the exact browser
origin, including a nonstandard port when relevant. Configure separate gates for separate public
origins. The Express/H3 `origin` adapter option remains available for trusted dynamic topologies.

**Login fails after adding Express middleware**

Register Sitegate before `express.urlencoded()`, static files, and the application's request
handler. Sitegate needs the original login form stream. Application request bodies pass through
untouched after authentication.

**“Sign-in is temporarily unavailable”**

Check the shared limiter's storage and credentials. Sitegate fails closed with a recoverable `503`
page and emits `login_unavailable`; it never exposes the storage error or signs in without checking
the attempt limit.

**`SitegateConfigurationError: password must contain at least 1 character`**
Set a non-empty shared password. Sitegate leaves password-strength policy to the application owner
while continuing to fail closed on missing configuration.

**The login works on localhost but loops in production**  
Check that the public request is recognized as HTTPS and that a proxy/CDN is not stripping the
`__Host-sitegate_session` cookie. Keep its path at `/` and do not set a `Domain` attribute.

**A route is still public**  
Confirm it matches the statically analyzable `config.matcher` in `proxy.ts` or `middleware.ts` and
is not in `excludedPaths`. Sitegate cannot protect a request for which Next.js never invokes the
interception function.

For H3, confirm Sitegate installed and locked the application handler before the listener was
exposed. For Hono, confirm it is the first root middleware.
For Nuxt, use `sitegate/nuxt` from `server/plugins`, not client or scanned server middleware, and
confirm the request reaches the Nitro Node server. For Cloudflare assets, confirm
`assets.run_worker_first` is enabled and the public hostname routes through this Worker.

**The Vite development server is protected, but my deployed static site is public**  
That is expected: the Vite plugin runs in the development and local preview servers, not in static
build output. Add the framework-neutral gate to the deployed site's server/edge request boundary or
use equivalent access protection supplied by the host.

**Users coming from email links see the login page again**  
That is the `SameSite=Strict` default. Use `sameSite: "lax"` if preserving the session on top-level
cross-site navigation is more important for your preview.

## Development

```bash
pnpm install
pnpm check
pnpm compat:express
pnpm compat:fastify
pnpm compat:h3
pnpm compat:hono
pnpm compat:cloudflare-workers
pnpm compat:next
pnpm compat:nuxt
pnpm compat:vite
pnpm compat:sveltekit
pnpm compat:astro
pnpm exec playwright install chromium firefox webkit
pnpm test:browser
```

The check pipeline runs linting, formatting verification, strict TypeScript, unit/integration/security
tests with coverage, a clean declaration build, and an npm tarball dry run. The compatibility command
installs isolated consumers for Express 4 and 5, Fastify 5, H3 1.15, Hono 4.0 and current Hono 4,
Nuxt 3 and 4 on Nitro 2, the latest Next.js 14, 15, and 16 patch releases, Vite 6, 7, and 8, and the
current Cloudflare Workers toolchain. The main integration suite exercises real servers and workerd,
login/session flows, bounded bodies, error paths, nested plugins, static assets, route-rule order,
and final security-header enforcement.

## License

MIT

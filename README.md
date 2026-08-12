# Sitegate

Sitegate is a small, self-hosted password gate for staging, preview, client-review, and internal
websites. It protects the request boundary—not merely the rendered frontend—so pages, APIs, route
handlers, and direct HTTP requests all require a valid session.

It has no database, hosted service, React UI, or Sitegate backend. Authentication runs inside your
application using server-only configuration.

> [!WARNING]
> Sitegate is coarse-grained access protection for non-production environments. It is not a
> replacement for user authentication, authorization, roles, audit trails, SSO, or access control
> inside a multi-user production application.

## Why Sitegate?

- One shared password protects the complete request surface.
- Password verification and session handling are server-side.
- Signed, tamper-resistant, expiring sessions use standard HMAC-SHA-256 JWTs via `jose`.
- Cookies are `HttpOnly`, `SameSite=Strict`, and `Secure` on HTTPS by default.
- The built-in responsive login page has no client JavaScript or UI dependencies.
- Login CSRF protection combines same-origin checks, Fetch Metadata, a signed token, and a
  short-lived `__Host-` pre-session cookie.
- A rolling, process-local brute-force limiter is included, with a pluggable shared-store interface.
- Protected responses are marked `private, no-store`, varied on cookies, and excluded from compliant
  search indexing.
- The core uses standard `Request` and `Response`; adapters cover Next.js 14–16 and Vite 6–8.

## Install

```bash
pnpm add sitegate
```

Sitegate requires Node.js 24 LTS. Its optional framework peers support Next.js 14.2–16 and
Vite 6–8.

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
security patch within your chosen Next.js line.

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

## Configuration

```ts
export const proxy = sitegate({
  password: process.env.SITEGATE_PASSWORD,
  secret: process.env.SITEGATE_SECRET,
  sessionDuration: 8 * 60 * 60,
  sameSite: "strict",
  secureCookies: "auto",
  excludedPaths: ["/health"],
  branding: {
    siteName: "Acme Preview",
    title: "Client review",
    description: "Enter the preview password to continue.",
    logo: "/acme-logo.svg",
    accentColor: "#635bff",
  },
});
```

| Option | Default | Notes |
| --- | --- | --- |
| `password` | `SITEGATE_PASSWORD` in Next.js/Vite adapters | Required when enabled; at least 12 characters. |
| `secret` | `SITEGATE_SECRET` in Next.js/Vite adapters | Required when enabled; at least 32 UTF-8 bytes. Keep separate from the password. |
| `enabled` | `true` | Makes protection easy to remove or scope by environment. |
| `sessionDuration` | 8 hours | Absolute lifetime; between 60 seconds and 30 days. |
| `loginPath` | `/_sitegate/login` | Built-in GET/POST login endpoint. |
| `logoutPath` | `/_sitegate/logout` | Built-in POST-only logout endpoint. |
| `protectedPaths` | all paths | String prefixes, regular expressions, or pathname callbacks. |
| `excludedPaths` | none | Always wins over `protectedPaths`; login/logout remain handled. |
| `secureCookies` | `"auto"` | Adds `Secure` for HTTPS. Set `true` when TLS is terminated before an HTTP origin and the request URL is not reconstructed as HTTPS. |
| `sameSite` | `"strict"` | May be changed to `"lax"` when cross-site navigation continuity matters. |
| `rateLimit` | process-local rolling window | `10` failures/trusted client and `200` globally per 15 minutes. Without a trusted client identity, the shared limit is `200`. Set `false` only when an equivalent outer control exists. |
| `branding` | Sitegate defaults | Text, a root-relative logo, and a six-digit accent color. No raw HTML. The logo path is publicly readable so it can load before login. |
| `onEvent` | none | Receives secret-free success/failure/limit/session/logout events. |

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

The core exposes typed path policy helpers and a `LoginAttemptLimiter` interface so Express, Hono,
Fastify, Nuxt, Workers, or production Vite hosts can integrate without rewriting session or login
logic.

## Rate limiting in serverless and multi-region deployments

The default limiter is bounded to the current JavaScript process. It is useful on a single server
and as a baseline on serverless instances, but it is not coordinated across processes, regions, or
cold starts. For an internet-exposed preview on horizontally scaled infrastructure, pass a
`LoginAttemptLimiter` backed by your existing shared store and add rate limiting at the CDN/WAF.

By default Sitegate does not trust `X-Forwarded-For`, so untrusted clients cannot rotate a spoofed
header to evade the local limiter. Set `rateLimit.trustProxy: true` only when your platform strips
incoming forwarding headers and writes a trustworthy client address. Custom client identifiers are
hashed or otherwise made non-sensitive by the application before use.

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
   static asset, image, and route handler without cookies.
4. Confirm the CDN cannot serve a previously cached private response before the gate runs. Purge
   old public objects when enabling Sitegate on an existing deployment.
5. Configure a shared login limiter or an edge/WAF rule for scaled public deployments.
6. Test the platform's canonical URL, preview aliases, origin hostname, and branch URLs; disable
   bypass URLs where possible.
7. Verify `Set-Cookie`, `Cache-Control`, `Vary`, and `X-Robots-Tag` on the deployed response.
8. Keep authorization inside the application wherever users have different permissions.

## Troubleshooting

**`SitegateConfigurationError: password must contain at least 12 characters`**  
Use a longer shared password. Sitegate fails closed rather than silently accepting weak or missing
configuration.

**The login works on localhost but loops in production**  
Check that the public request is recognized as HTTPS and that a proxy/CDN is not stripping the
`__Host-sitegate_session` cookie. Keep its path at `/` and do not set a `Domain` attribute.

**A route is still public**  
Confirm it matches the statically analyzable `config.matcher` in `proxy.ts` or `middleware.ts` and
is not in `excludedPaths`. Sitegate cannot protect a request for which Next.js never invokes the
interception function.

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
pnpm compat:next
pnpm compat:vite
```

The check pipeline runs linting, formatting verification, strict TypeScript, unit/integration/security
tests with coverage, a clean declaration build, and an npm tarball dry run. The compatibility command
installs isolated consumers for the latest Next.js 14, 15, and 16 patch releases, type-checks their
required file conventions, and runs their adapters. The Vite compatibility command does the same
for Vite 6, 7, and 8; the main integration suite starts a real Vite server and exercises the full
login/session flow.

## License

MIT

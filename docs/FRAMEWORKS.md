# Framework integration guide

Sitegate belongs at the server request boundary. Install it in the package that owns that server,
keep its password and signing secret private, and register the gate before protected handlers.
Use one stable secret across all instances. Never put it in a frontend environment variable.

## Existing React Router, Remix, Angular SSR, or NestJS servers

For an Express server, register `sitegate/express` before the framework's request handler and
before static-file and body-parser middleware:

```ts
import express from "express";
import { sitegate } from "sitegate/express";

const app = express();
app.use(sitegate()); // Reads SITEGATE_PASSWORD and SITEGATE_SECRET.
// Register express.static(), parsers, and your framework handler here.
```

For NestJS, install this middleware on the underlying Express instance before starting the
application. A NestJS Fastify server uses `sitegate/fastify` as a root plugin before routes. These
are server composition recipes, not separate tested framework adapters; validate the actual host's
page, API, asset, and login paths before sharing a private deployment.

For a Fetch-native server (including a custom Bun or Deno server), the core boundary is:

```ts
import { createSitegate } from "sitegate";

const gate = createSitegate({
  password: serverPassword,
  secret: stableServerSecret,
});

export function fetch(request: Request) {
  return gate.handle(request, () => applicationFetch(request));
}
```

`serverPassword`, `stableServerSecret`, and `applicationFetch` represent your server's configuration
and existing handler. Resolve secrets using the runtime's private environment API. The core uses
Web Crypto and Fetch APIs; Node and Cloudflare are runtime-tested in this repository. Bun and Deno
are integration targets for this standard boundary, not part of the current automated runtime matrix.

## Public URL and hosting

When TLS terminates at a proxy and the application sees `http://internal:3000`, set
`publicOrigin: "https://preview.example.com"`. It is an exact configured origin, not a list of
allowed cross-site origins. It controls source checks and secure-cookie selection, and fixes Next.js
relative redirects behind internal hostnames. Do not copy arbitrary client forwarding headers into
this setting. Each configured gate should serve its declared public origin.

Distributed/serverless hosts need a shared attempt limiter or explicit `rateLimit: false`.
The latter accepts unthrottled attempts and requires no extra infrastructure. Sitegate retains
signature checks, CSRF protection, secure cookies, and request gating in that mode.

## Static and prerendered content

- Vite's plugin protects its development and preview servers. A Vite production build is static
  output and must be protected at its deployment host.
- SvelteKit's server hook protects requests that reach SvelteKit. `static/` files and prerendered
  pages may bypass it. Keep private pages server-rendered or gate the complete deployed server.
- Astro needs server output and a server adapter. Sitegate rejects prerendered middleware contexts.
  Files in `public/` still need host-level gating.
- Cloudflare must route assets through the Worker with `assets.run_worker_first: true`.
- A PHP, Python, Ruby, or other non-JavaScript application can sit behind a gated Worker or reverse
  proxy, but cannot import this npm package into its native application runtime.

## Tested integrations

CI checks Node 20, 22, 24, and 26; Next.js 14–16; Vite 6–8; Express 4–5; Fastify 5; Hono 4; H3
1.15; Nuxt 3–4; and Cloudflare workerd. SvelteKit 2.70.3 and Astro 7.3.3 have isolated, packed-package
consumers with TypeScript checks, production builds, and running-server authentication tests.
The login UI is exercised in Chromium, Firefox, and WebKit, including disabled JavaScript,
multiple tabs, error recovery, logout, and mobile layout. See `compat/` and `test/browser/` in the
repository for exact pinned versions and test coverage.

Framework contracts: [SvelteKit hooks](https://svelte.dev/docs/kit/hooks),
[Astro middleware](https://docs.astro.build/en/guides/middleware/), and
[Astro server rendering](https://docs.astro.build/en/guides/on-demand-rendering/).

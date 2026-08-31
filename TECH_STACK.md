# Technical stack

| Area | Choice | Rationale |
| --- | --- | --- |
| Language | TypeScript 7, strict mode | Typed public API and generated declarations. |
| Package manager | pnpm 11.16.0, project-pinned | Reproducible installs and committed lockfile. |
| Runtime target | Node.js 24 LTS and web-standard edge runtimes, ESM | Node baseline for server adapters/tooling plus Fetch/Web Crypto APIs for Hono and Workers. |
| Crypto/JWT | Web Crypto and `jose` | Standard primitives and mature JOSE validation; no custom algorithm. |
| Framework adapters | Next.js 14–16, Vite 6–8, Express 4–5, Fastify 5, H3 1, Hono 4, Nuxt 3–4/Nitro 2, Cloudflare Workers | Request-boundary integration without client secrets. |
| Tests | Vitest with V8 coverage and real workerd fixtures | TypeScript unit, integration, security, and runtime compatibility tests. |
| Lint/format | Biome | One fast, project-local tool with security rules. |
| Build | TypeScript compiler | Minimal ESM output, source maps, and declaration maps without bundling dependencies. |
| CI | GitHub Actions | Pinned Node 24 checks, isolated framework consumers, Workers bundle checks, and npm package dry run. |

Runtime dependencies are intentionally limited to `jose` and the small `fastify-plugin`
registration helper. Sitegate requires no database, external identity provider, hosted service, or
client framework.

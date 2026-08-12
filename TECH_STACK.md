# Technical stack

| Area | Choice | Rationale |
| --- | --- | --- |
| Language | TypeScript 7, strict mode | Typed public API and generated declarations. |
| Package manager | pnpm 11.16.0, project-pinned | Reproducible installs and committed lockfile. |
| Runtime target | Node.js 20.19+, ESM | Supported baseline shared by the tested framework lines and Web Crypto. |
| Crypto/JWT | Web Crypto and `jose` | Standard primitives and mature JOSE validation; no custom algorithm. |
| Framework adapters | Next.js 14–16 Middleware/Proxy; Vite 6–8 server plugin | Request-boundary integration without client secrets. |
| Tests | Vitest with V8 coverage | Fast TypeScript unit, integration, and security regression tests. |
| Lint/format | Biome | One fast, project-local tool with security rules. |
| Build | TypeScript compiler | Minimal ESM output, source maps, and declaration maps without bundling dependencies. |
| CI | GitHub Actions | Node version matrix, checks, and npm package dry run. |

Runtime dependencies are intentionally limited to `jose`. Sitegate requires no database, external
identity provider, hosted service, or client framework.

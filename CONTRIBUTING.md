# Contributing

Use Node.js 24 and the repository-pinned pnpm version.

```bash
corepack enable
pnpm install
pnpm check
```

Keep the framework-neutral core on standard Web APIs. Framework-specific imports belong in their
adapter entry point. Security-sensitive changes should include a regression test and update the
threat model when assumptions or residual risks change.

Please report vulnerabilities through the private process in `SECURITY.md`, not a public issue.

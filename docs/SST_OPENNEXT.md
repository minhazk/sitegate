# SST/OpenNext deployment

Sitegate runs inside the deployed Next.js Proxy or Middleware. SST's OpenNext adapter, the Next.js
matcher, and the deployed function environment are therefore part of the security boundary.

## Proxy and matcher

Next.js 16 uses `proxy.ts`:

```ts
import { createSitegateNext } from "sitegate/next";
import { existingProxy } from "./src/auth/existing-proxy";

export const proxy = createSitegateNext(
  {
    enabled: process.env.STAGE === "staging",
    rateLimit: false,
    branding: {
      siteName: "Starla",
      title: "Staging access",
      description: "Enter the shared staging password.",
    },
  },
  { next: (request) => existingProxy(request) },
);

export const config = {
  matcher: ["/:path*"],
};
```

Use the `middleware` export in `middleware.ts` on Next.js 14 or 15. The broad matcher protects page
HTML, APIs, route handlers, assets, and the Sitegate endpoints. Narrow it only after verifying every
excluded response is public. The application-owned continuation runs after Sitegate grants access.

Sitegate 0.2.0 and newer makes Next adapter redirects absolute. OpenNext/SST therefore receives
locations such as `https://staging.example.com/_sitegate/login?next=%2F` for unauthenticated pages,
successful login destinations, and logout.

## Propagate the deployment stage

An environment variable on the GitHub Actions deployment job controls that shell process; it does
not automatically become a runtime variable inside the deployed Next.js function. Pass the SST
stage explicitly:

```ts
new sst.aws.Nextjs("Web", {
  environment: {
    STAGE: $app.stage,
  },
});
```

Keep `SITEGATE_PASSWORD` and `SITEGATE_SECRET` in the deployed server environment or SST secrets,
never in `NEXT_PUBLIC_` variables. If `enabled` depends on `STAGE`, verify the value in the deployed
function configuration and test that production intentionally passes through while staging does
not.

## Rate limiting

SST can create multiple Lambda instances. The default process-local limiter is intentionally
rejected there because cold starts would create independent guessing budgets. Choose one of:

- `rateLimit: false` for the lightweight, explicitly unthrottled mode;
- an edge/WAF rule the application already owns; or
- an application-supplied atomic `LoginAttemptLimiter` with `scope: "shared"`.

Sitegate does not install or require DynamoDB, Redis, or another hosted service.

## Deployment verification

After every Next.js, OpenNext, SST, matcher, or environment change, verify the live canonical URL:

1. An unauthenticated HTML page returns `307` with an absolute same-origin login `Location`.
2. An unauthenticated API request returns JSON `401`, not login HTML.
3. A wrong password returns `401` and no session cookie.
4. A correct password returns `303`, an absolute same-origin destination, and a secure session
   cookie.
5. Logout returns `303`, an absolute login destination, and expires the cookies.
6. A representative page, API, route handler, image, download, and static asset cannot bypass the
   configured matcher.
7. Production behaves exactly as intended when `enabled` is `false`.

Sitegate depends on the host's interception boundary. Use an upstream-supported, currently patched
Next.js release and keep OpenNext/SST current; a framework-level Proxy/Middleware bypass also
bypasses Sitegate.

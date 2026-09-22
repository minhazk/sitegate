import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createApp, eventHandler, readRawBody, toWebHandler } from "h3";
import { createSitegateH3 } from "sitegate/h3";

const ORIGIN = "https://h3-1-15.compat.invalid";
const password = randomBytes(24).toString("base64url");
const secret = randomBytes(48).toString("base64url");

function cookieValue(response, name) {
  for (const cookie of response.headers.getSetCookie()) {
    const match = new RegExp(`^${name}=([^;]*)`, "u").exec(cookie);
    if (match?.[1] !== undefined) return decodeURIComponent(match[1]);
  }
  throw new Error(`Missing ${name} cookie.`);
}

function assertSecurityHeaders(response, referrerPolicy = "no-referrer") {
  assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
  assert.equal(response.headers.get("referrer-policy"), referrerPolicy);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow, noarchive, nosnippet");
}

const app = createApp();
createSitegateH3(
  app,
  {
    password,
    secret,
    rateLimit: false,
    secureCookies: false,
  },
  { origin: ORIGIN },
);
app.use(
  "/private",
  eventHandler((event) => {
    event.node.res.statusCode = 209;
    event.node.res.setHeader("Cache-Control", "public, max-age=3600");
    event.node.res.setHeader("Referrer-Policy", "unsafe-url");
    event.node.res.setHeader("X-Content-Type-Options", "unsafe");
    event.node.res.setHeader("X-Robots-Tag", "index, follow");
    event.node.res.setHeader("Vary", "Accept-Encoding");
    event.node.res.appendHeader("Set-Cookie", "downstream_one=1; Path=/");
    event.node.res.appendHeader("Set-Cookie", "downstream_two=2; Path=/");
    return "h3 protected response";
  }),
);
app.use(
  "/api/private",
  eventHandler(() => ({ private: true })),
);
app.use(
  "/api/echo",
  eventHandler(async (event) => {
    event.node.res.statusCode = 207;
    event.node.res.setHeader("X-Echo", "1");
    return readRawBody(event);
  }),
);
app.use(
  "/stream",
  eventHandler(
    () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("h3 streamed response"));
            controller.close();
          },
        }),
        { headers: { "X-Stream": "1" } },
      ),
  ),
);

const handler = toWebHandler(app);

const htmlDenial = await handler(
  new Request(`${ORIGIN}/private?tab=compat`, { headers: { Accept: "text/html" } }),
);
assert.equal(htmlDenial.status, 307);
const denialLocation = new URL(assertNonNull(htmlDenial.headers.get("location")), ORIGIN);
assert.equal(denialLocation.pathname, "/_sitegate/login");
assert.equal(denialLocation.searchParams.get("next"), "/private?tab=compat");
assertSecurityHeaders(htmlDenial);

const apiDenial = await handler(
  new Request(`${ORIGIN}/api/private`, { headers: { Accept: "application/json" } }),
);
assert.equal(apiDenial.status, 401);
assert.deepEqual(await apiDenial.json(), { error: "Authentication required." });
assertSecurityHeaders(apiDenial);

const loginPage = await handler(
  new Request(`${ORIGIN}/_sitegate/login?next=${encodeURIComponent("/private")}`),
);
assert.equal(loginPage.status, 200);
assertSecurityHeaders(loginPage, "same-origin");
const csrfToken = /name="csrf" value="([^"]+)"/u.exec(await loginPage.clone().text())?.[1];
assert.ok(csrfToken, "The login page must contain a CSRF token.");
const csrfCookie = cookieValue(loginPage, "sitegate_csrf");

const loginResponse = await handler(
  new Request(`${ORIGIN}/_sitegate/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: `sitegate_csrf=${encodeURIComponent(csrfCookie)}`,
      Origin: ORIGIN,
      "Sec-Fetch-Site": "same-origin",
    },
    body: new URLSearchParams({
      csrf: csrfToken,
      next: "/private",
      password,
    }),
  }),
);
assert.equal(loginResponse.status, 303);
assert.equal(loginResponse.headers.get("location"), "/private");
assert.equal(loginResponse.headers.getSetCookie().length, 2);
assert.ok(
  loginResponse.headers
    .getSetCookie()
    .some((cookie) => cookie.startsWith("sitegate_csrf=") && cookie.includes("Max-Age=0")),
  "A successful login must expire the CSRF cookie separately.",
);
assertSecurityHeaders(loginResponse);
const sessionCookie = cookieValue(loginResponse, "sitegate_session");
const authHeaders = { Cookie: `sitegate_session=${encodeURIComponent(sessionCookie)}` };

const protectedResponse = await handler(new Request(`${ORIGIN}/private`, { headers: authHeaders }));
assert.equal(protectedResponse.status, 209);
assert.equal(await protectedResponse.text(), "h3 protected response");
assertSecurityHeaders(protectedResponse);
assert.deepEqual(protectedResponse.headers.getSetCookie(), [
  "downstream_one=1; Path=/",
  "downstream_two=2; Path=/",
]);
const vary = assertNonNull(protectedResponse.headers.get("vary"))
  .split(",")
  .map((value) => value.trim().toLowerCase());
assert.ok(vary.includes("accept-encoding"));
assert.ok(vary.includes("cookie"));

const body = "h3 compatibility request body 🔒";
const echoResponse = await handler(
  new Request(`${ORIGIN}/api/echo`, {
    method: "POST",
    headers: { ...authHeaders, "Content-Type": "text/plain; charset=utf-8" },
    body,
  }),
);
assert.equal(echoResponse.status, 207);
assert.equal(echoResponse.headers.get("x-echo"), "1");
assert.equal(await echoResponse.text(), body);
assertSecurityHeaders(echoResponse);

const streamResponse = await handler(new Request(`${ORIGIN}/stream`, { headers: authHeaders }));
assert.equal(streamResponse.status, 200);
assert.equal(streamResponse.headers.get("x-stream"), "1");
assert.equal(await streamResponse.text(), "h3 streamed response");
assertSecurityHeaders(streamResponse);

let hookCalls = 0;
const hookApp = createApp({
  async onRequest(event) {
    hookCalls += 1;
    await event.respondWith(
      new Response("h3 request hook response", {
        status: 218,
        headers: { "X-Compat-Request-Hook": "reached" },
      }),
    );
  },
});
createSitegateH3(
  hookApp,
  {
    password,
    secret,
    rateLimit: false,
    excludedPaths: ["/public"],
  },
  { origin: ORIGIN },
);
const fetchHookApp = toWebHandler(hookApp);
const hookDenial = await fetchHookApp(
  new Request(`${ORIGIN}/private`, { headers: { Accept: "application/json" } }),
);
assert.equal(hookDenial.status, 401);
assert.equal(hookDenial.headers.get("x-compat-request-hook"), null);
assert.equal(hookCalls, 0);
const allowedHook = await fetchHookApp(new Request(`${ORIGIN}/public`));
assert.equal(allowedHook.status, 218);
assert.equal(await allowedHook.text(), "h3 request hook response");
assert.equal(allowedHook.headers.get("x-compat-request-hook"), "reached");
assert.equal(hookCalls, 1);
assert.deepEqual(Object.getOwnPropertyDescriptor(hookApp, "handler"), {
  configurable: false,
  enumerable: true,
  value: hookApp.handler,
  writable: false,
});

const disabledApp = createApp();
createSitegateH3(disabledApp, {
  password: "",
  secret: "",
  enabled: false,
  rateLimit: false,
});
disabledApp.use(
  "/_sitegate/login",
  eventHandler((event) => readRawBody(event)),
);
const disabledBody = await toWebHandler(disabledApp)(
  new Request(`${ORIGIN}/_sitegate/login`, { method: "POST", body: "untouched body" }),
);
assert.equal(await disabledBody.text(), "untouched body");

function assertNonNull(value) {
  assert.notEqual(value, null);
  return value;
}

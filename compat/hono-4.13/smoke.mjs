import { Hono } from "hono";
import { sitegate } from "sitegate/hono";

const protectedApp = new Hono();
protectedApp.use(
  "*",
  sitegate({
    password: "compatibility fixture password",
    secret: "sitegate compatibility fixture signing key",
    rateLimit: false,
    excludedPaths: ["/health"],
  }),
);
protectedApp.get("/health", (context) => {
  context.header("Cache-Control", "public");
  context.header("Referrer-Policy", "unsafe-url");
  context.header("X-Robots-Tag", "index");
  context.header("Vary", "Origin");
  return context.body("ok", 203);
});

const response = await protectedApp.request("https://preview.example.test/health");
if (response.status !== 203 || (await response.text()) !== "ok") {
  throw new Error("Hono 4.13 continuation output was not preserved.");
}
if (response.headers.get("cache-control") !== "private, no-store, max-age=0") {
  throw new Error("Hono 4.13 response replacement weakened cache policy.");
}
if (response.headers.get("referrer-policy") !== "no-referrer") {
  throw new Error("Hono 4.13 response replacement weakened referrer policy.");
}
if (
  !response.headers.get("vary")?.includes("Origin") ||
  !response.headers.get("vary")?.includes("Cookie")
) {
  throw new Error("Hono 4.13 response replacement lost Vary fields.");
}

const disabledApp = new Hono();
disabledApp.use("*", sitegate({ password: "", secret: "", enabled: false }));
disabledApp.post("/_sitegate/login", async (context) => context.text(await context.req.raw.text()));
const downstream = await disabledApp.request("https://preview.example.test/_sitegate/login", {
  method: "POST",
  body: "downstream body",
});
if ((await downstream.text()) !== "downstream body") {
  throw new Error("Hono 4.13 disabled mode consumed the downstream request body.");
}

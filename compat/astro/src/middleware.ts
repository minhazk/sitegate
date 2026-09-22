import type { MiddlewareHandler } from "astro";
import { sitegate } from "sitegate/astro";

export const onRequest: MiddlewareHandler = sitegate({
  password: "compatibility fixture password",
  secret: "sitegate compatibility fixture signing key",
  rateLimit: false,
});

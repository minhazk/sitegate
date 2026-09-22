import type { Handle } from "@sveltejs/kit";
import { sitegate } from "sitegate/sveltekit";

export const handle: Handle = sitegate({
  password: "compatibility fixture password",
  secret: "sitegate compatibility fixture signing key",
  rateLimit: false,
});

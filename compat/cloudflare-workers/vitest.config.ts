import { randomBytes } from "node:crypto";
import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

process.env["SITEGATE_PASSWORD"] ??= randomBytes(18).toString("base64url");
process.env["SITEGATE_SECRET"] ??= randomBytes(48).toString("base64url");

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: {
        configPath: "./wrangler.jsonc",
      },
    }),
  ],
});

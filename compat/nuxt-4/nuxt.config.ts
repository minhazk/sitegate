import { defineNuxtConfig } from "nuxt/config";

export default defineNuxtConfig({
  devtools: { enabled: false },
  nitro: { preset: "node-server" },
  workspaceDir: import.meta.dirname,
  routeRules: {
    "/nitro-redirect": { redirect: "/health" },
  },
  runtimeConfig: {
    sitegate: {
      password: "",
      secret: "",
    },
  },
});

import { createSitegateWorker } from "sitegate/cloudflare-workers";

export default {
  fetch: createSitegateWorker<CloudflareBindings>(
    (env) => ({
      password: env.SITEGATE_PASSWORD,
      secret: env.SITEGATE_SECRET,
      rateLimit: false,
    }),
    (request, env) => env.ASSETS.fetch(request),
  ),
} satisfies ExportedHandler<CloudflareBindings>;

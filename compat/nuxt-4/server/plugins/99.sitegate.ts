import { createSitegateNuxt } from "sitegate/nuxt";

export default createSitegateNuxt(() => {
  const runtimeConfig = useRuntimeConfig();
  return {
    password: runtimeConfig.sitegate.password,
    secret: runtimeConfig.sitegate.secret,
    rateLimit: false,
    secureCookies: false,
    excludedPaths: ["/health"],
  };
});

import { createApp, eventHandler } from "h3";
import {
  createSitegateH3,
  type H3SitegateOptions,
  type SitegateConfig,
  sitegate,
} from "sitegate/h3";

const config = {
  password: "compatibility fixture password",
  secret: "compatibility fixture signing secret value",
  rateLimit: false,
} satisfies SitegateConfig;

const options = {
  origin: "https://h3-1-15.compat.invalid",
} satisfies H3SitegateOptions;

export const app = createApp();

createSitegateH3(app, config, options);
app.use(
  "/health",
  eventHandler(() => "ok"),
);

export const disabledApp = createApp();

sitegate(disabledApp, {
  password: "",
  secret: "",
  enabled: false,
  rateLimit: false,
});

import { Hono } from "hono";
import { createSitegateHono } from "sitegate/hono";

type Runtime = { Bindings: { SITE_NAME: string } };

export const app = new Hono<Runtime>();

app.use("*", createSitegateHono<Runtime>({ password: "", secret: "", enabled: false }));
app.get("/health", (context) => context.text(context.env.SITE_NAME));

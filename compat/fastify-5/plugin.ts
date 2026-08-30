import Fastify from "fastify";
import { sitegate } from "sitegate/fastify";

export const app = Fastify();

await app.register(sitegate, { enabled: false });
app.get("/health", () => "ok");

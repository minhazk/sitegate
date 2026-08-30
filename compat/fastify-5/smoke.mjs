import Fastify from "fastify";
import { sitegate } from "sitegate/fastify";

const app = Fastify();
await app.register(sitegate, {
  password: "correct horse battery staple",
  secret: "this is only a test signing secret value",
  rateLimit: false,
});
app.get("/api/private", () => ({ private: true }));

try {
  const response = await app.inject({
    method: "GET",
    url: "/api/private",
    headers: { accept: "application/json" },
  });
  if (response.statusCode !== 401 || response.json().error !== "Authentication required.") {
    throw new Error("Fastify 5 protection did not deny the API request.");
  }
} finally {
  await app.close();
}

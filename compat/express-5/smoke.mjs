import express from "express";
import { sitegate } from "sitegate/express";

const app = express();
app.use(
  sitegate({
    password: "correct horse battery staple",
    secret: "this is only a test signing secret value",
    rateLimit: false,
  }),
);
app.get("/private", (_request, response) => response.send("private"));

const server = app.listen(0, "127.0.0.1");
await new Promise((resolve, reject) => {
  server.once("listening", resolve);
  server.once("error", reject);
});

try {
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Express did not listen.");
  const response = await fetch(`http://127.0.0.1:${address.port}/private`, {
    headers: { Accept: "text/html" },
    redirect: "manual",
  });
  if (
    response.status !== 307 ||
    !response.headers.get("location")?.startsWith("/_sitegate/login")
  ) {
    throw new Error("Express 5 protection did not redirect to Sitegate.");
  }
} finally {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

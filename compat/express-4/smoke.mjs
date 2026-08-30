import express from "express";
import { sitegate } from "sitegate/express";

const app = express();
app.use(sitegate({ enabled: false }));
app.post("/_sitegate/login", express.text({ type: "*/*" }), (request, response) => {
  response.send(request.body);
});

const server = app.listen(0, "127.0.0.1");
await new Promise((resolve, reject) => {
  server.once("listening", resolve);
  server.once("error", reject);
});

try {
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Express did not listen.");
  const response = await fetch(`http://127.0.0.1:${address.port}/_sitegate/login`, {
    method: "POST",
    body: "express 4 downstream body",
  });
  if ((await response.text()) !== "express 4 downstream body") {
    throw new Error("Express 4 continuation consumed the downstream body.");
  }
} finally {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

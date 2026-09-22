import express from "express";
import { sitegate } from "../../dist/express.js";

const app = express();
app.use(
  sitegate({
    password: "browser test password",
    secret: "sitegate browser test signing secret 000000",
    rateLimit: false,
    excludedPaths: ["/health"],
  }),
);
app.use((request, response) =>
  response
    .type("html")
    .send(
      `<h1>Private application</h1><p>${request.path}</p><form action="/_sitegate/logout" method="post"><button>Sign out</button></form>`,
    ),
);
app.listen(4179, "127.0.0.1");

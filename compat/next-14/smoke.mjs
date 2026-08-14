import { NextRequest } from "next/server.js";
import { sitegate } from "sitegate/next";

const middleware = sitegate({ enabled: false });
const response = await middleware(new NextRequest("https://preview.example.test/private"));

if (response.headers.get("x-middleware-next") !== "1") {
  throw new Error("Next.js 14 middleware continuation failed.");
}

const protectedMiddleware = sitegate({
  password: "correct horse battery staple",
  secret: "this is only a test signing secret value",
  rateLimit: false,
});
const redirect = await protectedMiddleware(
  new NextRequest("https://preview.example.test/private", {
    headers: { Accept: "text/html" },
  }),
);
const expectedLogin = new URL("/_sitegate/login", "https://preview.example.test");
expectedLogin.searchParams.set("next", "/private");
if (redirect.headers.get("location") !== expectedLogin.toString()) {
  throw new Error("Next.js 14 absolute redirect compatibility failed.");
}

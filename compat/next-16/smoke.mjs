import { NextRequest, NextResponse } from "next/server.js";
import { createSitegateNext, sitegate } from "sitegate/next";

const proxy = createSitegateNext(
  { enabled: false },
  {
    next: () => {
      const response = NextResponse.next();
      response.headers.set("X-Existing-Proxy", "1");
      return response;
    },
  },
);
const response = await proxy(new NextRequest("https://preview.example.test/private"));

if (response.headers.get("x-middleware-next") !== "1") {
  throw new Error("Next.js 16 proxy continuation failed.");
}
if (response.headers.get("x-existing-proxy") !== "1") {
  throw new Error("Next.js 16 custom continuation failed.");
}

const protectedProxy = sitegate({
  password: "correct horse battery staple",
  secret: "this is only a test signing secret value",
  rateLimit: false,
});
const redirect = await protectedProxy(
  new NextRequest("https://preview.example.test/private", {
    headers: { Accept: "text/html" },
  }),
);
const expectedLogin = new URL("/_sitegate/login", "https://preview.example.test");
expectedLogin.searchParams.set("next", "/private");
if (redirect.headers.get("location") !== expectedLogin.toString()) {
  throw new Error("Next.js 16 absolute redirect compatibility failed.");
}

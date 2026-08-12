import { NextRequest } from "next/server.js";
import { sitegate } from "sitegate/next";

const middleware = sitegate({ enabled: false });
const response = await middleware(new NextRequest("https://preview.example.test/private"));

if (response.headers.get("x-middleware-next") !== "1") {
  throw new Error("Next.js 14 middleware continuation failed.");
}

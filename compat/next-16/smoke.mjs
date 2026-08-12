import { NextRequest } from "next/server.js";
import { sitegate } from "sitegate/next";

const proxy = sitegate({ enabled: false });
const response = await proxy(new NextRequest("https://preview.example.test/private"));

if (response.headers.get("x-middleware-next") !== "1") {
  throw new Error("Next.js 16 proxy continuation failed.");
}

import { NextResponse } from "next/server";
import { createSitegateNext } from "sitegate/next";

export const proxy = createSitegateNext(
  { enabled: false },
  {
    next: () => {
      const response = NextResponse.next();
      response.headers.set("X-Existing-Proxy", "1");
      return response;
    },
  },
);

export const config = { matcher: ["/:path*"] };

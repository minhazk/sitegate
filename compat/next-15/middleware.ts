import { sitegate } from "sitegate/next";

export const middleware = sitegate({ enabled: false });

export const config = { matcher: ["/:path*"] };

import { sitegate } from "sitegate/next";

export const proxy = sitegate({ enabled: false });

export const config = { matcher: ["/:path*"] };

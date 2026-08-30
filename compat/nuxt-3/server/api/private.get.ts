export default defineEventHandler((event) => {
  setResponseStatus(event, 209);
  setResponseHeader(event, "Cache-Control", "public, max-age=3600");
  setResponseHeader(event, "Referrer-Policy", "unsafe-url");
  setResponseHeader(event, "X-Content-Type-Options", "unsafe");
  setResponseHeader(event, "X-Robots-Tag", "index, follow");
  setResponseHeader(event, "Vary", "Accept-Encoding");
  appendResponseHeader(event, "Vary", "X-Fixture");
  appendResponseHeader(event, "Set-Cookie", "downstream_one=1; Path=/");
  appendResponseHeader(event, "Set-Cookie", "downstream_two=2; Path=/");
  return "nuxt protected response";
});

export default defineEventHandler((event) => {
  setResponseHeader(event, "Cache-Control", "public, max-age=3600");
  setResponseHeader(event, "Referrer-Policy", "unsafe-url");
  setResponseHeader(event, "Vary", "Accept-Language");
  return { ok: true };
});

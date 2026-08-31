export default defineNitroPlugin((nitro) => {
  nitro.hooks.hook("request", async (event) => {
    if (event.node.req.headers["x-compat-request-hook"] === "terminate") {
      await event.respondWith(
        new Response("nitro request hook response", {
          status: 218,
          headers: { "X-Compat-Request-Hook": "terminated" },
        }),
      );
      return;
    }
    event.node.res.setHeader("X-Compat-Request-Hook", "reached");
  });
});

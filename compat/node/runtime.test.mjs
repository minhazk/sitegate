import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";
import express from "express";
import { createSitegate } from "sitegate";
import { createSitegateExpress } from "sitegate/express";

const config = {
  password: "runtime compatibility test password",
  secret: "runtime compatibility test signing secret",
};

async function authenticationFlow(send, origin) {
  const request = (path, init) => send(new Request(`${origin}${path}`, init));
  assert.equal((await request("/private")).status, 401);
  const page = await request("/_sitegate/login?next=/private");
  assert.equal(page.status, 200);
  const csrf = /name="csrf" value="([^"]+)"/u.exec(await page.text())?.[1];
  assert.ok(csrf);
  const cookie = page.headers.getSetCookie()[0]?.split(";")[0];
  assert.ok(cookie);
  const login = (password, token = csrf) =>
    request("/_sitegate/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: cookie,
        Origin: origin,
      },
      body: new URLSearchParams({ password, csrf: token, next: "/private" }),
    });
  assert.equal((await login(config.password, "invalid")).status, 403);
  assert.equal((await login("incorrect password")).status, 401);
  const authenticated = await login(config.password);
  assert.equal(authenticated.status, 303);
  assert.equal(authenticated.headers.get("location"), "/private");
  const cookies = authenticated.headers.getSetCookie();
  assert.equal(cookies.length, 2);
  const session = cookies.find((value) => value.startsWith("sitegate_session="))?.split(";")[0];
  assert.ok(session);
  const response = await request("/private", { headers: { Cookie: session } });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "protected content");
  assert.match(response.headers.get("cache-control"), /no-store/u);
  assert.equal(
    (await request("/private", { headers: { Cookie: `${session}tampered` } })).status,
    401,
  );
  const logout = await request("/_sitegate/logout", {
    method: "POST",
    headers: { Cookie: session, Origin: origin },
  });
  assert.equal(logout.status, 303);
  assert.equal(logout.headers.getSetCookie().length, 2);
  for (const expired of logout.headers.getSetCookie()) assert.match(expired, /Max-Age=0/u);
}

test("built package signs and verifies authentication on the consumer Node runtime", async () => {
  const gate = createSitegate(config);
  await authenticationFlow(
    (request) => gate.handle(request, () => new Response("protected content")),
    "http://preview.example.test",
  );
});

test("built Express adapter preserves login cookies through Node HTTP", async () => {
  const app = express();
  app.use(createSitegateExpress(config));
  app.use((_request, response) => response.send("protected content"));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    await authenticationFlow(
      (request) => fetch(request, { redirect: "manual" }),
      `http://127.0.0.1:${address.port}`,
    );
  } finally {
    server.closeAllConnections();
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

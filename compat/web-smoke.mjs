import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { setTimeout } from "node:timers/promises";

const framework = process.argv[2];
const probe = createServer().listen(0, "127.0.0.1");
await once(probe, "listening");
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
const base = `http://127.0.0.1:${port}`;
const child = spawn(
  process.execPath,
  [framework === "astro" ? "dist/server/entry.mjs" : "build/index.js"],
  {
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(port), ORIGIN: base },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let output = "";
for (const stream of [child.stdout, child.stderr])
  stream.on("data", (chunk) => {
    output = `${output}${chunk}`.slice(-10000);
  });

try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error(output);
    try {
      await fetch(base);
      ready = true;
      break;
    } catch {
      await setTimeout(100);
    }
  }
  assert.ok(ready, `Server did not start: ${output}`);
  const page = await fetch(base, { headers: { Accept: "text/html" }, redirect: "manual" });
  assert.equal(page.status, 307);
  assert.equal((await fetch(`${base}/api/private`)).status, 401);
  const form = await fetch(`${base}/_sitegate/login?next=%2Fapi%2Fprivate`);
  assert.equal(form.status, 200);
  const token = /name="csrf" value="([^"]+)"/u.exec(await form.text())?.[1];
  assert.ok(token);
  const cookie = form.headers.getSetCookie()[0].split(";")[0];
  const login = await fetch(`${base}/_sitegate/login`, {
    method: "POST",
    redirect: "manual",
    headers: { Cookie: cookie, Origin: base },
    body: new URLSearchParams({
      csrf: token,
      password: "compatibility fixture password",
      next: "/api/private",
    }),
  });
  assert.equal(login.status, 303);
  assert.equal(login.headers.get("location"), "/api/private");
  assert.equal(login.headers.getSetCookie().length, 2);
  const session = login.headers
    .getSetCookie()
    .find((value) => value.startsWith("sitegate_session="))
    .split(";")[0];
  const headers = { Cookie: session };
  const api = await fetch(`${base}/api/private`, { headers });
  assert.deepEqual(await api.json(), { private: true });
  assert.match(api.headers.get("cache-control"), /no-store/u);
  const html = await fetch(base, { headers });
  assert.match(await html.text(), /Private (Astro|SvelteKit) application/u);
  const body = await fetch(`${base}/api/private`, {
    method: "POST",
    headers: { ...headers, Origin: base },
    body: "preserved downstream body",
  });
  assert.equal(await body.text(), "preserved downstream body");
  const logout = await fetch(`${base}/_sitegate/logout`, {
    method: "POST",
    redirect: "manual",
    headers: { ...headers, Origin: base },
  });
  assert.equal(logout.status, 303);
  assert.match(logout.headers.get("set-cookie"), /Max-Age=0/u);
  console.log(
    `${framework}: production build, page/API protection, login, session, request body, headers, and logout passed.`,
  );
} catch (error) {
  throw new Error(`${error.message}\n${output}`, { cause: error });
} finally {
  const exit = once(child, "exit");
  if (child.exitCode === null) {
    child.kill("SIGTERM");
    await exit;
  }
}

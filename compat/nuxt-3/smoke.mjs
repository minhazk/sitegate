import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const fixtureDirectory = fileURLToPath(new URL(".", import.meta.url));
const password = randomBytes(24).toString("base64url");
const secret = randomBytes(48).toString("base64url");
const port = await unusedPort();
const baseUrl = `http://127.0.0.1:${port}`;
let output = "";

const child = spawn(process.execPath, [path.join(fixtureDirectory, ".output/server/index.mjs")], {
  cwd: fixtureDirectory,
  env: {
    ...process.env,
    HOST: "127.0.0.1",
    NITRO_HOST: "127.0.0.1",
    NITRO_PORT: String(port),
    NODE_ENV: "production",
    NUXT_SITEGATE_PASSWORD: password,
    NUXT_SITEGATE_SECRET: secret,
    PORT: String(port),
  },
  stdio: ["ignore", "pipe", "pipe"],
});

for (const stream of [child.stdout, child.stderr]) {
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    output = `${output}${chunk}`.slice(-20_000);
  });
}

try {
  await waitUntilReady();
  await verifyProductionServer();
} catch (error) {
  const details = output.trim() === "" ? "No server output was captured." : output.trim();
  throw new Error(`${error instanceof Error ? error.message : String(error)}\n${details}`);
} finally {
  await stopChild();
}

async function verifyProductionServer() {
  const health = await fetch(`${baseUrl}/health`, { redirect: "manual" });
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { ok: true });
  assertSecurityHeaders(health);
  assertVary(health, "accept-language", "cookie");
  assert.equal(health.headers.get("x-compat-request-hook"), "reached");

  const htmlDenial = await fetch(`${baseUrl}/nitro-redirect?source=compat`, {
    headers: { Accept: "text/html", "X-Compat-Request-Hook": "terminate" },
    redirect: "manual",
  });
  assert.equal(htmlDenial.status, 307);
  const location = new URL(assertNonNull(htmlDenial.headers.get("location")), baseUrl);
  assert.equal(location.pathname, "/_sitegate/login");
  assert.equal(location.searchParams.get("next"), "/nitro-redirect?source=compat");
  assertSecurityHeaders(htmlDenial);
  assert.equal(htmlDenial.headers.get("x-compat-request-hook"), null);

  const apiDenial = await fetch(`${baseUrl}/api/private`, {
    headers: { Accept: "application/json", "X-Compat-Request-Hook": "terminate" },
    redirect: "manual",
  });
  assert.equal(apiDenial.status, 401);
  assert.deepEqual(await apiDenial.json(), { error: "Authentication required." });
  assertSecurityHeaders(apiDenial);
  assert.equal(apiDenial.headers.get("x-compat-request-hook"), null);

  const loginPage = await fetch(
    `${baseUrl}/_sitegate/login?next=${encodeURIComponent("/api/private")}`,
    { redirect: "manual" },
  );
  assert.equal(loginPage.status, 200);
  assertSecurityHeaders(loginPage, "same-origin");
  assert.equal(loginPage.headers.get("x-compat-request-hook"), null);
  const csrfToken = /name="csrf" value="([^"]+)"/u.exec(await loginPage.clone().text())?.[1];
  assert.ok(csrfToken, "The login page must contain a CSRF token.");
  const csrfCookie = cookieValue(loginPage, "sitegate_csrf");

  const loginResponse = await fetch(`${baseUrl}/_sitegate/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: `sitegate_csrf=${encodeURIComponent(csrfCookie)}`,
      Origin: baseUrl,
      "Sec-Fetch-Site": "same-origin",
    },
    body: new URLSearchParams({
      csrf: csrfToken,
      next: "/api/private",
      password,
    }),
    redirect: "manual",
  });
  assert.equal(loginResponse.status, 303);
  assert.equal(loginResponse.headers.get("location"), "/api/private");
  assert.equal(loginResponse.headers.getSetCookie().length, 2);
  assert.ok(
    loginResponse.headers
      .getSetCookie()
      .some((cookie) => cookie.startsWith("sitegate_csrf=") && cookie.includes("Max-Age=0")),
    "A successful login must expire the CSRF cookie separately.",
  );
  assertSecurityHeaders(loginResponse);
  assert.equal(loginResponse.headers.get("x-compat-request-hook"), null);
  const sessionCookie = cookieValue(loginResponse, "sitegate_session");
  const authHeaders = { Cookie: `sitegate_session=${encodeURIComponent(sessionCookie)}` };

  const protectedResponse = await fetch(`${baseUrl}/api/private`, {
    headers: authHeaders,
    redirect: "manual",
  });
  assert.equal(protectedResponse.status, 209);
  assert.equal(await protectedResponse.text(), "nuxt protected response");
  assertSecurityHeaders(protectedResponse);
  assert.equal(protectedResponse.headers.get("x-compat-request-hook"), "reached");
  assertVary(protectedResponse, "accept-encoding", "x-fixture", "cookie");
  assert.deepEqual(protectedResponse.headers.getSetCookie(), [
    "downstream_one=1; Path=/",
    "downstream_two=2; Path=/",
  ]);

  const terminatingHookResponse = await fetch(`${baseUrl}/api/private`, {
    headers: { ...authHeaders, "X-Compat-Request-Hook": "terminate" },
    redirect: "manual",
  });
  assert.equal(terminatingHookResponse.status, 218);
  assert.equal(await terminatingHookResponse.text(), "nitro request hook response");
  assert.equal(terminatingHookResponse.headers.get("x-compat-request-hook"), "terminated");
  assertSecurityHeaders(terminatingHookResponse);

  const body = "nuxt compatibility request body 🔒";
  const echoResponse = await fetch(`${baseUrl}/api/echo`, {
    method: "POST",
    headers: { ...authHeaders, "Content-Type": "text/plain; charset=utf-8" },
    body,
    redirect: "manual",
  });
  assert.equal(echoResponse.status, 207);
  assert.equal(echoResponse.headers.get("x-echo"), "1");
  assert.equal(await echoResponse.text(), body);
  assertSecurityHeaders(echoResponse);
  assert.equal(echoResponse.headers.get("x-compat-request-hook"), "reached");

  const errorResponse = await fetch(`${baseUrl}/api/error`, {
    headers: authHeaders,
    redirect: "manual",
  });
  assert.equal(errorResponse.status, 503);
  assertSecurityHeaders(errorResponse);
  assert.equal(errorResponse.headers.get("x-compat-request-hook"), "reached");
}

async function waitUntilReady() {
  let lastError;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Nuxt server exited with code ${child.exitCode}.`);
    try {
      const response = await fetch(`${baseUrl}/health`, { redirect: "manual" });
      if (response.status === 200) return;
      lastError = new Error(`Health endpoint returned ${response.status}.`);
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  throw new Error(
    `Nuxt server did not become ready: ${lastError instanceof Error ? lastError.message : "unknown error"}`,
  );
}

async function unusedPort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address !== null && typeof address !== "string");
  await new Promise((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
  return address.port;
}

async function stopChild() {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([waitForExit(), delay(5_000)]);
  if (child.exitCode === null) {
    child.kill("SIGKILL");
    await waitForExit();
  }
}

function waitForExit() {
  if (child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => child.once("exit", resolve));
}

function cookieValue(response, name) {
  for (const cookie of response.headers.getSetCookie()) {
    const match = new RegExp(`^${name}=([^;]*)`, "u").exec(cookie);
    if (match?.[1] !== undefined) return decodeURIComponent(match[1]);
  }
  throw new Error(`Missing ${name} cookie.`);
}

function assertSecurityHeaders(response, referrerPolicy = "no-referrer") {
  assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
  assert.equal(response.headers.get("referrer-policy"), referrerPolicy);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow, noarchive, nosnippet");
}

function assertVary(response, ...requiredValues) {
  const values = assertNonNull(response.headers.get("vary"))
    .split(",")
    .map((value) => value.trim().toLowerCase());
  for (const required of requiredValues) assert.ok(values.includes(required));
}

function assertNonNull(value) {
  assert.notEqual(value, null);
  return value;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

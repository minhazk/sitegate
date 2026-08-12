import { createSitegate, type Sitegate, type SitegateConfig } from "../src/index.js";

export const TEST_PASSWORD = "correct horse battery staple";
export const TEST_SECRET = "this is only a test signing secret value";
export const BASE_URL = "https://preview.example.com";

export function makeGate(overrides: Partial<SitegateConfig> = {}): Sitegate {
  return createSitegate({
    password: TEST_PASSWORD,
    secret: TEST_SECRET,
    ...overrides,
  });
}

export const blocked = () => Promise.resolve(new Response("application", { status: 200 }));

export function cookieValue(response: Response, name: string): string {
  const setCookie = response.headers.get("set-cookie") ?? "";
  const match = new RegExp(`(?:^|, )${name}=([^;]*)`, "u").exec(setCookie);
  if (match?.[1] === undefined) throw new Error(`Missing ${name} cookie in ${setCookie}`);
  return decodeURIComponent(match[1]);
}

export async function loginForm(
  gate: Sitegate,
  destination = "/",
): Promise<{
  cookie: string;
  response: Response;
  token: string;
}> {
  const response = await gate.handle(
    new Request(`${BASE_URL}${gate.loginPath}?next=${encodeURIComponent(destination)}`, {
      headers: { Accept: "text/html" },
    }),
    blocked,
  );
  const body = await response.clone().text();
  const token = /name="csrf" value="([^"]+)"/u.exec(body)?.[1];
  if (token === undefined) throw new Error("Missing CSRF token");
  const csrf = cookieValue(response, "__Host-sitegate_csrf");
  return { cookie: `__Host-sitegate_csrf=${encodeURIComponent(csrf)}`, response, token };
}

export async function submitLogin(
  gate: Sitegate,
  password: string,
  destination = "/",
  form?: Awaited<ReturnType<typeof loginForm>>,
): Promise<Response> {
  const page = form ?? (await loginForm(gate, destination));
  const body = new URLSearchParams({ csrf: page.token, next: destination, password });
  return gate.handle(
    new Request(`${BASE_URL}${gate.loginPath}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: page.cookie,
        Origin: BASE_URL,
        "Sec-Fetch-Site": "same-origin",
      },
      body,
    }),
    blocked,
  );
}

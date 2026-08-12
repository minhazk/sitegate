export const SECURITY_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet",
} as const;

export function secureResponse(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);
  const vary = headers.get("Vary");
  if (vary === null) headers.set("Vary", "Cookie");
  else if (
    vary.trim() !== "*" &&
    !vary.split(",").some((value) => value.trim().toLowerCase() === "cookie")
  ) {
    headers.set("Vary", `${vary}, Cookie`);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function redirect(location: string, status: 303 | 307 = 303): Response {
  return secureResponse(new Response(null, { status, headers: { Location: location } }));
}

export function jsonError(message: string, status: 400 | 401 | 403 | 405 | 413 | 429): Response {
  return secureResponse(
    Response.json(
      { error: message },
      {
        status,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      },
    ),
  );
}

import type { ResolvedConfig } from "./config.js";
import { secureResponse } from "./response.js";

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/gu, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "'": "&#39;",
      '"': "&quot;",
    };
    return entities[character] ?? character;
  });
}

interface LoginPageOptions {
  config: ResolvedConfig;
  csrfToken: string;
  destination: string;
  error?: string;
  status?: 200 | 401 | 403 | 429;
}

export function loginPage(options: LoginPageOptions): Response {
  const { branding, loginPath, strings } = options.config;
  const logo =
    branding.logo === undefined
      ? `<div class="mark" aria-hidden="true">S</div>`
      : `<img class="logo" src="${escapeHtml(branding.logo)}" alt="" />`;
  const error =
    options.error === undefined
      ? ""
      : `<div class="error" role="alert">${escapeHtml(options.error)}</div>`;
  const html = `<!doctype html>
<html lang="${escapeHtml(strings.language)}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex,nofollow,noarchive,nosnippet" />
  <title>${escapeHtml(branding.title)} · ${escapeHtml(branding.siteName)}</title>
  <style>
    :root { color-scheme: light dark; --accent: ${branding.accentColor}; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px; background: #f5f6fa; color: #17181c; font: 16px/1.5 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    main { width: min(100%, 420px); }
    .card { background: #fff; border: 1px solid #e4e5eb; border-radius: 20px; padding: 32px; box-shadow: 0 20px 55px rgba(20, 22, 34, .09); }
    .mark { width: 44px; height: 44px; display: grid; place-items: center; border-radius: 12px; background: var(--accent); color: #fff; font-weight: 800; letter-spacing: -.03em; }
    .logo { display: block; max-width: 160px; max-height: 52px; object-fit: contain; object-position: left center; }
    .eyebrow { margin: 20px 0 4px; color: #626572; font-size: 13px; font-weight: 650; letter-spacing: .08em; text-transform: uppercase; }
    h1 { margin: 0; font-size: clamp(25px, 6vw, 31px); line-height: 1.18; letter-spacing: -.035em; }
    .description { margin: 10px 0 24px; color: #626572; }
    label { display: block; margin-bottom: 7px; font-size: 14px; font-weight: 650; }
    input { width: 100%; min-height: 48px; border: 1px solid #c9cbd4; border-radius: 10px; padding: 10px 12px; background: #fff; color: #17181c; font: inherit; }
    input:focus { outline: 3px solid color-mix(in srgb, var(--accent) 22%, transparent); border-color: var(--accent); }
    button { width: 100%; min-height: 48px; margin-top: 14px; border: 0; border-radius: 10px; background: var(--accent); color: #fff; font: inherit; font-weight: 750; cursor: pointer; }
    button:hover { filter: brightness(.95); }
    button:focus-visible { outline: 3px solid color-mix(in srgb, var(--accent) 30%, transparent); outline-offset: 3px; }
    .error { margin: 0 0 16px; border-radius: 10px; padding: 11px 12px; background: #fff0f0; color: #9c1c1c; font-size: 14px; }
    .foot { margin: 16px 0 0; text-align: center; color: #777a86; font-size: 12px; }
    @media (max-width: 480px) { .card { padding: 24px; border-radius: 16px; } }
    @media (prefers-color-scheme: dark) {
      body { background: #101115; color: #f5f5f6; }
      .card { background: #181a20; border-color: #2c2f38; box-shadow: 0 20px 55px rgba(0, 0, 0, .28); }
      .eyebrow, .description, .foot { color: #a7aab5; }
      input { background: #101115; border-color: #494d59; color: #f5f5f6; }
      .error { background: #351a1c; color: #ffb4b8; }
    }
    @media (prefers-reduced-motion: reduce) { *, *::before, *::after { scroll-behavior: auto !important; } }
  </style>
</head>
<body>
  <main>
    <section class="card" aria-labelledby="sitegate-title">
      ${logo}
      <p class="eyebrow">${escapeHtml(branding.siteName)}</p>
      <h1 id="sitegate-title">${escapeHtml(branding.title)}</h1>
      <p class="description">${escapeHtml(branding.description)}</p>
      ${error}
      <form action="${escapeHtml(loginPath)}" method="post">
        <input type="hidden" name="csrf" value="${escapeHtml(options.csrfToken)}" />
        <input type="hidden" name="next" value="${escapeHtml(options.destination)}" />
        <label for="sitegate-password">${escapeHtml(strings.passwordLabel)}</label>
        <input id="sitegate-password" name="password" type="password" autocomplete="current-password" required autofocus maxlength="1024" />
        <button type="submit">${escapeHtml(strings.submitLabel)}</button>
      </form>
    </section>
    <p class="foot">${escapeHtml(strings.footerText)}</p>
  </main>
</body>
</html>`;

  return secureResponse(
    new Response(html, {
      status: options.status ?? (options.error === undefined ? 200 : 401),
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy":
          "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
        "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
        "X-Frame-Options": "DENY",
      },
    }),
  );
}

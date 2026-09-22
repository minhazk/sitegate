import { expect, test } from "@playwright/test";

test("a real browser form signs in and returns to the requested page", async ({ page }) => {
  await page.goto("/reports?month=9");
  await page.getByLabel("Password", { exact: true }).fill("browser test password");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page).toHaveURL("/reports?month=9");
  await expect(page.getByRole("heading", { name: "Private application" })).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
  await page.goto("/reports");
  await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
});

test("opening another tab does not expire the first tab's login form", async ({
  page,
  context,
}) => {
  await page.goto("/first");
  const second = await context.newPage();
  await second.goto("/second");
  await page.getByLabel("Password", { exact: true }).fill("browser test password");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page).toHaveURL("/first");
  await second.getByLabel("Password", { exact: true }).fill("browser test password");
  await second.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(second).toHaveURL("/second");
});

test("wrong passwords can be corrected without reloading, and visibility is accessible", async ({
  page,
}) => {
  await page.goto("/reports");
  const password = page.getByLabel("Password", { exact: true });
  await password.fill("wrong password");
  await page.getByRole("button", { name: "Show password" }).click();
  await expect(password).toHaveAttribute("type", "text");
  await page.getByRole("button", { name: "Hide password" }).click();
  await expect(password).toHaveAttribute("type", "password");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("That password is not correct");
  await expect(password).toHaveAttribute("aria-invalid", "true");
  await password.fill("browser test password");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page).toHaveURL("/reports");
});

test("missing cookies have a clear recovery message and a fresh working form", async ({
  page,
  context,
}) => {
  await page.goto("/reports");
  await context.clearCookies();
  await page.getByLabel("Password", { exact: true }).fill("browser test password");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Allow cookies for this site");
  await page.getByLabel("Password", { exact: true }).fill("browser test password");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page).toHaveURL("/reports");
});

test("the complete form still works without JavaScript", async ({ browser, baseURL }) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    baseURL: baseURL ?? "http://127.0.0.1:4179",
  });
  try {
    const page = await context.newPage();
    await page.goto("/reports");
    await expect(page.getByRole("button", { name: "Show password" })).toBeHidden();
    await page.getByLabel("Password", { exact: true }).fill("browser test password");
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(page).toHaveURL("/reports");
  } finally {
    await context.close();
  }
});

test("mobile layout fits and the enhancement does not violate CSP", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("/reports");
  await expect(page.getByRole("button", { name: "Show password" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(errors).toEqual([]);
});

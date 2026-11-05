import { test, expect } from "@playwright/test";
import { mockApi, mockPhotos, ok } from "./helpers";

// S-06: the page now fetches the catalogue on load, so smoke runs against the mocked API too.
test.beforeEach(async ({ page }) => {
  await mockApi(page, ok());
  await mockPhotos(page);
});

test("page loads with the right title and a rendered placeholder", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

  await page.goto("/");
  await expect(page).toHaveTitle("A44 Medley Garage Sale");
  await expect(page.locator("#app")).not.toBeEmpty();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("A44 Medley Garage Sale");
  expect(errors).toEqual([]);
});

test("privacy and viewport meta tags are present (brief 4.4)", async ({ page }) => {
  await page.goto("/");
  const meta = (attr: string, name: string) =>
    page.locator(`meta[${attr}="${name}"]`).getAttribute("content");

  expect(await meta("name", "referrer")).toBe("no-referrer");
  expect(await meta("name", "robots")).toBe("noindex");
  expect(await meta("name", "viewport")).toContain("width=device-width");

  const csp = await meta("http-equiv", "Content-Security-Policy");
  expect(csp).toContain("default-src 'none'");
  expect(csp).toContain("script-src 'self'");
  expect(csp).not.toContain("unsafe-inline");
  expect(csp).not.toContain("unsafe-eval");
});

test("placeholder has no horizontal overflow at phone width", async ({ page }) => {
  await page.goto("/");
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

const EXPECTED_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; " +
  "connect-src 'self' https://script.google.com https://script.googleusercontent.com; " +
  "base-uri 'none'; form-action 'none'";

test("CSP is exactly the agreed policy and precedes every script and stylesheet", async ({ page }) => {
  await page.goto("/");
  const csp = page.locator('head meta[http-equiv="Content-Security-Policy"]');
  await expect(csp).toHaveCount(1);
  expect(await csp.getAttribute("content")).toBe(EXPECTED_CSP);

  // Document order inside <head>: nothing that loads resources may come before the CSP.
  const loadersBefore = await page.evaluate(() => {
    const kids = [...document.head.children];
    const at = kids.findIndex((el) => el.matches('meta[http-equiv="Content-Security-Policy"]'));
    return kids.slice(0, at).filter((el) => el.matches("script, link, style, img, iframe, object, embed")).length;
  });
  expect(loadersBefore).toBe(0);
  expect(await page.locator("head script, head link").count()).toBeGreaterThan(0);
  expect(await page.locator("body script").count()).toBeGreaterThan(0);
});

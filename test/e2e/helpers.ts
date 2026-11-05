// Shared e2e helpers: mock the Apps Script API and the photo manifest. Nothing here touches the
// network or the real photos. The API URL is matched by HOST (script.google.com, and
// script.googleusercontent.com which Apps Script redirects to), so tests do not depend on the
// real deployment URL in src/site/config.ts.
import type { Page, Route } from "@playwright/test";
import { MANIFEST, response } from "../fixtures/catalogue-fixture";

// A valid 1x1 WebP, used for every thumbnail.
// Stored as lowercase hex: a long mixed-case base64 string looks like a sheet ID to tools/pii-scan.mjs.
const TINY_WEBP = Buffer.from("52494646220000005745425056503820160000003001009d012a010001000ec0fe25a400037000000000", "hex");

export type ApiHandler = (route: Route) => Promise<void> | void;

export const json = (body: unknown): ApiHandler => (route) =>
  route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

export const ok = (body: unknown = response()): ApiHandler => json(body);
export const serverError: ApiHandler = (route) =>
  route.fulfill({ status: 500, contentType: "text/plain", body: "boom" });
export const htmlPage: ApiHandler = (route) =>
  route.fulfill({ status: 200, contentType: "text/html", body: "<html><body>Sign in to continue</body></html>" });
export const errorJson: ApiHandler = json({ error: "unavailable" });
export const networkDown: ApiHandler = (route) => route.abort("failed");
/** Never answers (until the page closes). */
export const hang: ApiHandler = () => new Promise<void>(() => {});

export async function mockApi(page: Page, handler: ApiHandler): Promise<{ urls: string[] }> {
  const seen = { urls: [] as string[] };
  await page.route(
    (u) => /(^|\.)script\.google(usercontent)?\.com$/.test(u.hostname),
    (route) => {
      seen.urls.push(route.request().url());
      return handler(route);
    },
  );
  return seen;
}

export async function mockPhotos(page: Page, manifest: unknown = MANIFEST): Promise<void> {
  await page.route("**/photos/manifest.json", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(manifest) }),
  );
  await page.route("**/photos/*.webp", (r) =>
    r.fulfill({ status: 200, contentType: "image/webp", body: TINY_WEBP }),
  );
}

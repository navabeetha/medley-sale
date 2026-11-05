// S-06 QA fixes (red step). Covers the findings F1 to F5 in the latest S-06 entry of
// docs/qa/qa-log.md, plus the contactUrl allow-list and the "last saved list" wording.
// Same mocks as catalogue.spec.ts (helpers.ts); synthetic data only.
//
// Conventions here:
//  - The cache key is NOT hardcoded: a test that needs a bad cache first loads normally, then
//    overwrites every localStorage entry, so the implementer may rename or add keys (e.g. a
//    manifest cache next to the catalogue).
//  - Timings are loose on purpose: the manifest timeout is "about 3 s", not pinned.
import { test, expect, type Page } from "@playwright/test";
import { ITEMS, MANIFEST, CONTACT_URL, item, response } from "../fixtures/catalogue-fixture";
import { hang, mockApi, mockPhotos, ok, serverError, type ApiHandler } from "./helpers";

const LOADING_TEXT = "Loading the sale… this can take a few seconds";
const rows = (page: Page) => page.getByTestId("item-row");
const row = (page: Page, id: string) => page.locator(`[data-testid="item-row"][data-id="${id}"]`);
const isApiHost = (u: URL) => /(^|\.)script\.google(usercontent)?\.com$/.test(u.hostname);

/** Collects uncaught page errors (including unhandled promise rejections). */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

/** Swap the API mock for a new handler (later routes win, but unroute keeps the old one from lingering). */
async function replaceApi(page: Page, handler: ApiHandler): Promise<{ urls: string[] }> {
  await page.unroute(isApiHost);
  return mockApi(page, handler);
}

/** Overwrite every localStorage entry with `raw` (used to plant a bad cache). */
async function plantCache(page: Page, raw: string): Promise<void> {
  await page.evaluate((v) => {
    for (const k of Object.keys(localStorage)) localStorage.setItem(k, v);
  }, raw);
}

/** A manifest route that answers after `ms`. Swallows the error if the page is gone by then. */
async function slowManifest(page: Page, ms: number): Promise<void> {
  await page.route("**/photos/manifest.json", async (r) => {
    await new Promise((res) => setTimeout(res, ms));
    try {
      await r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(MANIFEST) });
    } catch {
      /* page closed */
    }
  });
}

test.beforeEach(async ({ page }) => {
  await mockPhotos(page);
});

// ---------------------------------------------------------------------------------------------
test.describe("F1: the manifest never blocks the list", () => {
  test("first visit: a manifest that never answers still gives rows within 5 s of the API answering, with no thumbnails", async ({ page }) => {
    await page.route("**/photos/manifest.json", () => new Promise<void>(() => {}));
    await mockApi(page, ok());
    await page.goto("/");
    await expect(rows(page)).toHaveCount(ITEMS.length, { timeout: 5_000 });
    await expect(page.getByTestId("loading")).toHaveCount(0);
    await expect(page.locator("img")).toHaveCount(0);
  });

  test("repeat visit: cached rows show within 1 s while the manifest takes 3 s and the API hangs", async ({ page }) => {
    await mockApi(page, ok());
    await page.goto("/");
    await expect(rows(page)).toHaveCount(ITEMS.length);
    await replaceApi(page, hang);
    await slowManifest(page, 3_000);
    await page.reload();
    await expect(rows(page)).toHaveCount(ITEMS.length, { timeout: 1_000 });
  });

  const badManifests: [string, (page: Page) => Promise<unknown>][] = [
    ["a 404", (p) => p.route("**/photos/manifest.json", (r) => r.fulfill({ status: 404, body: "nope" }))],
    ["junk that is not JSON", (p) => p.route("**/photos/manifest.json", (r) => r.fulfill({ status: 200, contentType: "application/json", body: "{not json" }))],
    ["JSON null", (p) => p.route("**/photos/manifest.json", (r) => r.fulfill({ status: 200, contentType: "application/json", body: "null" }))],
    ["a JSON array", (p) => p.route("**/photos/manifest.json", (r) => r.fulfill({ status: 200, contentType: "application/json", body: "[1,2]" }))],
    ["a JSON string", (p) => p.route("**/photos/manifest.json", (r) => r.fulfill({ status: 200, contentType: "application/json", body: '"hello"' }))],
  ];
  for (const [label, setup] of badManifests) {
    test(`a manifest that is ${label} gives rows with no thumbnails and no crash`, async ({ page }) => {
      const errors = watchErrors(page);
      await setup(page);
      await mockApi(page, ok());
      await page.goto("/");
      await expect(rows(page)).toHaveCount(ITEMS.length);
      await expect(page.locator("img")).toHaveCount(0);
      await expect(page.getByTestId("loading")).toHaveCount(0);
      expect(errors).toEqual([]);
    });
  }
});

// ---------------------------------------------------------------------------------------------
test.describe("F2: a bad item never poisons the page", () => {
  const good1 = item({ id: "I-9301", name: "Good One" });
  const good2 = item({ id: "I-9302", name: "Good Two", freeUnits: 0, unitsLeft: 1 });
  // Each entry is something the API might send inside `items` that must be dropped.
  const bad: [string, unknown][] = [
    ["null", null],
    ["a string", "just text"],
    ["a number", 7],
    ["an item with no id", { ...item({ id: "x", name: "No Id" }), id: undefined }],
    ["an item whose id is a number", { ...item({ id: "x", name: "Numeric Id" }), id: 42 }],
    ["an item with no name", { ...item({ id: "I-9399", name: "x" }), name: undefined }],
    ["an item whose name is a number", { ...item({ id: "I-9398", name: "x" }), name: 5 }],
    ["an item with no freeUnits", { ...item({ id: "I-9397", name: "No Free" }), freeUnits: undefined }],
    ["an item whose freeUnits is a string", { ...item({ id: "I-9396", name: "Str Free" }), freeUnits: "1" }],
    ["an item with no unitsLeft", { ...item({ id: "I-9395", name: "No Left" }), unitsLeft: undefined }],
    ["an item whose unitsLeft is a string", { ...item({ id: "I-9394", name: "Str Left" }), unitsLeft: "1" }],
  ];

  for (const [label, b] of bad) {
    test(`drops ${label} from the API answer and renders the valid items around it`, async ({ page }) => {
      const errors = watchErrors(page);
      await mockApi(page, ok(response([good1, b as never, good2])));
      await page.goto("/");
      await expect(rows(page)).toHaveCount(2);
      const ids = await rows(page).evaluateAll((els) => els.map((e) => e.getAttribute("data-id")));
      expect(ids).toEqual(["I-9301", "I-9302"]); // free first, then reserved
      await expect(page.getByTestId("loading")).toHaveCount(0);
      expect(errors).toEqual([]);
    });
  }

  test("renders valid items when the answer mixes several kinds of bad item with them", async ({ page }) => {
    const errors = watchErrors(page);
    const mixed = [null, good1, { id: "I-1", name: "x" }, ...bad.map(([, b]) => b), good2];
    await mockApi(page, ok(response(mixed as never)));
    await page.goto("/");
    await expect(rows(page)).toHaveCount(2);
    expect(errors).toEqual([]);
  });

  test("the QA repro answer ({id,name} only, then null) leaves the page working after a reload", async ({ page }) => {
    const errors = watchErrors(page);
    await mockApi(page, ok({ items: [{ id: "I-1", name: "x" }, null], contactUrl: null }));
    await page.goto("/");
    await expect(page.getByTestId("loading")).toHaveCount(0);
    // Reload with a healthy API: the page must fetch it and show the real list.
    const seen = await replaceApi(page, ok());
    await page.reload();
    await expect(rows(page)).toHaveCount(ITEMS.length);
    expect(seen.urls.length).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });

  test("after a mixed answer and a reload with a hanging API, the page still calls the API and throws nothing", async ({ page }) => {
    const errors = watchErrors(page);
    await mockApi(page, ok(response([good1, null as never, good2])));
    await page.goto("/");
    // First-load rendering is covered by the tests above; here we only wait for it to settle,
    // so a failure below is about the reload, not the first load.
    await expect(page.getByTestId("loading")).toHaveCount(0);
    const seen = await replaceApi(page, hang);
    await page.reload();
    await expect(async () => expect(seen.urls.length).toBeGreaterThan(0)).toPass({ timeout: 5_000 });
    // Either the cache was never saved with the bad item or it is filtered on read.
    expect(errors).toEqual([]);
    for (const id of await rows(page).evaluateAll((els) => els.map((e) => e.getAttribute("data-id")))) {
      expect(["I-9301", "I-9302"]).toContain(id);
    }
  });

  const badCaches: [string, string][] = [
    ["an item list holding null", JSON.stringify({ items: [null], contactUrl: null })],
    ["only non-object items", JSON.stringify({ items: [5, "x", null], contactUrl: null })],
    ["items that lack freeUnits", JSON.stringify({ items: [{ id: "I-1", name: "x" }], contactUrl: null })],
    ["a valid item next to a null one", JSON.stringify({ items: [item({ id: "I-9301", name: "Stale" }), null], contactUrl: null })],
  ];
  for (const [label, raw] of badCaches) {
    test(`ignores a valid-JSON cache with ${label}: shows loading, calls the API, renders fresh data, no errors`, async ({ page }) => {
      const errors = watchErrors(page);
      await mockApi(page, ok());
      await page.goto("/");
      await expect(rows(page)).toHaveCount(ITEMS.length);
      await plantCache(page, raw);

      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      const seen = await replaceApi(page, async (route) => {
        await gate;
        await ok()(route);
      });
      await page.reload();
      await expect(page.getByTestId("loading")).toHaveText(LOADING_TEXT);
      await expect(rows(page)).toHaveCount(0);
      release();
      await expect(rows(page)).toHaveCount(ITEMS.length);
      await expect(page.getByTestId("loading")).toHaveCount(0);
      expect(seen.urls.length).toBeGreaterThan(0);
      expect(errors).toEqual([]);
    });
  }
});

// ---------------------------------------------------------------------------------------------
test.describe("F3: fallback WhatsApp link tap target", () => {
  test("the 'message me on WhatsApp' link in the refresh-failed notice is at least 44 px tall", async ({ page }) => {
    await mockApi(page, ok());
    await page.goto("/");
    await expect(rows(page)).toHaveCount(ITEMS.length);
    await replaceApi(page, serverError);
    await page.reload();
    const link = page.getByTestId("catalogue-error").locator('a[href^="https://wa.me/"]');
    await expect(link).toBeVisible();
    expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  });
});

// ---------------------------------------------------------------------------------------------
test.describe("F4: a contactUrl that already has a query string", () => {
  test("still gives each reserve link exactly one text parameter holding our reserve message", async ({ page }) => {
    await mockApi(page, ok(response(ITEMS, `${CONTACT_URL}?text=hi`)));
    await page.goto("/");
    await expect(rows(page)).toHaveCount(ITEMS.length);
    for (const it of ITEMS) {
      const href = (await row(page, it.id).getByRole("link", { name: "Message to reserve" }).getAttribute("href"))!;
      const u = new URL(href);
      expect(u.origin + u.pathname).toBe(CONTACT_URL);
      expect(u.searchParams.getAll("text")).toEqual([`Hi! I'd like to reserve: ${it.name}`]);
    }
  });
});

// ---------------------------------------------------------------------------------------------
test.describe("F5: a malformed manifest entry", () => {
  const manifest = {
    "I-9001": [{ thumb: "I-9001-1-thumb.webp" }], // no alt
    "I-9002": [{ alt: "Lamp" }], // no thumb
    "I-9004": "str", // not an array
    "I-9003": MANIFEST["I-9003"], // valid, still gets its thumbnail
  };

  test("shows no thumbnail for that item, and the DOM never has src or alt set to 'undefined'", async ({ page }) => {
    const errors = watchErrors(page);
    await mockPhotos(page, manifest);
    await mockApi(page, ok());
    await page.goto("/");
    await expect(rows(page)).toHaveCount(ITEMS.length);
    await expect(row(page, "I-9003").locator("img.thumb")).toHaveCount(1);
    for (const id of ["I-9001", "I-9002", "I-9004"]) await expect(row(page, id).locator("img")).toHaveCount(0);
    const attrs = await page.evaluate(() =>
      [...document.querySelectorAll("[src],[alt]")].map((e) => `${e.getAttribute("src")}|${e.getAttribute("alt")}`),
    );
    expect(attrs.filter((a) => a.includes("undefined"))).toEqual([]);
    expect(errors).toEqual([]);
  });

  test("an entry that is itself not an object (null or a string) shows no thumbnail and does not crash", async ({ page }) => {
    const errors = watchErrors(page);
    await mockPhotos(page, { "I-9001": [null], "I-9003": ["I-9003-1-thumb.webp"] });
    await mockApi(page, ok());
    await page.goto("/");
    await expect(rows(page)).toHaveCount(ITEMS.length);
    await expect(page.locator("img")).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
test.describe("contactUrl allow-list", () => {
  const badUrls = [
    "javascript:alert(1)",
    "http://wa.me/919000000001",
    "https://wa.me.evil.example/919000000001",
    "https://example.com/",
  ];
  for (const url of badUrls) {
    test(`a contactUrl of ${url} gives no reserve link and no fallback link, and the list still renders`, async ({ page }) => {
      await mockApi(page, ok(response(ITEMS, url)));
      await page.goto("/");
      await expect(rows(page)).toHaveCount(ITEMS.length);
      await expect(page.getByRole("link", { name: "Message to reserve" })).toHaveCount(0);
      await expect(page.locator("a")).toHaveCount(0);

      // A failed refresh over the cached list must not offer the bad URL as a fallback either.
      await replaceApi(page, serverError);
      await page.reload();
      await expect(page.getByTestId("catalogue-error")).toBeVisible();
      await expect(rows(page)).toHaveCount(ITEMS.length);
      await expect(page.locator("a")).toHaveCount(0);
    });
  }
});

// ---------------------------------------------------------------------------------------------
test.describe("wording of the refresh-failed notice", () => {
  test("with a cached list on screen the notice says 'showing the last saved list' and not 'couldn't load the sale'", async ({ page }) => {
    await mockApi(page, ok());
    await page.goto("/");
    await expect(rows(page)).toHaveCount(ITEMS.length);
    await replaceApi(page, serverError);
    await page.reload();
    const err = page.getByTestId("catalogue-error");
    await expect(err).toBeVisible();
    await expect(rows(page)).toHaveCount(ITEMS.length);
    await expect(err).toContainText("showing the last saved list");
    expect((await page.locator("body").innerText()).toLowerCase()).not.toMatch(/couldn.t load the sale/);
  });

  test("on a first visit the failure text is unchanged", async ({ page }) => {
    await mockApi(page, serverError);
    await page.goto("/");
    await expect(page.getByTestId("catalogue-error")).toContainText("We couldn't load the sale just now. Please try again.");
    await expect(page.getByTestId("catalogue-error")).not.toContainText("last saved list");
  });
});

// S-06 follow-ups F7 to F9 (red step), from the last S-06 entry in docs/qa/qa-log.md.
// Synthetic data only. Same mocks as catalogue.spec.ts (helpers.ts).
//  - F7: an API item with a wrongly typed field is dropped, the others render, no page error.
//  - F8: a manifest slower than 4 s still fills in the thumbnails; rows never wait for it.
//  - F9: the reserve link encodes spaces as %20, never "+".
import { test, expect, type Page } from "@playwright/test";
import { ITEMS, MANIFEST, CONTACT_URL, item, response } from "../fixtures/catalogue-fixture";
import { mockApi, mockPhotos, ok } from "./helpers";

const rows = (page: Page) => page.getByTestId("item-row");
const row = (page: Page, id: string) => page.locator(`[data-testid="item-row"][data-id="${id}"]`);

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

/** Realistic data: the items that have a manifest entry say photos > 0. */
const PHOTO_ITEMS = ITEMS.map((i) => (MANIFEST[i.id] ? { ...i, photos: MANIFEST[i.id]!.length } : i));

/** A manifest route that answers after `ms`; tolerant of the page closing first. */
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
test.describe("F7: an item with a wrongly typed field is dropped, never thrown on", () => {
  // The QA repro: JSON.stringify drops an undefined price, so the key is simply missing.
  test("the QA repro (an item with no price key) is dropped and every other item renders, with no page error", async ({ page }) => {
    const errors = watchErrors(page);
    await mockApi(page, ok(response([{ ...ITEMS[0]!, id: "I-7", price: undefined } as never, ...ITEMS])));
    await page.goto("/");
    await expect(rows(page)).toHaveCount(ITEMS.length);
    await expect(row(page, "I-7")).toHaveCount(0);
    await expect(page.getByTestId("catalogue-error")).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  const bad: [string, Record<string, unknown>][] = [
    ["a string price", { price: "100" }],
    ["the string \"NaN\" as price (a real NaN becomes null in JSON, which is valid)", { price: "NaN" }],
    ["a numeric brand", { brand: 7 }],
    ["a numeric availableFrom", { availableFrom: 20261202 }],
    ["a numeric tab", { tab: 3 }],
    ["an object notes", { notes: {} }],
    ["a boolean category", { category: true }],
    ["a numeric author", { author: 1 }],
    ["string photos", { photos: "2" }],
  ];
  for (const [label, over] of bad) {
    test(`drops an item with ${label}; the valid items still render with no page error`, async ({ page }) => {
      const errors = watchErrors(page);
      await mockApi(page, ok(response([{ ...ITEMS[0]!, id: "I-7", ...over } as never, ...ITEMS])));
      await page.goto("/");
      await expect(rows(page)).toHaveCount(ITEMS.length);
      await expect(row(page, "I-7")).toHaveCount(0);
      await expect(page.getByTestId("catalogue-error")).toHaveCount(0);
      expect(errors).toEqual([]);
    });
  }

  test("an item with a null price is valid and shows 'Ask'", async ({ page }) => {
    await mockApi(page, ok(response([item({ id: "I-8", name: "Ask Item", price: null })])));
    await page.goto("/");
    await expect(row(page, "I-8").getByTestId("item-price")).toHaveText("Ask");
  });
});

// ---------------------------------------------------------------------------------------------
test.describe("F8: a slow manifest still fills in the thumbnails", () => {
  test("rows show before a 4.5 s manifest arrives, then the thumbnails appear (no abort throws them away)", async ({ page }) => {
    test.setTimeout(30_000);
    await slowManifest(page, 4_500);
    await mockApi(page, ok(response(PHOTO_ITEMS)));
    const t0 = Date.now();
    await page.goto("/");
    await expect(rows(page)).toHaveCount(ITEMS.length);
    // Rows are up well before the manifest answers, and have no images yet.
    expect(Date.now() - t0).toBeLessThan(3_500);
    await expect(page.locator("img.thumb")).toHaveCount(0);
    // Then the late manifest fills the slots.
    for (const id of Object.keys(MANIFEST)) {
      await expect(row(page, id).locator("img")).toHaveCount(1, { timeout: 10_000 });
    }
    await expect(row(page, "I-9002").locator("img")).toHaveCount(0);
  });
});

test.describe("F8: layout shift with a delayed manifest (pin)", () => {
  test("keeps cumulative layout shift under 0.1 with photos > 0 on real-shaped data and a manifest delayed 2 s", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "layout-shift entries exist only in Chromium");
    await page.addInitScript(() => {
      (window as unknown as { __cls: number }).__cls = 0;
      new PerformanceObserver((list) => {
        for (const e of list.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) {
          if (!e.hadRecentInput) (window as unknown as { __cls: number }).__cls += e.value;
        }
      }).observe({ type: "layout-shift", buffered: true });
    });
    await slowManifest(page, 2_000);
    await mockApi(page, ok(response(PHOTO_ITEMS)));
    await page.goto("/");
    await expect(rows(page)).toHaveCount(ITEMS.length);
    await expect(row(page, "I-9001").locator("img")).toHaveCount(1, { timeout: 10_000 });
    await page.waitForLoadState("networkidle");
    const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
    expect(cls).toBeLessThan(0.1);
  });
});

// ---------------------------------------------------------------------------------------------
test.describe("F9: the reserve link encodes spaces as %20", () => {
  const NAMES = ["Test Kettle", "Pots & Pans #2", "50% off + more", "a?b=c&d"];
  const items = NAMES.map((name, n) => item({ id: `I-${9100 + n}`, name }));

  for (const contact of [CONTACT_URL, `${CONTACT_URL}?text=hi`]) {
    test(`raw href has %20 for spaces, no "+", one text parameter, and decodes exactly (contactUrl ${contact === CONTACT_URL ? "bare" : "with a query"})`, async ({ page }) => {
      await mockApi(page, ok(response(items, contact)));
      await page.goto("/");
      await expect(rows(page)).toHaveCount(items.length);
      for (const it of items) {
        const href = (await row(page, it.id).getByRole("link", { name: "Message to reserve" }).getAttribute("href"))!;
        const query = href.split("?")[1] ?? "";
        const textParams = query.split("&").filter((p) => p.startsWith("text="));
        expect(textParams).toHaveLength(1);
        expect(href).not.toContain("+"); // a literal plus would be a space to some readers and a plus to others
        expect(textParams[0]).toContain("%20");
        expect(decodeURIComponent(textParams[0]!.slice("text=".length))).toBe(`Hi! I'd like to reserve: ${it.name}`);
        expect(href.split("#")).toHaveLength(1);
      }
    });
  }
});

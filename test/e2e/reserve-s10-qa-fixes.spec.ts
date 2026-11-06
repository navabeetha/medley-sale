// S-12 carried tickets F1, F2 and F4 from the S-10 QA (PM, 2026-11-06). Written BEFORE the fixes: each test must
// fail on the current site. (F3, landing on #/b/<token>, is pinned in booking-page.spec.ts.) API mocked; synthetic data.
//
//   F1  A live catalogue arriving while the buyer types on #/reserve must not detach the focused input (that closes
//       the phone keyboard). The list updates; the form, the heading and the typed text stay put.
//   F2  On success only the entries that were SENT leave the basket; Remove is disabled while a booking is pending.
//   F4  Entering the form focuses its h2 (tabindex -1). Back restores the catalogue's scroll position and focuses
//       the Reserve link.
import { test, expect, type Page, type Route } from "@playwright/test";
import { ITEMS, item, response } from "../fixtures/catalogue-fixture";
import { json, mockApi, mockPhotos, ok } from "./helpers";

const KETTLE = "I-9001";
const LAMP = "I-9002"; // none free, waitingCount 2
const NOVEL = "I-9004";
const TOKEN = ["0f1e2d3c4b5a6978", "8796a5b4c3d2e1f0"].join(""); // lowercase hex: not a sheet-ID lookalike
const CATALOGUE_KEY = "medley-sale:catalogue:v1";
const BASKET_KEY = "medley-sale:basket:v1";
const SUCCESS = { ok: true, token: TOKEN, bookingId: 1, units: [], skipped: [], whatsappUrl: null };
const reserving = (items = ITEMS) => ({ ...response(items), reserving: true });
const t = (p: Page, id: string) => p.getByTestId(id);
const row = (p: Page, id: string) => p.locator(`[data-testid="item-row"][data-id="${id}"]`);
const focusedTestId = (p: Page) => p.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.testid ?? null);

/** A promise whose resolution the test controls. */
function gate(): { wait: Promise<void>; open: () => void } {
  let open!: () => void;
  const wait = new Promise<void>((r) => { open = r; });
  return { wait, open };
}

/** GET answers `catalogue` (after `getGate` if given); POST answers `post`. Returns the POST bodies seen. */
async function setup(page: Page, opts: { catalogue?: unknown; getGate?: Promise<void>; post?: (r: Route) => Promise<void> | void } = {}): Promise<string[]> {
  const posts: string[] = [];
  await mockApi(page, async (route) => {
    if (route.request().method() === "POST") {
      posts.push(route.request().postData() ?? "");
      return (opts.post ?? json(SUCCESS))(route);
    }
    await opts.getGate;
    return ok(opts.catalogue ?? reserving())(route);
  });
  return posts;
}

async function fillAndSend(page: Page): Promise<void> {
  await t(page, "reserve-name").fill("Asha Testperson");
  await t(page, "reserve-number").fill("90000 00012");
  await t(page, "reserve-submit").click();
}

test.beforeEach(async ({ page }) => {
  await mockPhotos(page);
});

test.describe("F1: a live list arriving on #/reserve keeps the focused input", () => {
  test("the input keeps focus, its element and its text; only the list updates", async ({ page }) => {
    const g = gate();
    const live = reserving(ITEMS.map((i) => (i.id === LAMP ? { ...i, waitingCount: 4 } : i)));
    await setup(page, { catalogue: live, getGate: g.wait });
    // A cached list and a basket put the buyer straight on the form while the live list is still on its way.
    await page.addInitScript(([ck, bk, cache, basket]) => {
      localStorage.setItem(ck!, cache!);
      localStorage.setItem(bk!, basket!);
    }, [CATALOGUE_KEY, BASKET_KEY, JSON.stringify(reserving()), JSON.stringify([{ id: LAMP, units: 1 }])]);
    await page.goto("/#/reserve");
    await expect(t(page, "reserve-form")).toBeVisible();
    await expect(t(page, "reserve-item-outcome")).toHaveText(/position 3\b/i); // from the cache: 2 waiting
    const name = t(page, "reserve-name");
    await name.focus();
    await name.pressSequentially("Asha");
    await name.evaluate((n) => { (n as HTMLInputElement & { mark?: number }).mark = 1; });

    g.open();
    await expect(t(page, "reserve-item-outcome")).toHaveText(/position 5\b/i); // live: 4 waiting

    expect(await name.evaluate((n) => (n as HTMLInputElement & { mark?: number }).mark), "same input element").toBe(1);
    expect(await focusedTestId(page)).toBe("reserve-name");
    await expect(name).toHaveValue("Asha");
  });
});

test.describe("F2: success removes only what was sent; Remove is off while pending", () => {
  test("Remove is disabled while a booking is pending, and back once it failed", async ({ page }) => {
    const g = gate();
    await setup(page, { post: async (r) => { await g.wait; await json({ ok: false, error: "busy" })(r); } });
    await page.goto("/");
    await row(page, KETTLE).getByTestId("add-button").click();
    await row(page, LAMP).getByTestId("add-button").click();
    await t(page, "basket-reserve").click();
    await fillAndSend(page);
    await expect(t(page, "reserve-status")).toBeVisible();
    for (const b of await t(page, "reserve-item-remove").all()) await expect(b).toBeDisabled();
    g.open();
    await expect(t(page, "reserve-error")).toBeVisible();
    for (const b of await t(page, "reserve-item-remove").all()) await expect(b).toBeEnabled();
  });

  test("an item added to the basket while the booking was in flight survives the success", async ({ page }) => {
    const g = gate();
    await setup(page, { post: async (r) => { await g.wait; await json(SUCCESS)(r); } });
    await page.goto("/");
    await expect(t(page, "item-row")).toHaveCount(ITEMS.length);
    await row(page, KETTLE).getByTestId("add-button").click();
    await t(page, "basket-reserve").click();
    await fillAndSend(page);
    await expect(t(page, "reserve-status")).toBeVisible();
    // The buyer goes back to the sale and adds another item while the answer is still on its way.
    await t(page, "reserve-back").click();
    await row(page, NOVEL).getByTestId("add-button").click();
    g.open();
    await expect.poll(() => page.evaluate(() => location.hash)).toBe(`#/b/${TOKEN}`);
    const stored = await page.evaluate((k) => localStorage.getItem(k), BASKET_KEY);
    expect(JSON.parse(stored ?? "[]")).toEqual([{ id: NOVEL, units: 1 }]); // Kettle was sent and is gone
  });
});

test.describe("F4: focus and scroll around the form", () => {
  test("entering the form focuses its heading, which is programmatically focusable only", async ({ page }) => {
    await setup(page);
    await page.goto("/");
    await row(page, KETTLE).getByTestId("add-button").click();
    await t(page, "basket-reserve").click();
    const h2 = page.getByRole("heading", { level: 2, name: "Your reservation" });
    await expect(h2).toBeFocused();
    await expect(h2).toHaveAttribute("tabindex", "-1");
  });

  for (const how of ["the Back link", "the browser Back button"] as const) {
    test(`${how} restores the catalogue's scroll position and focuses the Reserve link`, async ({ page }) => {
      const many = Array.from({ length: 40 }, (_, i) => item({ id: `I-95${String(i).padStart(2, "0")}`, name: `Test Filler ${i}` }));
      await setup(page, { catalogue: reserving(many) });
      await page.goto("/");
      await expect(t(page, "item-row")).toHaveCount(40);
      await row(page, "I-9500").getByTestId("add-button").click();
      await page.evaluate(() => window.scrollTo(0, 900));
      const before = await page.evaluate(() => window.scrollY);
      expect(before, "the page is long enough to scroll").toBeGreaterThan(300);
      await t(page, "basket-reserve").click();
      await expect(t(page, "reserve-form")).toBeVisible();
      if (how === "the Back link") await t(page, "reserve-back").click();
      else await page.goBack();
      await expect(t(page, "catalogue")).toBeVisible();
      await expect.poll(() => page.evaluate((b) => Math.abs(window.scrollY - b), before)).toBeLessThanOrEqual(2);
      expect(await focusedTestId(page)).toBe("basket-reserve");
    });
  }
});
